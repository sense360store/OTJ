// Registered players import, stage one part A: parsing. A hostile spreadsheet
// is treated as untrusted input from the first byte. Everything here runs in the
// uploading user's own browser tab, with only their own privileges, and writes
// nothing: parsing produces an in memory grid of cells, and the classification
// (playersImportPlan.ts) turns that grid into the preview. No database call, no
// upload, no file kept anywhere. A file that fails a cap or a structural check
// is rejected before a single row is read into the plan.
//
// Formats, caps and the rejection list: docs/product/registered-players-import-export.md
// (Import formats and file rules). Architecture (browser parsing, no formula
// evaluation, the server re-validates regardless): docs/adr/
// ADR-0007-player-import-export-architecture.md. Security: the caps bound
// decompression bombs, a fatal UTF-8 decoder rejects mis-encoded files, XLSX
// formulas are never evaluated, and no file content is ever logged.
//
// PR 5 scope: parse, validate and preview only. Nothing here or downstream
// writes to the database.
import * as XLSX from 'xlsx'

// ---------------------------------------------------------------------------
// The seven template columns plus the one export only column the import
// contract recognises and silently ignores. The header row is matched case
// insensitively, after Unicode (NFKC) normalisation and whitespace collapse, so
// a confusable or oddly spaced header cannot slip past as a distinct column.
// ---------------------------------------------------------------------------
export type ImportField = 'playerId' | 'playerName' | 'season' | 'team' | 'status' | 'shirt' | 'registeredDate'

export const IMPORT_FIELDS: ImportField[] = [
  'playerId',
  'playerName',
  'season',
  'team',
  'status',
  'shirt',
  'registeredDate',
]

// Canonical header label for each field, and the export only label. Kept here so
// the parser is self contained; the same labels are pinned against the template
// and export builders by their own tests.
const FIELD_HEADER: Record<ImportField, string> = {
  playerId: 'Player ID',
  playerName: 'Player Name',
  season: 'Season',
  team: 'Team',
  status: 'Registration Status',
  shirt: 'Shirt Number',
  registeredDate: 'Registered Date',
}

const EXPORT_ONLY_HEADER = 'Last Updated'

// Normalise a header cell for matching: NFKC folds compatibility lookalikes,
// whitespace collapses, case is dropped. This is matching only; the raw header
// text is never used as an object key (prototype pollution defence below).
export function normalizeHeader(raw: string): string {
  return raw.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase()
}

const HEADER_TO_FIELD = new Map<string, ImportField>(
  IMPORT_FIELDS.map((f) => [normalizeHeader(FIELD_HEADER[f]), f]),
)
const EXPORT_ONLY_KEY = normalizeHeader(EXPORT_ONLY_HEADER)

// ---------------------------------------------------------------------------
// Caps. File size is checked first (before any parse), then rows and columns.
// docs/product/registered-players-import-export.md (Import formats and file rules).
// ---------------------------------------------------------------------------
export const CSV_MAX_BYTES = 1 * 1024 * 1024 // 1 MB
export const XLSX_MAX_BYTES = 2 * 1024 * 1024 // 2 MB
export const MAX_DATA_ROWS = 500
export const MAX_COLUMNS = 30
// A hard ceiling on the total records the tokenizer will hold, so a file padded
// with blank lines under the size cap cannot exhaust memory before the data row
// cap is reached. Well above any real grassroots file.
const MAX_TOTAL_RECORDS = 100_000
// The most rows SheetJS is allowed to materialise from a workbook, passed as the
// `sheetRows` read option so a declared used range far larger than the data (a
// crafted A1:AD100001 range, or Excel's inflated ghost used-range) cannot drive
// O(rows*cols) work off metadata alone. Comfortably above the 500 data row cap
// plus any realistic run of interspersed blank rows; the real data row cap is
// still enforced in buildSheet.
const XLSX_MAX_SHEET_ROWS = 5000

// MIME accept lists. The browser frequently supplies an empty or misleading
// type, so the extension plus the content checks are the real gate; a type
// outside the list is still rejected.
const CSV_MIME_ACCEPT = new Set(['text/csv', 'application/vnd.ms-excel', 'text/plain', ''])
const XLSX_MIME_ACCEPT = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/octet-stream',
  '',
])

