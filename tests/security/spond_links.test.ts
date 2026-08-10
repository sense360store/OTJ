// The Spond linking surfaces added by 0045: player_spond_links and
// spond_event_responses.
//
// Intended contract:
//   player_spond_links     select requires players.view, exactly like the
//                          roster it resolves against, so a parent and a
//                          coach without players.view read nothing.
//                          Insert and delete require players.manage
//                          (admin and manager), NOT sessions.create: a
//                          link binds an opaque Spond id to a named
//                          child, which is a roster identity write.
//                          There is no update path at all.
//   spond_event_responses  select requires players.view. Insert, update
//                          and delete require sessions.create, the
//                          capability spond-sync runs under. A row for
//                          an UNLINKED member is unrepresentable, and
//                          unlinking drains every stored row for that
//                          member.
//
// The privacy assertions here are the point of the file: the member id
// column refuses anything that could be a name, no Spond name reaches
// either table, and the audit trail records the fact without the id.
//
// Every fixture is synthetic: invented names and disposable hex ids that
// are not, and have never been, real Spond member ids.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  CLUB_A,
  CLUB_B,
  TEST_TEAM,
  expectCheckConstraintRefusal,
  expectRlsInsertRefusal,
  runId,
  runSqlInContainer,
  seedPlayer,
  serviceClient,
  signIn,
} from './stack'

const RUN = runId()
const playerPrefix = `SEC TEST spond player ${RUN}`
const eventPrefix = `SEC TEST spond event ${RUN}`

// Synthetic opaque ids, uppercase hex, 32 characters like Spond's own.
const MEMBER_ONE = '0123456789ABCDEF0123456789ABCDEF'
const MEMBER_TWO = 'FEDCBA9876543210FEDCBA9876543210'
const MEMBER_THREE = 'AAAABBBBCCCCDDDDEEEEFFFF00001111'

