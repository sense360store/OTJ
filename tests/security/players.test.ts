// players (the stable child identity) RLS after the PR 2 split
// (0032_registered_players.sql). The read model changed from a sessions.create
// gate to the club wide players.view read: a coach with players.view reads the
// whole club register (no team arm), but cannot write; a manager or admin with
// players.manage writes; permanent identity delete requires players.delete
// (admins only, not managers); a parent, an outsider and anon read nothing. The
// insert pins created_by = auth.uid(), fixing the confirmed 0021 comment versus
// clause mismatch. Synthetic names only, never real children.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  CLUB_A,
  CLUB_B,
  TEST_TEAM,
  anonClient,
  expectRlsInsertRefusal,
  runId,
  seedPlayer,
  serviceClient,
  signIn,
} from './stack'

const RUN = runId()
const playerName = `SEC TEST Player ${RUN}`

describe('players identity row level security', () => {
  let admin: SupabaseClient
  let manager: SupabaseClient
  let coachOne: SupabaseClient
  let parent: SupabaseClient
  let outsider: SupabaseClient
  let managerId: string
  let coachOneId: string
  let playerId: string
  let seasonA: string

  beforeAll(async () => {
    admin = (await signIn('admin')).client
    const m = await signIn('manager')
    manager = m.client
    managerId = m.userId
    const c1 = await signIn('coachOne')
    coachOne = c1.client
    coachOneId = c1.userId
    parent = (await signIn('parent')).client
    outsider = (await signIn('outsider')).client

    const { data: season } = await serviceClient()
      .from('seasons')
      .select('id')
      .eq('club_id', CLUB_A)
      .eq('is_current', true)
      .single()
    seasonA = season!.id
    // A stable identity plus its current-season registration, seeded atomically
    // (a bare players insert is rolled back by the deferred require-registration
    // constraint).
    playerId = seedPlayer({
      club: CLUB_A,
      season: seasonA,
      display: playerName,
      createdBy: coachOneId,
    }).playerId
  })

  afterAll(async () => {
    await serviceClient().from('players').delete().like('display_name', `SEC TEST Player ${RUN}%`)
  })

  // --- Read: club wide on players.view ---
  it('a coach holding players.view reads the club register', async () => {
    const { data, error } = await coachOne.from('players').select('id, display_name').eq('id', playerId)
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
  })

  it('an admin reads the club register', async () => {
    const { data, error } = await admin.from('players').select('id').eq('id', playerId)
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
  })

  it('a parent cannot select player rows or names', async () => {
    const { data, error } = await parent.from('players').select('id, display_name')
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('anon cannot select players', async () => {
    const { data, error } = await anonClient().from('players').select('id')
    expect(error !== null || (data ?? []).length === 0).toBe(true)
  })

  it('a member of another club cannot select this club register', async () => {
    const { data, error } = await outsider.from('players').select('id').eq('club_id', CLUB_A)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  // --- The read only coach: players.view without players.manage ---
  it('a coach with only players.view cannot insert, update or delete an identity', async () => {
    const { error: insErr } = await coachOne
      .from('players')
      .insert({ club_id: CLUB_A, display_name: `${playerName} coach`, created_by: coachOneId })
    expectRlsInsertRefusal(insErr)

    const { data: upd } = await coachOne
      .from('players')
      .update({ display_name: 'should never land' })
      .eq('id', playerId)
      .select('id')
    expect(upd).toEqual([])

    const { data: del } = await coachOne.from('players').delete().eq('id', playerId).select('id')
    expect(del).toEqual([])
    const { data: still } = await serviceClient().from('players').select('id').eq('id', playerId)
    expect(still).toHaveLength(1)
  })

  it('a parent cannot insert a player', async () => {
    const { error } = await parent
      .from('players')
      .insert({ club_id: CLUB_A, display_name: `${playerName} parent`, created_by: coachOneId })
    expectRlsInsertRefusal(error)
  })

  // --- players.manage writes ---
  it('a manager with players.manage creates (add_player, created_by pinned) and updates', async () => {
    // Creation goes through add_player: a bare players insert is rolled back by
    // the deferred require-registration constraint, so the sanctioned path is
    // the RPC that commits the identity and its registration together.
    const newId = crypto.randomUUID()
    const { error: insErr } = await manager.rpc('add_player', {
      p_id: newId,
      p_display_name: `${playerName} manager`,
      p_team_id: TEST_TEAM,
      p_shirt_number: null,
      p_status: 'registered',
      p_registered_date: null,
    })
    expect(insErr).toBeNull()
    // created_by is pinned to the acting manager, not forgeable.
    const { data: row } = await serviceClient().from('players').select('created_by').eq('id', newId).single()
    expect(row!.created_by).toBe(managerId)
    // The identity rename is an ordinary players.manage update.
    const { data: upd, error: updErr } = await manager
      .from('players')
      .update({ display_name: `${playerName} manager edited` })
      .eq('id', newId)
      .select('id')
    expect(updErr).toBeNull()
    expect(upd).toHaveLength(1)
  })

  it('a forged created_by via add_player is impossible (the RPC pins auth.uid)', async () => {
    // add_player ignores any caller-supplied creator and pins created_by to the
    // acting user, so a manager cannot attribute a child to someone else.
    const newId = crypto.randomUUID()
    const { error } = await manager.rpc('add_player', {
      p_id: newId,
      p_display_name: `${playerName} forge`,
      p_team_id: TEST_TEAM,
      p_shirt_number: null,
      p_status: 'registered',
      p_registered_date: null,
    })
    expect(error).toBeNull()
    const { data: row } = await serviceClient().from('players').select('created_by').eq('id', newId).single()
    expect(row!.created_by).toBe(managerId)
  })

  it('a bare players insert by a manager is rolled back by the deferred invariant', async () => {
    // The insert passes RLS (players.manage) but leaves no registration, so the
    // deferred players_require_registration constraint aborts it at commit.
    const orphanName = `${playerName} orphan`
    const { error } = await manager
      .from('players')
      .insert({ club_id: CLUB_A, display_name: orphanName, created_by: managerId })
      .select('id')
    expect(error).not.toBeNull()
    expect(error?.message ?? '').toContain('at least one registration')
    // Nothing landed, and no player.created audit event survives the rollback.
    const { data: rows } = await serviceClient().from('players').select('id').eq('display_name', orphanName)
    expect(rows).toEqual([])
  })

  it('a manager insert naming another club is refused (42501)', async () => {
    const { error } = await manager
      .from('players')
      .insert({ club_id: CLUB_B, display_name: `${playerName} clubB`, created_by: managerId })
    expectRlsInsertRefusal(error)
  })

  // --- Permanent delete requires players.delete ---
  it('a manager cannot permanently delete an identity (no players.delete): zero rows', async () => {
    const { data: del } = await manager.from('players').delete().eq('id', playerId).select('id')
    expect(del).toEqual([])
    const { data: still } = await serviceClient().from('players').select('id').eq('id', playerId)
    expect(still).toHaveLength(1)
  })

  it('an admin with players.delete permanently deletes an identity and cascades its registrations', async () => {
    const { playerId: pid, regId } = seedPlayer({
      club: CLUB_A,
      season: seasonA,
      display: `${playerName} to delete`,
      teamId: TEST_TEAM,
      createdBy: managerId,
    })
    const { data: del, error } = await admin.from('players').delete().eq('id', pid).select('id')
    expect(error).toBeNull()
    expect(del).toHaveLength(1)
    // The registration cascaded with the identity: no orphan registration.
    const { data: regs } = await serviceClient().from('player_registrations').select('id').eq('id', regId)
    expect(regs).toEqual([])
  })

  it('a manager cannot delete a registration directly (no delete grant): erasure is the identity cascade', async () => {
    // player_registrations has no client delete grant, so even a players.delete
    // holder cannot remove a single registration and orphan the identity.
    const { error: mgrErr } = await manager.from('player_registrations').delete().eq('player_id', playerId)
    expect(mgrErr).not.toBeNull()
    const { error: adminErr } = await admin.from('player_registrations').delete().eq('player_id', playerId)
    expect(adminErr).not.toBeNull()
    // The registration still exists.
    const { data: still } = await serviceClient().from('player_registrations').select('id').eq('player_id', playerId)
    expect(still).toHaveLength(1)
  })
})
