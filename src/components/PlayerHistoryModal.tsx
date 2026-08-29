// The per player History modal (a Modal, the repo's only overlay primitive).
// Reads the child's audit trail through the player_history RPC, gated server
// side on audit.view; the page only opens it for audit.view holders. It follows
// the same dialog and focus rules as every other modal. It renders no child
// name: each entry is a time, the acting adult's name (a snapshot, or a neutral
// label once that adult is removed), and a plain-language description of what
// changed with team names resolved by id.
//
// Its three non-list states are the shared ones now: a labelled Loading rather
// than a grey "Loading…", an ErrorNote rather than a danger coloured paragraph,
// and the empty case stated in one muted sentence. 2.14 asks a loading and an
// error state not to look alike, which was exactly what these two did.
import { usePlayerHistory } from '../lib/queries'
import { describeHistoryEntry } from '../lib/playersView'
import { fmtHistoryTime, fmtRegDate } from '../lib/playersFormat'
import type { Team } from '../lib/data'
import { ErrorNote, Loading, Modal } from './ui'

// Opened by id and current display name so both the Registered players page and
// the club wide Activity page can drive it: the page passes the stable player id
// (the audit entity id) and the name it already holds. The modal itself never
// derives a name from an audit event; the name is the current display name the
// caller resolved through the players.view gated read.
export function PlayerHistoryModal({
  playerId,
  displayName,
  teams,
  onClose,
}: {
  playerId: string
  displayName: string
  teams: Team[]
  onClose: () => void
}) {
  const { data: entries = [], isLoading, isError } = usePlayerHistory(playerId)
  const teamName = (id: string | null | undefined): string =>
    id == null ? 'Unassigned' : (teams.find((t) => t.id === id)?.name ?? 'Deleted team')

  return (
    <Modal title="History" sub={displayName} onClose={onClose}>
      {isLoading ? (
        <Loading />
      ) : isError ? (
        <ErrorNote>Could not load the history. Refresh to try again.</ErrorNote>
      ) : entries.length === 0 ? (
        <p className="modal-copy muted">No changes recorded yet.</p>
      ) : (
        <ul className="history-list">
          {entries.map((e) => (
            <li key={e.id} className="history-item">
              <span className="mono history-time">{fmtHistoryTime(e.occurredAt)}</span>
              <span className="history-what">
                <b>{e.actorName ?? 'System'}</b>
                <span className="history-sep"> · </span>
                {describeHistoryEntry(e, { teamName, formatDate: fmtRegDate })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}
