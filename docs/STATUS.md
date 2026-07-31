# Kitty — consolidated status

Covers all four hardening phases. Written 2026-07-31, before deploy.

- **Repo:** https://github.com/pranay123-stack/kitty-nimiq-mini-app (public, MIT)
- **Target:** Nimiq Mini Apps Competition, **Cycle II — Aug 10 → Sep 4 2026**
- **Automated checks:** 91 passing — 6 on-chain, 46 UI, 9 OG lifecycle, 30 deploy
- **Worker bundle:** 992.76 KiB gzipped against a 3072 KiB limit (68% free)
- **Values you must fill in:** exactly one (`database_id`)

---

> ## ✅ RESOLVED — Option C shipped
>
> The section below documents the investigation that led here. **The regression it describes is
> fixed**: the crawler-facing request no longer rasterises, so error 1102 can no longer happen on any
> plan. Kitty now degrades to a generic-but-valid card on free tier and auto-upgrades to per-Kitty
> cards wherever CPU headroom exists.
>
> | | Free plan | Paid plan ($5/mo) |
> |---|---|---|
> | 1st crawler request | valid generic card (`static`) | valid generic card (`static`) |
> | 2nd request onward | generic card | **per-Kitty card** (`upgraded`) |
> | Error 1102 | never | never |
>
> **The billing decision is yours and is not assumed anywhere.** Nothing in the code, config or docs
> requires the paid plan; it changes behaviour automatically if you take it. Measured cost of the
> synchronous path: **0.055 ms CPU, 182× under the free budget.**

---

## The investigation (retained for the record): why the OG image needed this treatment

**The per-Kitty Open Graph card cannot work on the Cloudflare free plan.** This was measured, not
estimated, and it changes a claim made at the end of Phase 3.

| | |
|---|---|
| Free-plan CPU limit | **10 ms** per invocation |
| One card render, measured | **97 ms wall / 152 ms CPU** (multi-threaded) |
| One-time WASM init, first request per isolate | **+78 ms CPU** |
| Verdict | **~10–15× over budget. The render can never complete on free tier.** |

### Three consequences, stated plainly

**1. The fallback does not save us on free tier.** Exceeding CPU **terminates the isolate**; it is
not a catchable error. The `try/catch` that serves the static card never runs. A crawler gets
Cloudflare **error 1102**, not a PNG.

> This corrects my Phase 3 report, which said "any failure still yields a valid PNG." That holds for
> catchable failures — a resvg throw, a WASM error, a timeout, an unknown id, all tested — but **not**
> for a CPU-limit kill. On free tier the result is *no preview image at all*, which is worse than the
> static card we had before Phase 3.

**2. The first impression is effectively permanent.** Every platform caches previews hard, keyed on
URL, and caches failures too. WhatsApp offers no per-user refresh. A Kitty that first unfurls with no
image keeps that until the platform's TTL lapses or you force a refresh via its debugger. Our own
Cache API only ever stores *successfully generated* responses, so we never pin a bad card ourselves —
but we cannot un-poison the platform's cache.

**3. Pre-warming does not fix it.** A pre-warm at Kitty-creation time runs in its own invocation,
which gets *the same* 10 ms. Caching the PNG in D1/KV has the same problem: both need one successful
render to populate, and on free tier there is never one. Reducing the render below 10 ms is not
available either — a 1200×630 raster is 756k pixels, and this needs a 10–15× cut, not a tune-up.

### Resolution — Option C, shipped

The crawler-facing request was split from the render:

- **Synchronous path** (what a crawler hits): reads the Kitty row, checks the cache, returns
  pre-built bytes. No rasterising. Its only CPU work is a 179 KB byte copy, measured at
  **0.055 ms — 182× under the 10 ms free budget**. It cannot overrun on any plan.
- **Deferred render**: a *separate* invocation (`?render=1`) triggered via `waitUntil`, with its own
  CPU budget, whose only job is to write to the cache. A kill there cannot affect a response already
  sent. Nothing is cached unless a render genuinely succeeded.
- **Cache key** includes a 5% progress bucket and the settled flag, so the card follows the pot as it
  fills rather than pinning the first render forever.

