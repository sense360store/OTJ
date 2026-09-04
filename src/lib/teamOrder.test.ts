// The club's team order. Everything here is PURE: the ordering and draft
// rules the screen renders, the request the save sends, and the wording each
// refusal is shown in.
//
// There is no fake store and no simulated write, and their absence is the
// point. Until 0052 this module carried a two phase clear-then-place save
// against a store interface, and the tests drove it with a fake that enforced
// teams_sort_order_unique per row and interleaved two savers to prove the
// compare and set held. All of that was compensation for the absence of a
// transaction. public.set_team_order is that transaction, so the client sends
// ONE request and the properties those tests chased (atomicity, the complete
// set, serialization against another admin) are proved where they now live:
// .github/scripts/production-migration/test_0052_atomic_team_order.sh drives
// the disjoint race with two real connections, and
// tests/security/set-team-order.test.ts drives the contract through PostgREST
// with real JWTs. Simulating them here again would test a fake.
import { describe, expect, it } from 'vitest'
import type { Team } from './data'
import {
  TeamOrderChanged,
  TeamOrderNotPermitted,
  TeamOrderRefused,
  clubOrder,
  clubOrderState,
  compareTeamsByName,
  draftAfterSaved,
  intendedPositions,
  moveTeam,
  positionsAgree,
  reconcileDraft,
  sameTeamOrder,
  samePositions,
  saveFailureMessage,
  snapshotAfterRead,
  teamOrderRequest,
  teamPositions,
  teamsInDraftOrder,
  type TeamPosition,
} from './teamOrder'
import { teamOrderError } from './queries'

const team = (id: string, name: string, sortOrder: number | null = null): Team => ({ id, name, bibColour: null, sortOrder })

const names = (teams: readonly Team[]) => teams.map((t) => t.name)

describe('the three states', () => {
  it('is unset when every team is unplaced, and when there are no teams', () => {
    expect(clubOrderState([team('a', 'Titans'), team('b', 'Trojans')])).toBe('unset')
    expect(clubOrderState([])).toBe('unset')
  })
  it('is configured when every team has a position', () => {
    expect(clubOrderState([team('a', 'Titans', 2), team('b', 'Trojans', 1)])).toBe('configured')
  })
  it('is incomplete when some have a position and some do not', () => {
    expect(clubOrderState([team('a', 'Titans', 1), team('b', 'Trojans')])).toBe('incomplete')
  })
})

describe('the club order', () => {
  it('is alphabetical when nothing is placed, and says it is unset rather than calling that an ability order', () => {
    const order = clubOrder([team('t', 'Trojans'), team('a', 'Argonauts'), team('s', 'Spartans')])
    expect(order.state).toBe('unset')
    expect(names(order.teams)).toEqual(['Argonauts', 'Spartans', 'Trojans'])
    expect(names(order.unplaced)).toEqual(['Argonauts', 'Spartans', 'Trojans'])
  })

  it('reads a configured order ascending by stored position, whatever the read order and the names', () => {
    const order = clubOrder([team('a', 'Argonauts', 5), team('t', 'Titans', 1), team('s', 'Spartans', 3), team('g', 'Gladiators', 2), team('r', 'Trojans', 4)])
    expect(order.state).toBe('configured')
    expect(names(order.teams)).toEqual(['Titans', 'Gladiators', 'Spartans', 'Trojans', 'Argonauts'])
    expect(order.unplaced).toEqual([])
  })

  it('keeps gaps: 1, 3, 8 is a valid stored order and reads in that order', () => {
    const order = clubOrder([team('c', 'Charlie', 8), team('a', 'Alpha', 1), team('b', 'Bravo', 3)])
    expect(order.state).toBe('configured')
    expect(names(order.teams)).toEqual(['Alpha', 'Bravo', 'Charlie'])
  })

  it('puts the placed teams first by position and the unplaced after them alphabetically when incomplete', () => {
    const order = clubOrder([team('z', 'Zulu'), team('t', 'Trojans', 2), team('a', 'Argonauts'), team('x', 'Titans', 1)])
    expect(order.state).toBe('incomplete')
    expect(names(order.teams)).toEqual(['Titans', 'Trojans', 'Argonauts', 'Zulu'])
    expect(names(order.unplaced)).toEqual(['Argonauts', 'Zulu'])
  })

  it('breaks every tie deterministically: by name, then by id for two teams of one name', () => {
    // Two teams at one position cannot be stored, but a stale cache can carry
    // it for a render, and the order must not depend on how the read came.
    const a = team('id-b', 'Same', 1)
    const b = team('id-a', 'Same', 1)
    expect(names(clubOrder([a, b]).teams)).toEqual(['Same', 'Same'])
    expect(clubOrder([a, b]).teams.map((t) => t.id)).toEqual(['id-a', 'id-b'])
    expect(clubOrder([b, a]).teams.map((t) => t.id)).toEqual(['id-a', 'id-b'])
    expect(compareTeamsByName(team('1', 'Alpha'), team('2', 'Bravo'))).toBeLessThan(0)
    expect(compareTeamsByName(team('2', 'Alpha'), team('1', 'Alpha'))).toBeGreaterThan(0)
  })

  it('reads no name into the rule: the order of any five names is by position alone', () => {
    const order = clubOrder([team('1', 'Titans', 3), team('2', 'Argonauts', 1), team('3', 'Trojans', 2)])
    expect(names(order.teams)).toEqual(['Argonauts', 'Trojans', 'Titans'])
  })
})

