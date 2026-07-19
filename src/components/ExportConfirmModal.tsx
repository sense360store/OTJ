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
          <button className="btn btn-ghost" onClick={onClose} disabled={generating}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={run} disabled={generating}>
            <Icon.download />
            {generating ? 'Preparing…' : `Download ${format.toUpperCase()}`}
          </button>
        </>
      }
    >
      <fieldset className="export-choice" style={{ border: 0, padding: 0, margin: '0 0 14px' }}>
        <legend style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 6 }}>What to export</legend>
        <label className="row" style={{ gap: 8, fontSize: 14, marginBottom: 6 }}>
          <input
            type="radio"
            name="export-scope"
            checked={scope === 'filtered'}
            disabled={generating}
            onChange={() => setScope('filtered')}
          />
          This list ({filteredCount} player{filteredCount !== 1 ? 's' : ''})
        </label>
        <label className="row" style={{ gap: 8, fontSize: 14 }}>
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

      <fieldset className="export-choice" style={{ border: 0, padding: 0, margin: '0 0 14px' }}>
        <legend style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 6 }}>Format</legend>
        <label className="row" style={{ gap: 8, fontSize: 14, marginBottom: 6 }}>
          <input
            type="radio"
            name="export-format"
            checked={format === 'csv'}
            disabled={generating}
            onChange={() => setFormat('csv')}
          />
          CSV (opens everywhere)
        </label>
        <label className="row" style={{ gap: 8, fontSize: 14 }}>
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

      <p style={{ fontSize: 14, lineHeight: 1.55, margin: '0 0 4px' }}>
        {shownCount} player{shownCount !== 1 ? 's' : ''} from <b>{season.name}</b> will be exported.
      </p>
      {scope === 'filtered' ? (
        <p className="muted" style={{ fontSize: 13, margin: '0 0 12px' }}>
          Filters: {teamLabel}, {STATUS_FILTER_LABEL[filters.status]}
          {searchApplied ? ', a name search is applied' : ''}.
        </p>
      ) : (
        <p className="muted" style={{ fontSize: 13, margin: '0 0 12px' }}>
          The current filters are ignored; every player in {season.name} you can read is included.
        </p>
      )}

      <p
        role="note"
        style={{
          fontSize: 13,
          lineHeight: 1.5,
          background: 'var(--gold-soft)',
          borderRadius: 11,
          padding: '9px 12px',
          margin: '0 0 12px',
        }}
      >
        Store and share this file securely. It names children.
      </p>

      <div style={{ borderTop: '1px solid var(--line)', paddingTop: 10 }}>
        <p className="muted" style={{ fontSize: 12.5, margin: '0 0 6px' }}>
          Need a blank template to fill in?
        </p>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => downloadTemplate('csv')} disabled={generating}>
            Template (CSV)
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => downloadTemplate('xlsx')} disabled={generating}>
            Template (XLSX)
          </button>
        </div>
      </div>

      {failed && (
        <ActionError onRetry={run} style={{ marginTop: 12 }}>
          Could not prepare the export. Try again.
        </ActionError>
      )}
    </Modal>
  )
}