// ---------------------------------------------------------------------------
// The parsed shape handed to the plan. A FieldCell carries the trimmed text
// value; badType is set for an XLSX cell whose type can never be a valid import
// value (a formula, a boolean, or an error cell), so the plan can reject that
// row with the right reason without the parser needing to know field semantics.
// ---------------------------------------------------------------------------
export interface FieldCell {
  value: string
  // Set when the source cell is a type that is never valid data (XLSX formula,
  // boolean or error cell). The value is then the empty string.
  badType?: string
}

export type FieldMap = Record<ImportField, FieldCell>

export interface ParsedRow {
  // The row number as the user sees it in their file: the header is row 1, so
  // the first data row is row 2. Blank rows keep their number, so a reference
  // like "row 12" points at the right line even when earlier rows were blank.
  rowNumber: number
  fields: FieldMap
}

export interface ParsedSheet {
  rows: ParsedRow[]
  // Blank rows skipped, shown as a count in the preview. Never read as data.
  blankRows: number
  // Unknown header labels (warned and ignored). Export only Last Updated is not
  // listed here: it is recognised and silently ignored.
  ignoredHeaders: string[]
}

export type ParseErrorCode =
  | 'extension'
  | 'empty'
  | 'size'
  | 'mime'
  | 'encoding'
  | 'delimiter'
  | 'header_missing'
  | 'header_required'
  | 'header_duplicate'
  | 'too_many_rows'
  | 'too_many_columns'
  | 'worksheet_count'
  | 'merged_cells'
  | 'protected'
  | 'macro'
  | 'external_links'
  | 'unreadable'

export type ParseOutcome =
  | { ok: true; sheet: ParsedSheet }
  | { ok: false; code: ParseErrorCode; message: string }

function fail(code: ParseErrorCode, message: string): ParseOutcome {
  return { ok: false, code, message }
}

const emptyFields = (): FieldMap => {
  // Built field by field over the fixed key set: no header text ever becomes an
  // object key, so a header like __proto__ cannot pollute a prototype.
  const map = {} as FieldMap
  for (const f of IMPORT_FIELDS) map[f] = { value: '' }
  return map
}

// ---------------------------------------------------------------------------
// Cell text normalisation, shared by both formats.
//   - Strip a BOM and zero width characters that could hide inside a value.
//   - Trim (JS trim removes Unicode whitespace, including no break space).
//   - Strip exactly one leading apostrophe when the value, ignoring any further
//     leading apostrophes, then begins with =, +, - or @. This is the inverse of
//     the CSV export formula guard, so an export/import round trip is stable and
//     never accumulates apostrophes. CSV only; XLSX text cells import verbatim.
// The remaining control character check is the plan's job (it is a per field
// validity question), not the parser's.
// ---------------------------------------------------------------------------
// The BOM and the zero width characters that can hide inside a value. Kept as
// explicit code points so no invisible character sits in the source and no
// control-character regex is needed (they are all at or above U+200B).
const ZERO_WIDTH_CODES = new Set([0xfeff, 0x200b, 0x200c, 0x200d, 0x2060])

export function cleanText(raw: string): string {
  let out = ''
  for (const ch of raw) {
    if (!ZERO_WIDTH_CODES.has(ch.codePointAt(0) as number)) out += ch
  }
  return out.trim()
}

export function stripCsvFormulaGuard(value: string): string {
  // One or more leading apostrophes immediately followed by a trigger character:
  // remove exactly the first apostrophe.
  if (/^'+[=+\-@]/.test(value)) return value.slice(1)
  return value
}

// ---------------------------------------------------------------------------
// CSV tokenizer, RFC 4180. Fields separated by comma, records by CRLF, LF or a
// lone CR. A field may be quoted; inside quotes a doubled quote is a literal
// quote and separators are data. Nothing is guessed: a malformed quote is read
// literally rather than reinterpreting the delimiter.
// ---------------------------------------------------------------------------
export function tokenizeCsv(text: string): string[][] {
  const records: string[][] = []
  let field = ''
  let record: string[] = []
  let inQuotes = false
  let i = 0
  const n = text.length

  const endField = () => {
    record.push(field)
    field = ''
  }
  const endRecord = () => {
    record.push(field)
    field = ''
    records.push(record)
    record = []
    if (records.length > MAX_TOTAL_RECORDS) {
      // Bail hard: a file padded with newlines cannot force an unbounded array.
      throw new RangeError('too_many_records')
    }
  }

  while (i < n) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i += 1
        continue
      }
      field += ch
      i += 1
      continue
    }
    if (ch === '"') {
      // A quote only opens a quoted section at the start of a field; elsewhere it
      // is a literal character (lenient, never a reinterpretation of the row).
      if (field === '') {
        inQuotes = true
        i += 1
        continue
      }
      field += ch
      i += 1
      continue
    }
    if (ch === ',') {
      endField()
      i += 1
      continue
    }
    if (ch === '\r') {
      endRecord()
      if (text[i + 1] === '\n') i += 2
      else i += 1
      continue
    }
    if (ch === '\n') {
      endRecord()
      i += 1
      continue
    }
    field += ch
    i += 1
  }
  // Emit the trailing record unless the input ended exactly on a record
  // separator (field empty and no cells accumulated), which would otherwise add
  // a spurious empty record.
  if (field !== '' || record.length > 0 || inQuotes) {
    record.push(field)
    records.push(record)
  }
  return records
}

