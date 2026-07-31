#!/usr/bin/env bash
#
# verify-deploy.sh — prove a live Kitty deployment actually works.
#
# Written on the assumption that a step was skipped. Each check names the exact
# remedy rather than just failing, because "something is wrong" is useless at
# the point you are staring at a fresh URL.
#
#   ./scripts/verify-deploy.sh https://kitty.you.workers.dev
#   ./scripts/verify-deploy.sh --write-urls https://kitty.you.workers.dev
#
# Exit codes: 0 = all passed, 1 = a check failed, 2 = bad usage.

set -uo pipefail

WRITE_URLS=0
BASE=""

while [ $# -gt 0 ]; do
  case "$1" in
    --write-urls) WRITE_URLS=1; shift ;;
    -h|--help)
      sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) BASE="$1"; shift ;;
  esac
done

if [ -z "$BASE" ]; then
  echo "usage: $0 [--write-urls] https://your-worker.workers.dev" >&2
  exit 2
fi

BASE="${BASE%/}"
case "$BASE" in
  https://*) ;;
  http://127.0.0.1*|http://localhost*) ;;
  *) echo "error: URL must start with https:// (got '$BASE')" >&2; exit 2 ;;
esac

RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; DIM=$'\033[2m'; OFF=$'\033[0m'
PASS=0; FAIL=0; WARN=0

