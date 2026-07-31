import { requestDeviceIdentifier } from '@nimiq/mini-app-sdk'

/**
 * Device identifier handling.
 *
 * Two honest constraints shape this file:
 *  1. The identifier is per *device*, not per user — Nimiq's own docs say a
 *     shared device returns the same value to everyone. So it gates "did this
 *     device create this Kitty" and nothing security-sensitive.
 *  2. The user can refuse. Everything except creating and settling a pot must
 *     keep working when they do — a declined prompt is a choice, not an error.
 */

const STORAGE_KEY = 'kitty.device-id'

let cached: string | null = null
let inflight: Promise<string | null> | null = null

/** Whatever we already have, without prompting. */
export function peekDeviceId(): string | null {
  if (cached) return cached
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored && /^[0-9a-f]{64}$/i.test(stored)) {
      cached = stored
      return cached
    }
  } catch {
    // Private mode or storage disabled — fall through and ask the host again.
  }
  return null
}

/**
 * Ask Nimiq Pay for the identifier. `reason` is shown verbatim to the user on
 * the first call per origin, so it is written for a human, not a log file.
 */
export async function ensureDeviceId(
  reason = 'So we can show your name on the contributor list and keep this Kitty yours',
): Promise<string | null> {
  const existing = peekDeviceId()
  if (existing) return existing
  if (inflight) return inflight

  inflight = (async () => {
    try {
      const id = await requestDeviceIdentifier({ reason })
      if (typeof id === 'string' && /^[0-9a-f]{64}$/i.test(id)) {
        cached = id.toLowerCase()
        try {
          localStorage.setItem(STORAGE_KEY, cached)
        } catch {
          // Non-fatal: we simply re-prompt next session.
        }
        return cached
      }
      return null
    } catch {
      // Declined, empty reason, or running outside Nimiq Pay.
      return null
    } finally {
      inflight = null
    }
  })()

  return inflight
}

/** True when the app can perform organizer-only actions on this device. */
export function hasDeviceId(): boolean {
  return peekDeviceId() !== null
}