// Map the header record to field column indices, validating structure. Returns
// the column index per field (or -1 when the column is absent), plus the set of
// ignored unknown header labels. A structural problem returns a ParseOutcome
// error instead.
interface HeaderMap {
  columnForField: Record<ImportField, number>
  ignoredHeaders: string[]
  columnCount: number
}

function mapHeaders(headerRow: string[]): HeaderMap | ParseOutcome {
  if (headerRow.length > MAX_COLUMNS) {
    return fail('too_many_columns', `The file has more than ${MAX_COLUMNS} columns. Use the template layout.`)
  }
  const columnForField = {} as Record<ImportField, number>
  for (const f of IMPORT_FIELDS) columnForField[f] = -1
  const ignoredHeaders: string[] = []
  const seen = new Map<string, number>() // normalised header -> first column

  for (let c = 0; c < headerRow.length; c++) {
    const rawHeader = cleanText(headerRow[c])
    if (rawHeader === '') continue // an empty header cell maps nothing
    const key = normalizeHeader(rawHeader)
    // Duplicate header: any header label appearing twice (after normalisation)
    // is an error, so a confusable second copy cannot shadow the first.
    if (seen.has(key)) {
      return fail('header_duplicate', `The column "${rawHeader}" appears more than once. Use one of each column.`)
    }
    seen.set(key, c)
    if (key === EXPORT_ONLY_KEY) continue // Last Updated: recognised, silently ignored
    const field = HEADER_TO_FIELD.get(key)
    if (field) {
      columnForField[field] = c
    } else {
      ignoredHeaders.push(rawHeader)
    }
  }

  if (columnForField.playerName === -1) {
    return fail(
      'header_required',
      'The file is missing the required Player Name column. Download the template and use its headers.',
    )
  }
  return { columnForField, ignoredHeaders, columnCount: headerRow.length }
}

// Turn tokenized records (header first) into the ParsedSheet, applying the row
// cap, skipping and counting blank rows, and pulling each known column into a
// FieldCell. Shared by CSV and XLSX once each has produced string records.
// applyFormulaGuard strips the CSV leading apostrophe; XLSX passes it as a no op.
function buildSheet(
  records: string[][],
  header: HeaderMap,
  opts: { firstDataRowNumber: number; applyFormulaGuard: boolean; badTypeAt?: (rowIndex: number, col: number) => string | undefined },
): ParseOutcome {
  const rows: ParsedRow[] = []
  let blankRows = 0
  const dataRecords = records.slice(1)

  for (let r = 0; r < dataRecords.length; r++) {
    const rec = dataRecords[r]
    const rowNumber = opts.firstDataRowNumber + r
    // A row is blank when every cell trims to empty. Blank rows are skipped and
    // counted, never read as data.
    const isBlank = rec.every((cell) => cleanText(cell) === '')
    if (isBlank) {
      blankRows += 1
      continue
    }
    if (rows.length >= MAX_DATA_ROWS) {
      return fail(
        'too_many_rows',
        `The file has more than ${MAX_DATA_ROWS} players. Split it into smaller files under ${MAX_DATA_ROWS} rows.`,
      )
    }
    const fields = emptyFields()
    for (const f of IMPORT_FIELDS) {
      const col = header.columnForField[f]
      if (col === -1) continue
      const bad = opts.badTypeAt?.(r, col)
      if (bad) {
        fields[f] = { value: '', badType: bad }
        continue
      }
      let value = cleanText(rec[col] ?? '')
      if (opts.applyFormulaGuard) value = stripCsvFormulaGuard(value)
      fields[f] = { value }
    }
    rows.push({ rowNumber, fields })
  }

  return { ok: true, sheet: { rows, blankRows, ignoredHeaders: header.ignoredHeaders } }
}

