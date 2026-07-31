/**
 * Share surfaces: rich link previews and a visual share card.
 *
 * This exists for one reason: a Kitty link gets pasted into a group chat. If it
 * unfurls as a bare URL, nobody taps it. If it unfurls as "Weekend in Lisbon —
 * 62% there, 8 people chipped in", people tap it. That difference is the whole
 * growth loop.
 */

import { formatAmount, progressPct } from '../shared/money'

export interface ShareData {
  id: string
  title: string
  note: string | null
  emoji: string
  raised: bigint
  target: bigint
  decimals: number
  symbol: string
  contributorCount: number
  settled: boolean
}

/** Escape for use in XML/HTML text and attributes. */
export function escapeXml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** Trim to a sane length without cutting mid-word where avoidable. */
function truncate(input: string, max: number): string {
  if (input.length <= max) return input
  const slice = input.slice(0, max)
  const lastSpace = slice.lastIndexOf(' ')
  return (lastSpace > max * 0.6 ? slice.slice(0, lastSpace) : slice).trimEnd() + '…'
}

export function shareDescription(data: ShareData): string {
  const pct = Math.round(progressPct(data.raised, data.target))
  const raised = `${formatAmount(data.raised, data.decimals, { maxFrac: 2 })} ${data.symbol}`
  const target = `${formatAmount(data.target, data.decimals, { maxFrac: 2 })} ${data.symbol}`

  if (data.settled) return `Paid out — ${raised} raised by ${data.contributorCount} people.`

  const who =
    data.contributorCount === 0
      ? 'Be the first to chip in.'
      : data.contributorCount === 1
        ? '1 person has chipped in.'
        : `${data.contributorCount} people have chipped in.`

  return `${pct}% there — ${raised} of ${target}. ${who}`
}

/**
 * Inject per-Kitty Open Graph tags into the built index.html.
 *
 * We rewrite the shipped HTML rather than server-render the app: the SPA still
 * boots exactly as it does everywhere else, and only the crawler-facing tags
 * change.
 */
export function injectMeta(html: string, data: ShareData, url: string): string {
  const title = `${data.emoji} ${truncate(data.title, 60)} — Kitty`
  const description = truncate(shareDescription(data), 160)

  // A per-Kitty PNG. It has to be PNG: WhatsApp, Telegram, X and LinkedIn all
  // refuse SVG for og:image, so the SVG card this used to point at produced no
  // preview image at all in exactly the places Kitty links get shared. The
  // endpoint always answers with a valid PNG — falling back to the static brand
  // card rather than erroring — because crawlers cache whatever they first get.
  const image = `${new URL(url).origin}/og/${data.id}.png`

  const tags = [
    `<title>${escapeXml(title)}</title>`,
    `<meta name="description" content="${escapeXml(description)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="Kitty" />`,
    `<meta property="og:title" content="${escapeXml(title)}" />`,
    `<meta property="og:description" content="${escapeXml(description)}" />`,
    `<meta property="og:url" content="${escapeXml(url)}" />`,
    `<meta property="og:image" content="${escapeXml(image)}" />`,
    `<meta property="og:image:type" content="image/png" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="${escapeXml(`${truncate(data.title, 60)} — ${shareDescription(data)}`)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escapeXml(title)}" />`,
    `<meta name="twitter:description" content="${escapeXml(description)}" />`,
    `<meta name="twitter:image" content="${escapeXml(image)}" />`,
  ].join('\n    ')

  // Drop the static tags the template ships with so we don't emit duplicates.
  return html
    .replace(/<title>[\s\S]*?<\/title>/, '')
    .replace(/<meta name="description"[^>]*>/, '')
    .replace(/<meta property="og:[^>]*>/g, '')
    .replace(/<meta name="twitter:[^>]*>/g, '')
    .replace('</head>', `  ${tags}\n  </head>`)
}

/**
 * The visual share card. Rendered as SVG because a Worker has no rasterizer and
 * pulling in one would cost more than the entire app — this renders crisply
 * in-app and in any browser.
 */
export function shareCardSvg(data: ShareData): string {
  const pct = Math.round(progressPct(data.raised, data.target))
  const raised = `${formatAmount(data.raised, data.decimals, { maxFrac: 2 })} ${data.symbol}`
  const target = `${formatAmount(data.target, data.decimals, { maxFrac: 2 })} ${data.symbol}`
  const title = escapeXml(truncate(data.title, 42))
  const barWidth = Math.max(pct === 0 ? 0 : 24, (pct / 100) * 1008)

  const people =
    data.contributorCount === 1 ? '1 person chipped in' : `${data.contributorCount} people chipped in`

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-label="${title}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#2A2F5C"/><stop offset="0.55" stop-color="#1F2348"/><stop offset="1" stop-color="#161A35"/>
    </linearGradient>
    <linearGradient id="fill" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#E9B213"/><stop offset="1" stop-color="#FC8702"/>
    </linearGradient>
    <linearGradient id="done" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#21BCA5"/><stop offset="1" stop-color="#17D3B5"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <circle cx="1060" cy="120" r="240" fill="#FC8702" opacity="0.07"/>
  <g font-family="Mulish, -apple-system, Segoe UI, sans-serif">
    <text x="96" y="118" font-size="30" fill="#FFFFFF" opacity="0.55">🐱 Kitty · chip in together</text>
    <text x="96" y="236" font-size="76" font-weight="800" fill="#FFFFFF">${escapeXml(data.emoji)} ${title}</text>
    <text x="96" y="316" font-size="40" fill="#FFFFFF" opacity="0.62">${escapeXml(raised)} of ${escapeXml(target)}</text>
    <rect x="96" y="372" width="1008" height="34" rx="17" fill="#FFFFFF" opacity="0.14"/>
    <rect x="96" y="372" width="${barWidth}" height="34" rx="17" fill="url(#${pct >= 100 ? 'done' : 'fill'})"/>
    <text x="96" y="486" font-size="60" font-weight="800" fill="#FFFFFF">${pct}%</text>
    <text x="240" y="486" font-size="34" fill="#FFFFFF" opacity="0.62">${escapeXml(people)}</text>
    <text x="96" y="566" font-size="28" fill="#FFFFFF" opacity="0.42">${
      data.settled ? 'Paid out' : 'Open in Nimiq Pay to chip in'
    }</text>
  </g>
</svg>`
}
