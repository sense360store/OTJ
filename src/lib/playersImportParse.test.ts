import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import {
  cleanText,
  fileExtension,
  MAX_COLUMNS,
  MAX_DATA_ROWS,
  normalizeHeader,
  parseCsv,
  parseWorkbook,
  readImportFile,
  stripCsvFormulaGuard,
  tokenizeCsv,
  type ParsedSheet,
} from './playersImportParse'

const HEADER = 'Player ID,Player Name,Season,Team,Registration Status,Shirt Number,Registered Date'
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

function csvFile(text: string, name = 'players.csv', type = 'text/csv'): File {
  return new File([text], name, { type })
}
function ok(sheet: ParsedSheet | undefined): ParsedSheet {
  if (!sheet) throw new Error('expected a parsed sheet')
  return sheet
}

// Build an xlsx File from an array of arrays (all string/number cells), one
// worksheet named Players.
function xlsxFromAoa(aoa: (string | number)[][], sheetName = 'Players'): File {
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  return new File([buf], 'players.xlsx', { type: XLSX_TYPE })
}

describe('cleanText', () => {
  it('trims Unicode whitespace and strips zero width characters', () => {
    const NBSP = String.fromCharCode(0xa0)
    const ZWSP = String.fromCharCode(0x200b)
    const BOM = String.fromCharCode(0xfeff)
    const ZWJ = String.fromCharCode(0x200d)
    const WJ = String.fromCharCode(0x2060)
    expect(cleanText('  Sam  ')).toBe('Sam')
    expect(cleanText(NBSP + 'Sam' + NBSP)).toBe('Sam')
    expect(cleanText('Sam' + ZWSP)).toBe('Sam')
    expect(cleanText(BOM + 'Sam')).toBe('Sam')
    expect(cleanText('A' + ZWJ + WJ + 'B')).toBe('AB')
  })
})

describe('stripCsvFormulaGuard', () => {
  it('strips exactly one leading apostrophe before a trigger character', () => {
    expect(stripCsvFormulaGuard("'=SUM(A1)")).toBe('=SUM(A1)')
    expect(stripCsvFormulaGuard("'+1")).toBe('+1')
    expect(stripCsvFormulaGuard("'-1")).toBe('-1')
    expect(stripCsvFormulaGuard("'@x")).toBe('@x')
    expect(stripCsvFormulaGuard("''=x")).toBe("'=x") // exactly one removed
    expect(stripCsvFormulaGuard("'''=x")).toBe("''=x")
  })
  it('leaves a genuine leading apostrophe untouched', () => {
    expect(stripCsvFormulaGuard("'Sam")).toBe("'Sam") // apostrophe then non-trigger
    expect(stripCsvFormulaGuard('Sam')).toBe('Sam')
    expect(stripCsvFormulaGuard('=x')).toBe('=x') // no apostrophe, unchanged
  })
})

describe('normalizeHeader', () => {
  it('folds case, whitespace and NFKC', () => {
    expect(normalizeHeader('  Player   Name ')).toBe('player name')
    expect(normalizeHeader('PLAYER NAME')).toBe('player name')
  })
})

describe('tokenizeCsv (RFC 4180)', () => {
  it('parses quoted fields with commas, quotes and newlines', () => {
    const rows = tokenizeCsv('a,"b,c","he said ""hi""","line1\nline2"')
    expect(rows).toEqual([['a', 'b,c', 'he said "hi"', 'line1\nline2']])
  })
  it('handles CRLF, LF and a lone CR as record separators', () => {
    expect(tokenizeCsv('a,b\r\nc,d\ne,f\rg,h')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
      ['e', 'f'],
      ['g', 'h'],
    ])
  })
  it('does not emit a spurious trailing record for a trailing newline', () => {
    expect(tokenizeCsv('a,b\n')).toEqual([['a', 'b']])
  })
  it('keeps an interior blank line as a blank record', () => {
    expect(tokenizeCsv('a\n\nb')).toEqual([['a'], [''], ['b']])
  })
})

