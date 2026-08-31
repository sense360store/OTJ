// The "Plan from Spond" suggestions surface: synced Spond events a coach can
// turn into a session. It lists events in the coach's scope (their team's
// events plus club events) that they have not already planned, soonest
// first, and "Plan this" creates a pre filled session and drops the coach
// into the planner to build the drills. Events that have already run are
// behind the Past chip: a night that has happened is not one to organise,
// so it is reachable and never in the way.
//
// Counts only, the children's data boundary (CLAUDE.md, Spond integration):
// each row shows the four counts and event facts from the spond_events read
// as planning context and nothing member identifying. The browser never calls
// Spond; the surface reads the synced mirror and writes only a session through
// the existing create path and its RLS. Nothing is created automatically and
// nothing flows toward Spond.
import { useRef, useState } from 'react'
import { useNav } from '../hooks/useNav'
import { useAuth } from '../hooks/useAuth'
import { useGuardedSubmit } from '../hooks/useGuardedSubmit'
import { useSessions } from '../context/SessionsContext'
import {
  SpondLinkTakenError,
  useMyCapabilities,
  useMyTeams,
  useRefreshSpondPlanning,
  useEventKindContext,
  useSpondEvents,
  useTeams,
  useVenues,
} from '../lib/queries'
import { memberTeamIds } from '../lib/data'
import type { Session, SpondEvent } from '../lib/data'
import { SESSION_CREATE_ERROR, SESSION_SPOND_LINK_TAKEN_ERROR, stableCreateId } from '../lib/sessionSubmit'
import {
  sessionFromSpondEvent,
  spondAudienceNote,
  spondEventWhen,
  spondPlanSuggestions,
  spondTeamLabel,
} from '../lib/spond'
import { ALL_EVENTS_LABEL, DEFAULT_EVENT_KIND, type EventKind, isSpondMatch, TRAINING_LABEL } from '../lib/eventKind'
import {
  DEFAULT_LIFECYCLE_SCOPE,
  LIFECYCLE_SCOPE_LABELS,
  type LifecycleScope,
} from '../lib/sessionLifecycle'
import { Icon } from './icons'
import { CancelledBadge, MatchBadge } from './SpondAttendance'
import { ActionError, Chip } from './ui'

// What a failed read of the synced events says. Named so the default and
// the teams wording beside it are the same kind of thing.
const EVENTS_ERROR = 'Could not load the synced events. Try again.'
const TEAMS_ERROR = 'Could not load the club’s teams, so a session cannot be given the ones it covers. Try again.'

