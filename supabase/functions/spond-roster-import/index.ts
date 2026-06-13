// =====================================================================
// spond-roster-import Edge Function
//
// REVIEW REQUIRED, AND GATED BEYOND MERGE: merging this file puts nothing
// live. After merge the function is reviewed line by line in the main
// session and deployed through the Supabase connector from merged main
// with verify_jwt on, then verified by reading the deployed source back
// and checking its content, never by trusting a version number. A real
// import additionally needs the dedicated Spond organiser account and its
// two secrets (below) and a spond_groups mapping for the team.
//
// What this is. A coach or admin imports the children in a mapped Spond
// subgroup into that team's Hub roster, so the squad lives in one place
// instead of being cross referenced against Spond. It runs only when
// someone presses Import for a specific mapped team: never automatic,
// never on a schedule, never part of the attendance sync.
//
// THE ROSTER NAME BOUNDARY. This is the first time the Spond pipeline
// reads names, and it is deliberately isolated. From each member only the
// roster's fields are read: a display name reduced to a first name plus
// last initial (e.g. "Jack T"), and a shirt number if Spond exposes one.
// The member's guardians (names, emails, phone numbers), its own email and
// phoneNumber, and every other profile field Spond returns are never read
// and never stored, the same discipline buildEventRow uses for events. The
// member to roster reduction lives in ../_shared/spond.ts and is pinned by
// spond_roster_test.ts. The Ossett group's members are the children, so a
// member's firstName and lastName are the child's name (confirmed single
// source); when a child profile is managed by an adult the parent appears
// in the member's guardians sub array, which this function never reads.
//
// NO LOGGING OF NAMES. Like spond-sync, this logs only HTTP status and
// counts: never payload content, never a name. Spond response bodies and
// headers are never logged.
//
// Read only toward Spond. Authentication is the only non GET call. The
// function never creates, modifies, cancels or responds to anything on
// Spond. Endpoints and shapes are ported from the reference library
// github.com/Olen/Spond (read at build time); it is a reference, not a
// dependency.
//
// Security model, identical to spond-sync:
//   * The Supabase client is built from the caller's JWT and the anon key,
//     so every read and write goes through RLS as that coach. The service
//     role key is not used in this function at all.
//   * The sessions.create capability is required before Spond is
//     contacted, checked by calling the live has_perm function through the
//     caller's RLS client: the same function the players write policy
//     uses, so the early check and the RLS enforcement cannot drift.
//   * Credentials are the dedicated organiser account's, in the
//     SPOND_EMAIL and SPOND_PASSWORD function secrets. When either is
//     missing the function fails closed with a 503 and writes nothing.
// =====================================================================
import { corsHeaders, reply, resolveCaller } from '../_shared/fa.ts'
import {
  extractAccessToken,
  planRosterImport,
  selectGroupMembers,
  SPOND_API_BASE,
  SPOND_TIMEOUT_MS,
} from '../_shared/spond.ts'
import type { RosterPlayer, SpondMapping } from '../_shared/spond.ts'

const SPOND_EMAIL = Deno.env.get('SPOND_EMAIL') ?? ''
const SPOND_PASSWORD = Deno.env.get('SPOND_PASSWORD') ?? ''

// The exact header shape the reference library sends on every
// authenticated call (base.py auth_headers), mirrored from spond-sync.
function spondHeaders(token: string): HeadersInit {
  return { 'content-type': 'application/json', Authorization: `Bearer ${token}` }
}

// Sign in to Spond as the dedicated organiser account: POST auth2/login,
// token at accessToken.token, mirrored from spond-sync. The only non GET
// call. The response body is read for the token and nothing else; a failed
// login can carry 2FA challenge tokens and a phone number, so neither the
// body nor its headers are ever logged or echoed.
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
    return { response: reply(502, { error: 'Could not reach Spond to sign in. Nothing was imported.' }) }
  }
  if (!res.ok) {
    console.error('spond-roster-import: login failed', { status: res.status })
    await res.body?.cancel()
    return {
      response: reply(502, {
        error: `Spond sign in failed (HTTP ${res.status}). Check the SPOND_EMAIL and SPOND_PASSWORD secrets. Nothing was imported.`,
      }),
    }
  }
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    body = null
  }
  const token = extractAccessToken(body)
  if (!token) {
    console.error('spond-roster-import: login returned no usable token')
    return { response: reply(502, { error: 'Spond sign in did not return a usable token. Nothing was imported.' }) }
  }
  return { token }
}

