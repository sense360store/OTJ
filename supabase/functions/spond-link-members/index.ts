// =====================================================================
// spond-link-members Edge Function
//
// REVIEW REQUIRED, AND GATED BEYOND MERGE: merging this file puts
// nothing live. After merge the function is reviewed line by line in the
// main session and deployed through the Supabase connector from merged
// main with verify_jwt on, then verified by reading the deployed source
// back and checking its content, never by trusting a version number. A
// real call additionally needs the dedicated Spond organiser account and
// its two secrets, and a spond_groups mapping for the team.
//
// What this is. A manager opens the Spond links screen for one team and
// needs to see who is in that team's Spond group so they can bind each
// member to a child on the roster. This function is the read that shows
// them, and it is the whole of its job.
//
// IT PERSISTS NOTHING. It has no write of any kind, to any table, in any
// branch. The link row the browser then inserts carries the member id,
// the player id and matched_by, and nothing else.
//
// THE NAME BOUNDARY. This is the second of exactly two functions that
// read a Spond member's name, and the only one that does not persist
// one. From each member it reads exactly four things: the opaque id, the
// first and last name fields joined (rosterDisplayName), the opaque
// subGroups list (which subgroup a member is in, the scoping the
// candidate list has always used and the fact the diagnostics report),
// and the opaque roles list (staff exclusion). The member's guardians
// (names, emails, phone numbers), its own email, phoneNumber, address and
// every other profile field are never reached, so they cannot be returned
// even by accident. Both return shapes are closed, LinkCandidate for
// linking and LinkDiagnosticMember for the diagnostics, and are pinned by
// spond_link_test.ts, which asserts the ABSENCE of those fields from the
// serialised output.
//
// THE DIAGNOSTICS ARE READ ONLY AND LINK NOBODY. They report what the
// team's mapped subgroup MISSES so a manager can fix the Spond side: a
// member in the parent group with no subgroup, or in another one. They
// carry no member id, so nothing can be linked from them, and the closed
// LinkCandidate shape stays the only thing linking is built on. They come
// from the SAME groups/ response the candidates come from: no second
// Spond call is made, which the deploy workflow's endpoint assertion
// holds this function to.
//
// The display name is TRANSIENT. It exists so the manager can tell who
// they are binding. It is stored nowhere, logged nowhere, and the client
// holds it in a mutation result with gcTime 0 so it does not outlive the
// screen. Every name the product shows for a linked child afterwards is
// players.display_name.
//
// NO LOGGING OF NAMES. Like spond-sync and spond-roster-import, this
// logs only HTTP status, our own error codes and our own team id: never
// payload content, never a name, never a member id.
//
// Read only toward Spond. Authentication is the only non GET call. The
// function never creates, modifies, cancels or responds to anything on
// Spond. Endpoints and shapes are ported from the reference library
// github.com/Olen/Spond (read at build time); it is a reference, not a
// dependency.
//
// Security model:
//   * The Supabase client is built from the caller's JWT and the anon
//     key, so the mapping read and the has_perm probe run through RLS as
//     that member. The service role key is not used in this function at
//     all, and no write path exists to use it for.
//   * The players.manage capability is required before anything else:
//     the exact capability the player_spond_links insert policy names,
//     so a yes here means the link the browser then writes will pass RLS
//     and a no refuses early. The gate runs BEFORE the secret presence
//     check and before the mapping read, so an unauthorised caller
//     learns neither the server's configuration state nor whether this
//     team has a Spond group.
//   * Credentials are the dedicated organiser account's, in the
//     SPOND_EMAIL and SPOND_PASSWORD function secrets. When either is
//     missing the function fails closed with a 503.
// =====================================================================
import { corsHeaders, reply, resolveCaller } from '../_shared/fa.ts'
import {
  collectLinkCandidates,
  collectLinkDiagnostics,
  extractAccessToken,
  linkCollectionWarnings,
  parseIgnoredMemberIds,
  readCappedJson,
  SPOND_API_BASE,
  SPOND_MAX_BODY_BYTES,
  SPOND_TIMEOUT_MS,
} from '../_shared/spond.ts'
import type { SpondMapping } from '../_shared/spond.ts'

