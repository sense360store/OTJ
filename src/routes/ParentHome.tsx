// The parent Home: a development window on the team. Parents organise life in
// Spond; here the Hub answers three questions, what is the team working on,
// what did they practice last, and how can we support it at home. Everything
// is read only, club wide content narrowed to the parent's team(s) through
// member_teams (or the all teams flag). Nothing per child exists in this app
// and nothing here changes that: no attendance, no responses, no child data.
//
// The screen splits into a presentational ParentDashboard, which renders the
// five sections from plain props, and a ParentHome container that resolves
// the team scope and the session and drill data and feeds it in. The split
// keeps the dashboard testable with the static renderer, the same style as
// the rest of the suite.
import type { ReactNode } from 'react'
import { useNav } from '../hooks/useNav'
import { useAuth } from '../hooks/useAuth'
import {
  useDrillMap,
  useDrills,
  useMediaMap,
  useMyTeams,
  useProgrammeMap,
  useTeamMap,
} from '../lib/queries'
import { useSessions } from '../context/SessionsContext'
import { isSampleMedia, memberTeamIds } from '../lib/data'
import type { Drill, Session } from '../lib/data'
import { Icon } from '../components/icons'
import type { IconComponent } from '../components/icons'
import { DrillCard, ErrorNote, fmtDate, Loading } from '../components/ui'
import './ParentHome.css'

// ---- Presentational shapes ------------------------------------------------

export interface ParentSessionView {
  id: string
  name: string
  // The date split for the small calendar block: Sat and 14.
  dow: string
  day: string
  time: string
  venue: string
  teamLabel: string
  focus: string
  intentions: string[]
}

export interface LastSessionView {
  focus: string
  dateLabel: string
  intentions: string[]
  drills: Drill[]
}

export interface ParentProgrammeContext {
  name: string
  week: number | null
  weeks: number
  intentions: string[]
}

// An at home suggestion drawn from a recent drill: a make it easier adaptation
// to try, or a video to watch together. Never framed as homework.
export interface PracticeSuggestion {
  drillId: string
  drillTitle: string
  kind: 'easier' | 'video'
  text: string
}

// ---- Section primitives ---------------------------------------------------

// A card section in the dashboard, styled like the Account screen's section
// cards: a titled card with an optional one line sub.
function Section({
  icon: Ico,
  title,
  sub,
  children,
}: {
  icon: IconComponent
  title: string
  sub?: string
  children: ReactNode
}) {
  return (
    <section className="card parent-section">
      <div className="section-title" style={{ margin: 0 }}>
        <Ico />
        <h3>{title}</h3>
      </div>
      {sub && <p className="parent-section-sub muted">{sub}</p>}
      {children}
    </section>
  )
}

function IntentionPills({ intentions }: { intentions: string[] }) {
  if (intentions.length === 0) return null
  return (
    <div className="row wrap" style={{ gap: 6 }}>
      {intentions.map((x, i) => (
        <span className="pill" key={i}>
          {x}
        </span>
      ))}
    </div>
  )
}

// The gentle note a parent with no team assignment sees above club wide
// content. The fix is an admin action, so the note points there. Shared with
// the Sessions schedule, which scopes to the same member_teams.
export function NoTeamNote() {
  return (
    <div className="parent-note">
      <Icon.flag />
      <div>
        <b>No team set yet</b>
        <p>
          Ask a club admin to add you to your child's team and this page will focus on their sessions. For now, here is
          what is happening across the club.
        </p>
      </div>
    </div>
  )
}

// ---- Sections -------------------------------------------------------------

