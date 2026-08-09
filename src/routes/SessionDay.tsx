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
import {
  useActivityTitle,
  useBoard,
  useDrillMap,
  useLinkSessionBoard,
  useLinkSessionSpondEvent,
  useMediaMap,
  useMyCapabilities,
  usePlayers,
  useProgrammeMap,
  useSession,
  useSetSessionSetup,
  useTeamMap,
  useVenueAreas,
} from '../lib/queries'
import { sessionMinutes } from '../lib/data'
import { sessionTeamsLabel, soleCoveredTeamId } from '../lib/sessionTeams'
import { areaFrame, schematicStations, sessionKit } from '../lib/sessionSetup'
import type { Activity, Drill, MediaItem, Session } from '../lib/data'
import { Icon } from '../components/icons'
import { Empty, ErrorNote, fmtDate, Loading, MediaThumb, PHASE_COLOR, SourceLink } from '../components/ui'
import { DeleteSessionModal } from '../components/DeleteSessionModal'
import { DiagramViewer } from '../components/DiagramViewer'
import type { DiagramSlide } from '../components/DiagramViewer'
import { SpondAttendanceCard } from '../components/SpondAttendance'
import { BoardPickerModal } from '../components/BoardPicker'
import { ShareButton } from '../components/ShareButton'
import { PublicShareControl } from '../components/PublicShareControl'
import { TacticsBoardView } from '../components/TacticsBoardView'
import { SetupPlanView } from '../components/SetupSchematic'
import { SetupComposerModal } from '../components/SetupComposer'
import { SetupSheet } from '../components/SetupSheet'
import { playerNameMap, type Board, type PlayerNameMap } from '../lib/tacticsBoard'
import './SessionDay.css'
// The embedded board reuses the tactics board's pitch and disc styles.
import './Board.css'

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
  const { user } = useAuth()
  const { caps } = useMyCapabilities()
  const drillById = useDrillMap()
  const mediaById = useMediaMap()
  const teamById = useTeamMap()
  const actTitle = useActivityTitle()
  // Driving, editing and deleting all follow the sessions update RLS arms:
  // sessions.manage on any session, an owner holding sessions.create on
  // their own. The capability condition matters for a coach demoted to
  // parent, who still matches coach_id on old sessions. The same link opens
  // the live view for everyone; the label says whether this user will drive
  // it or watch it.
  const canManage =
    caps.has('sessions.manage') || (caps.has('sessions.create') && session.coachId === user?.id)
  const canDrive = canManage
  // Sharing this saved session's canonical link is a coaching affordance shown
  // to any coach (sessions.create), not only the owner or a manager, and hidden
  // from parents. It is a UI decision about who sees the button, not an access
  // boundary: the link is the canonical protected page, grants nothing on its
  // own, and makes no write.
  const canShare = caps.has('sessions.create')
  // Public sharing is a separate, gated affordance from the internal club link:
  // it publishes a login-free snapshot. Publish/manage needs shares.create plus
  // ownership or session manage (the server re-enforces this); a shares.manage
  // holder may turn off any club link. Parents see neither. The UI decides only
  // what to surface; the lifecycle RPC is the boundary.
  const canPublishShare = caps.has('shares.create') && canManage
  const canRevokeAnyShare = caps.has('shares.manage')
  const [tab, setTab] = useState<Tab>('setup')
  const [viewerAt, setViewerAt] = useState<number | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [checked, setChecked] = useState<string[]>(() => loadChecked(session.id))
  // Linking writes at once here, unlike the planner's draft: this view shows
  // the saved session, so there is no save step to ride.
  const linkSpond = useLinkSessionSpondEvent()

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

  // The kit list is the union of equipment across the session's drills plus
  // the pieces every drill diagram counts, each line remembering which
  // drills need it, in session order. Counts are the most a single drill
  // needs, not the sum: the drills run one after another.
  const kit = useMemo(
    () =>
      sessionKit(
        rows
          .map((r) => r.drill)
          .filter((d): d is Drill => !!d)
          .map((d) => ({ title: d.title, equipment: d.equipment, layout: d.layout ?? null })),
      ),
    [rows],
  )

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

  // The composed setup, resolved once for the printable sheet; the Setup
  // tab's card resolves the same thing for the screen.
  const { data: venueAreas = [] } = useVenueAreas()
  const setupArea = venueAreas.find((a) => a.id === session.setupAreaId)
  const setupFrame = useMemo(() => (setupArea?.boundary ? areaFrame(setupArea.boundary) : null), [setupArea])
  const sheetDrillAreas = useMemo(
    () => Object.fromEntries(rows.filter((r) => r.drill).map((r) => [r.drill!.id, r.drill!.layout?.area ?? null])),
    [rows],
  )

  const mins = sessionMinutes(session)
  const teamName = sessionTeamsLabel(session, teamById)
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

      {(canManage || caps.has('players.view')) && (
        <div className="row" style={{ gap: 9, marginBottom: 12 }}>
          {/* The Register reads children's names through the players.view
              gated read, so the button follows that capability, not session
              ownership: any coach staffing the gate opens it. */}
          {caps.has('players.view') && (
            <button className="btn btn-ghost btn-sm" onClick={() => nav('register', { sessionId: session.id })}>
              <Icon.users />
              Register
            </button>
          )}
          {canManage && (
            <>
              <button className="btn btn-ghost btn-sm" onClick={() => nav('planner', { sessionId: session.id })}>
                <Icon.edit />
                Edit plan
              </button>
              <button
                className="btn btn-ghost btn-sm icon-only"
                style={{ width: 38, padding: 0 }}
                aria-label="Delete session"
                onClick={() => setDeleting(true)}
              >
                <Icon.trash />
              </button>
            </>
          )}
        </div>
      )}

      {canShare && (
        <div style={{ marginBottom: 12 }}>
          <ShareButton kind="session" id={session.id} title={session.name} />
        </div>
      )}

      {(canPublishShare || canRevokeAnyShare) && (
        <PublicShareControl
          kind="session"
          sourceId={session.id}
          title={session.name}
          canPublish={canPublishShare}
          canRevokeAny={canRevokeAnyShare}
        />
      )}

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

      <SpondAttendanceCard
        spondEventId={session.spondEventId}
        teamId={soleCoveredTeamId(session)}
        date={session.date}
        time={session.time}
        canEdit={canManage}
        busy={linkSpond.isPending}
        errorText={linkSpond.isError ? linkSpond.error.message : ''}
        onLink={(id) => linkSpond.mutate({ sessionId: session.id, spondEventId: id })}
        style={{ marginBottom: 12 }}
      />

      {/* The attached tactics board, read only inline. The board row carries
          player ids and numbers, never names; the card resolves names through
          the sessions.create gated players query, so a parent sees the shape
          and numbers with nothing to resolve against. */}
      <SessionBoardCard session={session} canManage={canManage} />

      <SetupSheet
        sessionName={session.name}
        subtitle={subBits.join(' · ')}
        areaName={setupArea?.name ?? ''}
        frame={setupFrame}
        stations={session.setup ? schematicStations(session.setup, drillById) : []}
        drillAreas={sheetDrillAreas}
        kit={kit}
        activities={rows.map((r) => ({ title: actTitle(r.act), phase: r.act.phase, duration: r.act.duration }))}
      />

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
          <SessionSetupCard session={session} canManage={canManage} drills={rows.map((r) => r.drill)} />
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
              None of this session's drills lists equipment or carries a diagram.
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
                      <span className="sd-kit-name">
                        {item.count === null ? item.name : `${item.count} ${item.name}`}
                      </span>
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
      {deleting && <DeleteSessionModal s={session} onClose={() => setDeleting(false)} onDeleted={() => nav('sessions')} />}
    </div>
  )
}

