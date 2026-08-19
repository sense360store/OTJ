// The tripwire that keeps one activity structure rule from becoming five.
//
// WHY THIS EXISTS. "Is this activity running tonight?" is one boolean
// expression, and the session duration sum it feeds is one line of arithmetic
// that this repository already implemented FOUR separate times before anything
// could be stood down. Three of those were found by grepping for a function
// name; the fourth was an inline expression in a different runtime. A fifth
// costs thirty seconds to type and disagrees silently.
//
// The rule lives in ./activityStructure, the wire boundary lives in ./queries,
// and the Deno half lives in supabase/functions/_shared/share.ts because Edge
// Functions cannot import from src/lib/. That duplication is stated rather than
// papered over, and the checks below are what keep the two halves in step.
//
// WHAT IT IS NOT. A tripwire, not a proof. It reads source text, so a
// determined workaround walks past it; the last describe names the shapes it
// cannot catch, so nobody mistakes a pass for a guarantee. It catches the
// realistic mistake, which is somebody typing the obvious thing in a hurry.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ACTIVITY_SLOTS, MAX_STATIONS, MIN_STATIONS } from './activityStructure'

const SRC = join(import.meta.dirname, '..')
const SHARE = join(SRC, '..', 'supabase', 'functions', '_shared', 'share.ts')
const SHARE_TEST = join(SRC, '..', 'supabase', 'functions', '_shared', 'share_test.ts')

// The one browser file allowed to know the rule, and its own tests.
const SEAM = [
  'lib/activityStructure.ts',
  'lib/activityStructure.test.ts',
  'lib/activityStructure.invariant.test.ts',
]

// The wire boundary. queries.ts is allowed to read the raw keys because it is
// the only place a stored row becomes an Activity, and the only place an
// Activity becomes a stored row.
const WIRE = ['lib/queries.ts', 'lib/queries.test.ts']

// `skipped` is an overloaded word in this repository and these say it about
// something else entirely: how many rows a players import passed over. Named
// with the reason rather than excluded by a looser pattern, so a future file
// that means the ACTIVITY sense still has to answer for itself.
const SKIPPED_MEANS_SOMETHING_ELSE: Record<string, string> = {
  'components/PlayerActionModals.tsx': 'the players import result count',
  'components/RenewSeasonModal.tsx': 'the season renewal result count',
  'lib/playersImportCommit.ts': 'the players import result count',
  'lib/playersImportCommit.test.ts': 'the players import result count',
}

function sourceFiles(): string[] {
  const out: string[] = []
  const walk = (dir: string, prefix: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) walk(join(dir, entry.name), rel)
      else if (/\.tsx?$/.test(entry.name)) out.push(rel)
    }
  }
  walk(SRC, '')
  return out
}

// Comments explain the rule on both sides of it, and prose is not code.
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
}

const read = (f: string) => stripComments(readFileSync(join(SRC, f), 'utf8'))

const isTest = (f: string) => /\.test\.tsx?$/.test(f)

// ---- The shapes a second rule is written in ---------------------------

