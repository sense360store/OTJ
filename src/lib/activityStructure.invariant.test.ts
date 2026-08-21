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
const FUNCTIONS = join(SRC, '..', 'supabase', 'functions')
const SHARE = join(FUNCTIONS, '_shared', 'share.ts')
const SHARE_TEST = join(FUNCTIONS, '_shared', 'share_test.ts')

// The Deno half of the seam. share.ts holds the duplicated rule on purpose;
// nothing else under supabase/functions/ may hold a second copy of it.
const DENO_SEAM = ['_shared/share.ts', '_shared/share_test.ts']

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

// The AUTHORING boundary, COACH-2B. activityRole.ts is the one module that
// decides what a coach's press WRITES and REMOVES, so it necessarily names
// `skipped` to delete it, and its tests necessarily read it to prove the
// write happened.
//
// This widens the check, so it is paid for: 'reads the stand-down through
// the seam' below asserts that the authoring module never re-implements the
// READ rule it is excused from. It may remove the key; it may not decide
// what the key MEANS. That decision stays in activityStructure.ts, where
// both halves of isStoodDown are load bearing.
const AUTHORING = [
  'lib/activityRole.ts',
  'lib/activityRole.test.ts',
  'lib/coach2bPersistence.test.ts',
]

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

function tsFiles(root: string): string[] {
  const out: string[] = []
  const walk = (dir: string, prefix: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) walk(join(dir, entry.name), rel)
      else if (/\.tsx?$/.test(entry.name)) out.push(rel)
    }
  }
  walk(root, '')
  return out
}

const sourceFiles = () => tsFiles(SRC)
// Walked as well as src/, because a second Edge Function holding its own
// answer is exactly the drift the browser only walk could not see.
const denoFiles = () => tsFiles(FUNCTIONS).filter((f) => !DENO_SEAM.includes(f))

// Comments explain the rule on both sides of it, and prose is not code.
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
}

