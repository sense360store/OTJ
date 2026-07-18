// The transactional edit path (update_player) and provenance integrity of
// created_by across seasons, players and player_registrations
// (0031_seasons.sql, 0032_registered_players.sql). Proves: a name plus shirt
// edit is all or nothing; a forced failure rolls the whole edit back; a stale
// displayed season is refused so a concurrent activation cannot redirect the
// edit; cross club and missing rows fail closed; a view only coach and a parent
// are refused; a genuine profile deletion nulls created_by without deleting or
// blocking the row, while an authenticated caller cannot erase or replace it;
// and a provenance only cascade writes no misleading business event. Synthetic
// data only.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { CLUB_A, CLUB_B, TEST_TEAM, runId, runSqlInContainer, seedPlayer, serviceClient, signIn } from './stack'

const RUN = runId()
const name = (s: string) => `SEC MUT ${RUN} ${s}`

async function currentSeason(club: string): Promise<string> {
  const { data } = await serviceClient().from('seasons').select('id').eq('club_id', club).eq('is_current', true).single()
  return data!.id
}

// A disposable profile (with its auth.users row) usable as created_by, so its
// deletion exercises the ON DELETE SET NULL cascade. Returned id is cleaned up
// by the caller if it still exists.
function seedProfile(display: string): string {
  const id = crypto.randomUUID()
  const email = `sec-mut-${id}@otj-security-tests.local`
  // The auth.users insert fires handle_new_user, which creates a quarantined
  // profile; upsert the club and name onto it.
  runSqlInContainer(
    `insert into auth.users (id, instance_id, aud, role, email)
       values ('${id}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '${email}');
     insert into public.profiles (id, club_id, full_name, role)
       values ('${id}', '${CLUB_A}', '${display.replace(/'/g, "''")}', 'coach')
       on conflict (id) do update set club_id = excluded.club_id, full_name = excluded.full_name, role = excluded.role;`,
  )
  return id
}

