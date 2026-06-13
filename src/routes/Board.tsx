// The tactics board: place numbered discs on a pitch, drag them into shape,
// and (phase two) save the board and load it back later. It follows
// sessions.create, the same coaching write capability as the planner, so
// coaches and admins reach it and parents do not. Positions are held as
// fractions of the pitch, the shape the boards table persists, so a saved
// board renders identically at any size.
//
// Saving an already loaded board updates it; a fresh board inserts. Reads are
// club wide, so the saved boards list is every board in the club; a coach
// renames and deletes their own, an admin any. A quiet indicator marks the
// board as having unsaved changes when it differs from the last saved or
// loaded state, so loading another board does not silently lose work; there
// is no autosave.
import { useMemo, useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import {
  useBoards,
  useDeleteBoard,
  useMemberMap,
  useMyCapabilities,
  usePlayers,
  useRenameBoard,
  useSaveBoard,
  useTeamMap,
  useTeams,
} from '../lib/queries'
import {
  boardIsDirty,
  captureBoardEdit,
  FORMATIONS,
  formationPositions,
  nextNumber,
  rosterTokens,
  type Board,
  type BoardEdit,
  type BoardSnapshot,
  type Token,
  type TokenSide,
} from '../lib/tacticsBoard'
import type { Team } from '../lib/data'
import { Icon } from '../components/icons'
import { TacticsPitch } from '../components/TacticsPitch'
import { TacticsBoardView } from '../components/TacticsBoardView'
import { ErrorNote, Loading, Modal } from '../components/ui'
import './Board.css'

// The board page opens read only and enters editing on demand, so a coach can
// scroll the page on a phone (the read only pitch attaches no drag handlers and
// does not capture touch) and only reaches the tools when they choose to edit.
export type BoardMode = 'view' | 'edit'

// A coarse "updated 20 minutes ago" label for the saved boards list. Freshness
// not precision, matching the rest of the app's relative times.
function updatedAgo(iso: string, now: Date = new Date()): string {
  const ms = now.getTime() - Date.parse(iso)
  if (!Number.isFinite(ms)) return ''
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return 'updated just now'
  if (minutes < 60) return `updated ${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `updated ${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  return `updated ${days} day${days === 1 ? '' : 's'} ago`
}

export function Board() {
  const { user, profile } = useAuth()
  const { caps } = useMyCapabilities()
  const isAdmin = caps.has('club.manage')
  const { data: teams } = useTeams()
  const teamList = teams ?? []
  // The roster source: a team's real players, the opt in alternative to the
  // formation picker. The players read is gated on sessions.create by RLS, the
  // same capability that gates this page, so it returns nothing for a parent
  // (who never reaches the board anyway).
  const { data: players = [] } = usePlayers()
  // The team selector frames the board and is saved with it. It defaults to
  // the coach's team; tokens come from the formation picker and the add
  // control until a roster lands.
  const [teamId, setTeamId] = useState<string | null>(null)
  const selectedTeam = teamId ?? profile?.team_id ?? teamList[0]?.id ?? ''

  const [tokens, setTokens] = useState<Token[]>([])
  // The side new tokens and formations take, the "show shape against
  // opposition" control: place one side, switch, place the other.
  const [side, setSide] = useState<TokenSide>('home')
  // The formation the board was last seeded from, saved with it. Empty for a
  // hand placed board.
  const [formation, setFormation] = useState('')

  // The save state: the board's name, the id of the loaded board (null for a
  // fresh one), and the snapshot of the last saved state of the loaded board
  // the unsaved indicator compares against.
  const [name, setName] = useState('')
  const [loadedId, setLoadedId] = useState<string | null>(null)
  const [savedSnapshot, setSavedSnapshot] = useState<BoardSnapshot | null>(null)

  const [browsing, setBrowsing] = useState(false)

  // The page opens read only and enters editing on demand. editBaseline holds
  // the editable state as it was when edit mode was entered, so Cancel restores
  // it; it is null outside edit mode.
  const [mode, setMode] = useState<BoardMode>('view')
  const [editBaseline, setEditBaseline] = useState<BoardEdit | null>(null)

  const save = useSaveBoard()

  const current: BoardSnapshot = useMemo(
    () => ({ name, formation, teamId: selectedTeam || null, tokens }),
    [name, formation, selectedTeam, tokens],
  )
  // The clean baseline. For a loaded board it is the last saved state; for a
  // fresh board it is the empty pitch with the auto-selected default team, so
  // the default team selection is never itself counted as an unsaved change.
  const baseline: BoardSnapshot =
    loadedId && savedSnapshot ? savedSnapshot : { name: '', formation: '', teamId: selectedTeam || null, tokens: [] }
  const dirty = boardIsDirty(current, baseline)

  // The selected team's roster, the source the "Seed from roster" control uses.
  const teamPlayers = useMemo(() => players.filter((p) => p.teamId === selectedTeam), [players, selectedTeam])

  // Placing a formation replaces that side's tokens and leaves the other side
  // alone, so home and away can sit on the board together.
  function placeFormation(key: string) {
    if (!key) return
    const placed = formationPositions(key, side)
    setTokens((prev) => [...prev.filter((t) => t.side !== side), ...placed])
    setFormation(key)
  }

  // Seed the current side from the selected team's roster, the opt in
  // alternative to a formation: one token per player, the display name copied
  // into the token label and the shirt number used as the number. It replaces
  // that side's tokens the way a formation does and clears the formation key,
  // since the shape no longer came from a picker. The label is a plain string
  // snapshot of the name with no link back to the player, so a board saved from
  // here never breaks when a player is later renamed or removed.
  function seedFromRoster() {
    if (teamPlayers.length === 0) return
    const placed = rosterTokens(
      teamPlayers.map((p) => ({ displayName: p.displayName, shirtNumber: p.shirtNumber })),
      side,
    )
    setTokens((prev) => [...prev.filter((t) => t.side !== side), ...placed])
    setFormation('')
  }

  function addToken() {
    const number = nextNumber(tokens, side)
    setTokens((prev) => [
      ...prev,
      { id: `${side}-${number}`, number, label: '', side, x: 0.5, y: side === 'home' ? 0.62 : 0.38 },
    ])
  }

  // Remove the most recently added token; the per disc affordance is left for a
  // later phase.
  function removeToken() {
    setTokens((prev) => prev.slice(0, -1))
  }

  function moveToken(id: string, x: number, y: number) {
    setTokens((prev) => prev.map((t) => (t.id === id ? { ...t, x, y } : t)))
  }

  function labelToken(id: string, label: string) {
    setTokens((prev) => prev.map((t) => (t.id === id ? { ...t, label } : t)))
  }

  // Enter edit mode, snapshotting the editable state so Cancel can restore it.
  function enterEdit() {
    setEditBaseline(captureBoardEdit({ name, formation, side, teamId, tokens }))
    setMode('edit')
  }

  // Done keeps the on-screen changes and returns to viewing. It does not save to
  // the database; the save button and the unsaved indicator are unchanged.
  function doneEdit() {
    setEditBaseline(null)
    setMode('view')
  }

  // Cancel reverts to the board as it was when edit mode was entered, then
  // returns to viewing.
  function cancelEdit() {
    if (editBaseline) {
      setName(editBaseline.name)
      setFormation(editBaseline.formation)
      setSide(editBaseline.side)
      setTeamId(editBaseline.teamId)
      setTokens(editBaseline.tokens)
    }
    setEditBaseline(null)
    setMode('view')
  }

  // Load a saved board onto the pitch, replacing the current state and marking
  // it clean. A board saved with no team (its team was later deleted) falls
  // back to the default team the same way a fresh board does, so the baseline
  // records that resolved team rather than the stored null, and loading alone
  // never reads as an unsaved change. A loaded board lands in view mode.
  function loadBoard(b: Board) {
    const resolvedTeam = b.teamId ?? profile?.team_id ?? teamList[0]?.id ?? null
    setTokens(b.tokens)
    setFormation(b.formation ?? '')
    setTeamId(b.teamId)
    setName(b.name)
    setLoadedId(b.id)
    setSavedSnapshot({ name: b.name, formation: b.formation ?? '', teamId: resolvedTeam, tokens: b.tokens })
    setBrowsing(false)
    setEditBaseline(null)
    setMode('view')
  }

  // Start a fresh board, clearing the pitch and detaching from any loaded one.
  // The baseline falls back to the empty pitch, so no snapshot is needed. A new
  // board opens straight into editing, the one place a coach starts building.
  function newBoard() {
    setTokens([])
    setFormation('')
    setName('')
    setLoadedId(null)
    setSavedSnapshot(null)
    setEditBaseline(captureBoardEdit({ name: '', formation: '', side, teamId, tokens: [] }))
    setMode('edit')
  }

  function saveBoard() {
    save.mutate(
      { id: loadedId, name, formation: formation || null, teamId: selectedTeam || null, tokens },
      {
        onSuccess: (b) => {
          setLoadedId(b.id)
          setSavedSnapshot({ name: b.name, formation: b.formation ?? '', teamId: b.teamId, tokens: b.tokens })
        },
      },
    )
  }

  const canSave = !!name.trim() && !save.isPending

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Tactics board</h2>
          <div className="sub">Place players and drag them into shape. Save a board to load it back later.</div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="btn btn-ghost" onClick={newBoard}>
            <Icon.plus />
            New board
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => setBrowsing(true)}>
            <Icon.list />
            Saved boards
          </button>
        </div>
      </div>

      <BoardStage
        mode={mode}
        tokens={tokens}
        onEdit={enterEdit}
        onDone={doneEdit}
        onCancel={cancelEdit}
        onMove={moveToken}
        onLabel={labelToken}
        teamList={teamList}
        selectedTeam={selectedTeam}
        onTeam={setTeamId}
        formation={formation}
        onFormation={placeFormation}
        side={side}
        onSide={setSide}
        teamPlayerCount={teamPlayers.length}
        onSeedRoster={seedFromRoster}
        onAddToken={addToken}
        onRemoveToken={removeToken}
        onClear={() => setTokens([])}
        name={name}
        onName={setName}
        dirty={dirty}
        canSave={canSave}
        saving={save.isPending}
        saveError={save.isError ? save.error.message : null}
        loadedId={loadedId}
        onSave={saveBoard}
      />

      {browsing && (
        <BoardsModal
          currentUserId={user?.id}
          isAdmin={isAdmin}
          dirty={dirty}
          onLoad={loadBoard}
          onClose={() => setBrowsing(false)}
        />
      )}
    </div>
  )
}

