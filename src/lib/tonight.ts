// =====================================================================
// Tonight: who is expected, and how are we splitting them up.
//
// THE PRODUCT JOB THIS SERVES. Not "who arrived?". The coach standing on
// the grass is asking "who is coming, which of them am I including, and
// what bib does each need so I can split them into groups?". Spond
// suggests the pool; the coach decides the groups.
//
// THREE INDEPENDENT FACTS PER CHILD, and conflating any two of them is
// the mistake this module exists to prevent:
//
//   RESPONSE   what the child's parent said in Spond. Read only. Four
//              states, and a fifth thing that is not a state: a child
//              with no Spond link has NO response. That is not "no
//              reply" — they have no reply to give — so they appear
//              under Everyone and are counted nowhere else.
//   INCLUDED   whether the coach is putting them in tonight's groups.
//              A Going child need not be included. A Not going child may
//              be, because they turned up anyway. Stored in
//              register_entries.included_in_groups (0047).
//   ATTENDANCE whether the child actually turned up. Stored in
//              register_entries.present, which is what that column has
//              meant since 0044 and means again after 0047.
//
// THE SECOND AND THIRD WERE ONE COLUMN, and that is the defect being
// corrected. Tonight reused `present` for inclusion because one tick set
// both, so a coach who split fourteen of the eighteen who came had just
// recorded that four of them were absent. Every combination below is a
// real Tuesday and every one of them is now storable:
//
//   present, included         the ordinary case
//   present, not included     came, but not in this split
//   absent, included          groups arranged before anybody arrived
//   absent, not included      not here, not playing
//
// Nothing in this module derives one from another, and nothing derives
// either from the Spond reply.
//
// EVERYTHING IS A DRAFT until the coach saves. Selecting, clearing,
// toggling and changing a bib all edit a local draft, so the coach can
// arrange the whole night, look at it, and then commit it once. Nothing
// here talks to a database; ../lib/queries owns that.
// =====================================================================
import { BIB_COLOURS, effectiveBib, bibLabel } from './bibs'
import type { RegisterEntry, RegisterView } from './register'
import type { Team } from './data'
import type { RsvpStatus } from './spondRsvp'

// The four Spond reply states plus the widening. Order is the order a
// coach reads them: the ones they act on first, then everyone.
export const RESPONSE_FILTERS = ['going', 'unanswered', 'declined', 'waiting', 'all'] as const
export type ResponseFilter = (typeof RESPONSE_FILTERS)[number]

// "No reply" rather than "Unanswered", and "Not going" rather than
// "Declined": the words a parent used, not the words the API uses.
export const RESPONSE_FILTER_LABELS: Record<ResponseFilter, string> = {
  going: 'Going',
  unanswered: 'No reply',
  declined: 'Not going',
  waiting: 'Waiting',
  all: 'Everyone',
}

// Going first. It is the list a coach acts on, and on a normal night
// Select all here plus a couple of exceptions is the whole job.
export const DEFAULT_RESPONSE_FILTER: ResponseFilter = 'going'

// One child on tonight's screen: their identity, their team, and what
// their parent said. `response` is null for a child with no Spond link,
// which is a different thing from every RsvpStatus.
export interface TonightRow {
  playerId: string
  displayName: string
  shirtNumber: number | null
  teamId: string | null
  teamName: string | null
  // The team's default bib colour, or null when the team has none set.
  teamBib: string | null
  response: RsvpStatus | null
  // True when this child is here only because a coach added them on the
  // day: a guest, not part of the covered squad.
  manual: boolean
}

// The filter a coach taps, to the reply state Spond stores. Only one word
// differs, and it differs on purpose: "Going" is what the parent pressed,
// "accepted" is what the API calls it, and the screen speaks the parent's
// language. Mapping here keeps that translation in one place.
const FILTER_STATUS: Record<Exclude<ResponseFilter, 'all'>, RsvpStatus> = {
  going: 'accepted',
  unanswered: 'unanswered',
  declined: 'declined',
  waiting: 'waiting',
}

// Tonight's rows, composed from the register view the screen already
// builds.
//
// Deliberately built ON TOP of buildRegister rather than beside it: which
// children a session covers, how a quick added guest is grouped, and what
// order names appear in are decided there and tested there, and a second
// implementation would be a second set of answers. This flattens that
// view and attaches each child's own Spond reply.
export function buildTonightRows(
  view: RegisterView,
  teams: Team[],
  // Only the status is read. Freshness belongs to the note beside the
  // event, not to a child's row.
  rsvpByPlayer: Record<string, { status: RsvpStatus; syncedAt?: string }>,
): TonightRow[] {
  const bibByTeam = new Map(teams.map((t) => [t.id, t.bibColour ?? null]))
  const out: TonightRow[] = []
  for (const g of view.groups) {
    for (const r of g.rows) {
      out.push({
        playerId: r.player.id,
        displayName: r.player.displayName,
        shirtNumber: r.player.shirtNumber,
        teamId: r.player.teamId,
        teamName: r.player.teamId === null ? null : g.teamName,
        teamBib: r.player.teamId === null ? null : (bibByTeam.get(r.player.teamId) ?? null),
        // Absent means no Spond link, which is not a reply state.
        response: rsvpByPlayer[r.player.id]?.status ?? null,
        manual: r.manual,
      })
    }
  }
  return out
}