// The attached board section, presentational so the read only render and the
// attach affordances can be exercised without the data hooks or a query
// client. The container resolves the board and wires the link mutation.
//
// When nothing is attached and the viewer cannot edit (a parent, or another
// coach's session), the card renders nothing rather than an empty shell. With
// a board it shows the read only renderer. The board's tokens carry player
// ids, never names (tacticsBoard.ts); the optional names map resolves them,
// and the container only builds one for a sessions.create holder, so a
// parent's render has no name anywhere in its inputs.
export function SessionBoardCardView({
  board,
  boardId,
  names,
  canEdit,
  onAttach,
  onRemove,
}: {
  board: Board | null
  boardId: string | null
  names?: PlayerNameMap
  canEdit: boolean
  onAttach: () => void
  onRemove: () => void
}) {
  if (!boardId && !canEdit) return null
  return (
    <div className="card sd-board-card">
      <div className="sd-board-head">
        {/* The heading icon carries no intrinsic size of its own, so it is
            constrained here to a small muted marker. Left unsized it expands to
            fill the card, the empty state's giant dark chevron. --slate-2 is the
            muted token the app's other empty-state graphics use (.empty svg). */}
        <Icon.layers size={20} style={{ color: 'var(--slate-2)', flex: '0 0 auto' }} />
        <h4>{board ? board.name : 'Tactics board'}</h4>
        {canEdit && (
          <div className="sd-board-actions">
            <button type="button" className="btn btn-ghost btn-sm" onClick={onAttach}>
              {boardId ? 'Change' : 'Attach'}
            </button>
            {boardId && (
              <button
                type="button"
                className="btn btn-quiet btn-sm icon-only"
                aria-label="Remove board"
                onClick={onRemove}
              >
                <Icon.x />
              </button>
            )}
          </div>
        )}
      </div>
      {board ? (
        <TacticsBoardView tokens={board.tokens} names={names} />
      ) : boardId ? (
        <p className="muted" style={{ fontSize: 13.5, margin: 0 }}>
          This board is not available.
        </p>
      ) : (
        <p className="muted" style={{ fontSize: 13.5, margin: 0 }}>
          No board attached. Attach one to show the shape here.
        </p>
      )}
    </div>
  )
}

