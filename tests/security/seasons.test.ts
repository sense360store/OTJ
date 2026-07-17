// Seasons RLS and the one current season invariant (0031_seasons.sql). Read is
// club wide (every member with a club reads their club's seasons); create,
// update, archive and activate require seasons.manage (admin only under the
// approved seed), so a manager, coach or parent is refused. The invariant is
// enforced below RLS for every writer: the partial unique index refuses a
// second current season (23505), and the guard trigger refuses clearing
// is_current outside activate_season, archiving the current season and deleting
// the current season (each P0001). All fixtures are synthetic.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  CLUB_A,
  CLUB_B,
  expectCheckConstraintRefusal,
  expectRlsInsertRefusal,
  expectTriggerRefusal,
  runId,
  serviceClient,
  signIn,
} from './stack'

const RUN = runId()
// Season names are bounded to 20 characters, so use a short, unique, counter
// based label per created season (the tag is only for readability of intent).
const SPREFIX = `s${RUN.slice(0, 6)}-`
let seasonSeq = 0
const label = (_tag: string) => `${SPREFIX}${seasonSeq++}`

async function currentSeasonId(club: string): Promise<string> {
  const { data, error } = await serviceClient()
    .from('seasons')
    .select('id')
    .eq('club_id', club)
    .eq('is_current', true)
    .single()
  if (error || !data) throw new Error(`no current season for ${club}: ${error?.message}`)
  return data.id
}

