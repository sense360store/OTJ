// The rejected and warning row report: a client generated CSV a coach can use to
// correct their file, built entirely in the browser and never uploaded or kept
// anywhere. It contains children's names because a correction report without the
// name is unusable; it is a derivative of the user's own file on their own
// device, and the same secure handling guidance as export applies. The filename
// carries no player data.
//
// docs/product/registered-players-import-export.md (Import results): the report
// lists the original row number, Player Name, the offending column and the
// reason, and applies the same formula escaping as exports (reused here through
// buildCsv). PR 5 scope: no upload, no server copy, no audit.
import { buildCsv, triggerDownload, CSV_MIME } from './playersExport'
import type { Plan } from './playersImportPlan'

export const REPORT_HEADERS = ['Row', 'Player Name', 'Column', 'Reason'] as const

// One report row per invalid reason and per warning, in file order. Invalid rows
// contribute each of their field failures; any non-invalid row contributes each
// of its overlay warnings. Needs-your-choice and clean rows contribute nothing.
export function buildIssuesReportRows(plan: Plan): string[][] {
  const out: string[][] = []
  for (const r of plan.rows) {
    const rowNo = String(r.rowNumber)
    if (r.class === 'invalid') {
      for (const issue of r.issues) {
        out.push([rowNo, r.playerName, issue.column, issue.message])
      }
    } else {
      for (const warn of r.warnings) {
        out.push([rowNo, r.playerName, warn.column, warn.message])
      }
    }
  }
  return out
}

export function hasReportableIssues(plan: Plan): boolean {
  return plan.rows.some((r) => (r.class === 'invalid' ? r.issues.length > 0 : r.warnings.length > 0))
}

export function buildIssuesReportCsv(plan: Plan): string {
  return buildCsv(REPORT_HEADERS, buildIssuesReportRows(plan))
}

function stamp(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`
}

// registered-players-import-issues-<YYYYMMDD-HHmm>.csv. The date is injected so
// the generator is pure and provable without a clock. Never player data.
export function importIssuesFilename(now: Date): string {
  return `registered-players-import-issues-${stamp(now)}.csv`
}

// Build the report and hand it to the browser. now is injected only so the
// filename is deterministic in tests.
export function downloadIssuesReport(plan: Plan, now: Date = new Date()): void {
  const blob = new Blob([buildIssuesReportCsv(plan)], { type: CSV_MIME })
  triggerDownload(blob, importIssuesFilename(now))
}
