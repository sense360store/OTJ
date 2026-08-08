// =====================================================================
// spond-link-members Edge Function
//
// REVIEW REQUIRED, AND GATED BEYOND MERGE: merging this file puts
// nothing live. After merge the function is reviewed line by line in
// the main session and deployed through the Supabase connector from
// merged main with verify_jwt on, then verified by reading the deployed
// source back and checking its content, never by trusting a version
// number. A real call additionally needs the dedicated Spond organiser
// account and its two secrets (below) and a spond_groups mapping for
// the team.
//
// What this is. The linking flow's candidate read (ADR-0008, the
// amended boundary in docs/security/spond-data-boundary.md): the
// members of a team's mapped Spond groups as name and id pairs, so the
// linking screen can match them to the club's players and store links.
// It runs only when an authorised member opens the linking screen and
// asks for a team's candidates: never automatic, never on a schedule,
// never part of the attendance sync.
//
// THE TRANSIENT NAME RULE. This is the linking flow's one permitted
// name read. From each member exactly two things are read: the opaque
// member id (validated against the 0045 token shape) and the display
// name, the same name fields the roster import reads. The pair exists
// only in this function's response body, returned to the authorised
// caller: it is never persisted, never logged, and never appears in an
// error message. The member's guardians, email, phoneNumber and every
// other field are never read. The reduction lives in
// ../_shared/spond.ts (reduceLinkCandidate, planLinkCandidates) and is
// pinned by spond_link_test.ts. What the client may then STORE is only
// what migration 0045 allows: the id, never the name.
//
// NO LOGGING OF NAMES. Like the other Spond functions, this logs only
// HTTP status codes and its own context: never payload content, never a
// name, never an id. Spond response bodies and headers are never
// logged.
//
// Read only toward Spond. Authentication is the only non GET call.
// Endpoints and shapes are ported from the reference library
// github.com/Olen/Spond (read at build time); it is a reference, not a
// dependency.
//
// Security model:
//   * The Supabase client is built from the caller's JWT and the anon
//     key, so the mapping read and the has_perm probe run through RLS
//     as that member. The service role key is not used at all, and this
//     function writes nothing anywhere.
//   * The players.manage capability is required before Spond is
//     contacted: linking is roster curation, the same gate the
//     player_spond_links write policies enforce (0045), so the early
//     refusal and the RLS enforcement cannot drift. Managers and admins
//     hold it; a coach (players.view only) and every parent are
//     refused. The gate runs ahead of the secret presence check so an
//     unauthorised caller learns nothing about server configuration.
//   * Credentials are the dedicated organiser account's, in the
//     SPOND_EMAIL and SPOND_PASSWORD function secrets. When either is
//     missing the function fails closed with a 503.
// =====================================================================
import { corsHeaders, reply, resolveCaller } from '../_shared/fa.ts'
import {
  extractAccessToken,
  MAX_ROSTER_MEMBERS,
  planLinkCandidates,
  readCappedJson,
  selectGroupMembers,
  SPOND_API_BASE,
  SPOND_MAX_BODY_BYTES,
  SPOND_TIMEOUT_MS,
} from '../_shared/spond.ts'
import type { SpondMapping } from '../_shared/spond.ts'

const SPOND_EMAIL = Deno.env.get('SPOND_EMAIL') ?? ''
const SPOND_PASSWORD = Deno.env.get('SPOND_PASSWORD') ?? ''

// The exact header shape the reference library sends on every
// authenticated call (base.py auth_headers), mirrored from spond-sync.
function spondHeaders(token: string): HeadersInit {
  return { 'content-type': 'application/json', Authorization: `Bearer ${token}` }
}

