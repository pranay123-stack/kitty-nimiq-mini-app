# Deploying Kitty

Copy-paste literal. Every command is run from the repo root.

**There is exactly one value you must edit by hand: `database_id` in `wrangler.toml`.**
Everything else — share links, the `nimiqpay://` deeplink, Open Graph URLs — is derived from the
request origin at runtime, so it cannot be misconfigured.

---

## ⚠️ Read this first: pick your hostname before you launch

The Mini App device identifier is **scoped per origin**. Kitty uses it to decide who may pay a Kitty
out. If you deploy on `kitty-x.workers.dev`, let people create Kitties, and *then* move to
`kitty.yourdomain.com`, every existing organizer gets a different identifier and **permanently loses
the ability to pay out the Kitties they already created.**

There is no migration for this — the identifier is derived host-side and we never see the input.

So: decide now whether you are launching on `*.workers.dev` or a custom domain. If there is any
chance you will want a custom domain, set it up **before** the first real Kitty exists.

---

## 0. Prerequisites

```bash
node --version     # must be 20 or newer
npx wrangler --version
npx wrangler login # opens a browser; skip if `wrangler whoami` already works
npx wrangler whoami
```

## 1. Install and confirm the build works locally

```bash
npm install
npm run typecheck
npm run build
```

If `npm run build` fails, stop. Deploying a broken build wastes a URL.

## 2. Create the D1 database

```bash
npx wrangler d1 create kitty-db
```

This prints a block like:

```
[[d1_databases]]
binding = "DB"
database_name = "kitty-db"
database_id = "a1b2c3d4-0000-0000-0000-abcdef123456"
```

## 3. ▶ Paste the id into `wrangler.toml`

Open `wrangler.toml` and replace **`REPLACE_WITH_YOUR_D1_DATABASE_ID`** with the `database_id` value
from step 2. Keep the quotes.

```toml
[[d1_databases]]
binding = "DB"
database_name = "kitty-db"
database_id = "a1b2c3d4-0000-0000-0000-abcdef123456"   # ← yours
```

Confirm you actually changed it:

```bash
grep database_id wrangler.toml
# must NOT print REPLACE_WITH_YOUR_D1_DATABASE_ID
```

## 4. Create the tables on the **remote** database

This is the single most commonly skipped step. Without it the app loads fine and every write fails.

```bash
npm run db:remote
```

Verify the tables exist:

```bash
npx wrangler d1 execute kitty-db --remote \
  --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
```

Expected: `contributions`, `kitties` (plus `sqlite_sequence`, `_cf_KV` — both normal).

> Re-running `npm run db:remote` **drops and recreates the tables**, deleting all Kitties. The schema
> begins with `DROP TABLE IF EXISTS`. Run it once at setup, and never again on a live deployment.

## 5. Deploy

```bash
npm run deploy
```

Wrangler prints your URL, e.g. `https://kitty.<your-subdomain>.workers.dev`. Copy it.

## 6. Verify the live deployment

```bash
./scripts/verify-deploy.sh https://kitty.<your-subdomain>.workers.dev
```

This is the real check. It exercises the SPA, the API, a full create→contribute→read round trip
against your live D1, the Open Graph tags, and the OG image — and fails loudly with a specific
remedy if anything is wrong. **Do not proceed until it prints `ALL CHECKS PASSED`.**

It creates one throwaway Kitty named `🔧 deploy smoke test`. That is harmless — a Kitty holds no
funds, it is only metadata until someone pays into it. Delete it if you like:

```bash
npx wrangler d1 execute kitty-db --remote \
  --command "DELETE FROM kitties WHERE title LIKE '%deploy smoke test%';"
```

## 7. Fill in your URL everywhere

Eight documentation placeholders still read `<your-worker>.workers.dev`, plus three `<link>` markers
in the launch posts. One command fixes all of them:

```bash
./scripts/verify-deploy.sh --write-urls https://kitty.<your-subdomain>.workers.dev
```

Then check nothing was missed:

```bash
grep -rn '<your-worker>\|<link>' README.md docs/*.md || echo "clean"
```

## 8. Commit and push

```bash
git add -A
git commit -m "Deploy: point docs at the live URL"
git push
```

---

## Post-deploy smoke test by hand

If you want to eyeball it rather than trust the script:

```bash
BASE=https://kitty.<your-subdomain>.workers.dev

# 1. SPA loads
curl -sI $BASE | head -1                       # HTTP/2 200

# 2. API is alive
curl -s $BASE/api/health                       # {"ok":true,"time":...}

# 3. Chain registry (proves the Worker bundle is complete)
curl -s $BASE/api/chains | head -c 120

# 4. D1 is migrated — this fails loudly if step 4 was skipped
curl -s -X POST $BASE/api/kitties \
  -H "X-Device-Id: $(printf 'ab%.0s' {1..32})" \
  -H 'content-type: application/json' \
  -d '{"title":"manual test","rail":"nim","targetAmount":"100000",
       "payoutAddress":"NQ27 1EE2 A5R4 LR8J QXVQ 0F4H STFD BV9M 8T7P"}'
# expect {"kitty":{...}}; a 500 means the remote schema was never applied

# 5. Static OG image is served
curl -sI $BASE/og-default.png | head -1        # HTTP/2 200
```

### Confirming device-identifier origin scoping

The identifier is issued by Nimiq Pay, scoped to your Mini App's origin, and is only obtainable
inside Nimiq Pay — so it cannot be checked with `curl`. What you *can* verify:

1. Open the deployed app inside Nimiq Pay and create a Kitty. The consent prompt appears once,
   showing your reason string.
2. Create a second Kitty. **No prompt this time** — that is the per-origin cache working.
3. Open the same Kitty in a normal mobile browser. You are *not* the organizer there: no **Pay out**
   button. That is correct — no identifier, no ownership.
4. Server-side, ownership is enforced in `POST /api/kitties/:id/settle`, which compares the
   `X-Device-Id` header against `kitties.organizer_id` and returns `403` on mismatch.
   `verify-deploy.sh` asserts that 403.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `D1_ERROR: no such table: kitties` | Step 4 skipped | `npm run db:remote` |
| Deploy fails: `Couldn't find a D1 DB with the id` | Step 3 not done, or id typo'd | Re-check `grep database_id wrangler.toml` |
| App loads, every action fails with 500 | Remote schema missing | `npm run db:remote` |
| `/api/*` returns the HTML page | `run_worker_first` missing from `[assets]` | Don't edit that block in `wrangler.toml` |
| Link previews show no image | Normal — `og:image` is the static PNG | See the OG notes in the README |
| Organizer lost the **Pay out** button | Origin changed, so the device id changed | Unrecoverable; see the hostname warning above |
| `wrangler d1 execute` asks to create a DB | `database_name` mismatch | Must stay `kitty-db` |

---

## What deploying does *not* set up

- **No secrets are required.** Kitty has no API keys, no signing keys and no custody. If you ever add
  one, use `npx wrangler secret put NAME` — never `[vars]`, which is world-readable in the dashboard.
- **No cron.** On-chain reconciliation runs lazily when someone reads a Kitty.
- **No custom domain.** If you want one, attach it in the Cloudflare dashboard *before* launch, for
  the origin-scoping reason above.
