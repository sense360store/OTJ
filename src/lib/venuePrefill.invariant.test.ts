// The tripwire that keeps the Spond venue prefill a DEFAULT.
//
// WHY THIS EXISTS. Production holds a session the club arranged at
// Flushdyke whose Spond event's location is "Woodkirk Academy, Rein Rd,
// Tingley, Wakefield". That is not a mistake anybody wants corrected: it
// is a real arrangement, made by a coach, recorded in the field built for
// it. The Spond location is what somebody typed when they created the
// event, and the venue is what the club decided.
//
// So the rule has one shape and one moment. matchVenueByLocation answers
// only where a location names exactly one of the club's venues, and it is
// consulted only while building a session that does not exist yet. Every
// other reading of it is a rule that can reach a saved row: a page render
// that "tidies up" a venue, a Spond link that resets one, a refetch that
// helpfully corrects the coach. Each of those loses information nobody can
// get back, and each of them is three lines somebody could write in good
// faith on a Tuesday.
//
// WHAT IT IS NOT. A tripwire, not a proof, in the house tradition. It reads
// source text, so a call routed through a variable or assembled at runtime
// walks past it; the last describe names the shapes it cannot catch. What
// it catches is the realistic edit.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(import.meta.dirname, '..')

// The one file that owns the rule, and its own tests.
const SEAM = ['lib/venues.ts', 'lib/venues.test.ts', 'lib/venuePrefill.invariant.test.ts']

// The one place in the product allowed to consult it: the pure builder for
// a session that does not exist yet.
const CALLER = 'lib/spond.ts'

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

// Comments explain the rule on half a dozen screens, and prose is not code.
// This file's own explanations name the very shapes it forbids, which is
// the other reason the stripping has to happen.
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
}

const read = (rel: string) => stripComments(readFileSync(join(SRC, rel), 'utf8'))
const isTest = (f: string) => /\.test\.tsx?$/.test(f)

// Every useEffect call's arguments, taken by balancing parentheses rather
// than by matching a shape. A regex for `useEffect(() => {` misses the two
// cleanup only effects in this repo, which are written
// `useEffect(() => () => …)` and have no braced body at all, and it would
// miss the next shape somebody writes too. Quotes are tracked so a bracket
// inside a string cannot unbalance the count.
function effectBodies(src: string): string[] {
  const out: string[] = []
  const needle = 'useEffect('
  for (let at = src.indexOf(needle); at !== -1; at = src.indexOf(needle, at + 1)) {
    let depth = 0
    let quote = ''
    let i = at + needle.length - 1
    for (; i < src.length; i++) {
      const ch = src[i]
      if (quote) {
        if (ch === '\\') i++
        else if (ch === quote) quote = ''
        continue
      }
      if (ch === "'" || ch === '"' || ch === '`') quote = ch
      else if (ch === '(') depth++
      else if (ch === ')') {
        depth--
        if (depth === 0) break
      }
    }
    out.push(src.slice(at + needle.length, i))
  }
  return out
}