Still true, and still your call: **the paid plan is what makes per-Kitty cards actually appear.** It
is no longer a correctness requirement, only a quality upgrade, and it needs no code change.

### What is unaffected by any of this

Everything else works identically on free tier. The OG image is the only CPU-heavy path in the app —
all other routes are I/O bound (D1 reads, RPC fetches), and network time does not count toward CPU.

---

## What is built

| Phase | Delivered |
|---|---|
| **Core** | Non-custodial group pots on NIM + USDT; one `PaymentRail` interface; on-chain verification; live progress; contributor wall; settle flow; en/de/es; device-identifier leaderboard and anti-spam |
| **1 — Deploy** | [DEPLOY.md](../DEPLOY.md), [verify-deploy.sh](../scripts/verify-deploy.sh) (30 checks); removed `APP_BASE_URL` dead config |
| **2 — Deeplink** | Host detection; browser fallback branch that never dead-ends; dual-link sharing; [DEEPLINK-TEST.md](DEEPLINK-TEST.md) |
| **3 — OG images** | Per-Kitty PNG card via resvg + subsetted Mulish; static fallback; full meta tags |
| **5 — Option C** | Crawler path never rasterises (0.055 ms CPU); deferred render + bucketed cache; safe on every plan |
| **4 — This report** | Investigation above; consolidated status |

### Notable engineering decisions

- **The organizer's wallet *is* the pot.** Nimiq PoS has no general smart contracts, so escrow would
  have made the NIM rail permanently worse than USDT. Both rails behave identically instead, and the
  trust model is disclosed on the create screen rather than hidden.
- **The chain is the source of truth.** Contributions count only once independently re-verified
  against an RPC node. An unreachable RPC never fails a row — only positive contrary evidence does.
- **satori was removed, not added.** It bundles yoga's Emscripten loader, which calls
  `WebAssembly.instantiate()` on raw bytes at import time; Workers forbid that. Writing the SVG
  directly and rasterising with resvg removed 205 KiB and the whole failure mode.
- **No `APP_BASE_URL`.** Every origin is derived from the request, so there is nothing to misconfigure.

---

## Tested vs verified vs unverified

### ✅ Machine-tested — 91 automated checks

| Suite | Count | Covers |
|---|---|---|
| `npm run test:live` | 6 | Verification logic against **Nimiq mainnet**, not mocks. ERC-20 calldata decoding; confirm/fail/unknown outcomes |
| `npm run test:ui` | 46 | Real browser, true mobile emulation (390×844, touch) |
| `./scripts/verify-deploy.sh` | 30 | Live URL end to end |
| `npm run test:og` | 9 | OG lifecycle: safety on every path, deferred upgrade, fallbacks, bucket invalidation |
| `npm run typecheck` | — | App, worker and shared |

Highlights worth naming, because they encode the risky bits:

- A **rejection returned as `{error:{…}}`** reads as *cancelled*, never as success — the SDK footgun,
  tested end-to-end through the UI with a simulated provider.
- A **fake transaction stays unconfirmed**, so money can never be paid out against unverified rows.
- A **non-organizer settle returns 403**.
- **Every OG path** returns a valid 1200×630 PNG — cold cache, upgraded, forced failure and unknown
  id — so error 1102 cannot reach a crawler.
- A **fallback is never cached** as though it were a real card.
- **No horizontal scroll, ≥40px tap targets, no clipped `de`/`es` text** on every screen.

### 👁 Visually verified only (screenshots in `docs/screenshots/`)

Reviewed by eye, not asserted by a test: overall visual design and typography; the NIM card at 62%
and USDT card at 100%; light and dark themes; German and Spanish layouts; confetti and milestone
animations; the success screen.

### ❓ Unverified — needs a deployed URL and a phone

1. Whether any chat client linkifies, strips or opens `nimiqpay://` (expected to be patchy — most
   linkify `http(s)` only, which is exactly why both links are always emitted)
2. Whether each platform's crawler fetches, accepts and displays the OG image
3. Whether the deeplink hand-off works from in-app browsers
4. Device-identifier behaviour inside the real Nimiq Pay app
5. Real wallet approval flows against real funds on both rails

---

## 📋 Post-deploy checklist — everything only you can do

Work top to bottom.

