// Media table RLS matrix (the database rows, not the Storage objects, which
// storage.test.ts covers). Intended contract mirrors drills: club-wide
// reads; insert requires media.create; update and delete require ownership
// plus media.create, or media.manage. The rows created here are youtube
// entries so no Storage object is involved.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { CLUB_A, expectRlsInsertRefusal, runId, serviceClient, signIn } from './stack'

const RUN = runId()
const namePrefix = `SEC TEST media ${RUN}`

describe('media row level security', () => {
  let admin: SupabaseClient
  let coachOne: SupabaseClient
  let coachTwo: SupabaseClient
  let parent: SupabaseClient
  let coachOneId: string
  let mediaId: string

  beforeAll(async () => {
    const a = await signIn('admin')
    const c1 = await signIn('coachOne')
    const c2 = await signIn('coachTwo')
    const p = await signIn('parent')
    admin = a.client
    coachOne = c1.client
    coachTwo = c2.client
    parent = p.client
    coachOneId = c1.userId
  })

  afterAll(async () => {
    await serviceClient().from('media').delete().like('name', `${namePrefix}%`)
  })

  it('admin, coach and parent all read club media rows', async () => {
    for (const client of [admin, coachOne, parent]) {
      const { data, error } = await client.from('media').select('id').limit(5)
      expect(error).toBeNull()
      expect(data?.length ?? 0).toBeGreaterThan(0)
    }
  })

  it('a coach holding media.create can create a media row', async () => {
    const { data, error } = await coachOne
      .from('media')
      .insert({
        club_id: CLUB_A,
        name: `${namePrefix} by coach one`,
        type: 'youtube',
        yt_url: 'https://youtu.be/',
        created_by: coachOneId,
      })
      .select('id')
      .single()
    expect(error).toBeNull()
    expect(data?.id).toBeTruthy()
    mediaId = data!.id
  })

  it('the owner can edit their own media row', async () => {
    const { data, error } = await coachOne
      .from('media')
      .update({ kind: 'pitch' })
      .eq('id', mediaId)
      .select('id')
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
  })

  it('a different coach cannot edit or delete another coach media row without media.manage', async () => {
    const { data: updated, error: updateErr } = await coachTwo
      .from('media')
      .update({ kind: 'should never land' })
      .eq('id', mediaId)
      .select('id')
    expect(updateErr).toBeNull()
    expect(updated).toEqual([])

    const { data: deleted, error: deleteErr } = await coachTwo
      .from('media')
      .delete()
      .eq('id', mediaId)
      .select('id')
    expect(deleteErr).toBeNull()
    expect(deleted).toEqual([])
  })

  it('parent cannot create a media row', async () => {
    const { error } = await parent.from('media').insert({
      club_id: CLUB_A,
      name: `${namePrefix} by parent`,
      type: 'youtube',
      yt_url: 'https://youtu.be/',
    })
    expectRlsInsertRefusal(error)
  })

  it('parent cannot update or delete a club media row', async () => {
    const { data: updated, error: updateErr } = await parent
      .from('media')
      .update({ kind: 'should never land' })
      .eq('id', mediaId)
      .select('id')
    expect(updateErr).toBeNull()
    expect(updated).toEqual([])

    const { data: deleted, error: deleteErr } = await parent
      .from('media')
      .delete()
      .eq('id', mediaId)
      .select('id')
    expect(deleteErr).toBeNull()
    expect(deleted).toEqual([])
  })

  it('admin, holding media.manage, can edit and delete any club media row', async () => {
    const { data: updated, error: updateErr } = await admin
      .from('media')
      .update({ kind: 'edited by manager' })
      .eq('id', mediaId)
      .select('id')
    expect(updateErr).toBeNull()
    expect(updated).toHaveLength(1)

    const { data: deleted, error: deleteErr } = await admin
      .from('media')
      .delete()
      .eq('id', mediaId)
      .select('id')
    expect(deleteErr).toBeNull()
    expect(deleted).toHaveLength(1)
  })
})
