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
import type { Activity, Drill, MediaItem, Phase, Session, Team } from '../lib/data'
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
  ShareControlView,
  SourceLink,
} from '../components/ui'
import {
  createPlannerActions,
  logSessionWriteError,
  plannerBusy,
  sessionBaseline,
  sessionDirty,
  SESSION_SAVE_ERROR,
  SESSION_SHARE_ERROR,
  SESSION_START_ERROR,
} from '../lib/sessionSubmit'
import type { PlannerAction, PlannerActions } from '../lib/sessionSubmit'
import { useShare } from '../hooks/useShare'
import { canonicalUrl, SAVE_AND_SHARE_NOTE, SHARE_ACCOUNT_NOTE, type ShareFeedback } from '../lib/share'
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
  busy = false,
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
  // A Save or Start is in flight on the whole draft; reordering, changing a
  // phase or duration, or removing a row all edit that draft, so they freeze
  // until the write settles. Expanding the detail panel is passive viewing and
  // stays live. readOnly rows are never busy (a viewer starts no write).
  busy?: boolean
}) {
  const panelId = `act-panel-${idx}`
  const frozen = readOnly || busy
  return (
    <div className="act-item">
      <div
        className="act-card"
        style={dragging ? { opacity: 0.4 } : undefined}
        draggable={!frozen}
        {...(frozen ? {} : dragHandlers)}
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
          disabled={frozen}
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
            disabled={frozen}
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
          <button className="act-x" disabled={busy} onClick={() => onRemove(idx)} aria-label="Remove activity">
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
          {/* Reading the detail is passive viewing and stays live, but the link
              OUT to the full drill leaves the planner and would abandon the
              draft, so it freezes with the other navigation controls while a
              write is in flight. A read-only viewer is never busy, so their
              link stays live. */}
          {busy ? (
            <button type="button" className="btn btn-ghost btn-sm act-panel-link" disabled>
              <Icon.external />
              Open full drill
            </button>
          ) : (
            <Link className="btn btn-ghost btn-sm act-panel-link" to={drillHref}>
              <Icon.external />
              Open full drill
            </Link>
          )}
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
  busy,
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
  busy: boolean
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
      busy={busy}
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
  shareLabel,
  shareNote,
  shareFeedback,
  onStart,
  onSave,
  onShare,
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
  // "Share" for a saved, clean session (no write) or "Save and share" for a new
  // or dirty draft; the note explains the effect and the account requirement.
  shareLabel: string
  shareNote: string
  // The clipboard or native-share outcome after a successful save (or a direct
  // share); a save failure surfaces through the failed error below instead.
  shareFeedback: ShareFeedback
  onStart: () => void
  onSave: () => void
  onShare: () => void
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
        // Session day navigates off the planner, abandoning the draft, so it
        // freezes while a write is in flight.
        <button className="btn btn-primary btn-block" disabled={busy} onClick={onSessionDay}>
          <Icon.cone />
          Session day
        </button>
      )}
      {isExisting && (
        // Add to calendar exports the current draft as an .ics; it neither
        // edits nor abandons it, so it stays available (passive action).
        <button className="btn btn-ghost btn-block" onClick={onCalendar}>
          <Icon.calendar />
          Add to calendar
        </button>
      )}
      {/* Share the canonical session-day link. A saved, clean session (and a
          read-only viewer, who cannot dirty it) shares with no write; a new or
          dirty draft saves through the guarded seam first and shares only after
          the save resolves. The button freezes while any write is in flight and
          reads "Saving…" during its own. */}
      <ShareControlView
        label={pending === 'share' ? 'Saving…' : shareLabel}
        note={shareNote}
        busy={busy}
        feedback={shareFeedback}
        onShare={onShare}
        buttonClassName="btn btn-ghost btn-block"
      />
      {!readOnly && (
        <>
          <button className="btn btn-primary btn-block" disabled={busy} onClick={onSave}>
            <Icon.check />
            {pending === 'save' ? 'Saving…' : 'Save session'}
          </button>
          {failed && (
            // Retrying a failed start honours the same empty-session gate as
            // the Start button; with no activities left the error stays but
            // the retry affordance goes. A failed Save and share retries the
            // save-then-share as one action.
            <ActionError
              onRetry={failed === 'save' ? onSave : failed === 'share' ? onShare : canStart ? onStart : undefined}
            >
              {failed === 'save' ? SESSION_SAVE_ERROR : failed === 'share' ? SESSION_SHARE_ERROR : SESSION_START_ERROR}
            </ActionError>
          )}
          {/* Loading a template navigates to the templates screen, abandoning
              the draft, so it freezes while a write is in flight. */}
          <button className="btn btn-ghost btn-block" disabled={busy} onClick={onLoadTemplate}>
            <Icon.book />
            Load a template
          </button>
        </>
      )}
      {/* Delete is owner or admin, the same rule the sessions delete RLS
          enforces; a new unsaved session has nothing to delete yet. It opens a
          destructive modal, so it freezes while a write is in flight. */}
      {isExisting && !readOnly && (
        <button className="btn btn-ghost btn-block" disabled={busy} onClick={onDelete}>
          <Icon.trash />
          Delete session
        </button>
      )}
    </div>
  )
}

