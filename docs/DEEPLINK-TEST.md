# Deeplink test matrix

> ## ⚠️ STATUS: UNVERIFIED — awaiting a phone
>
> **Nothing in the matrix below has been tested.** Whether a `nimiqpay://` link survives a given
> chat app is the one thing that cannot be checked from a build machine: it depends on that app's
> link parser, its in-app browser, and the OS handler registration — none of which exist in a
> headless browser.
>
> What *has* been automatically tested is everything on our side of the line: the web fallback
> renders a full read-only Kitty in a plain mobile browser, both links are emitted on every share,
> and the browser branch offers two working routes forward. See "What is already verified" at the
> bottom.
>
> Fill in the Result column after deploying. Anything that fails is a distribution problem, not a
> code problem — the fallback already covers it.

---

## Before you start

1. Deploy and run `./scripts/verify-deploy.sh <url>` until it passes.
2. Run `./scripts/verify-deploy.sh --write-urls <url>` so the links below are real.
3. Create one real Kitty and note its id.
4. Have **two** phones if possible — one iOS, one Android. Failing that, test one and mark the
   other `NOT TESTED` rather than assuming.
5. Install Nimiq Pay on the test phone. Then, for the "app absent" rows, use a second device
   *without* it (or uninstall temporarily).

## The two links

Replace `<BASE>` with your deployed origin and `<ID>` with a real Kitty id.

```
WEB (always works, always share this)
https://<BASE>/k/<ID>

DEEPLINK (opens straight into Nimiq Pay)
nimiqpay://miniapp?url=https%3A%2F%2F<BASE>%2Fk%2F<ID>
```

> The `url` parameter is percent-encoded by the app. Paste it exactly as the Share button produces
> it — hand-typing an unencoded `?url=https://…` is a different string and may parse differently.

---

## Matrix A — the web link (this is the one you actually promote)

Paste **only** the `https://` link into each app and tap it from the recipient side.

| # | OS | App | Expected | Result |
|---|---|---|---|---|
| A1 | iOS | WhatsApp | Rich preview card with title + live % · tap → opens Kitty read-only in WhatsApp's in-app browser · branch offers "Open in Nimiq Pay" | ☐ |
| A2 | iOS | Telegram | Preview card · tap → in-app browser → read-only Kitty + branch | ☐ |
| A3 | iOS | iMessage | Preview card · tap → Safari → read-only Kitty + branch | ☐ |
| A4 | iOS | SMS | Plain tappable link → Safari → read-only Kitty + branch | ☐ |
| A5 | Android | WhatsApp | Preview card · tap → in-app browser → read-only Kitty + branch | ☐ |
| A6 | Android | Telegram | Preview card · tap → in-app browser → read-only Kitty + branch | ☐ |
| A7 | Android | Messages (RCS/SMS) | Tappable link → Chrome → read-only Kitty + branch | ☐ |

**A-row failure is serious.** The https link is the backbone of distribution. If a preview card
doesn't render, check `docs/GROWTH-KIT.md` → OG notes; if the page doesn't load, re-run
`verify-deploy.sh`.

## Matrix B — the raw deeplink (nice to have, expected to be patchy)

Paste **only** the `nimiqpay://` link.

| # | OS | App | Expected | Known risk | Result |
|---|---|---|---|---|---|
| B1 | iOS | WhatsApp | Nimiq Pay opens directly on the Kitty | Custom schemes are usually **not auto-linkified** — likely shows as untappable grey text | ☐ |
| B2 | iOS | Telegram | Nimiq Pay opens | Telegram linkifies `http(s)` and `tg://`; other schemes often stay plain text | ☐ |
| B3 | iOS | iMessage | Nimiq Pay opens | iMessage generally linkifies `http(s)` only | ☐ |
| B4 | iOS | SMS | Nimiq Pay opens | Same as B3 | ☐ |
| B5 | Android | WhatsApp | Nimiq Pay opens | Same linkification limit; Android may also show a chooser | ☐ |
| B6 | Android | Telegram | Nimiq Pay opens | As B2 | ☐ |
| B7 | Android | Messages | Nimiq Pay opens | As B4 | ☐ |

