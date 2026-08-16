// spond_reconcile_player_team (0049_spond_team_reconcile.sql): making a
// child's CURRENT SEASON team assignment agree with Spond, and confirming the
// Spond member link in the same transaction when there is not one yet.
//
// Intended contract:
//   capability   players.manage, re checked in the body because SECURITY
//                DEFINER is not bound by RLS. A coach with players.view, a
//                parent and a member of another club are all refused with
//                42501, and none of them changes anything.
//   identity     A child with no player_spond_links row CANNOT BE MOVED, by
//                any caller, however the client asks. That is the whole rule
//                the roster import's cross team guard defers to, enforced
//                here rather than in a screen. The only way to move an
//                unlinked child is to supply the opaque member id a human
//                confirmed, which is bound in the same transaction. And a
//                proved move NAMES the member its destination was derived
//                from: "this child has some link" is not proof, because the
//                link can have been repointed since the caller read Spond,
//                which is stale_link and never a move. Exactly one of the two
//                member arguments must be supplied, so a null can never mean
//                "any link will do".
//   season       Derived server side from seasons.is_current. The caller
//                cannot name a season, so a historic or archived
//                registration is not addressable through this path at all.
//   preservation No player identity is ever created; no link is ever deleted
//                or repointed; a contested member and an already bound child
//                are named refusals, not overwrites.
//   isolation    The destination team is re validated against the caller's
//                club, and a cross club player id finds no registration.
//   concurrency  A per (club, player) then per (club, member) advisory lock,
//                a canonically ordered FOR UPDATE over the link rows, and an
//                optimistic expected-team check: a row somebody else moved is
//                refused, and a row already on the destination is an
//                idempotent no-op rather than a second event. The member key
//                lock covers the case the row locks cannot, a member with no
//                link row yet.
//
// Maps the reconciliation cells of docs/security/spond-data-boundary.md. The
// atomicity and racing proofs that need two open transactions live in
// .github/scripts/production-migration/test_0049_spond_team_reconcile.sh,
// which runs the same function against a real PostgreSQL; this file proves
// the gates against the REAL schema, policies and capabilities, which that
// stand-in cannot.
//
// Every fixture is synthetic: invented names and disposable hex ids that are
// not, and have never been, real Spond member ids.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { CLUB_A, CLUB_B, TEST_TEAM, runId, seedPlayer, serviceClient, signIn } from './stack'

const RUN = runId()
const name = (s: string) => `SEC RCN ${RUN} ${s}`
const svc = serviceClient()

// Synthetic opaque ids, uppercase hex, 32 characters like Spond's own.
const M_LINKED = '0123456789ABCDEF0123456789ABCDEF'
const M_SECOND = 'FEDCBA9876543210FEDCBA9876543210'
const M_FRESH = 'AAAABBBBCCCCDDDDEEEEFFFF00001111'
const M_SPARE = '99998888777766665555444433332222'

const OTHER_TEAM = '44444444-4444-4444-4444-4444444444fe'
const CLUB_B_TEAM = '44444444-4444-4444-4444-4444444444fd'

async function currentSeason(club: string): Promise<string> {
  const { data } = await svc.from('seasons').select('id').eq('club_id', club).eq('is_current', true).single()
  return data!.id as string
}

// A registration read out of band, so an assertion never depends on the same
// path it is checking.
async function reg(playerId: string, seasonId: string) {
  const { data } = await svc
    .from('player_registrations')
    .select('team_id, status, shirt_number')
    .eq('player_id', playerId)
    .eq('season_id', seasonId)
    .maybeSingle()
  return data
}

async function linksFor(playerId: string) {
  const { data } = await svc.from('player_spond_links').select('spond_member_id, matched_by').eq('player_id', playerId)
  return data ?? []
}

interface ReconcileRow {
  outcome: string
  player_id: string
  season_id: string
  from_team_id: string | null
  to_team_id: string | null
  linked: boolean
  link_created: boolean
}

