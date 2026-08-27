// Drives Chromium over the VISUAL-00 acceptance matrix and writes one PNG per
// surface, width, theme and capability variant. Development only.
//
//   node tools/visual/shoot.mjs [outDir]
//
// Expects the harness to be serving: npx vite --config vite.visual.config.ts
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright-core'

const OUT = process.argv[2] ?? 'visual-shots'
const BASE = process.env.HARNESS ?? 'http://localhost:5199'
const EXE = process.env.CHROMIUM ?? '/opt/pw-browsers/chromium'

// The seven widths from Part 4, plus 900 where the breakpoint itself matters.
const WIDTHS = [360, 390, 430, 768, 1024, 1280, 1600]
const PHONE = [360, 390, 430, 768, 900]

const SHOTS = [
  // Home and Sessions in every capability variant they render.
  ...['home', 'sessions'].flatMap((screen) =>
    ['coach', 'viewer', 'parent'].flatMap((caps) =>
      WIDTHS.map((w) => ({ screen, caps, w })),
    ),
  ),
  // Login is outside the shell, so it has no capability variant.
  ...WIDTHS.map((w) => ({ screen: 'login', w })),
  // The More sheet only exists under the phone breakpoint, and only for a
  // member whose capability set fills the overflow.
  ...PHONE.map((w) => ({ screen: 'home', caps: 'coach', w, open: 'more' })),
  // A dialog at every width plus the 900px changeover, where a form dialog
  // becomes a bottom sheet.
  ...[...WIDTHS, 900].map((w) => ({ screen: 'dialog', w })),
  // Every primitive and state in one render.
  ...[390, 1280].map((w) => ({ screen: 'primitives', w })),
]

const name = (s, theme) =>
  [s.screen, s.caps ?? 'na', s.open ?? 'default', theme, `${s.w}w`].join('_') + '.png'

await mkdir(OUT, { recursive: true })
// An outbound HTTP proxy, when the environment has one, so the Google Fonts
// link resolves and the shots carry Archivo and Hanken Grotesk rather than a
// fallback stack. Without it every page also waits out a connection reset.
const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy
const browser = await chromium.launch({
  executablePath: EXE,
  ...(proxy ? { proxy: { server: proxy, bypass: 'localhost,127.0.0.1' } } : {}),
})
const context = await browser.newContext({ ignoreHTTPSErrors: true, deviceScaleFactor: 1 })
let failures = 0

for (const theme of ['light', 'dark']) {
  for (const s of SHOTS) {
    const page = await context.newPage()
    await page.setViewportSize({ width: s.w, height: 900 })
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    const q = new URLSearchParams({ screen: s.screen, theme })
    if (s.caps) q.set('caps', s.caps)
    await page.goto(`${BASE}/?${q}`, { waitUntil: 'domcontentloaded' })
    await page.evaluate(() => document.fonts.ready)
    await page.waitForTimeout(250)
    if (s.open === 'more') {
      const more = page.getByRole('button', { name: 'More', exact: true })
      if (await more.count()) {
        await more.first().click()
        await page.waitForTimeout(400)
      }
    }
    await page.screenshot({ path: `${OUT}/${name(s, theme)}`, fullPage: !s.open })
    if (errors.length) {
      failures++
      console.log(`ERROR ${name(s, theme)}: ${errors[0].slice(0, 160)}`)
    }
    await page.close()
  }
}

await context.close()
await browser.close()
console.log(`${SHOTS.length * 2} shots written to ${OUT}/, ${failures} with page errors`)
