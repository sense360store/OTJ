// The bulk permanent deletion path added by 0050: preview_delete_players and
// delete_players (roadmap PLAYERS-01).
//
// Intended contract:
//   preview_delete_players  read only. Requires players.delete, the capability
//                           that would run the deletion, not merely
//                           players.view: what a deletion would cost is a
//                           shape of a child's record. Club scoped, so a cross
//                           club id contributes nothing. Writes and audits
//                           nothing.
//   delete_players          requires players.delete and the caller's own club,
//                           re checked in the SECURITY DEFINER body. Folds
//                           duplicate ids. Refuses the WHOLE run if any id is
//                           not a live player of the club, or if the caller's
//                           confirmed count no longer matches server truth.
//                           One transaction: a refusal deletes nobody and
//                           writes no audit event. Emits ONE
//                           players.bulk_deleted event carrying numeric counts
//                           only, sharing a batch id with the per identity
//                           player.deleted events the 0032 trigger writes.
//
// The destructive assertions are the point of this file: a manager (who holds
// players.manage but not players.delete) cannot run it, another club's child
// cannot be reached, a stale confirmation deletes nobody, and the audit
// metadata cannot carry a name.
//
// Every fixture is synthetic: invented names and disposable hex ids that are
// not, and have never been, real Spond member ids.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { CLUB_A, CLUB_B, SEEDED_SESSION, TEST_TEAM, runId, seedPlayer, serviceClient, signIn } from './stack'

const RUN = runId()
// players.display_name is bounded to 40 characters, so the fixture prefix is
// kept short (15 characters) and every label below is a few more. It is still
// unique per run, which is what the afterAll cleanup matches on.
const prefix = `SEC BD ${RUN}`
// seasons.name is bounded to 20 characters and is unique per club, so the
// archived season fixture gets its own short unique label (the
// player-registrations suite's convention).
const SEASON_NAME = `bd${RUN.slice(0, 6)}-past`

// Synthetic opaque ids, uppercase hex, 32 characters like Spond's own.
const MEMBER_ONE = '00BB11BB22BB33BB44BB55BB66BB77BB'
const MEMBER_TWO = 'CCCC1111DDDD2222EEEE3333FFFF4444'