describe('moving a team in the draft', () => {
  const draft = [team('a', 'A'), team('b', 'B'), team('c', 'C')]

  it('moves one place up or down and returns a new array', () => {
    expect(names(moveTeam(draft, 'b', 'up'))).toEqual(['B', 'A', 'C'])
    expect(names(moveTeam(draft, 'b', 'down'))).toEqual(['A', 'C', 'B'])
    expect(moveTeam(draft, 'b', 'up')).not.toBe(draft)
  })

  it('does nothing at the top, at the bottom, or for a team that is not there, and says so by identity', () => {
    expect(moveTeam(draft, 'a', 'up')).toBe(draft)
    expect(moveTeam(draft, 'c', 'down')).toBe(draft)
    expect(moveTeam(draft, 'zz', 'up')).toBe(draft)
  })

  it('leaves the input untouched', () => {
    const before = names(draft)
    moveTeam(draft, 'c', 'up')
    expect(names(draft)).toEqual(before)
  })
})


describe('what a save means to leave', () => {
  it('assigns 1..N in the order given', () => {
    expect(intendedPositions(['c', 'a', 'b'])).toEqual([
      { id: 'c', sortOrder: 1 },
      { id: 'a', sortOrder: 2 },
      { id: 'b', sortOrder: 3 },
    ])
  })

  it('states nothing for an empty order', () => {
    expect(intendedPositions([])).toEqual([])
  })

  it('compares two orders by id sequence', () => {
    const a = [team('x', 'X'), team('y', 'Y')]
    expect(sameTeamOrder(a, [team('x', 'X'), team('y', 'Y')])).toBe(true)
    expect(sameTeamOrder(a, [team('y', 'Y'), team('x', 'X')])).toBe(false)
    expect(sameTeamOrder(a, [team('x', 'X')])).toBe(false)
  })
})

describe('the draft follows a fresh read without losing the arrangement', () => {
  const teams = [team('t', 'Titans', 1), team('g', 'Gladiators', 2), team('a', 'Argonauts')]

  it('keeps the admin arrangement of the teams the read still holds', () => {
    expect(reconcileDraft(['a', 'g', 't'], teams)).toEqual(['a', 'g', 't'])
  })

  it('drops a team the read no longer holds', () => {
    expect(reconcileDraft(['a', 'gone', 'g', 't'], teams)).toEqual(['a', 'g', 't'])
  })

  it('appends a team it has never seen at the end, in club order among the newcomers', () => {
    const wider = [...teams, team('z', 'Zulu'), team('b', 'Bravo'), team('p', 'Placed', 5)]
    // The placed newcomer first, then the unplaced ones alphabetically: a
    // just added team never states where it stands, so it lands last.
    expect(reconcileDraft(['a', 'g', 't'], wider)).toEqual(['a', 'g', 't', 'p', 'b', 'z'])
  })

  it('renders the draft in its own order and skips an id the read does not know', () => {
    expect(names(teamsInDraftOrder(['a', 'missing', 't'], teams))).toEqual(['Argonauts', 'Titans'])
  })
})


/* ---- the request the RPC takes ---- */

