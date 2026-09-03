// public.set_team_order (0052_atomic_team_order.sql): writing the club's
// COMPLETE team order in one atomic, serialized transaction.
//
// WHY THE FUNCTION EXISTS. COACH-1B (#225) saves the order from the browser
// as separate PostgREST statements, each conditioned on the value the screen
// last read. Two admins who move DISJOINT rows never collide: one swaps
// positions 1 and 2 while the other swaps 3 and 4, every per row compare and
// set passes, both commit, and the club is left with a complete valid order
// NEITHER submitted. teams_sort_order_unique cannot object, because the merge
// is a permutation like any other. This function replaces that with one
// transaction that either stores the whole submitted order or stores nothing.
//
// Intended contract:
//   capability   teams.manage, re checked in the function body because
//                SECURITY DEFINER is not bound by RLS. A coach without it, a
//                parent and a member of another club are refused with 42501
//                and change nothing. anon cannot execute it at all: the grant,
//                not the body, is what stops them.
//   club         Derived server side from public.my_club(). The caller cannot
//                name a club, every id must belong to theirs, and a foreign
//                id is refused without being echoed back.
//   completeness The request must name the club's CURRENT team set exactly.
//                A missing id, an extra id, a duplicate and a null are each
//                refused with P0001 before anything is written.
//   snapshot     Every stored position must still equal the expected value
//                supplied for that same team, with null a valid expected
//                value. One difference refuses the WHOLE order with SQLSTATE
//                40001 and writes nothing. This is the check that makes the
//                disjoint merge unreachable.
//   atomicity    The whole order commits or nothing does. A refused call
//                leaves every position exactly where it was, so no partial
//                order is reachable through this path.
//   audit        The existing audit_teams() trigger is the only record. A
//                moved, already placed team writes two team.updated events
//                (the clear and the placement), an unplaced one writes one,
//                an unmoved one writes none, and none carries a value.
//
// WHAT THIS FILE CANNOT PROVE, and where that proof lives. Serialization
// needs two connections contending on the same lock, and vitest holds one
// session per client. The two session proof, including the disjoint race run
// both ways round, is in
// .github/scripts/production-migration/test_0052_atomic_team_order.sh, which
// runs the same function against a real PostgreSQL. THIS file proves the
// gates against the REAL schema, policies, capabilities and grants, which
// that stand-in cannot.
//
// Every fixture is synthetic: invented names, disposable ids, and no club
// team name anywhere in this file.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { CLUB_A, CLUB_B, anonClient, runId, serviceClient, signIn } from './stack'

const RUN = runId()
const prefix = `SEC TEST setorder ${RUN}`

interface TeamRow {
  id: string
  sort_order: number | null
}

interface PgFailure {
  code?: string
  message?: string
}

// The club's teams as they stand, which is what a complete order has to
// name. Read fresh rather than remembered: this file's own teams are not the
// only ones in the club, and the contract is about the club's CURRENT set.
async function clubTeams(clubId: string): Promise<TeamRow[]> {
  const { data, error } = await serviceClient()
    .from('teams')
    .select('id, sort_order')
    .eq('club_id', clubId)
    .order('id')
  if (error) throw new Error(`could not read the club's teams: ${error.message}`)
  return data as TeamRow[]
}

async function positionsOf(clubId: string): Promise<Map<string, number | null>> {
  return new Map((await clubTeams(clubId)).map((t) => [t.id, t.sort_order]))
}

// One call, returning the error rather than throwing, so each test can say
// which refusal it expected.
async function callSetOrder(
  client: SupabaseClient,
  ids: (string | null)[],
  expected: (number | null)[],
): Promise<{ data: unknown; error: PgFailure | null }> {
  const { data, error } = await client.rpc('set_team_order', {
    p_team_ids: ids,
    p_expected_sort_orders: expected,
  })
  return { data, error: error as PgFailure | null }
}

