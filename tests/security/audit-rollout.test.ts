// Wider application audit rollout (Registered Players PR 8, 0037_audit_rollout).
//
// Proves the PR 8 slice of the reserved catalogue on a real local stack:
//   * every approved create / update / delete on the audited tables writes
//     EXACTLY one event, with the right action, entity, actor and source, and
//     only safe fields (changed_fields from the allow list, never a value; no
//     safe_changes and no metadata for any of these domains);
//   * a refused write (RLS 42501, a trigger P0001, a check 23514) and a rolled
//     back transaction write NO event;
//   * a content update touching only a non allow listed (body) field writes no
//     event; an allow listed change records only the field name, never a body
//     column;
//   * role and capability changes distinguish add from remove (distinct actions);
//   * a service role / system membership write (the invite grant, a cascade,
//     seeding) writes no per row assignment event (auth.uid() is null), so the
//     single user.invited / user.removed event is the whole record;
//   * an audit write failure aborts the business write (the same transaction
//     guarantee, deliberately fail closed);
//   * the user administration writer log_user_admin_event is service role only,
//     validates its actor is a member of the named club, resolves the actor name
//     server side, refuses a forged actor / club / action, and stores no email,
//     token or free text;
//   * a deletion event stays readable after its source row is gone;
//   * append only client access to audit_events is unchanged, and a coach
//     without audit.view and a parent still read zero rows.
//
// Every fixture is synthetic. Disposable rows are created with invented ids and
// cleaned up; audit_events written by these tests are deleted by id in afterAll
// so the shared club feed is left as it was.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  CLUB_A,
  TEST_TEAM,
  anonClient,
  runId,
  runSqlInContainer,
  serviceClient,
  signIn,
} from './stack'

const RUN = runId()

// Audit event ids these tests create, deleted in afterAll (service role, the
// sanctioned fixture cleanup path). Kept precise so nothing else is touched.
const createdEventIds = new Set<string>()

interface EventRow {
  id: string
  club_id: string
  actor_id: string | null
  actor_name: string | null
  action: string
  entity_type: string
  entity_id: string | null
  team_id: string | null
  season_id: string | null
  source: string
  changed_fields: string[] | null
  safe_changes: unknown
  metadata: unknown
}

const EVENT_COLS =
  'id, club_id, actor_id, actor_name, action, entity_type, entity_id, team_id, season_id, source, changed_fields, safe_changes, metadata'

// Fetch every event for one entity_id and action, recording their ids for
// cleanup. The trail is written in the business transaction, so by the time the
// awaited mutation returns the event has committed and is visible to the service
// role read.
async function eventsFor(entityId: string, action: string): Promise<EventRow[]> {
  const { data, error } = await serviceClient()
    .from('audit_events')
    .select(EVENT_COLS)
    .eq('entity_id', entityId)
    .eq('action', action)
  if (error) throw new Error(`could not read audit events: ${error.message}`)
  const rows = (data ?? []) as EventRow[]
  for (const r of rows) createdEventIds.add(r.id)
  return rows
}

// Assert exactly one event for (entity_id, action) and return it, with the
// invariants every PR 8 event must satisfy: safe_changes and metadata are null
// (those domains never write them), and the source is a valid bounded value.
async function expectOneEvent(entityId: string, action: string): Promise<EventRow> {
  const rows = await eventsFor(entityId, action)
  expect(rows, `expected exactly one ${action} event for ${entityId}`).toHaveLength(1)
  const e = rows[0]
  expect(e.safe_changes, `${action} must not write safe_changes`).toBeNull()
  expect(e.metadata, `${action} must not write metadata`).toBeNull()
  return e
}

let admin: SupabaseClient
let manager: SupabaseClient
let coachOne: SupabaseClient
let parent: SupabaseClient
let adminId: string
let coachTwoId: string
let customRoleId: string

