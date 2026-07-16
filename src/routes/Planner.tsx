import { useEffect, useRef, useState } from 'react'
import type { DragEventHandler, ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useNav } from '../hooks/useNav'
import { useAuth } from '../hooks/useAuth'
import { useSessions } from '../context/SessionsContext'
import {
  useActivityTitle,
  useBoards,
  useDrillMap,
  useMediaMap,
  useMemberMap,
  useMyCapabilities,
  useSession,
  useTeams,
} from '../lib/queries'
import { blankSession, embedSrc, isSampleMedia, PHASES } from '../lib/data'
import type { Activity, Drill, MediaItem, Phase, Session } from '../lib/data'
import { isFaVideo } from '../lib/fa'
import { Icon } from '../components/icons'
import type { IconComponent } from '../components/icons'
import {
  ActionError,
  Empty,
  ErrorNote,
  ListInput,
  Loading,
  MediaAttribution,
  MediaThumb,
  PHASE_COLOR,
  SourceLink,
} from '../components/ui'
import { createPlannerActions, logSessionWriteError, SESSION_SAVE_ERROR, SESSION_START_ERROR } from '../lib/sessionSubmit'
import type { PlannerAction, PlannerActions } from '../lib/sessionSubmit'
import { AddDrillModal } from '../components/AddDrillModal'
import { BoardPickerModal } from '../components/BoardPicker'
import { DeleteSessionModal } from '../components/DeleteSessionModal'
import { DiagramViewer } from '../components/DiagramViewer'
import { MediaPlayerModal } from '../components/MediaPlayerModal'
import { SpondAttendanceCard } from '../components/SpondAttendance'
import { downloadSessionIcs } from '../lib/ics'
import { PlanFromSpond } from '../components/PlanFromSpond'

interface DragHandlers {
  onDragStart: DragEventHandler<HTMLDivElement>
  onDragEnter: DragEventHandler<HTMLDivElement>
  onDragEnd: DragEventHandler<HTMLDivElement>
  onDragOver: DragEventHandler<HTMLDivElement>
}

// A labelled setup cell, the drill detail's grid square reused at panel size.
function MetaCell({ icon: Ico, k, v }: { icon: IconComponent; k: string; v: string }) {
  return (
    <div className="setup-cell">
      <div className="k">
        <Ico />
        {k}
      </div>
      <div className="v">
        {v || (
          <span className="muted" style={{ fontWeight: 500 }}>
            Not set
          </span>
        )}
      </div>
    </div>
  )
}

