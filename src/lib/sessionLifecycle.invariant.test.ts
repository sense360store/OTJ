// The tripwire that keeps one lifecycle rule from becoming five.
//
// WHY THIS EXISTS. "Has this session happened?" is three lines of date
// arithmetic, which is exactly the kind of thing a new screen writes for
// itself in thirty seconds. It had already happened three times before the
// seam existed: `s.status === 'upcoming' && s.date >= todayStr` on Home, a
// different pair of predicates on the parent dashboard, and
// `Date.parse(e.startsAt) >= now` inside the Spond planner. All three
// disagreed at the edges, all three hid a session the moment its start
// time passed, and the disagreement was invisible until a coach found
// tonight missing from one page and present on another.
//
// The rule lives in ./sessionLifecycle and nowhere else, and this test
// fails the build when a second copy appears.
//
// WHAT IT IS NOT. A tripwire, not a proof. It reads source text, so a
// determined workaround walks past it; the last describe below names the
// shapes it cannot catch, so nobody mistakes a pass for a guarantee. It
// catches the realistic mistake, which is somebody typing the obvious
// thing in a hurry.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FALLBACK_SESSION_MINUTES } from './sessionLifecycle'

const SRC = join(import.meta.dirname, '..')

// The one file allowed to know the rule, and its own tests.
const SEAM = [
  'lib/sessionLifecycle.ts',
  'lib/sessionLifecycle.test.ts',
  'lib/sessionLifecycle.invariant.test.ts',
]

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
  return out.filter((f) => !SEAM.includes(f))
}

// Comments carry prose about dates and endings on half the screens, and
// prose is not a predicate. Stripping them keeps the check on code. This
// file's own explanations quote the very shapes it forbids, which is the
// other reason it has to run.
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
}

const isTest = (f: string) => /\.test\.tsx?$/.test(f)

// ---- The shapes a second cutoff is written in -------------------------

// An instant compared against another instant. `Date.parse(e.startsAt) >=
// at`, `s.getTime() < now.getTime()`, `Date.now() > end`. Ordering
// comparators are safe from this because they subtract rather than compare,
// which is why the Spond closeness sort walks past it untouched.
const INSTANT_CUTOFF = /(Date\.now\(\)|\.getTime\(\)|Date\.parse\([^)\n]*\))\s*(<=?|>=?)/

// A date or time string compared against a today-ish one, in either order.
// This is the shape that hid a session at midnight however late it had run,
// and it is the cheapest one to retype. Both sides allow a dotted prefix,
// because the real thing is written `s.date >= todayStr`, and both orders
// are covered, because the same mistake reads just as well backwards.
const TIMED_TERM = String.raw`[\w.]*(?:[Dd]ate|[Tt]ime|[Ss]tartsAt)\w*`
const CLOCK_TERM = String.raw`[\w.]*(?:[Tt]oday|[Nn]ow)\w*`
const COMPARE = String.raw`\s*(?:<=?|>=?)\s*`
const DATE_STRING_CUTOFF = new RegExp(
  String.raw`\b(?:${TIMED_TERM}${COMPARE}${CLOCK_TERM}|${CLOCK_TERM}${COMPARE}${TIMED_TERM})`,
)

// A bare clock read compared against anything.
const CLOCK_COMPARISON = /new Date\(\)\s*(<=?|>=?)/

