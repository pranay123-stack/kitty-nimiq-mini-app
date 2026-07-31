import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

/* -------------------------------------------------------------- buttons */

export function Button({
  children,
  variant = 'default',
  size,
  onClick,
  disabled,
  type = 'button',
}: {
  children: ReactNode
  variant?: 'default' | 'primary' | 'cool' | 'ghost' | 'outline'
  size?: 'sm'
  onClick?: () => void
  disabled?: boolean
  type?: 'button' | 'submit'
}) {
  const classes = [
    'btn',
    variant !== 'default' ? `btn--${variant}` : '',
    size === 'sm' ? 'btn--sm' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <button className={classes} onClick={onClick} disabled={disabled} type={type}>
      {children}
    </button>
  )
}

/* ------------------------------------------------------------ progress */

/**
 * The centrepiece. Animates from whatever it last showed to the new value, so
 * a contribution arriving feels like the bar *moving* rather than re-rendering.
 */
export function ProgressBar({ pct, complete }: { pct: number; complete: boolean }) {
  const [shown, setShown] = useState(0)

  useEffect(() => {
    // One frame at zero width lets the CSS transition run on first paint.
    // A timer backs up the rAF because rAF is starved in a backgrounded tab —
    // without it the bar can stay stuck near zero while the real total is 60%,
    // which is the single most misleading thing this screen could do.
    const frame = requestAnimationFrame(() => setShown(pct))
    const fallback = setTimeout(() => setShown(pct), 80)
    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(fallback)
    }
  }, [pct])

  return (
    <div
      className={`progress ${complete ? 'progress--complete' : ''}`}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className="progress__fill" style={{ width: `${Math.max(shown, pct > 0 ? 3 : 0)}%` }} />
    </div>
  )
}

/** Counts up to a new total so the number feels alive when someone chips in. */
export function AnimatedAmount({ value, className }: { value: string; className?: string }) {
  const [display, setDisplay] = useState(value)
  const previous = useRef(value)

  useEffect(() => {
    if (previous.current === value) return
    previous.current = value
    setDisplay(value)
  }, [value])

  return (
    <span key={display} className={`${className ?? ''} pop`}>
      {display}
    </span>
  )
}

/* ------------------------------------------------------------ skeleton */

export function Skeleton({ height = 16, width = '100%', radius = 8 }: {
  height?: number
  width?: number | string
  radius?: number
}) {
  return (
    <div
      className="skeleton"
      style={{ height, width, borderRadius: radius }}
      aria-hidden="true"
    />
  )
}

export function KittySkeleton() {
  return (
    <div className="stack" aria-busy="true">
      <div className="card--hero card" style={{ background: 'var(--surface-2)' }}>
        <div className="stack">
          <Skeleton height={22} width="65%" />
          <Skeleton height={40} width="45%" />
          <Skeleton height={14} radius={999} />
        </div>
      </div>
      <div className="card stack">
        <Skeleton height={16} width="40%" />
        {[0, 1, 2].map((i) => (
          <div key={i} className="row">
            <Skeleton height={40} width={40} radius={20} />
            <div className="grow stack-sm">
              <Skeleton height={13} width="50%" />
              <Skeleton height={11} width="30%" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* --------------------------------------------------------------- empty */

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: string
  title: string
  body?: string
  action?: ReactNode
}) {
  return (
    <div className="empty">
      <div className="empty__icon">{icon}</div>
      <h3>{title}</h3>
      {body && <p className="tiny">{body}</p>}
      {action}
    </div>
  )
}

/* -------------------------------------------------------------- avatar */

const AVATAR_COLORS = [
  'linear-gradient(135deg, #FC8702, #E9B213)',
  'linear-gradient(135deg, #0CA6FE, #0582CA)',
  'linear-gradient(135deg, #21BCA5, #17d3b5)',
  'linear-gradient(135deg, #5F4B8B, #8b6fc7)',
  'linear-gradient(135deg, #D94432, #f2704f)',
]

/** Deterministic colour from the address, so a person looks the same everywhere. */
export function Avatar({ seed, label }: { seed: string; label: string }) {
  const background = useMemo(() => {
    let hash = 0
    for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0
    return AVATAR_COLORS[hash % AVATAR_COLORS.length]
  }, [seed])

  return (
    <div className="avatar" style={{ background }} aria-hidden="true">
      {label.slice(0, 1).toUpperCase()}
    </div>
  )
}

/* -------------------------------------------------------------- toasts */

export interface Toast {
  id: number
  message: string
  tone: 'neutral' | 'error' | 'success'
}

export function ToastHost({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="toast-host" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`toast ${t.tone !== 'neutral' ? `toast--${t.tone}` : ''}`}
        >
          {t.message}
        </div>
      ))}
    </div>
  )
}

/* ----------------------------------------------------------- confetti */

/**
 * Deliberately hand-rolled: a confetti dependency would be larger than the
 * whole app, and this runs entirely on the compositor.
 */
export function Confetti({ fire }: { fire: number }) {
  const [bits, setBits] = useState<Array<{ id: number; style: React.CSSProperties }>>([])

  useEffect(() => {
    if (!fire) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const colors = ['#FC8702', '#E9B213', '#0CA6FE', '#21BCA5', '#5F4B8B']
    const next = Array.from({ length: 44 }, (_, i) => ({
      id: fire * 1000 + i,
      style: {
        left: `${Math.random() * 100}%`,
        background: colors[i % colors.length],
        animationDuration: `${1.6 + Math.random() * 1.4}s`,
        animationDelay: `${Math.random() * 0.35}s`,
      } as React.CSSProperties,
    }))
    setBits(next)

    const timer = setTimeout(() => setBits([]), 3600)
    return () => clearTimeout(timer)
  }, [fire])

  if (!bits.length) return null

  return (
    <div className="confetti" aria-hidden="true">
      {bits.map((b) => (
        <div key={b.id} className="confetti__bit" style={b.style} />
      ))}
    </div>
  )
}
