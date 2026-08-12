// Pure helpers behind the Spond surfaces: the mapping editor's input
// parsing, the event picker's ordering and the freshness label. No fetching
// of any kind happens here or anywhere else client side; the browser never
// calls Spond, and the only Spond data the client touches is the counts and
// event facts the spond_events read returns (CLAUDE.md, Spond integration).
import { blankSession } from './data'
import type { Session, SpondEvent, SpondMapping } from './data'

// The four counts in display order, the only attendance figures the app
// holds. They key straight into SpondEvent.
export const SPOND_COUNT_LABELS = ['accepted', 'declined', 'unanswered', 'waiting'] as const

// ---- The event aggregate, and who it counts --------------------------
//
// THE POPULATION THESE FOUR NUMBERS DESCRIBE, which is the thing every
// screen showing them has to say out loud.
//
// spond_events holds four integers per event, derived from the response
// arrays Spond returns. They count EVERY MEMBER SPOND INVITED: children
// the Hub has never bound to a roster child, coaches, members of a
// subgroup nobody mapped, and anyone else on the event. It is not the
// club's roster and it is not a squad.
//
// Tonight's chips count something else entirely: covered Hub players.
// Both were once rendered as a bare number beside the same word, so one
// event honestly read "19 accepted" on the planner and "Going 11" on
// Tonight, and a coach reasonably asked which was wrong. Neither was:
// on that night the event's audience was 46 people and 27 of the club's
// 40 covered children were linked to one of them.
//
// So nothing here is compared with a Tonight count, and nothing here is
// rendered without naming its population.

// Everybody the Spond event reached, which is what the four counts add up
// to. Named rather than summed at each call site so no screen invents its
// own idea of the denominator.
export function spondAudience(event: {
  accepted: number
  declined: number
  unanswered: number
  waiting: number
}): number {
  return event.accepted + event.declined + event.unanswered + event.waiting
}

// The caption above a row of the four counts. Its whole job is to stop the
// numbers under it being read as a statement about the club's squad.
export const SPOND_AUDIENCE_CAPTION = 'Everyone invited to the Spond event'

// One line naming the population and the figure a Tonight chip is most
// often compared with. Rendered where the aggregate sits beside Hub
// counts, so the two never look like the same measurement.
export function spondAudienceNote(event: {
  accepted: number
  declined: number
  unanswered: number
  waiting: number
}): string {
  return `Spond event: ${spondAudience(event)} invited, ${event.accepted} going`
}

// What an admin pastes into the add mapping form resolves to: the Spond
// group, and optionally one subgroup within it.
export interface SpondGroupRef {
  groupId: string
  subgroupId: string | null
}

// Spond ids are long uppercase hex strings (32 characters today). A long
// hex run is required rather than an exact length so a format tweak on
// Spond's side does not brick the editor, while short hex-looking words
// still fail as garbage.
const SPOND_ID = /^[0-9A-F]{16,}$/