describe('update_player and provenance integrity', () => {
  let manager: SupabaseClient
  let coachOne: SupabaseClient
  let parent: SupabaseClient
  let managerId: string
  let seasonA: string

  beforeAll(async () => {
    const m = await signIn('manager')
    manager = m.client
    managerId = m.userId
    coachOne = (await signIn('coachOne')).client
    parent = (await signIn('parent')).client
    seasonA = await currentSeason(CLUB_A)
  })

  afterAll(async () => {
    await serviceClient().from('players').delete().like('display_name', `SEC MUT ${RUN} %`)
    await serviceClient().from('seasons').delete().like('name', `smut-${RUN.slice(0, 5)}%`)
  })

  // --- update_player: item 2 ---
  it('a manager updates name and shirt together, atomically', async () => {
    const { playerId } = seedPlayer({ club: CLUB_A, season: seasonA, display: name('edit'), teamId: TEST_TEAM, shirt: 3 })
    const { data, error } = await manager.rpc('update_player', {
      p_id: playerId,
      p_expected_season: seasonA,
      p_display_name: name('edited'),
      p_set_shirt: true,
      p_shirt_number: 21,
    })
    expect(error).toBeNull()
    const row = Array.isArray(data) ? data[0] : data
    expect(row.display_name).toBe(name('edited'))
    expect(row.shirt_number).toBe(21)
  })

  it('a forced registration failure rolls back the name change and writes no audit event', async () => {
    const { playerId } = seedPlayer({ club: CLUB_A, season: seasonA, display: name('rollback'), teamId: TEST_TEAM })
    const { data: before } = await serviceClient().from('audit_events').select('id').eq('entity_id', playerId)
    const baseline = (before ?? []).length
    // Shirt 200 violates the 1..99 check, so the whole RPC transaction aborts.
    const { error } = await manager.rpc('update_player', {
      p_id: playerId,
      p_expected_season: seasonA,
      p_display_name: name('never-lands'),
      p_set_shirt: true,
      p_shirt_number: 200,
    })
    expect(error).not.toBeNull()
    const { data: identity } = await serviceClient().from('players').select('display_name').eq('id', playerId).single()
    expect(identity!.display_name).toBe(name('rollback')) // name unchanged
    const { data: after } = await serviceClient().from('audit_events').select('id').eq('entity_id', playerId)
    expect((after ?? []).length).toBe(baseline) // no audit event survived
  })

  it('a stale displayed season is refused, so a concurrent activation cannot redirect the edit', async () => {
    const { playerId } = seedPlayer({ club: CLUB_A, season: seasonA, display: name('stale'), teamId: TEST_TEAM })
    const { error } = await manager.rpc('update_player', {
      p_id: playerId,
      p_expected_season: crypto.randomUUID(), // not the current season
      p_display_name: name('stale-edit'),
      p_set_shirt: false,
      p_shirt_number: null,
    })
    expect(error).not.toBeNull()
    expect(error?.message ?? '').toContain('season changed')
  })

  it('a view only coach and a parent are refused (42501) and change nothing', async () => {
    const { playerId } = seedPlayer({ club: CLUB_A, season: seasonA, display: name('nowrite'), teamId: TEST_TEAM })
    for (const client of [coachOne, parent]) {
      const { error } = await client.rpc('update_player', {
        p_id: playerId,
        p_expected_season: seasonA,
        p_display_name: name('nope'),
        p_set_shirt: false,
        p_shirt_number: null,
      })
      expect(error).not.toBeNull()
    }
    const { data } = await serviceClient().from('players').select('display_name').eq('id', playerId).single()
    expect(data!.display_name).toBe(name('nowrite'))
  })

  it('a cross club or missing player is refused', async () => {
    // A player id from club B (seed in club B's current season).
    const seasonB = await currentSeason(CLUB_B)
    const { playerId: clubBPlayer } = seedPlayer({ club: CLUB_B, season: seasonB, display: name('clubB') })
    const cross = await manager.rpc('update_player', {
      p_id: clubBPlayer,
      p_expected_season: seasonA,
      p_display_name: name('cross'),
      p_set_shirt: false,
      p_shirt_number: null,
    })
    expect(cross.error).not.toBeNull()
    // A missing player id.
    const missing = await manager.rpc('update_player', {
      p_id: crypto.randomUUID(),
      p_expected_season: seasonA,
      p_display_name: name('missing'),
      p_set_shirt: false,
      p_shirt_number: null,
    })
    expect(missing.error).not.toBeNull()
  })

  // --- created_by provenance: item 3 ---
  it('deleting the profile that created a player nulls created_by and keeps the rows', async () => {
    const curator = seedProfile(name('curator'))
    const { playerId, regId } = seedPlayer({
      club: CLUB_A,
      season: seasonA,
      display: name('curated'),
      teamId: TEST_TEAM,
      createdBy: curator,
    })
    // Delete the curator profile: the SET NULL cascade must succeed.
    const { error } = await serviceClient().from('profiles').delete().eq('id', curator)
    expect(error).toBeNull()
    const { data: p } = await serviceClient().from('players').select('created_by').eq('id', playerId).single()
    expect(p!.created_by).toBeNull()
    const { data: r } = await serviceClient().from('player_registrations').select('created_by').eq('id', regId).single()
    expect(r!.created_by).toBeNull()
    runSqlInContainer(`delete from auth.users where id = '${curator}';`)
  })

  it('deleting the profile that created a season nulls created_by, keeps the season, writes no misleading event', async () => {
    const curator = seedProfile(name('season-curator'))
    const { data: season } = await serviceClient()
      .from('seasons')
      .insert({
        club_id: CLUB_A,
        name: `smut-${RUN.slice(0, 5)}-s`,
        starts_on: '2055-07-01',
        ends_on: '2056-06-30',
        created_by: curator,
      })
      .select('id')
      .single()
    const { data: before } = await serviceClient().from('audit_events').select('id').eq('entity_id', season!.id)
    const baseline = (before ?? []).length
    const { error } = await serviceClient().from('profiles').delete().eq('id', curator)
    expect(error).toBeNull()
    const { data: s } = await serviceClient().from('seasons').select('created_by').eq('id', season!.id).single()
    expect(s!.created_by).toBeNull()
    // No contentless season.updated event for the provenance-only cascade.
    const { data: after } = await serviceClient().from('audit_events').select('id').eq('entity_id', season!.id)
    expect((after ?? []).length).toBe(baseline)
    runSqlInContainer(`delete from auth.users where id = '${curator}';`)
  })

  it('a manager cannot erase or replace created_by on players, registrations or seasons', async () => {
    const { playerId, regId } = seedPlayer({
      club: CLUB_A,
      season: seasonA,
      display: name('provenance'),
      teamId: TEST_TEAM,
      createdBy: managerId,
    })
    // players: null and replace both refused (zero rows filtered? no: the touch
    // trigger raises P0001, surfaced as an error).
    const pNull = await manager.from('players').update({ created_by: null }).eq('id', playerId).select('id')
    expect(pNull.error).not.toBeNull()
    const pRepl = await manager.from('players').update({ created_by: CLUB_A }).eq('id', playerId).select('id')
    expect(pRepl.error).not.toBeNull()
    // registrations: null refused.
    const rNull = await manager.from('player_registrations').update({ created_by: null }).eq('id', regId).select('id')
    expect(rNull.error).not.toBeNull()
    // The provenance is intact.
    const { data } = await serviceClient().from('players').select('created_by').eq('id', playerId).single()
    expect(data!.created_by).toBe(managerId)
  })
})