// THE FOUR REPLY STATES ARE THE COVERED SQUAD. Everyone is the widening
// that holds the rest.
//
// Two rows are excluded from a reply state, for two different reasons:
//
//   NO LINK      response is null. They are not "No reply": they have no
//                reply to give.
//   A GUEST      a child the coach quick added, who is not part of the
//                squad this session covers. Their reply is a fact about
//                their own team's event, not about this squad, which is
//                exactly what hasResponseContext below has always said. It
//                said it in one direction only: a visitor's reply could
//                not OPEN the filters, but it could still inflate them and
//                appear inside them. So the Going chip counted a
//                population the coverage figures beside it did not, and
//                going + noReply + notGoing + waiting stopped equalling
//                withResponse the moment one visitor had replied.
//
// Excluding them here rather than in tonightCounts is what keeps a chip's
// number equal to the rows that chip shows: the count and the list go
// through this one predicate, so they cannot disagree.
export function matchesResponse(row: TonightRow, filter: ResponseFilter): boolean {
  if (filter === 'all') return true
  return !row.manual && row.response !== null && row.response === FILTER_STATUS[filter]
}

// Whether this session has any Spond reply to filter by at all.
//
// Absence has exactly one appearance: no linked event, no linked child, a
// read still in flight and a read that failed all arrive here as rows
// carrying no response, and all four mean the same thing.
export function hasResponseContext(rows: TonightRow[]): boolean {
  // A quick added guest does not count. Their reply is a fact about their
  // own team's event, not about the squad this session covers, and one
  // linked visitor beside an entirely unlinked squad was enough to keep
  // the Going default and hide every child behind them. registerScope.ts
  // guards the same collapse for the same reason.
  return rows.some((r) => !r.manual && r.response !== null)
}

// The filter the screen can ACTUALLY use.
//
// Going is the default because it is the list a coach acts on. A club with
// no Spond has no accepted child, so that default would hide every one of
// them behind "Nobody under Going" over a full squad. Missing context can
// never empty this screen: with nothing to filter by, Everyone is the
// working view and the coach organises the night by hand.
export function usableFilter(rows: TonightRow[], filter: ResponseFilter): ResponseFilter {
  return hasResponseContext(rows) ? filter : 'all'
}

export function visibleRows(rows: TonightRow[], filter: ResponseFilter): TonightRow[] {
  return rows.filter((r) => matchesResponse(r, filter))
}

export type ResponseCounts = Record<ResponseFilter, number>

// The numbers on the chips.
//
// These count HUB PLAYERS ON THIS SESSION, never the raw Spond event
// aggregate. The chips are actionable: tapping one filters this list, so
// its number has to be the number of rows that appear. A whole parent
// group's fifty replies on the event row is a different figure and
// belongs beside the event, not on a filter.
//
// The four reply states count the COVERED SQUAD and `all` counts every row
// on screen, guests included. Both follow from matchesResponse above, so
// there is nothing to keep in step here.
export function countByResponse(rows: TonightRow[]): ResponseCounts {
  const counts: ResponseCounts = { going: 0, unanswered: 0, declined: 0, waiting: 0, all: rows.length }
  for (const r of rows) {
    for (const f of RESPONSE_FILTERS) {
      if (f !== 'all' && matchesResponse(r, f)) counts[f]++
    }
  }
  return counts
}

// ---- The five populations, counted once -----------------------------
//
// WHY THIS EXISTS. Five different things on this screen are a number of
// people, and a coach reported two of them as a contradiction: "19 vs
// 11". Neither was wrong. 19 was the Spond EVENT AGGREGATE, every member
// Spond invited who pressed Going, over an audience of 46 to 50. 11 was
// this screen's Going chip, covered Hub players bound to a Spond member
// whose member accepted. On the night it was reported the club had 40
// covered children, 27 of them linked, so the two numbers could not have
// matched and were never meant to.
//
// The five, and none of them is any of the others:
//
//   COVERED       Hub players this session lists. What Everyone shows.
//   LINKED        of those, the ones bound to a Spond member.
//   WITH REPLY    of those, the ones carrying a stored reply for THIS
//                 event. Smaller than linked whenever a link was made
//                 after the last sync, or the member was not invited.
//   RESPONSES     those replies split four ways.
//   SELECTED      who the coach put in tonight's groups. Independent of
//                 every number above, in both directions.
//
// The event aggregate is deliberately NOT here and cannot be: this takes
// rows and links, and there is no parameter an aggregate could arrive
// through. It is named and captioned in ./spond instead.
//
// One builder, so the screen never counts an array itself. A chip whose
// number disagreed with the list under it is the defect this prevents.

