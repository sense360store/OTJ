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
// THE CHILDREN'S DATA BOUNDARY, amended by 0045_spond_links.sql. Spond
// event responses identify children and their parents. This function
// still NEVER reads a name, an email, a phone number, a comment, a
// guardian or the recipients object, and none of those reaches any
// column, any log line or this function's response body. It derives the
// four integer counts per event in memory as before.
//
// What changed: for LINKED members only, it also writes one closed reply
// state per event to spond_event_responses. The only Spond identifier it
// stores is the opaque member id, and only for a member a human bound to
// a roster child in the management screen. A row for an UNLINKED member
// is unrepresentable, not merely avoided: spond_event_responses_link_fk
// refuses it. When the link set cannot be proved (see the three state
// rule below) this function writes and deletes NOTHING.
//
// RSVP is context, never attendance. Nothing here reads, writes,
// defaults or constrains register_entries; the register is the coach's
// own record. Spond response bodies and headers are never logged; errors
// log the HTTP status and our own context only. The derivations live in
// ../_shared/spond.ts and are pinned by spond_test.ts and
// spond_link_test.ts. See docs/security/spond-data-boundary.md.
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
  buildResponseRows,
  claimEvent,
  deriveMemberStatuses,
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

// The page size PostgREST serves and the point at which it TRUNCATES a
// larger result silently rather than erroring (max_rows). Every read here
// that could exceed it asks for an explicit range and pages, because a
// silently short link set is the one input that could make this function
// delete live context.
const PAGE = 1000

