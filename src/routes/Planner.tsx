import { useEffect, useRef, useState } from 'react'
import type { DragEventHandler } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useNav } from '../hooks/useNav'
import { useSessions } from '../context/SessionsContext'
import { drillById, mediaById, PHASES } from '../lib/data'
import type { Activity, Phase, Session } from '../lib/data'
import { Icon } from '../components/icons'
import { Empty, MediaThumb, PHASE_COLOR } from '../components/ui'
import { AddDrillModal } from '../components/AddDrillModal'

let DRAFT_SEQ = 100
function blankSession(): Session {
  return {
    id: 's' + DRAFT_SEQ++,
    name: 'New Session',
    date: '2026-06-16',
    time: '17:30',
    ageGroup: 'U8s',
    venue: 'Springmill 3G',
    focus: 'All-round',
    status: 'upcoming',
    activities: [],
  }
}

interface DragHandlers {
  onDragStart: DragEventHandler<HTMLDivElement>
  onDragEnter: DragEventHandler<HTMLDivElement>
  onDragEnd: DragEventHandler<HTMLDivElement>
  onDragOver: DragEventHandler<HTMLDivElement>
}

function ActivityRow({
  act,
  idx,
  onRemove,
  onDur,
  onPhase,
  dragHandlers,
  dragging,
}: {
  act: Activity
  idx: number
  onRemove: (i: number) => void
  onDur: (i: number, v: number) => void
  onPhase: (i: number, v: Phase) => void
  dragHandlers: DragHandlers
  dragging: boolean
}) {
  const drill = act.drillId ? drillById[act.drillId] : null
  const media = drill && drill.mediaId ? mediaById[drill.mediaId] : null
  return (
    <div className="act-card" style={dragging ? { opacity: 0.4 } : undefined} draggable {...dragHandlers}>
      <span className="act-grip">
        <Icon.grip />
      </span>
      <div className="act-thumb" style={{ overflow: 'hidden' }}>
        <MediaThumb media={media} showPlay={false} showBadge={false} label="" />
      </div>
      <div className="ac-body">
        <h4>{drill ? drill.title : act.title || 'Custom activity'}</h4>
        <div className="ac-sub">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span className="tag-dot" style={{ background: PHASE_COLOR[act.phase] }}></span>
            {act.phase}
          </span>
          {drill && <span>{drill.skill}</span>}
        </div>
      </div>
      <select
        value={act.phase}
        onChange={(e) => onPhase(idx, e.target.value as Phase)}
        style={{
          height: 34,
          borderRadius: 8,
          border: '1px solid var(--line)',
          background: 'var(--bg)',
          fontSize: 12.5,
          fontWeight: 700,
          color: 'var(--ink)',
          padding: '0 6px',
        }}
      >
        {PHASES.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </select>
      <div className="row" style={{ gap: 4 }}>
        <input
          type="number"
          value={act.duration}
          min="1"
          max="90"
          onChange={(e) => onDur(idx, parseInt(e.target.value) || 0)}
          style={{
            width: 52,
            height: 34,
            borderRadius: 8,
            border: '1px solid var(--line)',
            background: 'var(--bg)',
            textAlign: 'center',
            fontWeight: 800,
            fontSize: 13,
            color: 'var(--ink)',
          }}
        />
        <span className="muted" style={{ fontSize: 12, fontWeight: 700 }}>
          min
        </span>
      </div>
      <button className="act-x" onClick={() => onRemove(idx)}>
        <Icon.trash />
      </button>
    </div>
  )
}

export function Planner() {
  const nav = useNav()
  const { sessions, upsertSession } = useSessions()
  const [searchParams] = useSearchParams()
  const editId = searchParams.get('sessionId')
  const existing = editId ? sessions.find((s) => s.id === editId) : null

  const [session, setSession] = useState<Session>(() =>
    existing ? (JSON.parse(JSON.stringify(existing)) as Session) : blankSession(),
  )
  const [addOpen, setAddOpen] = useState(false)
  const dragFrom = useRef<number | null>(null)
  const [dragIdx, setDragIdx] = useState<number | null>(null)

  // Resync the editable draft when the URL selects a different session.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (existing) setSession(JSON.parse(JSON.stringify(existing)) as Session)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId])

  const mins = session.activities.reduce((a, x) => a + (x.duration || 0), 0)
  const setField = (k: 'name' | 'date' | 'time' | 'ageGroup' | 'venue' | 'focus', v: string) =>
    setSession((s) => ({ ...s, [k]: v }))
  const removeAct = (i: number) => setSession((s) => ({ ...s, activities: s.activities.filter((_, j) => j !== i) }))
  const setDur = (i: number, v: number) =>
    setSession((s) => {
      const a = [...s.activities]
      a[i] = { ...a[i], duration: v }
      return { ...s, activities: a }
    })
  const setPhase = (i: number, v: Phase) =>
    setSession((s) => {
      const a = [...s.activities]
      a[i] = { ...a[i], phase: v }
      return { ...s, activities: a }
    })
  const addActivities = (items: Activity[]) => setSession((s) => ({ ...s, activities: [...s.activities, ...items] }))

  const reorder = (to: number) => {
    const from = dragFrom.current
    if (from === null || from === to) return
    setSession((s) => {
      const a = [...s.activities]
      const [m] = a.splice(from, 1)
      a.splice(to, 0, m)
      return { ...s, activities: a }
    })
    dragFrom.current = to
  }

  const save = () => {
    upsertSession(session)
    nav('sessions')
  }
  const start = () => {
    upsertSession(session)
    nav('live', { sessionId: session.id })
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <button className="btn btn-quiet btn-sm" style={{ marginBottom: 8, marginLeft: -8 }} onClick={() => nav('sessions')}>
            <Icon.chevL />
            Sessions
          </button>
          <h2>{existing ? 'Edit session' : 'Plan a session'}</h2>
          <div className="sub">Drag to reorder · pull drills from the library or start from a template.</div>
        </div>
      </div>

      <div className="planner">
        <div className="timeline-wrap">
          {session.activities.length === 0 ? (
            <div className="card" style={{ padding: 0 }}>
              <Empty icon={Icon.layers} title="Empty session">
                Add drills from the library or load a template to get started.
              </Empty>
            </div>
          ) : (
            <div className="timeline">
              {session.activities.map((act, i) => (
                <ActivityRow
                  key={i}
                  act={act}
                  idx={i}
                  onRemove={removeAct}
                  onDur={setDur}
                  onPhase={setPhase}
                  dragging={dragIdx === i}
                  dragHandlers={{
                    onDragStart: () => {
                      dragFrom.current = i
                      setDragIdx(i)
                    },
                    onDragEnter: () => reorder(i),
                    onDragEnd: () => {
                      dragFrom.current = null
                      setDragIdx(null)
                    },
                    onDragOver: (e) => e.preventDefault(),
                  }}
                />
              ))}
            </div>
          )}
          <div className="row" style={{ gap: 10, marginTop: 4 }}>
            <button className="add-slot" style={{ marginBottom: 0 }} onClick={() => setAddOpen(true)}>
              <Icon.plus />
              Add from library
            </button>
            <button
              className="add-slot"
              style={{ marginBottom: 0 }}
              onClick={() => addActivities([{ phase: 'Skill', title: 'Custom activity', duration: 10 }])}
            >
              <Icon.edit />
              Add custom
            </button>
          </div>
        </div>

        <div className="planner-side">
          <div className="card side-card">
            <div className="total-time" style={{ marginBottom: 4 }}>
              <span className="big">{mins}</span>
              <span className="muted" style={{ fontWeight: 700 }}>
                min total
              </span>
            </div>
            <div className="muted" style={{ fontSize: 13, marginBottom: 14 }}>
              {session.activities.length} activities
            </div>
            <div className="field">
              <label>Session name</label>
              <input value={session.name} onChange={(e) => setField('name', e.target.value)} />
            </div>
            <div className="row" style={{ gap: 10 }}>
              <div className="field" style={{ flex: 1 }}>
                <label>Date</label>
                <input type="date" value={session.date} onChange={(e) => setField('date', e.target.value)} />
              </div>
              <div className="field" style={{ width: 110 }}>
                <label>Time</label>
                <input type="time" value={session.time} onChange={(e) => setField('time', e.target.value)} />
              </div>
            </div>
            <div className="row" style={{ gap: 10 }}>
              <div className="field" style={{ flex: 1 }}>
                <label>Age group</label>
                <select value={session.ageGroup} onChange={(e) => setField('ageGroup', e.target.value)}>
                  {['U6s', 'U7s', 'U8s', 'U9s', 'U10s', 'U11s', 'U12s'].map((a) => (
                    <option key={a}>{a}</option>
                  ))}
                </select>
              </div>
              <div className="field" style={{ flex: 1 }}>
                <label>Venue</label>
                <input value={session.venue} onChange={(e) => setField('venue', e.target.value)} />
              </div>
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Focus</label>
              <input value={session.focus} onChange={(e) => setField('focus', e.target.value)} />
            </div>
          </div>

          <div className="card side-card" style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            <button className="btn btn-gold btn-block" disabled={!session.activities.length} onClick={start}>
              <Icon.play />
              Start session
            </button>
            <button className="btn btn-primary btn-block" onClick={save}>
              <Icon.check />
              Save session
            </button>
            <button className="btn btn-ghost btn-block" onClick={() => nav('templates')}>
              <Icon.book />
              Load a template
            </button>
          </div>
        </div>
      </div>

      {addOpen && (
        <AddDrillModal
          onClose={() => setAddOpen(false)}
          onAdd={(items) => {
            addActivities(items)
            setAddOpen(false)
          }}
        />
      )}
    </div>
  )
}
