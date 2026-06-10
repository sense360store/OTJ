// =====================================================================
// invite-user Edge Function, v3
//
// REVIEW REQUIRED. One of the two places the service role key exists
// (remove-user is the other). The platform injects it as the
// SUPABASE_SERVICE_ROLE_KEY secret; it is never in the repo and never in
// the client. Deploy with `npx supabase functions deploy invite-user`
// and set the app origin with
// `npx supabase secrets set APP_ORIGIN=https://your-app.vercel.app`.
//
// v3 (Phase 8): roles are rows. The payload carries role_id, validated
// as a role of the caller's club; the caller check is the users.manage
// capability looked up through role_permissions, the same lookup
// has_perm() makes in the database, instead of a role name comparison.
// The invite metadata carries role_id plus the legacy role string so the
// handle_new_user fallback works even if the role row disappears between
// invite and acceptance. A legacy payload that names a role instead of a
// role_id still works for the window until the Users screen sends
// role_id (Phase 8 PR C); it maps to the club's system role of that name.
//
// Flow: verify the caller holds users.manage, validate the payload,
// invite via the auth admin API with the metadata keys handle_new_user
// reads (full_name, role, role_id, club_id), then set the new profile's
// team_id when one was supplied, because the trigger does not know about
// teams.
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

const LEGACY_ROLES = ['coach', 'admin', 'parent'] as const

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return reply(405, { error: 'Method not allowed.' })

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Resolve the caller from the Authorization JWT and require users.manage.
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
    return reply(403, { error: 'Only a member who manages users can send invites.' })
  }
  const { data: callerGrant } = await admin
    .from('role_permissions')
    .select('permission')
    .eq('role_id', caller.role_id)
    .eq('permission', 'users.manage')
    .maybeSingle()
  if (!callerGrant) {
    return reply(403, { error: 'Only a member who manages users can send invites.' })
  }

  // Validate the payload: email, full name, a role of the caller's club
  // (role_id, or the legacy role name mapped to the system role), and an
  // optional team that must belong to the caller's club.
  let payload: Record<string, unknown>
  try {
    payload = await req.json()
  } catch {
    return reply(400, { error: 'Invalid request body.' })
  }
  const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : ''
  const fullName = typeof payload.full_name === 'string' ? payload.full_name.trim() : ''
  const roleId = typeof payload.role_id === 'string' && payload.role_id ? payload.role_id : null
  const legacyRole = typeof payload.role === 'string' ? payload.role : null
  const teamId = payload.team_id == null || payload.team_id === '' ? null : payload.team_id
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply(400, { error: 'Enter a valid email address.' })
  if (!fullName) return reply(400, { error: 'Enter a full name.' })

  let role: { id: string; name: string; is_system: boolean } | null = null
  if (roleId) {
    const { data } = await admin
      .from('roles')
      .select('id, name, is_system, club_id')
      .eq('id', roleId)
      .eq('club_id', caller.club_id)
      .maybeSingle()
    role = data
    if (!role) return reply(400, { error: 'That role does not belong to your club.' })
  } else if (legacyRole && (LEGACY_ROLES as readonly string[]).includes(legacyRole)) {
    const systemName = legacyRole.charAt(0).toUpperCase() + legacyRole.slice(1)
    const { data } = await admin
      .from('roles')
      .select('id, name, is_system, club_id')
      .eq('club_id', caller.club_id)
      .eq('is_system', true)
      .eq('name', systemName)
      .maybeSingle()
    role = data
    if (!role) return reply(500, { error: 'The club is missing its system roles. Run the 0010 migration.' })
  } else {
    return reply(400, { error: 'Choose a role for the invite.' })
  }

  if (teamId !== null) {
    if (typeof teamId !== 'string') return reply(400, { error: 'Invalid team.' })
    const { data: team } = await admin.from('teams').select('id, club_id').eq('id', teamId).maybeSingle()
    if (!team || team.club_id !== caller.club_id) {
      return reply(400, { error: 'That team does not belong to your club.' })
    }
  }

  // The legacy role string for the metadata: the enum column still exists for
  // one phase and handle_new_user falls back to it if the role row is gone by
  // the time the invite is accepted. System roles map to their own name; a
  // custom role maps by what it can do, so the fallback stays close in spirit.
  let legacyName: string
  if (role.is_system && (LEGACY_ROLES as readonly string[]).includes(role.name.toLowerCase())) {
    legacyName = role.name.toLowerCase()
  } else {
    const { data: grants } = await admin.from('role_permissions').select('permission').eq('role_id', role.id)
    const perms = (grants ?? []).map((g) => g.permission as string)
    legacyName = perms.includes('users.manage')
      ? 'admin'
      : perms.some((p) => p.endsWith('.create'))
        ? 'coach'
        : 'parent'
  }

  // Invite. handle_new_user reads exactly these metadata keys; club_id is
  // always the caller's own club, never taken from the payload.
  const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { full_name: fullName, role: legacyName, role_id: role.id, club_id: caller.club_id },
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

  // The trigger created the profile; set the team afterwards when given.
  if (teamId && invited?.user) {
    const { error: teamError } = await admin.from('profiles').update({ team_id: teamId }).eq('id', invited.user.id)
    if (teamError) {
      return reply(200, { ok: true, warning: 'Invited, but the team could not be set. Assign it from the Users screen.' })
    }
  }

  return reply(200, { ok: true })
})
