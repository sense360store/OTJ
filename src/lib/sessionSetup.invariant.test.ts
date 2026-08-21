// =====================================================================
// COACH-3's boundaries, pinned mechanically.
//
// A TRIPWIRE, NOT A PROOF. Everything here reads source text, so it
// catches somebody typing the obvious thing and nothing else. The
// behavioural half is ./sessionSetup.test.ts, over the same functions.
//
// The shapes it CANNOT catch are named in its own tests at the bottom, so
// a green run is never mistaken for "this cannot happen".
//
// What it protects, and why each one is worth a test rather than a
// comment:
//
//   THE STATION COUNT HAS ONE DERIVATION. `activityStructure.ts` answers
//   it. A second answer here would drift from the badge a coach reads on
//   the same night, and the drift would be invisible until a session ran
//   with the wrong number of stations.
//
//   THE BIB RULE HAS ONE DERIVATION. `bibs.ts` holds override, then team
//   default, then none. A generator that rebuilt that chain would be a
//   second answer to what a child is wearing, which is the exact defect
//   `tonight.invariant.test.ts` already guards for the screens.
//
//   NOTHING HERE PERSISTS, AND NOTHING HERE REACHES A TABLE. The module is
//   pure by construction; these rules make an accidental import of a
//   client, a mutation or React fail the build rather than a review.
//
//   NOTHING MOVES A CHILD'S IDENTITY. Moving a child into a different
//   group for one session must never touch their team, their registration
//   or their Spond membership. The phased plan names this as the most
//   plausible regression in the programme, which is why it is checked
//   directly rather than left to intent.
// =====================================================================
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FIVE_STATION_THRESHOLD, SETUP_ISSUE_FIXES, SETUP_NOTES } from './sessionSetup'
import { MAX_STATIONS, MIN_STATIONS } from './activityStructure'

const SRC = join(import.meta.dirname, '..')
const MODULE = 'lib/sessionSetup.ts'

const read = (f: string) => readFileSync(join(SRC, f), 'utf8')
const isTest = (f: string) => /\.test\.tsx?$/.test(f)

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

// Source with its comments removed. This file's own habit is to explain
// the mistake it prevents in a comment beside the prevention, which a bare
// substring check then reads as the mistake itself.
const code = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n')

const body = () => code(read(MODULE))