// The id segment of a Spond client URL: everything after /client/groups/ up
// to the next path separator, query or fragment.
const CLIENT_URL = /^https?:\/\/(?:www\.)?spond\.com\/client\/groups\/([^/?#]+)/i

// Resolves the add mapping form's one source input. Accepts a raw group id,
// a raw GROUP-S-SUBGROUP pair, or a full Spond client URL of the form
// https://spond.com/client/groups/<GROUPID> or
// https://spond.com/client/groups/<GROUPID>-S-<SUBGROUPID>, where the -S-
// separator splits group from subgroup. Case is normalised to the uppercase
// Spond uses. Anything else, other URLs included, is null: only ids reach
// the insert, never a pasted page.
export function parseSpondMappingInput(raw: string): SpondGroupRef | null {
  let value = raw.trim()
  const url = value.match(CLIENT_URL)
  if (url) value = url[1]
  else if (value.includes('/') || value.includes(':')) return null
  const parts = value.toUpperCase().split('-S-')
  if (parts.length > 2) return null
  const [groupId, subgroupId] = parts
  if (!SPOND_ID.test(groupId)) return null
  if (subgroupId === undefined) return { groupId, subgroupId: null }
  if (!SPOND_ID.test(subgroupId)) return null
  return { groupId, subgroupId }
}

// Whether a team has a Spond group mapped, and which mapping the roster
// import would pull. The roster manager offers Import from Spond only when
// this returns a mapping; with no mapping the action is hidden. Returns the
// first mapping for the team (the import server side pulls every mapping the
// team carries, this only decides the affordance). Pure so the test pins
// that import is offered only for a mapped team.
export function mappingForTeam(mappings: SpondMapping[], teamId: string): SpondMapping | null {
  if (!teamId) return null
  return mappings.find((m) => m.teamId === teamId) ?? null
}

// A synced event's team label. Null is a club event, one the sync matched
// through more than one mapping (or an event whose team was later deleted),
// so it reads as the whole club's.
export function spondTeamLabel(teamName: string | null): string {
  return teamName ?? 'All teams'
}

// The picker's team filter: a club event (no team) is visible under every
// team's filter, not only the all events toggle.
export function spondEventInTeam(event: { teamId: string | null }, teamId: string): boolean {
  return event.teamId === null || event.teamId === teamId
}

// Comparator for the event picker: nearest to the session's moment first,
// so the Tuesday session offers Tuesday's event before the gala in three
// weeks. The session date is a plain yyyy-mm-dd with the start time joined
// when set; a session with no date falls back to start order.
export function bySpondEventCloseness(date: string, time: string) {
  const at = date ? Date.parse(`${date}T${time || '00:00'}`) : NaN
  return (a: { startsAt: string }, b: { startsAt: string }): number => {
    if (Number.isFinite(at)) {
      const d = Math.abs(Date.parse(a.startsAt) - at) - Math.abs(Date.parse(b.startsAt) - at)
      if (d !== 0) return d
    }
    return a.startsAt.localeCompare(b.startsAt)
  }
}

// What the Link Spond event picker lists, given its two narrowings and the
// session's moment: Training or All events first, then the team scope, then
// nearest to the session.
//
// Lives here rather than in the modal that renders it because the modal
// opens on a tap and this project has no DOM, so inside the component the
// rule was unreachable by any test: it could be changed to always widen and
// the suite stayed green while the Training chip rendered pressed over a
// list of fixtures. Out here it is ordinary pure code with ordinary tests.
export function pickerEvents(
  events: SpondEvent[],
  opts: { kind: EventKind; showAll: boolean; teamId: string | null; date: string; time: string },
): SpondEvent[] {
  const teamId = opts.teamId
  const inTeam = opts.showAll || !teamId ? events : events.filter((e) => spondEventInTeam(e, teamId))
  const pool = inTeam.filter((e) => matchesEventKind(e, opts.kind))
  return [...pool].sort(bySpondEventCloseness(opts.date, opts.time))
}

// The freshness label next to the counts: "synced 20 minutes ago". Coarse
// on purpose, freshness not precision; the counts are a snapshot and change
// only when someone presses Sync now.
export function syncedAgo(syncedAt: string, now: Date = new Date()): string {
  const ms = now.getTime() - Date.parse(syncedAt)
  if (!Number.isFinite(ms)) return ''
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return 'synced just now'
  if (minutes < 60) return `synced ${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `synced ${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  return `synced ${days} day${days === 1 ? '' : 's'} ago`
}

// An event's date and time the way the session cards show theirs:
// Mon 16 Jun · 17:30.
export function spondEventWhen(startsAt: string): string {
  const d = new Date(startsAt)
  if (Number.isNaN(d.getTime())) return ''
  const date = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  return `${date} · ${time}`
}

// The muted line under a picker row's title: when it is, whose it is, and
// how many of the people Spond invited are going.
//
// PURE, AND HERE, because the picker lives inside a modal and this project
// has no DOM: a modal never opens under test, so a rule left in that JSX is
// a rule nothing checks. (pickerEvents is in this file for the same reason.
// A test asserting the row's wording through a static render of the card
// passed while the row said the opposite, which is how this arrived.)
//
// It reads "21 of 50 invited going" rather than "21 accepted" because that
// bare figure is the one a coach carries to Tonight and compares with a
// Going chip counting covered Hub players.
export function spondPickerSummary(event: SpondEvent): string {
  return `${spondEventWhen(event.startsAt)} · ${spondTeamLabel(event.teamName)} · ${event.accepted} of ${spondAudience(event)} invited going`
}

// The event's local wall clock split into the session's yyyy-mm-dd date and
// HH:mm time, the same instant the suggestion row shows through spondEventWhen.
// An unreadable timestamp leaves both blank.
export function spondEventLocalDateTime(startsAt: string): { date: string; time: string } {
  const d = new Date(startsAt)
  if (Number.isNaN(d.getTime())) return { date: '', time: '' }
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return { date: `${yyyy}-${mm}-${dd}`, time: `${hh}:${min}` }
}

// The training classifier lives in ./eventKind, which is the single seam every
// surface uses. Imported for use below and re-exported so existing Spond
// callers keep a stable import; there is no second implementation.
import { DEFAULT_EVENT_KIND, type EventKind, isTrainingEvent, matchesEventKind } from './eventKind'
export { isTrainingEvent, matchesEventKind }

// The lifecycle rule lives in ./sessionLifecycle, the single seam every
// operational surface uses. Imported for the upcoming and past split below;
// this file declares no cutoff of its own.
import { DEFAULT_LIFECYCLE_SCOPE, matchesLifecycleScope, type LifecycleScope } from './sessionLifecycle'

// The "Plan from Spond" suggestions: synced events a coach could turn into a
// session. Upcoming soonest first by default; the Past scope returns the
// events that have already run, most recent first, for a coach writing up a
// night after it happened. Drops events any club session already links,
// narrows to their teams plus club events
// (team_id null) unless the all teams toggle widens it, and narrows to the
// requested event kind, which is Training unless the caller widens it. Pure
// so the screen wires it to live data and the test pins the scope and
// ordering.
export interface SpondPlanOptions {
  events: SpondEvent[]
  // Event ids that ANY club session already links. A mirrored Spond event
  // holds at most one Hub session (migration 0048), so "already planned" is a
  // question about the club and never about who owns the row. It used to be
  // built per coach, which offered an event another coach had already planned
  // to everybody else and left the database to refuse whoever pressed second.
  plannedEventIds: Set<string>
  // The coach's effective team ids (member_teams resolved, every team when the
  // all teams flag is set). Club events (team_id null) are always in scope.
  scopeTeamIds: string[]
  // Widen to every team's events, the club wide toggle.
  showAllTeams: boolean
  // Which kind of event to suggest. Defaults to Training: a coach opening
  // this is choosing a night to plan, and a Training Hub session is
  // training. All events is the deliberate widening, not the starting
  // point, which is the correction this parameter carries.
  kind?: EventKind
  // Which side of the lifecycle to suggest. Upcoming unless the caller
  // widens it: an event that has already run is not a night to organise,
  // and mixing the two put last month's gala under a coach's thumb while
  // they were trying to plan Tuesday.
  scope?: LifecycleScope
  now?: Date
}

export function spondPlanSuggestions({
  events,
  plannedEventIds,
  scopeTeamIds,
  showAllTeams,
  kind = DEFAULT_EVENT_KIND,
  scope = DEFAULT_LIFECYCLE_SCOPE,
  now = new Date(),
}: SpondPlanOptions): SpondEvent[] {
  const inScope = (e: SpondEvent) => showAllTeams || e.teamId === null || scopeTeamIds.includes(e.teamId)
  const pool = events.filter(
    (e) =>
      !plannedEventIds.has(e.id) &&
      inScope(e) &&
      matchesEventKind(e, kind),
  )
  // Past reads most recent first, because a coach looking back wants last
  // night before last month; upcoming reads soonest first for the same
  // reason pointed the other way.
  // matchesLifecycleScope, not a `!isSessionPast` of its own. With three
  // lifecycle states the seam is the only place that should decide which
  // of them Upcoming holds, and restating it here is how a fourth answer
  // to the same question gets written. An event that RAN EARLIER TODAY is
  // therefore still offered: planning a session from this morning's event
  // is the same real act as writing up last night, and it stops being
  // offered when the local day turns over.
  if (scope === 'past') {
    return pool
      .filter((e) => matchesLifecycleScope(e, 'past', now))
      .sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt))
  }
  return pool
    .filter((e) => matchesLifecycleScope(e, 'upcoming', now))
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
}

// The pre filled session "Plan this" creates: the tapping coach owns it, the
// date and time come from the event, and the link is set so the session shows
// the attendance block. Coverage is the event's team, or the coach's default
// when the event is a club event with no team, or the whole club when neither
// names one, matching a fresh planner draft. It is never left unset: this
// session is saved before the coach sees it, and an unset session's register
// lists nobody. No drills are added; the coach builds those in the planner.
// Rides the existing session create path and its RLS, so no new policy. Pure
// so the test pins the carried fields.
export function sessionFromSpondEvent(
  event: SpondEvent,
  coachId: string,
  defaultTeamId: string | null,
  allTeamIds: string[] = [],
): Session {
  const { date, time } = spondEventLocalDateTime(event.startsAt)
  const teamId = event.teamId ?? defaultTeamId
  return {
    ...blankSession(coachId, teamId),
    teamIds: teamId ? [teamId] : allTeamIds,
    name: event.title,
    date,
    time,
    spondEventId: event.id,
  }
}
