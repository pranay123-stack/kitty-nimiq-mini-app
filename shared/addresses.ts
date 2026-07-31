/**
 * Address validation, kept dependency-free so both the React app and the Worker
 * can use the exact same rules. Divergent client/server validation is how a
 * payout address that looks fine in the UI ends up unspendable on chain.
 */

/** Nimiq's base32 alphabet — note it omits I, O, W and Z. */
const NQ_ALPHABET = '0123456789ABCDEFGHJKLMNPQRSTUVXY'

/**
 * Validate a Nimiq address including the IBAN-style mod-97 checksum.
 *
 * Worth doing properly rather than a format-only regex: the payout address is
 * where an entire pot lands, and one mistyped character would otherwise send it
 * somewhere unrecoverable.
 */
export function isValidNimAddress(address: string): boolean {
  const clean = address.replace(/\s+/g, '').toUpperCase()
  if (clean.length !== 36 || !clean.startsWith('NQ')) return false
  if (!/^\d{2}$/.test(clean.slice(2, 4))) return false
  for (const ch of clean.slice(4)) {
    if (!NQ_ALPHABET.includes(ch)) return false
  }
  // Rotate the first four characters to the end, map letters to 10..35, mod 97.
  const rotated = clean.slice(4) + clean.slice(0, 4)
  let digits = ''
  for (const ch of rotated) {
    digits += ch >= '0' && ch <= '9' ? ch : (ch.charCodeAt(0) - 55).toString()
  }
  let remainder = 0
  for (const d of digits) {
    remainder = (remainder * 10 + Number(d)) % 97
  }
  return remainder === 1
}

/** Group into blocks of four, the way Nimiq displays addresses. */
export function formatNimAddress(address: string): string {
  const clean = address.replace(/\s+/g, '').toUpperCase()
  return clean.match(/.{1,4}/g)?.join(' ') ?? clean
}

export function normaliseNimAddress(address: string): string {
  return address.replace(/\s+/g, '').toUpperCase()
}

export function isValidEvmAddress(address: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(address.trim())
}

/** Validate against whichever rail the Kitty is denominated in. */
export function isValidAddressFor(rail: 'nim' | 'usdt', address: string): boolean {
  return rail === 'nim' ? isValidNimAddress(address) : isValidEvmAddress(address)
}
