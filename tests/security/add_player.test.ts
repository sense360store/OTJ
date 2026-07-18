// add_player, the transactional creation path (0032_registered_players.sql).
// SECURITY INVOKER, so the players and registration RLS bind both inserts: it
// commits the stable identity and its current season registration together
// (never one without the other), requires players.manage, derives the club and
// actor server side, supports Unassigned, never dedupes on name, and is
// idempotent under an ambiguous retry with the same client minted id. A failed
// call leaves neither row and no audit event; a parent or a view only coach is
// refused. Exactly two audit events per successful add: player.created and
// player.registration_created. Synthetic names only.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { TEST_TEAM, runId, serviceClient, signIn } from './stack'

const RUN = runId()
const name = (s: string) => `SEC ADD ${RUN} ${s}`
const uuid = () => crypto.randomUUID()

async function auditFor(entityId: string): Promise<string[]> {
  const { data } = await serviceClient()
    .from('audit_events')
    .select('action')
    .eq('entity_id', entityId)
    .order('occurred_at', { ascending: true })
  return (data ?? []).map((r) => r.action as string)
}

// The two events of an atomic add share one occurred_at, so their row order is
// not guaranteed. Compare as a multiset, which still catches a missing or
// duplicate event.
function expectActions(actions: string[], expected: string[]): void {
  expect([...actions].sort()).toEqual([...expected].sort())
}

describe('add_player transactional creation', () => {
  let admin: SupabaseClient
  let coachOne: SupabaseClient
  let parent: SupabaseClient

  beforeAll(async () => {
    admin = (await signIn('admin')).client
    coachOne = (await signIn('coachOne')).client
    parent = (await signIn('parent')).client
  })

  afterAll(async () => {
    await serviceClient().from('players').delete().like('display_name', `SEC ADD ${RUN} %`)
  })

  it('an admin add commits identity plus registration and writes exactly the two events', async () => {
    const id = uuid()
    const { data, error } = await admin.rpc('add_player', {
      p_id: id,
      p_display_name: name('commit'),
      p_team_id: TEST_TEAM,
      p_shirt_number: 7,
      p_status: 'registered',
      p_registered_date: null,
    })
    expect(error).toBeNull()
    const row = Array.isArray(data) ? data[0] : data
    expect(row.id).toBe(id)
    expect(row.team_id).toBe(TEST_TEAM)
    expect(row.shirt_number).toBe(7)
    expect(row.display_name).toBe(name('commit'))

    const { data: identity } = await serviceClient().from('players').select('id').eq('id', id)
    expect(identity).toHaveLength(1)
    const { data: reg } = await serviceClient().from('player_registrations').select('id').eq('player_id', id)
    expect(reg).toHaveLength(1)
    expectActions(await auditFor(id), ['player.created', 'player.registration_created'])
  })

  it('an ambiguous retry with the same stable id does not duplicate the child', async () => {
    const id = uuid()
    const args = {
      p_id: id,
      p_display_name: name('retry'),
      p_team_id: TEST_TEAM,
      p_shirt_number: 8,
      p_status: 'registered',
      p_registered_date: null,
    }
    const first = await admin.rpc('add_player', args)
    expect(first.error).toBeNull()
    const second = await admin.rpc('add_player', args)
    expect(second.error).toBeNull()

    const { data: identity } = await serviceClient().from('players').select('id').eq('id', id)
    expect(identity).toHaveLength(1)
    const { data: reg } = await serviceClient().from('player_registrations').select('id').eq('player_id', id)
    expect(reg).toHaveLength(1)
    // Still exactly two events; the retry added nothing.
    expectActions(await auditFor(id), ['player.created', 'player.registration_created'])
  })

  it('a failed add (unknown team) leaves neither row nor any audit event', async () => {
    const id = uuid()
    const { error } = await admin.rpc('add_player', {
      p_id: id,
      p_display_name: name('failed'),
      p_team_id: uuid(), // a team that does not exist: the registration FK fails
      p_shirt_number: null,
      p_status: 'pending',
      p_registered_date: null,
    })
    expect(error).not.toBeNull()
    const { data: identity } = await serviceClient().from('players').select('id').eq('id', id)
    expect(identity).toEqual([])
    const { data: reg } = await serviceClient().from('player_registrations').select('id').eq('player_id', id)
    expect(reg).toEqual([])
    expectActions(await auditFor(id), [])
  })

  it('a parent is refused (42501) and creates nothing', async () => {
    const id = uuid()
    const { error } = await parent.rpc('add_player', {
      p_id: id,
      p_display_name: name('parent'),
      p_team_id: TEST_TEAM,
      p_shirt_number: null,
      p_status: 'pending',
      p_registered_date: null,
    })
    expect(error).not.toBeNull()
    expect(error?.code).toBe('42501')
    const { data } = await serviceClient().from('players').select('id').eq('id', id)
    expect(data).toEqual([])
  })

  it('a view only coach is refused (42501)', async () => {
    const id = uuid()
    const { error } = await coachOne.rpc('add_player', {
      p_id: id,
      p_display_name: name('coach'),
      p_team_id: TEST_TEAM,
      p_shirt_number: null,
      p_status: 'pending',
      p_registered_date: null,
    })
    expect(error).not.toBeNull()
    expect(error?.code).toBe('42501')
    const { data } = await serviceClient().from('players').select('id').eq('id', id)
    expect(data).toEqual([])
  })

  it('Unassigned (null team) is accepted', async () => {
    const id = uuid()
    const { data, error } = await admin.rpc('add_player', {
      p_id: id,
      p_display_name: name('unassigned'),
      p_team_id: null,
      p_shirt_number: null,
      p_status: 'pending',
      p_registered_date: null,
    })
    expect(error).toBeNull()
    const row = Array.isArray(data) ? data[0] : data
    expect(row.team_id).toBeNull()
  })

  it('two children with identical names are both created (no name dedupe)', async () => {
    const idA = uuid()
    const idB = uuid()
    const shared = name('Same Name')
    const a = await admin.rpc('add_player', {
      p_id: idA,
      p_display_name: shared,
      p_team_id: TEST_TEAM,
      p_shirt_number: null,
      p_status: 'pending',
      p_registered_date: null,
    })
    const b = await admin.rpc('add_player', {
      p_id: idB,
      p_display_name: shared,
      p_team_id: TEST_TEAM,
      p_shirt_number: 5,
      p_status: 'pending',
      p_registered_date: null,
    })
    expect(a.error).toBeNull()
    expect(b.error).toBeNull()
    const { data } = await serviceClient().from('players').select('id').eq('display_name', shared)
    expect((data ?? []).length).toBe(2)
  })
})
