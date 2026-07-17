// audit_events append only boundary and the private writer (0030_audit_foundation).
//
// Intended contract (docs/security/app-audit-boundary.md,
// docs/adr/ADR-0006-app-audit-events.md, docs/security/registered-players-threat-model.md):
//   * Reads require club_id = my_club() AND has_perm('audit.view'). Admin and
//     manager hold audit.view by default; coach and parent do not; an
//     outsider is scoped out by the club arm even when they hold audit.view
//     in their own club. Anon reads nothing.
//   * The table is append only for every client role: authenticated holds
//     SELECT only, so insert, update and delete are refused at the grant
//     (42501), and there are no write policies. Anon holds nothing.
//   * The private writer log_audit_event is service_role only (EXECUTE
//     revoked from anon and authenticated). Its actor, actor name, club and
//     timestamp are derived server side and cannot be supplied; a
//     name shaped value cannot enter safe_changes or metadata.
//   * The same transaction guarantee: a rolled back write leaves no event.
//
// This PR adds NO player or season triggers, so no player linked event is
// produced yet; every event here is a synthetic fixture written through the
// service role or the writer. Names used are synthetic, never real children.

import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { CLUB_A, CLUB_B, anonClient, runId, serviceClient, signIn } from './stack'

const RUN = runId()
const MARK = `sec-audit-${RUN}`

// Run SQL directly inside the local database container, the only way to
// prove a transaction that writes an event and then rolls back (PostgREST
// commits each request, so a rollback cannot be expressed over supabase-js).
// Mirrors the docker exec path tests/security/global-setup.ts already uses.
function dbContainer(): string {
  const configToml = readFileSync(join(process.cwd(), 'supabase', 'config.toml'), 'utf8')
  const projectId = /^project_id\s*=\s*"([^"]+)"/m.exec(configToml)?.[1]
  if (!projectId) throw new Error('could not read project_id from supabase/config.toml')
  return `supabase_db_${projectId}`
}

function runSqlInContainer(sql: string): void {
  execSync(`docker exec -i ${dbContainer()} psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f -`, {
    input: sql,
    stdio: ['pipe', 'ignore', 'pipe'],
  })
}

