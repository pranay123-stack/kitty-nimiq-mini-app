import { useEffect, useState } from 'react'
import type { Nav, ToastFn } from '../App'
import type { Kitty, LeaderboardEntry } from '../../shared/types'
import { api } from '../lib/api'
import { peekDeviceId } from '../lib/device'
import { isInsideNimiqPay } from '../lib/host'
import { useI18n } from '../i18n'
import { formatAmount, fromWire, progressPct } from '../../shared/money'
import { railDecimals, railSymbol } from '../rails'
import { Avatar, Button, EmptyState, Skeleton } from '../components/ui'

export function HomeScreen({ nav, onToast }: { nav: Nav; onToast: ToastFn }) {
  const { t } = useI18n()
  const [mine, setMine] = useState<Kitty[] | null>(null)
  const [leaders, setLeaders] = useState<LeaderboardEntry[] | null>(null)

  useEffect(() => {
    let cancelled = false

    // Only ask for the user's own pots if this device already has an identifier;
    // landing on the home screen is not a good enough reason to prompt.
    const loadMine = peekDeviceId()
      ? api.myKitties().then((r) => r.kitties).catch(() => [])
      : Promise.resolve<Kitty[]>([])

    void Promise.all([loadMine, api.leaderboard().then((r) => r.entries).catch(() => [])]).then(
      ([kitties, entries]) => {
        if (cancelled) return
        setMine(kitties)
        setLeaders(entries)
      },
    )

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="screen stack">
      <header className="row-between" style={{ marginBottom: 4 }}>
        <div className="row" style={{ gap: 8 }}>
          <span style={{ fontSize: 26 }}>🐱</span>
          <strong style={{ fontSize: 18 }}>{t('app.name')}</strong>
        </div>
        <span className="tiny faint">{t('app.tagline')}</span>
      </header>

      <section className="card card--hero">
        <h1 style={{ whiteSpace: 'pre-line', marginBottom: 10 }}>{t('home.heroTitle')}</h1>
        <p className="muted" style={{ marginBottom: 20 }}>
          {t('home.heroBody')}
        </p>
        <Button variant="primary" onClick={() => nav.go({ name: 'create' })}>
          {t('home.create')}
        </Button>
      </section>

      {!isInsideNimiqPay() && (
        <p className="tiny faint center">{t('home.openInPay')}</p>
      )}

      <section className="stack-sm">
        <h2>{t('home.mine')}</h2>
        {mine === null ? (
          <div className="card stack-sm">
            <Skeleton height={18} width="60%" />
            <Skeleton height={12} width="35%" />
          </div>
        ) : mine.length === 0 ? (
          <div className="card">
            <p className="tiny muted center">{t('home.mineEmpty')}</p>
          </div>
        ) : (
          <div className="stack-sm">
            {mine.map((kitty) => (
              <KittyRow key={kitty.id} kitty={kitty} onOpen={() => nav.go({ name: 'kitty', id: kitty.id })} />
            ))}
          </div>
        )}
      </section>

      <section className="stack-sm">
        <h2>{t('home.leaderboard')}</h2>
        {leaders === null ? (
          <div className="card stack-sm">
            <Skeleton height={16} width="50%" />
            <Skeleton height={16} width="40%" />
          </div>
        ) : leaders.length === 0 ? (
          <div className="card">
            <EmptyState icon="🏆" title={t('home.leaderboardEmpty')} />
          </div>
        ) : (
          <div className="card">
            {leaders.slice(0, 10).map((entry, i) => (
              <div
                key={`${entry.displayName}-${entry.rank}`}
                className="contributor"
                style={{ animationDelay: `${i * 0.04}s` }}
              >
                <Avatar seed={entry.displayName} label={entry.displayName} />
                <div className="grow">
                  <strong>{entry.displayName}</strong>
                  <div className="tiny faint">
                    {t('home.leaderStat', {
                      kitties: entry.kittyCount,
                      contributions: entry.contributionCount,
                    })}
                  </div>
                </div>
                <span style={{ fontSize: 18 }}>
                  {entry.rank === 1 ? '🥇' : entry.rank === 2 ? '🥈' : entry.rank === 3 ? '🥉' : ''}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <button
        className="btn btn--ghost"
        onClick={() => {
          void navigator.clipboard
            ?.writeText(window.location.origin)
            .then(() => onToast('common.copied', 'success'))
            .catch(() => undefined)
        }}
      >
        {t('share.copyLink')}
      </button>
    </div>
  )
}

function KittyRow({ kitty, onOpen }: { kitty: Kitty; onOpen: () => void }) {
  const { t } = useI18n()
  const decimals = railDecimals(kitty.rail, kitty.chainId)
  const symbol = railSymbol(kitty.rail, kitty.chainId)
  const target = fromWire(kitty.targetAmount)

  return (
    <button
      className="card row"
      onClick={onOpen}
      style={{ textAlign: 'left', border: 'none', cursor: 'pointer', width: '100%' }}
    >
      <span style={{ fontSize: 26 }}>{kitty.emoji}</span>
      <div className="grow">
        <strong>{kitty.title}</strong>
        <div className="tiny faint">
          {formatAmount(target, decimals, { maxFrac: 2 })} {symbol}
          {kitty.settledAt ? ` · ${t('kitty.settled')}` : ''}
        </div>
      </div>
      <span className="faint">›</span>
    </button>
  )
}

/** Re-exported for the Kitty screen's "similar pots" affordance. */
export { progressPct }
