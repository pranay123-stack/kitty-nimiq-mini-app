import type { RailId } from '../../shared/types'
import { NimRail } from './nim'
import { EvmRail } from './evm'
import { DEFAULT_CHAIN_ID, getChain } from '../../shared/chains'
import type { PaymentRail } from './types'

export * from './types'
export * from '../../shared/chains'
export * from '../../shared/addresses'
export { kittyMemo } from './nim'
export { encodeTransfer } from './evm'
export { NimRail } from './nim'
export { EvmRail } from './evm'

const cache = new Map<string, PaymentRail>()

/**
 * The only place the app decides which currency it is talking to. Every screen
 * above this takes a `PaymentRail` and never branches on `rail === 'nim'`.
 */
export function createRail(rail: RailId, chainId?: number | null): PaymentRail {
  const key = rail === 'nim' ? 'nim' : `usdt:${chainId ?? DEFAULT_CHAIN_ID}`
  const existing = cache.get(key)
  if (existing) return existing

  const instance: PaymentRail =
    rail === 'nim' ? new NimRail() : new EvmRail(chainId ?? DEFAULT_CHAIN_ID)
  cache.set(key, instance)
  return instance
}

/** Decimals for a rail without instantiating a provider (safe during SSR/tests). */
export function railDecimals(rail: RailId, chainId?: number | null): number {
  if (rail === 'nim') return 5
  return getChain(chainId ?? DEFAULT_CHAIN_ID)?.decimals ?? 6
}

export function railSymbol(rail: RailId, chainId?: number | null): string {
  if (rail === 'nim') return 'NIM'
  return getChain(chainId ?? DEFAULT_CHAIN_ID)?.tokenSymbol ?? 'USDT'
}
