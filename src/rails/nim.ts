import { init } from '@nimiq/mini-app-sdk'
import type { NimiqProvider } from '@nimiq/mini-app-sdk'
import { NIM_DECIMALS, toProviderNumber } from '../../shared/money'
import { isValidNimAddress, formatNimAddress } from '../../shared/addresses'
import {
  RailError,
  unwrap,
  classifyProviderError,
  type ContributeParams,
  type ContributeResult,
  type PaymentRail,
  type RailAccount,
} from './types'

export { isValidNimAddress, formatNimAddress } from '../../shared/addresses'

let providerPromise: Promise<NimiqProvider> | null = null

/**
 * True when the page is demonstrably not running inside Nimiq Pay.
 *
 * Nimiq Pay injects both the provider and the host context *before* page
 * scripts run, so by the time a user has loaded the app and tapped a button,
 * the absence of both is conclusive. Checking this lets us fail in a few
 * milliseconds instead of making someone watch "Connecting…" for the whole
 * init() timeout before being told to open the app somewhere else.
 */
function definitelyOutsideNimiqPay(): boolean {
  return typeof window !== 'undefined' && !window.nimiq && !window.nimiqPay
}

function getProvider(): Promise<NimiqProvider> {
  if (definitelyOutsideNimiqPay()) {
    return Promise.reject(
      new RailError('Nimiq wallet not available. Open this inside Nimiq Pay.', 'unavailable'),
    )
  }

  // init() resolves once Nimiq Pay injects window.nimiq. Cache it: calling it
  // per-action would re-arm the timeout on every tap.
  if (!providerPromise) {
    providerPromise = init({ timeout: 4000 }).catch((err) => {
      providerPromise = null
      throw new RailError(
        'Nimiq wallet not available. Open this inside Nimiq Pay.',
        'unavailable',
        err,
      )
    })
  }
  return providerPromise
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * The provider documents `sendBasicTransaction*` as returning "the serialized
 * transaction", not a hash. When it hands back something that already looks
 * like a 32-byte hash we use it directly; otherwise we derive a stable local
 * key so the row can be de-duplicated, and let the server reconcile the real
 * hash from chain data using the memo we stamped on the transaction.
 */
async function toReceipt(raw: string): Promise<ContributeResult> {
  const clean = raw.trim().replace(/^0x/i, '')
  if (/^[0-9a-f]{64}$/i.test(clean)) {
    return { txHash: clean.toLowerCase(), canonical: true }
  }
  return { txHash: `local:${(await sha256Hex(raw)).slice(0, 40)}`, canonical: false }
}

/** Memo written into the transaction's data field — also visible to the user. */
export function kittyMemo(kittyId: string): string {
  return `kitty:${kittyId}`
}

export class NimRail implements PaymentRail {
  readonly id = 'nim' as const
  readonly symbol = 'NIM'
  readonly decimals = NIM_DECIMALS

  async isAvailable(): Promise<boolean> {
    if (typeof window === 'undefined') return false
    if (window.nimiq) return true
    try {
      await getProvider()
      return true
    } catch {
      return false
    }
  }

  async connect(): Promise<RailAccount> {
    const provider = await getProvider()
    try {
      if (!provider.connected) await provider.connect()
      const accounts = unwrap(await provider.listAccounts())
      const address = accounts?.[0]
      if (!address) {
        throw new RailError('No Nimiq account available', 'unavailable')
      }
      return this.#account(address)
    } catch (err) {
      throw this.#wrap(err, 'Could not connect your Nimiq wallet')
    }
  }

  async peek(): Promise<RailAccount | null> {
    try {
      const provider = await getProvider()
      if (!provider.connected) return null
      const accounts = unwrap(await provider.listAccounts())
      return accounts?.[0] ? this.#account(accounts[0]) : null
    } catch {
      return null
    }
  }

  async contribute({ kittyId, to, amount }: ContributeParams): Promise<ContributeResult> {
    if (!isValidNimAddress(to)) {
      throw new RailError('That Nimiq address looks wrong', 'invalid_address')
    }
    const provider = await getProvider()
    try {
      // The memo makes each contribution self-attesting on chain: the pot can
      // be rebuilt from an RPC node alone, with no trust in our database.
      const raw = unwrap(
        await provider.sendBasicTransactionWithData({
          recipient: formatNimAddress(to),
          value: toProviderNumber(amount),
          data: kittyMemo(kittyId),
        }),
      )
      return await toReceipt(raw)
    } catch (err) {
      throw this.#wrap(err, 'Contribution failed')
    }
  }

  async settle({ to, amount }: { to: string; amount: bigint }): Promise<ContributeResult> {
    if (!isValidNimAddress(to)) {
      throw new RailError('That Nimiq address looks wrong', 'invalid_address')
    }
    const provider = await getProvider()
    try {
      const raw = unwrap(
        await provider.sendBasicTransactionWithData({
          recipient: formatNimAddress(to),
          value: toProviderNumber(amount),
          data: 'kitty:payout',
        }),
      )
      return await toReceipt(raw)
    } catch (err) {
      throw this.#wrap(err, 'Payout failed')
    }
  }

  validateAddress(address: string): boolean {
    return isValidNimAddress(address)
  }

  explorerTxUrl(txHash: string): string | null {
    if (txHash.startsWith('local:')) return null
    return `https://nimiq.watch/#${txHash}`
  }

  explorerAddressUrl(address: string): string | null {
    return `https://nimiq.watch/#${address.replace(/\s+/g, '')}`
  }

  #account(address: string): RailAccount {
    const formatted = formatNimAddress(address)
    return {
      address: formatted,
      short: `${formatted.slice(0, 9)}…${formatted.slice(-4)}`,
    }
  }

  #wrap(err: unknown, fallbackMessage: string): RailError {
    if (err instanceof RailError) return err
    const message = err instanceof Error ? err.message : String(err)
    return new RailError(fallbackMessage, classifyProviderError('', message), err)
  }
}
