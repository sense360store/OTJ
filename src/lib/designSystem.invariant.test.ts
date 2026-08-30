/// <reference types="node" />
// =====================================================================
// The VISUAL-01 design system, pinned.
//
// WHAT THIS IS AND IS NOT. Half of this file is a real computation: it
// parses the token blocks out of src/styles.css and measures every
// semantic pairing against the WCAG contrast floors VISUAL-00 settled, in
// BOTH themes. That half cannot be satisfied by writing the right words;
// a token nudged to a prettier hue fails it with a number.
//
// The other half is a source-text tripwire, in the style of
// eventKind.invariant and sessionLifecycle.invariant, and it carries their
// caveat: it catches the realistic mistakes (a literal size creeping back
// into the shared stylesheet, a classification colour borrowed to mean a
// state, an icon button shipped with no accessible name) and it cannot
// catch a value that reaches the same place through a variable. Treat a
// pass as "nobody typed the obvious thing", never as proof.
//
// See docs/design/visual-design-read.md Part 2 for the decisions.
// =====================================================================
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const srcDir = fileURLToPath(new URL('..', import.meta.url))
const styles = readFileSync(join(srcDir, 'styles.css'), 'utf8')

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    return statSync(full).isDirectory() ? walk(full) : [full]
  })
}

const sourceFiles = walk(srcDir).filter(
  (f) => (f.endsWith('.tsx') || f.endsWith('.ts') || f.endsWith('.css')) && !f.includes('.test.'),
)
const read = (f: string) => readFileSync(f, 'utf8')
const rel = (f: string) => f.slice(srcDir.length)

/* The files each landed wave OWNS: what it brought onto the shared system
   and is therefore answerable for keeping there. Read by the type scale rule
   and by the spacing rule below, which are two different questions about the
   same list; it lives here so neither can drift from the other. Widen it as
   each wave lands rather than weakening either rule. */
const OWNED_FILES = [
  'components/ui.tsx',
  'components/primitives.tsx',
  'components/Sidebar.tsx',
  'components/TopBar.tsx',
  'components/BottomNav.tsx',
  'components/Crest.tsx',
  'components/UserAvatar.tsx',
  'routes/Players.tsx',
  'components/PlayerFilters.tsx',
  'components/BulkDeletePlayersModal.tsx',
  'components/PlayerFormModal.tsx',
  'components/PlayerActionModals.tsx',
  'components/PlayerHistoryModal.tsx',
  'components/ExportConfirmModal.tsx',
  'components/ImportPlayersModal.tsx',
  'components/RenewSeasonModal.tsx',
  'routes/Activity.tsx',
  'routes/Account.tsx',
  'components/AuthCard.tsx',
  'routes/Login.tsx',
  'routes/SetPassword.tsx',
]



// JSX opening tags cannot be matched with `<button[^>]*>`: an arrow function
// in onClick contains a `>` and truncates the match, which silently drops
// every attribute written after it. This walks to the real end of the tag.
function openingTags(src: string, tag: string): string[] {
  const out: string[] = []
  let i = src.indexOf(`<${tag}`)
  while (i !== -1) {
    let depth = 0
    let j = i + tag.length + 1
    for (; j < src.length; j++) {
      const c = src[j]
      if (c === '{') depth++
      else if (c === '}') depth--
      else if (c === '>' && depth === 0 && src[j - 1] !== '=') break
    }
    out.push(src.slice(i, j + 1))
    i = src.indexOf(`<${tag}`, j)
  }
  return out
}


// Names the site of a match so an allowlist can compare WHAT was found rather
// than how much: the selector for a CSS declaration, the trimmed line for a
// JSX one.
function siteOf(src: string, index: number, isCss: boolean): string {
  if (!isCss) {
    const start = src.lastIndexOf('\n', index) + 1
    const end = src.indexOf('\n', index)
    return src.slice(start, end === -1 ? undefined : end).trim()
  }
  const open = src.lastIndexOf('{', index)
  const prev = Math.max(src.lastIndexOf('}', open), src.lastIndexOf('*/', open))
  return src
    .slice(prev + 1, open)
    .replace(/\s+/g, ' ')
    .trim()
}

/* ---- the token blocks, parsed ---------------------------------- */

function block(selector: string): Record<string, string> {
  const start = styles.indexOf(selector + ' {')
  expect(start, `${selector} block`).toBeGreaterThan(-1)
  const body = styles.slice(start, styles.indexOf('\n}', start))
  const out: Record<string, string> = {}
  // Not anchored to the line start: the semantic roles are declared three to
  // a line, and an anchored pattern silently reads only the first of each,
  // which is how --danger-fg and --danger-surface went missing from the first
  // version of this parser while every test still passed.
  for (const m of body.matchAll(/(?:^|\s)(--[a-z0-9-]+): *([^;]+);/gm)) out[m[1]] = m[2].trim()
  return out
}

const LIGHT = block(':root')
const DARK = block('.theme-dark')

// A token's value in a theme: the dark block only redefines what it
// changes, so an unlisted token keeps its light value.
const value = (token: string, dark: boolean) => (dark ? (DARK[token] ?? LIGHT[token]) : LIGHT[token])

const HEX = /^#[0-9a-fA-F]{6}$/

function channels(hex: string): [number, number, number] {
  expect(hex, `${hex} is a six digit hex`).toMatch(HEX)
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number]
}

function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const ratio = (fg: string, bg: string, dark: boolean) => contrast(value(fg, dark), value(bg, dark))

