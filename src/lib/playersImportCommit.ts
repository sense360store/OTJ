// Registered players import, stage two: the commit payload and the outcome
// counts. Pure and deterministic so the "what gets sent" and "what the outcome
// screen shows" rules are provable without a DOM, the same discipline as
// playersImportPlan.ts. This module NEVER writes and NEVER logs a name; it
// shapes the minimum normalised operations the transactional import_players RPC
// receives (docs/adr/ADR-0007-player-import-export-architecture.md) and the
// safe aggregate counts the outcome screen renders
// (docs/product/registered-players-import-export.md, Import results;
// docs/product/registered-players-ux.md, section 8 stage 3).
//
// The server is authoritative and re-validates every field, so nothing here is
// trusted at commit: the operation is the desired write, and the RPC re-derives
// its outcome by Player ID, never auto merging by name.
import type { RegistrationStatus } from './data'
import type { Choice, Plan, PlanSummary } from './playersImportPlan'

// One proposed write. The server derives the kind from the presence of a
// player_id (an existing identity in the caller's club) rather than any client
// "op" label: a player_id present is an update by id (no name; import never
// renames), a player_id absent is a new identity carrying the file name. row is
// the file row number, sent only so a server refusal can name the row; it is not
// personal data. team_id null means Unassigned.
export interface ImportOperation {
  row: number
  player_id: string | null
  name: string | null
  team_id: string | null
  status: RegistrationStatus
  shirt_number: number | null
  registered_date: string | null
}

// Build the minimum normalised operations to send: ONLY the actionable rows,
// valid new, valid update, and needs-your-choice rows the user resolved to
// Import as new. Rows the preview marked invalid, already present, resolved to
// Skip, or left unresolved are NEVER sent (an invalid row is never a write
// candidate). The order follows the file; the server re-validates each row.
export function buildImportOperations(plan: Plan, choices: Record<number, Choice>): ImportOperation[] {
  const ops: ImportOperation[] = []
  for (const r of plan.rows) {
    // Every actionable row carries its resolved fields; a guard keeps a
    // malformed plan from ever emitting an operation without them.
    if (!r.resolved) continue
    if (r.class === 'update') {
      if (!r.matchPlayerId) continue
      ops.push({
        row: r.rowNumber,
        player_id: r.matchPlayerId,
        name: null,
        team_id: r.resolved.teamId,
        status: r.resolved.status,
        shirt_number: r.resolved.shirt,
        registered_date: r.resolved.date,
      })
    } else if (r.class === 'new' || (r.class === 'needs_choice' && choices[r.rowNumber] === 'new')) {
      ops.push({
        row: r.rowNumber,
        player_id: null,
        name: r.playerName,
        team_id: r.resolved.teamId,
        status: r.resolved.status,
        shirt_number: r.resolved.shirt,
        registered_date: r.resolved.date,
      })
    }
    // already_present, needs_choice (skip or unresolved) and invalid: not sent.
  }
  return ops
}

// The whole confirmed payload the RPC receives as its single jsonb argument.
// The format travels with the rows so the fixed three argument signature holds.
export interface ImportPayload {
  format: 'csv' | 'xlsx'
  rows: ImportOperation[]
}

// The structured result the RPC returns (server derived counts and outcome
// only; never a name, a row or a file fingerprint).
export interface ImportServerResult {
  batch_id: string
  outcome: 'succeeded' | 'failed'
  rows_received: number
  added: number
  updated: number
  already_present: number
  resolved_new: number
  skipped: number
  invalid: number
  failure_summary: string | null
  settled_at: string | null
}

// The outcome screen's aggregate counts. A non-overlapping partition of the
// previewed total: the server is authoritative for what was written (added,
// updated, already present), and the client preview supplies what it withheld
// and never sent (skipped, rejected, warnings). Together they sum to the
// preview total (docs/product/registered-players-import-export.md, Import
// results; docs/product/registered-players-ux.md, section 8).
export interface ImportResultCounts {
  added: number
  updated: number
  alreadyPresent: number
  skipped: number
  rejected: number
  warnings: number
}

export function importResultCounts(server: ImportServerResult, summary: PlanSummary): ImportResultCounts {
  // needs-your-choice rows resolved to Import as new committed as added (server
  // side); the rest of the needs-your-choice rows (Skip or unresolved) were
  // withheld and are the client's skipped total. Derivable from the summary
  // alone: actionable = new + update + (needs_choice resolved to new).
  const resolvedNew = Math.max(0, summary.actionable - summary.newCount - summary.updateCount)
  const withheldSkips = Math.max(0, summary.needsChoice - resolvedNew)
  return {
    // Server derived: what was actually written.
    added: server.added,
    updated: server.updated,
    // Server no-op updates (a stale preview that committed as already present)
    // plus the rows the preview already knew were present and never sent.
    alreadyPresent: server.already_present + summary.alreadyPresent,
    // Client withheld: needs-your-choice rows not resolved to Import as new.
    skipped: withheldSkips,
    // Client withheld: invalid rows, never a write candidate.
    rejected: summary.invalid,
    // Overlay, never a bucket in the partition; shown separately.
    warnings: summary.warnings,
  }
}

// The short batch reference shown on the outcome screen ("Import 3f2a91c8"),
// the first eight hex characters of the batch uuid (the naming in
// docs/product/registered-players-spec.md). Never the full id in the UI.
export function batchReference(batchId: string): string {
  return `Import ${batchId.replace(/-/g, '').slice(0, 8)}`
}

// The success outcome sentence for the outcome screen. Warnings are noted
// separately by the caller, never folded into this sentence.
export function importOutcomeSentence(counts: ImportResultCounts, seasonName: string): string {
  return (
    `Imported into ${seasonName}: ` +
    `${counts.added} added, ${counts.updated} updated, ${counts.alreadyPresent} already present, ` +
    `${counts.skipped} skipped, ${counts.rejected} rejected.`
  )
}

// The user-facing reason for a terminal import failure, from the server's SAFE
// failure summary (a row number and a fixed reason from a bounded vocabulary).
// Never contains a name. A missing summary falls back to a generic sentence.
export function importFailureReason(failureSummary: string | null | undefined): string {
  const s = (failureSummary ?? '').trim()
  return s !== '' ? s : 'Nothing changed. Re-open the file and try again.'
}

// The user-facing reason for a RAISED refusal (an archived or cross club season,
// a revoked capability, a malformed payload, or a cross club batch id). The
// RPC's messages are safe (no names); strip the internal prefix and present a
// sentence. An unrecognised message falls back to a generic sentence.
export function importRefusalReason(message: string | null | undefined): string {
  const raw = (message ?? '').trim()
  const stripped = raw.replace(/^import_players:\s*/i, '').trim()
  if (stripped === '') return 'The import was refused. Re-open the file and try again.'
  const sentence = stripped.charAt(0).toUpperCase() + stripped.slice(1)
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`
}