// The composed setup, at the top of the Setup tab: the venue area with the
// session's stations on it, scale true, and the same picture the printed
// sheet and the live view show. Composing is a session write, so it
// follows the same ownership as editing the plan; everyone else reads it.
function SessionSetupCard({
  session,
  canManage,
  drills,
}: {
  session: Session
  canManage: boolean
  drills: (Drill | null)[]
}) {
  const { data: areas = [] } = useVenueAreas()
  const save = useSetSessionSetup()
  const [composing, setComposing] = useState(false)
  const area = areas.find((a) => a.id === session.setupAreaId)
  const frame = useMemo(() => (area?.boundary ? areaFrame(area.boundary) : null), [area])
  // Only the session's own drills can be bound, and their titles and
  // declared areas are what the plan reads back.
  const sessionDrills = useMemo(() => {
    const seen = new Map<string, Drill>()
    for (const d of drills) if (d && !seen.has(d.id)) seen.set(d.id, d)
    return [...seen.values()]
  }, [drills])
  const drillById = useMemo(() => Object.fromEntries(sessionDrills.map((d) => [d.id, d])), [sessionDrills])
  const drillAreas = useMemo(
    () => Object.fromEntries(sessionDrills.map((d) => [d.id, d.layout?.area ?? null])),
    [sessionDrills],
  )
  const setup = session.setup ?? null
  if (!canManage && (!setup || !frame)) return null
  return (
    <div className="sd-card">
      <div className="sd-card-head">
        <h4>Setup plan</h4>
        {canManage && (
          <button className="btn btn-ghost btn-sm" onClick={() => setComposing(true)}>
            <Icon.ruler />
            {setup ? 'Edit setup' : 'Compose setup'}
          </button>
        )}
      </div>
      {setup && frame && area && (
        <button className="btn btn-quiet btn-sm" style={{ marginBottom: 8 }} onClick={() => window.print()}>
          <Icon.list />
          Print setup sheet
        </button>
      )}
      {setup && frame && area ? (
        <SetupPlanView
          frame={frame}
          stations={schematicStations(setup, drillById)}
          areaName={area.name}
          drillAreas={drillAreas}
        />
      ) : setup && !frame ? (
        <p className="muted" style={{ fontSize: 13.5, margin: 0 }}>
          The area this setup was laid out on is no longer configured. Compose it again on a current area.
        </p>
      ) : (
        <p className="muted" style={{ fontSize: 13.5, margin: 0 }}>
          No setup composed. Lay the stations out on a venue area to see where everything goes.
        </p>
      )}
      {composing && (
        <SetupComposerModal
          areas={areas}
          initialAreaId={session.setupAreaId ?? null}
          initialSetup={setup}
          drills={sessionDrills}
          saving={save.isPending}
          errorText={save.isError ? save.error.message : ''}
          onSave={(areaId, next) =>
            save.mutate(
              { sessionId: session.id, areaId, setup: next },
              { onSuccess: () => setComposing(false) },
            )
          }
          onClose={() => setComposing(false)}
        />
      )}
    </div>
  )
}

function SessionBoardCard({
  session,
  canManage,
}: {
  session: Session
  canManage: boolean
}) {
  const { caps } = useMyCapabilities()
  const { data: board } = useBoard(session.boardId ?? undefined)
  // Name resolution runs only for a players.view holder, mirroring the players
  // RLS since PR 2: a coach or admin fetches the roster and sees names on the
  // embedded board; a parent never issues the query, and the board row they
  // did read holds ids and numbers only.
  const canResolveNames = caps.has('players.view')
  const { data: players = [] } = usePlayers(canResolveNames)
  const names = useMemo(() => playerNameMap(players), [players])
  const link = useLinkSessionBoard()
  const [picking, setPicking] = useState(false)
  return (
    <>
      <SessionBoardCardView
        board={board ?? null}
        boardId={session.boardId}
        names={canResolveNames ? names : undefined}
        canEdit={canManage}
        onAttach={() => setPicking(true)}
        onRemove={() => link.mutate({ sessionId: session.id, boardId: null })}
      />
      {picking && (
        <BoardPickerModal
          currentId={session.boardId}
          defaultTeamId={soleCoveredTeamId(session)}
          onSelect={(id) => link.mutate({ sessionId: session.id, boardId: id })}
          onClose={() => setPicking(false)}
        />
      )}
    </>
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