// Every place a token is used as a FOREGROUND, named by its CSS selector or
// its JSX line so an allowlist can compare what was found rather than how
// much. The lookbehind is what keeps `border-color:` out of the results.
function foregroundSites(token: string): Set<string> {
  const out = new Set<string>()
  for (const f of sourceFiles) {
    const src = read(f)
    const isCss = f.endsWith('.css')
    const pattern = isCss
      ? new RegExp(`(?<![-a-z])color: *var\\(${token}\\)`, 'g')
      : new RegExp(`(?<![-a-z])color: *'var\\(${token}\\)'`, 'g')
    for (const m of src.matchAll(pattern)) out.add(`${rel(f)}: ${siteOf(src, m.index!, isCss)}`)
  }
  return out
}

// A colour laid over a ground at a given alpha, for the tints that are
// written as color-mix() and so have no token of their own.
function mix(fg: string, bg: string, alpha: number): string {
  // channels() is normalised to 0..1, so the blend is scaled back to bytes.
  // Without that every mix rounded to #010101 and the tint assertion failed
  // at 1.69:1 against a colour that is nowhere on the screen.
  const [r1, g1, b1] = channels(fg)
  const [r2, g2, b2] = channels(bg)
  const blend = (a: number, b: number) => Math.round((a * alpha + b * (1 - alpha)) * 255)
  return '#' + [blend(r1, r2), blend(g1, g2), blend(b1, b2)].map((v) => v.toString(16).padStart(2, '0')).join('')
}

/* ---- 2.2 contrast floors, measured ----------------------------- */

describe('the semantic state roles meet their contrast floors in both themes', () => {
  const ROLES = ['danger', 'success', 'warning', 'info'] as const

  for (const theme of ['light', 'dark'] as const) {
    const dark = theme === 'dark'

    for (const role of ROLES) {
      it(`${theme}: --${role} reads as text on the card, and its label reads on its own fill`, () => {
        // Body and secondary text: 4.5:1. The hue is what an error message
        // and a menu item's destructive label are painted with.
        expect(ratio(`--${role}`, '--card', dark)).toBeGreaterThanOrEqual(4.5)
        // A filled control's label against its own fill: 4.5:1. This is the
        // floor the bulk delete confirm button used to fail at 3.34:1.
        expect(ratio(`--${role}-fg`, `--${role}`, dark)).toBeGreaterThanOrEqual(4.5)
        // Note text sits at --ink on the tinted surface.
        expect(ratio('--ink', `--${role}-surface`, dark)).toBeGreaterThanOrEqual(4.5)
        // The Note's border is the hue on the tinted surface it encloses,
        // and it is a meaning bearing edge: 3:1.
        expect(ratio(`--${role}`, `--${role}-surface`, dark)).toBeGreaterThanOrEqual(3)
      })
    }

    it(`${theme}: --focus rings clear 3:1 against every surface it can land on`, () => {
      for (const surface of ['--card', '--bg', '--bg-2']) {
        expect(ratio('--focus', surface, dark), `--focus on ${surface}`).toBeGreaterThanOrEqual(3)
      }
    })

    it(`${theme}: --slate carries text and --slate-2 carries control borders`, () => {
      // --slate-2 was demoted to a non text role. What it must still do is
      // outline a control at 3:1, on the card AND on the --bg an input sits on.
      for (const surface of ['--card', '--bg', '--bg-2', '--line']) {
        expect(ratio('--slate-2', surface, dark), `--slate-2 on ${surface}`).toBeGreaterThanOrEqual(3)
      }
      for (const surface of ['--card', '--bg', '--bg-2']) {
        expect(ratio('--slate', surface, dark), `--slate on ${surface}`).toBeGreaterThanOrEqual(4.5)
        expect(ratio('--ink', surface, dark), `--ink on ${surface}`).toBeGreaterThanOrEqual(4.5)
        expect(ratio('--ink-2', surface, dark), `--ink-2 on ${surface}`).toBeGreaterThanOrEqual(4.5)
      }
    })

    it(`${theme}: the primary and gold buttons carry their own labels`, () => {
      // Both the resting and the hover fill, because a hover that drops
      // below the floor is still a control a coach is reading.
      expect(contrast('#ffffff', value('--navy', dark))).toBeGreaterThanOrEqual(4.5)
      expect(contrast('#ffffff', value('--navy-900', dark))).toBeGreaterThanOrEqual(4.5)
      // Gold does not darken in the dark theme, so its label rides on
      // --gold-fg rather than --ink, which flips to near white.
      expect(ratio('--gold-fg', '--gold', dark)).toBeGreaterThanOrEqual(4.5)
      expect(ratio('--gold-fg', '--gold-600', dark)).toBeGreaterThanOrEqual(4.5)
      // Gold is only ever a fill behind dark text, never text on the card.
      expect(ratio('--ink', '--gold-soft', dark)).toBeGreaterThanOrEqual(4.5)
      // The active navigation item is a navy fill with a GOLD icon, which is
      // the thing 2.11 says must not become a generic grey highlight. That
      // pairing has a floor of its own, and lightening --navy for the dark
      // theme is what put it at 2.75:1 before this was asserted.
      expect(ratio('--gold', '--navy', dark)).toBeGreaterThanOrEqual(3)
      expect(ratio('--gold', '--navy-900', dark)).toBeGreaterThanOrEqual(3)
    })

    it(`${theme}: a classification tag reads on its own tint`, () => {
      if (dark) {
        // A media hue is a fill under --on-accent rather than text. In dark
        // the hues are VISUAL-01's own and --on-accent flips to ink, so the
        // badge label reads; the light pairs are the frozen palette and are
        // recorded below rather than asserted.
        for (const hue of ['--m-video', '--m-youtube', '--m-image', '--m-pdf']) {
          expect(ratio('--on-accent', hue, true), `--on-accent on ${hue}`).toBeGreaterThanOrEqual(4.5)
        }
        // The dark values are VISUAL-01's own, so they meet the text floor.
        for (const hue of ['--c-technical', '--c-physical', '--c-social', '--c-psych']) {
          expect(ratio(hue, '--card', true), `${hue} on --card`).toBeGreaterThanOrEqual(4.5)
        }
      }
    })
  }
})

