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
// What this is. A manager or admin imports the children in a mapped Spond
// subgroup into that team's Hub roster, so the squad lives in one place
// instead of being cross referenced against Spond. It runs only when
// someone presses Import for a specific mapped team: never automatic,
// never on a schedule, never part of the attendance sync.
//
// THE ROSTER NAME BOUNDARY. This is the first time the Spond pipeline
// reads names, and it is deliberately isolated. From each member only the
// roster's fields are read: a display name, the child's full name as Spond
// gives it (the first and last name fields joined, e.g. "Jack Thompson"),
// and a shirt number if Spond exposes one. The full name is the user's
// decision: coaches know the children by full name and the roster is the
// single source, so the minimal form would be less readable than the Spond
// app it replaces.
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
// Security model:
//   * The Supabase client is built from the caller's JWT and the anon key,
//     so the reads and the has_perm probe run through RLS as that member. The
//     commit goes through the spond_import_roster RPC (0036), which is SECURITY
//     DEFINER and re checks the capability and club in its own body; the
//     service role key is not used in this function at all.
//   * The players.import capability is required before Spond is contacted,
//     checked by calling the live has_perm function through the caller's RLS
//     client: the same gate the spond_import_roster RPC re checks at commit,
//     so the early refusal and the authoritative enforcement cannot drift.
//     players.import defaults to managers and admins, so a coach (players.view
//     only) no longer reaches this import, making CLAUDE.md's "admin triggered"
//     description real.
//   * Credentials are the dedicated organiser account's, in the
//     SPOND_EMAIL and SPOND_PASSWORD function secrets. When either is
//     missing the function fails closed with a 503 and writes nothing.
//   * Imported children land as Pending registrations in the club's current
//     season, chosen server side; the client cannot pick a season, and the
//     function refuses when the club has none. Each run carries a batch id on
//     its audit events (source spond_import) and writes one players.spond_imported
//     summary. It records no import_batches row and reads only {name, shirt}.
// =====================================================================
import { corsHeaders, reply, resolveCaller } from '../_shared/fa.ts'
import {
  collectRosterMembers,
  extractAccessToken,
  parseIgnoredMemberIds,
  planRosterImport,
  readCappedJson,
  rosterCollectionWarnings,
  rosterMembersForCommit,
  SPOND_API_BASE,
  SPOND_MAX_BODY_BYTES,
  SPOND_TIMEOUT_MS,
} from '../_shared/spond.ts'
import type { SpondMapping } from '../_shared/spond.ts'

