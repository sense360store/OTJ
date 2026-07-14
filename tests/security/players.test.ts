// Players RLS matrix, the children's data boundary (0021_players,
// 0023_players_fullname). Intended contract: the ONE table whose select is
// gated rather than club-wide. Reads and writes require sessions.create
// within the club; the parent role holds no capability, so a parent must
// never select, insert, update or delete a roster row. A blocked select
// surfaces as zero rows, not an error, because RLS filters the set.
// The names used here are synthetic fixtures, never real children.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { CLUB_A, TEST_TEAM, expectRlsInsertRefusal, runId, serviceClient, signIn } from './stack'

const RUN = runId()
const playerName = `SEC TEST Player ${RUN}`

describe('players row level security', () => {
  let admin: SupabaseClient
  let coachOne: SupabaseClient
  let parent: SupabaseClient
  let outsider: SupabaseClient
  let coachOneId: string
  let playerId: string

  beforeAll(async () => {
    const a = await signIn('admin')
    const c1 = await signIn('coachOne')
    const p = await signIn('parent')
    const o = await signIn('outsider')
    admin = a.client
    coachOne = c1.client
    parent = p.client
    outsider = o.client
    coachOneId = c1.userId

    const { data, error } = await serviceClient()
      .from('players')
      .insert({
        club_id: CLUB_A,
        team_id: TEST_TEAM,
        display_name: playerName,
        shirt_number: 9,
        created_by: coachOneId,
      })
      .select('id')
      .single()
    if (error) throw new Error(`could not seed the fixture player: ${error.message}`)
    playerId = data!.id
  })

  afterAll(async () => {
    await serviceClient().from('players').delete().like('display_name', `SEC TEST Player ${RUN}%`)
  })

  it('a coach holding sessions.create reads the club roster', async () => {
    const { data, error } = await coachOne.from('players').select('id, display_name').eq('id', playerId)
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
  })

  it('admin reads the club roster', async () => {
    const { data, error } = await admin.from('players').select('id').eq('id', playerId)
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
  })

  it('parent cannot select player rows or names', async () => {
    const { data, error } = await parent.from('players').select('id, display_name')
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('a member of another club cannot select this club roster', async () => {
    const { data, error } = await outsider.from('players').select('id').eq('club_id', CLUB_A)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('parent cannot insert a player', async () => {
    const { error } = await parent.from('players').insert({
      club_id: CLUB_A,
      team_id: TEST_TEAM,
      display_name: `${playerName} by parent`,
      created_by: coachOneId,
    })
    expectRlsInsertRefusal(error)
  })

  it('parent cannot update or delete a player', async () => {
    const { data: updated, error: updateErr } = await parent
      .from('players')
      .update({ display_name: 'should never land' })
      .eq('id', playerId)
      .select('id')
    expect(updateErr).toBeNull()
    expect(updated).toEqual([])

    const { data: deleted, error: deleteErr } = await parent
      .from('players')
      .delete()
      .eq('id', playerId)
      .select('id')
    expect(deleteErr).toBeNull()
    expect(deleted).toEqual([])
    const { data: still } = await serviceClient().from('players').select('id').eq('id', playerId)
    expect(still).toHaveLength(1)
  })

  it('a coach holding sessions.create can curate the roster', async () => {
    const { data: created, error: insertErr } = await coachOne
      .from('players')
      .insert({
        club_id: CLUB_A,
        team_id: TEST_TEAM,
        display_name: `${playerName} second`,
        created_by: coachOneId,
      })
      .select('id')
      .single()
    expect(insertErr).toBeNull()

    const { data: deleted, error: deleteErr } = await coachOne
      .from('players')
      .delete()
      .eq('id', created!.id)
      .select('id')
    expect(deleteErr).toBeNull()
    expect(deleted).toHaveLength(1)
  })
})
