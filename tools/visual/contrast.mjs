// Measures the contrast of EVERY rendered text run on the acceptance
// surfaces, in both themes, at phone and desktop width. Development only.
//
//   node tools/visual/contrast.mjs
//
// This exists because the invariant test measures the token pairings it
// names, and a screenshot shows a colour without judging it. Neither can
// see a pairing nobody thought to write down: this found five text runs
// under their threshold that forty four invariant tests and the whole
// screenshot matrix had all passed.
//
// Two things its first version got wrong, both of which made it report
// failures that were not there. It measured mid transition, so a chip in
// the dark theme read as grey on grey; it runs under reduced motion now,
// which the stylesheet honours by collapsing every transition, so what it
// measures is the settled paint. And it walked past a gradient to the page
// behind it, so every hero and every striped placeholder was measured
// against a colour that is not there; a gradient now contributes each of
// its colour stops as a candidate ground and the worst is reported.
//
// Exits non zero on a run that fails. Two categories are reported without
// failing, each for a stated reason rather than as a list of instances:
// an inactive control, which WCAG 1.4.3 exempts, and a frozen
// classification hue, which this wave has no power to move.
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { assertServingCurrentBuild } from './fresh.mjs'

const BASE = process.env.HARNESS ?? 'http://localhost:5199'
await assertServingCurrentBuild(BASE)
const FONTS = path.resolve(fileURLToPath(new URL('../../node_modules/.visual-harness-fonts', import.meta.url)))
if (!existsSync(path.join(FONTS, 'manifest.json'))) {
  console.log('NO FONT CACHE: run node tools/visual/fetch-fonts.mjs first.')
  process.exit(1)
}
const manifest = JSON.parse(await readFile(path.join(FONTS, 'manifest.json'), 'utf8'))

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium' })
// Reduced motion is a real user setting and the stylesheet honours it, so
// measuring in it is measuring a state that ships, not a contrivance.
const context = await browser.newContext({ reducedMotion: 'reduce' })
await context.route(
  (url) => url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com',
  async (route) => {
    const file = manifest[route.request().url()]
    if (!file) return route.abort()
    await route.fulfill({
      body: await readFile(path.join(FONTS, file)),
      contentType: file.endsWith('.css') ? 'text/css' : 'font/woff2',
    })
  },
)

const SWEEP = `() => {
  const parse = (c) => {
    const m = c && c.match(/rgba?\\(([^)]+)\\)/)
    if (!m) return null
    const p = m[1].split(/[,\\s\\/]+/).filter(Boolean).map(Number)
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }
  }
  const stopsOf = (img) => (img.match(/rgba?\\([^)]+\\)/g) || []).map(parse).filter(Boolean)
  const over = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 })
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b) }
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05) }
  const hex = (c) => '#' + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')

  // Every ground the text could be painted on. A gradient contributes one
  // candidate per colour stop, so the worst case is measured rather than an
  // average that exists nowhere on the screen.
  const groundsOf = (el) => {
    const layers = []
    for (let n = el; n; n = n.parentElement) {
      const s = getComputedStyle(n)
      const bg = parse(s.backgroundColor)
      const img = s.backgroundImage && s.backgroundImage !== 'none' ? stopsOf(s.backgroundImage) : []
      if (img.length) layers.push({ kind: 'gradient', stops: img })
      if (bg && bg.a > 0) layers.push({ kind: 'color', c: bg })
      if ((bg && bg.a === 1) || (img.length > 0 && img.every((c) => c.a === 1))) break
    }
    const page = parse(getComputedStyle(document.documentElement).backgroundColor)
    let out = [page && page.a === 1 ? page : { r: 255, g: 255, b: 255, a: 1 }]
    for (let i = layers.length - 1; i >= 0; i--) {
      const l = layers[i]
      const next = []
      for (const g of out) {
        if (l.kind === 'color') next.push(over(l.c, g))
        else for (const c of l.stops) next.push(over(c, g))
      }
      out = next.slice(0, 24)
    }
    return out
  }

  const label = (el) => {
    const id = el.id ? '#' + el.id : ''
    const cls = typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\\s+/).slice(0, 3).join('.') : ''
    return el.tagName.toLowerCase() + id + cls
  }

  // The hues this wave may not move, read from the document rather than
  // copied here, so renaming one cannot leave a stale literal behind.
  // A custom property comes back as authored, so these are hex strings
  // rather than rgb(); reading them with the rgb parser matched nothing and
  // reported every classification label as a failure.
  const root = getComputedStyle(document.documentElement)
  const frozen = ['--c-technical', '--c-physical', '--c-social', '--c-psych', '--m-video', '--m-youtube', '--m-image', '--m-pdf']
    .map((k) => root.getPropertyValue(k).trim().toLowerCase())
    .filter((v) => /^#[0-9a-f]{6}$/.test(v))

  const rows = []
  for (const el of document.querySelectorAll('body *')) {
    if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue
    if (el.closest('.sr-only') || el.closest('[aria-hidden="true"]')) continue
    const r = el.getBoundingClientRect()
    if (r.width < 2 || r.height < 2) continue
    const s = getComputedStyle(el)
    if (s.visibility === 'hidden' || s.display === 'none') continue
    const base = parse(s.color)
    if (!base) continue
    // opacity multiplies down the tree and applies to the text itself
    let o = 1
    for (let n = el; n && n !== document.body; n = n.parentElement) o *= parseFloat(getComputedStyle(n).opacity)
    const fg = { ...base, a: base.a * o }
    const size = parseFloat(s.fontSize), weight = parseInt(s.fontWeight, 10) || 400
    const large = size >= 24 || (size >= 18.66 && weight >= 700)
    let worst = null
    for (const g of groundsOf(el)) {
      const cand = { fg: over(fg, g), bg: g, ratio: ratio(over(fg, g), g) }
      if (!worst || cand.ratio < worst.ratio) worst = cand
    }
    rows.push({
      sel: label(el), text: el.textContent.trim().slice(0, 44),
      disabled: !!(el.disabled || el.getAttribute('aria-disabled') === 'true' || el.closest('[disabled]')),
      frozen: frozen.includes(hex(fg).toLowerCase()),
      fg: hex(worst.fg), bg: hex(worst.bg), size, weight,
      ratio: Math.round(worst.ratio * 100) / 100, need: large ? 3 : 4.5,
    })
  }
  return rows
}`

