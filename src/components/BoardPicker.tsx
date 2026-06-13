// The board picker: attach one of the club's saved boards to a session. Reads
// are club wide (the boards select RLS), so the list is every board in the
// club; the session's team is a default, not a filter, so a team's boards sort
// to the top while the rest stay reachable (CLAUDE.md, team is a filter and a
// default, never access control). Selecting a board reports its id; the
// detach row reports null. The picker only surfaces the choice; the caller
// (the planner draft or the session day link mutation) writes it, and the
// sessions update RLS is the real enforcement.
import { useMemo } from 'react'
import { useBoards, useTeamMap } from '../lib/queries'
import type { Board } from '../lib/tacticsBoard'
import { Icon } from '../components/icons'
import { ErrorNote, Loading, Modal } from '../components/ui'
import '../routes/Board.css'

export function BoardPickerModal({
  currentId,
  defaultTeamId,
  onSelect,
  onClose,
}: {
  currentId: string | null
  defaultTeamId: string | null
  onSelect: (boardId: string | null) => void
  onClose: () => void
}) {
  const { data: boards = [], isLoading, isError } = useBoards()
  const teamById = useTeamMap()

  // The session's team first, then the rest. useBoards already returns newest
  // first, so a stable sort by team membership keeps that order within each
  // group.
  const ordered = useMemo(() => {
    if (!defaultTeamId) return boards
    return [...boards].sort((a, b) => {
      const am = a.teamId === defaultTeamId ? 0 : 1
      const bm = b.teamId === defaultTeamId ? 0 : 1
      return am - bm
    })
  }, [boards, defaultTeamId])

  const choose = (b: Board) => {
    onSelect(b.id)
    onClose()
  }
  const detach = () => {
    onSelect(null)
    onClose()
  }

  return (
    <Modal title="Attach a board" sub="Saved boards across the club. The session's team shows first." onClose={onClose}>
      {isLoading ? (
        <Loading />
      ) : isError ? (
        <ErrorNote />
      ) : boards.length === 0 ? (
        <p className="muted" style={{ fontSize: 13.5 }}>
          No boards saved yet. Build one on the tactics board, then attach it here.
        </p>
      ) : (
        <>
          {currentId && (
            <button type="button" className="btn btn-ghost btn-sm" style={{ marginBottom: 8 }} onClick={detach}>
              <Icon.x />
              Remove attached board
            </button>
          )}
          {ordered.map((b) => {
            const teamName = b.teamId ? teamById[b.teamId]?.name : null
            const current = b.id === currentId
            return (
              <div key={b.id} className="board-list-row">
                <button type="button" className="board-list-main" onClick={() => choose(b)}>
                  <b className="board-list-name">{b.name}</b>
                  <span className="board-list-meta">
                    {teamName && <span className="pill">{teamName}</span>}
                    {current && <span className="muted">Attached</span>}
                  </span>
                </button>
              </div>
            )
          })}
        </>
      )}
    </Modal>
  )
}
