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
import { assertServingCurrentBuild } from './fresh.mjs'
import { DIALOGS, openDialog, openRowMenu, queryFor, DIALOG_PLAYER } from './dialogs.mjs'

const OUT = process.argv[2] ?? 'visual-shots'
const BASE = process.env.HARNESS ?? 'http://localhost:5199'
await assertServingCurrentBuild(BASE)
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
  /* The header's action hierarchy. `allactions` is the fullest header a coach
     can reach: Import from Spond is the one action gated on the team filter,
     so every one of the nine is offered only with a Spond mapped team
     selected, and that is the case the hierarchy has to hold. Shot closed at
     the three phone widths the acceptance names plus a desktop pair, and
     open at the same widths plus the 900px changeover. The capability limited
     variants need no entry of their own: viewer and parent are already shot
     at every width above, and neither is offered an overflow at all. */
  ...[360, 390, 430, 1024, 1280].map((w) => ({ screen: 'players', caps: 'coach', state: 'allactions', w })),
  ...[360, 390, 430, 900, 1280].map((w) => ({
    screen: 'players',
    caps: 'coach',
    state: 'allactions',
    w,
    open: 'moreactions',
  })),
  /* A ROW's overflow, which is the surface whose item height this slice
     brings to 44px. Shot in both layouts, because above 900px the row shows
     Edit and History beside the trigger and below it the card holds every
     action in the menu, so the two popups are different lists. */
  ...[390, 1280].map((w) => ({ screen: 'players', caps: 'coach', w, open: 'rowmenu' })),

  /* ---- VISUAL-02, the six remaining dialog files ----------------------
     Eleven dialogs across six files, plus the states each one owns. Every
     entry is opened by pressing the controls a coach presses, and proves
     both that it is the dialog its name claims and that it is in the state
     its name claims (tools/visual/dialogs.mjs).

     390 and 1280 for all of them, which is the phone and the desktop; the
     five that are forms are also shot at 900, where 2.13 turns a form dialog
     into a bottom sheet and the footer has to stay above the keyboard. */
  ...DIALOGS.flatMap((d) => [390, 1280].map((w) => ({ screen: 'players', caps: 'coach', dialog: d, w }))),
  ...DIALOGS.filter((d) => ['add', 'edit', 'export', 'import-preview', 'renew'].includes(d.key)).map((d) => ({
    screen: 'players',
    caps: 'coach',
    dialog: d,
    w: 900,
  })),
]

const name = (s, theme) =>
  [
    s.screen,
    s.caps ?? 'na',
    s.dialog ? s.dialog.state : (s.state ?? 'default'),
    s.dialog ? `dialog-${s.dialog.key}` : (s.open ?? 'default'),
    theme,
    `${s.w}w`,
  ].join('_') + '.png'

// An overlay is shot at the viewport rather than full page: a full page shot
// of a dialog over a two hundred row register is a picture of the register.
const OVERLAY = new Set(['more', 'delete', 'moreactions', 'rowmenu'])
const isOverlay = (s) => !!s.dialog || OVERLAY.has(s.open)


// Every entry whose name claims a state must PROVE that state before its
// screenshot is filed. Without this the interaction can no-op and leave an
// ordinary page under a name that says otherwise, which is worse evidence
// than a missing file because it looks like proof. The selector is what the
// state actually renders, so a primitive that stops rendering fails here too.
//
// The filename carries TWO claims, and both are proved. `open` is a state the
// run drives by pressing a control; `state` is one the harness's own reads
// answer with. A shot named for a state whose read quietly returned the
// ordinary register is the exact failure this map exists to stop, and the
// state axis was the half that had no proof when it was introduced.
const REACHED = {
  more: '.more-sheet',
  // The header's own overflow, which is a popup rather than the bottom sheet
  // `more` names. Scoped to .players-more so a row menu left open by another
  // press could not stand in for it.
  moreactions: '.players-more .menu-list',
  // And the row's, scoped the other way for the same reason: NOT inside
  // .players-more, so the header's popup cannot stand in for a row's.
  rowmenu: '.menu:not(.players-more) .menu-list',
  error: '.note-danger[role="alert"]',
  info: '.note-success[role="status"]',
  select: '.bulk-bar',
  delete: '.modal',
}