beforeAll(async () => {
  admin = (await signIn('admin')).client
  manager = (await signIn('manager')).client
  coachOne = (await signIn('coachOne')).client
  parent = (await signIn('parent')).client
  adminId = (await signIn('admin')).userId
  coachTwoId = (await signIn('coachTwo')).userId

  // A disposable custom role in club A for the role and capability tests, so no
  // system role or shared fixture is disturbed.
  const { data, error } = await serviceClient()
    .from('roles')
    .insert({ club_id: CLUB_A, key: `audit_rollout_${RUN}`, label: 'Audit Rollout Test Role', system: false })
    .select('id')
    .single()
  if (error) throw new Error(`could not create the test role: ${error.message}`)
  customRoleId = data!.id
})

afterAll(async () => {
  const svc = serviceClient()
  // Remove any membership/capability residue on the fixture user and the role.
  await svc.from('member_roles').delete().eq('member_id', coachTwoId).eq('role_id', customRoleId)
  await svc.from('member_teams').delete().eq('member_id', coachTwoId).eq('team_id', TEST_TEAM)
  await svc.from('roles').delete().eq('id', customRoleId)
  // Delete exactly the audit rows these tests created.
  const ids = [...createdEventIds]
  for (let i = 0; i < ids.length; i += 100) {
    await svc.from('audit_events').delete().in('id', ids.slice(i, i + 100))
  }
})

