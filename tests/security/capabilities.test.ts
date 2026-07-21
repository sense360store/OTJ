// Capability consistency: the frontend's capability strings, the seeded SQL
// catalogue, and the reserved capability line must not silently drift.
//
// The React hook useMyCapabilities cannot run from SQL, so the seam is:
//   * a static scan of src/ for capability string literals, checked against
//     the catalogue the local database actually holds;
//   * the RESERVED_CAPABILITIES constant exported by src/lib/data.ts,
//     checked against the catalogue and against the database's own
//     enforcement (RLS for non-holders, the reserved trigger for holders);
//   * the hook's exact two-query read path (member_roles, then
//     role_capabilities) replayed over real JWTs for each role, checked
//     against the capability sets the seed intends.

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { RESERVED_CAPABILITIES } from '../../src/lib/data'
import { CLUB_A, runId, serviceClient, signIn } from './stack'

// The catalogue 0012_rbac seeds, restated here on purpose: if a migration
// adds, renames or removes a capability, this test must be updated in the
// same change, which is exactly the drift tripwire wanted.
const EXPECTED_CATALOGUE = [
  'club.manage',
  'drills.create',
  'drills.manage',
  'media.create',
  'media.manage',
  'programmes.create',
  'programmes.manage',
  'sessions.create',
  'sessions.manage',
  'teams.manage',
  'templates.create',
  'templates.manage',
  'users.manage',
  // 0030 audit foundation: the seven Registered Players and seasons keys.
  'players.view',
  'players.manage',
  'players.import',
  'players.export',
  'players.delete',
  'seasons.manage',
  'audit.view',
  // 0038 content sharing: the two sharing keys.
  'shares.create',
  'shares.manage',
].sort()

// Coach default grants: the five create capabilities (0012), players.view
// (0030) and shares.create (0038). Coaches receive no other new key, and in
// particular not audit.view and not shares.manage.
const COACH_CAPS = [
  'drills.create',
  'media.create',
  'programmes.create',
  'sessions.create',
  'templates.create',
  'players.view',
  'shares.create',
].sort()

// Manager default grants (0012, 0030, 0038): every content key, both sharing
// keys, and the manager subset of the players and audit family, but NOT the
// four admin only keys. Restated so the manager sharing grant is pinned:
// managers hold both shares.create and shares.manage. The keys a manager lacks
// are the two reserved administrative keys (users.manage, club.manage) and the
// two admin only Registered Players keys (players.delete, seasons.manage).
const MANAGER_ONLY_EXCLUDES = ['users.manage', 'club.manage', 'players.delete', 'seasons.manage']
const MANAGER_CAPS = EXPECTED_CATALOGUE.filter((k) => !MANAGER_ONLY_EXCLUDES.includes(k)).sort()

// Extended for 0030 to the players, seasons and audit prefixes and the view,
// import, export and delete verbs, so the frontend drift scan sees the new
// family. Without this the scan is blind to any new capability string.
const CAPABILITY_PATTERN =
  /\b(?:drills|media|templates|programmes|sessions|teams|users|club|players|seasons|audit|shares)\.(?:create|manage|view|import|export|delete)\b/g