// What each named state actually renders. `default` claims nothing, so it
// needs nothing; every other value MUST be listed, and an unlisted one is a
// failure rather than a pass, so adding a state without its proof cannot go
// quiet. Playwright's :has-text() is what separates two states that render
// the same element with different words.
//
// A value may be a PREDICATE instead of a selector, for a state whose proof is
// not "an element is on screen". `allactions` is one: what it claims is that
// the address put the team filter on the Spond mapped team, which is what
// makes Import from Spond available, and no selector can ask a <select> what
// it is set to. Proving it by some element that merely happens to render
// alongside would be the same false proof this map exists to stop.
const REACHED_STATE = {
  loading: '.content > .loading[role="status"]',
  rowsloading: '.skeleton-list',
  empty: '.empty',
  error: '.state-error[role="alert"]',
  archived: '.note-neutral:has-text("archived and read only")',
  // :visible, because this state renders in whichever of the two layouts the
  // width selects and the other is display:none. Without it a comma list
  // resolves to the first match in DOM ORDER, which is the table row, and
  // every phone width failed against a row it had correctly hidden.
  withdrawn: '.player-card.withdrawn:visible, table.reg-table tr.withdrawn:visible',
  noseason: '.empty:has-text("season")',
  stale: '.modal .note-danger:has-text("out of date")',
  overlimit: '.modal .note-danger:has-text("At most 200")',
  allactions: async (page) =>
    page.$eval('#filter-team', (el) => el.value === 'titans').catch(() => false),
}

async function visible(page, selector) {
  return page.waitForSelector(selector, { state: 'visible', timeout: 3000 }).then(() => true, () => false)
}

async function reached(page, s, theme) {
  let ok = true
  if (s.open) {
    const selector = REACHED[s.open]
    if (!selector) {
      failures++
      console.log(`ERROR ${name(s, theme)}: no proof selector for open=${s.open}, so the shot claims a state nothing checked`)
      ok = false
    } else if (!(await visible(page, selector))) {
      failures++
      console.log(`ERROR ${name(s, theme)}: ${selector} never appeared, so the ${s.open} state was not reached`)
      ok = false
    }
  }
  if (s.state && s.state !== 'default') {
    const proof = REACHED_STATE[s.state]
    if (!proof) {
      failures++
      console.log(`ERROR ${name(s, theme)}: no proof selector for state=${s.state}, so the shot claims a state nothing checked`)
      ok = false
    } else if (!(typeof proof === 'function' ? await proof(page) : await visible(page, proof))) {
      failures++
      // A predicate stringifies to its whole body, which buries the message
      // it is attached to. It is named rather than printed.
      const shown = typeof proof === 'function' ? `the ${s.state} predicate` : proof
      console.log(`ERROR ${name(s, theme)}: ${shown} never held, so the ${s.state} state was not reached`)
      ok = false
    }
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
    // A dialog entry carries its own state and address (they are not always
    // the same thing), so its query string is built by the module that owns
    // the entry rather than assembled again here.
    const q = s.dialog
      ? queryFor(s.dialog, { theme, caps: s.caps })
      : (() => {
          const p = new URLSearchParams({ screen: s.screen, theme })
          if (s.caps) p.set('caps', s.caps)
          if (s.state) p.set('state', s.state)
          return p
        })()
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
    if (s.open === 'moreactions') {
      // Pressed, never faked, and named EXACTLY: every row's menu trigger is
      // called "More actions for <child>", so a loose name matches nine
      // controls and the first of them is a row.
      const more = page.getByRole('button', { name: 'More actions', exact: true })
      if ((await more.count()) === 0) {
        failures++
        console.log(`ERROR ${name(s, theme)}: no More actions button, so the overflow was never opened`)
      } else {
        await more.first().click()
        await page.waitForTimeout(150)
      }
    }
    if (s.open === 'rowmenu') {
      // A row's own overflow, opened on a named row so it is the same list at
      // both widths rather than whichever row happens to be first.
      if (!(await openRowMenu(page, DIALOG_PLAYER))) {
        failures++
        console.log(`ERROR ${name(s, theme)}: the row's More actions trigger is not on the page`)
      }
      await page.waitForTimeout(150)
    }
    if (s.open === 'error' || s.open === 'info') {
      // The real paths: pressing the magic link button with an empty field is
      // the error, and with one filled is the confirmation. Neither is faked.
      if (s.open === 'info') await page.getByLabel('Email').fill('coach@example.invalid')
      await page.getByRole('button', { name: 'Email me a link' }).click()
    }
    // A dialog carries its own proof, of the dialog AND of the state its name
    // claims, so a press that quietly no-ops fails here rather than filing an
    // ordinary dialog under a name that says otherwise.
    if (s.dialog) {
      const why = await openDialog(page, s.dialog)
      if (why) {
        failures++
        console.log(`ERROR ${name(s, theme)}: ${why}`)
      }
    }
    await reached(page, s, theme)
    await page.screenshot({ path: `${OUT}/${name(s, theme)}`, fullPage: !isOverlay(s) })
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
