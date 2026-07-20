// =====================================================================
// Shared Spond sync core
//
// REVIEW REQUIRED. This module is the pure logic behind the spond-sync
// Edge Function: the sync window, the events query, the counts
// derivation and the upsert row shape. It is shared with the Deno tests
// (spond_test.ts) so the parts that can be wrong quietly stay pinned.
// See CLAUDE.md, Spond integration, for the standing policy this code
// implements.
//
// THE CHILDREN'S DATA BOUNDARY, the rule that shapes this module. Spond
// event responses identify children and their parents: member ids in
// the response arrays, names elsewhere in the payload. This app never
// holds any of that. The four counts are derived in memory as array
// lengths and everything else is discarded. buildEventRow is the only
// place a Spond event becomes a database row, and SPOND_EVENT_COLUMNS
// is the complete set of columns it may carry: no member ids, no names,
// no payload fragments. The event's recipients object, which embeds
// member names, is never read at all; subgroup scoping is delegated to
// Spond's own subGroupId filter (see eventsQuery).
//
// Read only toward Spond: authentication is the only non GET call the
// function makes, and nothing here builds a write. The endpoint paths,
// parameter names, header shape, timestamp format and login response
// shape are ported from the reference library github.com/Olen/Spond
// (spond/spond.py and spond/base.py, read at build time, 2026-06-12),
// which targets the consumer API the Spond apps use. The library is the
// reference, not a dependency.
// =====================================================================

// The API base the reference library targets (_API_BASE_URL).
export const SPOND_API_BASE = 'https://api.spond.com/core/v1/'

// The defensive sync window: events starting between WINDOW_BACK_DAYS
// before now and WINDOW_FORWARD_DAYS after, at most MAX_EVENTS_PER_GROUP
// per mapping (the library's own default cap on the events endpoint) and
// at most MAX_TOTAL_EVENTS processed per invocation across all mappings.
export const WINDOW_BACK_DAYS = 14
export const WINDOW_FORWARD_DAYS = 90
export const MAX_EVENTS_PER_GROUP = 100
export const MAX_TOTAL_EVENTS = 500

// Timeout on every Spond request.
export const SPOND_TIMEOUT_MS = 15_000

// A byte cap on every Spond response body, mirroring the FA importer's caps
// discipline (_shared/fa.ts MAX_PAGE_BYTES). A grassroots club's login token and
// group list are a few KB; 5 MB is generous headroom, so a malformed or
// unexpectedly huge upstream response is bounded rather than buffered whole into
// the function's memory. See readCappedJson.
export const SPOND_MAX_BODY_BYTES = 5 * 1024 * 1024

// Read a JSON response body with a hard byte cap, streaming the body and
// aborting once the cap is exceeded, so a huge or malformed upstream response
// can never buffer past the limit. A declared content-length over the cap is
// rejected before any read. Returns the parsed value, or null when the body is
// absent, over the cap, or not valid JSON. The raw body is never logged.
export async function readCappedJson(res: Response, maxBytes: number): Promise<unknown> {
  const declared = parseInt(res.headers.get('content-length') ?? '', 10)
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel()
    return null
  }
  const reader = res.body?.getReader()
  if (!reader) {
    // No stream (e.g. an empty body): fall back to a bounded text read.
    let text: string
    try {
      text = await res.text()
    } catch {
      return null
    }
    if (new TextEncoder().encode(text).length > maxBytes) return null
    try {
      return text ? JSON.parse(text) : null
    } catch {
      return null
    }
  }
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value && value.byteLength > 0) {
        total += value.byteLength
        if (total > maxBytes) {
          await reader.cancel()
          return null
        }
        chunks.push(value)
      }
    }
  } catch {
    return null
  }
  const buf = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    buf.set(c, offset)
    offset += c.byteLength
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: false }).decode(buf))
  } catch {
    return null
  }
}

