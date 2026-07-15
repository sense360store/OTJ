// =====================================================================
// invite-user Edge Function
//
// REVIEW REQUIRED. This function holds the service role key. The
// platform injects it as the SUPABASE_SERVICE_ROLE_KEY secret; it is
// never in the repo and never in the client. Deploy with
// `npx supabase functions deploy invite-user` and set the app origin
// with `npx supabase secrets set APP_ORIGIN=https://your-app.vercel.app`.
// Deploy only after the RBAC v2 migrations (roles as data, member
// teams) are applied: the caller check below reads member_roles and
// refuses while the table is missing, so the order fails closed.
//
// RBAC v2: an invite assigns one or more roles (by role key or id,
// validated against the club's roles table) and either a set of teams
// or the all teams flag. Admin and manager default to all teams unless
// the payload says otherwise. profiles.role is the display primary:
// the highest precedence system role assigned (admin, manager, coach,
// parent, defaulting to coach when only custom roles are assigned);
// profiles.team_id is the first assigned team.
//
// Signup hardening (0029): handle_new_user ignores client metadata, so
// nothing membership shaped goes through the invite metadata any more;
// only the full_name display string rides along for the email
// template. After inviteUserByEmail creates the quarantined auth user,
// this function grants the club, the roles and the teams in one call
// to grant_club_membership(), a service role only database function
// that validates club scoping and applies everything in a single
// transaction. If that grant fails the invite is rolled back by
// deleting the just created auth user, so no half provisioned member
// is left behind.
//
// The caller check is unchanged in meaning: inviting, and assigning any
// role on invite (the admin role included), is a users.manage action.
// users.manage is held through member_roles and role_capabilities now,
// so the probe reads those. The reserved capability guard does not
// apply here because invites assign roles, not capabilities.
//
// Until the RBAC v2 UI lands, the Users screen still sends the single
// role and single team payload, so both shapes are accepted: roles as
// an array or role as a string, team_ids as an array or team_id as a
// string.
// =====================================================================
import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
// CORS is restricted to the app origin. The invite redirect lands there too,
// so the accept link opens the deployed site.
const APP_ORIGIN = Deno.env.get('APP_ORIGIN') ?? ''