// The eight classification values, frozen: whether the four corners hues move
// at all is Part 5's open product decision. Module scope because two describes
// need them, one measuring the pairing and one hunting the same value written
// out as a literal.
const FROZEN: Record<string, string> = {
  '--c-technical': '#1f43d6',
  '--c-physical': '#16a34a',
  '--c-social': '#ef8e1b',
  '--c-psych': '#7c4dff',
  '--m-video': '#1f43d6',
  '--m-youtube': '#e23b3b',
  '--m-image': '#16a34a',
  '--m-pdf': '#ef5a5a',
}

describe('the frozen classification hues, and the gap they leave', () => {
  // .corner-* paints the hue as its own label. In LIGHT that is
  // --c-technical 7.41:1, --c-psych 4.81:1, --c-physical 3.30:1 and
  // --c-social 2.45:1 on the card, so two of the four do not meet the text
  // floor and one of those does not meet 3:1 either. VISUAL-01 cannot fix that from
  // here and does not pretend to: the VALUES are frozen (whether the four
  // corners hues move at all is Part 5's open product decision) and 2.7
  // keeps the tag's appearance unchanged. What this test does is stop them
  // drifting, so the decision is made deliberately rather than by a nudge.
  // The fix belongs to the Library and Media wave, with the hue decision
  // settled; the same gap is recorded in the VISUAL-01 pull request.

  it('keeps the light classification values exactly as they were', () => {
    for (const [token, hex] of Object.entries(FROZEN)) expect(LIGHT[token], token).toBe(hex)
  })

  it('records the light media badge ratios that remain below the text floor', () => {
    // The same frozen palette, as a badge fill under a white label. Only
    // --m-video clears 4.5:1 in light. VISUAL-01 introduced --on-accent so
    // the DARK badge reads, and left the light values where the product
    // decision leaves them.
    const measured = Object.fromEntries(
      ['--m-video', '--m-youtube', '--m-image', '--m-pdf'].map((t) => [
        t,
        Number(ratio('--on-accent', t, false).toFixed(2)),
      ]),
    )
    expect(measured).toEqual({
      '--m-video': 7.41,
      '--m-youtube': 4.27,
      '--m-image': 3.3,
      '--m-pdf': 3.34,
    })
  })

  it('records the light tag label ratios that remain below the text floor', () => {
    // Written as measurements rather than as a floor, so the day a hue moves
    // this test says what changed instead of silently passing.
    const measured = Object.fromEntries(
      ['--c-technical', '--c-physical', '--c-social', '--c-psych'].map((t) => [
        t,
        Number(ratio(t, '--card', false).toFixed(2)),
      ]),
    )
    expect(measured).toEqual({
      '--c-technical': 7.41,
      '--c-physical': 3.3,
      '--c-social': 2.45,
      '--c-psych': 4.81,
    })
  })
})

describe('the dark palette is complete, because one surface is always dark', () => {
  it('gives every role and hue token a dark value', () => {
    // The live view forces .theme-dark on its own container whatever the
    // coach chose, so a token left out of this block is a pitch-side
    // defect rather than a preference nobody uses.
    const mustFlip = Object.keys(LIGHT).filter(
      (t) =>
        HEX.test(LIGHT[t]) &&
        // The brand marks are deliberately fixed: the hero and the login
        // ground are the same navy in either theme.
        !t.startsWith('--brand-'),
    )
    const missing = mustFlip.filter((t) => !(t in DARK))
    expect(missing, 'tokens with no dark value').toEqual([])
  })

  it('keeps the fixed brand marks out of the dark block', () => {
    expect(Object.keys(DARK).filter((t) => t.startsWith('--brand-'))).toEqual([])
  })
})

/* ---- 2.1 the type scale ---------------------------------------- */