// One spond_groups mapping row, as the function reads it. spond_name is
// a team display label, never a person.
export interface SpondMapping {
  id: string
  spond_group_id: string
  spond_subgroup_id: string | null
  spond_name: string
  team_id: string
}

// The complete set of columns a synced event row may carry, mirroring
// migration 0013's spond_events plus 0018's spond_type (id is generated
// by the database). The boundary test asserts buildEventRow emits exactly
// these keys and only primitive values: four integer counts and event
// facts, never an id array or anything member identifying.
export const SPOND_EVENT_COLUMNS = [
  'club_id',
  'spond_event_id',
  'title',
  'starts_at',
  'ends_at',
  'location',
  'team_id',
  'accepted_count',
  'declined_count',
  'unanswered_count',
  'waiting_count',
  'cancelled',
  'synced_at',
  'spond_type',
] as const

// team_id is null only for a club event, one matched by more than one
// mapping in a run (see claimEvent); buildEventRow itself always writes
// the mapping's team.
export interface SpondEventRow {
  club_id: string
  spond_event_id: string
  title: string
  starts_at: string
  ends_at: string | null
  location: string | null
  team_id: string | null
  accepted_count: number
  declined_count: number
  unanswered_count: number
  waiting_count: number
  cancelled: boolean
  synced_at: string
  spond_type: string | null
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function arrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0
}

// A timestamp from the payload, normalised to ISO so Postgres always
// accepts it; null when missing or unreadable.
function isoTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null
}

// The Spond timestamp format the reference library sends (_DT_FORMAT,
// "%Y-%m-%dT00:00:00.000Z"): the UTC date with the time zeroed.
export function spondTimestamp(at: Date): string {
  return at.toISOString().slice(0, 10) + 'T00:00:00.000Z'
}

export interface SyncWindow {
  from: string
  to: string
}

export function syncWindow(now: Date): SyncWindow {
  const day = 86_400_000
  return {
    from: spondTimestamp(new Date(now.getTime() - WINDOW_BACK_DAYS * day)),
    to: spondTimestamp(new Date(now.getTime() + WINDOW_FORWARD_DAYS * day)),
  }
}

// The events query for one mapping, mirroring the reference library's
// get_events parameter names and construction order: max, scheduled,
// maxStartTimestamp, minStartTimestamp, groupId, then subGroupId. The
// scheduled value mirrors the library's wire format byte for byte
// (Python str(False) is "False"): scheduled events have no responses
// yet, so they are excluded exactly as the library excludes them by
// default.
//
// Subgroup matching: when the mapping names a subgroup, the query adds
// the subGroupId filter, the recipients model the library exposes
// ("Restrict to events within this subgroup", the parameter that
// resolved the library's issue 14). Scoping is therefore Spond's own,
// the same filter the Spond app's calendar uses, covering events
// addressed to the subgroup and to the whole group. The alternative,
// parsing each event's recipients object in memory, would mean handling
// member names and ids; delegating to the server keeps that payload
// region entirely unread.
export function eventsQuery(
  mapping: Pick<SpondMapping, 'spond_group_id' | 'spond_subgroup_id'>,
  window: SyncWindow,
): URLSearchParams {
  const params = new URLSearchParams()
  params.set('max', String(MAX_EVENTS_PER_GROUP))
  params.set('scheduled', 'False')
  params.set('maxStartTimestamp', window.to)
  params.set('minStartTimestamp', window.from)
  params.set('groupId', mapping.spond_group_id)
  if (mapping.spond_subgroup_id) params.set('subGroupId', mapping.spond_subgroup_id)
  return params
}

// The four counts, taken as the lengths of the response arrays and
// nothing else. A missing array counts as zero rather than failing.
// unconfirmedIds is deliberately ignored: it is not one of the four
// counts the schema stores. The member ids inside the arrays are never
// read, only counted.
export function deriveCounts(
  responses: unknown,
): Pick<SpondEventRow, 'accepted_count' | 'declined_count' | 'unanswered_count' | 'waiting_count'> {
  const r = asRecord(responses)
  return {
    accepted_count: arrayLength(r.acceptedIds),
    declined_count: arrayLength(r.declinedIds),
    unanswered_count: arrayLength(r.unansweredIds),
    waiting_count: arrayLength(r.waitinglistIds),
  }
}