describe('audit_events append only boundary', () => {
  let admin: SupabaseClient
  let manager: SupabaseClient
  let coachOne: SupabaseClient
  let parent: SupabaseClient
  let outsider: SupabaseClient
  let eventA: string // a club A event
  let eventB: string // a club B event

  beforeAll(async () => {
    admin = (await signIn('admin')).client
    manager = (await signIn('manager')).client
    coachOne = (await signIn('coachOne')).client
    parent = (await signIn('parent')).client
    outsider = (await signIn('outsider')).client

    // Seed one synthetic event in each club through the service role (it
    // bypasses RLS and keeps its grants, the sanctioned fixture path).
    const { data: a, error: aErr } = await serviceClient()
      .from('audit_events')
      .insert({
        club_id: CLUB_A,
        action: 'player.updated',
        entity_type: 'player',
        source: 'manual',
        actor_name: `Security Test Actor ${RUN}`,
        request_id: `${MARK}-A`,
      })
      .select('id')
      .single()
    if (aErr) throw new Error(`could not seed the club A audit event: ${aErr.message}`)
    eventA = a!.id

    const { data: b, error: bErr } = await serviceClient()
      .from('audit_events')
      .insert({
        club_id: CLUB_B,
        action: 'player.updated',
        entity_type: 'player',
        source: 'manual',
        request_id: `${MARK}-B`,
      })
      .select('id')
      .single()
    if (bErr) throw new Error(`could not seed the club B audit event: ${bErr.message}`)
    eventB = b!.id
  })

  afterAll(async () => {
    await serviceClient().from('audit_events').delete().like('request_id', `${MARK}%`)
  })

  // ---- Read matrix -----------------------------------------------------

  it('admin with audit.view reads same club audit events', async () => {
    const { data, error } = await admin.from('audit_events').select('id').eq('id', eventA)
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
  })

  it('manager with audit.view reads same club audit events', async () => {
    const { data, error } = await manager.from('audit_events').select('id').eq('id', eventA)
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
  })

  it('a coach without audit.view reads zero audit rows', async () => {
    const { data, error } = await coachOne.from('audit_events').select('id')
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('a parent reads zero audit rows', async () => {
    const { data, error } = await parent.from('audit_events').select('id')
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('an outsider reads zero rows of this club, even holding audit.view in their own club', async () => {
    // The outsider is a club B coach granted audit.view in club B. They read
    // their own club's event but nothing of club A: the isolation is the
    // club_id arm, not the absence of the capability.
    const { data: own, error: ownErr } = await outsider.from('audit_events').select('id').eq('id', eventB)
    expect(ownErr).toBeNull()
    expect(own).toHaveLength(1)

    const { data: crossId, error: crossErr } = await outsider.from('audit_events').select('id').eq('id', eventA)
    expect(crossErr).toBeNull()
    expect(crossId).toEqual([])

    const { data: allVisible } = await outsider.from('audit_events').select('club_id')
    expect((allVisible ?? []).every((r: { club_id: string }) => r.club_id === CLUB_B)).toBe(true)
  })

  it('cross club events cannot be read (admin in club A never sees a club B event)', async () => {
    const { data, error } = await admin.from('audit_events').select('id').eq('id', eventB)
    expect(error).toBeNull()
    expect(data).toEqual([])
    const { data: allVisible } = await admin.from('audit_events').select('club_id')
    expect((allVisible ?? []).every((r: { club_id: string }) => r.club_id === CLUB_A)).toBe(true)
  })

  it('anon cannot read audit rows', async () => {
    const anon = anonClient()
    const { data, error } = await anon.from('audit_events').select('id')
    // No grant to anon, so PostgREST refuses; either way nothing is returned.
    expect(error !== null || (data ?? []).length === 0).toBe(true)
  })

  // ---- Append only write matrix ---------------------------------------

  it('authenticated clients cannot directly insert audit rows', async () => {
    for (const client of [admin, coachOne, parent]) {
      const { error } = await client.from('audit_events').insert({
        club_id: CLUB_A,
        action: 'player.updated',
        entity_type: 'player',
        source: 'manual',
        request_id: `${MARK}-insert`,
      })
      expect(error).not.toBeNull()
      expect(error?.code).toBe('42501')
    }
    // Nothing landed.
    const { data } = await serviceClient().from('audit_events').select('id').eq('request_id', `${MARK}-insert`)
    expect(data).toEqual([])
  })

  it('authenticated clients cannot update audit rows', async () => {
    // Admin can read eventA but must not be able to change it. The refusal is
    // at the grant (SELECT only), so it is 42501, not RLS zero rows.
    const { error } = await admin.from('audit_events').update({ action: 'tampered' }).eq('id', eventA)
    expect(error).not.toBeNull()
    expect(error?.code).toBe('42501')
    const { data } = await serviceClient().from('audit_events').select('action').eq('id', eventA).single()
    expect(data!.action).toBe('player.updated')
  })

  it('authenticated clients cannot delete audit rows', async () => {
    const { error } = await admin.from('audit_events').delete().eq('id', eventA)
    expect(error).not.toBeNull()
    expect(error?.code).toBe('42501')
    const { data } = await serviceClient().from('audit_events').select('id').eq('id', eventA)
    expect(data).toHaveLength(1)
  })

  it('anon cannot write audit rows', async () => {
    const { error } = await anonClient().from('audit_events').insert({
      club_id: CLUB_A,
      action: 'player.updated',
      entity_type: 'player',
      source: 'manual',
      request_id: `${MARK}-anon`,
    })
    expect(error).not.toBeNull()
    const { data } = await serviceClient().from('audit_events').select('id').eq('request_id', `${MARK}-anon`)
    expect(data).toEqual([])
  })

  // ---- The private writer boundary ------------------------------------

  it('the private writer is not executable by anon or authenticated', async () => {
    const args = { p_action: 'players.exported', p_entity_type: 'export', p_source: 'manual', p_club_id: CLUB_A }
    const authed = await coachOne.rpc('log_audit_event', args)
    expect(authed.error).not.toBeNull()
    expect(authed.error?.code).toBe('42501')
    const anon = await anonClient().rpc('log_audit_event', args)
    expect(anon.error).not.toBeNull()
  })

  it('a trusted writer call derives occurred_at server side', async () => {
    const before = Date.now()
    const { data: id, error } = await serviceClient().rpc('log_audit_event', {
      p_action: 'players.exported',
      p_entity_type: 'export',
      p_source: 'manual',
      p_club_id: CLUB_A,
      p_metadata: { record_count: 3, format: 'csv', name_search_applied: false },
      p_request_id: `${MARK}-writer`,
    })
    const after = Date.now()
    expect(error).toBeNull()
    expect(id).toBeTruthy()
    const { data: row } = await serviceClient()
      .from('audit_events')
      .select('occurred_at, actor_id, actor_name, club_id, source, entity_type')
      .eq('id', id as string)
      .single()
    const occurred = new Date(row!.occurred_at).getTime()
    // Allow a second of clock skew either side of the request window.
    expect(occurred).toBeGreaterThanOrEqual(before - 1000)
    expect(occurred).toBeLessThanOrEqual(after + 1000)
    expect(row!.club_id).toBe(CLUB_A)
  })

  it('actor identity cannot be forged through supplied arguments', async () => {
    // A service role (system) call has no session, so the derived actor is
    // null; there is no actor argument to override it.
    const { data: id } = await serviceClient().rpc('log_audit_event', {
      p_action: 'players.exported',
      p_entity_type: 'export',
      p_source: 'manual',
      p_club_id: CLUB_A,
      p_request_id: `${MARK}-actor`,
    })
    const { data: row } = await serviceClient()
      .from('audit_events')
      .select('actor_id, actor_name')
      .eq('id', id as string)
      .single()
    expect(row!.actor_id).toBeNull()
    expect(row!.actor_name).toBeNull()

    // The function exposes no actor parameter: an attempt to supply one is a
    // signature mismatch, not a silently honoured forgery.
    const forged = await serviceClient().rpc('log_audit_event', {
      p_action: 'players.exported',
      p_entity_type: 'export',
      p_source: 'manual',
      p_club_id: CLUB_A,
      p_actor_id: '00000000-0000-0000-0000-000000000000',
    })
    expect(forged.error).not.toBeNull()
  })

  it('club identity cannot be forged through supplied arguments', async () => {
    // A system caller cannot fabricate an event for a club that does not
    // exist; the club is validated, never blindly trusted.
    const ghost = await serviceClient().rpc('log_audit_event', {
      p_action: 'players.exported',
      p_entity_type: 'export',
      p_source: 'manual',
      p_club_id: '99999999-9999-9999-9999-999999999999',
      p_request_id: `${MARK}-ghost`,
    })
    expect(ghost.error).not.toBeNull()
    const { data } = await serviceClient().from('audit_events').select('id').eq('request_id', `${MARK}-ghost`)
    expect(data).toEqual([])
  })

  it('no child name shaped value can enter metadata through the writer', async () => {
    // A name shaped key is not in the metadata allow list.
    const named = await serviceClient().rpc('log_audit_event', {
      p_action: 'players.exported',
      p_entity_type: 'export',
      p_source: 'manual',
      p_club_id: CLUB_A,
      p_metadata: { display_name: 'Synthetic Child Name' },
      p_request_id: `${MARK}-meta1`,
    })
    expect(named.error).not.toBeNull()

    // A free text value under an allow listed text key is refused too: the
    // text keys are bounded to a fixed vocabulary, so a name cannot ride in.
    const freeText = await serviceClient().rpc('log_audit_event', {
      p_action: 'players.exported',
      p_entity_type: 'export',
      p_source: 'manual',
      p_club_id: CLUB_A,
      p_metadata: { format: 'Synthetic Child Name' },
      p_request_id: `${MARK}-meta2`,
    })
    expect(freeText.error).not.toBeNull()

    const { data } = await serviceClient()
      .from('audit_events')
      .select('id')
      .in('request_id', [`${MARK}-meta1`, `${MARK}-meta2`])
    expect(data).toEqual([])
  })

  it('no child name shaped value can enter safe_changes, even for the service role', async () => {
    // The safe_changes allow list is a check constraint, so it binds every
    // writer including the service role: display_name is not an allowed key.
    const { error } = await serviceClient().from('audit_events').insert({
      club_id: CLUB_A,
      action: 'player.updated',
      entity_type: 'player',
      source: 'manual',
      safe_changes: { display_name: { old: 'Old Synthetic', new: 'New Synthetic' } },
      request_id: `${MARK}-safe`,
    })
    expect(error).not.toBeNull()
    expect(error?.code).toBe('23514')
    // A safe_changes payload restricted to the allow list is accepted.
    const { error: okErr } = await serviceClient().from('audit_events').insert({
      club_id: CLUB_A,
      action: 'player.status_changed',
      entity_type: 'player',
      source: 'manual',
      safe_changes: { status: { old: 'pending', new: 'registered' } },
      request_id: `${MARK}-safe-ok`,
    })
    expect(okErr).toBeNull()
  })

  it('a rolled back transaction leaves no audit event', async () => {
    const marker = `${MARK}-rollback`
    // Inside one transaction: write an event through the writer, then roll
    // back. Under the same transaction guarantee, nothing must persist.
    runSqlInContainer(
      `begin;` +
        ` select public.log_audit_event(` +
        `p_action => 'players.exported', p_entity_type => 'export', p_source => 'manual',` +
        ` p_club_id => '${CLUB_A}', p_request_id => '${marker}');` +
        ` rollback;`,
    )
    const { data } = await serviceClient().from('audit_events').select('id').eq('request_id', marker)
    expect(data).toEqual([])
  })

  // ---- Reservation rules -----------------------------------------------

  it('audit.view is a normal grantable capability, not reserved', async () => {
    // A disposable custom role, so no shared fixture is disturbed. Granting
    // audit.view to a non admin role succeeds: the reserved trigger guards
    // only users.manage and club.manage, which the existing capabilities
    // suite continues to prove.
    const { data: role, error: roleErr } = await serviceClient()
      .from('roles')
      .insert({ club_id: CLUB_A, key: `sec_audit_${RUN}`, label: 'Sec Audit Test', system: false })
      .select('id')
      .single()
    expect(roleErr).toBeNull()
    try {
      const { error } = await admin.from('role_capabilities').insert({ role_id: role!.id, capability: 'audit.view' })
      expect(error).toBeNull()
    } finally {
      await serviceClient().from('roles').delete().eq('id', role!.id)
    }
  })
})
