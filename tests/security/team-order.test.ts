// The club's team order added by 0051: public.teams.sort_order and the
// partial unique index teams_sort_order_unique.
//
// Intended contract (the migration's header states it in full):
//   read    club wide, through the untouched teams_select_club policy. A
//           fresh team reads sort_order null, and any number of a club's
//           teams may be null together: null means the club has not
//           configured its order.
//   write   teams.manage only, through the untouched teams_manage policy. A
//           coach without it, a parent and a member of another club change
//           zero rows and leave no event.
//   index   two non-null positions in one club cannot collide (23505 naming
//           teams_sort_order_unique); the same position in another club is
//           allowed; positions need not be contiguous; a position can be
//           given back.
//   audit   a position change writes one team.updated event with
//           changed_fields ['sort_order'] and no value anywhere; a rename
//           still writes ['name'] alone, so the existing trail is intact.
//
// Every fixture is synthetic: invented names, disposable ids, and no club
// team name anywhere in this file.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { CLUB_A, CLUB_B, anonClient, runId, serviceClient, signIn } from './stack'

const RUN = runId()
const prefix = `SEC TEST order ${RUN}`

interface TeamEvent {
  id: string
  action: string
  entity_type: string
  entity_id: string
  team_id: string | null
  actor_id: string | null
  changed_fields: string[] | null
  safe_changes: unknown
  metadata: unknown
}

const EVENT_COLS = 'id, action, entity_type, entity_id, team_id, actor_id, changed_fields, safe_changes, metadata'

async function eventsFor(teamId: string, action: string): Promise<TeamEvent[]> {
  const { data, error } = await serviceClient()
    .from('audit_events')
    .select(EVENT_COLS)
    .eq('entity_id', teamId)
    .eq('action', action)
  if (error) throw new Error(`could not read audit events: ${error.message}`)
  return (data ?? []) as TeamEvent[]
}

async function positionOf(teamId: string): Promise<number | null> {
  const { data, error } = await serviceClient().from('teams').select('sort_order').eq('id', teamId).single()
  if (error) throw new Error(`could not read the team: ${error.message}`)
  return (data as { sort_order: number | null }).sort_order
}