ok()   { PASS=$((PASS+1)); printf "  ${GREEN}PASS${OFF}  %s\n" "$1"; }
warn() { WARN=$((WARN+1)); printf "  ${YELLOW}WARN${OFF}  %s\n" "$1"; [ $# -gt 1 ] && printf "        ${DIM}%s${OFF}\n" "$2"; }
bad()  { FAIL=$((FAIL+1)); printf "  ${RED}FAIL${OFF}  %s\n" "$1"; [ $# -gt 1 ] && printf "        ${DIM}→ %s${OFF}\n" "$2"; }

need() { command -v "$1" >/dev/null 2>&1 || { echo "error: '$1' is required but not installed" >&2; exit 2; }; }
need curl
need python3

# A 64-char hex device id. Real ones come from Nimiq Pay; the API only checks shape.
DEVICE_ID="$(printf 'ab%.0s' $(seq 1 32))"
# Checksum-valid Nimiq address (mod-97 verified) used as the throwaway payout target.
NQ="NQ27 1EE2 A5R4 LR8J QXVQ 0F4H STFD BV9M 8T7P"

get()  { curl -sS --max-time 20 "$@" 2>/dev/null; }
code() { curl -sS --max-time 20 -o /dev/null -w '%{http_code}' "$@" 2>/dev/null; }

echo
echo "Verifying ${BASE}"
echo

# ---------------------------------------------------------------- 1. the SPA
echo "1. Static app"

STATUS="$(code "$BASE/")"
if [ "$STATUS" = "200" ]; then ok "GET / → 200"
else bad "GET / → $STATUS" "Deployment missing or not public. Re-run: npm run deploy"; fi

HTML="$(get "$BASE/")"
if printf '%s' "$HTML" | grep -q 'id="root"'; then ok "index.html contains the app root"
else bad "index.html has no #root" "The SPA never built. Run: npm run build && npm run deploy"; fi

BUNDLE="$(printf '%s' "$HTML" | grep -oE '/assets/[A-Za-z0-9._-]+\.js' | head -1)"
if [ -n "$BUNDLE" ]; then
  if [ "$(code "$BASE$BUNDLE")" = "200" ]; then ok "JS bundle is served ($BUNDLE)"
  else bad "JS bundle 404s ($BUNDLE)" "dist/ was stale at deploy. Run: npm run build && npm run deploy"; fi
else
  bad "no JS bundle referenced in index.html" "Run: npm run build && npm run deploy"
fi

if [ "$(code "$BASE/og-default.png")" = "200" ]; then ok "static OG image is served"
else bad "/og-default.png 404s" "public/og-default.png missing from the build"; fi

# ------------------------------------------------------------------ 2. API up
echo
echo "2. API"

HEALTH="$(get "$BASE/api/health")"
if printf '%s' "$HEALTH" | grep -q '"ok":true'; then ok "/api/health responds"
else bad "/api/health did not return ok" "Worker not running. Got: $(printf '%s' "$HEALTH" | head -c 120)"; fi

if printf '%s' "$HEALTH" | grep -q '<!doctype\|<html'; then
  bad "/api/* is being served the HTML page" "run_worker_first is missing from [assets] in wrangler.toml"
fi

CHAINS="$(get "$BASE/api/chains")"
CHAIN_N="$(printf '%s' "$CHAINS" | python3 -c 'import sys,json
try: print(len(json.load(sys.stdin).get("chains",[])))
except Exception: print(0)' 2>/dev/null)"
if [ "$CHAIN_N" = "6" ]; then ok "/api/chains returns 6 chains"
else bad "/api/chains returned $CHAIN_N chains (expected 6)" "Worker bundle incomplete. Redeploy."; fi

if [ "$(code "$BASE/api/definitely-not-a-route")" = "404" ]; then ok "unknown /api route → 404"
else warn "unknown /api route did not 404"; fi

# -------------------------------------------- 3. D1 write path (the big one)
echo
echo "3. Database (this is the step people skip)"

CREATE="$(curl -sS --max-time 25 -X POST "$BASE/api/kitties" \
  -H "X-Device-Id: $DEVICE_ID" -H 'content-type: application/json' \
  -d "{\"title\":\"🔧 deploy smoke test\",\"emoji\":\"🔧\",\"rail\":\"nim\",\"targetAmount\":\"100000\",\"payoutAddress\":\"$NQ\"}" 2>/dev/null)"

KID="$(printf '%s' "$CREATE" | python3 -c 'import sys,json
try: print(json.load(sys.stdin)["kitty"]["id"])
except Exception: print("")' 2>/dev/null)"

if [ -n "$KID" ]; then
  ok "created a Kitty on live D1 (id: $KID)"
else
  bad "could not create a Kitty" "The remote schema was never applied. Run: npm run db:remote"
  printf "        ${DIM}response: %s${OFF}\n" "$(printf '%s' "$CREATE" | head -c 200)"
fi

if [ -n "$KID" ]; then
  CONTRIB="$(curl -sS --max-time 20 -X POST "$BASE/api/kitties/$KID/contributions" \
    -H 'content-type: application/json' \
    -d "{\"txHash\":\"local:smoketest\",\"fromAddress\":\"$NQ\",\"amount\":\"25000\",\"displayName\":\"Smoke test\"}" 2>/dev/null)"
  if printf '%s' "$CONTRIB" | grep -q '"ok":true'; then ok "recorded a contribution"
  else bad "could not record a contribution" "response: $(printf '%s' "$CONTRIB" | head -c 160)"; fi

  VIEW="$(get "$BASE/api/kitties/$KID")"
  RAISED="$(printf '%s' "$VIEW" | python3 -c 'import sys,json
try: print(json.load(sys.stdin)["raisedTotal"])
except Exception: print("?")' 2>/dev/null)"
  if [ "$RAISED" = "25000" ]; then ok "read back the correct total (25000 base units)"
  else bad "total read back as '$RAISED', expected 25000" "Read path or reconciliation is broken"; fi

  CONFIRMED="$(printf '%s' "$VIEW" | python3 -c 'import sys,json
try: print(json.load(sys.stdin)["confirmedTotal"])
except Exception: print("?")' 2>/dev/null)"
  if [ "$CONFIRMED" = "0" ]; then
    ok "fake contribution stayed unconfirmed (chain verification is live)"
  else
    bad "a fake tx was marked confirmed (got $CONFIRMED)" "Verification is not running — money could be paid out against unverified rows"
  fi

  # Ownership: a caller with no device id must not be able to settle.
  SETTLE_CODE="$(curl -sS --max-time 20 -o /dev/null -w '%{http_code}' -X POST "$BASE/api/kitties/$KID/settle" \
    -H 'content-type: application/json' \
    -d "{\"txHash\":\"local:x\",\"settleTo\":\"$NQ\"}" 2>/dev/null)"
  if [ "$SETTLE_CODE" = "403" ]; then ok "non-organizer cannot settle (403) — origin scoping enforced"
  else bad "non-organizer settle returned $SETTLE_CODE, expected 403" "Ownership check is broken; anyone could mark a pot paid out"; fi

  if [ "$(code "$BASE/api/kitties/zzzzzzzz")" = "404" ]; then ok "unknown Kitty → 404"
  else warn "unknown Kitty did not 404"; fi
fi

# ------------------------------------------------------- 4. sharing surfaces
echo
echo "4. Sharing"

if [ -n "$KID" ]; then
  # The web fallback is what a stripped deeplink lands on, so it must be solid.
  if [ "$(code "$BASE/k/$KID")" = "200" ]; then ok "web fallback /k/<id> → 200"
  else bad "web fallback /k/<id> did not return 200" "Shared links will dead-end"; fi

  KPAGE="$(get "$BASE/k/$KID")"

  if printf '%s' "$KPAGE" | grep -q 'og:title'; then ok "/k/<id> injects Open Graph tags"
  else bad "/k/<id> has no og:title" "run_worker_first must include \"/k/*\" in wrangler.toml"; fi

  OGURL="$(printf '%s' "$KPAGE" | grep -oE 'property="og:url" content="[^"]+"' | sed 's/.*content="//;s/"$//')"
  case "$OGURL" in
    "$BASE"/k/*) ok "og:url matches the deployed origin" ;;
    "") warn "og:url not found" ;;
    *) bad "og:url is '$OGURL', not under $BASE" "Shared links will point at the wrong host" ;;
  esac

  if printf '%s' "$KPAGE" | grep -qE 'og:description" content="[^"]*%'; then
    ok "og:description carries live progress"
  else
    warn "og:description has no percentage" "Link previews lose their hook"
  fi

  OGIMG_CT="$(curl -sS --max-time 20 -o /dev/null -w '%{content_type}' "$BASE/og/$KID.png" 2>/dev/null)"
  OGIMG_CODE="$(code "$BASE/og/$KID.png")"
  if [ "$OGIMG_CODE" = "200" ]; then
    case "$OGIMG_CT" in
      image/png*) ok "per-Kitty OG image is image/png" ;;
      *) bad "OG image content-type is '$OGIMG_CT'" "Social clients only render PNG/JPEG" ;;
    esac
  else
    warn "/og/<id>.png returned $OGIMG_CODE" "Falling back to the static card"
  fi
fi

# --------------------------------------------- 5. placeholders left in build
echo
echo "5. Placeholders"

if printf '%s' "$HTML" | grep -qE '<your-worker>|REPLACE_WITH|example\.workers\.dev'; then
  bad "served HTML still contains a placeholder" "Rebuild and redeploy"
else
  ok "no placeholders in the served HTML"
fi

DOC_HITS=0
if [ -f README.md ]; then
  DOC_HITS="$(grep -rl '<your-worker>\|<link>' README.md docs/*.md 2>/dev/null | wc -l | tr -d ' ')"
fi
if [ "$DOC_HITS" = "0" ]; then
  ok "docs contain no unfilled URL placeholders"
elif [ "$WRITE_URLS" = "1" ]; then
  python3 - "$BASE" <<'PY'
import re, sys, pathlib
base = sys.argv[1]
files = ['README.md', 'docs/GROWTH-KIT.md', 'docs/SUBMISSION.md']
changed = 0
for f in files:
    p = pathlib.Path(f)
    if not p.exists():
        continue
    text = original = p.read_text()
    text = text.replace('https://<your-worker>.workers.dev', base)
    text = text.replace('<your-worker>.workers.dev', base.replace('https://', ''))
    # Launch-post link markers: "Try it: <link>", "👉 <link>", "Live: <link>"
    text = re.sub(r'(?<![\w<])<link>(?![\w>])', base, text)
    if text != original:
        p.write_text(text)
        changed += 1
        print(f'        rewrote {f}')
print(f'        {changed} file(s) updated')
PY
  ok "--write-urls: documentation placeholders replaced with $BASE"
else
  warn "$DOC_HITS doc file(s) still contain <your-worker> or <link>" \
       "Fix with: ./scripts/verify-deploy.sh --write-urls $BASE"
fi

# ------------------------------------------------------------------ summary
echo
echo "────────────────────────────────────────────"
if [ "$FAIL" -eq 0 ]; then
  printf "  ${GREEN}ALL CHECKS PASSED${OFF}  (%d passed, %d warnings)\n" "$PASS" "$WARN"
  echo
  echo "  Your Mini App URL:"
  echo "    $BASE"
  echo "  Share deeplink:"
  echo "    nimiqpay://miniapp?url=$BASE"
  if [ -n "${KID:-}" ]; then
    echo
    echo "  Throwaway Kitty created by this script: $BASE/k/$KID"
    echo "  Remove it with:"
    echo "    npx wrangler d1 execute kitty-db --remote \\"
    echo "      --command \"DELETE FROM kitties WHERE title LIKE '%deploy smoke test%';\""
  fi
  echo "────────────────────────────────────────────"
  exit 0
else
  printf "  ${RED}%d CHECK(S) FAILED${OFF}  (%d passed, %d warnings)\n" "$FAIL" "$PASS" "$WARN"
  echo "  Fix the items marked → above, then run this again."
  echo "────────────────────────────────────────────"
  exit 1
fi
