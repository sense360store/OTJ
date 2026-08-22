// The bulk permanent deletion dialog for the Registered players page (roadmap
// PLAYERS-01). Destructive and admin only (players.delete). It opens on a
// PREVIEW, never on a delete: the server is asked what the selection would
// touch, the answer is shown in full including the one dependency that is
// destroyed rather than neutralised, and only then does a typed confirmation
// naming the number arm the button.
//
// Nothing here is optimistic. The dialog cannot be dismissed while the run is
// in flight, a failure keeps the selection so Retry resends exactly the same
// ids, and a stale preview is refused by the server rather than reconciled
// here. The names listed are the ones the caller already holds; they reach no
// URL, no log and no audit payload.
import { useState } from 'react'
import { useBulkDeletePlayers, useDeletePlayersPreview, isStaleBulkSelection } from '../lib/queries'
import { useGuardedSubmit } from '../hooks/useGuardedSubmit'
import {
  bulkDeleteButtonLabel,
  bulkDeleteConfirmed,
  bulkDeletePhrase,
  changeLines,
  historyLines,
  previewIsStale,
  removalLines,
  type DeletePreview,
} from '../lib/playersBulk'
import type { RegisteredPlayer } from '../lib/data'
import { Icon } from './icons'
import { ActionError, Loading, Modal } from './ui'

export function BulkDeletePlayersModal({
  players,
  onClose,
  onDeleted,
}: {
  // The selected rows, in the order the table showed them. The dialog counts
  // these and sends their player ids; it never re-derives the selection.
  players: RegisteredPlayer[]
  onClose: () => void
  onDeleted: (result: DeletePreview) => void
}) {
  const playerIds = players.map((p) => p.playerId)
  const count = playerIds.length
  const [typed, setTyped] = useState('')

  const preview = useDeletePlayersPreview(playerIds, true)
  const del = useBulkDeletePlayers()
  const { submit, pending, failed, error } = useGuardedSubmit<
    { playerIds: string[]; expectedCount: number },
    DeletePreview
  >({
    operation: 'bulk delete players',
    perform: (input) => del.mutateAsync(input),
    onSuccess: (result) => {
      onDeleted(result)
      onClose()
    },
  })
  const deleting = pending !== null

  // The server found fewer live players than were asked about, so somebody else
  // has deleted one of these children since the selection was made. The button
  // stays disabled: there is no number the admin could confirm that the server
  // would still accept.
  const stale = preview.data ? previewIsStale(preview.data) : false
  const ready = preview.isSuccess && !stale
  const confirmed = ready && bulkDeleteConfirmed(typed, count)

  const run = () => {
    if (!confirmed || deleting) return
    void submit({ playerIds, expectedCount: count })
  }

  return (
    <Modal
      title={`Delete ${count} ${count === 1 ? 'player' : 'players'} permanently`}
      sub="This cannot be undone"
      wide
      onClose={onClose}
      dismissible={!deleting}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={deleting}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            style={{ background: 'var(--m-pdf)' }}
            onClick={run}
            disabled={!confirmed || deleting}
          >
            <Icon.trash />
            {deleting ? 'Deleting…' : bulkDeleteButtonLabel(count)}
          </button>
        </>
      }
    >
      {preview.isLoading && <Loading />}

      {preview.isError && (
        <ActionError onRetry={() => void preview.refetch()}>
          Could not work out what deleting these players would affect, so nothing has been deleted. Try again.
        </ActionError>
      )}

      {preview.isSuccess && (
        <>
          {stale && (
            <div role="alert" className="bulk-delete-stale">
              The selection is out of date: {preview.data.players} of the {preview.data.requested} selected players are
              still here. Somebody else has changed the register. Close this, check the list and select again.
            </div>
          )}

          <p className="bulk-delete-lede">This will remove:</p>
          <ul className="bulk-delete-list">
            {removalLines(preview.data).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>

          {changeLines(preview.data).length > 0 && (
            <>
              <p className="bulk-delete-lede">And changes:</p>
              <ul className="bulk-delete-list">
                {changeLines(preview.data).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </>
          )}

          <div className="bulk-delete-history">
            <h4>What happens to history</h4>
            {historyLines(preview.data).map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>

          <details className="bulk-delete-who" open={count <= 12}>
            <summary>
              {count === 1 ? 'The player being deleted' : `The ${count} players being deleted`}
            </summary>
            <ul className="bulk-delete-names">
              {players.map((p) => (
                <li key={p.playerId}>{p.displayName}</li>
              ))}
            </ul>
          </details>

          <div className="field bulk-delete-confirm">
            <label htmlFor="bulk-delete-phrase">
              To confirm, type <b>{bulkDeletePhrase(count)}</b>
            </label>
            <input
              id="bulk-delete-phrase"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={bulkDeletePhrase(count)}
              autoComplete="off"
              spellCheck={false}
              disabled={deleting || stale}
            />
          </div>
        </>
      )}

      {failed && (
        <ActionError onRetry={confirmed ? run : undefined} style={{ marginTop: 10 }}>
          {isStaleBulkSelection(error)
            ? 'The register changed while this was open, so nothing was deleted. Close this, check the list and select again.'
            : 'The players were not deleted, and nothing was partly deleted. Reload and try again.'}
        </ActionError>
      )}
    </Modal>
  )
}

// The selection action bar. Presentational, so the static renderer proves the
// count, the scoped Select all label and the destructive button without a DOM.
// "Select all" always names the number it would select AND the fact that it is
// the shown rows, because a Select all that quietly means the whole database is
// the classic way a bulk delete goes wrong.
export function BulkSelectionBar({
  selectedCount,
  shownCount,
  allSelected,
  onSelectAllShown,
  onClear,
  onDelete,
  onExit,
}: {
  selectedCount: number
  shownCount: number
  allSelected: boolean
  onSelectAllShown: () => void
  onClear: () => void
  onDelete: () => void
  onExit: () => void
}) {
  return (
    <div className="bulk-bar" role="group" aria-label="Bulk selection">
      <span className="bulk-bar-count" aria-live="polite">
        {selectedCount} selected
      </span>
      <button className="btn btn-ghost btn-sm" onClick={onSelectAllShown} disabled={shownCount === 0 || allSelected}>
        Select all {shownCount} shown
      </button>
      <button className="btn btn-ghost btn-sm" onClick={onClear} disabled={selectedCount === 0}>
        Clear
      </button>
      <span className="bulk-bar-spacer" />
      <button className="btn btn-quiet btn-sm" onClick={onExit}>
        Done
      </button>
      <button
        className="btn btn-primary btn-sm"
        style={{ background: 'var(--m-pdf)' }}
        onClick={onDelete}
        disabled={selectedCount === 0}
      >
        <Icon.trash />
        Delete {selectedCount} {selectedCount === 1 ? 'player' : 'players'}
      </button>
    </div>
  )
}