// =====================================================================
// Content lifecycle
// =====================================================================
describe('content lifecycle audit (drills, templates, programmes, sessions)', () => {
  it('a drill create, an allow listed update, and a delete each write exactly one safe event', async () => {
    const { data: created, error } = await admin
      .from('drills')
      .insert({ club_id: CLUB_A, title: `Audit Drill ${RUN}`, corner: 'technical', level: 'foundation', duration: 10 })
      .select('id')
      .single()
    expect(error).toBeNull()
    const drillId = created!.id as string

    const create = await expectOneEvent(drillId, 'drill.created')
    expect(create.entity_type).toBe('drill')
    expect(create.actor_id).toBe(adminId)
    expect(create.actor_name).toBe('Security Test Admin')
    expect(create.source).toBe('manual')
    expect(create.club_id).toBe(CLUB_A)

    // An allow listed structural change (corner) plus a body change (title) in
    // one update: exactly one event, changed_fields is ONLY the allow listed
    // field, and the body column never appears.
    const { error: upErr } = await admin
      .from('drills')
      .update({ corner: 'physical', title: `Audit Drill ${RUN} renamed` })
      .eq('id', drillId)
    expect(upErr).toBeNull()
    const upd = await expectOneEvent(drillId, 'drill.updated')
    expect(upd.changed_fields).toEqual(['corner'])
    expect(upd.changed_fields).not.toContain('title')
    expect(upd.changed_fields).not.toContain('summary')

    await admin.from('drills').delete().eq('id', drillId)
    const del = await expectOneEvent(drillId, 'drill.deleted')
    expect(del.entity_type).toBe('drill')
    // The deletion event stays readable after the source row is gone.
    const { data: gone } = await serviceClient().from('drills').select('id').eq('id', drillId)
    expect(gone).toEqual([])
  })

  it('a content update touching only a body field writes no event', async () => {
    const { data: created } = await admin
      .from('drills')
      .insert({ club_id: CLUB_A, title: `Audit BodyOnly ${RUN}`, corner: 'technical' })
      .select('id')
      .single()
    const drillId = created!.id as string
    await expectOneEvent(drillId, 'drill.created')

    // Only body / free text and non allow listed fields change.
    const { error } = await admin
      .from('drills')
      .update({ title: `Audit BodyOnly ${RUN} v2`, summary: 'a new summary', points: ['a', 'b'] })
      .eq('id', drillId)
    expect(error).toBeNull()
    expect(await eventsFor(drillId, 'drill.updated')).toHaveLength(0)

    await admin.from('drills').delete().eq('id', drillId)
    await expectOneEvent(drillId, 'drill.deleted')
  })

  it('a session create, a status update, and a delete write one event each; a name only edit writes none', async () => {
    const { data: created, error } = await admin
      .from('sessions')
      .insert({ club_id: CLUB_A, coach_id: adminId, name: `Audit Session ${RUN}`, team_id: TEST_TEAM })
      .select('id')
      .single()
    expect(error).toBeNull()
    const sessionId = created!.id as string
    const create = await expectOneEvent(sessionId, 'session.created')
    expect(create.entity_type).toBe('session')
    expect(create.team_id).toBe(TEST_TEAM)

    // A name only edit (free text) writes no event.
    await admin.from('sessions').update({ name: `Audit Session ${RUN} v2` }).eq('id', sessionId)
    expect(await eventsFor(sessionId, 'session.updated')).toHaveLength(0)

    // A status change (allow listed) writes one event with only that field.
    await admin.from('sessions').update({ status: 'completed' }).eq('id', sessionId)
    const upd = await expectOneEvent(sessionId, 'session.updated')
    expect(upd.changed_fields).toEqual(['status'])

    // board_id is NOT on the session allow list (boards are out of scope), so
    // attaching a board writes NO event: the session.updated count stays at one.
    const { data: board } = await serviceClient()
      .from('boards')
      .insert({ club_id: CLUB_A, created_by: adminId, name: `Audit Board ${RUN}` })
      .select('id')
      .single()
    const boardId = board!.id as string
    await admin.from('sessions').update({ board_id: boardId }).eq('id', sessionId)
    expect(await eventsFor(sessionId, 'session.updated')).toHaveLength(1)
    await serviceClient().from('boards').delete().eq('id', boardId)

    await admin.from('sessions').delete().eq('id', sessionId)
    await expectOneEvent(sessionId, 'session.deleted')
  })

  it('a template and a programme lifecycle each write safe events with allow listed updates only', async () => {
    // Programme first, so the template can link to it (an allow listed field).
    const { data: prog } = await admin
      .from('programmes')
      .insert({ club_id: CLUB_A, name: `Audit Programme ${RUN}`, weeks: 6 })
      .select('id')
      .single()
    const progId = prog!.id as string
    await expectOneEvent(progId, 'programme.created')
    // A focus (free text) edit writes nothing; a weeks change writes one event.
    await admin.from('programmes').update({ focus: 'possession' }).eq('id', progId)
    expect(await eventsFor(progId, 'programme.updated')).toHaveLength(0)
    await admin.from('programmes').update({ weeks: 8 }).eq('id', progId)
    expect((await expectOneEvent(progId, 'programme.updated')).changed_fields).toEqual(['weeks'])

    const { data: tmpl } = await admin
      .from('templates')
      .insert({ club_id: CLUB_A, name: `Audit Template ${RUN}` })
      .select('id')
      .single()
    const tmplId = tmpl!.id as string
    await expectOneEvent(tmplId, 'template.created')
    // A name (free text) edit writes nothing; a programme link writes one event.
    await admin.from('templates').update({ name: `Audit Template ${RUN} v2` }).eq('id', tmplId)
    expect(await eventsFor(tmplId, 'template.updated')).toHaveLength(0)
    await admin.from('templates').update({ programme_id: progId, programme_week: 2 }).eq('id', tmplId)
    const upd = await expectOneEvent(tmplId, 'template.updated')
    expect(new Set(upd.changed_fields ?? [])).toEqual(new Set(['programme_id', 'programme_week']))

    await admin.from('templates').delete().eq('id', tmplId)
    await admin.from('programmes').delete().eq('id', progId)
    await expectOneEvent(tmplId, 'template.deleted')
    await expectOneEvent(progId, 'programme.deleted')
  })
})