// The location as one display string: the venue name then the address,
// the two fields the reference library's own ical example reads. Null
// when the event carries no readable location.
export function deriveLocation(location: unknown): string | null {
  const loc = asRecord(location)
  const parts: string[] = []
  for (const field of ['feature', 'address'] as const) {
    const value = loc[field]
    if (typeof value === 'string' && value.trim()) parts.push(value.trim())
  }
  return parts.length > 0 ? parts.join(', ') : null
}

// One Spond event reduced to the only row this app holds: the four
// counts plus title, times, location and the cancelled flag. Everything
// else in the payload is discarded here. Null when the event lacks the
// id, title or start time the table requires; the caller counts and
// reports the skip without echoing anything from the payload. Missing
// optional fields map to null and a missing cancelled flag to false,
// the same defensive read the reference library's ical example uses.
export function buildEventRow(
  clubId: string,
  teamId: string,
  event: unknown,
  syncedAt: string,
): SpondEventRow | null {
  const e = asRecord(event)
  const id = typeof e.id === 'string' ? e.id : ''
  const title = typeof e.heading === 'string' ? e.heading.trim() : ''
  const startsAt = isoTimestamp(e.startTimestamp)
  if (!id || !title || !startsAt) return null
  return {
    club_id: clubId,
    spond_event_id: id,
    title,
    starts_at: startsAt,
    ends_at: isoTimestamp(e.endTimestamp),
    location: deriveLocation(e.location),
    team_id: teamId,
    ...deriveCounts(e.responses),
    cancelled: e.cancelled === true,
    synced_at: syncedAt,
    // Spond's own classification of the event, the payload's spondType
    // ("EVENT" or "MATCH" in the reference library's _event_template.py):
    // an event fact about the event itself, not member data. A defensive
    // read in the style above, never a failure: a non empty string is
    // stored uppercased, anything else is null.
    spond_type: typeof e.spondType === 'string' && e.spondType ? e.spondType.toUpperCase() : null,
  }
}

// Shared event attribution. One Spond event can be matched by more than
// one mapping in a run: a whole group mapping and a sibling subgroup's,
// or two subgroups both invited to a gala. Such an event belongs to no
// single team; it is a club event and its team_id is null. The map
// records the row each event id first queued this run. A later claim
// with the SAME team keeps the team (a whole group mapping plus a
// subgroup mapping to one team) and is reported as already synced. A
// later claim with a DIFFERENT team yields the first row rewritten with
// team_id null, for an additional upsert on the same conflict target,
// idempotent by design; the map keeps the rewrite so every further claim
// of the event also reads as shared. Re running the sync self heals
// existing rows through the same path: the rewrite's upsert overwrites
// whatever team a previous run stored.
export type EventClaim =
  | { outcome: 'queued' }
  | { outcome: 'already_synced' }
  | { outcome: 'shared'; rewrite: SpondEventRow }

export function claimEvent(queued: Map<string, SpondEventRow>, row: SpondEventRow): EventClaim {
  const first = queued.get(row.spond_event_id)
  if (!first) {
    queued.set(row.spond_event_id, row)
    return { outcome: 'queued' }
  }
  if (first.team_id === row.team_id) return { outcome: 'already_synced' }
  const rewrite: SpondEventRow = { ...first, team_id: null }
  queued.set(row.spond_event_id, rewrite)
  return { outcome: 'shared', rewrite }
}

// The bearer token from a login response, the shape the reference
// library validates: { accessToken: { token: "<JWT>" } }. Null on any
// other shape. Nothing else is read from the response: a failed login
// can carry 2FA challenge tokens and a phone number, none of which may
// be logged or surfaced.
export function extractAccessToken(loginResult: unknown): string | null {
  const token = asRecord(asRecord(loginResult).accessToken).token
  return typeof token === 'string' && token ? token : null
}

