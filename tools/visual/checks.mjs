// Browser-measured checks over the VISUAL-01 acceptance surfaces: hit areas,
// the error state, the focus ring, the phone shell, the Sheet's focus
// contract and reduced motion. Development only.
//
//   node tools/visual/checks.mjs
//
// These are the claims a screenshot cannot settle and a source-text test
// cannot either, because they are computed styles and live interaction.
// Exits non zero if any check fails. Expects the harness to be serving.
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const BASE = process.env.HARNESS ?? 'http://localhost:5199'
const FONTS = path.resolve(fileURLToPath(new URL('../../node_modules/.visual-harness-fonts', import.meta.url)))
const manifest = existsSync(path.join(FONTS, 'manifest.json'))
  ? JSON.parse(await readFile(path.join(FONTS, 'manifest.json'), 'utf8'))
  : {}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium' })
const context = await browser.newContext()
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

const out = []
const check = (name, ok, detail = '') => out.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`)

const open = async (screen, width, opts = {}) => {
  const page = await context.newPage()
  if (opts.reducedMotion) await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width, height: 900 })
  await page.goto(`${BASE}/?screen=${screen}&theme=${opts.theme ?? 'light'}`, { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => document.fonts.ready)
  return page
}

/* ---- hit areas, the error state and the focus ring ---- */
{
  const page = await open('primitives', 1280)

  // A control's hit area is its ::after box wherever the visible box is
  // smaller, so measure the pseudo rather than probing points around the
  // control: a fixed probe offset falls inside or outside depending on how
  // much smaller the visible box is, which is how the first version of this
  // check reported three false failures.
  const hit = async (sel) => {
    await page.locator(sel).first().scrollIntoViewIfNeeded()
    return page.evaluate((s) => {
      const el = document.querySelector(s)
      if (!el) return null
      const r = el.getBoundingClientRect()
      const a = getComputedStyle(el, '::after')
      const px = (v) => (v.endsWith('px') ? parseFloat(v) : 0)
      return {
        box: Math.round(r.height),
        pseudo: a.content === 'none' ? null : { w: Math.round(px(a.width)), h: Math.round(px(a.height)) },
      }
    }, sel)
  }

  for (const [label, sel] of [
    ['chip', '.chip'],
    ['icon button', '.icon-btn'],
    ['small button', '.btn-sm'],
    ['toggle', '.toggle'],
    ['medium button', '.btn-primary'],
  ]) {
    const r = await hit(sel)
    const h = r ? Math.max(r.box, r.pseudo ? r.pseudo.h : 0) : 0
    const w = r && r.pseudo ? r.pseudo.w : 999
    check(`${label} reaches a 44px hit area`, h >= 44 && w >= 44, JSON.stringify(r))
  }

  const invalid = await page.evaluate(() => {
    const el = document.querySelector('input[aria-invalid="true"]')
    if (!el) return null
    const id = el.getAttribute('aria-describedby')
    return { border: getComputedStyle(el).borderTopColor, message: id && document.getElementById(id)?.textContent }
  })
  check(
    'an invalid field sets the danger border, a message and aria-describedby',
    !!invalid && invalid.border === 'rgb(198, 40, 40)' && !!invalid.message,
    JSON.stringify(invalid),
  )

  const ring = await page.evaluate(() => {
    const el = document.querySelector('.btn-primary')
    el.focus()
    const cs = getComputedStyle(el)
    return { width: cs.outlineWidth, colour: cs.outlineColor, offset: cs.outlineOffset }
  })
  check(
    'a focused button draws the shared ring',
    ring.width === '2px' && ring.colour === 'rgb(31, 67, 214)' && ring.offset === '2px',
    JSON.stringify(ring),
  )
  await page.close()
}

/* ---- the phone shell ---- */
{
  const page = await open('home', 390)
  const nav = await page.evaluate(() => {
    const a = document.querySelector('.bn-item.active')
    const cs = getComputedStyle(a)
    return { size: cs.fontSize, current: a.getAttribute('aria-current'), height: Math.round(a.getBoundingClientRect().height) }
  })
  check(
    'the bottom nav label is 12px, the item is 44px and the current one says so',
    nav.size === '12px' && nav.current === 'page' && nav.height >= 44,
    JSON.stringify(nav),
  )

  const toggle = await page.evaluate(() => {
    const t = document.querySelector('.mobile-topbar .toggle')
    return { role: t.getAttribute('role'), checked: t.getAttribute('aria-checked'), label: t.getAttribute('aria-label') }
  })
  check('the phone theme control is a labelled switch', toggle.role === 'switch' && !!toggle.label, JSON.stringify(toggle))

  const h1 = await page.evaluate(() => [...document.querySelectorAll('h1')].map((e) => e.textContent))
  check('the page title is the page\'s only h1', h1.length === 1, JSON.stringify(h1))
  await page.close()
}

/* ---- the Sheet's focus contract ---- */
{
  const page = await open('home', 390)
  await page.getByRole('button', { name: 'More', exact: true }).first().click()
  await page.waitForTimeout(200)
  check(
    'the sheet takes focus on open',
    await page.evaluate(() => !!document.querySelector('.more-sheet') && document.activeElement.classList.contains('more-sheet')),
  )
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
  const closed = await page.evaluate(() => ({
    gone: !document.querySelector('.more-sheet'),
    focused: document.activeElement.textContent.trim(),
  }))
  check('Escape closes the sheet and focus returns to the opener', closed.gone && closed.focused === 'More', JSON.stringify(closed))
  await page.close()
}

/* ---- reduced motion ---- */
{
  const page = await open('dialog', 1280, { reducedMotion: true })
  await page.waitForTimeout(200)
  const name = await page.evaluate(() => getComputedStyle(document.querySelector('.modal')).animationName)
  check('reduced motion removes the dialog entry animation', name === 'none', name)
  await page.close()
}

console.log(out.join('\n'))
await context.close()
await browser.close()
if (out.some((line) => line.startsWith('FAIL'))) process.exitCode = 1
