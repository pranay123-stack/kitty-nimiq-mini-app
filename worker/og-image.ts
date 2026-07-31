/**
 * Per-Kitty Open Graph card, rendered to PNG in the Worker.
 *
 * Why PNG and not the SVG we had before: WhatsApp, Telegram, X and LinkedIn all
 * refuse SVG for `og:image`, so the previous card produced *no* preview image in
 * exactly the places Kitty links get shared. A link that unfurls with a live
 * progress bar is the whole growth loop.
 *
 * ── Why resvg alone, and no satori ────────────────────────────────────────
 * satori was the obvious choice and it does not work here. It bundles yoga's
 * Emscripten loader, which calls `WebAssembly.instantiate()` on raw bytes at
 * *module import time*. Workers refuse that outright — "Wasm code generation
 * disallowed by embedder" — so satori aborts before a request is ever served,
 * and its `init(module)` escape hatch runs too late to help.
 *
 * Since we compose the card ourselves anyway, the layout engine bought us
 * nothing: this file writes the SVG directly and hands it to resvg, which
 * rasterises text using font buffers we embed. That removes satori and yoga
 * from the bundle (~146 KB gzipped) and removes the failure entirely.
 *
 * ── The hard rule ─────────────────────────────────────────────────────────
 * This module never fails. Every path returns a valid PNG. A preview that 500s
 * or serves an SVG is worse than a generic card, because the crawler caches the
 * failure and will not come back for days.
 */

import { Resvg, initWasm } from '@resvg/resvg-wasm'
import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm'
import fontRegular from './assets/mulish-400.ttf'
import fontBold from './assets/mulish-800.ttf'
import { formatAmount, progressPct } from '../shared/money'
import { escapeXml, type ShareData } from './share'

const WIDTH = 1200
const HEIGHT = 630

/**
 * resvg's wasm is compiled by Wrangler at build time (the `CompiledWasm` rule)
 * and injected here — the one form of WebAssembly a Worker will accept.
 */
let wasmReady: Promise<void> | null = null
function ensureWasm(): Promise<void> {
  if (!wasmReady) {
    wasmReady = initWasm(resvgWasm as WebAssembly.Module).catch((err) => {
      // Let the next request retry rather than poisoning the isolate forever.
      wasmReady = null
      throw err
    })
  }
  return wasmReady
}

function fontBuffers(): Uint8Array[] {
  return [new Uint8Array(fontRegular), new Uint8Array(fontBold)]
}

/* ------------------------------------------------------------------ card */

function truncate(input: string, max: number): string {
  if (input.length <= max) return input
  const cut = input.slice(0, max)
  const space = cut.lastIndexOf(' ')
  return (space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd() + '…'
}

/**
 * Strip anything the subsetted font cannot draw.
 *
 * The subset covers Latin-1 and Latin Extended-A, which is what en/de/es need.
 * A title in Japanese, or containing emoji, would otherwise rasterise as blank
 * boxes — visibly broken, and worse than simply omitting those characters. If
 * nothing survives we fall back to a generic label rather than an empty card.
 */
export function toRenderableText(input: string, fallback: string): string {
  const cleaned = Array.from(input)
    .filter((ch) => {
      const c = ch.codePointAt(0) ?? 0
      return (
        (c >= 0x20 && c <= 0x7e) ||
        (c >= 0xa0 && c <= 0xff) ||
        (c >= 0x100 && c <= 0x17f) ||
        c === 0x2013 || c === 0x2014 || c === 0x2018 || c === 0x2019 ||
        c === 0x201c || c === 0x201d || c === 0x2026 || c === 0xb7 || c === 0x20ac
      )
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned || fallback
}

/** The card, as SVG. Deliberately plain shapes and text — resvg handles both. */
export function ogCardSvg(data: ShareData): string {
  const pct = Math.round(progressPct(data.raised, data.target))
  const raised = `${formatAmount(data.raised, data.decimals, { maxFrac: 2 })} ${data.symbol}`
  const target = `${formatAmount(data.target, data.decimals, { maxFrac: 2 })} ${data.symbol}`
  const title = escapeXml(truncate(toRenderableText(data.title, 'A Kitty'), 34))
  const people =
    data.contributorCount === 1 ? '1 person chipped in' : `${data.contributorCount} people chipped in`
  const complete = pct >= 100

  const trackX = 90
  const trackW = WIDTH - trackX * 2
  const fillW = pct === 0 ? 0 : Math.max(30, (Math.min(100, pct) / 100) * trackW)

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
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
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)"/>
  <circle cx="1120" cy="70" r="250" fill="#FC8702" opacity="0.07"/>
  <g font-family="Mulish">
    <text x="90" y="112" font-size="27" font-weight="400" fill="#FFFFFF" fill-opacity="0.55">Kitty · chip in together · ${escapeXml(data.symbol)}</text>
    <text x="90" y="228" font-size="72" font-weight="800" fill="#FFFFFF">${title}</text>
    <text x="90" y="300" font-size="36" font-weight="400" fill="#FFFFFF" fill-opacity="0.62">${escapeXml(raised)} of ${escapeXml(target)}</text>
    <rect x="${trackX}" y="352" width="${trackW}" height="30" rx="15" fill="#FFFFFF" fill-opacity="0.14"/>
    ${fillW > 0 ? `<rect x="${trackX}" y="352" width="${fillW.toFixed(1)}" height="30" rx="15" fill="url(#${complete ? 'done' : 'fill'})"/>` : ''}
    <!-- One text run with a tspan offset, rather than two elements at guessed
         x positions: the percentage's width varies with its digit count, and
         hand-tuned offsets collided at some values. -->
    <text x="90" y="474" font-size="60" font-weight="800" fill="#FFFFFF">${pct}%<tspan dx="24" font-size="32" font-weight="400" fill-opacity="0.62">${escapeXml(people)}</tspan></text>
    <text x="90" y="556" font-size="26" font-weight="400" fill="#FFFFFF" fill-opacity="0.42">${data.settled ? 'Paid out' : 'Open in Nimiq Pay to chip in'}</text>
  </g>
</svg>`
}

/* --------------------------------------------------------------- render */

export interface RenderResult {
  png: Uint8Array
  /** False when the static card was served because generation failed. */
  generated: boolean
}

/**
 * Render a Kitty's card, falling back to the static PNG on *any* failure —
 * including a slow render, because a crawler that times out caches nothing.
 */
export async function renderOgPng(
  data: ShareData,
  staticFallback: () => Promise<Uint8Array | null>,
  opts: { timeoutMs?: number } = {},
): Promise<RenderResult> {
  const timeoutMs = opts.timeoutMs ?? 8000

  try {
    const png = await withTimeout(generate(data), timeoutMs)
    return { png, generated: true }
  } catch (err) {
    console.error('OG render failed, serving static card:', err)
    const fallback = await staticFallback().catch(() => null)
    if (!fallback) throw err
    return { png: fallback, generated: false }
  }
}

async function generate(data: ShareData): Promise<Uint8Array> {
  await ensureWasm()
  const resvg = new Resvg(ogCardSvg(data), {
    fitTo: { mode: 'width', value: WIDTH },
    font: {
      fontBuffers: fontBuffers(),
      defaultFontFamily: 'Mulish',
      loadSystemFonts: false, // a Worker has none, and looking wastes time
    },
  })
  const rendered = resvg.render()
  const png = rendered.asPng()
  rendered.free()
  return png
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`OG render exceeded ${ms}ms`)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}

export const OG_WIDTH = WIDTH
export const OG_HEIGHT = HEIGHT
