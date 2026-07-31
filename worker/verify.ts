/**
 * On-chain verification.
 *
 * The rule this file exists to enforce: a contribution only counts as
 * `confirmed` once we have independently seen it on chain. The client tells us
 * a payment happened; we believe the chain. Anything we cannot prove stays
 * `pending` — we never mark a row `failed` just because an RPC call errored,
 * because that would erase a real payment on a transient network blip.
 */

import { CHAINS } from '../shared/chains'
import { normaliseNimAddress } from '../shared/addresses'

export type VerifyOutcome = 'confirmed' | 'failed' | 'unknown'

interface JsonRpcResponse<T> {
  result?: T
  error?: { code: number; message: string }
}

async function callRpc<T>(url: string, method: string, params: unknown[]): Promise<T | null> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: AbortSignal.timeout(6000),
    })
    if (!res.ok) return null
    const body = (await res.json()) as JsonRpcResponse<T>
    if (body.error) return null
    return body.result ?? null
  } catch {
    return null
  }
}

/** Standard EVM JSON-RPC: the value sits directly on `result`. */
const evmRpc = callRpc

/**
 * Nimiq's Albatross RPC wraps every payload one level deeper than a normal
 * JSON-RPC server: `{"result": {"data": <value>, "metadata": null}}`. Reading
 * `result` directly yields the wrapper object, so verification silently never
 * matches. Unwrap `data` here, once, for every Nimiq call.
 */
async function nimiqRpc<T>(url: string, method: string, params: unknown[]): Promise<T | null> {
  const wrapped = await callRpc<{ data?: T; metadata?: unknown } | T>(url, method, params)
  if (wrapped && typeof wrapped === 'object' && 'data' in wrapped) {
    return ((wrapped as { data?: T }).data ?? null) as T | null
  }
  return (wrapped ?? null) as T | null
}

const SELECTOR_TRANSFER = 'a9059cbb'

/** Decode an ERC-20 `transfer(address,uint256)` calldata payload. */
export function decodeTransfer(input: string): { to: string; amount: bigint } | null {
  const data = input.toLowerCase().replace(/^0x/, '')
  if (!data.startsWith(SELECTOR_TRANSFER) || data.length < 8 + 64 + 64) return null
  const to = '0x' + data.slice(8 + 24, 8 + 64)
  const amount = BigInt('0x' + data.slice(8 + 64, 8 + 128))
  return { to, amount }
}

interface EvmTx {
  from: string
  to: string | null
  input: string
}
interface EvmReceipt {
  status: string
  to: string | null
}

/**
 * Verify an ERC-20 contribution: the transaction must have succeeded, been sent
 * to the right token contract, and its calldata must decode to a transfer of at
 * least `expectedAmount` to the pot address.
 */
export async function verifyEvmContribution(params: {
  chainId: number
  txHash: string
  expectedTo: string
  expectedAmount: bigint
  expectedFrom: string
}): Promise<VerifyOutcome> {
  const chain = CHAINS[params.chainId]
  if (!chain) return 'unknown'
  if (!/^0x[0-9a-f]{64}$/i.test(params.txHash)) return 'unknown'

  const url = chain.rpcUrls[0]
  const receipt = await evmRpc<EvmReceipt | null>(url, 'eth_getTransactionReceipt', [params.txHash])
  if (!receipt) return 'unknown' // not mined yet, or RPC unavailable

  // A mined-but-reverted transaction is the one case we can definitively fail.
  if (receipt.status === '0x0') return 'failed'

  const tx = await evmRpc<EvmTx | null>(url, 'eth_getTransactionByHash', [params.txHash])
  if (!tx) return 'unknown'

  if ((tx.to ?? '').toLowerCase() !== chain.token.toLowerCase()) return 'failed'
  if (tx.from.toLowerCase() !== params.expectedFrom.toLowerCase()) return 'failed'

  const decoded = decodeTransfer(tx.input)
  if (!decoded) return 'failed'
  if (decoded.to.toLowerCase() !== params.expectedTo.toLowerCase()) return 'failed'
  // Allow overpayment; only under-payment is a mismatch.
  if (decoded.amount < params.expectedAmount) return 'failed'

  return 'confirmed'
}

interface NimTx {
  hash: string
  from: string
  to: string
  value: number
  data?: string
  senderData?: string
  recipientData?: string
}

function nimDataMatches(tx: NimTx, memo: string): boolean {
  const fields = [tx.data, tx.recipientData, tx.senderData].filter(Boolean) as string[]
  return fields.some((field) => {
    if (field === memo) return true
    // The data field may come back hex-encoded depending on the node.
    try {
      const hex = field.replace(/^0x/, '')
      if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) return false
      const bytes = hex.match(/.{2}/g)!.map((h) => Number.parseInt(h, 16))
      return new TextDecoder().decode(new Uint8Array(bytes)) === memo
    } catch {
      return false
    }
  })
}

const normaliseNim = normaliseNimAddress

/**
 * Verify a NIM contribution.
 *
 * The Nimiq provider returns a *serialized transaction* rather than a hash, so
 * we cannot always look the payment up by id. Instead we scan recent
 * transactions to the pot address and match on the `kitty:<id>` memo we stamped
 * into the data field — which is exactly why the memo is written in the first
 * place.
 */
export async function verifyNimContribution(params: {
  rpcUrl: string
  txHash: string
  expectedTo: string
  expectedAmount: bigint
  expectedFrom: string
  memo: string
  /**
   * Canonical hashes already claimed by other contributions to this pot. The
   * scan below must not award one on-chain payment to two different rows.
   */
  excludeHashes?: Set<string>
}): Promise<{ outcome: VerifyOutcome; canonicalHash?: string }> {
  const haveCanonicalHash = !params.txHash.startsWith('local:')

  if (haveCanonicalHash) {
    const tx = await nimiqRpc<NimTx | null>(params.rpcUrl, 'getTransactionByHash', [params.txHash])
    if (tx) {
      const ok =
        normaliseNim(tx.to) === normaliseNim(params.expectedTo) &&
        BigInt(Math.round(tx.value)) >= params.expectedAmount
      return { outcome: ok ? 'confirmed' : 'failed', canonicalHash: tx.hash }
    }
    // We were given a real hash and the chain has not seen it yet. That means
    // "not in consensus yet", so we wait and re-check. Falling through to the
    // address scan here would be actively wrong: it could match a *different*
    // payment from the same person and confirm the wrong row.
    return { outcome: 'unknown' }
  }

  // No canonical hash — the provider returned a serialized transaction rather
  // than an id. Scan the pot address for the memo we stamped on the payment.
  // The third argument is a start-at hash (or null); the RPC rejects the call
  // without it.
  const recent = await nimiqRpc<NimTx[] | null>(params.rpcUrl, 'getTransactionsByAddress', [
    normaliseNim(params.expectedTo),
    100,
    null,
  ])
  if (!recent || !Array.isArray(recent)) return { outcome: 'unknown' }

  const match = recent.find(
    (tx) =>
      !params.excludeHashes?.has(tx.hash) &&
      normaliseNim(tx.to) === normaliseNim(params.expectedTo) &&
      normaliseNim(tx.from) === normaliseNim(params.expectedFrom) &&
      BigInt(Math.round(tx.value)) >= params.expectedAmount &&
      nimDataMatches(tx, params.memo),
  )

  if (match) return { outcome: 'confirmed', canonicalHash: match.hash }
  return { outcome: 'unknown' } // may simply not be in consensus yet
}
