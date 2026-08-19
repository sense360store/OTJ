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
import { activeActivityMinutes } from './activityStructure'
import type { ActivitySlot } from './activityStructure'

// THREE STATES, BECAUSE "FINISHED" AND "YESTERDAY" ARE TWO QUESTIONS.
//
// The first version of this module had two, and answered both with one
// comparison. A session at 18:00 with no planned activities took the 90
// minute fallback, became `past` at 19:30, and left every operational
// surface while the coach was still standing on the pitch at 22:30. The
// row was intact, its Spond link was intact, its saved groups were
// intact; it was simply unreachable. That was a real session on
// 2026-08-11 and lib/sameDaySession.test.ts pins the hour by hour rule
// against it.
//
//   active       still to come, or running now. The only state that can
//                be the "next" event.
//   endedToday   it has ended, and its local calendar day is still the
//                day we are in. Not next, not gone: the coach can still
//                open it, organise it and record who was there.
//   past         a previous local day or older. The widening a coach asks
//                for, exactly as before.
//
// The third state is deliberately NOT a fourth scope, a per screen date
// comparison or a grace period in minutes. A grace period would have been
// the obvious fix and it is the wrong shape: "two hours after it ends" is
// not a thing a coach can reason about, and at 23:00 it would have hidden
// the session again. The local calendar day is the unit the product
// already thinks in, and it is the one a coach can predict.
export type SessionLifecycle = 'active' | 'endedToday' | 'past'

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
  // The structural keys travel with the duration, because how long a
  // session runs is now the sum of the activities ACTUALLY RUNNING. A
  // synced Spond event carries no activities at all and is unaffected.
  activities?: readonly { duration?: number | null; slot?: ActivitySlot | null; skipped?: true }[] | null
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
// the fallback applied where the plan cannot answer.
//
// THE FALLBACK KEYS ON THERE BEING NO PLAN, NOT ON THE SUM BEING ZERO.
// It used to read `total > 0 ? total : FALLBACK_SESSION_MINUTES`, with
// the comment "zero counts as no answer: an empty plan is a session
// nobody has built yet, not a session that lasts no time". That reading
// was correct while a zero total could only mean an empty plan. It stops
// being correct the moment a filter can empty the sum, and standing
// every station down is exactly such a filter: a coach who runs nothing
// tonight would have been answered a synthetic 90 minute session, and
// sessionExpectedEnd would have placed it an hour and a half after a
// night that runs no minutes at all.
//
// So an empty plan still falls back, and a plan somebody built that adds
// up to nothing answers nothing. The distinction was verified against
// the hosted database before it was made: of 24 stored sessions, 12
// carry no activities and take the fallback exactly as before, and NOT
// ONE carries activities summing to zero. No existing row's answer
// moves.
export function plannedMinutes(event: TimedEvent): number {
  const activities = event.activities ?? []
  if (activities.length === 0) return FALLBACK_SESSION_MINUTES
  return activeActivityMinutes(activities)
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

// Are these two instants on the same local calendar day?
//
// LOCAL FIELDS, NEVER A STRING. Comparing toISOString().slice(0, 10)
// would ask whether they share a UTC day, which for a Yorkshire club is a
// different day for one hour of every summer evening: a session at 23:30
// BST is already tomorrow in UTC. Reading getFullYear/getMonth/getDate
// asks the runtime the question the coach is asking, and it is DST safe
// for free, because a 23 hour and a 25 hour day both still have one date.
// Is this instant's local calendar day LATER than now's? Day granularity,
// so a session at 09:00 today is not "after today".
function startsAfterToday(at: Date, now: Date): boolean {
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  return day(at) > day(now)
}

export function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  )
}

// The instant the live marker was written, when the row carries a readable
// one. The driver rewrites live_activity_started_at on EVERY activity
// change, so the stamp dates the evidence rather than the session.
function liveMarkerStamp(event: TimedEvent): Date | null {
  if (!event.liveActivityStartedAt) return null
  const ms = Date.parse(event.liveActivityStartedAt)
  return Number.isFinite(ms) ? new Date(ms) : null
}