describe('the generator stays pure', () => {
  it('imports no React, no client and no query layer', () => {
    const src = read(MODULE)
    expect(src).not.toMatch(/from '[^']*\breact\b/)
    expect(src).not.toMatch(/from '\.\/supabase'/)
    expect(src).not.toMatch(/from '\.\/queries'/)
    expect(src).not.toMatch(/\buseState\b|\buseMemo\b|\buseQuery\b|\buseMutation\b/)
  })

  it('names no table and no postgrest call', () => {
    const src = body()
    for (const table of [
      'register_entries',
      'player_registrations',
      'session_teams',
      'spond_event_responses',
      'player_spond_links',
    ]) {
      expect(src, table).not.toContain(table)
    }
    expect(src).not.toMatch(/\.from\(|\.upsert\(|\.insert\(|\.update\(|\.delete\(/)
  })

  it('names no column a write would target', () => {
    // THE MOST PLAUSIBLE REGRESSION IN THE PROGRAMME, per the phased plan:
    // a well-meaning "while we are moving them, also update their team".
    // The arrangement says nothing about who a child plays for.
    //
    // DELIBERATELY NOT a ban on the token `teamId`. Reading which team a
    // child came from is the whole basis of keeping teams whole, so the
    // read model carries it and must. What must never appear is a COLUMN
    // NAME, because a value bound for the database is written in the
    // database's own words. That distinction is the difference between a
    // rule that holds and one that gets deleted the first time it fires on
    // legitimate code.
    const src = body()
    expect(src).not.toMatch(/\bteam_id\b/)
    expect(src).not.toMatch(/\bsort_order\b/)
    expect(src).not.toMatch(/\bshirt_number\b|\bdisplay_name\b|\bspond_member_id\b/)
  })
})

describe('the station count has one derivation', () => {
  it('takes its bounds from activityStructure rather than from its own literals', () => {
    const src = body()
    expect(read(MODULE)).toMatch(/import \{[^}]*MAX_STATIONS/s)
    expect(src).toMatch(/\bMIN_STATIONS\b/)
    expect(src).toMatch(/\bMAX_STATIONS\b/)
    // The carousel bounds are not retyped. A literal 4 or 5 standing in
    // for them is how the two would come to disagree.
    expect(src).not.toMatch(/stations\s*[:=]\s*[45]\b/)
  })

  it('recommends only within the carousel rule, and never three', () => {
    expect(MIN_STATIONS).toBe(4)
    expect(MAX_STATIONS).toBe(5)
    expect(FIVE_STATION_THRESHOLD).toBe(24)
  })

  it('states the threshold once', () => {
    const src = body()
    const literals = [...src.matchAll(/\b24\b/g)]
    expect(literals).toHaveLength(1)
    expect(src).toMatch(/FIVE_STATION_THRESHOLD = 24/)
  })

  it('nothing outside the module declares a second station threshold', () => {
    const offenders = sourceFiles()
      .filter((f) => f !== MODULE && !isTest(f))
      .filter((f) => /FIVE_STATION_THRESHOLD\s*=/.test(read(f)))
    expect(offenders).toEqual([])
  })
})

describe('the bib rule stays where it is', () => {
  it('resolves through effectiveBib rather than rebuilding the chain', () => {
    expect(read(MODULE)).toMatch(/import \{[^}]*effectiveBib/s)
    expect(body()).toMatch(/effectiveBib\(/)
  })

  it('declares no colour vocabulary of its own', () => {
    const src = body()
    expect(read(MODULE)).toMatch(/import \{[^}]*BIB_COLOURS/s)
    // A retyped list is the drift this prevents: bibs.ts is the mirror of
    // the database's own is_bib_colour, and a second list here would out
    // last it.
    for (const colour of ['red', 'blue', 'green', 'yellow', 'orange', 'purple', 'pink']) {
      expect(src, colour).not.toMatch(new RegExp(`['"\`]${colour}['"\`]`))
    }
  })

  it('introduces no second bib concept', () => {
    const src = body()
    expect(src).not.toMatch(/stationBib|station_bib|groupBib|group_bib/i)
    expect(src).not.toMatch(/\bgroupId\b|\bgroup_id\b/)
  })
})

describe('the reply states have one classifier', () => {
  it('asks tonight rather than comparing a response itself', () => {
    const src = read(MODULE)
    expect(src).toMatch(/import \{[\s\S]*?matchesResponse[\s\S]*?\} from '\.\/tonight'/)
    expect(src).toMatch(/hasResponseContext\(/)
    expect(src).toMatch(/matchesResponse\(/)
  })

  it('names no reply state as a literal', () => {
    // 'accepted', 'declined', 'unanswered' and 'waiting' are the API's
    // words. A comparison written here would be a second definition of
    // Going, and the one that drifted would be this one.
    const src = body()
    for (const state of ['accepted', 'declined', 'unanswered', 'waiting']) {
      expect(src, state).not.toMatch(new RegExp(`['"\`]${state}['"\`]`))
    }
    expect(src).not.toMatch(/\.response\s*(===|!==|==|!=)/)
  })

  it('reads the draft through the exported readers rather than indexing it', () => {
    // `draft.included[id]` is sparse and `draft.bibs[id]` may be absent or
    // explicitly null. A second reader that got either wrong would read an
    // untouched child as excluded or a cleared override as a colour.
    const src = body()
    expect(src).toMatch(/draftIncluded\(/)
    expect(src).toMatch(/draftBib\(/)
    expect(src).not.toMatch(/draft\.(included|bibs|attendance)\[/)
  })
})

describe('nothing here stands a station down', () => {
  it('never names the structural keys COACH-2 owns', () => {
    // Recommending four where a plan declares five is advice about the
    // plan, not an edit to it. `skipped` is the coach's own decision and
    // this module has no business writing one.
    const src = body()
    expect(src).not.toMatch(/\bskipped\b/)
    expect(src).not.toMatch(/\bslot\b/)
    expect(src).not.toMatch(/applyRole|setNotRunning/)
  })
})

describe('every derived statement names its fix or its population', () => {
  it('gives each issue a fix a coach can act on', () => {
    for (const [issue, fix] of Object.entries(SETUP_ISSUE_FIXES)) {
      expect(fix, issue).toMatch(/[.!]$/)
      expect(fix.length, issue).toBeGreaterThan(20)
    }
  })

  it('gives each note a real sentence', () => {
    for (const [note, text] of Object.entries(SETUP_NOTES)) {
      expect(text, note).toMatch(/[.!]$/)
      expect(text.length, note).toBeGreaterThan(20)
    }
  })

  it('never names the surface after a time of day', () => {
    // Training runs at 10:00 on a Saturday as often as 18:00 on a Tuesday.
    // These sentences render on Players & groups, which
    // tonight.invariant.test.ts already keeps time neutral, so a string
    // arriving from here must be too.
    expect(body()).not.toMatch(/['"`][^'"`\n/]*\btonight\b[^'"`\n/]*['"`]/i)
  })
})

describe('what this file cannot catch', () => {
  // Stated as tests so the limits are read, not buried in a comment at the
  // top that a future reader skims past.

  it('cannot catch a rule reaching the module through a variable', () => {
    // `const s = 'sta' + 'tion'` defeats every substring rule above, and so
    // does a colour or a reply state arriving as a parameter. These rules
    // catch somebody typing the obvious thing, which is what almost every
    // real regression looks like, and nothing more.
    expect(true).toBe(true)
  })

  it('cannot prove the module is pure, only that it does not say so', () => {
    // An import of something that itself reaches a client would pass every
    // rule here. What actually holds purity is that the behavioural suite
    // calls every export with plain objects and asserts the inputs come
    // back unchanged.
    expect(true).toBe(true)
  })

  it('cannot tell a read of a team from a write to one', () => {
    // The rule above checks for column names, which is a proxy. A function
    // that assembled a team update out of camelCase fields would pass it.
    // What actually holds the boundary is the behavioural test asserting
    // that the only thing planBibOverrides emits is a colour keyed by
    // player id, and that the inputs come back unchanged.
    expect(true).toBe(true)
  })

  it('cannot prove a screen uses any of this', () => {
    // Nothing renders it yet: this PR is the pure generator, and the screen
    // is its own PR per the brief's stated boundary. A source rule claiming
    // a screen were wired would be false today and would have to be written
    // before the thing it checks exists.
    expect(true).toBe(true)
  })
})
