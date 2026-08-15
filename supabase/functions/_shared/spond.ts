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
// the response arrays, names elsewhere in the payload. No name, guardian,
// contact detail, comment or payload fragment is ever stored by anything
// here. The four counts are derived in memory as array lengths.
// buildEventRow is the only place a Spond EVENT becomes a database row,
// and SPOND_EVENT_COLUMNS is the complete set of columns it may carry:
// no member ids, no names, no payload fragments. The event's recipients
// object, which embeds member names, is never read at all; subgroup
// scoping is delegated to Spond's own subGroupId filter (see
// eventsQuery).
//
// Since 0045_spond_links.sql this module also shapes the per member
// reply rows, in the Release B section at the end of the file:
// buildResponseRows is the only place a member's reply becomes a row,
// SPOND_RESPONSE_COLUMNS is its complete column set, and only members a
// human has LINKED to a roster child appear in one. The opaque member id
// is the sole Spond identifier either row shape may carry. See
// docs/security/spond-data-boundary.md.
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

// Defensive cap on how many subgroup queries one parent group costs in a
// run. The whole group pass below queries every subgroup Spond lists for
// the group, mapped or not, so this bounds a group whose subgroup list is
// unexpectedly long. A group with more subgroups than this is reported and
// its whole group pass is skipped, never guessed at.
export const MAX_SUBGROUP_QUERIES = 20

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

// team_id is null for a club event, which arises two ways: an event
// matched by more than one mapping in a run (see claimEvent), or an event
// addressed to the whole parent group rather than to any subgroup (see
// the whole group pass in spond-sync). A subgroup mapping's event always
// carries that mapping's team.
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
// (Python str(True) is "True").
//
// SCHEDULED IS SENT TRUE, and that is the whole of this fix. In the
// reference library `scheduled` is an INCLUSION flag, not a filter:
// "Include scheduled events (events whose invitations are queued to be
// sent in the future). Defaults to False for performance reasons."
// Sending False therefore excluded every event whose invitations Spond
// has queued rather than already sent, which at this club is exactly the
// recurring weekly training. Fixtures and galas, whose invitations go out
// at once, arrived; training never did, and a coach could not Plan from
// Spond for the one thing they run every week.
//
// True is a superset, not a different set: normal events still come back
// unchanged, so this widens what is synced and narrows nothing. The
// window, the caps and the subgroup filter are untouched, and a scheduled
// event carries no responses yet, which deriveCounts already reads as
// four zeroes.
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
  params.set('scheduled', 'True')
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
  teamId: string | null,
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
// The whole group pass: events addressed to the parent group itself.
//
// THE SCOPING FACT THIS EXISTS FOR. subGroupId is a restriction, not a
// widening: the reference library documents it as "Restrict to events
// within this subgroup", and production proved that literal. Every one of
// this club's mappings names a subgroup, so every query carried
// subGroupId, and an event addressed to the whole parent group (the
// club's weekly training) was returned by none of them. Fixtures, which
// are addressed to a subgroup, arrived; training never did. Sending
// scheduled=True was necessary and not sufficient: it fixed which events
// Spond will consider, not which recipients scope is asked for.
//
// WHY THIS IS NOT SIMPLY "DROP subGroupId". A query without subGroupId
// returns the whole group's events AND every subgroup's events together,
// with nothing in the response saying which. Storing all of it would
// destroy team attribution, and storing "whatever the mapped subgroup
// queries missed" would be worse: this club's Spond group has six
// subgroups and five are mapped, so the sixth subgroup's events would
// land in the Hub as club wide "All teams" events, visible to every team
// and every parent. The unmapped subgroup is the leak this design exists
// to prevent.
//
// THE DISCRIMINATOR, and why it reads no person data. The event payload
// gives no usable answer: the reference library's Event model carries no
// recipients, group or subGroups field at all, and the raw recipients
// object embeds member names, which this function never reads. The group
// does give an answer. The reference library's Group model carries
// `subgroups: list[Subgroup] = Field(alias="subGroups")` and Subgroup is
// exactly `{uid (alias "id"), name}`: group structure, not membership. So
// the complete subgroup id list comes from the groups/ response the sync
// already fetches for visibleGroupIds, and only the ids are read, never a
// subgroup name, never the members array beside it.
//
// An event is therefore addressed to the whole group when the group wide
// query returned it and NO subgroup query did, with every subgroup asked,
// mapped or not. That is a fact about recipients scope derived entirely
// from event ids and subgroup ids.
// =====================================================================

