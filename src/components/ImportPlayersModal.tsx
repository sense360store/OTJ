// The registered players import modal (PR 5): stage one only, parse, validate
// and preview. Selecting a file never writes; this modal performs ZERO database
// writes and has no commit path. The two stage flow's second stage (the explicit
// Confirm that calls the transactional import_players RPC) is a later PR, so the
// confirm control here is present but disabled, with a note that saving is not
// yet enabled. Everything runs in the uploading user's own browser tab.
//
// Parsing is playersImportParse.ts; classification is playersImportPlan.ts; the
// rejected report is playersImportReport.ts; all pure and unit tested. The modal
// only orchestrates: pick a file, show the preview, let the user resolve each
// needs-your-choice collision, and download a correction report, then discard
// everything on close. No file, name, row or filename is ever logged, put in a
// URL, or sent anywhere.
//
// UI contract: docs/product/registered-players-ux.md (section 8, import modal and
// preview; section 12, accessibility). Rules: docs/product/registered-players-import-export.md.
import { useEffect, useMemo, useRef, useState } from 'react'
import type { RegisteredPlayer, Team } from '../lib/data'
import { readImportFile, type ParsedSheet } from '../lib/playersImportParse'
import {
  classify,
  rowsForFilter,
  summarize,
  type Choice,
  type Plan,
  type PlanRow,
  type PlanSummary,
  type PreviewFilter,
} from '../lib/playersImportPlan'
import {
  announceSummary,
  chipCount,
  FILTER_CHIPS,
  PREVIEW_PILL,
  summarySentence,
  WARNING_COLOR,
} from '../lib/playersImportView'
import { downloadIssuesReport, hasReportableIssues } from '../lib/playersImportReport'
import { downloadTemplate } from '../lib/playersTemplate'
import { useClubPlayerIdentities } from '../lib/queries'
import { Icon } from './icons'
import { ActionError, Chip, Modal } from './ui'

// One preview row: the class pill (and a Warning pill when a non-invalid row
// carries warnings), the player name from the file, the detail line, and, for a
// needs-your-choice row, the inline Skip / Import as new controls. Exported and
// pure so it is covered with the static renderer.
export function PreviewRow({
  row,
  choice,
  onChoose,
}: {
  row: PlanRow
  choice: Choice | undefined
  onChoose?: (rowNumber: number, choice: Choice) => void
}) {
  const pill = PREVIEW_PILL[row.class]
  const showWarn = row.class !== 'invalid' && row.warnings.length > 0
  return (
    <div className="ip-row">
      <div className="ip-row-head">
        <span className="ip-pill" style={{ background: pill.color }}>
          {pill.word}
        </span>
        {showWarn && (
          <span className="ip-pill" style={{ background: WARNING_COLOR }}>
            Warning
          </span>
        )}
        <span className="ip-name">{row.playerName || '(no name)'}</span>
        <span className="ip-rownum mono">Row {row.rowNumber}</span>
      </div>
      <div className="ip-detail">{row.detail}</div>
      {showWarn &&
        row.warnings.map((w, i) => (
          <div key={i} className="ip-detail ip-warn">
            {w.message}
          </div>
        ))}
      {row.class === 'needs_choice' && onChoose && (
        <div className="ip-choice" role="group" aria-label={`Resolve row ${row.rowNumber}`}>
          <button
            type="button"
            className={'btn btn-sm' + (choice === 'skip' ? ' btn-primary' : ' btn-ghost')}
            aria-pressed={choice === 'skip'}
            onClick={() => onChoose(row.rowNumber, 'skip')}
          >
            Skip
          </button>
          <button
            type="button"
            className={'btn btn-sm' + (choice === 'new' ? ' btn-primary' : ' btn-ghost')}
            aria-pressed={choice === 'new'}
            onClick={() => onChoose(row.rowNumber, 'new')}
          >
            Import as new
          </button>
        </div>
      )}
    </div>
  )
}

