import { Hono } from 'hono'
import type {
  ApiError,
  Contribution,
  CreateKittyRequest,
  Kitty,
  KittyView,
  LeaderboardEntry,
  RailId,
  RecordContributionRequest,
  SettleRequest,
} from '../shared/types'
import { isValidAddressFor, normaliseNimAddress } from '../shared/addresses'
import { progressPct } from '../shared/money'
import { CHAINS } from '../shared/chains'
import { verifyEvmContribution, verifyNimContribution } from './verify'
import { injectMeta, shareCardSvg, type ShareData } from './share'
import { renderOgPng } from './og-image'

export interface Env {
  DB: D1Database
  ASSETS: Fetcher
  /**
   * Nimiq RPC endpoint for server-side verification. Everything else — share
   * links, deeplinks, Open Graph URLs — is derived from the request origin
   * rather than configured, so there is no base-URL setting to get wrong.
   */
  NIMIQ_RPC_URL: string
}

type Vars = { deviceId: string | null }

const app = new Hono<{ Bindings: Env; Variables: Vars }>()

/* ------------------------------------------------------------------ utils */

const ID_ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz' // no 0/1/i/l/o — read aloud safely

function newId(length = 8): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  return [...bytes].map((b) => ID_ALPHABET[b % ID_ALPHABET.length]).join('')
}

function fail(code: ApiError['code'], message: string, status: 400 | 403 | 404 | 429 | 500 = 400) {
  return Response.json({ error: message, code } satisfies ApiError, { status })
}

function now(): number {
  return Math.floor(Date.now() / 1000)
}

/** Amounts cross the wire as decimal strings of base units. */
function parseBaseUnits(value: unknown): bigint | null {
  if (typeof value !== 'string' || !/^\d{1,32}$/.test(value)) return null
  try {
    const parsed = BigInt(value)
    return parsed > 0n ? parsed : null
  } catch {
    return null
  }
}

function clampText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, max) : null
}

function isRail(value: unknown): value is RailId {
  return value === 'nim' || value === 'usdt'
}

function normaliseAddress(rail: RailId, address: string): string {
  return rail === 'nim' ? normaliseNimAddress(address) : address.trim().toLowerCase()
}

/* ------------------------------------------------------------- middleware */

app.use('/api/*', async (c, next) => {
  // The device identifier comes from requestDeviceIdentifier() in the Mini App.
  // It is a per-origin pseudonymous hash — never an authentication credential,
  // so it gates ownership of a Kitty you created on this device and nothing more.
  const raw = c.req.header('X-Device-Id')
  c.set('deviceId', raw && /^[0-9a-f]{64}$/i.test(raw) ? raw.toLowerCase() : null)
  await next()
})

app.onError((err, _c) => {
  console.error('API error', err)
  return fail('server', 'Something went wrong on our side', 500)
})

/* ------------------------------------------------------------------ rows  */

interface KittyRow {
  id: string
  title: string
  note: string | null
  emoji: string
  rail: RailId
  chain_id: number | null
  target_amount: string
  payout_address: string
  organizer_id: string
  organizer_name: string | null
  settled_at: number | null
  settle_tx: string | null
  settle_to: string | null
  created_at: number
}

interface ContributionRow {
  id: number
  kitty_id: string
  tx_hash: string
  from_addr: string
  amount: string
  display_name: string | null
  message: string | null
  status: 'pending' | 'confirmed' | 'failed'
  created_at: number
}

function toKitty(row: KittyRow): Kitty {
  return {
    id: row.id,
    title: row.title,
    note: row.note,
    emoji: row.emoji,
    rail: row.rail,
    chainId: row.chain_id,
    targetAmount: row.target_amount,
    payoutAddress: row.payout_address,
    organizerName: row.organizer_name,
    settledAt: row.settled_at,
    settleTx: row.settle_tx,
    settleTo: row.settle_to,
    createdAt: row.created_at,
  }
}

function toContribution(row: ContributionRow): Contribution {
  return {
    id: row.id,
    txHash: row.tx_hash,
    fromAddress: row.from_addr,
    amount: row.amount,
    displayName: row.display_name,
    message: row.message,
    status: row.status,
    createdAt: row.created_at,
  }
}