// The hard cap on links read in one run. A grassroots club is a few
// hundred children; reaching this means something is wrong, and a
// possibly partial set is treated as UNKNOWN, never as the truth.
const MAX_LINKED_MEMBERS = 2000

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

  // The capability gate, before Spond is contacted at all AND before the
  // secrets are looked at, so a caller who may not sync learns nothing
  // about how the server is configured. (This orders the two gates the
  // way spond-roster-import already does; a misconfigured club whose
  // caller lacks the capability now sees 403 rather than 503.) has_perm
  // is the live SECURITY DEFINER function the spond_events write policy
  // calls (signature has_perm(capability text)), so a yes here means the
  // writes below will pass RLS and a no refuses early.
  const { data: canSync, error: permError } = await caller.db.rpc('has_perm', { capability: 'sessions.create' })
  if (permError) {
    return reply(500, { error: 'Could not check your access. Nothing was synced.' })
  }
  if (canSync !== true) {
    return reply(403, { error: 'Syncing Spond attendance needs the sessions.create capability.' })
  }

  // Fail closed while the dedicated organiser account is not configured.
  // The function can be deployed before the secrets exist; only a real
  // sync needs them.
  if (!SPOND_EMAIL || !SPOND_PASSWORD) {
    return reply(503, {
      error:
        'The Spond account is not configured. An administrator must set the SPOND_EMAIL and SPOND_PASSWORD function secrets. Nothing was synced.',
    })
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

  // ---------------------------------------------------------------
  // The linked member set. THREE STATES, and the distinction between
  // two of them is the most important line in this function:
  //
  //   null       UNKNOWN. We could not prove the link set. Touch NO
  //              response row: no upsert, no delete, nothing. The counts
  //              still sync.
  //   empty Set  KNOWN and empty. This club has linked nobody.
  //   non empty  KNOWN. Exactly these members may have stored context.
  //
  // Collapsing unknown into empty (the shape `linked ?? new Set()`
  // invites) would delete every stored response in the club on a
  // transient read error. An inability to prove the linked set is never
  // read as "the linked set is empty".
  //
  // Reading the links needs players.view, which a syncing coach may not
  // hold. That is a normal outcome, not a failure: the counts sync and
  // the response context is left exactly as it was.
  let linked: ReadonlySet<string> | null = null
  {
    const { data: canReadLinks, error: linkPermError } = await caller.db
      .rpc('has_perm', { capability: 'players.view' })
    if (!linkPermError && canReadLinks === true) {
      const ids = new Set<string>()
      let offset = 0
      let ok = true
      for (;;) {
        // An explicit range on every page: an unbounded read is silently
        // truncated at max_rows, and a short link set is the one input
        // that could make the reconcile below delete live rows.
        const { data: page, error: pageError } = await caller.db
          .from('player_spond_links')
          .select('spond_member_id')
          .eq('club_id', caller.clubId)
          .order('spond_member_id', { ascending: true })
          .range(offset, offset + PAGE - 1)
        if (pageError) {
          console.error('spond-sync: link read failed', { code: pageError.code })
          ok = false
          break
        }
        const rows = (page ?? []) as { spond_member_id: string }[]
        for (const row of rows) ids.add(row.spond_member_id)
        // Stop on the first EMPTY page and advance by the rows actually
        // returned, never by PAGE. Inferring "short page, therefore last
        // page" is only correct while PAGE happens to equal the server's
        // max_rows: lower max_rows and a truncated first page reads as the
        // end of the set, `ok` stays true, and the reconcile then treats
        // every link past the cut as absent and DELETES their live context.
        // A silently short link set is the one input this code must never
        // mistake for the truth, so the terminator cannot depend on a
        // server setting matching a constant here. This is the
        // useClubPlayerIdentities pattern in src/lib/queries.ts.
        if (rows.length === 0) break
        offset += rows.length
        if (offset >= MAX_LINKED_MEMBERS) {
          // A possibly partial set is UNKNOWN, never the truth.
          console.error('spond-sync: link read hit its cap; response context skipped')
          ok = false
          break
        }
      }
      if (ok) linked = ids
    }
  }
  // How many response rows this run wrote, and whether it touched them at
  // all. Deliberately NOT how many members are linked: that figure is
  // withheld by the players.view gate this caller may not hold.
  let responsesWritten = 0

  const syncedAt = new Date().toISOString()

  // ---------------------------------------------------------------
  // RSVP context for LINKED members only, for ONE batch of events that
  // has just been written. Skipped entirely when the link set is unknown
  // (see the three state rule above), so a failed link read leaves every
  // stored response exactly as it was.
  //
  // Per event: upsert what this run saw stamped with syncedAt, then
  // delete only the strictly older tail for that event. Properties this
  // buys over a delete then insert: no window in which the event has no
  // context, idempotent on a re-run, and no id list in the predicate to
  // grow or be truncated.
  //
  // ONE implementation, TWO callers: the per mapping loop below and the
  // whole group pass after it. Whole group events are this club's weekly
  // training, the sessions a coach actually runs a register for, so
  // leaving them without context would miss the case Release B exists
  // for. Factored rather than copied so the two paths cannot drift.
  //
  // Two overlapping runs, precisely, and the TWO residuals this leaves.
  //
  // ONE thing genuinely holds without a lock: no run can store a member
  // nobody linked, because spond_event_responses_link_fk refuses the row.
  // That is a database guarantee, not an ordering argument.
  //
  // "The upsert always lands before the delete" is a WITHIN RUN property
  // only. syncedAt is one constant per invocation, so this function's two
  // callers cannot fight each other. It does NOT generalise across runs,
  // and an earlier version of this comment wrongly said it did.
  //
  // Residual 1, stale stamp. The upsert sets synced_at unconditionally, so
  // an OLDER run committing after a NEWER one lowers a row's stamp and the
  // event holds that older view of who replied.
  //
  // Residual 2, transient emptying. Same cause, one step further. Run B
  // (newer, T2) upserts an event's rows; run A (older, T1) then upserts the
  // same rows, dropping their stamps to T1 because ON CONFLICT DO UPDATE
  // overwrites synced_at downward; B's tail delete, keyed on the stamp
  // alone with no member restriction, then matches them all and the event
  // is left with no stored context at all.
  //
  // Both are accepted, recorded debt, NOT impossibilities. Neither is
  // serialised behind a lock because the cost of being wrong is missing or
  // stale context, the next successful sync self heals it, and the register
  // simply shows no reply pill in the meantime. Attendance is never
  // affected: this function reads and writes no register_entries. Closing
  // residual 2 needs no lock either, only a tail delete that excludes the
  // member ids just written; that is a deliberate follow-up, not a silent
  // change inside a forward port.
  //
  // A failure here warns and moves on. The event's counts are already
  // written, the previous context is still in place, and the next run
  // self heals it.
  const reconcileResponses = async (
    rows: SpondEventRow[],
    eventRowIdBySpondId: Map<string, string>,
    responsesBySpondId: Map<string, unknown>,
    context: string,
  ): Promise<void> => {
    if (linked === null) return
    for (const row of rows) {
      const eventRowId = eventRowIdBySpondId.get(row.spond_event_id)
      if (!eventRowId) continue
      const statuses = deriveMemberStatuses(responsesBySpondId.get(row.spond_event_id), linked)
      const responseRows = buildResponseRows(caller.clubId, eventRowId, statuses, syncedAt)
      if (responseRows.length > 0) {
        const { error: rsvpError } = await caller.db
          .from('spond_event_responses')
          .upsert(responseRows, { onConflict: 'spond_event_id,spond_member_id' })
        if (rsvpError) {
          console.error('spond-sync: response upsert failed', { scope: context, code: rsvpError.code })
          continue // leave the tail alone: the previous context stays
        }
        responsesWritten += responseRows.length
      }
      // The tail runs even with nothing to upsert: an event every linked
      // member has left should lose its stored context, not keep the last
      // run's.
      const { error: tailError } = await caller.db
        .from('spond_event_responses')
        .delete()
        .eq('spond_event_id', eventRowId)
        .lt('synced_at', syncedAt)
      if (tailError) {
        console.error('spond-sync: response tail delete failed', { scope: context, code: tailError.code })
      }
    }
  }
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
  // The subgroups that actually ANSWERED an events query this run. A mapped
  // subgroup whose query failed is configured but told us nothing, so it is
  // not in here and the whole group pass re-asks it. Keying that pass on the
  // mappings instead would treat a failed subgroup as asked, and the group
  // wide query would then store that team's own fixtures as club events.
  const answeredSubgroups = new Set<string>()
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
      answeredSubgroups.add(mapping.spond_subgroup_id)
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
    // The response arrays of each event this mapping newly queued, kept
    // beside the row so the reconcile below can read them without a
    // second pass over the payload. Nothing else from the event is kept.
    const queuedResponses = new Map<string, unknown>()
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
      queuedResponses.set(row.spond_event_id, (event as { responses?: unknown } | null)?.responses)
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
    // The returning projection is the only change to this write: no
    // column, no value and no conflict target moves. It exists so the
    // response reconcile below knows each event's row id without a
    // second read.
    const eventRowIdBySpondId = new Map<string, string>()
    if (upserts.length > 0) {
      const { data: written, error: writeError } = await caller.db
        .from('spond_events')
        .upsert(upserts, { onConflict: 'club_id,spond_event_id' })
        .select('id, spond_event_id')
      if (writeError) {
        console.error('spond-sync: upsert failed', { mapping: mapping.id, code: writeError.code })
        failed('Could not write the synced events. Check your access and try again.', warnings)
        continue
      }
      for (const row of (written ?? []) as { id: string; spond_event_id: string }[]) {
        eventRowIdBySpondId.set(row.spond_event_id, row.id)
      }
    }

    // RSVP context for this mapping's events. The rationale lives once, on
    // reconcileResponses above, so it cannot drift from the whole group
    // pass's identical call.
    await reconcileResponses(rows, eventRowIdBySpondId, queuedResponses, mapping.id)

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
      answeredSubgroupIds: [...answeredSubgroups],
      hasWholeGroupMapping: groupMappings.some((m) => !m.spond_subgroup_id),
      truncated: truncatedGroups.has(groupId),
    })
    if (!gate.ok) {
      skip(gate.reason)
      continue
    }

    // Ask every subgroup that has not already answered: the unmapped ones,
    // and any mapped one whose own query failed above. Only event ids are
    // read from these responses: no row is built and nothing is stored.
    const mapped = new Set(
      groupMappings.map((m) => m.spond_subgroup_id).filter((id): id is string => typeof id === 'string' && !!id),
    )
    const unasked = gate.unasked
    let unmappedFailed = false
    for (const subgroupId of unasked) {
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

    // Only the responses object per event, the same single field the per
    // mapping path collects, taken from the response already in hand. The
    // recipients object beside it, which embeds member names, is not read
    // here any more than it is there, and deriveMemberStatuses reduces this
    // to linked member ids and a closed reply state before anything is
    // stored.
    // Keyed only by the events this pass actually CLASSIFIED as whole group,
    // never by everything the group wide query returned. The unmapped
    // subgroup's own events are in byId and are deliberately not carried
    // here: nothing downstream would store them, and not holding their
    // responses at all is the stronger statement.
    const wholeGroupIds = wholeGroupEventIds(byId.keys(), subgroupSeen)
    const wholeGroupResponses = new Map<string, unknown>()
    for (const eventId of wholeGroupIds) {
      const event = byId.get(eventId)
      wholeGroupResponses.set(eventId, (event as { responses?: unknown } | null)?.responses)
    }

    const rows: SpondEventRow[] = []
    let malformed = 0
    let capped = false
    for (const eventId of wholeGroupIds) {
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

    // The returning projection is what lets the RSVP reconcile below key on
    // the event's row id, exactly as the per mapping path does.
    const wholeGroupRowIds = new Map<string, string>()
    if (rows.length > 0) {
      const { data: written, error: writeError } = await caller.db
        .from('spond_events')
        .upsert(rows, { onConflict: 'club_id,spond_event_id' })
        .select('id, spond_event_id')
      if (writeError) {
        console.error('spond-sync: whole group upsert failed', { group: groupId, code: writeError.code })
        record({ status: 'failed', reason: 'Could not write the whole group events.', whole_group_events: 0 })
        continue
      }
      for (const written_row of (written ?? []) as { id: string; spond_event_id: string }[]) {
        wholeGroupRowIds.set(written_row.spond_event_id, written_row.id)
      }
    }

    // RSVP context for the whole group events too. Without this the weekly
    // training, the one session a coach runs a register for every week,
    // would be the only thing in the club with no replies beside the names.
    // The responses come from the group wide response already in hand, so
    // nothing is refetched and the aggregate event path is untouched.
    await reconcileResponses(rows, wholeGroupRowIds, wholeGroupResponses, `whole-group:${groupId}`)

    eventsTotal += rows.length
    const notes: string[] = []
    const unmappedCount = unasked.filter((id) => !mapped.has(id)).length
    const reasked = unasked.length - unmappedCount
    if (unmappedCount > 0) {
      notes.push(
        unmappedCount === 1
          ? '1 subgroup is not mapped to a team; its own events were excluded.'
          : `${unmappedCount} subgroups are not mapped to a team; their own events were excluded.`,
      )
    }
    if (reasked > 0) {
      notes.push(
        `${reasked} mapped subgroup${reasked === 1 ? '' : 's'} did not answer above and ${reasked === 1 ? 'was' : 'were'} asked again here, so ${reasked === 1 ? 'its' : 'their'} events are not mistaken for whole group events.`,
      )
    }
    if (malformed > 0) {
      notes.push(`Skipped ${malformed} event${malformed === 1 ? '' : 's'} with no usable id, title or start time.`)
    }
    if (capped) notes.push(`Stopped at this run's cap of ${MAX_TOTAL_EVENTS} events.`)
    record({
      status: 'synced',
      whole_group_events: rows.length,
      subgroups_total: gate.total,
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
    // How many rows of RSVP context this run wrote, and whether it
    // touched the context at all. 'skipped' means the link set could not
    // be proved (often simply that this coach does not hold players.view)
    // and nothing was written or deleted. The number of LINKED members is
    // deliberately not reported: that is what the players.view gate
    // withholds.
    responses_written: responsesWritten,
    responses_context: linked === null ? 'skipped' : 'updated',
    ...(stopped ? { stopped } : {}),
  })
})
