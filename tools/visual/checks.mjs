// Browser-measured checks over the acceptance surfaces: hit areas, the error
// state, the focus ring, the phone shell, the Sheet's focus contract, reduced
// motion, and (VISUAL-02) the Registered players table, its card equivalent,
// the badge and the destructive dialog. Development only.
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
import { assertServingCurrentBuild } from './fresh.mjs'
import { DIALOGS, DIALOG_PLAYER, openDialog, openRowMenu, queryFor } from './dialogs.mjs'
import { ACCOUNT_FLOWS, queryForFlow, runFlow } from './account.mjs'
import { AUTH_FLOWS, BRAND, GUARD_CASES, LOGIN_EMAIL, LOGIN_PASSWORD, brandRendered, queryForAuth, runAuthFlow, urlForAuth } from './auth.mjs'
import { FEEDBACK_ENTRIES, ROWS, expandRow, queryForFeedback, row, runFeedbackFlow } from './feedback.mjs'
import {
  ADMIN_ENTRIES,
  MEMBERS,
  ROLES,
  memberRow,
  noWrites,
  queryForAdmin,
  roleRow,
  runAdminFlow,
  teamRow,
  tickState,
} from './admin.mjs'

const BASE = process.env.HARNESS ?? 'http://localhost:5199'
await assertServingCurrentBuild(BASE)
const FONTS = path.resolve(fileURLToPath(new URL('../../node_modules/.visual-harness-fonts', import.meta.url)))
const manifest = existsSync(path.join(FONTS, 'manifest.json'))
  ? JSON.parse(await readFile(path.join(FONTS, 'manifest.json'), 'utf8'))
  : {}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium' })
const context = await browser.newContext()
// Ten seconds rather than Playwright's thirty. Every wait in this file is
// explicit and finishes in well under a second; the default only ever applies
// when something has gone wrong, and then it is the cost of finding out. Nine
// guarded presses against a control that has become unclickable is ninety
// seconds of nothing rather than four and a half minutes.
context.setDefaultTimeout(10000)
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
// Each result is printed AS IT IS RECORDED, not collected and printed at the
// end. A run that ends unexpectedly used to report nothing at all, because the
// only print was the last statement in the file: fifteen lines of stack trace,
// zero results, and a non zero exit that looks the same as a clean failure.
// Codex. Printing here means an abort loses only the checks after it, and the
// summary at the end says how many ran.
const check = (name, ok, detail = '') => {
  const line = `${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`
  out.push(line)
  console.log(line)
}

// And an abort is a NAMED failure rather than a stack trace. A rejected top
// level await prints a stack and exits non zero, which reads like a check that
// failed rather than like a run that stopped early; this says which it was and
// how far it got.
//
// BOTH events, because they are not interchangeable: a rejected top level await
// reaches Node as an uncaught exception, not as an unhandled rejection, so a
// handler for the second alone never fires and the abort is a stack trace
// again. Found by mutating a surface to render nothing.
const aborted = (e) => {
  check('the run completed', false, `it aborted: ${String(e?.message ?? e).split('\n')[0]}`)
  console.log(`${out.length - 1} checks ran before the abort`)
  process.exit(1)
}
process.on('unhandledRejection', aborted)
process.on('uncaughtException', aborted)

// A press that cannot end the run. Playwright rejects a click or a focus on a
// control that is not rendered, after its thirty second timeout, and the
// rejection takes the process with it, so ONE regression hides every check
// after it rather than failing its own. Found twice on this PR, both times by
// a mutation that removed an item from the overflow, and both times the run
// ended with an unhandled timeout and nothing else reported. A missing control
// is a recorded failure here and the caller carries on.
//
// The count guard is not the whole story, and a guard that catches half the
// cases reads as one that catches all of them: a control that is PRESENT but
// disabled, covered by another element, or still animating makes click() wait
// and then reject on its own account, which is the same abort by another door.
// So the action itself is caught too, and the reason Playwright gives is what
// the failure reports.
const acted = async (locator, what, verb, run) => {
  if ((await locator.count()) === 0) {
    check(what, false, `the control is not on the page`)
    return false
  }
  try {
    await run(locator.first())
    return true
  } catch (e) {
    check(what, false, `the control could not be ${verb}: ${String(e.message ?? e).split('\n')[0]}`)
    return false
  }
}
const pressed = (locator, what) => acted(locator, what, 'clicked', (el) => el.click())
const focused = (locator, what) => acted(locator, what, 'focused', (el) => el.focus())
// Choosing a value is an action like any other and rejects the same way on a
// control that is not there. It needs the same guard: without it a press that
// already failed and returned false is followed by a selection that rejects on
// its own account, which ends the run and skips every check after it. Codex.
const chose = (locator, value, what) => acted(locator, what, 'set', (el) => el.selectOption(value))
// And typing into a field, which is the third action this file performs. The
// typed confirmation on the two delete dialogs is the only caller.
const typed = (locator, value, what) => acted(locator, what, 'typed into', (el) => el.fill(value))
// The header's overflow trigger, named exactly: every row's is "More actions
// for <child>", so a loose name matches ten controls and resolves to a row.
const moreActions = (page) => page.getByRole('button', { name: 'More actions', exact: true })

const open = async (screen, width, opts = {}) => {
  const page = await context.newPage()
  if (opts.reducedMotion) await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width, height: opts.height ?? 900 })
  // A dialog entry owns its own query string, because its state and its
  // address are not always the same thing.
  // An Account flow owns its own query string for the same reason a dialog
  // does: the write phase it needs is part of the entry, not of the caller.
  // An auth entry owns its query string for the same reason, and its whole
  // ADDRESS as well: one of them reproduces an arrival defined by its URL
  // fragment.
  const q = opts.dialog
    ? queryFor(opts.dialog, { theme: opts.theme ?? 'light', caps: opts.caps ?? 'coach' })
    : opts.flow
      ? queryForFlow(opts.flow, { theme: opts.theme ?? 'light', caps: opts.caps ?? 'coach' })
      : opts.authEntry
        ? queryForAuth(opts.authEntry, { theme: opts.theme ?? 'light' })
        : // A feedback entry owns its query string for the same reason: the
          // capability set and the write phase it needs are part of the entry
          // rather than of the caller.
          opts.feedbackEntry
          ? queryForFeedback(opts.feedbackEntry, { theme: opts.theme ?? 'light' })
          : // An admin entry owns its query string for the same reason again:
            // WHICH of the two screens it drives, the capability set and the
            // write phase it needs are all part of the entry.
            opts.adminEntry
            ? queryForAdmin(opts.adminEntry, { theme: opts.theme ?? 'light' })
            : new URLSearchParams({ screen, theme: opts.theme ?? 'light' })
  const plain = !opts.dialog && !opts.flow && !opts.authEntry && !opts.feedbackEntry && !opts.adminEntry
  // The auth condition the guard is given, for a plain open of an auth
  // surface. It is a key of its own rather than a state, because "has to set
  // a password" and "the write hangs" are both true of one screen at once.
  if (plain && opts.auth) q.set('auth', opts.auth)
  if (plain && opts.caps) q.set('caps', opts.caps)
  if (plain && opts.state) q.set('state', opts.state)
  // A state and an address are two different things: the Activity feed's one
  // URL persisted filter is the batch deep link, and it is reached by opening
  // that address rather than by a state the reads answer with.
  if (plain && opts.at) q.set('at', opts.at)
  await page.goto(opts.authEntry ? urlForAuth(BASE, opts.authEntry, { theme: opts.theme ?? 'light' }) : `${BASE}/?${q}`, {
    waitUntil: 'domcontentloaded',
  })
  await page.evaluate(() => document.fonts.ready)
  // domcontentloaded fires before React has rendered anything, so a check that
  // evaluated straight after this read an empty page. Every check here asserts
  // about rendered output, so waiting for the app to have painted belongs in
  // ONE place rather than in each of them. Without it the error state check
  // reported a false FAIL on roughly one run in three.
  //
  // A surface that never painted is RECORDED as a failure here and marked, so
  // the checks that follow can skip the operations that would reject on a
  // missing control. Catching the wait alone was not enough: the caller went
  // on to scroll to a control that was not there, which rejects on its own
  // account and aborts the run just the same. Codex.
  //
  // `blank` is a property on the page rather than a second return value,
  // because forty call sites destructure nothing and a signal none of them
  // reads is not a signal.
  /* `.login` matched NOTHING. The signed out card has always been
     `.login-bg` wrapping `.login-card`, so every open of that surface waited
     the full five seconds, recorded "the surface never painted" and marked
     the page blank. Nothing caught it because no check opened login until
     this slice; a selector nobody exercises is a selector nobody notices.

     The auth surfaces need a third alternative because the guard's own
     loading branch renders a splash with no class at all. The route witness
     is the honest signal there: it is a sibling of the real App, so it is
     attached exactly when the auth tree mounted, whichever of the three
     things that tree decided to render. */
  const paint = opts.authEntry
    ? '.content > *, .login-card, [data-route]'
    : '.content > *, .login-card'
  const painted = await page.waitForSelector(paint, { state: 'attached', timeout: 5000 }).then(() => true, () => false)
  page.blank = !painted
  if (!painted) check(`${screen} at ${width} renders something`, false, 'the surface never painted')
  if (opts.awaitSelector) await page.waitForSelector(opts.awaitSelector, { state: 'visible', timeout: 5000 }).catch(() => {})
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
    if (page.blank) return null
    // Guarded for the same reason every press here is: a control that is not
    // on the page rejects this after its timeout and takes the run with it.
    await page.locator(sel).first().scrollIntoViewIfNeeded().catch(() => {})
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

  // Guarded like the two above it: a missing control makes this a failing
  // check rather than a thrown TypeError that ends the run.
  const ring = await page.evaluate(() => {
    const el = document.querySelector('.btn-primary')
    if (!el) return null
    el.focus()
    const cs = getComputedStyle(el)
    return { width: cs.outlineWidth, colour: cs.outlineColor, offset: cs.outlineOffset }
  })
  check(
    'a focused button draws the shared ring',
    !!ring && ring.width === '2px' && ring.colour === 'rgb(31, 67, 214)' && ring.offset === '2px',
    JSON.stringify(ring),
  )
  await page.close()
}

/* ---- an enlarged hit area must not steal a neighbour's clicks ---- */
{
  for (const [screen, width] of [
    ['home', 360],
    ['sessions', 360],
    ['sessions', 390],
    ['sessions', 1280],
    ['primitives', 390],
    ['players', 360],
    ['players', 390],
    ['players', 1024],
    ['players', 1280],
    // Activity's card layout stacks a link carrying a pseudo hit area directly
    // above a button carrying one, which is the arrangement this check exists
    // for. 900 is the card layout's widest, 1280 the row's.
    ['activity', 360],
    ['activity', 390],
    ['activity', 900],
    ['activity', 1280],
    // The feedback row puts a small ghost button and two icon buttons in one
    // cluster, and wraps that cluster under the title at narrow widths, which
    // is where an overhanging hit box would reach the row's own Delete. The
    // expanded row, whose comment actions stack, is measured in the Feedback
    // block below, because a collapsed page has no comment to act on.
    ['feedback', 360],
    ['feedback', 390],
    ['feedback', 430],
    ['feedback', 768],
    ['feedback', 1280],
  ]) {
    const page = await open(screen, width)
    const r = await page.evaluate(() => {
      // Every control whose hit area comes from an ::after: does that box
      // reach into a NEIGHBOURING control's own visible box? Two chips on
      // wrapped rows are the case worth checking, since each pseudo extends
      // five pixels past a 34px chip into the row gap.
      const els = [...document.querySelectorAll('.chip, .btn-sm, .icon-btn, .toggle, a.activity-batch')]
      const boxes = els.map((el) => {
        const b = el.getBoundingClientRect()
        const a = getComputedStyle(el, '::after')
        const px = (v) => (v.endsWith('px') ? parseFloat(v) : 0)
        const ph = a.content === 'none' ? b.height : Math.max(b.height, px(a.height))
        const pw = a.content === 'none' ? b.width : Math.max(b.width, px(a.width))
        return {
          label: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 14),
          hit: {
            l: b.left - (pw - b.width) / 2,
            r: b.right + (pw - b.width) / 2,
            t: b.top - (ph - b.height) / 2,
            b: b.bottom + (ph - b.height) / 2,
          },
          box: b,
        }
      })
      const clashes = []
      for (const a of boxes) {
        for (const c of boxes) {
          if (a === c) continue
          const ox = Math.min(a.hit.r, c.box.right) - Math.max(a.hit.l, c.box.left)
          const oy = Math.min(a.hit.b, c.box.bottom) - Math.max(a.hit.t, c.box.top)
          if (ox > 0.5 && oy > 0.5) clashes.push(`${a.label} over ${c.label}`)
        }
      }
      return { count: boxes.length, clashes: [...new Set(clashes)] }
    })
    check(
      `no hit area overlaps a neighbouring control on ${screen} at ${width}`,
      r.clashes.length === 0,
      `${r.count} controls${r.clashes.length ? ': ' + r.clashes.slice(0, 3).join(', ') : ''}`,
    )
    await page.close()
  }
}

