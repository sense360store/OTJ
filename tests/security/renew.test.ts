// The transactional bulk Renew commit path (renew_registrations,
// 0036_spond_and_renew.sql). Proves the child-data WRITE boundary of PR 6's
// renewal: only a players.manage holder can renew; the server derives club and
// actor and re-reads team and shirt from the source registration (nothing
// trusted from the client); source and target seasons must belong to the club,
// differ, and the target must be non archived; renewal is idempotent per
// (player, season); the source registration is never mutated; a cross club or
// forged player id renews nothing; and the audit trail carries source 'renewal'
// with a shared batch id and no import_batches row. Maps the renew.test.ts
// contract in docs/security/registered-players-threat-model.md (PR 6) and the
// policy-test-matrix renew cells. Synthetic data only.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { CLUB_A, CLUB_B, TEST_TEAM, runId, seedPlayer, serviceClient, signIn } from './stack'

const RUN = runId()
const name = (s: string) => `SEC RNW ${RUN} ${s}`
const svc = serviceClient()
const batchIds: string[] = []
const seededPlayers: string[] = []

function batch(): string {
  const id = crypto.randomUUID()
  batchIds.push(id)
  return id
}

async function currentSeason(club: string): Promise<string> {
  const { data } = await svc.from('seasons').select('id').eq('club_id', club).eq('is_current', true).single()
  return data!.id
}

// A registration row for a player and season, out of band (names never leave the DB).
async function reg(playerId: string, seasonId: string) {
  const { data } = await svc
    .from('player_registrations')
    .select('id, status, team_id, shirt_number, registered_date')
    .eq('player_id', playerId)
    .eq('season_id', seasonId)
    .maybeSingle()
  return data
}
async function importBatch(id: string) {
  const { data } = await svc.from('import_batches').select('id').eq('id', id).maybeSingle()
  return data
}
async function renewalEvents(id: string) {
  const { data } = await svc
    .from('audit_events')
    .select('action, source, entity_type, batch_id')
    .eq('batch_id', id)
  return data ?? []
}