// 1. This week: the next planned session(s), framed as what the team is
// working on. No attendance counts; responses live in Spond.
function ThisWeekSection({ sessions }: { sessions: ParentSessionView[] }) {
  return (
    <Section icon={Icon.calendar} title="This week" sub="What the team is working on next.">
      <div className="parent-sessions">
        {sessions.map((s) => (
          <div className="psn" key={s.id}>
            <span className="psn-date">
              <span className="psn-dow">{s.dow}</span>
              <span className="psn-day">{s.day}</span>
            </span>
            <span className="psn-body">
              <b>{s.name}</b>
              <span className="psn-meta">
                {s.time && (
                  <span className="pill">
                    <Icon.clock />
                    {s.time}
                  </span>
                )}
                {s.venue && (
                  <span className="pill">
                    <Icon.pin />
                    {s.venue}
                  </span>
                )}
                <span className="pill">
                  <Icon.flag />
                  {s.teamLabel}
                </span>
              </span>
              {s.focus && <span className="psn-focus">{s.focus}</span>}
              {s.intentions.length > 0 && (
                <span style={{ marginTop: 6 }}>
                  <IntentionPills intentions={s.intentions} />
                </span>
              )}
            </span>
          </div>
        ))}
      </div>
    </Section>
  )
}

// 2. Last session: the most recent past session, its focus and intentions and
// the drills covered as cards. Tapping a drill opens the drill detail.
function LastSessionSection({
  view,
  onOpenDrill,
}: {
  view: LastSessionView
  onOpenDrill: (drillId: string) => void
}) {
  return (
    <Section
      icon={Icon.whistle}
      title="Last session"
      sub={view.dateLabel ? `What the team practised on ${view.dateLabel}.` : 'What the team practised last.'}
    >
      {view.focus && <div className="parent-focus">{view.focus}</div>}
      {view.intentions.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <IntentionPills intentions={view.intentions} />
        </div>
      )}
      {view.drills.length > 0 ? (
        <div className="grid-drills">
          {view.drills.map((d) => (
            <DrillCard key={d.id} drill={d} onClick={() => onOpenDrill(d.id)} />
          ))}
        </div>
      ) : (
        <p className="muted" style={{ fontSize: 13.5, margin: 0 }}>
          This session's drills are not in the library.
        </p>
      )}
    </Section>
  )
}

// 3. Practice at home: make it easier adaptations and watchable clips from the
// last few sessions, clearly optional and fun. Exported for the render tests.
export function PracticeAtHome({
  suggestions,
  onOpenDrill,
}: {
  suggestions: PracticeSuggestion[]
  onOpenDrill: (drillId: string) => void
}) {
  if (suggestions.length === 0) return null
  return (
    <Section
      icon={Icon.home}
      title="Practice at home"
      sub="Optional and fun, never homework. A few easy ways to keep the ball rolling."
    >
      <div className="practice-list">
        {suggestions.map((s, i) => (
          <button className="practice-row" key={i} onClick={() => onOpenDrill(s.drillId)}>
            <span className="practice-ico">{s.kind === 'video' ? <Icon.play /> : <Icon.star />}</span>
            <span className="practice-body">
              <span className="practice-text">{s.text}</span>
              <span className="practice-from">
                {s.kind === 'video' ? 'Watch together' : 'Make it easier'} · {s.drillTitle}
              </span>
            </span>
            <Icon.chevR style={{ width: 16, height: 16, color: 'var(--slate-2)', flex: '0 0 16px' }} />
          </button>
        ))}
      </div>
    </Section>
  )
}

// 4. Programme context: shown only when the team's recent sessions belong to a
// programme. Week N of 6, the programme name and its intentions.
function ProgrammeSection({ ctx }: { ctx: ParentProgrammeContext }) {
  const title = ctx.week != null ? `Week ${ctx.week} of ${ctx.weeks}` : ctx.name
  const sub = ctx.week != null ? ctx.name : undefined
  return (
    <Section icon={Icon.list} title={title} sub={sub}>
      {ctx.intentions.length > 0 ? (
        <IntentionPills intentions={ctx.intentions} />
      ) : (
        <p className="muted" style={{ fontSize: 13.5, margin: 0 }}>
          Part of the {ctx.name} programme.
        </p>
      )}
    </Section>
  )
}

