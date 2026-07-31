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
  text: string
}): Promise<ShareResult> {
  const url = webLink(params.kittyId)

  if (navigator.share) {
    try {
      await navigator.share({ title: params.title, text: params.text, url })
      return { method: 'native' }
    } catch (err) {
      // AbortError means the user closed the sheet: that is not a failure and
      // must not trigger a fallback that quietly copies without asking.
      if ((err as Error)?.name === 'AbortError') return { method: 'native' }
    }
  }

  try {
    await navigator.clipboard.writeText(`${params.text} ${url}`)
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
