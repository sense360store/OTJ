// The Home route dispatches on the capability set: parents (no sessions.create,
// the coaching write capability) get the development dashboard in ParentHome;
// coaches and admins, and anyone holding both a coaching role and the parent
// role, get the schedule-first CoachHome below.
//
// CoachHome: schedule-first, action-first. The hero is the next session (the
// signed-in coach's own), This week lists the coming seven days' club sessions,
// the quick actions row carries the everyday starts, and What's new shows the
// latest drills and templates. A number only rides inside a card that does
// something; there are no standalone stat tiles. The corner distribution moved
// to the Drill Library as a filter-aware strip.
import { useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useNav } from '../hooks/useNav'
import { useSessions } from '../context/SessionsContext'
import { useAuth } from '../hooks/useAuth'
import {
  useDrillMap,
  useDrills,
  useMediaMap,
  useMemberMap,
  useMyCapabilities,
  useEventKindContext,
  useTeamMap,
  useTemplates,
  useVenueMap,
} from '../lib/queries'
import { FA_IMPORT_CAPS, hasAllCaps, sessionMinutes } from '../lib/data'
import { ALL_EVENTS_LABEL, isTrainingEvent, TRAINING_LABEL } from '../lib/eventKind'
import { applyEventFilter, DEFAULT_EVENT_FILTER, pickNextEvent, type EventFilterState } from '../lib/eventFilter'
import { isSessionActive, isSessionEndedToday, isSessionLive, isSessionOperational } from '../lib/sessionLifecycle'
import { compareNewestFirst } from '../lib/contentOrder'
import type { Session, Template } from '../lib/data'
import { sessionTeamsLabel } from '../lib/sessionTeams'
import { venueNameFor } from '../lib/venues'
import { Icon } from '../components/icons'
import type { IconComponent } from '../components/icons'
import { Chip, DrillCard, Empty, ErrorNote, Loading, MediaThumb } from '../components/ui'
import { DrillFormModal } from '../components/DrillFormModal'
import { ImportFAModal } from '../components/ImportFAModal'
import { UploadModal } from './Media'
import { ParentHome } from './ParentHome'
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
  isTraining,
  canManage,
  teamName,
  venueName,
  todayStr,
  live,
  nav,
}: {
  s: Session
  isOwn: boolean
  // The hero prefers training over a sooner fixture, so the eyebrow says
  // which "next" it means. Calling Tuesday's training "your next session"
  // while a friendly sits between now and it would be a claim the row does
  // not satisfy.
  isTraining: boolean
  canManage: boolean
  teamName: string
  // The resolved venue, empty when unknown. Reading s.venue directly here
  // would show the frozen legacy label and lose the chosen venue entirely.
  venueName: string
  todayStr: string
  // Whether the session is being driven RIGHT NOW, decided by the container
  // through isSessionLive against the render's one moment. Reading
  // s.liveActivityIndex here is what put "Live now" on a June session whose
  // driver never pressed End: the column says somebody once started it, not
  // that anybody is running it. See ../lib/sessionLifecycle.
  live: boolean
  nav: Nav
}) {
  const mins = sessionMinutes(s)
  const dayStr = new Date(s.date + 'T00:00:00').toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
  return (
    <div className="hero">
      <div className="eyebrow">
        {isOwn
          ? isTraining
            ? 'Your next training'
            : 'Your next session'
          : isTraining
            ? 'Next club training'
            : 'Next club session'}{' '}
        · {live ? 'Live now' : countdownLabel(s.date, todayStr)}
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
        {venueName && (
          <span className="row">
            <Icon.pin />
            {venueName}
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

function WeekRow({
  s,
  teamName,
  ownerName,
  ended,
  nav,
}: {
  s: Session
  teamName: string
  ownerName: string | null
  // Finished earlier today. The row stays, and one tap still opens Session
  // Day and Tonight, because the evening's work outlives the session's own
  // end time. It says so rather than sitting silently among the nights
  // still to come.
  ended: boolean
  nav: Nav
}) {
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
          {ended && (
            <span
              className="pill"
              style={{ color: 'var(--gold-600)', background: 'color-mix(in srgb, var(--gold) 16%, transparent)' }}
            >
              Ended earlier today
            </span>
          )}
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

// The coach and admin Home: schedule-first, action-first. Parents are routed
// away to the development dashboard before this renders, so the schedule
// framing here is always a planner's; the capability checks below stay as
// defence in depth.
function CoachHome() {
  const nav = useNav()
  const navigate = useNavigate()
  const { sessions, loading: sessionsLoading, error: sessionsError } = useSessions()
  const { data: drills = [], isLoading: drillsLoading, isError: drillsError } = useDrills()
  const { data: templates = [], isLoading: templatesLoading, isError: templatesError } = useTemplates()
  const { user, profile } = useAuth()
  const { caps } = useMyCapabilities()
  const teamById = useTeamMap()
  const venueById = useVenueMap()
  const memberById = useMemberMap()
  // A session planned from a Spond event carries only the event id, so the
  // classifier needs this to see that the event was a MATCH. Sessions reads
  // the same cache entry; the hero, the week list and the eyebrow all go
  // through it, so this screen cannot answer three ways about one row.
  const kindContext = useEventKindContext()
  // The This week list honours the Sessions screen's default, which is
  // Training across the club. Mine is the secondary narrowing, off unless
  // asked for; the two screens share the constant so they cannot drift.
  const [filter, setFilter] = useState<EventFilterState>(DEFAULT_EVENT_FILTER)
  const [addOpen, setAddOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [uploadOpen, setUploadOpen] = useState(false)

  const firstName = profile?.full_name?.split(' ')[0]
  // The affordances follow the capability set, granting on any held role;
  // members without sessions.create (parents) get the schedule framing. The
  // checks are positive so nothing flashes in while loading.
  const canPlan = caps.has('sessions.create')

  if (sessionsLoading || drillsLoading || templatesLoading) return <Loading />
  if (sessionsError || drillsError || templatesError) return <ErrorNote />

  const now = new Date()
  const todayLine =
    now.toLocaleDateString('en-GB', { weekday: 'long' }) +
    ' · ' +
    now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  const todayStr = toIso(now)

  const isMine = (s: Session) => s.coachId === user?.id
  // The sessions read is club-wide and ordered by date and time. What
  // counts as still to come is the shared lifecycle rule in
  // ../lib/sessionLifecycle, never the stored status and never a date
  // string comparison: a session keeps its place through its own planned
  // duration and for as long as somebody is driving it live, and loses it
  // the moment it has genuinely finished. Yesterday's training does not sit
  // here waiting for a status nobody ever set.
  //
  // TWO SETS, NOT ONE, and conflating them is the same-day regression.
  // `stillToCome` is what may be offered as next: strictly active. `onToday`
  // adds the nights that have already finished but whose local day has not,
  // because a coach opening this at 22:30 is looking for exactly that
  // session and Home is where they look first.
  const stillToCome = sessions.filter((s) => isSessionActive(s, now))
  const onToday = sessions.filter((s) => isSessionOperational(s, now))
  // The hero leads with your own next training, and with the club's when you
  // own none. Leading with ownership alone told a coach who owns no session
  // that nothing was scheduled on a night the club was training; the shared
  // rule in ../lib/eventFilter states the whole preference order. It reads
  // `stillToCome`, so a session that ended three hours ago is never the hero.
  const next = canPlan ? pickNextEvent(stillToCome, user?.id, kindContext, now) : stillToCome[0]
  // A session that finished earlier today is never the hero and is always
  // in the week list below, marked, one tap from Session Day and Tonight.
  // isSessionEndedToday decides the marking at the row.
  // The session being driven right now, if any. The predicate takes the
  // render's one moment, so a marker nobody cleared last June cannot offer a
  // Watch live action for a night that finished two months ago. Written as an
  // arrow rather than passed by reference on purpose: `find(isSessionLive)`
  // hands the callback the ARRAY INDEX as its second argument, which would
  // arrive here as `now`.
  const liveNow = sessions.find((s) => isSessionLive(s, now))
  // A brand-new coach has no sessions at all, upcoming or past.
  const fresh = canPlan && !sessions.some(isMine)

  const weekEnd = addDaysIso(todayStr, 7)
  // Narrowed to what a coach may still act on, so this only closes the far
  // end of the window. Yesterday's training is outside `onToday`, which is
  // the right way round; tonight's finished session is inside it, which is
  // the correction.
  const weekAll = onToday.filter((s) => s.date < weekEnd)
  // Parents get the club's week whole; they own nothing to narrow to and
  // the kind filter is a coach's tool, so their list stays unfiltered.
  const week = canPlan ? applyEventFilter(weekAll, filter, { userId: user?.id, kindContext, now }) : weekAll

  const teamName = (s: Session) => sessionTeamsLabel(s, teamById)
  const venueName = (s: Session) => venueNameFor(s, venueById)

  // The latest drills and templates together, newest first through the same
  // comparator as the content lists, so Home and the Library agree on ties.
  const whatsNew = [
    ...drills.map((d) => ({ kind: 'drill' as const, id: d.id, createdAt: d.createdAt, drill: d })),
    ...templates.map((t) => ({ kind: 'template' as const, id: t.id, createdAt: t.createdAt, template: t })),
  ]
    .sort(compareNewestFirst)
    .slice(0, 6)

  // Each quick action follows the capability that backs it.
  const actions: QuickAction[] = []
  if (canPlan) actions.push({ label: 'Plan session', icon: Icon.layers, on: () => nav('planner') })
  if (caps.has('drills.create')) actions.push({ label: 'Add drill', icon: Icon.plus, on: () => setAddOpen(true) })
  if (hasAllCaps(caps, FA_IMPORT_CAPS)) {
    actions.push({ label: 'Import from England Football', icon: Icon.download, on: () => setImportOpen(true) })
  }
  if (caps.has('media.create')) actions.push({ label: 'Upload media', icon: Icon.upload, on: () => setUploadOpen(true) })
  if (caps.has('users.manage')) {
    actions.push({ label: 'Invite', icon: Icon.users, on: () => navigate('/admin/users') })
  }
  if (actions.length === 0 && liveNow) {
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
            {canPlan
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
            isTraining={isTrainingEvent(next, kindContext)}
            canManage={caps.has('sessions.manage') || (canPlan && isMine(next))}
            teamName={teamName(next)}
            venueName={venueName(next)}
            todayStr={todayStr}
            live={isSessionLive(next, now)}
            nav={nav}
          />
        ) : (
          <EmptyHero coaching={canPlan} fresh={fresh} nav={nav} onImport={() => setImportOpen(true)} />
        )}

        <div className="card week-card">
          <div className="week-head">
            <h3>This week</h3>
            <span className="pill">
              <Icon.calendar />
              {week.length} session{week.length !== 1 ? 's' : ''}
            </span>
            {canPlan && (
              <>
                <Chip on={filter.kind === 'training'} onClick={() => setFilter((f) => ({ ...f, kind: 'training' }))}>
                  {TRAINING_LABEL}
                </Chip>
                <Chip on={filter.kind === 'all'} onClick={() => setFilter((f) => ({ ...f, kind: 'all' }))}>
                  {ALL_EVENTS_LABEL}
                </Chip>
                {/* Ownership, deliberately last and off by default. */}
                <Chip on={filter.mine} onClick={() => setFilter((f) => ({ ...f, mine: !f.mine }))}>
                  Mine
                </Chip>
              </>
            )}
          </div>
          <div className="week-list">
            {week.length === 0 ? (
              <div className="week-empty">
                {!canPlan
                  ? 'Nothing on the club calendar in the next seven days.'
                  : filter.mine
                    ? 'Nothing of yours in the next seven days. Turn Mine off for the whole club.'
                    : filter.kind === 'training'
                      ? `No training in the next seven days. Tap ${ALL_EVENTS_LABEL} for fixtures and the rest.`
                      : 'Nothing on the club calendar in the next seven days.'}
              </div>
            ) : (
              week.map((s) => (
                <WeekRow
                  key={s.id}
                  s={s}
                  teamName={teamName(s)}
                  ownerName={isMine(s) ? null : memberById[s.coachId]?.fullName || (s.coachId ? 'Another coach' : 'Club session')}
                  ended={isSessionEndedToday(s, now)}
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
          {canPlan
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

// The Home dispatch, pulled out as a presentational switch over the capability
// set so the routing is covered by the static renderer. sessions.create is the
// coaching write capability; a member without it is a parent (or any read-only
// member) and gets the development dashboard, everyone else the coach home. A
// member holding both a coaching role and the parent role still holds
// sessions.create, so they keep the coach home.
export function HomeSwitch({ caps, parent, coach }: { caps: ReadonlySet<string>; parent: ReactNode; coach: ReactNode }) {
  return <>{caps.has('sessions.create') ? coach : parent}</>
}

export function Home() {
  const { caps, isPending } = useMyCapabilities()
  // Wait for the capability set so neither home flashes before the role is
  // known.
  if (isPending) return <Loading />
  return <HomeSwitch caps={caps} parent={<ParentHome />} coach={<CoachHome />} />
}
