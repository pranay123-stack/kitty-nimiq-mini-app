/**
 * UI check — drives the real app in a real browser with true mobile emulation.
 *
 * This exists because the interactive surfaces (bottom sheets, the wallet
 * error path, other locales, light mode) cannot be verified by loading a URL
 * and taking a picture. It also asserts no screen scrolls horizontally, which
 * is the failure a phone-sized WebView punishes hardest.
 *
 * Usage:  node scripts/ui-check.mjs [baseUrl] [outDir]
 * Requires the app to be running (npm run build && npm run dev:api).
 */
import puppeteer from 'puppeteer-core'
import { mkdir, writeFile } from 'node:fs/promises'

const BASE = process.argv[2] ?? 'http://127.0.0.1:8787'
const OUT = process.argv[3] ?? 'docs/screenshots'

const CHROME =
  process.env.CHROME_PATH ??
  ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(Boolean)

// iPhone 14-ish. A real mobile viewport, not a narrow desktop window.
const PHONE = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }

let failures = 0
const ok = (name) => console.log(`  PASS  ${name}`)
const bad = (name, detail) => {
  failures++
  console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
}

/** Horizontal overflow is the classic phone-layout bug; assert it everywhere. */
async function assertNoHScroll(page, label) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  if (scrollWidth > clientWidth + 1) {
    bad(`${label}: no horizontal scroll`, `scrollWidth ${scrollWidth} > ${clientWidth}`)
  } else {
    ok(`${label}: no horizontal scroll`)
  }
}

/** Every tappable control should clear the ~44px comfortable-touch floor. */
async function assertTapTargets(page, label) {
  const small = await page.evaluate(() => {
    const bad = []
    for (const el of document.querySelectorAll('button, a[href], input, select, textarea')) {
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue // hidden
      if (r.height < 40) {
        bad.push(`${el.tagName.toLowerCase()}.${el.className || '-'} h=${Math.round(r.height)}`)
      }
    }
    return bad
  })
  if (small.length) bad(`${label}: tap targets ≥40px`, small.slice(0, 4).join(' | '))
  else ok(`${label}: tap targets ≥40px`)
}

async function shoot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png` })
}

async function seed() {
  const deviceId = 'ab'.repeat(32)
  const headers = { 'content-type': 'application/json', 'X-Device-Id': deviceId }
  const res = await fetch(`${BASE}/api/kitties`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      title: 'Weekend in Lisbon',
      note: 'Flights, hostel and one very good dinner.',
      emoji: '✈️',
      rail: 'nim',
      targetAmount: '100000000',
      payoutAddress: 'NQ27 1EE2 A5R4 LR8J QXVQ 0F4H STFD BV9M 8T7P',
      organizerName: 'Pranay',
    }),
  })
  const { kitty } = await res.json()

  const A = '0123456789ABCDEFGHJKLMNPQRSTUVXY'
  const mod97 = (s) => {
    let d = ''
    for (const c of s) d += c >= '0' && c <= '9' ? c : (c.charCodeAt(0) - 55).toString()
    let r = 0
    for (const ch of d) r = (r * 10 + Number(ch)) % 97
    return r
  }
  const addr = (seed) => {
    let body = ''
    for (let i = 0; i < 32; i++) body += A[(seed * (i + 7) * 31 + i * 13) % A.length]
    return `NQ${String(98 - mod97(body + 'NQ00')).padStart(2, '0')}${body}`
  }

  const people = [
    ['Maya', 'Cant wait for this!', '25000000'],
    ['Sam', null, '15000000'],
    ['Ines', 'Book the good restaurant', '12000000'],
    ['Tomas', 'in!', '8000000'],
  ]
  for (const [i, [name, message, amount]] of people.entries()) {
    await fetch(`${BASE}/api/kitties/${kitty.id}/contributions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        txHash: `local:ui${i}`,
        fromAddress: addr(i + 1),
        amount,
        displayName: name,
        ...(message ? { message } : {}),
      }),
    })
  }
  return { kitty, deviceId }
}

