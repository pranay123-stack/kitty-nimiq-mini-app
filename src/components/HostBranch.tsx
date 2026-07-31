import { useEffect, useState } from 'react'
import { useI18n } from '../i18n'
import {
  detectHostMode,
  openInNimiqPay,
  watchForProvider,
  NIMIQ_PAY_URL,
  type HostMode,
} from '../lib/host'
import { Button } from './ui'

/**
 * Which host we're in, resolved synchronously on first render.
 *
 * Never returns a "still deciding" state: a link that arrived stripped of its
 * scheme must land on something usable, not a spinner. We start from the
 * synchronous check (correct in practice, since Nimiq Pay injects before page
 * scripts run) and only ever upgrade browser → nimiq-pay if a provider shows
 * up late.
 */
export function useHostMode(): HostMode {
  const [mode, setMode] = useState<HostMode>(detectHostMode)

  useEffect(() => {
    if (mode === 'nimiq-pay') return
    return watchForProvider(() => setMode('nimiq-pay'))
  }, [mode])

  return mode
}

/**
 * The browser branch.
 *
 * Shown *above* the Kitty rather than in front of it. A full-screen interstitial
 * would hide the progress bar and contributor list — which is precisely the
 * thing that makes someone want to chip in — so the content stays visible and
 * the choice sits on top of it. Neither option dead-ends: one hands off to
 * Nimiq Pay, the other keeps reading here.
 */
export function BrowserBranch({
  kittyId,
  variant = 'kitty',
  onDismiss,
}: {
  kittyId: string | null
  variant?: 'kitty' | 'home'
  onDismiss?: () => void
}) {
  const { t } = useI18n()
  const [noApp, setNoApp] = useState(false)

  return (
    <section className="card branch" data-testid="browser-branch">
      <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
        <span style={{ fontSize: 22, lineHeight: 1.2 }}>📱</span>
        <div className="grow">
          <strong>{variant === 'home' ? t('host.homeBranchTitle') : t('host.branchTitle')}</strong>
          <p className="tiny muted" style={{ marginTop: 2 }}>
            {variant === 'home' ? t('host.homeBranchBody') : t('host.branchBody')}
          </p>
        </div>
      </div>

      <div className="stack-sm" style={{ marginTop: 14 }}>
        <Button
          variant="cool"
          onClick={() => {
            setNoApp(false)
            openInNimiqPay(kittyId, () => setNoApp(true))
          }}
        >
          {t('host.openInPay')}
        </Button>

        {onDismiss && (
          <Button variant="ghost" onClick={onDismiss}>
            {t('host.continueBrowser')}
          </Button>
        )}
      </div>

      {/* A custom scheme fails silently when the app is absent, so the only
          honest recovery is to offer the install link once nothing happened. */}
      {noApp && (
        <div className="branch__noapp" data-testid="no-app-hint">
          <strong className="tiny">{t('host.noAppTitle')}</strong>
          <p className="tiny muted" style={{ margin: '2px 0 10px' }}>
            {t('host.noAppBody')}
          </p>
          <a
            className="btn btn--outline btn--sm"
            href={NIMIQ_PAY_URL}
            target="_blank"
            rel="noreferrer noopener"
          >
            {t('host.getApp')} ↗
          </a>
        </div>
      )}
    </section>
  )
}

/** Small persistent marker so a view-only visitor is never confused. */
export function ViewOnlyBadge() {
  const { t } = useI18n()
  return (
    <span className="badge badge--viewonly" data-testid="view-only-badge">
      👁 {t('host.viewOnly')}
    </span>
  )
}
