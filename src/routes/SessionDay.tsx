// Session day: the mobile-first pitch-side view a coach opens ten minutes
// before players arrive, phone in one hand and a bag of cones in the other.
// Three questions, in tab order: what needs setting up (Setup), what do I
// need (Kit), what does it look like (the diagrams, full screen). The kit
// check offs persist per device in localStorage, a pre-session aid, not
// shared data.
//
// The view leans on TanStack Query's cache: a session opened in the car park
// still renders at the far end of the pitch because cached data keeps
// rendering even if a background refetch fails. Full offline support (PWA,
// precached signed URLs) is out of scope and noted as possible future work.
import { useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useNav } from '../hooks/useNav'
import { useAuth } from '../hooks/useAuth'
import { useActivityTitle, useDrillMap, useMediaMap, useProgrammeMap, useSession, useTeamMap } from '../lib/queries'
import { sessionMinutes } from '../lib/data'
import type { Activity, Drill, MediaItem, Session } from '../lib/data'
import { Icon } from '../components/icons'
import { Empty, ErrorNote, fmtDate, Loading, MediaThumb, PHASE_COLOR, SourceLink } from '../components/ui'
import { DiagramViewer } from '../components/DiagramViewer'
import type { DiagramSlide } from '../components/DiagramViewer'
import './SessionDay.css'

type Tab = 'setup' | 'kit' | 'plan'

interface RowData {
  act: Activity
  drill: Drill | null
  media: MediaItem | null
  // Index into the diagram slides when this activity has one.
  diagramIndex: number | null
}

function kitKey(sessionId: string) {
  return 'otj_kit_' + sessionId
}

