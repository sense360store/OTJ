// =====================================================================
// COACH-10's boundary, pinned mechanically: ONE activity-list editor.
//
// A TRIPWIRE, NOT A PROOF. Everything here reads source text, so it
// catches somebody typing the obvious thing: restoring a local activity
// row in a host, a second add bar, a second phase select, a hand-rolled
// role control. The behavioural half is ./ActivityListEditor.test.tsx,
// and the strongest guard of all is that the pre-existing Planner,
// TemplateFormModal and coach2b suites pass unchanged over the extracted
// rows.
//
// The patterns are markup vocabulary rather than line numbers or
// function shapes, so an honest refactor inside the seam does not trip
// them and a reimplementation outside it does.
// =====================================================================
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(import.meta.dirname, '..')
const SEAM = 'components/ActivityListEditor.tsx'
const PLANNER = 'routes/Planner.tsx'
const TEMPLATE = 'components/TemplateFormModal.tsx'

const read = (f: string) => readFileSync(join(SRC, f), 'utf8')
const code = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n')

describe('both hosts mount the one shared editor', () => {
  it('the dated-session planner mounts it and re-exports its row from it', () => {
    const src = code(read(PLANNER))
    expect(src).toContain('<ActivityListEditor')
    expect(src).toMatch(/export \{[^}]*ActivityCardView[^}]*\} from '\.\.\/components\/ActivityListEditor'/)
  })

  it('the week-plan editor mounts it and re-exports its row from it', () => {
    const src = code(read(TEMPLATE))
    expect(src).toContain('<ActivityListEditor')
    expect(src).toMatch(/export \{[^}]*TemplateActivityRow[^}]*\} from '\.\/ActivityListEditor'/)
  })
})

describe('neither host holds a local activity-row implementation', () => {
  // The row's own markup vocabulary. Any of these reappearing in a host is
  // a restored local row, an inline phase select, or a second add bar: the
  // exact regression COACH-10 exists to make loud.
  const ROW_VOCABULARY = [
    'act-card',
    'act-edit',
    'act-x',
    'add-slot',
    'PHASES.map(',
    'Add from library',
    'aria-label="Move up"',
    'draggable=',
  ]

  for (const [name, file] of [
    ['Planner', PLANNER],
    ['TemplateFormModal', TEMPLATE],
  ] as const) {
    it(`${name} carries none of the row markup itself`, () => {
      const src = code(read(file))
      for (const token of ROW_VOCABULARY) {
        expect(src, token).not.toContain(token)
      }
    })
  }

  it('the seam is where that vocabulary lives', () => {
    const src = code(read(SEAM))
    for (const token of ['act-card', 'act-edit', 'act-x', 'add-slot', 'PHASES.map(', 'aria-label="Move up"']) {
      expect(src, token).toContain(token)
    }
  })
})

describe('the seam stays presentational and reimplements no meaning', () => {
  it('holds no state, no hook, no query and no mutation', () => {
    const src = code(read(SEAM))
    expect(src).not.toMatch(/\buse[A-Z]\w*\(/)
    expect(src).not.toMatch(/from '\.\.\/lib\/(queries|supabase)'/)
    expect(src).not.toMatch(/\.mutate\(|\.from\(|\.upsert\(|\.insert\(|\.update\(|\.delete\(/)
  })

  it('mounts the one role row rather than rebuilding chips of its own', () => {
    const src = code(read(SEAM))
    expect(src).toContain('<ActivityRoleRow')
    expect(src).not.toContain('ACTIVITY_ROLES')
    expect(src).not.toContain('aria-pressed')
  })

  it('reads no structural key and infers nothing from phase', () => {
    // roleOf, stationNumberAt and isStoodDown stay behind ActivityRoleRow
    // and the activityRole seam. The editor renders what it is handed.
    const src = code(read(SEAM))
    expect(src).not.toMatch(/\.slot\b/)
    expect(src).not.toMatch(/\bskipped\b/)
    expect(src).not.toMatch(/\.phase\s*(===|!==)/)
    expect(src).not.toMatch(/\bstationNumber|roleOf\(|isStoodDown\(/)
  })

  it('offers the stand-down through the dated variant alone', () => {
    // The plan variant's shape has no onStandDown to pass, so `skipped`
    // cannot reach reusable content through this seam. The one dated
    // mount is the session row's.
    const src = code(read(SEAM))
    const mounts = src.match(/<ActivityRoleRow[\s\S]*?\/>/g) ?? []
    expect(mounts).toHaveLength(2)
    expect(mounts.filter((m) => m.includes('dated\n') || m.includes('dated '))).toHaveLength(1)
    expect(mounts.filter((m) => m.includes('dated={false}'))).toHaveLength(1)
    expect(mounts.filter((m) => m.includes('onStandDown'))).toHaveLength(1)
  })
})

describe('what this file cannot catch', () => {
  it('cannot catch markup rebuilt with fresh class names', () => {
    // A host that reimplements the row under a new vocabulary walks past
    // every token above. What actually holds the line is the pre-existing
    // suites passing unchanged over the shared row, plus review.
    expect(true).toBe(true)
  })

  it('cannot prove the two variants behave alike, only that one file renders both', () => {
    // ./ActivityListEditor.test.tsx walks the real element tree for that:
    // each control reaches its own host callback with its own index.
    expect(true).toBe(true)
  })
})
