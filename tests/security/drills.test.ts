// Drills RLS matrix. Intended contract (0012_rbac and 0015_rbac_roles):
// club-wide reads for every member; insert requires drills.create; update
// and delete require ownership plus drills.create, or drills.manage.
// Blocked updates and deletes surface as zero affected rows because RLS
// filters the target set; blocked inserts raise 42501.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  CLUB_A,
  SEEDED_DRILL,
  expectRlsInsertRefusal,
  runId,
  serviceClient,
  signIn,
} from './stack'

const RUN = runId()
const titlePrefix = `SEC TEST drill ${RUN}`

describe('drills row level security', () => {
  let admin: SupabaseClient
  let coachOne: SupabaseClient
  let coachTwo: SupabaseClient
  let parent: SupabaseClient
  let outsider: SupabaseClient
  let coachOneId: string
  let coachDrillId: string

  beforeAll(async () => {
    const a = await signIn('admin')
    const c1 = await signIn('coachOne')
    const c2 = await signIn('coachTwo')
    const p = await signIn('parent')
    const o = await signIn('outsider')
    admin = a.client
    coachOne = c1.client
    coachTwo = c2.client
    parent = p.client
    outsider = o.client
    coachOneId = c1.userId
  })

  afterAll(async () => {
    await serviceClient().from('drills').delete().like('title', `${titlePrefix}%`)
  })

  it('admin, coach and parent all read club drills', async () => {
    for (const client of [admin, coachOne, parent]) {
      const { data, error } = await client.from('drills').select('id').limit(5)
      expect(error).toBeNull()
      expect(data?.length ?? 0).toBeGreaterThan(0)
    }
  })

  it('a member of another club reads none of this club drills', async () => {
    const { data, error } = await outsider.from('drills').select('id').eq('club_id', CLUB_A)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('a coach holding drills.create can create a drill', async () => {
    const { data, error } = await coachOne
      .from('drills')
      .insert({ club_id: CLUB_A, title: `${titlePrefix} by coach one`, created_by: coachOneId })
      .select('id')
      .single()
    expect(error).toBeNull()
    expect(data?.id).toBeTruthy()
    coachDrillId = data!.id
  })

  it('the owner can edit their own drill', async () => {
    const { data, error } = await coachOne
      .from('drills')
      .update({ summary: 'edited by owner' })
      .eq('id', coachDrillId)
      .select('id')
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
  })

  it('a different coach cannot edit another coach drill without drills.manage', async () => {
    const { data, error } = await coachTwo
      .from('drills')
      .update({ summary: 'should never land' })
      .eq('id', coachDrillId)
      .select('id')
    expect(error).toBeNull()
    expect(data).toEqual([])
    const { data: row } = await serviceClient()
      .from('drills')
      .select('summary')
      .eq('id', coachDrillId)
      .single()
    expect(row?.summary).toBe('edited by owner')
  })

  it('a different coach cannot delete another coach drill without drills.manage', async () => {
    const { data, error } = await coachTwo.from('drills').delete().eq('id', coachDrillId).select('id')
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('parent cannot create a drill', async () => {
    const { error } = await parent
      .from('drills')
      .insert({ club_id: CLUB_A, title: `${titlePrefix} by parent` })
    expectRlsInsertRefusal(error)
  })

  it('parent cannot update a club drill', async () => {
    const { data, error } = await parent
      .from('drills')
      .update({ summary: 'should never land' })
      .eq('id', SEEDED_DRILL)
      .select('id')
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('parent cannot delete a club drill', async () => {
    const { data, error } = await parent.from('drills').delete().eq('id', SEEDED_DRILL).select('id')
    expect(error).toBeNull()
    expect(data).toEqual([])
    const { data: still } = await serviceClient().from('drills').select('id').eq('id', SEEDED_DRILL)
    expect(still).toHaveLength(1)
  })

  it('admin, holding drills.manage, can edit and delete any club drill', async () => {
    const { data: updated, error: updateErr } = await admin
      .from('drills')
      .update({ summary: 'edited by manager' })
      .eq('id', coachDrillId)
      .select('id')
    expect(updateErr).toBeNull()
    expect(updated).toHaveLength(1)

    const { data: deleted, error: deleteErr } = await admin
      .from('drills')
      .delete()
      .eq('id', coachDrillId)
      .select('id')
    expect(deleteErr).toBeNull()
    expect(deleted).toHaveLength(1)
  })
})
