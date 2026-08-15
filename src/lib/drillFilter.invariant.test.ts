// The tripwire that keeps one drill filter from becoming two.
//
// WHY THIS EXISTS. The Library and Add from library browse the same club
// library, and for a while they did not: the modal grew its own search over
// a concatenation with no separators, so a query matched across a field
// boundary there and nowhere else, and no filter the Library offered
// existed in the modal at all. The rules live in ./drillFilter and
// ./drillPicker and nowhere else, and this test fails the build when a
// screen starts answering for itself.
//
// WHAT IT IS NOT. This is a tripwire, not a proof. It reads source text, so
// it catches the realistic mistakes: a screen re-importing the sort or the
// FA lists to compose its own pipeline, a filter predicate retyped inline,
// the results grid forced back to a fixed column count, a confirm built
// from the visible rows. What it cannot see: a predicate reached through a
// helper defined elsewhere, a forbidden call aliased to another name, or
// which call site an imported identifier feeds. The behavioural halves are
// AddDrillModal.test.tsx and drillFilter.test.ts; treat a pass here as
// "nobody typed the obvious thing", never as "the screens agree".
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(import.meta.dirname, '..')

const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8')

function stripComments(src: string): string {
  let out = ''
  let i = 0
  let quote: string | null = null
  while (i < src.length) {
    const c = src[i]
    const next = src[i + 1]
    if (quote) {
      out += c
      if (c === '\\') {
        out += next ?? ''
        i += 2
        continue
      }
      if (c === quote) quote = null
      i++
      continue
    }
    if (c === "'" || c === '"' || c === '`') {
      quote = c
      out += c
      i++
      continue
    }
    if (c === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') i++
      continue
    }
    if (c === '/' && next === '*') {
      i += 2
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++
      i += 2
      continue
    }
    out += c
    i++
  }
  return out
}

// The two screens that browse the drill library.
const SCREENS = ['routes/Library.tsx', 'components/AddDrillModal.tsx']

describe('one filter implementation', () => {
  it('both screens compose their results through applyDrillFilter', () => {
    for (const f of SCREENS) {
      expect(stripComments(read(f)), f).toContain('applyDrillFilter(')
    }
  })

  it('neither screen rebuilds the pipeline from the parts', () => {
    // Reaching past drillFilter for the sort, the FA lists or the option
    // merge is how a second pipeline starts. The seam composes those; a
    // screen has no business importing them.
    for (const f of SCREENS) {
      const src = stripComments(read(f))
      for (const banned of ['sortLibraryDrills', 'withExistingValues', 'FA_PLAYER_SKILLS', 'FA_THEMES', 'FA_FORMATS']) {
        expect(src, `${f} reaches past drillFilter for ${banned}`).not.toContain(banned)
      }
    }
  })

  it('neither screen retypes a filter predicate inline', () => {
    // The shapes every inline copy of these rules has actually taken:
    // lowercased haystacks, includes over ages or tags, comparisons against
    // a drill's taxonomy fields.
    for (const f of SCREENS) {
      const src = stripComments(read(f))
      for (const banned of ['.toLowerCase()', 'localeCompare', '.ages.includes(', '.tags.includes(', '.theme !==', '.skill !==', '.format !==', '.level !==']) {
        expect(src, `${f} retypes a predicate: ${banned}`).not.toContain(banned)
      }
    }
  })
})

describe('the modal confirm', () => {
  it('draws the added activities from the full library list, never the visible rows', () => {
    const src = stripComments(read('components/AddDrillModal.tsx'))
    expect(src).toContain('selectedActivities(drills')
    expect(src).not.toContain('selectedActivities(results')
  })
})

describe('the responsive results grid', () => {
  it('the modal styles the grid through its stylesheet, never an inline column count', () => {
    const src = stripComments(read('components/AddDrillModal.tsx'))
    expect(src).toContain("import './AddDrillModal.css'")
    expect(src).not.toContain('gridTemplateColumns')
  })

  it('the stylesheet is one column at the base and widens only under min-width', () => {
    const css = read('components/AddDrillModal.css')
    // Outside every @media block, the grid is exactly one column.
    const [base, ...media] = css.split('@media')
    const baseColumns = [...base.matchAll(/grid-template-columns:\s*([^;]+);/g)].map((m) => m[1].trim())
    expect(baseColumns).toContain('1fr')
    for (const value of baseColumns) expect(value, 'the phone layout is one column').toBe('1fr')
    // A wider layout may exist, but only where the viewport is proven wide:
    // a min-width query, never max-width forcing columns onto a phone.
    for (const block of media) {
      expect(block.trimStart(), 'media queries widen, they never narrow').toMatch(/^\(min-width:/)
    }
  })
})
