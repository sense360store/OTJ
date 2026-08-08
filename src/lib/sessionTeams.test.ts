import { describe, expect, it } from 'vitest'
import {
  BIB_COLOURS,
  bibSwatch,
  coveredTeamIds,
  coversWholeClub,
  sessionCoversAnyTeam,
  sessionTeamsDiff,
  sessionTeamsLabel,
  toggleCoveredTeam,
} from './sessionTeams'
import type { Team } from './data'

// The covered teams helpers are the single home of the frozen column
// fallback (ADR-0008): rows if any, else the one legacy team, else the
// whole club. These pin that resolution and the diff a save applies.

const ALL = ['t1', 't2', 't3']

const teamById: Record<string, Team | undefined> = {
  t1: { id: 't1', name: 'Titans', bibColour: 'red' },
  t2: { id: 't2', name: 'Trojans', bibColour: null },
  t3: { id: 't3', name: 'Argonauts', bibColour: 'blue' },
}

const withRows = (teamIds: string[], teamId: string | null = null) => ({ teamId, teamIds })

describe('coveredTeamIds', () => {
  it('explicit rows win', () => {
    expect(coveredTeamIds(withRows(['t2']), ALL)).toEqual(['t2'])
  })

  it('a legacy team row covers that one team', () => {
    expect(coveredTeamIds(withRows([], 't1'), ALL)).toEqual(['t1'])
  })

  it('a legacy club row covers every team', () => {
    expect(coveredTeamIds(withRows([], null), ALL)).toEqual(ALL)
  })
})

describe('sessionCoversAnyTeam', () => {
  it('matches through rows, the legacy team and the club fallback', () => {
    expect(sessionCoversAnyTeam(withRows(['t1', 't2']), ['t2'])).toBe(true)
    expect(sessionCoversAnyTeam(withRows(['t1']), ['t3'])).toBe(false)
    expect(sessionCoversAnyTeam(withRows([], 't1'), ['t1'])).toBe(true)
    expect(sessionCoversAnyTeam(withRows([], 't1'), ['t2'])).toBe(false)
    expect(sessionCoversAnyTeam(withRows([], null), ['t3'])).toBe(true)
  })

  it('an empty candidate list never matches', () => {
    expect(sessionCoversAnyTeam(withRows([], null), [])).toBe(false)
  })
})

describe('coversWholeClub', () => {
  it('explicit rows spanning every team are a whole club slot', () => {
    expect(coversWholeClub(withRows(ALL), ALL)).toBe(true)
    expect(coversWholeClub(withRows(['t1', 't2']), ALL)).toBe(false)
  })

  it('a legacy club row is a whole club slot; a legacy team row is not', () => {
    expect(coversWholeClub(withRows([], null), ALL)).toBe(true)
    expect(coversWholeClub(withRows([], 't1'), ALL)).toBe(false)
  })

  it('rows can span a club with no teams left only vacuously false', () => {
    expect(coversWholeClub(withRows(['t9']), [])).toBe(false)
  })
})

describe('sessionTeamsLabel', () => {
  it('a whole club slot reads All teams', () => {
    expect(sessionTeamsLabel(withRows(ALL), teamById)).toBe('All teams')
  })

  it('a subset lists the names alphabetically', () => {
    expect(sessionTeamsLabel(withRows(['t2', 't3']), teamById)).toBe('Argonauts, Trojans')
  })

  it('legacy rows keep their historical labels', () => {
    expect(sessionTeamsLabel(withRows([], 't1'), teamById)).toBe('Titans')
    expect(sessionTeamsLabel(withRows([], null), teamById)).toBe('Club')
  })

  it('rows naming only deleted teams fall back to the frozen ladder', () => {
    // The transient stale cache state: the label must agree with the
    // filters, which treat these rows as matching nothing, so it never
    // claims All teams for a session a team scoped view is hiding.
    expect(sessionTeamsLabel(withRows(['gone']), teamById)).toBe('Club')
    expect(sessionTeamsLabel(withRows(['gone'], 't1'), teamById)).toBe('Titans')
  })
})

describe('sessionTeamsDiff', () => {
  it('computes the pair rows to add and remove', () => {
    expect(sessionTeamsDiff(['t1', 't2'], ['t2', 't3'])).toEqual({ add: ['t3'], remove: ['t1'] })
  })

  it('an unchanged selection writes nothing', () => {
    expect(sessionTeamsDiff(['t1', 't2'], ['t2', 't1'])).toEqual({ add: [], remove: [] })
  })

  it('from empty everything is an add; to empty everything is a remove', () => {
    expect(sessionTeamsDiff([], ALL)).toEqual({ add: ALL, remove: [] })
    expect(sessionTeamsDiff(ALL, [])).toEqual({ add: [], remove: ALL })
  })

  it('duplicate desired entries collapse to one add, so the pair insert cannot collide with itself', () => {
    expect(sessionTeamsDiff([], ['t1', 't1'])).toEqual({ add: ['t1'], remove: [] })
    expect(sessionTeamsDiff(['t1'], ['t1', 't1'])).toEqual({ add: [], remove: [] })
  })
})

describe('toggleCoveredTeam', () => {
  it('adds and removes teams', () => {
    expect(toggleCoveredTeam(['t1'], 't2')).toEqual(['t1', 't2'])
    expect(toggleCoveredTeam(['t1', 't2'], 't1')).toEqual(['t2'])
  })

  it('refuses to empty the selection', () => {
    expect(toggleCoveredTeam(['t1'], 't1')).toEqual(['t1'])
  })
})

describe('bib colours', () => {
  it('resolves a known colour to its swatch and unknowns to null', () => {
    expect(bibSwatch('red')).toBe(BIB_COLOURS[0].swatch)
    expect(bibSwatch('tartan')).toBeNull()
    expect(bibSwatch(null)).toBeNull()
  })

  it('stores lowercase labels within the 0044 length bound', () => {
    for (const b of BIB_COLOURS) {
      expect(b.value).toBe(b.value.toLowerCase())
      expect(b.value.length).toBeGreaterThan(0)
      expect(b.value.length).toBeLessThanOrEqual(20)
    }
  })
})