/* -------------------------------------------------------------- verifying */

/**
 * Re-check pending contributions against the chain.
 *
 * Deliberately lazy: it runs when someone loads the Kitty, so there is no cron
 * to configure and the numbers are freshest exactly when a human is looking at
 * them. Bounded per request so a busy pot can't blow the CPU budget.
 */
async function reconcilePending(env: Env, kitty: KittyRow, rows: ContributionRow[]): Promise<void> {
  const stale = rows.filter((r) => r.status === 'pending').slice(0, 5)
  if (!stale.length) return

  // Hashes already tied to a contribution here. Passed into verification so the
  // memo scan can never award one on-chain payment to two different rows.
  const claimed = new Set(
    rows.map((r) => r.tx_hash).filter((h) => !h.startsWith('local:')),
  )

  const updates = await Promise.all(
    stale.map(async (row) => {
      try {
        if (kitty.rail === 'usdt' && kitty.chain_id) {
          const outcome = await verifyEvmContribution({
            chainId: kitty.chain_id,
            txHash: row.tx_hash,
            expectedTo: kitty.payout_address,
            expectedAmount: BigInt(row.amount),
            expectedFrom: row.from_addr,
          })
          return { id: row.id, outcome, hash: undefined as string | undefined }
        }
        const { outcome, canonicalHash } = await verifyNimContribution({
          rpcUrl: env.NIMIQ_RPC_URL,
          txHash: row.tx_hash,
          expectedTo: kitty.payout_address,
          expectedAmount: BigInt(row.amount),
          expectedFrom: row.from_addr,
          memo: `kitty:${kitty.id}`,
          excludeHashes: claimed,
        })
        return { id: row.id, outcome, hash: canonicalHash }
      } catch {
        return { id: row.id, outcome: 'unknown' as const, hash: undefined }
      }
    }),
  )

  // These ran concurrently against the same `claimed` snapshot, so two rows can
  // still come back holding the same hash. Let the first keep it; the rest stay
  // pending and get re-checked on the next read.
  const seen = new Set(claimed)
  const changed = updates.filter((u) => {
    if (u.outcome === 'unknown') return false
    if (!u.hash) return true
    if (seen.has(u.hash)) return false
    seen.add(u.hash)
    return true
  })
  if (!changed.length) return

  // Applied one at a time rather than as a batch: a UNIQUE(kitty_id, tx_hash)
  // collision on a single row must not roll back every other confirmation.
  await Promise.all(
    changed.map(async (u) => {
      try {
        await env.DB.prepare(
          'UPDATE contributions SET status = ?, tx_hash = COALESCE(?, tx_hash) WHERE id = ?',
        )
          .bind(u.outcome, u.hash ?? null, u.id)
          .run()

        const row = rows.find((r) => r.id === u.id)
        if (row) {
          row.status = u.outcome as ContributionRow['status']
          if (u.hash) row.tx_hash = u.hash
        }
      } catch {
        // Another row already claimed this hash; leave ours pending.
      }
    }),
  )
}

/* ----------------------------------------------------------------- routes */

app.get('/api/health', (c) => c.json({ ok: true, time: now() }))

/** Chains we can actually denominate a pot in, for the create screen. */
app.get('/api/chains', (c) =>
  c.json({
    chains: Object.values(CHAINS).map((ch) => ({
      chainId: ch.chainId,
      name: ch.name,
      shortName: ch.shortName,
      tokenSymbol: ch.tokenSymbol,
      decimals: ch.decimals,
      documented: ch.documented,
    })),
  }),
)

