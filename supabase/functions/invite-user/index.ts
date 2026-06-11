// =====================================================================
// invite-user Edge Function
//
// REVIEW REQUIRED. This is the only place the service role key exists.
// The platform injects it as the SUPABASE_SERVICE_ROLE_KEY secret; it is
// never in the repo and never in the client. Deploy with
// `npx supabase functions deploy invite-user` and set the app origin with
// `npx supabase secrets set APP_ORIGIN=https://your-app.vercel.app`.
//
// Flow: verify the caller is signed in and holds the users.manage
// capability (0012_rbac), validate the payload, invite via the auth admin
// API with the metadata keys handle_new_user reads (full_name, role,
// club_id), then write the new member's roles and teams into the join
// tables. Inviting, and assigning roles and teams on invite, is a
// users.manage action; the role names themselves are never checked here.
//
// Many to many (migration B). A member can be invited with one or more
// roles and zero or more teams. The invite metadata carries a single role,
// the highest privilege one (the primary), which handle_new_user writes to
// profiles.role and member_roles. This function then adds any further
// roles to member_roles, the teams to member_teams, and sets
// profiles.team_id to the primary team. profiles.role and profiles.team_id
// stay the denormalized primaries; member_roles and member_teams are the
// source of truth.
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

// The roles a member may hold, and the privilege order that picks the
// primary. Admin is root, then manager (all content management), then
// coach (content creation), then parent (read only). The primary is the
// highest privilege role held; it seeds profiles.role for display.
const ALLOWED_ROLES = ['coach', 'admin', 'parent', 'manager']
const PRIVILEGE_ORDER = ['admin', 'manager', 'coach', 'parent']

function reply(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return reply(405, { error: 'Method not allowed.' })

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Resolve the caller from the Authorization JWT and require the
  // users.manage capability through the role_capabilities mapping. A
  // missing mapping row, or the table not existing yet because 0012 has
  // not been applied, refuses the invite: this fails closed.
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!jwt) return reply(401, { error: 'Not signed in.' })
  const { data: userData, error: userError } = await admin.auth.getUser(jwt)
  if (userError || !userData?.user) return reply(401, { error: 'Not signed in.' })

  const { data: caller } = await admin
    .from('profiles')
    .select('id, club_id, role')
    .eq('id', userData.user.id)
    .maybeSingle()
  if (!caller || !caller.club_id) {
    return reply(403, { error: 'Only a member with user management access can send invites.' })
  }
  const { data: perm } = await admin
    .from('role_capabilities')
    .select('capability')
    .eq('role', caller.role)
    .eq('capability', 'users.manage')
    .maybeSingle()
  if (!perm) {
    return reply(403, { error: 'Only a member with user management access can send invites.' })
  }

  // Validate the payload: email, full name, a non empty roles list each
  // limited to coach, admin, parent or manager, and zero or more teams
  // that each belong to the caller's club.
  let payload: Record<string, unknown>
  try {
    payload = await req.json()
  } catch {
    return reply(400, { error: 'Invalid request body.' })
  }
  const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : ''
  const fullName = typeof payload.full_name === 'string' ? payload.full_name.trim() : ''
  const rolesRaw: unknown[] = Array.isArray(payload.roles) ? payload.roles : []
  const teamsRaw: unknown[] = Array.isArray(payload.team_ids) ? payload.team_ids : []
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply(400, { error: 'Enter a valid email address.' })
  if (!fullName) return reply(400, { error: 'Enter a full name.' })
  if (rolesRaw.length === 0 || !rolesRaw.every((r) => typeof r === 'string' && ALLOWED_ROLES.includes(r))) {
    return reply(400, { error: 'Choose at least one role: coach, admin, parent or manager.' })
  }
  const roles = [...new Set(rolesRaw as string[])]
  const teamIds = [...new Set(teamsRaw.filter((t): t is string => typeof t === 'string' && t !== ''))]
  for (const teamId of teamIds) {
    const { data: team } = await admin.from('teams').select('id, club_id').eq('id', teamId).maybeSingle()
    if (!team || team.club_id !== caller.club_id) {
      return reply(400, { error: 'A chosen team does not belong to your club.' })
    }
  }

  // The primary role seeds profiles.role through the trigger metadata; the
  // primary team is the first chosen and seeds profiles.team_id below.
  const primaryRole = PRIVILEGE_ORDER.find((r) => roles.includes(r)) ?? roles[0]
  const primaryTeam = teamIds[0] ?? null

  // Invite. handle_new_user reads exactly these metadata keys, seeding the
  // primary role into profiles.role and member_roles; club_id is always
  // the caller's own club, never taken from the payload.
  const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { full_name: fullName, role: primaryRole, club_id: caller.club_id },
    redirectTo: APP_ORIGIN || undefined,
  })
  if (inviteError) {
    const status = (inviteError as { status?: number }).status
    if (status === 422 || /already.*(registered|exists)/i.test(inviteError.message)) {
      return reply(409, { error: 'That email already has an account. They can sign in or use password reset.' })
    }
    console.error('inviteUserByEmail failed:', inviteError.message)
    return reply(500, { error: 'Could not send the invite. Try again.' })
  }

  // The trigger created the profile and the primary member_roles row. Add
  // any further roles, the team memberships, and the primary team. Each is
  // best effort: the member is already invited with the primary role, so a
  // failure here is surfaced as a warning to finish from the Users screen
  // rather than failing the whole invite. The role and team upserts ignore
  // the row the trigger already wrote.
  if (invited?.user) {
    const uid = invited.user.id
    let warning: string | undefined

    const { error: rolesError } = await admin
      .from('member_roles')
      .upsert(roles.map((role) => ({ member_id: uid, role })), { onConflict: 'member_id,role', ignoreDuplicates: true })
    if (rolesError) warning = 'Invited, but some roles could not be set. Assign them from the Users screen.'

    if (!warning && teamIds.length > 0) {
      const { error: teamsError } = await admin
        .from('member_teams')
        .upsert(teamIds.map((team_id) => ({ member_id: uid, team_id })), { onConflict: 'member_id,team_id', ignoreDuplicates: true })
      if (teamsError) warning = 'Invited, but the teams could not be set. Assign them from the Users screen.'
    }

    if (!warning && primaryTeam) {
      const { error: primaryTeamError } = await admin.from('profiles').update({ team_id: primaryTeam }).eq('id', uid)
      if (primaryTeamError) warning = 'Invited, but the team could not be set. Assign it from the Users screen.'
    }

    if (warning) return reply(200, { ok: true, warning })
  }

  return reply(200, { ok: true })
})
