// =====================================================================
// spond-sync Edge Function
//
// REVIEW REQUIRED, AND GATED BEYOND MERGE: merging this file puts
// nothing live. After merge the function is reviewed line by line in
// the main session and deployed through the Supabase connector from
// merged main with verify_jwt on, then verified by reading the deployed
// source back and checking its content, never by trusting a version
// number. A real sync additionally needs the dedicated Spond organiser
// account and its two secrets (below), and a first spond_groups mapping
// row inserted by an admin.
//
// What this is. Spond is where the club arranges sessions and parents
// respond. A coach triggers this function to pull attendance for the
// mapped Spond groups into spond_events, counts only. See CLAUDE.md,
// Spond integration, for the standing policy.
//
// THE CHILDREN'S DATA BOUNDARY. Spond event responses identify children
// and their parents. The function derives four integer counts per event
// in memory and discards everything else: never member ids, names,
// emails, phone numbers, comments or any payload fragment, in any
// column, any log line, or this function's response body. Spond
// response bodies and headers are never logged; errors log the HTTP
// status and our own context only. The derivation lives in
// ../_shared/spond.ts and is pinned by spond_test.ts.
//
// Read only toward Spond. Authentication is the only non GET call. The
// function never creates, modifies, cancels or responds to anything on
// Spond. Endpoints and shapes are ported from the reference library
// github.com/Olen/Spond (read at build time); it is a reference, not a
// dependency.
//
// Security model, identical to fa-import:
//   * The Supabase client is built from the caller's JWT and the anon
//     key, so every read and write goes through RLS as that coach. The
//     service role key is not used in this function at all.
//   * The sessions.create capability is required before Spond is
//     contacted, checked by calling the live has_perm function through
//     the caller's RLS client: the exact function the spond_events
//     write policy uses, so the early check and the RLS enforcement
//     cannot drift.
//   * Credentials are the dedicated organiser account's, in the
//     SPOND_EMAIL and SPOND_PASSWORD function secrets. When either is
//     missing the function fails closed with a 503 and writes nothing.
// =====================================================================
import { corsHeaders, reply, resolveCaller } from '../_shared/fa.ts'
import {
  buildEventRow,
  claimEvent,
  eventsQuery,
  extractAccessToken,
  groupSubgroupIds,
  MAX_EVENTS_PER_GROUP,
  MAX_TOTAL_EVENTS,
  SPOND_API_BASE,
  SPOND_TIMEOUT_MS,
  syncWindow,
  visibleGroupIds,
  wholeGroupEventIds,
  wholeGroupGate,
  WINDOW_BACK_DAYS,
  WINDOW_FORWARD_DAYS,
} from '../_shared/spond.ts'
import type { SpondEventRow, SpondMapping, SyncWindow } from '../_shared/spond.ts'

const SPOND_EMAIL = Deno.env.get('SPOND_EMAIL') ?? ''
const SPOND_PASSWORD = Deno.env.get('SPOND_PASSWORD') ?? ''

// The per mapping summary the response carries: our mapping id, our
// display label, counts and plain failures. Never any Spond payload
// content.
interface MappingOutcome {
  id: string
  spond_name: string
  status: 'synced' | 'failed'
  events: number
  warnings?: string[]
  error?: string
}

// The per parent group summary the whole group pass reports: the Spond
// group id we were already given in the mapping, counts, and plain
// reasons. The counts are what prove the scoping fact on a real sync:
// group_wide_returned against the subgroup queries' reach. Never any
// Spond payload content, and never a subgroup name.
interface WholeGroupOutcome {
  spond_group_id: string
  status: 'synced' | 'skipped' | 'failed'
  whole_group_events: number
  reason?: string
  notes?: string[]
  subgroups_total?: number
  subgroups_mapped?: number
  group_wide_returned?: number
}

// The exact header shape the reference library sends on every
// authenticated call (base.py auth_headers).
function spondHeaders(token: string): HeadersInit {
  return { 'content-type': 'application/json', Authorization: `Bearer ${token}` }
}