// The four reply states in the product's own words, plus the widening.
export interface TonightResponseCounts {
  going: number
  noReply: number
  notGoing: number
  waiting: number
  // Every row on screen, guests included: what the Everyone chip shows.
  everyone: number
}

export interface TonightCounts {
  // The squad this session covers. A quick added guest is on the list but
  // is NOT part of it: link coverage is a claim about the covered squad,
  // and a visitor from another team must not make it look better or worse.
  covered: number
  guests: number
  // Null means UNKNOWN, never none. A read still in flight, a read that
  // failed, and a database where linking is not available yet all arrive
  // here, and "0 of 40 linked" would be a confident falsehood.
  linked: number | null
  unlinked: number | null
  // Covered players carrying a stored reply for this event, and the linked
  // ones who are not. Without the second figure those players render
  // exactly like unlinked children: no pill, no chip, and the screen
  // claiming more linked than it can show replies for.
  //
  // going + noReply + notGoing + waiting === withResponse, always. The two
  // sides describe one population, the covered squad, which is why a guest
  // is absent from both.
  withResponse: number
  awaiting: number | null
  responses: TonightResponseCounts
  selected: number
}

// Every count on the screen, from the rows it is already showing, the
// draft it is already holding, and the club's link set.
//
// `linkedPlayerIds` is club wide by construction (one binding per child,
// read without a session filter), and is intersected with the rows here.
// Counting it whole would answer a question the coach is not asking and
// would exceed the covered total on any single team session.
export function tonightCounts(
  rows: TonightRow[],
  draft: TonightDraft,
  linkedPlayerIds: ReadonlySet<string> | null,
): TonightCounts {
  // By player, so a row appearing twice cannot count twice.
  const byPlayer = new Map<string, TonightRow>()
  for (const r of rows) if (!byPlayer.has(r.playerId)) byPlayer.set(r.playerId, r)
  const unique = [...byPlayer.values()]

  // The reply split comes from the SAME function the chips filter with, so
  // a chip's number and the list under it cannot disagree by construction
  // rather than by a test remembering to check. That predicate also decides
  // the population: the four states are the covered squad, `all` is every
  // row, and that is what makes the identity below hold.
  const chips = countByResponse(unique)
  const responses: TonightResponseCounts = {
    going: chips.going,
    noReply: chips.unanswered,
    notGoing: chips.declined,
    waiting: chips.waiting,
    everyone: chips.all,
  }

  let covered = 0
  let guests = 0
  let linked = 0
  let withResponse = 0
  let selected = 0

  for (const r of unique) {
    if (draft.included[r.playerId] === true) selected++
    if (r.manual) {
      guests++
      continue
    }
    covered++
    if (r.response !== null) withResponse++
    // Carrying a reply is itself proof of a link: the response row's
    // foreign key makes an unlinked member's reply unrepresentable. So a
    // row with a reply counts as linked even when the two reads came from
    // different moments, which also keeps `awaiting` from going negative.
    if (linkedPlayerIds?.has(r.playerId) === true || r.response !== null) linked++
  }

  return {
    covered,
    guests,
    linked: linkedPlayerIds === null ? null : linked,
    unlinked: linkedPlayerIds === null ? null : covered - linked,
    withResponse,
    awaiting: linkedPlayerIds === null ? null : linked - withResponse,
    responses,
    selected,
  }
}

// The one line that says which population the chips above it describe.
//
// Printed whenever the link set is known and there is a squad to describe,
// INCLUDING a fully linked one: the screen used to print it only when
// linked was short of covered, so the clubs whose numbers matched lost the
// only sentence naming the population, and the chips went back to being
// bare figures a coach had to guess at.
//
// Empty means say nothing, which is what an unknown link set and an empty
// squad both deserve.
//
// `responsesKnown` is the SECOND thing that can be unknown, and it is
// passed rather than inferred because it cannot be inferred: a reply query
// still in flight, and one that failed, hand this function rows carrying
// no response, which is arithmetically identical to an event nobody
// replied to. Reading that as "0 with a reply" is the confident falsehood
// this screen refuses everywhere else, so the reply clause appears only
// once the caller says the answer is actually in.
export function tonightLinkNote(counts: TonightCounts, responsesKnown: boolean): string {
  if (counts.linked === null || counts.covered === 0) return ''
  const note = `${counts.linked} of ${counts.covered} players linked to Spond`
  // Only when the two differ. A linked child with no stored reply for this
  // event is invisible in every chip, so the screen owes the coach the
  // number rather than letting them read the gap as a mistake.
  if (responsesKnown && counts.awaiting !== null && counts.awaiting > 0) {
    return `${note} · ${counts.withResponse} with a reply for this event`
  }
  return note
}