// The complete subgroup id list for one parent group, read from the
// groups/ response. Group structure only: subGroups[].id, never a name,
// never a member.
//
// Null is the FAIL CLOSED signal and is not the same as an empty list.
// Null means the group is absent from the response or its subGroups is
// not an array, so the subgroup set is unknown; the caller must then skip
// the whole group pass entirely, because "returned by no subgroup query"
// is only trustworthy when every subgroup was actually asked. An empty
// array is a real answer, a group with no subgroups at all, and every
// event in it is a whole group event.
export function groupSubgroupIds(groups: unknown, groupId: string): string[] | null {
  if (!Array.isArray(groups)) return null
  const group = groups.find((g) => asRecord(g).id === groupId)
  if (group === undefined) return null
  const subs = asRecord(group).subGroups
  if (!Array.isArray(subs)) return null
  const ids: string[] = []
  for (const sub of subs) {
    const id = asRecord(sub).id
    if (typeof id === 'string' && id && !ids.includes(id)) ids.push(id)
  }
  return ids
}

// The gate on the whole group pass: every condition under which it must
// NOT run, in one pure place so the fail closed rules are testable rather
// than buried in the function.
//
// The pass may only run when every subgroup of the group was asked, and
// asked completely, because "no subgroup returned this" is the entire
// discriminator. A subgroup that was not asked, or was asked and answered
// with a truncated list, means an event could belong to it and still be
// absent from what we saw; storing that event as a club event would put a
// subgroup's private event in front of every team and every parent. In
// every one of those cases the correct answer is to sync no whole group
// events at all and say so, never to guess.
// `unasked` is every subgroup that has not already ANSWERED this run, which
// is deliberately not the same as every subgroup that is unmapped. A mapped
// subgroup whose events query failed was configured but told us nothing, so
// it is unasked: its events are absent from what we saw for a reason that
// has nothing to do with recipients scope. Keying this on the mappings
// instead would silently exclude it from the re-ask and let the group wide
// query store that team's own fixtures as All teams club events.
export type WholeGroupGate =
  | { ok: true; unasked: string[]; total: number }
  | { ok: false; reason: string }

export function wholeGroupGate(input: {
  subgroupIds: string[] | null
  answeredSubgroupIds: string[]
  hasWholeGroupMapping: boolean
  truncated: boolean
}): WholeGroupGate {
  // A mapping that already queries the whole group attributes every event it
  // returns to its own team, which is the operator's explicit choice.
  if (input.hasWholeGroupMapping) {
    return { ok: false, reason: 'This group already has a whole group mapping, which syncs its events.' }
  }
  if (input.subgroupIds === null) {
    return {
      ok: false,
      reason: 'Spond did not return a readable subgroup list for this group, so whole group events were not synced.',
    }
  }
  if (input.subgroupIds.length > MAX_SUBGROUP_QUERIES) {
    return {
      ok: false,
      reason: `This group has more than ${MAX_SUBGROUP_QUERIES} subgroups, so whole group events were not synced.`,
    }
  }
  if (input.truncated) {
    return {
      ok: false,
      reason:
        `A subgroup returned the maximum of ${MAX_EVENTS_PER_GROUP} events, so its list is incomplete and whole group events were not synced.`,
    }
  }
  const answered = new Set(input.answeredSubgroupIds)
  return {
    ok: true,
    unasked: input.subgroupIds.filter((id) => !answered.has(id)),
    total: input.subgroupIds.length,
  }
}