const corsHeaders = {
  'Access-Control-Allow-Origin': APP_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function reply(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

interface ClubRole {
  id: string
  key: string
  system: boolean
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return reply(405, { error: 'Method not allowed.' })

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Resolve the caller from the Authorization JWT and require the
  // users.manage capability through member_roles and role_capabilities,
  // granting on any held role exactly as has_perm() does. A missing
  // assignment, or the tables not existing yet because the RBAC v2
  // migrations have not been applied, refuses the invite: this fails
  // closed.
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!jwt) return reply(401, { error: 'Not signed in.' })
  const { data: userData, error: userError } = await admin.auth.getUser(jwt)
  if (userError || !userData?.user) return reply(401, { error: 'Not signed in.' })

  const { data: caller } = await admin
    .from('profiles')
    .select('id, club_id')
    .eq('id', userData.user.id)
    .maybeSingle()
  if (!caller || !caller.club_id) {
    return reply(403, { error: 'Only a member with user management access can send invites.' })
  }
  const { data: callerRoles, error: callerRolesError } = await admin
    .from('member_roles')
    .select('role_id')
    .eq('member_id', caller.id)
  const callerRoleIds = (callerRoles ?? []).map((r: { role_id: string }) => r.role_id)
  if (callerRolesError || callerRoleIds.length === 0) {
    return reply(403, { error: 'Only a member with user management access can send invites.' })
  }
  const { data: perm } = await admin
    .from('role_capabilities')
    .select('capability')
    .in('role_id', callerRoleIds)
    .eq('capability', 'users.manage')
    .limit(1)
    .maybeSingle()
  if (!perm) {
    return reply(403, { error: 'Only a member with user management access can send invites.' })
  }

  // Validate the payload: email, full name, at least one role that
  // resolves against the club's roles table, and teams that belong to
  // the caller's club. club_id is always the caller's own club, never
  // taken from the payload.
  let payload: Record<string, unknown>
  try {
    payload = await req.json()
  } catch {
    return reply(400, { error: 'Invalid request body.' })
  }
  const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : ''
  const fullName = typeof payload.full_name === 'string' ? payload.full_name.trim() : ''
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply(400, { error: 'Enter a valid email address.' })
  if (!fullName) return reply(400, { error: 'Enter a full name.' })

  // Roles: the array form, or the legacy single role string.
  let requestedRoles: string[] = []
  if (Array.isArray(payload.roles)) {
    requestedRoles = payload.roles
      .filter((r): r is string => typeof r === 'string' && r.trim() !== '')
      .map((r) => r.trim())
  } else if (typeof payload.role === 'string' && payload.role.trim() !== '') {
    requestedRoles = [payload.role.trim()]
  }
  if (requestedRoles.length === 0) return reply(400, { error: 'Assign at least one role.' })

  const { data: clubRolesData, error: clubRolesError } = await admin
    .from('roles')
    .select('id, key, system')
    .eq('club_id', caller.club_id)
  const clubRoles = (clubRolesData ?? []) as ClubRole[]
  if (clubRolesError || clubRoles.length === 0) {
    return reply(500, { error: 'Could not read the club roles. Try again.' })
  }
  const rolesByKey = new Map(clubRoles.map((r) => [r.key, r]))
  const rolesById = new Map(clubRoles.map((r) => [r.id, r]))
  const assigned = new Map<string, ClubRole>()
  for (const entry of requestedRoles) {
    const role = rolesByKey.get(entry) ?? rolesById.get(entry)
    if (!role) return reply(400, { error: `"${entry}" is not one of the club's roles.` })
    assigned.set(role.id, role)
  }

  // Teams: the array form, or the legacy single team string. Every team
  // must belong to the caller's club.
  let teamIds: string[] = []
  if (Array.isArray(payload.team_ids)) {
    teamIds = [...new Set(payload.team_ids.filter((t): t is string => typeof t === 'string' && t !== ''))]
  } else if (typeof payload.team_id === 'string' && payload.team_id !== '') {
    teamIds = [payload.team_id]
  } else if (payload.team_id != null && payload.team_id !== '') {
    return reply(400, { error: 'Invalid team.' })
  }
  if (teamIds.length > 0) {
    const { data: teams, error: teamsError } = await admin
      .from('teams')
      .select('id, club_id')
      .in('id', teamIds)
    const found = (teams ?? []).filter((t: { id: string; club_id: string }) => t.club_id === caller.club_id)
    if (teamsError || found.length !== teamIds.length) {
      return reply(400, { error: 'That team does not belong to your club.' })
    }
  }

  // The all teams flag: explicit when sent, otherwise defaulted on for
  // admin and manager. While the flag is on the specific teams are moot,
  // so none are written and the primary team stays empty.
  const systemKeys = [...assigned.values()].filter((r) => r.system).map((r) => r.key)
  const allTeams =
    typeof payload.all_teams === 'boolean'
      ? payload.all_teams
      : systemKeys.includes('admin') || systemKeys.includes('manager')
  if (allTeams) teamIds = []

  // The display primary role_kind is derived inside grant_club_membership
  // from the assigned role ids (same admin > manager > coach > parent
  // precedence), so nothing here needs to compute or pass it; capabilities
  // flow from the member_roles rows the grant writes.

  // Invite. The metadata carries the full_name display string only; the
  // hardened handle_new_user reads nothing membership shaped, so the
  // auth user starts quarantined (no club, no role, no capability).
  const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { full_name: fullName },
    redirectTo: APP_ORIGIN || undefined,
  })
  if (inviteError || !invited?.user) {
    const status = (inviteError as { status?: number } | null)?.status
    if (status === 422 || /already.*(registered|exists)/i.test(inviteError?.message ?? '')) {
      return reply(409, { error: 'That email already has an account. They can sign in or use password reset.' })
    }
    console.error('inviteUserByEmail failed:', inviteError?.message)
    return reply(500, { error: 'Could not send the invite. Try again.' })
  }

  // The trigger created a quarantined profile; grant the club, the
  // roles and the teams in one database transaction. The function
  // re-validates that every role and team belongs to the caller's club
  // and refuses a member already in another club, so the trust boundary
  // holds even against a compromised payload. On failure the just
  // created auth user is deleted again: the invite either provisions
  // the member completely or leaves nothing behind.
  const memberId = invited.user.id
  const { error: grantError } = await admin.rpc('grant_club_membership', {
    target_member: memberId,
    target_club: caller.club_id,
    role_ids: [...assigned.keys()],
    primary_team: teamIds[0] ?? null,
    member_team_ids: teamIds,
    set_all_teams: allTeams,
    member_full_name: fullName,
  })
  if (grantError) {
    console.error('grant_club_membership failed:', grantError.message)
    const { error: undoError } = await admin.auth.admin.deleteUser(memberId)
    if (undoError) {
      console.error('rollback deleteUser failed:', undoError.message)
      return reply(500, {
        error:
          'The invite could not be completed. The account has no club access. An admin must delete the auth user in the Supabase dashboard before this email can be invited again.',
      })
    }
    return reply(500, { error: 'Could not send the invite. Try again.' })
  }

  return reply(200, { ok: true })
})
