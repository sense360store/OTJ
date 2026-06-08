import { useNav } from '../hooks/useNav'
import { useSessions } from '../context/SessionsContext'
import { useAuth } from '../hooks/useAuth'
import { useDrills, useTemplates, useMedia } from '../lib/queries'
import { sessionMinutes, CORNERS } from '../lib/data'
import type { CornerKey, Session } from '../lib/data'
import { Icon } from '../components/icons'
import type { IconComponent } from '../components/icons'
import { DrillCard, ErrorNote, Loading } from '../components/ui'

const CORNER_ICONS: Record<CornerKey, IconComponent> = {
  technical: Icon.target,
  physical: Icon.dumbbell,
  social: Icon.handshake,
  psychological: Icon.brain,
}

type Nav = ReturnType<typeof useNav>

function NextSessionHero({ session, nav }: { session: Session; nav: Nav }) {
  const mins = sessionMinutes(session)
  const d = new Date(session.date + 'T' + session.time)
  const dayStr = d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
  return (
    <div className="hero">
      <div className="eyebrow">Your next session</div>
      <h2>{session.name}</h2>
      <div style={{ fontWeight: 700, color: 'var(--gold)', fontSize: 15 }}>{session.focus}</div>
      <div className="hero-meta">
        <span className="row">
          <Icon.calendar />
          {dayStr}
        </span>
        <span className="row">
          <Icon.clock />
          {session.time} · {mins} min
        </span>
        <span className="row">
          <Icon.pin />
          {session.venue}
        </span>
        <span className="row">
          <Icon.list />
          {session.activities.length} activities
        </span>
      </div>
      <div className="hero-acts">
        <button className="btn btn-gold btn-lg" onClick={() => nav('live', { sessionId: session.id })}>
          <Icon.play />
          Start session
        </button>
        <button
          className="btn btn-ghost btn-lg"
          style={{ background: 'rgba(255,255,255,.12)', color: '#fff', borderColor: 'rgba(255,255,255,.25)' }}
          onClick={() => nav('planner', { sessionId: session.id })}
        >
          <Icon.edit />
          Open plan
        </button>
      </div>
    </div>
  )
}

function StatCard({
  label,
  val,
  foot,
  icon: Ico,
  onClick,
}: {
  label: string
  val: number
  foot: string
  icon: IconComponent
  onClick?: () => void
}) {
  return (
    <div className="card stat" style={onClick ? { cursor: 'pointer' } : undefined} onClick={onClick}>
      <div className="spread">
        <span className="label">{label}</span>
        <Ico className="ico" />
      </div>
      <div className="val">{val}</div>
      <div className="foot">{foot}</div>
    </div>
  )
}

export function Home() {
  const nav = useNav()
  const { sessions, loading: sessionsLoading, error: sessionsError } = useSessions()
  const { data: drills = [], isLoading: drillsLoading, isError: drillsError } = useDrills()
  const { data: templates = [], isLoading: templatesLoading, isError: templatesError } = useTemplates()
  const { data: media = [], isLoading: mediaLoading, isError: mediaError } = useMedia()
  const { profile } = useAuth()
  const firstName = profile?.full_name?.split(' ')[0] ?? 'Coach'

  if (sessionsLoading || drillsLoading || templatesLoading || mediaLoading) return <Loading />
  if (sessionsError || drillsError || templatesError || mediaError) return <ErrorNote />

  const next = sessions[0]
  const recent = drills.slice(0, 4)
  const cornerCounts: Record<string, number> = {}
  drills.forEach((d) => {
    cornerCounts[d.corner] = (cornerCounts[d.corner] || 0) + 1
  })
  const now = new Date()
  const today =
    now.toLocaleDateString('en-GB', { weekday: 'long' }) +
    ' · ' +
    now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="eyebrow">{today}</div>
          <h2 style={{ marginTop: 4 }}>Welcome back, {firstName}</h2>
          <div className="sub">Plan a session, browse the drill library, or jump straight onto the pitch.</div>
        </div>
        <div className="row">
          <button className="btn btn-ghost" onClick={() => nav('library')}>
            <Icon.search />
            Browse drills
          </button>
          <button className="btn btn-primary" onClick={() => nav('planner')}>
            <Icon.plus />
            New session
          </button>
        </div>
      </div>

      <div
        style={{ display: 'grid', gridTemplateColumns: '1.55fr 1fr', gap: 18, alignItems: 'stretch', marginBottom: 18 }}
        className="home-top"
      >
        {next && <NextSessionHero session={next} nav={nav} />}
        <div className="stat-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <StatCard label="Drills" val={drills.length} foot="In the library" icon={Icon.grid} onClick={() => nav('library')} />
          <StatCard label="Templates" val={templates.length} foot="Ready to use" icon={Icon.book} onClick={() => nav('templates')} />
          <StatCard label="Sessions" val={sessions.length} foot="Planned ahead" icon={Icon.calendar} onClick={() => nav('sessions')} />
          <StatCard label="Media" val={media.length} foot="Clips · PDFs · images" icon={Icon.film} onClick={() => nav('media')} />
        </div>
      </div>

      {/* Browse by corner */}
      <div className="section-title">
        <Icon.sparkle />
        <h3>Browse by FA corner</h3>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 14, marginBottom: 28 }}>
        {Object.values(CORNERS).map((c) => {
          const Ico = CORNER_ICONS[c.key]
          return (
            <button
              key={c.key}
              className="card"
              onClick={() => nav('library', { corner: c.key })}
              style={{
                padding: 16,
                textAlign: 'left',
                border: '1px solid var(--line)',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              <span
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 11,
                  display: 'grid',
                  placeItems: 'center',
                  background: 'color-mix(in srgb, ' + c.color + ' 14%, transparent)',
                  color: c.color,
                }}
              >
                <Ico style={{ width: 22, height: 22 }} />
              </span>
              <div>
                <div style={{ fontWeight: 800, fontSize: 16 }}>{c.label}</div>
                <div className="muted" style={{ fontSize: 13 }}>
                  {cornerCounts[c.key] || 0} drills
                </div>
              </div>
            </button>
          )
        })}
      </div>

      {/* Recently added */}
      <div className="spread" style={{ marginBottom: 14 }}>
        <div className="section-title" style={{ margin: 0 }}>
          <Icon.bolt />
          <h3>Recently added</h3>
        </div>
        <button className="btn btn-quiet btn-sm" onClick={() => nav('library')}>
          View all
          <Icon.arrowRight />
        </button>
      </div>
      <div className="grid-drills">
        {recent.map((d) => (
          <DrillCard key={d.id} drill={d} onClick={() => nav('drill', { drillId: d.id })} />
        ))}
      </div>
    </div>
  )
}
