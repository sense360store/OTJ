// The auth membership boundary: client controlled signup metadata grants
// nothing, and club membership flows only through the trusted invite path.
//
// Contract under test (0029_signup_hardening, docs/security/
// auth-membership-boundary.md):
//   * a direct signUp carrying club_id, role and team_id metadata produces a
//     quarantined profile: no club, parent display role, no member_roles, no
//     member_teams, no team;
//   * over a real JWT, a quarantined account reads nothing club scoped,
//     holds zero capabilities and passes no write policy;
//   * grant_club_membership is the single trusted path: it provisions an
//     invited coach and an invited parent exactly as intended, is
//     idempotent, refuses cross club claims, refuses roles and teams from
//     the wrong club, refuses unknown members and empty role sets, and is
//     not executable by anon or authenticated callers;
//   * a duplicate invite for an existing email is refused at the auth
//     layer, and a forged invite token verifies to nothing;
//   * the standing fixtures (invited members) still authenticate and keep
//     their access.
//
// Every disposable account created here uses the reserved test domain and
// is deleted again in afterAll, so repeated runs stay clean.

import { afterAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  CLUB_A,
  CLUB_B,
  SEEDED_DRILL,
  TEST_PASSWORD,
  TEST_TEAM,
  anonClient,
  expectRlsInsertRefusal,
  runId,
  serviceClient,
  signIn,
} from './stack'

const service = serviceClient()
const disposable: string[] = []

function testEmail(tag: string): string {
  return `sec-signup-${tag}-${runId()}@otj-security-tests.local`
}

async function createDirectSignup(metadata: Record<string, unknown>): Promise<{
  client: SupabaseClient
  userId: string
}> {
  // A real POST /auth/v1/signup with the anon key, exactly what any
  // stranger holding the published key can send.
  const client = anonClient()
  const { data, error } = await client.auth.signUp({
    email: testEmail('direct'),
    password: TEST_PASSWORD,
    options: { data: metadata },
  })
  if (error || !data.user) throw new Error(`signUp failed: ${error?.message ?? 'no user'}`)
  disposable.push(data.user.id)
  // The local stack autoconfirms email, so the signup session is live; if a
  // session was not returned, sign in explicitly.
  if (!data.session) {
    const { error: signInError } = await client.auth.signInWithPassword({
      email: data.user.email!,
      password: TEST_PASSWORD,
    })
    if (signInError) throw new Error(`could not sign in as the direct signup: ${signInError.message}`)
  }
  return { client, userId: data.user.id }
}