// The board surface and its mode bar, pulled out so the two modes are one
// testable unit. View mode renders the read only TacticsBoardView (no drag
// handlers, the page scrolls and pans normally) under a prominent Edit board
// button. Edit mode renders the editable TacticsPitch with the full toolset and
// the Done and Cancel actions. The mode is conveyed in text (the status line),
// not by colour alone, and Edit board, Done and Cancel are real buttons.
export function BoardStage({
  mode,
  tokens,
  onEdit,
  onDone,
  onCancel,
  onMove,
  onLabel,
  teamList,
  selectedTeam,
  onTeam,
  formation,
  onFormation,
  side,
  onSide,
  teamPlayerCount,
  onSeedRoster,
  onAddToken,
  onRemoveToken,
  onClear,
  name,
  onName,
  dirty,
  canSave,
  saving,
  saveError,
  loadedId,
  onSave,
}: {
  mode: BoardMode
  tokens: Token[]
  onEdit: () => void
  onDone: () => void
  onCancel: () => void
  onMove: (id: string, x: number, y: number) => void
  onLabel: (id: string, label: string) => void
  teamList: Team[]
  selectedTeam: string
  onTeam: (id: string) => void
  formation: string
  onFormation: (key: string) => void
  side: TokenSide
  onSide: (side: TokenSide) => void
  teamPlayerCount: number
  onSeedRoster: () => void
  onAddToken: () => void
  onRemoveToken: () => void
  onClear: () => void
  name: string
  onName: (name: string) => void
  dirty: boolean
  canSave: boolean
  saving: boolean
  saveError: string | null
  loadedId: string | null
  onSave: () => void
}) {
  if (mode === 'view') {
    return (
      <>
        <div className="card board-mode-bar">
          <div className="board-mode-text">
            <div className="board-mode-title" role="status">
              Viewing
            </div>
            <div className="sub">The board is read only. Edit to move players and use the tools.</div>
          </div>
          <button type="button" className="btn btn-primary board-edit-btn" onClick={onEdit}>
            <Icon.edit />
            Edit board
          </button>
        </div>
        <TacticsBoardView tokens={tokens} />
      </>
    )
  }

  return (
    <>
      <div className="card board-mode-bar">
        <div className="board-mode-text">
          <div className="board-mode-title" role="status">
            Editing
          </div>
          <div className="sub">Done returns to viewing. Save persists the board.</div>
        </div>
        <div className="board-mode-actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={onDone}>
            <Icon.check />
            Done
          </button>
        </div>
      </div>

      <div className="card board-controls">
        <label className="board-field">
          <span>Team</span>
          <select className="select" value={selectedTeam} onChange={(e) => onTeam(e.target.value)}>
            {teamList.length === 0 && <option value="">No teams</option>}
            {teamList.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>

        <label className="board-field">
          <span>Formation</span>
          <select className="select" value={formation} onChange={(e) => onFormation(e.target.value)}>
            <option value="">Place a formation…</option>
            {FORMATIONS.map((f) => (
              <option key={f.key} value={f.key}>
                {f.label}
              </option>
            ))}
          </select>
        </label>

        <div className="board-field">
          <span>Roster</span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onSeedRoster}
            disabled={teamPlayerCount === 0}
            title={
              teamPlayerCount === 0
                ? 'This team has no roster. Add players in Roster, or place a formation.'
                : undefined
            }
          >
            <Icon.users />
            {teamPlayerCount === 0 ? 'No roster' : `Seed ${side} from roster (${teamPlayerCount})`}
          </button>
        </div>

        <div className="board-field">
          <span>Add as</span>
          <div className="board-side-toggle" role="group" aria-label="Token colour">
            <button
              type="button"
              className={'board-side home' + (side === 'home' ? ' active' : '')}
              aria-pressed={side === 'home'}
              onClick={() => onSide('home')}
            >
              Home
            </button>
            <button
              type="button"
              className={'board-side away' + (side === 'away' ? ' active' : '')}
              aria-pressed={side === 'away'}
              onClick={() => onSide('away')}
            >
              Away
            </button>
          </div>
        </div>

        <div className="board-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onAddToken}>
            <Icon.plus />
            Add token
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onRemoveToken} disabled={tokens.length === 0}>
            <Icon.x />
            Remove token
          </button>
          <button type="button" className="btn btn-quiet btn-sm" onClick={onClear} disabled={tokens.length === 0}>
            <Icon.trash />
            Clear board
          </button>
        </div>
      </div>

      <div className="card board-save">
        <label className="board-field board-name">
          <span>Board name</span>
          <input
            className="input"
            value={name}
            onChange={(e) => onName(e.target.value)}
            placeholder="e.g. Titans 2-3-1 high press"
            maxLength={80}
          />
        </label>
        <div className="board-save-actions">
          {dirty && (
            <span className="board-unsaved" aria-live="polite">
              Unsaved changes
            </span>
          )}
          <button type="button" className="btn btn-primary" onClick={onSave} disabled={!canSave}>
            <Icon.check />
            {saving ? 'Saving…' : loadedId ? 'Save changes' : 'Save board'}
          </button>
        </div>
        {saveError && (
          <p className="board-save-error" role="alert">
            {saveError}
          </p>
        )}
      </div>

      <TacticsPitch tokens={tokens} onMove={onMove} onLabel={onLabel} />
    </>
  )
}