// The planner's page header: the back link to the sessions list, the title
// and the sub. Pulled out so the static renderer covers the back link freezing
// while a write is in flight (leaving the planner would abandon the draft).
// readOnly viewers write nothing, so busy never applies to them and the back
// link stays live.
export function PlannerHeaderView({
  readOnly,
  isExisting,
  ownerName,
  busy,
  onBack,
}: {
  readOnly: boolean
  isExisting: boolean
  ownerName?: string
  busy: boolean
  onBack: () => void
}) {
  return (
    <div className="page-head">
      <div>
        <button className="btn btn-quiet btn-sm" style={{ marginBottom: 8, marginLeft: -8 }} disabled={busy} onClick={onBack}>
          <Icon.chevL />
          Sessions
        </button>
        <h2>{readOnly ? 'View session' : isExisting ? 'Edit session' : 'Plan a session'}</h2>
        <div className="sub">
          {readOnly
            ? `${ownerName || 'Another coach'}'s session. You can view it and watch it live, but only the owner or an admin can change or drive it.`
            : 'Drag to reorder · pull drills from the library or start from a template.'}
        </div>
      </div>
    </div>
  )
}

// The two "add an activity" buttons under the timeline. Adding a drill or a
// custom activity edits the draft, so both freeze while a write is in flight.
export function AddActivityBar({
  busy,
  onAddLibrary,
  onAddCustom,
}: {
  busy: boolean
  onAddLibrary: () => void
  onAddCustom: () => void
}) {
  return (
    <div className="row" style={{ gap: 10, marginTop: 4 }}>
      <button className="add-slot" style={{ marginBottom: 0 }} disabled={busy} onClick={onAddLibrary}>
        <Icon.plus />
        Add from library
      </button>
      <button className="add-slot" style={{ marginBottom: 0 }} disabled={busy} onClick={onAddCustom}>
        <Icon.edit />
        Add custom
      </button>
    </div>
  )
}

type SessionFieldKey = 'name' | 'date' | 'time' | 'ageGroup' | 'venue' | 'focus' | 'space' | 'sourceUrl'