describe('seasons row level security and invariants', () => {
  let admin: SupabaseClient
  let manager: SupabaseClient
  let coachOne: SupabaseClient
  let parent: SupabaseClient
  let outsider: SupabaseClient
  let seasonA: string

  beforeAll(async () => {
    admin = (await signIn('admin')).client
    manager = (await signIn('manager')).client
    coachOne = (await signIn('coachOne')).client
    parent = (await signIn('parent')).client
    outsider = (await signIn('outsider')).client
    seasonA = await currentSeasonId(CLUB_A)
  })

  afterAll(async () => {
    await serviceClient().from('seasons').delete().like('name', `${SPREFIX}%`)
  })

  // --- Read: club wide ---
  it('a coach with only players.view reads the club seasons', async () => {
    const { data, error } = await coachOne.from('seasons').select('id').eq('id', seasonA)
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
  })

  it('a parent reads the club seasons (club wide read, no capability)', async () => {
    const { data, error } = await parent.from('seasons').select('id').eq('id', seasonA)
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
  })

  it('an outsider cannot read another club seasons', async () => {
    const { data, error } = await outsider.from('seasons').select('id').eq('club_id', CLUB_A)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  // --- Write matrix: create/update require seasons.manage ---
  it('admin (seasons.manage) creates a season', async () => {
    const { data, error } = await admin
      .from('seasons')
      .insert({
        club_id: CLUB_A,
        name: label('create'),
        starts_on: '2030-07-01',
        ends_on: '2031-06-30',
        is_current: false,
        created_by: (await signIn('admin')).userId,
      })
      .select('id')
      .single()
    expect(error).toBeNull()
    expect(data?.id).toBeTruthy()
  })

  it('manager, coach and parent cannot create a season', async () => {
    for (const [who, client] of [
      ['manager', manager],
      ['coach', coachOne],
      ['parent', parent],
    ] as const) {
      const { error } = await client.from('seasons').insert({
        club_id: CLUB_A,
        name: label(`nope-${who}`),
        starts_on: '2032-07-01',
        ends_on: '2033-06-30',
        is_current: false,
      })
      expectRlsInsertRefusal(error)
    }
  })

  it('the insert pins created_by to the writer (a forged created_by is refused)', async () => {
    const outsiderId = (await signIn('outsider')).userId
    const { error } = await admin.from('seasons').insert({
      club_id: CLUB_A,
      name: label('forge'),
      starts_on: '2034-07-01',
      ends_on: '2035-06-30',
      is_current: false,
      created_by: outsiderId,
    })
    expectRlsInsertRefusal(error)
  })

  it('a coach cannot update a season (zero rows, no error)', async () => {
    const { data, error } = await coachOne
      .from('seasons')
      .update({ name: label('coach-edit') })
      .eq('id', seasonA)
      .select('id')
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  // --- The three guard trigger cells (proven below RLS via serviceClient) ---
  it('clearing is_current directly is refused (P0001), even for the service role', async () => {
    const { error } = await serviceClient()
      .from('seasons')
      .update({ is_current: false })
      .eq('id', seasonA)
      .select('id')
    expectTriggerRefusal(error as never, 'current season can only change through activate_season')
  })

  it('archiving the current season directly is refused (P0001)', async () => {
    const { error } = await serviceClient()
      .from('seasons')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', seasonA)
      .select('id')
    expectTriggerRefusal(error as never, 'current season cannot be archived')
  })

  it('deleting the current season is refused: no client delete grant (42501), and P0001 for the service role', async () => {
    // A client holds no DELETE grant on seasons, so the refusal is at the grant.
    const { error: clientErr } = await admin.from('seasons').delete().eq('id', seasonA)
    expect(clientErr).not.toBeNull()
    expect(clientErr?.code).toBe('42501')
    // The service role holds the grant, so the guard trigger is what refuses.
    const { error: svcErr } = await serviceClient().from('seasons').delete().eq('id', seasonA)
    expectTriggerRefusal(svcErr as never, 'current season cannot be deleted')
    // The season still exists.
    const { data } = await serviceClient().from('seasons').select('id').eq('id', seasonA)
    expect(data).toHaveLength(1)
  })

  // --- Upper bound: a second current season is refused by the partial index ---
  it('a second current season is refused by the partial unique index (23505), even for the service role', async () => {
    const { error } = await serviceClient().from('seasons').insert({
      club_id: CLUB_A,
      name: label('second-current'),
      starts_on: '2036-07-01',
      ends_on: '2037-06-30',
      is_current: true,
    })
    expect(error).not.toBeNull()
    expect(error?.code).toBe('23505')
  })

  // --- Date order check constraint ---
  it('a season with ends_on not after starts_on is refused (23514), even for the service role', async () => {
    const { error } = await serviceClient().from('seasons').insert({
      club_id: CLUB_A,
      name: label('badorder'),
      starts_on: '2038-07-01',
      ends_on: '2037-06-30',
      is_current: false,
    })
    expectCheckConstraintRefusal(error as never, 'seasons_dates_ordered')
  })

  // --- activate_season ---
  it('a coach cannot call activate_season', async () => {
    const { error } = await coachOne.rpc('activate_season', { p_season_id: seasonA })
    expect(error).not.toBeNull()
    expect(error?.code).toBe('42501')
  })

  it('activate_season atomically swaps the current season and writes exactly one season.activated event', async () => {
    // A fresh non current season to activate.
    const { data: target, error: seedErr } = await serviceClient()
      .from('seasons')
      .insert({
        club_id: CLUB_A,
        name: label('activate-target'),
        starts_on: '2040-07-01',
        ends_on: '2041-06-30',
        is_current: false,
      })
      .select('id')
      .single()
    expect(seedErr).toBeNull()
    const targetId = target!.id

    const before = new Date().toISOString()
    const { error } = await admin.rpc('activate_season', { p_season_id: targetId })
    expect(error).toBeNull()

    // Exactly one current season in the club, and it is the target.
    const { data: currents } = await serviceClient()
      .from('seasons')
      .select('id')
      .eq('club_id', CLUB_A)
      .eq('is_current', true)
    expect(currents).toHaveLength(1)
    expect(currents![0].id).toBe(targetId)

    // Exactly one season.activated event for the target since `before`.
    const { data: events } = await serviceClient()
      .from('audit_events')
      .select('action, entity_id')
      .eq('entity_id', targetId)
      .eq('action', 'season.activated')
      .gte('occurred_at', before)
    expect(events).toHaveLength(1)

    // Restore the original current season so later tests see the seeded season.
    await admin.rpc('activate_season', { p_season_id: seasonA })
  })
})
