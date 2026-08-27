// The club calendar of sessions. Visibility is club-wide: every coach sees
// every club session. Whose sessions you are looking at is a view filter that
// defaults to your own, and team narrows further. Edit and delete follow
// ownership (own, or admin); other coaches' sessions render read-only with
// the owner's name. The sessions RLS enforces the same rules on write.
import { useState } from 'react'
import { ALL_EVENTS_LABEL, TRAINING_LABEL } from '../lib/eventKind'
import {
  applyEventFilter,
  DEFAULT_EVENT_FILTER,
  type EventFilterState,
  orderEventsForScope,
} from '../lib/eventFilter'
import { isSessionEndedToday, LIFECYCLE_SCOPE_LABELS, matchesLifecycleScope } from '../lib/sessionLifecycle'
import { emptyEventListNote, NO_PAST_SESSIONS_NOTE } from '../lib/sessionEmptyState'
import { useNav } from '../hooks/useNav'
import { useAuth } from '../hooks/useAuth'
import { useSessions } from '../context/SessionsContext'
import {
  useMemberMap,
  useMyCapabilities,
  useMyTeams,
  useEventKindContext,
  useTeamMap,
  useTeams,
  useVenueMap,
} from '../lib/queries'
import { memberTeamIds, sessionMinutes } from '../lib/data'
import type { Session } from '../lib/data'
import { venueNameFor } from '../lib/venues'
import {
  coversWholeClub,
  sessionCoversAnyTeam,
  sessionTeamsLabel,
  sessionVisibleToTeams,
} from '../lib/sessionTeams'
import { Icon } from '../components/icons'
import { Chip, Empty, ErrorNote, fmtDate, Loading, PHASE_COLOR } from '../components/ui'
import { DeleteSessionModal } from '../components/DeleteSessionModal'
import { PlanFromSpond } from '../components/PlanFromSpond'
import { NoTeamNote } from './ParentHome'
import { downloadSessionIcs } from '../lib/ics'

type Nav = ReturnType<typeof useNav>

