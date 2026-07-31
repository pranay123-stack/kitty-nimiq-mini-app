import { useCallback, useEffect, useRef, useState } from 'react'
import type { Nav, ToastFn } from '../App'
import type { KittyView } from '../../shared/types'
import { api, ApiFailure } from '../lib/api'
import { useI18n } from '../i18n'
import { formatAmount, fromWire, progressPct } from '../../shared/money'
import { createRail, railDecimals, railSymbol } from '../rails'
import { deepLink, shareKitty, copyText, tap } from '../lib/host'
import { ensureDeviceId, peekDeviceId } from '../lib/device'
import {
  Avatar,
  Button,
  Confetti,
  EmptyState,
  KittySkeleton,
  ProgressBar,
} from '../components/ui'
import { ContributeSheet, type ContributionOutcome } from '../components/ContributeSheet'
import { SettleSheet } from '../components/SettleSheet'
import { SuccessScreen } from '../components/SuccessScreen'

/** Milestones that deserve a celebration, in percent. */
const MILESTONES = [25, 50, 75, 100]

export function KittyScreen({
  kittyId,
  nav,
  onToast,
}: {
  kittyId: string
  nav: Nav
  onToast: ToastFn
}) {
  const { t } = useI18n()

  const [view, setView] = useState<KittyView | null>(null)
  const [missing, setMissing] = useState(false)
  const [contributing, setContributing] = useState(false)
  const [settling, setSettling] = useState(false)
  const [success, setSuccess] = useState<ContributionOutcome | null>(null)
  const [fire, setFire] = useState(0)

  // Tracks the highest milestone already celebrated so a poll that returns the
  // same total doesn't re-fire confetti every few seconds.
  const celebrated = useRef(0)

  const load = useCallback(
    async (opts: { quiet?: boolean } = {}) => {
      try {
        const next = await api.getKitty(kittyId)
        setView(next)

        const pct = progressPct(fromWire(next.raisedTotal), fromWire(next.kitty.targetAmount))
        const reached = MILESTONES.filter((m) => pct >= m).pop() ?? 0
        if (reached > celebrated.current) {
          // Don't celebrate history: on first load just record where we are.
          if (celebrated.current !== 0 || opts.quiet !== true) {
            if (celebrated.current !== 0) setFire((n) => n + 1)
          }
          celebrated.current = reached
        }
      } catch (err) {
        if (err instanceof ApiFailure && err.code === 'not_found') {
          setMissing(true)
          return
        }
        if (!opts.quiet) onToast('err.offline', 'error')
      }
    },
    [kittyId, onToast],
  )

  // First paint: fetch, and make sure we send a device id if this device
  // already has one so `isOrganizer` resolves correctly.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (peekDeviceId()) await ensureDeviceId().catch(() => null)
      if (!cancelled) await load({ quiet: true })
    })()
    return () => {
      cancelled = true
    }
  }, [load])

  /**
   * Live updates by polling.
   *
   * Polling rather than websockets is the right call here: a Kitty is read for
   * a minute at a time, a Worker holding a socket open costs far more, and the
   * page pauses itself when backgrounded so it is nearly free on mobile data.
   */
  useEffect(() => {
    if (missing || success) return

    let timer: number | undefined
    const schedule = () => {
      timer = window.setTimeout(async () => {
        if (document.visibilityState === 'visible') await load({ quiet: true })
        schedule()
      }, 6000)
    }
    schedule()

    const onVisible = () => {
      if (document.visibilityState === 'visible') void load({ quiet: true })
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      if (timer) clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [load, missing, success])

  async function share() {
    if (!view) return
    tap()
    const result = await shareKitty({
      kittyId: view.kitty.id,
      title: view.kitty.title,
      text: t('share.text', { title: view.kitty.title }),
    })
    if (result.method === 'clipboard') onToast('share.copied', 'success')
    if (result.method === 'failed') onToast('err.failed', 'error')
  }

  if (missing) {
    return (
      <div className="screen" style={{ justifyContent: 'center' }}>
        <EmptyState
          icon="🙀"
          title={t('kitty.notFound')}
          body={t('kitty.notFoundBody')}
          action={
            <div style={{ marginTop: 12, width: '100%' }}>
              <Button variant="primary" onClick={() => nav.go({ name: 'home' })}>
                {t('home.create')}
              </Button>
            </div>
          }
        />
      </div>
    )
  }

  if (!view) {
    return (
      <div className="screen">
        <KittySkeleton />
      </div>
    )
  }

  const { kitty } = view
  const decimals = railDecimals(kitty.rail, kitty.chainId)
  const symbol = railSymbol(kitty.rail, kitty.chainId)
  const raised = fromWire(view.raisedTotal)
  const target = fromWire(kitty.targetAmount)
  const pct = progressPct(raised, target)
  const complete = raised >= target

  if (success) {
    return (
      <SuccessScreen
        kitty={kitty}
        amountLabel={success.formatted}
        pct={pct}
        onShared={(method) => {
          if (method === 'clipboard') onToast('share.copied', 'success')
          if (method === 'failed') onToast('err.failed', 'error')
        }}
        onBack={() => {
          setSuccess(null)
          void load({ quiet: true })
        }}
        onCreateOwn={() => nav.go({ name: 'create' })}
      />
    )
  }

  return (
    <div className="screen screen--with-dock stack">
      <Confetti fire={fire} />

      <header className="row-between">
        <button className="btn btn--ghost btn--sm" onClick={() => nav.go({ name: 'home' })}>
          ‹ {t('app.name')}
        </button>
        {kitty.organizerName && (
          <span className="tiny faint">
            {t('kitty.organizer')}: {kitty.organizerName}
          </span>
        )}
      </header>

      <section className={`card card--hero ${complete ? 'pop' : ''}`}>
        <div className="row" style={{ gap: 10, marginBottom: 14 }}>
          <span style={{ fontSize: 34 }}>{kitty.emoji}</span>
          <div className="grow">
            <h2>{kitty.title}</h2>
            {kitty.note && (
              <p className="muted tiny" style={{ marginTop: 2 }}>
                {kitty.note}
              </p>
            )}
          </div>
        </div>

        <div className="row-between" style={{ alignItems: 'flex-end', marginBottom: 10 }}>
          <div>
            <div className="amount-big">
              {formatAmount(raised, decimals, { maxFrac: 2 })}
            </div>
            <div className="muted tiny">
              {t('kitty.of', {
                target: `${formatAmount(target, decimals, { maxFrac: 2 })} ${symbol}`,
              })}
            </div>
          </div>
          <div className="center">
            <div style={{ fontSize: 22, fontWeight: 800 }}>{Math.round(pct)}%</div>
            {complete && <div className="tiny">🎉 {t('kitty.goalReached')}</div>}
          </div>
        </div>

        <ProgressBar pct={pct} complete={complete} />

        <div className="muted tiny" style={{ marginTop: 12 }}>
          {view.contributorCount === 1
            ? t('kitty.contributors_one', { count: view.contributorCount })
            : t('kitty.contributors_other', { count: view.contributorCount })}
        </div>
      </section>

      {kitty.settledAt && (
        <div className="card center">
          <strong>✅ {t('kitty.settled')}</strong>
          {kitty.settleTo && (
            <div className="tiny faint mono" style={{ marginTop: 4 }}>
              {kitty.settleTo.slice(0, 12)}…{kitty.settleTo.slice(-6)}
            </div>
          )}
        </div>
      )}

      <section className="card">
        {view.contributions.length === 0 ? (
          <EmptyState icon="🫙" title={t('kitty.emptyTitle')} body={t('kitty.emptyBody')} />
        ) : (
          view.contributions.map((c, i) => {
            const rail = createRail(kitty.rail, kitty.chainId)
            const url = rail.explorerTxUrl(c.txHash)
            const label = c.displayName || t('kitty.anonymous')

            return (
              <div
                key={c.id}
                className="contributor"
                style={{ animationDelay: `${Math.min(i, 8) * 0.04}s` }}
              >
                <Avatar seed={c.fromAddress} label={label} />
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="row" style={{ gap: 6 }}>
                    <strong style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {label}
                    </strong>
                    <span className={`badge badge--${c.status === 'confirmed' ? 'confirmed' : 'pending'}`}>
                      {c.status === 'confirmed' ? t('kitty.confirmed') : t('kitty.pending')}
                    </span>
                  </div>
                  {c.message && <div className="tiny muted">{c.message}</div>}
                  {url && (
                    <a
                      className="tiny faint"
                      href={url}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      {t('kitty.viewOnChain')} ↗
                    </a>
                  )}
                </div>
                <strong style={{ whiteSpace: 'nowrap' }}>
                  {formatAmount(fromWire(c.amount), decimals, { maxFrac: 2 })}
                </strong>
              </div>
            )
          })
        )}
      </section>

      <button
        className="btn btn--ghost btn--sm"
        style={{ width: '100%' }}
        onClick={() => {
          void copyText(deepLink(kitty.id)).then((ok) =>
            onToast(ok ? 'share.deeplinkCopied' : 'err.failed', ok ? 'success' : 'error'),
          )
        }}
      >
        {t('share.copyDeeplink')}
      </button>

      <div className="dock">
        {!kitty.settledAt && (
          <Button variant="primary" onClick={() => setContributing(true)}>
            {t('kitty.contribute')}
          </Button>
        )}
        <div className="row" style={{ gap: 8 }}>
          <Button variant="outline" onClick={() => void share()}>
            {t('kitty.share')}
          </Button>
          {view.isOrganizer && !kitty.settledAt && fromWire(view.confirmedTotal) > 0n && (
            <Button variant="cool" onClick={() => setSettling(true)}>
              {t('kitty.settle')}
            </Button>
          )}
        </div>
      </div>

      <ContributeSheet
        view={view}
        open={contributing}
        onClose={() => setContributing(false)}
        onError={(key) => onToast(key, 'error')}
        onDone={(outcome) => {
          setContributing(false)
          setSuccess(outcome)
          // Reconcile in the background so returning from the success screen
          // shows the real, server-confirmed state.
          void load({ quiet: true })
        }}
      />

      <SettleSheet
        view={view}
        open={settling}
        onClose={() => setSettling(false)}
        onError={(key) => onToast(key, 'error')}
        onDone={() => {
          setSettling(false)
          onToast('settle.done', 'success')
          void load({ quiet: true })
        }}
      />
    </div>
  )
}
