// =====================================================================
// invite-user Edge Function
//
// REVIEW REQUIRED. This is the only place the service role key exists.
// The platform injects it as the SUPABASE_SERVICE_ROLE_KEY secret; it is
// never in the repo and never in the client. Deploy with
// `npx supabase functions deploy invite-user` and set the app origin with
// `npx supabase secrets set APP_ORIGIN=https://your-app.vercel.app`.
//
// Flow: verify the caller is a signed in admin, validate the payload,
// invite via the auth admin API with the metadata keys handle_new_user
// reads (full_name, role, club_id), then set the new profile's team_id
// when one was supplied, because the trigger does not know about teams.
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return reply(405, { error: 'Method not allowed.' })

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Resolve the caller from the Authorization JWT and require the admin role.
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!jwt) return reply(401, { error: 'Not signed in.' })
  const { data: userData, error: userError } = await admin.auth.getUser(jwt)
  if (userError || !userData?.user) return reply(401, { error: 'Not signed in.' })

  const { data: caller } = await admin
    .from('profiles')
    .select('id, club_id, role')
    .eq('id', userData.user.id)
    .maybeSingle()
  if (!caller || caller.role !== 'admin' || !caller.club_id) {
    return reply(403, { error: 'Only a club admin can send invites.' })
  }

  // Validate the payload: email, full name, role limited to coach, admin or
  // parent, and an optional team that must belong to the caller's club.
  let payload: Record<string, unknown>
  try {
    payload = await req.json()
  } catch {
    return reply(400, { error: 'Invalid request body.' })
  }
  const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : ''
  const fullName = typeof payload.full_name === 'string' ? payload.full_name.trim() : ''
  const role = payload.role
  const teamId = payload.team_id == null || payload.team_id === '' ? null : payload.team_id
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply(400, { error: 'Enter a valid email address.' })
  if (!fullName) return reply(400, { error: 'Enter a full name.' })
  if (role !== 'coach' && role !== 'admin' && role !== 'parent') {
    return reply(400, { error: 'Role must be coach, admin or parent.' })
  }
  if (teamId !== null) {
    if (typeof teamId !== 'string') return reply(400, { error: 'Invalid team.' })
    const { data: team } = await admin.from('teams').select('id, club_id').eq('id', teamId).maybeSingle()
    if (!team || team.club_id !== caller.club_id) {
      return reply(400, { error: 'That team does not belong to your club.' })
    }
  }

  // Invite. handle_new_user reads exactly these metadata keys; club_id is
  // always the caller's own club, never taken from the payload.
  const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { full_name: fullName, role, club_id: caller.club_id },
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