// The event ids a group wide query returned that no subgroup query
// returned. Pure, so the test can pin the six subgroups and five mappings
// case directly: an event seen only under the unmapped sixth subgroup is
// absent from this result and never becomes a club event.
export function wholeGroupEventIds(groupWideIds: Iterable<string>, seenInAnySubgroup: Set<string>): string[] {
  const out: string[] = []
  const emitted = new Set<string>()
  for (const id of groupWideIds) {
    if (seenInAnySubgroup.has(id) || emitted.has(id)) continue
    emitted.add(id)
    out.push(id)
  }
  return out
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

// One scoped read of a group's members, with the two facts a caller needs
// before it may treat what came back as the whole truth.
//
// `found` is whether the group and its member array were actually there.
// It is deliberately not the same as "the list is empty": a group the
// organiser account cannot see, and a subgroup with nobody in it, are two
// different answers with two different consequences.
//
// `truncated` is whether the cap cut the list short. Before this existed
// the cap was a silent slice, so a group larger than the cap returned a
// short list that every caller read as complete. Absence from a short
// list is not absence, which is the rule the whole linking screen turns
// on, so the cap now says when it bit.
export interface GroupMemberScan {
  members: unknown[]
  found: boolean
  truncated: boolean
}

// The members of one mapped group, scoped the same way the events query is
// scoped (eventsQuery): a whole group mapping (no subgroup) reads every
// member, a subgroup mapping reads only members whose subGroups list
// contains the subgroup id. The group is found by id in the groups/
// response, the same response spond-sync reads for visibleGroupIds, which
// already carries each group's members; spond-sync discards them, this
// reads them.
export function scanGroupMembers(
  groups: unknown,
  groupId: string,
  subgroupId: string | null,
  max: number = MAX_ROSTER_MEMBERS,
): GroupMemberScan {
  if (!Array.isArray(groups)) return { members: [], found: false, truncated: false }
  const group = groups.find((g) => asRecord(g).id === groupId)
  const members = asRecord(group).members
  if (!Array.isArray(members)) return { members: [], found: false, truncated: false }
  const scoped = subgroupId === null ? members : members.filter((m) => memberSubgroupIds(m).includes(subgroupId))
  return { members: scoped.slice(0, max), found: true, truncated: scoped.length > max }
}

// The members alone, for the roster import, whose plan is a de-dupe by
// name and has never read either flag.
export function selectGroupMembers(groups: unknown, groupId: string, subgroupId: string | null): unknown[] {
  return scanGroupMembers(groups, groupId, subgroupId).members
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
  // Members whose name already holds a current season registration that is not
  // on the team being imported: another team, Unassigned, or withdrawn. Not
  // inserted, not moved, counted here so the run can say so.
  registeredElsewhere: number
}

// The roster name normalisation: case folded, ends trimmed, internal runs of
// whitespace collapsed to one space.
//
// It mirrors the spond_import_roster RPC's
// lower(regexp_replace(btrim(name), '\s+', ' ', 'g')) but is not byte identical
// to it, and the difference is deliberately in the safe direction. JavaScript
// trim strips every Unicode whitespace character from the ends, while SQL btrim
// with no second argument strips spaces only, so this key folds slightly MORE
// than the RPC's. Folding more can only make two names match where the RPC
// would see them as distinct, and a match here means REFUSE, so the divergence
// can only refuse an import, never admit a duplicate. A key that folded less
// than the RPC's would be the dangerous direction.
export function normaliseRosterName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase()
}

// THE CROSS TEAM GUARD, and why it refuses rather than moves.
//
// A child who moves between Spond subgroups is invisible to the team scoped
// dedupe: importing their NEW team finds no registration for that name on that
// team, so the run creates a SECOND identity and a SECOND current season
// registration, leaving the club holding one child twice. That is the defect
// this guard closes.
//
// It closes it by refusing, never by asserting identity. Nothing here proves
// that the Spond member and the existing child are the same person: a Spond
// member id is never persisted, and a name is not an identity. So a member
// whose name already holds ANY current season registration that is not on the
// team being imported is counted and EXCLUDED, and no row is inserted, updated
// or moved for them. Another team, Unassigned and withdrawn all count: the
// rule is that the child already exists this season, not which team they are
// on, because the RPC only inserts and would otherwise mint a second identity.
//
// The asymmetry is the whole argument. Refusing on a false name match declines
// one import and reports it, which a manager can see and undo. Acting on a
// false name match would move a different child's registration to another team
// silently, and it would look correct. Moving on a proved identity is the
// reconciliation that the durable Spond member link makes possible; it is
// deliberately not attempted here.
export function planRosterImport(
  members: unknown[],
  existingNames: Iterable<string>,
  registeredElsewhereNames: Iterable<string> = [],
): RosterImportPlan {
  const seen = new Set<string>()
  for (const name of existingNames) seen.add(normaliseRosterName(name))
  const elsewhere = new Set<string>()
  for (const name of registeredElsewhereNames) {
    const key = normaliseRosterName(name)
    // A name on this team wins: that child is already correctly registered
    // here, so they are "already present", never a cross team case.
    if (!seen.has(key)) elsewhere.add(key)
  }
  const inserts: RosterPlayer[] = []
  let added = 0
  let alreadyPresent = 0
  let skipped = 0
  let registeredElsewhere = 0
  for (const member of members) {
    const reduced = reduceMember(member)
    if (!reduced) {
      skipped++
      continue
    }
    const key = normaliseRosterName(reduced.display_name)
    if (seen.has(key)) {
      alreadyPresent++
      continue
    }
    if (elsewhere.has(key)) {
      registeredElsewhere++
      continue
    }
    seen.add(key)
    inserts.push(reduced)
    added++
  }
  return { inserts, added, alreadyPresent, skipped, registeredElsewhere }
}

