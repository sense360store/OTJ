// Registered players export: the pure CSV and XLSX builders, the formula
// injection escaping, the filename generator, and the DOM download side effect.
// Kept out of the component (and split from the DOM step) so every builder and
// every escape rule is provable without a browser, exactly as src/lib/ics.ts
// separates buildSessionIcs from downloadSessionIcs.
//
// The server (export_players, 0034) is the authority for WHAT leaves and for
// the audit record; this module only shapes the returned rows into a file. No
// child name is logged or encoded anywhere here; a display name only ever
// travels into a cell the caller already holds.
//
// Formats and rules: docs/product/registered-players-import-export.md (Export,
// Formula injection protection). Architecture: docs/adr/
// ADR-0007-player-import-export-architecture.md (Export).
import * as XLSX from 'xlsx'
import type { RegistrationStatus } from './data'

// The row shape export_players returns (PostgREST snake_case). team_name is
// already the empty string for an Unassigned registration; status is lower
// case and capitalised here for the file.
export interface ExportPlayerRow {
  player_id: string
  player_name: string
  season_name: string
  team_id: string | null
  team_name: string
  status: RegistrationStatus
  shirt_number: number | null
  registered_date: string | null
  updated_at: string
}

// The resolved view filter the client sends to export_players. The server
// treats these as a VIEW filter (never an access control), applies them under
// the club wide read scope, and records only a safe summary (the team id, the
// status set, and whether a search was applied), never the search text. The
// declared format is added by the export hook.
export interface ExportFilterPayload {
  // 'all' | 'unassigned' | a team uuid.
  team: string
  statuses: RegistrationStatus[]
  // A name search; used transiently to filter, never persisted or logged.
  search: string
}

// The eight export columns, in order (docs/product/registered-players-import-export.md,
// Export column order). The template has the first seven; Last Updated is the
// export only column the import contract recognises and silently ignores.
export const EXPORT_HEADERS = [
  'Player ID',
  'Player Name',
  'Season',
  'Team',
  'Registration Status',
  'Shirt Number',
  'Registered Date',
  'Last Updated',
] as const

// Registration Status renders capitalised in the file; the values round trip on
// import (matched case insensitively).
const EXPORT_STATUS_LABEL: Record<RegistrationStatus, string> = {
  pending: 'Pending',
  registered: 'Registered',
  withdrawn: 'Withdrawn',
}

// UTF-8 byte order mark, so Excel opens the CSV as UTF-8 rather than the local
// code page; RFC 4180 records are CRLF separated.
const BOM = '﻿'
const CRLF = '\r\n'

// A cell is dangerous when a spreadsheet application might interpret it as a
// formula: its first character is =, +, -, @, a tab or a carriage return. The
// extra apostrophe rule matches the CSV strip on import: a value that is one or
// more leading apostrophes followed immediately by =, +, - or @ is also
// guarded, so the single strip on import restores exactly the stored value and
// no apostrophes accumulate across export/import cycles
// (docs/product/registered-players-import-export.md, Formula injection).
export function needsFormulaGuard(value: string): boolean {
  if (value === '') return false
  const first = value[0]
  if (first === '=' || first === '+' || first === '-' || first === '@' || first === '\t' || first === '\r') {
    return true
  }
  const run = /^'+/.exec(value)
  if (run) {
    const after = value[run[0].length]
    if (after === '=' || after === '+' || after === '-' || after === '@') return true
  }
  return false
}

// One CSV cell: apply the formula guard (a leading apostrophe forces text
// interpretation), then RFC 4180 quoting (wrap and double the quotes when the
// value carries a comma, a quote or a line break).
export function escapeCsvCell(raw: string): string {
  const guarded = needsFormulaGuard(raw) ? "'" + raw : raw
  if (/[",\r\n]/.test(guarded)) return '"' + guarded.replace(/"/g, '""') + '"'
  return guarded
}

function csvRow(cells: string[]): string {
  return cells.map(escapeCsvCell).join(',')
}

// A CSV document: BOM, then the header and each data row, CRLF separated, with
// a trailing CRLF. A blank rows array (the template) yields the header alone.
export function buildCsv(header: readonly string[], rows: string[][]): string {
  const lines = [csvRow([...header]), ...rows.map(csvRow)]
  return BOM + lines.join(CRLF) + CRLF
}

// An XLSX document: one worksheet, EVERY cell written as a text (string) cell,
// so no value is ever a formula type and the formula triggers are inert. The
// text cell is the whole defence in this format, so no apostrophe prefix is
// added (values import back verbatim). Passing string values to aoa_to_sheet
// produces string cells; numbers would become numeric cells, so callers pass
// pre stringified values.
export function buildXlsx(header: readonly string[], rows: string[][], sheetName = 'Players'): ArrayBuffer {
  const aoa: string[][] = [[...header], ...rows]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  // type 'array' yields an ArrayBuffer, a valid BlobPart that XLSX.read parses
  // back for the round-trip unit test.
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
}

// One export row as its eight ordered cells (all strings; an empty string for a
// null team, shirt or date; the ISO timestamp for Last Updated).
export function exportCells(row: ExportPlayerRow): string[] {
  return [
    row.player_id,
    row.player_name,
    row.season_name,
    row.team_name,
    EXPORT_STATUS_LABEL[row.status] ?? row.status,
    row.shirt_number == null ? '' : String(row.shirt_number),
    row.registered_date ?? '',
    row.updated_at ?? '',
  ]
}

export function buildPlayersCsv(rows: ExportPlayerRow[]): string {
  return buildCsv(EXPORT_HEADERS, rows.map(exportCells))
}

export function buildPlayersXlsx(rows: ExportPlayerRow[]): ArrayBuffer {
  return buildXlsx(EXPORT_HEADERS, rows.map(exportCells))
}

// A filesystem safe season slug: the / in 2026/27 (and any other non word,
// non hyphen character) becomes a hyphen, giving 2026-27, with leading and
// trailing hyphens trimmed. Never contains player data.
export function seasonSlug(seasonName: string): string {
  return seasonName.replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '') || 'season'
}

function stamp(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`
}

// registered-players-<season>-<YYYYMMDD-HHmm>.<ext>. The date is injected so the
// generator is pure and the name is provable without a clock. Never player data.
export function exportFilename(seasonName: string, format: 'csv' | 'xlsx', now: Date): string {
  return `registered-players-${seasonSlug(seasonName)}-${stamp(now)}.${format}`
}

// The MIME types the download blobs declare.
const CSV_MIME = 'text/csv;charset=utf-8'
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

// The shared DOM download step (Blob, object URL, temporary anchor, revoke),
// the established pattern from downloadSessionIcs (src/lib/ics.ts). Not unit
// tested; the builders above and the filename generator are.
export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

// Build the file from the RPC's returned rows and hand it to the browser. The
// dataset is never stored anywhere; there is no server copy and no URL to
// retain. now is injected only so the filename is deterministic in tests.
export function downloadPlayersExport(
  rows: ExportPlayerRow[],
  format: 'csv' | 'xlsx',
  seasonName: string,
  now: Date = new Date(),
): void {
  const filename = exportFilename(seasonName, format, now)
  const blob =
    format === 'csv'
      ? new Blob([buildPlayersCsv(rows)], { type: CSV_MIME })
      : new Blob([buildPlayersXlsx(rows)], { type: XLSX_MIME })
  triggerDownload(blob, filename)
}

export { CSV_MIME, XLSX_MIME }