async function main() {
  await mkdir(OUT, { recursive: true })
  const { kitty, deviceId } = await seed()
  console.log(`\nSeeded Kitty ${kitty.id} (600 of 1 000 NIM, 4 contributors)\n`)

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--font-render-hinting=none'],
  })

  const open = async (path, { locale, scheme = 'dark', withDevice = true } = {}) => {
    const page = await browser.newPage()
    await page.setViewport(PHONE)
    if (locale) await page.setExtraHTTPHeaders({ 'Accept-Language': locale })
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }])
    if (locale) {
      await page.evaluateOnNewDocument((l) => {
        Object.defineProperty(navigator, 'language', { get: () => l })
        Object.defineProperty(navigator, 'languages', { get: () => [l] })
      }, locale)
    }
    if (withDevice) {
      await page.evaluateOnNewDocument((id) => {
        localStorage.setItem('kitty.device-id', id)
      }, deviceId)
    }
    await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle0' })
    await new Promise((r) => setTimeout(r, 700)) // let entry animations settle
    return page
  }

  console.log('Dark mode — core screens')
  for (const [path, name] of [
    ['/', 'home'],
    ['/create', 'create'],
    [`/k/${kitty.id}`, 'kitty'],
  ]) {
    const page = await open(path)
    await assertNoHScroll(page, name)
    await assertTapTargets(page, name)
    await shoot(page, name)
    await page.close()
  }

  console.log('\nLight mode')
  for (const [path, name] of [
    ['/', 'home-light'],
    [`/k/${kitty.id}`, 'kitty-light'],
    ['/create', 'create-light'],
  ]) {
    const page = await open(path, { scheme: 'light' })
    await assertNoHScroll(page, name)
    await shoot(page, name)
    await page.close()
  }

  console.log('\nContribute sheet (the core interaction)')
  {
    const page = await open(`/k/${kitty.id}`)
    const tapped = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) =>
        /chip in/i.test(b.textContent ?? ''),
      )
      if (!btn) return false
      btn.click()
      return true
    })
    if (!tapped) bad('contribute sheet opens', 'Chip in button not found')
    else {
      await new Promise((r) => setTimeout(r, 600))
      const visible = await page.$('.sheet')
      if (!visible) bad('contribute sheet opens', '.sheet not rendered')
      else {
        ok('contribute sheet opens')
        await assertNoHScroll(page, 'contribute sheet')
        await shoot(page, 'contribute')

        // Pick a suggested amount, then try to send with no wallet present.
        // The app must degrade to a readable message, not a crash.
        await page.evaluate(() => {
          const chip = document.querySelector('.chips .chip')
          chip?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        })
        await new Promise((r) => setTimeout(r, 300))
        await shoot(page, 'contribute-filled')

        await page.evaluate(() => {
          const send = [...document.querySelectorAll('.sheet button')].find((b) =>
            /send/i.test(b.textContent ?? ''),
          )
          send?.click()
        })
        // Generous: covers the provider-init timeout if the fast path ever regresses.
        await new Promise((r) => setTimeout(r, 6000))
        const errText = await page.evaluate(
          () => document.querySelector('.error-text')?.textContent ?? '',
        )
        if (/nimiq pay/i.test(errText)) ok(`no-wallet path explains itself ("${errText}")`)
        else bad('no-wallet path explains itself', `got "${errText}"`)
        await shoot(page, 'contribute-no-wallet')
      }
    }
    await page.close()
  }

  console.log('\nLocalisation')
  for (const [locale, name] of [
    ['de', 'kitty-de'],
    ['es', 'kitty-es'],
  ]) {
    const page = await open(`/k/${kitty.id}`, { locale })
    await assertNoHScroll(page, `kitty (${locale})`)
    const lang = await page.evaluate(() => document.documentElement.lang)
    if (lang === locale) ok(`document lang = ${locale}`)
    else bad(`document lang = ${locale}`, `got "${lang}"`)
    // Catch text that overflows its own box (German compounds are long).
    const clipped = await page.evaluate(() => {
      const out = []
      for (const el of document.querySelectorAll('button, .field__label, h1, h2, strong')) {
        if (el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0) {
          out.push(`${el.tagName}: ${(el.textContent ?? '').slice(0, 30)}`)
        }
      }
      return out
    })
    if (clipped.length) bad(`${locale}: no clipped text`, clipped.slice(0, 3).join(' | '))
    else ok(`${locale}: no clipped text`)
    await shoot(page, name)
    await page.close()
  }

  console.log('\nEmpty and error states')
  {
    const page = await open('/k/doesnotexist')
    const body = await page.evaluate(() => document.body.innerText)
    if (/couldn|find/i.test(body)) ok('unknown Kitty shows a real empty state')
    else bad('unknown Kitty shows a real empty state', body.slice(0, 60))
    await shoot(page, 'not-found')
    await page.close()
  }

  await browser.close()

  console.log(
    failures === 0
      ? `\nAll UI checks passed. Screenshots in ${OUT}/\n`
      : `\n${failures} UI check(s) failed.\n`,
  )
  process.exit(failures === 0 ? 0 : 1)
}

main().catch(async (err) => {
  console.error('ui-check crashed:', err)
  await writeFile('/tmp/ui-check-error.txt', String(err?.stack ?? err)).catch(() => {})
  process.exit(1)
})