const read = (f: string) => stripComments(readFileSync(join(SRC, f), 'utf8'))
const readDeno = (f: string) => stripComments(readFileSync(join(FUNCTIONS, f), 'utf8'))

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
    for (const f of denoFiles()) {
      const hit = readDeno(f).match(SLOT_COMPARISON)
      if (hit) offenders.push(`supabase/functions/${f}: ${hit[0]}`)
    }
    expect(offenders).toEqual([])
  })

  it('is the only place the stand-down key is read, outside the wire boundary', () => {
    const offenders: string[] = []
    for (const f of sourceFiles()) {
      if (SEAM.includes(f) || WIRE.includes(f) || AUTHORING.includes(f) || f in SKIPPED_MEANS_SOMETHING_ELSE)
        continue
      const hit = read(f).match(SKIPPED_READ)
      if (hit) offenders.push(`${f}: ${hit[0]}`)
    }
    expect(offenders).toEqual([])
  })

  it('reads the stand-down through the seam, in the authoring module excused above', () => {
    // The authoring module may REMOVE the key. It may not decide what the key
    // MEANS: both halves of isStoodDown (an operational slot AND skipped) are
    // load bearing, and a second answer to "is this stood down" is exactly
    // what the exclusion above would otherwise permit.
    const src = read('lib/activityRole.ts')
    expect(src).toContain("from './activityStructure'")
    expect(src).toContain('isStoodDown(')
    // No hand-rolled comparison, in either shape.
    expect(/\bskipped\s*(===|!==|==|!=)/.test(src)).toBe(false)
    expect(/\.skipped\s*(===|!==|==|!=)/.test(src)).toBe(false)
    // And the only thing it does to the key by name is delete it.
    const byName = src.match(/[^\s]*\.skipped\b/g) ?? []
    expect(byName.length).toBeGreaterThan(0)
    for (const hit of byName) expect(src).toContain(`delete ${hit}`)
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

  it('no Edge Function sums a session of its own', () => {
    // share.ts accumulates with `totalDuration +=` rather than with a reduce,
    // so the browser shape would not catch a second Deno copy. This one does.
    const DENO_DURATION_SUM = /\+=\s*[\w.]*[Dd]uration|[Dd]uration\w*\s*\+=/
    const offenders: string[] = []
    for (const f of denoFiles()) {
      const hit = readDeno(f).match(DENO_DURATION_SUM)
      if (hit) offenders.push(`supabase/functions/${f}: ${hit[0]}`)
    }
    expect(offenders).toEqual([])
  })

  it('the FA import builds its template activities literally, so it carries nothing to strip', () => {
    // THE FOURTH TEMPLATE WRITE PATH, AND IT IS IN DENO. `_shared/fa.ts`
    // inserts straight into the templates table, which the browser boundary
    // helper structurally cannot reach. It is safe because it CONSTRUCTS its
    // activities from drill ids rather than copying a session's, so no
    // session-local key can arrive there. That is a property of the literal,
    // and this is what notices if the literal ever starts carrying one.
    const literal = readDeno('_shared/fa.ts').match(/const activities = drillIds\.map\([^\n]*\)/)?.[0]
    expect(literal).toBeTruthy()
    expect(literal).toContain('phase:')
    expect(literal).toContain('duration:')
    expect(literal).not.toContain('slot')
    expect(literal).not.toContain('skipped')
  })

  it('the shared sum is reached by the module every session surface inherits from', () => {
    // sessionMinutes is implementation one of the four and the one six
    // screens inherit. The negative reduce check above would catch it being
    // re-inlined, and would not catch it being rewritten as a loop, which is
    // the first shape this file admits it cannot see.
    expect(readFileSync(join(SRC, 'lib/data.ts'), 'utf8')).toMatch(/from '\.\/activityStructure'/)
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
    //
    // BOTH MARKERS ARE ASSERTED FOUND BEFORE ANYTHING IS SLICED. indexOf
    // returns -1 when a name is gone, slice(-1) yields the last character, and
    // a negative assertion passes on it, so renaming either builder would have
    // turned this check green while saying nothing.
    const src = share()
    const sessionAt = src.indexOf('export function buildSessionSnapshot')
    const programmeAt = src.indexOf('export function buildProgrammeSnapshot')
    expect(sessionAt).toBeGreaterThan(-1)
    expect(programmeAt).toBeGreaterThan(sessionAt)
    expect(src.slice(sessionAt, programmeAt)).toMatch(/isStoodDownActivity\(a\)/)
    expect(src.slice(programmeAt)).not.toMatch(/isStoodDownActivity/)
  })

  it('publishes neither key, in either runtime', () => {
    // PublicActivity is exactly phase, duration, drillRef and customTitle, and
    // ACTIVITY_KEYS in ./publicShare is the other end of the same contract.
    // Widening either is the one thing the content-sharing boundary review for
    // this slice exists to refuse.
    //
    // EVERY NEGATIVE HERE SITS BEHIND A POSITIVE. Two `not.toContain` calls
    // over an extraction that degrades to the empty string report green when
    // they read nothing at all, and the Deno interface is the half this whole
    // check exists for: a nested type or an `extends` clause would stop the
    // regex matching, and both forbidden keys could then be declared on the
    // published interface with the suite still green.
    const publicActivity = share().match(/export interface PublicActivity \{[^}]*\}/)?.[0] ?? ''
    expect(publicActivity).toContain('customTitle')
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

  it('states which of its checks reach the Deno tree, and which do not', () => {
    // A SCOPE LIMIT RATHER THAN A REGEX BLIND SPOT, and worth its own
    // sentence because a reader takes a pass as covering both runtimes.
    //
    // Reaching supabase/functions/: the slot comparison, the Deno duration
    // sum, and the FA import's activity literal.
    //
    // NOT reaching it: the stand-down key read. `skipped` is a count and a
    // status across spond-sync, spond-roster-import, fa-import and
    // fa-import-programme, so reading the word over that tree would be noise
    // rather than a check, and the assertion below is what keeps that reason
    // true rather than assumed. It is tolerable because an activity is stood
    // down only when a valid slot is ALSO present, and the slot comparison IS
    // checked there, so a second Deno implementation still trips this file on
    // its other half.
    expect(denoFiles().filter((f) => SKIPPED_READ.test(readDeno(f))).length).toBeGreaterThan(0)
    for (const f of denoFiles()) expect(SLOT_COMPARISON.test(readDeno(f))).toBe(false)
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
