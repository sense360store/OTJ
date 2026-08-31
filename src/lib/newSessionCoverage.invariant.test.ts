// =====================================================================
// What a NEW session covers, pinned mechanically.
//
// There are three ways to create a session and they used to answer this
// question three times: the planner seeded the coach's profile team
// through blankSession, Use template seeded it inline, and Plan from
// Spond used it as the fallback for a club wide event. All three were the
// same mistake, which is a personal default about the COACH standing in
// for a statement about the NIGHT. A coach whose profile said Trojans
// opened New Session and found Trojans already ticked, took a club
// template and got a Trojans session, and planned the club's own Tuesday
// from Spond into a session covering one team. Nothing on any of those
// screens said a choice had been made for them.
//
// The rule is now one function, newSessionCoverage in ./sessionTeams: the
// whole club, unless the thing the session was created FROM names one
// team. This file pins that there is still only one, because three
// implementations that agree today drift on the first change and each of
// them saves a session a coach never looked at.
//
// A tripwire, not a proof, in the house tradition. It reads source text,
// so it catches somebody typing the obvious thing. What it cannot catch
// is a profile team reaching a create path through a variable, a hook
// that returns one under another name, or a fourth create path in a file
// nothing here names. The behavioural halves are ./sessionTeams.test.ts,
// ./data.test.ts and ./spond.test.ts.
// =====================================================================
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { blankSession } from './data'
import { newSessionCoverage } from './sessionTeams'

const SRC = join(import.meta.dirname, '..')

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

const isTest = (f: string) => /\.test\.tsx?$/.test(f)
const read = (f: string) => readFileSync(join(SRC, f), 'utf8')

// Source with its comments removed. This file explains the mistake it is
// preventing directly beside the prevention, which a bare substring check
// would otherwise read as the mistake itself.
const code = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n')

// The three paths that build a session nobody has edited yet.
const CREATE_PATHS = ['routes/Planner.tsx', 'hooks/useStartFromTemplate.ts', 'lib/spond.ts']

describe('one rule decides what a new session covers', () => {
  it('every create path asks newSessionCoverage', () => {
    for (const f of CREATE_PATHS) {
      expect(code(read(f)), f).toMatch(/newSessionCoverage\(/)
    }
  })

  it('nothing else declares a rule of its own', () => {
    const offenders = sourceFiles()
      .filter((f) => f !== 'lib/sessionTeams.ts' && !isTest(f))
      .filter((f) => /export function newSessionCoverage/.test(read(f)))
    expect(offenders).toEqual([])
  })

  it('takes the club and the source, and nothing about the coach', () => {
    // Structural. There is no parameter a profile team could arrive
    // through, which is what stops the old fallback being reintroduced by
    // a call site rather than by an edit to the rule.
    expect(newSessionCoverage.length).toBe(1)
    expect(newSessionCoverage(['t1', 't2'])).toEqual(['t1', 't2'])
    expect(newSessionCoverage(['t1', 't2'], 't2')).toEqual(['t2'])
  })
})

describe('no create path seeds coverage from the signed in coach', () => {
  it('blankSession takes no team at all', () => {
    // The argument is gone rather than defaulted. Left in place it would
    // read as an invitation, and the planner filled it with the profile
    // team for exactly that reason.
    expect(blankSession.length).toBe(1)
    expect(blankSession('coach-1').teamIds).toEqual([])
    expect(code(read('lib/data.ts'))).not.toMatch(/teamIds: teamId/)
  })

  it('no create path reads a profile team', () => {
    // `profile?.team_id` and `profile.team_id`. It remains a legitimate
    // personal default elsewhere (a board's team, a programme's team
    // picker), which is why this names the create paths rather than the
    // whole tree.
    for (const f of CREATE_PATHS) {
      expect(code(read(f)), f).not.toMatch(/profile\??\.team_id/)
    }
  })

  it('the planner seeds a draft once, and never an existing session', () => {
    // The ref used to start true for a coach whose profile named a team,
    // because blankSession had already seeded it. Now the only thing that
    // suppresses the seed is editing a STORED session, whose coverage is
    // the answer: a one team session must never widen for being opened.
    const src = code(read('routes/Planner.tsx'))
    expect(src).toMatch(/const coverageSeeded = useRef\(!!existing\)/)
    // Once. A later teams refetch, a team added or a team deleted must
    // not rewrite a draft the coach has since edited.
    expect(src).toMatch(/if \(coverageSeeded\.current \|\| teams\.length === 0\) return/)
    // And only into a draft that covers nothing, so a coach who has
    // cleared every team keeps an empty selection.
    expect(src).toMatch(/s\.teamIds\.length > 0 \? s :/)
  })

  it('a new draft is not remounted when the profile arrives', () => {
    // The key used to carry the profile id so a late read could rebuild
    // the draft around the coach's team. Nothing about a new draft depends
    // on the profile any more, and remounting would now throw away
    // whatever the coach had already typed and unticked.
    const src = code(read('routes/Planner.tsx'))
    expect(src).toMatch(/key="new"/)
    expect(src).not.toMatch(/key=\{'new-'/)
  })
})

describe('a path that saves before the coach sees it waits for the club', () => {
  // newSessionCoverage returns an empty set for an unknown club, which is
  // correct (absence is absence) and unusable for a session that is
  // written immediately: the planner it opens will not re-seed a stored
  // row, so the register lists nobody with no later repair. Both such
  // paths therefore gate on the teams read having ANSWERED.
  it('Plan from Spond reads the teams query, not only the derived map', () => {
    const src = code(read('components/PlanFromSpond.tsx'))
    expect(src).toMatch(/useTeams\(\)/)
    expect(src).toMatch(/teamsQuery\.isLoading/)
    expect(src).toMatch(/teamsQuery\.isError/)
  })

  it('Use template reports whether the club is known, and the screens disable on it', () => {
    expect(code(read('hooks/useStartFromTemplate.ts'))).toMatch(/ready: teamsQuery\.data !== undefined/)
    for (const f of ['routes/Templates.tsx', 'routes/ProgrammeDetail.tsx']) {
      expect(code(read(f)), f).toMatch(/useBlocked=\{!teamsReady\}/)
      expect(code(read(f)), f).toMatch(/disabled=\{usePendingId !== null \|\| useBlocked\}/)
    }
  })
})

describe('what this file cannot catch', () => {
  it('names its own blind spots rather than implying it has none', () => {
    // A profile team reaching a create path through a local variable or a
    // hook that returns one under another name; a fourth create path in a
    // file this list does not name; a call site that passes the club's
    // teams but filters them first. Each of those passes every rule above.
    // The behavioural halves are the pure suites, and the register itself
    // is what a coach notices when this is wrong.
    expect(CREATE_PATHS).toHaveLength(3)
  })
})