const SPOND_EMAIL = Deno.env.get('SPOND_EMAIL') ?? ''
const SPOND_PASSWORD = Deno.env.get('SPOND_PASSWORD') ?? ''
// Opaque member ids never to import as children: the backstop for staff
// the club has not assigned a Spond role. Parsed through the member id
// pattern, so a name cannot be expressed here.
const IGNORED_MEMBER_IDS = parseIgnoredMemberIds(Deno.env.get('SPOND_IGNORED_MEMBER_IDS'))

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
  // Cap the body: a login response is a few hundred bytes; anything huge is a
  // malformed or hostile response and is bounded rather than buffered whole.
  const body = await readCappedJson(res, SPOND_MAX_BODY_BYTES)
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
  // Cap the group list body, streaming and aborting past SPOND_MAX_BODY_BYTES so
  // an oversized or malformed response is bounded, never buffered whole. null
  // means unreadable, over the cap, or not JSON: a clear 502, not a silent
  // zero-member import.
  const body = await readCappedJson(res, SPOND_MAX_BODY_BYTES)
  if (body === null) {
    console.error('spond-roster-import: groups body unreadable or over cap')
    return { response: reply(502, { error: 'Spond returned an unreadable or oversized group list. Nothing was imported.' }) }
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

  // The capability gate FIRST, before anything else and before Spond is
  // contacted. has_perm is the live SECURITY DEFINER function; a yes here means
  // the spond_import_roster commit below will pass its own in body players.import
  // re check, and a no refuses early. The gate is players.import (managers and
  // admins by default), so the early probe and the RPC's authoritative check
  // cannot drift. It runs ahead of the secret presence check so an unauthorized
  // caller learns nothing about the server's configuration state.
  const { data: canImport, error: permError } = await caller.db.rpc('has_perm', { capability: 'players.import' })
  if (permError) {
    return reply(500, { error: 'Could not check your access. Nothing was imported.' })
  }
  if (canImport !== true) {
    return reply(403, { error: 'Importing a Spond squad needs the players.import capability.' })
  }

  // Fail closed while the dedicated organiser account is not configured. Only an
  // authorized caller reaches this point, so it reveals nothing to an outsider.
  if (!SPOND_EMAIL || !SPOND_PASSWORD) {
    return reply(503, {
      error:
        'The Spond account is not configured. An administrator must set the SPOND_EMAIL and SPOND_PASSWORD function secrets. Nothing was imported.',
    })
  }

  // The season is chosen server side: the club's current season. The client
  // cannot pick an arbitrary season, and the function refuses when the club has
  // none (registrations require a season).
  const { data: seasonRow, error: seasonError } = await caller.db
    .from('seasons')
    .select('id')
    .eq('is_current', true)
    .maybeSingle()
  if (seasonError) {
    return reply(500, { error: 'Could not read the current season. Nothing was imported.' })
  }
  if (!seasonRow) {
    return reply(409, {
      error: 'The club has no current season yet. An admin sets one up before importing. Nothing was imported.',
    })
  }
  const seasonId = (seasonRow as { id: string }).id

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

  // Collect the members of every mapping for this team, each scoped to
  // its subgroup, with staff (Spond role holders) and configured ignores
  // removed before the plan is built, so a coach in the subgroup can
  // never be imported onto the player list as a child. The whole rule
  // lives in ../_shared/spond.ts where the Deno tests hold it; a mapping
  // whose group came back empty is a warning, not a silent skip.
  const collected = collectRosterMembers(groups.groups, mappings, IGNORED_MEMBER_IDS)
  const members = collected.members
  const warnings = rosterCollectionWarnings(collected)

  // The names already registered on this team for the current season, read
  // through RLS, so the de-dupe matches on (club, season, team, display_name)
  // and re running the import adds nobody twice. The team and shirt now live on
  // the registration since the PR 2 split, so the existing names come from the
  // current season registrations for this team, joined to the identity names.
  // Read the club's CURRENT SEASON registrations across every team, not just
  // this one, and partition them. Team scoped alone is what let a child who
  // moved subgroup be imported a second time: their name was registered, but
  // to their old team, so this team's snapshot never saw it.
  //
  // This widens a read the caller already holds (registrations and identity
  // names are club wide under players.view; nothing new is readable) and
  // persists nothing. Past seasons are untouched: season_id pins the current
  // season, so a child on last season's Trojans is not a cross team case.
  // BOTH reads are paged. PostgREST caps a single response at db.max_rows
  // (1000, supabase/config.toml), and a silently truncated read here is not a
  // cosmetic miss: a registration past the cap is absent from the cross team
  // set, so the very child this guard exists to protect would be imported
  // again as a duplicate. Advance by the rows actually returned and stop on
  // the first empty page, which stays correct whatever the server cap is.
  // This is the useClubPlayerIdentities pattern in src/lib/queries.ts.
  const PAGE = 1000
  const registrations: { player_id: string; team_id: string | null }[] = []
  for (let from = 0; ; ) {
    const { data, error } = await caller.db
      .from('player_registrations')
      .select('player_id, team_id')
      .eq('club_id', caller.clubId)
      .eq('season_id', seasonId)
      .order('player_id', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) {
      return reply(500, { error: 'Could not read the existing player list. Nothing was imported.' })
    }
    const rows = (data ?? []) as { player_id: string; team_id: string | null }[]
    for (const row of rows) registrations.push(row)
    if (rows.length === 0) break
    from += rows.length
  }

  const nameById = new Map<string, string>()
  if (registrations.length > 0) {
    for (let from = 0; ; ) {
      const { data, error } = await caller.db
        .from('players')
        .select('id, display_name')
        .eq('club_id', caller.clubId)
        .order('id', { ascending: true })
        .range(from, from + PAGE - 1)
      if (error) {
        return reply(500, { error: 'Could not read the existing player list. Nothing was imported.' })
      }
      const rows = (data ?? []) as { id: string; display_name: string }[]
      for (const row of rows) nameById.set(row.id, row.display_name)
      if (rows.length === 0) break
      from += rows.length
    }
  }

  const existingNames: string[] = []
  const elsewhereNames: string[] = []
  for (const reg of registrations) {
    const name = nameById.get(reg.player_id)
    if (name === undefined) continue
    // ANY current season registration that is not on this team counts, whatever
    // its team or status: another team, Unassigned (team_id null), or withdrawn.
    //
    // The rule is deliberately about EXISTENCE, not about team. A child with any
    // current season registration already has an identity, so inserting them
    // here does not assign them anywhere: spond_import_roster only ever inserts,
    // never updates, so it would mint a SECOND player row with a SECOND current
    // season registration. The unique (player_id, season_id) constraint does not
    // stop that, because the new row carries a new player_id. Narrowing this to
    // "another team" would leave the duplicate this guard exists to prevent wide
    // open on the Unassigned and withdrawn paths.
    //
    // Status is ignored on both sides for the same reason: a child withdrawn
    // from this team is still an existing identity, and re-importing them must
    // not mint a second one.
    if (reg.team_id === teamId) existingNames.push(name)
    else elsewhereNames.push(name)
  }

  // Reduce each member to name plus optional number and plan the inserts
  // against the names already registered on this team this season. The
  // reduction discards everything else; planRosterImport never echoes a member,
  // only counts. The dedupe cannot distinguish two different children who share
  // a name in the same subgroup (Spond member ids are never persisted): the
  // second is treated as already present. Genuine same name members are
  // represented by a manual add or an id keyed spreadsheet import.
  const plan = planRosterImport(members, existingNames, elsewhereNames)

  // A member already registered to another team this season is NOT imported and
  // NOT moved. Their team is a question only a proved identity can answer, and
  // a Spond member id is never persisted, so the run reports the count and
  // leaves the decision to a manager. Counts only: no name reaches this warning,
  // the response or any log line.
  if (plan.registeredElsewhere > 0) {
    warnings.push(
      plan.registeredElsewhere === 1
        ? '1 member is already registered elsewhere in this season (another team, Unassigned, or withdrawn) and was not imported, so no second record was created for them. Check the Registered players page to see where they are and change it there if they have moved.'
        : `${plan.registeredElsewhere} members are already registered elsewhere in this season (another team, Unassigned, or withdrawn) and were not imported, so no second record was created for them. Check the Registered players page to see where they are and change it there if they have moved.`,
    )
  }

  // Commit through the transactional spond_import_roster RPC (0036), not a per
  // member add_player loop. In one transaction, gated on players.import and the
  // caller's club (both re derived server side), it inserts a new identity plus
  // a Pending current season registration for every name still new at commit
  // (re snapshotting under a per team advisory lock, so a concurrent import
  // never double inserts), stamps the audit context so each row carries source
  // 'spond_import' and this run's batch id, and writes exactly one
  // players.spond_imported summary. It records no import_batches row, and it
  // receives only {name, shirt_number}, never a Spond member id. A failure
  // rolls the whole run back, so a partial import cannot occur. The client
  // minted batch id is an audit grouping key only.
  const batchId = crypto.randomUUID()
  const { data: committed, error: commitError } = await caller.db.rpc('spond_import_roster', {
    p_batch_id: batchId,
    p_team_id: teamId,
    p_members: rosterMembersForCommit(plan.inserts),
  })
  if (commitError) {
    console.error('spond-roster-import: spond_import_roster failed', { code: commitError.code })
    return reply(500, {
      error: 'Could not write the imported players. Check your access and try again. Nothing was imported.',
    })
  }

  // Counts: added is the RPC's server derived insert count (authoritative,
  // reflecting the commit under the advisory lock). already_present and skipped
  // combine the preview's pre filter with anything the RPC re classified at
  // commit (a concurrent import that landed a name first, or a name the RPC
  // itself rejected). Those three plus registered_elsewhere, the members left
  // alone because they already hold a current season registration, are the four
  // buckets that sum to the reduced member total.
  //
  // A LIMIT WORTH STATING. This guard runs in the Edge Function, outside the
  // RPC's per (club, team) advisory lock, and spond_import_roster's own commit
  // time dedupe is still team scoped. So it closes the path every real import
  // takes, and it does NOT make the duplicate unrepresentable: a direct RPC
  // call, or two imports of different teams racing, can still mint a second
  // identity. Closing it at the database needs a gated migration to widen the
  // RPC's snapshot, which is deliberately not in this hotfix.
  const result = (committed ?? {}) as { added?: number; already_present?: number; skipped?: number }
  const added = result.added ?? 0
  const alreadyPresent = plan.alreadyPresent + (result.already_present ?? 0)
  const skipped = plan.skipped + (result.skipped ?? 0)

  return reply(200, {
    ok: true,
    added,
    already_present: alreadyPresent,
    skipped,
    // Server derived count of members left alone because their name is already
    // registered to another team this season. A count, never a name.
    registered_elsewhere: plan.registeredElsewhere,
    warnings,
  })
})
