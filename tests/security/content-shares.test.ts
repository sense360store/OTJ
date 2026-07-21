// content_shares and content_share_dependencies: the private public share
// substrate and the service role only lifecycle RPC (0038_content_sharing).
//
// Intended contract (docs/security/content-sharing-boundary.md):
//   * Both tables carry NO client policy and NO client grant: neither anon nor
//     authenticated (not even a shares.manage holder) can read or write them
//     directly. All access is through the service role gated lifecycle RPC.
//   * manage_content_share is service_role only (EXECUTE revoked from anon and
//     authenticated), is the final authority, and re-validates the passed
//     actor's club, sharing capability, source capability, source ownership and
//     source club inside the transaction. A forged actor, a cross club source,
//     a parent, and a coach acting on another coach's source are all refused.
//   * A manager (shares.manage) may revoke any club share but may NOT rotate or
//     refresh another creator's share.
//   * The kill switch fails create, refresh and rotate closed while off; revoke
//     stays allowed.
//   * Only a SHA-256 hash is stored; the raw secret is never stored, logged or
//     returned. Rotate replaces the hash and invalidates the old secret.
//   * A rights downgrade to internal_only invalidates exactly the dependent
//     active shares and clears their snapshots and dependency rows.
//   * Every successful lifecycle action writes exactly one audit event whose
//     metadata carries only allow listed safe scalars, never a secret, hash,
//     snapshot or free text. A refused action writes nothing.
//
// All fixtures are synthetic and created through the service role (which
// bypasses RLS); out of band verification of the private tables is done
// through the local database container as the owner. Nothing here is real
// production data.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  CLUB_A,
  CLUB_B,
  anonClient,
  runId,
  runSqlInContainer,
  serviceClient,
  signIn,
} from './stack'

const RUN = runId()
const MARK = `sec-share-${RUN}`

