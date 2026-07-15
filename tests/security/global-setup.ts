// Global setup for the security policy suite. Runs once before the tests
// and prepares idempotent fixtures on the LOCAL stack only:
//
//   * verifies the local stack is running and the migrations plus seed have
//     been applied (fails with instructions otherwise);
//   * creates the disposable test users (admin, two coaches, a parent, and
//     an outsider coach in a second club) through the auth admin API, so the
//     hardened handle_new_user trigger (0029) builds each profile
//     quarantined exactly as production sign-up would;
//   * grants each user their club, role and display primary through
//     grant_club_membership, the same service role only function the
//     invite-user Edge Function calls, so the fixtures walk the real
//     trusted invite path;
//   * creates a second club with its system roles so the club isolation
//     contract is executable while the real seed has a single club;
//   * creates one synthetic team in the seeded club so roster rows can be
//     written (the local seed does not run seed_teams.sql).
//
// Everything is upsert-or-ignore, so repeated runs are safe. Fixture users
// are synthetic: invented names, a reserved test email domain, one shared
// throwaway password. Nothing here ever touches a hosted project; the stack
// helpers refuse non-local URLs.

import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { CLUB_A, CLUB_B, TEST_PASSWORD, TEST_TEAM, TEST_USERS, serviceClient } from './stack'

// A freshly created local stack no longer auto-grants Data API access to
// tables the way the hosted project (created before that change) still has
// it, so without this every pre-0012 table would fail on grants instead of
// exercising RLS. local-grants.sql reproduces the legacy production grants
// on the LOCAL database container only; RLS stays the boundary under test.
function applyLocalGrants(): void {
  const configToml = readFileSync(join(process.cwd(), 'supabase', 'config.toml'), 'utf8')
  const projectId = /^project_id\s*=\s*"([^"]+)"/m.exec(configToml)?.[1]
  if (!projectId) throw new Error('could not read project_id from supabase/config.toml')
  const grants = readFileSync(join(process.cwd(), 'tests', 'security', 'local-grants.sql'), 'utf8')
  try {
    execSync(`docker exec -i supabase_db_${projectId} psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f -`, {
      input: grants,
      stdio: ['pipe', 'ignore', 'pipe'],
    })
  } catch (err) {
    throw new Error(
      'Could not apply tests/security/local-grants.sql to the local database container ' +
        `supabase_db_${projectId}. Is the local stack running? (${(err as Error).message})`,
      { cause: err },
    )
  }
}

async function findUserByEmail(service: SupabaseClient, email: string): Promise<User | null> {
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw new Error(`auth admin listUsers failed: ${error.message}`)
    const hit = data.users.find((u) => u.email === email)
    if (hit) return hit
    if (data.users.length < 200) return null
  }
  return null
}

export default async function setup(): Promise<void> {
  applyLocalGrants()
  const service = serviceClient()

  // The stack must be running with migrations and seed applied.
  const { data: clubA, error: clubErr } = await service
    .from('clubs')
    .select('id')
    .eq('id', CLUB_A)
    .maybeSingle()
  if (clubErr || !clubA) {
    throw new Error(
      'The local stack is not ready for the security suite. Run ' +
        '`npx supabase start` then `npx supabase db reset`, and retry. ' +
        `(${clubErr?.message ?? 'seeded club not found'})`,
    )
  }
  const { data: caps, error: capsErr } = await service.from('capabilities').select('key')
  if (capsErr || !caps || caps.length === 0) {
    throw new Error(
      'The capabilities catalogue is empty; migrations look unapplied. Run `npx supabase db reset`.',
    )
  }

  // Club B: the second tenant for the isolation contract, with the four
  // system roles 0015 would have seeded had the club existed then, and the
  // coach role holding the same create capabilities as club A's coach.
  const { error: clubBErr } = await service
    .from('clubs')
    .upsert(
      { id: CLUB_B, name: 'Security Test Club B', motto: 'Fixture club for policy tests' },
      { onConflict: 'id', ignoreDuplicates: true },
    )
  if (clubBErr) throw new Error(`could not ensure club B: ${clubBErr.message}`)

  const systemRoles = [
    { key: 'admin', label: 'Admin' },
    { key: 'manager', label: 'Manager' },
    { key: 'coach', label: 'Coach' },
    { key: 'parent', label: 'Parent' },
  ]
  const { error: rolesErr } = await service.from('roles').upsert(
    systemRoles.map((r) => ({ club_id: CLUB_B, key: r.key, label: r.label, system: true })),
    { onConflict: 'club_id,key', ignoreDuplicates: true },
  )
  if (rolesErr) throw new Error(`could not ensure club B system roles: ${rolesErr.message}`)

  const { data: clubBCoach } = await service
    .from('roles')
    .select('id')
    .eq('club_id', CLUB_B)
    .eq('key', 'coach')
    .single()
  if (clubBCoach) {
    const createCaps = [
      'drills.create',
      'media.create',
      'templates.create',
      'programmes.create',
      'sessions.create',
    ]
    const { error } = await service.from('role_capabilities').upsert(
      createCaps.map((capability) => ({ role_id: clubBCoach.id, capability })),
      { onConflict: 'role_id,capability', ignoreDuplicates: true },
    )
    if (error) throw new Error(`could not ensure club B coach capabilities: ${error.message}`)
  }

  // One synthetic team in club A so roster rows have a team to belong to.
  const { error: teamErr } = await service
    .from('teams')
    .upsert(
      { id: TEST_TEAM, club_id: CLUB_A, name: 'Security Test Team' },
      { onConflict: 'id', ignoreDuplicates: true },
    )
  if (teamErr) throw new Error(`could not ensure the test team: ${teamErr.message}`)

  // The test users. Created through the auth admin API, where the hardened
  // handle_new_user trigger (0029) builds a quarantined profile, then
  // granted club, role and display primary through grant_club_membership,
  // exactly as the invite-user Edge Function provisions a real invite. The
  // grant is idempotent, so repeated runs converge on the same state.
  for (const spec of Object.values(TEST_USERS)) {
    let user = await findUserByEmail(service, spec.email)
    if (!user) {
      const { data, error } = await service.auth.admin.createUser({
        email: spec.email,
        password: TEST_PASSWORD,
        email_confirm: true,
        user_metadata: { full_name: spec.fullName },
      })
      if (error || !data.user) {
        throw new Error(`could not create test user ${spec.email}: ${error?.message ?? 'no user'}`)
      }
      user = data.user
    }

    const { data: role, error: roleErr } = await service
      .from('roles')
      .select('id')
      .eq('club_id', spec.clubId)
      .eq('key', spec.role)
      .eq('system', true)
      .single()
    if (roleErr || !role) {
      throw new Error(`could not find the ${spec.role} system role in club ${spec.clubId}`)
    }
    const { error: grantErr } = await service.rpc('grant_club_membership', {
      target_member: user.id,
      target_club: spec.clubId,
      role_ids: [role.id],
      display_role: spec.role,
      member_full_name: spec.fullName,
    })
    if (grantErr) {
      throw new Error(
        `could not grant ${spec.role} membership to ${spec.email}: ${grantErr.message}. ` +
          'Is migration 0029_signup_hardening applied? Run `npx supabase db reset`.',
      )
    }
  }
}
