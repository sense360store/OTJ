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
  intendedPositions,
  moveTeam,
  positionsAgree,
  reconcileDraft,
  sameTeamOrder,
  samePositions,
  saveFailureMessage,
  saveTeamOrder,
  snapshotAfterRead,
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

/* Enforces teams_sort_order_unique per row the way PostgreSQL does, and
   answers each write the way PostgREST answers a conditional UPDATE: the
   row comes back when the condition held and nothing comes back when it
   did not, with nothing changed in that case. Two savers can share one
   store, which is how the concurrency tests below interleave them. */
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
    async clearPosition(id, from) {
      failing()
      log.push(`clear ${id}@${from}`)
      if (opts.refuseWrites) return []
      if (!state.has(id) || state.get(id) !== from) return []
      state.set(id, null)
      assertUnique()
      return snapshot([id])
    },
    async setPosition(id, position) {
      failing()
      log.push(`set ${id}=${position}`)
      if (opts.refuseWrites) return []
      if (!state.has(id) || state.get(id) !== null) return []
      state.set(id, position)
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
    // Nothing is placed, so there is nothing to clear: the writes are the
    // three placements and nothing else.
    expect(log).toEqual(['read', 'set c=1', 'set a=2', 'set b=3', 'read'])
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
    // The trailing read is the readback: what is stored is compared whole
    // with what the save meant to store before "saved" is said.
    expect(log).toEqual(['read', 'clear b@2', 'clear a@1', 'set b=1', 'set a=2', 'read'])
  })

  it('leaves a team already at its position untouched', async () => {
    const { store, log } = fakeStore([
      { id: 'a', sortOrder: 1 },
      { id: 'b', sortOrder: 3 },
      { id: 'c', sortOrder: 8 },
    ])
    await saveTeamOrder(store, ['a', 'b', 'c'])
    expect(log).toEqual(['read', 'clear b@3', 'clear c@8', 'set b=2', 'set c=3', 'read'])
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
    // Both clears succeed (writes 1 and 2), the first set (write 3) fails.
    const { store, state } = fakeStore(
      [
        { id: 'a', sortOrder: 1 },
        { id: 'b', sortOrder: 2 },
        { id: 'c', sortOrder: 3 },
      ],
      { failAt: 3 },
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

  it('a save that drops between two clears leaves the cleared team null and the rest as they were', async () => {
    const { store, state } = fakeStore(
      [
        { id: 'a', sortOrder: 1 },
        { id: 'b', sortOrder: 2 },
        { id: 'c', sortOrder: 3 },
      ],
      { failAt: 2 },
    )
    await expect(saveTeamOrder(store, ['c', 'b', 'a'])).rejects.toThrow('network dropped')
    expect([...state]).toEqual([
      ['a', 1],
      ['b', 2],
      ['c', null],
    ])
  })

  it('a save that drops after some positions are set leaves the rest null, and says how many were placed', async () => {
    // Clears are writes 1 and 2, c=1 is write 3, a=3 is write 4 and fails.
    const { store, state } = fakeStore(
      [
        { id: 'a', sortOrder: 1 },
        { id: 'b', sortOrder: 2 },
        { id: 'c', sortOrder: 3 },
      ],
      { failAt: 4 },
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

  it('treats a write that comes back with no row as the order having changed or the write refused, and writes nothing after it', async () => {
    // Row level security answers a caller without teams.manage with no
    // row, exactly as a compare and set that found another value does; the
    // save cannot tell them apart and says both.
    const { store, log } = fakeStore(
      [
        { id: 'a', sortOrder: null },
        { id: 'b', sortOrder: null },
      ],
      { refuseWrites: true },
    )
    const failure = await saveTeamOrder(store, ['a', 'b']).catch((e: unknown) => e)
    expect(failure).toBeInstanceOf(TeamOrderChanged)
    expect((failure as Error).message).toContain('or the write was refused')
    expect((failure as Error).message).toContain('0 of 2 moved teams were placed')
    expect(log).toEqual(['read', 'set a=1'])
    const placed = fakeStore([{ id: 'a', sortOrder: 1 }, { id: 'b', sortOrder: 2 }], { refuseWrites: true })
    const atClear = await saveTeamOrder(placed.store, ['b', 'a']).catch((e: unknown) => e)
    expect(atClear).toBeInstanceOf(TeamOrderChanged)
    expect((atClear as Error).message).toContain('Nothing was placed')
    expect(placed.log).toEqual(['read', 'clear b@2'])
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
    const unclearing: TeamOrderStore = {
      ...store,
      async clearPosition(id, from) {
        return [{ id, sortOrder: from }]
      },
    }
    const placed = fakeStore([{ id: 'a', sortOrder: 1 }, { id: 'b', sortOrder: 2 }])
    await expect(saveTeamOrder({ ...placed.store, clearPosition: unclearing.clearPosition }, ['b', 'a'])).rejects.toBeInstanceOf(
      TeamOrderRefused,
    )
  })

  /* ---- two admins, one store ----
     The fresh read before the writes is not enough on its own: two saves
     can both read before either writes, and both pass. The compare and set
     on every write is what refuses the second, and these interleave two
     savers by hand over one store to prove it. */
  const step = () => {
    // A store whose writes wait until released, so two saves can be
    // interleaved at chosen points.
    const gates: (() => void)[] = []
    const release = () => gates.shift()?.()
    const waiting = () => gates.length
    const gate = <T,>(run: () => Promise<T>) => new Promise<T>((resolve, reject) => gates.push(() => run().then(resolve, reject)))
    return { gate, release, waiting }
  }
  const settle = () => new Promise((r) => setTimeout(r, 0))

  it('the second of two saves that both read before either wrote is refused at its first clear, with nothing overwritten', async () => {
    const { store, state } = fakeStore([
      { id: 'a', sortOrder: 1 },
      { id: 'b', sortOrder: 2 },
      { id: 'c', sortOrder: 3 },
    ])
    const rows = () => store.readPositions()
    // Both admins read the same club.
    const snapshotA = await rows()
    const snapshotB = await rows()
    // A saves c, a, b in full first.
    await saveTeamOrder(store, ['c', 'a', 'b'], snapshotA)
    expect([...state]).toEqual([
      ['a', 2],
      ['b', 3],
      ['c', 1],
    ])
    // B's fresh read now disagrees with B's snapshot: refused before any write.
    await expect(saveTeamOrder(store, ['b', 'c', 'a'], snapshotB)).rejects.toBeInstanceOf(TeamOrderChanged)
    expect([...state]).toEqual([
      ['a', 2],
      ['b', 3],
      ['c', 1],
    ])
  })

  it('a save whose fresh read passed is still refused by the compare and set when the other save lands between its read and its writes', async () => {
    const shared = fakeStore([
      { id: 'a', sortOrder: 1 },
      { id: 'b', sortOrder: 2 },
      { id: 'c', sortOrder: 3 },
    ])
    const { gate, release, waiting } = step()
    // B's writes are gated; B's read is not, so B reads fresh and passes
    // the snapshot check, and then waits at its first clear.
    const gated: TeamOrderStore = {
      readPositions: () => shared.store.readPositions(),
      clearPosition: (id, from) => gate(() => shared.store.clearPosition(id, from)),
      setPosition: (id, position) => gate(() => shared.store.setPosition(id, position)),
    }
    const snapshot = await shared.store.readPositions()
    const b = saveTeamOrder(gated, ['b', 'c', 'a'], snapshot).catch((e: unknown) => e)
    await settle()
    expect(waiting()).toBe(1)
    // A saves in full while B is waiting.
    await saveTeamOrder(shared.store, ['c', 'a', 'b'], snapshot)
    expect([...shared.state]).toEqual([
      ['a', 2],
      ['b', 3],
      ['c', 1],
    ])
    // B's first clear expects b@2, and b is now 3: no row, refused, and A's
    // order stands untouched.
    release()
    const failure = await b
    expect(failure).toBeInstanceOf(TeamOrderChanged)
    expect((failure as Error).message).toContain('Nothing was placed')
    expect([...shared.state]).toEqual([
      ['a', 2],
      ['b', 3],
      ['c', 1],
    ])
    expect(waiting()).toBe(0)
  })

  it('a placement finds its row taken when the other save placed it in between, and stops rather than overwriting', async () => {
    // Both start from an UNSET club, so neither has anything to clear and
    // both go straight to placing; the compare and set on null is what
    // separates them.
    const shared = fakeStore([
      { id: 'a', sortOrder: null },
      { id: 'b', sortOrder: null },
    ])
    const { gate, release, waiting } = step()
    const gated: TeamOrderStore = {
      readPositions: () => shared.store.readPositions(),
      clearPosition: (id, from) => gate(() => shared.store.clearPosition(id, from)),
      setPosition: (id, position) => gate(() => shared.store.setPosition(id, position)),
    }
    const b = saveTeamOrder(gated, ['b', 'a']).catch((e: unknown) => e)
    await settle()
    expect(waiting()).toBe(1)
    await saveTeamOrder(shared.store, ['a', 'b'])
    release()
    const failure = await b
    expect(failure).toBeInstanceOf(TeamOrderChanged)
    expect((failure as Error).message).toContain('0 of 2 moved teams were placed')
    expect([...shared.state]).toEqual([
      ['a', 1],
      ['b', 2],
    ])
  })

  it('a save that reads a half placed club reorders what it read, and the interrupted save is refused at its next placement', async () => {
    // A places a=1 and then waits. B reads fresh (a at 1, b unplaced) and,
    // with no snapshot of its own, arranges from what it read: its clear of
    // a is conditioned on the 1 it saw and lands, b and a are placed, and
    // B's order is complete. A resumes and finds b taken: refused, told how
    // far it got, and B's order stands. Nothing anybody wrote was
    // overwritten without having been read first.
    const shared = fakeStore([
      { id: 'a', sortOrder: null },
      { id: 'b', sortOrder: null },
    ])
    const { gate, release, waiting } = step()
    const gated: TeamOrderStore = {
      readPositions: () => shared.store.readPositions(),
      clearPosition: (id, from) => gate(() => shared.store.clearPosition(id, from)),
      setPosition: (id, position) => gate(() => shared.store.setPosition(id, position)),
    }
    const a = saveTeamOrder(gated, ['a', 'b']).catch((e: unknown) => e)
    await settle()
    release() // a=1 lands
    await settle()
    expect(shared.state.get('a')).toBe(1)
    expect(waiting()).toBe(1)
    await saveTeamOrder(shared.store, ['b', 'a'])
    expect([...shared.state]).toEqual([
      ['a', 2],
      ['b', 1],
    ])
    release() // A's b=2 finds b at 1
    const failure = await a
    expect(failure).toBeInstanceOf(TeamOrderChanged)
    expect((failure as Error).message).toContain('1 of 2 moved teams were placed')
    expect([...shared.state]).toEqual([
      ['a', 2],
      ['b', 1],
    ])
    // Had B carried the snapshot its screen drew the draft from (a unplaced),
    // B would have been refused before writing instead.
    const again = fakeStore([
      { id: 'a', sortOrder: 1 },
      { id: 'b', sortOrder: null },
    ])
    await expect(
      saveTeamOrder(again.store, ['b', 'a'], [
        { id: 'a', sortOrder: null },
        { id: 'b', sortOrder: null },
      ]),
    ).rejects.toBeInstanceOf(TeamOrderChanged)
    expect(again.log).toEqual(['read'])
  })

  it('detects two saves over disjoint rows, which no compare and set can refuse, and never calls the merge saved', async () => {
    // A swaps the top two, B swaps the bottom two. Neither touches a row
    // the other writes, so every compare and set passes for both and the
    // club ends with a merge neither arranged. That is the limit of a save
    // made of separate statements, and what the readback is for: A's
    // readback finds the bottom two not where A left them and refuses,
    // so "saved" is not said of the merge.
    const shared = fakeStore([
      { id: 'a', sortOrder: 1 },
      { id: 'b', sortOrder: 2 },
      { id: 'c', sortOrder: 3 },
      { id: 'd', sortOrder: 4 },
    ])
    const { gate, release, waiting } = step()
    const gated: TeamOrderStore = {
      readPositions: () => shared.store.readPositions(),
      clearPosition: (id, from) => gate(() => shared.store.clearPosition(id, from)),
      setPosition: (id, position) => gate(() => shared.store.setPosition(id, position)),
    }
    const snapshot = await shared.store.readPositions()
    const a = saveTeamOrder(gated, ['b', 'a', 'c', 'd'], snapshot).catch((e: unknown) => e)
    await settle()
    expect(waiting()).toBe(1)
    // B runs in full while A waits at its first write; B's own readback
    // agrees with B, so B is told saved.
    await saveTeamOrder(shared.store, ['a', 'b', 'd', 'c'], snapshot)
    expect([...shared.state]).toEqual([
      ['a', 1],
      ['b', 2],
      ['c', 4],
      ['d', 3],
    ])
    // A's rows are untouched, so A's writes all land...
    while (waiting() > 0) {
      release()
      await settle()
    }
    const failure = await a
    // ...and A's readback refuses, naming the cause.
    expect(failure).toBeInstanceOf(TeamOrderChanged)
    expect((failure as Error).message).toContain('another admin saved at the same time')
    expect([...shared.state]).toEqual([
      ['a', 2],
      ['b', 1],
      ['c', 4],
      ['d', 3],
    ])
  })

  it('states what a save means to leave as 1..N in the order given', () => {
    expect(intendedPositions(['b', 'a'])).toEqual([
      { id: 'b', sortOrder: 1 },
      { id: 'a', sortOrder: 2 },
    ])
    expect(intendedPositions([])).toEqual([])
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
    await expect(saveTeamOrder(refused.store, ['a'])).rejects.toThrow('or the write was refused')
    expect(new TeamOrderChanged().message).toContain('The list has been refreshed')
    expect(saveFailureMessage(new TeamOrderChanged())).toMatch(/^Could not save the team order\. The club's teams changed/)
    expect(saveFailureMessage(new TeamOrderRefused('Half done.'))).toBe(
      'Could not save the team order. Half done. The status above says what is stored now; check the order and press Save team order again.',
    )
    expect(saveFailureMessage(new Error('boom'))).not.toContain('boom')
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

  it('is what the save refuses against, so the two agree', async () => {
    // A draft drawn over a, b at 1, 2; the read moved b. The screen drops
    // the draft (null here), and had it saved anyway the save would refuse.
    const expected = [pos('a', 1), pos('b', 2)]
    const read = [pos('a', 1), pos('b', 3)]
    expect(snapshotAfterRead(expected, read)).toBeNull()
    const { store } = fakeStore(read)
    await expect(saveTeamOrder(store, ['b', 'a'], expected)).rejects.toBeInstanceOf(TeamOrderChanged)
  })
})
