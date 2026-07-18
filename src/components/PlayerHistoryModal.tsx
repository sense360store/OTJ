// The per player History modal (a Modal, the repo's only overlay primitive).
// Reads the child's audit trail through the player_history RPC, gated server
// side on audit.view; the page only opens it for audit.view holders. It follows
// the same dialog and focus rules as every other modal. It renders no child
// name: each entry is a time, the acting adult's name (a snapshot, or a neutral
// label once that adult is removed), and a plain-language description of what
// changed with team names resolved by id.
import { usePlayerHistory } from '../lib/queries'
import { describeHistoryEntry } from '../lib/playersView'
import { fmtHistoryTime, fmtRegDate } from '../lib/playersFormat'
import type { RegisteredPlayer, Team } from '../lib/data'
import { Modal } from './ui'

export function PlayerHistoryModal({
  player,
  teams,
  onClose,
}: {
  player: RegisteredPlayer
  teams: Team[]
  onClose: () => void
}) {
  const { data: entries = [], isLoading, isError } = usePlayerHistory(player.playerId)
  const teamName = (id: string | null | undefined): string =>
    id == null ? 'Unassigned' : (teams.find((t) => t.id === id)?.name ?? 'Deleted team')

  return (
    <Modal title="History" sub={player.displayName} onClose={onClose}>
      {isLoading ? (
        <p className="muted" style={{ fontSize: 14 }}>
          Loading…
        </p>
      ) : isError ? (
        <p role="alert" className="muted" style={{ fontSize: 14, color: 'var(--m-pdf)' }}>
          Could not load the history. Refresh to try again.
        </p>
      ) : entries.length === 0 ? (
        <p className="muted" style={{ fontSize: 14 }}>
          No changes recorded yet.
        </p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {entries.map((e) => (
            <li key={e.id} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <span className="mono muted" style={{ fontSize: 12, minWidth: 96, flex: '0 0 auto', paddingTop: 1 }}>
                {fmtHistoryTime(e.occurredAt)}
              </span>
              <span style={{ flex: 1, fontSize: 13.5, lineHeight: 1.5 }}>
                <b>{e.actorName ?? 'System'}</b>
                <span style={{ color: 'var(--slate)' }}> · </span>
                {describeHistoryEntry(e, { teamName, formatDate: fmtRegDate })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}