async function createInvitedMember(roleKey: 'coach' | 'parent'): Promise<{
  client: SupabaseClient
  userId: string
  roleId: string
}> {
  // The invite-user flow as the Edge Function performs it: the auth admin
  // API creates the user (the trigger quarantines the profile), then
  // grant_club_membership provisions club, role and display primary.
  const email = testEmail(`invited-${roleKey}`)
  const { data, error } = await service.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: `Invited ${roleKey} fixture` },
  })
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message ?? 'no user'}`)
  disposable.push(data.user.id)
  const { data: role } = await service
    .from('roles')
    .select('id')
    .eq('club_id', CLUB_A)
    .eq('key', roleKey)
    .eq('system', true)
    .single()
  const { error: grantError } = await service.rpc('grant_club_membership', {
    target_member: data.user.id,
    target_club: CLUB_A,
    role_ids: [role!.id],
  })
  if (grantError) throw new Error(`grant_club_membership failed: ${grantError.message}`)
  const client = anonClient()
  const { error: signInError } = await client.auth.signInWithPassword({ email, password: TEST_PASSWORD })
  if (signInError) throw new Error(`could not sign in as the invited ${roleKey}: ${signInError.message}`)
  return { client, userId: data.user.id, roleId: role!.id }
}

afterAll(async () => {
  for (const id of disposable) {
    await service.auth.admin.deleteUser(id)
  }
})

describe('direct signup with forged metadata', () => {
  it('club_id, role and team_id metadata are all ignored: the profile is quarantined', async () => {
    const { userId } = await createDirectSignup({
      full_name: 'Forged Metadata Attacker',
      club_id: CLUB_A,
      role: 'admin',
      team_id: TEST_TEAM,
    })
    const { data: profile, error } = await service
      .from('profiles')
      .select('club_id, role, team_id, all_teams')
      .eq('id', userId)
      .single()
    expect(error).toBeNull()
    expect(profile?.club_id).toBeNull()
    expect(profile?.role).toBe('parent')
    expect(profile?.team_id).toBeNull()
    expect(profile?.all_teams).toBe(false)

    const { data: roles } = await service.from('member_roles').select('role_id').eq('member_id', userId)
    expect(roles).toEqual([])
    const { data: teams } = await service.from('member_teams').select('team_id').eq('member_id', userId)
    expect(teams).toEqual([])
  })

  it('a direct signup gains no club readable data over a real JWT', async () => {
    const { client } = await createDirectSignup({ club_id: CLUB_A, role: 'admin' })
    for (const table of [
      'drills',
      'media',
      'templates',
      'programmes',
      'sessions',
      'profiles',
      'teams',
      'boards',
      'feedback',
      'spond_events',
      'spond_groups',
      'players',
      'clubs',
    ]) {
      const { data, error } = await client.from(table).select('*').limit(5)
      expect(error, `${table} select should not error`).toBeNull()
      expect(data, `${table} must be empty for a quarantined account`).toEqual([])
    }
    // Storage: the club's objects are invisible and unreadable.
    const { data: objects } = await client.storage.from('media').list(CLUB_A)
    expect(objects ?? []).toEqual([])
  })

  it('a direct signup holds zero capabilities and passes no write policy', async () => {
    const { client, userId } = await createDirectSignup({ club_id: CLUB_A, role: 'admin' })
    const { data: hasPerm } = await client.rpc('has_perm', { capability: 'users.manage' })
    expect(hasPerm).toBe(false)
    const { data: canCreate } = await client.rpc('has_perm', { capability: 'sessions.create' })
    expect(canCreate).toBe(false)

    const { error: drillError } = await client
      .from('drills')
      .insert({ club_id: CLUB_A, title: `quarantine probe ${runId()}` })
    expectRlsInsertRefusal(drillError)

    // feedback insert is the one write open to parents, and it still
    // requires club membership; a quarantined account is refused.
    const { error: feedbackError } = await client
      .from('feedback')
      .insert({ club_id: CLUB_A, created_by: userId, kind: 'bug', title: `quarantine probe ${runId()}` })
    expectRlsInsertRefusal(feedbackError)

    // Self escalation through the profile row is pinned: neither club nor
    // role can be self assigned.
    const { data: climbed } = await client
      .from('profiles')
      .update({ club_id: CLUB_A, role: 'admin' })
      .eq('id', userId)
      .select('id')
    expect(climbed).toEqual([])
    const { data: after } = await service.from('profiles').select('club_id, role').eq('id', userId).single()
    expect(after?.club_id).toBeNull()
    expect(after?.role).toBe('parent')
  })
})

describe('the trusted invite path', () => {
  it('an invited coach receives exactly the intended club, role and capabilities', async () => {
    const { client, userId, roleId } = await createInvitedMember('coach')
    const { data: profile } = await service
      .from('profiles')
      .select('club_id, role')
      .eq('id', userId)
      .single()
    expect(profile?.club_id).toBe(CLUB_A)
    expect(profile?.role).toBe('coach')
    const { data: roles } = await service.from('member_roles').select('role_id').eq('member_id', userId)
    expect((roles ?? []).map((r) => r.role_id)).toEqual([roleId])

    // Over their real JWT: club content is readable and coach writes work.
    const { data: drills, error: drillsError } = await client.from('drills').select('id').limit(1)
    expect(drillsError).toBeNull()
    expect(drills?.length).toBeGreaterThan(0)
    const title = `invited coach probe ${runId()}`
    const { data: created, error: createError } = await client
      .from('drills')
      .insert({ club_id: CLUB_A, title, created_by: userId })
      .select('id')
      .single()
    expect(createError).toBeNull()
    if (created) await service.from('drills').delete().eq('id', created.id)
  })

  it('an invited parent reads club content but holds no capability', async () => {
    const { client, userId } = await createInvitedMember('parent')
    const { data: drills, error } = await client.from('drills').select('id').limit(1)
    expect(error).toBeNull()
    expect(drills?.length).toBeGreaterThan(0)
    const { data: hasCreate } = await client.rpc('has_perm', { capability: 'sessions.create' })
    expect(hasCreate).toBe(false)
    const { error: insertError } = await client
      .from('drills')
      .insert({ club_id: CLUB_A, title: `parent probe ${runId()}`, created_by: userId })
    expectRlsInsertRefusal(insertError)
  })

  it('granting membership is idempotent: an identical repeat is a no-op', async () => {
    const { userId, roleId } = await createInvitedMember('coach')
    const { error } = await service.rpc('grant_club_membership', {
      target_member: userId,
      target_club: CLUB_A,
      role_ids: [roleId],
    })
    expect(error).toBeNull()
    const { data: roles } = await service.from('member_roles').select('role_id').eq('member_id', userId)
    expect(roles?.length).toBe(1)
  })

  it('a role change on an already-provisioned member is refused: use the role editor', async () => {
    // A coach re-grant that asks for the admin role instead must fail
    // closed, not accumulate or swap the role. This is the provisioning
    // versus role-editor boundary.
    const { userId } = await createInvitedMember('coach')
    const { data: adminRole } = await service
      .from('roles')
      .select('id')
      .eq('club_id', CLUB_A)
      .eq('key', 'admin')
      .single()
    const { error } = await service.rpc('grant_club_membership', {
      target_member: userId,
      target_club: CLUB_A,
      role_ids: [adminRole!.id],
    })
    expect(error).not.toBeNull()
    expect(error?.message ?? '').toContain('already provisioned')
    // The member still holds coach only; no admin crept in.
    const { data: roles } = await service
      .from('member_roles')
      .select('roles!inner(key)')
      .eq('member_id', userId)
    const keys = (roles ?? []).map((r) => (r as unknown as { roles: { key: string } }).roles.key)
    expect(keys).toEqual(['coach'])
  })

  it('an admin role cannot survive a later parent-only grant on the provisioning path', async () => {
    // A quarantined member that somehow carries a stale admin assignment
    // (club still null) must not keep it once provisioned: the
    // provisioning path replaces the role set wholesale, it does not add
    // to it.
    const email = testEmail('stale-admin')
    const { data } = await service.auth.admin.createUser({
      email,
      password: TEST_PASSWORD,
      email_confirm: true,
    })
    disposable.push(data.user!.id)
    const { data: adminRole } = await service
      .from('roles')
      .select('id')
      .eq('club_id', CLUB_A)
      .eq('key', 'admin')
      .single()
    const { data: parentRole } = await service
      .from('roles')
      .select('id')
      .eq('club_id', CLUB_A)
      .eq('key', 'parent')
      .single()
    // Plant the stale admin assignment on the still-quarantined member.
    const { error: plantError } = await service
      .from('member_roles')
      .insert({ member_id: data.user!.id, role_id: adminRole!.id })
    expect(plantError).toBeNull()

    // Provision as parent only.
    const { error } = await service.rpc('grant_club_membership', {
      target_member: data.user!.id,
      target_club: CLUB_A,
      role_ids: [parentRole!.id],
    })
    expect(error).toBeNull()

    const { data: roles } = await service
      .from('member_roles')
      .select('roles!inner(key)')
      .eq('member_id', data.user!.id)
    const keys = (roles ?? []).map((r) => (r as unknown as { roles: { key: string } }).roles.key)
    expect(keys).toEqual(['parent'])
    const { data: profile } = await service
      .from('profiles')
      .select('role')
      .eq('id', data.user!.id)
      .single()
    expect(profile?.role).toBe('parent')
  })

  it('concurrent provisioning of one quarantined member cannot diverge', async () => {
    // Two service-role grants for different states fire at once against a
    // freshly quarantined member. The SELECT ... FOR UPDATE row lock
    // serialises them: exactly one provisions, the other blocks, re-reads
    // the committed state and fails closed with "already provisioned".
    // The member ends with a single role, never both.
    const email = testEmail('race')
    const { data } = await service.auth.admin.createUser({
      email,
      password: TEST_PASSWORD,
      email_confirm: true,
    })
    disposable.push(data.user!.id)
    const { data: coachRole } = await service
      .from('roles')
      .select('id')
      .eq('club_id', CLUB_A)
      .eq('key', 'coach')
      .single()
    const { data: parentRole } = await service
      .from('roles')
      .select('id')
      .eq('club_id', CLUB_A)
      .eq('key', 'parent')
      .single()

    const [asCoach, asParent] = await Promise.all([
      service.rpc('grant_club_membership', {
        target_member: data.user!.id,
        target_club: CLUB_A,
        role_ids: [coachRole!.id],
      }),
      service.rpc('grant_club_membership', {
        target_member: data.user!.id,
        target_club: CLUB_A,
        role_ids: [parentRole!.id],
      }),
    ])

    const errors = [asCoach.error, asParent.error]
    const succeeded = errors.filter((e) => e === null)
    const refused = errors.filter((e) => e !== null)
    expect(succeeded).toHaveLength(1)
    expect(refused).toHaveLength(1)
    expect(refused[0]?.message ?? '').toContain('already provisioned')

    // Exactly one role, the winner's, and the profile role agrees.
    const { data: roles } = await service
      .from('member_roles')
      .select('roles!inner(key)')
      .eq('member_id', data.user!.id)
    const keys = (roles ?? []).map((r) => (r as unknown as { roles: { key: string } }).roles.key)
    expect(keys).toHaveLength(1)
    expect(['coach', 'parent']).toContain(keys[0])
    const { data: profile } = await service
      .from('profiles')
      .select('role')
      .eq('id', data.user!.id)
      .single()
    expect(profile?.role).toBe(keys[0])
  })

  it('an invite for club A cannot be claimed into club B', async () => {
    const { userId } = await createInvitedMember('coach')
    const { data: clubBCoach } = await service
      .from('roles')
      .select('id')
      .eq('club_id', CLUB_B)
      .eq('key', 'coach')
      .single()
    const { error } = await service.rpc('grant_club_membership', {
      target_member: userId,
      target_club: CLUB_B,
      role_ids: [clubBCoach!.id],
    })
    expect(error).not.toBeNull()
    expect(error?.message ?? '').toContain('already belongs to a different club')
    const { data: profile } = await service.from('profiles').select('club_id').eq('id', userId).single()
    expect(profile?.club_id).toBe(CLUB_A)
  })

  it('roles and teams from the wrong club are refused, and the member stays quarantined', async () => {
    const email = testEmail('mismatch')
    const { data } = await service.auth.admin.createUser({
      email,
      password: TEST_PASSWORD,
      email_confirm: true,
    })
    disposable.push(data.user!.id)
    const { data: clubBCoach } = await service
      .from('roles')
      .select('id')
      .eq('club_id', CLUB_B)
      .eq('key', 'coach')
      .single()
    const { error: roleMismatch } = await service.rpc('grant_club_membership', {
      target_member: data.user!.id,
      target_club: CLUB_A,
      role_ids: [clubBCoach!.id],
    })
    expect(roleMismatch?.message ?? '').toContain('every role must belong to the target club')

    const { data: clubACoach } = await service
      .from('roles')
      .select('id')
      .eq('club_id', CLUB_A)
      .eq('key', 'coach')
      .single()
    const { error: teamMismatch } = await service.rpc('grant_club_membership', {
      target_member: data.user!.id,
      target_club: CLUB_B,
      role_ids: [clubACoach!.id],
      primary_team: TEST_TEAM,
      member_team_ids: [TEST_TEAM],
    })
    expect(teamMismatch).not.toBeNull()

    const { data: profile } = await service
      .from('profiles')
      .select('club_id, role')
      .eq('id', data.user!.id)
      .single()
    expect(profile?.club_id).toBeNull()
    expect(profile?.role).toBe('parent')
  })

  it('a primary team with a null or empty team set is refused', async () => {
    const { data: clubACoach } = await service
      .from('roles')
      .select('id')
      .eq('club_id', CLUB_A)
      .eq('key', 'coach')
      .single()
    // Empty team set but a primary team named: the primary belongs to no
    // assigned team, so it is refused.
    const empty = await createDirectSignup({})
    const { error: emptyTeams } = await service.rpc('grant_club_membership', {
      target_member: empty.userId,
      target_club: CLUB_A,
      role_ids: [clubACoach!.id],
      primary_team: TEST_TEAM,
      member_team_ids: [],
    })
    expect(emptyTeams).not.toBeNull()
    expect(emptyTeams?.message ?? '').toContain('primary team must be one of the assigned teams')

    // Null team set (member_team_ids omitted) with a primary team named:
    // the null normalises to empty and is refused the same way.
    const nullSet = await createDirectSignup({})
    const { error: nullTeams } = await service.rpc('grant_club_membership', {
      target_member: nullSet.userId,
      target_club: CLUB_A,
      role_ids: [clubACoach!.id],
      primary_team: TEST_TEAM,
    })
    expect(nullTeams).not.toBeNull()
    expect(nullTeams?.message ?? '').toContain('primary team must be one of the assigned teams')

    // Both members stay quarantined.
    for (const id of [empty.userId, nullSet.userId]) {
      const { data: profile } = await service.from('profiles').select('club_id').eq('id', id).single()
      expect(profile?.club_id).toBeNull()
    }
  })

  it('an unknown member and an empty role set both fail closed', async () => {
    const { data: clubACoach } = await service
      .from('roles')
      .select('id')
      .eq('club_id', CLUB_A)
      .eq('key', 'coach')
      .single()
    const { error: missing } = await service.rpc('grant_club_membership', {
      target_member: crypto.randomUUID(),
      target_club: CLUB_A,
      role_ids: [clubACoach!.id],
    })
    expect(missing?.message ?? '').toContain('no profile exists')

    const { userId } = await createDirectSignup({})
    const { error: empty } = await service.rpc('grant_club_membership', {
      target_member: userId,
      target_club: CLUB_A,
      role_ids: [],
    })
    expect(empty?.message ?? '').toContain('at least one role is required')
  })

  it('grant_club_membership is not executable by anon or authenticated callers', async () => {
    const coach = await signIn('coachOne')
    const { data: coachRole } = await service
      .from('roles')
      .select('id')
      .eq('club_id', CLUB_A)
      .eq('key', 'admin')
      .single()
    const args = {
      target_member: coach.userId,
      target_club: CLUB_A,
      role_ids: [coachRole!.id],
    }
    // Refused either by the revoked EXECUTE grant (42501, as the hosted
    // project holds it) or by the in-body service role guard (P0001, the
    // belt-and-braces path that also holds where a platform blanket grant
    // re-adds EXECUTE, as the local stack does). Both hold the line.
    const { error: authedError } = await coach.client.rpc('grant_club_membership', args)
    expect(authedError).not.toBeNull()
    expect(['42501', 'P0001']).toContain(authedError?.code)
    const { error: anonError } = await anonClient().rpc('grant_club_membership', args)
    expect(anonError).not.toBeNull()
    expect(['42501', 'P0001']).toContain(anonError?.code)
    // The admin role must not have been self assigned by either attempt.
    const { data: rows } = await service
      .from('member_roles')
      .select('role_id')
      .eq('member_id', coach.userId)
      .eq('role_id', coachRole!.id)
    expect(rows).toEqual([])
  })

  it('a duplicate invite for an existing email is refused by the auth layer', async () => {
    const email = testEmail('duplicate')
    const { data } = await service.auth.admin.createUser({
      email,
      password: TEST_PASSWORD,
      email_confirm: true,
    })
    disposable.push(data.user!.id)
    const { error } = await service.auth.admin.inviteUserByEmail(email)
    expect(error).not.toBeNull()
  })

  it('a forged invite token verifies to nothing', async () => {
    const client = anonClient()
    const { data, error } = await client.auth.verifyOtp({
      token_hash: `forged-${runId()}`,
      type: 'invite',
    })
    expect(error).not.toBeNull()
    expect(data?.session ?? null).toBeNull()
  })
})

describe('existing members are unaffected', () => {
  it('the standing fixtures still authenticate and retain their access', async () => {
    const admin = await signIn('admin')
    const coach = await signIn('coachOne')
    const parent = await signIn('parent')
    for (const { client } of [admin, coach, parent]) {
      const { data, error } = await client.from('drills').select('id').eq('id', SEEDED_DRILL)
      expect(error).toBeNull()
      expect(data?.length).toBe(1)
    }
    const { data: adminPerm } = await admin.client.rpc('has_perm', { capability: 'users.manage' })
    expect(adminPerm).toBe(true)
    const { data: coachPerm } = await coach.client.rpc('has_perm', { capability: 'sessions.create' })
    expect(coachPerm).toBe(true)
    const { data: parentPerm } = await parent.client.rpc('has_perm', { capability: 'sessions.create' })
    expect(parentPerm).toBe(false)
  })
})