const SPOND_EMAIL = Deno.env.get('SPOND_EMAIL') ?? ''
const SPOND_PASSWORD = Deno.env.get('SPOND_PASSWORD') ?? ''
// Opaque member ids never to offer as children: the backstop for staff
// the club has not assigned a Spond role. Parsed through the same id
// pattern the links table enforces, so a name cannot be expressed here.
const IGNORED_MEMBER_IDS = parseIgnoredMemberIds(Deno.env.get('SPOND_IGNORED_MEMBER_IDS'))

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// The exact header shape the reference library sends on every
// authenticated call (base.py auth_headers), mirrored from spond-sync.
function spondHeaders(token: string): HeadersInit {
  return { 'content-type': 'application/json', Authorization: `Bearer ${token}` }
}

// Sign in as the dedicated organiser account: POST auth2/login, token at
// accessToken.token, mirrored from spond-sync. The only non GET call. The
// response body is read for the token and nothing else; a failed login
// can carry 2FA challenge tokens and a phone number, so neither the body
// nor its headers are ever logged or echoed.
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
// spond-roster-import. The response carries each group's members; only
// the matched group's members are read, and only through
// reduceLinkCandidate, which touches two fields per member.
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

  // The capability gate FIRST, before the secrets, before the mapping
  // read and before Spond is contacted. players.manage is the exact
  // capability the player_spond_links insert policy names, so the early
  // refusal and the authoritative enforcement cannot drift. Running it
  // first means an unauthorised caller learns nothing at all: not whether
  // the club has Spond configured, and not whether this team is mapped.
  const { data: canManage, error: permError } = await caller.db.rpc('has_perm', { capability: 'players.manage' })
  if (permError) {
    return reply(500, { error: 'Could not check your access.' })
  }
  if (canManage !== true) {
    return reply(403, { error: 'Linking Spond members needs the players.manage capability.' })
  }

  // Fail closed while the organiser account is not configured. Only an
  // authorised caller reaches this point, so it reveals nothing to an
  // outsider.
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
  const teamId = typeof parsed.team_id === 'string' && UUID.test(parsed.team_id) ? parsed.team_id : ''
  if (!teamId) {
    return reply(400, { error: 'Choose a team to link.' })
  }

  // The team's mappings, read through RLS as the caller. spond_groups is
  // the allow list: only groups present here are read, and only those for
  // the requested team. No mapping is a normal outcome with a plain
  // message, not an error.
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
      team_id: teamId,
      members: [],
      truncated: false,
      // No mapping means no Spond group was read, so nothing about a
      // registered player's Spond setup is known and none is claimed.
      diagnostic_members: [],
      diagnostic_complete: false,
      warnings: ['This team has no Spond group mapped. An admin adds the mapping on the Spond admin page.'],
    })
  }

  const login = await spondLogin()
  if ('response' in login) return login.response

  const groups = await spondGroups(login.token)
  if ('response' in groups) return groups.response

  // The whole collection rule, exclusion before cap before reduction,
  // lives in ../_shared/spond.ts where the Deno tests hold it; this
  // function only carries the result to the response. The exclusion
  // counts travel as DATA beside the prose warnings, because the client
  // decides completeness from them: a subgroup whose members were all
  // staff is a complete answer, not an unproven read.
  const collected = collectLinkCandidates(groups.groups, mappings, IGNORED_MEMBER_IDS)
  // The setup diagnostics: the members of the SAME already fetched parent
  // group that this team's mappings do not reach, so the screen can say
  // whether a registered player's Spond member exists with no subgroup, in
  // another subgroup, or not in the group data at all, instead of showing
  // three different problems as one unexplained list. A separate, closed
  // shape rather than a widened LinkCandidate: nothing links from a
  // diagnostic row, so it carries no member id. No extra Spond call is
  // made, and nothing here is written anywhere.
  const diagnostics = collectLinkDiagnostics(groups.groups, mappings, IGNORED_MEMBER_IDS)
  return reply(200, {
    ok: true,
    team_id: teamId,
    members: collected.members,
    truncated: collected.truncated,
    staff_excluded: collected.staff,
    ignored_excluded: collected.ignored,
    diagnostic_members: diagnostics.members,
    diagnostic_complete: diagnostics.complete,
    warnings: linkCollectionWarnings(collected),
  })
})