describe('bulk permanent deletion of player identities', () => {
  let admin: SupabaseClient
  let manager: SupabaseClient
  let coachOne: SupabaseClient
  let parent: SupabaseClient
  let outsider: SupabaseClient
  let adminId: string
  let seasonA: string
  let seasonB: string
  let archivedSeason: string
  let sessionId: string
  let eventId: string
  let boardId: string
  let outsiderPlayer: string

  // Seed a fresh pair of children with the full dependency set, so each
  // destructive test starts from a known shape rather than from what the
  // previous one left behind.
  const seedPair = (label: string): { one: string; two: string } => {
    const one = seedPlayer({ club: CLUB_A, season: seasonA, display: `${prefix} ${label} one`, teamId: TEST_TEAM }).playerId
    const two = seedPlayer({ club: CLUB_A, season: seasonA, display: `${prefix} ${label} two`, teamId: TEST_TEAM }).playerId
    return { one, two }
  }

  beforeAll(async () => {
    const service = serviceClient()
    const a = await signIn('admin')
    admin = a.client
    adminId = a.userId
    manager = (await signIn('manager')).client
    coachOne = (await signIn('coachOne')).client
    parent = (await signIn('parent')).client
    outsider = (await signIn('outsider')).client

    const { data: current } = await service
      .from('seasons')
      .select('id')
      .eq('club_id', CLUB_A)
      .eq('is_current', true)
      .single()
    seasonA = current!.id as string

    const { data: theirs } = await service
      .from('seasons')
      .select('id')
      .eq('club_id', CLUB_B)
      .eq('is_current', true)
      .single()
    seasonB = theirs!.id as string

    // An archived season, so the "every season, archived included" half of the
    // cascade is exercised rather than assumed. registrations_guard_archived
    // guards INSERT and UPDATE only, so the row is written before archiving.
    // starts_on and ends_on are NOT NULL and ordered (seasons_dates_ordered),
    // and the name is bounded to 20 characters and unique per club; the dates
    // are long past so they collide with no other suite's fixtures.
    const { data: past, error: pastErr } = await service
      .from('seasons')
      .insert({
        club_id: CLUB_A,
        name: SEASON_NAME,
        starts_on: '2014-07-01',
        ends_on: '2015-06-30',
        is_current: false,
      })
      .select('id')
      .single()
    if (pastErr) throw new Error(`could not seed the archived season: ${pastErr.message}`)
    archivedSeason = past!.id as string

    // The seeded club A session, so the register entry counts below are about a
    // session that exists whatever order the suite runs in. The assertions only
    // ever count entries for this file's own players, so sharing it with
    // another suite changes nothing.
    sessionId = SEEDED_SESSION

    const { data: event, error: eventErr } = await service
      .from('spond_events')
      .insert({
        club_id: CLUB_A,
        spond_event_id: `${RUN}BULK`,
        title: `${prefix} event`,
        starts_at: new Date().toISOString(),
        synced_at: new Date().toISOString(),
      })
      .select('id')
      .single()
    if (eventErr) throw new Error(`could not seed the test Spond event: ${eventErr.message}`)
    eventId = event!.id as string

    const { data: board, error: boardErr } = await service
      .from('boards')
      .insert({ club_id: CLUB_A, created_by: adminId, name: `${prefix} board`, tokens: [] })
      .select('id')
      .single()
    if (boardErr) throw new Error(`could not seed the test board: ${boardErr.message}`)
    boardId = board!.id as string

    outsiderPlayer = seedPlayer({ club: CLUB_B, season: seasonB, display: `${prefix} other` }).playerId
  })

  afterAll(async () => {
    const service = serviceClient()
    await service.from('boards').delete().eq('id', boardId)
    await service.from('spond_event_responses').delete().eq('spond_event_id', eventId)
    await service.from('spond_events').delete().eq('id', eventId)
    // Players first: their registrations cascade, so the archived season is
    // unreferenced by the time it is removed (registrations reference seasons
    // ON DELETE RESTRICT).
    await service.from('players').delete().like('display_name', `${prefix}%`)
    await service.from('seasons').delete().like('name', `${SEASON_NAME}%`)
  })

  // ---- the capability gate ------------------------------------------

  it('a manager holding players.manage but not players.delete cannot preview or delete', async () => {
    const { one, two } = seedPair('mgr')
    const preview = await manager.rpc('preview_delete_players', { p_player_ids: [one, two] })
    expect(preview.error).not.toBeNull()
    expect(preview.error!.message).toMatch(/players\.delete/)

    const run = await manager.rpc('delete_players', { p_player_ids: [one, two], p_expected_count: 2 })
    expect(run.error).not.toBeNull()
    expect(run.error!.message).toMatch(/players\.delete/)

    const { data: still } = await serviceClient().from('players').select('id').in('id', [one, two])
    expect(still).toHaveLength(2)
  })

  it('a coach with players.view only, and a parent, cannot reach either function', async () => {
    const { one } = seedPair('coach')
    for (const client of [coachOne, parent]) {
      const preview = await client.rpc('preview_delete_players', { p_player_ids: [one] })
      expect(preview.error).not.toBeNull()
      const run = await client.rpc('delete_players', { p_player_ids: [one], p_expected_count: 1 })
      expect(run.error).not.toBeNull()
    }
    const { data: still } = await serviceClient().from('players').select('id').eq('id', one)
    expect(still).toHaveLength(1)
  })

  // ---- the preview ---------------------------------------------------

  it('the preview counts every dependency and writes nothing', async () => {
    const service = serviceClient()
    const { one, two } = seedPair('prev')

    // One archived-season registration, three register entries across one
    // session, two Spond links and three replies, two board tokens.
    await service.from('player_registrations').insert([
      { club_id: CLUB_A, player_id: one, season_id: archivedSeason, status: 'registered' },
      { club_id: CLUB_A, player_id: two, season_id: archivedSeason, status: 'withdrawn' },
    ])
    await service.from('seasons').update({ archived_at: new Date().toISOString() }).eq('id', archivedSeason)
    await service.from('register_entries').insert([
      { club_id: CLUB_A, session_id: sessionId, player_id: one, present: true, included_in_groups: true },
      { club_id: CLUB_A, session_id: sessionId, player_id: two, present: false, included_in_groups: false },
    ])
    await service.from('player_spond_links').insert([
      { club_id: CLUB_A, player_id: one, spond_member_id: MEMBER_ONE, matched_by: 'chosen' },
      { club_id: CLUB_A, player_id: two, spond_member_id: MEMBER_TWO, matched_by: 'chosen' },
    ])
    await service.from('spond_event_responses').insert([
      { club_id: CLUB_A, spond_event_id: eventId, spond_member_id: MEMBER_ONE, status: 'accepted', synced_at: new Date().toISOString() },
      { club_id: CLUB_A, spond_event_id: eventId, spond_member_id: MEMBER_TWO, status: 'declined', synced_at: new Date().toISOString() },
    ])
    await service
      .from('boards')
      .update({
        tokens: [
          { id: 't1', number: 7, side: 'home', x: 0.5, y: 0.5, playerId: one },
          { id: 't2', number: 9, side: 'home', x: 0.6, y: 0.4, playerId: two },
          { id: 't3', number: 4, side: 'away', x: 0.2, y: 0.2 },
        ],
      })
      .eq('id', boardId)

    const { data, error } = await admin.rpc('preview_delete_players', { p_player_ids: [one, two] })
    expect(error).toBeNull()
    const p = data as Record<string, number>
    expect(p.requested).toBe(2)
    expect(p.players).toBe(2)
    expect(p.registrations).toBe(4)
    expect(p.registrations_current).toBe(2)
    expect(p.registrations_archived).toBe(2)
    expect(p.registration_seasons).toBe(2)
    expect(p.register_entries).toBe(2)
    expect(p.register_sessions).toBe(1)
    expect(p.spond_links).toBe(2)
    expect(p.spond_replies).toBe(2)
    expect(p.board_tokens).toBe(2)
    expect(p.boards).toBe(1)

    // Read only: nothing was deleted and no audit event was written for it.
    const { data: stillThere } = await service.from('players').select('id').in('id', [one, two])
    expect(stillThere).toHaveLength(2)
    const { data: events } = await service
      .from('audit_events')
      .select('id')
      .eq('action', 'players.bulk_deleted')
      .eq('club_id', CLUB_A)
    expect(events).toEqual([])

    // Clean up the archived-season rows this test created so the later runs
    // start from the shape they seed for themselves.
    await service.from('players').delete().in('id', [one, two])
    await service.from('seasons').update({ archived_at: null }).eq('id', archivedSeason)
  })

  it('duplicate ids in the input are counted once', async () => {
    const { one } = seedPair('dup')
    const { data, error } = await admin.rpc('preview_delete_players', { p_player_ids: [one, one, one] })
    expect(error).toBeNull()
    expect((data as Record<string, number>).requested).toBe(1)
    expect((data as Record<string, number>).players).toBe(1)
    expect((data as Record<string, number>).registrations).toBe(1)
  })

  it('another club id contributes nothing to the preview', async () => {
    const { data, error } = await admin.rpc('preview_delete_players', { p_player_ids: [outsiderPlayer] })
    expect(error).toBeNull()
    expect((data as Record<string, number>).requested).toBe(1)
    expect((data as Record<string, number>).players).toBe(0)
  })

  it('an empty selection previews nothing and deletes nothing', async () => {
    const { data, error } = await admin.rpc('preview_delete_players', { p_player_ids: [] })
    expect(error).toBeNull()
    expect((data as Record<string, number>).players).toBe(0)

    const run = await admin.rpc('delete_players', { p_player_ids: [], p_expected_count: 0 })
    expect(run.error).not.toBeNull()
    expect(run.error!.message).toMatch(/no players were selected/)
  })

  // ---- the destructive run ------------------------------------------

  it('refuses the whole run when one selected id belongs to another club, and deletes nobody', async () => {
    const { one, two } = seedPair('xclub')
    const { error } = await admin.rpc('delete_players', {
      p_player_ids: [one, two, outsiderPlayer],
      p_expected_count: 3,
    })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/out of date/)

    const service = serviceClient()
    const { data: mine } = await service.from('players').select('id').in('id', [one, two])
    expect(mine).toHaveLength(2)
    const { data: theirs } = await service.from('players').select('id').eq('id', outsiderPlayer)
    expect(theirs).toHaveLength(1)
  })

  it('refuses when the confirmed count no longer matches server truth, and deletes nobody', async () => {
    const { one, two } = seedPair('stale')
    const { error } = await admin.rpc('delete_players', { p_player_ids: [one, two], p_expected_count: 5 })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/selection changed/)

    const { data: still } = await serviceClient().from('players').select('id').in('id', [one, two])
    expect(still).toHaveLength(2)
  })

  it('a member of another club cannot delete this club players', async () => {
    const { one } = seedPair('out')
    const { error } = await outsider.rpc('delete_players', { p_player_ids: [one], p_expected_count: 1 })
    expect(error).not.toBeNull()
    const { data: still } = await serviceClient().from('players').select('id').eq('id', one)
    expect(still).toHaveLength(1)
  })

  it('deletes every selected identity and its whole dependency set in one run', async () => {
    const service = serviceClient()
    const { one, two } = seedPair('run')
    const survivor = seedPlayer({ club: CLUB_A, season: seasonA, display: `${prefix} surv` }).playerId

    await service.from('register_entries').insert([
      { club_id: CLUB_A, session_id: sessionId, player_id: one, present: true, included_in_groups: true },
      { club_id: CLUB_A, session_id: sessionId, player_id: survivor, present: true, included_in_groups: true },
    ])
    await service
      .from('player_spond_links')
      .insert({ club_id: CLUB_A, player_id: one, spond_member_id: MEMBER_ONE, matched_by: 'chosen' })
    await service.from('spond_event_responses').insert({
      club_id: CLUB_A,
      spond_event_id: eventId,
      spond_member_id: MEMBER_ONE,
      status: 'accepted',
      synced_at: new Date().toISOString(),
    })

    const { data, error } = await admin.rpc('delete_players', { p_player_ids: [one, two], p_expected_count: 2 })
    expect(error).toBeNull()
    const result = data as Record<string, unknown>
    expect(result.outcome).toBe('succeeded')
    expect(result.players).toBe(2)
    expect(result.register_entries).toBe(1)
    expect(result.spond_links).toBe(1)
    expect(result.spond_replies).toBe(1)

    // The identities and everything that cascades from them are gone.
    const { data: gone } = await service.from('players').select('id').in('id', [one, two])
    expect(gone).toEqual([])
    const { data: regs } = await service.from('player_registrations').select('id').in('player_id', [one, two])
    expect(regs).toEqual([])
    const { data: entries } = await service.from('register_entries').select('id').in('player_id', [one, two])
    expect(entries).toEqual([])
    const { data: links } = await service.from('player_spond_links').select('player_id').in('player_id', [one, two])
    expect(links).toEqual([])
    const { data: replies } = await service
      .from('spond_event_responses')
      .select('spond_member_id')
      .eq('spond_member_id', MEMBER_ONE)
    expect(replies).toEqual([])

    // Nothing outside the selection moved: the session, the board and the
    // other child's register entry all survive.
    const { data: session } = await service.from('sessions').select('id').eq('id', sessionId)
    expect(session).toHaveLength(1)
    const { data: board } = await service.from('boards').select('id').eq('id', boardId)
    expect(board).toHaveLength(1)
    const { data: kept } = await service.from('register_entries').select('id').eq('player_id', survivor)
    expect(kept).toHaveLength(1)

    // Retrying the same run refuses rather than half running.
    const retry = await admin.rpc('delete_players', { p_player_ids: [one, two], p_expected_count: 2 })
    expect(retry.error).not.toBeNull()
    expect(retry.error!.message).toMatch(/out of date/)

    await service.from('players').delete().eq('id', survivor)
  })

  // ---- the audit trail -----------------------------------------------

  it('writes one bulk event per run beside the per identity events, all sharing a batch', async () => {
    const service = serviceClient()
    const { one, two } = seedPair('audit')
    const { data, error } = await admin.rpc('delete_players', { p_player_ids: [one, two], p_expected_count: 2 })
    expect(error).toBeNull()
    const batchId = (data as Record<string, string>).batch_id
    expect(batchId).toBeTruthy()

    const { data: events } = await service
      .from('audit_events')
      .select('action, entity_type, entity_id, actor_id, source, metadata, changed_fields, safe_changes')
      .eq('batch_id', batchId)
    expect(events).toHaveLength(3)

    const bulk = events!.filter((e) => e.action === 'players.bulk_deleted')
    const each = events!.filter((e) => e.action === 'player.deleted')
    expect(bulk).toHaveLength(1)
    expect(each).toHaveLength(2)
    expect(each.map((e) => e.entity_id).sort()).toEqual([one, two].sort())

    expect(bulk[0].entity_type).toBe('delete_batch')
    expect(bulk[0].entity_id).toBe(batchId)
    expect(bulk[0].actor_id).toBe(adminId)
    expect(bulk[0].source).toBe('manual')
    expect(bulk[0].safe_changes).toBeNull()

    // The metadata is numbers under a closed key list, so no name can be in it.
    const metadata = bulk[0].metadata as Record<string, unknown>
    expect(Object.keys(metadata).sort()).toEqual(
      [
        'board_tokens',
        'boards',
        'register_entries',
        'register_sessions',
        'registration_seasons',
        'registrations',
        'registrations_archived',
        'registrations_current',
        'spond_links',
        'spond_replies',
        'players',
      ].sort(),
    )
    for (const value of Object.values(metadata)) expect(typeof value).toBe('number')
    expect(JSON.stringify(events)).not.toContain(prefix)
  })

  it('the metadata predicate refuses a text value for any caller', async () => {
    // The predicate is what stands between a future writer and a name in the
    // audit trail, so it is asserted directly rather than trusted.
    const service = serviceClient()
    const { data } = await service.rpc('audit_bulk_delete_metadata_ok', { p_metadata: { players: 'Test Child' } })
    expect(data).toBe(false)
    const { data: ok } = await service.rpc('audit_bulk_delete_metadata_ok', { p_metadata: { players: 2 } })
    expect(ok).toBe(true)
  })

  // ---- the boundary this feature must not have moved ------------------

  it('leaves the internal counts helper unreachable from any client', async () => {
    for (const client of [admin, manager, coachOne, parent, outsider]) {
      const { error } = await client.rpc('player_deletion_counts', { p_club: CLUB_A, p_ids: [] })
      expect(error).not.toBeNull()
    }
  })

  it('still refuses a direct registration delete, bulk path or not', async () => {
    // No client holds a DELETE grant on registrations, so this is refused at
    // the grant rather than filtered to zero rows. A registration goes only
    // through the identity cascade, which is exactly what the bulk path uses.
    const { one } = seedPair('regdel')
    const { error } = await admin.from('player_registrations').delete().eq('player_id', one)
    expect(error).not.toBeNull()
    const { data: still } = await serviceClient().from('player_registrations').select('id').eq('player_id', one)
    expect(still).toHaveLength(1)
  })
})