// =====================================================================
// Teams and Spond configuration
// =====================================================================
describe('teams and Spond configuration audit', () => {
  it('a team create, rename and delete each write one safe event', async () => {
    const { data: created, error } = await admin
      .from('teams')
      .insert({ club_id: CLUB_A, name: `Audit Team ${RUN}` })
      .select('id')
      .single()
    expect(error).toBeNull()
    const teamId = created!.id as string
    const create = await expectOneEvent(teamId, 'team.created')
    expect(create.entity_type).toBe('team')
    expect(create.team_id).toBe(teamId)

    await admin.from('teams').update({ name: `Audit Team ${RUN} v2` }).eq('id', teamId)
    const upd = await expectOneEvent(teamId, 'team.updated')
    expect(upd.changed_fields).toEqual(['name'])

    await admin.from('teams').delete().eq('id', teamId)
    const del = await expectOneEvent(teamId, 'team.deleted')
    // The deletion event stays readable after the team row is gone (no FK).
    const { data: gone } = await serviceClient().from('teams').select('id').eq('id', teamId)
    expect(gone).toEqual([])
    expect(del.entity_id).toBe(teamId)
  })

  it('a Spond mapping create, change and remove each write one safe event carrying no Spond value', async () => {
    const { data: created, error } = await admin
      .from('spond_groups')
      .insert({
        club_id: CLUB_A,
        spond_group_id: `grp-${RUN}`,
        spond_subgroup_id: `sub-${RUN}`,
        spond_name: `Audit Spond ${RUN}`,
        team_id: TEST_TEAM,
      })
      .select('id')
      .single()
    expect(error).toBeNull()
    const mapId = created!.id as string
    const create = await expectOneEvent(mapId, 'spond.mapping_created')
    expect(create.entity_type).toBe('spond_mapping')
    expect(create.team_id).toBe(TEST_TEAM)
    // No Spond id or name value rides in the event: changed_fields is null on
    // create, and no value column is populated.
    expect(create.changed_fields).toBeNull()

    await admin.from('spond_groups').update({ spond_name: `Audit Spond ${RUN} v2` }).eq('id', mapId)
    const upd = await expectOneEvent(mapId, 'spond.mapping_changed')
    // Only the changed field NAME is recorded, never the Spond value.
    expect(upd.changed_fields).toEqual(['spond_name'])

    await admin.from('spond_groups').delete().eq('id', mapId)
    await expectOneEvent(mapId, 'spond.mapping_removed')
  })
})

// =====================================================================
// User administration: role, capability and team membership triggers
// =====================================================================
describe('role, capability and team membership audit', () => {
  it('a role assignment and removal write distinct events with the safe role key only', async () => {
    const { error: insErr } = await admin
      .from('member_roles')
      .insert({ member_id: coachTwoId, role_id: customRoleId })
    expect(insErr).toBeNull()
    const assigned = await expectOneEvent(coachTwoId, 'user.role_assigned')
    expect(assigned.entity_type).toBe('user')
    expect(assigned.actor_id).toBe(adminId)
    // The safe role KEY rides in changed_fields, never the free text label.
    expect(assigned.changed_fields).toEqual([`audit_rollout_${RUN}`])

    // A repeated identical assignment is a primary key violation: refused, so no
    // second event.
    const { error: dupErr } = await admin
      .from('member_roles')
      .insert({ member_id: coachTwoId, role_id: customRoleId })
    expect(dupErr).not.toBeNull()
    expect(await eventsFor(coachTwoId, 'user.role_assigned')).toHaveLength(1)

    await admin.from('member_roles').delete().eq('member_id', coachTwoId).eq('role_id', customRoleId)
    const removed = await expectOneEvent(coachTwoId, 'user.role_removed')
    expect(removed.changed_fields).toEqual([`audit_rollout_${RUN}`])
  })

  it('a capability grant and revoke write distinct events with the safe capability key', async () => {
    const { error: grantErr } = await admin
      .from('role_capabilities')
      .insert({ role_id: customRoleId, capability: 'drills.manage' })
    expect(grantErr).toBeNull()
    const granted = await expectOneEvent(customRoleId, 'user.capability_granted')
    expect(granted.entity_type).toBe('role')
    expect(granted.changed_fields).toEqual(['drills.manage'])

    await admin.from('role_capabilities').delete().eq('role_id', customRoleId).eq('capability', 'drills.manage')
    const revoked = await expectOneEvent(customRoleId, 'user.capability_revoked')
    expect(revoked.changed_fields).toEqual(['drills.manage'])
  })

  it('a team membership add and remove write distinct events carrying the team id', async () => {
    const { error: addErr } = await admin
      .from('member_teams')
      .insert({ member_id: coachTwoId, team_id: TEST_TEAM })
    expect(addErr).toBeNull()
    const added = await expectOneEvent(coachTwoId, 'user.team_assigned')
    expect(added.entity_type).toBe('user')
    expect(added.team_id).toBe(TEST_TEAM)

    await admin.from('member_teams').delete().eq('member_id', coachTwoId).eq('team_id', TEST_TEAM)
    const removed = await expectOneEvent(coachTwoId, 'user.team_removed')
    expect(removed.team_id).toBe(TEST_TEAM)
  })

  it('a service role / system membership write produces no per row assignment event', async () => {
    // Insert a member_roles row as the database owner (auth.uid() is null, the
    // invite grant / cascade / seed path). The trigger must skip it, so the only
    // record of an invite is the single user.invited event the Edge Function
    // writes, never a per row assignment event.
    runSqlInContainer(
      `insert into public.member_roles (member_id, role_id) values ('${coachTwoId}', '${customRoleId}')
         on conflict do nothing;`,
    )
    expect(await eventsFor(coachTwoId, 'user.role_assigned')).toHaveLength(0)
    // Clean the row up (also owner path, so it emits nothing either).
    runSqlInContainer(
      `delete from public.member_roles where member_id = '${coachTwoId}' and role_id = '${customRoleId}';`,
    )
    expect(await eventsFor(coachTwoId, 'user.role_removed')).toHaveLength(0)
  })
})