// Sign in to Spond as the dedicated organiser account: POST auth2/login
// with the email and password, token at accessToken.token, the flow
// ported from the reference library's base.py. The only non GET call.
// The response body is read for the token and nothing else; a failed
// login can carry 2FA challenge tokens and a phone number, so neither
// the body nor its headers are ever logged or echoed.
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
    return { response: reply(502, { error: 'Could not reach Spond to sign in. Nothing was synced.' }) }
  }
  if (!res.ok) {
    console.error('spond-sync: login failed', { status: res.status })
    await res.body?.cancel()
    return {
      response: reply(502, {
        error: `Spond sign in failed (HTTP ${res.status}). Check the SPOND_EMAIL and SPOND_PASSWORD secrets. Nothing was synced.`,
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
    console.error('spond-sync: login returned no usable token')
    return { response: reply(502, { error: 'Spond sign in did not return a usable token. Nothing was synced.' }) }
  }
  return { token }
}

// The groups the organiser account can see: GET groups/, ported from the
// reference library's get_groups. The response carries member names; only
// the group ids and each group's subgroup ids are read, and the rest,
// the members array included, is discarded untouched.
//
// The subgroup ids come from the group's own subGroups array (the
// reference library's Group.subgroups, aliased from "subGroups", whose
// entries are Subgroup {id, name}). Only the ids are taken, never a
// subgroup name and never anything from the members beside them. They are
// derived here and the response body is dropped, so no member data
// outlives this function. A group whose subGroups is unreadable maps to
// null, the fail closed signal the whole group pass refuses to guess past.
async function spondGroupIds(
  token: string,
): Promise<{ ids: Set<string>; subgroupsByGroup: Map<string, string[] | null> } | { response: Response }> {
  let res: Response
  try {
    res = await fetch(`${SPOND_API_BASE}groups/`, {
      headers: spondHeaders(token),
      signal: AbortSignal.timeout(SPOND_TIMEOUT_MS),
    })
  } catch {
    return { response: reply(502, { error: 'Could not fetch the Spond group list. Nothing was synced.' }) }
  }
  if (!res.ok) {
    console.error('spond-sync: groups fetch failed', { status: res.status })
    await res.body?.cancel()
    return {
      response: reply(502, { error: `Spond refused the group list (HTTP ${res.status}). Nothing was synced.` }),
    }
  }
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    body = null
  }
  const ids = visibleGroupIds(body)
  const subgroupsByGroup = new Map<string, string[] | null>()
  for (const id of ids) subgroupsByGroup.set(id, groupSubgroupIds(body, id))
  return { ids, subgroupsByGroup }
}

// Events for one mapping: GET sponds/ with the query eventsQuery builds
// (the library's get_events parameters, the subgroup filter included when
// the mapping names one). A 429 or 5xx stops the whole sync, reported
// plainly with no retry; other failures fail this mapping and the rest
// continue. The events array is capped defensively in case the server
// ignores the max parameter.
// The scope of one events query: a mapping's group and subgroup, or the
// synthetic whole group and unmapped subgroup scopes the whole group pass
// builds. `id` is our own label for logging, never anything from Spond.
interface EventScope {
  id: string
  spond_group_id: string
  spond_subgroup_id: string | null
}

async function spondEvents(
  token: string,
  scope: EventScope,
  window: SyncWindow,
): Promise<{ events: unknown[] } | { error: string; stop?: boolean }> {
  let res: Response
  try {
    res = await fetch(`${SPOND_API_BASE}sponds/?${eventsQuery(scope, window)}`, {
      headers: spondHeaders(token),
      signal: AbortSignal.timeout(SPOND_TIMEOUT_MS),
    })
  } catch {
    return { error: 'Could not reach Spond for this group within the timeout.' }
  }
  if (res.status === 429 || res.status >= 500) {
    console.error('spond-sync: events fetch failed', { scope: scope.id, status: res.status })
    await res.body?.cancel()
    return { error: `Sync stopped: Spond returned HTTP ${res.status}. Try again later.`, stop: true }
  }
  if (!res.ok) {
    console.error('spond-sync: events fetch refused', { scope: scope.id, status: res.status })
    await res.body?.cancel()
    return { error: `Spond refused this group's events (HTTP ${res.status}).` }
  }
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    body = null
  }
  // The library documents null as the no events shape; anything else
  // non array is an unexpected response, reported without echoing it.
  if (body === null) return { events: [] }
  if (!Array.isArray(body)) return { error: 'Spond returned an unexpected events response.' }
  return { events: body.slice(0, MAX_EVENTS_PER_GROUP) }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return reply(405, { error: 'Method not allowed.' })

  const resolved = await resolveCaller(req)
  if ('response' in resolved) return resolved.response
  const { caller } = resolved

  // Fail closed while the dedicated organiser account is not configured.
  // The function can be deployed before the secrets exist; only a real
  // sync needs them.
  if (!SPOND_EMAIL || !SPOND_PASSWORD) {
    return reply(503, {
      error:
        'The Spond account is not configured. An administrator must set the SPOND_EMAIL and SPOND_PASSWORD function secrets. Nothing was synced.',
    })
  }

  // The capability gate, before Spond is contacted at all. has_perm is
  // the live SECURITY DEFINER function the spond_events write policy
  // calls (signature has_perm(capability text)), so a yes here means the
  // writes below will pass RLS and a no refuses early.
  const { data: canSync, error: permError } = await caller.db.rpc('has_perm', { capability: 'sessions.create' })
  if (permError) {
    return reply(500, { error: 'Could not check your access. Nothing was synced.' })
  }
  if (canSync !== true) {
    return reply(403, { error: 'Syncing Spond attendance needs the sessions.create capability.' })
  }

  // The club's mappings, read through RLS as the caller. The sync touches
  // only groups present here: spond_groups is the allow list. Mappings
  // are processed in creation order, so attribution is deterministic:
  // an event matched again with the same team stays on that team, and an
  // event matched by mappings with different teams becomes a club event
  // with no team (claimEvent in ../_shared/spond.ts).
  const { data: mappingRows, error: mappingsError } = await caller.db
    .from('spond_groups')
    .select('id, spond_group_id, spond_subgroup_id, spond_name, team_id')
    .eq('club_id', caller.clubId)
    .order('created_at', { ascending: true })
  if (mappingsError) {
    return reply(500, { error: 'Could not read the Spond group mappings. Nothing was synced.' })
  }
  const mappings = (mappingRows ?? []) as SpondMapping[]

  const window = syncWindow(new Date())
  const windowReport = {
    from: window.from,
    to: window.to,
    back_days: WINDOW_BACK_DAYS,
    forward_days: WINDOW_FORWARD_DAYS,
  }

  // No mappings is a normal outcome, not an error.
  if (mappings.length === 0) {
    return reply(200, {
      ok: true,
      message: 'No Spond groups are mapped yet. An admin adds the first mapping.',
      window: windowReport,
      mappings: [],
      events_total: 0,
    })
  }

  const login = await spondLogin()
  if ('response' in login) return login.response

  // The account's groups, fetched once and reconciled against the
  // mappings: a mapping the organiser account cannot see is reported as
  // failed, not silently skipped, and the rest continue.
  const groups = await spondGroupIds(login.token)
  if ('response' in groups) return groups.response

  const syncedAt = new Date().toISOString()
  const outcomes: MappingOutcome[] = []
  // The row each event id first queued this run, the shared attribution
  // state claimEvent reads and rewrites.
  const queuedRows = new Map<string, SpondEventRow>()
  // Every event id a MAPPED subgroup query returned this run, recorded
  // before the caps and the row build can drop an event, so a truncated or
  // malformed event still counts as "a subgroup returned this". The whole
  // group pass reads it as one half of its discriminator. Ids only; nothing
  // else from these events is kept.
  const subgroupSeen = new Set<string>()
  // Parent groups where a subgroup query came back at the per query cap, so
  // its event list is truncated and subgroupSeen is incomplete for them. The
  // whole group pass fails closed on these: an event beyond the cap was
  // never seen, and calling it a whole group event would store a subgroup's
  // event as an All teams one.
  const truncatedGroups = new Set<string>()
  let processed = 0
  let eventsTotal = 0
  let stopped: string | null = null

  for (const mapping of mappings) {
    const failed = (error: string, warnings: string[] = []) =>
      outcomes.push({
        id: mapping.id,
        spond_name: mapping.spond_name,
        status: 'failed',
        events: 0,
        ...(warnings.length > 0 ? { warnings } : {}),
        error,
      })

    if (stopped) {
      failed(stopped)
      continue
    }
    if (!groups.ids.has(mapping.spond_group_id)) {
      failed('The Spond organiser account cannot see this group. Check the group id and the account membership.')
      continue
    }
    if (processed >= MAX_TOTAL_EVENTS) {
      failed(`Not synced: this run reached its cap of ${MAX_TOTAL_EVENTS} events.`)
      continue
    }

    const fetched = await spondEvents(login.token, mapping, window)
    if ('error' in fetched) {
      if (fetched.stop) stopped = fetched.error
      failed(fetched.error)
      continue
    }

    // What this subgroup query returned, recorded before anything can drop
    // an event. A whole group mapping (no subgroup) is deliberately not
    // recorded: its results already include the parent group's own events,
    // so counting them here would hide exactly what the pass looks for.
    if (mapping.spond_subgroup_id) {
      for (const event of fetched.events) {
        const eventId = (event as Record<string, unknown> | null)?.id
        if (typeof eventId === 'string' && eventId) subgroupSeen.add(eventId)
      }
      if (fetched.events.length >= MAX_EVENTS_PER_GROUP) truncatedGroups.add(mapping.spond_group_id)
    }

    const warnings: string[] = []
    if (fetched.events.length >= MAX_EVENTS_PER_GROUP) {
      warnings.push(`This group hit the cap of ${MAX_EVENTS_PER_GROUP} events; later events in the window were not synced.`)
    }

    // Reduce each event to its row: counts and facts only, everything
    // else discarded in buildEventRow. Malformed events and events an
    // earlier mapping already synced this run are counted and reported,
    // never echoed. An event an earlier mapping queued with a different
    // team is shared: claimEvent rewrites it as a club event (team_id
    // null) and the rewrite rides this mapping's upsert. The map keys
    // rewrites by event id so one upsert never targets a row twice.
    const rows: SpondEventRow[] = []
    const rewrites = new Map<string, SpondEventRow>()
    let malformed = 0
    let alreadySynced = 0
    for (const event of fetched.events) {
      if (processed >= MAX_TOTAL_EVENTS) {
        warnings.push(`Stopped at this run's cap of ${MAX_TOTAL_EVENTS} events.`)
        break
      }
      processed++
      const row = buildEventRow(caller.clubId, mapping.team_id, event, syncedAt)
      if (!row) {
        malformed++
        continue
      }
      const claim = claimEvent(queuedRows, row)
      if (claim.outcome === 'already_synced') {
        alreadySynced++
        continue
      }
      if (claim.outcome === 'shared') {
        rewrites.set(claim.rewrite.spond_event_id, claim.rewrite)
        continue
      }
      rows.push(row)
    }
    if (malformed > 0) {
      warnings.push(`Skipped ${malformed} event${malformed === 1 ? '' : 's'} with no usable id, title or start time.`)
    }
    if (alreadySynced > 0) {
      warnings.push(
        `${alreadySynced} event${alreadySynced === 1 ? ' was' : 's were'} already synced by an earlier mapping this run.`,
      )
    }
    if (rewrites.size > 0) {
      warnings.push(
        rewrites.size === 1
          ? '1 event is shared with other teams and is now a club event.'
          : `${rewrites.size} events are shared with other teams and are now club events.`,
      )
    }

    // Upsert on the unique (club_id, spond_event_id): new events insert,
    // existing ones take fresh counts, fields, the mapping's team and
    // synced_at. Re running a sync updates rows and never duplicates,
    // which is also how an event a previous run attributed to one team
    // self heals to a club event once it is detected as shared. The
    // shared rewrites ride the same call, an additional upsert on the
    // same conflict target setting team_id null. The write goes through
    // RLS as the caller.
    const upserts = [...rows, ...rewrites.values()]
    if (upserts.length > 0) {
      const { error: writeError } = await caller.db
        .from('spond_events')
        .upsert(upserts, { onConflict: 'club_id,spond_event_id' })
      if (writeError) {
        console.error('spond-sync: upsert failed', { mapping: mapping.id, code: writeError.code })
        failed('Could not write the synced events. Check your access and try again.', warnings)
        continue
      }
    }

    eventsTotal += rows.length
    outcomes.push({
      id: mapping.id,
      spond_name: mapping.spond_name,
      status: 'synced',
      events: rows.length,
      ...(warnings.length > 0 ? { warnings } : {}),
    })
  }

  // ---- The whole group pass -------------------------------------------
  // Events addressed to the parent group itself rather than to any
  // subgroup: at this club, the weekly training. See ../_shared/spond.ts
  // for the scoping fact this implements and why the discriminator reads
  // subgroup ids and nothing else.
  //
  // Per parent group: ask every subgroup Spond lists, mapped or not, then
  // ask the group with no subGroupId at all. An event the group wide query
  // returned that no subgroup query returned is addressed to the whole
  // group, and is stored as a club event with team_id null. Anything a
  // subgroup returned belongs to that subgroup: a mapped one already has
  // its team from the loop above, and an UNMAPPED one is deliberately
  // dropped. That is what stops this club's sixth, unmapped subgroup
  // surfacing in the Hub as an "All teams" event.
  const wholeGroupOutcomes: WholeGroupOutcome[] = []
  const parentGroupIds: string[] = []
  for (const mapping of mappings) {
    if (!parentGroupIds.includes(mapping.spond_group_id)) parentGroupIds.push(mapping.spond_group_id)
  }

  for (const groupId of parentGroupIds) {
    const record = (outcome: Omit<WholeGroupOutcome, 'spond_group_id'>) =>
      wholeGroupOutcomes.push({ spond_group_id: groupId, ...outcome })
    const skip = (reason: string) => record({ status: 'skipped', reason, whole_group_events: 0 })

    if (stopped) {
      skip(stopped)
      continue
    }
    if (!groups.ids.has(groupId)) {
      skip('The Spond organiser account cannot see this group.')
      continue
    }

    // FAIL CLOSED, the rule the unmapped subgroup makes necessary. Every
    // condition that stops us asking every subgroup completely skips the
    // group wide query entirely: see wholeGroupGate in ../_shared/spond.ts,
    // where those rules live so they can be tested directly.
    const groupMappings = mappings.filter((m) => m.spond_group_id === groupId)
    const subgroupIds = groups.subgroupsByGroup.get(groupId) ?? null
    const gate = wholeGroupGate({
      subgroupIds,
      mappedSubgroupIds: groupMappings
        .map((m) => m.spond_subgroup_id)
        .filter((id): id is string => typeof id === 'string' && !!id),
      hasWholeGroupMapping: groupMappings.some((m) => !m.spond_subgroup_id),
      truncated: truncatedGroups.has(groupId),
    })
    if (!gate.ok) {
      skip(gate.reason)
      continue
    }

    // Ask the subgroups this run has not already asked. Only event ids are
    // read from these responses: no row is built and nothing is stored.
    const mapped = new Set(
      groupMappings.map((m) => m.spond_subgroup_id).filter((id): id is string => typeof id === 'string' && !!id),
    )
    const unmapped = gate.unmapped
    let unmappedFailed = false
    for (const subgroupId of unmapped) {
      const fetched = await spondEvents(
        login.token,
        { id: `subgroup:${subgroupId}`, spond_group_id: groupId, spond_subgroup_id: subgroupId },
        window,
      )
      if ('error' in fetched) {
        if (fetched.stop) stopped = fetched.error
        unmappedFailed = true
        break
      }
      for (const event of fetched.events) {
        const eventId = (event as Record<string, unknown> | null)?.id
        if (typeof eventId === 'string' && eventId) subgroupSeen.add(eventId)
      }
      if (fetched.events.length >= MAX_EVENTS_PER_GROUP) truncatedGroups.add(groupId)
    }
    if (unmappedFailed) {
      skip('A subgroup could not be read, so whole group events were not synced.')
      continue
    }
    // FAIL CLOSED on truncation. A subgroup query that came back at the cap
    // has an incomplete event list, so an event it did not return may still
    // belong to it. Storing that as a club event is the same leak by another
    // route, so the group wide query is not run at all.
    if (truncatedGroups.has(groupId)) {
      skip(
        `A subgroup returned the maximum of ${MAX_EVENTS_PER_GROUP} events, so its list is incomplete and whole group events were not synced.`,
      )
      continue
    }

    const fetchedWhole = await spondEvents(
      login.token,
      { id: `whole-group:${groupId}`, spond_group_id: groupId, spond_subgroup_id: null },
      window,
    )
    if ('error' in fetchedWhole) {
      if (fetchedWhole.stop) stopped = fetchedWhole.error
      record({ status: 'failed', reason: fetchedWhole.error, whole_group_events: 0 })
      continue
    }

    const byId = new Map<string, unknown>()
    for (const event of fetchedWhole.events) {
      const eventId = (event as Record<string, unknown> | null)?.id
      if (typeof eventId === 'string' && eventId && !byId.has(eventId)) byId.set(eventId, event)
    }

    const rows: SpondEventRow[] = []
    let malformed = 0
    let capped = false
    for (const eventId of wholeGroupEventIds(byId.keys(), subgroupSeen)) {
      // An event a mapping already queued keeps the attribution it was
      // given; the pass never rewrites a team.
      if (queuedRows.has(eventId)) continue
      if (processed >= MAX_TOTAL_EVENTS) {
        capped = true
        break
      }
      processed++
      const row = buildEventRow(caller.clubId, null, byId.get(eventId), syncedAt)
      if (!row) {
        malformed++
        continue
      }
      queuedRows.set(eventId, row)
      rows.push(row)
    }

    if (rows.length > 0) {
      const { error: writeError } = await caller.db
        .from('spond_events')
        .upsert(rows, { onConflict: 'club_id,spond_event_id' })
      if (writeError) {
        console.error('spond-sync: whole group upsert failed', { group: groupId, code: writeError.code })
        record({ status: 'failed', reason: 'Could not write the whole group events.', whole_group_events: 0 })
        continue
      }
    }

    eventsTotal += rows.length
    const notes: string[] = []
    if (unmapped.length > 0) {
      notes.push(
        unmapped.length === 1
          ? '1 subgroup is not mapped to a team; its own events were excluded.'
          : `${unmapped.length} subgroups are not mapped to a team; their own events were excluded.`,
      )
    }
    if (malformed > 0) {
      notes.push(`Skipped ${malformed} event${malformed === 1 ? '' : 's'} with no usable id, title or start time.`)
    }
    if (capped) notes.push(`Stopped at this run's cap of ${MAX_TOTAL_EVENTS} events.`)
    record({
      status: 'synced',
      whole_group_events: rows.length,
      subgroups_total: mapped.size + unmapped.length,
      subgroups_mapped: mapped.size,
      group_wide_returned: byId.size,
      ...(notes.length > 0 ? { notes } : {}),
    })
  }

  const failures =
    outcomes.filter((o) => o.status === 'failed').length +
    wholeGroupOutcomes.filter((o) => o.status === 'failed').length
  return reply(200, {
    ok: failures === 0 && !stopped,
    window: windowReport,
    mappings: outcomes,
    whole_group: wholeGroupOutcomes,
    events_total: eventsTotal,
    ...(stopped ? { stopped } : {}),
  })
})