// =====================================================================
// Release B: linked member RSVP context (0045_spond_links.sql)
//
// THE BOUNDARY THIS SECTION IMPLEMENTS. A stored response row exists
// only for a member a human has bound to a roster child. Nothing here
// reads a name, a guardian, a contact field, a comment or the
// recipients object; the four response arrays are read for their member
// ids and nothing else in the payload is touched. The database refuses
// a row for an unlinked member outright
// (spond_event_responses_link_fk), so this code is the second line of
// defence, not the only one.
//
// RSVP is context. Nothing here reads, writes or derives attendance:
// register_entries is the coach's own record and this module does not
// know it exists.
// =====================================================================

// The opaque Spond member id, exactly the character class the
// player_spond_links column check enforces. Uppercase hex admits no
// space, no '@', no '+', no '.' and no lowercase letter, so a name, an
// email address or a phone number fails here as it would fail there. A
// candidate that would be refused by the column is dropped before it is
// ever offered to a caller.
export const SPOND_MEMBER_ID_PATTERN = /^[0-9A-F]{16,64}$/

// The complete set of columns a response row may carry. The same
// discipline SPOND_EVENT_COLUMNS applies to events: no name, no
// guardian, no comment, no payload fragment, and no free shaped column
// to hide one in. Pinned by spond_test.ts.
export const SPOND_RESPONSE_COLUMNS = [
  'club_id',
  'spond_event_id',
  'spond_member_id',
  'status',
  'synced_at',
] as const

export type SpondResponseStatus = 'accepted' | 'declined' | 'unanswered' | 'waiting'

export interface SpondResponseRow {
  club_id: string
  spond_event_id: string
  spond_member_id: string
  status: SpondResponseStatus
  synced_at: string
}

export interface MemberStatus {
  spond_member_id: string
  status: SpondResponseStatus
}

// A defensive cap on ids read from any one response array, so a
// malformed or unexpectedly huge event is bounded. A grassroots squad is
// a few dozen.
export const MAX_RESPONSE_IDS_PER_ARRAY = 1000

// The four arrays, read in a fixed order so the output is deterministic,
// mapped to the four values the status column accepts. unconfirmedIds is
// deliberately absent: it is not one of the four and is never read, as it
// is never read by deriveCounts.
const RESPONSE_ARRAYS: ReadonlyArray<readonly [string, SpondResponseStatus]> = [
  ['acceptedIds', 'accepted'],
  ['declinedIds', 'declined'],
  ['unansweredIds', 'unanswered'],
  ['waitinglistIds', 'waiting'],
]

// One event's response arrays reduced to the statuses of the LINKED
// members only. Same payload plus same link set gives the same rows in
// the same order, by construction, so a re-sync of an unchanged event
// writes an identical set.
//
// `linked` is the proven link set. The caller must never pass an empty
// set to mean "we could not read the links": empty means the club has no
// links, which is a different fact and has a different consequence. See
// the three state rule in spond-sync/index.ts.
//
// An id appearing in more than one array (which Spond should not do)
// keeps its first claim, so the result never contains a member twice and
// the upsert never targets one row twice.
export function deriveMemberStatuses(responses: unknown, linked: ReadonlySet<string>): MemberStatus[] {
  const r = asRecord(responses)
  const seen = new Set<string>()
  const out: MemberStatus[] = []
  for (const [field, status] of RESPONSE_ARRAYS) {
    const value = r[field]
    if (!Array.isArray(value)) continue
    for (const id of value.slice(0, MAX_RESPONSE_IDS_PER_ARRAY)) {
      if (typeof id !== 'string') continue
      const memberId = id.toUpperCase()
      if (!SPOND_MEMBER_ID_PATTERN.test(memberId)) continue
      if (!linked.has(memberId)) continue
      if (seen.has(memberId)) continue
      seen.add(memberId)
      out.push({ spond_member_id: memberId, status })
    }
  }
  return out
}