/* ---- the phone shell ---- */
{
  const page = await open('home', 390)
  const nav = await page.evaluate(() => {
    const a = document.querySelector('.bn-item.active')
    if (!a) return { size: null, current: null, height: 0 }
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
    if (!t) return { role: null, checked: null, label: null }
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
  await pressed(page.getByRole('button', { name: 'More', exact: true }), 'the sheet takes focus on open')
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

/* ---- VISUAL-02: the table, its card equivalent and the badge -------
   These are the two primitives VISUAL-01 defined and deferred, and the
   claims about them are computed styles and live interaction rather than
   anything a screenshot or a source-text test can settle. */
{
  // 2.9: the table renders above 900px, a card list at and below it, and the
  // two never render together. Checked either side of the breakpoint and ON
  // it, because 900 is where the answer changes.
  for (const [width, wantTable] of [[900, false], [901, true], [1280, true], [390, false], [360, false]]) {
    const page = await open('players', width)
    const r = await page.evaluate(() => {
      const shown = (sel) => {
        const el = document.querySelector(sel)
        return !!el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().height > 0
      }
      return { table: shown('.reg-table-wrap'), cards: shown('.reg-cards') }
    })
    check(
      `at ${width} exactly one of the table and the card list renders`,
      r.table === wantTable && r.cards === !wantTable && r.table !== r.cards,
      JSON.stringify(r),
    )
    await page.close()
  }

  // 2.9: the two named columns drop between 901 and 1080, and stay valid sort
  // keys. A column that dropped out of the sort control would be unreachable,
  // which is the half of that rule a screenshot cannot see.
  for (const [width, wantDropped] of [[1024, true], [1280, false]]) {
    const page = await open('players', width)
    const r = await page.evaluate(() => {
      const cell = (sel) => {
        const el = document.querySelector(sel)
        return !!el && getComputedStyle(el).display !== 'none'
      }
      const sorts = [...document.querySelectorAll('select[aria-label="Sort players"] option')].map((o) => o.value)
      return { date: cell('table.reg-table .col-date'), updated: cell('table.reg-table .col-updated'), sorts }
    })
    check(
      `at ${width} the date columns ${wantDropped ? 'drop' : 'render'} and both stay sort keys`,
      r.date === !wantDropped && r.updated === !wantDropped && r.sorts.includes('registered') && r.sorts.includes('updated'),
      JSON.stringify(r),
    )
    await page.close()
  }

  // 2.9: the card equivalent carries the same information as the table, not a
  // subset. The two columns the table drops are the ones a card is most
  // likely to lose, so they are what this names.
  {
    const page = await open('players', 390)
    const r = await page.evaluate(() => {
      const card = document.querySelector('.player-card')
      const text = card ? card.textContent : ''
      return { has: !!card, registered: /Registered \d/.test(text), updated: /Updated \d/.test(text) }
    })
    check('the phone card carries the registered and updated dates the table drops', r.has && r.registered && r.updated, JSON.stringify(r))
    await page.close()
  }

  // 2.7: a badge is a tone, a dot AND a word. Never one of the three alone.
  //
  // The TONE half needs asserting, not just the dot's existence. This check
  // first collected the class and never read it, and accepted any dot that was
  // not transparent, so deleting the .badge-success and .badge-warning rules
  // left every dot the base opaque slate and the check still passed. Codex.
  // Two claims now: the class a status carries is the one its word means, and
  // distinct tones are drawn in distinct colours, which is what a deleted
  // override collapses. The colours are compared with each other rather than
  // with hard coded hex, so moving a token stays a design decision rather than
  // a broken check.
  {
    const page = await open('players', 1280, { state: 'withdrawn' })
    // The whole class, not a modifier: neutral is the Badge primitive's base
    // and carries no modifier at all, so "contains badge-neutral" would be a
    // check for a class that has never existed.
    const TONE = { Registered: 'badge badge-success', Pending: 'badge badge-warning', Withdrawn: 'badge' }
    const r = await page.evaluate(() => {
      const seen = new Map()
      for (const b of document.querySelectorAll('td .badge')) {
        const word = b.textContent.trim()
        if (seen.has(word)) continue
        const dot = b.querySelector('.badge-dot')
        seen.set(word, {
          cls: b.className,
          dot: !!dot,
          word,
          dotColour: dot ? getComputedStyle(dot).backgroundColor : null,
        })
      }
      return [...seen.values()]
    })
    const tones = new Set(r.map((b) => b.dotColour))
    check(
      'every status badge carries a dot and a word, so status is never colour alone',
      r.length >= 2 &&
        r.every((b) => b.dot && b.word.length > 0 && b.dotColour !== 'rgba(0, 0, 0, 0)') &&
        // The class says what the word says.
        r.every((b) => TONE[b.word] && b.cls.trim() === TONE[b.word]) &&
        // And the tones are actually different from one another.
        tones.size === r.length,
      JSON.stringify(r),
    )
    await page.close()
  }

  // 2.5: the two controls the table adds are controls, so the 44px rule binds
  // them. A sortable header and a row checkbox were 30px and 36px targets.
  {
    const page = await open('players', 1280)
    const header = await page.evaluate(() => {
      const b = document.querySelector('table.reg-table th button')
      if (!b) return { w: 0, h: 0 }
      const r = b.getBoundingClientRect()
      return { w: Math.round(r.width), h: Math.round(r.height) }
    })
    check('a sortable column header reaches a 44px target', header.h >= 44 && header.w >= 44, JSON.stringify(header))

    // 2.15: the ring has to be VISIBLE, not merely applied. The table scrolls
    // inside its own container, and an overflow other than visible clips at
    // the padding box; the header button starts at the cell edge, so the ring
    // reaching 4px out was cut on the first header's top and left until the
    // container was given that 4px back.
    const ring = await page.evaluate(() => {
      const wrap = document.querySelector('.reg-table-wrap')
      const b = document.querySelector('table.reg-table th.sort-th button')
      if (!wrap || !b) return null
      b.focus()
      const w = wrap.getBoundingClientRect(), r = b.getBoundingClientRect()
      const cs = getComputedStyle(b)
      const reach = parseFloat(cs.outlineOffset) + parseFloat(cs.outlineWidth)
      return {
        reach,
        top: Math.round(Math.max(0, w.top - (r.top - reach))),
        left: Math.round(Math.max(0, w.left - (r.left - reach))),
        scrolls: wrap.scrollWidth > wrap.clientWidth,
      }
    })
    check(
      'the sortable header\'s focus ring is not clipped by the scroll container',
      !!ring && ring.reach > 0 && ring.top === 0 && ring.left === 0 && !ring.scrolls,
      JSON.stringify(ring),
    )

    await page.close()
  }

  // The row checkbox, measured in each layout at a width where that layout is
  // the one rendering. The card list is display:none above 900px, so a single
  // page cannot measure both: the first version of this check read the card's
  // hidden box as 0x0 and reported a failure that was its own.
  for (const [width, sel, layout] of [
    [1280, 'table.reg-table td.col-select .cell-select', 'the table'],
    [390, '.player-card .pc-select', 'the card list'],
  ]) {
    const page = await open('players', width)
    await pressed(page.getByRole('button', { name: 'Select players', exact: true }), `the row checkbox reaches a 44px target in ${layout}`)
    await page.waitForTimeout(150)
    const box = await page.evaluate((s) => {
      const el = document.querySelector(s)
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { w: Math.round(r.width), h: Math.round(r.height) }
    }, sel)
    check(
      `the row checkbox reaches a 44px target in ${layout}`,
      !!box && box.w >= 44 && box.h >= 44,
      JSON.stringify(box),
    )
    await page.close()
  }

  // 2.14: a failed read is an announced error with a retry, and it is NOT
  // rendered as a club with no children in it. The count strip is the thing
  // that would otherwise say "0 players" about a read that never landed.
  {
    const page = await open('players', 1280, { state: 'error', awaitSelector: '.state-error' })
    const r = await page.evaluate(() => ({
      alert: !!document.querySelector('.state-error[role="alert"]'),
      retry: !![...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Retry'),
      counts: !!document.querySelector('.reg-count'),
      zero: document.body.textContent.includes('0 players'),
    }))
    check(
      'a failed register read announces itself, offers a retry and claims no count',
      r.alert && r.retry && !r.counts && !r.zero,
      JSON.stringify(r),
    )
    await page.close()
  }

  // The destructive dialog's focus contract and its typed gate. The gate is
  // behaviour PLAYERS-01 owns and this wave must not have moved: the confirm
  // button stays inert until the phrase names the count.
  {
    const DIALOG = 'the destructive dialog opens with its confirm button inert'
    const page = await open('players', 1280)
    // Three presses of setup, each of which every check below depends on. A
    // failed one is reported and the block stops rather than asserting
    // against a dialog that was never opened.
    const opened =
      (await pressed(page.getByRole('button', { name: 'Select players', exact: true }), DIALOG)) &&
      (await pressed(page.getByRole('button', { name: /^Select all \d+ shown$/ }), DIALOG)) &&
      (await pressed(page.getByRole('button', { name: /^Delete \d+ players?$/ }), DIALOG))
    if (opened) {
      await page.waitForTimeout(250)
      const confirm = page.getByRole('button', { name: /permanently$/ })
      check(DIALOG, await confirm.isDisabled())
      check(
        'the dialog took focus, so Escape and the Tab trap are live',
        await page.evaluate(() => document.activeElement.classList.contains('modal')),
      )
      const field = page.getByLabel(/^To confirm, type/)
      if (await typed(field, 'DELETE 7 PLAYERS', 'a phrase naming the wrong count leaves it inert')) {
        await page.waitForTimeout(120)
        check('a phrase naming the wrong count leaves it inert', await confirm.isDisabled())
        if (await typed(field, 'DELETE 8 PLAYERS', 'the phrase naming the count arms it')) {
          await page.waitForTimeout(120)
          check('the phrase naming the count arms it', !(await confirm.isDisabled()))
        }
      }
      const danger = await page.evaluate(() => {
        const b = [...document.querySelectorAll('.modal button')].find((x) => /permanently$/.test(x.textContent.trim()))
        return b ? { cls: b.className, fill: getComputedStyle(b).backgroundColor, word: /Delete/.test(b.textContent) } : null
      })
      check(
        'the destructive control is the danger variant and says the word, not only the colour',
        !!danger && danger.cls.includes('btn-danger') && danger.word,
        JSON.stringify(danger),
      )
      await page.keyboard.press('Escape')
      await page.waitForTimeout(200)
      check('Escape closes it and nothing was deleted', await page.evaluate(() => !document.querySelector('.modal')))
    }
    await page.close()
  }

  // The over limit refusal, reached with a register past the server's cap.
  {
    const page = await open('players', 1280, { state: 'overlimit' })
    const OVER = 'a selection past the cap is refused in words and never arms'
    await pressed(page.getByRole('button', { name: 'Select players', exact: true }), OVER)
    await pressed(page.getByRole('button', { name: /^Select all \d+ shown$/ }), OVER)
    await pressed(page.getByRole('button', { name: /^Delete \d+ players?$/ }), OVER)
    await page.waitForTimeout(250)
    const r = await page.evaluate(() => {
      const note = document.querySelector('.modal .note-danger[role="alert"]')
      const b = [...document.querySelectorAll('.modal button')].find((x) => /permanently$/.test(x.textContent.trim()))
      return { note: note ? note.textContent.trim().slice(0, 60) : null, armed: b ? !b.disabled : null }
    })
    check(
      'a selection past the cap is refused in words and never arms',
      !!r.note && r.note.includes('At most 200') && r.armed === false,
      JSON.stringify(r),
    )
    await page.close()
  }

  // The selection bar sticks so the count and the destructive button stay
  // reachable while a coach scrolls a long register. That is the whole point
  // of it sticking, and it is a claim about what is on top: the bar is
  // z-index 20 and the shell's header is 30, so an offset that only cleared
  // the page edge left every control in it drawn underneath the header and
  // unclickable. Reachability is read from the point each control is drawn
  // at, in both shells, because the two headers are different heights.
  for (const width of [1280, 390]) {
    const page = await open('players', width, { state: 'overlimit' })
    await pressed(
      page.getByRole('button', { name: 'Select players', exact: true }),
      `the selection bar stays reachable below the header at ${width}`,
    )
    await page.waitForTimeout(200)
    await page.evaluate(() => window.scrollTo(0, 1500))
    await page.waitForTimeout(300)
    const r = await page.evaluate(() => {
      const bar = document.querySelector('.bulk-bar')
      if (!bar) return null
      const b = bar.getBoundingClientRect()
      const head = [...document.querySelectorAll('.topbar, .mobile-topbar')].find((e) => e.getBoundingClientRect().height > 0)
      const h = head ? head.getBoundingClientRect() : null
      const controls = [...bar.querySelectorAll('button')].map((el) => {
        const g = el.getBoundingClientRect()
        const hit = document.elementFromPoint(g.left + g.width / 2, g.top + g.height / 2)
        return { label: el.textContent.trim().slice(0, 16), reachable: !!hit && (el.contains(hit) || el === hit) }
      })
      return { stuck: Math.round(b.top) < 400, clearsHeader: !h || b.top >= h.bottom, unreachable: controls.filter((c) => !c.reachable).map((c) => c.label) }
    })
    check(
      `the selection bar stays reachable below the header at ${width}`,
      !!r && r.stuck && r.clearsHeader && r.unreachable.length === 0,
      JSON.stringify(r),
    )
    await page.close()
  }

  /* ---- the header's action hierarchy (VISUAL-02) -------------------
     Design Read 2.10: one primary action, everything else ghost, quiet or in
     an overflow. Before this, the full capability set put eight actions in
     the slot, which wrapped to five rows at 360px and a 371px tall header,
     four at 390px and 430px, and never fewer than two at any desktop width;
     901px, where the sidebar returns and the content drops to 589px, was
     three rows and worse than 900px.

     `allactions` opens the register with the Spond mapped team selected,
     which is the only way Import from Spond is offered, so this is the
     fullest header a coach can reach: nine actions rather than eight. */
  {
    // The numbers, at the widths the acceptance names plus the two the
    // measurements showed were the worst. Rows are counted by BOTTOM edge:
    // .players-head .page-head-acts is align-items: flex-end, so the season
    // field, which is taller than a button, shares a row with a different
    // top and would read as a row of its own.
    //
    // A CEILING rather than an equality, deliberately. At 360px whether the
    // slot takes two rows or three turns on whether the page is long enough
    // to show a vertical scrollbar, which is a property of how many children
    // the filter leaves rather than of the header. The old layout was five
    // rows at 360 and four at 390 and 430, so these ceilings catch a
    // regression towards it without failing on fifteen pixels of scrollbar.
    const ROW_CAP = { 360: 3, 390: 2, 430: 2, 901: 2, 1024: 1, 1280: 1 }
    for (const [width, cap] of Object.entries(ROW_CAP)) {
      const page = await open('players', Number(width), { state: 'allactions' })
      const r = await page.evaluate(() => {
        const acts = document.querySelector('.page-head-acts')
        if (!acts) return null
        const kids = [...acts.children]
        const bottoms = new Set(kids.map((k) => Math.round(k.getBoundingClientRect().bottom)))
        return {
          rows: bottoms.size,
          slot: kids.map((k) => k.textContent.trim().slice(0, 16)),
          headerHeight: Math.round(document.querySelector('.page-head')?.getBoundingClientRect().height ?? 0),
        }
      })
      check(
        `the header's action slot is at most ${cap} row(s) at ${width} with every action offered`,
        !!r && r.rows <= cap,
        JSON.stringify(r),
      )
      await page.close()
    }
  }

  {
    // What the overflow holds, opened through the control a coach presses.
    // Named EXACTLY: every row's trigger is "More actions for <child>", so a
    // loose name matches the rows too and resolves to one of them first.
    const page = await open('players', 390, { state: 'allactions' })
    await pressed(moreActions(page), 'the overflow holds the six lower frequency actions, in reading order')
    await page.waitForTimeout(150)
    const r = await page.evaluate(() => {
      const list = document.querySelector('.players-more .menu-list')
      if (!list) return null
      const items = [...list.children]
      return {
        labels: items.map((c) => c.textContent.trim()),
        // A destination stays an anchor, so Spond links keeps middle click
        // and open in a new tab; the rest are buttons that run something.
        anchors: items.filter((c) => c.tagName === 'A').map((c) => `${c.textContent.trim()}→${c.getAttribute('href')}`),
        short: items.filter((c) => Math.round(c.getBoundingClientRect().height) < 44).map((c) => c.textContent.trim()),
      }
    })
    check(
      'the overflow holds the six lower frequency actions, in reading order',
      !!r &&
        JSON.stringify(r.labels) ===
          JSON.stringify(['Import from Spond', 'Spond links', 'Renew', 'Import players', 'Export', 'Download template']),
      JSON.stringify(r),
    )
    check(
      'Spond links stays an anchor to its own route rather than becoming a button',
      !!r && JSON.stringify(r.anchors) === JSON.stringify(['Spond links→/players/spond-links']),
      JSON.stringify(r && r.anchors),
    )
    check('every overflow item is a 44px target', !!r && r.short.length === 0, JSON.stringify(r && r.short))
    await page.close()
  }

  {
    // The popup is anchored to the ACTION SLOT, not to its own trigger, and
    // that RULE is what is asserted, rather than a consequence of it.
    //
    // Asserting only "it is on screen" was not enough, and that is what this
    // check looked like first: restoring the trigger anchoring still passed
    // at every width, because in the shipped typeface the trigger happens to
    // sit far enough right at all of them. The case the rule exists for is
    // real but narrower than it first looked: in the FALLBACK face, which is
    // what a coach gets when the font request does not land, the buttons are
    // narrower, the trigger wraps alone to the start of the last row at
    // 360px, and a trigger anchored popup's left edge computes to -35px. A
    // check that survives the mutation it exists to catch is not a check, so
    // this one compares the popup's right edge with the SLOT's, which differs
    // by 29px to 447px under that mutation at eight of these ten widths.
    // noseason is in the list because it is the case that broke it. A club
    // with no season at all offers a players.manage holder nothing but Spond
    // links, so the slot holds the trigger alone at 161px, narrower than the
    // popup it anchors, and the popup's left edge measured -13px at 360 and
    // 390 with no scroll that could reach it. The slot carries a min-width of
    // --menu-w now, the same token the popup's width comes from.
    for (const state of ['default', 'allactions', 'noseason']) {
      for (const width of [360, 390, 430, 901, 1280]) {
        const page = await open('players', width, { state })
        const trigger = moreActions(page)
        if ((await trigger.count()) === 0) {
          check(`the overflow popup is anchored to the action slot at ${width} (${state})`, false, 'no trigger')
          await page.close()
          continue
        }
        if (!(await pressed(trigger, `the overflow popup is anchored to the action slot at ${width} (${state})`))) {
          await page.close()
          continue
        }
        await page.waitForTimeout(150)
        const r = await page.evaluate(() => {
          const list = document.querySelector('.players-more .menu-list')
          if (!list) return null
          const b = list.getBoundingClientRect()
          const acts = document.querySelector('.page-head-acts')
          if (!acts) return null
          const slot = acts.getBoundingClientRect()
          const btn = document.querySelector('.players-more > button')?.getBoundingClientRect() ?? null
          return {
            left: Math.round(b.left),
            right: Math.round(b.right),
            slotLeft: Math.round(slot.left),
            slotRight: Math.round(slot.right),
            triggerRight: btn ? Math.round(btn.right) : null,
            viewport: window.innerWidth,
            overflows: document.documentElement.scrollWidth > window.innerWidth,
            // It opens BELOW the whole slot rather than over the rows above it.
            clearsSlot: b.top >= slot.bottom - 1,
          }
        })
        check(
          `the overflow popup is anchored to the action slot at ${width} (${state})`,
          !!r &&
            Math.abs(r.right - r.slotRight) <= 1 &&
            // The slot's LEFT edge is the content's left edge, so staying
            // inside the slot is what keeps the popup on the page. Asserting
            // left >= 0 alone would miss a popup clipped inside a padded
            // content column, and it is the SLOT the anchoring rule is about.
            r.left >= r.slotLeft - 1 &&
            r.left >= 0 &&
            r.right <= r.viewport &&
            !r.overflows &&
            r.clearsSlot,
          JSON.stringify(r),
        )
        await page.close()
      }
    }
  }

  {
    // The focus contract, which is the disclosure's whole accessibility
    // claim: keyboard reachable, Escape closes it, and focus comes back to
    // the trigger rather than dropping to the document body.
    const page = await open('players', 1280, { state: 'allactions' })
    const trigger = moreActions(page)
    await focused(trigger, 'Escape closes the overflow and returns focus to the trigger')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(150)
    const opened = await page.evaluate(() => ({
      open: !!document.querySelector('.players-more .menu-list'),
      expanded: document.querySelector('.players-more > button')?.getAttribute('aria-expanded') ?? null,
    }))
    check(
      'the keyboard opens the overflow, and the trigger says it is open',
      opened.open && opened.expanded === 'true',
      JSON.stringify(opened),
    )
    // Tab reaches the items: it is a disclosure, not an ARIA menu widget, so
    // Tab is how it is walked and there is no roving arrow key navigation to
    // claim.
    await page.keyboard.press('Tab')
    const first = await page.evaluate(() => {
      const el = document.activeElement
      return { inside: !!el.closest('.players-more .menu-list'), label: el.textContent.trim() }
    })
    check('Tab moves into the popup', first.inside, JSON.stringify(first))
    await page.keyboard.press('Escape')
    await page.waitForTimeout(150)
    const closed = await page.evaluate(() => ({
      open: !!document.querySelector('.players-more .menu-list'),
      expanded: document.querySelector('.players-more > button')?.getAttribute('aria-expanded') ?? null,
      focused: document.activeElement === document.querySelector('.players-more > button'),
    }))
    check(
      'Escape closes the overflow and returns focus to the trigger',
      !closed.open && closed.expanded === 'false' && closed.focused,
      JSON.stringify(closed),
    )
    await page.close()
  }

  {
    // A click outside closes it, and choosing an action returns focus to the
    // trigger BEFORE the modal opens, so the modal captures a still mounted
    // opener and restores focus to it on close. Renew is the action used
    // because it opens a dialog rather than navigating or downloading.
    const page = await open('players', 1280, { state: 'allactions' })
    await pressed(moreActions(page), 'a click outside closes the overflow')
    await page.waitForTimeout(120)
    await pressed(page.locator('h1'), 'a click outside closes the overflow')
    await page.waitForTimeout(150)
    check(
      'a click outside closes the overflow',
      await page.evaluate(() => !document.querySelector('.players-more .menu-list')),
    )
    await pressed(moreActions(page), 'choosing an overflow action closes the popup and opens that action')
    await page.waitForTimeout(120)
    await pressed(
      page.getByRole('button', { name: 'Renew', exact: true }),
      'choosing an overflow action closes the popup and opens that action',
    )
    await page.waitForTimeout(250)
    check(
      'choosing an overflow action closes the popup and opens that action',
      await page.evaluate(() => !document.querySelector('.players-more .menu-list') && !!document.querySelector('.modal')),
    )
    await page.keyboard.press('Escape')
    await page.waitForTimeout(250)
    const back = await page.evaluate(() => ({
      closed: !document.querySelector('.modal'),
      focused: document.activeElement === document.querySelector('.players-more > button'),
    }))
    check(
      'closing that dialog returns focus to the More actions trigger',
      back.closed && back.focused,
      JSON.stringify(back),
    )
    await page.close()
  }

  {
    // Every item is keyboard reachable and rings. Walked with real Tab
    // presses rather than element.focus(), because :focus-visible follows the
    // interaction that moved focus: a scripted focus after a mouse click does
    // not ring, and reading 0px from that would be a false failure. The
    // anchor is the one worth naming, since it is the only item that is not a
    // <button> and takes the ring through a different selector.
    const page = await open('players', 1280, { state: 'allactions' })
    await focused(moreActions(page), 'Tab reaches all six overflow items and every one draws the shared ring')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(150)
    const walked = []
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab')
      walked.push(
        await page.evaluate(() => {
          const el = document.activeElement
          const s = getComputedStyle(el)
          return {
            label: el.textContent.trim(),
            tag: el.tagName,
            inside: !!el.closest('.players-more .menu-list'),
            ring: s.outlineWidth === '2px' && s.outlineColor === 'rgb(31, 67, 214)',
          }
        }),
      )
    }
    check(
      'Tab reaches all six overflow items and every one draws the shared ring',
      // No length assertion: the loop always pushes six. What is claimed is
      // that all six landed INSIDE the popup and that one of them is the
      // anchor, which is the item that takes the ring through its own
      // selector rather than the shared button one.
      walked.every((w) => w.inside && w.ring) && walked.filter((w) => w.tag === 'A').length === 1,
      JSON.stringify(walked.filter((w) => !w.inside || !w.ring)),
    )
    await page.close()
  }

  {
    // Six 44px items is a 284px popup, which is taller than the fold on a
    // landscape phone: at 844x390 the last item starts 61px BELOW the fold,
    // and the bottom nav is fixed over the last 55px of it at z-index 50
    // against the popup's 30. The popup carries no max-height and no inner
    // scroll on purpose: it is absolutely positioned in the document rather
    // than fixed to the viewport, so the page scrolls to it and the item
    // comes out from under the nav, and a nested scroll area inside a 390px
    // tall window would be a second scroll surface where one already works.
    //
    // So this scrolls first, deliberately, and what it proves is that the
    // item is reachable AFTER the scroll a coach would make: elementFromPoint
    // returns the item itself, which it would not if the nav were still over
    // it. That is a claim about a viewport shape nothing else here opens, so
    // it is measured rather than asserted in a comment.
    for (const [width, height] of [
      [844, 390],
      [740, 360],
    ]) {
      const page = await open('players', width, { state: 'allactions', height })
      await pressed(moreActions(page), `the last overflow item is reachable, once scrolled to, at ${width}x${height}`)
      await page.waitForTimeout(150)
      const r = await page.evaluate(() => {
        const list = document.querySelector('.players-more .menu-list')
        if (!list) return null
        const last = list.lastElementChild
        last.scrollIntoView({ block: 'center' })
        const g = last.getBoundingClientRect()
        const hit = document.elementFromPoint(g.left + g.width / 2, g.top + g.height / 2)
        return {
          listHeight: Math.round(list.getBoundingClientRect().height),
          last: last.textContent.trim(),
          onScreen: g.top >= 0 && g.bottom <= window.innerHeight,
          reachable: !!hit && (last === hit || last.contains(hit)),
        }
      })
      check(
        `the last overflow item is reachable, once scrolled to, at ${width}x${height}`,
        !!r && r.onScreen && r.reachable && r.last === 'Download template',
        JSON.stringify(r),
      )
      await page.close()
    }
  }

  {
    // Escape is a React handler on the menu wrapper, so it fires only while
    // focus is inside it. Tab past the last item and the popup stayed open,
    // aria-expanded still true, over the page: a mouse user could click
    // outside to dismiss it, a keyboard user had nothing left. Focus leaving
    // the wrapper closes it now, and the trigger is NOT refocused, because
    // focus has deliberately moved on.
    const page = await open('players', 1280, { state: 'allactions' })
    await focused(moreActions(page), 'tabbing out of the overflow closes it and leaves focus where the Tab put it')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(120)
    for (let i = 0; i < 7; i++) await page.keyboard.press('Tab')
    await page.waitForTimeout(150)
    const r = await page.evaluate(() => ({
      open: !!document.querySelector('.players-more .menu-list'),
      expanded: document.querySelector('.players-more > button')?.getAttribute('aria-expanded') ?? null,
      insidePopup: !!document.activeElement.closest('.players-more'),
      pulledBack: document.activeElement === document.querySelector('.players-more > button'),
    }))
    check(
      'tabbing out of the overflow closes it and leaves focus where the Tab put it',
      !r.open && r.expanded === 'false' && !r.insidePopup && !r.pulledBack,
      JSON.stringify(r),
    )
    await page.close()
  }

  {
    // The gates, read from what the popup HOLDS. Export and Import players
    // are gated on a settled, non errored register, and Import players and
    // Import from Spond additionally on a season that can be written to.
    // With the popup closed neither label is in the markup, so a static test
    // asserting their absence would pass whatever the gate did; opening it is
    // what makes these gates observable at all.
    // The labels AND the preconditions the labels are read against. Codex,
    // twice: an absence proves the gate it names only if the OTHER reasons
    // that action could be absent are ruled out first. Import from Spond
    // needs a Spond mapped team selected, so a check that reads only the
    // labels passes for the wrong reason the moment the address, the URL
    // parsing or the mapping fixture stops delivering one, which is the same
    // shape as the finding that produced `archivedteam` in the first place.
    const held = async (state) => {
      const page = await open('players', 1280, { state })
      const trigger = moreActions(page)
      const labels =
        (await trigger.count()) === 0
          ? []
          : await (async () => {
              if (!(await pressed(trigger, `the ${state} overflow could be opened`))) return []
              await page.waitForTimeout(150)
              return page.evaluate(() =>
                [...document.querySelectorAll('.players-more .menu-list > *')].map((c) => c.textContent.trim()),
              )
            })()
      // Read from the control itself, because no selector can ask a select
      // what it is set to and the address is exactly what might have stopped
      // working.
      const team = await page.evaluate(() => {
        const el = document.querySelector('#filter-team')
        return el ? el.value : null
      })
      await page.close()
      return { labels, team }
    }

    // No Spond claim here, so this one needs no team precondition.
    const onError = (await held('error')).labels
    check(
      'a failed register read withdraws Export and Import players, and keeps the rest',
      !onError.includes('Export') &&
        !onError.includes('Import players') &&
        onError.includes('Renew') &&
        onError.includes('Download template'),
      JSON.stringify(onError),
    )

    // archivedTEAM, not archived: the plain archived address leaves the team
    // filter on All teams, and Import from Spond is then absent because no
    // mapped team is selected rather than because the season is not the
    // current one. Deleting the isCurrent and writable gates from that action
    // would still have passed. Codex found this; the state that makes the two
    // reasons distinguishable is the fix.
    // A POSITIVE CONTROL beside the negative one, on the same team, differing
    // only in the season. Codex, a third time down the same chain, and right
    // again: Spond links proves the club has SOME mapping, not that the
    // selected team is the mapped one, so a fixture whose mapping moved to
    // another team would leave both preconditions true while Import from
    // Spond was absent for the unmapped team reason. Reading the mapping off
    // the page is circular, since the only thing the page renders about it is
    // the action under test. A control is not: Import from Spond being
    // OFFERED on the current season with this team selected proves the team
    // is mapped, the fixture is live, players.import is held and the address
    // works, and the archived case then differs in exactly one variable.
    const onCurrentTeam = await held('allactions')
    const onArchived = await held('archivedteam')
    check(
      'an archived season keeps Export and the template and withdraws both imports',
      onCurrentTeam.team === 'titans' &&
        onCurrentTeam.labels.includes('Import from Spond') &&
        onArchived.team === 'titans' &&
        onArchived.labels.includes('Export') &&
        onArchived.labels.includes('Download template') &&
        !onArchived.labels.includes('Import players') &&
        !onArchived.labels.includes('Import from Spond'),
      JSON.stringify({ control: onCurrentTeam, archived: onArchived }),
    )
  }

  {
    // Each action still does what its label says. The four that open a dialog
    // are pressed and the dialog named, so a wiring mistake in the action
    // table (the right label against the wrong handler) fails here rather
    // than being caught by a coach.
    const OPENS = [
      ['Import from Spond', 'Import from Spond'],
      ['Renew', 'Renew players'],
      ['Import players', 'Import players'],
      ['Export', 'Export registered players'],
    ]
    const wrong = []
    for (const [item, dialog] of OPENS) {
      const page = await open('players', 1280, { state: 'allactions' })
      await pressed(moreActions(page), 'every overflow action opens the dialog its label names')
      await page.waitForTimeout(120)
      // An absent item is a FAILURE of this check, not an exception that ends
      // the whole run thirty seconds later with nothing else reported. Found
      // by mutating the fixture's Spond mapping onto another team, which is
      // exactly the case the archived gate check's control exists for: the
      // run aborted here before that check could report.
      const control = page.getByRole('button', { name: item, exact: true })
      if ((await control.count()) === 0) {
        wrong.push(`${item} is not in the overflow`)
        await page.close()
        continue
      }
      try {
        await control.click()
      } catch (e) {
        wrong.push(`${item} could not be pressed: ${String(e.message ?? e).split('\n')[0]}`)
        await page.close()
        continue
      }
      await page.waitForTimeout(300)
      const title = await page.evaluate(() => {
        const h = document.querySelector('.modal h3, .modal h2, .more-sheet h3')
        return h ? h.textContent.trim() : null
      })
      if (title !== dialog) wrong.push(`${item} opened ${title}`)
      await page.close()
    }
    check('every overflow action opens the dialog its label names', wrong.length === 0, JSON.stringify(wrong))

    // The one that is not a dialog: the blank template is a file, and the
    // press has to actually produce one.
    //
    // The same guard as the loop above, for the same reason, and Codex found
    // that fixing one and not the other left the hole where it was: only the
    // waitForEvent half carried a catch, so an absent item made the click
    // reject, Promise.all reject with it, and the whole run end before this
    // check or any after it could report.
    const page = await open('players', 1280, { state: 'allactions' })
    await pressed(moreActions(page), 'Download template still downloads the blank template')
    await page.waitForTimeout(120)
    const template = page.getByRole('button', { name: 'Download template', exact: true })
    const download =
      (await template.count()) === 0
        ? null
        : (
            await Promise.all([
              page.waitForEvent('download', { timeout: 5000 }).catch(() => null),
              template.click().catch(() => null),
            ])
          )[0]
    check(
      'Download template still downloads the blank template',
      !!download && download.suggestedFilename() === 'registered-players-template.csv',
      download ? download.suggestedFilename() : (await template.count()) === 0 ? 'not in the overflow' : 'no download',
    )
    await page.close()
  }

  {
    // Capability limited: the overflow is offered only where the capability
    // set opens something to put in it. A players.view only member gets no
    // trigger at all rather than an empty popup.
    const page = await open('players', 390, { caps: 'viewer' })
    const r = await page.evaluate(() => ({
      rows: document.querySelectorAll('.player-card').length,
      trigger: !!document.querySelector('.players-more'),
      slot: [...document.querySelectorAll('.page-head-acts > *')].map((e) => e.textContent.trim().slice(0, 16)),
    }))
    check(
      'a read only member is offered no overflow, and no empty popup to open',
      r.rows > 0 && !r.trigger,
      JSON.stringify(r),
    )
    await page.close()
  }

  // A read only member sees the register and no write affordance at all.
  {
    const page = await open('players', 1280, { caps: 'viewer' })
    const r = await page.evaluate(() => {
      const labels = [...document.querySelectorAll('button, a.btn')].map((b) => b.textContent.trim())
      return {
        rows: document.querySelectorAll('table.reg-table tbody tr').length,
        writes: labels.filter((l) => ['Add player', 'Select players', 'Import players', 'Edit'].includes(l)),
      }
    })
    check(
      'a players.view only member reads the register and is offered no write',
      r.rows > 0 && r.writes.length === 0,
      JSON.stringify(r),
    )
    await page.close()
  }

  // And a member without players.view never reaches it: the route guard
  // redirects, which is what a parent actually gets.
  {
    const page = await open('players', 1280, { caps: 'parent' })
    await page.waitForTimeout(200)
    const r = await page.evaluate(() => ({
      table: !!document.querySelector('table.reg-table'),
      cards: !!document.querySelector('.player-card'),
      h1: document.querySelector('h1') ? document.querySelector('h1').textContent : null,
    }))
    check(
      'a member without players.view is redirected rather than shown an empty register',
      !r.table && !r.cards && r.h1 !== 'Registered players',
      JSON.stringify(r),
    )
    await page.close()
  }
}

/* ---- VISUAL-02: the row overflow, and the six remaining dialog files ----
   The claims a screenshot cannot settle: a computed hit height, a focus
   contract, a dismissal contract and a wired error. */

// Did focus come back to THE OPENER, rather than to some other control on the
// page? The first version of this accepted any button or link, which is
// satisfied by focus landing on the wrong row's trigger or on a header action
// the coach never pressed, so it could not fail for the reason it names. The
// entry resolves its own opener (dialogs.mjs), because the two layouts put a
// row action in two different places, and the comparison is identity.
const focusReturned = async (page, d) => {
  const closed = await page.evaluate(() => !document.querySelector('.modal'))
  const opener = await d.opener(page)
  const count = await opener.count()
  const active = await page.evaluate(() => {
    const el = document.activeElement
    return el ? `${el.tagName} ${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 28)}` : null
  })
  if (count !== 1) return { closed, toTheOpener: false, why: `the opener resolves to ${count} controls`, active }
  return {
    closed,
    toTheOpener: await opener.evaluate((el) => el === document.activeElement),
    active,
  }
}

{
  // 2.5: the ROW menu's items reach 44px. They shipped at roughly 37px, which
  // the page header's own overflow already set on itself; the height is the
  // shared .menu-list rule now, so both menus take it. Measured in BOTH
  // layouts, because above 900px the row shows Edit and History beside the
  // trigger and below it the card holds every action in the menu: two
  // different lists through one rule.
  for (const [width, layout] of [
    [1280, 'the table row'],
    [390, 'the card'],
  ]) {
    const page = await open('players', width, { state: 'withdrawn' })
    const WHAT = `every item in ${layout}'s overflow reaches a 44px target`
    if (await openRowMenu(page, DIALOG_PLAYER)) {
      await page.waitForTimeout(150)
      const r = await page.evaluate(() => {
        // NOT .players-more: that is the page header's popup, which already
        // had the height, so reading it would pass whatever a row's did.
        const list = document.querySelector('.menu:not(.players-more) .menu-list')
        if (!list) return null
        const items = [...list.children]
        return {
          labels: items.map((c) => c.textContent.trim()),
          short: items
            .filter((c) => c.getBoundingClientRect().height < 43.5)
            .map((c) => `${c.textContent.trim()} ${Math.round(c.getBoundingClientRect().height)}px`),
        }
      })
      check(WHAT, !!r && r.labels.length > 0 && r.short.length === 0, JSON.stringify(r))
    } else {
      check(WHAT, false, "the row's More actions trigger is not on the page")
    }
    await page.close()
  }

  // A 44px item a thumb cannot land on is not a 44px target. The LAST row's
  // menu is the case: the popup extends the document's own scroll height
  // exactly to its own bottom edge, so scrolled fully down its last item sat
  // under the phone shell's fixed bottom navigation and elementFromPoint
  // returned a nav item. Measured at the two landscape and portrait phone
  // shapes, on the last row, which is the one with nothing below to scroll to.
  //
  // It was already true at the height the row menus shipped with; raising
  // every item to 44px makes the popup 50px taller, so it is fixed here
  // rather than left as something this slice made worse.
  for (const [width, height] of [
    [390, 844],
    [740, 360],
  ]) {
    const page = await open('players', width, { height })
    const WHAT = `the last row's overflow is reachable, once scrolled to, at ${width}x${height}`
    const trigger = page.getByRole('button', { name: /^(More )?[Aa]ctions for / }).last()
    if (!(await acted(trigger, WHAT, 'clicked', async (el) => {
      await el.scrollIntoViewIfNeeded()
      await el.click()
    }))) {
      await page.close()
      continue
    }
    await page.waitForTimeout(200)
    const r = await page.evaluate(() => {
      const list = document.querySelector('.menu:not(.players-more) .menu-list')
      if (!list) return null
      const last = list.lastElementChild
      last.scrollIntoView({ block: 'center' })
      const g = last.getBoundingClientRect()
      const hit = document.elementFromPoint(g.left + g.width / 2, g.top + g.height / 2)
      return {
        last: last.textContent.trim(),
        onScreen: g.top >= 0 && g.bottom <= window.innerHeight,
        reachable: !!hit && (last === hit || last.contains(hit)),
        covering: hit ? `${hit.tagName}.${typeof hit.className === 'string' ? hit.className : ''}` : null,
      }
    })
    check(WHAT, !!r && r.onScreen && r.reachable, JSON.stringify(r))
    await page.close()
  }

  // 2.5 again, inside every dialog: each interactive control reaches 44px.
  // For a checkbox or a radio the LABEL is the target, which is the rule the
  // product already states for the register's own row checkbox, so that is
  // what is measured rather than the 16px box inside it. Run at 390, the
  // phone width the whole rule exists for.
  {
    const tooSmall = []
    const missing = []
    for (const d of DIALOGS) {
      const page = await open('players', 390, { dialog: d })
      const why = await openDialog(page, d)
      if (why) {
        missing.push(`${d.key}: ${why}`)
        await page.close()
        continue
      }
      const small = await page.evaluate(() => {
        const px = (v) => (v.endsWith('px') ? parseFloat(v) : 0)
        const out = []
        for (const el of document.querySelectorAll('.modal button, .modal a, .modal select, .modal textarea, .modal input, .modal summary')) {
          if (el.closest('.sr-only') || el.getAttribute('aria-hidden') === 'true' || el.tabIndex < 0) continue
          const cs = getComputedStyle(el)
          if (cs.display === 'none' || cs.visibility === 'hidden') continue
          const box = el.getBoundingClientRect()
          if (box.width < 1 && box.height < 1) continue
          const isTick = el.tagName === 'INPUT' && (el.type === 'checkbox' || el.type === 'radio')
          const target = isTick ? (el.closest('label') ?? el) : el
          const t = target.getBoundingClientRect()
          const a = getComputedStyle(el, '::after')
          const h = Math.max(t.height, a.content === 'none' ? 0 : px(a.height))
          const w = Math.max(t.width, a.content === 'none' ? 0 : px(a.width))
          if (h < 43.5 || w < 43.5) {
            out.push(`${(el.textContent || el.getAttribute('aria-label') || el.type || el.tagName).trim().slice(0, 20)} ${Math.round(w)}x${Math.round(h)}`)
          }
        }
        return out
      })
      if (small.length) tooSmall.push(`${d.key}: ${small.join(', ')}`)
      await page.close()
    }
    check('every dialog opened, in the state its name claims', missing.length === 0, JSON.stringify(missing))
    check(
      'every interactive control in every dialog reaches a 44px target',
      tooSmall.length === 0,
      JSON.stringify(tooSmall),
    )
  }

  // An enlarged hit area must not steal a neighbour's clicks, INSIDE a
  // dialog. The import preview is the case: seven filter chips wrap onto two
  // rows an 8px gap apart, and each chip's pseudo-element reaches 5px past a
  // 34px chip. The page level version of this check cannot see it, because
  // nothing it opens has a wrapped chip row inside an overlay.
  {
    const d = DIALOGS.find((x) => x.key === 'import-preview')
    for (const width of [390, 1280]) {
      const page = await open('players', width, { dialog: d })
      const why = await openDialog(page, d)
      const WHAT = `no hit area inside the import preview overlaps a neighbouring control at ${width}`
      if (why) {
        check(WHAT, false, why)
        await page.close()
        continue
      }
      const r = await page.evaluate(() => {
        const px = (v) => (v.endsWith('px') ? parseFloat(v) : 0)
        const boxes = [...document.querySelectorAll('.modal .chip, .modal .btn-sm, .modal .icon-btn')].map((el) => {
          const b = el.getBoundingClientRect()
          const a = getComputedStyle(el, '::after')
          const ph = a.content === 'none' ? b.height : Math.max(b.height, px(a.height))
          const pw = a.content === 'none' ? b.width : Math.max(b.width, px(a.width))
          return {
            label: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 14),
            hit: {
              l: b.left - (pw - b.width) / 2,
              r: b.right + (pw - b.width) / 2,
              t: b.top - (ph - b.height) / 2,
              b: b.bottom + (ph - b.height) / 2,
            },
            box: b,
          }
        })
        const clashes = []
        for (const a of boxes) {
          for (const c of boxes) {
            if (a === c) continue
            const ox = Math.min(a.hit.r, c.box.right) - Math.max(a.hit.l, c.box.left)
            const oy = Math.min(a.hit.b, c.box.bottom) - Math.max(a.hit.t, c.box.top)
            if (ox > 0.5 && oy > 0.5) clashes.push(`${a.label} over ${c.label}`)
          }
        }
        return { count: boxes.length, clashes: [...new Set(clashes)] }
      })
      check(WHAT, r.count > 0 && r.clashes.length === 0, JSON.stringify(r))
      await page.close()
    }
  }

  // 2.13: the Modal focus contract, which this slice must PRESERVE. Focus
  // enters the dialog on open, Escape closes it, and focus returns to the
  // control that opened it rather than dropping to the document body. Checked
  // on one dialog per file, and at both widths, because a row action is a
  // button in the table and a menu item on the card, so the opener the modal
  // captures is a different element in each.
  for (const width of [1280, 390]) {
    for (const key of ['add', 'move', 'history', 'export', 'import', 'renew']) {
      const d = DIALOGS.find((x) => x.key === key)
      const page = await open('players', width, { dialog: d })
      const WHAT = `${key}: focus enters the dialog, Escape closes it and focus returns to the opener at ${width}`
      const why = await openDialog(page, d)
      if (why) {
        check(WHAT, false, why)
        await page.close()
        continue
      }
      const entered = await page.evaluate(() => {
        const el = document.activeElement
        return { inside: !!el && !!el.closest('.modal'), what: el ? el.tagName + '.' + el.className : null }
      })
      await page.keyboard.press('Escape')
      await page.waitForTimeout(250)
      const after = await focusReturned(page, d)
      check(WHAT, entered.inside && after.closed && after.toTheOpener, JSON.stringify({ entered, after }))
      await page.close()
    }
  }

  // The other two dismissal routes, on a dialog that is dismissible: the X in
  // the head and a press on the overlay. Escape is checked on six dialogs
  // above; these two are the same contract through different controls, and
  // both must also return focus to the opener.
  // Each route is a guarded action: the X is a control that can be missing,
  // and a press on the coordinates is not. Both go through the same helper so
  // a missing close button is a failed check rather than a run that stops.
  for (const [route, dismiss] of [
    ['the X', (page, what) => acted(page.locator('.modal-head .icon-btn'), what, 'clicked', (el) => el.click())],
    ['a press on the overlay', (page) => page.mouse.click(5, 5).then(() => true)],
  ]) {
    const d = DIALOGS.find((x) => x.key === 'move')
    const page = await open('players', 1280, { dialog: d })
    const WHAT = `${route} closes a dismissible dialog and returns focus to the opener`
    const why = await openDialog(page, d)
    if (why) {
      check(WHAT, false, why)
      await page.close()
      continue
    }
    const dismissed = await dismiss(page, WHAT)
    await page.waitForTimeout(250)
    const r = await focusReturned(page, d)
    check(WHAT, dismissed && r.closed && r.toTheOpener, JSON.stringify(r))
    await page.close()
  }

  // 2.13 again, the half that must NOT move: a dialog whose write is in
  // flight is dismissible by nothing. Escape is inert, the X is disabled and
  // the overlay has no close handler. This is behaviour PLAYERS-01 and the
  // Modal contract own, and presentation work is exactly where it gets lost.
  for (const key of ['add-saving', 'delete-deleting']) {
    const d = DIALOGS.find((x) => x.key === key)
    const page = await open('players', 1280, { dialog: d })
    const WHAT = `${key}: a write in flight cannot be dismissed by Escape, the X or the overlay`
    const why = await openDialog(page, d)
    if (why) {
      check(WHAT, false, why)
      await page.close()
      continue
    }
    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)
    const stillOpen = await page.evaluate(() => !!document.querySelector('.modal'))
    const closeDisabled = await page.evaluate(() => {
      const x = document.querySelector('.modal-head .icon-btn')
      return !!x && x.disabled
    })
    // The overlay: a press on the ground outside the dialog.
    await page.mouse.click(5, 5)
    await page.waitForTimeout(200)
    const afterOverlay = await page.evaluate(() => !!document.querySelector('.modal'))
    check(WHAT, stillOpen && closeDisabled && afterOverlay, JSON.stringify({ stillOpen, closeDisabled, afterOverlay }))
    await page.close()
  }

  // 2.6: an error sets the border AND renders a message AND wires
  // aria-invalid and aria-describedby. The shirt field used to do the last
  // two by hand beside a paragraph of its own; it is the Field primitive's
  // now, and what matters is that all three still hold together.
  {
    const d = DIALOGS.find((x) => x.key === 'add-invalid')
    const page = await open('players', 1280, { dialog: d })
    const WHAT = 'an invalid shirt number sets the danger border, a message and aria-describedby'
    const why = await openDialog(page, d)
    if (why) check(WHAT, false, why)
    else {
      const r = await page.evaluate(() => {
        const el = document.querySelector('.modal input[aria-invalid="true"]')
        if (!el) return null
        const id = el.getAttribute('aria-describedby')
        const msg = id && document.getElementById(id.split(' ')[0])
        return {
          border: getComputedStyle(el).borderTopColor,
          message: msg ? msg.textContent.trim() : null,
          announced: !!msg && !!msg.querySelector('[role="alert"]'),
        }
      })
      check(
        WHAT,
        !!r && r.border === 'rgb(198, 40, 40)' && !!r.message && r.announced,
        JSON.stringify(r),
      )
    }
    await page.close()
  }

  // The typed confirmation on the single player delete, which is an
  // irreversible action's only gate. Presentation moved the instruction into
  // a real <label>; deleteConfirmed still decides, and the control stays
  // inert until the name matches.
  {
    const d = DIALOGS.find((x) => x.key === 'delete')
    const page = await open('players', 1280, { dialog: d })
    const WHAT = 'the single player delete stays inert until the name is typed exactly'
    const why = await openDialog(page, d)
    if (why) check(WHAT, false, why)
    else {
      const confirm = page.locator('.modal').getByRole('button', { name: 'Delete permanently', exact: true })
      const field = page.locator('.modal').getByLabel(/^To confirm, type/)
      const closed = await confirm.isDisabled()
      const partialTyped = await typed(field, 'Aria Bexley', WHAT)
      await page.waitForTimeout(120)
      const partial = await confirm.isDisabled()
      const fullTyped = partialTyped && (await typed(field, DIALOG_PLAYER, WHAT))
      await page.waitForTimeout(120)
      const armed = fullTyped && (await confirm.isEnabled())
      const danger = await page.evaluate(() => {
        const b = [...document.querySelectorAll('.modal button')].find((x) => x.textContent.trim() === 'Delete permanently')
        return b ? { cls: b.className, word: /Delete/.test(b.textContent) } : null
      })
      check(
        WHAT,
        closed && partial && armed && !!danger && danger.cls.includes('btn-danger') && danger.word,
        JSON.stringify({ closed, partial, armed, danger }),
      )
    }
    await page.close()
  }

  // The import preview's two inline controls are a pressed pair, so the
  // choice is exposed rather than being a fill alone, and both still disable
  // while a confirm is in flight.
  {
    const d = DIALOGS.find((x) => x.key === 'import-preview')
    const page = await open('players', 1280, { dialog: d })
    const WHAT = 'a needs-your-choice row exposes its choice with aria-pressed, not a fill alone'
    const why = await openDialog(page, d)
    if (why) check(WHAT, false, why)
    else {
      const before = await page.evaluate(() =>
        [...document.querySelectorAll('.ip-choice button')].map((b) => `${b.textContent.trim()}=${b.getAttribute('aria-pressed')}`),
      )
      await pressed(page.locator('.ip-choice').getByRole('button', { name: 'Skip', exact: true }), WHAT)
      await page.waitForTimeout(150)
      const after = await page.evaluate(() =>
        [...document.querySelectorAll('.ip-choice button')].map((b) => `${b.textContent.trim()}=${b.getAttribute('aria-pressed')}`),
      )
      check(
        WHAT,
        before.length === 2 &&
          before.every((s) => s.endsWith('=false')) &&
          after.includes('Skip=true') &&
          after.includes('Import as new=false'),
        JSON.stringify({ before, after }),
      )
    }
    await page.close()
  }
}

/* ---- VISUAL-02: the club wide Activity feed --------------------------
   Its acceptance is the CSS only row to card reflow, the desktop inline
   filters against the phone filter dialog, Load more, the empty states and
   long names. Every one of those is a computed style or a live interaction,
   which is why they are here rather than in a static test.

   The privacy boundary is checked here too, and deliberately in the browser:
   the identity map the page holds is what the History dialog's title is built
   from, so the only way to prove a name reaches the dialog and NOT the feed is
   to open the dialog and read both. */
{
  // The whole point of the reflow: one list, two presentations, the same
  // information and the same actions at every width.
  {
    const rowAt = async (width) => {
      const page = await open('activity', width, { awaitSelector: '.activity-item' })
      const r = await page.evaluate(() => {
        // Every read is guarded. getComputedStyle throws on null, so a missing
        // control here ends the run rather than failing this check, which is
        // the shape that keeps coming back in this file.
        const style = (sel) => {
          const el = document.querySelector(sel)
          return el ? getComputedStyle(el) : null
        }
        const item = document.querySelector('.activity-item')
        const cs = item ? getComputedStyle(item) : null
        return {
          columns: cs ? cs.gridTemplateColumns.split(' ').length : 0,
          card: cs ? parseFloat(cs.borderTopWidth) > 0 : false,
          inlineFilters: style('.activity-filters')?.display ?? null,
          filtersButton: style('.activity-filters-btn')?.display ?? null,
          // What the row SAYS and what it OFFERS, so the two presentations can
          // be compared rather than assumed equivalent.
          text: item ? item.innerText.replace(/\s+/g, ' ').trim() : '',
          controls: item ? [...item.querySelectorAll('button, a')].map((e) => e.textContent.trim()).join('|') : '',
          fields: document.querySelectorAll('.activity-filters .field').length,
        }
      })
      await page.close()
      return r
    }
    const wide = await rowAt(901)
    const narrow = await rowAt(900)
    check(
      'the row becomes a card at 900 and back to a row at 901, by CSS alone',
      wide.columns === 3 && !wide.card && narrow.columns === 1 && narrow.card,
      JSON.stringify({ wide: [wide.columns, wide.card], narrow: [narrow.columns, narrow.card] }),
    )
    check(
      'the inline filters and the Filters button swap at the same boundary, never both',
      wide.inlineFilters !== 'none' && wide.filtersButton === 'none' &&
        narrow.inlineFilters === 'none' && narrow.filtersButton !== 'none',
      JSON.stringify({ wide: [wide.inlineFilters, wide.filtersButton], narrow: [narrow.inlineFilters, narrow.filtersButton] }),
    )
    check(
      'the card carries the same words and the same actions as the row',
      wide.text === narrow.text && wide.controls === narrow.controls && wide.controls.length > 0,
      JSON.stringify({ wide: wide.text, narrow: narrow.text, controls: wide.controls }),
    )
    check('the desktop bar offers all eight filters', wide.fields === 8, String(wide.fields))
  }

  // The phone filter dialog: the same controls, the same state, and the shared
  // Modal's focus contract. A second set of controls that did not drive the
  // page's own filters would look identical in a screenshot.
  {
    const page = await open('activity', 390, { awaitSelector: '.activity-item' })
    const opener = page.getByRole('button', { name: /^Filters/ })
    const openedIt = await pressed(opener, 'the phone Filters button opens a dialog')
    await page.waitForTimeout(200)
    const opened = await page.evaluate(() => {
      const m = document.querySelector('.modal')
      return m
        ? {
            role: m.getAttribute('role'),
            focusInside: m.contains(document.activeElement),
            fields: m.querySelectorAll('.field').length,
            title: m.querySelector('h3, h2')?.textContent,
          }
        : null
    })
    check(
      'the phone Filters dialog is the shared Modal, holds all eight filters and takes focus',
      !!opened && opened.role === 'dialog' && opened.fields === 8 && opened.focusInside,
      JSON.stringify(opened),
    )

    // Driving a control in the dialog moves the PAGE's filter state. Every
    // action from here is guarded and conditional on the one before it: a
    // press that failed leaves a control that a later action would wait for
    // and then reject on, which ends the run rather than failing its own
    // check.
    const before = await page.$$eval('.activity-item', (e) => e.length)
    const set = openedIt &&
      (await chose(
        page.locator('.modal').getByLabel('Filter by entity type'),
        'season',
        'a filter chosen in the dialog narrows the feed and is counted on the opener',
      ))
    await page.waitForTimeout(250)
    const narrowed = await page.$$eval('.activity-item', (e) => e.length)
    if (set) {
      await pressed(page.locator('.modal').getByRole('button', { name: 'Done', exact: true }), 'Done closes the filter dialog')
    }
    await page.waitForTimeout(250)
    const after = await page.evaluate(() => ({
      open: !!document.querySelector('.modal'),
      label: document.querySelector('.activity-filters-btn')?.getAttribute('aria-label'),
      text: document.querySelector('.activity-filters-btn')?.textContent,
      rows: document.querySelectorAll('.activity-item').length,
      // Capped, and never the whole document: when nothing is focused the
      // active element is <body>, and printing its text buries the failure
      // it is attached to under the entire page.
      focused: (document.activeElement.textContent ?? '').trim().slice(0, 40),
    }))
    check(
      'a filter chosen in the dialog narrows the feed and is counted on the opener',
      set && narrowed > 0 && narrowed < before && !after.open && after.rows === narrowed &&
        after.label === 'Filters, 1 active' && after.text.includes('(1)'),
      JSON.stringify({ before, narrowed, after }),
    )
    check('Done returns focus to the Filters button', after.focused.startsWith('Filters'), after.focused)
    await page.close()
  }

  // Escape closes it and returns focus, and Tab is trapped inside it. All
  // three are the Modal contract the page inherits rather than reimplements,
  // and all three are the reason the overlay is a Modal rather than a second
  // panel that happens to look like one.
  {
    const page = await open('activity', 390, { awaitSelector: '.activity-item' })
    await pressed(page.getByRole('button', { name: /^Filters/ }), 'Tab is trapped inside the filter dialog')
    await page.waitForTimeout(200)
    // Enough presses to run past the dialog's own controls twice over: the
    // close button, eight fields and the footer. If the trap is missing, focus
    // walks out into the page behind it.
    const escaped = []
    for (let i = 0; i < 16; i++) {
      await page.keyboard.press('Tab')
      const inside = await page.evaluate(() => {
        const m = document.querySelector('.modal')
        return !!m && m.contains(document.activeElement)
      })
      if (!inside) escaped.push(await page.evaluate(() => document.activeElement.outerHTML.slice(0, 60)))
    }
    check('Tab is trapped inside the filter dialog', escaped.length === 0, JSON.stringify(escaped.slice(0, 2)))
    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)
    const closed = await page.evaluate(() => ({
      gone: !document.querySelector('.modal'),
      // Capped, and never the whole document: when nothing is focused the
      // active element is <body>, and printing its text buries the failure
      // it is attached to under the entire page.
      focused: (document.activeElement.textContent ?? '').trim().slice(0, 40),
    }))
    check(
      'Escape closes the filter dialog and focus returns to the opener',
      closed.gone && closed.focused.startsWith('Filters'),
      JSON.stringify(closed),
    )
    await page.close()
  }

  // Every filter control has an accessible name and a real label bound to it,
  // in BOTH mount points at once, which is the arrangement that made this hard
  // before: the same component renders in the inline bar and in the overlay,
  // and both are in the document below the breakpoint.
  {
    const page = await open('activity', 390, { awaitSelector: '.activity-item' })
    await pressed(page.getByRole('button', { name: /^Filters/ }), 'every filter control is labelled in both mount points')
    await page.waitForTimeout(250)
    const r = await page.evaluate(() => {
      const controls = [...document.querySelectorAll('.activity-filter-grid input, .activity-filter-grid select')]
      const ids = controls.map((c) => c.id)
      const unlabelled = controls.filter((c) => {
        const bound = c.id && document.querySelector(`label[for="${CSS.escape(c.id)}"]`)
        const named = c.getAttribute('aria-label') || (bound && bound.textContent.trim())
        return !bound || !named
      })
      return {
        count: controls.length,
        unique: new Set(ids).size,
        blank: ids.filter((i) => !i).length,
        unlabelled: unlabelled.map((c) => c.outerHTML.slice(0, 50)),
      }
    })
    check(
      'both copies of the filters are fully labelled, with ids that do not collide',
      r.count === 16 && r.unique === 16 && r.blank === 0 && r.unlabelled.length === 0,
      JSON.stringify(r),
    )
    await page.close()
  }

  // Clear filters from the phone overlay has to clear BOTH halves of the
  // filter state: the page state and the URL persisted batch. Clearing only
  // the half the dialog can see would leave the feed narrowed with nothing
  // saying so.
  {
    const WHAT = 'Clear filters in the overlay clears the page state AND the URL batch'
    const page = await open('activity', 390, { at: 'batch', awaitSelector: '.activity-item' })
    // Read through evaluate rather than off a locator: a locator's
    // getAttribute waits for an element that may not be there and rejects,
    // where a query inside the page answers null and the check fails.
    const state = () =>
      page.evaluate(() => ({
        open: !!document.querySelector('.modal'),
        rows: document.querySelectorAll('.activity-item').length,
        note: !!document.querySelector('.activity-filter-note'),
        label: document.querySelector('.activity-filters-btn')?.getAttribute('aria-label') ?? null,
      }))
    const start = await state()
    const openedIt = await pressed(page.getByRole('button', { name: /^Filters/ }), WHAT)
    await page.waitForTimeout(200)
    const set = openedIt && (await chose(page.locator('.modal').getByLabel('Filter by source'), 'csv_import', WHAT))
    await page.waitForTimeout(200)
    const two = (await state()).label
    if (set) {
      await pressed(page.locator('.modal').getByRole('button', { name: 'Clear filters', exact: true }), WHAT)
    }
    await page.waitForTimeout(300)
    const end = await state()
    check(
      'the batch deep link narrows the feed, is counted, and is announced as a Note',
      start.note && start.rows > 0 && start.rows < 50 && start.label === 'Filters, 1 active',
      JSON.stringify(start),
    )
    check('a second filter beside the batch link is counted with it', two === 'Filters, 2 active', String(two))
    check(
      WHAT,
      set && !end.open && !end.note && end.label === 'Filters' && end.rows === 50,
      JSON.stringify(end),
    )
    await page.close()
  }

  // Load more, in both of its states, pressed rather than drawn.
  {
    const page = await open('activity', 1280, { awaitSelector: '.activity-item' })
    const first = await page.$$eval('.activity-item', (e) => e.length)
    await pressed(page.getByRole('button', { name: 'Load more', exact: true }), 'Load more appends the next page')
    await page.waitForTimeout(300)
    const second = await page.evaluate(() => ({
      rows: document.querySelectorAll('.activity-item').length,
      more: !!document.querySelector('.activity-more'),
    }))
    check(
      'Load more appends the next page and then stops offering itself',
      first === 50 && second.rows === 62 && !second.more,
      JSON.stringify({ first, second }),
    )
    await page.close()
  }
  {
    const page = await open('activity', 1280, { state: 'loadingmore', awaitSelector: '.activity-item' })
    await pressed(page.getByRole('button', { name: 'Load more', exact: true }), 'Load more disables itself while a page is in flight')
    await page.waitForTimeout(300)
    const inflight = await page.evaluate(() => {
      const b = document.querySelector('.activity-more button')
      const live = document.querySelector('[aria-live="polite"]')
      // Both queries are guarded, not just the first: the ternary covered the
      // button and then dereferenced the live region regardless. Codex.
      return b ? { label: b.textContent.trim(), disabled: b.disabled, busy: live?.getAttribute('aria-busy') ?? null } : null
    })
    check(
      'Load more disables itself and says so while a page is in flight',
      !!inflight && inflight.disabled && inflight.label === 'Loading…' && inflight.busy === 'true',
      JSON.stringify(inflight),
    )
    await page.close()
  }

  /* ---- the information boundary, in the browser ---- */
  // The page holds ONE child name, for the History dialog's title. It must
  // reach the dialog and nothing else. A static test can assert the feed is
  // clean; only a driven browser can assert that the name a coach CAN see is
  // reachable exactly where it is meant to be.
  {
    const page = await open('activity', 1280, { state: 'history', awaitSelector: '.activity-item' })
    const feed = await page.evaluate(() => document.body.innerText)
    await pressed(page.getByRole('button', { name: 'View history', exact: true }).first(), 'View history opens the gated dialog')
    await page.waitForTimeout(300)
    const opened = await page.evaluate(() => {
      const m = document.querySelector('.modal')
      return m
        ? {
            title: m.querySelector('.modal-head h3')?.textContent,
            sub: m.querySelector('.modal-head p')?.textContent,
            rows: m.querySelectorAll('.history-item').length,
          }
        : null
    })
    check(
      'the feed names no child, and View history opens the dialog that does',
      !feed.includes('Bexley') && !!opened && opened.title === 'History' &&
        opened.sub === 'Aria Bexley-Thornton' && opened.rows > 0,
      JSON.stringify({ feedHadName: feed.includes('Bexley'), opened }),
    )
    await page.close()
  }

  // audit.view without players.view. The two are different boundaries: the
  // feed renders in full, and every player reference falls closed to a neutral
  // label with no history offered and no deletion claimed.
  //
  // Read from the entity CELLS, not from the page text. A body text search for
  // "Player" is satisfied by the description "Player deleted", so it would have
  // held with every player reference removed. Codex.
  //
  // And compared ROW BY ROW, not as totals. Aggregate counts are unchanged by a
  // regression that labels a live child deleted and the deleted child live, so
  // the totals would match while the coach's feed named the wrong row. Codex
  // again. The identity is per cell: a reference a holder of both capabilities
  // sees as "Player" or "Deleted player" is the neutral "Player" for the
  // auditor, and every other reference is the same string for both.
  {
    const cells = async (caps) => {
      const page = await open('activity', 1280, { caps, awaitSelector: '.activity-item' })
      const r = await page.evaluate(() => ({
        rows: document.querySelectorAll('.activity-item').length,
        // Per ROW, so a cell is compared against the cell of the same event
        // rather than against the same position in a flat list. An event with
        // no reference contributes an empty string, which keeps the rows
        // aligned when one of them stops rendering a cell at all.
        entities: [...document.querySelectorAll('.activity-item')].map(
          (item) => item.querySelector('.activity-entity')?.textContent.trim() ?? '',
        ),
        history: [...document.querySelectorAll('.activity-item')].map(
          (item) => (item.querySelector('.activity-actions .btn')?.textContent.trim() ?? ''),
        ),
        name: document.body.innerText.includes('Bexley'),
      }))
      await page.close()
      return r
    }
    const both = await cells('coach')
    const audit = await cells('auditor')
    const PLAYER = new Set(['Player', 'Deleted player'])
    const wrong = both.entities
      .map((label, i) => {
        const seen = audit.entities[i]
        const want = PLAYER.has(label) ? 'Player' : label
        return seen === want ? null : `row ${i}: ${label} -> ${seen}, wanted ${want}`
      })
      .filter(Boolean)
    // The identity above collapses "Player" and "Deleted player" into one
    // answer, which is correct and is exactly why it cannot see the two swap
    // places. So the COACH's own row is asserted as a pair: the row that offers
    // View history is the row whose reference is the neutral "Player", and a
    // row that says a child was deleted offers nothing to open.
    const mispaired = both.entities
      .map((label, i) => {
        const history = both.history[i] === 'View history'
        if (history && label !== 'Player') return `row ${i}: View history beside "${label}"`
        if (label === 'Deleted player' && history) return `row ${i}: a deleted player with a history button`
        return null
      })
      .filter(Boolean)
    check(
      'audit.view without players.view reads the feed but names, resolves and deletes nothing',
      audit.rows === both.rows && audit.entities.length === both.entities.length &&
        // The coach's feed really does carry both kinds, or the identity below
        // would hold over a feed that has nothing to fall closed.
        both.entities.includes('Player') && both.entities.includes('Deleted player') &&
        both.history.includes('View history') &&
        wrong.length === 0 && mispaired.length === 0 &&
        audit.history.every((label) => label === '') &&
        !audit.name && !both.name,
      JSON.stringify({
        rows: both.rows,
        wrong: wrong.slice(0, 3),
        mispaired: mispaired.slice(0, 3),
        auditHistory: audit.history.filter(Boolean).length,
      }),
    )
  }

  // And without audit.view the route guard answers, not the page.
  {
    const page = await open('activity', 1280, { caps: 'viewer', state: 'guarded' })
    // Both halves. An absence alone is satisfied by a blank shell, a redirect
    // to the wrong route and a guard returning null, so the claim is that
    // Activity is gone AND the redirect landed on `/`. Codex.
    //
    // The landing is read from the harness's route witness rather than from
    // anything the page draws. Home has capability variants of its own (a
    // member without sessions.create gets ParentHome, with no hero), and
    // screenFromPath falls back to 'home' for a path it does not know, so both
    // the body and the navigation can say Home for a route that is not.
    const r = await page.evaluate(() => ({
      path: document.querySelector('.content')?.getAttribute('data-path') ?? '',
      heading: document.querySelector('h1')?.textContent ?? '',
      feed: !!document.querySelector('.activity-list'),
      filters: !!document.querySelector('.activity-filters-btn'),
    }))
    check(
      'a member without audit.view is redirected off Activity onto Home',
      r.path === '/' && r.heading !== 'Activity' && !r.feed && !r.filters,
      JSON.stringify(r),
    )
    await page.close()
  }

  /* ---- long names, the narrow phone, and the focus ring ---- */
  {
    for (const width of [360, 390, 1280]) {
      const page = await open('activity', width, { state: 'longnames', awaitSelector: '.activity-item' })
      const r = await page.evaluate(() => {
        const doc = document.documentElement
        // A run of text wider than the box that paints it is a clip, whether
        // the overflow is hidden or simply painted outside the card.
        const clipped = []
        for (const el of document.querySelectorAll('.activity-item *')) {
          if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0) clipped.push(el.className + ' ' + el.scrollWidth + '>' + el.clientWidth)
        }
        // Guarded: a feed with no rows makes this a failing check rather than
        // a throw inside evaluate, which ends the run.
        const first = document.querySelector('.activity-item')
        const card = first ? first.getBoundingClientRect() : null
        const overflowing = card
          ? [...document.querySelectorAll('.activity-item *')]
              .filter((el) => el.getBoundingClientRect().right > card.right + 1)
              .map((el) => el.className)
          : ['no rows']
        return {
          page: doc.scrollWidth - doc.clientWidth,
          clipped: clipped.slice(0, 4),
          overflowing: overflowing.slice(0, 4),
          longActor: document.body.innerText.includes('Fotheringay-Wallington-Smythe'),
          longTeam: document.body.innerText.includes('Development Squad Under Nines'),
          // The one that actually exercises the wrapping rules: a name with
          // no space in it has no break opportunity, so it is the only string
          // that can push a reference past the card that holds it.
          unbroken: document.body.innerText.includes('OssettTownJuniorsDevelopmentSquadUnderNines'),
        }
      })
      check(
        `a long actor and a long entity name wrap rather than clip or overflow at ${width}`,
        r.page === 0 && r.clipped.length === 0 && r.overflowing.length === 0 && r.longActor && r.longTeam && r.unbroken,
        JSON.stringify(r),
      )
      await page.close()
    }
  }

  // Every control the feed offers reaches 44 by 44, including the batch link,
  // whose visible pill is 18px tall and whose hit area is a pseudo-element.
  // The unfiltered feed, because it is the only view that offers Load more.
  {
    const page = await open('activity', 390, { awaitSelector: '.activity-more' })
    const r = await page.evaluate(() => {
      const px = (v) => (v.endsWith('px') ? parseFloat(v) : 0)
      const measure = (sel) => {
        const el = document.querySelector(sel)
        if (!el) return { sel, missing: true }
        const b = el.getBoundingClientRect()
        const a = getComputedStyle(el, '::after')
        const h = a.content === 'none' ? b.height : Math.max(b.height, px(a.height))
        const w = a.content === 'none' ? b.width : Math.max(b.width, px(a.width))
        return { sel, w: Math.round(w), h: Math.round(h) }
      }
      return ['a.activity-batch', '.activity-actions .btn', '.activity-more .btn', '.activity-filters-btn'].map(measure)
    })
    check(
      'every control the feed offers reaches a 44px hit area',
      r.every((x) => !x.missing && x.w >= 44 && x.h >= 44),
      JSON.stringify(r),
    )
    await page.close()
  }

  // Keyboard order and a visible ring on the two controls a row offers.
  {
    const page = await open('activity', 1280, { at: 'batch', awaitSelector: '.activity-item' })
    const ring = async (sel) => {
      await focused(page.locator(sel).first(), `${sel} shows a focus ring`)
      return page.evaluate((s) => {
        const el = document.querySelector(s)
        if (!el) return { width: '0px', style: 'none', colour: '', focused: false }
        const cs = getComputedStyle(el)
        return { width: cs.outlineWidth, style: cs.outlineStyle, colour: cs.outlineColor, focused: document.activeElement === el }
      }, sel)
    }
    for (const sel of ['a.activity-batch', '.activity-actions .btn', '.activity-filters .field select']) {
      const r = await ring(sel)
      check(
        `${sel} draws the shared focus ring`,
        r.focused && r.style === 'solid' && parseFloat(r.width) >= 2,
        JSON.stringify(r),
      )
    }
    // Tab order follows visual order. Asserted over ONE row that carries both
    // controls, as the exact list in document order and as geometry: an
    // assertion that a row has at least one control passes while the two swap
    // or one disappears, which is the regression this is named for. Codex.
    const order = await page.evaluate(() => {
      const row = [...document.querySelectorAll('.activity-item')].find(
        (r) => r.querySelector('a.activity-batch') && r.querySelector('.activity-actions .btn'),
      )
      if (!row) return null
      const els = [...row.querySelectorAll('a, button')]
      if (els.length !== 2) return { labels: els.map((e) => e.textContent.trim()), visualFirst: false }
      const [a, b] = els.map((e) => e.getBoundingClientRect())
      // Reading order: entirely above, OR sharing a line and to the left. The
      // left comparison has to be CONDITIONAL on sharing a line, or a control
      // painted lower down but further left still counts as first. Codex.
      const sharesALine = a.top < b.bottom && b.top < a.bottom
      return {
        labels: els.map((e) => e.textContent.trim()),
        visualFirst: a.bottom <= b.top + 1 || (sharesALine && a.left < b.left),
        boxes: [a, b].map((r) => [Math.round(r.top), Math.round(r.left), Math.round(r.bottom)]),
      }
    })
    check(
      'a row exposes its batch link before its action, in document order and on screen',
      !!order && JSON.stringify(order.labels) === JSON.stringify(['Batch', 'View history']) && order.visualFirst,
      JSON.stringify(order),
    )
    await page.close()
  }

  // The empty states are two different screens, and only one offers a way out.
  {
    const bare = await open('activity', 390, { state: 'empty', awaitSelector: '.empty' })
    const b = await bare.evaluate(() => ({
      title: document.querySelector('.empty h3')?.textContent ?? null,
      action: !!document.querySelector('.empty .btn'),
    }))
    await bare.close()
    const filtered = await open('activity', 390, { state: 'empty', at: 'batch', awaitSelector: '.empty' })
    const f = await filtered.evaluate(() => ({
      title: document.querySelector('.empty h3')?.textContent ?? null,
      action: document.querySelector('.empty .btn')?.textContent.trim(),
      note: !!document.querySelector('.activity-filter-note'),
    }))
    check(
      'the two empty states differ, and only the filtered one offers Clear filters',
      b.title === 'No activity yet.' && !b.action &&
        f.title === 'No activity in this range.' && f.action === 'Clear filters' && f.note,
      JSON.stringify({ b, f }),
    )
    // And pressing it inside the empty state clears the URL batch too.
    await pressed(filtered.getByRole('button', { name: 'Clear filters', exact: true }), 'the empty state clears the URL batch')
    await filtered.waitForTimeout(300)
    const cleared = await filtered.evaluate(() => ({
      note: !!document.querySelector('.activity-filter-note'),
      label: document.querySelector('.activity-filters-btn')?.getAttribute('aria-label') ?? null,
    }))
    check(
      'Clear filters in the empty state clears the URL batch as well',
      !cleared.note && cleared.label === 'Filters',
      JSON.stringify(cleared),
    )
    await filtered.close()
  }

  // The narrow phone, on the ordinary feed rather than only on the long name
  // case: no page level horizontal scroll, and nothing painted outside the
  // card that contains it. 360 is the width SessionRegister.css already
  // designs for and the rest of the product did not.
  {
    for (const [width, at] of [
      [360, undefined],
      [390, undefined],
      [360, 'batch'],
      [430, undefined],
    ]) {
      const page = await open('activity', width, { at, awaitSelector: '.activity-item' })
      const r = await page.evaluate(() => {
        const doc = document.documentElement
        const out = []
        for (const item of document.querySelectorAll('.activity-item')) {
          const box = item.getBoundingClientRect()
          for (const el of item.querySelectorAll('*')) {
            const b = el.getBoundingClientRect()
            if (b.width === 0) continue
            if (b.right > box.right + 1 || b.left < box.left - 1) out.push(el.className || el.tagName)
            if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0) out.push('clipped:' + (el.className || el.tagName))
          }
        }
        return { page: doc.scrollWidth - doc.clientWidth, out: [...new Set(out)].slice(0, 4) }
      })
      check(
        `the feed neither scrolls the page nor paints outside a card at ${width}${at ? ' (' + at + ')' : ''}`,
        r.page === 0 && r.out.length === 0,
        JSON.stringify(r),
      )
      await page.close()
    }
  }

  // Loading, error and empty must not look alike. Measured rather than read:
  // this is the regression 2.14 exists to stop.
  {
    const shape = async (state) => {
      const page = await open('activity', 1280, { state })
      const r = await page.evaluate(() => ({
        skeleton: !!document.querySelector('.skeleton-list'),
        error: !!document.querySelector('.state-error[role="alert"]'),
        empty: !!document.querySelector('.empty'),
        retry: [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Retry'),
      }))
      await page.close()
      return r
    }
    const loading = await shape('loading')
    const failed = await shape('error')
    const empty = await shape('empty')
    check(
      'loading, error and empty are three different treatments',
      loading.skeleton && !loading.error && !loading.empty &&
        failed.error && failed.retry && !failed.skeleton && !failed.empty &&
        empty.empty && !empty.skeleton && !empty.error,
      JSON.stringify({ loading, failed, empty }),
    )
  }
}