// Sign in to Spond as the dedicated organiser account, mirrored from the
// sibling functions. The only non GET call. The response body is read
// for the token and nothing else; a failed login can carry 2FA
// challenge tokens and a phone number, so neither the body nor its
// headers are ever logged or echoed.
async function spondLogin(): Promise<{ token: string } | { response: Response }> {
  let res: Response
  try {
    res = await fetch(`${SPOND_API_BASE}auth2/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: SPOND_EMAIL, password: SPOND_PASSWORD }),
      signal: AbortSignal.timeout(SPOND_TIMEOUT_MS),
    })
  } catch {
    return { response: reply(502, { error: 'Could not reach Spond to sign in.' }) }
  }
  if (!res.ok) {
    console.error('spond-link-members: login failed', { status: res.status })
    await res.body?.cancel()
    return {
      response: reply(502, {
        error: `Spond sign in failed (HTTP ${res.status}). Check the SPOND_EMAIL and SPOND_PASSWORD secrets.`,
      }),
    }
  }
  const body = await readCappedJson(res, SPOND_MAX_BODY_BYTES)
  const token = extractAccessToken(body)
  if (!token) {
    console.error('spond-link-members: login returned no usable token')
    return { response: reply(502, { error: 'Spond sign in did not return a usable token.' }) }
  }
  return { token }
}

// The organiser account's groups: GET groups/, mirrored from
// spond-roster-import, body capped the same way.
async function spondGroups(token: string): Promise<{ groups: unknown } | { response: Response }> {
  let res: Response
  try {
    res = await fetch(`${SPOND_API_BASE}groups/`, {
      headers: spondHeaders(token),
      signal: AbortSignal.timeout(SPOND_TIMEOUT_MS),
    })
  } catch {
    return { response: reply(502, { error: 'Could not fetch the Spond group list.' }) }
  }
  if (!res.ok) {
    console.error('spond-link-members: groups fetch failed', { status: res.status })
    await res.body?.cancel()
    return { response: reply(502, { error: `Spond refused the group list (HTTP ${res.status}).` }) }
  }
  const body = await readCappedJson(res, SPOND_MAX_BODY_BYTES)
  if (body === null) {
    console.error('spond-link-members: groups body unreadable or over cap')
    return { response: reply(502, { error: 'Spond returned an unreadable or oversized group list.' }) }
  }
  return { groups: body }
}

interface LinkMembersBody {
  team_id?: unknown
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return reply(405, { error: 'Method not allowed.' })

  const resolved = await resolveCaller(req)
  if ('response' in resolved) return resolved.response
  const { caller } = resolved

  // The capability gate FIRST, before anything else and before Spond is
  // contacted. players.manage is the link write gate (0045), so a yes
  // here means the client's link writes will pass RLS and a no refuses
  // early, ahead of the secret presence check.
  const { data: canLink, error: permError } = await caller.db.rpc('has_perm', { capability: 'players.manage' })
  if (permError) {
    return reply(500, { error: 'Could not check your access.' })
  }
  if (canLink !== true) {
    return reply(403, { error: 'Linking Spond members needs the players.manage capability.' })
  }

  // Fail closed while the dedicated organiser account is not configured.
  if (!SPOND_EMAIL || !SPOND_PASSWORD) {
    return reply(503, {
      error:
        'The Spond account is not configured. An administrator must set the SPOND_EMAIL and SPOND_PASSWORD function secrets.',
    })
  }

  let parsed: LinkMembersBody
  try {
    parsed = (await req.json()) as LinkMembersBody
  } catch {
    parsed = {}
  }
  const teamId = typeof parsed.team_id === 'string' ? parsed.team_id : ''
  if (!teamId) {
    return reply(400, { error: 'Choose a team to load Spond members for.' })
  }

  // The team's mappings, read through RLS as the caller. spond_groups is
  // the allow list; only mapped groups are ever read.
  const { data: mappingRows, error: mappingsError } = await caller.db
    .from('spond_groups')
    .select('id, spond_group_id, spond_subgroup_id, spond_name, team_id')
    .eq('club_id', caller.clubId)
    .eq('team_id', teamId)
    .order('created_at', { ascending: true })
  if (mappingsError) {
    return reply(500, { error: 'Could not read the Spond group mappings.' })
  }
  const mappings = (mappingRows ?? []) as SpondMapping[]
  if (mappings.length === 0) {
    return reply(200, {
      ok: true,
      message: 'This team has no Spond group mapped. An admin adds the mapping on the Spond admin page.',
      members: [],
      warnings: [],
    })
  }

  const login = await spondLogin()
  if ('response' in login) return login.response

  const groups = await spondGroups(login.token)
  if ('response' in groups) return groups.response

  // The scoped members of every mapping for this team, reduced to name
  // and id pairs and de-duped by id. A mapping whose group the account
  // cannot see is reported as a warning, not a silent skip.
  const members: unknown[] = []
  const warnings: string[] = []
  for (const mapping of mappings) {
    const scoped = selectGroupMembers(groups.groups, mapping.spond_group_id, mapping.spond_subgroup_id)
    if (scoped.length === 0) {
      warnings.push(
        `No members found for ${mapping.spond_name}. Check the Spond organiser account can see this group and that the subgroup has members.`,
      )
    }
    for (const member of scoped) members.push(member)
  }
  const candidates = planLinkCandidates(members)
  // The cap is silent in the reduction; a screen missing children with no
  // signal would be worse than a long list, so say so.
  if (members.length > candidates.length && candidates.length >= MAX_ROSTER_MEMBERS) {
    warnings.push(`Only the first ${MAX_ROSTER_MEMBERS} members are offered. Link in batches and reload.`)
  }

  // The one place the pair leaves the server: the authorised caller's
  // response. Nothing was persisted and nothing identifying was logged.
  return reply(200, {
    ok: true,
    members: candidates,
    ...(warnings.length > 0 ? { warnings } : {}),
  })
})