// The number on one chip, read out of the canonical model.
//
// The chips are labelled in the parent's words and the model is named in
// them too, so this is the one place the filter key and the count key are
// tied together. A screen reaching past this to count an array itself is
// how a chip and its list drift apart.
const CHIP_COUNT: Record<ResponseFilter, keyof TonightResponseCounts> = {
  going: 'going',
  unanswered: 'noReply',
  declined: 'notGoing',
  waiting: 'waiting',
  all: 'everyone',
}

export function chipCount(counts: TonightCounts, filter: ResponseFilter): number {
  return counts.responses[CHIP_COUNT[filter]]
}

// ---- The draft ------------------------------------------------------

// The coach's working arrangement, before it is saved. Sparse on
// purpose: a player with no entry here has never been touched, which is
// what lets the delta write only what changed.
export interface TonightDraft {
  // In tonight's working groups. register_entries.included_in_groups.
  included: Record<string, boolean>
  // Physically here. register_entries.present. A SEPARATE map, so no code
  // path can move one by touching the other: there is no shared entry to
  // overwrite by accident.
  attendance: Record<string, boolean>
  bibs: Record<string, string | null>
  // Children the coach quick added tonight who are not part of the covered
  // squad. Tracked here because a guest exists only in the draft until the
  // save, and a guest must never read as a squad member.
  added: Record<string, boolean>
  // WHICH FIELDS THE COACH ACTUALLY TOUCHED, keyed `${playerId}:${field}`.
  //
  // This exists because "touched" cannot be inferred from a diff. The three
  // maps above are seeded from the stored entries when the draft opens, and
  // the draft is then FROZEN until the coach saves or leaves, while the
  // stored entries behind it keep refetching (TanStack Query's default
  // staleTime is 0 and it refetches on window focus, which is what a phone
  // locking and unlocking on a touchline does). So a coach who tapped only
  // one row would, on saving, diff their frozen seed against a baseline
  // another coach had moved, decide the fields they never touched had
  // "changed", and write their stale seed over the other coach's work.
  //
  // That is the exact failure the per field payload exists to prevent, and
  // inferring the flags from the diff reintroduced it one level down. An
  // explicit record cannot drift: a field is in here because a gesture put
  // it here.
  touched: Record<string, true>
}

// The three fields a save can carry, and the key each is recorded under.
type TouchedField = 'included' | 'attendance' | 'bib'

const touchKey = (playerId: string, field: TouchedField) => `${playerId}:${field}`

function withTouch(draft: TonightDraft, playerId: string, field: TouchedField): Record<string, true> {
  return { ...draft.touched, [touchKey(playerId, field)]: true }
}

function wasTouched(draft: TonightDraft, playerId: string, field: TouchedField): boolean {
  return draft.touched[touchKey(playerId, field)] === true
}

export function draftFromEntries(entries: RegisterEntry[]): TonightDraft {
  const included: Record<string, boolean> = {}
  const attendance: Record<string, boolean> = {}
  const bibs: Record<string, string | null> = {}
  const added: Record<string, boolean> = {}
  for (const e of entries) {
    included[e.playerId] = e.includedInGroups
    attendance[e.playerId] = e.present
    bibs[e.playerId] = e.bibColourOverride
    if (e.source === 'manual') added[e.playerId] = true
  }
  return { included, attendance, bibs, added, touched: {} }
}

// Someone who is not on the list. Put in tonight's groups straight away,
// because that is why the coach reached for the button, and marked as a
// guest so a visitor never becomes a squad member.
//
// It does NOT mark them present. Adding a child to the groups and saying
// they were here are the two facts this module keeps apart, and quick add
// is the coach pressing one of them. Attendance stays one explicit tap
// away, where every other attendance mark is.
export function quickAdd(draft: TonightDraft, playerId: string): TonightDraft {
  return {
    ...draft,
    included: { ...draft.included, [playerId]: true },
    added: { ...draft.added, [playerId]: true },
    touched: withTouch(draft, playerId, 'included'),
  }
}

// The draft expressed as register entries, for composing the list.
//
// WHY THIS EXISTS. buildRegister lists a guest only when they have a
// STORED entry, and a quick add is now a draft edit that stores nothing
// until Save. Without merging the draft in first, the child a coach just
// added would vanish the moment the modal closed and reappear only after
// a save whose point they could no longer see.
export function draftEntries(
  draft: TonightDraft,
  entries: RegisterEntry[],
  sessionId: string,
): RegisterEntry[] {
  const byPlayer = new Map(entries.map((e) => [e.playerId, e]))
  for (const c of draftDelta(draft, entries, sessionId)) {
    byPlayer.set(c.playerId, {
      sessionId,
      playerId: c.playerId,
      present: c.present,
      includedInGroups: c.includedInGroups,
      bibColourOverride: c.bibColourOverride,
      source: c.source,
    })
  }
  return [...byPlayer.values()]
}

export function toggleIncluded(draft: TonightDraft, playerId: string): TonightDraft {
  return {
    ...draft,
    included: { ...draft.included, [playerId]: !draft.included[playerId] },
    touched: withTouch(draft, playerId, 'included'),
  }
}