/* ---- VISUAL-02: the Account screen ------------------------------------
   The self service surface. Its acceptance is forms, avatar upload and the
   success and error outcomes, so what is measured here is what a screenshot
   cannot settle: the hit areas, the label bindings, the keyboard order, and
   where FOCUS ends up when a successful write removes or disables the control
   that had it. That last one is the defect this slice found: three of the
   four successes on this page emptied a field or unmounted a button while the
   coach's focus was on it, which drops focus to the document body.

   Every outcome here is DRIVEN through tools/visual/account.mjs, the same
   entries shoot.mjs photographs, so a control that stops rendering fails the
   run rather than producing a plausible measurement. */
{
  const flowOf = (key) => ACCOUNT_FLOWS.find((f) => f.key === key)

  // Every control a coach can press, at the narrowest width and the widest.
  // The admin set is used because it renders the most controls: four
  // destination rows rather than three, and one of those rows was 39px tall
  // before this slice.
  for (const width of [360, 1280]) {
    const page = await open('account', width, { caps: 'clubadmin' })
    const r = page.blank
      ? null
      : await page.evaluate(() => {
          const short = []
          const px = (v) => (v.endsWith('px') ? parseFloat(v) : 0)
          const controls = [
            ...document.querySelectorAll('.account button, .account select, .account input:not([type="file"])'),
          ]
          for (const el of controls) {
            const b = el.getBoundingClientRect()
            // The hidden file picker has no box at all; it is reached through
            // its visible button, which is measured like every other control.
            if (b.width === 0 && b.height === 0) continue
            const a = getComputedStyle(el, '::after')
            const h = a.content === 'none' ? b.height : Math.max(b.height, px(a.height))
            const w = a.content === 'none' ? b.width : Math.max(b.width, px(a.width))
            if (h < 44 || w < 44) {
              const name = (el.textContent || el.getAttribute('aria-label') || el.id || el.tagName).trim()
              short.push(`${name.slice(0, 24)} ${Math.round(w)}x${Math.round(h)}`)
            }
          }
          return { count: controls.length, short }
        })
    check(
      `every Account control reaches a 44px target at ${width}`,
      !!r && r.count > 0 && r.short.length === 0,
      JSON.stringify(r),
    )
    await page.close()
  }

  // The narrow phone, including the state where every string the club chooses
  // is as long as a club would really make it. No page level horizontal
  // scroll, and nothing painted outside the card that contains it.
  for (const [width, state] of [
    [360, undefined],
    [390, undefined],
    [430, undefined],
    [900, undefined],
    [360, 'longvalues'],
    [390, 'longvalues'],
    [1280, 'longvalues'],
  ]) {
    for (const theme of ['light', 'dark']) {
      const page = await open('account', width, { state, theme, caps: 'clubadmin' })
      const r = page.blank
        ? null
        : await page.evaluate(() => {
            const doc = document.documentElement
            const out = []
            for (const card of document.querySelectorAll('.account-section')) {
              const box = card.getBoundingClientRect()
              for (const el of card.querySelectorAll('*')) {
                const b = el.getBoundingClientRect()
                if (b.width === 0) continue
                if (b.right > box.right + 1 || b.left < box.left - 1) out.push(el.className || el.tagName)
                // A form control scrolls or truncates its own value by
                // specification: a select ellipsises a long option and a text
                // field scrolls a value longer than its box. Neither is copy
                // the layout failed to fit. Everything else that scrolls
                // inside itself is.
                const owns = el.tagName === 'SELECT' || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA'
                if (!owns && el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0) {
                  out.push('clipped:' + (el.className || el.tagName))
                }
              }
            }
            return { page: doc.scrollWidth - doc.clientWidth, out: [...new Set(out)].slice(0, 4) }
          })
      check(
        `Account neither scrolls the page nor paints outside a card at ${width}${state ? ' (' + state + ')' : ''}, ${theme}`,
        !!r && r.page === 0 && r.out.length === 0,
        JSON.stringify(r),
      )
      await page.close()
    }
  }

  // Every visible label is bound to a control that exists, and every control
  // is named by one. A styled span beside a field is what this catches, and
  // it is the shape the Activity filters shipped with.
  {
    const page = await open('account', 1280, { caps: 'clubadmin' })
    const r = page.blank
      ? null
      : await page.evaluate(() => {
          const orphans = []
          for (const label of document.querySelectorAll('.account label')) {
            const to = label.getAttribute('for')
            const target = to ? document.getElementById(to) : null
            if (!target) orphans.push((label.textContent || '').trim())
          }
          const unnamed = []
          for (const el of document.querySelectorAll('.account input:not([type="file"]), .account select')) {
            const lab = el.id ? document.querySelector(`label[for="${el.id}"]`) : null
            const named = (lab ? (lab.textContent || '').trim() : '') || el.getAttribute('aria-label') || ''
            if (!named) unnamed.push(el.id || el.tagName)
          }
          // The picker is opened by a button and is never a control on its
          // own, so it must be out of the tab order rather than an unlabelled
          // field a keyboard lands on.
          const picker = document.querySelector('.account input[type="file"]')
          const reachable = picker ? picker.getBoundingClientRect().height > 0 : false
          return { orphans, unnamed, reachable, labels: document.querySelectorAll('.account label').length }
        })
    check(
      'every Account label is bound to a control, every control is named, and the file picker is not in the tab order',
      !!r && r.labels >= 5 && r.orphans.length === 0 && r.unnamed.length === 0 && !r.reachable,
      JSON.stringify(r),
    )
    await page.close()
  }

  /* The Security forms open inert, and stay inert until BOTH halves of each
     are typed. A submit that arms on one password would send an unconfirmed
     one, and a screenshot of an untouched form cannot tell an inert control
     from an active one. */
  {
    const page = await open('account', 1280)
    const submit = (label) => page.getByRole('button', { name: label, exact: true })
    const inert = async (label) => ((await submit(label).count()) ? submit(label).first().isDisabled() : null)
    const WHAT = 'the Security submits are inert until their form is complete'
    const steps = { emptyPassword: await inert('Change password'), emptyEmail: await inert('Change email') }
    if (await typed(page.getByLabel('New password', { exact: true }), 'a-long-enough-passphrase', WHAT)) {
      await page.waitForTimeout(120)
      steps.oneOfTwo = await inert('Change password')
      if (await typed(page.getByLabel('Confirm password', { exact: true }), 'a-long-enough-passphrase', WHAT)) {
        await page.waitForTimeout(120)
        steps.bothTyped = await inert('Change password')
      }
    }
    if (await typed(page.getByLabel('New email', { exact: true }), 'new.coach@example.invalid', WHAT)) {
      await page.waitForTimeout(120)
      steps.emailTyped = await inert('Change email')
    }
    check(
      WHAT,
      steps.emptyPassword === true &&
        steps.emptyEmail === true &&
        steps.oneOfTwo === true &&
        steps.bothTyped === false &&
        steps.emailTyped === false,
      JSON.stringify(steps),
    )
    await page.close()
  }

  /* Two frozen behaviours on the name row, neither of which a screenshot can
     show: Enter saves, and Save is armed only by a MEANINGFUL change. Blank,
     unchanged and unchanged-with-padding all leave it inert, which is what
     stops a coach clearing their own name by pressing a button. */
  {
    const page = await open('account', 1280)
    const field = page.getByLabel('Full name', { exact: true })
    const save = page.getByRole('button', { name: 'Save', exact: true })
    // Guarded: a control that is not there rejects isEnabled() on its own
    // account, which ends the run rather than failing this check.
    const armed = async () => ((await save.count()) ? save.first().isEnabled() : null)
    const WHAT = 'Save is armed only by a meaningful changed name'
    const arm = async (value) => {
      if (!(await typed(field, value, WHAT))) return 'unreachable'
      await page.waitForTimeout(120)
      return armed()
    }
    const states = {
      untouched: await armed(),
      blank: await arm('   '),
      unchanged: await arm('Sam Whitfield'),
      padded: await arm('  Sam Whitfield  '),
      changed: await arm('Sam Whitfield-Ashby'),
    }
    check(
      WHAT,
      states.untouched === false &&
        states.blank === false &&
        states.unchanged === false &&
        states.padded === false &&
        states.changed === true,
      JSON.stringify(states),
    )

    // And Enter, from the field the coach is typing in, with the name left
    // changed by the block above. The save is proved by the confirmation AND
    // by the name the shell now shows, so a note rendered without a write
    // would fail here.
    const ENTER = 'Enter in the name field saves it'
    if (await focused(field, ENTER)) {
      await page.keyboard.press('Enter')
      await page.waitForTimeout(300)
      const r = await page.evaluate(() => ({
        note: !!document.querySelector('.account-name-block .note-success'),
        shell: document.querySelector('.coach-chip b')?.textContent ?? null,
      }))
      check(ENTER, r.note && r.shell === 'Sam Whitfield-Ashby', JSON.stringify(r))
    }
    await page.close()
  }

  /* The autocomplete a password manager reads, taken off the live element
     rather than out of the markup. The static test can only see the JSX
     spelling; this is the property the browser resolved, which is what a
     manager acts on. Frozen behaviour: both password fields are
     new-password (never current-password, which would offer the wrong
     credential) and the address field is email. */
  {
    const page = await open('account', 1280)
    const r = page.blank
      ? null
      : await page.evaluate(() =>
          ['new-password', 'confirm-password', 'new-email'].map((id) => {
            const el = document.getElementById(id)
            return el ? `${id}:${el.autocomplete}:${el.type}` : `${id}:missing`
          }),
        )
    check(
      'the Security fields carry the autocomplete a password manager reads',
      !!r &&
        JSON.stringify(r) ===
          JSON.stringify([
            'new-password:new-password:password',
            'confirm-password:new-password:password',
            'new-email:email:email',
          ]),
      JSON.stringify(r),
    )
    await page.close()
  }

  // Keyboard order follows visual order. The forms lay a field beside its
  // action at desktop width and stack them on a phone, and the DOM order is
  // what a keyboard follows in both.
  for (const width of [360, 1280]) {
    const page = await open('account', width, { caps: 'clubadmin' })
    const r = page.blank
      ? null
      : await page.evaluate(() => {
          const els = [
            ...document.querySelectorAll('.account button, .account select, .account input:not([type="file"])'),
          ].filter((el) => !el.disabled && el.getBoundingClientRect().height > 0)
          const out = []
          for (let i = 1; i < els.length; i++) {
            const a = els[i - 1].getBoundingClientRect()
            const b = els[i].getBoundingClientRect()
            // Same visual row when their tops are within half a control, in
            // which case the later one must be to the right.
            const sameRow = Math.abs(a.top - b.top) < 22
            const ok = sameRow ? b.left >= a.left - 1 : b.top >= a.top - 1
            if (!ok) out.push(`${els[i - 1].id || els[i - 1].textContent.trim().slice(0, 12)} → ${els[i].id || els[i].textContent.trim().slice(0, 12)}`)
          }
          return { count: els.length, out }
        })
    check(`the Account tab order follows the visual order at ${width}`, !!r && r.count > 5 && r.out.length === 0, JSON.stringify(r))
    await page.close()
  }

  /* Focus after an outcome. Four successes each take away the control that
     had focus: Remove photo unmounts with the photo, Save goes inert because
     the name now matches, and the two Security submits go inert because they
     empty their own fields. A browser drops focus to the body when a focused
     control is disabled or removed, so each of these places it somewhere
     deliberate. This is the check that fails if that placement is dropped. */
  for (const [key, target] of [
    // After a removal the only photo action left is the one that adds a new
    // one, and it is where focus goes.
    ['remove-ok', '.account-photo-acts button'],
    ['name-ok', '#full-name'],
    ['password-ok', '#new-password'],
    ['email-ok', '#new-email'],
  ]) {
    const flow = flowOf(key)
    const WHAT = `focus lands on the intended Account control after ${key}`
    if (!flow) {
      check(WHAT, false, 'no such flow')
      continue
    }
    const page = await open('account', 1280, { flow })
    const why = await runFlow(page, flow)
    if (why) {
      check(WHAT, false, why)
      await page.close()
      continue
    }
    // The NAMED control, not merely a live one somewhere on the page. A
    // password success that focused Add photo or New email would move a coach
    // into a different form, and "somewhere in .account, enabled and visible"
    // accepted all of those. Codex.
    const at = await page.evaluate((sel) => {
      const el = document.activeElement
      if (!el || el === document.body) return { focused: null, onTarget: false }
      const want = document.querySelector(sel)
      return {
        focused: el.id || el.getAttribute('class') || el.tagName,
        label: (el.textContent || '').trim().slice(0, 20),
        onTarget: !!want && want === el,
        disabled: !!el.disabled,
        hidden: el.getBoundingClientRect().height === 0,
      }
    }, target)
    check(WHAT, !!at && at.onTarget && !at.disabled && !at.hidden, JSON.stringify({ want: target, ...at }))
    await page.close()
  }

  /* Focus is RESTORED, never STOLEN, which is the other half of the same
     claim and the one a check for the first half cannot make. Only the photo
     actions are disabled during a removal, so a coach can carry on using the
     rest of the page while a write is in flight; a repair that moves focus on
     success must leave it where they put it. Codex.

     Reached through `writeslow`, a write that settles rather than hanging, so
     the driver can start it, move focus, and see the write finish. `inflight`
     cannot answer this: nothing ever settles, so nothing would ever be stolen
     and the check would pass on a screen that steals. */
  for (const [key, start, moveTo, slowState] of [
    // The removal needs a photo to remove, so it takes the photo axis crossed
    // with the slow write, exactly as its other states do.
    ['remove-ok', 'Remove photo', '#full-name', 'photoslow'],
    ['name-ok', 'Save', '#new-email', 'writeslow'],
    ['password-ok', 'Change password', '#full-name', 'writeslow'],
    ['email-ok', 'Change email', '#full-name', 'writeslow'],
  ]) {
    const WHAT = `a successful ${key} leaves focus where the coach moved it`
    const page = await open('account', 1280, { state: slowState })
    // The presses each write needs before it can be started, typed rather than
    // assumed: an empty form's submit is inert.
    const typedOk =
      key === 'name-ok'
        ? await typed(page.getByLabel('Full name', { exact: true }), 'Sam Whitfield-Ashby', WHAT)
        : key === 'password-ok'
          ? (await typed(page.getByLabel('New password', { exact: true }), 'a-long-enough-passphrase', WHAT)) &&
            (await typed(page.getByLabel('Confirm password', { exact: true }), 'a-long-enough-passphrase', WHAT))
          : key === 'email-ok'
            ? await typed(page.getByLabel('New email', { exact: true }), 'new.coach@example.invalid', WHAT)
            : true
    if (!typedOk) {
      await page.close()
      continue
    }
    if (!(await pressed(page.getByRole('button', { name: start, exact: true }), WHAT))) {
      await page.close()
      continue
    }
    // The coach carries on: focus a control in a different section while the
    // write is still in flight.
    if (!(await focused(page.locator(moveTo), WHAT))) {
      await page.close()
      continue
    }
    const moved = await page.evaluate((sel) => document.activeElement === document.querySelector(sel), moveTo)
    await page.waitForTimeout(2000)
    const after = await page.evaluate(
      (sel) => {
        const el = document.activeElement
        return {
          stillThere: !!el && el === document.querySelector(sel),
          now: el ? el.id || el.getAttribute('class') || el.tagName : null,
          settled: !!document.querySelector('.account .note-success'),
        }
      },
      moveTo,
    )
    check(WHAT, moved && after.settled && after.stillThere, JSON.stringify({ moved, ...after }))
    await page.close()
  }

  /* Every outcome carries an icon and a live region, in both themes. Colour
     alone is what this page used to say success and failure with, and colour
     alone is what 2.4 and 2.14 forbid. */
  for (const [key, tone, role] of [
    ['name-ok', 'note-success', 'status'],
    ['name-failed', 'note-danger', 'alert'],
    ['password-mismatch', 'note-danger', 'alert'],
    ['email-ok', 'note-success', 'status'],
  ]) {
    for (const theme of ['light', 'dark']) {
      const flow = flowOf(key)
      const WHAT = `${key} is announced and carries a glyph, not colour alone (${theme})`
      if (!flow) {
        check(WHAT, false, 'no such flow')
        continue
      }
      const page = await open('account', 1280, { flow, theme })
      const why = await runFlow(page, flow)
      if (why) {
        check(WHAT, false, why)
        await page.close()
        continue
      }
      const r = await page.evaluate(() => {
        const n = document.querySelector('.account .note')
        if (!n) return null
        return {
          role: n.getAttribute('role'),
          glyph: !!n.querySelector('svg[aria-hidden="true"]'),
          tone: [...n.classList].find((c) => c.startsWith('note-') && c !== 'note-body') ?? null,
          words: (n.textContent || '').trim().length,
        }
      })
      check(WHAT, !!r && r.role === role && r.glyph && r.tone === tone && r.words > 8, JSON.stringify(r))
      await page.close()
    }
  }

  // A write in flight says so and offers no outcome yet. A success note drawn
  // before the server answered is the failure this rules out.
  for (const key of ['upload-pending', 'remove-pending', 'name-pending', 'team-pending', 'password-pending', 'email-pending']) {
    const flow = flowOf(key)
    const WHAT = `${key} shows no outcome while it is still in flight`
    if (!flow) {
      check(WHAT, false, 'no such flow')
      continue
    }
    const page = await open('account', 1280, { flow })
    const why = await runFlow(page, flow)
    if (why) {
      check(WHAT, false, why)
      await page.close()
      continue
    }
    const notes = await page.evaluate(() => document.querySelectorAll('.account .note').length)
    check(WHAT, notes === 0, `${notes} notes`)
    await page.close()
  }

  /* The capability boundary, read from what the page renders. Default team
     follows sessions.create and each destination row follows the capability
     the sidebar's own ITEM_CAP map names, so a set that holds three of the
     four gets three rows. `coach` and `admin` are that partial case: neither
     holds users.manage, so neither is offered Users. */
  for (const [caps, team, rows] of [
    ['planner', true, []],
    ['parent', false, []],
    ['viewer', false, []],
    ['coach', true, ['Club', 'Teams', 'Spond']],
    ['clubadmin', true, ['Club', 'Users', 'Teams', 'Spond']],
  ]) {
    const page = await open('account', 1280, { caps })
    const r = page.blank
      ? null
      : await page.evaluate(() => {
          const cards = [...document.querySelectorAll('.account-section')]
          const admin = cards.find((c) => (c.querySelector('h2')?.textContent ?? '') === 'Admin')
          return {
            team: !!document.querySelector('#default-team'),
            adminManaged: [...document.querySelectorAll('.account-team-admin')].length,
            rows: admin ? [...admin.querySelectorAll('.account-link-text b')].map((b) => (b.textContent || '').trim()) : [],
            // The Feedback row is open to every role and is deliberately NOT
            // in the Admin card, so a set with no admin capability still has
            // exactly one destination row.
            feedback: [...document.querySelectorAll('.account-link-text b')].some((b) => b.textContent === 'Feedback log'),
          }
        })
    check(
      `${caps} is offered exactly the Account controls its capabilities open`,
      !!r &&
        r.team === team &&
        r.adminManaged === (team ? 0 : 1) &&
        JSON.stringify(r.rows) === JSON.stringify(rows) &&
        r.feedback,
      JSON.stringify(r),
    )
    await page.close()
  }

  // The page level gate is a different screen from the loaded one, and says
  // it is loading rather than looking like an account with nothing in it.
  {
    const page = await open('account', 1280, { state: 'profileloading' })
    const r = await page.evaluate(() => ({
      loading: !!document.querySelector('.content > .loading[role="status"]'),
      account: !!document.querySelector('.account'),
      label: (document.querySelector('.content > .loading')?.textContent ?? '').trim(),
    }))
    check('the profile gate is a labelled load rather than an empty account', r.loading && !r.account && r.label.length > 3, JSON.stringify(r))
    await page.close()
  }
}