export function ImportPlayersModal({
  season,
  seasonRows,
  teams,
  onClose,
}: {
  season: { id: string; name: string }
  seasonRows: RegisteredPlayer[]
  teams: Team[]
  onClose: () => void
}) {
  const [fileName, setFileName] = useState<string | null>(null)
  const [parsing, setParsing] = useState(false)
  const [parseError, setParseError] = useState<string | null>(null)
  const [sheet, setSheet] = useState<ParsedSheet | null>(null)
  const [choices, setChoices] = useState<Record<number, Choice>>({})
  const [filter, setFilter] = useState<PreviewFilter>('all')
  // A transient announcement for one-off actions (report download), set from an
  // event handler. The parse and preview lifecycle is announced by a separate,
  // derived live region below, so no state is set inside an effect.
  const [actionMsg, setActionMsg] = useState('')
  const [drag, setDrag] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  // A monotonic token so a slow parse from a superseded pick is ignored, and so
  // nothing runs after the modal unmounts.
  const pickToken = useRef(0)

  // Club player identities verify Player ID ownership in the preview (and give
  // the stored name for the rename warning). Loaded lazily while the modal is open.
  const { data: clubIdentities, isPending: identitiesPending, isError: identitiesError } = useClubPlayerIdentities(true)

  const plan: Plan | null = useMemo(() => {
    if (!sheet || !clubIdentities) return null
    return classify(sheet, { seasonName: season.name, seasonRows, clubIdentities, teams })
  }, [sheet, clubIdentities, season.name, seasonRows, teams])

  const summary: PlanSummary | null = useMemo(() => (plan ? summarize(plan, choices) : null), [plan, choices])
  // The base summary (no choices) drives the one-time "Preview ready" live
  // announcement; it does not change as the user resolves collisions, so the
  // announcement is made once and not repeated.
  const baseAnnouncement = useMemo(() => (plan ? announceSummary(summarize(plan, {})) : ''), [plan])

  const resetForNewPick = () => {
    setParseError(null)
    setSheet(null)
    setChoices({})
    setFilter('all')
    setActionMsg('')
  }

  const onPick = async (file: File | undefined | null) => {
    if (!file) return
    const token = ++pickToken.current
    resetForNewPick()
    setFileName(file.name)
    setParsing(true)
    const outcome = await readImportFile(file)
    if (token !== pickToken.current) return // superseded pick or unmounted
    setParsing(false)
    if (!outcome.ok) {
      setParseError(outcome.message)
      return
    }
    setSheet(outcome.sheet)
    // The preview announcement is derived (see the live region below) once the
    // plan computes, so nothing is set here.
  }

  // On unmount, bump the token so any in-flight parse skips its setState, and
  // let React discard the parsed dataset with the component (no module level
  // cache holds it, so it is unreferenced and collectable once the modal closes).
  useEffect(() => {
    const token = pickToken
    return () => {
      token.current += 1
    }
  }, [])

  const choose = (rowNumber: number, choice: Choice) => {
    setChoices((prev) => ({ ...prev, [rowNumber]: choice }))
  }

  const downloadReport = () => {
    if (!plan) return
    downloadIssuesReport(plan)
    // Clear then set so the polite live region re-announces even on a second
    // consecutive download (identical text would otherwise not re-fire).
    setActionMsg('')
    queueMicrotask(() => setActionMsg('Report downloaded.'))
  }

  // The parse and preview lifecycle announcement, derived so it is never set
  // inside an effect: reading, then the failure reason, then "Preview ready".
  const lifecycleMsg = parsing
    ? 'Reading the file on this device…'
    : parseError
      ? parseError
      : baseAnnouncement

  const cancel = () => {
    pickToken.current += 1
    resetForNewPick()
    setFileName(null)
    onClose()
  }

  const visibleRows = plan ? rowsForFilter(plan, filter) : []
  const canReport = plan ? hasReportableIssues(plan) : false
  const actionable = summary?.actionable ?? 0

  return (
    <Modal title="Import players" sub={`Into ${season.name}`} onClose={cancel} wide>
      {/* Two polite live regions: the parse/preview lifecycle (derived) and a
          transient action announcement (the report download). */}
      <div aria-live="polite" className="sr-only">
        {lifecycleMsg}
      </div>
      <div aria-live="polite" className="sr-only">
        {actionMsg}
      </div>

      {/* Preview only banner: the boundary is explicit. This release validates
          and previews; it writes nothing. */}
      <p role="note" className="ip-note">
        Preview only. This checks your file and shows what an import would do. Saving imported players is not enabled in
        this release, so nothing here is written.
      </p>

      {/* Stage 0: pick. An accessible dropzone: a real, focusable button opens
          the picker, and drag and drop is an enhancement, never the only way. */}
      <div
        className={'ip-dropzone' + (drag ? ' drag' : '')}
        onDragOver={(e) => {
          e.preventDefault()
          setDrag(true)
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDrag(false)
          void onPick(e.dataTransfer.files?.[0])
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.xlsx"
          className="sr-only"
          // The visible "Choose file" button is the sole keyboard entry point;
          // keep this clipped input out of the tab order and the a11y tree so it
          // is not an invisible tab stop or a duplicate screen-reader control.
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            void onPick(e.target.files?.[0])
            // Allow re-picking the same file name (onChange won't fire otherwise).
            e.target.value = ''
          }}
        />
        <Icon.upload style={{ width: 26, height: 26, color: 'var(--slate-2)' }} />
        <button type="button" className="btn btn-primary" onClick={() => inputRef.current?.click()} disabled={parsing}>
          Choose file
        </button>
        <div style={{ fontWeight: 700, fontSize: 14 }}>Choose a CSV or XLSX file. Nothing is written until you confirm.</div>
        <div className="muted" style={{ fontSize: 12.5 }}>The file is read on this device. It is never uploaded or stored.</div>
        <div className="muted" style={{ fontSize: 12.5 }}>Up to 500 rows. CSV up to 1 MB, XLSX up to 2 MB.</div>
        {fileName && !parsing && (
          <div className="muted" style={{ fontSize: 12.5 }}>
            Selected: {fileName}
          </div>
        )}
        <div className="row" style={{ gap: 8, marginTop: 4 }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => downloadTemplate('csv')}>
            Download template (CSV)
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => downloadTemplate('xlsx')}>
            XLSX
          </button>
        </div>
      </div>

      {parsing && (
        <p className="muted" role="status" style={{ fontSize: 13.5, marginTop: 12 }}>
          Reading the file…
        </p>
      )}

      {parseError && (
        <ActionError style={{ marginTop: 12 }}>{parseError}</ActionError>
      )}

      {sheet && !plan && identitiesPending && (
        <p className="muted" style={{ fontSize: 13.5, marginTop: 12 }}>
          Checking against the current register…
        </p>
      )}

      {sheet && !plan && !identitiesPending && identitiesError && (
        <ActionError style={{ marginTop: 12 }}>
          Could not check the file against the current register. Close this and try again.
        </ActionError>
      )}

      {/* Stage 1: preview. */}
      {plan && summary && (
        <div style={{ marginTop: 14 }}>
          <p style={{ fontSize: 14, fontWeight: 700, margin: '0 0 4px' }}>{summarySentence(summary)}</p>
          {summary.warnings > 0 && (
            <p className="muted" style={{ fontSize: 13, margin: '0 0 2px' }}>
              {summary.warnings} of these carry warnings.
            </p>
          )}
          {summary.unknownTeams > 0 && (
            <p className="muted" style={{ fontSize: 13, margin: '0 0 2px' }}>
              {summary.unknownTeams} row{summary.unknownTeams === 1 ? '' : 's'} name a team that does not exist yet.
            </p>
          )}
          {summary.unassignedRows > 0 && (
            <p className="muted" style={{ fontSize: 13, margin: '0 0 2px' }}>
              {summary.unassignedRows} row{summary.unassignedRows === 1 ? '' : 's'} have no team and will be Unassigned.
            </p>
          )}
          {plan.blankRows > 0 && (
            <p className="muted" style={{ fontSize: 13, margin: '0 0 2px' }}>
              {plan.blankRows} blank row{plan.blankRows === 1 ? '' : 's'} skipped.
            </p>
          )}
          {plan.ignoredHeaders.length > 0 && (
            <p className="muted" style={{ fontSize: 13, margin: '0 0 2px' }}>
              Unknown columns ignored: {plan.ignoredHeaders.join(', ')}.
            </p>
          )}

          <div className="row wrap" style={{ gap: 6, margin: '10px 0' }} role="group" aria-label="Filter preview rows">
            {FILTER_CHIPS.map((c) => (
              <Chip key={c.key} on={filter === c.key} onClick={() => setFilter(c.key)}>
                {c.label} {chipCount(summary, c.key)}
              </Chip>
            ))}
          </div>

          <div className="ip-list">
            {visibleRows.length === 0 ? (
              <p className="muted" style={{ fontSize: 13, padding: '10px 0' }}>
                No rows in this category.
              </p>
            ) : (
              visibleRows.map((row) => (
                <PreviewRow key={row.rowNumber} row={row} choice={choices[row.rowNumber]} onChoose={choose} />
              ))
            )}
          </div>

          {canReport && (
            <div style={{ marginTop: 12 }}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={downloadReport}>
                <Icon.download />
                Download rejected and warning rows (CSV)
              </button>
              <p className="muted" style={{ fontSize: 12.5, margin: '6px 0 0' }}>
                The report contains the player names from your file so you can correct them. It stays on this device.
              </p>
            </div>
          )}
        </div>
      )}

      <div className="modal-foot" style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
        <button type="button" className="btn btn-ghost" onClick={cancel}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled
          title="Saving imported players is not enabled in this preview release"
        >
          Import {actionable} row{actionable === 1 ? '' : 's'}
        </button>
      </div>
      <p className="muted" style={{ fontSize: 12, margin: '6px 0 0', textAlign: 'right' }}>
        Cancelling is always safe and discards everything: selecting a file never writes.
      </p>
    </Modal>
  )
}
