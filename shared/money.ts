/**
 * Money handling for Kitty.
 *
 * Everything is a bigint of *base units* internally (Luna for NIM, 1e-6 for
 * USDT) and a decimal string on the wire. We never put a monetary value through
 * a JS float: the Nimiq provider takes `value` as a `number` of Lunas, so the
 * only safe pattern is to keep exact integers everywhere and convert to
 * `number` at the last possible moment, after checking it is still exact.
 */

export const NIM_DECIMALS = 5 // 1 NIM = 100_000 Luna
export const USDT_DECIMALS = 6 // USDT is 6dp on every chain we target

/** Parse a human-typed amount ("12.50") into base units. Throws on garbage. */
export function parseAmount(input: string, decimals: number): bigint {
  const trimmed = input.trim().replace(',', '.')
  if (!/^\d*\.?\d*$/.test(trimmed) || trimmed === '' || trimmed === '.') {
    throw new Error('Enter a valid amount')
  }
  const [whole, frac = ''] = trimmed.split('.')
  if (frac.length > decimals) {
    throw new Error(`Too many decimal places (max ${decimals})`)
  }
  const padded = frac.padEnd(decimals, '0')
  return BigInt(whole || '0') * 10n ** BigInt(decimals) + BigInt(padded || '0')
}

/** Format base units for display. Trims trailing zeros but keeps `minFrac`. */
export function formatAmount(
  base: bigint,
  decimals: number,
  opts: { minFrac?: number; maxFrac?: number; group?: boolean } = {},
): string {
  const { minFrac = 0, maxFrac = decimals, group = true } = opts
  const negative = base < 0n
  const abs = negative ? -base : base
  const divisor = 10n ** BigInt(decimals)
  const whole = abs / divisor
  const frac = abs % divisor

  let fracStr = frac.toString().padStart(decimals, '0').slice(0, maxFrac)
  fracStr = fracStr.replace(/0+$/, '')
  while (fracStr.length < minFrac) fracStr += '0'

  const wholeStr = group
    ? whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
    : whole.toString()

  return `${negative ? '-' : ''}${wholeStr}${fracStr ? '.' + fracStr : ''}`
}

/**
 * Convert base units to the `number` the Nimiq provider expects.
 *
 * `sendBasicTransaction({ value })` is typed as a plain `number` of Lunas, so a
 * large pot could in principle exceed Number.MAX_SAFE_INTEGER. Guard rather
 * than silently truncate — a silently wrong `value` is a lost transaction.
 */
export function toProviderNumber(base: bigint): number {
  if (base > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('Amount too large to send safely')
  }
  if (base < 0n) throw new Error('Amount must be positive')
  return Number(base)
}

/** Percentage of target reached, clamped to [0, 100] and rounded to 1dp. */
export function progressPct(raised: bigint, target: bigint): number {
  if (target <= 0n) return 0
  const pct = Number((raised * 1000n) / target) / 10
  return Math.max(0, Math.min(100, pct))
}

/** Safe parse of a decimal-string amount that arrived over the wire. */
export function fromWire(value: string): bigint {
  if (!/^\d+$/.test(value)) throw new Error('Malformed amount')
  return BigInt(value)
}
