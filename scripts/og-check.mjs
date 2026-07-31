/**
 * Open Graph image lifecycle check.
 *
 * The OG route has an unusual contract worth testing directly: the request a
 * crawler makes must *never* rasterise (that would cost ~152 ms CPU against a
 * 10 ms free-plan budget, and a CPU overrun is an uncatchable isolate kill —
 * error 1102, no image, cached hard by every platform). Instead it serves
 * pre-built bytes immediately and defers the real render to its own invocation,
 * which fills a cache so later requests are upgraded.
 *
 * So this asserts two different things:
 *   1. Safety  — every path returns a valid 1200x630 PNG, on any plan.
 *   2. Upgrade — where CPU headroom exists, the per-Kitty card appears.
 *
 * A missing upgrade is reported as INFO, not failure: on the free plan it is
 * the expected, designed-for outcome.
 *
 * Usage:  node scripts/og-check.mjs [baseUrl]
 */

const BASE = (process.argv[2] ?? 'http://127.0.0.1:8787').replace(/\/$/, '')
const NQ = 'NQ27 1EE2 A5R4 LR8J QXVQ 0F4H STFD BV9M 8T7P'

let failures = 0
const ok = (m) => console.log(`  PASS  ${m}`)
const bad = (m, d) => {
  failures++
  console.log(`  FAIL  ${m}`)
  if (d) console.log(`        → ${d}`)
}
const info = (m, d) => {
  console.log(`  INFO  ${m}`)
  if (d) console.log(`        ${d}`)
}

const deviceId = () =>
  [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('')

/** Parse PNG magic + IHDR dimensions without a decoder. */
function pngInfo(buf) {
  const b = new Uint8Array(buf)
  const magic = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (b.length < 24 || magic.some((v, i) => b[i] !== v)) return null
  const dv = new DataView(buf)
  return { width: dv.getUint32(16), height: dv.getUint32(24 - 4), bytes: b.length }
}

async function getPng(url) {
  const res = await fetch(url)
  const buf = await res.arrayBuffer()
  return {
    status: res.status,
    type: res.headers.get('content-type') ?? '',
    mode: res.headers.get('x-kitty-og') ?? '',
    png: pngInfo(buf),
  }
}

/** Assert the universal safety contract: 200, image/png, exactly 1200x630. */
function assertSafe(label, r, expectedModes) {
  if (r.status !== 200) return bad(`${label}: HTTP 200`, `got ${r.status} — a crawler would cache a miss`)
  if (!r.type.startsWith('image/png')) return bad(`${label}: image/png`, `got '${r.type}'`)
  if (!r.png) return bad(`${label}: valid PNG bytes`, 'magic bytes missing')
  if (r.png.width !== 1200 || r.png.height !== 630)
    return bad(`${label}: 1200x630`, `got ${r.png.width}x${r.png.height}`)
  if (expectedModes && !expectedModes.includes(r.mode))
    return bad(`${label}: x-kitty-og in [${expectedModes}]`, `got '${r.mode}'`)
  ok(`${label} → 200 image/png 1200x630 (x-kitty-og: ${r.mode})`)
  return true
}

async function seed(title, amount) {
  const res = await fetch(`${BASE}/api/kitties`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Device-Id': deviceId() },
    body: JSON.stringify({
      title,
      emoji: '✈️',
      rail: 'nim',
      targetAmount: '100000000',
      payoutAddress: NQ,
    }),
  })
  const body = await res.json()
  if (!body?.kitty?.id) throw new Error(`seed failed (HTTP ${res.status}): ${JSON.stringify(body)}`)
  await fetch(`${BASE}/api/kitties/${body.kitty.id}/contributions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      txHash: `local:og-${Math.floor(performance.now())}-${body.kitty.id}`,
      fromAddress: NQ,
      amount,
      displayName: 'Maya',
    }),
  })
  return body.kitty.id
}

async function main() {
  console.log(`\nOG lifecycle against ${BASE}\n`)

  const id = await seed('Weekend in Lisbon', '62000000') // 62%

  console.log('1. Safety — the crawler-facing path')
  const first = await getPng(`${BASE}/og/${id}.png`)
  assertSafe('first request (cold cache)', first, ['static', 'upgraded'])
  if (first.mode === 'static') {
    ok('first request served pre-built bytes (no rasterising on the crawler path)')
  }

  console.log('\n2. Upgrade — does the deferred render populate the cache?')
  let upgraded = null
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 500))
    const r = await getPng(`${BASE}/og/${id}.png`)
    if (r.mode === 'upgraded') {
      upgraded = r
      break
    }
  }
  if (upgraded) {
    assertSafe('upgraded card', upgraded, ['upgraded'])
    if (first.png && upgraded.png && upgraded.png.bytes !== first.png.bytes) {
      ok(`upgraded card differs from the static one (${first.png.bytes} → ${upgraded.png.bytes} bytes)`)
    } else {
      bad('upgraded card differs from the static one', 'byte length identical — is it really the per-Kitty card?')
    }
  } else {
    info(
      'no upgrade within 6s — expected on the Cloudflare free plan',
      'The render needs ~152ms CPU against a 10ms budget, so the deferred invocation is killed and ' +
        'nothing is cached. The static card keeps being served, which is the designed behaviour.',
    )
  }

  console.log('\n3. Safety net — forced failure and unknown ids')
  assertSafe('forced fallback (?fallback=1)', await getPng(`${BASE}/og/${id}.png?fallback=1`), ['fallback'])
  assertSafe('unknown Kitty id', await getPng(`${BASE}/og/zzzzzzzz.png`), ['fallback'])

  console.log('\n4. A fallback is never cached as if it were real')
  await getPng(`${BASE}/og/${id}.png?fallback=1`)
  const after = await getPng(`${BASE}/og/${id}.png`)
  if (after.mode === 'fallback') {
    bad('serving a fallback did not poison the cache', 'normal request now returns fallback')
  } else {
    ok(`serving a fallback did not poison the cache (still '${after.mode}')`)
  }

  console.log('\n5. The card follows the pot as it fills')
  const before = await getPng(`${BASE}/og/${id}.png`)
  await fetch(`${BASE}/api/kitties/${id}/contributions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      txHash: `local:bump-${Math.floor(performance.now())}`,
      fromAddress: NQ,
      amount: '30000000', // 62% -> 92%, several buckets up
      displayName: 'Sam',
    }),
  })
  const bumped = await getPng(`${BASE}/og/${id}.png`)
  assertSafe('after a new contribution', bumped, ['static', 'upgraded'])
  if (before.mode === 'upgraded' && bumped.mode === 'static') {
    ok('crossing a progress bucket invalidates the cached card (re-render queued)')
  } else if (before.mode === 'upgraded' && bumped.mode === 'upgraded') {
    bad('crossing a progress bucket invalidates the cached card', 'still served the old bucket')
  } else {
    info('bucket invalidation not observable without the upgrade path', 'expected on the free plan')
  }

  console.log(
    failures === 0
      ? `\nAll OG checks passed.${upgraded ? '' : ' (upgrade path idle — see INFO above)'}\n`
      : `\n${failures} OG check(s) failed.\n`,
  )
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('og-check crashed:', err.message)
  process.exit(1)
})