// The ids of the groups the organiser account can see, from the groups
// response. Only the ids are read; the response's member lists, with
// their names, are discarded untouched. An unexpected response shape
// yields an empty set, so every mapping then reports as not visible
// rather than the sync guessing.
export function visibleGroupIds(groups: unknown): Set<string> {
  const ids = new Set<string>()
  if (!Array.isArray(groups)) return ids
  for (const group of groups) {
    const id = asRecord(group).id
    if (typeof id === 'string' && id) ids.add(id)
  }
  return ids
}

// =====================================================================
// Roster import: members to roster rows.
//
// Used only by the spond-roster-import Edge Function, never by
// spond-sync. spond-sync stays counts only and never touches a name, so
// the attendance pipeline keeps its name free boundary forever; this is
// the one place the Spond pipeline reads member names, deliberately
// isolated here and pinned by spond_roster_test.ts.
//
// THE ROSTER NAME BOUNDARY (mirrors 0021_players.sql, updated by
// 0023_players_fullname.sql). From a Spond group member only what the roster
// holds is ever read: a display name, the child's full name as Spond gives it
// (the first and last name fields joined), and an optional shirt number if
// Spond exposes one. The full name is the user's decision: coaches know the
// children by full name and the roster is the single source, so the minimal
// form would be less readable than the Spond app it replaces. Everything else
// the member object carries is never read and never stored, in particular the
// member's guardians array (guardian names, emails, phone numbers) and the
// member's own email and phoneNumber. The member is reduced to name plus
// optional number in memory and the rest is discarded, the same discipline
// buildEventRow uses for events.
//
// The member model is the reference library's (github.com/Olen/Spond,
// read at build time, and the spond-classes Member dataclass it documents:
// id, firstName, lastName, subGroups, guardians, email, phoneNumber).
// subGroups is the list of subgroup ids the member belongs to. The Ossett
// setup is the children as members, so a member's firstName and lastName
// are the child's name (the user confirmed this single source); when a
// child profile is managed by an adult the parent appears in the member's
// guardians sub array, which is never read here.
// =====================================================================

// The roster's documented name bound, the players.display_name check
// (1 to 40). A reduced name is always clamped to this.
export const ROSTER_NAME_MAX = 40

// Defensive cap on members read from one group in one import, so a
// malformed or unexpectedly huge group response is bounded.
export const MAX_ROSTER_MEMBERS = 200

// One member reduced to the only fields the roster holds.
export interface RosterPlayer {
  display_name: string
  shirt_number: number | null
}

// The exact payload the transactional commit RPC (spond_import_roster, 0036)
// receives for a run: a reduced roster of names and optional shirt numbers
// ONLY. reduceMember already dropped every Spond member id, guardian and
// contact field before the plan; this shaping carries through only the two
// roster fields the RPC reads, so no member identifier can reach the database
// layer even by accident. Pinned by spond_roster_test.ts.
export interface RosterCommitMember {
  name: string
  shirt_number: number | null
}
export function rosterMembersForCommit(inserts: RosterPlayer[]): RosterCommitMember[] {
  return inserts.map((p) => ({ name: p.display_name, shirt_number: p.shirt_number }))
}

// The child's full name as Spond gives it: the first and last name fields
// joined, e.g. "Jack Thompson", from the member's firstName and lastName (the
// reference library's Member.first_name and last_name). When Spond gives only
// a single name field, it is stored as is. Always clamped to ROSTER_NAME_MAX,
// truncating only the rare name genuinely longer than 40. Null when no usable
// name exists. The guardians array and every other field are never read.
export function rosterDisplayName(member: unknown): string | null {
  const m = asRecord(member)
  const first = typeof m.firstName === 'string' ? m.firstName.trim() : ''
  const last = typeof m.lastName === 'string' ? m.lastName.trim() : ''
  const name = first && last ? `${first} ${last}` : first || last
  if (!name) return null
  return name.slice(0, ROSTER_NAME_MAX)
}

