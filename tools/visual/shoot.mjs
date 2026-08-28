// Drives Chromium over the acceptance matrix the Design Read's Part 4 names,
// and writes one PNG per surface, width, theme, capability variant and state.
// Development only.
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

  /* ---- VISUAL-02, Registered players ---------------------------------
     The wave's primary acceptance surface, and the one that carries the two
     primitives VISUAL-01 defined and could not accept: the table with its
     card equivalent, and the badge. Part 4 names the table at 1280, the
     column drop at 1024 and the card list at 390 and 360, so the register
     is shot at every width in every capability variant it renders. */
  ...['coach', 'viewer', 'parent'].flatMap((caps) =>
    WIDTHS.map((w) => ({ screen: 'players', caps, w })),
  ),
  // The state matrix, at one phone width and one desktop width each. Every
  // one is the screen's own branch, reached through the query's own flags or
  // through the address the screen opens on, never drawn.
  ...['rowsloading', 'empty', 'error', 'archived', 'withdrawn'].flatMap((state) =>
    [390, 1280].map((w) => ({ screen: 'players', caps: 'coach', state, w })),
  ),
  // The page level gate (the seasons read), and the pre setup call to
  // action, which only a seasons.manage holder sees.
  ...[390, 1280].map((w) => ({ screen: 'players', caps: 'coach', state: 'loading', w })),
  ...[390, 1280].map((w) => ({ screen: 'players', caps: 'admin', state: 'noseason', w })),
  // Selection, in both layouts and across the breakpoint.
  ...[360, 390, 900, 1024, 1280].map((w) => ({ screen: 'players', caps: 'coach', w, open: 'select' })),
  // The destructive dialog, at 900 in both of its forms because 2.13 turns a
  // form dialog into a bottom sheet at and below that width.
  ...[360, 390, 900, 1280].map((w) => ({ screen: 'players', caps: 'coach', w, open: 'delete' })),
  // Its two refusals, each reached by the real path: a preview the server
  // answered with fewer live players than were asked about, and a selection
  // past the server's cap of 200.
  ...[390, 1280].map((w) => ({ screen: 'players', caps: 'coach', state: 'stale', w, open: 'delete' })),
  ...[390, 1280].map((w) => ({ screen: 'players', caps: 'coach', state: 'overlimit', w, open: 'delete' })),
]

const name = (s, theme) =>
  [s.screen, s.caps ?? 'na', s.state ?? 'default', s.open ?? 'default', theme, `${s.w}w`].join('_') + '.png'

// An overlay is shot at the viewport rather than full page: a full page shot
// of a dialog over a two hundred row register is a picture of the register.
const OVERLAY = new Set(['more', 'delete'])


// Every entry whose name claims a state must PROVE that state before its
// screenshot is filed. Without this the interaction can no-op and leave an
// ordinary page under a name that says otherwise, which is worse evidence
// than a missing file because it looks like proof. The selector is what the
// state actually renders, so a primitive that stops rendering fails here too.
const REACHED = {
  more: '.more-sheet',
  error: '.note-danger[role="alert"]',
  info: '.note-success[role="status"]',
  select: '.bulk-bar',
  delete: '.modal',
}

async function reached(page, s, theme) {
  const selector = REACHED[s.open]
  if (!selector) return true
  const ok = await page
    .waitForSelector(selector, { state: 'visible', timeout: 3000 })
    .then(() => true, () => false)
  if (!ok) {
    failures++
    console.log(`ERROR ${name(s, theme)}: ${selector} never appeared, so the ${s.open} state was not reached`)
  }
  return ok
}

await mkdir(OUT, { recursive: true })
// No proxy and no outbound request: the only external resource the harness
// loads is the font stylesheet, and that is served from the cache below.
const browser = await chromium.launch({ executablePath: EXE })
const context = await browser.newContext({ ignoreHTTPSErrors: true, deviceScaleFactor: 1 })

// Google Fonts is not reachable from the browser in every environment, and a
// request that times out costs twelve seconds a page. Serve the cache that
// fetch-fonts.mjs wrote; with no cache, abort the request at once and say so,
// rather than shooting the whole matrix in a fallback typeface
// without noticing.
const FONTS = path.resolve(fileURLToPath(new URL('../../node_modules/.visual-harness-fonts', import.meta.url)))
// No cache means every font request is aborted and every shot renders in a
// fallback typeface. These screenshots exist to verify a type scale, so that
// is a failed run rather than a degraded one, and it fails HERE rather than
// after writing the whole matrix as useless PNGs.
if (!existsSync(path.join(FONTS, 'manifest.json'))) {
  console.log('NO FONT CACHE: run `node tools/visual/fetch-fonts.mjs` first. These shots verify a type scale and cannot do that in a fallback face.')
  process.exit(1)
}
const manifest = JSON.parse(await readFile(path.join(FONTS, 'manifest.json'), 'utf8'))
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
console.log('serving the local font cache')

let failures = 0
// Serving a cache is not the same as rendering in the right typeface: a stale
// or malformed cache produces a CSS decode error, which is a console message
// rather than a pageerror, and Chromium falls back silently. So the claim
// above is checked once against the browser, and a run that made it falsely
// fails rather than shipping the whole matrix in the wrong face.
let fontsChecked = false
async function verifyFonts(page) {
  if (fontsChecked) return
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
    if (s.state) q.set('state', s.state)
    await page.goto(`${BASE}/?${q}`, { waitUntil: 'domcontentloaded' })
    await page.evaluate(() => document.fonts.ready)
    await verifyFonts(page)
    await page.waitForTimeout(250)
    if (s.open === 'more') {
      // The matrix only asks for this with the coach capability set, where
      // the button must exist; a parent legitimately has no More.
      const more = page.getByRole('button', { name: 'More', exact: true })
      if ((await more.count()) === 0) {
        failures++
        console.log(`ERROR ${name(s, theme)}: no More button, so the sheet was never opened`)
      } else {
        await more.first().click()
      }
    }
    // Selection and the destructive dialog are DRIVEN, through the same
    // controls a coach presses: enter selection mode, select every shown row,
    // then open the dialog. Nothing is faked, so a control that stops
    // rendering fails the run rather than producing a plausible shot.
    if (s.open === 'select' || s.open === 'delete') {
      const press = async (nameRe) => {
        const b = page.getByRole('button', { name: nameRe })
        if ((await b.count()) === 0) {
          failures++
          console.log(`ERROR ${name(s, theme)}: no ${nameRe} button, so the ${s.open} state was never reached`)
          return false
        }
        await b.first().click()
        await page.waitForTimeout(150)
        return true
      }
      if (await press(/^Select players$/)) {
        if (s.open === 'delete') {
          if (await press(/^Select all \d+ shown$/)) await press(/^Delete \d+ players?$/)
        }
      }
    }
    if (s.open === 'error' || s.open === 'info') {
      // The real paths: pressing the magic link button with an empty field is
      // the error, and with one filled is the confirmation. Neither is faked.
      if (s.open === 'info') await page.getByLabel('Email').fill('coach@example.invalid')
      await page.getByRole('button', { name: 'Email me a link' }).click()
    }
    await reached(page, s, theme)
    await page.screenshot({ path: `${OUT}/${name(s, theme)}`, fullPage: !OVERLAY.has(s.open) })
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
