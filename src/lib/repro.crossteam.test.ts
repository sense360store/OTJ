import { describe, expect, it } from 'vitest'
import { spondSetupRows, teamNameBySubgroup, suggestionPool, unmatchedPlayers } from './spondLinking'
import type { RegisteredPlayer } from './data'

const player = (id: string, name: string, teamId: string): RegisteredPlayer =>
  ({
    playerId: id,
    displayName: name,
    shirtNumber: null,
    teamId,
    status: 'active',
  }) as unknown as RegisteredPlayer

describe('cross team same name reproduction', () => {
  it('names Titans for an Argonauts child, off a Titans member of the same name', () => {
    // Club roster, current season, both children real and distinct.
    const clubRoster = [
      player('P-ARG', 'Alex Smith', 'T-ARG'),
      player('P-TIT', 'Alex Smith', 'T-TIT'),
    ]
    // The screen scopes the pool to the team being worked through.
    const pool = suggestionPool(clubRoster, 'T-ARG')
    expect(pool.map((p) => p.playerId)).toEqual(['P-ARG'])

    // Argonauts' own mapped subgroup holds nobody of that name.
    const candidates: never[] = []
    const links: never[] = []
    expect(unmatchedPlayers(candidates, links, pool).map((p) => p.playerId)).toEqual(['P-ARG'])

    // The parent group members Argonauts' mapping does not reach: the
    // Titans child, who is a different person.
    const outsideMembers = [{ displayName: 'Alex Smith', subgroupIds: ['SG-TITANS'] }]

    const teamBySubgroup = teamNameBySubgroup([
      { subgroupId: 'SG-ARGONAUTS', teamName: 'Argonauts' },
      { subgroupId: 'SG-TITANS', teamName: 'Titans' },
    ])

    const rows = spondSetupRows({
      candidates,
      links,
      pool,
      outsideMembers,
      outsideComplete: true,
      teamBySubgroup,
    })
    console.log(JSON.stringify(rows.map((r) => ({ n: r.player.displayName, state: r.state, otherTeam: r.otherTeam }))))
    expect(rows).toHaveLength(1)
    expect(rows[0].state).toBe('other_subgroup')
    expect(rows[0].otherTeam).toBe('Titans')
  })
})
