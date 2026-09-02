import { describe, expect, it } from 'vitest'
import {
  coverageKey,
  coverageOf,
  newSessionCoverage,
  coversWholeClub,
  coveredTeamIds,
  sessionCoversAnyTeam,
  sessionTeamsLabel,
  sessionVisibleToTeams,
  soleCoveredTeamId,
  toggleCoveredTeam,
} from './sessionTeams'
import type { Team } from './data'

// Coverage semantics, and in particular the rule that absence is never
// read as "everyone". The earlier model inferred a whole club session
// from zero rows, so deleting a team widened every session that had
// covered only that team.

const cover = (teamIds: string[], teamId: string | null = null) => ({ teamId, teamIds })

const teams: Record<string, Team | undefined> = {
  t1: { id: 't1', name: 'Titans', bibColour: 'red', sortOrder: null },
  t2: { id: 't2', name: 'Trojans', bibColour: null, sortOrder: null },
  t3: { id: 't3', name: 'Spartans', bibColour: null, sortOrder: null },
}
const allIds = ['t1', 't2', 't3']

describe('coverageOf', () => {
  it('reads explicit rows first', () => {
    expect(coverageOf(cover(['t2', 't1']))).toEqual({ kind: 'teams', teamIds: ['t2', 't1'] })
  })

  it('falls back to the frozen single team for a legacy session', () => {
    expect(coverageOf(cover([], 't1'))).toEqual({ kind: 'legacy', teamIds: ['t1'] })
  })

  it('is unset when there is neither, and unset covers nothing', () => {
    expect(coverageOf(cover([]))).toEqual({ kind: 'unset', teamIds: [] })
    expect(coveredTeamIds(cover([]))).toEqual([])
  })
})

describe('the widening bug this model exists to prevent', () => {
  it('a session whose only team was deleted covers nothing, not everyone', () => {
    // The team delete cascaded its session_teams row away. The session is
    // left with no rows and no frozen team.
    const orphaned = cover([])
    expect(coveredTeamIds(orphaned)).toEqual([])
    expect(coversWholeClub(orphaned, allIds)).toBe(false)
    expect(sessionCoversAnyTeam(orphaned, allIds)).toBe(false)
    expect(sessionTeamsLabel(orphaned, teams)).toBe('Teams not set')
  })

  it('rows naming only deleted teams read as unset rather than as all teams', () => {
    const stale = cover(['gone'])
    expect(coversWholeClub(stale, allIds)).toBe(false)
    expect(sessionTeamsLabel(stale, teams)).toBe('Teams not set')
  })
})

describe('coversWholeClub', () => {
  it('is true only when explicit rows span every current team', () => {
    expect(coversWholeClub(cover(['t1', 't2', 't3']), allIds)).toBe(true)
    expect(coversWholeClub(cover(['t1', 't2']), allIds)).toBe(false)
    expect(coversWholeClub(cover([], 't1'), allIds)).toBe(false)
    expect(coversWholeClub(cover([]), allIds)).toBe(false)
  })

  it('is false for a club with no teams at all, which covers nobody', () => {
    expect(coversWholeClub(cover([]), [])).toBe(false)
    expect(coversWholeClub(cover(['t1']), [])).toBe(false)
  })
})

describe('sessionCoversAnyTeam', () => {
  it('matches on the covered set and never on absence', () => {
    expect(sessionCoversAnyTeam(cover(['t1', 't2']), ['t2'])).toBe(true)
    expect(sessionCoversAnyTeam(cover(['t1']), ['t2'])).toBe(false)
    expect(sessionCoversAnyTeam(cover([], 't1'), ['t1'])).toBe(true)
    expect(sessionCoversAnyTeam(cover([]), allIds)).toBe(false)
    expect(sessionCoversAnyTeam(cover(['t1']), [])).toBe(false)
  })
})

