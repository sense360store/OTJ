// player_registrations RLS and constraints (0032_registered_players.sql). Read
// is club wide on players.view (no team arm); writes require players.manage with
// created_by pinned to the writer; permanent single-registration delete requires
// players.delete. The seasonal facts (team, status, shirt, dates) live here, the
// name never does. Constraints proven below RLS via the service role: the status
// vocabulary check (23514), the one registration per player and season unique
// (23505), the disallowed status transition trigger (P0001), the team deletion
// SET NULL cascade fix, the curator deletion SET NULL fix, and archived season
// immutability (P0001). All fixtures are synthetic; two identical names on one
// team and season are both representable.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  CLUB_A,
  CLUB_B,
  TEST_TEAM,
  expectCheckConstraintRefusal,
  expectRlsInsertRefusal,
  expectTriggerRefusal,
  runId,
  serviceClient,
  signIn,
} from './stack'

const RUN = runId()
const name = (s: string) => `SEC REG ${RUN} ${s}`
// Season names are bounded to 20 characters; use a short unique label.
const SPREFIX = `r${RUN.slice(0, 6)}-`
let seasonSeq = 0
const sname = () => `${SPREFIX}${seasonSeq++}`

async function currentSeason(club: string): Promise<string> {
  const { data, error } = await serviceClient()
    .from('seasons')
    .select('id')
    .eq('club_id', club)
    .eq('is_current', true)
    .single()
  if (error || !data) throw new Error(`no current season for ${club}: ${error?.message}`)
  return data.id
}

// Seeds a stable identity plus one registration directly through the service
// role. The identity is written with null frozen columns so the legacy
// compatibility trigger does not also create a registration; the registration
// is written explicitly.
async function seedPlayer(opts: {
  club: string
  season: string
  display: string
  teamId?: string | null
  shirt?: number | null
  status?: string
  createdBy?: string | null
}): Promise<{ playerId: string; regId: string }> {
  const svc = serviceClient()
  const { data: p, error: pe } = await svc
    .from('players')
    .insert({ club_id: opts.club, display_name: opts.display, created_by: opts.createdBy ?? null })
    .select('id')
    .single()
  if (pe || !p) throw new Error(`seed identity failed: ${pe?.message}`)
  const { data: r, error: re } = await svc
    .from('player_registrations')
    .insert({
      club_id: opts.club,
      player_id: p.id,
      season_id: opts.season,
      team_id: opts.teamId ?? null,
      status: opts.status ?? 'registered',
      shirt_number: opts.shirt ?? null,
      created_by: opts.createdBy ?? null,
    })
    .select('id')
    .single()
  if (re || !r) throw new Error(`seed registration failed: ${re?.message}`)
  return { playerId: p.id, regId: r.id }
}