// ---------------------------------------------------------------------------
// CSV parse from already decoded text. Detects a semicolon delimited file (a
// common European Excel save) and rejects it with a clear message rather than
// reading the whole row as one cell.
// ---------------------------------------------------------------------------
export function parseCsv(text: string): ParseOutcome {
  let records: string[][]
  try {
    records = tokenizeCsv(text)
  } catch {
    return fail(
      'too_many_rows',
      `The file has more than ${MAX_DATA_ROWS} players. Split it into smaller files under ${MAX_DATA_ROWS} rows.`,
    )
  }
  if (records.length === 0 || (records.length === 1 && records[0].every((c) => cleanText(c) === ''))) {
    return fail('header_missing', 'The file has no header row. Download the template and fill it in.')
  }
  const headerRow = records[0]
  // Semicolon delimiter: the whole header collapsed into one cell that carries
  // semicolons is the tell.
  if (headerRow.length === 1 && headerRow[0].includes(';')) {
    return fail(
      'delimiter',
      'This file looks semicolon separated. Save it as comma separated CSV (UTF-8) and import again.',
    )
  }
  const header = mapHeaders(headerRow)
  if ('ok' in header) return header // a ParseOutcome error
  return buildSheet(records, header, { firstDataRowNumber: 2, applyFormulaGuard: true })
}