app.post('/api/kitties', async (c) => {
  const deviceId = c.get('deviceId')
  if (!deviceId) {
    return fail('forbidden', 'A device identifier is required to create a Kitty', 403)
  }

  const body = (await c.req.json().catch(() => null)) as CreateKittyRequest | null
  if (!body) return fail('validation', 'Invalid request body')

  const title = clampText(body.title, 80)
  if (!title) return fail('validation', 'Give your Kitty a name')

  if (!isRail(body.rail)) return fail('validation', 'Choose NIM or USDT')

  const chainId = body.rail === 'usdt' ? Number(body.chainId) : null
  if (body.rail === 'usdt' && (!chainId || !CHAINS[chainId])) {
    return fail('validation', 'Choose a supported network')
  }

  const target = parseBaseUnits(body.targetAmount)
  if (!target) return fail('validation', 'Set a target above zero')

  const payout = clampText(body.payoutAddress, 100)
  if (!payout || !isValidAddressFor(body.rail, payout)) {
    return fail('validation', 'That payout address is not valid')
  }

  // Anti-spam: the device identifier exists precisely for this. Ten pots an
  // hour is far above real use and far below what makes spamming worthwhile.
  const recent = await c.env.DB.prepare(
    'SELECT COUNT(*) AS n FROM kitties WHERE organizer_id = ? AND created_at > ?',
  )
    .bind(deviceId, now() - 3600)
    .first<{ n: number }>()
  if ((recent?.n ?? 0) >= 10) {
    return fail('rate_limited', 'You have created a lot of Kitties. Try again in an hour.', 429)
  }

  const id = newId()
  const row: KittyRow = {
    id,
    title,
    note: clampText(body.note, 200),
    emoji: clampText(body.emoji, 8) ?? '🎁',
    rail: body.rail,
    chain_id: chainId,
    target_amount: target.toString(),
    payout_address: normaliseAddress(body.rail, payout),
    organizer_id: deviceId,
    organizer_name: clampText(body.organizerName, 40),
    settled_at: null,
    settle_tx: null,
    settle_to: null,
    created_at: now(),
  }

  await c.env.DB.prepare(
    `INSERT INTO kitties (id, title, note, emoji, rail, chain_id, target_amount,
       payout_address, organizer_id, organizer_name, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      row.id, row.title, row.note, row.emoji, row.rail, row.chain_id,
      row.target_amount, row.payout_address, row.organizer_id,
      row.organizer_name, row.created_at,
    )
    .run()

  return c.json({ kitty: toKitty(row) }, 201)
})

app.get('/api/kitties/:id', async (c) => {
  const id = c.req.param('id')
  const kitty = await c.env.DB.prepare('SELECT * FROM kitties WHERE id = ?')
    .bind(id)
    .first<KittyRow>()
  if (!kitty) return fail('not_found', 'That Kitty does not exist', 404)

  const { results } = await c.env.DB.prepare(
    'SELECT * FROM contributions WHERE kitty_id = ? ORDER BY created_at DESC LIMIT 200',
  )
    .bind(id)
    .all<ContributionRow>()
  const rows = results ?? []

  await reconcilePending(c.env, kitty, rows)

  const counted = rows.filter((r) => r.status !== 'failed')
  const raised = counted.reduce((sum, r) => sum + BigInt(r.amount), 0n)
  const confirmed = rows
    .filter((r) => r.status === 'confirmed')
    .reduce((sum, r) => sum + BigInt(r.amount), 0n)

  const view: KittyView = {
    kitty: toKitty(kitty),
    contributions: counted.map(toContribution),
    raisedTotal: raised.toString(),
    confirmedTotal: confirmed.toString(),
    contributorCount: new Set(counted.map((r) => r.from_addr)).size,
    isOrganizer: c.get('deviceId') === kitty.organizer_id,
  }
  return c.json(view)
})

app.post('/api/kitties/:id/contributions', async (c) => {
  const id = c.req.param('id')
  const kitty = await c.env.DB.prepare('SELECT * FROM kitties WHERE id = ?')
    .bind(id)
    .first<KittyRow>()
  if (!kitty) return fail('not_found', 'That Kitty does not exist', 404)
  if (kitty.settled_at) return fail('already_settled', 'This Kitty has already been paid out')

  const body = (await c.req.json().catch(() => null)) as RecordContributionRequest | null
  if (!body) return fail('validation', 'Invalid request body')

  const amount = parseBaseUnits(body.amount)
  if (!amount) return fail('validation', 'Invalid contribution amount')

  const txHash = clampText(body.txHash, 120)
  if (!txHash) return fail('validation', 'Missing transaction reference')

  const from = clampText(body.fromAddress, 100)
  if (!from || !isValidAddressFor(kitty.rail, from)) {
    return fail('validation', 'Invalid sender address')
  }

  const row = {
    kitty_id: id,
    tx_hash: txHash,
    from_addr: normaliseAddress(kitty.rail, from),
    amount: amount.toString(),
    display_name: clampText(body.displayName, 40),
    device_id: c.get('deviceId'),
    message: clampText(body.message, 140),
    created_at: now(),
  }

  try {
    // Recorded as `pending`; only chain verification promotes it to confirmed.
    await c.env.DB.prepare(
      `INSERT INTO contributions
         (kitty_id, tx_hash, from_addr, amount, display_name, device_id, message, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    )
      .bind(
        row.kitty_id, row.tx_hash, row.from_addr, row.amount,
        row.display_name, row.device_id, row.message, row.created_at,
      )
      .run()
  } catch (err) {
    // UNIQUE(kitty_id, tx_hash) — a retry or double-tap, not an error worth showing.
    if (String(err).includes('UNIQUE')) {
      return fail('duplicate', 'That contribution is already recorded')
    }
    throw err
  }

  return c.json({ ok: true }, 201)
})

