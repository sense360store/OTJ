// Feedback RLS matrix (0019_feedback). Feedback is the one insert surface
// deliberately open to the parent role: any member files feedback about the
// app, a creator edits and deletes their own items, and status moves only
// with club.manage (held by a trigger, since with check cannot compare old
// and new). These tests pin that the parent write surface is exactly this
// wide and no wider.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  CLUB_A,
  expectRlsInsertRefusal,
  expectTriggerRefusal,
  runId,
  serviceClient,
  signIn,
} from './stack'

const RUN = runId()
const titlePrefix = `SEC TEST feedback ${RUN}`

describe('feedback row level security', () => {
  let admin: SupabaseClient
  let coachOne: SupabaseClient
  let parent: SupabaseClient
  let coachOneId: string
  let parentId: string
  let parentItemId: string
  let coachItemId: string

  beforeAll(async () => {
    const a = await signIn('admin')
    const c1 = await signIn('coachOne')
    const p = await signIn('parent')
    admin = a.client
    coachOne = c1.client
    parent = p.client
    coachOneId = c1.userId
    parentId = p.userId

    const { data, error } = await coachOne
      .from('feedback')
      .insert({
        club_id: CLUB_A,
        created_by: coachOneId,
        kind: 'general',
        title: `${titlePrefix} by coach`,
      })
      .select('id')
      .single()
    if (error) throw new Error(`could not seed coach feedback: ${error.message}`)
    coachItemId = data!.id
  })

  afterAll(async () => {
    await serviceClient().from('feedback').delete().like('title', `${titlePrefix}%`)
  })

  it('parent can file feedback (the deliberately allowed write surface)', async () => {
    const { data, error } = await parent
      .from('feedback')
      .insert({
        club_id: CLUB_A,
        created_by: parentId,
        kind: 'bug',
        title: `${titlePrefix} by parent`,
      })
      .select('id')
      .single()
    expect(error).toBeNull()
    parentItemId = data!.id
  })

  it('parent can edit their own feedback title and body', async () => {
    const { data, error } = await parent
      .from('feedback')
      .update({ title: `${titlePrefix} by parent, edited` })
      .eq('id', parentItemId)
      .select('id')
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
  })

  it('parent cannot file feedback in another member name', async () => {
    const { error } = await parent.from('feedback').insert({
      club_id: CLUB_A,
      created_by: coachOneId,
      kind: 'general',
      title: `${titlePrefix} spoofed author`,
    })
    expectRlsInsertRefusal(error)
  })

  it('parent cannot file feedback with a pre-set status', async () => {
    const { error } = await parent.from('feedback').insert({
      club_id: CLUB_A,
      created_by: parentId,
      kind: 'general',
      title: `${titlePrefix} pre-triaged`,
      status: 'done',
    })
    expectTriggerRefusal(error, 'club.manage')
  })

  it('parent cannot move the status of their own feedback', async () => {
    const { error } = await parent
      .from('feedback')
      .update({ status: 'done' })
      .eq('id', parentItemId)
    expectTriggerRefusal(error, 'club.manage')
  })

  it('parent cannot edit another member feedback', async () => {
    const { data, error } = await parent
      .from('feedback')
      .update({ title: `${titlePrefix} should never land` })
      .eq('id', coachItemId)
      .select('id')
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('admin, holding club.manage, can move status', async () => {
    const { data, error } = await admin
      .from('feedback')
      .update({ status: 'planned' })
      .eq('id', parentItemId)
      .select('id, status')
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
    expect(data![0].status).toBe('planned')
  })

  it('parent can delete their own feedback and only their own', async () => {
    const { data: notTheirs, error: notTheirsErr } = await parent
      .from('feedback')
      .delete()
      .eq('id', coachItemId)
      .select('id')
    expect(notTheirsErr).toBeNull()
    expect(notTheirs).toEqual([])

    const { data: own, error: ownErr } = await parent
      .from('feedback')
      .delete()
      .eq('id', parentItemId)
      .select('id')
    expect(ownErr).toBeNull()
    expect(own).toHaveLength(1)
  })

  it('the feedback surface grants the parent no other table write (spot check via drills)', async () => {
    const { error } = await parent
      .from('drills')
      .insert({ club_id: CLUB_A, title: `${titlePrefix} drill through feedback role` })
    expectRlsInsertRefusal(error)
  })
})
