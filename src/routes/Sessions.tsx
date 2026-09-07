// The club calendar of sessions. Visibility is club-wide: every coach sees
// every club session. Whose sessions you are looking at is a view filter that
// defaults to your own, and team narrows further. Edit and delete follow
// ownership (own, or admin); other coaches' sessions render read-only with
// the owner's name. The sessions RLS enforces the same rules on write.
//
// VISUAL-02 brought it onto the shared system: PageHeader for the heading,
// Button and IconButton for every hand written class string, Card for each
// session, Badge for the one status a card carries, a labelled SelectField
// for the team filter, and the type and spacing scales for everything that
// was an inline size, in Sessions.css. Nothing about what the screen decides
// moved: which rows a capability set sees, which controls it is offered,
// how the parent scope narrows and where each control navigates are exactly
// what they were, and src/routes/sessions.screens.test.tsx pins them
// against the real screen.
import { useState } from 'react'
import { ALL_EVENTS_LABEL, TRAINING_LABEL } from '../lib/eventKind'
import {
  applyEventFilter,
  DEFAULT_EVENT_FILTER,
  type EventFilterState,
  orderEventsForScope,
} from '../lib/eventFilter'
import {
  ENDED_TODAY_LABEL,
  isSessionEndedToday,
  LIFECYCLE_SCOPE_LABELS,
  matchesLifecycleScope,
} from '../lib/sessionLifecycle'
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
import { Badge, Button, Card, IconButton, PageHeader, SelectField } from '../components/primitives'
import { DeleteSessionModal } from '../components/DeleteSessionModal'
import { PlanFromSpond } from '../components/PlanFromSpond'
import { NoTeamNote } from './ParentHome'
import { downloadSessionIcs } from '../lib/ics'
import './Sessions.css'

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
  // The plan bar in words, for a reader who cannot see its phase colours:
  // the same facts the segments draw, in the same order.
  const planLabel = s.activities.map((a) => `${a.phase} ${a.duration} min`).join(', ')
  return (
    <Card className="session-card">
      <div className="sc-head">
        <div className="sc-title">
          <div className="sc-when">
            <span className="pill sc-date">
              <Icon.calendar aria-hidden="true" />
              {fmtDate(s.date)}
            </span>
            <span className="pill">
              <Icon.clock aria-hidden="true" />
              {s.time}
            </span>
            {/* A state of the row is a dot plus a word (2.7), and the same
                Badge and the same words Home's week list carries. */}
            {ended && <Badge>{ENDED_TODAY_LABEL}</Badge>}
          </div>
          {/* The card's heading sits one level under the page's h1. */}
          <h2>{s.name}</h2>
          {s.focus && <p className="sc-focus">{s.focus}</p>}
        </div>
        <span className="avatar sc-age">{s.ageGroup}</span>
      </div>

      <div className="sc-meta">
        {venueName && (
          <span className="pill">
            <Icon.pin aria-hidden="true" />
            {venueName}
          </span>
        )}
        {teamName && (
          <span className="pill">
            <Icon.flag aria-hidden="true" />
            {teamName}
          </span>
        )}
        <span className="pill">
          <Icon.list aria-hidden="true" />
          {s.activities.length} activities
        </span>
        <span className="pill">
          <Icon.clock aria-hidden="true" />
          {mins} min
        </span>
        {ownerName && (
          <span className="pill">
            <Icon.user aria-hidden="true" />
            {ownerName}
          </span>
        )}
      </div>

      {/* The plan at a glance. Each segment's share and hue are the row's
          own data (its minutes and its phase), which is the one inline
          style the card writes, the way a bib swatch writes its colour. */}
      {s.activities.length > 0 && (
        <div className="sc-timeline" role="img" aria-label={`Plan: ${planLabel}`}>
          {s.activities.map((a, i) => (
            <span key={i} title={a.phase} style={{ flex: a.duration, background: PHASE_COLOR[a.phase] }}></span>
          ))}
        </div>
      )}

      <div className="sc-acts">
        <Button variant="primary" icon={Icon.cone} onClick={() => nav('sessionDay', { sessionId: s.id })}>
          Session day
        </Button>
        {/* Driving is owner or admin; everyone else opens the same live view
            as a watcher, so the label says what will happen. */}
        <Button variant="gold" icon={canManage ? Icon.play : Icon.eye} onClick={() => nav('live', { sessionId: s.id })}>
          {canManage ? 'Start' : 'Watch'}
        </Button>
      </div>
      <div className="sc-acts">
        {canManage ? (
          <Button variant="ghost" icon={Icon.edit} onClick={() => nav('planner', { sessionId: s.id })}>
            Edit plan
          </Button>
        ) : coaching ? (
          <Button variant="ghost" icon={Icon.eye} onClick={() => nav('planner', { sessionId: s.id })}>
            View plan
          </Button>
        ) : (
          <span className="sc-spacer"></span>
        )}
        {/* Icon only controls are named by aria-label, never by title, which
            does not survive touch (2.5). `large` gives each the 44px box of
            the buttons beside it. */}
        <IconButton label="Add to calendar" icon={Icon.calendar} large onClick={() => downloadSessionIcs(s, venueName)} />
        {canManage && <IconButton label="Delete session" icon={Icon.trash} tone="danger" large onClick={onDelete} />}
      </div>
    </Card>
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
      <PageHeader
        title="Sessions"
        sub={
          canPlan
            ? `Training coming up across the club, including today's after it has finished. All events widens to fixtures, galas and the rest; ${LIFECYCLE_SCOPE_LABELS.past} holds earlier days.`
            : hasTeam
              ? "Your team's training nights."
              : 'Training nights across the club.'
        }
        actions={
          canPlan && (
            <Button variant="primary" icon={Icon.plus} onClick={() => nav('planner')}>
              New session
            </Button>
          )
        }
      />

      {!canPlan && !hasTeam && <NoTeamNote />}

      <div className="filter-row sessions-filters">
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
            {/* A real <label>, read and not shown: the control's own value
                says which team, and the row is chips rather than a form. */}
            <SelectField
              label="Team"
              labelHidden
              className="field-flush sessions-team"
              value={teamId}
              onChange={(e) => setTeamId(e.target.value)}
            >
              <option value="">All teams</option>
              <option value="club">Club</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </SelectField>
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
        <div className="sessions-grid">
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
