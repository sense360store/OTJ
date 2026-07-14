// Sessions RLS matrix. Intended contract: reads are club-wide for every
// member (0002_teams_roles, the current product design: parents watch live
// sessions); insert pins coach_id to the caller and requires
// sessions.create; update and delete require ownership plus
// sessions.create, or sessions.manage.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  CLUB_A,
  SEEDED_SESSION,
  expectRlsInsertRefusal,
  runId,
  serviceClient,
  signIn,
} from './stack'

const RUN = runId()
const namePrefix = `SEC TEST session ${RUN}`

describe('sessions row level security', () => {
  let admin: SupabaseClient
  let coachOne: SupabaseClient
  let coachTwo: SupabaseClient
  let parent: SupabaseClient
  let coachOneId: string
  let parentId: string
  let sessionId: string

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
    parentId = p.userId
  })

  afterAll(async () => {
    await serviceClient().from('sessions').delete().like('name', `${namePrefix}%`)
  })

  it('admin, coach and parent all read club sessions (club-wide read is the product design)', async () => {
    for (const client of [admin, coachOne, parent]) {
      const { data, error } = await client.from('sessions').select('id').limit(5)
      expect(error).toBeNull()
      expect(data?.length ?? 0).toBeGreaterThan(0)
    }
  })

  it('parent cannot create a session, even naming themselves as coach', async () => {
    const { error } = await parent
      .from('sessions')
      .insert({ club_id: CLUB_A, coach_id: parentId, name: `${namePrefix} by parent` })
    expectRlsInsertRefusal(error)
  })

  it('parent cannot modify or delete a club session', async () => {
    const { data: updated, error: updateErr } = await parent
      .from('sessions')
      .update({ focus: 'should never land' })
      .eq('id', SEEDED_SESSION)
      .select('id')
    expect(updateErr).toBeNull()
    expect(updated).toEqual([])

    const { data: deleted, error: deleteErr } = await parent
      .from('sessions')
      .delete()
      .eq('id', SEEDED_SESSION)
      .select('id')
    expect(deleteErr).toBeNull()
    expect(deleted).toEqual([])
    const { data: still } = await serviceClient()
      .from('sessions')
      .select('id')
      .eq('id', SEEDED_SESSION)
    expect(still).toHaveLength(1)
  })

  it('a coach can create and manage their own session', async () => {
    const { data: created, error: insertErr } = await coachOne
      .from('sessions')
      .insert({ club_id: CLUB_A, coach_id: coachOneId, name: `${namePrefix} by coach one` })
      .select('id')
      .single()
    expect(insertErr).toBeNull()
    sessionId = created!.id

    const { data: updated, error: updateErr } = await coachOne
      .from('sessions')
      .update({ focus: 'edited by owner' })
      .eq('id', sessionId)
      .select('id')
    expect(updateErr).toBeNull()
    expect(updated).toHaveLength(1)
  })

  it('a coach cannot create a session naming a different coach', async () => {
    const { error } = await coachTwo
      .from('sessions')
      .insert({ club_id: CLUB_A, coach_id: coachOneId, name: `${namePrefix} spoofed owner` })
    expectRlsInsertRefusal(error)
  })

  it('a different coach cannot edit or delete another coach session without sessions.manage', async () => {
    const { data: updated, error: updateErr } = await coachTwo
      .from('sessions')
      .update({ focus: 'should never land' })
      .eq('id', sessionId)
      .select('id')
    expect(updateErr).toBeNull()
    expect(updated).toEqual([])

    const { data: deleted, error: deleteErr } = await coachTwo
      .from('sessions')
      .delete()
      .eq('id', sessionId)
      .select('id')
    expect(deleteErr).toBeNull()
    expect(deleted).toEqual([])
  })

  it('admin, holding sessions.manage, can edit and delete any club session', async () => {
    const { data: updated, error: updateErr } = await admin
      .from('sessions')
      .update({ focus: 'edited by manager' })
      .eq('id', sessionId)
      .select('id')
    expect(updateErr).toBeNull()
    expect(updated).toHaveLength(1)

    const { data: deleted, error: deleteErr } = await admin
      .from('sessions')
      .delete()
      .eq('id', sessionId)
      .select('id')
    expect(deleteErr).toBeNull()
    expect(deleted).toHaveLength(1)
  })
})