### A. Deploy (see [DEPLOY.md](../DEPLOY.md))
- [ ] Decide the hostname **before launch** — device identifiers are origin-scoped, and moving domains
      later strands every existing organizer with no migration path
- [ ] `npx wrangler d1 create kitty-db` → paste `database_id` into `wrangler.toml` ← **the only fill-in**
- [ ] `npm run db:remote` (most commonly skipped step; without it every write fails)
- [ ] `npm run deploy`
- [ ] `./scripts/verify-deploy.sh <url>` → must print **ALL CHECKS PASSED**
- [ ] `./scripts/verify-deploy.sh --write-urls <url>` → clears all 11 doc placeholders
- [ ] **Decide the plan** — optional. Free works and previews never break; paid ($5/mo) turns on
      per-Kitty preview cards with no code change. Nothing assumes either.

### B. Device identifier — inside Nimiq Pay ([DEPLOY.md § origin scoping](../DEPLOY.md))
- [ ] Create a Kitty in Nimiq Pay → consent prompt appears once, showing your reason string
- [ ] Create a second → **no prompt** (per-origin cache working)
- [ ] Open the same Kitty in a normal browser → no **Pay out** button (no identifier, no ownership)

### C. Deeplinks — [DEEPLINK-TEST.md](DEEPLINK-TEST.md), Matrices A–D
- [ ] Matrix A — the **https** link across iOS/Android × WhatsApp/Telegram/iMessage/SMS. **A-row
      failures are serious**; this link is the backbone of distribution
- [ ] Matrix B — the raw `nimiqpay://` link. **Failures here are expected and already handled** —
      record them so the growth kit stops promising it
- [ ] Matrix C — the in-app "Open in Nimiq Pay" button, with and without the app installed
- [ ] Matrix D — the share sheet emits **both** links

### D. OG previews — [DEEPLINK-TEST.md](DEEPLINK-TEST.md), Matrix E
- [ ] `curl -sI <url>/og/<id>.png` → `image/png`, and check `x-kitty-og`:
      `generated` = real card, `static` = fell back (expected on free plan)
- [ ] Facebook Sharing Debugger, X Card Validator, LinkedIn Post Inspector, Telegram `@WebpageBot`
- [ ] Fill a pot further, re-check, confirm the percentage moved

### E. Real money, both rails
- [ ] One complete NIM pot including a real payout
- [ ] One complete USDT pot on a supported chain
- [ ] Decline a wallet dialog → must read "Cancelled", not an error
- [ ] Switch Nimiq Pay to German and Spanish and re-check

### F. Launch — [GROWTH-KIT.md](GROWTH-KIT.md)
- [ ] Recruit **8–10 people** to each start a real Kitty on day one (highest-leverage remaining action,
      and it is not code)
- [ ] Record the demo video — the two-phone cut matters more than production value
- [ ] Time the three launch posts to **~Aug 24**, when submissions go public for early-access testing
- [ ] Submit: 250-word description ([SUBMISSION.md](SUBMISSION.md)), repo link, demo URL

---

## Accuracy fix — done

`worker/og-image.ts` previously opened with *"This module never fails. Every path returns a valid
PNG."* That was false under CPU exhaustion. The header now states the truth: every *catchable* path
returns a valid PNG, a CPU-limit kill is not catchable, and therefore `renderOgPng()` is never called
on the request that answers a crawler.

---

## README accuracy

Re-checked against the shipped state. Accurate:

- **Trust model** — organizer holds the pot; non-custodial; no smart contract; disclosed in-app.
  Untouched since Phase 0 and still correct.
- **Limitations** — organizer is trusted; device id is per-device not per-person; NIM receipts may not
  be canonical hashes; silent custom-scheme failure; untested chat-app deeplink behaviour; OG card is
  Latin-only without emoji; preview rendering unverified.
- **Resolved and removed** — the old "og:image is a static card, not per-Kitty" caveat.

The README now also documents the shipped preview behaviour in a **Link previews** section: what the
crawler request does, the measured 0.055 ms synchronous cost, the deferred render, and the
`x-kitty-og` diagnostic. It states plainly that free tier serves a generic card and paid enables
per-Kitty cards — without assuming which you will choose.
