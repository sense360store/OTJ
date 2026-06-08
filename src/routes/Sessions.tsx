import { useNav } from '../hooks/useNav'
import { useSessions } from '../context/SessionsContext'
import { sessionMinutes } from '../lib/data'
import type { Session } from '../lib/data'
import { Icon } from '../components/icons'
import { ErrorNote, Loading, PHASE_COLOR } from '../components/ui'

type Nav = ReturnType<typeof useNav>

function dateLabel(d: string) {
  return new Date(d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}

function SessionCard({ s, nav }: { s: Session; nav: Nav }) {
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
              {dateLabel(s.date)}
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
        <span className="pill">
          <Icon.pin />
          {s.venue}
        </span>
        <span className="pill">
          <Icon.list />
          {s.activities.length} activities
        </span>
        <span className="pill">
          <Icon.clock />
          {mins} min
        </span>
      </div>

      {/* mini timeline */}
      <div style={{ display: 'flex', gap: 3, height: 7, borderRadius: 4, overflow: 'hidden' }}>
        {s.activities.map((a, i) => (
          <div key={i} title={a.phase} style={{ flex: a.duration, background: PHASE_COLOR[a.phase] }}></div>
        ))}
      </div>

      <div className="row" style={{ gap: 9 }}>
        <button className="btn btn-gold" style={{ flex: 1 }} onClick={() => nav('live', { sessionId: s.id })}>
          <Icon.play />
          Start
        </button>
        <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => nav('planner', { sessionId: s.id })}>
          <Icon.edit />
          Edit plan
        </button>
      </div>
    </div>
  )
}

export function Sessions() {
  const nav = useNav()
  const { sessions, loading, error } = useSessions()
  if (loading) return <Loading />
  if (error) return <ErrorNote />
  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Sessions</h2>
          <div className="sub">Your planned training nights — start one live or tweak the plan.</div>
        </div>
        <button className="btn btn-primary" onClick={() => nav('planner')}>
          <Icon.plus />
          New session
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(330px,1fr))', gap: 18 }}>
        {sessions.map((s) => (
          <SessionCard key={s.id} s={s} nav={nav} />
        ))}
      </div>
    </div>
  )
}
