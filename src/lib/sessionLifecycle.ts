// =====================================================================
// The canonical session lifecycle: is this night still operational work,
// or has it happened?
//
// THE PRODUCT RULE THIS ENCODES. Training Hub is an operational product.
// A coach opening it wants tonight, or the next night, and nothing else.
// Once a session has genuinely finished it must stop appearing as active
// work: no hero on Home, no place in the upcoming counts, no row in the
// default Sessions list, no offer as the night to organise. It is not
// deleted and it is not hidden, it moves. Past is a view a coach asks
// for; every historical row, its register, its bibs, its plan and its
// saved groups stay exactly where they were.
//
// NOTHING HERE WRITES. The lifecycle is DERIVED on every read. The
// sessions.status column is only ever set to completed by one thing, the
// live view's driver pressing End, which means almost every finished
// session in the database still says upcoming for ever. Trusting that
// flag is what left yesterday's training sitting on the front page. So
// the flag is read as evidence when it says finished, and the clock
// answers otherwise. No page render reconciles a stale row, because a
// render is not an instruction to change a record.
//
// ONE SEAM, ON PURPOSE. Before this existed the cutoff was written three
// times: `s.status === 'upcoming' && s.date >= todayStr` on Home, a
// slightly different pair of predicates on the parent dashboard, and
// `Date.parse(e.startsAt) >= now` inside the Spond planner. All three
// disagreed at the edges and all three hid a session the moment its start
// time passed. sessionLifecycle.invariant.test.ts fails the build when a
// fourth one appears.
// =====================================================================
import type { SessionStatus } from './data'

export type SessionLifecycle = 'active' | 'past'

// The duration used when a session's plan cannot answer how long it runs.
//
// WHY 90, AND WHY GENEROUS. The two failure modes are not equal. Ending a
// session too late costs a coach one extra row on a screen; ending it too
// early takes tonight off the front page while they are standing on the
// pitch. A junior training night is an hour to an hour and a half, so 90
// minutes covers the real ones and errs the safe way for anything odd.
// This is the ONLY fallback duration in the product: the invariant test
// fails the build if a second one is declared.
export const FALLBACK_SESSION_MINUTES = 90

// The two views a list of sessions can be in. Upcoming is the operational
// default everywhere; Past is the deliberate widening a coach asks for,
// the same shape as Training and All events one level up.
export type LifecycleScope = 'upcoming' | 'past'

export const LIFECYCLE_SCOPE_LABELS: Record<LifecycleScope, string> = {
  upcoming: 'Upcoming',
  past: 'Past',
}

export const DEFAULT_LIFECYCLE_SCOPE: LifecycleScope = 'upcoming'

// The smallest thing anything needs to be placed in time.
//
// TWO SHAPES, ONE RULE, exactly as ./eventKind reads a session's `name`
// and a synced event's `title`. A Training Hub session carries a local
// `date` and `time` as a coach typed them; a synced Spond event carries
// `startsAt`, an absolute instant. Both are read here so no caller has to
// normalise first and no screen gets an excuse to write its own cutoff
// for the shape it happens to hold. Every field is optional: a row that
// answers none of them is active, because hiding a session is worse than
// showing an odd one.
export interface TimedEvent {
  // yyyy-mm-dd, the club's local calendar day.
  date?: string | null
  // HH:mm, the club's local wall clock.
  time?: string | null
  // An absolute ISO instant, the shape the Spond mirror stores.
  startsAt?: string | null
  status?: SessionStatus | null
  activities?: readonly { duration?: number | null }[] | null
  liveActivityIndex?: number | null
  liveActivityStartedAt?: string | null
}

// The status value that means finished. It lives here, beside the rule
// that reads it, so no screen re-derives "has this happened" from a
// string comparison of its own.
const COMPLETED: SessionStatus = 'completed'

const DATE_PARTS = /^(\d{4})-(\d{2})-(\d{2})$/
const TIME_PARTS = /^(\d{1,2}):(\d{2})/

interface ResolvedStart {
  at: Date
  // True when the row named a day but no time, so nothing says when it
  // began and the whole day has to count as its running time.
  wholeDay: boolean
}