describe('the type scale is the only source of a font size', () => {
  it('leaves no literal font size in the shared stylesheet', () => {
    const literals = [...styles.matchAll(/font-size: *([0-9.]+)px/g)].map((m) => m[1])
    expect(literals, 'literal font sizes in styles.css').toEqual([])
  })

  it('has no half pixel step, and none below the 12px reading floor', () => {
    // The NAMES, not the count. A count passes while one step is renamed and
    // another added, which is the same hole Codex found in the gold allowlist
    // below; there is no reason to leave a second one here.
    const scale = Object.entries(LIGHT).filter(([t]) => t.startsWith('--text-'))
    expect(scale.map(([t]) => t).sort()).toEqual([
      '--text-2xl',
      '--text-3xl',
      '--text-base',
      '--text-display',
      '--text-lg',
      '--text-md',
      '--text-sm',
      '--text-xl',
      '--text-xs',
    ])
    for (const [token, v] of scale) {
      const px = Number(v.replace('px', ''))
      expect(Number.isInteger(px), `${token} is a whole pixel`).toBe(true)
      expect(px, `${token} is at least the 12px reading floor`).toBeGreaterThanOrEqual(12)
    }
  })

  it('sets no font size inline in the shared vocabulary or the shell', () => {
    // Scoped to what the landed waves own. A route still carries inline sizes
    // and retires them with its own wave, which is the same split Part 4
    // applies to the fourteen control-size overrides. Widen this list as each
    // wave lands rather than weakening it.
    //
    // VISUAL-01: the shared vocabulary and the shell.
    // VISUAL-02, Registered players: the route, its filter bar and the bulk
    // selection bar and bulk delete dialog, which is the surface Part 4 names,
    // and then the six remaining dialog files that surface can open. Those
    // six carried 56 inline sizes between them and were deliberately deferred
    // from the first slice; they are owned now, so a size cannot come back.
    // VISUAL-02, Activity: the club wide audit feed, whose one remaining
    // inline size was the batch filter note at 13.5px.
    // VISUAL-02, Account: the self service screen, which carried sixteen
    // inline sizes across five cards and two copies of one list row.
    // VISUAL-02, Login and Set Password: the two signed out screens and the
    // card they share. Their one inline value was a MARGIN rather than a size,
    // which this rule cannot see; the spacing rule below owns that, and the
    // two are separate because they read different things.
    const OWNED = OWNED_FILES
    const offenders: string[] = []
    for (const f of sourceFiles.filter((f) => OWNED.includes(rel(f)))) {
      // The value is captured and then tested, rather than excluded with a
      // lookahead: `fontSize: *(?!'var\()` lets the optional space match zero
      // characters and then passes the lookahead against the space itself, so
      // every scale value read as an offender while the test still looked
      // right.
      for (const m of read(f).matchAll(/fontSize: *([^,}\n]+)/g)) {
        const v = m[1].trim()
        if (v.startsWith("'var(--text-")) continue
        // UserAvatar scales its initials to the avatar's own size, which is
        // a ratio rather than a step on the scale.
        if (v.includes('size *')) continue
        offenders.push(`${rel(f)}: fontSize: ${v}`)
      }
    }
    expect(offenders).toEqual([])
  })
})