describe('parseCsv: header validation', () => {
  it('accepts the template header and reads data rows with 1-based file row numbers', () => {
    const out = parseCsv(`${HEADER}\n,Sam Example,2026/27,Titans,Registered,7,2026-07-01`)
    expect(out.ok).toBe(true)
    const sheet = ok(out.ok ? out.sheet : undefined)
    expect(sheet.rows).toHaveLength(1)
    expect(sheet.rows[0].rowNumber).toBe(2)
    expect(sheet.rows[0].fields.playerName.value).toBe('Sam Example')
    expect(sheet.rows[0].fields.team.value).toBe('Titans')
    expect(sheet.rows[0].fields.status.value).toBe('Registered')
  })
  it('is case insensitive on headers and tolerates reordering', () => {
    const out = parseCsv('player name,shirt number\nSam,9')
    expect(out.ok).toBe(true)
    const sheet = ok(out.ok ? out.sheet : undefined)
    expect(sheet.rows[0].fields.playerName.value).toBe('Sam')
    expect(sheet.rows[0].fields.shirt.value).toBe('9')
  })
  it('recognises and silently ignores the export only Last Updated column', () => {
    const out = parseCsv(`${HEADER},Last Updated\n,Sam,2026/27,,Pending,,,2026-07-01T00:00:00Z`)
    expect(out.ok).toBe(true)
    const sheet = ok(out.ok ? out.sheet : undefined)
    expect(sheet.ignoredHeaders).toEqual([])
  })
  it('warns and ignores an unknown column', () => {
    const out = parseCsv('Player Name,Nickname\nSam,Sammy')
    expect(out.ok).toBe(true)
    const sheet = ok(out.ok ? out.sheet : undefined)
    expect(sheet.ignoredHeaders).toEqual(['Nickname'])
  })
  it('rejects a missing Player Name column', () => {
    const out = parseCsv('Team,Shirt Number\nTitans,7')
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.code).toBe('header_required')
  })
  it('rejects duplicate (confusable) headers', () => {
    const out = parseCsv('Player Name,player  name\nSam,Sam')
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.code).toBe('header_duplicate')
  })
  it('rejects a semicolon delimited file', () => {
    const out = parseCsv('Player Name;Team;Shirt Number\nSam;Titans;7')
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.code).toBe('delimiter')
  })
  it('rejects an empty file', () => {
    const out = parseCsv('')
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.code).toBe('header_missing')
  })
})

describe('parseCsv: blank rows and caps', () => {
  it('skips and counts blank rows, keeping file row numbers stable', () => {
    const out = parseCsv(`${HEADER}\n,Sam,,,,,\n\n,Robin,,,,,`)
    expect(out.ok).toBe(true)
    const sheet = ok(out.ok ? out.sheet : undefined)
    expect(sheet.rows).toHaveLength(2)
    expect(sheet.blankRows).toBe(1)
    // Robin is on file row 4 (header 1, Sam 2, blank 3, Robin 4).
    expect(sheet.rows[1].rowNumber).toBe(4)
  })
  it('rejects more than 500 data rows', () => {
    const body = Array.from({ length: MAX_DATA_ROWS + 1 }, (_, i) => `,Player ${i},,,,,`).join('\n')
    const out = parseCsv(`${HEADER}\n${body}`)
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.code).toBe('too_many_rows')
  })
  it('rejects more than 30 columns', () => {
    const wide = Array.from({ length: MAX_COLUMNS + 1 }, (_, i) => `c${i}`).join(',')
    const out = parseCsv(`${wide}\n${'x,'.repeat(MAX_COLUMNS)}x`)
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.code).toBe('too_many_columns')
  })
})

describe('parseCsv: formula guard on import', () => {
  it('strips the leading apostrophe an export added, restoring the stored value', () => {
    const out = parseCsv(`Player Name\n'=cmd`)
    const sheet = ok(out.ok ? out.sheet : undefined)
    expect(sheet.rows[0].fields.playerName.value).toBe('=cmd')
  })
})