describe('sessionVisibleToTeams: the schedule filter, deliberately generous', () => {
  it('shows a session covering one of my teams, and hides one covering none', () => {
    expect(sessionVisibleToTeams(cover(['t1', 't2']), ['t2'])).toBe(true)
    expect(sessionVisibleToTeams(cover(['t1']), ['t2'])).toBe(false)
    expect(sessionVisibleToTeams(cover([], 't1'), ['t1'])).toBe(true)
  })

  it('keeps an untagged session visible rather than vanishing it', () => {
    // The register hides an unset session's players; a schedule must not
    // hide the session itself, or a coach loses their own night because
    // they never ticked a team.
    expect(sessionVisibleToTeams(cover([]), ['t1'])).toBe(true)
    expect(sessionVisibleToTeams(cover([]), [])).toBe(true)
    // The strict rule, used by the register, still says nothing is covered.
    expect(sessionCoversAnyTeam(cover([]), ['t1'])).toBe(false)
  })
})

describe('coverageKey', () => {
  it('is the same for the same set whatever the order, and empty for unset', () => {
    expect(coverageKey(cover(['t2', 't1']))).toBe(coverageKey(cover(['t1', 't2'])))
    expect(coverageKey(cover(['t1']))).not.toBe(coverageKey(cover(['t1', 't2'])))
    expect(coverageKey(cover([]))).toBe('')
    expect(coverageKey(cover([], 't1'))).toBe('t1')
  })
})

describe('sessionTeamsLabel', () => {
  it('names the whole club, a subset alphabetically, and one legacy team', () => {
    expect(sessionTeamsLabel(cover(['t1', 't2', 't3']), teams)).toBe('All teams')
    expect(sessionTeamsLabel(cover(['t2', 't1']), teams)).toBe('Titans, Trojans')
    expect(sessionTeamsLabel(cover([], 't1'), teams)).toBe('Titans')
    expect(sessionTeamsLabel(cover([]), teams)).toBe('Teams not set')
  })
})

describe('soleCoveredTeamId', () => {
  it('answers only when exactly one team is covered', () => {
    expect(soleCoveredTeamId(cover(['t1']))).toBe('t1')
    expect(soleCoveredTeamId(cover([], 't2'))).toBe('t2')
    expect(soleCoveredTeamId(cover(['t1', 't2']))).toBeNull()
    expect(soleCoveredTeamId(cover([]))).toBeNull()
  })
})

describe('toggleCoveredTeam', () => {
  it('adds, removes, and allows clearing the last one', () => {
    expect(toggleCoveredTeam([], 't1')).toEqual(['t1'])
    expect(toggleCoveredTeam(['t1', 't2'], 't1')).toEqual(['t2'])
    // Clearing every team is a real state the planner shows as unset,
    // not something to silently refuse.
    expect(toggleCoveredTeam(['t1'], 't1')).toEqual([])
  })
})

describe('newSessionCoverage', () => {
  it('covers the whole club when nothing names one team', () => {
    expect(newSessionCoverage(['t1', 't2', 't3'])).toEqual(['t1', 't2', 't3'])
  })

  it('covers exactly the one team the source named', () => {
    // A team specific Spond event, and nothing else the club has.
    expect(newSessionCoverage(['t1', 't2', 't3'], 't2')).toEqual(['t2'])
  })

  it('narrows to a team the club list does not carry, rather than dropping it', () => {
    // A team the read has not caught up with is still what the event said.
    // Dropping it would silently widen the night to everybody, which is
    // the direction this whole rule exists to prevent.
    expect(newSessionCoverage([], 't9')).toEqual(['t9'])
  })

  it('takes no coach, so a personal default cannot narrow a night', () => {
    // THE DEFECT, structurally. The profile team used to be an argument,
    // and a club wide event inherited it. There is no parameter for one
    // now, and the second is about the SESSION's source rather than about
    // who is creating it.
    expect(newSessionCoverage.length).toBe(1)
  })

  it('returns an empty set for an unknown club rather than inventing one', () => {
    // Absence is absence, exactly as coverageOf insists. A caller that
    // would SAVE this must wait for the team read instead of asking early.
    expect(newSessionCoverage([])).toEqual([])
  })

  it('de-duplicates and returns a fresh array the caller may edit', () => {
    const all = ['t1', 't1', 't2']
    const out = newSessionCoverage(all)
    expect(out).toEqual(['t1', 't2'])
    out.push('t3')
    expect(all).toEqual(['t1', 't1', 't2'])
  })
})