// The statuses shaped into rows. Every row carries this run's syncedAt,
// which is what lets the reconcile delete only the strictly older tail
// for the event rather than emptying it first. Nothing but the five
// columns is constructed, so no payload fragment can ride along.
export function buildResponseRows(
  clubId: string,
  eventRowId: string,
  statuses: MemberStatus[],
  syncedAt: string,
): SpondResponseRow[] {
  return statuses.map((s) => ({
    club_id: clubId,
    spond_event_id: eventRowId,
    spond_member_id: s.spond_member_id,
    status: s.status,
    synced_at: syncedAt,
  }))
}

// ---- Staff never enter the player pipelines --------------------------------
//
// Production, 15 August: a team's linking screen offered its manager as a
// candidate child, because staff join the Spond group and its subgroups
// exactly the way the children do. Spond's own admin roles are the
// structural signal that separates them: a role uid (member.roles, the
// reference library's Member.role_uids) is assigned only to group staff,
// and a plain participant carries no roles key at all. So absent, empty
// and malformed all read the same, as NO roles, which fails towards
// offering: linking stays human approved either way, and a strange shape
// must never hide a child from the list. Only the uids are read; role
// names are group configuration this pipeline never touches, and no
// guardian, profile or contact field is reached.

// The role uids a member carries. Same defensive shape as
// memberSubgroupIds: unexpected input yields an empty list.
export function memberRoleIds(member: unknown): string[] {
  const value = asRecord(member).roles
  if (!Array.isArray(value)) return []
  return value.filter((id): id is string => typeof id === 'string' && id.length > 0)
}

// The SPOND_IGNORED_MEMBER_IDS config: the backstop for staff the club
// never assigned a Spond role. Opaque member ids only, comma separated.
// An entry the links table would refuse (a name, an email address) is
// discarded on parse, so the secret cannot quietly become a name match
// rule and no name can be expressed in it.
export function parseIgnoredMemberIds(raw: string | undefined | null): Set<string> {
  const out = new Set<string>()
  for (const entry of (raw ?? '').split(',')) {
    const id = entry.trim().toUpperCase()
    if (id && SPOND_MEMBER_ID_PATTERN.test(id)) out.add(id)
  }
  return out
}

// The members who may be offered as children: staff (any Spond role) and
// configured ignores dropped and counted, everybody else kept untouched
// and in order. Classification reads exactly the roles array and the id.
// The excluded ids ride along so a caller collecting across overlapping
// mappings can count one person once; they go no further than that
// arithmetic and are never returned to a client or logged.
export function excludeNonPlayers(
  members: unknown[],
  ignored: ReadonlySet<string>,
): { members: unknown[]; staff: number; ignored: number; staffIds: string[]; ignoredIds: string[] } {
  const kept: unknown[] = []
  const staffIds: string[] = []
  const ignoredIds: string[] = []
  let staff = 0
  let dropped = 0
  for (const member of members) {
    const id = asRecord(member).id
    if (memberRoleIds(member).length > 0) {
      staff++
      if (typeof id === 'string') staffIds.push(id.toUpperCase())
      continue
    }
    if (typeof id === 'string' && ignored.has(id.toUpperCase())) {
      dropped++
      ignoredIds.push(id.toUpperCase())
      continue
    }
    kept.push(member)
  }
  return { members: kept, staff, ignored: dropped, staffIds, ignoredIds }
}

// ---- Collecting a team's candidates, the whole rule in one place -----------
//
// The loop this replaces lived in spond-link-members/index.ts, where no
// test executes: the cap's position relative to the exclusion, the
// dedupe, the truncation flag and every warning string were pinned by
// nothing. A review demonstrated the cost by moving the cap ahead of the
// exclusion and rewording a warning to carry names, both with every test
// green. Pure, so the Deno tests hold all of it.

export interface LinkCandidateCollection {
  members: LinkCandidate[]
  truncated: boolean
  // People, not rows: a staff member in two of the team's mappings is one
  // person and counts once. Members with no usable id cannot be folded
  // and count per appearance, which can only overstate, never hide.
  staff: number
  ignored: number
  dropped: number
  emptyMappings: string[]
}

