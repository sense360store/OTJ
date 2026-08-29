// The export confirmation dialog for the Registered players page (PR 4). Every
// export passes through here first: it names the record count, the season and
// the active filters, carries the secure handling reminder, and only on Confirm
// calls export_players, which writes the one players.exported audit event and
// returns the dataset the browser turns into a CSV or XLSX file. One extra
// click, defensible for child data.
//
// No optimistic anything: while the file is generating the modal is not
// dismissible (dismissible={!generating}, the existing PR #103 Modal contract),
// and a failure keeps the choices for Retry. Calling the RPC IS the export for
// audit purposes, so cancelling before Confirm writes nothing. The blank import
// template (players.export holds it in PR 4; the import flow that consumes it
// arrives in PR 5) downloads from here too, with no audit event because it
// carries no child data.
//
// Formats, filename, filter summary and the reminder copy:
// docs/product/registered-players-import-export.md (Export, Export confirmation)
// and docs/product/registered-players-ux.md (section 9).
import { useState } from 'react'
import { useExportPlayers } from '../lib/queries'
import { useGuardedSubmit } from '../hooks/useGuardedSubmit'
import { statusesForFilter, type PlayersFilters, type StatusFilter } from '../lib/playersView'
import { downloadPlayersExport, type ExportFilterPayload, type ExportPlayerRow } from '../lib/playersExport'
import { downloadTemplate } from '../lib/playersTemplate'
import { Icon } from './icons'
import { ActionError, Modal } from './ui'
import { Button, Note } from './primitives'

type ExportFormat = 'csv' | 'xlsx'
type ExportScope = 'filtered' | 'all'

// Everything the confirm needs, computed at click time and passed through the
// guarded submit input, never read from a closure (useGuardedSubmit captures
// perform once, at first render; reading live state from the closure would
// export the modal's initial choices, the PR #109 lesson).
interface SubmitInput {
  format: ExportFormat
  scope: ExportScope
  payload: ExportFilterPayload
  seasonId: string
  seasonName: string
}

const STATUS_FILTER_LABEL: Record<StatusFilter, string> = {
  pending_registered: 'Pending and registered',
  pending: 'Pending',
  registered: 'Registered',
  withdrawn: 'Withdrawn',
  all: 'All statuses',
}

