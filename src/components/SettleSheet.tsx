import { useState } from 'react'
import type { KittyView } from '../../shared/types'
import { formatAmount, fromWire } from '../../shared/money'
import { createRail, isValidAddressFor, railDecimals, railSymbol } from '../rails'
import { api } from '../lib/api'
import { useI18n, type TranslationKey } from '../i18n'
import { errorKey, isCancellation } from '../lib/errors'
import { tap } from '../lib/host'
import { Button } from './ui'
import { Sheet } from './Sheet'

/**
 * Paying the pot out.
 *
 * Because the organizer's own wallet *is* the pot, settling is simply a normal
 * outbound transaction that we pre-fill with the confirmed total. Kitty never
 * holds or moves the money itself; it only records that the payout happened.
 */
export function SettleSheet({
  view,
  open,
  onClose,
  onDone,
  onError,
}: {
  view: KittyView
  open: boolean
  onClose: () => void
  onDone: () => void
  onError: (key: TranslationKey) => void
}) {
  const { t } = useI18n()
  const { kitty } = view

  const decimals = railDecimals(kitty.rail, kitty.chainId)
  const symbol = railSymbol(kitty.rail, kitty.chainId)

  // Pay out what we have actually seen on chain, not the optimistic total —
  // sending money on the strength of an unconfirmed row would be a real bug.
  const payoutAmount = fromWire(view.confirmedTotal)
  const formatted = `${formatAmount(payoutAmount, decimals, { maxFrac: 2 })} ${symbol}`

  const [destination, setDestination] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const valid = isValidAddressFor(kitty.rail, destination.trim()) && payoutAmount > 0n

  async function settle() {
    if (!valid) return
    setError(null)
    setBusy(true)

    try {
      const rail = createRail(kitty.rail, kitty.chainId)
      await rail.connect()

      const receipt = await rail.settle({ to: destination.trim(), amount: payoutAmount })
      await api.settle(kitty.id, { txHash: receipt.txHash, settleTo: destination.trim() })

      tap([15, 50, 15])
      onDone()
    } catch (err) {
      if (isCancellation(err)) {
        setBusy(false)
        return
      }
      const key = errorKey(err)
      setError(t(key))
      onError(key)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={open} onClose={busy ? () => undefined : onClose} label={t('settle.title')}>
      <div className="stack">
        <h2>{t('settle.title')}</h2>
        <p className="muted tiny">{t('settle.body', { amount: formatted })}</p>

        <div className="card center stack-sm">
          <span className="tiny faint">{t('kitty.confirmed')}</span>
          <span className="amount-big">{formatted}</span>
        </div>

        <div className="field">
          <label className="field__label" htmlFor="destination">
            {t('settle.destinationLabel')}
          </label>
          <input
            id="destination"
            className={`input mono ${error ? 'input--error' : ''}`}
            value={destination}
            onChange={(e) => {
              setDestination(e.target.value)
              setError(null)
            }}
            placeholder={kitty.rail === 'nim' ? 'NQ…' : '0x…'}
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        {error && <p className="error-text center">{error}</p>}

        <Button variant="primary" onClick={() => void settle()} disabled={!valid || busy}>
          {busy ? t('contribute.sending') : t('settle.confirm', { amount: formatted })}
        </Button>
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          {t('common.cancel')}
        </Button>
      </div>
    </Sheet>
  )
}