export function collectLinkCandidates(
  groups: unknown,
  mappings: readonly SpondMapping[],
  ignoredConfig: ReadonlySet<string>,
  max: number = MAX_LINK_CANDIDATES,
): LinkCandidateCollection {
  const members: LinkCandidate[] = []
  const seen = new Set<string>()
  const staffSeen = new Set<string>()
  const ignoredSeen = new Set<string>()
  let staffAnon = 0
  let ignoredAnon = 0
  let dropped = 0
  let truncated = false
  // Only the CANDIDATE cap ends the walk: once `max` candidates are held
  // there is nothing further to collect. A scoped read the per group cap
  // cut short is truncated too, but the remaining mappings still have
  // members worth offering, so it flags and carries on.
  let capped = false
  const emptyMappings: string[] = []
  for (const mapping of mappings) {
    const scan = scanGroupMembers(groups, mapping.spond_group_id, mapping.spond_subgroup_id)
    const scoped = scan.members
    // A scoped read the per group cap cut short is truncated for the same
    // reason the candidate cap is: what came back is not the whole group,
    // so no absence may be read off it. Before this the slice was silent.
    if (scan.truncated) truncated = true
    if (scoped.length === 0) emptyMappings.push(mapping.spond_name)
    // Exclusion runs BEFORE the cap, so staff neither appear nor consume
    // a candidate slot, and before the reduction, so an excluded member
    // is never reduced at all.
    const players = excludeNonPlayers(scoped, ignoredConfig)
    for (const id of players.staffIds) staffSeen.add(id)
    for (const id of players.ignoredIds) ignoredSeen.add(id)
    staffAnon += players.staff - players.staffIds.length
    ignoredAnon += players.ignored - players.ignoredIds.length
    for (const member of players.members) {
      if (members.length >= max) {
        truncated = true
        capped = true
        break
      }
      const candidate = reduceLinkCandidate(member)
      if (!candidate) {
        dropped++
        continue
      }
      // A member in two of the team's mappings appears once.
      if (seen.has(candidate.spond_member_id)) continue
      seen.add(candidate.spond_member_id)
      members.push(candidate)
    }
    if (capped) break
  }
  return {
    members,
    truncated,
    staff: staffSeen.size + staffAnon,
    ignored: ignoredSeen.size + ignoredAnon,
    dropped,
    emptyMappings,
  }
}

// The warnings a collection earns, counts and mapping labels only. A
// member name is not representable here: the collection carries none.
export function linkCollectionWarnings(c: LinkCandidateCollection, max: number = MAX_LINK_CANDIDATES): string[] {
  const warnings: string[] = []
  for (const name of c.emptyMappings) {
    warnings.push(
      `No members found for ${name}. Check the Spond organiser account can see this group and that the subgroup has members.`,
    )
  }
  if (c.staff > 0) {
    warnings.push(
      `Not offering ${c.staff} Spond staff member${c.staff === 1 ? '' : 's'} (group role holder${c.staff === 1 ? '' : 's'}) for linking.`,
    )
  }
  if (c.ignored > 0) {
    warnings.push(`Not offering ${c.ignored} member${c.ignored === 1 ? '' : 's'} an admin has excluded.`)
  }
  if (c.dropped > 0) {
    warnings.push(`Skipped ${c.dropped} Spond member${c.dropped === 1 ? '' : 's'} with no usable name or id.`)
  }
  if (c.truncated) {
    warnings.push(
      `Showing the first ${max} members. Map this team to its Spond subgroup rather than the whole group so the list is scoped to the squad.`,
    )
  }
  return warnings
}

// ---- The setup diagnostics: the parent group this team's mappings miss --
//
// WHAT THIS ANSWERS, AND WHY THE SCREEN COULD NOT ANSWER IT. The candidate
// list above is scoped to the team's mapped subgroup, so a Spond member
// outside that subgroup is not in it. A registered player therefore lands
// in "not matched yet" for three completely different reasons that looked
// identical: their Spond member is in the parent group with NO subgroup at
// all, or is in a DIFFERENT subgroup, or is not in the parent group data
// the organiser account can see. Production, 15 August: an Argonauts
// player was in Spond with no team assigned, and the screen could only say
// they were unmatched.
//
// SAME FETCH, NO SECOND CALL. This reads the groups/ response
// spond-link-members has already fetched for the candidates. It adds no
// Spond request, and the endpoint assertion in the deploy workflow holds
// the function to exactly auth2/login and groups/.
//
// WHAT IT READS, AND WHAT IT RETURNS. Per member exactly what the
// candidate reduction reads plus the subgroup ids the scoping already
// reads: the opaque id (to fold one person appearing under two of the
// team's mapped groups, in memory, never returned), first and last name
// through rosterDisplayName, subGroups, and roles for the staff exclusion.
// No guardian, contact, address or any other profile field is reached. The
// returned shape is SPOND_DIAGNOSTIC_MEMBER_FIELDS and nothing else: a
// transient display name and opaque subgroup ids. The member id is
// deliberately NOT returned, because nothing links from a diagnostic row;
// the closed LinkCandidate shape stays the only thing linking is built on.
// Nothing here is persisted, by this module or by its caller.
//
// STAFF FIRST, always. The exclusion runs over the whole parent group
// before a single row is emitted, so a manager or coach in another
// subgroup can never be reported as somebody's child.

