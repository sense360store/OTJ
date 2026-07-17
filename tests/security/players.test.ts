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
import { CLUB_A, CLUB_B, anonClient, expectRlsInsertRefusal, runId, serviceClient, signIn } from './stack'

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

    const { data, error } = await serviceClient()
      .from('players')
      .insert({ club_id: CLUB_A, display_name: playerName, created_by: coachOneId })
      .select('id')
      .single()
    if (error) throw new Error(`could not seed the fixture player: ${error.message}`)
    playerId = data!.id
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
  it('a manager with players.manage inserts (created_by pinned) and updates', async () => {
    const { data: created, error: insErr } = await manager
      .from('players')
      .insert({ club_id: CLUB_A, display_name: `${playerName} manager`, created_by: managerId })
      .select('id')
      .single()
    expect(insErr).toBeNull()
    const { data: upd, error: updErr } = await manager
      .from('players')
      .update({ display_name: `${playerName} manager edited` })
      .eq('id', created!.id)
      .select('id')
    expect(updErr).toBeNull()
    expect(upd).toHaveLength(1)
  })

  it('a forged created_by on insert is refused (42501)', async () => {
    const { error } = await manager
      .from('players')
      .insert({ club_id: CLUB_A, display_name: `${playerName} forge`, created_by: coachOneId })
    expectRlsInsertRefusal(error)
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

  it('an admin with players.delete permanently deletes an identity', async () => {
    const { data: created } = await serviceClient()
      .from('players')
      .insert({ club_id: CLUB_A, display_name: `${playerName} to delete`, created_by: managerId })
      .select('id')
      .single()
    const { data: del, error } = await admin.from('players').delete().eq('id', created!.id).select('id')
    expect(error).toBeNull()
    expect(del).toHaveLength(1)
  })
})
