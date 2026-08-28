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

const BASE = process.env.HARNESS ?? 'http://localhost:5199'
await assertServingCurrentBuild(BASE)
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
  const q = new URLSearchParams({ screen, theme: opts.theme ?? 'light' })
  if (opts.caps) q.set('caps', opts.caps)
  if (opts.state) q.set('state', opts.state)
  await page.goto(`${BASE}/?${q}`, { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => document.fonts.ready)
  // domcontentloaded fires before React has rendered anything, so a check that
  // evaluated straight after this read an empty page. Every check here asserts
  // about rendered output, so waiting for the app to have painted belongs in
  // ONE place rather than in each of them. Without it the error state check
  // reported a false FAIL on roughly one run in three.
  await page.waitForSelector('.content > *, .login', { state: 'attached', timeout: 5000 })
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
  ]) {
    const page = await open(screen, width)
    const r = await page.evaluate(() => {
      // Every control whose hit area comes from an ::after: does that box
      // reach into a NEIGHBOURING control's own visible box? Two chips on
      // wrapped rows are the case worth checking, since each pseudo extends
      // five pixels past a 34px chip into the row gap.
      const els = [...document.querySelectorAll('.chip, .btn-sm, .icon-btn, .toggle')]
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
  {
    const page = await open('players', 1280)
    const r = await page.evaluate(() => {
      const badges = [...document.querySelectorAll('td .badge')]
      return badges.slice(0, 3).map((b) => ({
        cls: b.className,
        dot: !!b.querySelector('.badge-dot'),
        word: b.textContent.trim(),
        dotColour: b.querySelector('.badge-dot') ? getComputedStyle(b.querySelector('.badge-dot')).backgroundColor : null,
      }))
    })
    check(
      'every status badge carries a dot and a word, so status is never colour alone',
      r.length > 0 && r.every((b) => b.dot && b.word.length > 0 && b.dotColour !== 'rgba(0, 0, 0, 0)'),
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
      ring.reach > 0 && ring.top === 0 && ring.left === 0 && !ring.scrolls,
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
    await page.getByRole('button', { name: 'Select players', exact: true }).click()
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
    const page = await open('players', 1280)
    await page.getByRole('button', { name: 'Select players', exact: true }).click()
    await page.getByRole('button', { name: /^Select all \d+ shown$/ }).click()
    await page.getByRole('button', { name: /^Delete \d+ players?$/ }).click()
    await page.waitForTimeout(250)
    const confirm = page.getByRole('button', { name: /permanently$/ })
    check('the destructive dialog opens with its confirm button inert', await confirm.isDisabled())
    check(
      'the dialog took focus, so Escape and the Tab trap are live',
      await page.evaluate(() => document.activeElement.classList.contains('modal')),
    )
    await page.getByLabel(/^To confirm, type/).fill('DELETE 7 PLAYERS')
    await page.waitForTimeout(120)
    check('a phrase naming the wrong count leaves it inert', await confirm.isDisabled())
    await page.getByLabel(/^To confirm, type/).fill('DELETE 8 PLAYERS')
    await page.waitForTimeout(120)
    check('the phrase naming the count arms it', !(await confirm.isDisabled()))
    const danger = await page.evaluate(() => {
      const b = [...document.querySelectorAll('.modal button')].find((x) => /permanently$/.test(x.textContent.trim()))
      return { cls: b.className, fill: getComputedStyle(b).backgroundColor, word: /Delete/.test(b.textContent) }
    })
    check(
      'the destructive control is the danger variant and says the word, not only the colour',
      danger.cls.includes('btn-danger') && danger.word,
      JSON.stringify(danger),
    )
    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)
    check('Escape closes it and nothing was deleted', await page.evaluate(() => !document.querySelector('.modal')))
    await page.close()
  }

  // The over limit refusal, reached with a register past the server's cap.
  {
    const page = await open('players', 1280, { state: 'overlimit' })
    await page.getByRole('button', { name: 'Select players', exact: true }).click()
    await page.getByRole('button', { name: /^Select all \d+ shown$/ }).click()
    await page.getByRole('button', { name: /^Delete \d+ players?$/ }).click()
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
    await page.getByRole('button', { name: 'Select players', exact: true }).click()
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
