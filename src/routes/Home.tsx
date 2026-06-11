// The Home dashboard: schedule-first, action-first. The hero is the next
// session (the signed-in coach's own; the club's next for a parent), This
// week lists the coming seven days' club sessions, the quick actions row
// carries the everyday starts, and What's new shows the latest drills and
// templates. A number only rides inside a card that does something; there
// are no standalone stat tiles. The corner distribution moved to the Drill
// Library as a filter-aware strip.
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useNav } from '../hooks/useNav'
import { useSessions } from '../context/SessionsContext'
import { useAuth } from '../hooks/useAuth'
import { useDrillMap, useDrills, useMediaMap, useMemberMap, useTeamMap, useTemplates } from '../lib/queries'
import { sessionMinutes } from '../lib/data'
import type { Session, Template } from '../lib/data'
import { Icon } from '../components/icons'
import type { IconComponent } from '../components/icons'
import { Chip, DrillCard, Empty, ErrorNote, Loading, MediaThumb } from '../components/ui'
import { DrillFormModal } from '../components/DrillFormModal'
import { ImportFAModal } from '../components/ImportFAModal'
import { UploadModal } from './Media'
import './Home.css'

type Nav = ReturnType<typeof useNav>

const GHOST_ON_NAVY = {
  background: 'rgba(255,255,255,.12)',
  color: '#fff',
  borderColor: 'rgba(255,255,255,.25)',
} as const

function toIso(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return toIso(d)
}

