// The blank registered players import template: a header only CSV (the primary
// format, opens everywhere) and XLSX (the compatibility format, one worksheet
// named Players). Both carry the same seven stable headers and no data rows, so
// a coach downloads a file to fill in. The headers are pinned by a unit test so
// they never drift from the import contract.
//
// Format and the exact header row: docs/product/registered-players-import-export.md
// (Import template). The template ships in PR 4 alongside export (delivery plan
// PR 4); the import flow that consumes a filled template arrives in PR 5. The
// same formula injection escaping the export uses applies here (the headers
// never trigger it, but the builders are shared).
import { buildCsv, buildXlsx, triggerDownload, CSV_MIME, XLSX_MIME } from './playersExport'

// The seven template headers, in order. Exports add an eighth column, Last
// Updated, which the import contract recognises and silently ignores; the
// template itself carries only these seven so a hand filled file needs no
// export only column.
export const TEMPLATE_HEADERS = [
  'Player ID',
  'Player Name',
  'Season',
  'Team',
  'Registration Status',
  'Shirt Number',
  'Registered Date',
] as const

export const TEMPLATE_CSV_FILENAME = 'registered-players-template.csv'
export const TEMPLATE_XLSX_FILENAME = 'registered-players-template.xlsx'

export function buildTemplateCsv(): string {
  return buildCsv(TEMPLATE_HEADERS, [])
}

export function buildTemplateXlsx(): ArrayBuffer {
  return buildXlsx(TEMPLATE_HEADERS, [])
}

// Build the blank template and hand it to the browser. No child data is
// involved, so no audit event is written (unlike a data export).
export function downloadTemplate(format: 'csv' | 'xlsx'): void {
  if (format === 'csv') {
    triggerDownload(new Blob([buildTemplateCsv()], { type: CSV_MIME }), TEMPLATE_CSV_FILENAME)
  } else {
    triggerDownload(new Blob([buildTemplateXlsx()], { type: XLSX_MIME }), TEMPLATE_XLSX_FILENAME)
  }
}