describe('one venue matcher, consulted from one place', () => {
  it('is implemented only in lib/venues.ts', () => {
    // A second implementation is how the strict rule and a looser one end
    // up disagreeing about the same address on two screens.
    for (const file of sourceFiles()) {
      if (SEAM.includes(file)) continue
      expect(read(file), file).not.toMatch(/function\s+matchVenueByLocation/)
    }
  })

  it('is called from lib/spond.ts and nowhere else', () => {
    for (const file of sourceFiles()) {
      if (SEAM.includes(file) || file === CALLER || isTest(file)) continue
      expect(read(file), file).not.toMatch(/matchVenueByLocation\s*\(/)
    }
  })

  it('is called only from sessionFromSpondEvent, which builds a new session', () => {
    // Narrower than the file: spond.ts also holds the picker, the
    // suggestions and the labels, and any of them running the matcher
    // would be a rule reading a saved row.
    const src = read(CALLER)
    const builder = src.slice(src.indexOf('export function sessionFromSpondEvent'))
    expect(builder).toMatch(/matchVenueByLocation\(/)
    expect(src.slice(0, src.indexOf('export function sessionFromSpondEvent'))).not.toMatch(/matchVenueByLocation\(/)
  })

  it('is handed the club’s real venues by the one surface that plans', () => {
    // The parameter is required, so tsc already refuses a call that drops
    // it. What tsc cannot tell is a real list from an `[]` somebody typed
    // to make the compiler quiet, which would leave the feature dead with
    // the whole suite green. So the call site names the query's value.
    const src = read('components/PlanFromSpond.tsx')
    expect(src).toMatch(/useVenues\(\)/)
    // Bounded rather than open ended: the arguments carry their own
    // parentheses (`Object.keys(teamById)`), so this cannot be a simple
    // "anything but a bracket" run.
    expect(src).toMatch(/sessionFromSpondEvent\([\s\S]{0,200}?,\s*venues\)/)
  })

  it('builds no regex out of a venue name or a Spond location', () => {
    // `new RegExp(venue.name)` is the obvious way to write whole word
    // matching and it is two defects at once: an unescaped "." matches a
    // venue nobody chose, and an unescaped "(" throws on a name a coach is
    // free to type. The seam splits on a fixed pattern instead.
    expect(read('lib/venues.ts')).not.toMatch(/new RegExp/)
  })
})

describe('nothing else moves a venue', () => {
  it('leaves the Spond link write touching one column', () => {
    // Linking an event to an EXISTING session answers one question, which
    // event this session is arranged as. It has no business restating where
    // the session is, and a coach who linked an event after choosing a
    // venue would lose that choice silently.
    const src = read('lib/queries.ts')
    const hook = src.slice(src.indexOf('export function useLinkSessionSpondEvent'))
    const update = hook.slice(hook.indexOf('.update('), hook.indexOf('.eq('))
    expect(update).toContain('spond_event_id')
    expect(update).not.toMatch(/venue/)
  })

  it('leaves the planner’s link handler editing one field', () => {
    // The planner links into the draft rather than writing at once, so the
    // same rule has a second shape here.
    const src = read('routes/Planner.tsx')
    const onLink = src.slice(src.indexOf('onLink='), src.indexOf('onLink=') + 200)
    expect(onLink).toContain('spondEventId')
    expect(onLink).not.toMatch(/venue/i)
  })

  it('never gives the frozen free text venue column a value', () => {
    // 0044 froze sessions.venue. The write row clears it when a real venue
    // is chosen and never writes anything else into it, so the read
    // fallback behind it cannot resurrect and contradict the real field.
    const src = read('lib/queries.ts')
    const row = src.slice(src.indexOf('export function toSessionWriteRow'))
    const body = row.slice(0, row.indexOf('\n}'))
    // The only assignment to the column, and its value is null.
    const writes = [...body.matchAll(/\bvenue\s*:\s*([^,}\n]+)/g)].map((m) => m[1].trim())
    expect(writes).toEqual(['null'])
  })

  it('moves no venue from a render', () => {
    // A backfill dressed as a page load is the other way a saved venue
    // disappears: an effect that "corrects" a session while a coach reads
    // it. Two separate claims, because either one alone is weak. No effect
    // saves a session at all, and no effect so much as mentions a venue.
    //
    // Deliberately not "no effect writes anything": the live view's driver
    // starts the first activity from an effect, which is a real render time
    // write of live state and has nothing to do with where the session is.
    let scanned = 0
    for (const file of sourceFiles()) {
      if (isTest(file)) continue
      for (const effect of effectBodies(read(file))) {
        scanned++
        expect(effect, `${file}: useEffect`).not.toMatch(/upsertSession\s*\(/)
        expect(effect, `${file}: useEffect`).not.toMatch(/venue/i)
      }
    }
    // A count, so a scan that silently stopped finding effects fails here
    // rather than passing on nothing. The number moves whenever an effect
    // is added or removed, which is the point: it is a prompt to look, not
    // a rule about how many there should be.
    expect(scanned).toBeGreaterThanOrEqual(29)
  })
})

describe('what this cannot catch', () => {
  it('names its own blind spots', () => {
    // Written down rather than implied, so a green run is read as what it
    // is. None of these are hypothetical shapes nobody would write; they
    // are the ways this check is walked past.
    //
    //  1. The matcher reached through an alias or a variable
    //     (`const m = matchVenueByLocation; m(...)`), or re-exported under
    //     another name.
    //  2. A second matcher that is not a `function` declaration: a const
    //     arrow, a method, or one inlined into a component.
    //  3. A session write inside a helper the effect calls, rather than in
    //     the effect body the scan reads. The scan balances parentheses so
    //     it sees every effect whatever shape it is written in, cleanup
    //     only ones included, but it reads only what is inside the call.
    //  4. A venue assignment routed through a spread or a computed key, so
    //     the literal `venue:` never appears.
    //  5. Anything at all in the database or an Edge Function. This reads
    //     the client only.
    //
    // src/lib/venues.test.ts is the behavioural half, and
    // src/lib/spond.test.ts pins what the pre filled session carries.
    expect(true).toBe(true)
  })
})