function SessionCard({
  s,
  nav,
  ownerName,
  teamName,
  venueName,
  canManage,
  coaching,
  ended,
  onDelete,
}: {
  s: Session
  nav: Nav
  ownerName: string | null
  teamName: string | null
  // This session finished earlier today. It is deliberately still in the
  // default view, because a coach at 22:30 is looking for exactly this
  // night, so the card has to say so rather than sit silently among the
  // sessions still to come. See ../lib/sessionLifecycle.
  ended: boolean
  // The resolved venue name. Falls back to the frozen free text label for a
  // session saved before venues existed, and is empty when neither is set.
  venueName: string
  canManage: boolean
  // Parents do not get the planner link at all (the route redirects them);
  // the session day view is their detail.
  coaching: boolean
  onDelete: () => void
}) {
  const mins = sessionMinutes(s)
  return (
    <div className="card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="spread">
        <div>
          <div className="row" style={{ gap: 8, marginBottom: 6 }}>
            <span
              className="pill"
              style={{ color: 'var(--royal)', background: 'color-mix(in srgb, var(--royal) 10%, transparent)' }}
            >
              <Icon.calendar />
              {fmtDate(s.date)}
            </span>
            <span className="pill">
              <Icon.clock />
              {s.time}
            </span>
            {ended && (
              <span
                className="pill"
                style={{ color: 'var(--ink)', background: 'color-mix(in srgb, var(--gold) 16%, transparent)' }}
              >
                Ended earlier today
              </span>
            )}
          </div>
          <h3 style={{ fontSize: 19 }}>{s.name}</h3>
          <div style={{ color: 'var(--ink-2)', fontWeight: 700, fontSize: 'var(--text-base)', marginTop: 2 }}>{s.focus}</div>
        </div>
        <div className="avatar" style={{ background: 'var(--bg-2)', color: 'var(--royal)', fontSize: 13 }}>
          {s.ageGroup}
        </div>
      </div>

      <div className="row wrap" style={{ gap: 7 }}>
        {venueName && (
          <span className="pill">
            <Icon.pin />
            {venueName}
          </span>
        )}
        {teamName && (
          <span className="pill">
            <Icon.flag />
            {teamName}
          </span>
        )}
        <span className="pill">
          <Icon.list />
          {s.activities.length} activities
        </span>
        <span className="pill">
          <Icon.clock />
          {mins} min
        </span>
        {ownerName && (
          <span className="pill">
            <Icon.user />
            {ownerName}
          </span>
        )}
      </div>

      {/* mini timeline */}
      <div style={{ display: 'flex', gap: 3, height: 7, borderRadius: 4, overflow: 'hidden' }}>
        {s.activities.map((a, i) => (
          <div key={i} title={a.phase} style={{ flex: a.duration, background: PHASE_COLOR[a.phase] }}></div>
        ))}
      </div>

      <div className="row" style={{ gap: 9 }}>
        <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => nav('sessionDay', { sessionId: s.id })}>
          <Icon.cone />
          Session day
        </button>
        {/* Driving is owner or admin; everyone else opens the same live view
            as a watcher, so the label says what will happen. */}
        <button className="btn btn-gold" style={{ flex: 1 }} onClick={() => nav('live', { sessionId: s.id })}>
          {canManage ? <Icon.play /> : <Icon.eye />}
          {canManage ? 'Start' : 'Watch'}
        </button>
      </div>
      <div className="row" style={{ gap: 9 }}>
        {canManage ? (
          <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => nav('planner', { sessionId: s.id })}>
            <Icon.edit />
            Edit plan
          </button>
        ) : coaching ? (
          <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => nav('planner', { sessionId: s.id })}>
            <Icon.eye />
            View plan
          </button>
        ) : (
          <span style={{ flex: 1 }}></span>
        )}
        <button
          className="btn btn-ghost btn-sm icon-only"
          style={{ width: 38, padding: 0, alignSelf: 'stretch', height: 'auto' }}
          aria-label="Add to calendar"
          title="Add to calendar"
          onClick={() => downloadSessionIcs(s, venueName)}
        >
          <Icon.calendar />
        </button>
        {canManage && (
          <button
            className="btn btn-ghost btn-sm icon-only"
            style={{ width: 38, padding: 0, alignSelf: 'stretch', height: 'auto' }}
            aria-label="Delete session"
            onClick={onDelete}
          >
            <Icon.trash />
          </button>
        )}
      </div>
    </div>
  )
}

