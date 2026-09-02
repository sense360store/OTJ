import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
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
  useVenues,
} from '../lib/queries'
import { ActivityStructureSummary } from '../components/ActivityRoleControls'
import { type ActivityRole, applyRole, setNotRunning } from '../lib/activityRole'
import { blankSession, embedSrc, isSampleMedia, sessionMinutes } from '../lib/data'
import type { Activity, Drill, MediaItem, Phase, Session, Team } from '../lib/data'
import type { Venue } from '../lib/venues'
import { newSessionCoverage, soleCoveredTeamId, toggleCoveredTeam } from '../lib/sessionTeams'
import { isFaVideo } from '../lib/fa'
import { Icon } from '../components/icons'
import {
  ActionError,
  Empty,
  ErrorNote,
  ListInput,
  Loading,
  MediaAttribution,
  MediaThumb,
  ShareControlView,
  SourceLink,
} from '../components/ui'
import { ActivityListEditor, type SessionRowContent } from '../components/ActivityListEditor'
import {
  createPlannerActions,
  logSessionWriteError,
  plannerBusy,
  sessionBaseline,
  sessionDirty,
  shareDecision,
  SESSION_SAVE_ERROR,
  SESSION_SHARE_ERROR,
  SESSION_START_ERROR,
} from '../lib/sessionSubmit'
import type { PlannerAction, PlannerActions } from '../lib/sessionSubmit'
import { useShare } from '../hooks/useShare'
import { canonicalUrl, SAVE_AND_SHARE_NOTE, SHARE_ACCOUNT_NOTE, type ShareFeedback } from '../lib/share'
import { ActivityDiagram } from '../components/ActivityDiagram'
import { AddDrillModal } from '../components/AddDrillModal'
import { BoardPickerModal } from '../components/BoardPicker'
import { DeleteSessionModal } from '../components/DeleteSessionModal'
import { DiagramViewer } from '../components/DiagramViewer'
import { MediaPlayerModal } from '../components/MediaPlayerModal'
import { SpondAttendanceCard } from '../components/SpondAttendance'
import { downloadSessionIcs } from '../lib/ics'
import { PlanFromSpond } from '../components/PlanFromSpond'
import { RightsControl } from '../components/RightsControl'

// COACH-10: the activity row, the add bar and the list itself live in the
// shared authoring seam now, mounted below by PlannerEditor and by the
// week-plan editor alike. Re-exported so existing imports (and the suites
// that pin the row's behaviour) keep their one path.
export { ActivityCardView, AddActivityBar } from '../components/ActivityListEditor'

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
  // "Copy the club link" for a saved, clean session (no write) or "Save and copy
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
        <h1>{readOnly ? 'View session' : isExisting ? 'Edit session' : 'Plan a session'}</h1>
        <div className="sub">
          {readOnly
            ? `${ownerName || 'Another coach'}'s session. You can view it and watch it live, but only the owner or an admin can change or drive it.`
            : 'Drag to reorder · pull drills from the library or start from a template.'}
        </div>
      </div>
    </div>
  )
}

type SessionFieldKey = 'name' | 'date' | 'time' | 'ageGroup' | 'focus' | 'space' | 'sourceUrl'