describe('set_team_order (0052): the club order is written whole or not at all', () => {
  let admin: SupabaseClient
  let coachOne: SupabaseClient
  let parent: SupabaseClient
  let outsider: SupabaseClient
  let seeded: string[] = []
  let otherClubTeam: string

  beforeAll(async () => {
    const service = serviceClient()
    admin = (await signIn('admin')).client
    coachOne = (await signIn('coachOne')).client
    parent = (await signIn('parent')).client
    outsider = (await signIn('outsider')).client

    const { data, error } = await service
      .from('teams')
      .insert([
        { club_id: CLUB_A, name: `${prefix} one` },
        { club_id: CLUB_A, name: `${prefix} two` },
        { club_id: CLUB_A, name: `${prefix} three` },
        { club_id: CLUB_B, name: `${prefix} other club` },
      ])
      .select('id, name, club_id')
    if (error) throw new Error(`could not seed the order teams: ${error.message}`)
    const rows = data as { id: string; name: string; club_id: string }[]
    seeded = rows.filter((r) => r.club_id === CLUB_A).map((r) => r.id)
    otherClubTeam = rows.find((r) => r.club_id === CLUB_B)!.id
  })

  afterAll(async () => {
    const service = serviceClient()
    // Give the club back the ordering state it had: this file is the only
    // one that positions CLUB_A's teams, and leaving positions behind would
    // change what a later run of team-order.test.ts reads.
    await service.from('teams').update({ sort_order: null }).eq('club_id', CLUB_A)
    await service.from('teams').delete().like('name', `${prefix}%`)
    await service.from('audit_events').delete().in('entity_id', [...seeded, otherClubTeam])
  })

  // --- The capability gate, re checked in the body ---------------------

  // The outsider is a coach of club B and holds no teams.manage anywhere, so
  // the gate that refuses them here is the CAPABILITY one, reached before the
  // club is ever compared. That is the honest reading of this assertion. No
  // fixture holds teams.manage in a second club, which is the same gap
  // team-order.test.ts records, so a holder of the capability reaching across
  // clubs is proved in the harness instead, where the roles are synthetic:
  // .github/scripts/production-migration/test_0052_atomic_team_order.sh.
  it('a coach without teams.manage, a parent and a member of another club are refused, and change nothing', async () => {
    const before = await positionsOf(CLUB_A)
    const ids = [...before.keys()]
    const expected = ids.map((id) => before.get(id) ?? null)

    for (const [who, client] of [
      ['a coach without teams.manage', coachOne],
      ['a parent', parent],
      ['a member of another club', outsider],
    ] as const) {
      const { error } = await callSetOrder(client, ids, expected)
      expect(error, `${who} was not refused`).not.toBeNull()
      expect(error!.code, `${who} was refused with the wrong code`).toBe('42501')
    }

    const after = await positionsOf(CLUB_A)
    expect([...after.entries()].sort()).toEqual([...before.entries()].sort())
  })

  it('an unauthenticated caller cannot execute it at all', async () => {
    const before = await positionsOf(CLUB_A)
    const { error } = await callSetOrder(anonClient(), [...before.keys()], [...before.values()])
    expect(error).not.toBeNull()
    // The grant is what stops anon, not the body: revoked from public and
    // anon, granted to authenticated only.
    expect(error!.code).toBe('42501')
    const after = await positionsOf(CLUB_A)
    expect([...after.entries()].sort()).toEqual([...before.entries()].sort())
  })

  // --- The complete set ------------------------------------------------

  it('a teams.manage holder writes the whole order, and it lands as 1..N', async () => {
    const before = await clubTeams(CLUB_A)
    const ids = before.map((t) => t.id)
    const expected = before.map((t) => t.sort_order)

    const { data, error } = await callSetOrder(admin, ids, expected)
    expect(error).toBeNull()
    expect((data as { changed: number }).changed).toBeGreaterThan(0)

    const after = await positionsOf(CLUB_A)
    ids.forEach((id, i) => expect(after.get(id)).toBe(i + 1))
  })

  it('an order that changes nothing writes no row', async () => {
    const current = await clubTeams(CLUB_A)
    const ordered = [...current].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    const { data, error } = await callSetOrder(
      admin,
      ordered.map((t) => t.id),
      ordered.map((t) => t.sort_order),
    )
    expect(error).toBeNull()
    expect((data as { changed: number }).changed).toBe(0)
  })

  it('a missing team, an extra id, a duplicate and a null are each refused before any write', async () => {
    const current = await clubTeams(CLUB_A)
    const ids = current.map((t) => t.id)
    const expected = current.map((t) => t.sort_order)
    const before = await positionsOf(CLUB_A)

    const cases: [string, (string | null)[], (number | null)[]][] = [
      ['a missing team', ids.slice(1), expected.slice(1)],
      ['a duplicate id', [ids[0], ...ids], [expected[0] ?? null, ...expected]],
      ['a null id', [null, ...ids.slice(1)], expected],
      ['mismatched lengths', ids, expected.slice(1)],
    ]
    for (const [label, callIds, callExpected] of cases) {
      const { error } = await callSetOrder(admin, callIds, callExpected)
      expect(error, `${label} was not refused`).not.toBeNull()
      expect(error!.code, `${label} was refused with the wrong code`).toBe('P0001')
    }

    const after = await positionsOf(CLUB_A)
    expect([...after.entries()].sort()).toEqual([...before.entries()].sort())
  })

  // --- Club isolation ---------------------------------------------------

  it("another club's team is refused, without the id reaching the message, and stays untouched", async () => {
    const current = await clubTeams(CLUB_A)
    const before = await positionsOf(CLUB_A)
    const otherBefore = await positionsOf(CLUB_B)

    // The set is kept the right SIZE so the completeness count passes and the
    // club check is what refuses: that is the path that could otherwise leak.
    const ids = [...current.slice(0, current.length - 1).map((t) => t.id), otherClubTeam]
    const expected = current.map((t) => t.sort_order)

    const { error } = await callSetOrder(admin, ids, expected)
    expect(error).not.toBeNull()
    expect(error!.code).toBe('P0001')
    expect(error!.message ?? '').toContain('not in your club')
    expect(error!.message ?? '').not.toContain(otherClubTeam)

    expect([...(await positionsOf(CLUB_A)).entries()].sort()).toEqual([...before.entries()].sort())
    expect([...(await positionsOf(CLUB_B)).entries()].sort()).toEqual([...otherBefore.entries()].sort())
  })

  // --- The expected snapshot, which is the whole point ------------------

  it('a stale expected position refuses the WHOLE order with 40001 and writes nothing', async () => {
    const current = await clubTeams(CLUB_A)
    const ordered = [...current].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    const before = await positionsOf(CLUB_A)

    // Swap the first two, but claim the LAST team is somewhere it is not.
    // That team is not one this order moves, which is exactly the disjoint
    // case: #225's per row compare and set would never look at it.
    const ids = [ordered[1].id, ordered[0].id, ...ordered.slice(2).map((t) => t.id)]
    const expected = [
      ordered[1].sort_order,
      ordered[0].sort_order,
      ...ordered.slice(2, -1).map((t) => t.sort_order),
      9999,
    ]

    const { error } = await callSetOrder(admin, ids, expected)
    expect(error).not.toBeNull()
    expect(error!.code).toBe('40001')

    const after = await positionsOf(CLUB_A)
    expect([...after.entries()].sort()).toEqual([...before.entries()].sort())
  })

  it('the same order saved against a fresh snapshot lands whole', async () => {
    const current = await clubTeams(CLUB_A)
    const ordered = [...current].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    const ids = [ordered[1].id, ordered[0].id, ...ordered.slice(2).map((t) => t.id)]
    const expected = [
      ordered[1].sort_order,
      ordered[0].sort_order,
      ...ordered.slice(2).map((t) => t.sort_order),
    ]

    const { error } = await callSetOrder(admin, ids, expected)
    expect(error).toBeNull()

    const after = await positionsOf(CLUB_A)
    ids.forEach((id, i) => expect(after.get(id)).toBe(i + 1))
  })

  it('an unset club normalises to 1..N, with null a valid expected value', async () => {
    const service = serviceClient()
    await service.from('teams').update({ sort_order: null }).eq('club_id', CLUB_A)

    const current = await clubTeams(CLUB_A)
    const ids = current.map((t) => t.id)
    const { error } = await callSetOrder(admin, ids, ids.map(() => null))
    expect(error).toBeNull()

    const after = await positionsOf(CLUB_A)
    ids.forEach((id, i) => expect(after.get(id)).toBe(i + 1))
  })

  // --- Audit -------------------------------------------------------------

  it('the trail is team.updated naming sort_order, with no value anywhere', async () => {
    const service = serviceClient()
    const current = await clubTeams(CLUB_A)
    const ordered = [...current].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    await service.from('audit_events').delete().in('entity_id', seeded)

    // Swap two teams THIS FILE owns, wherever they sit, because the read below
    // is filtered to this file's teams. Moving whichever two happened to hold
    // positions 1 and 2 would return no events at all when those belonged to
    // the seed, and a loop over an empty array asserts nothing.
    const owned = seeded
      .map((id) => ordered.findIndex((t) => t.id === id))
      .filter((i) => i >= 0)
      .sort((a, b) => a - b)
    expect(owned.length, 'this file seeds at least two teams of its own').toBeGreaterThanOrEqual(2)
    const swapped = [...ordered]
    const [first, second] = owned
    ;[swapped[first], swapped[second]] = [swapped[second], swapped[first]]

    const ids = swapped.map((t) => t.id)
    // Each slot carries the position ITS OWN team currently holds, which is
    // what the function compares against. Not the position it is moving to.
    const expected = swapped.map((t) => t.sort_order)
    const { error } = await callSetOrder(admin, ids, expected)
    expect(error).toBeNull()

    const { data, error: readError } = await service
      .from('audit_events')
      .select('action, changed_fields, safe_changes, metadata')
      .in('entity_id', seeded)
    expect(readError).toBeNull()
    const events = (data ?? []) as {
      action: string
      changed_fields: string[] | null
      safe_changes: unknown
      metadata: unknown
    }[]

    // Two moved teams, each already placed, each written twice inside the one
    // transaction (cleared, then placed), so four events. That doubling is the
    // documented cost of clear-then-place under teams_sort_order_unique, and
    // it is asserted rather than glossed: an assertion that only inspects
    // whatever turned up would pass on zero events.
    expect(events.length).toBe(4)
    for (const e of events) {
      expect(e.action).toBe('team.updated')
      expect(e.changed_fields).toEqual(['sort_order'])
      // The ordering is a position, never a value about a person or a team.
      expect(e.safe_changes).toBeNull()
      expect(e.metadata).toBeNull()
    }
  })
})
