// The "Plan from Spond" suggestions surface: synced Spond events a coach can
// turn into a session. It lists events in the coach's scope (their team's
// events plus club events) that they have not already planned, upcoming first
// then recent past, and "Plan this" creates a pre filled session and drops
// the coach into the planner to build the drills.
//
// Counts only, the children's data boundary (CLAUDE.md, Spond integration):
// each row shows the four counts and event facts from the spond_events read
// as planning context and nothing member identifying. The browser never calls
// Spond; the surface reads the synced mirror and writes only a session through
// the existing create path and its RLS. Nothing is created automatically and
// nothing flows toward Spond.
import { useEffect, useRef, useState } from 'react'
import { useNav } from '../hooks/useNav'
import { useAuth } from '../hooks/useAuth'
import { useGuardedSubmit } from '../hooks/useGuardedSubmit'
import { useSessions } from '../context/SessionsContext'
import { useMyCapabilities, useMyTeams, useSpondEvents, useTeamMap } from '../lib/queries'
import { memberTeamIds } from '../lib/data'
import type { Session, SpondEvent } from '../lib/data'
import { SESSION_CREATE_ERROR, stableCreateId } from '../lib/sessionSubmit'
import { sessionFromSpondEvent, SPOND_COUNT_LABELS, spondEventWhen, spondPlanSuggestions, spondTeamLabel } from '../lib/spond'
import { Icon } from './icons'
import { CancelledBadge, MatchBadge } from './SpondAttendance'
import { ActionError, Chip } from './ui'

// Presentational, so the static renderer covers the rows and toggles without a
// query client, the same style as the rest of the suite. The container
// resolves scope, filters and the create handler and feeds plain props in.
export function PlanFromSpondView({
  rows,
  eventsExist,
  trainingOnly,
  onTrainingOnly,
  showAll,
  onShowAll,
  showAllToggle,
  onPlan,
  loading,
  error,
  planPendingId = null,
  planFailed = false,
  frozen = false,
}: {
  rows: SpondEvent[]
  eventsExist: boolean
  trainingOnly: boolean
  onTrainingOnly: (v: boolean) => void
  showAll: boolean
  onShowAll: (v: boolean) => void
  showAllToggle: boolean
  onPlan: (event: SpondEvent) => void
  loading: boolean
  error: boolean
  // The event whose session create is in flight; every Plan this control
  // disables while one runs, so a second event cannot be planned in parallel.
  planPendingId?: string | null
  // The last create failed; the row's button doubles as the retry.
  planFailed?: boolean
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
        <Chip on={trainingOnly} onClick={() => onTrainingOnly(!trainingOnly)}>
          Training only
        </Chip>
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
          Could not load the synced events. Try again.
        </p>
      ) : rows.length === 0 ? (
        <p className="muted" style={{ fontSize: 13.5 }}>
          {eventsExist
            ? 'No unplanned events match. Try All teams, or turn Training only off to see every event.'
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
                {e.spondType === 'MATCH' && <MatchBadge />}
                {e.cancelled && <CancelledBadge />}
              </div>
              <div className="row wrap" style={{ gap: 6, marginTop: 4 }}>
                <span className="muted" style={{ fontSize: 12.5, fontWeight: 600 }}>
                  {spondEventWhen(e.startsAt)}
                </span>
                <span className="pill">{spondTeamLabel(e.teamName)}</span>
                {SPOND_COUNT_LABELS.map((label) => (
                  <span key={label} className="pill">
                    <b>{e[label]}</b> {label}
                  </span>
                ))}
              </div>
            </div>
            <button className="btn btn-primary btn-sm" disabled={planPendingId !== null || frozen} onClick={() => onPlan(e)}>
              <Icon.plus />
              {planPendingId === e.id ? 'Planning…' : 'Plan this'}
            </button>
          </div>
        ))
      )}
      {planFailed && <ActionError style={{ marginTop: 10 }}>{SESSION_CREATE_ERROR}</ActionError>}
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
  const { user, profile } = useAuth()
  const { caps } = useMyCapabilities()
  const { sessions, upsertSession } = useSessions()
  const { data: events = [], isLoading, isError } = useSpondEvents()
  const { data: myTeams } = useMyTeams()
  const teamById = useTeamMap()
  const [trainingOnly, setTrainingOnly] = useState(false)
  const [showAll, setShowAll] = useState(false)
  // One id per Spond event for the life of this surface, so a retry after an
  // ambiguous failure reuses it and the server-safe write recovers into an
  // update instead of duplicating; a success navigates away and unmounts.
  const ids = useRef(new Map<string, string>())
  // The create is awaited: the planner opens only once the session lands, and
  // a failure keeps this surface up with a calm note; the row's button is the
  // retry. The pre filled session carries the event id in spondEventId, which
  // keys the row's pending label.
  const { submit, pending, failed: planFailed } = useGuardedSubmit<Session, Session>({
    operation: 'plan from spond event',
    perform: (s) => upsertSession(s),
    onSuccess: (saved) => nav('planner', { sessionId: saved.id }),
  })
  const planPendingId = pending?.spondEventId ?? null
  // Report the pending transition up so the outer planner can freeze alongside.
  useEffect(() => {
    onPendingChange?.(pending !== null)
  }, [pending, onPendingChange])

  // Coaches plan; parents never see this. The planner route already redirects
  // parents, so this is belt and braces and keeps the surface safe to drop on
  // the Sessions screen too without leaking the create affordance.
  if (!caps.has('sessions.create')) return null

  const scope = myTeams ?? { teamIds: [], allTeams: false }
  const scopeTeamIds = memberTeamIds(scope, Object.keys(teamById))
  // The toggle widens to every team's events. It earns its place only when the
  // coach's own teams are a specific subset: the all teams flag already shows
  // everything, and with no team there is nothing but club events to narrow.
  const showAllToggle = !scope.allTeams && scope.teamIds.length > 0

  // Planned for this coach: a session they own already linked to the event.
  const plannedEventIds = new Set(
    sessions.filter((s) => s.coachId === user?.id && s.spondEventId).map((s) => s.spondEventId as string),
  )
  const rows = spondPlanSuggestions({
    events,
    plannedEventIds,
    scopeTeamIds,
    showAllTeams: showAll,
    trainingOnly,
  })

  // On the Sessions screen the surface only earns space when it has something
  // to suggest; on the planner it shows the empty guidance instead.
  if (hideWhenEmpty && !isLoading && !isError && rows.length === 0) return null

  const plan = (event: SpondEvent) => {
    const session = {
      ...sessionFromSpondEvent(event, user?.id ?? '', profile?.team_id ?? null),
      id: stableCreateId(ids.current, event.id),
    }
    void submit(session)
  }

  return (
    <PlanFromSpondView
      rows={rows}
      eventsExist={events.length > 0}
      trainingOnly={trainingOnly}
      onTrainingOnly={setTrainingOnly}
      showAll={showAll}
      onShowAll={setShowAll}
      showAllToggle={showAllToggle}
      onPlan={plan}
      loading={isLoading}
      error={isError}
      planPendingId={planPendingId}
      planFailed={planFailed}
      frozen={frozen}
    />
  )
}