describe('parseWorkbook (XLSX)', () => {
  it('parses a one worksheet workbook', () => {
    const file = xlsxFromAoa([
      ['Player Name', 'Shirt Number'],
      ['Sam', 7],
    ])
    // parseWorkbook takes bytes; go through the file for realism.
    return file.arrayBuffer().then((buf) => {
      const out = parseWorkbook(buf)
      expect(out.ok).toBe(true)
      const sheet = ok(out.ok ? out.sheet : undefined)
      expect(sheet.rows[0].fields.playerName.value).toBe('Sam')
      // A numeric shirt cell is stringified.
      expect(sheet.rows[0].fields.shirt.value).toBe('7')
    })
  })

  it('rejects a workbook with more than one worksheet (hidden or visible)', async () => {
    const ws1 = XLSX.utils.aoa_to_sheet([
      ['Player Name'],
      ['Sam'],
    ])
    const ws2 = XLSX.utils.aoa_to_sheet([['secret']])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws1, 'Players')
    XLSX.utils.book_append_sheet(wb, ws2, 'Hidden')
    if (wb.Workbook?.Sheets?.[1]) wb.Workbook.Sheets[1].Hidden = 1
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
    const out = parseWorkbook(buf)
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.code).toBe('worksheet_count')
  })

  it('rejects merged cells', async () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['Player Name', 'Team'],
      ['Sam', 'Titans'],
    ])
    ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Players')
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
    const out = parseWorkbook(buf)
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.code).toBe('merged_cells')
  })

  it('treats a formula cell as an invalid value, never evaluating it', async () => {
    const ws: XLSX.WorkSheet = {
      '!ref': 'A1:B2',
      A1: { t: 's', v: 'Player Name' },
      B1: { t: 's', v: 'Shirt Number' },
      A2: { t: 's', v: 'Sam' },
      B2: { t: 'n', f: '1+1', v: 2 },
    }
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Players')
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
    const out = parseWorkbook(buf)
    expect(out.ok).toBe(true)
    const sheet = ok(out.ok ? out.sheet : undefined)
    expect(sheet.rows[0].fields.shirt.badType).toBeTruthy()
    expect(sheet.rows[0].fields.shirt.value).toBe('')
  })

  it('converts a date typed cell to an ISO date (timezone independent)', async () => {
    const ws = XLSX.utils.aoa_to_sheet(
      [
        ['Player Name', 'Registered Date'],
        ['Sam', new Date(Date.UTC(2026, 6, 1))],
      ],
      { cellDates: true },
    )
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Players')
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
    const out = parseWorkbook(buf)
    const sheet = ok(out.ok ? out.sheet : undefined)
    expect(sheet.rows[0].fields.registeredDate.value).toBe('2026-07-01')
  })

  it('stringifies a plain numeric cell so a shirt number typed as a number works', async () => {
    const file = xlsxFromAoa([
      ['Player Name', 'Shirt Number'],
      ['Sam', 9],
    ])
    const buf = await file.arrayBuffer()
    const out = parseWorkbook(buf)
    const sheet = ok(out.ok ? out.sheet : undefined)
    expect(sheet.rows[0].fields.shirt.value).toBe('9')
  })

  it('treats a boolean cell as an invalid value', async () => {
    const ws: XLSX.WorkSheet = {
      '!ref': 'A1:B2',
      A1: { t: 's', v: 'Player Name' },
      B1: { t: 's', v: 'Shirt Number' },
      A2: { t: 's', v: 'Sam' },
      B2: { t: 'b', v: true },
    }
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Players')
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
    const out = parseWorkbook(buf)
    const sheet = ok(out.ok ? out.sheet : undefined)
    expect(sheet.rows[0].fields.shirt.badType).toBeTruthy()
  })
})

describe('readImportFile: caps, extensions, encoding', () => {
  it('rejects a legacy .xls file', async () => {
    const out = await readImportFile(csvFile('x', 'old.xls', 'application/vnd.ms-excel'))
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.code).toBe('extension')
  })
  it('rejects a macro enabled .xlsm file', async () => {
    const out = await readImportFile(csvFile('x', 'macro.xlsm', ''))
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.code).toBe('macro')
  })
  it('rejects an unknown extension', async () => {
    const out = await readImportFile(csvFile('x', 'players.txt', 'text/plain'))
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.code).toBe('extension')
  })
  it('rejects an oversized CSV before parsing', async () => {
    const big = 'A'.repeat(1024 * 1024 + 10)
    const out = await readImportFile(csvFile(big, 'big.csv'))
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.code).toBe('size')
  })
  it('rejects a CSV with a disallowed MIME type', async () => {
    const out = await readImportFile(csvFile(`${HEADER}\n,Sam,,,,,`, 'players.csv', 'application/x-evil'))
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.code).toBe('mime')
  })
  it('rejects a CSV that is not UTF-8', async () => {
    // 0xFF is not a valid UTF-8 lead byte; the fatal decoder rejects the file.
    const bytes = new Uint8Array([0x50, 0x6c, 0x61, 0x79, 0xff, 0xfe])
    const file = new File([bytes], 'players.csv', { type: 'text/csv' })
    const out = await readImportFile(file)
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.code).toBe('encoding')
  })
  it('accepts a well formed CSV with a BOM', async () => {
    const out = await readImportFile(csvFile(String.fromCharCode(0xfeff) + `${HEADER}\n,Sam,2026/27,,Pending,,`, 'players.csv'))
    expect(out.ok).toBe(true)
    const sheet = ok(out.ok ? out.sheet : undefined)
    expect(sheet.rows[0].fields.playerName.value).toBe('Sam')
  })
  it('rejects an empty file', async () => {
    const out = await readImportFile(csvFile('', 'players.csv'))
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.code).toBe('empty')
  })
})

describe('fileExtension', () => {
  it('lower cases and reads the last dot', () => {
    expect(fileExtension('Players.CSV')).toBe('.csv')
    expect(fileExtension('a.b.xlsx')).toBe('.xlsx')
    expect(fileExtension('noext')).toBe('')
  })
})