describe('a wave that owns a file owns its spacing too, not only its type', () => {
  /* WHY THIS EXISTS. `OWNED_FILES` is consumed by ONE rule, which scans for
     `fontSize`. So adding a file to it pins the type scale on that file and
     nothing else, and the entry for Login and Set Password named a 14px
     MARGIN as the value it was added for: a claim the list could not keep.
     The off scale step rule that does police spacing reads `src/styles.css`
     alone, so it sees neither a route stylesheet nor a piece of JSX.

     This is the missing half. It is a SEPARATE list, narrower than the type
     one, for the reason the type list is itself narrower than the product: a
     rule widened to files an earlier wave landed fails on their spacing, and
     retiring that is those waves' work rather than a licence for this one to
     weaken the rule. Counted rather than guessed: of the 21 files owned for
     their type, two still carry an inline step off the scale, `components/
     ui.tsx` with nine and `components/Sidebar.tsx` with one. Widen this list
     as each wave reaches them; the two converge when the last one does. */
  const SPACING_OWNED = [
    'components/AuthCard.tsx',
    'routes/Login.tsx',
    'routes/SetPassword.tsx',
    'routes/Login.css',
  ]

  it('writes no inline margin, padding or gap outside the spacing scale', () => {
    const offenders: string[] = []
    // JSX only: the stylesheet in the list is read by the rule below, whose
    // grammar is CSS rather than an object literal.
    for (const f of sourceFiles.filter((f) => SPACING_OWNED.includes(rel(f)) && f.endsWith('.tsx'))) {
      for (const m of read(f).matchAll(/\b(margin|padding|gap)[A-Za-z]*: *([^,}\n]+)/g)) {
        const v = m[2].trim()
        if (v.startsWith("'var(--space-")) continue
        // Not a step: zero in either form, and auto.
        if (/^'?0('|px')?$/.test(v)) continue
        if (v === "'auto'") continue
        offenders.push(`${rel(f)}: ${m[1]}: ${v}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('leaves no off scale step in the stylesheet this wave brought onto it', () => {
    // The same shape as the shared stylesheet's own rule, applied to the one
    // route stylesheet this wave owns. A literal is allowed only where it is
    // not a step: zero, a hairline, and a percentage or auto.
    const css = read(sourceFiles.find((f) => rel(f) === 'routes/Login.css')!)
    const offenders: string[] = []
    for (const m of css.matchAll(/(margin|padding|gap)[a-z-]*: *([^;]+);/g)) {
      for (const value of m[2].trim().split(/\s+/)) {
        if (/^var\(--space-/.test(value)) continue
        if (/^(0|auto|inherit|initial)$/.test(value)) continue
        if (/^\d+%$/.test(value)) continue
        offenders.push(`${m[1]}: ${value}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('covers every file this wave owns, so the list cannot quietly shrink', () => {
    // The wave's own four, named here rather than derived, because the point
    // of the list is that somebody chose to put a file on it.
    for (const f of ['components/AuthCard.tsx', 'routes/Login.tsx', 'routes/SetPassword.tsx', 'routes/Login.css']) {
      expect(SPACING_OWNED, `${f} is covered`).toContain(f)
      expect(sourceFiles.map(rel), `${f} exists`).toContain(f)
    }
  })
})

/* ---- 2.2 classification colours stay classification ------------ */

describe('no classification colour stands in for a state', () => {
  // The media type palette classifies a media item and the four corners
  // palette classifies a drill. Neither may paint a destructive control, a
  // success confirmation or a warning. These are the only places a
  // classification token is allowed to appear.
  const ALLOWED = new Set([
    'styles.css', // the token definitions, .corner-*, .bg-* and the tag rules
    'components/ui.tsx', // MEDIA_META and the PDF thumbnail glyph: media type, not state
    'lib/data.ts', // the CORNERS table
  ])

  it('keeps --m-* and --c-* out of every other module', () => {
    const offenders: string[] = []
    for (const f of sourceFiles) {
      if (ALLOWED.has(rel(f))) continue
      for (const m of read(f).matchAll(/var\(--(m|c)-[a-z]+\)/g)) offenders.push(`${rel(f)}: ${m[0]}`)
    }
    expect(offenders).toEqual([])
  })

  it('stops PHASE_COLOR aliasing the four corners', () => {
    const ui = read(join(srcDir, 'components/ui.tsx'))
    const table = ui.slice(ui.indexOf('export const PHASE_COLOR'), ui.indexOf('/* ---- empty state'))
    expect(table).not.toMatch(/var\(--c-/)
    expect(table).toMatch(/var\(--phase-/)
  })

  it('keeps a frozen classification hex out of a state, even written as a literal', () => {
    // The var(--c-*) scan above cannot see a value written out, and a value
    // written out is exactly how this shipped: the Renew dialog said Eligible
    // in #16a34a and Withdrawn in #ef8e1b, which ARE --c-physical and
    // --c-social, and no test in this file could see either. They are the
    // success and warning Badge tones now.
    //
    // The pattern is the QUOTED form, which is how a value reaches a style or
    // a table; the bare hexes this comment names are therefore not findings,
    // and a quoted one in a comment still is, which is the safe direction.
    // bibs.ts is the one deliberate exception, because a bib names a physical
    // garment a child is wearing, and drillDiagram.ts reads its fallback from
    // that same table.
    const EXEMPT = new Set(['lib/bibs.ts', 'lib/drillDiagram.ts'])
    const pattern = new RegExp(`'(${[...new Set(Object.values(FROZEN))].join('|')})'`, 'gi')
    const offenders: string[] = []
    for (const f of sourceFiles.filter((x) => x.endsWith('.ts') || x.endsWith('.tsx'))) {
      if (EXEMPT.has(rel(f))) continue
      const src = read(f)
      for (const m of src.matchAll(pattern)) offenders.push(`${rel(f)}: ${siteOf(src, m.index!, false)}`)
    }
    expect(offenders).toEqual([])
  })

  it('leaves one status badge vocabulary, which is the Badge primitive', () => {
    // .status-badge was the pre VISUAL-01 convention, and 2.7 named it as the
    // model the Badge primitive should become rather than as a second way of
    // saying the same thing. Its last caller was the season renewal dialog,
    // whose class words were the borrowed classification hues above; with
    // that dialog on Badge tones the class has no callers and is gone.
    expect(styles).not.toContain('.status-badge')
    expect(styles).toContain('.badge-dot')
  })

  it('leaves the bib swatches hardcoded, which is deliberate', () => {
    // A bib names a physical garment a child is wearing. It is the one
    // deliberate exception to both the token rule and the non colour cue
    // rule, and VISUAL-01 must not "fix" it.
    expect(read(join(srcDir, 'lib/bibs.ts'))).toMatch(/#[0-9a-f]{6}/i)
  })
})

/* ---- 2.5 buttons ------------------------------------------------ */

describe('destructive controls use the danger variant, not an inline fill', () => {
  it('leaves no inline background on a button', () => {
    const offenders: string[] = []
    for (const f of sourceFiles.filter((f) => f.endsWith('.tsx'))) {
      const src = read(f)
      for (const m of src.matchAll(/className="btn[^"]*"[^>]{0,160}style=\{\{[^}]*background:/g)) {
        offenders.push(`${rel(f)}: ${m[0].slice(0, 80)}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('defines the danger and on-dark variants the design read requires', () => {
    for (const v of ['.btn-danger', '.btn-on-dark', '.icon-btn.on-dark', '.icon-btn.danger']) {
      expect(styles, v).toContain(v)
    }
  })
})

describe('an icon only button always has an accessible name', () => {
  it('never ships an .icon-btn without aria-label', () => {
    const offenders: string[] = []
    for (const f of sourceFiles.filter((f) => f.endsWith('.tsx'))) {
      const src = read(f)
      // Each <button ...> opening tag that carries the icon-btn class.
      for (const tag of openingTags(src, 'button')) {
        if (!/\bicon-btn\b/.test(tag)) continue
        if (!tag.includes('aria-label')) offenders.push(`${rel(f)}: ${tag.replace(/\s+/g, ' ').slice(0, 100)}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('names an icon button with aria-label rather than title', () => {
    // title is a tooltip, and it does not survive touch.
    const offenders: string[] = []
    for (const f of sourceFiles.filter((f) => f.endsWith('.tsx'))) {
      for (const tag of openingTags(read(f), 'button')) {
        if (/\bicon-btn\b/.test(tag) && /\btitle=/.test(tag)) offenders.push(`${rel(f)}: ${tag.replace(/\s+/g, ' ').slice(0, 90)}`)
      }
    }
    expect(offenders).toEqual([])
  })
})

describe('a fixed ground carries a fixed foreground', () => {
  // The media thumbnail placeholders are painted with hardcoded light
  // stripes that do NOT flip with the theme, so anything drawn on them must
  // not flip either. This class of defect shipped twice in this wave and was
  // caught twice by looking rather than by reading: the placeholder label
  // demoted to --slate went from 3.10:1 to 1.91:1 in dark, and the PDF glyph
  // on --m-pdf at 60% opacity measured 1.39:1 there (1.81:1 in light, so it
  // was already poor). Both take fixed colours now.
  const FIXED_ON_FIXED = ['.thumb-empty-title', '.thumb-empty-hint', '.thumb-glyph', '.thumb-label']

  it('uses no theme token for text on a fixed placeholder', () => {
    const offenders: string[] = []
    for (const sel of FIXED_ON_FIXED) {
      for (const m of styles.matchAll(new RegExp(`\\${sel}[^{]*\\{([^}]*)\\}`, 'g'))) {
        const colour = m[1].match(/(?<![-a-z])color: *([^;]+);/)
        if (colour && colour[1].includes('var(')) offenders.push(`${sel}: ${colour[1].trim()}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('keeps the placeholder glyph off the media token entirely', () => {
    // It is the only type cue a caller passing showBadge={false} gets, so it
    // is not allowed to inherit the classification hue that moves with the
    // theme.
    const ui = read(join(srcDir, 'components/ui.tsx'))
    expect(ui).toContain('className="thumb-glyph"')
    expect(ui).not.toMatch(/Icon\.fileText style=\{\{[^}]*--m-pdf/)
  })
})

/* ---- 2.2 the brand as a foreground ------------------------------ */

// The one foreground left on --navy: a glyph on a fixed white circle,
// which does not flip with the theme and so is not held to a token pairing.
const ALLOWED_NAVY_FOREGROUNDS = new Set<string>(['styles.css: .play-btn'])


describe('a brand coloured word takes --royal, not --navy', () => {
  // Found by rendering rather than by reading: tools/visual/contrast.mjs
  // measures every text run on the acceptance surfaces and reported the
  // active bottom nav label at 3.13:1 and a session avatar's initials at
  // 3.35:1, both in the dark theme, both painted --navy. Nothing in this
  // file saw them, because --navy on --card was not a pairing anybody had
  // thought to name.
  //
  // --navy cannot be fixed in place, and that is arithmetic rather than
  // taste: carrying a white label caps its dark value at a relative
  // luminance of .183, and reading as text on --card needs .234. So the
  // fill role and the foreground role are two tokens, and a WORD takes
  // --royal. Icons and indicators stay on --navy at the 3:1 floor.
  for (const theme of ['light', 'dark'] as const) {
    const dark = theme === 'dark'

    it(`${theme}: --royal reads as a word on every surface one lands on`, () => {
      for (const surface of ['--card', '--bg', '--bg-2']) {
        expect(ratio('--royal', surface, dark), `--royal on ${surface}`).toBeGreaterThanOrEqual(4.5)
      }
    })

    it(`${theme}: --royal clears the 3:1 glyph floor on the tints it draws on`, () => {
      // The quick action glyphs sit on a 10% navy tint rather than on the
      // bare card, so the mix is measured rather than approximated by the
      // surface underneath it. This is the pairing that sent them to
      // --royal: --navy on its own tint measures 2.84:1 in the dark theme.
      const tint = mix(value('--navy', dark), value('--card', dark), 0.1)
      expect(contrast(value('--royal', dark), tint), '--royal on the navy tint').toBeGreaterThanOrEqual(3)
      expect(contrast(value('--navy', true), mix(value('--navy', true), value('--card', true), 0.1))).toBeLessThan(3)
    })
  }

  it('records the two floors --navy cannot satisfy at once', () => {
    // Stated as measurements, because the conclusion is that no value of
    // --navy passes both and a future nudge cannot make it.
    expect(contrast('#ffffff', value('--navy', true))).toBeGreaterThanOrEqual(4.5)
    expect(ratio('--navy', '--card', true)).toBeLessThan(4.5)
  })

  it('leaves --navy as a foreground only where the 3:1 floor applies', () => {
    // Every one of these draws a glyph or an indicator, never a word.
    // Compared as a SET rather than a count, which would pass if an
    // approved site were removed while a word elsewhere took --navy.
    const ALLOWED = ALLOWED_NAVY_FOREGROUNDS
    expect([...foregroundSites('--navy')].sort()).toEqual([...ALLOWED].sort())
  })
})

describe('--slate-2 is a non text role', () => {
  // The same sweep found five text runs still painted with it, none of
  // which cleared 4.5:1 in either theme: two day labels, the Spond
  // audience line and two diagram editor labels. The token's own comment
  // had said text had moved off it, and the comment was wrong.
  //
  // Scoped to the stylesheets, which is what this wave owns. A route still
  // carries inline `color: 'var(--slate-2)'`, almost all of it on an
  // Icon.* glyph held to 3:1, and the handful that are words belong to
  // that route's wave. Nothing here can tell a glyph from a word, which is
  // the reason tools/visual/contrast.mjs exists: it measures what renders.
  it('paints text with it only where a contrast floor does not apply', () => {
    const ALLOWED = new Set([
      'styles.css: .menu-list button:disabled', // an inactive control, exempt from 1.4.3
      'styles.css: .activity-sep', // a decorative separator glyph
      'routes/Board.css: .board-token-label::placeholder', // a fixed light label, the board's own wave
    ])
    const found = new Set<string>()
    for (const f of sourceFiles.filter((x) => x.endsWith('.css'))) {
      const src = read(f)
      for (const m of src.matchAll(/(?<![-a-z])color: *var\(--slate-2\)/g)) {
        found.add(`${rel(f)}: ${siteOf(src, m.index!, true)}`)
      }
    }
    expect([...found].sort()).toEqual([...ALLOWED].sort())
  })
})

describe('a gold fill is never restated with a different label', () => {
  // The shape Codex found on the sidebar badge: the base rule paired --gold
  // with --gold-fg, and a more-specific contextual rule restated the pair as
  // --ink, which is near white in the dark theme. The override looked
  // redundant in the diff and was not: it won on specificity and measured
  // 1.56:1.
  it('pairs every --gold background with --gold-fg, or with no label at all', () => {
    const offenders: string[] = []
    for (const f of sourceFiles.filter((x) => x.endsWith('.css'))) {
      for (const m of read(f).matchAll(/\{[^{}]*\}/g)) {
        const rule = m[0]
        if (!/background: *var\(--gold\)/.test(rule)) continue
        const colour = rule.match(/(?<![-a-z])color: *([^;]+);/)
        if (colour && colour[1].trim() !== 'var(--gold-fg)') {
          offenders.push(`${rel(f)}: ${rule.replace(/\s+/g, ' ').slice(0, 110)}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })
})

describe('gold is a fill behind dark text, never text itself', () => {
  // --gold-600 measures 2.06:1 on the card and 1.88:1 on --gold-soft, so it
  // is the hover FILL of the gold button and nothing else. Nine sites used
  // it as text, four of them on the two screens this wave accepts.
  it('never paints text with --gold-600', () => {
    const offenders: string[] = []
    for (const f of sourceFiles) {
      if (rel(f) === 'styles.css') {
        // The one legitimate use: .btn-gold's hover fill.
        for (const m of read(f).matchAll(/(?<![-a-z])color: *var\(--gold-600\)/g)) offenders.push(`${rel(f)}: ${m[0]}`)
        continue
      }
      for (const m of read(f).matchAll(/(?<![-a-z])color: *'?var\(--gold-600\)'?/g)) offenders.push(`${rel(f)}: ${m[0]}`)
    }
    expect(offenders).toEqual([])
  })

  it('paints text with --gold only at the three sites whose ground is navy', () => {
    // Named rather than pattern-matched, because the ground is not something
    // a scan of one declaration can see. The active navigation icon sits on
    // the navy fill (3.09:1 in dark, 7.62:1 in light, asserted above); the
    // live view's play glyph sits on the forced dark card at 9.67:1. A new
    // caller belongs in this list with its ratio, or it belongs on --ink.
    //
    // The SET is compared, not its size. Comparing counts would pass while
    // one approved site was removed and a new low-contrast one appeared,
    // which is a real way for this to go quiet.
    const allowed = [
      'styles.css :: .nav-item.active .nav-ico',
      'styles.css :: .more-sheet-item.active .nav-ico',
      'routes/LiveSession.tsx :: <span style={{ color: \'var(--gold)\' }}>',
    ]
    const found: string[] = []
    for (const f of sourceFiles) {
      const src = read(f)
      // (?<![-a-z]) or `border-color: var(--gold)` counts as gold text,
      // which is how this scan first reported five sites for three.
      for (const m of src.matchAll(/(?<![-a-z])color: *'?var\(--gold\)'?/g)) {
        found.push(`${rel(f)} :: ${siteOf(src, m.index ?? 0, f.endsWith('.css'))}`)
      }
    }
    expect(found.sort()).toEqual([...allowed].sort())
  })
})

describe('a semantic fill carries its own label colour', () => {
  // --success, --warning, --danger and --info lighten in the dark theme, so a
  // hardcoded white label on one of them reads at under 2:1 there. The fill's
  // own --*-fg (or --on-accent, where the fill is chosen per row) is what
  // flips with it.
  //
  // WHAT THIS CANNOT CATCH, and it is the shape that actually shipped: a rule
  // that sets the fill on one selector and the label on another. Three of
  // those were found by hand rather than here (SessionRegister's .reg-check,
  // SessionDay's .sd-check and the import preview's .ip-pill), because the
  // glyph colour sat on the base class and the fill arrived with a modifier.
  // A scan of one rule at a time sees neither half of that pair.
  it('never writes a fixed white label in the same rule as a semantic fill', () => {
    const offenders: string[] = []
    for (const f of sourceFiles.filter((x) => x.endsWith('.css'))) {
      for (const m of read(f).matchAll(/\{[^{}]*\}/g)) {
        const rule = m[0]
        if (!/background: *var\(--(success|warning|danger|info)\)/.test(rule)) continue
        if (/color: *#fff|color: *#ffffff|color: *white/i.test(rule)) {
          offenders.push(`${rel(f)}: ${rule.replace(/\s+/g, ' ').slice(0, 110)}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('carries every import preview pill label on its own fill, in both themes', () => {
    // The one place in the product where a fill is chosen PER ROW from a
    // table, so the cross-selector pair the comment above describes is the
    // shape by construction: .ip-pill sets --on-accent and the table sets the
    // background. Measured rather than read, because what matters is the
    // number: already_present was --slate-2 at 3.80:1 under white in light,
    // which is the token VISUAL-01 demoted to a non text role.
    // Every token the module names, so the separate WARNING_COLOR the warning
    // pill takes is measured beside the five row classes rather than being
    // the one fill nothing looked at.
    const fills = [
      ...new Set([...read(join(srcDir, 'lib/playersImportView.ts')).matchAll(/'var\((--[a-z0-9-]+)\)'/g)].map((m) => m[1])),
    ]
    expect(fills.length, 'a fill per row class, plus the warning pill').toBeGreaterThanOrEqual(5)
    for (const dark of [false, true]) {
      for (const fill of fills) {
        expect(ratio('--on-accent', fill, dark), `--on-accent on ${fill} (${dark ? 'dark' : 'light'})`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('leaves the three cross-selector pairs on their fill\'s own label', () => {
    // Pinned by name, because the scan above cannot see them.
    expect(read(join(srcDir, 'routes/SessionRegister.css'))).toContain('color: var(--success-fg)')
    expect(read(join(srcDir, 'routes/SessionDay.css'))).toContain('color: var(--success-fg)')
    expect(styles).toMatch(/\.ip-pill \{[^}]*color: var\(--on-accent\)/)
  })
})

/* ---- one focus restore, not one per screen ---------------------- */

describe('a control the browser blurs is restored from one place', () => {
  /* WHY THIS RULE EXISTS. Disabling a focused control blurs it, so every
     screen with a submit that freezes while a call is in flight meets the
     same defect, and every one of them is tempted to write the same effect
     again. Account met it first (#215), Login and Set Password met it next,
     and the reasoning is subtle in two places at once: it has to be an
     effect rather than a callback, because a per-call onSuccess runs before
     React re-renders; and it has to refuse to act unless focus is on the
     body, or it takes focus back off somebody who moved away while the call
     was running. A second copy is a second chance to get one of those two
     halves wrong.

     src/hooks/useFocusRestore.ts says out loud that this test enforces it,
     so the two have to agree or the comment is a claim with nothing behind
     it. This is that enforcement. */
  const HOOK = 'hooks/useFocusRestore.ts'

  it('defines the hook exactly once, in the shared module', () => {
    const definitions = sourceFiles.filter((f) => /function useFocusRestore\b/.test(read(f))).map(rel)
    expect(definitions).toEqual([HOOK])
  })

  it('reaches it by import everywhere else', () => {
    // A caller names the hook; only the module may define it. Anything that
    // uses the name without importing it has written its own.
    const offenders: string[] = []
    for (const f of sourceFiles.filter((f) => f.endsWith('.tsx') || f.endsWith('.ts'))) {
      if (rel(f) === HOOK) continue
      const src = read(f)
      if (!src.includes('useFocusRestore')) continue
      if (!/import \{[^}]*useFocusRestore[^}]*\} from '[^']*hooks\/useFocusRestore'/.test(src)) {
        offenders.push(rel(f))
      }
    }
    expect(offenders).toEqual([])
  })

  it('keeps the guard that makes it a restore rather than a steal, and gates on it', () => {
    /* The one rule that separates the two. Without it the hook moves focus on
       every settled write, including one somebody carried on working through.

       Checked as a GATE rather than as a presence: the rule is a named
       function and the effect has to return early on it, which is the shape
       an inverted or ignored guard breaks. What the rule ANSWERS is driven in
       src/hooks/focusRestore.test.ts; presence alone would hold for a hook
       that computed it and threw it away. */
    const src = read(sourceFiles.find((f) => rel(f) === HOOK)!)
    expect(src).toContain('export function focusWasLost(')
    expect(src).toMatch(/if \(!focusWasLost\(document\.activeElement, document\.body\)\) return/)
    // And the focus call comes after that return, not before it.
    expect(src.indexOf('focusWasLost(document.activeElement')).toBeLessThan(src.indexOf('target.current?.focus()'))
  })
})

/* ---- 2.15 focus, 2.17 motion ------------------------------------ */

describe('focus and motion', () => {
  it('has one shared focus-visible ring built on --focus', () => {
    expect(styles).toMatch(/:focus-visible[^{]*\{\s*\n?\s*outline: 2px solid var\(--focus\);\s*\n?\s*outline-offset: 2px;/)
  })

  it('writes outline: none only with a replacement ring on the same rule', () => {
    const offenders: string[] = []
    for (const f of sourceFiles.filter((f) => f.endsWith('.css'))) {
      const src = read(f)
      for (const m of src.matchAll(/\{[^{}]*outline: *none[^{}]*\}/g)) {
        // A rule that draws its replacement elsewhere (an SVG stroke, a
        // sibling ring) states so on the line, so the opt-out is a sentence
        // a reviewer reads rather than a silent omission.
        if (!/outline: *[0-9]|box-shadow|border-color|\/\* (replaced|not-a-control)/.test(m[0])) {
          offenders.push(`${rel(f)}: ${m[0].replace(/\s+/g, ' ').slice(0, 110)}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('honours prefers-reduced-motion', () => {
    expect(styles).toContain('@media (prefers-reduced-motion: reduce)')
  })

  it('leaves no property-less transition shorthand in the shared stylesheet', () => {
    // `transition: .12s` animates every property, including ones a later
    // rule adds without meaning to.
    const offenders = [...styles.matchAll(/transition: *[.0-9][^;]*;/g)]
      .map((m) => m[0])
      .filter((d) => !/[a-z-]+ +[.0-9]/.test(d.replace('transition: ', '')))
    expect(offenders).toEqual([])
  })
})

/* ---- 2.3 the spacing and radius scales -------------------------- */

describe('the spacing and radius scales are the only source of a step', () => {
  it('uses no off scale padding, margin or gap in the shared stylesheet', () => {
    const props = 'padding|padding-top|padding-right|padding-bottom|padding-left|margin|margin-top|margin-right|margin-bottom|margin-left|gap|row-gap|column-gap'
    const offenders: string[] = []
    for (const m of styles.matchAll(new RegExp(`\\b(${props}): *([^;{}]+);`, 'g'))) {
      const v = m[2]
      if (v.includes('calc(') || v.includes('env(') || v.includes('mm')) continue
      if (/[0-9]px/.test(v)) offenders.push(`${m[1]}: ${v}`)
    }
    // .sr-only's -1px is the visually-hidden technique, not a spacing step.
    expect(offenders.filter((o) => !o.includes('-1px'))).toEqual([])
  })

  it('has five radius steps and no literal radius in the shared stylesheet', () => {
    const radii = Object.keys(LIGHT).filter((t) => t.startsWith('--radius'))
    expect(radii.sort()).toEqual(['--radius-lg', '--radius-md', '--radius-pill', '--radius-sm', '--radius-xs'])
    const literals = [...styles.matchAll(/border-radius: *([0-9]+px)/g)].map((m) => m[1])
    expect(literals).toEqual([])
  })
})