// Whether this child was actually here. A separate act on a separate map,
// so putting somebody in a group cannot record that they turned up and
// correcting an attendance mis-tap cannot dissolve the group the coach
// built.
export function toggleAttendance(draft: TonightDraft, playerId: string): TonightDraft {
  return {
    ...draft,
    attendance: { ...draft.attendance, [playerId]: !draft.attendance[playerId] },
    touched: withTouch(draft, playerId, 'attendance'),
  }
}

// Select all, scoped to what the coach can actually see. Reaching past
// the current filter would put children in tonight's groups that nobody
// looked at, so the caller passes the visible rows and this trusts them.
export function selectAll(draft: TonightDraft, rows: TonightRow[]): TonightDraft {
  const included = { ...draft.included }
  const touched = { ...draft.touched }
  for (const r of rows) {
    included[r.playerId] = true
    touched[touchKey(r.playerId, 'included')] = true
  }
  return { ...draft, included, touched }
}

export function clearSelection(draft: TonightDraft, rows: TonightRow[]): TonightDraft {
  const included = { ...draft.included }
  const touched = { ...draft.touched }
  for (const r of rows) {
    included[r.playerId] = false
    touched[touchKey(r.playerId, 'included')] = true
  }
  return { ...draft, included, touched }
}

// A bib override, or null to fall back to the team's colour. The string
// 'none' is a real choice meaning this child wears no bib tonight even
// though their team has a default.
export function setDraftBib(draft: TonightDraft, playerId: string, value: string | null): TonightDraft {
  return {
    ...draft,
    bibs: { ...draft.bibs, [playerId]: value },
    touched: withTouch(draft, playerId, 'bib'),
  }
}

function draftIncluded(draft: TonightDraft, playerId: string): boolean {
  return draft.included[playerId] === true
}

function draftPresent(draft: TonightDraft, playerId: string): boolean {
  return draft.attendance[playerId] === true
}

// WHAT THE ROW WILL HOLD AFTER THIS SAVE: the coach's value where they
// touched the field, and the STORED value where they did not.
//
// The draft is frozen at the coach's first tap while the stored entries
// keep refetching, so the draft's own value for an untouched field is a
// stale seed, not a statement. Reading it as one is what let a save
// overwrite another coach's edit, and it is worse than that in the delete
// path: draftRemovals asks "does this row record anything at all", and
// answering from the frozen draft meant a guest whom another coach had
// just marked present was DELETED, destroying the record that a child was
// at the session. Nothing can surface that afterwards, because the
// readback and the draft then agree the row is gone.
function effective(
  draft: TonightDraft,
  stored: RegisterEntry | undefined,
  playerId: string,
): { includedInGroups: boolean; present: boolean; bibColourOverride: string | null } {
  const touchedIncluded = wasTouched(draft, playerId, 'included')
  const touchedAttendance = wasTouched(draft, playerId, 'attendance')
  const touchedBib = wasTouched(draft, playerId, 'bib')
  return {
    includedInGroups: touchedIncluded || !stored ? draftIncluded(draft, playerId) : stored.includedInGroups,
    present: touchedAttendance || !stored ? draftPresent(draft, playerId) : stored.present,
    bibColourOverride: touchedBib || !stored ? draftBib(draft, playerId) : stored.bibColourOverride,
  }
}

function draftBib(draft: TonightDraft, playerId: string): string | null {
  return draft.bibs[playerId] ?? null
}

// ---- Dirty, and the delta a save writes -----------------------------

// Every player either side of the comparison, so a row that exists in one
// and not the other still gets checked.
function touchedIds(draft: TonightDraft, entries: RegisterEntry[]): string[] {
  const ids = new Set<string>()
  for (const id of Object.keys(draft.included)) ids.add(id)
  for (const id of Object.keys(draft.attendance)) ids.add(id)
  for (const id of Object.keys(draft.bibs)) ids.add(id)
  for (const e of entries) ids.add(e.playerId)
  return [...ids]
}

// One changed row, ready for the query layer to upsert.
export interface TonightChange {
  sessionId: string
  playerId: string
  // Attendance.
  present: boolean
  // In tonight's working groups.
  includedInGroups: boolean
  bibColourOverride: string | null
  source: 'roster' | 'manual'
  // WHICH FIELDS THIS CHANGE ACTUALLY MOVED, and whether the row exists at
  // all. A save carries only what it changed, so two coaches working the
  // same session at once cannot revert each other: a whole row write would
  // carry a stale value for the field the other one just set.
  //
  // Now three flags rather than two, and the third is what stops the
  // regression this release fixes from reappearing as a race: a coach
  // organising the groups sends no attendance value at all, so the coach
  // marking arrivals beside them cannot be overwritten, and the reverse.
  presentChanged: boolean
  includedChanged: boolean
  bibChanged: boolean
  isNew: boolean
}