// A numbered sentence list (coaching points, the easier and harder STEP
// adaptations), the same shape the drill detail uses. Renders nothing when
// the drill carries none.
function PanelList({ icon: Ico, label, items }: { icon: IconComponent; label: string; items: string[] }) {
  if (!items.length) return null
  return (
    <div>
      <div className="act-panel-label">
        <Ico style={{ width: 13, height: 13 }} />
        {label}
      </div>
      <div className="coach-points">
        {items.map((p, i) => (
          <div className="cp" key={i}>
            <span className="cp-num">{i + 1}</span>
            <span style={{ fontSize: 14, lineHeight: 1.45 }}>{p}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// The expanded card's media preview. An image opens the full-screen diagram
// viewer; a video or YouTube clip opens the player overlay, the same patterns
// the drill detail and session day screens use. A sample row or a PDF shows
// the thumbnail and leaves anything more to the full drill link below.
function ActivityPanelMedia({ media, drill }: { media: MediaItem | null; drill: Drill }) {
  const [viewer, setViewer] = useState<'diagram' | 'player' | null>(null)
  if (!media) return null
  const sample = isSampleMedia(media)
  const isImage = media.type === 'image'
  const playable =
    !sample && (media.type === 'video' || media.type === 'youtube' || !!embedSrc(media.embedUrl) || isFaVideo(media))
  const open = isImage ? () => setViewer('diagram') : playable ? () => setViewer('player') : null
  return (
    <div className="act-panel-media">
      <div className="detail-media">
        {open ? (
          <button
            type="button"
            className="act-panel-mediabtn player"
            onClick={open}
            aria-label={(isImage ? 'View ' : 'Play ') + media.name}
          >
            <MediaThumb media={media} showPlay={playable} showBadge={false} label="" />
          </button>
        ) : (
          <div className="player">
            <MediaThumb media={media} showPlay={false} showBadge={false} label={sample ? 'sample' : undefined} />
          </div>
        )}
      </div>
      <MediaAttribution media={media} style={{ display: 'block', marginTop: 6 }} />
      {viewer === 'diagram' && (
        <DiagramViewer
          slides={[{ media, title: drill.title, summary: drill.summary }]}
          onClose={() => setViewer(null)}
        />
      )}
      {viewer === 'player' && <MediaPlayerModal item={media} onClose={() => setViewer(null)} />}
    </div>
  )
}

// The planner's drill row, presentational so the expand and collapse
// behaviour and the row controls render in a test without the data hooks.
// ActivityRow resolves the drill, its media nodes and the title and passes
// them in. A drill row's body is a button that toggles the detail panel
// beneath; a custom activity (no drill) keeps the old static body with
// nothing to expand.
export function ActivityCardView({
  act,
  idx,
  title,
  drill,
  thumb,
  expandedMedia,
  drillHref,
  expanded,
  onToggle,
  onRemove,
  onDur,
  onPhase,
  dragHandlers,
  dragging,
  readOnly,
}: {
  act: Activity
  idx: number
  title: string
  drill: Drill | null
  thumb: ReactNode
  expandedMedia: ReactNode
  drillHref: string
  expanded: boolean
  onToggle: () => void
  onRemove: (i: number) => void
  onDur: (i: number, v: number) => void
  onPhase: (i: number, v: Phase) => void
  dragHandlers: DragHandlers
  dragging: boolean
  readOnly: boolean
}) {
  const panelId = `act-panel-${idx}`
  return (
    <div className="act-item">
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
        {drill ? (
          <button
            type="button"
            className="ac-toggle"
            aria-expanded={expanded}
            aria-controls={panelId}
            onClick={onToggle}
          >
            <span className="act-thumb" style={{ overflow: 'hidden' }}>
              {thumb}
            </span>
            <span className="ac-toggle-text">
              <span className="ac-title">{title}</span>
              <span className="ac-sub">
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <span className="tag-dot" style={{ background: PHASE_COLOR[act.phase] }}></span>
                  {act.phase}
                </span>
                {drill.skill ? <span>{drill.skill}</span> : null}
              </span>
            </span>
            <span className={'ac-caret' + (expanded ? ' open' : '')}>
              <Icon.chevDown />
            </span>
          </button>
        ) : (
          <>
            <div className="act-thumb" style={{ overflow: 'hidden' }}>
              {thumb}
            </div>
            <div className="ac-body">
              <h4>{title}</h4>
              <div className="ac-sub">
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <span className="tag-dot" style={{ background: PHASE_COLOR[act.phase] }}></span>
                  {act.phase}
                </span>
              </div>
            </div>
          </>
        )}
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
          <button className="act-x" onClick={() => onRemove(idx)} aria-label="Remove activity">
            <Icon.trash />
          </button>
        )}
      </div>

      {expanded && drill && (
        <div className="act-panel" id={panelId} role="region" aria-label={`${drill.title} details`}>
          {expandedMedia}
          {drill.summary && <p className="act-panel-summary">{drill.summary}</p>}
          <div className="setup-grid">
            <MetaCell icon={Icon.clock} k="Duration" v={drill.duration + ' min'} />
            <MetaCell icon={Icon.users} k="Players" v={drill.players} />
            <MetaCell icon={Icon.ruler} k="Area" v={drill.area} />
            <MetaCell icon={Icon.target} k="Skill" v={drill.skill} />
          </div>
          <div>
            <div className="act-panel-label">
              <Icon.cone style={{ width: 13, height: 13 }} />
              Equipment
            </div>
            <div className="row wrap" style={{ gap: 7 }}>
              {drill.equipment.length ? (
                drill.equipment.map((e) => (
                  <span className="pill" key={e}>
                    {e}
                  </span>
                ))
              ) : (
                <span className="muted" style={{ fontSize: 13 }}>
                  None needed
                </span>
              )}
            </div>
          </div>
          <PanelList icon={Icon.whistle} label="Coaching points" items={drill.points} />
          <PanelList icon={Icon.chevDown} label="Make it easier" items={drill.easier} />
          <PanelList icon={Icon.bolt} label="Make it harder" items={drill.harder} />
          <Link className="btn btn-ghost btn-sm act-panel-link" to={drillHref}>
            <Icon.external />
            Open full drill
          </Link>
        </div>
      )}
    </div>
  )
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
  expanded,
  onToggle,
}: {
  act: Activity
  idx: number
  onRemove: (i: number) => void
  onDur: (i: number, v: number) => void
  onPhase: (i: number, v: Phase) => void
  dragHandlers: DragHandlers
  dragging: boolean
  readOnly: boolean
  expanded: boolean
  onToggle: () => void
}) {
  const drillById = useDrillMap()
  const mediaById = useMediaMap()
  const actTitle = useActivityTitle()
  // A drillId whose drill was deleted resolves to null; the row stays usable
  // with a removed drill placeholder from actTitle and is not expandable.
  const drill = act.drillId ? (drillById[act.drillId] ?? null) : null
  const media = drill && drill.mediaId ? (mediaById[drill.mediaId] ?? null) : null
  return (
    <ActivityCardView
      act={act}
      idx={idx}
      title={actTitle(act)}
      drill={drill}
      thumb={<MediaThumb media={media} showPlay={false} showBadge={false} label="" />}
      // Built lazily: the element only renders, and so only mints a signed
      // URL, when the panel is open.
      expandedMedia={drill ? <ActivityPanelMedia media={media} drill={drill} /> : null}
      drillHref={drill ? `/drill/${drill.id}` : ''}
      expanded={expanded}
      onToggle={onToggle}
      onRemove={onRemove}
      onDur={onDur}
      onPhase={onPhase}
      dragHandlers={dragHandlers}
      dragging={dragging}
      readOnly={readOnly}
    />
  )
}

// The planner's action card pulled out as a presentational component, so the
// static renderer covers the pending labels, the disabled states and the
// failure note without a query client. The editor resolves the submit state
// and feeds plain props in.
export function PlannerActionsView({
  readOnly,
  isExisting,
  canStart,
  pending,
  failed,
  onStart,
  onSave,
  onSessionDay,
  onCalendar,
  onLoadTemplate,
  onDelete,
}: {
  readOnly: boolean
  isExisting: boolean
  canStart: boolean
  pending: PlannerAction | null
  failed: PlannerAction | null
  onStart: () => void
  onSave: () => void
  onSessionDay: () => void
  onCalendar: () => void
  onLoadTemplate: () => void
  onDelete: () => void
}) {
  // A read-only viewer only watches, which writes nothing, so the pending and
  // failed states never apply to them.
  const busy = pending !== null
  return (
    <div className="card side-card" style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
      <button className="btn btn-gold btn-block" disabled={!canStart || (!readOnly && busy)} onClick={onStart}>
        {readOnly ? <Icon.eye /> : <Icon.play />}
        {readOnly ? 'Watch live' : pending === 'start' ? 'Starting…' : 'Start session'}
      </button>
      {isExisting && (
        <button className="btn btn-primary btn-block" onClick={onSessionDay}>
          <Icon.cone />
          Session day
        </button>
      )}
      {isExisting && (
        <button className="btn btn-ghost btn-block" onClick={onCalendar}>
          <Icon.calendar />
          Add to calendar
        </button>
      )}
      {!readOnly && (
        <>
          <button className="btn btn-primary btn-block" disabled={busy} onClick={onSave}>
            <Icon.check />
            {pending === 'save' ? 'Saving…' : 'Save session'}
          </button>
          {failed && (
            <ActionError onRetry={failed === 'save' ? onSave : onStart}>
              {failed === 'save' ? SESSION_SAVE_ERROR : SESSION_START_ERROR}
            </ActionError>
          )}
          <button className="btn btn-ghost btn-block" onClick={onLoadTemplate}>
            <Icon.book />
            Load a template
          </button>
        </>
      )}
      {/* Delete is owner or admin, the same rule the sessions delete RLS
          enforces; a new unsaved session has nothing to delete yet. */}
      {isExisting && !readOnly && (
        <button className="btn btn-ghost btn-block" onClick={onDelete}>
          <Icon.trash />
          Delete session
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
  const { user } = useAuth()
  const { caps } = useMyCapabilities()
  const { upsertSession } = useSessions()
  const { data: teams = [] } = useTeams()
  const { data: boards = [] } = useBoards()
  const memberById = useMemberMap()

  const [session, setSession] = useState<Session>(() =>
    existing
      ? (JSON.parse(JSON.stringify(existing)) as Session)
      : blankSession(newDefaults?.coachId ?? '', newDefaults?.teamId ?? null),
  )
  const [addOpen, setAddOpen] = useState(false)
  const [boardPickerOpen, setBoardPickerOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const dragFrom = useRef<number | null>(null)
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  // Which activity's detail panel is open, by index. One at a time keeps the
  // timeline short; a drag or a remove collapses it so the open index never
  // points at a moved or gone activity.
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null)

  // Visibility is club-wide, so any coach can open any club session here.
  // Editing mirrors the sessions update RLS arms: sessions.manage on any
  // session, the owner on their own (the route already requires
  // sessions.create); everyone else gets a read-only view of the plan. The
  // sessions RLS enforces the same rule on write.
  const readOnly = !!existing && existing.coachId !== user?.id && !caps.has('sessions.manage')
  const owner = existing ? memberById[existing.coachId] : undefined

  const mins = session.activities.reduce((a, x) => a + (x.duration || 0), 0)
  const setField = (k: 'name' | 'date' | 'time' | 'ageGroup' | 'venue' | 'focus' | 'space' | 'sourceUrl', v: string) =>
    setSession((s) => ({ ...s, [k]: v }))
  const setIntentions = (v: string[]) => setSession((s) => ({ ...s, intentions: v }))
  const setTeam = (v: string) => setSession((s) => ({ ...s, teamId: v || null }))
  const setBoard = (id: string | null) => setSession((s) => ({ ...s, boardId: id }))
  // The attached board's name, resolved from the club list for the label. A
  // board the coach cannot see (or one deleted) leaves boardId set but the
  // lookup empty, so the control falls back to a neutral label.
  const attachedBoard = session.boardId ? boards.find((b) => b.id === session.boardId) : undefined
  const removeAct = (i: number) => {
    setExpandedIdx(null)
    setSession((s) => ({ ...s, activities: s.activities.filter((_, j) => j !== i) }))
  }
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

  // Save and Start await the database write and navigate only on success; a
  // failure keeps the coach here with every edit intact, an inline error and
  // a retry. The two share one in-flight guard, so rapid clicks or crossing
  // actions cannot double-submit even before the buttons disable. Which
  // action is pending or failed drives the button labels and the error note.
  const [pendingAction, setPendingAction] = useState<PlannerAction | null>(null)
  const [failedAction, setFailedAction] = useState<PlannerAction | null>(null)
  // Constructed once so the shared in-flight guard survives re-renders. The
  // captured upsert delegates to the mutation's stable mutateAsync and the
  // captured nav only pushes absolute routes, so first-render captures stay
  // correct for the life of the editor.
  const [actions] = useState<PlannerActions>(() =>
    createPlannerActions({
      upsert: (draft) => upsertSession(draft),
      navSessions: () => nav('sessions'),
      navLive: (id) => nav('live', { sessionId: id }),
      onPending: (action) => {
        setPendingAction(action)
        // A new attempt clears the previous attempt's error.
        if (action) setFailedAction(null)
      },
      onFailure: (action, err) => {
        logSessionWriteError(`planner ${action}`, err)
        setFailedAction(action)
      },
    }),
  )
  // While unmounted the actions still settle (and log) but never navigate, so
  // a slow save cannot yank the coach to another screen after they have left.
  useEffect(() => {
    actions.setActive(true)
    return () => actions.setActive(false)
  }, [actions])

  // Both submit the draft as currently visible, so a retry after more edits
  // carries the latest state, never a payload captured by the failed attempt.
  const save = () => void actions.save(session)
  const start = () => void actions.start(session, readOnly)

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
          {/* A new session can start from a synced Spond event: picking one
              creates its own pre filled session and navigates there, so the
              surface shows only while building a fresh plan. */}
          {!existing && <PlanFromSpond />}
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
                  expanded={expandedIdx === i}
                  onToggle={() => setExpandedIdx((cur) => (cur === i ? null : i))}
                  dragHandlers={{
                    onDragStart: () => {
                      dragFrom.current = i
                      setDragIdx(i)
                      // Collapse so the open index does not drift as rows move.
                      setExpandedIdx(null)
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
            <div className="field">
              <label>Tactics board</label>
              {session.boardId ? (
                <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                  <span className="pill" style={{ flex: 1, minWidth: 0 }}>
                    <Icon.layers />
                    {attachedBoard?.name ?? 'Attached board'}
                  </span>
                  {!readOnly && (
                    <>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setBoardPickerOpen(true)}>
                        Change
                      </button>
                      <button
                        type="button"
                        className="btn btn-quiet btn-sm icon-only"
                        aria-label="Remove board"
                        onClick={() => setBoard(null)}
                      >
                        <Icon.x />
                      </button>
                    </>
                  )}
                </div>
              ) : readOnly ? (
                <span className="muted" style={{ fontSize: 13 }}>
                  None attached
                </span>
              ) : (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setBoardPickerOpen(true)}>
                  <Icon.plus />
                  Attach a board
                </button>
              )}
            </div>
          </div>

          {/* Linking edits the draft like every other planner field; Save
              writes it with the session. */}
          <SpondAttendanceCard
            spondEventId={session.spondEventId}
            teamId={session.teamId}
            date={session.date}
            time={session.time}
            canEdit={!readOnly}
            onLink={(id) => setSession((s) => ({ ...s, spondEventId: id }))}
          />

          <PlannerActionsView
            readOnly={readOnly}
            isExisting={!!existing}
            canStart={session.activities.length > 0}
            pending={pendingAction}
            failed={failedAction}
            onStart={start}
            onSave={save}
            onSessionDay={() => nav('sessionDay', { sessionId: session.id })}
            onCalendar={() => downloadSessionIcs(session)}
            onLoadTemplate={() => nav('templates')}
            onDelete={() => setDeleteOpen(true)}
          />
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
      {boardPickerOpen && (
        <BoardPickerModal
          currentId={session.boardId}
          defaultTeamId={session.teamId}
          onSelect={setBoard}
          onClose={() => setBoardPickerOpen(false)}
        />
      )}
      {deleteOpen && existing && (
        <DeleteSessionModal s={existing} onClose={() => setDeleteOpen(false)} onDeleted={() => nav('sessions')} />
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
