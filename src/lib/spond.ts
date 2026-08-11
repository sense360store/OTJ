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

// The "Plan from Spond" suggestions: synced events a coach could turn into a
// session, ordered upcoming soonest first then recent past most recent first.
// Drops events the coach has already planned (a session they own linked to
// it), narrows to their teams plus club events (team_id null) unless the all
// teams toggle widens it, and narrows to the requested event kind, which is
// Training unless the caller widens it. Pure so the screen wires it to live
// data and the test pins the scope and ordering.
export interface SpondPlanOptions {
  events: SpondEvent[]
  // Event ids the current coach already owns a session linked to. One event
  // can be planned by several coaches, so this clears the suggestion for the
  // owner only and leaves it for everyone else.
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
  now?: Date
}

export function spondPlanSuggestions({
  events,
  plannedEventIds,
  scopeTeamIds,
  showAllTeams,
  kind = DEFAULT_EVENT_KIND,
  now = new Date(),
}: SpondPlanOptions): SpondEvent[] {
  const at = now.getTime()
  const inScope = (e: SpondEvent) => showAllTeams || e.teamId === null || scopeTeamIds.includes(e.teamId)
  const pool = events.filter(
    (e) =>
      !plannedEventIds.has(e.id) &&
      inScope(e) &&
      matchesEventKind(e, kind),
  )
  const upcoming = pool
    .filter((e) => Date.parse(e.startsAt) >= at)
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
  const past = pool
    .filter((e) => Date.parse(e.startsAt) < at)
    .sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt))
  return [...upcoming, ...past]
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
