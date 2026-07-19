// The registered players import modal: the two stage flow. Stage 1 parses,
// validates and previews entirely client side and writes NOTHING; stage 2 is the
// one explicit Confirm that calls the transactional import_players RPC (PR 5
// write half). Everything runs in the uploading user's own browser tab, and no
// file, name, row or filename is ever logged, put in a URL, or sent anywhere
// except the minimum normalised operations the confirm submits.
//
// Parsing is playersImportParse.ts; classification is playersImportPlan.ts; the
// commit payload and outcome counts are playersImportCommit.ts; the rejected
// report is playersImportReport.ts; all pure and unit tested. The modal only
// orchestrates: pick a file, show the preview, let the user resolve each
// needs-your-choice collision, confirm once, show the outcome, then discard
// every parsed row on success, cancel or unmount.
//
// UI contract: docs/product/registered-players-ux.md (section 7 non dismissible
// pending state and focus; section 8 import modal, preview and outcome; section
// 12 accessibility). Rules and idempotency:
// docs/product/registered-players-import-export.md and
// docs/adr/ADR-0007-player-import-export-architecture.md.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { RegisteredPlayer, Team } from '../lib/data'
import { fileExtension, readImportFile, type ParsedSheet } from '../lib/playersImportParse'
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
import {
  batchReference,
  buildImportOperations,
  importFailureReason,
  importOutcomeSentence,
  importRefusalReason,
  importResultCounts,
  type ImportResultCounts,
  type ImportServerResult,
} from '../lib/playersImportCommit'
import { downloadIssuesReport, hasReportableIssues } from '../lib/playersImportReport'
import { downloadTemplate } from '../lib/playersTemplate'
import { useClubPlayerIdentities, useImportPlayers } from '../lib/queries'
import { useGuardedSubmit } from '../hooks/useGuardedSubmit'
import { Icon } from './icons'
import { ActionError, Chip, Modal } from './ui'

// One preview row: the class pill (and a Warning pill when a non-invalid row
// carries warnings), the player name from the file, the detail line, and, for a
// needs-your-choice row, the inline Skip / Import as new controls. Exported and
// pure so it is covered with the static renderer. Choice controls are disabled
// while a confirm is in flight (the caller passes disabled).
export function PreviewRow({
  row,
  choice,
  onChoose,
  disabled,
}: {
  row: PlanRow
  choice: Choice | undefined
  onChoose?: (rowNumber: number, choice: Choice) => void
  disabled?: boolean
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
            disabled={disabled}
            onClick={() => onChoose(row.rowNumber, 'skip')}
          >
            Skip
          </button>
          <button
            type="button"
            className={'btn btn-sm' + (choice === 'new' ? ' btn-primary' : ' btn-ghost')}
            aria-pressed={choice === 'new'}
            disabled={disabled}
            onClick={() => onChoose(row.rowNumber, 'new')}
          >
            Import as new
          </button>
        </div>
      )}
    </div>
  )
}

// The terminal outcome of a confirmed import: success (with the safe aggregate
// counts and the batch reference) or failure (a safe reason, no name). Rendered
// from these fields alone, so the parsed rows are cleared once it is set.
export type Outcome =
  | { kind: 'success'; counts: ImportResultCounts; warnings: number; batchId: string; settledAt: string | null }
  | { kind: 'failure'; reason: string }

// The outcome screen body (stage 3), presentational and pure so the results copy
// and counts are pinned with the static renderer (the house style). It renders
// from safe aggregate counts and a batch reference only, never a name or a row.
export function ImportOutcomeBody({ outcome, seasonName }: { outcome: Outcome; seasonName: string }) {
  if (outcome.kind === 'failure') {
    return <ActionError style={{ marginTop: 8 }}>Nothing was imported. {outcome.reason}</ActionError>
  }
  return (
    <div className="ip-outcome">
      <div className="ip-outcome-icon ok" aria-hidden="true">
        <Icon.check />
      </div>
      <p style={{ fontSize: 15, fontWeight: 700, margin: '8px 0 4px' }}>
        {importOutcomeSentence(outcome.counts, seasonName)}
      </p>
      {outcome.warnings > 0 && (
        <p className="muted" style={{ fontSize: 13, margin: '0 0 4px' }}>
          {outcome.warnings} of these carried warnings.
        </p>
      )}
      <p className="muted mono" style={{ fontSize: 12.5, margin: '4px 0 0' }}>
        {batchReference(outcome.batchId)}
        {outcome.settledAt ? `, ${new Date(outcome.settledAt).toLocaleString()}` : ''}
      </p>
    </div>
  )
}

