// =====================================================================
// remove-user Edge Function
//
// REVIEW REQUIRED. Like invite-user, this function holds the service
// role key. The platform injects it as the SUPABASE_SERVICE_ROLE_KEY
// secret; it is never in the repo and never in the client. Deploy with
// `npx supabase functions deploy remove-user` (JWT verification stays
// on) and CORS is restricted to the APP_ORIGIN secret. Deploy only
// after the RBAC v2 migrations are applied: the caller check reads
// member_roles and refuses while the table is missing, failing closed.
//
// Flow: verify the caller is signed in and holds the users.manage
// capability through member_roles and role_capabilities (any held role
// grants, exactly as has_perm() does), validate the target is a member
// of the caller's own club, refuse self removal and refuse removing the
// club's last admin, then delete the auth user. The profile row goes
// with it through the profiles on delete cascade foreign key inside one
// database transaction, and the member's member_roles and member_teams
// rows cascade with the profile in the same transaction (both carry
// member_id references profiles on delete cascade), so there is never a
// partial state. The member's content survives as club owned, because
// created_by on drills, media, templates and programmes and coach_id on
// sessions are on delete set null (0012).
//
// RBAC v2: the last admin guard counts members holding the admin system
// role through member_roles, not profiles.role, so a member who is
// admin plus coach still counts as an admin, and the last admin cannot
// be removed even when they also hold other roles.
// =====================================================================
import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
// CORS is restricted to the app origin, exactly as invite-user does it.
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return reply(405, { error: 'Method not allowed.' })

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Resolve the caller from the Authorization JWT and require the
  // users.manage capability through member_roles and role_capabilities.
  // A missing assignment, or the tables not existing yet because the
  // RBAC v2 migrations have not been applied, refuses the removal: this
  // fails closed.
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
    return reply(403, { error: 'Only a member with user management access can remove members.' })
  }
  const { data: callerRoles, error: callerRolesError } = await admin
    .from('member_roles')
    .select('role_id')
    .eq('member_id', caller.id)
  const callerRoleIds = (callerRoles ?? []).map((r: { role_id: string }) => r.role_id)
  if (callerRolesError || callerRoleIds.length === 0) {
    return reply(403, { error: 'Only a member with user management access can remove members.' })
  }
  const { data: perm } = await admin
    .from('role_capabilities')
    .select('capability')
    .in('role_id', callerRoleIds)
    .eq('capability', 'users.manage')
    .limit(1)
    .maybeSingle()
  if (!perm) {
    return reply(403, { error: 'Only a member with user management access can remove members.' })
  }

  // Validate the payload: the id of the member to remove.
  let payload: Record<string, unknown>
  try {
    payload = await req.json()
  } catch {
    return reply(400, { error: 'Invalid request body.' })
  }
  const userId = typeof payload.user_id === 'string' ? payload.user_id.trim() : ''
  if (!userId) return reply(400, { error: 'No member named.' })

  // Removal is for administering other members; removing yourself would
  // also end the session doing the removing.
  if (userId === caller.id) {
    return reply(400, { error: 'You cannot remove yourself. Another admin has to do that.' })
  }

  // The target must be a member of the caller's own club.
  const { data: target } = await admin
    .from('profiles')
    .select('id, club_id, full_name')
    .eq('id', userId)
    .maybeSingle()
  if (!target || target.club_id !== caller.club_id) {
    return reply(404, { error: 'That member was not found in your club.' })
  }

  // The club must keep at least one admin, or nobody can manage users,
  // teams or the club again without database access. Admin means holding
  // the admin system role through member_roles, whatever else the member
  // holds alongside it. Any error checking refuses the removal: nothing
  // is changed.
  const { data: adminRole, error: adminRoleError } = await admin
    .from('roles')
    .select('id')
    .eq('club_id', caller.club_id)
    .eq('key', 'admin')
    .eq('system', true)
    .maybeSingle()
  if (adminRoleError || !adminRole) {
    return reply(500, { error: 'Could not check the club admins. Nothing was changed. Try again.' })
  }
  const { data: targetAdmin, error: targetAdminError } = await admin
    .from('member_roles')
    .select('member_id')
    .eq('member_id', userId)
    .eq('role_id', adminRole.id)
    .maybeSingle()
  if (targetAdminError) {
    return reply(500, { error: 'Could not check the club admins. Nothing was changed. Try again.' })
  }
  if (targetAdmin) {
    const { count, error: countError } = await admin
      .from('member_roles')
      .select('member_id', { count: 'exact', head: true })
      .eq('role_id', adminRole.id)
    if (countError || count === null) {
      return reply(500, { error: 'Could not check the club admins. Nothing was changed. Try again.' })
    }
    if (count <= 1) {
      return reply(409, { error: "You cannot remove the club's only admin. Promote another admin first." })
    }
  }

  // One call performs the whole removal. Deleting the auth user removes
  // the profile through the on delete cascade foreign key inside one
  // database transaction, and the profile takes the member's
  // member_roles and member_teams rows with it through their own on
  // delete cascade foreign keys, so a failure here leaves everything in
  // place and a success removes it all; no path orphans a row. The
  // content foreign keys (created_by columns, sessions.coach_id) null
  // out in the same transaction.
  const { error: deleteError } = await admin.auth.admin.deleteUser(userId)
  if (deleteError) {
    console.error('deleteUser failed:', deleteError.message)
    return reply(500, { error: 'Could not remove the member. Nothing was changed. Try again.' })
  }

  const name = typeof target.full_name === 'string' && target.full_name ? target.full_name : 'The member'
  return reply(200, {
    ok: true,
    message: `${name} has been removed. Their drills, media, templates, programmes and sessions stay with the club.`,
  })
})
