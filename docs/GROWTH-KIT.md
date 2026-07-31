# Kitty — Growth Kit

Everything needed to put real wallets into the app. Written for the **Nimiq Mini Apps Competition,
Cycle II (Aug 10 – Sep 4, 2026)**.

---

## The one timing fact everything hangs on

Submissions **go public at the start of Week 3** for early-access testing. For Cycle II that is
roughly **Mon 24 Aug**.

That is the only window where strangers can actually open your Mini App and chip in — and judging
weighs how many distinct wallets interact. So the plan is deliberately back-loaded:

| Phase | Dates | Goal |
|---|---|---|
| **Build & seed** | now → Aug 9 | App finished. Recruit 8–10 friends who will each start one real Kitty on day one. |
| **Week 1–2** | Aug 10 – Aug 23 | Quiet. Post build-in-public updates only. Do *not* spend the launch on a private app. |
| **Week 3 — LAUNCH** | Aug 24 – Aug 30 | All three posts go out. This is the spike. |
| **Week 4** | Aug 31 – Sep 4 | Momentum + a "here's what happened" results post. |

The single highest-leverage action: **have 8–10 people ready to create a real Kitty within an hour
of going public.** Each of those pots then recruits its own contributors. Ten seeded pots at five
contributors each is fifty wallets — from ten conversations you had in advance.

---

## Share assets

### In-app

- **Live share card, as a real PNG** — `GET /og/<kittyId>.png` renders a 1200×630 card carrying the
  pot's actual title, progress bar, percentage, currency and contributor count. This is what
  `og:image` points at, so it is what people *see* in the chat. Drop the URL straight into a post or
  a slide; it re-renders itself as the pot fills.
- **SVG version** — `GET /og/<kittyId>.svg`, same design, for in-app use and anywhere vector is
  preferable. Do **not** use it for `og:image`: every major social client refuses SVG there.
- **Static brand card** — [`public/og-default.png`](../public/og-default.png). Served automatically
  if generation ever fails, so a preview is never missing.
- **Rich link previews** — every `/k/<id>` link unfurls with the card above plus
  *"✈️ Weekend in Lisbon — Kitty · 62% there — 620 NIM of 1 000 NIM. 4 people have chipped in."*
  The live number is the reason people tap. That is the whole growth loop in one line.

> Preview images and text are cached hard by every platform — often for days, keyed on the URL. If
> you re-share the same Kitty after it fills up, the old percentage can persist. Force a refresh with
> the platform's own debugger (see [DEEPLINK-TEST.md](DEEPLINK-TEST.md), Matrix E) or share a link
> with a throwaway query string.

### Links to hand out

```
Web link       https://<your-worker>.workers.dev
Deeplink       nimiqpay://miniapp?url=https://<your-worker>.workers.dev
A Kitty        https://<your-worker>.workers.dev/k/<id>
```

Always post the **web link** publicly — it works for everyone and redirects the curious into Nimiq
Pay. Use the deeplink when you know the person already has Nimiq Pay installed.

---

## Demo video script (75 seconds)

Shoot on a real phone, portrait, inside Nimiq Pay. No voiceover needed — captions carry it. Keep the
wallet approval dialogs on screen; they are proof it is real.

| Time | On screen | Caption |
|---|---|---|
| 0:00–0:05 | Group chat: "so who's paying for the villa?" then 40 unread messages | *Every group has this chat.* |
| 0:05–0:12 | Open Nimiq Pay → Kitty. Tap **Start a Kitty**. | *One pot. One link.* |
| 0:12–0:24 | Type "Weekend in Lisbon", pick ✈️, target 1 000 NIM, tap **Use my wallet**, **Create**. | *Twelve seconds to set up.* |
| 0:24–0:30 | Tap **Share Kitty** → OS share sheet → send to a WhatsApp group. | *Share it where the group already is.* |
| 0:30–0:38 | Cut to a **second phone**. The link preview shows *"0% there — be the first."* Tap it. | *Your friends just tap the link.* |
| 0:38–0:52 | Tap **Chip in**, tap the `250` chip, **Send**. Nimiq Pay's native approval appears. Approve. | *Approve once. Done.* |
| 0:52–1:02 | Confetti, success screen, then cut back to **phone one** — the bar animates up on its own. | *Everyone watches it fill, live.* |
| 1:02–1:10 | Contributor wall with four names. Organizer taps **Pay out**. | *Then the organizer pays it out.* |
| 1:10–1:15 | End card: Kitty logo + web link + "Built on the Nimiq Pay Mini Apps Framework". | *Kitty. Chip in together.* |

**Do not skip:** the two-phone cut at 0:30. Seeing a second person's contribution move the first
person's bar is the entire product, and it is the one thing a screen recording of a single device
cannot convey.

---

## Launch posts

### 1. Skool community — the builder post

