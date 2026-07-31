import { useMemo, useState } from 'react'
import type { KittyView } from '../../shared/types'
import { formatAmount, fromWire, parseAmount } from '../../shared/money'
import { createRail, railDecimals, railSymbol } from '../rails'
import { api } from '../lib/api'
import { useI18n } from '../i18n'
import { errorKey, isCancellation } from '../lib/errors'
import { tap } from '../lib/host'
import { ensureDeviceId } from '../lib/device'
import { Button } from './ui'
import { Sheet } from './Sheet'
import type { TranslationKey } from '../i18n'

export interface ContributionOutcome {
  amount: bigint
  formatted: string
}

export function ContributeSheet({
  view,
  open,
  onClose,
  onDone,
  onError,
}: {
  view: KittyView
  open: boolean
  onClose: () => void
  onDone: (outcome: ContributionOutcome) => void
  onError: (key: TranslationKey) => void
}) {
  const { t } = useI18n()
  const { kitty } = view

  const decimals = railDecimals(kitty.rail, kitty.chainId)
  const symbol = railSymbol(kitty.rail, kitty.chainId)

  const [amount, setAmount] = useState('')
  const [name, setName] = useState(() => localStorage.getItem('kitty.name') ?? '')
  const [message, setMessage] = useState('')
  const [stage, setStage] = useState<'idle' | 'connecting' | 'sending'>('idle')
  const [error, setError] = useState<string | null>(null)

  /**
   * Suggested amounts, derived from what is still missing rather than fixed
   * numbers — "the amount that finishes this" is the one people actually want,
   * and typing is the slowest step in the whole flow.
   */
  const suggestions = useMemo(() => {
    const target = fromWire(kitty.targetAmount)
    const raised = fromWire(view.raisedTotal)
    const remaining = target > raised ? target - raised : 0n
    const unit = 10n ** BigInt(decimals)

    const candidates = [target / 20n, target / 10n, target / 4n, remaining].filter(
      (v) => v > 0n,
    )

    // Round to something a human would type, de-duplicate, keep four.
    const rounded = candidates.map((v) => {
      if (v < unit) return v
      const step = v > unit * 100n ? unit * 10n : unit
      return (v / step) * step
    })

    const seen = new Set<string>()
    return rounded
      .filter((v) => v > 0n && !seen.has(v.toString()) && seen.add(v.toString()))
      .slice(0, 4)
  }, [kitty.targetAmount, view.raisedTotal, decimals])

  const parsed = (() => {
    try {
      return amount.trim() ? parseAmount(amount, decimals) : null
    } catch {
      return null
    }
  })()

  const canSend = parsed !== null && parsed > 0n && stage === 'idle'

  async function send() {
    if (!parsed || parsed <= 0n) return
    setError(null)

    const rail = createRail(kitty.rail, kitty.chainId)

    try {
      setStage('connecting')
      const account = await rail.connect()

      setStage('sending')
      // The wallet's native approval dialog happens here. Everything before this
      // point is reversible; everything after is recorded against a real tx.
      const receipt = await rail.contribute({
        kittyId: kitty.id,
        to: kitty.payoutAddress,
        amount: parsed,
      })

      if (name.trim()) localStorage.setItem('kitty.name', name.trim())

      // Attach the device id if we already have one so the contribution counts
      // toward the leaderboard — but never prompt for it mid-payment.
      await ensureDeviceId().catch(() => null)

      await api.recordContribution(kitty.id, {
        txHash: receipt.txHash,
        fromAddress: account.address,
        amount: parsed.toString(),
        displayName: name.trim() || undefined,
        message: message.trim() || undefined,
      })

      tap([12, 45, 12])
      onDone({
        amount: parsed,
        formatted: `${formatAmount(parsed, decimals, { maxFrac: 2 })} ${symbol}`,
      })
    } catch (err) {
      if (isCancellation(err)) {
        // The user declined the native dialog. Close quietly; nothing happened.
        setStage('idle')
        return
      }
      const key = errorKey(err)
      setError(t(key))
      onError(key)
    } finally {
      setStage('idle')
    }
  }

  return (
    <Sheet open={open} onClose={stage === 'idle' ? onClose : () => undefined} label={t('contribute.title')}>
      <div className="stack">
        <div className="row-between">
          <h2>{t('contribute.title')}</h2>
          <span className="tiny faint">
            {kitty.emoji} {kitty.title}
          </span>
        </div>

        <div className="field">
          <label className="field__label" htmlFor="amount">
            {t('contribute.amountLabel')} ({symbol})
          </label>
          <input
            id="amount"
            className={`input input--amount ${error ? 'input--error' : ''}`}
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value.replace(/[^\d.,]/g, ''))
              setError(null)
            }}
            placeholder="0"
            inputMode="decimal"
            autoFocus
            autoComplete="off"
          />
        </div>

        <div className="chips">
          {suggestions.map((value) => {
            const label = formatAmount(value, decimals, { maxFrac: 2 })
            return (
              <button
                key={value.toString()}
                className={`chip ${parsed === value ? 'chip--active' : ''}`}
                onClick={() => {
                  setAmount(formatAmount(value, decimals, { maxFrac: decimals, group: false }))
                  setError(null)
                  tap()
                }}
              >
                {label}
              </button>
            )
          })}
        </div>

        <div className="field">
          <label className="field__label" htmlFor="contributor-name">
            {t('contribute.nameLabel')}
          </label>
          <input
            id="contributor-name"
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('contribute.namePlaceholder')}
            maxLength={40}
            autoComplete="name"
          />
        </div>

        <div className="field">
          <label className="field__label" htmlFor="contributor-message">
            {t('contribute.messageLabel')}
          </label>
          <input
            id="contributor-message"
            className="input"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={t('contribute.messagePlaceholder')}
            maxLength={140}
            autoComplete="off"
          />
        </div>

        {error && <p className="error-text center">{error}</p>}

        <Button variant="primary" onClick={() => void send()} disabled={!canSend}>
          {stage === 'connecting'
            ? t('contribute.connecting')
            : stage === 'sending'
              ? t('contribute.sending')
              : t('contribute.submit', {
                  amount: parsed
                    ? `${formatAmount(parsed, decimals, { maxFrac: 2 })} ${symbol}`
                    : symbol,
                })}
        </Button>

        <p className="tiny faint center">{t('contribute.approveHint')}</p>
      </div>
    </Sheet>
  )
}