// The complete set of fields a diagnostic row may carry. The same
// discipline SPOND_EVENT_COLUMNS and SPOND_RESPONSE_COLUMNS apply to
// rows: no name beyond the transient display name, no contact, and no
// free shaped field to hide one in. Pinned by spond_link_test.ts.
export const SPOND_DIAGNOSTIC_MEMBER_FIELDS = ['display_name', 'subgroup_ids'] as const

export interface LinkDiagnosticMember {
  display_name: string
  subgroup_ids: string[]
}

// A defensive cap on both halves of the scan: how many members of one
// parent group are read, and how many rows are emitted. A grassroots
// club's parent group is a few dozen; exceeding this means the scan did
// not see everything, which is `complete: false` and never a short list
// presented as the whole truth.
export const MAX_LINK_DIAGNOSTIC_MEMBERS = 500

export interface LinkDiagnosticCollection {
  members: LinkDiagnosticMember[]
  // Whether the parent group member data was read WHOLE. False when a
  // group is absent from the payload, its members are not an array, or
  // either cap bit. On false the client states no diagnosis at all: a
  // positive match off a short list could be one of two same named
  // members it never saw, which would assert an identity, and a negative
  // one would be an absence claim off incomplete data.
  complete: boolean
}

export function collectLinkDiagnostics(
  groups: unknown,
  mappings: readonly SpondMapping[],
  ignoredConfig: ReadonlySet<string>,
  max: number = MAX_LINK_DIAGNOSTIC_MEMBERS,
): LinkDiagnosticCollection {
  const members: LinkDiagnosticMember[] = []
  const seen = new Set<string>()
  let complete = true
  // Per parent group: the subgroups this team's own mappings already
  // reach, and whether the team maps the whole group.
  const groupIds: string[] = []
  const reached = new Map<string, Set<string>>()
  const wholeGroup = new Set<string>()
  for (const mapping of mappings) {
    if (!reached.has(mapping.spond_group_id)) {
      reached.set(mapping.spond_group_id, new Set())
      groupIds.push(mapping.spond_group_id)
    }
    if (mapping.spond_subgroup_id) reached.get(mapping.spond_group_id)!.add(mapping.spond_subgroup_id)
    else wholeGroup.add(mapping.spond_group_id)
  }
  // No mapping means no group was read at all, so nothing is proved and
  // no absence may be claimed.
  if (groupIds.length === 0) return { members: [], complete: false }

  let capped = false
  for (const groupId of groupIds) {
    if (capped) break
    const scan = scanGroupMembers(groups, groupId, null, max)
    if (!scan.found || scan.truncated) {
      complete = false
      continue
    }
    // A team mapped to the WHOLE group already has every member in its
    // candidate list, so nothing in it is outside the mapping. The scan
    // still ran, so this group is proved and complete stays true.
    if (wholeGroup.has(groupId)) continue
    const reachedHere = reached.get(groupId) ?? new Set<string>()
    // Staff and configured ignores leave before any row is emitted.
    const players = excludeNonPlayers(scan.members, ignoredConfig)
    for (const member of players.members) {
      const subgroupIds = memberSubgroupIds(member)
      // Already offered as a candidate: this is the list of who the
      // mapping MISSES, so a member the mapping reaches is not in it.
      if (subgroupIds.some((id) => reachedHere.has(id))) continue
      if (members.length >= max) {
        complete = false
        capped = true
        break
      }
      const reduced = reduceDiagnosticMember(member)
      // No usable name: this member carries no name that could match a
      // registered player either way, so dropping it removes no evidence
      // and the scan stays complete.
      if (!reduced) continue
      const rawId = asRecord(member).id
      const memberId = typeof rawId === 'string' ? rawId.toUpperCase() : ''
      // Fold one person appearing under two of the team's mapped parent
      // groups. The id is used here and returned nowhere. A member whose
      // id the links table would refuse cannot be folded and is kept per
      // appearance, which can only ADD a same name row, and a second same
      // name row reads as ambiguous rather than as a false identity.
      if (SPOND_MEMBER_ID_PATTERN.test(memberId)) {
        if (seen.has(memberId)) continue
        seen.add(memberId)
      }
      members.push(reduced)
    }
  }
  // An unproved scan returns NOTHING, not a short list beside a flag. The
  // client already states no diagnosis on `complete: false`, but making
  // the payload itself empty means a future caller that forgets the flag
  // still cannot read a partial list as the whole group, and no name
  // leaves the function that nobody is going to be allowed to use.
  return complete ? { members, complete } : { members: [], complete }
}

