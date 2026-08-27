// Drives Chromium over the VISUAL-00 acceptance matrix and writes one PNG per
// surface, width, theme and capability variant. Development only.
//
//   node tools/visual/shoot.mjs [outDir]
//
// Expects the harness to be serving: npx vite --config vite.visual.config.ts
import { mkdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
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
  // Login is outside the shell, so it has no capability variant. Its error
  // and info states are the Note primitive and the success treatment, and
  // they are driven rather than faked: pressing the magic link button with an
  // empty field is the real error path, and pressing it with one filled is
  // the real confirmation.
  ...WIDTHS.map((w) => ({ screen: 'login', w })),
  ...[390, 1280].flatMap((w) => [
    { screen: 'login', w, open: 'error' },
    { screen: 'login', w, open: 'info' },
  ]),
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
// No proxy and no outbound request: the only external resource the harness
// loads is the font stylesheet, and that is served from the cache below.
const browser = await chromium.launch({ executablePath: EXE })
const context = await browser.newContext({ ignoreHTTPSErrors: true, deviceScaleFactor: 1 })

// Google Fonts is not reachable from the browser in every environment, and a
// request that times out costs twelve seconds a page. Serve the cache that
// fetch-fonts.mjs wrote; with no cache, abort the request at once and say so,
// rather than shooting a hundred and thirty pages in a fallback typeface
// without noticing.
const FONTS = path.resolve(fileURLToPath(new URL('../../node_modules/.visual-harness-fonts', import.meta.url)))
const haveFonts = existsSync(path.join(FONTS, 'manifest.json'))
const manifest = haveFonts ? JSON.parse(await readFile(path.join(FONTS, 'manifest.json'), 'utf8')) : {}
// A predicate rather than a glob: a glob treats the ? that begins the css2
// query string as a single character wildcard, and the pattern silently
// matches nothing.
const isFont = (url) => url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com'
await context.route(isFont, async (route) => {
  const file = manifest[route.request().url()]
  if (!file) return route.abort()
  const body = await readFile(path.join(FONTS, file))
  await route.fulfill({ body, contentType: file.endsWith('.css') ? 'text/css' : 'font/woff2' })
})
console.log(haveFonts ? 'serving the local font cache' : 'NO FONT CACHE: shots use the fallback stack, run tools/visual/fetch-fonts.mjs')

let failures = 0
// Serving a cache is not the same as rendering in the right typeface: a stale
// or malformed cache produces a CSS decode error, which is a console message
// rather than a pageerror, and Chromium falls back silently. So the claim
// above is checked once against the browser, and a run that made it falsely
// fails rather than shipping a hundred and thirty six shots in the wrong face.
let fontsChecked = false
async function verifyFonts(page) {
  if (fontsChecked || !haveFonts) return
  fontsChecked = true
  const loaded = await page.evaluate(() =>
    [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family),
  )
  for (const family of ['Archivo', 'Hanken Grotesk']) {
    if (!loaded.includes(family)) {
      failures++
      console.log(`ERROR font cache served but ${family} did not load: [${loaded.join(', ')}]`)
    }
  }
}

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
    await verifyFonts(page)
    await page.waitForTimeout(250)
    if (s.open === 'more') {
      const more = page.getByRole('button', { name: 'More', exact: true })
      if (await more.count()) {
        await more.first().click()
        await page.waitForTimeout(400)
      }
    }
    if (s.open === 'error' || s.open === 'info') {
      if (s.open === 'info') await page.getByLabel('Email').fill('coach@example.invalid')
      await page.getByRole('button', { name: 'Email me a link' }).click()
      await page.waitForTimeout(300)
    }
    await page.screenshot({ path: `${OUT}/${name(s, theme)}`, fullPage: s.open !== 'more' })
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
// A crashed page produces a screenshot of a blank or half rendered surface,
// which is worse than no screenshot: it looks like evidence. Fail the run so a
// chained verification cannot accept it on the strength of a log line nobody
// read, the same way checks.mjs fails on a failed check.
if (failures > 0) process.exitCode = 1