// What a save would write: only the rows whose stored value differs from
// the draft. An untouched row is not rewritten, so saving with nothing
// changed performs no writes at all.
//
// `source` is preserved from the stored row, so a quick added guest stays
// a guest and never quietly becomes a squad member.
export function draftDelta(
  draft: TonightDraft,
  entries: RegisterEntry[],
  sessionId: string,
): TonightChange[] {
  const byPlayer = new Map(entries.map((e) => [e.playerId, e]))
  const removing = new Set(draftRemovals(draft, entries))
  const out: TonightChange[] = []
  for (const playerId of touchedIds(draft, entries)) {
    if (removing.has(playerId)) continue
    const stored = byPlayer.get(playerId)
    // Effective, not raw draft: an untouched field carries the stored value
    // forward, so the row this change describes is the row that will exist
    // after the save. draftEntries composes the on screen list from these,
    // and a raw draft value there would have shown another coach's fresh
    // attendance mark as absent.
    const { includedInGroups, present, bibColourOverride } = effective(draft, stored, playerId)
    // Nothing to write for a player who has no stored row and nothing set
    // on them either: that is simply a child the coach has not touched.
    // A guest the coach ADDED is different: they are on this list because
    // somebody put them there, so unticking them must leave the row on
    // screen rather than deleting it under their thumb.
    if (!stored && !includedInGroups && !present && bibColourOverride === null && !draft.added[playerId]) continue
    // A field travels only when the coach TOUCHED it and it differs from
    // what is stored now. Both halves are load bearing:
    //
    //   the diff alone is not enough, because the draft is frozen at the
    //   first tap while `entries` keeps refetching, so an untouched field
    //   can "differ" purely because another coach moved it, and sending
    //   the frozen seed would overwrite them;
    //
    //   the touch alone is not enough either, because a coach who toggles
    //   a value and toggles it back has touched it and changed nothing,
    //   and rewriting it would take the same lock for no reason.
    //
    // A row with nothing stored is new, so every field is genuinely new
    // and all of them travel; there is no other coach's value to protect.
    const isNew = !stored
    const presentChanged = isNew || (wasTouched(draft, playerId, 'attendance') && stored.present !== present)
    const includedChanged =
      isNew || (wasTouched(draft, playerId, 'included') && stored.includedInGroups !== includedInGroups)
    const bibChanged =
      isNew || (wasTouched(draft, playerId, 'bib') && stored.bibColourOverride !== bibColourOverride)
    // No field would travel, so there is no row to send. This replaces the
    // old "does the draft differ from stored" check, which asked the wrong
    // question: a row can differ from a baseline another coach has moved
    // without this coach having changed anything.
    if (!presentChanged && !includedChanged && !bibChanged) continue
    out.push({
      sessionId,
      playerId,
      present,
      includedInGroups,
      bibColourOverride,
      source: stored?.source ?? (draft.added[playerId] ? 'manual' : 'roster'),
      presentChanged,
      includedChanged,
      bibChanged,
      isNew,
    })
  }
  return out
}

// What the screen's draft should be after a save reports success.
//
// NOT null unconditionally. Clearing the draft makes the screen rebuild it
// from the readback and then compare the readback with itself, so "Saved"
// becomes structurally true for any mutation that did not throw, and the
// field for field comparison this module documents never runs. It also
// silently discards anything the coach ticked while the write was in
// flight, since the payload was captured at click time.
//
// So: keep the draft when it still differs from what came back, and clear
// it only when they agree. Clean means Saved, and Saved then means stored.
export function draftAfterSave(
  draft: TonightDraft | null,
  persisted: RegisterEntry[],
): TonightDraft | null {
  if (!draft) return null
  return draftIsDirty(draft, persisted) ? draft : null
}

// Guests the save should DELETE rather than write.
//
// The screen this replaces had a per row remove wired straight to a
// delete. In a draft world the same intent is "untick them and save", so
// a stored guest the coach has unticked and left without a bib is removed
// entirely; otherwise a wrongly added child would stay on the session for
// ever with no affordance to take them off. Only a guest is ever removed:
// a roster child belongs to the covered squad and their row is their
// record, not their presence on a list.
//
// ATTENDANCE IS PART OF "SAYS NOTHING", and adding it is not a detail.
// While inclusion and attendance were one column this read "not ticked and
// no bib", which was complete. With them split, a guest could be marked
// present and then taken out of the working groups, and the old condition
// would have DELETED the row, destroying the record that a child was at
// the session. A row is removable only when it records nothing at all:
// not in a group, not marked present, no bib.
// The three facts are read through `effective`, so a field the coach never
// touched is judged by what is STORED NOW rather than by the seed their
// draft froze with. Without that, a guest another coach marked present
// between the coach's first tap and their Save was deleted.
export function draftRemovals(draft: TonightDraft, entries: RegisterEntry[]): string[] {
  return entries
    .filter((e) => e.source === 'manual')
    .filter((e) => {
      const value = effective(draft, e, e.playerId)
      return !value.includedInGroups && !value.present && value.bibColourOverride === null
    })
    .map((e) => e.playerId)
}