describe('spond_reconcile_player_team: capability, identity, season, preservation, isolation', () => {
  let manager: SupabaseClient
  let admin: SupabaseClient
  let coachOne: SupabaseClient
  let parent: SupabaseClient
  let outsider: SupabaseClient
  let currentA: string
  let currentB: string
  let historicA: string
  // Club A children, all registered on TEST_TEAM this season.
  let pLinked: string // linked to M_LINKED, and has a HISTORIC registration too
  let pUnlinked: string // no link at all
  let pSecond: string // linked to M_SECOND
  let pSpare: string // no link, used for the confirm path
  let clubBPlayer: string

  beforeAll(async () => {
    manager = (await signIn('manager')).client
    admin = (await signIn('admin')).client
    coachOne = (await signIn('coachOne')).client
    parent = (await signIn('parent')).client
    outsider = (await signIn('outsider')).client
    currentA = await currentSeason(CLUB_A)
    currentB = await currentSeason(CLUB_B)

    // A second team in club A to move to, and one in club B so the cross club
    // refusal is about a real team rather than a made up uuid.
    await svc.from('teams').insert([
      { id: OTHER_TEAM, club_id: CLUB_A, name: `SEC RCN ${RUN} other` },
      { id: CLUB_B_TEAM, club_id: CLUB_B, name: `SEC RCN ${RUN} clubB` },
    ])

    // A non current season in club A, and a registration in it. Nothing this
    // function does may ever reach that row.
    const h = await svc
      .from('seasons')
      .insert({ club_id: CLUB_A, name: `H${RUN}`, starts_on: '2024-07-01', ends_on: '2025-06-30', is_current: false })
      .select('id')
      .single()
    historicA = h.data!.id as string

    pLinked = seedPlayer({ club: CLUB_A, season: currentA, display: name('linked'), teamId: TEST_TEAM, shirt: 7 }).playerId
    pUnlinked = seedPlayer({ club: CLUB_A, season: currentA, display: name('unlinked'), teamId: TEST_TEAM }).playerId
    pSecond = seedPlayer({ club: CLUB_A, season: currentA, display: name('second'), teamId: TEST_TEAM }).playerId
    pSpare = seedPlayer({ club: CLUB_A, season: currentA, display: name('spare'), teamId: TEST_TEAM }).playerId
    clubBPlayer = seedPlayer({ club: CLUB_B, season: currentB, display: name('clubB') }).playerId

    // The historic registration for the linked child, on the OTHER team, so
    // "history is untouched" has something to be wrong about.
    await svc.from('player_registrations').insert({
      club_id: CLUB_A,
      player_id: pLinked,
      season_id: historicA,
      team_id: OTHER_TEAM,
      status: 'registered',
      shirt_number: 3,
    })

    await svc.from('player_spond_links').insert([
      { club_id: CLUB_A, spond_member_id: M_LINKED, player_id: pLinked, matched_by: 'chosen' },
      { club_id: CLUB_A, spond_member_id: M_SECOND, player_id: pSecond, matched_by: 'chosen' },
    ])
  })

  afterAll(async () => {
    await svc.from('player_spond_links').delete().in('player_id', [pLinked, pUnlinked, pSecond, pSpare])
    await svc.from('players').delete().like('display_name', `SEC RCN ${RUN} %`)
    await svc.from('seasons').delete().eq('id', historicA)
    await svc.from('teams').delete().in('id', [OTHER_TEAM, CLUB_B_TEAM])
  })

  const call = (
    client: SupabaseClient,
    args: {
      player: string
      expected: string | null
      target: string | null
      // Exactly one of these. expectedMember is the proved path (the member
      // whose Spond subgroups produced the target, which must still be this
      // child's link); confirmMember is the confirm path.
      expectedMember?: string | null
      confirmMember?: string | null
      batch?: string | null
    },
  ) =>
    client.rpc('spond_reconcile_player_team', {
      p_player_id: args.player,
      p_expected_team_id: args.expected,
      p_target_team_id: args.target,
      p_expected_member_id: args.expectedMember ?? null,
      p_confirm_member_id: args.confirmMember ?? null,
      p_batch_id: args.batch ?? null,
    })

  const row = (data: unknown): ReconcileRow => (Array.isArray(data) ? data[0] : data) as ReconcileRow

  // ---- the capability gate --------------------------------------------------

  it('refuses a coach who holds players.view but not players.manage (42501)', async () => {
    const { error } = await call(coachOne, { player: pLinked, expected: TEST_TEAM, target: OTHER_TEAM, expectedMember: M_LINKED })
    expect(error).not.toBeNull()
    expect(error!.message).toContain('players.manage')
    expect((await reg(pLinked, currentA))!.team_id).toBe(TEST_TEAM)
  })

  it('refuses a parent (42501), who holds no capability at all', async () => {
    const { error } = await call(parent, { player: pLinked, expected: TEST_TEAM, target: OTHER_TEAM, expectedMember: M_LINKED })
    expect(error).not.toBeNull()
    expect((await reg(pLinked, currentA))!.team_id).toBe(TEST_TEAM)
  })

  it('refuses a member of another club, whose own club has no such player', async () => {
    const { data, error } = await call(outsider, { player: pLinked, expected: TEST_TEAM, target: OTHER_TEAM, expectedMember: M_LINKED })
    // The outsider holds players.manage in club B, so the capability gate
    // passes and the CLUB scoping is what refuses: the player id belongs to
    // another club, so there is no registration to find and nothing moves.
    if (error) {
      expect(error.message).toMatch(/players\.manage|not in your club/)
    } else {
      expect(row(data).outcome).toBe('no_registration')
    }
    expect((await reg(pLinked, currentA))!.team_id).toBe(TEST_TEAM)
  })

  // ---- the identity rule ----------------------------------------------------

  it('refuses to move an UNLINKED child, however the client asks', async () => {
    const { data, error } = await call(manager, { player: pUnlinked, expected: TEST_TEAM, target: OTHER_TEAM, expectedMember: M_FRESH })
    expect(error).toBeNull()
    expect(row(data).outcome).toBe('not_linked')
    expect((await reg(pUnlinked, currentA))!.team_id).toBe(TEST_TEAM)
    expect(await linksFor(pUnlinked)).toHaveLength(0)
  })

  it('moves a linked child, and touches nothing else about the registration', async () => {
    const batch = crypto.randomUUID()
    const { data, error } = await call(manager, {
      player: pLinked,
      expected: TEST_TEAM,
      target: OTHER_TEAM,
      expectedMember: M_LINKED,
      batch,
    })
    expect(error).toBeNull()
    expect(row(data).outcome).toBe('moved')
    expect(row(data).link_created).toBe(false)

    const after = (await reg(pLinked, currentA))!
    expect(after.team_id).toBe(OTHER_TEAM)
    expect(after.status).toBe('registered')
    expect(after.shirt_number).toBe(7)

    // The existing trigger is the record. No new action, no new source.
    const { data: events } = await svc
      .from('audit_events')
      .select('action, source, entity_id, safe_changes')
      .eq('batch_id', batch)
    expect(events).toHaveLength(1)
    expect(events![0].action).toBe('player.team_changed')
    expect(events![0].source).toBe('manual')
    expect(events![0].entity_id).toBe(pLinked)
    const safe = events![0].safe_changes as Record<string, { old?: string; new?: string }>
    expect(safe.team_id.old).toBe(TEST_TEAM)
    expect(safe.team_id.new).toBe(OTHER_TEAM)
    expect(JSON.stringify(events![0])).not.toContain(name('linked'))
  })

  it('leaves every other season alone, because the caller cannot name one', async () => {
    const historic = (await reg(pLinked, historicA))!
    expect(historic.team_id).toBe(OTHER_TEAM)
    expect(historic.shirt_number).toBe(3)
    // And there is still exactly one registration per season for that child.
    const { data } = await svc.from('player_registrations').select('season_id').eq('player_id', pLinked)
    expect(data).toHaveLength(2)
  })

  it('moves to Unassigned, which is a destination and not a refusal', async () => {
    const { data, error } = await call(manager, { player: pLinked, expected: OTHER_TEAM, target: null, expectedMember: M_LINKED })
    expect(error).toBeNull()
    expect(row(data).outcome).toBe('moved')
    const after = (await reg(pLinked, currentA))!
    expect(after.team_id).toBeNull()
    expect(after.status).toBe('registered')
  })

  it('is idempotent: pressing again finds nothing to do and writes no second event', async () => {
    const batch = crypto.randomUUID()
    const { data, error } = await call(manager, {
      player: pLinked,
      expected: OTHER_TEAM,
      target: null,
      expectedMember: M_LINKED,
      batch,
    })
    expect(error).toBeNull()
    expect(row(data).outcome).toBe('already_matched')
    const { data: events } = await svc.from('audit_events').select('id').eq('batch_id', batch)
    expect(events).toHaveLength(0)
  })

  it('refuses a row somebody else moved, rather than overwriting their decision', async () => {
    await svc.from('player_registrations').update({ team_id: TEST_TEAM }).eq('player_id', pLinked).eq('season_id', currentA)
    const { data, error } = await call(manager, { player: pLinked, expected: OTHER_TEAM, target: null, expectedMember: M_LINKED })
    expect(error).toBeNull()
    expect(row(data).outcome).toBe('stale')
    expect((await reg(pLinked, currentA))!.team_id).toBe(TEST_TEAM)
  })

  it('refuses a proved move whose link has been repointed since the caller read Spond', async () => {
    // The stale link race. The caller worked the destination out from ONE
    // member; another manager unlinks that member and correctly links the
    // child to a different one. The child still has a link and their OTJ team
    // need not have changed, so nothing but naming the member catches it.
    {
      await svc.from('player_spond_links').delete().eq('player_id', pLinked)
      await svc
        .from('player_spond_links')
        .insert({ club_id: CLUB_A, spond_member_id: M_SPARE, player_id: pLinked, matched_by: 'chosen' })

      const { data, error } = await call(manager, {
        player: pLinked,
        expected: TEST_TEAM,
        target: OTHER_TEAM,
        expectedMember: M_LINKED,
      })
      expect(error).toBeNull()
      expect(row(data).outcome).toBe('stale_link')
      expect((await reg(pLinked, currentA))!.team_id).toBe(TEST_TEAM)
      // And the link the other manager made is untouched.
      const links = await linksFor(pLinked)
      expect(links).toHaveLength(1)
      expect(links[0].spond_member_id).toBe(M_SPARE)

      // Naming the member they ARE linked to still works, so the check
      // refuses a stale identity rather than refusing everything.
      const ok = await call(manager, {
        player: pLinked,
        expected: TEST_TEAM,
        target: OTHER_TEAM,
        expectedMember: M_SPARE,
      })
      expect(ok.error).toBeNull()
      expect(row(ok.data).outcome).toBe('moved')

      // Put the fixture back the way the later tests expect it.
      await svc.from('player_registrations').update({ team_id: TEST_TEAM }).eq('player_id', pLinked).eq('season_id', currentA)
      await svc.from('player_spond_links').delete().eq('player_id', pLinked)
      await svc
        .from('player_spond_links')
        .insert({ club_id: CLUB_A, spond_member_id: M_LINKED, player_id: pLinked, matched_by: 'chosen' })
    }
  })

  it('refuses a call that names neither member or both, so a null never means any link', async () => {
    const neither = await manager.rpc('spond_reconcile_player_team', {
      p_player_id: pLinked,
      p_expected_team_id: TEST_TEAM,
      p_target_team_id: OTHER_TEAM,
      p_expected_member_id: null,
      p_confirm_member_id: null,
      p_batch_id: null,
    })
    expect(neither.error).not.toBeNull()
    expect(neither.error!.message).toContain('exactly one')

    const both = await manager.rpc('spond_reconcile_player_team', {
      p_player_id: pLinked,
      p_expected_team_id: TEST_TEAM,
      p_target_team_id: OTHER_TEAM,
      p_expected_member_id: M_LINKED,
      p_confirm_member_id: M_LINKED,
      p_batch_id: null,
    })
    expect(both.error).not.toBeNull()
    expect((await reg(pLinked, currentA))!.team_id).toBe(TEST_TEAM)
  })

  // ---- the confirm path -----------------------------------------------------

  it('binds the confirmed member and moves the child in one transaction', async () => {
    const batch = crypto.randomUUID()
    const { data, error } = await call(manager, {
      player: pSpare,
      expected: TEST_TEAM,
      target: OTHER_TEAM,
      confirmMember: M_FRESH,
      batch,
    })
    expect(error).toBeNull()
    expect(row(data).outcome).toBe('moved')
    expect(row(data).link_created).toBe(true)

    const links = await linksFor(pSpare)
    expect(links).toHaveLength(1)
    expect(links[0].spond_member_id).toBe(M_FRESH)
    // 'suggested' means a manager accepted a name suggestion computed in the
    // browser, which is exactly what a confirmation is. There is no 'auto'.
    expect(links[0].matched_by).toBe('suggested')
    expect((await reg(pSpare, currentA))!.team_id).toBe(OTHER_TEAM)

    // One press, one batch, both halves in it.
    const { data: events } = await svc.from('audit_events').select('action').eq('batch_id', batch)
    expect((events ?? []).map((e) => e.action).sort()).toEqual(['player.spond_linked', 'player.team_changed'])
  })

  it('never repoints a link: a member already bound to another child is refused', async () => {
    const before = await linksFor(pSecond)
    const { data, error } = await call(manager, {
      player: pUnlinked,
      expected: TEST_TEAM,
      target: OTHER_TEAM,
      confirmMember: M_SECOND,
    })
    expect(error).toBeNull()
    expect(row(data).outcome).toBe('member_linked_elsewhere')
    expect((await reg(pUnlinked, currentA))!.team_id).toBe(TEST_TEAM)
    expect(await linksFor(pSecond)).toEqual(before)
    expect(await linksFor(pUnlinked)).toHaveLength(0)
  })

  it('never repoints a link the other way either: a bound child keeps its member', async () => {
    const { data, error } = await call(manager, {
      player: pSecond,
      expected: TEST_TEAM,
      target: OTHER_TEAM,
      confirmMember: M_SPARE,
    })
    expect(error).toBeNull()
    expect(row(data).outcome).toBe('player_linked_elsewhere')
    const links = await linksFor(pSecond)
    expect(links).toHaveLength(1)
    expect(links[0].spond_member_id).toBe(M_SECOND)
    expect((await reg(pSecond, currentA))!.team_id).toBe(TEST_TEAM)
    // And the member it refused to use stayed free.
    const { data: spare } = await svc.from('player_spond_links').select('player_id').eq('spond_member_id', M_SPARE)
    expect(spare).toHaveLength(0)
  })

  // ---- what cannot be passed in at all --------------------------------------

  it('refuses a destination team in another club', async () => {
    const { error } = await call(manager, { player: pSecond, expected: TEST_TEAM, target: CLUB_B_TEAM, expectedMember: M_SECOND })
    expect(error).not.toBeNull()
    expect(error!.message).toContain('not in your club')
    expect((await reg(pSecond, currentA))!.team_id).toBe(TEST_TEAM)
  })

  it('refuses anything that is not an opaque member id, so no name can be passed', async () => {
    for (const bad of ['Jack Thompson', 'parent@example.invalid', '+447700900000', 'ABCDEF', '']) {
      const { error } = await call(manager, {
        player: pUnlinked,
        expected: TEST_TEAM,
        target: OTHER_TEAM,
        confirmMember: bad,
      })
      expect(error, `the member id vocabulary accepted ${JSON.stringify(bad)}`).not.toBeNull()
    }
    expect(await linksFor(pUnlinked)).toHaveLength(0)
    expect((await reg(pUnlinked, currentA))!.team_id).toBe(TEST_TEAM)
  })

  it('never creates a player identity: an unregistered id is refused, not invented', async () => {
    const invented = '00000000-0000-4000-8000-0000000000ff'
    const { data, error } = await call(manager, { player: invented, expected: null, target: OTHER_TEAM, expectedMember: M_LINKED })
    expect(error).toBeNull()
    expect(row(data).outcome).toBe('no_registration')
    const { data: made } = await svc.from('players').select('id').eq('id', invented)
    expect(made).toHaveLength(0)
  })

  it('finds no registration for a player in another club, so a forged id moves nobody', async () => {
    const { data, error } = await call(manager, { player: clubBPlayer, expected: null, target: OTHER_TEAM, expectedMember: M_LINKED })
    expect(error).toBeNull()
    expect(row(data).outcome).toBe('no_registration')
    expect((await reg(clubBPlayer, currentB))!.team_id).toBeNull()
  })

  // ---- an admin holds the same capability -----------------------------------

  it('an admin may reconcile too, because the gate is the capability and not the role', async () => {
    const { data, error } = await call(admin, { player: pSecond, expected: TEST_TEAM, target: OTHER_TEAM, expectedMember: M_SECOND })
    expect(error).toBeNull()
    expect(row(data).outcome).toBe('moved')
    expect((await reg(pSecond, currentA))!.team_id).toBe(OTHER_TEAM)
  })

  // ---- the surface itself ---------------------------------------------------

  it('anon cannot execute the function at all', async () => {
    const { anonClient } = await import('./stack')
    const { error } = await anonClient().rpc('spond_reconcile_player_team', {
      p_player_id: pLinked,
      p_expected_team_id: TEST_TEAM,
      p_target_team_id: OTHER_TEAM,
      p_expected_member_id: M_LINKED,
      p_confirm_member_id: null,
      p_batch_id: null,
    })
    expect(error).not.toBeNull()
  })

  it('added no update path to the links table, which is what makes a link immutable', async () => {
    const { error } = await manager
      .from('player_spond_links')
      .update({ matched_by: 'chosen' })
      .eq('spond_member_id', M_FRESH)
    // No update grant and no update policy: the write cannot land. Either a
    // refusal or a zero row result is acceptable; what is not is a changed row.
    if (!error) {
      const links = await linksFor(pSpare)
      expect(links[0].matched_by).toBe('suggested')
    }
  })
})