// The status values, compared. Legitimate in the places that render the
// live view's finished state, track programme progress, or create a row;
// never legitimate in a file that decides what belongs in an operational
// list.
const STATUS_COMPARISON = /status\s*(===|!==|==|!=)\s*['"`](upcoming|completed)['"`]/

// The screens and modules that decide what appears as active work. Every
// one of them has to reach the seam, and none of them may hold a rule of
// its own.
const OPERATIONAL_SURFACES = [
  'routes/Home.tsx',
  'routes/Sessions.tsx',
  'routes/ParentHome.tsx',
  'lib/eventFilter.ts',
  'lib/spond.ts',
  'components/PlanFromSpond.tsx',
]

describe('the lifecycle rule lives in exactly one file', () => {
  it('is the fallback duration nothing else declares', () => {
    // Two fallback durations is two answers to "how long does a session
    // run", which is how the calendar export came to book an hour for a
    // night the app treated as ninety minutes.
    expect(FALLBACK_SESSION_MINUTES).toBe(90)
    const offenders = sourceFiles().filter((f) => {
      const src = stripComments(readFileSync(join(SRC, f), 'utf8'))
      return /(const|let|var)\s+FALLBACK_SESSION_MINUTES|FALLBACK_SESSION_MINUTES\s*=/.test(src)
    })
    expect(offenders).toEqual([])
  })

  it('no other file compares one moment against another to decide what has happened', () => {
    const offenders: string[] = []
    for (const f of sourceFiles().filter((f) => !isTest(f))) {
      const src = stripComments(readFileSync(join(SRC, f), 'utf8'))
      const hit = src.match(INSTANT_CUTOFF) ?? src.match(DATE_STRING_CUTOFF) ?? src.match(CLOCK_COMPARISON)
      if (hit) offenders.push(`${f}: ${hit[0]}`)
    }
    expect(offenders).toEqual([])
  })

  it('no operational surface decides anything from the stored status', () => {
    // Narrow on purpose. The live view renders a completed session's own
    // finished state, the programme screens count completed weeks, and the
    // create paths write upcoming; all of those read the column for
    // something other than "is this still work", and flagging them would
    // make this noise. What is forbidden is the list-composing files
    // trusting a flag that is almost never updated.
    const offenders: string[] = []
    for (const f of OPERATIONAL_SURFACES) {
      const src = stripComments(readFileSync(join(SRC, f), 'utf8'))
      const hit = src.match(STATUS_COMPARISON)
      if (hit) offenders.push(`${f}: ${hit[0]}`)
    }
    expect(offenders).toEqual([])
  })
})

describe('every surface that shows operational work reaches the seam', () => {
  // The negative checks above stop a second implementation appearing. This
  // stops the first one quietly disappearing: a refactor that drops the
  // lifecycle filter from a screen leaves the screen compiling and puts
  // last month back on the front page.
  for (const f of OPERATIONAL_SURFACES) {
    it(`${f} imports the lifecycle rule, or the filter built on it`, () => {
      const src = readFileSync(join(SRC, f), 'utf8')
      expect(src).toMatch(/from '\.\.?\/(lib\/)?(sessionLifecycle|eventFilter)'/)
    })
  }

  it('the calendar export takes its start and length from the same seam', () => {
    // Not an operational list, but the same question with the same right
    // answer. A second derivation here is a second duration by the back
    // door.
    const src = readFileSync(join(SRC, 'lib/ics.ts'), 'utf8')
    expect(src).toMatch(/from '\.\/sessionLifecycle'/)
  })
})

describe('every surface opens in the shared default', () => {
  // The seam can hold the right default and a screen can still open on the
  // wrong one, by writing its own literal into useState.
  const OPENS_ON: [string, RegExp][] = [
    ['routes/Sessions.tsx', /useState<EventFilterState>\(DEFAULT_EVENT_FILTER\)/],
    ['routes/Home.tsx', /useState<EventFilterState>\(DEFAULT_EVENT_FILTER\)/],
    ['components/PlanFromSpond.tsx', /useState<LifecycleScope>\(DEFAULT_LIFECYCLE_SCOPE\)/],
  ]

  for (const [f, pattern] of OPENS_ON) {
    it(`${f} initialises from the constant, not from a literal of its own`, () => {
      expect(readFileSync(join(SRC, f), 'utf8')).toMatch(pattern)
    })
  }

  it('no other file writes the Upcoming or Past labels as literals', () => {
    // Two screens with slightly different words for the same view is the
    // visible half of two screens with different rules behind it.
    const offenders: string[] = []
    for (const f of sourceFiles().filter((f) => !isTest(f))) {
      const src = stripComments(readFileSync(join(SRC, f), 'utf8'))
      for (const m of src.matchAll(/'([^'\\\n]*)'|"([^"\\\n]*)"|`([^`\\]*)`/g)) {
        const lit = (m[1] ?? m[2] ?? m[3] ?? '').trim()
        if (lit === 'Upcoming' || lit === 'Past') offenders.push(`${f}: ${lit}`)
      }
    }
    expect(offenders).toEqual([])
  })
})