// Whether the draft differs from what is stored.
//
// THIS IS WHAT "SAVED" MEANS. The status line never reports Saved because
// a mutation returned without an error; it reports Saved because the
// authoritative readback, compared here field for field, agrees with the
// draft. A partial write, a row refused by RLS, or a value that came back
// different all leave this true and the screen dirty.
export function draftIsDirty(draft: TonightDraft, entries: RegisterEntry[]): boolean {
  // Removals count. A draft whose only change is "take this guest off the
  // list" is still a change, and reading it as clean would leave the Save
  // button closed over work the coach had done.
  return draftDelta(draft, entries, '').length > 0 || draftRemovals(draft, entries).length > 0
}

// The database rows a save sends, built from the delta.
//
// Every column the application owns travels together, because Save groups
// is ONE user act over a baseline the coach just read: the arrangement
// they are looking at is the arrangement they mean. (The per tick writer
// this replaces deliberately sent only the field it changed, so two
// coaches ticking different children could not clobber each other. That
// still holds for a tick; it is the wrong model for committing a whole
// arrangement, and last writer wins is what "Save groups" means.)
//
// marked_by and marked_at are absent on purpose: a database trigger
// stamps both from auth.uid(), which is what makes them unforgeable.
export interface TonightUpsertRow {
  session_id: string
  player_id: string
  club_id: string
  present?: boolean
  included_in_groups?: boolean
  bib_colour_override?: string | null
  source?: 'roster' | 'manual'
}

// THE ROWS A SAVE SENDS, GROUPED SO THE PARTIAL WRITE SURVIVES THE WIRE.
//
// tonightUpsertRows deliberately emits rows with DIFFERENT key sets: a
// child whose group changed carries included_in_groups and nothing else, a
// child whose bib changed carries bib_colour_override and nothing else.
// That is what stops two coaches reverting each other.
//
// postgrest-js does not preserve it across an array. Its upsert sets the
// `columns` query parameter to the UNION of the keys of every object in
// the batch (@supabase/postgrest-js 2.108.0, PostgrestQueryBuilder.upsert),
// and because defaultToNull is true by default it does not send
// `Prefer: missing=default`. PostgREST therefore builds ONE
// INSERT ... ON CONFLICT DO UPDATE over that union, and a key an
// individual row omitted arrives as NULL. So a single Save that touched
// one child's group and another child's bib would propose NULL into
// present (NOT NULL, so 23502 and the whole statement fails) and NULL over
// the first child's stored bib on the way past.
//
// `defaultToNull: false` is not the fix and is strictly worse: the omitted
// key would then arrive as the column DEFAULT, so excluded.present is
// false and the DO UPDATE SET writes false over stored attendance,
// silently. That is precisely the corruption this whole release exists to
// prevent.
//
// So the batch is split by key shape and each shape is sent as its own
// upsert. Every request is then internally uniform, its `columns` union is
// exactly the keys that request meant to write, and nothing is proposed
// for a column the coach did not touch.
//
// WHAT THIS COSTS, stated honestly: one statement becomes up to a few, so
// the all-or-nothing guarantee now holds PER SHAPE rather than across the
// whole save. It is not a regression in what "Saved" means, because Saved
// has never rested on the write: it rests on the authoritative readback
// being compared with the draft field for field (see draftAfterSave). A
// batch that fails leaves the screen dirty and says so.
export function tonightUpsertBatches(changes: TonightChange[], clubId: string | null): TonightUpsertRow[][] {
  const rows = tonightUpsertRows(changes, clubId)
  const byShape = new Map<string, TonightUpsertRow[]>()
  for (const row of rows) {
    // The key set, order independent, so two rows that write the same
    // columns land in the same request whatever order the keys were set in.
    const shape = Object.keys(row).sort().join(',')
    const group = byShape.get(shape)
    if (group) group.push(row)
    else byShape.set(shape, [row])
  }
  return [...byShape.values()]
}

export function tonightUpsertRows(changes: TonightChange[], clubId: string | null): TonightUpsertRow[] {
  if (changes.length === 0) return []
  // A row with no club is a row RLS refuses, so fail here with something
  // a coach can read rather than at the database with a policy error.
  if (!clubId) throw new Error('You must be signed in to save tonight s groups.')
  return changes.map((c) => {
    const row: TonightUpsertRow = { session_id: c.sessionId, player_id: c.playerId, club_id: clubId }
    // Only the fields this change moved. Omitting a key leaves the stored
    // value alone, which is exactly what protects the other coach's edit;
    // a cleared bib is sent as an explicit null, not omitted, or "back to
    // the team colour" would silently not happen.
    //
    // present and included_in_groups are two separate keys under two
    // separate flags, so organising the groups sends no attendance value
    // and marking attendance sends no group value. That is what makes the
    // two facts safe to edit concurrently rather than merely documented as
    // independent.
    if (c.presentChanged) row.present = c.present
    if (c.includedChanged) row.included_in_groups = c.includedInGroups
    if (c.bibChanged) row.bib_colour_override = c.bibColourOverride
    // Only on insert. Rewriting it later could turn a stored guest into a
    // squad member, which the security suite pins against.
    if (c.isNew) row.source = c.source
    return row
  })
}

