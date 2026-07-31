/**
 * Live check of the on-chain verification logic against Nimiq mainnet.
 *
 * Not a unit test with mocks — the whole risk in `verify.ts` is whether our
 * assumptions about the RPC's response shape are right, and a mock would just
 * encode the same assumptions twice. Run with: npm run test:live
 */
import { verifyNimContribution, decodeTransfer } from '../worker/verify'

const RPC = 'https://rpc.nimiqwatch.com'

let failures = 0

/** BigInt has no JSON representation, so render it before comparing. */
function show(value: unknown): string {
  return JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? `${v}n` : v))
}

function check(name: string, actual: unknown, expected: unknown) {
  const ok = show(actual) === show(expected)
  if (!ok) failures++
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}`)
  if (!ok) console.log(`        expected ${show(expected)}, got ${show(actual)}`)
}

async function latestTransaction() {
  const call = async (method: string, params: unknown[]) => {
    const res = await fetch(RPC, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    })
    return ((await res.json()) as { result?: { data?: unknown } }).result?.data
  }

  const head = (await call('getBlockNumber', [])) as number
  for (let i = 0; i < 60; i++) {
    const block = (await call('getBlockByNumber', [head - i, true])) as
      | { transactions?: Array<Record<string, unknown>> }
      | undefined
    const tx = block?.transactions?.[0]
    if (tx) return tx
  }
  throw new Error('No transaction found in the last 60 blocks')
}

async function main() {
  console.log('\nERC-20 calldata decoding')
  check(
    'decodes transfer(address,uint256)',
    decodeTransfer(
      '0xa9059cbb' +
        '000000000000000000000000f39fd6e51aad88f6f4ce6ab8827279cfffb92266' +
        '00000000000000000000000000000000000000000000000000000000000f4240',
    ),
    { to: '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266', amount: 1_000_000n },
  )
  check('rejects non-transfer calldata', decodeTransfer('0xdeadbeef'), null)

  console.log('\nNimiq verification against mainnet')
  const tx = await latestTransaction()
  const hash = tx.hash as string
  const from = tx.from as string
  const to = tx.to as string
  const value = BigInt(Math.round(tx.value as number))
  const memoHex = (tx.recipientData as string) || ''
  const memo = memoHex
    ? new TextDecoder().decode(
        new Uint8Array((memoHex.match(/.{2}/g) ?? []).map((h) => parseInt(h, 16))),
      )
    : ''

  console.log(`  using tx ${hash.slice(0, 16)}…  value=${value} memo=${JSON.stringify(memo)}`)

  const exact = await verifyNimContribution({
    rpcUrl: RPC,
    txHash: hash,
    expectedTo: to,
    expectedAmount: value,
    expectedFrom: from,
    memo,
  })
  check('confirms a real transaction by hash', exact.outcome, 'confirmed')

  const overpay = await verifyNimContribution({
    rpcUrl: RPC,
    txHash: hash,
    expectedTo: to,
    expectedAmount: value + 1_000_000_000n,
    expectedFrom: from,
    memo,
  })
  check('fails when the on-chain value is short', overpay.outcome, 'failed')

  const wrongDest = await verifyNimContribution({
    rpcUrl: RPC,
    txHash: hash,
    expectedTo: 'NQ271EE2A5R4LR8JQXVQ0F4HSTFDBV9M8T7P',
    expectedAmount: value,
    expectedFrom: from,
    memo,
  })
  check('fails when the recipient is not the pot', wrongDest.outcome, 'failed')

  const unknownHash = await verifyNimContribution({
    rpcUrl: RPC,
    txHash: 'ab'.repeat(32),
    expectedTo: to,
    expectedAmount: value,
    expectedFrom: from,
    memo,
  })
  check('stays unknown for a hash that is not on chain', unknownHash.outcome, 'unknown')

  console.log(
    failures === 0 ? '\nAll live checks passed.\n' : `\n${failures} live check(s) failed.\n`,
  )
  process.exit(failures === 0 ? 0 : 1)
}

void main().catch((err) => {
  console.error('Live test crashed:', err)
  process.exit(1)
})