describe('renew_registrations: capability, isolation, carry forward, idempotency, audit', () => {
  let manager: SupabaseClient
  let coachOne: SupabaseClient
  let parent: SupabaseClient
  let outsider: SupabaseClient
  let currentA: string
  let sourceA: string
  let archivedA: string
  let currentB: string
  // source-season players in club A
  let pAlice: string // registered, team, shirt 7
  let pBob: string // withdrawn, team, shirt 9
  let pCara: string // registered, no team
  let clubBPlayer: string

  beforeAll(async () => {
    manager = (await signIn('manager')).client
    coachOne = (await signIn('coachOne')).client
    parent = (await signIn('parent')).client
    outsider = (await signIn('outsider')).client
    currentA = await currentSeason(CLUB_A)
    currentB = await currentSeason(CLUB_B)

    // A non current SOURCE season and an ARCHIVED season in club A.
    const s = await svc
      .from('seasons')
      .insert({ club_id: CLUB_A, name: `S${RUN}`, starts_on: '2024-07-01', ends_on: '2025-06-30', is_current: false })
      .select('id')
      .single()
    sourceA = s.data!.id
    const a = await svc
      .from('seasons')
      .insert({
        club_id: CLUB_A,
        name: `A${RUN}`,
        starts_on: '2018-07-01',
        ends_on: '2019-06-30',
        is_current: false,
        archived_at: new Date().toISOString(),
      })
      .select('id')
      .single()
    archivedA = a.data!.id

    pAlice = seedPlayer({ club: CLUB_A, season: sourceA, display: name('alice'), teamId: TEST_TEAM, shirt: 7, status: 'registered' }).playerId
    pBob = seedPlayer({ club: CLUB_A, season: sourceA, display: name('bob'), teamId: TEST_TEAM, shirt: 9, status: 'withdrawn' }).playerId
    pCara = seedPlayer({ club: CLUB_A, season: sourceA, display: name('cara'), teamId: null, status: 'registered' }).playerId
    clubBPlayer = seedPlayer({ club: CLUB_B, season: currentB, display: name('clubB'), status: 'registered' }).playerId
    seededPlayers.push(pAlice, pBob, pCara, clubBPlayer)
  })

  afterAll(async () => {
    await svc.from('players').delete().like('display_name', `SEC RNW ${RUN} %`)
    await svc.from('seasons').delete().in('id', [sourceA, archivedA])
  })

  // ---- capability gate ------------------------------------------------------
  it('refuses a coach without players.manage (42501)', async () => {
    const { error } = await coachOne.rpc('renew_registrations', {
      p_batch_id: batch(),
      p_source_season_id: sourceA,
      p_target_season_id: currentA,
      p_player_ids: [pAlice],
    })
    expect(error?.code).toBe('42501')
    expect(await reg(pAlice, currentA)).toBeNull()
  })

  it('refuses a parent (42501)', async () => {
    const { error } = await parent.rpc('renew_registrations', {
      p_batch_id: batch(),
      p_source_season_id: sourceA,
      p_target_season_id: currentA,
      p_player_ids: [pAlice],
    })
    expect(error?.code).toBe('42501')
  })

  it('refuses an outsider from another club (42501)', async () => {
    const { error } = await outsider.rpc('renew_registrations', {
      p_batch_id: batch(),
      p_source_season_id: sourceA,
      p_target_season_id: currentA,
      p_player_ids: [pAlice],
    })
    expect(error?.code).toBe('42501')
  })

  // ---- season isolation and eligibility -------------------------------------
  it('refuses renewing into the same season (P0001)', async () => {
    const { error } = await manager.rpc('renew_registrations', {
      p_batch_id: batch(),
      p_source_season_id: currentA,
      p_target_season_id: currentA,
      p_player_ids: [pAlice],
    })
    expect(error?.code).toBe('P0001')
  })

  it('refuses a source season from another club (42501)', async () => {
    const bSeason = await currentSeason(CLUB_B)
    const { error } = await manager.rpc('renew_registrations', {
      p_batch_id: batch(),
      p_source_season_id: bSeason,
      p_target_season_id: currentA,
      p_player_ids: [pAlice],
    })
    expect(error?.code).toBe('42501')
  })

  it('refuses an archived target season (P0001), writing nothing', async () => {
    const { error } = await manager.rpc('renew_registrations', {
      p_batch_id: batch(),
      p_source_season_id: sourceA,
      p_target_season_id: archivedA,
      p_player_ids: [pAlice],
    })
    expect(error?.code).toBe('P0001')
    expect(await reg(pAlice, archivedA)).toBeNull()
  })

  // ---- the happy path: carry forward, audit, no import_batches row -----------
  it('renews chosen registrations as Pending, carrying team and shirt, empty date, audited as renewal', async () => {
    const id = batch()
    const { data, error } = await manager.rpc('renew_registrations', {
      p_batch_id: id,
      p_source_season_id: sourceA,
      p_target_season_id: currentA,
      p_player_ids: [pAlice, pBob, pCara],
    })
    expect(error).toBeNull()
    const r = data as { outcome: string; renewed: number; already_in_target: number; skipped: number }
    expect(r.outcome).toBe('succeeded')
    expect(r.renewed).toBe(3)
    expect(r.already_in_target).toBe(0)
    expect(r.skipped).toBe(0)

    // Alice: pending, team + shirt carried, no registered date.
    const alice = await reg(pAlice, currentA)
    expect(alice!.status).toBe('pending')
    expect(alice!.team_id).toBe(TEST_TEAM)
    expect(alice!.shirt_number).toBe(7)
    expect(alice!.registered_date).toBeNull()
    // Cara: Unassigned carried.
    expect((await reg(pCara, currentA))!.team_id).toBeNull()

    // Source registrations are UNCHANGED (Bob stays withdrawn on his source row).
    const bobSource = await reg(pBob, sourceA)
    expect(bobSource!.status).toBe('withdrawn')
    expect(bobSource!.team_id).toBe(TEST_TEAM)
    expect(bobSource!.shirt_number).toBe(9)

    // Audit: three player.renewed events, source renewal, sharing the batch id.
    const events = await renewalEvents(id)
    const renewed = events.filter((e) => e.action === 'player.renewed' && e.source === 'renewal')
    expect(renewed.length).toBe(3)
    expect(events.every((e) => e.source === 'renewal')).toBe(true)
    // No import_batches row for a renewal.
    expect(await importBatch(id)).toBeNull()
  })

  it('is idempotent per (player, season): a repeat renewal creates no duplicates', async () => {
    const before = await svc
      .from('player_registrations')
      .select('id', { count: 'exact', head: true })
      .eq('season_id', currentA)
      .in('player_id', [pAlice, pBob, pCara])
    const { data, error } = await manager.rpc('renew_registrations', {
      p_batch_id: batch(),
      p_source_season_id: sourceA,
      p_target_season_id: currentA,
      p_player_ids: [pAlice, pBob, pCara],
    })
    expect(error).toBeNull()
    const r = data as { renewed: number; already_in_target: number }
    expect(r.renewed).toBe(0)
    expect(r.already_in_target).toBe(3)
    const after = await svc
      .from('player_registrations')
      .select('id', { count: 'exact', head: true })
      .eq('season_id', currentA)
      .in('player_id', [pAlice, pBob, pCara])
    expect(after.count).toBe(before.count) // no new rows
  })

  // ---- forged / cross club ids skip, never write ----------------------------
  it('skips a cross club player id, renewing nothing for it', async () => {
    const id = batch()
    // Use the source-only players plus the club B player; renew into a fresh
    // scratch season so nothing is already present.
    const scratch = await svc
      .from('seasons')
      .insert({ club_id: CLUB_A, name: `X${RUN}`, starts_on: '2029-07-01', ends_on: '2030-06-30', is_current: false })
      .select('id')
      .single()
    const scratchId = scratch.data!.id
    const { data, error } = await manager.rpc('renew_registrations', {
      p_batch_id: id,
      p_source_season_id: sourceA,
      p_target_season_id: scratchId,
      p_player_ids: [clubBPlayer],
    })
    expect(error).toBeNull()
    const r = data as { renewed: number; skipped: number }
    expect(r.renewed).toBe(0)
    expect(r.skipped).toBe(1)
    // The club B player gained no club A registration.
    expect(await reg(clubBPlayer, scratchId)).toBeNull()
    await svc.from('seasons').delete().eq('id', scratchId)
  })

  it('an empty player list is a no-op success', async () => {
    const { data, error } = await manager.rpc('renew_registrations', {
      p_batch_id: batch(),
      p_source_season_id: sourceA,
      p_target_season_id: currentA,
      p_player_ids: [],
    })
    expect(error).toBeNull()
    const r = data as { renewed: number; skipped: number; already_in_target: number }
    expect(r.renewed).toBe(0)
    expect(r.skipped).toBe(0)
    expect(r.already_in_target).toBe(0)
  })
})