/* ---- VISUAL-02: Login and Set Password --------------------------------
   The product with no shell around it, and the one family the two screens
   form. What is measured here is what a screenshot cannot settle: the hit
   areas, the label bindings, the autocomplete a password manager reads, the
   keyboard order, where FOCUS ends up when an outcome takes away the control
   that had it, and what the auth guard actually does at each address.

   Every state is DRIVEN through tools/visual/auth.mjs, the same entries
   shoot.mjs photographs and contrast.mjs sweeps, so a control that stops
   rendering fails the run rather than producing a plausible measurement. */
{
  const flowOf = (key) => AUTH_FLOWS.find((f) => f.key === key)

  /* Every entry reaches the state its own name claims. This is the backbone:
     the screenshots and the contrast sweep both file results under these
     names, and a name that nothing proves is the failure the whole proof
     apparatus exists to stop. Both themes, because half of these entries are
     a semantic Note and its surface, border and glyph all flip. */
  for (const entry of [...AUTH_FLOWS, ...GUARD_CASES]) {
    for (const theme of ['light', 'dark']) {
      const page = await open(entry.screen ?? 'auth', 1280, { authEntry: entry, theme })
      const why = page.blank ? 'the surface never painted' : await runAuthFlow(page, entry)
      check(`${entry.key} (${theme}): ${entry.note}`, !why, why ?? '')
      await page.close()
    }
  }

  /* Every control a member can press, at the narrowest width and the widest,
     on both screens. The text link is the one this exists for: it is the only
     control on either screen that is not a .btn, so it takes no hit area from
     the button rule and had to be given one. */
  for (const [what, screen, opts] of [
    ['Login', 'login', {}],
    ['Set Password', 'auth', { auth: 'needspassword' }],
  ]) {
    for (const width of [360, 1280]) {
      const page = await open(screen, width, opts)
      const r = page.blank
        ? null
        : await page.evaluate(() => {
            const short = []
            const px = (v) => (v.endsWith('px') ? parseFloat(v) : 0)
            const controls = [...document.querySelectorAll('.login-card button, .login-card input')]
            for (const el of controls) {
              const b = el.getBoundingClientRect()
              if (b.width === 0 && b.height === 0) continue
              const a = getComputedStyle(el, '::after')
              const h = a.content === 'none' ? b.height : Math.max(b.height, px(a.height))
              const w = a.content === 'none' ? b.width : Math.max(b.width, px(a.width))
              if (h < 44 || w < 44) {
                const label = (el.textContent || el.id || el.tagName).trim()
                short.push(`${label.slice(0, 24)} ${Math.round(w)}x${Math.round(h)}`)
              }
            }
            return { count: controls.length, short }
          })
      check(
        `every ${what} control reaches a 44px target at ${width}`,
        !!r && r.count >= 3 && r.short.length === 0,
        JSON.stringify(r),
      )
      await page.close()
    }
  }

  /* The shared focus ring, on every control of both screens, in both themes.
     The card is the surface --focus was hardest to satisfy on: it is not the
     page ground, and the brand gradient behind it is fixed in both themes.

     Set Password is ARMED first. Its submit is inert until both fields are
     typed, and a disabled control cannot be focused, so measuring the screen
     as it opens would silently skip the one control on it whose ring
     matters. The expected count is per screen and is checked, so a screen
     that stopped rendering a control fails here rather than passing with
     fewer measurements. */
  for (const [what, screen, opts, controls, arm] of [
    ['Login', 'login', {}, 5, null],
    ['Set Password', 'auth', { auth: 'needspassword' }, 3, ['New password', 'Confirm password']],
  ]) {
    for (const theme of ['light', 'dark']) {
      const page = await open(screen, 1280, { ...opts, theme })
      let ready = !page.blank
      for (const field of arm ?? []) {
        if (!ready) break
        ready = await typed(page.getByLabel(field, { exact: true }), 'a-long-enough-passphrase', `${what} focus ring (${theme})`)
      }
      const rings = !ready
        ? null
        : await page.evaluate(() => {
            const out = []
            for (const el of document.querySelectorAll('.login-card button, .login-card input')) {
              if (el.disabled) continue
              el.focus()
              const cs = getComputedStyle(el)
              out.push({
                what: (el.textContent || el.id || el.tagName).trim().slice(0, 20),
                width: cs.outlineWidth,
                style: cs.outlineStyle,
                offset: cs.outlineOffset,
                focused: document.activeElement === el,
              })
            }
            return out
          })
      const bad = (rings ?? []).filter(
        (r) => !r.focused || r.width !== '2px' || r.style !== 'solid' || r.offset !== '2px',
      )
      check(
        `every ${what} control draws the shared focus ring (${theme})`,
        !!rings && rings.length === controls && bad.length === 0,
        JSON.stringify(bad.length ? bad : { checked: rings?.length, want: controls }),
      )
      await page.close()
    }
  }

  /* One h1 per screen, every field bound to a real label, and the
     autocomplete a password manager reads still on it. The autocomplete
     values are BEHAVIOUR, not presentation: dropping one is how a visual pass
     quietly stops a member's password manager offering to fill the form. */
  for (const [what, screen, opts, heading, wanted] of [
    ['Login', 'login', {}, 'Training Hub', { email: 'email', password: 'current-password' }],
    [
      'Set Password',
      'auth',
      { auth: 'needspassword' },
      'Set your password',
      { 'new-password': 'new-password', 'confirm-password': 'new-password' },
    ],
  ]) {
    const page = await open(screen, 1280, opts)
    const r = page.blank
      ? null
      : await page.evaluate((wanted) => {
          const h1 = [...document.querySelectorAll('h1')].map((e) => (e.textContent || '').trim())
          const orphans = []
          for (const label of document.querySelectorAll('.login-card label')) {
            const to = label.getAttribute('for')
            const target = to ? document.getElementById(to) : null
            if (!target) orphans.push((label.textContent || '').trim())
          }
          const unnamed = []
          const autocomplete = {}
          for (const el of document.querySelectorAll('.login-card input')) {
            const lab = el.id ? document.querySelector(`label[for="${el.id}"]`) : null
            const named = (lab ? (lab.textContent || '').trim() : '') || el.getAttribute('aria-label') || ''
            if (!named) unnamed.push(el.id || el.tagName)
            autocomplete[el.id] = el.getAttribute('autocomplete')
          }
          const wrong = Object.entries(wanted).filter(([id, value]) => autocomplete[id] !== value)
          return { h1, orphans, unnamed, wrong, fields: Object.keys(autocomplete).length }
        }, wanted)
    check(
      `${what} has one h1, every field bound to a label, and its autocomplete intact`,
      !!r &&
        r.h1.length === 1 &&
        r.h1[0] === heading &&
        r.orphans.length === 0 &&
        r.unnamed.length === 0 &&
        r.wrong.length === 0 &&
        r.fields === Object.keys(wanted).length,
      JSON.stringify(r),
    )
    await page.close()
  }

  /* Keyboard order follows visual order. Driven with real Tab presses rather
     than read off the DOM, because tabindex, a portal or an absolutely
     positioned control would all make the two disagree and only the browser
     knows which. Compared against the order the controls are PAINTED in, top
     to bottom, rather than against a list written out here.

     Set Password is armed first, for the reason its focus ring check is: its
     submit is inert until both fields are typed, and a disabled control is
     out of the tab order entirely, so the unarmed screen would prove the
     order of two fields and say nothing about the control that ends the flow.

     Typing leaves focus in the last field, so the walk has to be started from
     the top, and blurring is NOT how: calling blur() clears
     document.activeElement but leaves the browser's sequential focus
     NAVIGATION STARTING POINT on the element it blurred, so the next Tab
     carries on from there. Measured: the walk began at Save password, went
     out of the document, and wrapped round to the first field. Clicking the
     identity block moves the starting point to the top of the card, which is
     what a person tabbing from the beginning of the page actually does. */
  for (const [what, screen, opts, arm] of [
    ['Login', 'login', {}, null],
    ['Set Password', 'auth', { auth: 'needspassword' }, ['New password', 'Confirm password']],
  ]) {
    const WHAT = `${what} tab order follows visual order`
    const page = await open(screen, 1280, opts)
    let ready = !page.blank
    for (const field of arm ?? []) {
      if (!ready) break
      ready = await typed(page.getByLabel(field, { exact: true }), 'a-long-enough-passphrase', WHAT)
    }
    // The identity block: the first thing in the card and not a control, so
    // clicking it takes focus off whatever the arming left it on AND moves
    // the sequential navigation starting point above every control.
    if (ready) ready = await pressed(page.locator('.login-head'), WHAT)
    const visual = !ready
      ? []
      : await page.evaluate(() =>
          [...document.querySelectorAll('.login-card button, .login-card input')]
            .filter((el) => !el.disabled)
            .map((el) => ({ label: (el.textContent || el.id || '').trim().slice(0, 24), top: el.getBoundingClientRect().top }))
            .sort((a, b) => a.top - b.top)
            .map((e) => e.label),
        )
    const seq = []
    for (let i = 0; i < visual.length; i++) {
      await page.keyboard.press('Tab')
      seq.push(
        await page.evaluate(() => {
          const el = document.activeElement
          if (!el || el === document.body) return 'BODY'
          return (el.textContent || el.id || el.tagName).trim().slice(0, 24)
        }),
      )
    }
    // The count is checked as well as the order: a screen that lost a control
    // would otherwise agree with itself on a shorter list.
    check(
      WHAT,
      visual.length === (arm ? 3 : 5) && JSON.stringify(seq) === JSON.stringify(visual),
      JSON.stringify({ visual, seq }),
    )
    await page.close()
  }

  /* Focus lands on the OUTCOME MESSAGE after every refusal. Pressing any of
     these disables it, the browser blurs a disabled control, and before this
     slice the outcome arrived with focus on the document body: a member who
     clicked rather than pressing Enter had to tab from the top of the page to
     reach the control again, with an alert on screen telling them to try.

     The message rather than the control, which is the error summary pattern
     and Codex's answer to the question the first version of this left open: a
     screen reader flushes its speech queue on a focus change, so a message
     announced through a live region in the same commit as a focus move to
     something else can be cut short. Focusing the message removes that race.
     src/hooks/useFocusRestore.ts carries both sides of it.

     Driven and measured here rather than reasoned about, which is the lesson
     #215 left: the first attempt at that repair on Account was a callback
     that fired before React had re-rendered and did nothing at all. */
  for (const key of ['signin-failed', 'link-failed', 'reset-failed', 'sp-failed']) {
    const WHAT = `${key} moves focus to the outcome message`
    const flow = flowOf(key)
    if (!flow) {
      check(WHAT, false, 'no such flow')
      continue
    }
    const page = await open(flow.screen ?? 'auth', 1280, { authEntry: flow })
    const why = page.blank ? 'the surface never painted' : await runAuthFlow(page, flow)
    if (why) {
      check(WHAT, false, why)
      await page.close()
      continue
    }
    /* The wrapper itself, and the wrapper WITH THE MESSAGE IN IT. Element
       identity alone would be satisfied by an empty box that happened to
       carry the class, which is the shape this repair must never take, so the
       danger Note is required to be inside the focused element rather than
       merely somewhere on the card.

       tabIndex is checked too: -1 is what keeps it out of the tab order, so a
       member's next Tab from the message reaches the first field rather than
       having to pass back through a stop that is not a control. */
    const at = await page.evaluate(() => {
      const el = document.activeElement
      if (!el || el === document.body) return { focused: null, onTarget: false }
      const want = document.querySelector('.login-card .login-outcome')
      return {
        focused: (el.className || el.id || el.tagName).trim().slice(0, 32),
        onTarget: !!want && want === el,
        holdsTheMessage: !!want && want === el && !!el.querySelector('.note-danger .note-body'),
        outOfTabOrder: el.tabIndex === -1,
      }
    })
    check(
      WHAT,
      !!at && at.onTarget && at.holdsTheMessage && at.outOfTabOrder,
      JSON.stringify(at),
    )
    await page.close()
  }

  /* The ring around the message, which is the one thing a SIGHTED member sees
     differently after this repair and is therefore claimed in Login.css and in
     the roadmap. Measured rather than reasoned about, because both halves of
     it rest on a browser heuristic: `:focus-visible` matches a scripted focus
     when the element focus came FROM matched it, so a keyboard activation
     carries the ring onto the message and a mouse press does not.

     That is the behaviour every control on the screen already has, and it is
     the right one here: focus moves BACKWARDS, above the form, so somebody who
     activated a button with the keyboard needs to see where their next Tab
     starts from, while somebody who clicked is looking at their pointer. Both
     activations are driven, because a rule that only ever draws or only ever
     hides is a different rule from this one. */
  for (const how of ['keyboard', 'mouse']) {
    const WHAT = `the outcome message draws the shared ring for a ${how} activation${how === 'mouse' ? ': it does not' : ''}`
    const page = await open('login', 1280, { state: 'writefails' })
    let ready = !page.blank
    if (ready) ready = await typed(page.getByLabel('Email', { exact: true }), LOGIN_EMAIL, WHAT)
    if (ready) ready = await typed(page.getByLabel('Password', { exact: true }), LOGIN_PASSWORD, WHAT)
    const submit = page.getByRole('button', { name: 'Sign in', exact: true })
    if (ready) {
      ready =
        how === 'keyboard'
          ? (await focused(submit, WHAT)) && (await acted(page.locator('body'), WHAT, 'pressed Enter', () => page.keyboard.press('Enter')))
          : await pressed(submit, WHAT)
    }
    if (!ready) {
      await page.close()
      continue
    }
    const r = await page.evaluate(() => {
      const el = document.querySelector('.login-outcome')
      if (!el) return null
      const cs = getComputedStyle(el)
      return {
        // Proved first: focus really is on the message, so what follows is a
        // measurement of THIS repair rather than of an element nobody focused.
        focused: document.activeElement === el,
        visible: el.matches(':focus-visible'),
        style: cs.outlineStyle,
        width: parseFloat(cs.outlineWidth),
        // The ring hugs the Note rather than boxing it, which is what the
        // wrapper's own radius is for.
        radius: cs.borderTopLeftRadius,
      }
    })
    const wantRing = how === 'keyboard'
    check(
      WHAT,
      !!r &&
        r.focused &&
        r.visible === wantRing &&
        (wantRing ? r.style === 'solid' && r.width >= 2 && r.radius === '12px' : r.style === 'none'),
      JSON.stringify({ how, wantRing, ...r }),
    )
    await page.close()
  }

  /* And never STOLEN, which is the other half of the same claim and the one a
     check for the first half cannot make. The fields stay live while a call
     is in flight, so a member can carry on typing; a repair that moves focus
     when the call settles must leave it where they put it.

     Both settling calls are driven, and the pair is the point. A REFUSED one
     puts an outcome message on screen, so the thing focus would move to is
     really there and declining to move is a decision the guard made. An
     ACCEPTED one renders no message at all, so the target is absent and the
     hook has nothing to aim at; that is the path a successful sign in takes
     and it is worth pinning, but on its own it would be true of a screen with
     no focus repair whatsoever. Running only the accepted case is exactly how
     this check would have gone quietly vacuous when the repair was retargeted
     from the control to the message.

     Both settle rather than hanging, so the driver can start the call, move
     focus, and see it finish. `inflight` cannot answer this: nothing ever
     settles, so nothing could ever be stolen. */
  for (const [state, wantNote] of [
    ['writeslowfails', true],
    ['writeslow', false],
  ]) {
    const WHAT = `a settled sign in that ${wantNote ? 'was refused' : 'said nothing'} leaves focus where the member moved it`
    const page = await open('login', 1280, { state })
    let ready = !page.blank
    if (ready) ready = await typed(page.getByLabel('Email', { exact: true }), LOGIN_EMAIL, WHAT)
    if (ready) ready = await typed(page.getByLabel('Password', { exact: true }), LOGIN_PASSWORD, WHAT)
    if (ready) ready = await pressed(page.getByRole('button', { name: 'Sign in', exact: true }), WHAT)
    // The member carries on: back into the email field while the call runs.
    if (ready) ready = await focused(page.locator('#email'), WHAT)
    if (!ready) {
      await page.close()
      continue
    }
    const moved = await page.evaluate(() => document.activeElement === document.querySelector('#email'))
    await page.waitForTimeout(2000)
    const after = await page.evaluate(() => {
      const el = document.activeElement
      return {
        stillThere: !!el && el === document.querySelector('#email'),
        now: el ? (el.className || el.id || el.tagName).trim().slice(0, 32) : null,
        // The call really finished: the submit is live again.
        settled: document.querySelector('.login-card button[type="submit"]')?.disabled === false,
        // And whether there was anywhere to steal focus TO, which is what
        // separates the two cases from each other.
        target: !!document.querySelector('.login-card .login-outcome'),
      }
    })
    check(
      WHAT,
      moved && after.settled && after.stillThere && after.target === wantNote,
      JSON.stringify({ state, moved, wantNote, ...after }),
    )
    await page.close()
  }

  /* The two strings the CLUB chooses, at a length a committee would really
     produce. Neither may scroll the page nor paint outside the card that
     contains it. The narrow phone widths are where this fails first: at 360
     the card's content column is 264px. */
  for (const [state, want] of [
    ['longclub', { name: BRAND.longClub, motto: BRAND.motto }],
    ['longmotto', { name: BRAND.club, motto: BRAND.longMotto }],
  ]) {
    for (const width of [360, 390, 430]) {
      for (const theme of ['light', 'dark']) {
        const page = await open('login', width, { state, theme })
        /* The state is proved before the layout is measured, and it is the
           half that was missing: "nothing painted outside the card" is true
           of the ORDINARY card too, so a fixture that stopped applying the
           long string would have passed all twelve of these while measuring
           a short one. Compared exactly against the fixture, and the entry
           names the other string as still ordinary, so a state that quietly
           made both long could not pass under either name. */
        const rendered = page.blank ? false : await brandRendered(page, want)
        const r = page.blank
          ? null
          : await page.evaluate(() => {
              const doc = document.documentElement
              const card = document.querySelector('.login-card')
              if (!card) return null
              const box = card.getBoundingClientRect()
              const out = []
              for (const el of card.querySelectorAll('*')) {
                const b = el.getBoundingClientRect()
                if (b.width === 0) continue
                if (b.right > box.right + 1 || b.left < box.left - 1) out.push(el.className || el.tagName)
                // A text field scrolls its own value by specification; that is
                // not copy the layout failed to fit. Anything else that
                // scrolls inside itself is.
                const owns = el.tagName === 'INPUT'
                if (!owns && el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0) {
                  out.push('clipped:' + (el.className || el.tagName))
                }
              }
              return { page: doc.scrollWidth - doc.clientWidth, out: [...new Set(out)].slice(0, 4) }
            })
        check(
          `a ${state === 'longclub' ? 'long club name' : 'long motto'} really renders and neither scrolls the page nor breaks the card at ${width}, ${theme}`,
          rendered && !!r && r.page === 0 && r.out.length === 0,
          JSON.stringify({ rendered, ...(r ?? {}) }),
        )
        await page.close()
      }
    }
  }

  /* The third string a member can make long is the one they TYPE. A club
     address with a hyphenated surname in it is one token with no space to
     break at, which is the hardest case the Account screen has; here it goes
     into a field, and a field scrolls its own value by specification. That is
     the claim: it scrolls INSIDE ITSELF and does not widen the card around
     it. Measured rather than assumed, because a field that lost `min-width:
     0` or gained an intrinsic width would push the card open instead. */
  {
    const LONG_EMAIL = 'wilhelmina.fotheringay-wallington-smythe@ossett-town-juniors-football-club.example'
    for (const width of [360, 1280]) {
      const WHAT = `a long typed address stays inside the field at ${width}`
      const page = await open('login', width)
      if (page.blank || !(await typed(page.getByLabel('Email', { exact: true }), LONG_EMAIL, WHAT))) {
        await page.close()
        continue
      }
      const r = await page.evaluate(() => {
        const doc = document.documentElement
        const card = document.querySelector('.login-card')
        const field = document.querySelector('#email')
        if (!card || !field) return null
        const box = card.getBoundingClientRect()
        const b = field.getBoundingClientRect()
        return {
          page: doc.scrollWidth - doc.clientWidth,
          inside: b.right <= box.right + 1 && b.left >= box.left - 1,
          // The value really is longer than the box, so the case is the one
          // its name claims rather than a short string that happened to fit.
          overflows: field.scrollWidth > field.clientWidth + 1,
        }
      })
      check(WHAT, !!r && r.page === 0 && r.inside && r.overflows, JSON.stringify(r))
      await page.close()
    }
  }
}