app.post('/api/kitties/:id/settle', async (c) => {
  const id = c.req.param('id')
  const deviceId = c.get('deviceId')
  const kitty = await c.env.DB.prepare('SELECT * FROM kitties WHERE id = ?')
    .bind(id)
    .first<KittyRow>()
  if (!kitty) return fail('not_found', 'That Kitty does not exist', 404)
  if (kitty.organizer_id !== deviceId) {
    return fail('forbidden', 'Only the organizer can pay this Kitty out', 403)
  }
  if (kitty.settled_at) return fail('already_settled', 'This Kitty has already been paid out')

  const body = (await c.req.json().catch(() => null)) as SettleRequest | null
  const txHash = clampText(body?.txHash, 120)
  const settleTo = clampText(body?.settleTo, 100)
  if (!txHash || !settleTo || !isValidAddressFor(kitty.rail, settleTo)) {
    return fail('validation', 'Invalid payout details')
  }

  await c.env.DB.prepare(
    'UPDATE kitties SET settled_at = ?, settle_tx = ?, settle_to = ? WHERE id = ?',
  )
    .bind(now(), txHash, normaliseAddress(kitty.rail, settleTo), id)
    .run()

  return c.json({ ok: true })
})

/** Kitties created on this device, so a returning organizer finds their pots. */
app.get('/api/my/kitties', async (c) => {
  const deviceId = c.get('deviceId')
  if (!deviceId) return c.json({ kitties: [] })

  const { results } = await c.env.DB.prepare(
    'SELECT * FROM kitties WHERE organizer_id = ? ORDER BY created_at DESC LIMIT 30',
  )
    .bind(deviceId)
    .all<KittyRow>()
  return c.json({ kitties: (results ?? []).map(toKitty) })
})

/**
 * Top contributors. Ranked by number of distinct pots chipped into rather than
 * amount — the point is to celebrate showing up for your friends, and ranking
 * by size would just reward whoever has the most money.
 */