> **I built Kitty: a shared money pot for groups, on Nimiq Pay**
>
> Every group has the same broken ritual. One person pays for the villa / the leaving gift / the team
> lunch, then spends two weeks chasing seven people in a group chat and quietly eats the difference.
>
> Kitty replaces that with a link. You start a pot, set a target in NIM or USDT, and share it.
> Your friends open it in Nimiq Pay, tap once, and everyone watches it fill up live.
>
> A few decisions I'd genuinely like feedback on:
>
> **It's non-custodial with no smart contract.** Contributions go straight from each contributor's
> wallet to the organizer's address. Kitty never holds anyone's money. I went this way because Nimiq
> PoS has no general smart contracts, so building escrow would have meant the NIM version was worse
> than the USDT version forever. Instead both behave identically and the app says plainly on the
> create screen that you're trusting the organizer — same as a real kitty.
>
> **Every NIM contribution is stamped on chain.** Each one carries a `kitty:<id>` memo via
> `sendBasicTransactionWithData`, so a pot can be rebuilt from chain data alone. You don't have to
> trust my database. The server independently re-checks every contribution against an RPC node
> before it counts toward the payout total.
>
> Two things that cost me hours, in case they save you some: provider methods return
> `{error: {...}}` instead of throwing, so a plain try/catch reads a user rejection as success. And
> Nimiq's RPC wraps results as `{"result": {"data": ...}}`, so reading `result` directly silently
> breaks every verification.
>
> Live: <link> · Code (MIT): https://github.com/pranay123-stack/kitty-nimiq-mini-app
>
> **Start a real Kitty with it and tell me where it feels wrong.** I'd rather fix it this week than
> defend it later.

*Post Mon of Week 3, morning CET. Reply to every single comment within the hour.*

---

### 2. X / Twitter — the thread

> 1/ Splitting money in a group is still broken in 2026.
>
> One person pays. Then chases six people for three weeks. Then eats the difference.
>
> So I built Kitty — a shared money pot that lives inside @nimiq Pay. 🐱
>
> 2/ Start a pot for anything. Trip, gift, team lunch, tip jar.
>
> Set a target in NIM or USDT. Get one link. Share it.
>
> Your friends tap it, chip in, and the whole group watches it fill up live.
>
> [video]
>
> 3/ The part I like most:
>
> Kitty never touches your money. Contributions go straight from each wallet to the organizer's
> address. No contract, no escrow, nothing for me to freeze or lose.
>
> 4/ And every NIM contribution is stamped on chain with the pot's id.
>
> Which means the pot can be rebuilt from chain data alone. You don't have to trust my server —
> and my server doesn't trust the client either. It re-checks every payment against an RPC node.
>
> 5/ Built on the Nimiq Pay Mini Apps Framework. Open source, MIT.
>
> Try it: <link>
> Code: https://github.com/pranay123-stack/kitty-nimiq-mini-app
>
> Start a Kitty for something you're actually splitting this week and tell me what breaks. 👇

*Post Tue of Week 3. Quote-tweet it Thursday with a screenshot of the biggest real pot.*

---

### 3. Short social — Telegram / Discord / LinkedIn

> 🐱 **Kitty — chip in together**
>
> A shared money pot for groups, inside Nimiq Pay.
>
> Start a pot → share one link → everyone chips in and watches it fill live. NIM or USDT.
> Non-custodial: the money goes straight to the organizer, never through us.
>
> Zero to contributing in under a minute, no instructions needed.
>
> 👉 <link>
>
> Open source (MIT), built on the Nimiq Pay Mini Apps Framework.

*Cross-post Wed of Week 3. In Telegram/Discord, paste a live Kitty link rather than the homepage —
the preview showing "62% there" outperforms a generic landing page every time.*

---

## Seeding checklist

Do all of this **before** Aug 24.

- [ ] Recruit 8–10 people who will each start a **real** Kitty on launch day. Ask them individually,
      not in a group — individual asks convert far better.
- [ ] Give each of them a pre-written line to send their own group. Removing the "what do I say?"
      step is worth more than any amount of polish.
- [ ] Run one real end-to-end pot yourself, with a real payout, and screenshot it.
- [ ] Record the demo video with two real phones.
- [ ] Have three genuine use cases ready to name: a trip, a leaving gift, a creator tip jar.
- [ ] Confirm the deeplink opens correctly from WhatsApp, Telegram and iMessage on both iOS and
      Android. Test it on someone else's phone, not just yours.

## What to measure

Distinct contributing wallets is the number that matters — it is both the judging signal and the
honest measure of whether the loop works.

- Distinct wallets that contributed
- Kitties created, and how many got ≥3 contributors (a pot with one contributor did not spread)
- Share taps → opens → contributions (where the funnel actually leaks)
- Median time from first open to first contribution — the target is **under 60 seconds**