function loadChecked(sessionId: string): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(kitKey(sessionId)) ?? '[]') as unknown
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function SessionDayView({ session }: { session: Session }) {
  const nav = useNav()
  const { user, role } = useAuth()
  const drillById = useDrillMap()
  const mediaById = useMediaMap()
  const teamById = useTeamMap()
  const actTitle = useActivityTitle()
  // The same link opens the live view for everyone; the label says whether
  // this user will drive it (owner, or admin) or watch it.
  const canDrive = session.coachId === user?.id || role === 'admin'
  const [tab, setTab] = useState<Tab>('setup')
  const [viewerAt, setViewerAt] = useState<number | null>(null)
  const [checked, setChecked] = useState<string[]>(() => loadChecked(session.id))

  // Activities resolved once: drill, diagram media (images only; videos and
  // PDFs are not part of the diagram carousel) and the slide index.
  const { rows, slides } = useMemo(() => {
    const slides: DiagramSlide[] = []
    const rows: RowData[] = session.activities.map((act) => {
      const drill = act.drillId ? (drillById[act.drillId] ?? null) : null
      const media = drill?.mediaId ? (mediaById[drill.mediaId] ?? null) : null
      const isDiagram = !!media && media.type === 'image' && !!media.storagePath
      let diagramIndex: number | null = null
      if (isDiagram && media && drill) {
        diagramIndex = slides.length
        slides.push({ media, title: drill.title, summary: drill.summary })
      }
      return { act, drill, media: isDiagram ? media : null, diagramIndex }
    })
    return { rows, slides }
  }, [session.activities, drillById, mediaById])

  // The kit list is the union of equipment across the session's drills, each
  // item remembering which drills need it, in session order.
  const kit = useMemo(() => {
    const byName = new Map<string, string[]>()
    for (const { drill } of rows) {
      if (!drill) continue
      for (const item of drill.equipment) {
        const drills = byName.get(item) ?? []
        if (!drills.includes(drill.title)) drills.push(drill.title)
        byName.set(item, drills)
      }
    }
    return [...byName.entries()].map(([name, drills]) => ({ name, drills }))
  }, [rows])

  const playersSummary = useMemo(() => {
    const distinct = [...new Set(rows.map((r) => r.drill?.players).filter((p): p is string => !!p))]
    return distinct.join(' · ')
  }, [rows])

  const toggleKit = (name: string) => {
    const next = checked.includes(name) ? checked.filter((x) => x !== name) : [...checked, name]
    localStorage.setItem(kitKey(session.id), JSON.stringify(next))
    setChecked(next)
  }
  const resetKit = () => {
    localStorage.removeItem(kitKey(session.id))
    setChecked([])
  }

  const mins = sessionMinutes(session)
  const teamName = session.teamId ? teamById[session.teamId]?.name : 'Club'
  const subBits = [fmtDate(session.date), session.time, session.venue, teamName].filter(Boolean)
  // A session created by applying a programme links back to its programme
  // and week; a hand-planned session has neither.
  const programmeById = useProgrammeMap()
  const programme = session.programmeId ? programmeById[session.programmeId] : undefined

  return (
    <div>
      <div className="sd-head">
        <button className="icon-btn" style={{ width: 44, height: 44 }} aria-label="Back" onClick={() => nav('sessions')}>
          <Icon.chevL />
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2>{session.name}</h2>
          <div className="sd-sub">{subBits.join(' · ')}</div>
        </div>
        <button className="btn btn-gold" style={{ height: 44 }} onClick={() => nav('live', { sessionId: session.id })}>
          {canDrive ? <Icon.play /> : <Icon.eye />}
          {canDrive ? 'Start' : 'Watch'}
        </button>
      </div>

      {programme && (
        <button
          className="pill"
          style={{ minHeight: 32, cursor: 'pointer', marginBottom: 12 }}
          onClick={() => nav('programme', { programmeId: programme.id })}
        >
          <Icon.list />
          {programme.name}
          {session.programmeWeek != null ? ` · Week ${session.programmeWeek}` : ''}
        </button>
      )}

      <div className="sd-tabs">
        <button className={'sd-tab' + (tab === 'setup' ? ' on' : '')} onClick={() => setTab('setup')}>
          <Icon.ruler />
          Setup
        </button>
        <button className={'sd-tab' + (tab === 'kit' ? ' on' : '')} onClick={() => setTab('kit')}>
          <Icon.cone />
          Kit
        </button>
        <button className={'sd-tab' + (tab === 'plan' ? ' on' : '')} onClick={() => setTab('plan')}>
          <Icon.list />
          Plan
        </button>
      </div>

      {session.activities.length === 0 ? (
        <Empty icon={Icon.layers} title="Nothing planned yet">
          Add activities to this session in the planner first.
        </Empty>
      ) : tab === 'setup' ? (
        <div className="sd-list">
          {rows.map((r, i) => (
            <div className="sd-card" key={i}>
              <div className="sd-card-head">
                <span className="sd-num">{i + 1}</span>
                <h4>{actTitle(r.act)}</h4>
                <span className="pill">
                  <Icon.clock />
                  {r.act.duration} min
                </span>
              </div>
              <div className="row wrap" style={{ gap: 7, marginTop: 10 }}>
                <span className="pill">
                  <span className="tag-dot" style={{ background: PHASE_COLOR[r.act.phase] }}></span>
                  {r.act.phase}
                </span>
                {r.drill?.area && (
                  <span className="pill">
                    <Icon.ruler />
                    {r.drill.area}
                  </span>
                )}
              </div>
              {r.drill?.setupNotes && <p className="sd-notes">{r.drill.setupNotes}</p>}
              {r.media && r.diagramIndex !== null && (
                <button className="sd-thumb" aria-label="Open diagram full screen" onClick={() => setViewerAt(r.diagramIndex)}>
                  <MediaThumb media={r.media} showPlay={false} showBadge={false} label="" />
                </button>
              )}
            </div>
          ))}
        </div>
      ) : tab === 'kit' ? (
        <div className="sd-list">
          <div className="sd-card">
            <div className="row wrap" style={{ gap: 7 }}>
              {session.space && (
                <span className="pill">
                  <Icon.ruler />
                  {session.space}
                </span>
              )}
              {playersSummary && (
                <span className="pill">
                  <Icon.users />
                  {playersSummary}
                </span>
              )}
              <span className="pill">
                <Icon.list />
                {session.activities.length} activities
              </span>
              <span className="pill">
                <Icon.clock />
                {mins} min
              </span>
            </div>
            {session.intentions.length > 0 && (
              <div className="row wrap" style={{ gap: 6, marginTop: 10 }}>
                {session.intentions.map((x, i) => (
                  <span key={i} className="pill">
                    {x}
                  </span>
                ))}
              </div>
            )}
            {session.sourceUrl && (
              <div style={{ marginTop: 10 }}>
                <SourceLink url={session.sourceUrl} label={session.sourceLabel} />
              </div>
            )}
          </div>
          {kit.length === 0 ? (
            <Empty icon={Icon.cone} title="No kit needed">
              None of this session's drills list equipment.
            </Empty>
          ) : (
            <>
              {kit.map((item) => {
                const on = checked.includes(item.name)
                return (
                  <button
                    key={item.name}
                    className={'sd-kit-item' + (on ? ' on' : '')}
                    onClick={() => toggleKit(item.name)}
                    aria-pressed={on}
                  >
                    <span className="sd-check">{on && <Icon.check />}</span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span className="sd-kit-name">{item.name}</span>
                      <span className="sd-kit-drills" style={{ display: 'block' }}>
                        {item.drills.join(' · ')}
                      </span>
                    </span>
                  </button>
                )
              })}
              {checked.length > 0 && (
                <button className="btn btn-quiet btn-sm" style={{ alignSelf: 'flex-start' }} onClick={resetKit}>
                  <Icon.rotate />
                  Reset checks
                </button>
              )}
            </>
          )}
        </div>
      ) : (
        <div className="sd-list">
          {rows.map((r, i) => (
            <button
              key={i}
              className="sd-plan-row"
              disabled={!r.drill}
              onClick={() => r.drill && nav('drill', { drillId: r.drill.id })}
            >
              <span className="sd-num">{i + 1}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span className="row" style={{ gap: 8 }}>
                  <span style={{ fontWeight: 800, fontSize: 15, flex: 1, minWidth: 0 }}>{actTitle(r.act)}</span>
                  <span className="pill">
                    <Icon.clock />
                    {r.act.duration} min
                  </span>
                </span>
                <span className="row" style={{ gap: 6, marginTop: 4 }}>
                  <span className="tag-dot" style={{ background: PHASE_COLOR[r.act.phase] }}></span>
                  <span className="muted" style={{ fontSize: 12.5, fontWeight: 700 }}>
                    {r.act.phase}
                    {r.drill?.skill ? ' · ' + r.drill.skill : ''}
                  </span>
                </span>
                {r.drill && r.drill.points.length > 0 && (
                  <ul className="sd-plan-points" style={{ margin: 0, paddingLeft: 18 }}>
                    {r.drill.points.map((p, j) => (
                      <li key={j}>{p}</li>
                    ))}
                  </ul>
                )}
              </span>
              {r.drill && <Icon.chevR style={{ width: 18, height: 18, color: 'var(--slate-2)', flex: '0 0 18px', marginTop: 4 }} />}
            </button>
          ))}
        </div>
      )}

      {viewerAt !== null && slides.length > 0 && (
        <DiagramViewer slides={slides} startIndex={viewerAt} onClose={() => setViewerAt(null)} />
      )}
    </div>
  )
}

export function SessionDay() {
  const { sessionId } = useParams()
  const nav = useNav()
  const { data: session, isLoading, isError } = useSession(sessionId)

  // Cached data renders even when a refetch fails, so only the truly empty
  // states fall through to loading and error.
  if (session) return <SessionDayView key={session.id} session={session} />
  if (isLoading) return <Loading />
  if (isError) return <ErrorNote />
  return (
    <Empty icon={Icon.calendar} title="Session not found">
      <button className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={() => nav('sessions')}>
        <Icon.chevL />
        Back to sessions
      </button>
    </Empty>
  )
}