// The organiser account's groups: GET groups/, mirrored from spond-sync.
// Unlike the sync, which discards the member lists, the roster import reads
// the members of the matched group (and only the name and optional number
// of each, in selectGroupMembers and reduceMember). The whole response is
// fetched once and the rest is discarded untouched.
async function spondGroups(token: string): Promise<{ groups: unknown } | { response: Response }> {
  let res: Response
  try {
    res = await fetch(`${SPOND_API_BASE}groups/`, {
      headers: spondHeaders(token),
      signal: AbortSignal.timeout(SPOND_TIMEOUT_MS),
    })
  } catch {
    return { response: reply(502, { error: 'Could not fetch the Spond group list. Nothing was imported.' }) }
  }
  if (!res.ok) {
    console.error('spond-roster-import: groups fetch failed', { status: res.status })
    await res.body?.cancel()
    return { response: reply(502, { error: `Spond refused the group list (HTTP ${res.status}). Nothing was imported.` }) }
  }
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    body = null
  }
  return { groups: body }
}

interface RosterImportBody {
  team_id?: unknown
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return reply(405, { error: 'Method not allowed.' })

  const resolved = await resolveCaller(req)
  if ('response' in resolved) return resolved.response
  const { caller } = resolved

  // Fail closed while the dedicated organiser account is not configured.
  if (!SPOND_EMAIL || !SPOND_PASSWORD) {
    return reply(503, {
      error:
        'The Spond account is not configured. An administrator must set the SPOND_EMAIL and SPOND_PASSWORD function secrets. Nothing was imported.',
    })
  }

  // The capability gate, before Spond is contacted at all. has_perm is the
  // live SECURITY DEFINER function the players write policy calls, so a yes
  // here means the inserts below pass RLS and a no refuses early.
  const { data: canImport, error: permError } = await caller.db.rpc('has_perm', { capability: 'sessions.create' })
  if (permError) {
    return reply(500, { error: 'Could not check your access. Nothing was imported.' })
  }
  if (canImport !== true) {
    return reply(403, { error: 'Importing a Spond squad needs the sessions.create capability.' })
  }

  let parsed: RosterImportBody
  try {
    parsed = (await req.json()) as RosterImportBody
  } catch {
    parsed = {}
  }
  const teamId = typeof parsed.team_id === 'string' ? parsed.team_id : ''
  if (!teamId) {
    return reply(400, { error: 'Choose a team to import into. Nothing was imported.' })
  }

  // The team's mappings, read through RLS as the caller. spond_groups is
  // the allow list; the import touches only mappings present here, and
  // only those for the requested team. A team may carry more than one
  // mapping (whole group plus a subgroup, or two subgroups), so all are
  // imported and de-duped together.
  const { data: mappingRows, error: mappingsError } = await caller.db
    .from('spond_groups')
    .select('id, spond_group_id, spond_subgroup_id, spond_name, team_id')
    .eq('club_id', caller.clubId)
    .eq('team_id', teamId)
    .order('created_at', { ascending: true })
  if (mappingsError) {
    return reply(500, { error: 'Could not read the Spond group mappings. Nothing was imported.' })
  }
  const mappings = (mappingRows ?? []) as SpondMapping[]
  if (mappings.length === 0) {
    return reply(200, {
      ok: true,
      message: 'This team has no Spond group mapped. An admin adds the mapping on the Spond admin page.',
      added: 0,
      already_present: 0,
      skipped: 0,
      warnings: [],
    })
  }

  const login = await spondLogin()
  if ('response' in login) return login.response

  const groups = await spondGroups(login.token)
  if ('response' in groups) return groups.response

  // Collect the members of every mapping for this team, each scoped to its
  // subgroup. A mapping whose group the organiser account cannot see is
  // reported as a warning, not a silent skip, and the rest continue.
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

  // The names already on this team's roster, read through RLS, so the
  // de-dupe matches on (club_id, team_id, display_name) and re running the
  // import adds nobody twice.
  const { data: existingRows, error: existingError } = await caller.db
    .from('players')
    .select('display_name')
    .eq('club_id', caller.clubId)
    .eq('team_id', teamId)
  if (existingError) {
    return reply(500, { error: 'Could not read the existing roster. Nothing was imported.' })
  }
  const existingNames = (existingRows ?? []).map((r) => (r as { display_name: string }).display_name)

  // Reduce each member to name plus optional number and plan the inserts.
  // The reduction discards everything else; planRosterImport never echoes a
  // member, only counts.
  const plan = planRosterImport(members, existingNames)

  if (plan.inserts.length > 0) {
    const rows = plan.inserts.map((p: RosterPlayer) => ({
      club_id: caller.clubId,
      team_id: teamId,
      display_name: p.display_name,
      shirt_number: p.shirt_number,
      created_by: caller.userId,
    }))
    const { error: writeError } = await caller.db.from('players').insert(rows)
    if (writeError) {
      console.error('spond-roster-import: insert failed', { code: writeError.code, count: rows.length })
      return reply(500, { error: 'Could not write the imported players. Check your access and try again.' })
    }
  }

  return reply(200, {
    ok: true,
    added: plan.added,
    already_present: plan.alreadyPresent,
    skipped: plan.skipped,
    ...(warnings.length > 0 ? { warnings } : { warnings: [] }),
  })
})
