import { RailError } from '../rails'
import { ApiFailure } from './api'
import type { TranslationKey } from '../i18n'

/**
 * One place that turns any thrown thing into a translation key.
 *
 * Rejection is deliberately *not* treated as a failure anywhere upstream: the
 * user declining a native approval dialog is a normal, expected outcome and
 * should read as "cancelled", never as a red error.
 */
export function errorKey(err: unknown): TranslationKey {
  if (err instanceof RailError) {
    switch (err.code) {
      case 'rejected':
        return 'err.rejected'
      case 'unavailable':
        return 'err.unavailable'
      case 'wrong_network':
        return 'err.wrongNetwork'
      case 'insufficient_funds':
        return 'err.insufficient'
      case 'invalid_address':
        return 'err.invalidAddress'
      case 'amount_too_large':
      case 'failed':
      default:
        return 'err.failed'
    }
  }

  if (err instanceof ApiFailure) {
    switch (err.code) {
      case 'rate_limited':
        return 'err.rateLimited'
      case 'duplicate':
        return 'err.duplicate'
      case 'validation':
        return 'err.invalidAddress'
      case 'server':
        return err.status === 0 ? 'err.offline' : 'err.failed'
      default:
        return 'err.failed'
    }
  }

  return 'err.failed'
}

/** Cancelling is not an error worth a red toast. */
export function isCancellation(err: unknown): boolean {
  return err instanceof RailError && err.code === 'rejected'
}
