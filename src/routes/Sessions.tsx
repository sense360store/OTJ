// The club calendar of sessions. Visibility is club-wide: every coach sees
// every club session. Whose sessions you are looking at is a view filter that
// defaults to your own, and team narrows further. Edit and delete follow
// ownership (own, or admin); other coaches' sessions render read-only with
// the owner's name. The sessions RLS enforces the same rules on write.
import { useState } from 'react'
import { ALL_EVENTS_LABEL, TRAINING_LABEL } from '../lib/eventKind'
import { applyEventFilter, DEFAULT_EVENT_FILTER, type EventFilterState } from '../lib/eventFilter'
import { useNav } from '../hooks/useNav'
import { useAuth } from '../hooks/useAuth'
import { useSessions } from '../context/SessionsContext'
import {
  useMemberMap,
  useMyCapabilities,
  useMyTeams,
  useSpondEventLookup,
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
  onDelete,
}: {
  s: Session
  nav: Nav
  ownerName: string | null
  teamName: string | null
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
          </div>
          <h3 style={{ fontSize: 19 }}>{s.name}</h3>
          <div style={{ color: 'var(--gold-600)', fontWeight: 700, fontSize: 14, marginTop: 2 }}>{s.focus}</div>
        </div>
        <div className="avatar" style={{ background: 'var(--bg-2)', color: 'var(--navy)', fontSize: 13 }}>
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
  const spondEvents = useSpondEventLookup(canPlan)
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

  // Training first. The primary split is what KIND of night this is, not who
  // owns the row: a coach opening Sessions is asking what training is
  // happening, so Training is the default and All events is the deliberate
  // widening. Team narrows within that, and Mine is a secondary narrowing that
  // is off by default. Ownership still decides who may edit or delete, which
  // is `canManage` below and a different question entirely.
  //
  // The composition lives in ../lib/eventFilter so Home and the Spond surfaces
  // give the same answer; only the team predicate is local, because it depends
  // on session coverage and the parent scope.
  const allTeamIds = Object.keys(teamById)
  const list = canPlan
    ? applyEventFilter(sessions, filter, {
        userId: user?.id,
        spondEvents,
        teamMatch: (s) =>
          !teamId ||
          (teamId === 'club' ? coversWholeClub(s, allTeamIds) : sessionCoversAnyTeam(s, [teamId])),
      })
    : hasTeam && parentScope === 'team'
      ? sessions.filter(teamScoped)
      : sessions

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Sessions</h2>
          <div className="sub">
            {canPlan
              ? 'Training across the club. All events widens to fixtures, galas and the rest.'
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

      {(canPlan || showParentToggle) && (
        <div className="filter-row" style={{ marginBottom: 18 }}>
          {canPlan ? (
            <>
              <Chip on={filter.kind === 'training'} onClick={() => setFilter((f) => ({ ...f, kind: 'training' }))}>
                {TRAINING_LABEL}
              </Chip>
              <Chip on={filter.kind === 'all'} onClick={() => setFilter((f) => ({ ...f, kind: 'all' }))}>
                {ALL_EVENTS_LABEL}
              </Chip>
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
          ) : (
            <>
              <Chip on={parentScope === 'team'} onClick={() => setParentScope('team')}>
                {teamChipLabel}
              </Chip>
              <Chip on={parentScope === 'club'} onClick={() => setParentScope('club')}>
                All club
              </Chip>
            </>
          )}
        </div>
      )}

      {/* Coaches can start a session from a synced Spond event. Hidden when
          there is nothing to suggest, so it adds no empty card here. */}
      <PlanFromSpond hideWhenEmpty />

      {list.length === 0 ? (
        <Empty icon={Icon.calendar} title="No sessions here yet">
          {/* An empty club and a filter that matched nothing look the same
              on screen and need opposite advice. Pointing a brand new club
              at All events would send them looking for sessions nobody has
              made yet.
              Name only the narrowings actually in effect, the way Home
              does: on the shipped default Mine is already off and no team
              is chosen, so suggesting either is advice that cannot change
              the result. */}
          {canPlan
            ? sessions.length === 0
              ? 'Plan your first session and it will appear here.'
              : [
                  `Nothing matches this filter. Try ${ALL_EVENTS_LABEL}`,
                  teamId ? ', another team' : '',
                  filter.mine ? ', or turn Mine off' : '',
                  '.',
                ].join('')
            : hasTeam && parentScope === 'team'
              ? 'Nothing scheduled for your team yet. Tap All club to see the whole club.'
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