// Whether the session is being driven RIGHT NOW.
//
// THE MARKER IS EVIDENCE, AND EVIDENCE GOES STALE. live_activity_index is
// written by the driver on every activity change and cleared when they press
// End. Pressing End is the only thing that clears it, so a driver who closes
// the tab, loses signal or simply walks off the pitch leaves the marker
// behind for ever. This function used to read the bare column, which meant
// "somebody once started this" was treated as "somebody is running this",
// and five sessions from June and July sat in the hosted database with
// live_activity_index = 0 keeping themselves permanently active. That is how
// 16 June turned up under Upcoming on 12 August.
//
// THE RULE, and why it is a calendar day rather than a grace period. A live
// marker counts only on the local day it belongs to. It belongs to the day
// it was WRITTEN, when the row stores one, and to the session's own start
// day when it does not. A marker belonging to a previous local day is stale;
// a marker belonging to a day that has not arrived is not evidence of
// anything either, so a future session carrying contradictory live columns
// gets no Live badge (it is still active, because it is still to come, which
// the clock decides on its own).
//
// A number of hours would have been the obvious alternative and it is the
// wrong shape here for the same reason a grace period was the wrong shape
// for endedToday: "six hours after the last activity change" is not
// something a coach can predict, and whatever number was chosen would either
// hide a session mid evening or keep last month's alive. The local calendar
// day is the unit this product already thinks in, it is the unit
// sessionLifecycle already uses below, and it self heals: a marker nobody
// cleared stops mattering when the day turns over, so no cleanup job and no
// destructive migration over historic rows is needed.
//
// WHAT THIS COSTS, stated rather than hidden. A coach still driving at 00:10
// on a session dated yesterday keeps it only if they touched an activity
// after midnight (which restamps the marker) or the session's planned window
// reaches into today. Otherwise the night moves to Past, where it is fully
// reachable. One row moving a few hours early is a glance; a June session
// wedged into Upcoming for ever is the bug.
//
// One definition, so a screen showing a Live badge and a filter deciding
// what is active cannot disagree. `now` is a parameter for the same reason
// it is one everywhere else here: tests must not depend on the day they run
// on, and a screen must judge every row against one moment.
export function isSessionLive(event: TimedEvent, now: Date = new Date()): boolean {
  if (event.liveActivityIndex == null) return false
  const marker = liveMarkerStamp(event) ?? sessionStart(event)
  // Nothing dates the marker at all: fail towards showing, exactly as an
  // unreadable date is read as active below.
  if (!marker) return true
  return isSameLocalDay(marker, now)
}

// The activity a driver is on RIGHT NOW, or null when nobody is driving.
//
// The same question as isSessionLive, answered with the index rather than a
// boolean, because the live view needs the position and the running clock
// beside it. It exists so the watcher cannot read the column directly: doing
// that gave anybody opening June's session a live stage with a clock counting
// up from two months earlier, which is the most convincing possible way to
// show a session that is not happening.
export function liveActivityNow(event: TimedEvent, now?: Date): number | null {
  return isSessionLive(event, now) ? (event.liveActivityIndex ?? null) : null
}