// What the guarded submit performs and returns. summary and seasonName travel in
// the input so the once-captured perform can build the outcome without reading
// live state, and the batch id makes a repeated confirm idempotent server side.
interface ConfirmInput {
  batchId: string
  seasonId: string
  seasonName: string
  summary: PlanSummary
  format: 'csv' | 'xlsx'
  operations: ReturnType<typeof buildImportOperations>
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
  const [format, setFormat] = useState<'csv' | 'xlsx'>('csv')
  const [parsing, setParsing] = useState(false)
  const [parseError, setParseError] = useState<string | null>(null)
  const [sheet, setSheet] = useState<ParsedSheet | null>(null)
  const [choices, setChoices] = useState<Record<number, Choice>>({})
  const [filter, setFilter] = useState<PreviewFilter>('all')
  const [actionMsg, setActionMsg] = useState('')
  const [drag, setDrag] = useState(false)
  // The season the current preview was parsed against, so a season change (which
  // cannot happen behind the modal, but is guarded defensively) disables confirm.
  // State, not a ref, so it is safe to read during render.
  const [parsedSeason, setParsedSeason] = useState<string | null>(null)
  // The terminal outcome, null until the confirm settles. When set, the body
  // swaps to the outcome screen and the parsed rows are cleared.
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  // A monotonic token so a slow parse from a superseded pick is ignored, and so
  // nothing runs after the modal unmounts.
  const pickToken = useRef(0)
  // The client minted batch id, one per produced preview (per parsed file). A
  // repeated confirm of the same preview reuses it, so the server replays the
  // stored result rather than importing twice. A new file mints a new id.
  const batchIdRef = useRef<string | null>(null)

  const qc = useQueryClient()
  const importMutation = useImportPlayers()

  // Recheck the register against the server when the import opens, so the preview
  // is built against fresh data and a stale preview cannot silently commit
  // incorrect changes. The server also re-validates every row at commit and
  // refuses a stale one with a clear failure, so this is defence in depth.
  useEffect(() => {
    void qc.invalidateQueries({ queryKey: ['registrations', season.id] })
    void qc.invalidateQueries({ queryKey: ['player_identities'] })
  }, [qc, season.id])

  // Club player identities verify Player ID ownership in the preview (and give
  // the stored name for the rename warning). Loaded lazily while the modal is open.
  const { data: clubIdentities, isPending: identitiesPending, isError: identitiesError } = useClubPlayerIdentities(true)

  const plan: Plan | null = useMemo(() => {
    if (!sheet || !clubIdentities) return null
    return classify(sheet, { seasonName: season.name, seasonRows, clubIdentities, teams })
  }, [sheet, clubIdentities, season.name, seasonRows, teams])

  const summary: PlanSummary | null = useMemo(() => (plan ? summarize(plan, choices) : null), [plan, choices])
  const baseAnnouncement = useMemo(() => (plan ? announceSummary(summarize(plan, {})) : ''), [plan])

