// The club's team order, as a pure rule and as a save that must not trip the
// unique index. The fake store below ENFORCES teams_sort_order_unique the way
// PostgreSQL does, per row, so a strategy that swapped two positions in place
// would fail here exactly as it would in production.
import { describe, expect, it } from 'vitest'
import type { Team } from './data'
import {
  TeamOrderChanged,
  TeamOrderRefused,
  canonicalPositions,
  clubOrder,
  clubOrderState,
  compareTeamsByName,
  moveTeam,
  reconcileDraft,
  sameTeamOrder,
  saveFailureMessage,
  saveTeamOrder,
  teamOrderWrites,
  teamsInDraftOrder,
  type TeamOrderStore,
  type TeamPosition,
} from './teamOrder'

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

describe('what a save writes', () => {
  it('assigns 1..N in the order given', () => {
    expect([...canonicalPositions([team('x', 'X'), team('y', 'Y'), team('z', 'Z')])]).toEqual([
      ['x', 1],
      ['y', 2],
      ['z', 3],
    ])
  })

  it('touches only the teams whose stored position differs from the one the order gives them', () => {
    // Stored 1, 3, 8 in the same order: the first is at its position already.
    const ordered = [team('a', 'Alpha', 1), team('b', 'Bravo', 3), team('c', 'Charlie', 8)]
    expect(teamOrderWrites(ordered)).toEqual([
      { id: 'b', position: 2 },
      { id: 'c', position: 3 },
    ])
  })

  it('writes nothing for an order that is already stored as 1..N', () => {
    expect(teamOrderWrites([team('a', 'Alpha', 1), team('b', 'Bravo', 2)])).toEqual([])
  })

  it('writes every unplaced team when the club has never set an order', () => {
    expect(teamOrderWrites([team('a', 'Alpha'), team('b', 'Bravo')])).toEqual([
      { id: 'a', position: 1 },
      { id: 'b', position: 2 },
    ])
  })

  it('compares two orders by id sequence', () => {
    expect(sameTeamOrder([team('a', 'A'), team('b', 'B')], [team('a', 'A2'), team('b', 'B2')])).toBe(true)
    expect(sameTeamOrder([team('a', 'A'), team('b', 'B')], [team('b', 'B'), team('a', 'A')])).toBe(false)
    expect(sameTeamOrder([team('a', 'A')], [team('a', 'A'), team('b', 'B')])).toBe(false)
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

/* ---- the save, against a store that enforces the unique index ---- */

interface FakeOptions {
  // Fail the nth write (1-based, counting clears and sets together) to
  // simulate a dropped connection mid save.
  failAt?: number
  // Answer every write with no rows, as row level security does for a
  // caller without teams.manage.
  refuseWrites?: boolean
}

function fakeStore(rows: TeamPosition[], opts: FakeOptions = {}) {
  const state = new Map(rows.map((r) => [r.id, r.sortOrder]))
  const log: string[] = []
  let writes = 0
  const failing = () => {
    writes += 1
    if (opts.failAt !== undefined && writes === opts.failAt) throw new Error('network dropped')
  }
  const assertUnique = () => {
    const taken = new Set<number>()
    for (const v of state.values()) {
      if (v === null) continue
      if (taken.has(v)) throw new Error(`unique_violation: teams_sort_order_unique at ${v}`)
      taken.add(v)
    }
  }
  const snapshot = (ids: readonly string[]): TeamPosition[] =>
    ids.filter((id) => state.has(id)).map((id) => ({ id, sortOrder: state.get(id) as number | null }))
  const store: TeamOrderStore = {
    async readPositions() {
      log.push('read')
      return snapshot([...state.keys()])
    },
    async clearPositions(ids) {
      failing()
      log.push(`clear ${[...ids].join(',')}`)
      if (opts.refuseWrites) return []
      for (const id of ids) if (state.has(id)) state.set(id, null)
      assertUnique()
      return snapshot(ids)
    },
    async setPosition(id, position) {
      failing()
      log.push(`set ${id}=${position}`)
      if (opts.refuseWrites) return []
      if (state.has(id)) state.set(id, position)
      assertUnique()
      return snapshot([id])
    },
  }
  return { store, log, state }
}

describe('saving the order', () => {
  it('stores 1..N for an unset club, clearing nothing first because nothing is placed', async () => {
    const { store, log, state } = fakeStore([
      { id: 'a', sortOrder: null },
      { id: 'b', sortOrder: null },
      { id: 'c', sortOrder: null },
    ])
    const done = await saveTeamOrder(store, ['c', 'a', 'b'])
    expect(done).toEqual([
      { id: 'c', position: 1 },
      { id: 'a', position: 2 },
      { id: 'b', position: 3 },
    ])
    expect([...state]).toEqual([
      ['a', 2],
      ['b', 3],
      ['c', 1],
    ])
    // The clear still runs over the moved set, which is every team here,
    // and is a no-op on rows already null.
    expect(log[0]).toBe('read')
    expect(log[1]).toBe('clear c,a,b')
  })

  it('swaps two placed teams without ever holding both at one position', async () => {
    const { store, log, state } = fakeStore([
      { id: 'a', sortOrder: 1 },
      { id: 'b', sortOrder: 2 },
      { id: 'c', sortOrder: 3 },
    ])
    await saveTeamOrder(store, ['b', 'a', 'c'])
    // The fake would have thrown unique_violation on an in place swap.
    expect(state.get('a')).toBe(2)
    expect(state.get('b')).toBe(1)
    expect(state.get('c')).toBe(3)
    expect(log).toEqual(['read', 'clear b,a', 'set b=1', 'set a=2'])
  })

  it('leaves a team already at its position untouched', async () => {
    const { store, log } = fakeStore([
      { id: 'a', sortOrder: 1 },
      { id: 'b', sortOrder: 3 },
      { id: 'c', sortOrder: 8 },
    ])
    await saveTeamOrder(store, ['a', 'b', 'c'])
    expect(log).toEqual(['read', 'clear b,c', 'set b=2', 'set c=3'])
    expect(log.some((l) => l.includes(' a'))).toBe(false)
  })

  it('writes nothing at all for an order already stored as 1..N', async () => {
    const { store, log } = fakeStore([
      { id: 'a', sortOrder: 1 },
      { id: 'b', sortOrder: 2 },
    ])
    expect(await saveTeamOrder(store, ['a', 'b'])).toEqual([])
    expect(log).toEqual(['read'])
  })

  it('completes an incomplete order, moving an unplaced team above a placed one', async () => {
    const { store, state } = fakeStore([
      { id: 'a', sortOrder: 1 },
      { id: 'b', sortOrder: 2 },
      { id: 'n', sortOrder: null },
    ])
    await saveTeamOrder(store, ['n', 'a', 'b'])
    expect([...state]).toEqual([
      ['a', 2],
      ['b', 3],
      ['n', 1],
    ])
  })

  it('refuses a stale draft rather than arranging around a team another admin added or removed', async () => {
    const added = fakeStore([
      { id: 'a', sortOrder: 1 },
      { id: 'b', sortOrder: 2 },
      { id: 'new', sortOrder: null },
    ])
    await expect(saveTeamOrder(added.store, ['b', 'a'])).rejects.toBeInstanceOf(TeamOrderChanged)
    expect(added.log).toEqual(['read'])
    const removed = fakeStore([{ id: 'a', sortOrder: 1 }])
    await expect(saveTeamOrder(removed.store, ['b', 'a'])).rejects.toBeInstanceOf(TeamOrderChanged)
    const duplicated = fakeStore([
      { id: 'a', sortOrder: 1 },
      { id: 'b', sortOrder: 2 },
    ])
    await expect(saveTeamOrder(duplicated.store, ['a', 'a'])).rejects.toBeInstanceOf(TeamOrderChanged)
  })

  it('a save that drops between the phases leaves an incomplete order of nulls, never a false one', async () => {
    // The clear succeeds, the first set fails.
    const { store, state } = fakeStore(
      [
        { id: 'a', sortOrder: 1 },
        { id: 'b', sortOrder: 2 },
        { id: 'c', sortOrder: 3 },
      ],
      { failAt: 2 },
    )
    await expect(saveTeamOrder(store, ['c', 'b', 'a'])).rejects.toThrow('network dropped')
    // Every MOVED team is null and nothing claims a position it does not
    // hold. b was already at 2 and was never touched, which is the point:
    // what is left is honestly incomplete, not a false order.
    expect([...state]).toEqual([
      ['a', null],
      ['b', 2],
      ['c', null],
    ])
    const left = [...state].map(([id, sortOrder]) => team(id, id.toUpperCase(), sortOrder))
    expect(clubOrderState(left)).toBe('incomplete')
  })

  it('a save that drops after some positions are set leaves the rest null, and says how many were placed', async () => {
    const { store, state } = fakeStore(
      [
        { id: 'a', sortOrder: 1 },
        { id: 'b', sortOrder: 2 },
        { id: 'c', sortOrder: 3 },
      ],
      { failAt: 3 },
    )
    await expect(saveTeamOrder(store, ['c', 'b', 'a'])).rejects.toThrow('network dropped')
    // c reached its position, b was never touched, a is still cleared.
    expect(state.get('c')).toBe(1)
    expect(state.get('b')).toBe(2)
    expect(state.get('a')).toBe(null)
    const left = [...state].map(([id, sortOrder]) => team(id, id.toUpperCase(), sortOrder))
    expect(clubOrderState(left)).toBe('incomplete')
    expect(clubOrder(left).teams.map((t) => t.id)).toEqual(['c', 'b', 'a'])
  })

  it('treats a write that comes back with no row as a refusal, and writes no position after it', async () => {
    const { store, log } = fakeStore(
      [
        { id: 'a', sortOrder: null },
        { id: 'b', sortOrder: null },
      ],
      { refuseWrites: true },
    )
    await expect(saveTeamOrder(store, ['a', 'b'])).rejects.toBeInstanceOf(TeamOrderRefused)
    expect(log).toEqual(['read', 'clear a,b'])
  })

  it('treats a position that comes back different from a refusal too', async () => {
    const { store } = fakeStore([
      { id: 'a', sortOrder: null },
      { id: 'b', sortOrder: null },
    ])
    const lying: TeamOrderStore = {
      ...store,
      async setPosition(id) {
        return [{ id, sortOrder: 99 }]
      },
    }
    await expect(saveTeamOrder(lying, ['a', 'b'])).rejects.toBeInstanceOf(TeamOrderRefused)
  })

  it('refuses to overwrite a position another admin stored after the draft was read, and writes nothing', async () => {
    // The screen read a, b, c at 1, 2, 3 and arranged c, b, a. Another admin
    // then stored their own order. The save carries what the screen read as
    // `expected`; a fresh position that differs from it is refused before
    // any write, so the other admin's order stands and the refusal says the
    // list has been refreshed.
    const { store, log, state } = fakeStore([
      { id: 'a', sortOrder: 2 },
      { id: 'b', sortOrder: 1 },
      { id: 'c', sortOrder: 3 },
    ])
    const expected: TeamPosition[] = [
      { id: 'a', sortOrder: 1 },
      { id: 'b', sortOrder: 2 },
      { id: 'c', sortOrder: 3 },
    ]
    await expect(saveTeamOrder(store, ['c', 'b', 'a'], expected)).rejects.toBeInstanceOf(TeamOrderChanged)
    expect(log).toEqual(['read'])
    expect([...state]).toEqual([
      ['a', 2],
      ['b', 1],
      ['c', 3],
    ])
  })

  it('saves when the fresh read agrees with what the draft was drawn from', async () => {
    const rows: TeamPosition[] = [
      { id: 'a', sortOrder: 1 },
      { id: 'b', sortOrder: 2 },
      { id: 'c', sortOrder: null },
    ]
    const { store, state } = fakeStore(rows)
    const done = await saveTeamOrder(store, ['c', 'a', 'b'], rows.map((r) => ({ ...r })))
    expect(done).toEqual([
      { id: 'c', position: 1 },
      { id: 'a', position: 2 },
      { id: 'b', position: 3 },
    ])
    expect([...state]).toEqual([
      ['a', 2],
      ['b', 3],
      ['c', 1],
    ])
  })

  it('reads a null in the snapshot as a fact too: a team placed in between is a change', async () => {
    const { store, log } = fakeStore([
      { id: 'a', sortOrder: 1 },
      { id: 'b', sortOrder: 2 },
    ])
    const expected: TeamPosition[] = [
      { id: 'a', sortOrder: 1 },
      { id: 'b', sortOrder: null },
    ]
    await expect(saveTeamOrder(store, ['b', 'a'], expected)).rejects.toBeInstanceOf(TeamOrderChanged)
    expect(log).toEqual(['read'])
  })

  it('with no snapshot, accepts whatever is stored: the caller has chosen last writer wins', async () => {
    const { store, state } = fakeStore([
      { id: 'a', sortOrder: 2 },
      { id: 'b', sortOrder: 1 },
    ])
    await saveTeamOrder(store, ['a', 'b'])
    expect([...state]).toEqual([
      ['a', 1],
      ['b', 2],
    ])
  })

  it('says in its refusals what is stored, in words a coach can act on', async () => {
    const refused = fakeStore([{ id: 'a', sortOrder: null }], { refuseWrites: true })
    await expect(saveTeamOrder(refused.store, ['a'])).rejects.toThrow('no position was written')
    expect(new TeamOrderChanged().message).toContain('The list has been refreshed')
    expect(saveFailureMessage(new TeamOrderChanged())).toMatch(/^Could not save the team order\. The club's teams changed/)
    expect(saveFailureMessage(new TeamOrderRefused('Half done.'))).toBe(
      'Could not save the team order. Half done. The status above says what is stored now; check the order and press Save team order again.',
    )
    expect(saveFailureMessage(new Error('boom'))).not.toContain('boom')
  })
})