**B-row failure is expected and already handled.** This is precisely why the share action emits both
links and why the web page carries the branch. Record the result so the growth kit can stop
promising something that doesn't work — do not treat it as a bug to fix in the app.

## Matrix C — the in-app "Open in Nimiq Pay" button

Open the **web** link, then tap the blue **Open in Nimiq Pay** button in the branch.

| # | Context | App installed? | Expected | Result |
|---|---|---|---|---|
| C1 | iOS Safari | yes | Hands off to Nimiq Pay, lands on this Kitty | ☐ |
| C2 | iOS Safari | no | Stays put; "Nothing happened?" appears with a **Get Nimiq Pay** link | ☐ |
| C3 | iOS WhatsApp in-app browser | yes | May be blocked by the webview — see note | ☐ |
| C4 | Android Chrome | yes | Hands off to Nimiq Pay | ☐ |
| C5 | Android Chrome | no | "Nothing happened?" + Get Nimiq Pay | ☐ |
| C6 | Android WhatsApp in-app browser | yes | May be blocked — see note | ☐ |

> **Note on C3/C6 — a known limitation, stated honestly.** A custom scheme fails *silently* when it
> can't resolve; there is no callback telling us it failed. We infer failure from "the page is still
> visible ~1.2s later". Inside an in-app browser that blocks the scheme, the user **does** have
> Nimiq Pay but still sees the "Nothing happened?" hint. That is a false positive we cannot
> eliminate, so the copy names both causes and tells them to open the page in Safari/Chrome first.
> If C3/C6 fail, the recovery path is correct even though the diagnosis is ambiguous.

## Matrix D — the share button itself

From inside Nimiq Pay, open a Kitty and tap **Share Kitty**.

| # | Check | Expected | Result |
|---|---|---|---|
| D1 | OS share sheet opens | Native sheet, not a copy toast | ☐ |
| D2 | Shared message contains **both** links | `nimiqpay://…` in the body, `https://…` as the link | ☐ |
| D3 | Recipient sees a preview card | Title, emoji, live % | ☐ |
| D4 | Sharing to WhatsApp preserves the deeplink text | May be stripped — record it | ☐ |
| D5 | Clipboard fallback (share sheet unavailable) | Both links copied | ☐ |

---

## If a row fails

| Failure | Meaning | Action |
|---|---|---|
| A-row preview card missing | OG tags not reaching the crawler | `curl -s <url>/k/<id> \| grep og:` — if empty, `run_worker_first` is misconfigured |
| A-row page blank | SPA or API broken | Re-run `verify-deploy.sh` |
| B-row not tappable | Chat app didn't linkify a custom scheme | **Expected.** Record it; the web link covers it |
| C-row false "Nothing happened?" | In-app browser blocked the scheme | Expected; copy already explains it |
| D2 missing a link | Share payload regression | `npm run test:ui` — the dual-link assertions should catch it |

## What is already verified (machine-tested, `npm run test:ui`)

These are the parts that don't need a phone, and they all pass:

- The fallback branch renders in a plain mobile browser at 390×844
- Both **Open in Nimiq Pay** and **Continue in browser (view-only)** are present, ≥40px tap targets
- The Kitty renders **read-only** in a browser: title, progress bar, percentage, contributor list
- The dock CTA becomes the hand-off rather than an action that could only fail
- With a provider present, the branch and view-only badge disappear and the CTA returns to "Chip in"
- Every share emits the `nimiqpay://` deeplink **and** the `https://` fallback, with the https link
  in the `url` field so the target app builds its preview from it
- No horizontal scroll, and no clipped text in `de` or `es`

**Not verified by anything above:** whether any given chat app linkifies, strips, or opens the
`nimiqpay://` scheme. That is what this document is for.
