import type { RailId } from '../../shared/types'

export interface RailAccount {
  address: string
  /** Short form for display, e.g. "NQ07 0000…0000" or "0x1234…abcd". */
  short: string
}

export interface ContributeParams {
  kittyId: string
  /** The pot: the organizer's own address. */
  to: string
  /** Base units. */
  amount: bigint
}

export interface ContributeResult {
  /**
   * Dedup key for this payment. On EVM this is the real transaction hash. On
   * Nimiq the provider returns a *serialized transaction* rather than a hash,
   * so this may be a locally derived digest — see `nim.ts`. Either way the
   * server treats it as opaque and re-derives truth from chain data.
   */
  txHash: string
  /** False when we could not obtain a canonical on-chain hash client-side. */
  canonical: boolean
}

/**
 * The single interface both currencies implement.
 *
 * The whole point: every screen above this line is currency-agnostic. Adding a
 * third rail later means writing one file, not touching the UI.
 */
export interface PaymentRail {
  readonly id: RailId
  /** Ticker shown in the UI. Per-chain for EVM (USDT vs BSC-USD). */
  readonly symbol: string
  /** Base-unit exponent. NOT constant across chains — BSC USDT is 18dp. */
  readonly decimals: number

  /** Is the underlying provider actually present in this WebView? */
  isAvailable(): Promise<boolean>
  /** Prompts the user. Always goes through the wallet's native dialog. */
  connect(): Promise<RailAccount>
  /** Current account without prompting, or null if not connected yet. */
  peek(): Promise<RailAccount | null>
  contribute(params: ContributeParams): Promise<ContributeResult>
  /** Organizer paying the pot out to its final destination. */
  settle(params: { to: string; amount: bigint }): Promise<ContributeResult>
  validateAddress(address: string): boolean
  explorerTxUrl(txHash: string): string | null
  explorerAddressUrl(address: string): string | null
}

/** Error the UI knows how to render kindly, instead of dumping a stack. */
export class RailError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'rejected' // user declined in the native dialog — not an error state
      | 'unavailable' // provider missing (e.g. opened outside Nimiq Pay)
      | 'wrong_network'
      | 'insufficient_funds'
      | 'invalid_address'
      | 'amount_too_large'
      | 'failed',
    readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'RailError'
  }
}

/**
 * The Nimiq provider resolves with `{error: {...}}` instead of rejecting on
 * several paths, so a bare try/catch reads a user rejection as success. Every
 * provider call in this app goes through here.
 */
export function unwrap<T>(result: T | { error: { type: string; message: string } }): T {
  if (result && typeof result === 'object' && 'error' in result) {
    const { type, message } = (result as { error: { type: string; message: string } }).error
    throw new RailError(message || 'Wallet request failed', classifyProviderError(type, message))
  }
  return result as T
}

export function classifyProviderError(type: string, message: string): RailError['code'] {
  const haystack = `${type} ${message}`.toLowerCase()
  if (/reject|denied|cancel|declin|abort|user closed/.test(haystack)) return 'rejected'
  if (/insufficient|balance|not enough/.test(haystack)) return 'insufficient_funds'
  if (/network|chain|unsupported/.test(haystack)) return 'wrong_network'
  if (/address|recipient|invalid/.test(haystack)) return 'invalid_address'
  return 'failed'
}