describe('the set_team_order request', () => {
  const snapshot = [
    { id: 'b', sortOrder: 2 },
    { id: 'a', sortOrder: 1 },
    { id: 'c', sortOrder: null },
  ]

  it('sends the complete desired order, first id at position 1', () => {
    const req = teamOrderRequest(['c', 'a', 'b'], snapshot)
    expect(req.p_team_ids).toEqual(['c', 'a', 'b'])
  })

  it('ALIGNS the expected positions with the ids by ordinality, not by the snapshot order', () => {
    // The snapshot arrives b,a,c and the order sent is c,a,b. The function
    // reads the arrays positionally, so handing the snapshot over as it came
    // would tell it to expect c at 2, a at 1 and b at null: two wrong
    // comparisons that would refuse a good save or accept a stale one.
    const req = teamOrderRequest(['c', 'a', 'b'], snapshot)
    expect(req.p_expected_sort_orders).toEqual([null, 1, 2])
    req.p_team_ids.forEach((id, i) => {
      const expected = snapshot.find((r) => r.id === id)!.sortOrder
      expect(req.p_expected_sort_orders[i]).toBe(expected)
    })
  })

  it('keeps null as a real expected value rather than dropping or defaulting it', () => {
    const req = teamOrderRequest(['a', 'b'], [
      { id: 'a', sortOrder: null },
      { id: 'b', sortOrder: null },
    ])
    expect(req.p_expected_sort_orders).toEqual([null, null])
    expect(req.p_expected_sort_orders.length).toBe(req.p_team_ids.length)
  })

  it('reads a team the snapshot has never seen as unplaced, which is what it is', () => {
    const req = teamOrderRequest(['a', 'new'], [{ id: 'a', sortOrder: 1 }])
    expect(req.p_expected_sort_orders).toEqual([1, null])
  })

  it('always sends two arrays of equal length, whatever the snapshot holds', () => {
    for (const ids of [[], ['a'], ['a', 'b', 'c', 'd', 'e']]) {
      const req = teamOrderRequest(ids, snapshot)
      expect(req.p_expected_sort_orders.length).toBe(req.p_team_ids.length)
    }
  })

  it('copies the ids rather than aliasing the caller\'s array', () => {
    const ids = ['a', 'b']
    const req = teamOrderRequest(ids, snapshot)
    ids.push('c')
    expect(req.p_team_ids).toEqual(['a', 'b'])
  })

  it('takes its snapshot through teamPositions, so the screen never reads the column', () => {
    const teams = [team('a', 'A', 1), team('b', 'B', null)]
    const req = teamOrderRequest(['b', 'a'], teamPositions(teams))
    expect(req.p_expected_sort_orders).toEqual([null, 1])
  })
})

/* ---- what each refusal means ---- */

describe('translating the function\'s refusals', () => {
  it('reads a stale save from the DETAIL token, not from the code', () => {
    const e = teamOrderError({ code: 'P0001', details: 'stale_order', message: 'refused' })
    expect(e).toBeInstanceOf(TeamOrderChanged)
  })

  it('does NOT read a bare P0001 as another admin saving', () => {
    // P0001 also covers every malformed request the function refuses. Saying
    // "another admin saved" for one of those sends an admin to check an order
    // nobody touched, and hides a defect that will not resolve on its own.
    for (const details of [null, '', 'some other detail', 'stale', 'stale_order ']) {
      const e = teamOrderError({ code: 'P0001', details, message: 'refused' })
      expect(e).not.toBeInstanceOf(TeamOrderChanged)
      expect(e).toBeInstanceOf(TeamOrderRefused)
    }
  })

  it('does not read the token as stale when the code is something else', () => {
    const e = teamOrderError({ code: '23505', details: 'stale_order', message: 'unique' })
    expect(e).not.toBeInstanceOf(TeamOrderChanged)
  })

  it('keeps the capability refusal distinguishable', () => {
    const e = teamOrderError({ code: '42501', details: null, message: 'permission denied' })
    expect(e).toBeInstanceOf(TeamOrderNotPermitted)
    expect(e).not.toBeInstanceOf(TeamOrderChanged)
    expect(e).not.toBeInstanceOf(TeamOrderRefused)
  })

  it('leaves anything else a plain error, carrying what the server said', () => {
    const e = teamOrderError({ code: '08006', details: null, message: 'connection failure' })
    expect(e).not.toBeInstanceOf(TeamOrderChanged)
    expect(e).not.toBeInstanceOf(TeamOrderNotPermitted)
    expect(e).not.toBeInstanceOf(TeamOrderRefused)
    expect(e.message).toBe('connection failure')
  })

  it('survives an error with no fields at all', () => {
    expect(teamOrderError(null).message).toBeTruthy()
    expect(teamOrderError({}).message).toBeTruthy()
  })

  it('says in each refusal what is stored, in words a coach can act on', () => {
    const changed = saveFailureMessage(new TeamOrderChanged())
    expect(changed).toContain('Could not save the team order.')
    expect(changed).toContain('refreshed')

    // Nothing was written, and the wording says so rather than leaving an
    // admin to wonder whether half an order landed.
    const refused = saveFailureMessage(new TeamOrderRefused('The server refused the request as it was made.'))
    expect(refused).toContain('Nothing was changed.')

    const denied = saveFailureMessage(new TeamOrderNotPermitted())
    expect(denied).toContain('permission')

    // A transport failure is the one case this client cannot resolve, and it
    // must not claim either outcome.
    const dropped = saveFailureMessage(new Error('network dropped'))
    expect(dropped).toContain('not known whether it reached the server')
    expect(dropped).not.toContain('Nothing was changed.')
  })
})