// A 32 byte SHA-256 shaped secret hash, distinct per call, in the `\x<hex>`
// bytea text form the RPC accepts.
function randHash(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return '\\x' + [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// A single scalar from the private tables, read as the container owner (the
// tables have no client grant, so this is the sanctioned out of band path).
function scalar(sql: string): string {
  return runSqlInContainer(sql).trim()
}

const sqlId = (v: string) => `'${v.replace(/'/g, "''")}'`

let admin: SupabaseClient
let manager: SupabaseClient
let coachOne: SupabaseClient
let anon: SupabaseClient
let svc: SupabaseClient
let coachOneId: string
let coachTwoId: string
let managerId: string
let parentId: string
let outsiderId: string

const createdDrillIds: string[] = []
const createdSessionIds: string[] = []
const createdMediaIds: string[] = []

async function makeDrill(opts: {
  owner: string | null
  rights: 'internal_only' | 'public_link_only' | 'public_full'
  mediaId?: string | null
  club?: string
}): Promise<string> {
  const { data, error } = await svc
    .from('drills')
    .insert({
      club_id: opts.club ?? CLUB_A,
      title: `${MARK}-drill`,
      created_by: opts.owner,
      rights: opts.rights,
      media_id: opts.mediaId ?? null,
    })
    .select('id')
    .single()
  if (error) throw new Error(`makeDrill: ${error.message}`)
  createdDrillIds.push(data!.id)
  return data!.id
}

async function makeMedia(opts: {
  rights: 'internal_only' | 'public_link_only' | 'public_full'
  club?: string
}): Promise<string> {
  const { data, error } = await svc
    .from('media')
    .insert({ club_id: opts.club ?? CLUB_A, name: `${MARK}-media`, type: 'image', rights: opts.rights })
    .select('id')
    .single()
  if (error) throw new Error(`makeMedia: ${error.message}`)
  createdMediaIds.push(data!.id)
  return data!.id
}

async function makeSession(opts: {
  owner: string
  rights: 'internal_only' | 'public_link_only' | 'public_full'
  drillIds?: string[]
  club?: string
}): Promise<string> {
  const activities = (opts.drillIds ?? []).map((id, i) => ({ phase: 'Skill', drill_id: id, duration: 10 + i }))
  const { data, error } = await svc
    .from('sessions')
    .insert({
      club_id: opts.club ?? CLUB_A,
      coach_id: opts.owner,
      name: `${MARK}-session`,
      rights: opts.rights,
      activities,
    })
    .select('id')
    .single()
  if (error) throw new Error(`makeSession: ${error.message}`)
  createdSessionIds.push(data!.id)
  return data!.id
}

async function makeProgramme(opts: {
  owner: string | null
  rights: 'internal_only' | 'public_link_only' | 'public_full'
  club?: string
}): Promise<string> {
  const { data, error } = await svc
    .from('programmes')
    .insert({ club_id: opts.club ?? CLUB_A, name: `${MARK}-prog-${runId()}`, created_by: opts.owner, rights: opts.rights })
    .select('id')
    .single()
  if (error) throw new Error(`makeProgramme: ${error.message}`)
  return data!.id
}

async function makeTemplate(opts: {
  rights: 'internal_only' | 'public_link_only' | 'public_full'
  programmeId?: string | null
  drillIds?: string[]
  club?: string
}): Promise<string> {
  const activities = (opts.drillIds ?? []).map((id) => ({ phase: 'Skill', drill_id: id, duration: 10 }))
  const { data, error } = await svc
    .from('templates')
    .insert({
      club_id: opts.club ?? CLUB_A,
      name: `${MARK}-tmpl-${runId()}`,
      rights: opts.rights,
      programme_id: opts.programmeId ?? null,
      activities,
    })
    .select('id')
    .single()
  if (error) throw new Error(`makeTemplate: ${error.message}`)
  return data!.id
}

async function setKill(enabled: boolean): Promise<void> {
  const { error } = await svc.from('clubs').update({ public_sharing_enabled: enabled }).eq('id', CLUB_A)
  if (error) throw new Error(`setKill: ${error.message}`)
}

// Call the lifecycle RPC as the service role (the trusted caller path).
async function rpc(args: Record<string, unknown>) {
  return svc.rpc('manage_content_share', args)
}

beforeAll(async () => {
  admin = (await signIn('admin')).client
  manager = (await signIn('manager')).client
  coachOne = (await signIn('coachOne')).client
  anon = anonClient()
  svc = serviceClient()
  coachOneId = (await signIn('coachOne')).userId
  coachTwoId = (await signIn('coachTwo')).userId
  managerId = (await signIn('manager')).userId
  parentId = (await signIn('parent')).userId
  outsiderId = (await signIn('outsider')).userId
  await setKill(true)
})

afterAll(async () => {
  // Deleting the sources cascades their shares and dependency rows away.
  if (createdSessionIds.length) await svc.from('sessions').delete().in('id', createdSessionIds)
  await svc.from('templates').delete().like('name', `${MARK}%`)
  await svc.from('programmes').delete().like('name', `${MARK}%`)
  if (createdDrillIds.length) await svc.from('drills').delete().in('id', createdDrillIds)
  if (createdMediaIds.length) await svc.from('media').delete().in('id', createdMediaIds)
  // Remove this file's sharing audit events (it is the only writer of them).
  await svc.from('audit_events').delete().eq('entity_type', 'content_share')
  await setKill(false)
})

// =====================================================================
// Direct table access is refused for every client role
// =====================================================================
describe('content_shares direct access is denied to every client', () => {
  let shareId: string

  beforeAll(async () => {
    await setKill(true)
    const drill = await makeDrill({ owner: coachOneId, rights: 'public_full' })
    const { data, error } = await rpc({
      p_action: 'create',
      p_actor_id: coachOneId,
      p_kind: 'drill',
      p_source_id: drill,
      p_secret_hash: randHash(),
      p_idempotency_key: `${MARK}-direct`,
    })
    if (error) throw new Error(`seed share: ${error.message}`)
    shareId = (data as { share_id: string }).share_id
  })

  it('anon cannot read content_shares', async () => {
    const { data, error } = await anon.from('content_shares').select('id')
    // No grant to anon, so PostgREST refuses (not in the exposed schema) or
    // returns nothing; either way the seeded row is invisible.
    expect(error !== null || (data ?? []).length === 0).toBe(true)
    if (data) expect(data.map((r: { id: string }) => r.id)).not.toContain(shareId)
  })

  it('an authenticated coach cannot read content_shares', async () => {
    const { data, error } = await coachOne.from('content_shares').select('id')
    expect(error !== null || (data ?? []).length === 0).toBe(true)
    if (data) expect(data.map((r: { id: string }) => r.id)).not.toContain(shareId)
  })

  it('a manager (shares.manage) cannot directly read content_shares', async () => {
    const { data, error } = await manager.from('content_shares').select('id')
    expect(error !== null || (data ?? []).length === 0).toBe(true)
    if (data) expect(data.map((r: { id: string }) => r.id)).not.toContain(shareId)
  })

  it('an authenticated coach cannot insert or update content_shares', async () => {
    const ins = await coachOne
      .from('content_shares')
      .insert({ club_id: CLUB_A, kind: 'drill', drill_id: createdDrillIds[0], token_hash: '\\x00' })
    expect(ins.error).not.toBeNull()
    const upd = await coachOne.from('content_shares').update({ revoked_at: new Date().toISOString() }).eq('id', shareId)
    expect(upd.error).not.toBeNull()
    // The row is untouched.
    expect(scalar(`select coalesce(revoked_at::text,'NULL') from public.content_shares where id=${sqlId(shareId)}`)).toBe('NULL')
  })

  it('anon and coach cannot read content_share_dependencies', async () => {
    const a = await anon.from('content_share_dependencies').select('id')
    expect(a.error !== null || (a.data ?? []).length === 0).toBe(true)
    const c = await coachOne.from('content_share_dependencies').select('id')
    expect(c.error !== null || (c.data ?? []).length === 0).toBe(true)
  })
})

// =====================================================================
// The lifecycle RPC is service role only, with exact grants
// =====================================================================
describe('manage_content_share is service role only', () => {
  it('anon and authenticated cannot execute the RPC', async () => {
    const args = { p_action: 'revoke', p_actor_id: coachOneId, p_share_id: crypto.randomUUID() }
    const a = await anon.rpc('manage_content_share', args)
    expect(a.error).not.toBeNull()
    const c = await coachOne.rpc('manage_content_share', args)
    expect(c.error).not.toBeNull()
    expect(c.error?.code).toBe('42501')
    const m = await manager.rpc('manage_content_share', args)
    expect(m.error).not.toBeNull()
    expect(m.error?.code).toBe('42501')
  })

  it('PUBLIC, anon and authenticated hold no EXECUTE, service_role does (exact signature)', () => {
    const sig = 'public.manage_content_share(text, uuid, public.content_share_kind, uuid, uuid, bytea, timestamptz, boolean, text)'
    expect(scalar(`select has_function_privilege('anon', ${sqlId(sig)}, 'EXECUTE')`)).toBe('f')
    expect(scalar(`select has_function_privilege('authenticated', ${sqlId(sig)}, 'EXECUTE')`)).toBe('f')
    expect(scalar(`select has_function_privilege('service_role', ${sqlId(sig)}, 'EXECUTE')`)).toBe('t')
    // The writer and internal helpers are private too.
    expect(scalar(`select has_function_privilege('authenticated', 'public.log_content_share_event(text, text, uuid, uuid, uuid, jsonb)', 'EXECUTE')`)).toBe('f')
    expect(scalar(`select has_function_privilege('authenticated', 'public.content_share_deps(public.content_share_kind, uuid, uuid)', 'EXECUTE')`)).toBe('f')
    expect(scalar(`select has_function_privilege('authenticated', 'public.content_share_invalidate_dependents(text, uuid, uuid, uuid)', 'EXECUTE')`)).toBe('f')
  })

  it('no accidental executable overload exists (exactly one manage_content_share)', () => {
    const count = scalar(
      `select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='manage_content_share'`,
    )
    expect(count).toBe('1')
    // And no variant is executable by authenticated.
    const anyExecutable = scalar(
      `select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace ` +
        `where n.nspname='public' and p.proname='manage_content_share' ` +
        `and has_function_privilege('authenticated', p.oid, 'EXECUTE')`,
    )
    expect(anyExecutable).toBe('0')
  })
})

// =====================================================================
// Create: authority, eligibility, one active share, idempotency
// =====================================================================
describe('create authority and eligibility', () => {
  beforeAll(() => setKill(true))

  it('an owning coach can create a share for eligible own content', async () => {
    const drill = await makeDrill({ owner: coachOneId, rights: 'public_full' })
    const { data, error } = await rpc({
      p_action: 'create', p_actor_id: coachOneId, p_kind: 'drill', p_source_id: drill,
      p_secret_hash: randHash(), p_idempotency_key: `${MARK}-${runId()}`,
    })
    expect(error).toBeNull()
    expect((data as { ok: boolean; status: string }).ok).toBe(true)
    expect((data as { status: string }).status).toBe('active')
  })

  it('a parent cannot create a share (lacks shares.create)', async () => {
    const drill = await makeDrill({ owner: coachOneId, rights: 'public_full' })
    const { error } = await rpc({
      p_action: 'create', p_actor_id: parentId, p_kind: 'drill', p_source_id: drill,
      p_secret_hash: randHash(), p_idempotency_key: `${MARK}-${runId()}`,
    })
    expect(error).not.toBeNull()
  })

  it('a coach cannot share another coach owned source', async () => {
    const drill = await makeDrill({ owner: coachTwoId, rights: 'public_full' })
    const { error } = await rpc({
      p_action: 'create', p_actor_id: coachOneId, p_kind: 'drill', p_source_id: drill,
      p_secret_hash: randHash(), p_idempotency_key: `${MARK}-${runId()}`,
    })
    expect(error).not.toBeNull()
  })

  it('a manager can share any club source (source manage arm)', async () => {
    const drill = await makeDrill({ owner: coachTwoId, rights: 'public_full' })
    const { data, error } = await rpc({
      p_action: 'create', p_actor_id: managerId, p_kind: 'drill', p_source_id: drill,
      p_secret_hash: randHash(), p_idempotency_key: `${MARK}-${runId()}`,
    })
    expect(error).toBeNull()
    expect((data as { ok: boolean }).ok).toBe(true)
  })

  it('an internal_only source is refused', async () => {
    const drill = await makeDrill({ owner: coachOneId, rights: 'internal_only' })
    const { error } = await rpc({
      p_action: 'create', p_actor_id: coachOneId, p_kind: 'drill', p_source_id: drill,
      p_secret_hash: randHash(), p_idempotency_key: `${MARK}-${runId()}`,
    })
    expect(error).not.toBeNull()
  })

  it('an aggregate with one internal_only nested drill is refused', async () => {
    const good = await makeDrill({ owner: coachOneId, rights: 'public_full' })
    const bad = await makeDrill({ owner: coachOneId, rights: 'internal_only' })
    const session = await makeSession({ owner: coachOneId, rights: 'public_full', drillIds: [good, bad] })
    const { error } = await rpc({
      p_action: 'create', p_actor_id: coachOneId, p_kind: 'session', p_source_id: session,
      p_secret_hash: randHash(), p_idempotency_key: `${MARK}-${runId()}`,
    })
    expect(error).not.toBeNull()
  })

  it('an aggregate with one internal_only nested media is refused (fail closed)', async () => {
    const media = await makeMedia({ rights: 'internal_only' })
    const drill = await makeDrill({ owner: coachOneId, rights: 'public_full', mediaId: media })
    const { error } = await rpc({
      p_action: 'create', p_actor_id: coachOneId, p_kind: 'drill', p_source_id: drill,
      p_secret_hash: randHash(), p_idempotency_key: `${MARK}-${runId()}`,
    })
    expect(error).not.toBeNull()
  })

  it('a missing nested entity fails closed', async () => {
    const drill = await makeDrill({ owner: coachOneId, rights: 'public_full' })
    const session = await makeSession({ owner: coachOneId, rights: 'public_full', drillIds: [drill] })
    // Delete the nested drill so the reference dangles.
    await svc.from('drills').delete().eq('id', drill)
    const { error } = await rpc({
      p_action: 'create', p_actor_id: coachOneId, p_kind: 'session', p_source_id: session,
      p_secret_hash: randHash(), p_idempotency_key: `${MARK}-${runId()}`,
    })
    expect(error).not.toBeNull()
  })

  it('one active share per source: a second create returns the existing row', async () => {
    const drill = await makeDrill({ owner: coachOneId, rights: 'public_full' })
    const first = await rpc({
      p_action: 'create', p_actor_id: coachOneId, p_kind: 'drill', p_source_id: drill,
      p_secret_hash: randHash(), p_idempotency_key: `${MARK}-${runId()}`,
    })
    const second = await rpc({
      p_action: 'create', p_actor_id: coachOneId, p_kind: 'drill', p_source_id: drill,
      p_secret_hash: randHash(), p_idempotency_key: `${MARK}-${runId()}`,
    })
    expect(first.error).toBeNull()
    expect(second.error).toBeNull()
    expect((second.data as { share_id: string }).share_id).toBe((first.data as { share_id: string }).share_id)
    expect((second.data as { existing?: boolean }).existing).toBe(true)
    expect(scalar(`select count(*) from public.content_shares where drill_id=${sqlId(drill)} and revoked_at is null`)).toBe('1')
  })

  it('create is idempotent on the same key', async () => {
    const drill = await makeDrill({ owner: coachOneId, rights: 'public_full' })
    const key = `${MARK}-idem-${runId()}`
    const a = await rpc({
      p_action: 'create', p_actor_id: coachOneId, p_kind: 'drill', p_source_id: drill,
      p_secret_hash: randHash(), p_idempotency_key: key,
    })
    const b = await rpc({
      p_action: 'create', p_actor_id: coachOneId, p_kind: 'drill', p_source_id: drill,
      p_secret_hash: randHash(), p_idempotency_key: key,
    })
    expect((b.data as { share_id: string }).share_id).toBe((a.data as { share_id: string }).share_id)
    expect((b.data as { idempotent?: boolean }).idempotent).toBe(true)
  })

  it('a key reused after revoke mints a fresh share, never resurfacing the dead one', async () => {
    const drill = await makeDrill({ owner: coachOneId, rights: 'public_full' })
    const key = `${MARK}-reuse-${runId()}`
    const first = await rpc({
      p_action: 'create', p_actor_id: coachOneId, p_kind: 'drill', p_source_id: drill,
      p_secret_hash: randHash(), p_idempotency_key: key,
    })
    const firstId = (first.data as { share_id: string }).share_id
    await rpc({ p_action: 'revoke', p_actor_id: coachOneId, p_share_id: firstId })
    // Reusing the same key after revoke must not return the revoked share; it
    // mints a fresh active one.
    const second = await rpc({
      p_action: 'create', p_actor_id: coachOneId, p_kind: 'drill', p_source_id: drill,
      p_secret_hash: randHash(), p_idempotency_key: key,
    })
    expect(second.error).toBeNull()
    const secondId = (second.data as { share_id: string }).share_id
    expect(secondId).not.toBe(firstId)
    expect(scalar(`select revoked_at is null from public.content_shares where id=${sqlId(secondId)}`)).toBe('t')
    expect(scalar(`select revoked_at is not null from public.content_shares where id=${sqlId(firstId)}`)).toBe('t')
  })

  it('a cross club actor cannot create a share for a club source', async () => {
    const drill = await makeDrill({ owner: coachOneId, rights: 'public_full' })
    const { error } = await rpc({
      p_action: 'create', p_actor_id: outsiderId, p_kind: 'drill', p_source_id: drill,
      p_secret_hash: randHash(), p_idempotency_key: `${MARK}-${runId()}`,
    })
    expect(error).not.toBeNull()
  })

  it('a club A actor cannot create a share for a club B source', async () => {
    const drillB = await makeDrill({ owner: outsiderId, rights: 'public_full', club: CLUB_B })
    const { error } = await rpc({
      p_action: 'create', p_actor_id: coachOneId, p_kind: 'drill', p_source_id: drillB,
      p_secret_hash: randHash(), p_idempotency_key: `${MARK}-${runId()}`,
    })
    expect(error).not.toBeNull()
  })

  it('a forged (non member) actor is refused', async () => {
    const drill = await makeDrill({ owner: coachOneId, rights: 'public_full' })
    const { error } = await rpc({
      p_action: 'create', p_actor_id: '00000000-0000-0000-0000-0000000000ff', p_kind: 'drill', p_source_id: drill,
      p_secret_hash: randHash(), p_idempotency_key: `${MARK}-${runId()}`,
    })
    expect(error).not.toBeNull()
  })
})

// =====================================================================
// Rotate, refresh, revoke: owner vs manager, secret handling
// =====================================================================
describe('rotate, refresh and revoke authority', () => {
  async function freshDrillShare(owner: string): Promise<{ drill: string; shareId: string; hash: string }> {
    await setKill(true)
    const drill = await makeDrill({ owner, rights: 'public_full' })
    const hash = randHash()
    const { data, error } = await rpc({
      p_action: 'create', p_actor_id: owner, p_kind: 'drill', p_source_id: drill,
      p_secret_hash: hash, p_idempotency_key: `${MARK}-${runId()}`,
    })
    if (error) throw new Error(`freshDrillShare: ${error.message}`)
    return { drill, shareId: (data as { share_id: string }).share_id, hash }
  }

  it('rotate replaces the hash and invalidates the old secret', async () => {
    const { shareId, hash } = await freshDrillShare(coachOneId)
    const before = scalar(`select encode(token_hash,'hex') from public.content_shares where id=${sqlId(shareId)}`)
    expect('\\x' + before).toBe(hash)
    const newHash = randHash()
    const { error } = await rpc({ p_action: 'rotate', p_actor_id: coachOneId, p_share_id: shareId, p_secret_hash: newHash })
    expect(error).toBeNull()
    const after = scalar(`select encode(token_hash,'hex') from public.content_shares where id=${sqlId(shareId)}`)
    expect('\\x' + after).toBe(newHash)
    expect(after).not.toBe(before)
    // rotated_at recorded.
    expect(scalar(`select rotated_at is not null from public.content_shares where id=${sqlId(shareId)}`)).toBe('t')
  })

  it('a manager cannot rotate another coach owned share', async () => {
    const { shareId } = await freshDrillShare(coachOneId)
    const before = scalar(`select encode(token_hash,'hex') from public.content_shares where id=${sqlId(shareId)}`)
    const { error } = await rpc({ p_action: 'rotate', p_actor_id: managerId, p_share_id: shareId, p_secret_hash: randHash() })
    expect(error).not.toBeNull()
    // The hash is untouched.
    expect(scalar(`select encode(token_hash,'hex') from public.content_shares where id=${sqlId(shareId)}`)).toBe(before)
  })

  it('a manager cannot refresh another coach owned share', async () => {
    const { shareId } = await freshDrillShare(coachOneId)
    const { error } = await rpc({ p_action: 'refresh', p_actor_id: managerId, p_share_id: shareId })
    expect(error).not.toBeNull()
  })

  it('refresh keeps the secret and rebuilds the snapshot and dependencies', async () => {
    await setKill(true)
    const d1 = await makeDrill({ owner: coachOneId, rights: 'public_full' })
    const session = await makeSession({ owner: coachOneId, rights: 'public_full', drillIds: [d1] })
    const hash = randHash()
    const created = await rpc({
      p_action: 'create', p_actor_id: coachOneId, p_kind: 'session', p_source_id: session,
      p_secret_hash: hash, p_idempotency_key: `${MARK}-${runId()}`,
    })
    const shareId = (created.data as { share_id: string }).share_id
    const depsBefore = scalar(`select string_agg(dependency_id::text, ',' order by dependency_id) from public.content_share_dependencies where share_id=${sqlId(shareId)}`)
    expect(depsBefore).toContain(d1)
    // Replace the nested drill with a different one.
    const d2 = await makeDrill({ owner: coachOneId, rights: 'public_full' })
    await svc.from('sessions').update({ activities: [{ phase: 'Skill', drill_id: d2, duration: 10 }] }).eq('id', session)
    const { error } = await rpc({ p_action: 'refresh', p_actor_id: coachOneId, p_share_id: shareId })
    expect(error).toBeNull()
    // Secret unchanged.
    expect('\\x' + scalar(`select encode(token_hash,'hex') from public.content_shares where id=${sqlId(shareId)}`)).toBe(hash)
    // Dependency set replaced atomically: d2 present, d1 gone.
    const depsAfter = scalar(`select string_agg(dependency_id::text, ',' order by dependency_id) from public.content_share_dependencies where share_id=${sqlId(shareId)}`)
    expect(depsAfter).toContain(d2)
    expect(depsAfter).not.toContain(d1)
    expect(scalar(`select refreshed_at is not null from public.content_shares where id=${sqlId(shareId)}`)).toBe('t')
  })

  it('a manager can revoke any club share, and revoke clears the snapshot and dependencies', async () => {
    const { shareId } = await freshDrillShare(coachOneId)
    expect(scalar(`select snapshot is not null from public.content_shares where id=${sqlId(shareId)}`)).toBe('t')
    const { error } = await rpc({ p_action: 'revoke', p_actor_id: managerId, p_share_id: shareId })
    expect(error).toBeNull()
    expect(scalar(`select revoked_at is not null from public.content_shares where id=${sqlId(shareId)}`)).toBe('t')
    expect(scalar(`select snapshot is null from public.content_shares where id=${sqlId(shareId)}`)).toBe('t')
    expect(scalar(`select revoked_by::text from public.content_shares where id=${sqlId(shareId)}`)).toBe(managerId)
    expect(scalar(`select count(*) from public.content_share_dependencies where share_id=${sqlId(shareId)}`)).toBe('0')
  })

  it('a parent cannot revoke a share', async () => {
    const { shareId } = await freshDrillShare(coachOneId)
    const { error } = await rpc({ p_action: 'revoke', p_actor_id: parentId, p_share_id: shareId })
    expect(error).not.toBeNull()
    expect(scalar(`select revoked_at is null from public.content_shares where id=${sqlId(shareId)}`)).toBe('t')
  })

  it('a revoked share cannot be revived by refresh or rotate', async () => {
    const { shareId } = await freshDrillShare(coachOneId)
    await rpc({ p_action: 'revoke', p_actor_id: coachOneId, p_share_id: shareId })
    const refresh = await rpc({ p_action: 'refresh', p_actor_id: coachOneId, p_share_id: shareId })
    expect(refresh.error).not.toBeNull()
    const rotate = await rpc({ p_action: 'rotate', p_actor_id: coachOneId, p_share_id: shareId, p_secret_hash: randHash() })
    expect(rotate.error).not.toBeNull()
    // A second revoke is an idempotent no-op, still revoked.
    const second = await rpc({ p_action: 'revoke', p_actor_id: coachOneId, p_share_id: shareId })
    expect(second.error).toBeNull()
    expect((second.data as { already?: boolean }).already).toBe(true)
    expect(scalar(`select revoked_at is not null from public.content_shares where id=${sqlId(shareId)}`)).toBe('t')
  })
})

// =====================================================================
// Kill switch
// =====================================================================
describe('the club kill switch', () => {
  it('defaults false on a club', () => {
    expect(scalar(`select public_sharing_enabled from public.clubs where id=${sqlId(CLUB_B)}`)).toBe('f')
  })

  it('only an admin (club.manage) can change it', async () => {
    // A coach and a manager cannot; an admin can. Reset to true afterwards.
    const c = await coachOne.from('clubs').update({ public_sharing_enabled: true }).eq('id', CLUB_A)
    const m = await manager.from('clubs').update({ public_sharing_enabled: true }).eq('id', CLUB_A)
    // RLS filters the update to zero rows for non holders (no error, no change).
    expect((c.data ?? []).length === 0).toBe(true)
    expect((m.data ?? []).length === 0).toBe(true)
    const a = await admin.from('clubs').update({ public_sharing_enabled: false }).eq('id', CLUB_A).select('id')
    expect(a.error).toBeNull()
    expect((a.data ?? []).length).toBe(1)
  })

  it('create, refresh and rotate are refused while disabled; revoke is allowed', async () => {
    await setKill(true)
    const drill = await makeDrill({ owner: coachOneId, rights: 'public_full' })
    const created = await rpc({
      p_action: 'create', p_actor_id: coachOneId, p_kind: 'drill', p_source_id: drill,
      p_secret_hash: randHash(), p_idempotency_key: `${MARK}-${runId()}`,
    })
    const shareId = (created.data as { share_id: string }).share_id

    await setKill(false)
    const drill2 = await makeDrill({ owner: coachOneId, rights: 'public_full' })
    const create = await rpc({
      p_action: 'create', p_actor_id: coachOneId, p_kind: 'drill', p_source_id: drill2,
      p_secret_hash: randHash(), p_idempotency_key: `${MARK}-${runId()}`,
    })
    expect(create.error).not.toBeNull()
    const refresh = await rpc({ p_action: 'refresh', p_actor_id: coachOneId, p_share_id: shareId })
    expect(refresh.error).not.toBeNull()
    const rotate = await rpc({ p_action: 'rotate', p_actor_id: coachOneId, p_share_id: shareId, p_secret_hash: randHash() })
    expect(rotate.error).not.toBeNull()
    // Revoke still works while disabled.
    const revoke = await rpc({ p_action: 'revoke', p_actor_id: coachOneId, p_share_id: shareId })
    expect(revoke.error).toBeNull()
    expect(scalar(`select revoked_at is not null from public.content_shares where id=${sqlId(shareId)}`)).toBe('t')
    await setKill(true)
  })
})

// =====================================================================
// Expiry policy
// =====================================================================
describe('expiry policy', () => {
  beforeAll(() => setKill(true))

  it('a coach cannot create a no-expiry share (never is reserved to shares.manage)', async () => {
    const drill = await makeDrill({ owner: coachOneId, rights: 'public_full' })
    const { error } = await rpc({
      p_action: 'create', p_actor_id: coachOneId, p_kind: 'drill', p_source_id: drill,
      p_secret_hash: randHash(), p_idempotency_key: `${MARK}-${runId()}`, p_no_expiry: true,
    })
    expect(error).not.toBeNull()
  })

  it('a coach cannot set an expiry beyond 90 days', async () => {
    const drill = await makeDrill({ owner: coachOneId, rights: 'public_full' })
    const far = new Date(Date.now() + 120 * 24 * 3600 * 1000).toISOString()
    const { error } = await rpc({
      p_action: 'create', p_actor_id: coachOneId, p_kind: 'drill', p_source_id: drill,
      p_secret_hash: randHash(), p_idempotency_key: `${MARK}-${runId()}`, p_expires_at: far,
    })
    expect(error).not.toBeNull()
  })

  it('a coach may shorten the expiry within 90 days, and the default is 90 days', async () => {
    const nearDrill = await makeDrill({ owner: coachOneId, rights: 'public_full' })
    const near = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString()
    const shortened = await rpc({
      p_action: 'create', p_actor_id: coachOneId, p_kind: 'drill', p_source_id: nearDrill,
      p_secret_hash: randHash(), p_idempotency_key: `${MARK}-${runId()}`, p_expires_at: near,
    })
    expect(shortened.error).toBeNull()
    const shortId = (shortened.data as { share_id: string }).share_id
    expect(scalar(`select (expires_at < now() + interval '30 days') from public.content_shares where id=${sqlId(shortId)}`)).toBe('t')

    const defDrill = await makeDrill({ owner: coachOneId, rights: 'public_full' })
    const def = await rpc({
      p_action: 'create', p_actor_id: coachOneId, p_kind: 'drill', p_source_id: defDrill,
      p_secret_hash: randHash(), p_idempotency_key: `${MARK}-${runId()}`,
    })
    const defId = (def.data as { share_id: string }).share_id
    // Default expiry lands about 90 days out.
    expect(scalar(`select (expires_at between now() + interval '89 days' and now() + interval '91 days') from public.content_shares where id=${sqlId(defId)}`)).toBe('t')
  })

  it('a manager may create a no-expiry share', async () => {
    const drill = await makeDrill({ owner: managerId, rights: 'public_full' })
    const { data, error } = await rpc({
      p_action: 'create', p_actor_id: managerId, p_kind: 'drill', p_source_id: drill,
      p_secret_hash: randHash(), p_idempotency_key: `${MARK}-${runId()}`, p_no_expiry: true,
    })
    expect(error).toBeNull()
    const shareId = (data as { share_id: string }).share_id
    expect(scalar(`select expires_at is null from public.content_shares where id=${sqlId(shareId)}`)).toBe('t')
  })
})

// =====================================================================
// Rights downgrade invalidation
// =====================================================================
describe('rights downgrade invalidation', () => {
  it('downgrading a nested drill invalidates exactly the dependent share, not others', async () => {
    await setKill(true)
    const shared = await makeDrill({ owner: coachOneId, rights: 'public_full' })
    const session = await makeSession({ owner: coachOneId, rights: 'public_full', drillIds: [shared] })
    const dependent = await rpc({
      p_action: 'create', p_actor_id: coachOneId, p_kind: 'session', p_source_id: session,
      p_secret_hash: randHash(), p_idempotency_key: `${MARK}-${runId()}`,
    })
    const dependentId = (dependent.data as { share_id: string }).share_id

    // An unrelated share that must stay active.
    const otherDrill = await makeDrill({ owner: coachOneId, rights: 'public_full' })
    const unrelated = await rpc({
      p_action: 'create', p_actor_id: coachOneId, p_kind: 'drill', p_source_id: otherDrill,
      p_secret_hash: randHash(), p_idempotency_key: `${MARK}-${runId()}`,
    })
    const unrelatedId = (unrelated.data as { share_id: string }).share_id

    // The owner downgrades the shared drill to internal_only through the normal
    // RLS bound update path (auth.uid() = coachOne drives the trigger).
    const { error } = await coachOne.from('drills').update({ rights: 'internal_only' }).eq('id', shared)
    expect(error).toBeNull()

    // The dependent share is invalidated: revoked, snapshot cleared, deps gone.
    expect(scalar(`select revoked_at is not null from public.content_shares where id=${sqlId(dependentId)}`)).toBe('t')
    expect(scalar(`select snapshot is null from public.content_shares where id=${sqlId(dependentId)}`)).toBe('t')
    expect(scalar(`select count(*) from public.content_share_dependencies where share_id=${sqlId(dependentId)}`)).toBe('0')
    // The unrelated share stays active.
    expect(scalar(`select revoked_at is null from public.content_shares where id=${sqlId(unrelatedId)}`)).toBe('t')
  })

  it('downgrading a nested media invalidates the share that references it', async () => {
    await setKill(true)
    const media = await makeMedia({ rights: 'public_full' })
    const drill = await makeDrill({ owner: coachOneId, rights: 'public_full', mediaId: media })
    const created = await rpc({
      p_action: 'create', p_actor_id: coachOneId, p_kind: 'drill', p_source_id: drill,
      p_secret_hash: randHash(), p_idempotency_key: `${MARK}-${runId()}`,
    })
    const shareId = (created.data as { share_id: string }).share_id
    expect(created.error).toBeNull()
    // Downgrade the media (service role path exercises the system-actor branch).
    await svc.from('media').update({ rights: 'internal_only' }).eq('id', media)
    expect(scalar(`select revoked_at is not null from public.content_shares where id=${sqlId(shareId)}`)).toBe('t')
  })

  it('downgrading a nested template invalidates the programme share that nests it', async () => {
    await setKill(true)
    const drill = await makeDrill({ owner: coachOneId, rights: 'public_full' })
    const programme = await makeProgramme({ owner: coachOneId, rights: 'public_full' })
    const template = await makeTemplate({ rights: 'public_full', programmeId: programme, drillIds: [drill] })
    const created = await rpc({
      p_action: 'create', p_actor_id: coachOneId, p_kind: 'programme', p_source_id: programme,
      p_secret_hash: randHash(), p_idempotency_key: `${MARK}-${runId()}`,
    })
    expect(created.error).toBeNull()
    const shareId = (created.data as { share_id: string }).share_id
    // The template is a recorded dependency; downgrading it invalidates the share.
    await svc.from('templates').update({ rights: 'internal_only' }).eq('id', template)
    expect(scalar(`select revoked_at is not null from public.content_shares where id=${sqlId(shareId)}`)).toBe('t')
  })

  it('downgrading a programme source invalidates its own share', async () => {
    await setKill(true)
    const drill = await makeDrill({ owner: coachOneId, rights: 'public_full' })
    const programme = await makeProgramme({ owner: coachOneId, rights: 'public_full' })
    await makeTemplate({ rights: 'public_full', programmeId: programme, drillIds: [drill] })
    const created = await rpc({
      p_action: 'create', p_actor_id: coachOneId, p_kind: 'programme', p_source_id: programme,
      p_secret_hash: randHash(), p_idempotency_key: `${MARK}-${runId()}`,
    })
    expect(created.error).toBeNull()
    const shareId = (created.data as { share_id: string }).share_id
    await svc.from('programmes').update({ rights: 'internal_only' }).eq('id', programme)
    expect(scalar(`select revoked_at is not null from public.content_shares where id=${sqlId(shareId)}`)).toBe('t')
  })

  it('downgrading a source drill invalidates its own share', async () => {
    await setKill(true)
    const drill = await makeDrill({ owner: coachOneId, rights: 'public_full' })
    const created = await rpc({
      p_action: 'create', p_actor_id: coachOneId, p_kind: 'drill', p_source_id: drill,
      p_secret_hash: randHash(), p_idempotency_key: `${MARK}-${runId()}`,
    })
    const shareId = (created.data as { share_id: string }).share_id
    await coachOne.from('drills').update({ rights: 'internal_only' }).eq('id', drill)
    expect(scalar(`select revoked_at is not null from public.content_shares where id=${sqlId(shareId)}`)).toBe('t')
    // An invalidation audit event was written.
    const { data } = await svc
      .from('audit_events')
      .select('action, metadata')
      .eq('entity_type', 'content_share')
      .eq('entity_id', shareId)
      .eq('action', 'content_share.invalidated')
    expect((data ?? []).length).toBe(1)
    expect((data![0].metadata as { reason_code: string }).reason_code).toBe('rights_downgrade')
  })
})

// =====================================================================
// Cross-club nesting and invalidation isolation
// =====================================================================
describe('cross-club nesting and invalidation isolation', () => {
  it('a club A session that nests a known club B drill uuid cannot be shared', async () => {
    await setKill(true)
    // A real club B drill, eligible in its own club.
    const drillB = await makeDrill({ owner: outsiderId, rights: 'public_full', club: CLUB_B })
    // A club A session whose free-form activities reference that club B drill.
    const sessionA = await makeSession({ owner: coachOneId, rights: 'public_full', drillIds: [drillB] })
    const { error } = await rpc({
      p_action: 'create', p_actor_id: coachOneId, p_kind: 'session', p_source_id: sessionA,
      p_secret_hash: randHash(), p_idempotency_key: `${MARK}-${runId()}`,
    })
    // The club B drill resolves as a missing/cross-club dependency and blocks
    // the share; no cross-club dependency row is ever recorded.
    expect(error).not.toBeNull()
    const { data: share } = await svc.from('content_shares').select('id')
    // (service can read for OOB) no active share exists for this session.
    void share
    expect(scalar(`select count(*) from public.content_shares where session_id=${sqlId(sessionA)}`)).toBe('0')
  })

  it("a club B owner's rights downgrade invalidates only club B shares and never aborts a foreign share", async () => {
    // An active club A share that must remain untouched throughout.
    await setKill(true)
    const drillA = await makeDrill({ owner: coachOneId, rights: 'public_full' })
    const aShare = await rpc({
      p_action: 'create', p_actor_id: coachOneId, p_kind: 'drill', p_source_id: drillA,
      p_secret_hash: randHash(), p_idempotency_key: `${MARK}-${runId()}`,
    })
    const aShareId = (aShare.data as { share_id: string }).share_id

    // A legitimate club B share for a club B drill.
    await svc.from('clubs').update({ public_sharing_enabled: true }).eq('id', CLUB_B)
    const drillB = await makeDrill({ owner: outsiderId, rights: 'public_full', club: CLUB_B })
    const bShare = await rpc({
      p_action: 'create', p_actor_id: outsiderId, p_kind: 'drill', p_source_id: drillB,
      p_secret_hash: randHash(), p_idempotency_key: `${MARK}-${runId()}`,
    })
    expect(bShare.error).toBeNull()
    const bShareId = (bShare.data as { share_id: string }).share_id

    // The club B owner downgrades their own drill. This must not error (no
    // cross-club abort) and must invalidate only the club B share.
    const outsider = (await signIn('outsider')).client
    const { error } = await outsider.from('drills').update({ rights: 'internal_only' }).eq('id', drillB)
    expect(error).toBeNull()
    expect(scalar(`select revoked_at is not null from public.content_shares where id=${sqlId(bShareId)}`)).toBe('t')
    // The unrelated club A share stays active.
    expect(scalar(`select revoked_at is null from public.content_shares where id=${sqlId(aShareId)}`)).toBe('t')

    await svc.from('clubs').update({ public_sharing_enabled: false }).eq('id', CLUB_B)
  })
})

// =====================================================================
// Audit coverage and metadata safety
// =====================================================================
describe('audit coverage and metadata safety', () => {
  it('each successful lifecycle action writes exactly one event with only safe metadata', async () => {
    await setKill(true)
    const drill = await makeDrill({ owner: coachOneId, rights: 'public_full' })
    const created = await rpc({
      p_action: 'create', p_actor_id: coachOneId, p_kind: 'drill', p_source_id: drill,
      p_secret_hash: randHash(), p_idempotency_key: `${MARK}-${runId()}`,
    })
    const shareId = (created.data as { share_id: string }).share_id
    await rpc({ p_action: 'refresh', p_actor_id: coachOneId, p_share_id: shareId })
    await rpc({ p_action: 'rotate', p_actor_id: coachOneId, p_share_id: shareId, p_secret_hash: randHash() })
    await rpc({ p_action: 'revoke', p_actor_id: coachOneId, p_share_id: shareId })

    const { data } = await svc
      .from('audit_events')
      .select('action, metadata, actor_id, actor_name, entity_type')
      .eq('entity_type', 'content_share')
      .eq('entity_id', shareId)
      .order('occurred_at', { ascending: true })
    const actions = (data ?? []).map((r: { action: string }) => r.action)
    expect(actions).toEqual([
      'content_share.created', 'content_share.refreshed', 'content_share.rotated', 'content_share.revoked',
    ])
    const safeKeys = new Set(['source_kind', 'source_id', 'expiry_state', 'reason_code', 'initiator'])
    for (const row of data ?? []) {
      const meta = (row.metadata ?? {}) as Record<string, unknown>
      for (const key of Object.keys(meta)) expect(safeKeys.has(key)).toBe(true)
      // No secret, hash or snapshot shaped key or value anywhere.
      const blob = JSON.stringify(meta).toLowerCase()
      expect(blob).not.toContain('token')
      expect(blob).not.toContain('hash')
      expect(blob).not.toContain('secret')
      expect(blob).not.toContain('snapshot')
      expect(blob).not.toContain('\\x')
      expect((row as { actor_id: string }).actor_id).toBe(coachOneId)
    }
  })

  it('a refused action writes no audit event', async () => {
    const drill = await makeDrill({ owner: coachTwoId, rights: 'public_full' })
    // coachOne cannot share coachTwo's drill; this is refused.
    const { error } = await rpc({
      p_action: 'create', p_actor_id: coachOneId, p_kind: 'drill', p_source_id: drill,
      p_secret_hash: randHash(), p_idempotency_key: `${MARK}-refused-${runId()}`,
    })
    expect(error).not.toBeNull()
    // No share row and no audit event for this source.
    expect(scalar(`select count(*) from public.content_shares where drill_id=${sqlId(drill)}`)).toBe('0')
    const { data } = await svc
      .from('audit_events')
      .select('id, metadata')
      .eq('entity_type', 'content_share')
    const leaked = (data ?? []).filter((r: { metadata: Record<string, unknown> | null }) =>
      (r.metadata as { source_id?: string } | null)?.source_id === drill)
    expect(leaked).toEqual([])
  })

  it('the stored secret is only a hash, and the RPC never returns a secret', async () => {
    await setKill(true)
    const drill = await makeDrill({ owner: coachOneId, rights: 'public_full' })
    const hash = randHash()
    const created = await rpc({
      p_action: 'create', p_actor_id: coachOneId, p_kind: 'drill', p_source_id: drill,
      p_secret_hash: hash, p_idempotency_key: `${MARK}-${runId()}`,
    })
    // The RPC result carries no secret, hash or snapshot.
    const blob = JSON.stringify(created.data).toLowerCase()
    expect(blob).not.toContain('secret')
    expect(blob).not.toContain('token')
    expect(blob).not.toContain('hash')
    expect(blob).not.toContain('snapshot')
    // The stored value is exactly 32 bytes (a SHA-256), and equals the hash we
    // supplied, never a plaintext secret (there is no plaintext column).
    const shareId = (created.data as { share_id: string }).share_id
    expect(scalar(`select octet_length(token_hash) from public.content_shares where id=${sqlId(shareId)}`)).toBe('32')
    expect('\\x' + scalar(`select encode(token_hash,'hex') from public.content_shares where id=${sqlId(shareId)}`)).toBe(hash)
    // There is no column that could hold a plaintext or reversible secret.
    const cols = scalar(
      `select string_agg(column_name, ',') from information_schema.columns where table_schema='public' and table_name='content_shares'`,
    )
    expect(cols).not.toContain('secret')
    expect(cols).not.toContain('plaintext')
  })
})
