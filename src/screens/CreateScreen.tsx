import { useState } from 'react'
import type { Nav, ToastFn } from '../App'
import type { RailId } from '../../shared/types'
import { api } from '../lib/api'
import { ensureDeviceId } from '../lib/device'
import { useI18n } from '../i18n'
import { parseAmount } from '../../shared/money'
import { chainsInPreferenceOrder, createRail, DEFAULT_CHAIN_ID, isValidAddressFor, railDecimals, railSymbol } from '../rails'
import { errorKey, isCancellation } from '../lib/errors'
import { Button } from '../components/ui'
import { tap } from '../lib/host'

const EMOJIS = ['🎁', '✈️', '🍕', '🎂', '🏠', '⚽', '🎸', '☕']

export function CreateScreen({ nav, onToast }: { nav: Nav; onToast: ToastFn }) {
  const { t } = useI18n()

  const [title, setTitle] = useState('')
  const [note, setNote] = useState('')
  const [emoji, setEmoji] = useState('🎁')
  const [rail, setRail] = useState<RailId>('nim')
  const [chainId, setChainId] = useState<number>(DEFAULT_CHAIN_ID)
  const [target, setTarget] = useState('')
  const [payout, setPayout] = useState('')
  const [organizerName, setOrganizerName] = useState('')
  const [busy, setBusy] = useState(false)
  const [fieldError, setFieldError] = useState<{ field: string; message: string } | null>(null)

  const decimals = railDecimals(rail, chainId)
  const symbol = railSymbol(rail, chainId)

  /** Fill the payout field from the connected wallet — the common case. */
  async function useMyWallet() {
    try {
      tap()
      const account = await createRail(rail, chainId).connect()
      setPayout(account.address)
      setFieldError(null)
    } catch (err) {
      if (!isCancellation(err)) onToast(errorKey(err), 'error')
    }
  }

  async function submit() {
    setFieldError(null)

    if (!title.trim()) {
      setFieldError({ field: 'title', message: t('create.errName') })
      return
    }

    let targetBase: bigint
    try {
      targetBase = parseAmount(target, decimals)
      if (targetBase <= 0n) throw new Error()
    } catch {
      setFieldError({ field: 'target', message: t('create.errTarget') })
      return
    }

    if (!isValidAddressFor(rail, payout.trim())) {
      setFieldError({ field: 'payout', message: t('create.errAddress') })
      return
    }

    setBusy(true)
    try {
      // The reason string is shown verbatim to the user, so it explains the
      // benefit rather than the mechanism.
      const deviceId = await ensureDeviceId(
        'So this Kitty stays yours and only you can pay it out',
      )
      if (!deviceId) {
        onToast('err.unavailable', 'error')
        return
      }

      const { kitty } = await api.createKitty({
        title: title.trim(),
        note: note.trim() || undefined,
        emoji,
        rail,
        chainId: rail === 'usdt' ? chainId : undefined,
        targetAmount: targetBase.toString(),
        payoutAddress: payout.trim(),
        organizerName: organizerName.trim() || undefined,
      })

      tap([10, 40, 10])
      nav.go({ name: 'kitty', id: kitty.id })
    } catch (err) {
      onToast(errorKey(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="screen screen--with-dock stack">
      <header className="row" style={{ gap: 12 }}>
        <button className="btn btn--ghost btn--sm" onClick={() => nav.back()}>
          ‹
        </button>
        <h1 style={{ fontSize: 22 }}>{t('create.title')}</h1>
      </header>

      <div className="field">
        <label className="field__label" htmlFor="title">
          {t('create.nameLabel')}
        </label>
        <input
          id="title"
          className={`input ${fieldError?.field === 'title' ? 'input--error' : ''}`}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t('create.namePlaceholder')}
          maxLength={80}
          autoComplete="off"
        />
        {fieldError?.field === 'title' && <span className="error-text">{fieldError.message}</span>}
      </div>

      <div className="chips">
        {EMOJIS.map((option) => (
          <button
            key={option}
            className={`chip ${emoji === option ? 'chip--active' : ''}`}
            onClick={() => {
              setEmoji(option)
              tap()
            }}
            aria-pressed={emoji === option}
          >
            {option}
          </button>
        ))}
      </div>

      <div className="field">
        <label className="field__label" htmlFor="note">
          {t('create.noteLabel')}
        </label>
        <textarea
          id="note"
          className="input"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t('create.notePlaceholder')}
          maxLength={200}
          rows={2}
        />
      </div>

      <div className="field">
        <span className="field__label">{t('create.currencyLabel')}</span>
        <div className="segmented" role="tablist">
          {(['nim', 'usdt'] as RailId[]).map((option) => (
            <button
              key={option}
              role="tab"
              aria-selected={rail === option}
              className={`segmented__item ${rail === option ? 'segmented__item--active' : ''}`}
              onClick={() => {
                setRail(option)
                setPayout('')
                setFieldError(null)
                tap()
              }}
            >
              {option === 'nim' ? 'NIM' : 'USDT'}
            </button>
          ))}
        </div>
      </div>

      {rail === 'usdt' && (
        <div className="field">
          <label className="field__label" htmlFor="chain">
            {t('create.networkLabel')}
          </label>
          <select
            id="chain"
            className="input"
            value={chainId}
            onChange={(e) => setChainId(Number(e.target.value))}
          >
            {chainsInPreferenceOrder().map((chain) => (
              <option key={chain.chainId} value={chain.chainId}>
                {chain.name} · {chain.tokenSymbol}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="field">
        <label className="field__label" htmlFor="target">
          {t('create.targetLabel')} ({symbol})
        </label>
        <input
          id="target"
          className={`input input--amount ${fieldError?.field === 'target' ? 'input--error' : ''}`}
          value={target}
          onChange={(e) => setTarget(e.target.value.replace(/[^\d.,]/g, ''))}
          placeholder="0"
          inputMode="decimal"
          autoComplete="off"
        />
        {fieldError?.field === 'target' && <span className="error-text">{fieldError.message}</span>}
      </div>

      <div className="field">
        <div className="row-between">
          <label className="field__label" htmlFor="payout">
            {t('create.payoutLabel')}
          </label>
          <button className="btn btn--ghost btn--sm" onClick={() => void useMyWallet()}>
            {t('create.useMyWallet')}
          </button>
        </div>
        <input
          id="payout"
          className={`input mono ${fieldError?.field === 'payout' ? 'input--error' : ''}`}
          value={payout}
          onChange={(e) => setPayout(e.target.value)}
          placeholder={rail === 'nim' ? 'NQ…' : '0x…'}
          autoComplete="off"
          spellCheck={false}
        />
        {fieldError?.field === 'payout' ? (
          <span className="error-text">{fieldError.message}</span>
        ) : (
          <span className="tiny faint" style={{ paddingLeft: 4 }}>
            {t('create.payoutHelp')}
          </span>
        )}
      </div>

      <div className="field">
        <label className="field__label" htmlFor="organizer">
          {t('create.yourNameLabel')}
        </label>
        <input
          id="organizer"
          className="input"
          value={organizerName}
          onChange={(e) => setOrganizerName(e.target.value)}
          placeholder={t('create.yourNamePlaceholder')}
          maxLength={40}
          autoComplete="off"
        />
      </div>

      <p className="tiny faint center" style={{ padding: '0 12px' }}>
        🔒 {t('create.custodyNote')}
      </p>

      <div className="dock">
        <Button variant="primary" onClick={() => void submit()} disabled={busy}>
          {busy ? t('create.creating') : t('create.submit')}
        </Button>
      </div>
    </div>
  )
}