export function Sessions() {
  const nav = useNav()
  const { user } = useAuth()
  const { caps } = useMyCapabilities()
  // Members without sessions.create (parents) watch and follow; the create
  // affordance and the planner links stay hidden for them, and the schedule
  // scopes to their team rather than offering the club-wide ownership filter.
  const canPlan = caps.has('sessions.create')
  const { sessions, loading, error } = useSessions()
  const { data: teams = [] } = useTeams()
  const teamById = useTeamMap()
  const venueById = useVenueMap()
  const memberById = useMemberMap()
  // The parent's team scope: their child's team(s), or every team via the all
  // teams flag. The read rides the same member_teams policy ParentHome uses.
  const { data: myTeams } = useMyTeams()
  // A session planned from a Spond event carries only the event id, so the
  // classifier needs this to see that the event was a MATCH. Read only for
  // members who filter by kind; parents never do.
  const kindContext = useEventKindContext(canPlan)
  const [filter, setFilter] = useState<EventFilterState>(DEFAULT_EVENT_FILTER)
  const [teamId, setTeamId] = useState('')
  // Parents default to their team's schedule; a club wide toggle covers
  // helping across teams.
  const [parentScope, setParentScope] = useState<'team' | 'club'>('team')
  const [deleting, setDeleting] = useState<Session | null>(null)

  if (loading) return <Loading />
  if (error) return <ErrorNote />

  // The parent team scope, resolved the same way ParentHome resolves it: the
  // member's teams, every team while the all teams flag is on, or none. Club
  // sessions (no team) are shared with everyone, so they stay in scope. With
  // no team set there is nothing to narrow to, so the club schedule shows with
  // the gentle note. Teams gate no access; this only narrows the view.
  const venueNameOf = (s: Session) => venueNameFor(s, venueById)
  const scope = myTeams ?? { teamIds: [], allTeams: false }
  const effectiveIds = memberTeamIds(scope, Object.keys(teamById))
  const hasTeam = scope.allTeams || scope.teamIds.length > 0
  // The toggle earns its place only when the member's teams differ from the
  // whole club: a specific selection, not the all teams flag and not no team.
  const showParentToggle = !canPlan && !scope.allTeams && scope.teamIds.length > 0
  const teamChipLabel = scope.teamIds.length > 1 ? 'My teams' : 'My team'
  const teamScoped = (s: Session) => sessionVisibleToTeams(s, effectiveIds)

  // Training first, upcoming first. The primary split is what KIND of night
  // this is, not who owns the row: a coach opening Sessions is asking what
  // training is happening, so Training is the default and All events is the
  // deliberate widening. Upcoming or Past comes next and defaults to
  // Upcoming, because this is an operational list and a finished session is
  // not work. Team narrows within both, and Mine is a secondary narrowing
  // that is off by default. Ownership still decides who may edit or delete,
  // which is `canManage` below and a different question entirely.
  //
  // The composition lives in ../lib/eventFilter so Home and the Spond surfaces
  // give the same answer; only the team predicate is local, because it depends
  // on session coverage and the parent scope. The ORDER comes from the same
  // place: Upcoming soonest first, Past most recent first. Neither is the
  // order the query returns for Past, which read oldest first and buried last
  // night under a season of history.
  const allTeamIds = Object.keys(teamById)
  // One moment for the whole render, so every row on screen is judged
  // against the same clock rather than against the millisecond it happened
  // to be tested at.
  const now = new Date()
  const list = canPlan
    ? applyEventFilter(sessions, filter, {
        userId: user?.id,
        kindContext,
        now,
        teamMatch: (s) =>
          !teamId ||
          (teamId === 'club' ? coversWholeClub(s, allTeamIds) : sessionCoversAnyTeam(s, [teamId])),
      })
    : // Parents get the same lifecycle split with none of the coaching
      // narrowings: their schedule is their team's next nights, and Past is
      // there when they want to look back at one. It does not go through
      // applyEventFilter (there is no kind, team or ownership narrowing to
      // apply), so it orders through the shared seam explicitly rather than
      // reading in whatever order the query returned.
      orderEventsForScope(
        (hasTeam && parentScope === 'team' ? sessions.filter(teamScoped) : sessions).filter((s) =>
          matchesLifecycleScope(s, filter.scope, now),
        ),
        filter.scope,
      )
  // Whether the club holds any finished session AT ALL, measured before
  // any narrowing. This is the one question "no sessions have finished
  // yet" is allowed to answer: a Past view emptied by a kind, team or
  // ownership filter is a filtered view, not an empty history, and telling
  // a coach their club has never trained would be plainly wrong on a
  // screen that had just hidden last Tuesday behind a chip.
  const pastExists = sessions.some((s) => matchesLifecycleScope(s, 'past', now))

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Sessions</h1>
          <div className="sub">
            {canPlan
              ? `Training coming up across the club, including today's after it has finished. All events widens to fixtures, galas and the rest; ${LIFECYCLE_SCOPE_LABELS.past} holds earlier days.`
              : hasTeam
                ? "Your team's training nights."
                : 'Training nights across the club.'}
          </div>
        </div>
        {canPlan && (
          <button className="btn btn-primary" onClick={() => nav('planner')}>
            <Icon.plus />
            New session
          </button>
        )}
      </div>

      {!canPlan && !hasTeam && <NoTeamNote />}

      <div className="filter-row" style={{ marginBottom: 18 }}>
        {canPlan ? (
          <>
            <Chip on={filter.kind === 'training'} onClick={() => setFilter((f) => ({ ...f, kind: 'training' }))}>
              {TRAINING_LABEL}
            </Chip>
            <Chip on={filter.kind === 'all'} onClick={() => setFilter((f) => ({ ...f, kind: 'all' }))}>
              {ALL_EVENTS_LABEL}
            </Chip>
          </>
        ) : (
          showParentToggle && (
            <>
              <Chip on={parentScope === 'team'} onClick={() => setParentScope('team')}>
                {teamChipLabel}
              </Chip>
              <Chip on={parentScope === 'club'} onClick={() => setParentScope('club')}>
                All club
              </Chip>
            </>
          )
        )}
        {/* The lifecycle split, second: what kind of night, then whether it
            has happened. Everyone gets it, coach and parent alike, because
            looking back at a session is not a coaching affordance. */}
        <Chip on={filter.scope === 'upcoming'} onClick={() => setFilter((f) => ({ ...f, scope: 'upcoming' }))}>
          {LIFECYCLE_SCOPE_LABELS.upcoming}
        </Chip>
        <Chip on={filter.scope === 'past'} onClick={() => setFilter((f) => ({ ...f, scope: 'past' }))}>
          {LIFECYCLE_SCOPE_LABELS.past}
        </Chip>
        {canPlan && (
          <>
            <select className="select" value={teamId} onChange={(e) => setTeamId(e.target.value)} style={{ height: 40 }}>
              <option value="">All teams</option>
              <option value="club">Club</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            {/* Ownership, deliberately last and off by default. */}
            <Chip on={filter.mine} onClick={() => setFilter((f) => ({ ...f, mine: !f.mine }))}>
              Mine
            </Chip>
          </>
        )}
      </div>

      {/* Coaches can start a session from a synced Spond event. Hidden when
          there is nothing to suggest, so it adds no empty card here. */}
      <PlanFromSpond hideWhenEmpty />

      {list.length === 0 ? (
        <Empty
          icon={Icon.calendar}
          title={filter.scope === 'past' ? 'Nothing in the past here' : 'No sessions here yet'}
        >
          {/* An empty club, a filter that matched nothing and a club with
              no history at all look identical on screen and need three
              different answers. Which one is true is decided in
              ../lib/sessionEmptyState, where every combination is testable;
              a static render cannot vary a chosen team or a pressed Mine
              chip, so assembling this sentence here left it unreachable.
              The parent's widening is All club rather than the coach's
              filters, so their two lines stay beside the toggle they name. */}
          {canPlan
            ? emptyEventListNote({
                anySessions: sessions.length > 0,
                anyPast: pastExists,
                scope: filter.scope,
                kind: filter.kind,
                team: !!teamId,
                mine: filter.mine,
              })
            : filter.scope === 'past' && !pastExists
              ? NO_PAST_SESSIONS_NOTE
              : hasTeam && parentScope === 'team'
                ? `Nothing ${filter.scope === 'past' ? 'in the past' : 'scheduled'} for your team. Tap All club to see the whole club.`
                : filter.scope === 'past'
                  ? 'Nothing in the past on the club calendar.'
                  : 'Nothing on the club calendar yet.'}
        </Empty>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(330px,1fr))', gap: 18 }}>
          {list.map((s) => {
            const mine = s.coachId === user?.id
            return (
              <SessionCard
                key={s.id}
                s={s}
                nav={nav}
                ownerName={mine ? null : memberById[s.coachId]?.fullName || (s.coachId ? 'Another coach' : 'Club session')}
                teamName={sessionTeamsLabel(s, teamById)}
                venueName={venueNameOf(s)}
                canManage={caps.has('sessions.manage') || (canPlan && mine)}
                coaching={canPlan}
                ended={isSessionEndedToday(s, now)}
                onDelete={() => setDeleting(s)}
              />
            )
          })}
        </div>
      )}

      {deleting && <DeleteSessionModal s={deleting} onClose={() => setDeleting(null)} />}
    </div>
  )
}
