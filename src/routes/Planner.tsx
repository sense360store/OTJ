import { useRef, useState } from 'react'
import type { DragEventHandler } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useNav } from '../hooks/useNav'
import { useAuth } from '../hooks/useAuth'
import { useSessions } from '../context/SessionsContext'
import { useActivityTitle, useDrillMap, useMediaMap, useMemberMap, useSession, useTeams } from '../lib/queries'
import { PHASES } from '../lib/data'
import type { Activity, Phase, Session } from '../lib/data'
import { Icon } from '../components/icons'
import { Empty, ErrorNote, ListInput, Loading, MediaThumb, PHASE_COLOR, SourceLink } from '../components/ui'
import { AddDrillModal } from '../components/AddDrillModal'
import { downloadSessionIcs } from '../lib/ics'

// A new session belongs to the signed-in coach and defaults to their team
// when one is set. Team is a filter and a default, never access control.
function blankSession(coachId: string, teamId: string | null): Session {
  return {
    id: crypto.randomUUID(),
    name: 'New Session',
    date: '2026-06-16',
    time: '17:30',
    ageGroup: 'U8s',
    venue: 'Springmill 3G',
    focus: 'All-round',
    status: 'upcoming',
    activities: [],
    coachId,
    teamId,
    intentions: [],
    space: '',
    sourceUrl: '',
    sourceLabel: '',
    programmeId: null,
    programmeWeek: null,
    liveActivityIndex: null,
    liveActivityStartedAt: null,
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
  readOnly,
}: {
  act: Activity
  idx: number
  onRemove: (i: number) => void
  onDur: (i: number, v: number) => void
  onPhase: (i: number, v: Phase) => void
  dragHandlers: DragHandlers
  dragging: boolean
  readOnly: boolean
}) {
  const drillById = useDrillMap()
  const mediaById = useMediaMap()
  const actTitle = useActivityTitle()
  // A drillId whose drill was deleted resolves to null; the row stays usable
  // with a removed drill placeholder from actTitle.
  const drill = act.drillId ? drillById[act.drillId] : null
  const media = drill && drill.mediaId ? mediaById[drill.mediaId] : null
  return (
    <div
      className="act-card"
      style={dragging ? { opacity: 0.4 } : undefined}
      draggable={!readOnly}
      {...(readOnly ? {} : dragHandlers)}
    >
      {!readOnly && (
        <span className="act-grip">
          <Icon.grip />
        </span>
      )}
      <div className="act-thumb" style={{ overflow: 'hidden' }}>
        <MediaThumb media={media} showPlay={false} showBadge={false} label="" />
      </div>
      <div className="ac-body">
        <h4>{actTitle(act)}</h4>
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
        disabled={readOnly}
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
          disabled={readOnly}
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
      {!readOnly && (
        <button className="act-x" onClick={() => onRemove(idx)}>
          <Icon.trash />
        </button>
      )}
    </div>
  )
}

