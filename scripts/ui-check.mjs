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
  // Randomised per run: Kitty rate-limits creation to 10 per device per hour,
  // so a fixed id makes the eleventh run of this suite die on an unrelated
  // error instead of testing anything.
  const deviceId = [...crypto.getRandomValues(new Uint8Array(32))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
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
  const created = await res.json()
  if (!created?.kitty?.id) {
    // Say what actually happened rather than throwing on undefined later.
    throw new Error(
      `Could not seed a Kitty (HTTP ${res.status}): ${JSON.stringify(created)}. ` +
        `Is the app running at ${BASE}?`,
    )
  }
  const { kitty } = created

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

  const open = async (
    path,
    { locale, scheme = 'dark', withDevice = true, insideNimiqPay = false, wallet = 'accept' } = {},
  ) => {
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
    if (insideNimiqPay) {
      // Stand in for the host injection. The app decides which branch to show
      // from the presence of these globals, exactly as it does in Nimiq Pay.
      // `wallet` selects how the fake provider answers a send:
      //   'reject' — returns {error:{...}} the way the real provider does when
      //              the user declines, which is the footgun worth testing
      //   'accept' — returns a serialized transaction string
      await page.evaluateOnNewDocument((walletMode) => {
        const ADDRESS = 'NQ27 1EE2 A5R4 LR8J QXVQ 0F4H STFD BV9M 8T7P'
        const send = async () =>
          walletMode === 'reject'
            ? { error: { type: 'REJECTED', message: 'User rejected the request' } }
            : 'aa'.repeat(96) // stand-in serialized transaction

        window.nimiqPay = {
          language: 'en',
          requestDeviceIdentifier: async () => 'cd'.repeat(32),
        }
        window.nimiq = {
          connected: true,
          connect: async () => undefined,
          disconnect: () => undefined,
          listAccounts: async () => [ADDRESS],
          isConsensusEstablished: async () => true,
          getBlockNumber: async () => 1,
          sendBasicTransaction: send,
          sendBasicTransactionWithData: send,
        }
      }, wallet)
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

  /** Open the sheet and select the first suggested amount. */
  const openSheetAndFill = async (page) => {
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('.dock button')].find((b) =>
        /chip in/i.test(b.textContent ?? ''),
      )
      btn?.click()
    })
    await new Promise((r) => setTimeout(r, 500))
    if (!(await page.$('.sheet'))) return false
    await page.evaluate(() => {
      document.querySelector('.chips .chip')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await new Promise((r) => setTimeout(r, 250))
    return true
  }

  const clickSend = async (page) => {
    await page.evaluate(() => {
      const send = [...document.querySelectorAll('.sheet button')].find((b) =>
        /send/i.test(b.textContent ?? ''),
      )
      send?.click()
    })
  }

  {
    const page = await open(`/k/${kitty.id}`, { insideNimiqPay: true, wallet: 'reject' })
    if (!(await openSheetAndFill(page))) {
      bad('contribute sheet opens', '.sheet not rendered after tapping Chip in')
    } else {
      ok('contribute sheet opens')

      const label = await page.evaluate(() => {
        const b = [...document.querySelectorAll('.sheet button')].find((x) =>
          /send/i.test(x.textContent ?? ''),
        )
        return (b?.textContent ?? '').trim()
      })
      if (/send\s+[\d\s.]+NIM/i.test(label)) ok(`amount chip fills the CTA ("${label}")`)
      else bad('amount chip fills the CTA', `CTA reads "${label}"`)

      await assertNoHScroll(page, 'contribute sheet')
      await shoot(page, 'contribute-filled')

      // The provider returns {error:{...}} rather than throwing when the user
      // declines. This asserts the unwrap() guard treats that as a cancellation
      // — not as success, and not as a red error.
      await clickSend(page)
      await new Promise((r) => setTimeout(r, 1500))

      const afterReject = await page.evaluate(() => ({
        error: document.querySelector('.error-text')?.textContent ?? '',
        sheetStillOpen: !!document.querySelector('.sheet'),
        wentToSuccess: /you chipped in/i.test(document.body.innerText),
      }))

      if (!afterReject.wentToSuccess) ok('declining does not fake a successful contribution')
      else bad('declining does not fake a successful contribution', 'success screen shown after a rejection')

      if (afterReject.error === '') ok('declining shows no error (cancel is not a failure)')
      else bad('declining shows no error', `got "${afterReject.error}"`)

      if (afterReject.sheetStillOpen) ok('declining leaves the sheet open to retry')
      else warn('sheet closed after a decline')
    }
    await page.close()
  }
  {
    // Happy path, end to end, with the wallet approving.
    const page = await open(`/k/${kitty.id}`, { insideNimiqPay: true, wallet: 'accept' })
    if (!(await openSheetAndFill(page))) {
      bad('approved contribution reaches the success screen', 'sheet did not open')
    } else {
      await clickSend(page)
      await new Promise((r) => setTimeout(r, 2500))

      const after = await page.evaluate(() => ({
        success: /you chipped in/i.test(document.body.innerText),
        share: [...document.querySelectorAll('button')].some((b) =>
          /share so it fills faster/i.test(b.textContent ?? ''),
        ),
        createOwn: [...document.querySelectorAll('button')].some((b) =>
          /start your own kitty/i.test(b.textContent ?? ''),
        ),
      }))

      if (after.success) ok('approved contribution reaches the success screen')
      else bad('approved contribution reaches the success screen')

      if (after.share) ok('success screen leads with sharing (the growth loop)')
      else bad('success screen leads with sharing')

      if (after.createOwn) ok('success screen offers "start your own"')
      else bad('success screen offers "start your own"')

      await assertNoHScroll(page, 'success screen')
      await shoot(page, 'success')
    }
    await page.close()
  }

  console.log('\nHost branch — plain browser vs Nimiq Pay')
  {
    // --- provider ABSENT: the web-fallback path a stripped deeplink lands on
    const page = await open(`/k/${kitty.id}`)

    const branch = await page.$('[data-testid="browser-branch"]')
    if (branch) ok('browser: fallback branch is shown')
    else bad('browser: fallback branch is shown', 'no [data-testid=browser-branch]')

    if (await page.$('[data-testid="view-only-badge"]')) ok('browser: view-only badge present')
    else bad('browser: view-only badge present')

    // Both routes out must exist — neither may dead-end.
    const labels = await page.evaluate(() =>
      [...document.querySelectorAll('button, a')].map((b) => (b.textContent ?? '').trim()),
    )
    if (labels.some((l) => /open in nimiq pay/i.test(l))) ok('browser: "Open in Nimiq Pay" offered')
    else bad('browser: "Open in Nimiq Pay" offered', labels.slice(0, 6).join(' | '))

    if (labels.some((l) => /continue in browser/i.test(l)))
      ok('browser: "Continue in browser" offered')
    else bad('browser: "Continue in browser" offered', labels.slice(0, 6).join(' | '))

    // The Kitty itself must still be readable — that is the whole point of the
    // fallback: a stripped deeplink still shows something worth acting on.
    const readable = await page.evaluate(() => {
      const text = document.body.innerText
      return {
        title: /Weekend in Lisbon/.test(text),
        progress: /%/.test(text),
        contributors: /Maya/.test(text) && /Sam/.test(text),
        bar: !!document.querySelector('[role="progressbar"]'),
      }
    })
    for (const [k, v] of Object.entries(readable)) {
      if (v) ok(`browser: Kitty ${k} renders read-only`)
      else bad(`browser: Kitty ${k} renders read-only`)
    }

    // The dock must not offer an action that can only fail without a wallet.
    const dock = await page.evaluate(
      () => document.querySelector('.dock')?.innerText ?? '',
    )
    if (/open in nimiq pay to chip in/i.test(dock)) ok('browser: dock CTA is the hand-off')
    else bad('browser: dock CTA is the hand-off', `dock reads "${dock.replace(/\n/g, ' / ')}"`)

    await assertNoHScroll(page, 'browser branch')
    await assertTapTargets(page, 'browser branch')
    await shoot(page, 'fallback-browser')
    await page.close()
  }
  {
    // --- provider PRESENT: full flow, no branch, no badge
    const page = await open(`/k/${kitty.id}`, { insideNimiqPay: true })

    if (!(await page.$('[data-testid="browser-branch"]'))) ok('nimiq pay: no fallback branch')
    else bad('nimiq pay: no fallback branch', 'branch shown inside the host app')

    if (!(await page.$('[data-testid="view-only-badge"]'))) ok('nimiq pay: no view-only badge')
    else bad('nimiq pay: no view-only badge')

    const dock = await page.evaluate(() => document.querySelector('.dock')?.innerText ?? '')
    if (/chip in/i.test(dock) && !/open in nimiq pay/i.test(dock))
      ok('nimiq pay: dock CTA is "Chip in"')
    else bad('nimiq pay: dock CTA is "Chip in"', `dock reads "${dock.replace(/\n/g, ' / ')}"`)

    await assertNoHScroll(page, 'nimiq pay view')
    await shoot(page, 'fallback-nimiqpay')
    await page.close()
  }

  console.log('\nDual-link sharing')
  {
    const page = await open(`/k/${kitty.id}`, { insideNimiqPay: true })
    // Capture what the app hands the OS share sheet, without a real share sheet.
    const shared = await page.evaluate(async () => {
      let captured = null
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: async (data) => {
          captured = data
        },
      })
      const btn = [...document.querySelectorAll('button')].find((b) =>
        /share kitty|kitty teilen|compartir/i.test(b.textContent ?? ''),
      )
      if (!btn) return { error: 'share button not found' }
      btn.click()
      await new Promise((r) => setTimeout(r, 400))
      return captured ?? { error: 'navigator.share was not called' }
    })

    if (shared?.error) {
      bad('share emits both links', shared.error)
    } else {
      const blob = `${shared.text ?? ''} ${shared.url ?? ''}`
      if (/nimiqpay:\/\/miniapp\?url=/.test(blob)) ok('share includes the nimiqpay:// deeplink')
      else bad('share includes the nimiqpay:// deeplink', blob.slice(0, 120))

      if (blob.includes(`${BASE}/k/${kitty.id}`)) ok('share includes the https web fallback')
      else bad('share includes the https web fallback', blob.slice(0, 120))

      if ((shared.url ?? '').startsWith('http'))
        ok('share url field is the https link (drives rich previews)')
      else bad('share url field is the https link', `url="${shared.url}"`)
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

    // These pages render in browser mode, so the fallback branch is on screen —
    // meaning the clipping check above covered its translated copy too. Assert
    // it explicitly rather than relying on that being obvious.
    if (await page.$('[data-testid="browser-branch"]')) {
      ok(`${locale}: fallback branch renders translated`)
    } else {
      bad(`${locale}: fallback branch renders translated`, 'branch missing from this page')
    }

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