// The covered teams control. Coverage is a set, not one team: a Thursday
// night that runs Titans and Trojans together is the normal case, and the
// register lists exactly what is ticked here. Nothing ticked is a real
// state and says so, rather than being read as the whole club.
export function CoveredTeamsField({
  teams,
  selected,
  disabled,
  readOnly,
  onToggle,
  onAll,
}: {
  teams: Team[]
  selected: string[]
  disabled: boolean
  readOnly: boolean
  onToggle: (teamId: string) => void
  onAll: () => void
}) {
  const all = teams.length > 0 && teams.every((t) => selected.includes(t.id))
  if (readOnly) {
    const names = teams.filter((t) => selected.includes(t.id)).map((t) => t.name)
    return (
      <div className="field">
        <label>Teams</label>
        {names.length === 0 ? (
          <span className="muted" style={{ fontSize: 13 }}>
            Not set
          </span>
        ) : (
          <div className="row wrap" style={{ gap: 6 }}>
            {(all ? ['All teams'] : names).map((n) => (
              <span key={n} className="pill">
                {n}
              </span>
            ))}
          </div>
        )}
      </div>
    )
  }
  return (
    <div className="field">
      <label>Teams</label>
      <div className="row wrap" style={{ gap: 7 }}>
        <button
          type="button"
          className={'chip' + (all ? ' on' : '')}
          style={{ minHeight: 44 }}
          aria-pressed={all}
          disabled={disabled || teams.length === 0}
          onClick={onAll}
        >
          All teams
        </button>
        {teams.map((t) => {
          const on = selected.includes(t.id)
          return (
            <button
              key={t.id}
              type="button"
              className={'chip' + (on ? ' on' : '')}
              style={{ minHeight: 44 }}
              aria-pressed={on}
              disabled={disabled}
              onClick={() => onToggle(t.id)}
            >
              {t.name}
            </button>
          )
        })}
      </div>
      {selected.length === 0 && (
        <span className="muted" style={{ fontSize: 12.5, marginTop: 6, display: 'block' }}>
          No teams selected, so the register will list nobody.
        </span>
      )}
    </div>
  )
}

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
  venues,
  venuesUnavailable,
  attachedBoardName,
  onField,
  onIntentions,
  onVenue,
  onToggleTeam,
  onAllTeams,
  onRemoveBoard,
  onOpenBoardPicker,
}: {
  session: Session
  readOnly: boolean
  busy: boolean
  teams: Team[]
  venues: Venue[]
  // True when the venue list could not be read. "We could not load the
  // venues" must not render as "your club has none".
  venuesUnavailable: boolean
  attachedBoardName?: string
  onField: (k: SessionFieldKey, v: string) => void
  onIntentions: (v: string[]) => void
  onVenue: (v: string | null) => void
  onToggleTeam: (teamId: string) => void
  onAllTeams: () => void
  onRemoveBoard: () => void
  onOpenBoardPicker: () => void
}) {
  const frozen = readOnly || busy
  // The "min total" headline the coach reads while standing a station down.
  // It used to be an inline reduce of its own, which made it a fourth answer
  // to how long a session runs and the one most likely to disagree, because
  // it is the number changing under the coach's finger. It reads the shared
  // seam now, so the active duration rule reaches it by construction.
  const mins = sessionMinutes(session)
  return (
    <div className="card side-card">
      <div className="total-time" style={{ marginBottom: 4 }}>
        <span className="big">{mins}</span>
        <span className="muted" style={{ fontWeight: 700 }}>
          min total
        </span>
      </div>
      <div className="muted" style={{ fontSize: 13, marginBottom: 10 }}>
        {session.activities.length} activities
      </div>
      {/* COACH-2B. What this plan declares, beside the number it produces.
          Warnings are stated and never block: a coach who declares three
          stations is told, and Save stays available. */}
      <div style={{ marginBottom: 14 }}>
        <ActivityStructureSummary activities={session.activities} />
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
          <label>Focus</label>
          <input value={session.focus} disabled={frozen} onChange={(e) => onField('focus', e.target.value)} />
        </div>
      </div>
      {/* Venue is one of the club's real places now, not free text, so
          every session at Springmill agrees on the name. A session saved
          before venues existed keeps its typed venue as a read only line
          until someone picks a real one. */}
      <div className="field">
        <label>Venue</label>
        <select
          value={session.venueId ?? ''}
          disabled={frozen}
          onChange={(e) => onVenue(e.target.value || null)}
        >
          <option value="">Not set</option>
          {venues.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
        {!session.venueId && session.venue && (
          <span className="muted" style={{ fontSize: 12.5, marginTop: 6, display: 'block' }}>
            Previously typed as “{session.venue}”. Pick a venue to replace it.
          </span>
        )}
        {venues.length === 0 && (
          <span className="muted" style={{ fontSize: 12.5, marginTop: 6, display: 'block' }}>
            {venuesUnavailable
              ? 'Could not load the venues. The one already saved on this session is unchanged.'
              : 'No venues yet. An admin adds them under Admin, Venues.'}
          </span>
        )}
      </div>
      <CoveredTeamsField
        teams={teams}
        selected={session.teamIds}
        disabled={busy}
        readOnly={readOnly}
        onToggle={onToggleTeam}
        onAll={onAllTeams}
      />
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
  // Who owns a new session, and nothing else. It used to carry the coach's
  // profile team as well, which seeded coverage before the coach had seen
  // the chips; the team is gone from the prop rather than defaulted, so it
  // cannot come back by a caller passing it again.
  newDefaults?: { coachId: string }
}) {
  const nav = useNav()
  const { user } = useAuth()
  const { caps } = useMyCapabilities()
  const { upsertSession } = useSessions()
  const { data: teams = [] } = useTeams()
  const venuesQuery = useVenues()
  const venues = venuesQuery.data ?? []
  const { data: boards = [] } = useBoards()
  const memberById = useMemberMap()
  // The lookups only this host can resolve for the shared editor's rows.
  // They lived in a per-row wrapper before COACH-10; the same cached reads
  // happen once here and the editor receives plain values and nodes.
  const drillById = useDrillMap()
  const mediaById = useMediaMap()
  const actTitle = useActivityTitle()

  const [session, setSession] = useState<Session>(() =>
    existing
      ? (JSON.parse(JSON.stringify(existing)) as Session)
      : blankSession(newDefaults?.coachId ?? ''),
  )

  // EVERY new session starts covering the whole club, seeded once the team
  // list arrives. Seeding here rather than at save time means the chips
  // show what will be written; nothing is invented later.
  //
  // It used to run only for a coach whose profile named no team, because
  // blankSession had already seeded the others with that team. So a coach
  // whose profile said Trojans opened New Session and found Trojans
  // already ticked, and a club wide Tuesday saved as a Trojans session
  // with nothing on screen saying a choice had been made for them. The
  // profile team is a personal default about the coach; coverage is a
  // statement about the night. newSessionCoverage in ../lib/sessionTeams
  // is the one rule now, shared with the two paths that save before the
  // coach sees anything.
  //
  // ONCE, and only into a draft nobody has touched. The ref is set the
  // first time the team list answers, so a later refetch, a team added or
  // a team deleted cannot rewrite a draft the coach has since edited, and
  // the emptiness check means a coach who has cleared every team keeps an
  // empty selection. An existing session never seeds at all: its stored
  // coverage is the answer, and a one team session must never widen for
  // being opened.
  //
  // This path does NOT wait for the team read the way Plan from Spond and
  // Use template do, and the difference is deliberate. Those two save a
  // session before the coach sees anything and drop them into a planner
  // that will not re-seed a stored row, so an unanswered read there
  // writes a register listing nobody with no visible cause. Here the
  // coach is looking at the form: with no teams read there are no chips
  // to press, the Teams row says the coverage is not set, and saving
  // early leaves a session they can correct in one tap on the screen they
  // are already on. Blocking Save over a sub second read, or over a
  // failed one, would cost more than it saves.
  const coverageSeeded = useRef(!!existing)
  useEffect(() => {
    if (coverageSeeded.current || teams.length === 0) return
    coverageSeeded.current = true
    setSession((s) => (s.teamIds.length > 0 ? s : { ...s, teamIds: newSessionCoverage(teams.map((t) => t.id)) }))
  }, [teams])
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
  const { share, reset: resetShare, feedback: shareFeedback } = useShare()
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
  const setVenue = (v: string | null) => setSession((s) => ({ ...s, venueId: v }))
  const toggleTeam = (teamId: string) =>
    setSession((s) => ({ ...s, teamIds: toggleCoveredTeam(s.teamIds, teamId) }))
  // All teams is a toggle: pressed when everything is already ticked it
  // clears the lot, which is how a coach starts again from one team.
  const allTeams = () =>
    setSession((s) => {
      const every = teams.length > 0 && teams.every((t) => s.teamIds.includes(t.id))
      return { ...s, teamIds: every ? [] : teams.map((t) => t.id) }
    })
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
  // COACH-2B. Both go through the pure rules in ../lib/activityRole, which own
  // exactly what each press writes and removes: a role change never touches
  // `phase`, and it clears any stand-down so stale session-local state cannot
  // follow an activity into another role. Draft edits like every other control
  // here; nothing autosaves.
  const setRole = (i: number, role: ActivityRole) =>
    setSession((s) => {
      const a = [...s.activities]
      a[i] = applyRole(a[i], role)
      return { ...s, activities: a }
    })
  const setStandDown = (i: number, on: boolean) =>
    setSession((s) => {
      const a = [...s.activities]
      a[i] = setNotRunning(a[i], on)
      return { ...s, activities: a }
    })
  const addActivities = (items: Activity[]) => setSession((s) => ({ ...s, activities: [...s.activities, ...items] }))

  // One dated row's resolved content for the shared editor. A drillId whose
  // drill was deleted resolves to null; the row stays usable with a removed
  // drill placeholder from actTitle and is not expandable. The two panel
  // nodes are built lazily in effect: each element only renders, and so only
  // mints a signed URL or fires the diagram read, when the panel is open.
  const rowContent = (act: Activity): SessionRowContent => {
    const drill = act.drillId ? (drillById[act.drillId] ?? null) : null
    const media = drill && drill.mediaId ? (mediaById[drill.mediaId] ?? null) : null
    return {
      title: actTitle(act),
      drill,
      thumb: <MediaThumb media={media} showPlay={false} showBadge={false} label="" />,
      expandedMedia: drill ? <ActivityPanelMedia media={media} drill={drill} /> : null,
      expandedDiagram: drill ? <ActivityDiagram drill={drill} className="dd-in-panel" /> : null,
      drillHref: drill ? `/drill/${drill.id}` : '',
    }
  }

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
  const canShareDirect = shareDecision(savedId, dirty) === 'direct'
  // Named for what it does, not just "Share". The session day page's Share
  // action opens the dialog that offers the club link AND the public link; this
  // one only ever copies the club link, and two identically labelled buttons
  // that do different things is the confusion this whole change removes.
  const shareLabel = canShareDirect ? 'Copy the club link' : 'Save and copy the club link'
  const shareNote = canShareDirect ? SHARE_ACCOUNT_NOTE : `${SAVE_AND_SHARE_NOTE} ${SHARE_ACCOUNT_NOTE}`
  const onShare = () => {
    if (busy) return
    if (canShareDirect && savedId) {
      share({ url: canonicalUrl('session', savedId), title: session.name, text: session.name })
    } else {
      // Deferred share: clear any stale prior outcome as the attempt starts, so
      // a save failure below shows only its own error, never a lingering "Link
      // copied" from an earlier direct share.
      resetShare()
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
          {/* COACH-10: the one shared activity-list editor, mounted here and
              by the week-plan editor. The planner supplies what only it owns:
              the resolved row content, the empty state, the drag mechanics,
              the busy freeze and the session-local stand-down. */}
          <ActivityListEditor
            activities={session.activities}
            variant={{
              kind: 'session',
              readOnly,
              busy,
              empty: (
                <div className="card" style={{ padding: 0 }}>
                  <Empty icon={Icon.layers} title="Empty session">
                    {readOnly ? 'No activities in this session yet.' : 'Add drills from the library or load a template to get started.'}
                  </Empty>
                </div>
              ),
              expandedIdx,
              onToggle: (i) => setExpandedIdx((cur) => (cur === i ? null : i)),
              onStandDown: setStandDown,
              draggingIdx: dragIdx,
              dragHandlersFor: (i) => ({
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
              }),
              content: rowContent,
            }}
            onPhase={setPhase}
            onDuration={setDur}
            onRole={setRole}
            onRemove={removeAct}
            onAddLibrary={() => setAddOpen(true)}
            onAddCustom={() => addActivities([{ phase: 'Skill', title: 'Custom activity', duration: 10 }])}
          />
        </div>

        <div className="planner-side">
          <SessionFieldsView
            session={session}
            readOnly={readOnly}
            busy={busy}
            teams={teams}
            venues={venues}
            venuesUnavailable={venuesQuery.isError}
            attachedBoardName={attachedBoard?.name}
            onField={setField}
            onIntentions={setIntentions}
            onVenue={setVenue}
            onToggleTeam={toggleTeam}
            onAllTeams={allTeams}
            onRemoveBoard={() => setBoard(null)}
            onOpenBoardPicker={() => setBoardPickerOpen(true)}
          />

          {/* The session's sharing level, in the ordinary edit flow. It saves on
              its own and writes only the rights column, so a planner Save never
              changes it and nothing is promoted as a side effect. Only a saved
              session has a row to classify. */}
          {existing && !readOnly && (
            <div className="card side-card">
              <RightsControl
                kind="session"
                id={existing.id}
                current={existing.rights}
                source={{ sourceUrl: existing.sourceUrl, sourceLabel: existing.sourceLabel }}
                canEdit
              />
            </div>
          )}

          {/* Linking edits the draft like every other planner field; Save
              writes it with the session. It freezes while a write is in
              flight, so the draft cannot change under an in-flight save. */}
          <SpondAttendanceCard
            spondEventId={session.spondEventId}
            teamId={soleCoveredTeamId(session)}
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
            onCalendar={() => downloadSessionIcs(session, venues.find((v) => v.id === session.venueId)?.name ?? null)}
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
          defaultTeamId={soleCoveredTeamId(session)}
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
  const { user } = useAuth()
  const editId = searchParams.get('sessionId')
  // Editing reads the one session by id; a new session has none to read and so
  // renders straight away. The key remounts the editor with fresh state
  // whenever the URL selects a different session.
  //
  // A new session's key is CONSTANT. It used to change when the profile
  // arrived, so the draft was thrown away and rebuilt around the coach's
  // team. Nothing about a new draft depends on the profile any more, and
  // remounting on a late read would now discard whatever the coach had
  // already typed and unticked.
  const { data: existing, isLoading, isError } = useSession(editId ?? undefined)
  if (editId && isLoading) return <Loading />
  if (editId && isError) return <ErrorNote />
  if (editId && existing) return <PlannerEditor key={editId} existing={existing} />
  return <PlannerEditor key="new" existing={null} newDefaults={{ coachId: user?.id ?? '' }} />
}
