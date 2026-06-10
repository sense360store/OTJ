// =====================================================================
// remove-user Edge Function
//
// REVIEW REQUIRED. One of the two places the service role key exists
// (invite-user is the other). The platform injects it as the
// SUPABASE_SERVICE_ROLE_KEY secret; it is never in the repo and never in
// the client. Deploy with `npx supabase functions deploy remove-user`;
// it shares the APP_ORIGIN secret with invite-user.
//
// The missing half of the user lifecycle (Phase 8 PR B). Removing a
// member deletes their auth user; the profile cascades from it. What
// happens to their sessions is the caller's choice: reassign_sessions
// true moves them to the caller before deletion, false lets them cascade
// away with the profile. Drills and media they created stay (created_by
// becomes null through the existing foreign keys), and their profile
// photo objects are removed from storage best effort.
//
// Guards: the caller must hold users.manage; the target must be a member
// of the caller's club; the last member whose role holds users.manage
// cannot be removed, so a club can never lock itself out.
// =====================================================================
import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
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

  // Resolve the caller from the Authorization JWT and require users.manage,
  // the same role_permissions lookup has_perm() makes in the database.
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!jwt) return reply(401, { error: 'Not signed in.' })
  const { data: userData, error: userError } = await admin.auth.getUser(jwt)
  if (userError || !userData?.user) return reply(401, { error: 'Not signed in.' })

  const { data: caller } = await admin
    .from('profiles')
    .select('id, club_id, role_id')
    .eq('id', userData.user.id)
    .maybeSingle()
  if (!caller?.club_id || !caller.role_id) {
    return reply(403, { error: 'Only a member who manages users can remove members.' })
  }
  const { data: callerGrant } = await admin
    .from('role_permissions')
    .select('permission')
    .eq('role_id', caller.role_id)
    .eq('permission', 'users.manage')
    .maybeSingle()
  if (!callerGrant) {
    return reply(403, { error: 'Only a member who manages users can remove members.' })
  }

  // Payload: the member to remove and what to do with their sessions.
  let payload: Record<string, unknown>
  try {
    payload = await req.json()
  } catch {
    return reply(400, { error: 'Invalid request body.' })
  }
  const targetId = typeof payload.user_id === 'string' ? payload.user_id : ''
  const reassign = payload.reassign_sessions === true
  if (!targetId) return reply(400, { error: 'Name the member to remove.' })

  // The target must be a member of the caller's club.
  const { data: target } = await admin
    .from('profiles')
    .select('id, club_id, role_id, full_name')
    .eq('id', targetId)
    .maybeSingle()
  if (!target || target.club_id !== caller.club_id) {
    return reply(404, { error: 'That member is not in your club.' })
  }

  // The generalised last admin guard: refuse removing the last member whose
  // role holds users.manage, whoever that is.
  const { data: managerGrants } = await admin
    .from('role_permissions')
    .select('role_id, roles!inner(club_id)')
    .eq('permission', 'users.manage')
    .eq('roles.club_id', caller.club_id)
  const managerRoleIds = (managerGrants ?? []).map((g) => g.role_id as string)
  if (target.role_id && managerRoleIds.includes(target.role_id)) {
    const { count } = await admin
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('club_id', caller.club_id)
      .in('role_id', managerRoleIds)
    if ((count ?? 0) <= 1) {
      return reply(409, {
        error: 'They are the last member who can manage users. Give someone else a user management role first.',
      })
    }
  }

  // Their sessions: count, then reassign to the caller or leave them to
  // cascade away with the profile.
  const { count: sessionCount } = await admin
    .from('sessions')
    .select('id', { count: 'exact', head: true })
    .eq('coach_id', target.id)
  if (reassign && (sessionCount ?? 0) > 0 && target.id !== caller.id) {
    const { error: moveError } = await admin.from('sessions').update({ coach_id: caller.id }).eq('coach_id', target.id)
    if (moveError) {
      console.error('session reassignment failed:', moveError.message)
      return reply(500, { error: 'Could not reassign their sessions. Nothing was removed.' })
    }
  }

  // Their profile photos are storage objects with no media rows; remove them
  // best effort so no orphans pile up.
  const { data: avatarObjects } = await admin.storage.from('media').list(`avatars/${target.id}`)
  if (avatarObjects?.length) {
    await admin.storage.from('media').remove(avatarObjects.map((o) => `avatars/${target.id}/${o.name}`))
  }

  // Delete the auth user; the profile cascades, and with it any sessions
  // that were not reassigned. Drills and media keep their rows with
  // created_by set null by the foreign keys.
  const { error: deleteError } = await admin.auth.admin.deleteUser(target.id)
  if (deleteError) {
    console.error('deleteUser failed:', deleteError.message)
    return reply(500, { error: 'Could not remove the member. Try again.' })
  }

  return reply(200, {
    ok: true,
    removed: target.id,
    sessions: reassign && target.id !== caller.id ? 'reassigned' : 'deleted',
    session_count: sessionCount ?? 0,
  })
})