export function ExportConfirmModal({
  season,
  filters,
  filteredCount,
  totalCount,
  teamLabel,
  onClose,
}: {
  season: { id: string; name: string }
  filters: PlayersFilters
  // Counts from the page's already-loaded rows, shown before generating; the
  // audited count the server records is authoritative and matches in the normal
  // case.
  filteredCount: number
  totalCount: number
  // Resolves the active team filter to its display label ("All teams",
  // "Unassigned" or a team name).
  teamLabel: string
  onClose: () => void
}) {
  const exporter = useExportPlayers()
  const [format, setFormat] = useState<ExportFormat>('csv')
  const [scope, setScope] = useState<ExportScope>('filtered')

  const { submit, pending, failed } = useGuardedSubmit<SubmitInput, ExportPlayerRow[]>({
    operation: 'export players',
    // Every value arrives through input, so nothing is read from a stale
    // closure. The RPC re-derives and re-counts server side; these are the
    // caller's view filter and declared format.
    perform: (input) =>
      exporter.mutateAsync({ seasonId: input.seasonId, filters: input.payload, format: input.format }),
    // The file is built from the RPC's returned rows and never stored anywhere.
    // If this step failed after a successful RPC the export is still audited
    // (the safe over-recording direction); in practice a build error surfaces
    // as a failed submit and the user retries.
    onSuccess: (rows, input) => {
      downloadPlayersExport(rows, input.format, input.seasonName)
      onClose()
    },
  })
  const generating = pending !== null

  const searchApplied = filters.q.trim() !== ''
  const shownCount = scope === 'filtered' ? filteredCount : totalCount

  const run = () => {
    if (generating) return
    // "All players I can access" clears the view filter to every status and
    // team with no search; "This list" uses the page's active filter, resolved
    // to the concrete team value, status set and trimmed search here.
    const payload: ExportFilterPayload =
      scope === 'all'
        ? { team: 'all', statuses: ['pending', 'registered', 'withdrawn'], search: '' }
        : { team: filters.team, statuses: statusesForFilter(filters.status), search: filters.q.trim() }
    void submit({ format, scope, payload, seasonId: season.id, seasonName: season.name })
  }

  return (
    <Modal
      title="Export registered players"
      sub={season.name}
      onClose={onClose}
      dismissible={!generating}
      footer={
        <>
          <Button onClick={onClose} disabled={generating}>
            Cancel
          </Button>
          <Button variant="primary" icon={Icon.download} onClick={run} disabled={generating}>
            {generating ? 'Preparing…' : `Download ${format.toUpperCase()}`}
          </Button>
        </>
      }
    >
      {/* Two real fieldsets with real legends. Each row is the shared
          .check-row, so the label is the 44px target rather than the 16px
          radio inside it, and neither the group nor its rows sets a size. */}
      <fieldset className="choice-group">
        <legend>What to export</legend>
        <label className="check-row">
          <input
            type="radio"
            name="export-scope"
            checked={scope === 'filtered'}
            disabled={generating}
            onChange={() => setScope('filtered')}
          />
          This list ({filteredCount} player{filteredCount !== 1 ? 's' : ''})
        </label>
        <label className="check-row">
          <input
            type="radio"
            name="export-scope"
            checked={scope === 'all'}
            disabled={generating}
            onChange={() => setScope('all')}
          />
          All players I can access ({totalCount} player{totalCount !== 1 ? 's' : ''})
        </label>
      </fieldset>

      <fieldset className="choice-group">
        <legend>Format</legend>
        <label className="check-row">
          <input
            type="radio"
            name="export-format"
            checked={format === 'csv'}
            disabled={generating}
            onChange={() => setFormat('csv')}
          />
          CSV (opens everywhere)
        </label>
        <label className="check-row">
          <input
            type="radio"
            name="export-format"
            checked={format === 'xlsx'}
            disabled={generating}
            onChange={() => setFormat('xlsx')}
          />
          Excel (XLSX)
        </label>
      </fieldset>

      <p className="modal-copy">
        {shownCount} player{shownCount !== 1 ? 's' : ''} from <b>{season.name}</b> will be exported.
      </p>
      {scope === 'filtered' ? (
        <p className="modal-copy-sm muted">
          Filters: {teamLabel}, {STATUS_FILTER_LABEL[filters.status]}
          {searchApplied ? ', a name search is applied' : ''}.
        </p>
      ) : (
        <p className="modal-copy-sm muted">
          The current filters are ignored; every player in {season.name} you can read is included.
        </p>
      )}

      {/* The handling reminder. A warning Note rather than an unflipped
          --gold-soft panel: --gold-soft is a gold tint now, not the universal
          note ground, and inherited text on it measured 1.01:1 in the dark
          theme. The tone is warning because the sentence is a caution about
          child data, and the icon is a second cue beside the colour. */}
      <Note tone="warning">Store and share this file securely. It names children.</Note>

      <div className="modal-split">
        <p className="modal-copy-sm muted">Need a blank template to fill in?</p>
        <div className="row">
          <Button size="sm" onClick={() => downloadTemplate('csv')} disabled={generating}>
            Template (CSV)
          </Button>
          <Button size="sm" onClick={() => downloadTemplate('xlsx')} disabled={generating}>
            Template (XLSX)
          </Button>
        </div>
      </div>

      {failed && (
        <ActionError onRetry={run} style={{ marginTop: 'var(--space-12)' }}>
          Could not prepare the export. Try again.
        </ActionError>
      )}
    </Modal>
  )
}