  // The guarded submit: one attempt at a time (a duplicate click is ignored), a
  // late-settling write never runs after unmount, and a clean server refusal
  // resolves to a terminal outcome (never the retryable error path). Only a
  // transport or unexpected error takes the guard's failure path, which offers a
  // safe retry (the same batch id makes a retry idempotent).
  const { submit, pending, failed } = useGuardedSubmit<ConfirmInput, Outcome>({
    operation: 'import-players',
    perform: async (input) => {
      try {
        const result = (await importMutation.mutateAsync({
          batchId: input.batchId,
          seasonId: input.seasonId,
          payload: { format: input.format, rows: input.operations },
        })) as ImportServerResult
        if (result.outcome === 'succeeded') {
          const counts = importResultCounts(result, input.summary)
          return { kind: 'success', counts, warnings: counts.warnings, batchId: input.batchId, settledAt: result.settled_at }
        }
        return { kind: 'failure', reason: importFailureReason(result.failure_summary) }
      } catch (e) {
        // A clean Postgres refusal (archived or cross club season, revoked
        // capability, malformed payload, cross club batch id) carries a code and
        // is terminal; anything else is a transport error and is retryable.
        const code = (e as { code?: string }).code
        if (code) return { kind: 'failure', reason: importRefusalReason((e as { message?: string }).message) }
        throw e
      }
    },
    onSuccess: (o) => {
      setOutcome(o)
      // Clear every parsed file and row from state once the attempt is settled
      // (success or a terminal failure): the outcome screen renders from the safe
      // counts in `o` alone, so the names can go. A transport error keeps the
      // preview so the user can retry.
      setSheet(null)
      setChoices({})
      setFileName(null)
    },
  })
  const submitting = pending !== null

  const resetForNewPick = () => {
    setParseError(null)
    setSheet(null)
    setChoices({})
    setFilter('all')
    setActionMsg('')
    setOutcome(null)
    batchIdRef.current = null
    setParsedSeason(null)
  }

  const onPick = async (file: File | undefined | null) => {
    if (!file || submitting) return
    const token = ++pickToken.current
    resetForNewPick()
    setFileName(file.name)
    setFormat(fileExtension(file.name) === '.xlsx' ? 'xlsx' : 'csv')
    setParsing(true)
    const result = await readImportFile(file)
    if (token !== pickToken.current) return // superseded pick or unmounted
    setParsing(false)
    if (!result.ok) {
      setParseError(result.message)
      return
    }
    setSheet(result.sheet)
    // Mint a fresh batch id and record the season this preview was parsed
    // against, so a repeated confirm of THIS preview is idempotent and a season
    // change disables confirm.
    batchIdRef.current = crypto.randomUUID()
    setParsedSeason(season.id)
  }

  // On unmount, bump the token so any in-flight parse skips its setState, and let
  // React discard the parsed dataset with the component (no module level cache
  // holds it, so it is unreferenced and collectable once the modal closes).
  useEffect(() => {
    const token = pickToken
    return () => {
      token.current += 1
    }
  }, [])

  const choose = (rowNumber: number, choice: Choice) => {
    if (submitting) return
    setChoices((prev) => ({ ...prev, [rowNumber]: choice }))
  }

  const downloadReport = () => {
    if (!plan || submitting) return
    downloadIssuesReport(plan)
    setActionMsg('')
    queueMicrotask(() => setActionMsg('Report downloaded.'))
  }

  const lifecycleMsg = parsing
    ? 'Reading the file on this device…'
    : parseError
      ? parseError
      : baseAnnouncement

  const cancel = () => {
    if (submitting) return // non dismissible while the confirm is in flight
    pickToken.current += 1
    resetForNewPick()
    setFileName(null)
    onClose()
  }

  const visibleRows = plan ? rowsForFilter(plan, filter) : []
  const canReport = plan ? hasReportableIssues(plan) : false
  const actionable = summary?.actionable ?? 0

  // Every needs-your-choice row must carry an explicit decision before confirm.
  const allChoicesMade = plan ? plan.rows.every((r) => r.class !== 'needs_choice' || choices[r.rowNumber] !== undefined) : false
  // The selected season must still be the season the preview was parsed against.
  const sameSeason = parsedSeason === season.id
  const confirmEnabled =
    !!plan &&
    !!summary &&
    !parseError &&
    !identitiesError &&
    actionable >= 1 &&
    allChoicesMade &&
    sameSeason &&
    !submitting

  const confirm = () => {
    if (!plan || !summary || !confirmEnabled || !batchIdRef.current) return
    const operations = buildImportOperations(plan, choices)
    if (operations.length === 0) return
    void submit({
      batchId: batchIdRef.current,
      seasonId: season.id,
      seasonName: season.name,
      summary,
      format,
      operations,
    })
  }