// ---------------------------------------------------------------------------
// XLSX parse from raw bytes via SheetJS. The workbook is treated as hostile:
//   - exactly one worksheet (a second, hidden or visible, is an error);
//   - no merged cells;
//   - no macros (a .xlsm is rejected by extension; a workbook carrying VBA is
//     rejected here);
//   - formula, boolean and error typed cells are never valid values;
//   - a date typed cell becomes an ISO date, a numeric cell is stringified.
// SheetJS evaluates no formulas; a formula arrives as an inert string with the
// cell's .f set, which we treat as an invalid cell value. An unreadable or
// password protected workbook is rejected.
// ---------------------------------------------------------------------------
export function parseWorkbook(data: ArrayBuffer): ParseOutcome {
  // External link parts (a workbook referencing another file, or a data
  // connection / web query) are rejected outright per the file rules and the
  // threat model. Detected from the raw zip part names, which appear as literal
  // ASCII in the archive, so this holds regardless of what the parser surfaces.
  // The parser evaluates no formulas and makes no network call, so this is
  // defence in depth, not the only barrier, but the documented rule is enforced.
  if (hasExternalLinkParts(data)) {
    return fail(
      'external_links',
      'This file links to another workbook or an external data source, which cannot be imported. Remove the links and save a plain .xlsx.',
    )
  }

  let wb: XLSX.WorkBook
  try {
    wb = XLSX.read(data, {
      type: 'array',
      // Do not let the library evaluate or fetch anything. cellFormula keeps the
      // formula string so we can detect and reject it; cellHTML off avoids
      // building rich text; cellNF keeps each cell's number format so a date
      // cell is recognised and converted from its serial in a timezone
      // independent way (readCell), never through a locale dependent Date.
      // sheetRows bounds how many rows the library materialises, so a declared
      // range far larger than the data cannot drive O(rows*cols) work.
      cellFormula: true,
      cellHTML: false,
      cellNF: true,
      sheetRows: XLSX_MAX_SHEET_ROWS,
    })
  } catch {
    return fail('protected', 'This file could not be read. It may be password protected or corrupted.')
  }

  // Macros: a workbook that carries a VBA project is refused even under a .xlsx
  // name. (A .xlsm is already refused by extension in readImportFile.)
  if ((wb as { vbaraw?: unknown }).vbaraw) {
    return fail('macro', 'This file contains macros and cannot be imported. Save it as a plain .xlsx and try again.')
  }

  // The Excel 1904 date system offsets every date serial by 1462 days. Read the
  // workbook flag so a 1904 file's dates convert against the right epoch, never
  // silently four years off.
  const date1904 = wb.Workbook?.WBProps?.date1904 === true

  const sheetNames = wb.SheetNames ?? []
  if (sheetNames.length !== 1) {
    return fail(
      'worksheet_count',
      'The file must contain exactly one worksheet. Remove any extra or hidden sheets and try again.',
    )
  }
  const ws = wb.Sheets[sheetNames[0]]
  if (!ws || !ws['!ref']) {
    return fail('header_missing', 'The worksheet is empty. Download the template and fill it in.')
  }
  if (ws['!merges'] && ws['!merges'].length > 0) {
    return fail('merged_cells', 'The file has merged cells, which cannot be imported. Unmerge them and try again.')
  }

  const range = XLSX.utils.decode_range(ws['!ref'])
  const colCount = range.e.c - range.s.c + 1
  if (colCount > MAX_COLUMNS) {
    return fail('too_many_columns', `The file has more than ${MAX_COLUMNS} columns. Use the template layout.`)
  }
  const rowCount = range.e.r - range.s.r + 1
  // Header plus data. The data row cap is enforced in buildSheet, but bail early
  // on an absurd row count so a huge sparse sheet is not materialised.
  if (rowCount - 1 > MAX_TOTAL_RECORDS) {
    return fail(
      'too_many_rows',
      `The file has more than ${MAX_DATA_ROWS} players. Split it into smaller files under ${MAX_DATA_ROWS} rows.`,
    )
  }

  // Read the addressed cells into records, capturing per cell the text value and
  // whether the cell type is one that can never be valid data.
  const records: string[][] = []
  const badTypes = new Map<string, string>() // "r:c" (data-relative) -> reason
  for (let r = range.s.r; r <= range.e.r; r++) {
    const rec: string[] = []
    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r, c })
      const cell = ws[addr] as XLSX.CellObject | undefined
      const { text, bad } = readCell(cell, date1904)
      if (bad && r > range.s.r) {
        // Keyed by the data-relative row index and the RECORD-relative column
        // index (c - range.s.c), matching how the record columns and the header
        // map are indexed. buildSheet's badTypeAt is handed that same record
        // relative column, so it looks up with no further offset.
        badTypes.set(`${r - range.s.r - 1}:${c - range.s.c}`, bad)
      }
      rec.push(text)
    }
    records.push(rec)
  }

  if (records.length === 0 || records[0].every((c) => cleanText(c) === '')) {
    return fail('header_missing', 'The worksheet has no header row. Download the template and fill it in.')
  }
  const header = mapHeaders(records[0])
  if ('ok' in header) return header

  return buildSheet(records, header, {
    firstDataRowNumber: range.s.r + 2, // the sheet's own 1-based row number of the first data row
    applyFormulaGuard: false, // XLSX text cells import verbatim (no apostrophe strip)
    // col is already the record-relative column index (header.columnForField is
    // derived from records[0]), matching the key stored above, so no offset.
    badTypeAt: (rowIndex, col) => badTypes.get(`${rowIndex}:${col}`),
  })
}

// Detect external link parts in a workbook's raw zip bytes. A .xlsx is a zip;
// the part names (xl/externalLinks/..., xl/connections.xml) appear as literal
// ASCII in the archive's file headers, so a byte scan finds them regardless of
// what the parser chooses to expose. A normal workbook contains neither part.
function hasExternalLinkParts(data: ArrayBuffer): boolean {
  // Only a zip (xlsx) can carry these; a zip starts with the PK signature.
  const bytes = new Uint8Array(data)
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) return false
  const text = new TextDecoder('latin1').decode(bytes)
  return text.includes('xl/externalLinks/') || text.includes('xl/connections.xml')
}

