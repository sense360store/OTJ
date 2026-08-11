// =====================================================================
// Tonight: who is expected, and how are we splitting them up.
//
// THE PRODUCT JOB THIS SERVES. Not "who arrived?". The coach standing on
// the grass is asking "who is coming, which of them am I including, and
// what bib does each need so I can split them into groups?". Spond
// suggests the pool; the coach decides the groups.
//
// TWO INDEPENDENT FACTS PER CHILD, and conflating them is the mistake
// this module exists to prevent:
//
//   RESPONSE   what the child's parent said in Spond. Read only. Four
//              states, and a fifth thing that is not a state: a child
//              with no Spond link has NO response. That is not "no
//              reply" — they have no reply to give — so they appear
//              under Everyone and are counted nowhere else.
//   INCLUDED   whether the coach is putting them in tonight's groups.
//              A Going child need not be included. A Not going child may
//              be, because they turned up anyway.
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

export function matchesResponse(row: TonightRow, filter: ResponseFilter): boolean {
  if (filter === 'all') return true
  // A child with no Spond link has response null and matches no reply
  // state. They are not "No reply": they have no reply to give.
  return row.response !== null && row.response === FILTER_STATUS[filter]
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
export function countByResponse(rows: TonightRow[]): ResponseCounts {
  const counts: ResponseCounts = { going: 0, unanswered: 0, declined: 0, waiting: 0, all: rows.length }
  for (const r of rows) {
    for (const f of RESPONSE_FILTERS) {
      if (f !== 'all' && matchesResponse(r, f)) counts[f]++
    }
  }
  return counts
}

// ---- The draft ------------------------------------------------------

// The coach's working arrangement, before it is saved. Sparse on
// purpose: a player with no entry here has never been touched, which is
// what lets the delta write only what changed.
export interface TonightDraft {
  included: Record<string, boolean>
  bibs: Record<string, string | null>
  // Children the coach quick added tonight who are not part of the covered
  // squad. Tracked here because a guest exists only in the draft until the
  // save, and a guest must never read as a squad member.
  added: Record<string, boolean>
}

export function draftFromEntries(entries: RegisterEntry[]): TonightDraft {
  const included: Record<string, boolean> = {}
  const bibs: Record<string, string | null> = {}
  const added: Record<string, boolean> = {}
  for (const e of entries) {
    included[e.playerId] = e.present
    bibs[e.playerId] = e.bibColourOverride
    if (e.source === 'manual') added[e.playerId] = true
  }
  return { included, bibs, added }
}

// Someone who turned up who is not on the list. Selected straight away,
// because that is why the coach reached for the button, and marked as a
// guest so a visitor never becomes a squad member.
export function quickAdd(draft: TonightDraft, playerId: string): TonightDraft {
  return {
    ...draft,
    included: { ...draft.included, [playerId]: true },
    added: { ...draft.added, [playerId]: true },
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
      bibColourOverride: c.bibColourOverride,
      source: c.source,
    })
  }
  return [...byPlayer.values()]
}

export function toggleIncluded(draft: TonightDraft, playerId: string): TonightDraft {
  return { ...draft, included: { ...draft.included, [playerId]: !draft.included[playerId] } }
}

// Select all, scoped to what the coach can actually see. Reaching past
// the current filter would put children in tonight's groups that nobody
// looked at, so the caller passes the visible rows and this trusts them.
export function selectAll(draft: TonightDraft, rows: TonightRow[]): TonightDraft {
  const included = { ...draft.included }
  for (const r of rows) included[r.playerId] = true
  return { ...draft, included }
}

export function clearSelection(draft: TonightDraft, rows: TonightRow[]): TonightDraft {
  const included = { ...draft.included }
  for (const r of rows) included[r.playerId] = false
  return { ...draft, included }
}

// A bib override, or null to fall back to the team's colour. The string
// 'none' is a real choice meaning this child wears no bib tonight even
// though their team has a default.
export function setDraftBib(draft: TonightDraft, playerId: string, value: string | null): TonightDraft {
  return { ...draft, bibs: { ...draft.bibs, [playerId]: value } }
}

function draftIncluded(draft: TonightDraft, playerId: string): boolean {
  return draft.included[playerId] === true
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
  for (const id of Object.keys(draft.bibs)) ids.add(id)
  for (const e of entries) ids.add(e.playerId)
  return [...ids]
}

// One changed row, ready for the query layer to upsert.
export interface TonightChange {
  sessionId: string
  playerId: string
  present: boolean
  bibColourOverride: string | null
  source: 'roster' | 'manual'
  // Which fields this change actually moved, and whether the row exists
  // at all. A save carries only what it changed, so two coaches working
  // the same session at once cannot revert each other: a whole row write
  // would carry a stale value for the field the other one just set.
  presentChanged: boolean
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
    const present = draftIncluded(draft, playerId)
    const bibColourOverride = draftBib(draft, playerId)
    const unchanged =
      stored !== undefined && stored.present === present && stored.bibColourOverride === bibColourOverride
    if (unchanged) continue
    // Nothing to write for a player who has no stored row and nothing set
    // on them either: that is simply a child the coach has not touched.
    // A guest the coach ADDED is different: they are on this list because
    // somebody put them there, so unticking them must leave the row on
    // screen rather than deleting it under their thumb.
    if (!stored && !present && bibColourOverride === null && !draft.added[playerId]) continue
    out.push({
      sessionId,
      playerId,
      present,
      bibColourOverride,
      source: stored?.source ?? (draft.added[playerId] ? 'manual' : 'roster'),
      presentChanged: !stored || stored.present !== present,
      bibChanged: !stored || stored.bibColourOverride !== bibColourOverride,
      isNew: !stored,
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
export function draftRemovals(draft: TonightDraft, entries: RegisterEntry[]): string[] {
  return entries
    .filter((e) => e.source === 'manual')
    .filter((e) => !draftIncluded(draft, e.playerId) && draftBib(draft, e.playerId) === null)
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
  bib_colour_override?: string | null
  source?: 'roster' | 'manual'
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
    if (c.presentChanged) row.present = c.present
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
  const counts = countByResponse(rows)
  const groups = tonightGroups(rows, draft)
  const selected = groups.reduce((a, g) => a + g.count, 0)
  // "0 expected" reads as "nobody is coming". With no Spond nothing is
  // known about who is coming, which is a different sentence, so the card
  // counts the squad it is organising instead of claiming a zero.
  const lead = hasResponseContext(rows) ? `${counts.going} expected` : `${rows.length} in the squad`
  const parts = [lead, `${selected} selected`]
  if (groups.length > 0) parts.push(`${groups.length} group${groups.length === 1 ? '' : 's'}`)
  return parts.join(' · ')
}