// ---- The groups on the grass ----------------------------------------

export interface TonightGroup {
  // The effective bib colour, or null for no bib.
  bib: string | null
  label: string
  rows: TonightRow[]
  count: number
  // The teams the children in this group come from, in first appearance
  // order. A bib group can mix teams, and the coach still needs to know
  // whose squad each child is in.
  teamNames: string[]
}

// The working answer to "how do I split these kids up on the grass".
//
// Grouped by EFFECTIVE BIB, because that is the thing a coach points at
// on the pitch, and team identity is kept beside it rather than instead
// of it. The effective bib is the existing rule and is not reimplemented
// here: the draft's override, then the child's team colour, then none,
// with a stored override of 'none' meaning no bib rather than fall back.
//
// Only SELECTED children appear. The counts are the working group sizes,
// so a child the coach has not included is not in a group.
export function tonightGroups(rows: TonightRow[], draft: TonightDraft): TonightGroup[] {
  const groups = new Map<string, TonightGroup>()
  for (const r of rows) {
    if (!draftIncluded(draft, r.playerId)) continue
    const bib = effectiveBib(draftBib(draft, r.playerId), r.teamBib)
    const key = bib ?? ''
    let g = groups.get(key)
    if (!g) {
      // "Red bibs", not "Red": the label names the group a coach points
      // at on the grass. The bibless group is "No bibs" and says nothing
      // about a team, because it holds two different facts at once: a
      // child the coach set to No bib, and a child whose team has no
      // colour configured. Both wear nothing, and blaming the team for
      // the first was simply untrue.
      const colour = bibLabel(bib)
      g = { bib, label: colour ? `${colour} bibs` : 'No bibs', rows: [], count: 0, teamNames: [] }
      groups.set(key, g)
    }
    g.rows.push(r)
    g.count++
    if (r.teamName && !g.teamNames.includes(r.teamName)) g.teamNames.push(r.teamName)
  }
  // Ordered by the club's own bib vocabulary, with the bibless group last.
  // Map insertion order would be the first appearance order of an
  // arbitrary child, so one bib edit reshuffled every card on a screen a
  // coach is reading to call groups out.
  const order = new Map(BIB_COLOURS.map((b, i) => [b.value, i]))
  return [...groups.values()].sort((a, b) => {
    const ai = a.bib === null ? Number.MAX_SAFE_INTEGER : (order.get(a.bib) ?? Number.MAX_SAFE_INTEGER - 1)
    const bi = b.bib === null ? Number.MAX_SAFE_INTEGER : (order.get(b.bib) ?? Number.MAX_SAFE_INTEGER - 1)
    return ai - bi
  })
}

// What the save button and status line are saying. Derived, never stored:
// the screen cannot be "Saved" while the draft differs from the readback.
export type SaveState = 'saved' | 'dirty' | 'saving' | 'failed'

export const SAVE_LABELS: Record<SaveState, string> = {
  saved: 'Saved',
  dirty: 'Unsaved changes',
  saving: 'Saving…',
  failed: 'Could not save',
}

export function saveState(dirty: boolean, saving: boolean, failed: boolean): SaveState {
  // Saving wins, so a slow write reads as in flight rather than as an old
  // failure. A failed save that the coach has since edited is dirty
  // again, because the thing on screen is not what failed.
  if (saving) return 'saving'
  if (failed && dirty) return 'failed'
  return dirty ? 'dirty' : 'saved'
}


// A truthful one line summary of tonight: how many are expected from
// Spond, how many the coach has selected, and how many groups that makes.
export function tonightSummary(rows: TonightRow[], draft: TonightDraft): string {
  // The same builder the screen uses. The card led with a count of its own
  // before, which is exactly how two surfaces describing one night start
  // disagreeing. Links are not read here: the card makes no claim about
  // them, and unknown is the honest input for a figure it never prints.
  const counts = tonightCounts(rows, draft, null)
  const groups = tonightGroups(rows, draft)
  // "0 expected" reads as "nobody is coming". With no Spond nothing is
  // known about who is coming, which is a different sentence, so the card
  // counts the squad it is organising instead of claiming a zero.
  const lead = hasResponseContext(rows) ? `${counts.responses.going} expected` : `${counts.responses.everyone} in the squad`
  const parts = [lead, `${counts.selected} selected`]
  if (groups.length > 0) parts.push(`${groups.length} group${groups.length === 1 ? '' : 's'}`)
  return parts.join(' · ')
}