/* ---- VISUAL-02: the club feedback log ---------------------------------
   What a screenshot cannot settle on this screen: the hit areas in a row that
   carries a select, a link, two icon buttons and (expanded) two more per
   comment; the expander's programmatic state; where FOCUS ends up when an
   outcome disables or removes the control that had it; whether a comment
   thread is read before its row is opened; and whether the admin GitHub
   refresh fires for the member it is supposed to and for nobody else. The
   last two are claims about a call, so they are COUNTED on the harness stub
   rather than inferred from what is drawn.

   Every state is DRIVEN through tools/visual/feedback.mjs, the same entries
   shoot.mjs photographs and contrast.mjs sweeps, so a control that stops
   rendering fails the run rather than producing a plausible measurement. */
{
  const entryOf = (key) => FEEDBACK_ENTRIES.find((f) => f.key === key)

  /* The backbone: every entry reaches the state its own name claims, in both
     themes, because half of them are a semantic Note whose surface, border
     and glyph all flip. The screenshots and the contrast sweep file their
     results under these names, so a name nothing proves is the failure the
     whole apparatus exists to stop. */
  for (const entry of FEEDBACK_ENTRIES) {
    for (const theme of ['light', 'dark']) {
      const page = await open('feedback', 1280, { feedbackEntry: entry, theme })
      const why = page.blank ? 'the surface never painted' : await runFeedbackFlow(page, entry)
      check(`${entry.key} (${theme}): ${entry.note}`, !why, why ?? '')
      await page.close()
    }
  }

  /* ---- the page's own structure ---- */
  {
    const page = await open('feedback', 1280)
    const r = await page.evaluate(() => {
      const h1s = [...document.querySelectorAll('h1')]
      const toggle = document.querySelector('.fb-toggle')
      const panel = toggle ? document.getElementById(toggle.getAttribute('aria-controls') ?? '') : null
      const badges = [...document.querySelectorAll('.fb-meta .badge')]
      return {
        h1: h1s.length,
        title: (h1s[0]?.textContent ?? '').trim(),
        expanded: toggle ? toggle.getAttribute('aria-expanded') : null,
        // aria-controls names an element that EXISTS while collapsed, which
        // is what makes the relationship readable before it is opened.
        panel: !!panel,
        panelHidden: panel ? panel.hasAttribute('hidden') : null,
        // The name of the expander is the title alone: putting the badges and
        // the byline inside the button would make the whole meta line its
        // accessible name.
        toggleText: (toggle?.textContent ?? '').trim(),
        // No state is carried by colour alone: every badge has a dot AND a
        // word.
        badgesWithWords: badges.filter((b) => (b.textContent ?? '').trim().length > 0).length,
        badgesWithDots: badges.filter((b) => !!b.querySelector('.badge-dot')).length,
        badgeCount: badges.length,
      }
    })
    check('the page has exactly one h1 and it names the page', r.h1 === 1 && r.title === 'Feedback', JSON.stringify(r))
    check(
      'the expander exposes its state and names a panel that exists while collapsed',
      r.expanded === 'false' && r.panel === true && r.panelHidden === true,
      JSON.stringify(r),
    )
    check(
      'the expander is named by the title alone',
      r.toggleText === 'Timer drifts on the live screen',
      r.toggleText,
    )
    check(
      'every badge carries a dot and a word, so no classification or state is colour alone',
      r.badgeCount > 0 && r.badgesWithWords === r.badgeCount && r.badgesWithDots === r.badgeCount,
      JSON.stringify(r),
    )
    await page.close()
  }

  /* The expander is a control, so it works from the keyboard and its state
     follows. Space rather than Enter, because a native button takes both and
     Space is the one a div dressed as a button silently loses. */
  {
    const WHAT = 'the expander toggles from the keyboard and its state follows'
    const page = await open('feedback', 1280)
    const toggle = page.locator('.fb-toggle').first()
    if (await focused(toggle, WHAT)) {
      await page.keyboard.press('Space')
      await page.waitForTimeout(200)
      const r = await page.evaluate(() => {
        const t = document.querySelector('.fb-toggle')
        const panel = t ? document.getElementById(t.getAttribute('aria-controls') ?? '') : null
        return { expanded: t?.getAttribute('aria-expanded'), hidden: panel ? panel.hasAttribute('hidden') : null }
      })
      check(WHAT, r.expanded === 'true' && r.hidden === false, JSON.stringify(r))
    }
    await page.close()
  }

  /* ---- hit areas, in the row and in the thread ---- */
  for (const width of [360, 1280]) {
    const page = await open('feedback', width)
    if (!page.blank && (await expandRow(page, ROWS.thread))) {
      const r = await page.evaluate(() => {
        const px = (v) => (v.endsWith('px') ? parseFloat(v) : 0)
        const measure = (el) => {
          const b = el.getBoundingClientRect()
          const a = getComputedStyle(el, '::after')
          return {
            label: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 26),
            h: Math.round(Math.max(b.height, a.content === 'none' ? 0 : px(a.height))),
            w: Math.round(Math.max(b.width, a.content === 'none' ? 0 : px(a.width))),
          }
        }
        const controls = [
          ...document.querySelectorAll(
            '.fb-toggle, .fb-item .icon-btn, .fb-item .btn, .fb-item a.btn, .fb-item select, .fb-comment .icon-btn',
          ),
        ]
        return {
          count: controls.length,
          small: controls.map(measure).filter((m) => m.h < 44 || m.w < 44),
        }
      })
      check(
        `every control in an expanded feedback row reaches 44px at ${width}`,
        r.count > 8 && r.small.length === 0,
        `${r.count} controls${r.small.length ? ': ' + JSON.stringify(r.small.slice(0, 4)) : ''}`,
      )

      // And the enlarged boxes do not reach into each other. The comment
      // actions stack two icon buttons in a column at 360, which is the
      // arrangement a 44px box over a 38px control can spill out of.
      const clash = await page.evaluate(() => {
        const px = (v) => (v.endsWith('px') ? parseFloat(v) : 0)
        const boxes = [...document.querySelectorAll('.fb-item .icon-btn, .fb-item .btn, .fb-comment .icon-btn')].map(
          (el) => {
            const b = el.getBoundingClientRect()
            const a = getComputedStyle(el, '::after')
            const ph = a.content === 'none' ? b.height : Math.max(b.height, px(a.height))
            const pw = a.content === 'none' ? b.width : Math.max(b.width, px(a.width))
            return {
              label: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 22),
              hit: {
                l: b.left - (pw - b.width) / 2,
                r: b.right + (pw - b.width) / 2,
                t: b.top - (ph - b.height) / 2,
                b: b.bottom + (ph - b.height) / 2,
              },
              box: b,
            }
          },
        )
        const out = []
        for (const a of boxes) {
          for (const c of boxes) {
            if (a === c) continue
            const ox = Math.min(a.hit.r, c.box.right) - Math.max(a.hit.l, c.box.left)
            const oy = Math.min(a.hit.b, c.box.bottom) - Math.max(a.hit.t, c.box.top)
            if (ox > 0.5 && oy > 0.5) out.push(`${a.label} over ${c.label}`)
          }
        }
        return [...new Set(out)]
      })
      check(
        `no hit area overlaps a neighbour in an expanded feedback row at ${width}`,
        clash.length === 0,
        clash.slice(0, 3).join(', '),
      )
    }
    await page.close()
  }

  /* ---- every control has a real accessible name, and every field a label -- */
  {
    const page = await open('feedback', 1280)
    if (!page.blank && (await expandRow(page, ROWS.thread))) {
      const r = await page.evaluate(() => {
        const named = (el) => {
          const aria = (el.getAttribute('aria-label') ?? '').trim()
          if (aria) return true
          const id = el.getAttribute('id')
          if (id && document.querySelector(`label[for="${CSS.escape(id)}"]`)) return true
          return (el.textContent ?? '').trim().length > 0
        }
        const controls = [...document.querySelectorAll('button, a[href], select, input, textarea')]
        const fields = [...document.querySelectorAll('.fb-item select, .fb-item textarea, .fb-item input')]
        return {
          count: controls.length,
          unnamed: controls.filter((el) => !named(el)).map((el) => el.tagName + '.' + el.className),
          // A field is bound by a real <label for>, or named by aria-label
          // where a visible label per row would be noise (the status select,
          // which names the item it belongs to).
          fields: fields.map((el) => ({
            tag: el.tagName,
            label: el.id ? !!document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : false,
            aria: (el.getAttribute('aria-label') ?? '').slice(0, 40),
          })),
        }
      })
      check(
        'every control on the feedback page has an accessible name',
        r.count > 10 && r.unnamed.length === 0,
        `${r.count} controls${r.unnamed.length ? ': ' + r.unnamed.slice(0, 4).join(', ') : ''}`,
      )
      check(
        'every field in a row is bound to a label or names its own item',
        r.fields.length > 0 && r.fields.every((f) => f.label || f.aria.length > 0),
        JSON.stringify(r.fields),
      )
    }
    await page.close()
  }

  /* The dialogs' fields, which are the ones a member types into. Every one is
     a real <label for>, which is what the field primitives give them. */
  for (const [what, opener] of [
    ['New feedback', 'New feedback'],
    ['Edit feedback', `Edit ${ROWS.own}`],
    ['Promote to GitHub issue', `Promote ${ROWS.own} to a GitHub issue`],
  ]) {
    const WHAT = `every field in the ${what} dialog is bound to its own label`
    const page = await open('feedback', 1280)
    if (!page.blank && (await pressed(page.getByRole('button', { name: opener, exact: true }), WHAT))) {
      await page.waitForTimeout(250)
      const r = await page.evaluate(() => {
        const fields = [...document.querySelectorAll('.modal input, .modal select, .modal textarea')]
        return fields.map((el) => ({
          id: el.id,
          label: el.id ? (document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent ?? '').trim() : '',
        }))
      })
      check(WHAT, r.length > 0 && r.every((f) => f.id && f.label.length > 0), JSON.stringify(r))
    }
    await page.close()
  }

  /* ---- FOCUS. Measured in a browser before it was repaired, which is what
     #215 and #216 asked for. Every one of these landed on document.body: a
     status change (the select is disabled while it saves), a posted comment
     (the button is disabled and the box empties, so it stays disabled), a
     deleted item (the row and its icon button go), and a REFUSED dialog write
     (Chrome fires no blur when a focused control is disabled, so Modal's own
     focusout recovery never runs, which also leaves Escape and the Tab trap
     dead). ---- */
  const focusNow = (page) =>
    page.evaluate(() => {
      const a = document.activeElement
      if (!a || a === document.body) return 'BODY'
      return `${a.tagName.toLowerCase()}|${(a.getAttribute('aria-label') || a.textContent || '').trim().slice(0, 60)}`
    })

  {
    const WHAT = 'a settled status change puts focus back on the select it was made from'
    const page = await open('feedback', 1280)
    if (!page.blank && (await chose(row(page, ROWS.own).locator('select'), 'planned', WHAT))) {
      await page.waitForTimeout(600)
      const at = await focusNow(page)
      check(WHAT, at.startsWith('select|Status of'), at)
    }
    await page.close()
  }

  {
    const WHAT = 'a posted comment puts focus back in the reply box rather than on the document body'
    const page = await open('feedback', 1280)
    if (!page.blank && (await expandRow(page, ROWS.thread))) {
      const thread = row(page, ROWS.thread)
      if (
        (await typed(thread.getByLabel('Reply', { exact: true }), 'A reply from the check.', WHAT)) &&
        (await pressed(thread.getByRole('button', { name: 'Post comment', exact: true }), WHAT))
      ) {
        await page.waitForTimeout(600)
        const at = await focusNow(page)
        check(WHAT, at.startsWith('textarea'), at)
      }
    }
    await page.close()
  }

  {
    const WHAT = 'a deleted item puts focus on the page action rather than on the row that has gone'
    const page = await open('feedback', 1280)
    if (
      !page.blank &&
      (await pressed(row(page, ROWS.own).getByRole('button', { name: `Delete ${ROWS.own}`, exact: true }), WHAT))
    ) {
      await page.waitForTimeout(250)
      if (await pressed(page.locator('.modal').getByRole('button', { name: 'Delete', exact: true }), WHAT)) {
        await page.waitForTimeout(700)
        const at = await focusNow(page)
        check(WHAT, at === 'button|New feedback', at)
      }
    }
    await page.close()
  }

  {
    const WHAT = 'a refused dialog write leaves focus inside the dialog, so Escape still closes it'
    const page = await open('feedback', 1280, { state: 'writefails' })
    if (!page.blank && (await pressed(page.getByRole('button', { name: 'New feedback', exact: true }), WHAT))) {
      await page.waitForTimeout(250)
      if (
        (await typed(page.locator('.modal').getByLabel('Title', { exact: true }), 'A title from the check', WHAT)) &&
        (await pressed(page.locator('.modal').getByRole('button', { name: 'Send feedback', exact: true }), WHAT))
      ) {
        await page.waitForTimeout(600)
        const at = await focusNow(page)
        const inside = await page.evaluate(() => !!document.querySelector('.modal')?.contains(document.activeElement))
        await page.keyboard.press('Escape')
        await page.waitForTimeout(250)
        const closed = await page.evaluate(() => document.querySelectorAll('.modal').length === 0)
        check(WHAT, inside && closed, `${at}, dialog ${closed ? 'closed' : 'stayed open'}`)
      }
    }
    await page.close()
  }

  /* The other half of the focus claim, and the one that makes it a RESTORE
     rather than a steal: a member who moved elsewhere while a write was
     running keeps their place. `writeslow` settles after a beat, which is
     what leaves room to move. */
  {
    const WHAT = 'a slow status change does not take focus back off a member who moved away'
    const page = await open('feedback', 1280, { state: 'writeslow' })
    if (
      !page.blank &&
      (await chose(row(page, ROWS.own).locator('select'), 'planned', WHAT)) &&
      (await focused(page.getByRole('button', { name: 'New feedback', exact: true }), WHAT))
    ) {
      await page.waitForTimeout(1700)
      const at = await focusNow(page)
      check(WHAT, at === 'button|New feedback', at)
    }
    await page.close()
  }

  /* Focus returns to the ACTUAL opener, not to the first control that looks
     like it. Every row carries a Delete, so a dialog that restored focus to
     `document.querySelector` would land on the wrong one and nothing about
     the first row would say so. */
  {
    const WHAT = 'a dialog returns focus to the row that opened it, not to the first row'
    const page = await open('feedback', 1280)
    const opener = row(page, ROWS.ownPromoted).getByRole('button', {
      name: `Delete ${ROWS.ownPromoted}`,
      exact: true,
    })
    if (!page.blank && (await pressed(opener, WHAT))) {
      await page.waitForTimeout(250)
      await page.keyboard.press('Escape')
      await page.waitForTimeout(250)
      const at = await focusNow(page)
      check(WHAT, at === `button|Delete ${ROWS.ownPromoted}`, at)
    }
    await page.close()
  }

  /* ---- the two claims about a call that must not happen ---- */
  {
    const WHAT = 'a collapsed row reads no comments, and opening one reads only its own'
    const page = await open('feedback', 1280)
    const before = await page.evaluate(() => window.__feedbackCalls?.threads ?? null)
    let after = null
    if (!page.blank && (await expandRow(page, ROWS.thread))) {
      after = await page.evaluate(() => window.__feedbackCalls?.threads ?? null)
    }
    check(
      WHAT,
      Array.isArray(before) && before.length === 0 && Array.isArray(after) && after.length === 1 && after[0] === 'fb-2',
      JSON.stringify({ before, after }),
    )
    await page.close()
  }

  for (const [caps, want] of [
    ['coach', 1],
    ['viewer', 0],
    ['parent', 0],
  ]) {
    const page = await open('feedback', 1280, { caps })
    await page.waitForTimeout(300)
    const n = await page.evaluate(() => window.__feedbackCalls?.refreshFromGithub ?? null)
    check(
      `the admin GitHub refresh fires ${want} time(s) for the ${caps} capability set`,
      n === want,
      `counted ${n}`,
    )
    await page.close()
  }

  /* ---- the external link stays recognisable as one ---- */
  {
    const page = await open('feedback', 1280)
    const r = await page.evaluate(() => {
      const a = document.querySelector('.fb-acts a[href^="https://github.com"]')
      if (!a) return null
      return {
        target: a.getAttribute('target'),
        rel: a.getAttribute('rel'),
        label: a.getAttribute('aria-label'),
        glyph: !!a.querySelector('svg'),
        text: (a.textContent ?? '').trim(),
      }
    })
    check(
      'a promoted item links out with an external glyph, a name and a safe target',
      !!r && r.target === '_blank' && (r.rel ?? '').includes('noreferrer') && r.glyph && /^GitHub issue #\d+$/.test(r.label ?? '') && /^Issue #\d+$/.test(r.text),
      JSON.stringify(r),
    )
    await page.close()
  }

  /* ---- long strings, at the narrowest phone ---- */
  for (const width of [360, 390]) {
    const WHAT = `a long title, body, author and comment stay inside the card at ${width}`
    const page = await open('feedback', width, { state: 'longnames' })
    if (!page.blank && (await expandRow(page, 'Sessionplannerrecalculates'))) {
      const r = await page.evaluate(() => {
        const doc = document.documentElement
        const card = document.querySelector('.card')
        if (!card) return null
        const box = card.getBoundingClientRect()
        const out = [...document.querySelectorAll('.fb-title, .fb-body, .fb-by, .fb-comment-body, .fb-acts a')]
          .filter((el) => {
            const b = el.getBoundingClientRect()
            return b.right > box.right + 1 || b.left < box.left - 1
          })
          .map((el) => (el.textContent ?? '').trim().slice(0, 24))
        return { page: doc.scrollWidth - doc.clientWidth, out }
      })
      check(WHAT, !!r && r.page === 0 && r.out.length === 0, JSON.stringify(r))
    }
    await page.close()
  }

  /* ---- the dismissal contract, RECORDED rather than changed --------------
     Every adopted Registered players dialog passes `dismissible={!busy}`, so
     a write in flight freezes Escape, the overlay and the X. The feedback
     dialogs never have, and this slice deliberately did not change it: the
     brief freezes the dismissibility contract, and moving it is a behaviour
     change rather than an adoption. So it is measured and stated instead of
     being quietly fixed or quietly forgotten.

     It is also the check that made the Modal defect visible. Before the
     recovery in src/components/ui.tsx, this failed: the dialog said it was
     dismissible, the X was enabled and the overlay would close it, and
     Escape did NOTHING, because pressing the submit disabled it and Chrome
     fires no blur for that, so focus was on the document body and the
     dialog's own key handler never ran. The contract was already broken for
     a keyboard; what the fix does is honour the one that is written down. */
  {
    const WHAT = 'a feedback dialog is still dismissible while its write is in flight (unchanged, and unlike the register dialogs)'
    const page = await open('feedback', 1280, { state: 'inflight' })
    if (!page.blank && (await pressed(page.getByRole('button', { name: 'New feedback', exact: true }), WHAT))) {
      await page.waitForTimeout(250)
      if (
        (await typed(page.locator('.modal').getByLabel('Title', { exact: true }), 'A title from the check', WHAT)) &&
        (await pressed(page.locator('.modal').getByRole('button', { name: 'Send feedback', exact: true }), WHAT))
      ) {
        await page.waitForTimeout(400)
        const closeDisabled = await page.evaluate(
          () => document.querySelector('.modal .icon-btn')?.hasAttribute('disabled') ?? null,
        )
        await page.keyboard.press('Escape')
        await page.waitForTimeout(250)
        const gone = await page.evaluate(() => document.querySelectorAll('.modal').length === 0)
        check(WHAT, gone === true && closeDisabled === false, `Escape ${gone ? 'closed it' : 'did not close it'}`)
      }
    }
    await page.close()
  }

  /* THE LIST STAYS A LIST WITH A DIALOG OPEN. Each row wires its own edit,
     delete and promote dialogs, and a Modal renders its own overlay, so a row
     that returned its <li> and its overlays side by side put a <div> among the
     <ul>'s children. Measured before it was fixed: the children read
     LI, DIV, LI, LI, LI, LI, and the separator on the row AFTER the open
     dialog went from 1px to 0, because `.fb-item + .fb-item` is an adjacency
     rule and the <div> broke it. Codex found it; this is what would have.

     Both halves are asserted, because either alone would pass a fix that
     addressed the other: the markup is what assistive technology reads, and
     the border is what a coach sees. */
  {
    const WHAT = 'an open row dialog leaves the list a list, and the next row keeps its separator'
    const page = await open('feedback', 1280)
    const read = () =>
      page.evaluate(() => ({
        children: [...(document.querySelector('.fb-list')?.children ?? [])].map((c) => c.tagName),
        borders: [...document.querySelectorAll('.fb-item')].map((el) => getComputedStyle(el).borderTopWidth),
      }))
    const before = page.blank ? null : await read()
    if (
      before &&
      (await pressed(row(page, ROWS.own).getByRole('button', { name: `Delete ${ROWS.own}`, exact: true }), WHAT))
    ) {
      await page.waitForTimeout(300)
      const after = await read()
      const allRows = (r) => r.children.length === 5 && r.children.every((t) => t === 'LI')
      // The first row carries none by design (the card's own padding is the
      // gap above it); every row after it carries one, dialog or no dialog.
      const separated = (r) => r.borders.length === 5 && r.borders[0] === '0px' && r.borders.slice(1).every((b) => b === '1px')
      check(
        WHAT,
        allRows(before) && separated(before) && allRows(after) && separated(after),
        JSON.stringify({ before, after }),
      )
    }
    await page.close()
  }

  /* A form dialog on a phone is a bottom sheet, so its actions stay above the
     keyboard rather than under it, and the longest body this screen has (the
     public repository caution above two fields) still leaves them on screen.
     Measured rather than assumed: the sheet's own max-height is what keeps
     the footer inside the viewport, and a body that grew past it would push
     the footer out with nothing else saying so. */
  for (const [what, opener] of [
    ['New feedback', 'New feedback'],
    ['Promote to GitHub issue', `Promote ${ROWS.own} to a GitHub issue`],
  ]) {
    const WHAT = `the ${what} dialog is a bottom sheet at 390 with its actions on screen`
    const page = await open('feedback', 390)
    if (!page.blank && (await pressed(page.getByRole('button', { name: opener, exact: true }), WHAT))) {
      await page.waitForTimeout(300)
      const r = await page.evaluate(() => {
        const modal = document.querySelector('.modal')
        const foot = document.querySelector('.modal-foot')
        if (!modal || !foot) return null
        const m = modal.getBoundingClientRect()
        const f = foot.getBoundingClientRect()
        return {
          // Anchored to the bottom of the viewport, which is what the sheet
          // treatment does at and below 900.
          bottom: Math.round(window.innerHeight - m.bottom),
          footerVisible: f.bottom <= window.innerHeight + 1 && f.top >= 0,
          radius: getComputedStyle(modal).borderBottomLeftRadius,
        }
      })
      check(WHAT, !!r && r.bottom === 0 && r.footerVisible && r.radius === '0px', JSON.stringify(r))
    }
    await page.close()
  }

  /* The row's status control keeps a coach's own choice while the write is in
     flight rather than snapping back to the stored value, which is what a
     controlled select does if the screen forgets to hold the pending value.
     Recorded as what it is: this screen does NOT hold one, so the select
     shows the stored status until the write settles. Frozen behaviour. */
  {
    const entry = entryOf('status-pending')
    const page = await open('feedback', 1280, { feedbackEntry: entry })
    const why = page.blank ? 'the surface never painted' : await runFeedbackFlow(page, entry)
    const shown = await page.evaluate(() => {
      const item = [...document.querySelectorAll('.fb-item')].find((el) =>
        (el.textContent ?? '').includes('Timer drifts on the live screen'),
      )
      return item?.querySelector('select')?.value ?? null
    })
    check(
      'a status write in flight leaves the select on the stored value, which is the unchanged behaviour',
      !why && shown === 'new',
      `${why ?? ''} showing ${shown}`,
    )
    await page.close()
  }
}