const SCREENS = ['home', 'sessions', 'login', 'dialog', 'primitives', 'players']
// Which capability variants a screen renders, and which of its own states are
// worth measuring. Registered players carries the destructive dialog, whose
// confirm button label is the pairing VISUAL-00 measured at 3.34:1, so it is
// opened here rather than left to a screenshot.
const CAPS_FOR = (screen) =>
  screen === 'home' || screen === 'sessions' || screen === 'players' ? ['coach', 'viewer', 'parent'] : ['na']
const STATES_FOR = (screen) => (screen === 'players' ? ['default', 'error', 'archived', 'empty', 'withdrawn'] : ['default'])

const failed = [], exempt = [], frozen = []
const seen = new Set()

for (const screen of SCREENS) {
  for (const theme of ['light', 'dark']) {
    for (const w of [390, 1280]) {
      for (const caps of CAPS_FOR(screen)) {
       for (const state of STATES_FOR(screen)) {
        // The states only vary what a coach sees; a member with no write and
        // a member with no access render the same thing in every one of them.
        if (state !== 'default' && caps !== 'coach') continue
        const page = await context.newPage()
        await page.setViewportSize({ width: w, height: 1400 })
        const q = new URLSearchParams({ screen, theme })
        if (caps !== 'na') q.set('caps', caps)
        if (state !== 'default') q.set('state', state)
        await page.goto(`${BASE}/?${q}`, { waitUntil: 'domcontentloaded' })
        await page.evaluate(() => document.fonts.ready)
        await page.waitForTimeout(400)
        if (screen === 'home' && w === 390 && caps === 'coach') {
          const more = page.locator('button', { hasText: /^More$/ })
          if (await more.count()) { await more.first().click(); await page.waitForTimeout(300) }
        }
        if (screen === 'login') {
          await page.getByRole('button', { name: /magic link/i }).first().click().catch(() => {})
          await page.waitForTimeout(300)
        }
        // The selection bar and the destructive dialog, driven through the
        // real controls, so their labels are measured on the fills they
        // actually sit on rather than assumed from a token pairing.
        if (screen === 'players' && state === 'default' && caps === 'coach') {
          const select = page.getByRole('button', { name: 'Select players', exact: true })
          if (await select.count()) {
            await select.click()
            await page.waitForTimeout(200)
            const all = page.getByRole('button', { name: /^Select all \d+ shown$/ })
            if (await all.count()) {
              await all.click()
              await page.waitForTimeout(150)
              const del = page.getByRole('button', { name: /^Delete \d+ players?$/ })
              if (await del.count()) {
                await del.click()
                await page.waitForTimeout(300)
                // Type the phrase so the confirm button is measured ARMED:
                // a disabled control is exempt from 1.4.3 and would be
                // recorded rather than judged, which would quietly skip the
                // one label this screen exists to check.
                const field = page.getByLabel(/^To confirm, type/)
                if (await field.count()) {
                  const title = await page.locator('.modal h3, .modal h2').first().textContent().catch(() => '')
                  const n = (title || '').match(/\d+/)
                  if (n) await field.fill(`DELETE ${n[0]} PLAYERS`)
                  await page.waitForTimeout(200)
                }
              }
            }
          }
        }
        const rows = await page.evaluate('(' + SWEEP + ')()')
        for (const r of rows) {
          if (r.ratio >= r.need) continue
          // Size and weight are part of the key, because label() emits a
          // bare tag for an unclassed element and two different text runs
          // that share a tag and a computed colour would otherwise collapse
          // into one line. That is not only a reporting nicety: it is how a
          // card's new date line hid behind the meta line above it, both
          // rendering as `span` in the same colour at different sizes.
          const key = `${r.sel}|${r.fg}|${r.bg}|${r.size}|${r.weight}|${theme}`
          if (seen.has(key)) continue
          seen.add(key)
          const row = { ...r, where: `${screen}/${caps}/${state}/${theme}/${w}w` }
          ;(r.disabled ? exempt : r.frozen ? frozen : failed).push(row)
        }
        await page.close()
       }
      }
    }
  }
}

const line = (f) => `${String(f.ratio).padStart(5)}:1 need ${f.need}  ${f.where}  ${f.sel}  ${f.fg} on ${f.bg}  ${f.size}px/${f.weight}  "${f.text}"`
const by = (a, b) => a.ratio - b.ratio
if (exempt.length) console.log(`recorded, inactive controls are exempt from WCAG 1.4.3:\n${exempt.sort(by).map(line).join('\n')}\n`)
if (frozen.length) console.log(`recorded, a frozen classification hue this wave may not move:\n${frozen.sort(by).map(line).join('\n')}\n`)
for (const f of failed.sort(by)) console.log('FAIL  ' + line(f))
console.log(`${failed.length} text runs below their threshold`)
await browser.close()
process.exitCode = failed.length > 0 ? 1 : 0