// Where this row sits in its own lifecycle.
//
// THE PRECEDENCE, in the order it is applied:
//
//   1. status completed. Read FIRST, exactly as before, and still beating
//      the live columns: a row that somehow carries both must not be
//      stuck active for ever, which is what reading live first would do.
//      What changed is the SIZE of the claim. It used to mean "past"; it
//      now means "has ended", and the day rule below decides where that
//      lands. A coach who pressed End at 19:30 still has that evening's
//      work in front of them, so a session completed today is endedToday.
//      A completed session with a FUTURE date is still past, unchanged,
//      because no local day of its own has begun.
//   2. Being driven live, where the marker is CURRENT (see isSessionLive).
//      A coach running long is still running the session, so it stays
//      active however far past its expected end the clock has gone. A
//      marker left behind on a previous local day is not evidence of
//      anybody running anything and is read past, exactly as if the
//      columns were null.
//   3. Expected end from the start plus the planned duration.
//   4. The fallback duration where the plan cannot answer, and the whole
//      local day where the row names no time.
//   5. Ended, and today: endedToday. Ended, and not today: past.
//      Anything else, an unreadable date included, is active.
//
// WHAT "TODAY" MEANS HERE, and why it is generous. A session counts as
// today when EITHER the day it started on OR the day it was expected to
// end on is the local day we are in. The two differ only for a night that
// runs through midnight, and taking either keeps such a session reachable
// on both the evening it began and the small hours it finished in. The
// failure modes are not equal: one extra row on a screen costs a coach a
// glance, and a missing row cost one an entire evening's register.
//
// Deliberately lopsided in the same direction as the training classifier:
// every rule that can hide is narrow and precise, and every ambiguity
// resolves towards keeping the session on screen.
export function sessionLifecycle(event: TimedEvent, now: Date = new Date()): SessionLifecycle {
  const completed = event.status === COMPLETED
  // Completed beats live. A row carrying both is a stale live column, and
  // reading live first would leave it active for ever.
  //
  // isSessionLive takes `now` and answers "is the marker CURRENT", not "does
  // the column hold a number". Passing the moment is the whole of the stale
  // live fix: without it a marker nobody ever cleared keeps its session
  // active for the rest of time, which is what happened to five rows in the
  // hosted database.
  if (!completed && isSessionLive(event, now)) return 'active'
  const end = sessionExpectedEnd(event)
  // Nothing places it in time. A completed row has still ended, and there
  // is no local day it could be "today" on, so it is past.
  if (!end) return completed ? 'past' : 'active'
  const start = sessionStart(event)
  // A completed session whose own DAY has not arrived yet is past, and does
  // not get the same-day reprieve.
  //
  // The row is self-contradictory: somebody marked it finished while it is
  // still days away, which the planner allows because editing a completed
  // session keeps its status. Without this the day rule read the FUTURE end
  // as "today" for the whole of the session's own date, so the row left the
  // Past view at midnight, sat in the default Upcoming list all day
  // labelled as having ended, and returned to Past the next midnight.
  //
  // THE COMPARISON IS ON CALENDAR DAYS, not instants, and that is the whole
  // subtlety. Comparing instants would also send a session the driver ENDED
  // EARLY back to past for the rest of its own window: End pressed at 18:45
  // on a session planned until 19:15 would read as past until 19:15 and
  // then reappear. Ending early is an ordinary Tuesday and that coach still
  // has the evening's work in front of them, so a completed session dated
  // TODAY is endedToday from the moment it is completed.
  if (completed && startsAfterToday(start ?? end, now)) return 'past'
  const overdue = now.getTime() > end.getTime()
  if (!completed && !overdue) return 'active'
  const today = isSameLocalDay(end, now) || (!!start && isSameLocalDay(start, now))
  return today ? 'endedToday' : 'past'
}

// Still to come, or running. The ONLY state that may be offered as the
// next event: an ended session is discoverable, never imminent.
export function isSessionActive(event: TimedEvent, now?: Date): boolean {
  return sessionLifecycle(event, now) === 'active'
}

// Finished, but on the day we are still in. The state that keeps Session
// Day, Tonight and the attendance record one tap away all evening.
export function isSessionEndedToday(event: TimedEvent, now?: Date): boolean {
  return sessionLifecycle(event, now) === 'endedToday'
}

// A previous local day or older. Narrower than it used to be, and that
// narrowing is the fix: this is now the only state that removes a session
// from the operational views.
export function isSessionPast(event: TimedEvent, now?: Date): boolean {
  return sessionLifecycle(event, now) === 'past'
}

// Everything a coach may still act on: tonight's session before it starts,
// while it runs, and after it has finished until the day turns over.
//
// This is the predicate every LIST and every ENTRY POINT wants, and
// isSessionActive is the one only "what is next" wants. Getting those two
// the wrong way round is precisely the regression, so they are named for
// the questions they answer rather than for the states they test.
export function isSessionOperational(event: TimedEvent, now?: Date): boolean {
  return sessionLifecycle(event, now) !== 'past'
}

// The one filter every list calls, kept separate from the predicates so a
// screen expresses "does this row belong in the current view?" rather
// than re-deriving the boolean each time.
//
// Upcoming holds active AND endedToday. A session that finished three
// hours ago is not "upcoming" in the dictionary sense, and it is exactly
// what a coach opening the app at 22:30 is looking for, so the default
// view keeps it and the row says "Ended" for itself. The alternative,
// filing it under Past the moment it ends, is the bug.
export function matchesLifecycleScope(event: TimedEvent, scope: LifecycleScope, now?: Date): boolean {
  return scope === 'past' ? isSessionPast(event, now) : isSessionOperational(event, now)
}