// The saved boards list: every board in the club, newest first. Selecting one
// loads it onto the pitch, confirming first if the current board has unsaved
// changes. The creator (and an admin on any board) sees rename and delete.
function BoardsModal({
  currentUserId,
  isAdmin,
  dirty,
  onLoad,
  onClose,
}: {
  currentUserId: string | undefined
  isAdmin: boolean
  dirty: boolean
  onLoad: (b: Board) => void
  onClose: () => void
}) {
  const { data: boards = [], isLoading, isError } = useBoards()
  const teamById = useTeamMap()
  const memberById = useMemberMap()
  const [confirmLoad, setConfirmLoad] = useState<Board | null>(null)
  const [renaming, setRenaming] = useState<Board | null>(null)
  const [deleting, setDeleting] = useState<Board | null>(null)

  // Load directly when there is nothing to lose; otherwise confirm first.
  function requestLoad(b: Board) {
    if (dirty) setConfirmLoad(b)
    else onLoad(b)
  }

  return (
    <Modal title="Saved boards" sub="Boards saved across the club. Loading one replaces the pitch." onClose={onClose}>
      {isLoading ? (
        <Loading />
      ) : isError ? (
        <ErrorNote />
      ) : boards.length === 0 ? (
        <p className="muted" style={{ fontSize: 13.5 }}>
          No boards saved yet. Build a shape on the pitch, name it and save.
        </p>
      ) : (
        boards.map((b) => {
          const mine = !!currentUserId && b.createdBy === currentUserId
          const canManage = mine || isAdmin
          const author = mine ? 'You' : memberById[b.createdBy]?.fullName || 'A coach'
          const teamName = b.teamId ? teamById[b.teamId]?.name : null
          return (
            <div key={b.id} className="board-list-row">
              <button type="button" className="board-list-main" onClick={() => requestLoad(b)}>
                <b className="board-list-name">{b.name}</b>
                <span className="board-list-meta">
                  {teamName && <span className="pill">{teamName}</span>}
                  <span className="muted">{author}</span>
                  <span className="muted">{updatedAgo(b.updatedAt)}</span>
                </span>
              </button>
              {canManage && (
                <div className="board-list-actions">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm icon-only"
                    aria-label={'Rename ' + b.name}
                    onClick={() => setRenaming(b)}
                  >
                    <Icon.edit />
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm icon-only"
                    aria-label={'Delete ' + b.name}
                    onClick={() => setDeleting(b)}
                  >
                    <Icon.trash />
                  </button>
                </div>
              )}
            </div>
          )
        })
      )}

      {confirmLoad && (
        <ConfirmLoadModal
          board={confirmLoad}
          onConfirm={() => {
            onLoad(confirmLoad)
            setConfirmLoad(null)
          }}
          onClose={() => setConfirmLoad(null)}
        />
      )}
      {renaming && <RenameBoardModal board={renaming} onClose={() => setRenaming(null)} />}
      {deleting && <DeleteBoardModal board={deleting} onClose={() => setDeleting(null)} />}
    </Modal>
  )
}