// One member reduced to a diagnostic row: the transient display name and
// the opaque subgroup ids, and nothing else. Reads exactly what
// reduceLinkCandidate reads plus the subGroups list the scoping already
// reads. The member's guardians, email, phoneNumber, address, roles and
// every other field are never reached, so they cannot be returned even by
// accident. Null when there is no usable name to match on.
export function reduceDiagnosticMember(member: unknown): LinkDiagnosticMember | null {
  const display_name = rosterDisplayName(member)
  if (!display_name) return null
  return { display_name, subgroup_ids: memberSubgroupIds(member) }
}

// The roster import's member collection, the same discipline: exclusion
// before the plan, one person counted once across mappings.
export interface RosterMemberCollection {
  members: unknown[]
  staff: number
  ignored: number
  emptyMappings: string[]
}

export function collectRosterMembers(
  groups: unknown,
  mappings: readonly SpondMapping[],
  ignoredConfig: ReadonlySet<string>,
): RosterMemberCollection {
  const members: unknown[] = []
  const staffSeen = new Set<string>()
  const ignoredSeen = new Set<string>()
  let staffAnon = 0
  let ignoredAnon = 0
  const emptyMappings: string[] = []
  for (const mapping of mappings) {
    const scoped = selectGroupMembers(groups, mapping.spond_group_id, mapping.spond_subgroup_id)
    if (scoped.length === 0) emptyMappings.push(mapping.spond_name)
    const players = excludeNonPlayers(scoped, ignoredConfig)
    for (const id of players.staffIds) staffSeen.add(id)
    for (const id of players.ignoredIds) ignoredSeen.add(id)
    staffAnon += players.staff - players.staffIds.length
    ignoredAnon += players.ignored - players.ignoredIds.length
    for (const member of players.members) members.push(member)
  }
  return { members, staff: staffSeen.size + staffAnon, ignored: ignoredSeen.size + ignoredAnon, emptyMappings }
}

export function rosterCollectionWarnings(c: RosterMemberCollection): string[] {
  const warnings: string[] = []
  for (const name of c.emptyMappings) {
    warnings.push(
      `No members found for ${name}. Check the Spond organiser account can see this group and that the subgroup has members.`,
    )
  }
  if (c.staff > 0) {
    warnings.push(
      `Skipped ${c.staff} Spond staff member${c.staff === 1 ? '' : 's'} (group role holder${c.staff === 1 ? '' : 's'}); staff are never imported as players.`,
    )
  }
  if (c.ignored > 0) {
    warnings.push(`Skipped ${c.ignored} member${c.ignored === 1 ? '' : 's'} an admin has excluded.`)
  }
  return warnings
}

// ---- The linking candidate shape -------------------------------------------

// The cap on candidates returned for one team across all of its
// mappings. A whole group mapping at a busy club can exceed a couple of
// hundred, and the remedy for hitting this is to map the team to its
// Spond subgroup so the list is scoped, never to reload: the cap applies
// to the input order before link state is known, so a reload returns the
// same names again.
export const MAX_LINK_CANDIDATES = 400

// The complete shape spond-link-members returns for one member. Two
// fields, both required by the manager to decide who this is. The
// display name is TRANSIENT: it is returned to the linking screen and
// stored nowhere, and the insert the browser then sends carries the
// member id, the player id and matched_by only.
export interface LinkCandidate {
  spond_member_id: string
  display_name: string
}

// One member reduced to a candidate, or null when it has no usable name
// or no id the links table would accept. Reads exactly two things:
// m.id, and the first and last name through rosterDisplayName. The
// member's guardians, email, phoneNumber, subGroups and every other
// field are never reached, so they cannot be returned even by accident.
//
// Rejecting a malformed id here rather than at insert time means the UI
// never offers a candidate the database would refuse.
export function reduceLinkCandidate(member: unknown): LinkCandidate | null {
  const id = asRecord(member).id
  if (typeof id !== 'string') return null
  const memberId = id.toUpperCase()
  if (!SPOND_MEMBER_ID_PATTERN.test(memberId)) return null
  const display_name = rosterDisplayName(member)
  if (!display_name) return null
  return { spond_member_id: memberId, display_name }
}
