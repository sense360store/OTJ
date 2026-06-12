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
  MAX_EVENTS_PER_GROUP,
  MAX_TOTAL_EVENTS,
  SPOND_API_BASE,
  SPOND_TIMEOUT_MS,
  syncWindow,
  visibleGroupIds,
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
// the group ids are read and the rest is discarded untouched.
async function spondGroupIds(token: string): Promise<{ ids: Set<string> } | { response: Response }> {
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
  return { ids: visibleGroupIds(body) }
}

// Events for one mapping: GET sponds/ with the query eventsQuery builds
// (the library's get_events parameters, the subgroup filter included when
// the mapping names one). A 429 or 5xx stops the whole sync, reported
// plainly with no retry; other failures fail this mapping and the rest
// continue. The events array is capped defensively in case the server
// ignores the max parameter.
async function spondEvents(
  token: string,
  mapping: SpondMapping,
  window: SyncWindow,
): Promise<{ events: unknown[] } | { error: string; stop?: boolean }> {
  let res: Response
  try {
    res = await fetch(`${SPOND_API_BASE}sponds/?${eventsQuery(mapping, window)}`, {
      headers: spondHeaders(token),
      signal: AbortSignal.timeout(SPOND_TIMEOUT_MS),
    })
  } catch {
    return { error: 'Could not reach Spond for this group within the timeout.' }
  }
  if (res.status === 429 || res.status >= 500) {
    console.error('spond-sync: events fetch failed', { mapping: mapping.id, status: res.status })
    await res.body?.cancel()
    return { error: `Sync stopped: Spond returned HTTP ${res.status}. Try again later.`, stop: true }
  }
  if (!res.ok) {
    console.error('spond-sync: events fetch refused', { mapping: mapping.id, status: res.status })
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

  const failures = outcomes.filter((o) => o.status === 'failed').length
  return reply(200, {
    ok: failures === 0 && !stopped,
    window: windowReport,
    mappings: outcomes,
    events_total: eventsTotal,
    ...(stopped ? { stopped } : {}),
  })
})