describe('player_registrations row level security and constraints', () => {
  let manager: SupabaseClient
  let coachOne: SupabaseClient
  let parent: SupabaseClient
  let outsider: SupabaseClient
  let managerId: string
  let coachOneId: string
  let seasonA: string
  let seasonB: string
  let fixture: { playerId: string; regId: string }

  beforeAll(async () => {
    const m = await signIn('manager')
    manager = m.client
    managerId = m.userId
    const c1 = await signIn('coachOne')
    coachOne = c1.client
    coachOneId = c1.userId
    parent = (await signIn('parent')).client
    outsider = (await signIn('outsider')).client
    seasonA = await currentSeason(CLUB_A)
    seasonB = await currentSeason(CLUB_B)
    fixture = await seedPlayer({ club: CLUB_A, season: seasonA, display: name('fixture'), teamId: TEST_TEAM, shirt: 9 })
  })

  afterAll(async () => {
    await serviceClient().from('players').delete().like('display_name', `SEC REG ${RUN} %`)
    await serviceClient().from('seasons').delete().like('name', `${SPREFIX}%`)
  })

  // --- Read matrix ---
  it('a coach with players.view reads the club register including the registration', async () => {
    const { data, error } = await coachOne.from('player_registrations').select('id').eq('id', fixture.regId)
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
  })

  it('anon reads no registrations', async () => {
    const { data, error } = await (await import('./stack')).anonClient().from('player_registrations').select('id')
    // An anon read is either an error or an empty set; never rows.
    expect(error !== null || (data ?? []).length === 0).toBe(true)
  })

  it('a parent reads no registrations', async () => {
    const { data, error } = await parent.from('player_registrations').select('id')
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('an outsider reads no registrations in another club', async () => {
    const { data, error } = await outsider.from('player_registrations').select('id').eq('club_id', CLUB_A)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  // --- Write matrix ---
  it('a coach with only players.view cannot insert, update or delete a registration', async () => {
    const { error: insErr } = await coachOne.from('player_registrations').insert({
      club_id: CLUB_A,
      player_id: fixture.playerId,
      season_id: seasonA,
      status: 'pending',
      created_by: coachOneId,
    })
    expectRlsInsertRefusal(insErr)

    const { data: upd } = await coachOne
      .from('player_registrations')
      .update({ shirt_number: 11 })
      .eq('id', fixture.regId)
      .select('id')
    expect(upd).toEqual([])

    const { data: del } = await coachOne.from('player_registrations').delete().eq('id', fixture.regId).select('id')
    expect(del).toEqual([])
  })

  it('a manager with players.manage updates a registration', async () => {
    const { data, error } = await manager
      .from('player_registrations')
      .update({ shirt_number: 12 })
      .eq('id', fixture.regId)
      .select('id, shirt_number')
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
    expect(data![0].shirt_number).toBe(12)
  })

  it('a manager cannot permanently delete a registration (no players.delete): zero rows', async () => {
    const { playerId } = await seedPlayer({ club: CLUB_A, season: seasonA, display: name('mgr-del') })
    const { data: reg } = await serviceClient()
      .from('player_registrations')
      .select('id')
      .eq('player_id', playerId)
      .single()
    const { data: del } = await manager.from('player_registrations').delete().eq('id', reg!.id).select('id')
    expect(del).toEqual([])
    const { data: still } = await serviceClient().from('player_registrations').select('id').eq('id', reg!.id)
    expect(still).toHaveLength(1)
  })

  // --- Forged tenancy / actor ---
  it('a manager insert naming another club is refused (42501)', async () => {
    const { error } = await manager.from('player_registrations').insert({
      club_id: CLUB_B,
      player_id: fixture.playerId,
      season_id: seasonB,
      status: 'pending',
      created_by: managerId,
    })
    expectRlsInsertRefusal(error)
  })

  it('a manager insert with a forged created_by is refused (42501)', async () => {
    const { error } = await manager.from('player_registrations').insert({
      club_id: CLUB_A,
      player_id: fixture.playerId,
      season_id: seasonA,
      status: 'pending',
      created_by: coachOneId,
    })
    expectRlsInsertRefusal(error)
  })

  // --- Constraints (below RLS via the service role) ---
  it('the status vocabulary is enforced by a check constraint (23514)', async () => {
    const { playerId } = await seedPlayer({ club: CLUB_A, season: seasonA, display: name('status-check-parent') })
    // A fresh season so the (player, season) unique does not interfere.
    const { data: s } = await serviceClient()
      .from('seasons')
      .insert({ club_id: CLUB_A, name: sname(), starts_on: '2050-07-01', ends_on: '2051-06-30' })
      .select('id')
      .single()
    const { error } = await serviceClient().from('player_registrations').insert({
      club_id: CLUB_A,
      player_id: playerId,
      season_id: s!.id,
      status: 'bogus',
    })
    expectCheckConstraintRefusal(error as never, 'player_registrations_status_check')
  })

  it('a second registration for the same player and season is refused (23505)', async () => {
    const { error } = await serviceClient().from('player_registrations').insert({
      club_id: CLUB_A,
      player_id: fixture.playerId,
      season_id: seasonA,
      status: 'pending',
    })
    expect(error).not.toBeNull()
    expect(error?.code).toBe('23505')
  })

  it('a disallowed status transition is refused by a trigger (P0001)', async () => {
    const { regId } = await seedPlayer({ club: CLUB_A, season: seasonA, display: name('transition'), status: 'registered' })
    // registered -> pending is not in the allowed matrix.
    const { error } = await manager
      .from('player_registrations')
      .update({ status: 'pending' })
      .eq('id', regId)
      .select('id')
    expectTriggerRefusal(error as never, 'status transition registered to pending is not allowed')
  })

  it('an allowed status transition (registered -> withdrawn) succeeds', async () => {
    const { regId } = await seedPlayer({ club: CLUB_A, season: seasonA, display: name('withdraw'), status: 'registered' })
    const { data, error } = await manager
      .from('player_registrations')
      .update({ status: 'withdrawn' })
      .eq('id', regId)
      .select('id, status')
    expect(error).toBeNull()
    expect(data![0].status).toBe('withdrawn')
  })

  // --- The cascade fixes ---
  it('deleting a team turns its registrations Unassigned without deleting them', async () => {
    const svc = serviceClient()
    const { data: team } = await svc
      .from('teams')
      .insert({ club_id: CLUB_A, name: name('disposable-team') })
      .select('id')
      .single()
    const { regId } = await seedPlayer({ club: CLUB_A, season: seasonA, display: name('team-del'), teamId: team!.id, shirt: 5 })
    await svc.from('teams').delete().eq('id', team!.id)
    const { data } = await svc.from('player_registrations').select('team_id, shirt_number, status').eq('id', regId).single()
    expect(data!.team_id).toBeNull()
    expect(data!.shirt_number).toBe(5) // shirt preserved
    expect(data!.status).toBe('registered') // status preserved; the row survives
  })

  it('deleting the curating profile leaves the registration with created_by null', async () => {
    const svc = serviceClient()
    const { data: created, error: createErr } = await svc.auth.admin.createUser({
      email: `sec-reg-creator-${RUN}@otj-security-tests.local`,
      password: 'otj-local-security-tests-only',
      email_confirm: true,
      user_metadata: { full_name: 'Disposable Creator' },
    })
    if (createErr || !created.user) throw new Error(`could not create disposable creator: ${createErr?.message}`)
    const creatorId = created.user.id
    await svc.from('profiles').update({ club_id: CLUB_A }).eq('id', creatorId)
    const { regId } = await seedPlayer({
      club: CLUB_A,
      season: seasonA,
      display: name('curator-del'),
      createdBy: creatorId,
    })
    await svc.auth.admin.deleteUser(creatorId)
    const { data } = await svc.from('player_registrations').select('id, created_by').eq('id', regId).single()
    expect(data!.id).toBe(regId) // survives
    expect(data!.created_by).toBeNull() // SET NULL
  })

  // --- Namesakes ---
  it('two identical names on the same team and season are both representable', async () => {
    const a = await seedPlayer({ club: CLUB_A, season: seasonA, display: name('Twin Child'), teamId: TEST_TEAM })
    const b = await seedPlayer({ club: CLUB_A, season: seasonA, display: name('Twin Child'), teamId: TEST_TEAM })
    expect(a.playerId).not.toBe(b.playerId)
    const { data } = await serviceClient()
      .from('players')
      .select('id')
      .eq('display_name', name('Twin Child'))
    expect((data ?? []).length).toBe(2)
  })

  // --- Archived season immutability ---
  it('a registration in an archived season cannot be changed (P0001)', async () => {
    const svc = serviceClient()
    const { data: s } = await svc
      .from('seasons')
      .insert({ club_id: CLUB_A, name: sname(), starts_on: '2060-07-01', ends_on: '2061-06-30' })
      .select('id')
      .single()
    const { regId } = await seedPlayer({ club: CLUB_A, season: s!.id, display: name('archived-reg'), status: 'registered' })
    // Archive the (non current) season.
    await svc.from('seasons').update({ archived_at: new Date().toISOString() }).eq('id', s!.id)
    // A content edit is now refused for every writer.
    const { error } = await svc
      .from('player_registrations')
      .update({ shirt_number: 3 })
      .eq('id', regId)
      .select('id')
    expectTriggerRefusal(error as never, 'archived season is read only')
  })
})