function PlannerEditor({
  existing,
  newDefaults,
}: {
  existing: Session | null
  newDefaults?: { coachId: string; teamId: string | null }
}) {
  const nav = useNav()
  const { user, role } = useAuth()
  const { upsertSession } = useSessions()
  const { data: teams = [] } = useTeams()
  const memberById = useMemberMap()

  const [session, setSession] = useState<Session>(() =>
    existing
      ? (JSON.parse(JSON.stringify(existing)) as Session)
      : blankSession(newDefaults?.coachId ?? '', newDefaults?.teamId ?? null),
  )
  const [addOpen, setAddOpen] = useState(false)
  const dragFrom = useRef<number | null>(null)
  const [dragIdx, setDragIdx] = useState<number | null>(null)

  // Visibility is club-wide, so any coach can open any club session here.
  // Editing follows ownership (own, or admin); everyone else gets a read-only
  // view of the plan. The sessions RLS enforces the same rule on write.
  const readOnly = !!existing && existing.coachId !== user?.id && role !== 'admin'
  const owner = existing ? memberById[existing.coachId] : undefined

  const mins = session.activities.reduce((a, x) => a + (x.duration || 0), 0)
  const setField = (k: 'name' | 'date' | 'time' | 'ageGroup' | 'venue' | 'focus' | 'space' | 'sourceUrl', v: string) =>
    setSession((s) => ({ ...s, [k]: v }))
  const setIntentions = (v: string[]) => setSession((s) => ({ ...s, intentions: v }))
  const setTeam = (v: string) => setSession((s) => ({ ...s, teamId: v || null }))
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
    if (!readOnly) upsertSession(session)
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
          <h2>{readOnly ? 'View session' : existing ? 'Edit session' : 'Plan a session'}</h2>
          <div className="sub">
            {readOnly
              ? `${owner?.fullName || 'Another coach'}'s session. You can view it and watch it live, but only the owner or an admin can change or drive it.`
              : 'Drag to reorder · pull drills from the library or start from a template.'}
          </div>
        </div>
      </div>

      <div className="planner">
        <div className="timeline-wrap">
          {session.intentions.length > 0 && (
            <div className="card" style={{ padding: '16px 18px', marginBottom: 14 }}>
              <div className="eyebrow" style={{ marginBottom: 8 }}>
                Session intentions
              </div>
              <div className="muted" style={{ fontSize: 13.5, marginBottom: 6 }}>
                This session will help players:
              </div>
              <ul style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {session.intentions.map((x, i) => (
                  <li key={i} style={{ fontSize: 14.5, lineHeight: 1.5 }}>
                    {x}
                  </li>
                ))}
              </ul>
              {(session.space || session.sourceUrl) && (
                <div className="row wrap" style={{ gap: 7, marginTop: 12 }}>
                  {session.space && (
                    <span className="pill">
                      <Icon.ruler />
                      {session.space}
                    </span>
                  )}
                  <SourceLink url={session.sourceUrl} label={session.sourceLabel} />
                </div>
              )}
            </div>
          )}
          {session.activities.length === 0 ? (
            <div className="card" style={{ padding: 0 }}>
              <Empty icon={Icon.layers} title="Empty session">
                {readOnly ? 'No activities in this session yet.' : 'Add drills from the library or load a template to get started.'}
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
                  readOnly={readOnly}
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
          {!readOnly && (
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
          )}
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
              <input value={session.name} disabled={readOnly} onChange={(e) => setField('name', e.target.value)} />
            </div>
            <div className="row" style={{ gap: 10 }}>
              <div className="field" style={{ flex: 1 }}>
                <label>Date</label>
                <input type="date" value={session.date} disabled={readOnly} onChange={(e) => setField('date', e.target.value)} />
              </div>
              <div className="field" style={{ width: 110 }}>
                <label>Time</label>
                <input type="time" value={session.time} disabled={readOnly} onChange={(e) => setField('time', e.target.value)} />
              </div>
            </div>
            <div className="row" style={{ gap: 10 }}>
              <div className="field" style={{ flex: 1 }}>
                <label>Age group</label>
                <select value={session.ageGroup} disabled={readOnly} onChange={(e) => setField('ageGroup', e.target.value)}>
                  {['U6s', 'U7s', 'U8s', 'U9s', 'U10s', 'U11s', 'U12s'].map((a) => (
                    <option key={a}>{a}</option>
                  ))}
                </select>
              </div>
              <div className="field" style={{ flex: 1 }}>
                <label>Venue</label>
                <input value={session.venue} disabled={readOnly} onChange={(e) => setField('venue', e.target.value)} />
              </div>
            </div>
            <div className="row" style={{ gap: 10 }}>
              <div className="field" style={{ flex: 1 }}>
                <label>Team</label>
                <select value={session.teamId ?? ''} disabled={readOnly} onChange={(e) => setTeam(e.target.value)}>
                  <option value="">Club (no team)</option>
                  {teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field" style={{ flex: 1 }}>
                <label>Focus</label>
                <input value={session.focus} disabled={readOnly} onChange={(e) => setField('focus', e.target.value)} />
              </div>
            </div>
            <div className="field">
              <label>Space</label>
              <input
                value={session.space}
                placeholder="e.g. Third of a pitch"
                disabled={readOnly}
                onChange={(e) => setField('space', e.target.value)}
              />
            </div>
            <div className="field">
              <label>Session intentions</label>
              {readOnly ? (
                session.intentions.length ? (
                  <div className="row wrap" style={{ gap: 6 }}>
                    {session.intentions.map((x, i) => (
                      <span key={i} className="pill">
                        {x}
                      </span>
                    ))}
                  </div>
                ) : (
                  <span className="muted" style={{ fontSize: 13 }}>
                    None set
                  </span>
                )
              ) : (
                <ListInput
                  value={session.intentions}
                  onChange={setIntentions}
                  placeholder="Type an intention and press enter"
                />
              )}
            </div>
            <div className="field">
              <label>Source link</label>
              <input
                type="url"
                value={session.sourceUrl}
                placeholder="https://… where this session came from"
                disabled={readOnly}
                onChange={(e) => setField('sourceUrl', e.target.value)}
              />
            </div>
          </div>

          <div className="card side-card" style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            <button className="btn btn-gold btn-block" disabled={!session.activities.length} onClick={start}>
              {readOnly ? <Icon.eye /> : <Icon.play />}
              {readOnly ? 'Watch live' : 'Start session'}
            </button>
            {existing && (
              <button className="btn btn-primary btn-block" onClick={() => nav('sessionDay', { sessionId: session.id })}>
                <Icon.cone />
                Session day
              </button>
            )}
            {existing && (
              <button className="btn btn-ghost btn-block" onClick={() => downloadSessionIcs(session)}>
                <Icon.calendar />
                Add to calendar
              </button>
            )}
            {!readOnly && (
              <>
                <button className="btn btn-primary btn-block" onClick={save}>
                  <Icon.check />
                  Save session
                </button>
                <button className="btn btn-ghost btn-block" onClick={() => nav('templates')}>
                  <Icon.book />
                  Load a template
                </button>
              </>
            )}
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

export function Planner() {
  const [searchParams] = useSearchParams()
  const { user, profile } = useAuth()
  const editId = searchParams.get('sessionId')
  // Editing reads the one session by id; a new session has none to read and so
  // renders straight away. The key remounts the editor with fresh state
  // whenever the URL selects a different session, and for a new session also
  // when the profile arrives, so the coach's default team applies.
  const { data: existing, isLoading, isError } = useSession(editId ?? undefined)
  if (editId && isLoading) return <Loading />
  if (editId && isError) return <ErrorNote />
  if (editId && existing) return <PlannerEditor key={editId} existing={existing} />
  return (
    <PlannerEditor
      key={'new-' + (profile?.id ?? 'loading')}
      existing={null}
      newDefaults={{ coachId: user?.id ?? '', teamId: profile?.team_id ?? null }}
    />
  )
}