// The session's start as a real instant, and whether it has a time at all.
//
// LOCAL, DELIBERATELY. `new Date(y, m - 1, d, hh, mm)` builds the instant
// that wall clock names where the club is. Handing '2026-08-11T18:00' or
// a bare date string to Date.parse would read it as UTC and move a
// Yorkshire training night by an hour in summer, which is the mistake
// this function exists to make unavailable.
function resolveStart(event: TimedEvent): ResolvedStart | null {
  // The absolute instant wins where a row carries one, because only the
  // Spond side sets it and that side holds the event facts.
  if (event.startsAt) {
    const ms = Date.parse(event.startsAt)
    if (Number.isFinite(ms)) return { at: new Date(ms), wholeDay: false }
  }
  const date = (event.date ?? '').match(DATE_PARTS)
  if (!date) return null
  const [, y, m, d] = date
  const time = (event.time ?? '').match(TIME_PARTS)
  const at = new Date(Number(y), Number(m) - 1, Number(d), Number(time?.[1] ?? 0), Number(time?.[2] ?? 0), 0, 0)
  if (!Number.isFinite(at.getTime())) return null
  return { at, wholeDay: !time }
}

// How long the session is planned to run, in minutes. The same sum the
// planner and the session cards show (see sessionMinutes in ./data), with
// the fallback applied where the plan cannot answer. Zero counts as no
// answer: an empty plan is a session nobody has built yet, not a session
// that lasts no time.
export function plannedMinutes(event: TimedEvent): number {
  const total = (event.activities ?? []).reduce((sum, a) => sum + (a?.duration || 0), 0)
  return total > 0 ? total : FALLBACK_SESSION_MINUTES
}

// The session's start instant, or null when nothing places it in time.
export function sessionStart(event: TimedEvent): Date | null {
  return resolveStart(event)?.at ?? null
}

// Whether the row names a readable time of day rather than only a date.
//
// The lifecycle itself does not need this, because a row with a day and no
// time simply runs to the end of that day. The calendar export does: an
// entry has to say when it begins, and booking midnight because a time
// could not be read would be worse than exporting nothing at all.
export function hasStartTime(event: TimedEvent): boolean {
  const start = resolveStart(event)
  return !!start && !start.wholeDay
}

// When the session is expected to be over.
//
//   start + planned duration, in REAL minutes off the start instant, so a
//   clock change cannot shorten or lengthen a session.
//
// A row with a day but no time runs to the end of that local day: nothing
// says when it started, so nothing may claim it has finished until the
// day it was planned for is over. A row with no readable day has no end
// at all, and callers read that as still active.
export function sessionExpectedEnd(event: TimedEvent): Date | null {
  const start = resolveStart(event)
  if (!start) return null
  if (start.wholeDay) {
    const d = start.at
    // The last millisecond of the local day, built by rolling the day
    // over rather than by adding 24 hours, so a clock change lands right.
    return new Date(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0).getTime() - 1)
  }
  return new Date(start.at.getTime() + plannedMinutes(event) * 60_000)
}

// Whether the session is being driven right now. The live columns are
// written by the driver on every activity change and cleared when they
// press End, so this is a fact about now rather than a flag nobody
// updates. One definition, so a screen showing a Live badge and a filter
// deciding what is active cannot disagree.
export function isSessionLive(event: TimedEvent): boolean {
  return event.liveActivityIndex != null
}

// Where this row sits in its own lifecycle.
//
// THE PRECEDENCE, in the order it is applied:
//
//   1. status completed. Authoritative and believed: somebody, or the
//      live view's End, has said this session is finished. A completed
//      session is past even if its date is in the future.
//   2. Being driven live. A coach running long is still running the
//      session, so it stays active however far past its expected end the
//      clock has gone, until the live state says otherwise.
//   3. Expected end from the start plus the planned duration.
//   4. The fallback duration where the plan cannot answer, and the whole
//      local day where the row names no time.
//   5. now later than the expected end means past. Anything else, an
//      unreadable date included, is active.
//
// Deliberately lopsided in the same direction as the training classifier:
// every rule that can hide is narrow and precise, and every ambiguity
// resolves towards keeping the session on screen.
export function sessionLifecycle(event: TimedEvent, now: Date = new Date()): SessionLifecycle {
  if (event.status === COMPLETED) return 'past'
  if (isSessionLive(event)) return 'active'
  const end = sessionExpectedEnd(event)
  if (!end) return 'active'
  return now.getTime() > end.getTime() ? 'past' : 'active'
}

export function isSessionActive(event: TimedEvent, now?: Date): boolean {
  return sessionLifecycle(event, now) === 'active'
}

export function isSessionPast(event: TimedEvent, now?: Date): boolean {
  return sessionLifecycle(event, now) === 'past'
}

// The one filter every list calls, kept separate from the predicates so a
// screen expresses "does this row belong in the current view?" rather
// than re-deriving the boolean each time.
export function matchesLifecycleScope(event: TimedEvent, scope: LifecycleScope, now?: Date): boolean {
  return scope === 'past' ? isSessionPast(event, now) : isSessionActive(event, now)
}