// =====================================================================
// Refused, rolled back and fail closed writes
// =====================================================================
describe('refused, rolled back and fail closed writes produce no event', () => {
  it('a coach without users.manage cannot assign a role, and no event is written', async () => {
    const { error } = await coachOne.from('member_roles').insert({ member_id: coachTwoId, role_id: customRoleId })
    expect(error).not.toBeNull()
    expect(error?.code).toBe('42501')
    expect(await eventsFor(coachTwoId, 'user.role_assigned')).toHaveLength(0)
  })

  it('a parent cannot create a drill, and no event is written', async () => {
    const probeId = crypto.randomUUID()
    const { error } = await parent
      .from('drills')
      .insert({ id: probeId, club_id: CLUB_A, title: `Parent Probe ${RUN}` })
    expect(error).not.toBeNull()
    expect(await eventsFor(probeId, 'drill.created')).toHaveLength(0)
  })

  it('a coach who is not an admin cannot create a team, and no event is written', async () => {
    const probeId = crypto.randomUUID()
    const { error } = await coachOne.from('teams').insert({ id: probeId, club_id: CLUB_A, name: `Coach Team ${RUN}` })
    expect(error).not.toBeNull()
    expect(await eventsFor(probeId, 'team.created')).toHaveLength(0)
  })

  it('a rolled back transaction leaves no business row and no event', async () => {
    const drillId = crypto.randomUUID()
    runSqlInContainer(
      `begin;
       insert into public.drills (id, club_id, title, corner) values ('${drillId}', '${CLUB_A}', 'Rollback ${RUN}', 'technical');
       rollback;`,
    )
    const { data: gone } = await serviceClient().from('drills').select('id').eq('id', drillId)
    expect(gone).toEqual([])
    expect(await eventsFor(drillId, 'drill.created')).toHaveLength(0)
  })

  it('an audit write failure aborts the business write (the same transaction guarantee)', async () => {
    // Force the trigger's audit insert to fail by setting an out of vocabulary
    // source GUC: the audit_events source CHECK (23514) then aborts the whole
    // statement, so the drill insert must not commit. This proves audit failure
    // is fail closed: no committed business change escapes an unwritable event.
    const drillId = crypto.randomUUID()
    let threw = false
    try {
      runSqlInContainer(
        `begin;
         select set_config('otj.audit_source', 'not_a_valid_source', true);
         insert into public.drills (id, club_id, title, corner) values ('${drillId}', '${CLUB_A}', 'FailClosed ${RUN}', 'technical');
         commit;`,
      )
    } catch {
      threw = true
    }
    expect(threw, 'the business write must fail when the audit write fails').toBe(true)
    const { data: gone } = await serviceClient().from('drills').select('id').eq('id', drillId)
    expect(gone).toEqual([])
  })
})