// The planner's session details card: the totals header, every session field
// and the tactics board control. Pulled out as a presentational component so
// the static renderer can prove a pending Save or Start freezes every field
// (each edits the draft), while a read-only viewer keeps the same disabled
// fields it always had. readOnly renders the intentions and board read-only;
// busy only ever applies to an editable planner, so frozen is readOnly-or-busy.
export function SessionFieldsView({
  session,
  readOnly,
  busy,
  teams,
  attachedBoardName,
  onField,
  onIntentions,
  onTeam,
  onRemoveBoard,
  onOpenBoardPicker,
}: {
  session: Session
  readOnly: boolean
  busy: boolean
  teams: Team[]
  attachedBoardName?: string
  onField: (k: SessionFieldKey, v: string) => void
  onIntentions: (v: string[]) => void
  onTeam: (v: string) => void
  onRemoveBoard: () => void
  onOpenBoardPicker: () => void
}) {
  const frozen = readOnly || busy
  const mins = session.activities.reduce((a, x) => a + (x.duration || 0), 0)
  return (
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
        <input value={session.name} disabled={frozen} onChange={(e) => onField('name', e.target.value)} />
      </div>
      <div className="row" style={{ gap: 10 }}>
        <div className="field" style={{ flex: 1 }}>
          <label>Date</label>
          <input type="date" value={session.date} disabled={frozen} onChange={(e) => onField('date', e.target.value)} />
        </div>
        <div className="field" style={{ width: 110 }}>
          <label>Time</label>
          <input type="time" value={session.time} disabled={frozen} onChange={(e) => onField('time', e.target.value)} />
        </div>
      </div>
      <div className="row" style={{ gap: 10 }}>
        <div className="field" style={{ flex: 1 }}>
          <label>Age group</label>
          <select value={session.ageGroup} disabled={frozen} onChange={(e) => onField('ageGroup', e.target.value)}>
            {['U6s', 'U7s', 'U8s', 'U9s', 'U10s', 'U11s', 'U12s'].map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>Venue</label>
          <input value={session.venue} disabled={frozen} onChange={(e) => onField('venue', e.target.value)} />
        </div>
      </div>
      <div className="row" style={{ gap: 10 }}>
        <div className="field" style={{ flex: 1 }}>
          <label>Team</label>
          <select value={session.teamId ?? ''} disabled={frozen} onChange={(e) => onTeam(e.target.value)}>
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
          <input value={session.focus} disabled={frozen} onChange={(e) => onField('focus', e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label>Space</label>
        <input
          value={session.space}
          placeholder="e.g. Third of a pitch"
          disabled={frozen}
          onChange={(e) => onField('space', e.target.value)}
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
            onChange={onIntentions}
            placeholder="Type an intention and press enter"
            disabled={busy}
          />
        )}
      </div>
      <div className="field">
        <label>Source link</label>
        <input
          type="url"
          value={session.sourceUrl}
          placeholder="https://… where this session came from"
          disabled={frozen}
          onChange={(e) => onField('sourceUrl', e.target.value)}
        />
      </div>
      <div className="field">
        <label>Tactics board</label>
        {session.boardId ? (
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <span className="pill" style={{ flex: 1, minWidth: 0 }}>
              <Icon.layers />
              {attachedBoardName ?? 'Attached board'}
            </span>
            {!readOnly && (
              <>
                <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={onOpenBoardPicker}>
                  Change
                </button>
                <button
                  type="button"
                  className="btn btn-quiet btn-sm icon-only"
                  aria-label="Remove board"
                  disabled={busy}
                  onClick={onRemoveBoard}
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
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={onOpenBoardPicker}>
            <Icon.plus />
            Attach a board
          </button>
        )}
      </div>
    </div>
  )
}

// The planner's editable working region (the timeline and the side panel).
// aria-busy marks it while a write settles, so assistive tech can defer the
// in-region label changes; it clears before the failure alert renders (the
// pending flag is cleared first and React batches the two updates into one
// commit), so the alert still announces. Pulled out so the static renderer can
// assert the aria-busy binding without mounting the whole editor.
export function PlannerWorkspace({ busy, children }: { busy: boolean; children: ReactNode }) {
  return (
    <div className="planner" aria-busy={busy}>
      {children}
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

  // Internal share state. The share hook holds the copy or native-share outcome
  // for the feedback line. baseline and savedId track the last successful save,
  // so the draft's dirtiness is known and a saved, unchanged session shares its
  // canonical URL with no second write. Both seed from the loaded session and
  // advance after a Save and share, so once saved the control needs no re-save.
  const { share, feedback: shareFeedback } = useShare()
  const [baseline, setBaseline] = useState<string | null>(() => sessionBaseline(existing))
  const [savedId, setSavedId] = useState<string | null>(existing?.id ?? null)

  // Visibility is club-wide, so any coach can open any club session here.
  // Editing mirrors the sessions update RLS arms: sessions.manage on any
  // session, the owner on their own (the route already requires
  // sessions.create); everyone else gets a read-only view of the plan. The
  // sessions RLS enforces the same rule on write.
  const readOnly = !!existing && existing.coachId !== user?.id && !caps.has('sessions.manage')
  const owner = existing ? memberById[existing.coachId] : undefined

  const setField = (k: SessionFieldKey, v: string) => setSession((s) => ({ ...s, [k]: v }))
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
  // A Plan from Spond create (shown only for a new session) runs its own
  // guarded submit and reports its pending state here, so it composes into the
  // planner's busy state below. That freezes Save, Start, the fields and the
  // navigation while a Spond-derived session is being created, and blocks a
  // second create from starting, so the two flows never write concurrently
  // from one planner screen.
  const [spondPending, setSpondPending] = useState(false)
  // Constructed once so the shared in-flight guard survives re-renders. The
  // captured upsert delegates to the mutation's stable mutateAsync and the
  // captured nav only pushes absolute routes, so first-render captures stay
  // correct for the life of the editor.
  const [actions] = useState<PlannerActions>(() =>
    createPlannerActions({
      upsert: (draft) => upsertSession(draft),
      navSessions: () => nav('sessions'),
      navLive: (id) => nav('live', { sessionId: id }),
      shareSaved: (saved, draft) => {
        // The write resolved. Record the saved id and a fresh baseline so the
        // draft now reads clean (a later share needs no second write), then
        // share the canonical saved-session URL. Built from the server-returned
        // id, never from stale or pre-save data. Runs only on success and only
        // while the guard is active, so an unmounted editor shares nothing.
        setSavedId(saved.id)
        setBaseline(sessionBaseline(draft))
        share({ url: canonicalUrl('session', saved.id), title: draft.name, text: draft.name })
      },
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

  // While an editable Save or Start is in flight, or a Plan from Spond create
  // is running on this screen, freeze every control that could change or
  // abandon the draft, so the visible draft cannot drift from the one being
  // written: an older attempt resolving must not navigate away over newer,
  // unwritten edits. Save and Start stay disabled (as before); this extends the
  // freeze to the fields, the activity controls, template loading, board
  // changes, Spond linking, delete and the back and Session day navigation.
  // Passive viewing (expanding a drill, watching a preview) and the read-only
  // Watch live path are untouched. A read-only viewer starts no write and never
  // sees Plan from Spond, so busy stays false for them; the failure path clears
  // pendingAction, re-enabling everything for a retry.
  const busy = plannerBusy(pendingAction, spondPending)

  // Both submit the draft as currently visible, so a retry after more edits
  // carries the latest state, never a payload captured by the failed attempt.
  // The busy guard also blocks a Save or Start from starting while a Spond
  // create is in flight (belt and braces beyond the disabled buttons), so the
  // two create paths on this screen cannot run at once. A read-only viewer is
  // never busy, so Watch live still navigates immediately.
  const save = () => {
    if (busy) return
    void actions.save(session)
  }
  const start = () => {
    if (busy && !readOnly) return
    void actions.start(session, readOnly)
  }

  // Share decides between a direct share and Save and share. A session that is
  // saved (has a stable id) and unchanged since that save shares its canonical
  // URL with no write; a read-only viewer never dirties the draft, so they take
  // this path too. A new or dirty draft saves through the guarded seam first and
  // shares only after the save resolves, so the link is never built from stale
  // or pre-save data and a rapid double click fires one save (the shared guard).
  const dirty = sessionDirty(session, baseline)
  const canShareDirect = savedId !== null && !dirty
  const shareLabel = canShareDirect ? 'Share' : 'Save and share'
  const shareNote = canShareDirect ? SHARE_ACCOUNT_NOTE : `${SAVE_AND_SHARE_NOTE} ${SHARE_ACCOUNT_NOTE}`
  const onShare = () => {
    if (busy) return
    if (canShareDirect && savedId) {
      share({ url: canonicalUrl('session', savedId), title: session.name, text: session.name })
    } else {
      void actions.saveAndShare(session)
    }
  }

  return (
    <div>
      <PlannerHeaderView
        readOnly={readOnly}
        isExisting={!!existing}
        ownerName={owner?.fullName}
        busy={busy}
        onBack={() => nav('sessions')}
      />

      <PlannerWorkspace busy={busy}>
        <div className="timeline-wrap">
          {/* A new session can start from a synced Spond event: picking one
              creates its own pre filled session and navigates there, so the
              surface shows only while building a fresh plan. */}
          {!existing && <PlanFromSpond frozen={busy} onPendingChange={setSpondPending} />}
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
                  busy={busy}
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
            <AddActivityBar
              busy={busy}
              onAddLibrary={() => setAddOpen(true)}
              onAddCustom={() => addActivities([{ phase: 'Skill', title: 'Custom activity', duration: 10 }])}
            />
          )}
        </div>

        <div className="planner-side">
          <SessionFieldsView
            session={session}
            readOnly={readOnly}
            busy={busy}
            teams={teams}
            attachedBoardName={attachedBoard?.name}
            onField={setField}
            onIntentions={setIntentions}
            onTeam={setTeam}
            onRemoveBoard={() => setBoard(null)}
            onOpenBoardPicker={() => setBoardPickerOpen(true)}
          />

          {/* Linking edits the draft like every other planner field; Save
              writes it with the session. It freezes while a write is in
              flight, so the draft cannot change under an in-flight save. */}
          <SpondAttendanceCard
            spondEventId={session.spondEventId}
            teamId={session.teamId}
            date={session.date}
            time={session.time}
            canEdit={!readOnly}
            busy={busy}
            onLink={(id) => setSession((s) => ({ ...s, spondEventId: id }))}
          />

          <PlannerActionsView
            readOnly={readOnly}
            isExisting={!!existing}
            canStart={session.activities.length > 0}
            pending={pendingAction}
            failed={failedAction}
            shareLabel={shareLabel}
            shareNote={shareNote}
            shareFeedback={shareFeedback}
            onStart={start}
            onSave={save}
            onShare={onShare}
            onSessionDay={() => nav('sessionDay', { sessionId: session.id })}
            onCalendar={() => downloadSessionIcs(session)}
            onLoadTemplate={() => nav('templates')}
            onDelete={() => setDeleteOpen(true)}
          />
        </div>
      </PlannerWorkspace>

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