// 5. Positive support: the club's touchline values. Static and warm, the same
// card styling as the rest.
const TOUCHLINE_VALUES = [
  'Cheer effort, not just goals.',
  'Applaud both teams, theirs and ours.',
  'Let the coach coach and the referee referee.',
  'On the way home, ask: did you have fun?',
]

function PositiveSupport() {
  return (
    <Section icon={Icon.handshake} title="On the touchline" sub="A few reminders that make match day better for everyone.">
      <ul className="touchline">
        {TOUCHLINE_VALUES.map((v) => (
          <li key={v}>
            <span className="touchline-dot" />
            <span>{v}</span>
          </li>
        ))}
      </ul>
    </Section>
  )
}

// ---- The dashboard --------------------------------------------------------

export interface ParentDashboardProps {
  firstName?: string
  noTeam: boolean
  thisWeek: ParentSessionView[]
  lastSession: LastSessionView | null
  practice: PracticeSuggestion[]
  programme: ParentProgrammeContext | null
  onOpenDrill: (drillId: string) => void
}

export function ParentDashboard({
  firstName,
  noTeam,
  thisWeek,
  lastSession,
  practice,
  programme,
  onOpenDrill,
}: ParentDashboardProps) {
  const now = new Date()
  const todayLine =
    now.toLocaleDateString('en-GB', { weekday: 'long' }) +
    ' · ' +
    now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  const hasContent = thisWeek.length > 0 || !!lastSession

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="eyebrow">{todayLine}</div>
          <h2 style={{ marginTop: 4 }}>Welcome{firstName ? `, ${firstName}` : ''}</h2>
          <div className="sub">How the team is developing, and a few ways to support it at home.</div>
        </div>
      </div>

      {noTeam && <NoTeamNote />}

      {hasContent ? (
        <>
          {thisWeek.length > 0 && <ThisWeekSection sessions={thisWeek} />}
          {lastSession && <LastSessionSection view={lastSession} onOpenDrill={onOpenDrill} />}
          <PracticeAtHome suggestions={practice} onOpenDrill={onOpenDrill} />
          {programme && <ProgrammeSection ctx={programme} />}
        </>
      ) : (
        <Section icon={Icon.calendar} title="No sessions yet">
          <p className="muted" style={{ margin: 0, fontSize: 14 }}>
            When a coach plans the team's next training night it appears here, with what they are working on and how you
            can support it at home.
          </p>
        </Section>
      )}

      <PositiveSupport />
    </div>
  )
}

// ---- Container ------------------------------------------------------------