function scanFrontendCapabilityStrings(): Set<string> {
  const found = new Set<string>()
  const srcDir = join(process.cwd(), 'src')
  for (const entry of readdirSync(srcDir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue
    if (!/\.(ts|tsx)$/.test(entry.name) || /\.test\./.test(entry.name)) continue
    const text = readFileSync(join(entry.parentPath, entry.name), 'utf8')
    for (const match of text.matchAll(CAPABILITY_PATTERN)) found.add(match[0])
  }
  return found
}

// The exact read path of useMyCapabilities (src/lib/queries.ts), replayed
// over a real JWT: the member's member_roles rows, then the capabilities
// those roles map to.
async function capabilitiesAsTheHookReads(client: SupabaseClient, userId: string): Promise<string[]> {
  const { data: roleRows, error: rolesError } = await client
    .from('member_roles')
    .select('role_id')
    .eq('member_id', userId)
  if (rolesError) throw rolesError
  const roleIds = (roleRows ?? []).map((r: { role_id: string }) => r.role_id)
  if (roleIds.length === 0) return []
  const { data: capRows, error: capsError } = await client
    .from('role_capabilities')
    .select('capability')
    .in('role_id', roleIds)
  if (capsError) throw capsError
  return [...new Set((capRows ?? []).map((rc: { capability: string }) => rc.capability))].sort()
}

describe('capability catalogue consistency', () => {
  let catalogue: Set<string>

  beforeAll(async () => {
    const { client } = await signIn('coachOne')
    const { data, error } = await client.from('capabilities').select('key')
    if (error) throw new Error(`could not read the capabilities catalogue: ${error.message}`)
    catalogue = new Set((data ?? []).map((c: { key: string }) => c.key))
  })

  it('the database catalogue is exactly the known capability set', () => {
    expect([...catalogue].sort()).toEqual(EXPECTED_CATALOGUE)
  })

  it('every capability string referenced by the frontend exists in the catalogue', () => {
    const referenced = scanFrontendCapabilityStrings()
    expect(referenced.size).toBeGreaterThan(0)
    const unknown = [...referenced].filter((cap) => !catalogue.has(cap))
    expect(unknown, `frontend references capabilities missing from the catalogue`).toEqual([])
  })

  it('RESERVED_CAPABILITIES in src/lib/data.ts names real catalogue keys and stays users.manage plus club.manage', () => {
    expect([...RESERVED_CAPABILITIES].sort()).toEqual(['club.manage', 'users.manage'])
    for (const cap of RESERVED_CAPABILITIES) expect(catalogue.has(cap)).toBe(true)
  })

  it('reserved capabilities map only to the admin system role in the database', async () => {
    const { data, error } = await serviceClient()
      .from('role_capabilities')
      .select('capability, roles!inner(key, system)')
      .in('capability', [...RESERVED_CAPABILITIES])
    expect(error).toBeNull()
    const rows = (data ?? []) as unknown as { capability: string; roles: { key: string; system: boolean } }[]
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(row.roles.key).toBe('admin')
      expect(row.roles.system).toBe(true)
    }
  })

  it('a coach cannot grant themselves any capability (RLS refuses without users.manage)', async () => {
    const { client } = await signIn('coachOne')
    const { data: coachRole } = await serviceClient()
      .from('roles')
      .select('id')
      .eq('club_id', CLUB_A)
      .eq('key', 'coach')
      .single()
    const { error } = await client
      .from('role_capabilities')
      .insert({ role_id: coachRole!.id, capability: 'drills.manage' })
    expect(error).not.toBeNull()
    expect(error?.code).toBe('42501')
  })

  it('a coach cannot grant themselves a reserved capability (refused server side)', async () => {
    const { client } = await signIn('coachOne')
    const { data: coachRole } = await serviceClient()
      .from('roles')
      .select('id')
      .eq('club_id', CLUB_A)
      .eq('key', 'coach')
      .single()
    const { error } = await client
      .from('role_capabilities')
      .insert({ role_id: coachRole!.id, capability: 'users.manage' })
    // The reserved-capability trigger (P0001) fires before the RLS with
    // check (42501); either refusal holds the line, and the row must not
    // exist afterwards.
    expect(error).not.toBeNull()
    expect(['42501', 'P0001']).toContain(error?.code)
    const { data: rows } = await serviceClient()
      .from('role_capabilities')
      .select('capability')
      .eq('role_id', coachRole!.id)
      .eq('capability', 'users.manage')
    expect(rows).toEqual([])
  })

  it('even a users.manage holder cannot move a reserved capability off the admin role (trigger refuses)', async () => {
    const { client } = await signIn('admin')
    const { data: coachRole } = await serviceClient()
      .from('roles')
      .select('id')
      .eq('club_id', CLUB_A)
      .eq('key', 'coach')
      .single()
    const { error } = await client
      .from('role_capabilities')
      .insert({ role_id: coachRole!.id, capability: 'users.manage' })
    expect(error).not.toBeNull()
    expect(error?.message ?? '').toContain('reserved')
    // Belt and braces: the row must not exist whatever the API returned.
    const { data: rows } = await serviceClient()
      .from('role_capabilities')
      .select('capability')
      .eq('role_id', coachRole!.id)
      .eq('capability', 'users.manage')
    expect(rows).toEqual([])
  })

  it('the useMyCapabilities read path yields the intended set per role over real JWTs', async () => {
    const admin = await signIn('admin')
    const manager = await signIn('manager')
    const coach = await signIn('coachOne')
    const parent = await signIn('parent')
    // Admin holds every key including both sharing keys; manager holds every
    // non reserved key including both sharing keys; coach holds shares.create
    // but not shares.manage; parent holds neither.
    expect(await capabilitiesAsTheHookReads(admin.client, admin.userId)).toEqual(EXPECTED_CATALOGUE)
    expect(await capabilitiesAsTheHookReads(manager.client, manager.userId)).toEqual(MANAGER_CAPS)
    expect(await capabilitiesAsTheHookReads(coach.client, coach.userId)).toEqual(COACH_CAPS)
    expect(await capabilitiesAsTheHookReads(parent.client, parent.userId)).toEqual([])
  })

  it('the two sharing capabilities are exactly the 0038 addition to the catalogue', () => {
    const sharing = [...catalogue].filter((k) => k.startsWith('shares.')).sort()
    expect(sharing).toEqual(['shares.create', 'shares.manage'])
  })

  it('shares.manage is a normal grantable capability, not reserved', async () => {
    // shares.manage follows the .manage naming convention but is NOT a reserved
    // administrative capability: the reserved set stays users.manage plus
    // club.manage. Granting shares.manage to a non admin custom role succeeds,
    // proving the reserved guard does not touch it. A disposable role, so no
    // shared fixture is disturbed.
    expect(RESERVED_CAPABILITIES).not.toContain('shares.manage')
    const { data: role, error: roleErr } = await serviceClient()
      .from('roles')
      .insert({ club_id: CLUB_A, key: `sec_shares_${runId()}`, label: 'Sec Shares Test', system: false })
      .select('id')
      .single()
    expect(roleErr).toBeNull()
    try {
      const { client } = await signIn('admin')
      const { error } = await client.from('role_capabilities').insert({ role_id: role!.id, capability: 'shares.manage' })
      expect(error).toBeNull()
    } finally {
      await serviceClient().from('roles').delete().eq('id', role!.id)
    }
  })
})