function ConfirmLoadModal({ board, onConfirm, onClose }: { board: Board; onConfirm: () => void; onClose: () => void }) {
  return (
    <Modal
      title="Load over unsaved changes?"
      sub={board.name}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={onConfirm}>
            Load board
          </button>
        </>
      }
    >
      <p style={{ fontSize: 14.5, lineHeight: 1.55 }}>
        The current board has unsaved changes. Loading this board replaces it and those changes are lost.
      </p>
    </Modal>
  )
}

function RenameBoardModal({ board, onClose }: { board: Board; onClose: () => void }) {
  const rename = useRenameBoard()
  const [name, setName] = useState(board.name)
  const ready = !!name.trim() && !rename.isPending
  const submit = () => {
    if (!ready) return
    rename.mutate({ id: board.id, name }, { onSuccess: onClose })
  }
  return (
    <Modal
      title="Rename board"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={rename.isPending}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={!ready}>
            {rename.isPending ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <div className="field">
        <label>Name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoFocus />
      </div>
      {rename.isError && (
        <p className="muted" style={{ fontSize: 13, color: 'var(--m-pdf)', marginBottom: 0 }}>
          {rename.error.message}
        </p>
      )}
    </Modal>
  )
}

function DeleteBoardModal({ board, onClose }: { board: Board; onClose: () => void }) {
  const del = useDeleteBoard()
  const remove = () => del.mutate({ id: board.id }, { onSuccess: onClose })
  return (
    <Modal
      title="Delete board"
      sub={board.name}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={del.isPending}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            style={{ background: 'var(--m-pdf)' }}
            onClick={remove}
            disabled={del.isPending}
          >
            <Icon.trash />
            {del.isPending ? 'Deleting…' : 'Delete'}
          </button>
        </>
      }
    >
      <p style={{ fontSize: 14.5, lineHeight: 1.55 }}>This removes the saved board for the whole club. It cannot be undone.</p>
      {del.isError && (
        <p className="muted" style={{ fontSize: 13, color: 'var(--m-pdf)', marginBottom: 0 }}>
          {del.error.message}
        </p>
      )}
    </Modal>
  )
}