// Read one XLSX cell to a text value, flagging a type that is never valid data.
// A formula cell (.f present) is invalid: SheetJS never evaluates it, so its
// cached value is not trusted as data. Boolean and error cells are invalid. A
// date formatted numeric cell converts to an ISO date from its serial with no
// JS Date, so the result never depends on the process timezone; a plain numeric
// cell stringifies (a shirt number typed as a number works); strings pass
// through cleaned.
function readCell(cell: XLSX.CellObject | undefined, date1904: boolean): { text: string; bad?: string } {
  if (!cell) return { text: '' }
  if (cell.f !== undefined && cell.f !== null && cell.f !== '') {
    return { text: '', bad: 'This cell contains a formula, which cannot be imported.' }
  }
  switch (cell.t) {
    case 'e':
      return { text: '', bad: 'This cell contains a spreadsheet error value.' }
    case 'b':
      return { text: '', bad: 'This cell contains a true/false value, which is not valid here.' }
    case 'n': {
      // A date formatted number (cell.z is a date format) converts from its
      // serial timezone independently; any other number stringifies.
      const iso = numericDateIso(cell, date1904)
      if (iso) return { text: iso }
      return { text: cleanText(String(cell.v ?? '')) }
    }
    case 'd':
      // Only reachable if a caller enabled cellDates; convert via UTC parts.
      return { text: cell.v instanceof Date ? dateFromDateObject(cell.v) : cleanText(String(cell.v ?? '')) }
    case 's':
      return { text: cleanText(String(cell.v ?? '')) }
    default:
      return { text: cleanText(String(cell.v ?? '')) }
  }
}

// If the cell is a date formatted numeric cell, return its YYYY-MM-DD from the
// Excel serial using SheetJS's pure date-code parser (no JS Date, so no
// timezone shift), honouring the workbook's 1900/1904 date system. Otherwise
// return null so the caller stringifies the number.
function numericDateIso(cell: XLSX.CellObject, date1904: boolean): string | null {
  const fmt = cell.z
  if (typeof cell.v !== 'number' || typeof fmt !== 'string' || !XLSX.SSF.is_date(fmt)) return null
  const dc = XLSX.SSF.parse_date_code(cell.v, { date1904 })
  if (!dc || !dc.y) return null
  return `${dc.y}-${String(dc.m).padStart(2, '0')}-${String(dc.d).padStart(2, '0')}`
}

// A Date (only from a cellDates read, not used by parseWorkbook) to YYYY-MM-DD
// via its UTC parts.
function dateFromDateObject(d: Date): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// ---------------------------------------------------------------------------
// The async entry point the modal calls: extension and size caps first, then a
// fatal UTF-8 decode for CSV (a single undecodable byte rejects the whole file),
// or a byte read for XLSX. Never logs the file name or any content.
// ---------------------------------------------------------------------------
export function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot === -1 ? '' : name.slice(dot).toLowerCase()
}

export async function readImportFile(file: File): Promise<ParseOutcome> {
  const ext = fileExtension(file.name)
  if (ext === '.xls') {
    return fail('extension', 'Old .xls files are not supported. Save as .xlsx or .csv and try again.')
  }
  if (ext === '.xlsm') {
    return fail('macro', 'Macro enabled .xlsm files are not supported. Save as a plain .xlsx and try again.')
  }
  if (ext !== '.csv' && ext !== '.xlsx') {
    return fail('extension', 'Choose a .csv or .xlsx file.')
  }
  if (file.size === 0) {
    return fail('empty', 'The file is empty.')
  }

  const type = (file.type || '').toLowerCase()
  if (ext === '.csv') {
    if (file.size > CSV_MAX_BYTES) {
      return fail('size', 'The CSV file is larger than 1 MB. Check it is the players file, not something else.')
    }
    if (!CSV_MIME_ACCEPT.has(type)) {
      return fail('mime', 'This does not look like a CSV file. Save it as CSV (UTF-8) and try again.')
    }
    let text: string
    try {
      const buf = await file.arrayBuffer()
      text = new TextDecoder('utf-8', { fatal: true }).decode(buf)
    } catch {
      return fail(
        'encoding',
        'The file is not UTF-8 text. In Excel use "CSV UTF-8 (Comma delimited)" when saving, then import again.',
      )
    }
    return parseCsv(text)
  }

  // .xlsx
  if (file.size > XLSX_MAX_BYTES) {
    return fail('size', 'The Excel file is larger than 2 MB. Check it is the players file, not something else.')
  }
  if (!XLSX_MIME_ACCEPT.has(type)) {
    return fail('mime', 'This does not look like an Excel .xlsx file.')
  }
  let buf: ArrayBuffer
  try {
    buf = await file.arrayBuffer()
  } catch {
    return fail('unreadable', 'The file could not be read. Try choosing it again.')
  }
  return parseWorkbook(buf)
}