describe('deciding a session is past writes nothing', () => {
  // The product rule, made mechanical: a page render is not an instruction
  // to change a record, so the modules that answer "has this happened"
  // cannot reach the database at all.
  for (const f of ['lib/sessionLifecycle.ts', 'lib/eventFilter.ts']) {
    it(`${f} cannot write, because it cannot reach the client`, () => {
      const src = readFileSync(join(SRC, f), 'utf8')
      expect(src).not.toMatch(/from '\.\/(supabase|queries)'/)
      expect(stripComments(src)).not.toMatch(/\.(update|insert|upsert|delete|mutate|mutateAsync)\s*\(/)
    })
  }
})

describe('the tripwire itself', () => {
  it('catches the shapes it claims to catch', () => {
    // Worth exactly what it detects, so the detector is pinned too.
    // Written as source text rather than as real code, because real code
    // here would trip the checks above.
    expect(INSTANT_CUTOFF.test('const upcoming = pool.filter((e) => Date.parse(e.startsAt) >= at)')).toBe(true)
    expect(INSTANT_CUTOFF.test('if (Date.now() > end) return true')).toBe(true)
    expect(INSTANT_CUTOFF.test('if (start.getTime() <= cutoff) hide()')).toBe(true)
    expect(DATE_STRING_CUTOFF.test("sessions.filter((s) => s.date >= todayStr)")).toBe(true)
    expect(DATE_STRING_CUTOFF.test('if (todayStr > s.date) return false')).toBe(true)
    expect(CLOCK_COMPARISON.test('if (new Date() > end) return')).toBe(true)
    expect(STATUS_COMPARISON.test("sessions.filter((s) => s.status === 'upcoming')")).toBe(true)
    expect(STATUS_COMPARISON.test("if (s.status !== 'completed') keep()")).toBe(true)
  })

  it('does not catch the shapes that are not cutoffs', () => {
    // What keeps it from being deleted as noise. An ordering comparator
    // subtracts, a countdown subtracts, and a view state comparison is
    // about the chip a coach pressed.
    expect(INSTANT_CUTOFF.test('return Date.parse(a.startsAt) - Date.parse(b.startsAt)')).toBe(false)
    expect(INSTANT_CUTOFF.test('const ms = now.getTime() - Date.parse(syncedAt)')).toBe(false)
    expect(DATE_STRING_CUTOFF.test("filter.scope === 'upcoming'")).toBe(false)
    expect(STATUS_COMPARISON.test("filter.scope === 'upcoming'")).toBe(false)
    expect(STATUS_COMPARISON.test("status: 'upcoming',")).toBe(false)
  })

  it('states what it does not catch, so nobody mistakes it for a proof', () => {
    // Named limits, because an invariant trusted beyond its reach is worse
    // than one nobody trusts. Each of these is a real second cutoff this
    // test would let through.
    const WALKS_PAST = [
      // The comparison is hidden behind a helper of the file's own.
      'if (isOver(s)) return false',
      // The instants are compared through a variable rather than a call.
      'const t = s.startsAtMs; if (t < cutoff) return false',
      // The status string is assembled rather than written.
      "if (s.status === DONE) return false",
    ]
    for (const src of WALKS_PAST) {
      const missed =
        !INSTANT_CUTOFF.test(src) &&
        !DATE_STRING_CUTOFF.test(src) &&
        !CLOCK_COMPARISON.test(src) &&
        !STATUS_COMPARISON.test(src)
      expect(missed).toBe(true)
    }
  })

  it('names the files it deliberately leaves alone, and why', () => {
    // Stated rather than silently omitted. Each of these reads the status
    // column for something that is not "is this still operational work",
    // and each would be a false positive worth deleting the test over.
    const READS_STATUS_FOR_SOMETHING_ELSE: Record<string, string> = {
      'lib/data.ts': 'declares the SessionStatus type',
      'lib/queries.ts': 'reads and writes the column',
      'routes/LiveSession.tsx': "renders a completed session's own finished screen",
      'routes/Programmes.tsx': 'counts completed programme weeks',
      'routes/ProgrammeDetail.tsx': 'counts completed programme weeks',
      'hooks/useStartFromTemplate.ts': 'creates a new session as upcoming',
      'components/ApplyProgrammeModal.tsx': 'creates new sessions as upcoming',
    }
    for (const f of Object.keys(READS_STATUS_FOR_SOMETHING_ELSE)) {
      // Each named file exists and is outside the operational list, which
      // is what makes the allowance a decision rather than an oversight.
      expect(() => readFileSync(join(SRC, f), 'utf8')).not.toThrow()
      expect(OPERATIONAL_SURFACES).not.toContain(f)
    }
  })
})

// =====================================================================
// The third state, and the trap it creates.
//
// With two states, isSessionActive and isSessionPast were exact
// complements, so a screen could use one for its Upcoming list and the
// other for its Past list and every row landed somewhere. With three they
// are NOT complements, and a session that ended earlier today satisfies
// neither: it would fall out of both lists and be unreachable, which is
// the regression this state exists to fix, reintroduced from the other
// side. ParentHome was written in exactly that shape and had to be
// corrected (isSessionActive -> isSessionOperational).
//
// A tripwire, not a proof. It catches the realistic mistake, a file
// partitioning its rows with the two non complementary predicates, and it
// cannot catch a predicate reaching a list through a variable or a helper.
// =====================================================================
describe('a list never partitions on two predicates that are not complements', () => {
  const OPERATIONAL = /\bisSessionOperational\b/
  const ACTIVE = /\bisSessionActive\b/
  const PAST = /\bisSessionPast\b/

  it('offers a predicate that IS the complement of past, and says so', () => {
    const seam = readFileSync(join(SRC, 'lib/sessionLifecycle.ts'), 'utf8')
    expect(seam).toMatch(/export function isSessionOperational/)
    expect(seam).toMatch(/export function isSessionEndedToday/)
    // matchesLifecycleScope must route Upcoming through it, or the default
    // view drops today's finished session again.
    const fn = seam.slice(seam.indexOf('export function matchesLifecycleScope'))
    expect(fn).toMatch(/isSessionOperational/)
    expect(fn).not.toMatch(/isSessionActive/)
  })

  it('lets no screen use active and past together without the complement', () => {
    // Naming both is the shape of a partition. A file that does it must
    // also name isSessionOperational, which is the one that actually
    // complements isSessionPast.
    const offenders = sourceFiles()
      .filter((f) => !/\.test\.tsx?$/.test(f) && f !== 'lib/sessionLifecycle.ts')
      .filter((f) => {
        const src = readFileSync(join(SRC, f), 'utf8')
        return ACTIVE.test(src) && PAST.test(src) && !OPERATIONAL.test(src)
      })
    expect(offenders).toEqual([])
  })

  it('names what this cannot catch', () => {
    // A predicate passed as a variable, a list built in a hook and
    // filtered elsewhere, or a screen that simply forgets to show ended
    // sessions at all. The behavioural cover for those is
    // ./sameDaySession.test.ts and ./sessionCleanup.acceptance.test.tsx.
    expect(OPERATIONAL.test('const p = isSessionActive; rows.filter(p)')).toBe(false)
  })
})
