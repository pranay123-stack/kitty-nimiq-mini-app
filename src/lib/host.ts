import { getHostLanguage } from '@nimiq/mini-app-sdk'

/** Locales we ship. Anything else falls back to English. */
export const SUPPORTED_LOCALES = ['en', 'de', 'es'] as const
export type Locale = (typeof SUPPORTED_LOCALES)[number]

/**
 * Resolve the UI language.
 *
 * `getHostLanguage()` reflects the language the user picked *inside Nimiq Pay*,
 * which is the one they actually want. `navigator.language` is the device
 * locale and can easily disagree — it is only a fallback for running this app
 * in a normal browser during development.
 */
export function resolveLocale(): Locale {
  const host = getHostLanguage()
  const candidate = (host ?? navigator.language ?? 'en').slice(0, 2).toLowerCase()
  return (SUPPORTED_LOCALES as readonly string[]).includes(candidate)
    ? (candidate as Locale)
    : 'en'
}

/** True when we are actually running inside Nimiq Pay. */
export function isInsideNimiqPay(): boolean {
  return typeof window !== 'undefined' && (!!window.nimiqPay || !!window.nimiq)
}

/**
 * Where the app is running.
 *
 * There is deliberately no `'detecting'` state. Nimiq Pay injects both the
 * provider and the host context *before page scripts run*, so the synchronous
 * check is right in practice — and a link that arrives stripped of its scheme
 * must never land on a spinner. We render the browser branch immediately and
 * upgrade if a provider turns up late.
 */
export type HostMode = 'nimiq-pay' | 'browser'

export function detectHostMode(): HostMode {
  return isInsideNimiqPay() ? 'nimiq-pay' : 'browser'
}

/**
 * Watch briefly for a provider that arrives after first paint.
 *
 * Belt and braces for a host build that injects late: we have already shown a
 * usable screen, so this only ever upgrades browser → nimiq-pay, never the
 * reverse. Returns an unsubscribe function.
 */
export function watchForProvider(
  onFound: () => void,
  { timeoutMs = 2500, intervalMs = 150 }: { timeoutMs?: number; intervalMs?: number } = {},
): () => void {
  if (isInsideNimiqPay()) return () => undefined

  let elapsed = 0
  const timer = setInterval(() => {
    elapsed += intervalMs
    if (isInsideNimiqPay()) {
      clearInterval(timer)
      onFound()
    } else if (elapsed >= timeoutMs) {
      clearInterval(timer)
    }
  }, intervalMs)

  return () => clearInterval(timer)
}

/** Where to send someone who does not have Nimiq Pay installed. */
export const NIMIQ_PAY_URL = 'https://www.nimiq.com/nimiq-pay/'

/**
 * Try to hand off to Nimiq Pay from a plain browser.
 *
 * There is no reliable way to detect whether a custom scheme resolved — the
 * browser simply does nothing when the app is absent. So we fire the deeplink
 * and, if the page is still visible a moment later, surface the install link
 * rather than leaving the user staring at a page that did nothing.
 */
export function openInNimiqPay(kittyId: string | null, onNoApp: () => void): void {
  const target = kittyId ? deepLink(kittyId) : appDeepLink()
  const startedAt = Date.now()

  const timer = setTimeout(() => {
    // If we were backgrounded, the hand-off worked; a long gap means the OS
    // switched away and came back rather than never leaving at all.
    if (document.visibilityState === 'visible' && Date.now() - startedAt < 2500) {
      onNoApp()
    }
  }, 1200)

  const cancel = () => {
    if (document.visibilityState === 'hidden') clearTimeout(timer)
  }
  document.addEventListener('visibilitychange', cancel, { once: true })

  window.location.href = target
}

export function appBaseUrl(): string {
  return window.location.origin
}

/** Plain web link to a Kitty — works in any browser or chat app. */
export function webLink(kittyId: string): string {
  return `${appBaseUrl()}/k/${kittyId}`
}

/**
 * Deeplink that opens the Kitty inside Nimiq Pay with full wallet access.
 * The documented shape is `nimiqpay://miniapp?url=<my-app-url>`.
 */
export function deepLink(kittyId: string): string {
  return `nimiqpay://miniapp?url=${encodeURIComponent(webLink(kittyId))}`
}

/** Deeplink to the app itself, for someone who has no particular Kitty yet. */
export function appDeepLink(): string {
  return `nimiqpay://miniapp?url=${encodeURIComponent(appBaseUrl())}`
}

/**
 * The message we hand to the OS share sheet.
 *
 * Both links, every time, deliberately. A deeplink alone is fragile: several
 * chat clients strip or refuse to linkify a custom scheme, and anyone without
 * Nimiq Pay installed gets nothing at all. The https link always resolves, and
 * it is also the one that produces the rich preview with live progress — which
 * is the thing that actually makes people tap.
 */
export function shareMessage(params: {
  kittyId: string
  intro: string
  payLabel: string
  webLabel: string
}): { text: string; url: string; deeplink: string } {
  const web = webLink(params.kittyId)
  const deep = deepLink(params.kittyId)
  return {
    text: `${params.intro}\n\n${params.payLabel} ${deep}\n\n${params.webLabel}`,
    url: web,
    deeplink: deep,
  }
}

export interface ShareResult {
  method: 'native' | 'clipboard' | 'failed'
}

/**
 * Share a Kitty. Prefers the OS share sheet, which is what makes this spread
 * through the group chats people already use; falls back to the clipboard so
 * the button is never a dead end.
 */
export async function shareKitty(params: {
  kittyId: string
  title: string
  /** Human intro line, e.g. "I started a Kitty for X — chip in?" */
  text: string
  /** Prefix for the deeplink line, e.g. "Open in Nimiq Pay:" */
  payLabel: string
  /** Trailing line explaining the https link, which the sheet appends as `url`. */
  webLabel: string
}): Promise<ShareResult> {
  const { text, url } = shareMessage({
    kittyId: params.kittyId,
    intro: params.text,
    payLabel: params.payLabel,
    webLabel: params.webLabel,
  })

  if (navigator.share) {
    try {
      // `url` carries the https link so the target app generates the rich
      // preview from it; the deeplink rides along inside `text`.
      await navigator.share({ title: params.title, text, url })
      return { method: 'native' }
    } catch (err) {
      // AbortError means the user closed the sheet: that is not a failure and
      // must not trigger a fallback that quietly copies without asking.
      if ((err as Error)?.name === 'AbortError') return { method: 'native' }
    }
  }

  try {
    // The clipboard path carries both links too — same reasoning as above.
    await navigator.clipboard.writeText(`${text} ${url}`)
    return { method: 'clipboard' }
  } catch {
    return { method: 'failed' }
  }
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/** Light haptic where supported — small thing, makes taps feel native. */
export function tap(pattern: number | number[] = 8): void {
  try {
    navigator.vibrate?.(pattern)
  } catch {
    // Unsupported; ignore.
  }
}