  // ---- The outcome screen (stage 3): the body swaps to the result and the
  // footer collapses to a single Done. Rendered from `outcome` alone.
  if (outcome) {
    const outcomeMsg =
      outcome.kind === 'success'
        ? importOutcomeSentence(outcome.counts, season.name) +
          (outcome.warnings > 0 ? ` ${outcome.warnings} carried warnings.` : '')
        : `Nothing was imported. ${outcome.reason}`
    return (
      <Modal title="Import players" sub={`Into ${season.name}`} onClose={onClose}>
        <div aria-live="polite" className="sr-only">
          {outcomeMsg}
        </div>
        <ImportOutcomeBody outcome={outcome} seasonName={season.name} />
        <div className="modal-foot" style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
          <button type="button" className="btn btn-primary" autoFocus onClick={onClose}>
            Done
          </button>
        </div>
      </Modal>
    )
  }

  return (
    <Modal title="Import players" sub={`Into ${season.name}`} onClose={cancel} wide dismissible={!submitting}>
      {/* Two polite live regions: the parse/preview lifecycle (derived) and a
          transient action announcement (the report download). */}
      <div aria-live="polite" className="sr-only">
        {submitting ? 'Importing. Do not close this window.' : lifecycleMsg}
      </div>
      <div aria-live="polite" className="sr-only">
        {actionMsg}
      </div>

      {/* Stage 0: pick. An accessible dropzone: a real, focusable button opens
          the picker, and drag and drop is an enhancement, never the only way. */}
      <div
        className={'ip-dropzone' + (drag ? ' drag' : '')}
        onDragOver={(e) => {
          if (submitting) return
          e.preventDefault()
          setDrag(true)
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDrag(false)
          if (submitting) return
          void onPick(e.dataTransfer.files?.[0])
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.xlsx"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            void onPick(e.target.files?.[0])
            e.target.value = ''
          }}
        />
        <Icon.upload style={{ width: 26, height: 26, color: 'var(--slate-2)' }} />
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => inputRef.current?.click()}
          disabled={parsing || submitting}
        >
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
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => downloadTemplate('csv')} disabled={submitting}>
            Download template (CSV)
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => downloadTemplate('xlsx')} disabled={submitting}>
            XLSX
          </button>
        </div>
      </div>

      {parsing && (
        <p className="muted" role="status" style={{ fontSize: 13.5, marginTop: 12 }}>
          Reading the file…
        </p>
      )}

      {parseError && <ActionError style={{ marginTop: 12 }}>{parseError}</ActionError>}

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
                <PreviewRow
                  key={row.rowNumber}
                  row={row}
                  choice={choices[row.rowNumber]}
                  onChoose={choose}
                  disabled={submitting}
                />
              ))
            )}
          </div>

          {canReport && (
            <div style={{ marginTop: 12 }}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={downloadReport} disabled={submitting}>
                <Icon.download />
                Download rejected and warning rows (CSV)
              </button>
              <p className="muted" style={{ fontSize: 12.5, margin: '6px 0 0' }}>
                The report contains the player names from your file so you can correct them. It stays on this device.
              </p>
            </div>
          )}

          {/* The pending progress sentence: the modal cannot be closed while the
              confirm is in flight (section 7). */}
          {submitting && (
            <p role="status" style={{ fontSize: 13.5, fontWeight: 700, marginTop: 12 }}>
              Importing. Do not close this window.
            </p>
          )}
          {/* A transport or unexpected error is retryable: the batch id makes a
              retry idempotent, so the same actionable rows commit at most once. */}
          {failed && !submitting && (
            <ActionError style={{ marginTop: 12 }} onRetry={confirm}>
              Could not reach the server to import. Check your connection and try again.
            </ActionError>
          )}
        </div>
      )}

      <div className="modal-foot" style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
        <button type="button" className="btn btn-ghost" onClick={cancel} disabled={submitting}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" onClick={confirm} disabled={!confirmEnabled}>
          {submitting ? 'Importing…' : `Import ${actionable} row${actionable === 1 ? '' : 's'}`}
        </button>
      </div>
      <p className="muted" style={{ fontSize: 12, margin: '6px 0 0', textAlign: 'right' }}>
        Cancelling is always safe and discards everything: selecting a file never writes.
      </p>
    </Modal>
  )
}