// Presentational, so the static renderer covers the rows and toggles without a
// query client, the same style as the rest of the suite. The container
// resolves scope, filters and the create handler and feeds plain props in.
export function PlanFromSpondView({
  rows,
  eventsExist,
  kind,
  onKind,
  scope,
  onScope,
  showAll,
  onShowAll,
  showAllToggle,
  onPlan,
  loading,
  error,
  errorText = EVENTS_ERROR,
  planPendingId = null,
  planFailed = false,
  planFailedText = SESSION_CREATE_ERROR,
  frozen = false,
}: {
  rows: SpondEvent[]
  eventsExist: boolean
  // Training by default. This surface used to open on every synced event
  // with a Training only toggle a coach had to find; a Training Hub asking
  // "which night do you want to plan?" should not lead with the gala.
  kind: EventKind
  onKind: (v: EventKind) => void
  // Upcoming by default. A night that has already run is not one to
  // organise, so past events are a deliberate widening here too, for the
  // coach writing up a session after it happened.
  scope: LifecycleScope
  onScope: (v: LifecycleScope) => void
  showAll: boolean
  onShowAll: (v: boolean) => void
  showAllToggle: boolean
  onPlan: (event: SpondEvent) => void
  loading: boolean
  error: boolean
  // What to say about that failure. Defaults to the events wording, which
  // is right for the read this card is mostly about. The club's teams are
  // read here too, and failing to read them is a different problem with a
  // different consequence: not "no suggestions" but "a session could not
  // be given the teams it covers", which is worth saying rather than
  // reporting as a missing event list.
  errorText?: string
  // The event whose session create is in flight; every Plan this control
  // disables while one runs, so a second event cannot be planned in parallel.
  planPendingId?: string | null
  // The last create failed; the row's button doubles as the retry.
  planFailed?: boolean
  // What to say about that failure. Defaults to the connection wording,
  // which is right for every failure except one: the database refusing a
  // second session on an event that already has one is not a connection
  // problem and must not be reported as if a retry would help.
  planFailedText?: string
  // An outer write is in flight (the planner's Save or Start on the draft this
  // surface sits above). Planning an event abandons that draft, so every Plan
  // this control freezes until the outer write settles.
  frozen?: boolean
}) {
  return (
    <div className="card" style={{ padding: 18, marginBottom: 18 }}>
      <h3 style={{ fontSize: 17, marginBottom: 4 }}>Plan from Spond</h3>
      <p className="muted" style={{ fontSize: 13.5, marginTop: 0, marginBottom: 12 }}>
        Turn a synced Spond event into a session. The counts show who has answered so far.
      </p>
      <div className="row" style={{ gap: 7, marginBottom: 12 }}>
        <Chip on={kind === 'training'} onClick={() => onKind('training')}>
          {TRAINING_LABEL}
        </Chip>
        <Chip on={kind === 'all'} onClick={() => onKind('all')}>
          {ALL_EVENTS_LABEL}
        </Chip>
        {/* Lifecycle, second: what kind of night, then whether it has
            happened. */}
        <Chip on={scope === 'upcoming'} onClick={() => onScope('upcoming')}>
          {LIFECYCLE_SCOPE_LABELS.upcoming}
        </Chip>
        <Chip on={scope === 'past'} onClick={() => onScope('past')}>
          {LIFECYCLE_SCOPE_LABELS.past}
        </Chip>
        {/* Team, third: a narrowing within the kind, never the split. */}
        {showAllToggle && (
          <Chip on={showAll} onClick={() => onShowAll(!showAll)}>
            All teams
          </Chip>
        )}
      </div>
      {loading ? (
        <p className="muted" style={{ fontSize: 13.5 }}>
          Loading…
        </p>
      ) : error ? (
        <p className="muted" style={{ fontSize: 13.5 }}>
          {errorText}
        </p>
      ) : rows.length === 0 ? (
        <p className="muted" style={{ fontSize: 13.5 }}>
          {/* Name only the widenings actually on screen: the All teams chip
              is absent for a coach whose scope is already the whole club,
              and the one they are already in is no use to them. */}
          {eventsExist
            ? [
                `No unplanned events here. Try ${ALL_EVENTS_LABEL}`,
                scope === 'upcoming' ? `, ${LIFECYCLE_SCOPE_LABELS.past}` : `, ${LIFECYCLE_SCOPE_LABELS.upcoming}`,
                showAllToggle ? ', or All teams.' : '.',
              ].join('')
            : 'Nothing synced yet. An admin presses Sync now on the Spond screen first.'}
        </p>
      ) : (
        rows.map((e) => (
          <div
            key={e.id}
            className="row"
            style={{ gap: 10, padding: '10px 0', borderTop: '1px solid var(--line)', alignItems: 'center' }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="row" style={{ gap: 8 }}>
                <b style={{ fontSize: 14 }}>{e.title}</b>
                {isSpondMatch(e) && <MatchBadge />}
                {e.cancelled && <CancelledBadge />}
              </div>
              <div className="row wrap" style={{ gap: 6, marginTop: 4 }}>
                <span className="muted" style={{ fontSize: 12.5, fontWeight: 600 }}>
                  {spondEventWhen(e.startsAt)}
                </span>
                <span className="pill">{spondTeamLabel(e.teamName)}</span>
                {/* The audience, named, and nothing that reads as a player
                    RSVP. The four counts used to render here as a split,
                    and they count every member Spond invited rather than
                    the squad the planned session will cover, which on the
                    production event was 50 people against 27 linked
                    children. Choosing a night to plan does not need a
                    reply figure; Tonight has the ones that count players. */}
                <span className="muted" style={{ fontSize: 12.5, fontWeight: 600 }}>
                  {spondAudienceNote(e)}
                </span>
              </div>
            </div>
            <button className="btn btn-primary btn-sm" disabled={planPendingId !== null || frozen} onClick={() => onPlan(e)}>
              <Icon.plus />
              {planPendingId === e.id ? 'Planning…' : 'Plan this'}
            </button>
          </div>
        ))
      )}
      {planFailed && <ActionError style={{ marginTop: 10 }}>{planFailedText}</ActionError>}
    </div>
  )
}

export function PlanFromSpond({
  hideWhenEmpty = false,
  frozen = false,
  onPendingChange,
}: {
  hideWhenEmpty?: boolean
  frozen?: boolean
  // Reports whether a Spond-derived create is in flight, so the planner it
  // sits inside can compose that into its own busy state and freeze Save,
  // Start, the fields and its navigation while this create runs. The two
  // surfaces then never create sessions concurrently from one planner.
  onPendingChange?: (pending: boolean) => void
}) {
  const nav = useNav()
  const refreshPlanning = useRefreshSpondPlanning()
  const { user } = useAuth()
  const { caps } = useMyCapabilities()
  const { sessions, upsertSession } = useSessions()
  const { data: events = [], isLoading, isError } = useSpondEvents()
  const { data: myTeams } = useMyTeams()
  // The club's teams, read as a QUERY rather than as the derived map,
  // because whether this read has answered decides whether Plan this may
  // run at all. A club event covers every team the club has, and the
  // session is saved before the coach sees it into a planner that will not
  // re-seed a stored row, so planning one over an unanswered read would
  // write a session covering nobody with no later repair. The map cannot
  // say: a pending read, a failed read and a club with no teams all arrive
  // at it as {}.
  //
  // Wider than the venue wait beside it, and deliberately so. An unmatched
  // venue leaves one field for the coach to fill in a moment later; an
  // empty covered set leaves a register listing nobody and no field
  // saying why.
  //
  // DATA IN HAND IS THE PROOF, not the flags, which is the same rule
  // ../lib/tonight's linkSetFromRead states and for the same reason: a
  // query that never dispatched (offline before the first fetch, or
  // disabled while a gate loads) reports isLoading false and isError
  // false with no data, and reading that as an answered empty club is how
  // a covered set of nobody gets written.
  //
  // It reads the flags only AFTER data, and that ordering matters the
  // other way too. A background refetch that fails leaves the previous
  // teams in hand and sets isError, and the club's teams do not change
  // between one render and the next; taking the card down over a stale
  // but perfectly usable list would stop a coach planning for no reason.
  // The stricter rule belongs where linkSetFromRead uses it, guarding a
  // CLAIM about the club that stale data could make falsely. This guards
  // a default for a row about to be written, where the last known list is
  // the right answer.
  const teamsQuery = useTeams()
  const teamsKnown = teamsQuery.data !== undefined
  const allTeamIds = (teamsQuery.data ?? []).map((t) => t.id)
  // The club's venues, so a new session can default to the one the event's
  // location names. A club wide read the planner already holds, so on the
  // screen this surface usually sits on it costs nothing.
  //
  // ITS LOADING JOINS THE CARD'S, and that is the whole of the race
  // handling. Both reads start together and this one is far the smaller, so
  // in practice the rows appear when the events do; but a coach who pressed
  // Plan this in the gap would have created a session with no venue and no
  // way back to the one this was for, because a successful create navigates
  // away and the retry path never runs again.
  //
  // A FAILED read is not a wait. isError leaves the data undefined, which is
  // an empty list, which means no match and an unset venue: the same place a
  // hand made session starts, and the coach picks one field down. Blocking
  // on that would take planning away over a venue guess.
  const { data: venues = [], isLoading: venuesLoading } = useVenues()
  // The classifier context, so the fixture rule fires here as well. Beside
  // the other reads, above the capability guard: hooks run in one order or
  // they run wrong.
  const kindContext = useEventKindContext()
  const [kind, setKind] = useState<EventKind>(DEFAULT_EVENT_KIND)
  // Named for the lifecycle rather than "scope", because this component
  // already calls the coach's team reach a scope and two of them would be
  // one too many.
  const [lifecycle, setLifecycle] = useState<LifecycleScope>(DEFAULT_LIFECYCLE_SCOPE)
  const [showAll, setShowAll] = useState(false)
  // One id per Spond event for the life of this surface, so a retry after an
  // ambiguous failure reuses it and the server-safe write recovers into an
  // update instead of duplicating; a success navigates away and unmounts.
  const ids = useRef(new Map<string, string>())
  // The create is awaited: the planner opens only once the session lands, and
  // a failure keeps this surface up with a calm note; the row's button is the
  // retry. The pre filled session carries the event id in spondEventId, which
  // keys the row's pending label. onPendingChange reports the transition up
  // synchronously (inside submit), so the outer planner freezes Save and Start
  // in the same tick the create starts, not a render later.
  const {
    submit,
    pending,
    failed: planFailed,
    error: planError,
  } = useGuardedSubmit<Session, Session>({
    operation: 'plan from spond event',
    perform: (s) => upsertSession(s),
    onSuccess: (saved) => nav('planner', { sessionId: saved.id }),
    onPendingChange,
    // The race, handled rather than reported as a mystery. Two coaches can
    // press Plan this on the same event within a second of each other; the
    // database (0048) refuses the second, which is exactly what should
    // happen, and the surface's job is then to tell the truth and catch up.
    // Refetching both lists is what makes the row disappear on the next
    // render: the winning session lands in `sessions`, the event joins
    // plannedEventIds and stops being suggested. refreshPlanning is a stable
    // callback, so it is safe to capture here.
    onFailure: (err) => {
      if (err instanceof SpondLinkTakenError) refreshPlanning()
    },
  })
  const planPendingId = pending?.spondEventId ?? null
  const linkTaken = planError instanceof SpondLinkTakenError

  // Coaches plan; parents never see this. The planner route already redirects
  // parents, so this is belt and braces and keeps the surface safe to drop on
  // the Sessions screen too without leaking the create affordance.
  if (!caps.has('sessions.create')) return null

  const scope = myTeams ?? { teamIds: [], allTeams: false }
  const scopeTeamIds = memberTeamIds(scope, allTeamIds)
  // The toggle widens to every team's events. It earns its place only when the
  // coach's own teams are a specific subset: the all teams flag already shows
  // everything, and with no team there is nothing but club events to narrow.
  const showAllToggle = !scope.allTeams && scope.teamIds.length > 0

  // Already planned, CLUB WIDE. A mirrored Spond event holds at most one Hub
  // session (migration 0048), so "has this been planned?" is a question about
  // the club, never about who owns the row. Asking it per coach meant a second
  // coach was still offered an event another coach had already planned, and
  // pressing Plan this then produced whatever the database said. Ownership
  // still decides who may EDIT the resulting session, which is a different
  // question and is decided elsewhere.
  //
  // The database is the authority on a concurrent create; this only keeps the
  // suggestion list honest about what it can already see.
  const plannedEventIds = new Set(
    sessions.filter((s) => s.spondEventId).map((s) => s.spondEventId as string),
  )
  const suggest = (forKind: EventKind, forScope: LifecycleScope) =>
    spondPlanSuggestions({
      events,
      plannedEventIds,
      scopeTeamIds,
      showAllTeams: showAll,
      kind: forKind,
      kindContext,
      scope: forScope,
    })
  const rows = suggest(kind, lifecycle)

  // On the Sessions screen the surface only earns space when it has something
  // to suggest; on the planner it shows the empty guidance instead.
  //
  // Measured against the widest view, deliberately: every kind, both sides
  // of the lifecycle. Judging it on the Training view would hide the whole
  // card on a week whose only unplanned events are fixtures, and judging it
  // on Upcoming would hide it whenever the only thing left to write up
  // already happened. The card is where both widenings live, so hiding it
  // takes them with it. What stays out of the DEFAULT list is the rule; what
  // the coach can still reach is not.
  const anythingToSuggest = suggest('all', 'upcoming').length > 0 || suggest('all', 'past').length > 0
  //
  // A read that has not answered is never "nothing to suggest", and that
  // now includes the teams read: without it the coach's scope resolves to
  // no teams at all, so the list narrows to club events and the card would
  // hide on the strength of a suggestion set it could not compute.
  if (hideWhenEmpty && !isLoading && !isError && teamsKnown && !anythingToSuggest) return null

  // Coverage comes from the event: its own team, or every team the club
  // has when the sync matched it through more than one mapping and stored
  // it as a club event. The tapping coach's profile team is no longer an
  // input, and used to be the fallback for a club event, which arranged
  // the whole club's Tuesday as one team's session.
  const plan = (event: SpondEvent) => {
    const session = {
      ...sessionFromSpondEvent(event, user?.id ?? '', allTeamIds, venues),
      id: stableCreateId(ids.current, event.id),
    }
    void submit(session)
  }

  return (
    <PlanFromSpondView
      rows={rows}
      eventsExist={events.length > 0}
      kind={kind}
      onKind={setKind}
      scope={lifecycle}
      onScope={setLifecycle}
      showAll={showAll}
      onShowAll={setShowAll}
      showAllToggle={showAllToggle}
      onPlan={plan}
      // An unanswered teams read is a wait, and a failed one is a stop.
      // Both only while the teams are actually unknown: once a list is in
      // hand it stays usable through a later refetch failure.
      loading={isLoading || venuesLoading || (!teamsKnown && !teamsQuery.isError)}
      error={isError || (!teamsKnown && teamsQuery.isError)}
      errorText={!isError && !teamsKnown ? TEAMS_ERROR : EVENTS_ERROR}
      planPendingId={planPendingId}
      planFailed={planFailed}
      planFailedText={linkTaken ? SESSION_SPOND_LINK_TAKEN_ERROR : SESSION_CREATE_ERROR}
      frozen={frozen}
    />
  )
}