/* ======================================================================
   VISUAL-02: Admin Users and Admin Teams

   What a screenshot cannot settle on these two screens: whether a tick still
   means the role and the capability its label says it does; whether the club
   is protected from losing its last administrator when the control that says
   so is disabled; whether a press that must NOT write actually wrote;
   whether a dialog returns focus to the control that opened it rather than to
   the first one on the page; and where focus ends up when a removal takes the
   row it was standing on. The first three are claims about identity and about
   calls, so they are read off the control's own accessible name and off the
   harness stub's counter rather than inferred from what is drawn.

   Every state is DRIVEN through tools/visual/admin.mjs, the same entries
   shoot.mjs photographs and contrast.mjs sweeps, so a control that stops
   rendering fails the run rather than producing a plausible measurement. */
{
  const adminEntry = (key) => ADMIN_ENTRIES.find((e) => e.key === key)

  /* The backbone: every entry reaches the state its own name claims, in both
     themes, because most of them are a semantic Note or a Badge whose
     surface, border and glyph all flip. The screenshots and the contrast
     sweep file their results under these names, so a name nothing proves is
     the failure the whole apparatus exists to stop. */
  for (const entry of ADMIN_ENTRIES) {
    for (const theme of ['light', 'dark']) {
      const page = await open(entry.screen ?? 'adminusers', 1280, { adminEntry: entry, theme })
      const why = page.blank ? 'the surface never painted' : await runAdminFlow(page, entry)
      check(`${entry.key} (${theme}): ${entry.note}`, !why, why ?? '')
      await page.close()
    }
  }

  /* ---- the page's own structure ---- */
  for (const [screen, title, ticks] of [
    // Users renders dozens of ticks; Teams renders none, so the two are asked
    // different questions rather than one loose one that passes on an empty
    // page.
    ['adminusers', 'Users', true],
    ['adminteams', 'Teams', false],
  ]) {
    const page = await open(screen, 1280, { caps: 'clubadmin' })
    const r = await page.evaluate(() => {
      const h1s = [...document.querySelectorAll('.content h1')]
      // Every form control on the page, and whether it has a REAL label
      // element bound to it. aria-label is an accessible name with no element
      // behind it, and 2.6 asks for the element.
      const controls = [...document.querySelectorAll('.content input, .content select, .content textarea')]
      const unlabelled = controls
        .filter((el) => {
          if (el.type === 'checkbox') return false // named by the label it sits inside
          const byFor = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null
          return !byFor && !el.closest('label')
        })
        .map((el) => el.tagName + (el.id || el.getAttribute('aria-label') || ''))
      // Every checkbox has a name, whichever way it gets one.
      const checkboxes = [...document.querySelectorAll('.content input[type="checkbox"]')]
      const namelessBoxes = checkboxes.filter(
        (el) => !el.getAttribute('aria-label') && !(el.closest('label')?.textContent ?? '').trim(),
      ).length
      // No icon only control is left without an accessible name.
      const namelessIcons = [...document.querySelectorAll('.content .icon-btn')].filter(
        (el) => !el.getAttribute('aria-label'),
      ).length
      // Every heading in the content frame, in document order, as a level.
      // A page whose only levels are 1 and 3 has a hole a screen reader user
      // navigating by level falls into.
      const levels = [...document.querySelectorAll('.content h1, .content h2, .content h3, .content h4')].map((h) =>
        Number(h.tagName.slice(1)),
      )
      return {
        h1: h1s.length,
        title: (h1s[0]?.textContent ?? '').trim(),
        levels,
        unlabelled,
        checkboxes: checkboxes.length,
        namelessBoxes,
        namelessIcons,
      }
    })
    check(`${screen}: exactly one h1 and it names the page`, r.h1 === 1 && r.title === title, JSON.stringify(r))
    check(
      `${screen}: heading levels do not skip one`,
      r.levels.every((lv, i) => i === 0 || lv <= r.levels[i - 1] + 1),
      JSON.stringify(r.levels),
    )
    check(`${screen}: every field has a real label element bound to it`, r.unlabelled.length === 0, JSON.stringify(r.unlabelled))
    check(
      `${screen}: every tick control exposes a name`,
      r.namelessBoxes === 0 && (ticks ? r.checkboxes > 0 : r.checkboxes === 0),
      JSON.stringify(r),
    )
    check(`${screen}: every icon only action has an accessible name`, r.namelessIcons === 0, JSON.stringify(r))
    await page.close()
  }

  /* ---- the capability grid is a real table ---- */
  {
    const page = await open('adminusers', 1280, { caps: 'clubadmin' })
    const r = await page.evaluate(() => {
      const table = document.querySelector('table.cap-grid')
      if (!table) return null
      const colHeads = [...table.querySelectorAll('thead th')]
      const rowHeads = [...table.querySelectorAll('tbody th')]
      return {
        caption: (table.querySelector('caption')?.textContent ?? '').trim(),
        cols: colHeads.length,
        colScopes: colHeads.every((th) => th.getAttribute('scope') === 'col'),
        rows: rowHeads.length,
        rowScopes: rowHeads.every((th) => th.getAttribute('scope') === 'row'),
        // The table scrolls inside its own container, never the page body.
        scrollsItself: !!table.closest('.cap-scroll'),
      }
    })
    check(
      'the capability grid is a table with a caption and scoped headers, scrolling in its own container',
      !!r && !!r.caption && r.cols === 6 && r.colScopes && r.rows > 0 && r.rowScopes && r.scrollsItself,
      JSON.stringify(r),
    )
    await page.close()
  }

  /* ---- hit areas, on both screens ---- */
  for (const [screen, selectors] of [
    ['adminusers', ['.check-row', '.check-cell', '.icon-btn', '.btn-sm']],
    ['adminteams', ['.icon-btn', '.btn-sm', '.field select']],
  ]) {
    for (const width of [360, 1280]) {
      const page = await open(screen, width, { caps: 'clubadmin' })
      for (const sel of selectors) {
        if (page.blank) break
        await page.locator(sel).first().scrollIntoViewIfNeeded().catch(() => {})
        const r = await page.evaluate((s) => {
          const el = document.querySelector(s)
          if (!el) return null
          const b = el.getBoundingClientRect()
          const a = getComputedStyle(el, '::after')
          const px = (v) => (v.endsWith('px') ? parseFloat(v) : 0)
          return {
            h: Math.round(b.height),
            w: Math.round(b.width),
            pseudo: a.content === 'none' ? null : { w: Math.round(px(a.width)), h: Math.round(px(a.height)) },
          }
        }, sel)
        const h = r ? Math.max(r.h, r.pseudo ? r.pseudo.h : 0) : 0
        check(`${screen} at ${width}: ${sel} reaches a 44px hit area`, h >= 44, JSON.stringify(r))
      }
      await page.close()
    }
  }

  /* The grid's ticks are 44px boxes 92px apart, so an enlarged target cannot
     reach its neighbour. Measured rather than reasoned: the ListInput rows
     and the row overflow menu both met exactly this overlap. */
  {
    const page = await open('adminusers', 1280, { caps: 'clubadmin' })
    const overlaps = await page.evaluate(() => {
      const boxes = [...document.querySelectorAll('.check-cell')].map((el) => el.getBoundingClientRect())
      let hits = 0
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i]
          const b = boxes[j]
          if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) hits++
        }
      }
      return { cells: boxes.length, hits }
    })
    check(
      'no two capability ticks share a pixel of hit area',
      overlaps.cells > 20 && overlaps.hits === 0,
      JSON.stringify(overlaps),
    )
    await page.close()
  }

  /* ---- the tick works from the keyboard, and its state follows ---- */
  {
    const WHAT = 'a capability tick toggles from the keyboard and its state follows'
    const page = await open('adminusers', 1280, { caps: 'clubadmin' })
    const box = page.getByRole('checkbox', { name: `Manage drills for ${ROLES.coach}`, exact: true })
    if (await focused(box, WHAT)) {
      await page.keyboard.press('Space')
      await page.waitForTimeout(200)
      const after = await tickState('Manage drills', ROLES.coach)(page)
      check(WHAT, !!after && after.checked === true, JSON.stringify(after))
    }
    await page.close()
  }

  /* ---- a dialog returns focus to the control that opened it ----
     The ACTUAL opener, which is why this opens the third row's Remove rather
     than the first: a repair that focused whatever came first would pass on
     row one and be wrong everywhere else. */
  for (const [screen, opener] of [
    ['adminusers', `Remove ${MEMBERS.admin}`],
    ['adminteams', 'Remove Gladiators'],
  ]) {
    const WHAT = `${screen}: Escape closes the dialog and focus returns to the control that opened it`
    const page = await open(screen, 1280, { caps: 'clubadmin' })
    const trigger = page.getByRole('button', { name: opener, exact: true })
    if (await pressed(trigger, WHAT)) {
      await page.waitForTimeout(250)
      const opened = await page.locator('.modal').count()
      await page.keyboard.press('Escape')
      await page.waitForTimeout(250)
      const r = await page.evaluate(() => ({
        dialogs: document.querySelectorAll('.modal').length,
        focused: document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.tagName ?? null,
      }))
      check(WHAT, opened === 1 && r.dialogs === 0 && r.focused === opener, JSON.stringify({ opened, ...r }))
    }
    await page.close()
  }

  /* ---- the focus repair, both halves ----
     The defect: pressing Send disables it, and on a success the cleared
     fields keep it disabled, so the browser drops focus onto the document
     body and an administrator who clicked rather than pressing Enter is left
     at the top of the page with a message they have to hunt for.

     Both halves are driven, because a repair that always moves focus is worse
     than the defect: somebody who carried on working through the write must
     keep their place. */
  {
    const WHAT = 'the invite outcome takes focus when the browser dropped it'
    const entry = adminEntry('invite-ok')
    const page = await open('adminusers', 1280, { adminEntry: entry })
    const why = page.blank ? 'the surface never painted' : await runAdminFlow(page, entry)
    check(WHAT, !why, why ?? '')
    await page.close()
  }
  {
    const WHAT = 'the invite outcome does NOT take focus from somebody who moved on during the write'
    const page = await open('adminusers', 1280, { adminEntry: { screen: 'adminusers', state: 'writeslow' } })
    const card = page.locator('.card').filter({ has: page.getByRole('heading', { name: 'Invite someone', exact: true }) })
    const ok =
      (await typed(card.getByLabel('Email', { exact: true }), 'new.coach@example.invalid', WHAT)) &&
      (await typed(card.getByLabel('Full name', { exact: true }), 'Alex Nowell', WHAT)) &&
      (await pressed(card.getByRole('button', { name: 'Send invite', exact: true }), WHAT))
    if (ok) {
      /* The write is still out. Move somewhere else, exactly as an
         administrator carrying on with the page would.

         The field is MARKED first, so what is compared afterwards is that
         element rather than its tag name: every role, team and capability
         tick on this screen is an INPUT too, so a repair that moved focus
         onto one of them passed a check named for focus staying put. */
      await page.evaluate(() => {
        document.querySelector('.card input[type="email"]')?.setAttribute('data-moved-to', 'yes')
      })
      await focused(card.getByLabel('Email', { exact: true }), WHAT)
      await page.waitForTimeout(1800)
      const r = await page.evaluate(() => {
        const el = document.activeElement
        return {
          onField: !!el && el.getAttribute('data-moved-to') === 'yes',
          outcome: document.querySelectorAll('.note-success').length,
        }
      })
      check(WHAT, r.onField && r.outcome === 1, JSON.stringify(r))
    }
    await page.close()
  }

  /* ---- the bib colour is never colour alone ---- */
  {
    const page = await open('adminteams', 1280, { caps: 'clubadmin' })
    const r = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('.admin-row')]
      return rows.map((row) => {
        const select = row.querySelector('select')
        const swatch = row.querySelector('.bib-swatch')
        return {
          word: select ? (select.options[select.selectedIndex]?.textContent ?? '').trim() : null,
          swatch: !!swatch,
          // The swatch carries no information of its own, so it is hidden
          // from assistive technology rather than read as a stray graphic.
          hidden: swatch ? swatch.getAttribute('aria-hidden') === 'true' : null,
        }
      })
    })
    check(
      'every team names its bib colour in words, with the swatch supplementary and hidden',
      r.length > 0 && r.every((x) => !!x.word) && r.some((x) => x.swatch) && r.every((x) => x.hidden !== false),
      JSON.stringify(r),
    )
    await page.close()
  }

  /* ---- long names do not overflow ---- */
  for (const screen of ['adminusers', 'adminteams']) {
    const page = await open(screen, 360, { adminEntry: { screen, state: 'longnames' } })
    const over = await page.evaluate(() => ({
      body: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
    }))
    check(`${screen} at 360 with the longest names the club can type: the page does not scroll sideways`, over.body === 0, JSON.stringify(over))
    await page.close()
  }

  /* ---- a destructive control is unmistakably destructive ---- */
  {
    const page = await open('adminusers', 1280, { adminEntry: adminEntry('remove-open') })
    await runAdminFlow(page, adminEntry('remove-open'))
    /* Found by its VARIANT, not by the text it is then asserted to carry.
       Selecting on "Remove member" and then testing /Remove/ against what was
       selected cannot fail: nothing reaches the assertion unless it already
       held. What is claimed is that the danger control says what it does. */
    const r = await page.evaluate(() => {
      const confirm = document.querySelector('.modal-foot button.btn-danger')
      if (!confirm) return null
      const cs = getComputedStyle(confirm)
      return { word: (confirm.textContent ?? '').trim(), fill: cs.backgroundColor }
    })
    check(
      'the destructive confirm carries the word as well as the danger fill',
      !!r && /^Remove member$/.test(r.word) && r.fill !== 'rgba(0, 0, 0, 0)',
      JSON.stringify(r),
    )
    await page.close()
  }

  /* ---- mounting the component grants nothing ----
     Both screens sit behind a real RequireCap. This is the same claim the
     capability matrix entries make, measured once more against the ROUTE
     rather than against the markup, because an absence is not a redirect: a
     blank frame, a guard returning null and a redirect to the wrong place all
     lack the heading a markup check looks for. */
  for (const [screen, caps] of [
    ['adminusers', 'coach'],
    ['adminusers', 'parent'],
    ['adminteams', 'planner'],
    ['adminteams', 'parent'],
  ]) {
    const page = await open(screen, 1280, { caps })
    const r = await page.evaluate(() => ({
      path: document.querySelector('.content')?.getAttribute('data-path') ?? null,
      rows: document.querySelectorAll('.admin-row').length,
    }))
    /* The write half goes through `noWrites` rather than summing the log
       here. Summing it read the recorded ORDER as a value: `0 + []` is the
       STRING "0", so the sum never equalled 0 again and four redirect proofs
       failed for a reason that had nothing to do with a redirect. Reusing the
       helper also keeps the one rule about a renamed or emptied counter in
       one place. */
    const wrote = !(await noWrites(page))
    check(
      `${screen}: a member without the capability is redirected rather than shown the screen (${caps})`,
      r.path === '/' && r.rows === 0 && !wrote,
      JSON.stringify({ ...r, wrote }),
    )
    await page.close()
  }

  /* ---- the two rows a driver names are the rows it thinks they are ----
     A visual refactor must not move which control belongs to which member or
     which role, and both lists are the same row class inside one page. */
  {
    const page = await open('adminusers', 1280, { caps: 'clubadmin' })
    const r = {
      memberHasOwnRemove:
        (await memberRow(page, MEMBERS.other).getByRole('button', { name: `Remove ${MEMBERS.other}` }).count()) === 1,
      memberHasNoOtherRemove:
        (await memberRow(page, MEMBERS.other).getByRole('button', { name: `Remove ${MEMBERS.invited}` }).count()) === 0,
      roleHasOwnDelete:
        (await roleRow(page, ROLES.custom).getByRole('button', { name: `Delete ${ROLES.custom}` }).count()) === 1,
      systemRoleHasNone: (await roleRow(page, ROLES.parent).getByRole('button').count()) === 0,
    }
    check('each row carries only its own actions', Object.values(r).every(Boolean), JSON.stringify(r))
    await page.close()
  }
  {
    const page = await open('adminteams', 1280, { caps: 'clubadmin' })
    const r = {
      ownRemove: (await teamRow(page, 'Titans').getByRole('button', { name: 'Remove Titans' }).count()) === 1,
      ownField: (await teamRow(page, 'Titans').locator('input').inputValue()) === 'Titans',
      ownBib: (await teamRow(page, 'Titans').locator('select').inputValue()) === 'blue',
      otherBib: (await teamRow(page, 'Trojans').locator('select').inputValue()) === 'red',
    }
    check('each team row edits its own name and its own bib', Object.values(r).every(Boolean), JSON.stringify(r))
    await page.close()
  }

  /* ---- COACH-1B: the order is moved from the keyboard, and focus stays on the moved row ----
     Moving a row moves its DOM node, and moving it to the top disables the
     control that was pressed; either can leave focus on the body. The rule
     under test is that it never does: the same control when it is still
     usable, its partner on the same row when it is not. Driven from the
     keyboard, because no drag gesture exists and Enter and Space are the
     whole of the interaction. */
  {
    const page = await open('adminteams', 1280, { caps: 'clubadmin' })
    const state = () =>
      page.evaluate(() => ({
        order: [...document.querySelectorAll('.admin-row button[aria-label^="Remove "]')].map((b) =>
          (b.getAttribute('aria-label') ?? '').replace('Remove ', ''),
        ),
        active: document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.tagName ?? 'none',
        activeDisabled: !!(document.activeElement && document.activeElement.disabled),
      }))
    // A move that ends at the boundary: Move Trojans up disables itself.
    await page.getByRole('button', { name: 'Move Trojans up', exact: true }).focus()
    await page.keyboard.press('Enter')
    await page.waitForTimeout(150)
    const top = await state()
    check('Enter on Move up moves the row from the keyboard', top.order[0] === 'Trojans' && top.order[1] === 'Titans', JSON.stringify(top))
    check(
      "a move that reaches the top puts focus on the same row's Move down, never on the body or a disabled control",
      top.active === 'Move Trojans down' && !top.activeDisabled,
      JSON.stringify(top),
    )
    // A move short of a boundary: the pressed control is still usable and keeps focus.
    await page.getByRole('button', { name: 'Move Spartans up', exact: true }).focus()
    await page.keyboard.press('Space')
    await page.waitForTimeout(150)
    const mid = await state()
    check('Space on Move up moves a row too', mid.order[2] === 'Spartans' && mid.order[3] === 'Gladiators', JSON.stringify(mid))
    check('a move short of a boundary keeps focus on the control that was pressed', mid.active === 'Move Spartans up' && !mid.activeDisabled, JSON.stringify(mid))
    // The bottom boundary, the other way round.
    await page.getByRole('button', { name: 'Move Spartans down', exact: true }).focus()
    await page.keyboard.press('Enter')
    await page.waitForTimeout(150)
    await page.getByRole('button', { name: 'Move Argonauts down', exact: true }).count()
    await page.getByRole('button', { name: 'Move Spartans down', exact: true }).focus()
    await page.keyboard.press('Enter')
    await page.waitForTimeout(150)
    const bottom = await state()
    check(
      "a move that reaches the bottom puts focus on the same row's Move up",
      bottom.order[bottom.order.length - 1] === 'Spartans' && bottom.active === 'Move Spartans up' && !bottom.activeDisabled,
      JSON.stringify(bottom),
    )
    check('four moves wrote nothing', await noWrites(page), '')
    await page.close()
  }

  /* ---- the ordering cluster at 360: its own line, inside the card, 44px targets, under the longest names ---- */
  {
    const page = await open('adminteams', 360, { adminEntry: adminEntry('teams-long-name') })
    if (!page.blank) {
      const r = await page.evaluate(() => {
        const card = document.querySelector('.card')?.getBoundingClientRect()
        return [...document.querySelectorAll('.admin-row')].map((row) => {
          const cluster = row.querySelector('.admin-order-acts')?.getBoundingClientRect()
          const field = row.querySelector('.admin-field-grow')?.getBoundingClientRect()
          // The hit area is what the ::after pseudo element reaches, the
          // same measurement the hit area check above takes: the visible
          // box of an icon button is 38px by design and the target is 44.
          const px = (v) => (v.endsWith('px') ? parseFloat(v) : 0)
          const targets = [...row.querySelectorAll('.admin-order-acts .icon-btn')].map((b) => {
            const box = b.getBoundingClientRect()
            const a = getComputedStyle(b, '::after')
            const pseudo = a.content === 'none' ? 0 : Math.min(px(a.width), px(a.height))
            return Math.max(Math.min(box.width, box.height), pseudo)
          })
          return {
            inside: !!card && !!cluster && cluster.right <= card.right + 0.5 && cluster.left >= card.left - 0.5,
            ownLine: !!cluster && !!field && cluster.top >= field.bottom - 0.5,
            targets: targets.length === 2 && targets.every((t) => t >= 44),
            noScroll: document.documentElement.scrollWidth <= 360,
          }
        })
      })
      check(
        'at 360 every ordering cluster sits on its own line inside the card with two 44px targets, under names as long as a club could type',
        r.length === 7 && r.every((x) => x.inside && x.ownLine && x.targets && x.noScroll),
        JSON.stringify(r),
      )
    } else {
      check('the long names Teams screen paints at 360', false, 'the surface never painted')
    }
    await page.close()
  }
}

/* ---- reduced motion ---- */
{
  const page = await open('dialog', 1280, { reducedMotion: true })
  await page.waitForTimeout(200)
  const name = await page.evaluate(() => {
    const m = document.querySelector('.modal')
    return m ? getComputedStyle(m).animationName : 'no dialog'
  })
  check('reduced motion removes the dialog entry animation', name === 'none', name)
  await page.close()
}

// Every line was printed as it was recorded, so this is the summary rather
// than the results.
console.log(`${out.length} checks ran, ${out.filter((l) => l.startsWith('FAIL')).length} failed`)
await context.close()
await browser.close()
if (out.some((line) => line.startsWith('FAIL'))) process.exitCode = 1
