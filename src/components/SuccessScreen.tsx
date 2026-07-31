import { useEffect, useState } from 'react'
import type { Kitty } from '../../shared/types'
import { useI18n } from '../i18n'
import { copyText, deepLink, shareKitty, tap } from '../lib/host'
import { Button, Confetti } from './ui'

/**
 * The moment after a successful contribution.
 *
 * This screen has one job beyond saying thank you: turn a contributor into a
 * distributor. Sharing is the primary action and starting your own Kitty is the
 * secondary one, because both grow the number of wallets that touch the app.
 */
export function SuccessScreen({
  kitty,
  amountLabel,
  pct,
  onShared,
  onBack,
  onCreateOwn,
}: {
  kitty: Kitty
  amountLabel: string
  pct: number
  onShared: (method: 'native' | 'clipboard' | 'failed') => void
  onBack: () => void
  onCreateOwn: () => void
}) {
  const { t } = useI18n()
  const [fire, setFire] = useState(0)

  useEffect(() => {
    setFire(1)
    tap([12, 40, 12, 40, 20])
  }, [])

  return (
    <div className="screen stack center" style={{ justifyContent: 'center' }}>
      <Confetti fire={fire} />

      <div className="stack" style={{ alignItems: 'center', gap: 12 }}>
        <div style={{ fontSize: 68 }} className="pop">
          {kitty.emoji}
        </div>
        <h1>{t('success.title')}</h1>
        <p className="muted">
          {t('success.body', { amount: amountLabel, title: kitty.title })}
        </p>
        {pct > 0 && (
          <p className="tiny faint">{t('success.milestone', { pct: Math.round(pct) })}</p>
        )}
      </div>

      <div className="stack" style={{ width: '100%', marginTop: 28 }}>
        <Button
          variant="primary"
          onClick={() => {
            void shareKitty({
              kittyId: kitty.id,
              title: kitty.title,
              text: t('share.text', { title: kitty.title }),
              payLabel: t('share.payLabel'),
              webLabel: t('share.webLabel'),
            }).then((r) => onShared(r.method))
          }}
        >
          {t('success.shareCta')}
        </Button>

        <Button
          variant="outline"
          onClick={() => {
            void copyText(deepLink(kitty.id)).then((ok) =>
              onShared(ok ? 'clipboard' : 'failed'),
            )
          }}
        >
          {t('share.copyDeeplink')}
        </Button>

        <Button variant="cool" onClick={onCreateOwn}>
          {t('success.createOwn')}
        </Button>

        <Button variant="ghost" onClick={onBack}>
          {t('success.back')}
        </Button>
      </div>
    </div>
  )
}