app.get('/api/leaderboard', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT display_name AS name,
            COUNT(*) AS contribution_count,
            COUNT(DISTINCT kitty_id) AS kitty_count
     FROM contributions
     WHERE status != 'failed' AND display_name IS NOT NULL AND display_name != ''
     GROUP BY LOWER(display_name)
     ORDER BY kitty_count DESC, contribution_count DESC
     LIMIT 20`,
  ).all<{ name: string; contribution_count: number; kitty_count: number }>()

  const entries: LeaderboardEntry[] = (results ?? []).map((r, i) => ({
    displayName: r.name,
    contributionCount: r.contribution_count,
    kittyCount: r.kitty_count,
    rank: i + 1,
  }))
  return c.json({ entries })
})

app.all('/api/*', () => fail('not_found', 'Unknown endpoint', 404))

/* ------------------------------------------------------------ sharing  */

/** Gather everything the share surfaces need, in one query pair. */
async function loadShareData(env: Env, id: string): Promise<ShareData | null> {
  const kitty = await env.DB.prepare('SELECT * FROM kitties WHERE id = ?').bind(id).first<KittyRow>()
  if (!kitty) return null

  const totals = await env.DB.prepare(
    `SELECT COALESCE(SUM(CAST(amount AS INTEGER)), 0) AS raised,
            COUNT(DISTINCT from_addr) AS people
     FROM contributions WHERE kitty_id = ? AND status != 'failed'`,
  )
    .bind(id)
    .first<{ raised: number; people: number }>()

  const chain = kitty.chain_id ? CHAINS[kitty.chain_id] : undefined
  return {
    id: kitty.id,
    title: kitty.title,
    note: kitty.note,
    emoji: kitty.emoji,
    raised: BigInt(totals?.raised ?? 0),
    target: BigInt(kitty.target_amount),
    decimals: kitty.rail === 'nim' ? 5 : (chain?.decimals ?? 6),
    symbol: kitty.rail === 'nim' ? 'NIM' : (chain?.tokenSymbol ?? 'USDT'),
    contributorCount: totals?.people ?? 0,
    settled: kitty.settled_at !== null,
  }
}

/** The pre-rendered brand card, used whenever generation cannot be trusted. */
async function staticCard(env: Env, req: Request): Promise<Uint8Array | null> {
  try {
    const res = await env.ASSETS.fetch(new URL('/og-default.png', req.url))
    if (!res.ok) return null
    return new Uint8Array(await res.arrayBuffer())
  } catch {
    return null
  }
}

/**
 * Progress bucket for the cache key.
 *
 * Keyed on 5% steps rather than the exact total so a busy pot does not
 * invalidate its card on every single contribution — that would mean a render
 * per contribution, and a crawler would almost always land on a cold cache.
 */
function progressBucket(data: ShareData): number {
  return Math.min(100, Math.floor(progressPct(data.raised, data.target) / 5) * 5)
}

/**
 * Cache key for a rendered card.
 *
 * Deliberately not the request URL: that URL is identical whatever the pot's
 * progress, so caching against it would pin the first card forever. Including
 * the bucket means the card refreshes as the pot fills, and `settled` is in
 * there because a paid-out Kitty draws differently at the same percentage.
 */
function ogCacheKey(origin: string, id: string, data: ShareData): Request {
  const bucket = progressBucket(data)
  const state = data.settled ? 's' : 'o'
  return new Request(`${origin}/__og-cache/${id}/${bucket}/${state}`)
}

type OgMode = 'upgraded' | 'static' | 'fallback' | 'generated'

function pngResponse(
  png: Uint8Array | ReadableStream | null,
  { mode, cacheSeconds }: { mode: OgMode; cacheSeconds: number },
): Response {
  return new Response(png as unknown as BodyInit, {
    headers: {
      'content-type': 'image/png',
      'cache-control': `public, max-age=${cacheSeconds}`,
      // Diagnostic, and documented in DEEPLINK-TEST.md Matrix E:
      //   upgraded  – the real per-Kitty card, served from cache
      //   static    – the CPU-safe pre-built card; a render has been queued
      //   fallback  – the pre-built card because something failed
      //   generated – a fresh render (only the internal ?render=1 path)
      'x-kitty-og': mode,
    },
  })
}

/**
 * Per-Kitty Open Graph image.
 *
 * Always PNG, always 200. Social clients refuse SVG and cache whatever they
 * first receive — including an error — so a failed render must still hand back
 * a valid image rather than a status code.
 *
 * `?fallback=1` forces the static path, which is how the test suite exercises
 * the failure branch without having to break the renderer.
 */
/**
 * Per-Kitty Open Graph image.
 *
 * ── The rule this route exists to enforce ─────────────────────────────────
 * The crawler-facing request **never rasterises anything**. It does at most two
 * I/O reads — the Kitty row and either a cache entry or a pre-built PNG — and
 * hands back bytes. Rasterising here would cost ~152 ms of CPU against a 10 ms
 * free-plan budget, and a CPU overrun is not catchable: Cloudflare kills the
 * isolate and the crawler gets error 1102, no image at all, cached hard by
 * every platform. That is strictly worse than a generic card.
 *
 * So: serve safe bytes now, and queue the real render as a *separate*
 * invocation (`?render=1`) whose only job is to fill the cache. If that
 * invocation dies for CPU — the normal case on the free plan — nothing is
 * cached, no request was harmed, and the static card keeps being served. With
 * CPU headroom it succeeds and the next request is upgraded to the real card.
 *
 * Query flags, both for tests rather than production:
 *   ?render=1   – do the render inline and cache it (the deferred path)
 *   ?fallback=1 – force the static path, to exercise the safety net
 */
app.get('/og/:file', async (c) => {
  const file = c.req.param('file')
  const id = file.replace(/\.(png|svg)$/, '')
  const url = new URL(c.req.url)
  const origin = url.origin

  // The SVG endpoint stays for in-app use and the growth kit, where SVG is fine.
  if (file.endsWith('.svg')) {
    const data = await loadShareData(c.env, id)
    if (!data) return c.notFound()
    return new Response(shareCardSvg(data), {
      headers: { 'content-type': 'image/svg+xml; charset=utf-8', 'cache-control': 'public, max-age=60' },
    })
  }

  const serveStatic = async (mode: OgMode, cacheSeconds: number) => {
    const bytes = await staticCard(c.env, c.req.raw)
    if (!bytes) return c.notFound()
    return pngResponse(bytes, { mode, cacheSeconds })
  }

  if (url.searchParams.get('fallback') === '1') {
    return serveStatic('fallback', 60)
  }

  const data = await loadShareData(c.env, id)
  if (!data) {
    // Unknown id: still a valid image, so a mistyped link degrades to the brand
    // card rather than a broken-image icon in someone's chat.
    return serveStatic('fallback', 300)
  }

  const cache = caches.default
  const key = ogCacheKey(origin, id, data)

  // ── The deferred render. A separate invocation with its own CPU budget, so
  //    a kill here can never touch a response already sent to a crawler.
  if (url.searchParams.get('render') === '1') {
    try {
      const { png, generated } = await renderOgPng(data, () => staticCard(c.env, c.req.raw))
      if (!generated) return pngResponse(png, { mode: 'fallback', cacheSeconds: 60 })

      // Only a genuinely generated card is ever cached — never a fallback, and
      // never a partial result, since a throw skips this entirely.
      const cached = pngResponse(png, { mode: 'upgraded', cacheSeconds: 600 })
      await cache.put(key, cached.clone())
      return pngResponse(png, { mode: 'generated', cacheSeconds: 600 })
    } catch {
      return serveStatic('fallback', 60)
    }
  }

  const hit = await cache.match(key)
  if (hit) return hit // the real per-Kitty card, already rendered

  // Cache miss: hand back safe bytes immediately, and ask a fresh invocation to
  // render in the background. waitUntil lets that outlive this response.
  c.executionCtx.waitUntil(
    fetch(`${origin}/og/${encodeURIComponent(id)}.png?render=1`).catch(() => undefined),
  )

  // Short TTL so a crawler that re-checks soon picks up the upgraded card.
  return serveStatic('static', 60)
})

/**
 * Serve the SPA shell for a Kitty with per-Kitty Open Graph tags baked in, so
 * the link unfurls with live progress when it lands in a group chat.
 */
app.get('/k/:id', async (c) => {
  const shell = await c.env.ASSETS.fetch(new URL('/index.html', c.req.url))
  if (!shell.ok) return shell

  const html = await shell.text()
  const data = await loadShareData(c.env, c.req.param('id'))
  if (!data) return c.html(html) // unknown id: let the app render its own empty state

  return c.html(injectMeta(html, data, c.req.url))
})

export default app
