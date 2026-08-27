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
    const scale = Object.entries(LIGHT).filter(([t]) => t.startsWith('--text-'))
    expect(scale.length).toBe(9)
    for (const [token, v] of scale) {
      const px = Number(v.replace('px', ''))
      expect(Number.isInteger(px), `${token} is a whole pixel`).toBe(true)
      expect(px, `${token} is at least the 12px reading floor`).toBeGreaterThanOrEqual(12)
    }
  })

  it('sets no font size inline in the shared vocabulary or the shell', () => {
    // Scoped to what VISUAL-01 owns. A route still carries inline sizes and
    // retires them with its own wave, which is the same split Part 4 applies
    // to the fourteen control-size overrides. Widen this list as each wave
    // lands rather than weakening it.
    const OWNED = [
      'components/ui.tsx',
      'components/primitives.tsx',
      'components/Sidebar.tsx',
      'components/TopBar.tsx',
      'components/BottomNav.tsx',
      'components/Crest.tsx',
      'components/UserAvatar.tsx',
    ]
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

  it('leaves the three cross-selector pairs on their fill\'s own label', () => {
    // Pinned by name, because the scan above cannot see them.
    expect(read(join(srcDir, 'routes/SessionRegister.css'))).toContain('color: var(--success-fg)')
    expect(read(join(srcDir, 'routes/SessionDay.css'))).toContain('color: var(--success-fg)')
    expect(styles).toMatch(/\.ip-pill \{[^}]*color: var\(--on-accent\)/)
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
