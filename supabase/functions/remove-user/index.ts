// =====================================================================
// remove-user Edge Function
//
// REVIEW REQUIRED. Like invite-user, this function holds the service
// role key. The platform injects it as the SUPABASE_SERVICE_ROLE_KEY
// secret; it is never in the repo and never in the client. Deploy with
// `npx supabase functions deploy remove-user` (JWT verification stays
// on) and CORS is restricted to the APP_ORIGIN secret.
//
// Flow: verify the caller is signed in and holds the users.manage
// capability (0012_rbac), validate the target is a member of the
// caller's own club, refuse self removal and refuse removing the
// club's last admin, then delete the auth user. The profile row goes
// with it through the profiles on delete cascade foreign key inside one
// database transaction, so there is never a partial state: either both
// rows are removed or neither is.
//
// The member's content survives as club owned, because created_by on
// drills, media, templates and programmes and coach_id on sessions are
// on delete set null (0012). The member's membership rows go with them:
// member_roles and member_teams reference profiles on delete cascade
// (migration B), so deleting the auth user cascades auth.users ->
// profiles -> member_roles and member_teams in the same transaction. No
// extra delete is needed.
//
// Many to many (migration B). The last admin guard counts admins through
// member_roles, the source of truth, not profiles.role, so a member who
// is admin plus coach is still counted as an admin and the club can never
// be left with no admin.
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
  // users.manage capability through the role_capabilities mapping. A
  // missing mapping row, or the table not existing yet because 0012 has
  // not been applied, refuses the removal: this fails closed.
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
    return reply(403, { error: 'Only a member with user management access can remove members.' })
  }
  const { data: perm } = await admin
    .from('role_capabilities')
    .select('capability')
    .eq('role', caller.role)
    .eq('capability', 'users.manage')
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

  // The last admin guard, read through member_roles. First, does the target
  // hold the admin role at all? A member who is admin plus coach still
  // counts, whatever their profiles.role primary says.
  const { data: targetAdmin } = await admin
    .from('member_roles')
    .select('role')
    .eq('member_id', userId)
    .eq('role', 'admin')
    .maybeSingle()
  if (targetAdmin) {
    // Count the members of the caller's club who hold the admin role. The
    // inner join to profiles scopes the count to the club, since
    // member_roles carries no club_id of its own. The club must keep at
    // least one admin, or nobody can manage users, teams or the club again
    // without database access.
    const { count, error: countError } = await admin
      .from('member_roles')
      .select('member_id, profiles!inner(club_id)', { count: 'exact', head: true })
      .eq('role', 'admin')
      .eq('profiles.club_id', caller.club_id)
    if (countError || count === null) {
      return reply(500, { error: 'Could not check the club admins. Nothing was changed. Try again.' })
    }
    if (count <= 1) {
      return reply(409, { error: "You cannot remove the club's only admin. Promote another admin first." })
    }
  }

  // One call performs the whole removal. Deleting the auth user removes the
  // profile through the on delete cascade foreign key, and the member_roles
  // and member_teams rows through their cascade to profiles, all inside one
  // database transaction, so a failure here leaves every row in place and a
  // success removes them together; no path orphans a row. The content
  // foreign keys (created_by columns, sessions.coach_id) null out in the
  // same transaction.
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