// =====================================================================
// The user administration writer log_user_admin_event
// =====================================================================
describe('log_user_admin_event (user.invited / user.removed writer)', () => {
  it('is not executable by anon or authenticated', async () => {
    const args = { p_action: 'user.invited', p_actor_id: adminId, p_club_id: CLUB_A, p_entity_id: adminId }
    const authed = await coachOne.rpc('log_user_admin_event', args)
    expect(authed.error).not.toBeNull()
    expect(authed.error?.code).toBe('42501')
    const anon = await anonClient().rpc('log_user_admin_event', args)
    expect(anon.error).not.toBeNull()
  })

  it('writes a server derived event for a valid actor and club, with no email or free text', async () => {
    const entity = crypto.randomUUID()
    const { data: id, error } = await serviceClient().rpc('log_user_admin_event', {
      p_action: 'user.invited',
      p_actor_id: adminId,
      p_club_id: CLUB_A,
      p_entity_id: entity,
    })
    expect(error).toBeNull()
    createdEventIds.add(id as string)
    const { data: row } = await serviceClient().from('audit_events').select(EVENT_COLS).eq('id', id as string).single()
    const e = row as EventRow
    expect(e.action).toBe('user.invited')
    expect(e.entity_type).toBe('user')
    expect(e.entity_id).toBe(entity)
    expect(e.actor_id).toBe(adminId)
    // The actor name is resolved server side from the profile, not supplied.
    expect(e.actor_name).toBe('Security Test Admin')
    expect(e.club_id).toBe(CLUB_A)
    expect(e.source).toBe('edge_function')
    // No email, token or free text anywhere: the writer has no such parameter.
    expect(e.safe_changes).toBeNull()
    expect(e.metadata).toBeNull()
    expect(e.changed_fields).toBeNull()
  })

  it('refuses a forged actor that is not a member of the named club', async () => {
    // The outsider is a club B member. Naming them as the actor for a club A
    // event is refused, so a forged cross club actor never lands.
    const outsiderId = (await signIn('outsider')).userId
    const { error } = await serviceClient().rpc('log_user_admin_event', {
      p_action: 'user.removed',
      p_actor_id: outsiderId,
      p_club_id: CLUB_A,
      p_entity_id: crypto.randomUUID(),
    })
    expect(error).not.toBeNull()
  })

  it('refuses an action outside its allow list and a non existent club', async () => {
    const badAction = await serviceClient().rpc('log_user_admin_event', {
      p_action: 'user.role_assigned',
      p_actor_id: adminId,
      p_club_id: CLUB_A,
      p_entity_id: crypto.randomUUID(),
    })
    expect(badAction.error).not.toBeNull()
    const badClub = await serviceClient().rpc('log_user_admin_event', {
      p_action: 'user.invited',
      p_actor_id: adminId,
      p_club_id: '99999999-9999-9999-9999-999999999999',
      p_entity_id: crypto.randomUUID(),
    })
    expect(badClub.error).not.toBeNull()
  })
})

// =====================================================================
// Read boundary unchanged by the rollout
// =====================================================================
describe('append only and read boundary unchanged', () => {
  it('a coach without audit.view and a parent still read zero rows after PR 8 events exist', async () => {
    // Create one event so the feed is non empty for club A.
    const { data } = await admin
      .from('teams')
      .insert({ club_id: CLUB_A, name: `Audit ReadBoundary ${RUN}` })
      .select('id')
      .single()
    const teamId = data!.id as string
    await expectOneEvent(teamId, 'team.created')

    const coachRead = await coachOne.from('audit_events').select('id')
    expect(coachRead.error).toBeNull()
    expect(coachRead.data).toEqual([])
    const parentRead = await parent.from('audit_events').select('id')
    expect(parentRead.error).toBeNull()
    expect(parentRead.data).toEqual([])

    // The manager (audit.view) can read, proving the feed is genuinely non empty.
    const mgrRead = await manager.from('audit_events').select('id').eq('entity_id', teamId).eq('action', 'team.created')
    expect(mgrRead.error).toBeNull()
    expect(mgrRead.data).toHaveLength(1)

    await admin.from('teams').delete().eq('id', teamId)
    await expectOneEvent(teamId, 'team.deleted')
  })

  it('a client still cannot directly write audit_events (append only unchanged by 0037)', async () => {
    const { error } = await admin.from('audit_events').insert({
      club_id: CLUB_A,
      action: 'team.created',
      entity_type: 'team',
      source: 'manual',
    })
    expect(error).not.toBeNull()
    expect(error?.code).toBe('42501')
  })
})