function toIso(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

export function ParentHome() {
  const nav = useNav()
  const { profile } = useAuth()
  const { sessions, loading: sessionsLoading, error: sessionsError } = useSessions()
  const { data: myTeams, isLoading: teamsLoading, isError: teamsError } = useMyTeams()
  const { isLoading: drillsLoading, isError: drillsError } = useDrills()
  const drillById = useDrillMap()
  const mediaById = useMediaMap()
  const programmeById = useProgrammeMap()
  const teamById = useTeamMap()

  if (sessionsLoading || teamsLoading || drillsLoading) return <Loading />
  if (sessionsError || teamsError || drillsError) return <ErrorNote />

  const firstName = profile?.full_name?.split(' ')[0]

  // Team scope: the member's teams, or every team while the all teams flag is
  // on, or none at all. With no team the dashboard shows club wide content
  // and a note. Teams gate no access; this only narrows the view.
  const scope = myTeams ?? { teamIds: [], allTeams: false }
  const allTeamIds = Object.keys(teamById)
  const effectiveIds = memberTeamIds(scope, allTeamIds)
  const hasTeam = scope.allTeams || scope.teamIds.length > 0

  // A session is in scope when it belongs to one of the member's teams, or it
  // is a club session (no team, shared with everyone). With no team set, every
  // session is in scope.
  const inScope = (s: Session) => {
    if (!hasTeam) return true
    if (s.teamId == null) return true
    return effectiveIds.includes(s.teamId)
  }
  const relevant = sessions.filter(inScope)

  const todayStr = toIso(new Date())
  const isUpcoming = (s: Session) => s.status === 'upcoming' && !!s.date && s.date >= todayStr
  const isPast = (s: Session) => !isUpcoming(s) && !!s.date && (s.date < todayStr || s.status === 'completed')
  // The sessions read is ordered ascending by date and time, so upcoming runs
  // soonest first and the last past entry is the most recent.
  const upcoming = relevant.filter(isUpcoming)
  const past = relevant.filter(isPast)
  const lastRow = past.length ? past[past.length - 1] : null

  const teamLabel = (s: Session) => (s.teamId ? (teamById[s.teamId]?.name ?? 'Team') : 'Club')

  const thisWeek: ParentSessionView[] = upcoming.slice(0, 3).map((s) => {
    const d = new Date(s.date + 'T00:00:00')
    return {
      id: s.id,
      name: s.name,
      dow: d.toLocaleDateString('en-GB', { weekday: 'short' }),
      day: String(d.getDate()),
      time: s.time,
      venue: s.venue,
      teamLabel: teamLabel(s),
      focus: s.focus,
      intentions: s.intentions,
    }
  })

  // The drills of a session, resolved and de-duplicated in session order.
  const drillsOf = (s: Session, seen = new Set<string>()): Drill[] =>
    s.activities.flatMap((a) => {
      if (!a.drillId) return []
      const d = drillById[a.drillId]
      if (!d || seen.has(d.id)) return []
      seen.add(d.id)
      return [d]
    })

  const lastSession: LastSessionView | null = lastRow
    ? {
        focus: lastRow.focus,
        dateLabel: fmtDate(lastRow.date),
        intentions: lastRow.intentions,
        drills: drillsOf(lastRow),
      }
    : null

  // Practice at home draws from the last few sessions' drills, most recent
  // first: each make it easier adaptation, and a watch together prompt for any
  // drill backed by a real video. Capped so the list stays a few ideas, not a
  // syllabus.
  const recentPast = past.slice(-3).reverse()
  const recentDrills: Drill[] = []
  const seenDrill = new Set<string>()
  for (const s of recentPast) {
    for (const d of drillsOf(s, seenDrill)) recentDrills.push(d)
  }
  const suggestions: PracticeSuggestion[] = []
  for (const d of recentDrills) {
    for (const easier of d.easier) {
      suggestions.push({ drillId: d.id, drillTitle: d.title, kind: 'easier', text: easier })
    }
    const media = d.mediaId ? mediaById[d.mediaId] : undefined
    if (media && !isSampleMedia(media) && (media.type === 'video' || media.type === 'youtube')) {
      suggestions.push({
        drillId: d.id,
        drillTitle: d.title,
        kind: 'video',
        text: 'Watch the clip together, then have a go in the garden or park.',
      })
    }
  }
  const practice = suggestions.slice(0, 6)

  // Programme context comes from the most relevant recent session that belongs
  // to a programme: the last session first, then the next planned one, then
  // any earlier session.
  const progSource =
    (lastRow?.programmeId ? lastRow : null) ??
    upcoming.find((s) => s.programmeId) ??
    [...past].reverse().find((s) => s.programmeId) ??
    null
  let programme: ParentProgrammeContext | null = null
  if (progSource?.programmeId) {
    const p = programmeById[progSource.programmeId]
    if (p) {
      programme = { name: p.name, week: progSource.programmeWeek, weeks: p.weeks, intentions: p.intentions }
    }
  }

  return (
    <ParentDashboard
      firstName={firstName}
      noTeam={!hasTeam}
      thisWeek={thisWeek}
      lastSession={lastSession}
      practice={practice}
      programme={programme}
      onOpenDrill={(drillId) => nav('drill', { drillId })}
    />
  )
}