describe('spond member links and event responses', () => {
  let admin: SupabaseClient
  let manager: SupabaseClient
  let coachOne: SupabaseClient
  let parent: SupabaseClient
  let outsider: SupabaseClient
  let playerOne: string
  let playerTwo: string
  let playerThree: string
  let eventId: string

  beforeAll(async () => {
    const service = serviceClient()
    admin = (await signIn('admin')).client
    manager = (await signIn('manager')).client
    coachOne = (await signIn('coachOne')).client
    parent = (await signIn('parent')).client
    outsider = (await signIn('outsider')).client

    const { data: season } = await service
      .from('seasons')
      .select('id')
      .eq('club_id', CLUB_A)
      .eq('is_current', true)
      .single()
    const seasonA = season!.id as string

    playerOne = seedPlayer({ club: CLUB_A, season: seasonA, display: `${playerPrefix} one`, teamId: TEST_TEAM }).playerId
    playerTwo = seedPlayer({ club: CLUB_A, season: seasonA, display: `${playerPrefix} two`, teamId: TEST_TEAM }).playerId
    playerThree = seedPlayer({
      club: CLUB_A,
      season: seasonA,
      display: `${playerPrefix} three`,
      teamId: TEST_TEAM,
    }).playerId

    const { data: event, error: eventErr } = await service
      .from('spond_events')
      .insert({
        club_id: CLUB_A,
        spond_event_id: `${RUN}EVENT`,
        title: `${eventPrefix} training`,
        starts_at: new Date().toISOString(),
        synced_at: new Date().toISOString(),
      })
      .select('id')
      .single()
    if (eventErr) throw new Error(`could not seed the test Spond event: ${eventErr.message}`)
    eventId = event!.id
  })

  afterAll(async () => {
    const service = serviceClient()
    // The links cascade their responses; the players cascade their links.
    await service.from('spond_event_responses').delete().eq('spond_event_id', eventId)
    await service.from('player_spond_links').delete().in('player_id', [playerOne, playerTwo, playerThree])
    await service.from('spond_events').delete().eq('id', eventId)
    await service.from('players').delete().in('id', [playerOne, playerTwo, playerThree])
  })

  // ---- the read gate ------------------------------------------------

  it('a manager can link a player and read the link back', async () => {
    const { error } = await manager
      .from('player_spond_links')
      .insert({ club_id: CLUB_A, spond_member_id: MEMBER_ONE, player_id: playerOne, matched_by: 'chosen' })
    expect(error).toBeNull()

    const { data, error: readErr } = await manager
      .from('player_spond_links')
      .select('spond_member_id, player_id, matched_by, created_by')
      .eq('player_id', playerOne)
    expect(readErr).toBeNull()
    expect(data).toHaveLength(1)
    expect(data![0].matched_by).toBe('chosen')
  })

  it('created_by is stamped by the database, not by the caller', async () => {
    const { data: me } = await manager.auth.getUser()
    const { data } = await manager
      .from('player_spond_links')
      .select('created_by')
      .eq('player_id', playerOne)
      .single()
    expect(data!.created_by).toBe(me.user!.id)

    // A forged created_by is overwritten rather than stored.
    await manager.from('player_spond_links').delete().eq('player_id', playerTwo)
    const { error } = await manager.from('player_spond_links').insert({
      club_id: CLUB_A,
      spond_member_id: MEMBER_TWO,
      player_id: playerTwo,
      matched_by: 'suggested',
      created_by: '00000000-0000-0000-0000-0000000000ff',
    })
    expect(error).toBeNull()
    const { data: forged } = await manager
      .from('player_spond_links')
      .select('created_by')
      .eq('player_id', playerTwo)
      .single()
    expect(forged!.created_by).toBe(me.user!.id)
  })

  it('a coach and an admin read links: the gate is players.view, not the write capability', async () => {
    for (const [who, client] of [['coach', coachOne], ['admin', admin]] as const) {
      const { data, error } = await client.from('player_spond_links').select('player_id').eq('player_id', playerOne)
      expect(error, `${who} should read links`).toBeNull()
      expect(data, `${who} should see the seeded link`).toHaveLength(1)
    }
  })

  it('a parent reads no link and no response', async () => {
    const links = await parent.from('player_spond_links').select('spond_member_id')
    expect(links.error).toBeNull()
    expect(links.data).toHaveLength(0)

    const responses = await parent.from('spond_event_responses').select('spond_member_id')
    expect(responses.error).toBeNull()
    expect(responses.data).toHaveLength(0)
  })

  it('another club reads nothing here', async () => {
    const { data, error } = await outsider.from('player_spond_links').select('spond_member_id')
    expect(error).toBeNull()
    expect(data).toHaveLength(0)
  })

  // ---- the write gate -----------------------------------------------

  it('a coach may not link a player: linking is a roster identity write', async () => {
    const { error } = await coachOne
      .from('player_spond_links')
      .insert({ club_id: CLUB_A, spond_member_id: MEMBER_THREE, player_id: playerThree, matched_by: 'chosen' })
    expectRlsInsertRefusal(error)
  })

  it('a coach may not unlink a player either', async () => {
    const { error } = await coachOne.from('player_spond_links').delete().eq('player_id', playerOne)
    expect(error).toBeNull() // delete under RLS filters rather than raising
    const { data } = await manager.from('player_spond_links').select('player_id').eq('player_id', playerOne)
    expect(data, 'the coach delete must have matched no row').toHaveLength(1)
  })

  it('a parent may not link anyone', async () => {
    const { error } = await parent
      .from('player_spond_links')
      .insert({ club_id: CLUB_A, spond_member_id: MEMBER_THREE, player_id: playerThree, matched_by: 'chosen' })
    expectRlsInsertRefusal(error)
  })

  it('a link cannot be updated by anyone: there is no update path', async () => {
    const grants = runSqlInContainer(
      `select coalesce(string_agg(privilege_type, ','), 'none')
         from information_schema.role_table_grants
        where table_schema = 'public' and table_name = 'player_spond_links'
          and grantee = 'authenticated';`,
    ).trim()
    expect(grants.split(',').sort().join(',')).toBe('DELETE,INSERT,SELECT')

    const policies = runSqlInContainer(
      `select coalesce(string_agg(cmd, ',' order by cmd), 'none') from pg_policies
        where schemaname = 'public' and tablename = 'player_spond_links';`,
    ).trim()
    expect(policies).toBe('DELETE,INSERT,SELECT')
  })

  it('grants anon nothing on either new table', async () => {
    const rows = runSqlInContainer(
      `select coalesce(string_agg(distinct table_name || ':' || privilege_type, ','), 'none')
         from information_schema.role_table_grants
        where table_schema = 'public'
          and table_name in ('player_spond_links','spond_event_responses')
          and grantee = 'anon';`,
    ).trim()
    expect(rows).toBe('none')
  })

  // ---- the data boundary --------------------------------------------

  it('the member id column refuses anything that could be a person', async () => {
    const service = serviceClient()
    // Refused for the service role too: this is a check constraint, below RLS.
    for (const value of ['Jack Thompson', 'jack.thompson', 'parent@example.invalid', '+447700900000', 'Jack_Thompson']) {
      const { error } = await service
        .from('player_spond_links')
        .insert({ club_id: CLUB_A, spond_member_id: value, player_id: playerThree, matched_by: 'chosen' })
      expectCheckConstraintRefusal(error, 'player_spond_links_spond_member_id_check')
    }
  })

  it('neither table has a column that could hold a name or a payload', async () => {
    const cols = runSqlInContainer(
      `select table_name || ':' || string_agg(column_name || '=' || data_type, ',' order by column_name)
         from information_schema.columns
        where table_schema = 'public'
          and table_name in ('player_spond_links','spond_event_responses')
        group by table_name order by table_name;`,
    ).trim()
    expect(cols).toBe(
      [
        'player_spond_links:club_id=uuid,created_at=timestamp with time zone,created_by=uuid,' +
          'matched_by=text,player_id=uuid,spond_member_id=text',
        'spond_event_responses:club_id=uuid,spond_event_id=uuid,spond_member_id=text,' +
          'status=text,synced_at=timestamp with time zone',
      ].join('\n'),
    )
    // And no free shaped column anywhere: a jsonb or an array would be the
    // escape hatch through which a payload could arrive.
    const loose = runSqlInContainer(
      `select coalesce(string_agg(table_name || '.' || column_name, ','), 'none')
         from information_schema.columns
        where table_schema = 'public'
          and table_name in ('player_spond_links','spond_event_responses')
          and (data_type in ('jsonb','json') or data_type = 'ARRAY');`,
    ).trim()
    expect(loose).toBe('none')
  })

  it('the status vocabulary is closed to Spond four reply states', async () => {
    const service = serviceClient()
    const { error } = await service.from('spond_event_responses').insert({
      club_id: CLUB_A,
      spond_event_id: eventId,
      spond_member_id: MEMBER_ONE,
      status: 'unconfirmed',
      synced_at: new Date().toISOString(),
    })
    expectCheckConstraintRefusal(error, 'spond_event_responses_status_check')
  })

  // ---- the invariant and the drain ----------------------------------

  it('a response for an unlinked member is unrepresentable', async () => {
    const service = serviceClient()
    const { error } = await service.from('spond_event_responses').insert({
      club_id: CLUB_A,
      spond_event_id: eventId,
      spond_member_id: MEMBER_THREE, // nobody linked this one
      status: 'accepted',
      synced_at: new Date().toISOString(),
    })
    expect(error?.code, 'a foreign key, not a policy, must refuse this').toBe('23503')
  })

  it('unlinking a player drains every stored response for that member', async () => {
    const service = serviceClient()
    const { error: writeErr } = await service.from('spond_event_responses').insert({
      club_id: CLUB_A,
      spond_event_id: eventId,
      spond_member_id: MEMBER_TWO,
      status: 'declined',
      synced_at: new Date().toISOString(),
    })
    expect(writeErr).toBeNull()

    const before = await service.from('spond_event_responses').select('spond_member_id').eq('spond_member_id', MEMBER_TWO)
    expect(before.data).toHaveLength(1)

    const { error: unlinkErr } = await manager.from('player_spond_links').delete().eq('player_id', playerTwo)
    expect(unlinkErr).toBeNull()

    const after = await service.from('spond_event_responses').select('spond_member_id').eq('spond_member_id', MEMBER_TWO)
    expect(after.data, 'the unlink must have drained the stored responses').toHaveLength(0)
  })

  it('erasing a child removes the link and its responses in one step', async () => {
    const service = serviceClient()
    await service
      .from('player_spond_links')
      .insert({ club_id: CLUB_A, spond_member_id: MEMBER_TWO, player_id: playerTwo, matched_by: 'chosen' })
    await service.from('spond_event_responses').insert({
      club_id: CLUB_A,
      spond_event_id: eventId,
      spond_member_id: MEMBER_TWO,
      status: 'accepted',
      synced_at: new Date().toISOString(),
    })

    const { error } = await service.from('players').delete().eq('id', playerTwo)
    expect(error).toBeNull()

    const links = await service.from('player_spond_links').select('player_id').eq('player_id', playerTwo)
    expect(links.data).toHaveLength(0)
    const responses = await service.from('spond_event_responses').select('spond_member_id').eq('spond_member_id', MEMBER_TWO)
    expect(responses.data).toHaveLength(0)
  })

  it('a cross club link is refused by the composite reference', async () => {
    const service = serviceClient()
    const { error } = await service
      .from('player_spond_links')
      .insert({ club_id: CLUB_B, spond_member_id: MEMBER_THREE, player_id: playerThree, matched_by: 'chosen' })
    expect(error?.code).toBe('23503')
  })

  it('one child carries at most one Spond member, and one member at most one child', async () => {
    const service = serviceClient()
    const second = await service
      .from('player_spond_links')
      .insert({ club_id: CLUB_A, spond_member_id: MEMBER_THREE, player_id: playerOne, matched_by: 'chosen' })
    expect(second.error?.code).toBe('23505')

    const shared = await service
      .from('player_spond_links')
      .insert({ club_id: CLUB_A, spond_member_id: MEMBER_ONE, player_id: playerThree, matched_by: 'chosen' })
    expect(shared.error?.code).toBe('23505')
  })

  // ---- the audit trail ----------------------------------------------

  it('the trail records the link and the unlink, and carries no member id', async () => {
    const trail = runSqlInContainer(
      `select coalesce(string_agg(distinct action, ',' order by action), 'none')
         from public.audit_events
        where club_id = '${CLUB_A}'
          and entity_type = 'player'
          and entity_id in ('${playerOne}','${playerTwo}')
          and action like 'player.spond%';`,
    ).trim()
    expect(trail).toBe('player.spond_linked,player.spond_unlinked')

    // No audit row, in any column, holds any of the synthetic member ids.
    const leaked = runSqlInContainer(
      `select count(*) from public.audit_events e
        where e::text like '%${MEMBER_ONE}%'
           or e::text like '%${MEMBER_TWO}%'
           or e::text like '%${MEMBER_THREE}%';`,
    ).trim()
    expect(leaked).toBe('0')
  })

  it('erasing a child emits no separate unlink event: player.deleted is the record', async () => {
    const events = runSqlInContainer(
      `select count(*) from public.audit_events
        where entity_id = '${playerTwo}' and action = 'player.spond_unlinked';`,
    ).trim()
    // playerTwo was unlinked once by a manager, then relinked and erased.
    // The erase must not have added a second unlink event.
    expect(events).toBe('1')
  })
})