// A slot literal compared by hand. `a.slot === 'station'`, `slot !== 'game'`.
const SLOT_COMPARISON = /\bslot\s*(===|!==|==|!=)\s*['"`]/

// The stand-down key read by hand, in either shape.
const SKIPPED_READ = /(\.skipped\b|\bskipped\s*(===|!==|==|!=))/

// The canonical representation, broken. `false` is never written.
const SKIPPED_FALSE = /skipped\s*:\s*false/

// The activity duration sum, written inline.
const INLINE_DURATION_SUM = /\.reduce\(\([^)]*\)\s*=>\s*[\w.]+\s*\+\s*\([\w.]+\.duration/

// The two inline sums that are allowed, and why. Both sum TEMPLATE
// activities, and a template cannot carry `skipped`: the template boundary in
// queries.ts strips it on every write and ignores it on the read. Adding a
// third is what this check exists to notice.
const TEMPLATE_SUMS: Record<string, string> = {
  'routes/Home.tsx': 'TemplateMiniCard sums a template',
  'routes/Templates.tsx': 'the template card sums a template',
}

describe('the structural rule lives in exactly one browser file', () => {
  it('is the only place a slot literal is compared', () => {
    const offenders: string[] = []
    for (const f of sourceFiles()) {
      if (SEAM.includes(f)) continue
      const hit = read(f).match(SLOT_COMPARISON)
      if (hit) offenders.push(`${f}: ${hit[0]}`)
    }
    expect(offenders).toEqual([])
  })

  it('is the only place the stand-down key is read, outside the wire boundary', () => {
    const offenders: string[] = []
    for (const f of sourceFiles()) {
      if (SEAM.includes(f) || WIRE.includes(f) || f in SKIPPED_MEANS_SOMETHING_ELSE) continue
      const hit = read(f).match(SKIPPED_READ)
      if (hit) offenders.push(`${f}: ${hit[0]}`)
    }
    expect(offenders).toEqual([])
  })

  it('names the files that say skipped about something else, and what they mean', () => {
    // Stated rather than silently excluded, and checked, so an entry that
    // stops being true is deleted rather than left widening the check.
    for (const [f, why] of Object.entries(SKIPPED_MEANS_SOMETHING_ELSE)) {
      expect(why.length).toBeGreaterThan(0)
      expect(SKIPPED_READ.test(read(f))).toBe(true)
    }
  })

  it('no shipped file writes the key as false', () => {
    // Each state has exactly one representation. Restoring removes the key,
    // so a stored row saying `skipped: false` would be a second way to say
    // running and the first thing to disagree with the first way.
    //
    // Tests are excluded because constructing the refused shape is how they
    // prove it is refused. The Deno module is checked by name because it is
    // outside the tree this walks.
    const offenders: string[] = []
    for (const f of sourceFiles()) {
      if (isTest(f)) continue
      const hit = read(f).match(SKIPPED_FALSE)
      if (hit) offenders.push(`${f}: ${hit[0]}`)
    }
    expect(offenders).toEqual([])
    expect(SKIPPED_FALSE.test(stripComments(readFileSync(SHARE, 'utf8')))).toBe(false)
  })

  it('declares the vocabulary and the carousel size once', () => {
    expect([...ACTIVITY_SLOTS]).toEqual(['station', 'game'])
    expect([MIN_STATIONS, MAX_STATIONS]).toEqual([4, 5])
    const offenders = sourceFiles()
      .filter((f) => !SEAM.includes(f))
      .filter((f) => /(const|let|var)\s+(ACTIVITY_SLOTS|MIN_STATIONS|MAX_STATIONS)\b/.test(read(f)))
    expect(offenders).toEqual([])
  })
})

describe('the session duration sum has one browser implementation', () => {
  it('no screen sums a session inline', () => {
    // The planner's headline was exactly this until COACH-2A, which made it a
    // fourth answer to how long a session runs and the one most likely to
    // disagree, because it is the number changing under the coach's finger.
    const offenders: string[] = []
    for (const f of sourceFiles()) {
      if (SEAM.includes(f) || f in TEMPLATE_SUMS || isTest(f)) continue
      const hit = read(f).match(INLINE_DURATION_SUM)
      if (hit) offenders.push(`${f}: ${hit[0]}`)
    }
    expect(offenders).toEqual([])
  })

  it('names the inline sums it deliberately allows, and why', () => {
    // Stated rather than silently omitted. Each of these sums a TEMPLATE, and
    // the template boundary means a template cannot carry the key, so the
    // active duration rule has nothing to do there. If one of them ever starts
    // summing a session this list is the thing to correct.
    for (const [f, why] of Object.entries(TEMPLATE_SUMS)) {
      expect(why.length).toBeGreaterThan(0)
      expect(INLINE_DURATION_SUM.test(read(f))).toBe(true)
    }
  })

  it('the calendar export takes its length from the same seam', () => {
    expect(readFileSync(join(SRC, 'lib/ics.ts'), 'utf8')).toMatch(/from '\.\/sessionLifecycle'/)
  })

  it('the derived lifecycle reads the rule rather than a duration of its own', () => {
    expect(readFileSync(join(SRC, 'lib/sessionLifecycle.ts'), 'utf8')).toMatch(/from '\.\/activityStructure'/)
  })

  it('the module that answers what is running cannot write', () => {
    // A page render is not an instruction to change a record, and this slice
    // adds no write of any kind.
    const src = readFileSync(join(SRC, 'lib/activityStructure.ts'), 'utf8')
    expect(src).not.toMatch(/from '\.\/(supabase|queries)'/)
    expect(stripComments(src)).not.toMatch(/\.(update|insert|upsert|delete|mutate|mutateAsync)\s*\(/)
  })
})

describe('the Deno half stays in step with the browser half', () => {
  // supabase/functions/_shared/share.ts cannot import from src/lib/, so the
  // rule is written twice on purpose. These are what stop the two drifting.
  const share = () => stripComments(readFileSync(SHARE, 'utf8'))

  it('carries the same two slot words and the same literal comparison', () => {
    const src = share()
    for (const slot of ACTIVITY_SLOTS) expect(src).toContain(`a.slot === '${slot}'`)
    expect(src).toMatch(/a\.skipped === true/)
  })

  it('names the duplication rather than hiding it', () => {
    // A reader who finds the second copy first has to be told there is a
    // first, or they will fix one and leave the other.
    expect(readFileSync(SHARE, 'utf8')).toContain('src/lib/activityStructure.ts')
  })

  it('applies the rule to the session snapshot and NOT to the programme snapshot', () => {
    // A template never carries the key, so buildProgrammeSnapshot summing week
    // activities is correct unchanged. Applying it there would be a change to
    // programme sharing this slice does not make.
    const src = share()
    const session = src.slice(src.indexOf('export function buildSessionSnapshot'))
    const sessionBody = session.slice(0, session.indexOf('export function buildProgrammeSnapshot'))
    const programme = src.slice(src.indexOf('export function buildProgrammeSnapshot'))
    expect(sessionBody).toMatch(/isStoodDownActivity\(a\)/)
    expect(programme).not.toMatch(/isStoodDownActivity/)
  })

  it('publishes neither key, in either runtime', () => {
    // PublicActivity is exactly phase, duration, drillRef and customTitle, and
    // ACTIVITY_KEYS in ./publicShare is the other end of the same contract.
    // Widening either is the one thing the content-sharing boundary review for
    // this slice exists to refuse.
    const publicActivity = share().match(/export interface PublicActivity \{[^}]*\}/)?.[0] ?? ''
    expect(publicActivity).not.toContain('slot')
    expect(publicActivity).not.toContain('skipped')
    const keys = read('lib/publicShare.ts').match(/const ACTIVITY_KEYS[^\n]*\n/)?.[0] ?? ''
    expect(keys).toContain("'phase', 'duration', 'drillRef', 'customTitle'")
    expect(keys).not.toContain('slot')
    expect(keys).not.toContain('skipped')
  })

  it('is covered by the Deno suite as well as the browser one', () => {
    const src = readFileSync(SHARE_TEST, 'utf8')
    expect(src).toContain("slot: 'station', skipped: true")
    expect(src).toMatch(/totalDuration/)
  })
})

describe('the tripwire itself', () => {
  it('catches the shapes it claims to catch', () => {
    // Worth exactly what it detects, so the detector is pinned too. Written as
    // source text rather than as real code, because real code here would trip
    // the checks above.
    expect(SLOT_COMPARISON.test("if (a.slot === 'station') stations.push(a)")).toBe(true)
    expect(SLOT_COMPARISON.test("const isGame = act.slot !== 'game'")).toBe(true)
    expect(SKIPPED_READ.test('if (a.skipped) return null')).toBe(true)
    expect(SKIPPED_READ.test('const off = skipped === true')).toBe(true)
    expect(SKIPPED_FALSE.test('setAct(i, { skipped: false })')).toBe(true)
    expect(INLINE_DURATION_SUM.test('const mins = s.activities.reduce((a, x) => a + (x.duration || 0), 0)')).toBe(true)
    expect(INLINE_DURATION_SUM.test('const t = list.reduce((sum, a) => sum + (a.duration ?? 0), 0)')).toBe(true)
  })

  it('does not catch the shapes that are not a second rule', () => {
    // What keeps it from being deleted as noise. A view state comparison is
    // about a chip somebody pressed, and a drill's own duration is not a
    // session's.
    expect(SLOT_COMPARISON.test("filter.scope === 'station'")).toBe(false)
    expect(SKIPPED_READ.test('const skippedRows = plan.length')).toBe(false)
    expect(INLINE_DURATION_SUM.test('const mins = drills.reduce((a, d) => a + d.players, 0)')).toBe(false)
  })

  it('states what it does not catch, so nobody mistakes it for a proof', () => {
    // Named limits, because an invariant trusted beyond its reach is worse
    // than one nobody trusts. Each of these is a real second rule this test
    // would let through.
    const WALKS_PAST = [
      // The slot word arrives through a variable rather than a literal.
      'if (a.slot === STATION) stations.push(a)',
      // The key is read through a destructure.
      'const { skipped } = a; if (skipped) return null',
      // The sum is written as a loop rather than a reduce.
      'let mins = 0; for (const a of s.activities) mins += a.duration',
      // Structure inferred from the coaching phase, which no text check can
      // separate from a legitimate read of the phase.
      "const stations = s.activities.filter((a) => a.phase === 'Skill')",
    ]
    for (const src of WALKS_PAST) {
      const missed =
        !SLOT_COMPARISON.test(src) && !SKIPPED_READ.test(src) && !SKIPPED_FALSE.test(src) && !INLINE_DURATION_SUM.test(src)
      expect(missed).toBe(true)
    }
  })
})