// An optional shirt or jersey number, only when Spond exposes one on the
// member object itself. The reference library's standard member model
// carries no such field, so this is null in practice; it is read
// defensively from a top level shirtNumber or jerseyNumber, bounded to a
// real football number (1 to 99), so a value is carried if Spond ever
// returns one. Read only from the member's own scalar fields, never from
// any nested object, so guardian data is never reached.
export function rosterShirtNumber(member: unknown): number | null {
  const m = asRecord(member)
  for (const field of ['shirtNumber', 'jerseyNumber'] as const) {
    const value = m[field]
    const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
    if (Number.isInteger(n) && n >= 1 && n <= 99) return n
  }
  return null
}

// One member reduced to a roster row, name plus optional number, or null
// when it has no usable name. The member's guardians, email, phoneNumber,
// subGroups and every other field are discarded here, never stored.
export function reduceMember(member: unknown): RosterPlayer | null {
  const display_name = rosterDisplayName(member)
  if (!display_name) return null
  return { display_name, shirt_number: rosterShirtNumber(member) }
}

// The subgroup ids a member belongs to, the member's subGroups list (the
// reference library's Member.subgroup_uids, aliased from the API key
// "subGroups"). Only the ids are read. An unexpected shape yields an empty
// list, so a subgroup mapping then matches no member rather than guessing.
export function memberSubgroupIds(member: unknown): string[] {
  const value = asRecord(member).subGroups
  if (!Array.isArray(value)) return []
  return value.filter((id): id is string => typeof id === 'string' && id.length > 0)
}

// The members of one mapped group, scoped the same way the events query is
// scoped (eventsQuery): a whole group mapping (no subgroup) reads every
// member, a subgroup mapping reads only members whose subGroups list
// contains the subgroup id. The group is found by id in the groups/
// response, the same response spond-sync reads for visibleGroupIds, which
// already carries each group's members; spond-sync discards them, this
// reads them. Returns an empty list when the group is absent or its
// members are not an array, capped at MAX_ROSTER_MEMBERS.
export function selectGroupMembers(groups: unknown, groupId: string, subgroupId: string | null): unknown[] {
  if (!Array.isArray(groups)) return []
  const group = groups.find((g) => asRecord(g).id === groupId)
  const members = asRecord(group).members
  if (!Array.isArray(members)) return []
  const scoped = subgroupId === null ? members : members.filter((m) => memberSubgroupIds(m).includes(subgroupId))
  return scoped.slice(0, MAX_ROSTER_MEMBERS)
}

// The import plan from the reduced members and the names already on the
// team's roster: the rows to insert and the three counts the function
// reports. De-dupe is by display name within the team (players have no
// natural key but the name, the same key the manager shows): a member
// whose name is already on the roster, or already added earlier in this
// run, is counted already present and never inserted a second time, so re
// running the import creates no duplicates. A member with no usable name
// is counted skipped. The comparison is case insensitive so "Jack Thompson"
// does not re add over an existing "jack thompson". Pure so the test pins the
// reduction and the de-dupe together.
export interface RosterImportPlan {
  inserts: RosterPlayer[]
  added: number
  alreadyPresent: number
  skipped: number
}

export function planRosterImport(members: unknown[], existingNames: Iterable<string>): RosterImportPlan {
  const seen = new Set<string>()
  for (const name of existingNames) seen.add(name.toLowerCase())
  const inserts: RosterPlayer[] = []
  let added = 0
  let alreadyPresent = 0
  let skipped = 0
  for (const member of members) {
    const reduced = reduceMember(member)
    if (!reduced) {
      skipped++
      continue
    }
    const key = reduced.display_name.toLowerCase()
    if (seen.has(key)) {
      alreadyPresent++
      continue
    }
    seen.add(key)
    inserts.push(reduced)
    added++
  }
  return { inserts, added, alreadyPresent, skipped }
}