describe('team order (teams.sort_order, 0051)', () => {
  let admin: SupabaseClient
  let coachOne: SupabaseClient
  let parent: SupabaseClient
  let outsider: SupabaseClient
  let adminId: string
  let teamOne: string
  let teamTwo: string
  let teamOther: string

  beforeAll(async () => {
    const service = serviceClient()
    const a = await signIn('admin')
    admin = a.client
    adminId = a.userId
    coachOne = (await signIn('coachOne')).client
    parent = (await signIn('parent')).client
    outsider = (await signIn('outsider')).client

    const { data, error } = await service
      .from('teams')
      .insert([
        { club_id: CLUB_A, name: `${prefix} one` },
        { club_id: CLUB_A, name: `${prefix} two` },
        { club_id: CLUB_B, name: `${prefix} other club` },
      ])
      .select('id, name')
    if (error) throw new Error(`could not seed the order teams: ${error.message}`)
    const byName = new Map((data as { id: string; name: string }[]).map((t) => [t.name, t.id]))
    teamOne = byName.get(`${prefix} one`)!
    teamTwo = byName.get(`${prefix} two`)!
    teamOther = byName.get(`${prefix} other club`)!
  })

  afterAll(async () => {
    const service = serviceClient()
    await service.from('teams').delete().like('name', `${prefix}%`)
    // The teams' whole trail, including the team.deleted events the line
    // above just wrote.
    await service.from('audit_events').delete().in('entity_id', [teamOne, teamTwo, teamOther])
  })

  // --- Read ---------------------------------------------------------

  it('every club member reads a fresh team with sort_order null, a parent included', async () => {
    for (const client of [admin, coachOne, parent]) {
      const { data, error } = await client.from('teams').select('id, sort_order').eq('id', teamOne)
      expect(error).toBeNull()
      expect(data).toEqual([{ id: teamOne, sort_order: null }])
    }
  })

  it('a member of another club reads none of it', async () => {
    const { data, error } = await outsider.from('teams').select('id, sort_order').eq('id', teamOne)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('an unauthenticated caller reads none of it and changes zero rows', async () => {
    const anon = anonClient()
    const { data: read, error: readErr } = await anon.from('teams').select('id, sort_order').eq('id', teamOne)
    expect(readErr).toBeNull()
    expect(read).toEqual([])
    const { data: wrote, error: writeErr } = await anon.from('teams').update({ sort_order: 1 }).eq('id', teamOne).select('id')
    expect(writeErr).toBeNull()
    expect(wrote).toEqual([])
    expect(await positionOf(teamOne)).toBeNull()
  })

  it('any number of unordered teams coexist in one club', async () => {
    const { data, error } = await admin
      .from('teams')
      .select('id')
      .eq('club_id', CLUB_A)
      .is('sort_order', null)
      .in('id', [teamOne, teamTwo])
    expect(error).toBeNull()
    expect(data).toHaveLength(2)
  })

  // --- Write --------------------------------------------------------

  it('a coach without teams.manage, a parent and an outsider change zero rows and leave no event', async () => {
    for (const client of [coachOne, parent, outsider]) {
      // A blocked UPDATE is filtered by row level security and reaches no
      // row, which PostgREST reports as no error and no rows returned.
      const { data, error } = await client.from('teams').update({ sort_order: 1 }).eq('id', teamOne).select('id')
      expect(error).toBeNull()
      expect(data).toEqual([])
    }
    expect(await positionOf(teamOne)).toBeNull()
    expect(await eventsFor(teamOne, 'team.updated')).toHaveLength(0)
  })

  it('a teams.manage holder sets a position, and the trail is one team.updated naming sort_order and no value', async () => {
    const { data, error } = await admin.from('teams').update({ sort_order: 1 }).eq('id', teamOne).select('id')
    expect(error).toBeNull()
    expect(data).toEqual([{ id: teamOne }])
    expect(await positionOf(teamOne)).toBe(1)

    const events = await eventsFor(teamOne, 'team.updated')
    expect(events).toHaveLength(1)
    const e = events[0]
    expect(e.entity_type).toBe('team')
    expect(e.team_id).toBe(teamOne)
    expect(e.actor_id).toBe(adminId)
    expect(e.changed_fields).toEqual(['sort_order'])
    // Field NAME only, never a value: the position is in no column of the
    // event, and the whole row carries no "1" that could be one.
    expect(e.safe_changes).toBeNull()
    expect(e.metadata).toBeNull()
  })

  // --- The index ----------------------------------------------------

  it('two teams in one club cannot share a position', async () => {
    const { error } = await admin.from('teams').update({ sort_order: 1 }).eq('id', teamTwo).select('id')
    expect(error, 'expected the duplicate position to be refused').not.toBeNull()
    expect(error?.code).toBe('23505')
    expect(error?.message ?? '').toContain('teams_sort_order_unique')
    expect(await positionOf(teamTwo)).toBeNull()
    // The refused statement rolled back with its trigger, so no event.
    expect(await eventsFor(teamTwo, 'team.updated')).toHaveLength(0)
  })

  it('the same position in another club is allowed', async () => {
    // No fixture user holds teams.manage in club B, so the club B position
    // is written as a FIXTURE through the service role, which is never the
    // subject of an assertion here (docs/security/policy-test-matrix.md).
    // What is asserted is what two real members then read: the club B
    // coach sees their team at position 1 while club A's team, read by its
    // own admin, holds position 1 as well. The index is a schema level rule
    // keyed by club, and two clubs sharing a position is the fact under test.
    const { error: seedErr } = await serviceClient().from('teams').update({ sort_order: 1 }).eq('id', teamOther)
    if (seedErr) throw new Error(`could not seed the club B position: ${seedErr.message}`)

    const { data: theirs, error: theirsErr } = await outsider
      .from('teams')
      .select('id, sort_order')
      .eq('id', teamOther)
    expect(theirsErr).toBeNull()
    expect(theirs).toEqual([{ id: teamOther, sort_order: 1 }])

    const { data: ours, error: oursErr } = await admin.from('teams').select('id, sort_order').eq('id', teamOne)
    expect(oursErr).toBeNull()
    expect(ours).toEqual([{ id: teamOne, sort_order: 1 }])
  })

  it('positions need not be contiguous, and a position can be given back', async () => {
    const { data: gap, error: gapErr } = await admin.from('teams').update({ sort_order: 7 }).eq('id', teamTwo).select('id')
    expect(gapErr).toBeNull()
    expect(gap).toEqual([{ id: teamTwo }])

    const { data: freed, error: freedErr } = await admin
      .from('teams')
      .update({ sort_order: null })
      .eq('id', teamOne)
      .select('id')
    expect(freedErr).toBeNull()
    expect(freed).toEqual([{ id: teamOne }])
    expect(await positionOf(teamOne)).toBeNull()

    // Unordering is a change a teams.manage holder made, and it is
    // recorded exactly like ordering: the field name and nothing else.
    const events = await eventsFor(teamOne, 'team.updated')
    expect(events).toHaveLength(2)
    for (const e of events) {
      expect(e.changed_fields).toEqual(['sort_order'])
      expect(e.safe_changes).toBeNull()
      expect(e.metadata).toBeNull()
    }
  })

  // --- The existing trail -------------------------------------------

  it('a rename still records name alone, so the existing allow list is intact', async () => {
    const { error } = await admin.from('teams').update({ name: `${prefix} two, renamed` }).eq('id', teamTwo)
    expect(error).toBeNull()
    const events = await eventsFor(teamTwo, 'team.updated')
    const fields = events.map((e) => e.changed_fields).sort((a, b) => String(a).localeCompare(String(b)))
    expect(fields).toEqual([['name'], ['sort_order']])
  })

  it('no team event written here carries a value', async () => {
    const service = serviceClient()
    const { data, error } = await service
      .from('audit_events')
      .select('id')
      .in('entity_id', [teamOne, teamTwo, teamOther])
      .or('safe_changes.not.is.null,metadata.not.is.null')
    expect(error).toBeNull()
    expect(data).toEqual([])
  })
})