describe('a draft snapshot under a fresh read', () => {
  const pos = (id: string, sortOrder: number | null): TeamPosition => ({ id, sortOrder })

  it('keeps the same content for a read that changed nothing, whatever order the read came in', () => {
    const expected = [pos('a', 1), pos('b', 2)]
    const next = snapshotAfterRead(expected, [pos('b', 2), pos('a', 1)])
    expect(next).toEqual([pos('b', 2), pos('a', 1)])
    expect(samePositions(next as TeamPosition[], [pos('b', 2), pos('a', 1)])).toBe(true)
    expect(samePositions(next as TeamPosition[], expected)).toBe(false)
  })

  it('answers null when a known team\'s position moved, which is another admin\'s placement', () => {
    expect(snapshotAfterRead([pos('a', 1), pos('b', 2)], [pos('a', 2), pos('b', 1)])).toBeNull()
    expect(snapshotAfterRead([pos('a', 1), pos('b', null)], [pos('a', 1), pos('b', 2)])).toBeNull()
    expect(snapshotAfterRead([pos('a', 1), pos('b', 2)], [pos('a', 1), pos('b', null)])).toBeNull()
  })

  it('lets a team just added join unplaced, and refuses one that arrives already placed', () => {
    expect(snapshotAfterRead([pos('a', 1)], [pos('a', 1), pos('n', null)])).toEqual([pos('a', 1), pos('n', null)])
    expect(snapshotAfterRead([pos('a', 1)], [pos('a', 1), pos('n', 2)])).toBeNull()
  })

  it('lets a team the read no longer holds leave', () => {
    expect(snapshotAfterRead([pos('a', 1), pos('b', 2)], [pos('a', 1)])).toEqual([pos('a', 1)])
  })

  it('says whether a read holds exactly what a save wrote, whatever order the read came in', () => {
    const saved = [pos('b', 1), pos('a', 2)]
    expect(positionsAgree(saved, [pos('a', 2), pos('b', 1)])).toBe(true)
    // Another admin's order, a team added, a team removed, and a position
    // lost all take the success note away.
    expect(positionsAgree(saved, [pos('a', 1), pos('b', 2)])).toBe(false)
    expect(positionsAgree(saved, [pos('a', 2), pos('b', 1), pos('n', null)])).toBe(false)
    expect(positionsAgree(saved, [pos('b', 1)])).toBe(false)
    expect(positionsAgree(saved, [pos('a', 2), pos('b', null)])).toBe(false)
    expect(positionsAgree([], [])).toBe(true)
  })

})

describe('the draft after a save', () => {
  // A save that landed leaves what it wrote, and that has cases worth
  // exercising. A save that FAILED leaves no draft at all, which has none:
  // it is `onError: () => setDraft(null)` on the screen, pinned there
  // structurally because the whole of it is one statement. The argument for
  // it, including the ABA sequence that refuted the earlier "keep both"
  // rule, is in teamOrder.ts beside the function below.
  const pos = (id: string, sortOrder: number | null): TeamPosition => ({ id, sortOrder })

  it('keeps what was written as the draft and its snapshot after an accepted save', () => {
    // The refetch carries exactly this, so the save's own readback is not
    // taken for another admin's change and `snapshotAfterRead` drops the
    // draft the moment the read agrees.
    expect(draftAfterSaved(['b', 'a', 'c'])).toEqual({
      ids: ['b', 'a', 'c'],
      expected: [pos('b', 1), pos('a', 2), pos('c', 3)],
    })
    // Made for a club that accepted the order shown without a move, so the
    // comparison exists either way.
    expect(draftAfterSaved([])).toEqual({ ids: [], expected: [] })
  })

  it('does not alias the caller\'s array, so a later move cannot rewrite the snapshot', () => {
    const ids = ['b', 'a']
    const draft = draftAfterSaved(ids)
    ids.reverse()
    expect(draft.ids).toEqual(['b', 'a'])
  })

})