// Calendar-day countdown phrasing for the hero.
function countdownLabel(dateStr: string, todayStr: string): string {
  const target = new Date(dateStr + 'T00:00:00')
  const today = new Date(todayStr + 'T00:00:00')
  const days = Math.round((target.getTime() - today.getTime()) / 86400000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  return `In ${days} days`
}

function NextSessionHero({
  s,
  isOwn,
  canManage,
  teamName,
  todayStr,
  nav,
}: {
  s: Session
  isOwn: boolean
  canManage: boolean
  teamName: string
  todayStr: string
  nav: Nav
}) {
  const mins = sessionMinutes(s)
  const dayStr = new Date(s.date + 'T00:00:00').toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
  const live = s.liveActivityIndex != null
  return (
    <div className="hero">
      <div className="eyebrow">
        {isOwn ? 'Your next session' : 'Next club session'} · {live ? 'Live now' : countdownLabel(s.date, todayStr)}
      </div>
      <h2>{s.name}</h2>
      {s.focus && <div style={{ fontWeight: 700, color: 'var(--gold)', fontSize: 15 }}>{s.focus}</div>}
      <div className="hero-meta">
        <span className="row">
          <Icon.calendar />
          {dayStr}
        </span>
        <span className="row">
          <Icon.clock />
          {s.time}
          {mins ? ` · ${mins} min` : ''}
        </span>
        {s.venue && (
          <span className="row">
            <Icon.pin />
            {s.venue}
          </span>
        )}
        <span className="row">
          <Icon.flag />
          {teamName}
        </span>
      </div>
      <div className="hero-acts">
        <button className="btn btn-gold btn-lg" onClick={() => nav('sessionDay', { sessionId: s.id })}>
          <Icon.cone />
          Session day
        </button>
        <button className="btn btn-ghost btn-lg" style={GHOST_ON_NAVY} onClick={() => nav('live', { sessionId: s.id })}>
          {canManage && !live ? <Icon.play /> : <Icon.eye />}
          Live
        </button>
        {canManage && (
          <button
            className="btn btn-ghost btn-lg"
            style={GHOST_ON_NAVY}
            onClick={() => nav('planner', { sessionId: s.id })}
          >
            <Icon.edit />
            Edit
          </button>
        )}
      </div>
    </div>
  )
}

// The hero when nothing is scheduled. A brand-new coach gets first steps as
// real links instead of zeros; a parent gets the schedule framing.
function EmptyHero({
  coaching,
  fresh,
  nav,
  onImport,
}: {
  coaching: boolean
  fresh: boolean
  nav: Nav
  onImport: () => void
}) {
  if (!coaching) {
    return (
      <div className="hero">
        <div className="eyebrow">The club schedule</div>
        <h2>No upcoming sessions</h2>
        <p className="hero-sub">
          When a coach plans the next training night it appears here with the day's details. Live sessions can be
          watched from here as they run.
        </p>
      </div>
    )
  }
  return (
    <div className="hero">
      <div className="eyebrow">Your next session</div>
      <h2>{fresh ? 'Welcome to the Training Hub' : 'Nothing scheduled yet'}</h2>
      <p className="hero-sub">
        {fresh
          ? 'Start by planning your first session, or look around the club library first.'
          : 'Plan your next session and it lands here with a countdown and the day plan.'}
      </p>
      <div className="hero-acts">
        <button className="btn btn-gold btn-lg" onClick={() => nav('planner')}>
          <Icon.plus />
          {fresh ? 'Plan your first session' : 'Plan a session'}
        </button>
        {fresh && (
          <>
            <button className="btn btn-ghost btn-lg" style={GHOST_ON_NAVY} onClick={() => nav('library')}>
              <Icon.grid />
              Browse the drill library
            </button>
            <button className="btn btn-ghost btn-lg" style={GHOST_ON_NAVY} onClick={onImport}>
              <Icon.download />
              Import an FA session
            </button>
          </>
        )}
      </div>
    </div>
  )
}

function WeekRow({ s, teamName, ownerName, nav }: { s: Session; teamName: string; ownerName: string | null; nav: Nav }) {
  const d = new Date(s.date + 'T00:00:00')
  return (
    <button className="week-row" onClick={() => nav('sessionDay', { sessionId: s.id })}>
      <span className="ww">
        <span className="ww-day">{d.toLocaleDateString('en-GB', { weekday: 'short' })}</span>
        <span className="ww-num">{d.getDate()}</span>
      </span>
      <span className="week-body">
        <b>{s.name}</b>
        <span className="week-meta">
          <span className="pill">
            <Icon.clock />
            {s.time}
          </span>
          <span className="pill">
            <Icon.flag />
            {teamName}
          </span>
          {ownerName && (
            <span className="pill">
              <Icon.user />
              {ownerName}
            </span>
          )}
        </span>
      </span>
      <Icon.chevR style={{ width: 16, height: 16, color: 'var(--slate-2)', flex: '0 0 16px' }} />
    </button>
  )
}

function TemplateMiniCard({ t, onClick }: { t: Template; onClick: () => void }) {
  const drillById = useDrillMap()
  const mediaById = useMediaMap()
  const mins = t.activities.reduce((a, x) => a + (x.duration || 0), 0)
  // The thumbnail borrows the first activity that resolves to a drill with
  // media, the same art the template opens onto.
  const mediaId = t.activities.map((a) => (a.drillId ? drillById[a.drillId]?.mediaId : null)).find((id) => !!id)
  const media = mediaId ? mediaById[mediaId] : undefined
  return (
    <div className="drill-card" onClick={onClick}>
      <div className="dc-corner-strip" style={{ background: 'var(--gold)' }}></div>
      <div style={{ padding: 0 }}>
        {media ? (
          <MediaThumb media={media} showBadge={false} showPlay={false} />
        ) : (
          <div className="thumb thumb-diagram">
            <Icon.book style={{ width: 30, height: 30, color: 'var(--slate-2)' }} />
          </div>
        )}
      </div>
      <div className="dc-body">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="tag" style={{ color: 'var(--gold-600)', background: 'var(--gold-soft)' }}>
            <Icon.book style={{ width: 12, height: 12 }} />
            Template
          </span>
          <span className="pill">
            <Icon.clock />
            {mins}m
          </span>
        </div>
        <h3>{t.name}</h3>
        <p
          className="muted"
          style={{
            fontSize: 13,
            lineHeight: 1.45,
            margin: 0,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {t.focus}
        </p>
        <div className="dc-meta">
          <span className="pill">
            <Icon.list />
            {t.activities.length} activities
          </span>
          {t.week != null && <span className="pill">Week {t.week}</span>}
        </div>
      </div>
    </div>
  )
}

interface QuickAction {
  label: string
  icon: IconComponent
  live?: boolean
  on: () => void
}

export function Home() {
  const nav = useNav()
  const navigate = useNavigate()
  const { sessions, loading: sessionsLoading, error: sessionsError } = useSessions()
  const { data: drills = [], isLoading: drillsLoading, isError: drillsError } = useDrills()
  const { data: templates = [], isLoading: templatesLoading, isError: templatesError } = useTemplates()
  const { user, profile, role } = useAuth()
  const teamById = useTeamMap()
  const memberById = useMemberMap()
  // The This week list honours the Sessions screen's default: yours first,
  // one tap to the whole club.
  const [weekView, setWeekView] = useState<'mine' | 'all'>('mine')
  const [addOpen, setAddOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [uploadOpen, setUploadOpen] = useState(false)

  const firstName = profile?.full_name?.split(' ')[0]
  // Parents are read-only; the planning and creating affordances stay hidden
  // for them. The check is positive so nothing flashes in while loading.
  const coaching = role === 'coach' || role === 'admin'

  if (sessionsLoading || drillsLoading || templatesLoading) return <Loading />
  if (sessionsError || drillsError || templatesError) return <ErrorNote />

  const now = new Date()
  const todayLine =
    now.toLocaleDateString('en-GB', { weekday: 'long' }) +
    ' · ' +
    now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  const todayStr = toIso(now)

  const isMine = (s: Session) => s.coachId === user?.id
  // The sessions read is club-wide and ordered by date and time; upcoming
  // keeps today's sessions all day so the hero holds while one runs.
  const upcoming = sessions.filter((s) => s.status === 'upcoming' && s.date >= todayStr)
  const next = coaching ? upcoming.find(isMine) : upcoming[0]
  const liveNow = sessions.find((s) => s.liveActivityIndex != null)
  // A brand-new coach has no sessions at all, upcoming or past.
  const fresh = coaching && !sessions.some(isMine)

  const weekEnd = addDaysIso(todayStr, 7)
  const weekAll = upcoming.filter((s) => s.date < weekEnd)
  const effWeekView = coaching ? weekView : 'all'
  const week = effWeekView === 'mine' ? weekAll.filter(isMine) : weekAll

  const teamName = (s: Session) => (s.teamId ? (teamById[s.teamId]?.name ?? 'Team') : 'Club')

  // The latest drills and templates together, newest first.
  const whatsNew = [
    ...drills.map((d) => ({ kind: 'drill' as const, when: d.createdAt, drill: d })),
    ...templates.map((t) => ({ kind: 'template' as const, when: t.createdAt, template: t })),
  ]
    .sort((a, b) => (a.when < b.when ? 1 : -1))
    .slice(0, 6)

  const actions: QuickAction[] = []
  if (coaching) {
    actions.push({ label: 'Plan session', icon: Icon.layers, on: () => nav('planner') })
    actions.push({ label: 'Add drill', icon: Icon.plus, on: () => setAddOpen(true) })
    actions.push({ label: 'Import from England Football', icon: Icon.download, on: () => setImportOpen(true) })
    actions.push({ label: 'Upload media', icon: Icon.upload, on: () => setUploadOpen(true) })
    if (role === 'admin') {
      actions.push({ label: 'Invite', icon: Icon.users, on: () => navigate('/admin/users') })
    }
  } else if (liveNow) {
    actions.push({
      label: 'Watch live',
      icon: Icon.play,
      live: true,
      on: () => nav('live', { sessionId: liveNow.id }),
    })
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="eyebrow">{todayLine}</div>
          <h2 style={{ marginTop: 4 }}>Welcome back{firstName ? `, ${firstName}` : ''}</h2>
          <div className="sub">
            {coaching
              ? 'Your schedule first, then everything you need for the next session.'
              : "The club schedule and the latest from the club's coaches."}
          </div>
        </div>
      </div>

      <div className="home-top">
        {next ? (
          <NextSessionHero
            s={next}
            isOwn={isMine(next)}
            canManage={(coaching && isMine(next)) || role === 'admin'}
            teamName={teamName(next)}
            todayStr={todayStr}
            nav={nav}
          />
        ) : (
          <EmptyHero coaching={coaching} fresh={fresh} nav={nav} onImport={() => setImportOpen(true)} />
        )}

        <div className="card week-card">
          <div className="week-head">
            <h3>This week</h3>
            <span className="pill">
              <Icon.calendar />
              {week.length} session{week.length !== 1 ? 's' : ''}
            </span>
            {coaching && (
              <>
                <Chip on={weekView === 'mine'} onClick={() => setWeekView('mine')}>
                  Mine
                </Chip>
                <Chip on={weekView === 'all'} onClick={() => setWeekView('all')}>
                  All
                </Chip>
              </>
            )}
          </div>
          <div className="week-list">
            {week.length === 0 ? (
              <div className="week-empty">
                {effWeekView === 'mine'
                  ? 'Nothing of yours in the next seven days. Tap All for the whole club.'
                  : 'Nothing on the club calendar in the next seven days.'}
              </div>
            ) : (
              week.map((s) => (
                <WeekRow
                  key={s.id}
                  s={s}
                  teamName={teamName(s)}
                  ownerName={isMine(s) ? null : memberById[s.coachId]?.fullName || (s.coachId ? 'Another coach' : 'Club session')}
                  nav={nav}
                />
              ))
            )}
          </div>
          <div className="week-foot">
            <button className="btn btn-quiet" onClick={() => nav('sessions')}>
              View all sessions
              <Icon.arrowRight />
            </button>
          </div>
        </div>
      </div>

      {actions.length > 0 && (
        <div className="qa-grid">
          {actions.map((a) => (
            <button key={a.label} className={'qa-btn' + (a.live ? ' qa-live' : '')} onClick={a.on}>
              <span className="qa-ico">
                <a.icon />
              </span>
              {a.label}
            </button>
          ))}
        </div>
      )}

      <div className="spread" style={{ marginBottom: 14 }}>
        <div className="section-title" style={{ margin: 0 }}>
          <Icon.sparkle />
          <h3>What's new at the club</h3>
        </div>
        <button className="btn btn-quiet btn-sm" onClick={() => nav('library')}>
          View library
          <Icon.arrowRight />
        </button>
      </div>
      {whatsNew.length === 0 ? (
        <Empty icon={Icon.sparkle} title="Nothing here yet">
          {coaching
            ? 'Add a drill or import an FA session and the newest content lands here.'
            : 'The latest drills and session templates land here as coaches add them.'}
        </Empty>
      ) : (
        <div className="grid-drills">
          {whatsNew.map((item) =>
            item.kind === 'drill' ? (
              <DrillCard
                key={'d' + item.drill.id}
                drill={item.drill}
                onClick={() => nav('drill', { drillId: item.drill.id })}
              />
            ) : (
              <TemplateMiniCard key={'t' + item.template.id} t={item.template} onClick={() => nav('templates')} />
            ),
          )}
        </div>
      )}

      {addOpen && <DrillFormModal onClose={() => setAddOpen(false)} />}
      {importOpen && <ImportFAModal onClose={() => setImportOpen(false)} />}
      {uploadOpen && <UploadModal onClose={() => setUploadOpen(false)} />}
    </div>
  )
}
