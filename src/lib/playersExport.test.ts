// Unit proofs for the registered players export builders and escaping. The
// server (export_players) decides WHAT leaves and writes the audit record; this
// suite pins how the returned rows become a file: the exact headers, RFC 4180
// quoting, the formula injection defence in both formats, and the filename
// shape. No stack, no DOM.
import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import {
  buildPlayersCsv,
  buildPlayersXlsx,
  escapeCsvCell,
  EXPORT_HEADERS,
  exportFilename,
  needsFormulaGuard,
  seasonSlug,
  type ExportPlayerRow,
} from './playersExport'
import { buildTemplateCsv, buildTemplateXlsx, TEMPLATE_HEADERS } from './playersTemplate'

const BOM = '﻿'
const CRLF = '\r\n'

// Two synthetic rows: a registered player on a team with a shirt, and a pending
// Unassigned player with no shirt or date (the blank-cell cases).
const ROWS: ExportPlayerRow[] = [
  {
    player_id: '9f2b6c1e-0d4a-4a7e-9c1b-2f3d4e5a6b7c',
    player_name: 'Sam Example',
    season_name: '2026/27',
    team_id: 't1',
    team_name: 'Titans',
    status: 'registered',
    shirt_number: 7,
    registered_date: '2026-07-01',
    updated_at: '2026-07-10T12:00:00+00:00',
  },
  {
    player_id: '1a2b3c4d-0d4a-4a7e-9c1b-2f3d4e5a6b7c',
    player_name: 'Robin Sample',
    season_name: '2026/27',
    team_id: null,
    team_name: '',
    status: 'pending',
    shirt_number: null,
    registered_date: null,
    updated_at: '2026-07-11T09:00:00+00:00',
  },
]

// The header rows are a contract with the import parser, so pin them exactly.
describe('headers', () => {
  it('export has the eight columns in order', () => {
    expect([...EXPORT_HEADERS]).toEqual([
      'Player ID',
      'Player Name',
      'Season',
      'Team',
      'Registration Status',
      'Shirt Number',
      'Registered Date',
      'Last Updated',
    ])
  })

  it('template has the first seven (no Last Updated)', () => {
    expect([...TEMPLATE_HEADERS]).toEqual([
      'Player ID',
      'Player Name',
      'Season',
      'Team',
      'Registration Status',
      'Shirt Number',
      'Registered Date',
    ])
  })
})

describe('formula injection guard', () => {
  it('flags a value whose first character is a formula trigger', () => {
    for (const trigger of ['=', '+', '-', '@', '\t', '\r']) {
      expect(needsFormulaGuard(`${trigger}x`)).toBe(true)
    }
  })

  it('flags leading apostrophes followed by a trigger (so the import strip restores exactly)', () => {
    expect(needsFormulaGuard("'=x")).toBe(true)
    expect(needsFormulaGuard("''=x")).toBe(true)
  })

  it('does not flag an ordinary value or an apostrophe followed by a letter', () => {
    expect(needsFormulaGuard('Sam Example')).toBe(false)
    expect(needsFormulaGuard("'plain")).toBe(false)
    expect(needsFormulaGuard('')).toBe(false)
    expect(needsFormulaGuard('7')).toBe(false)
  })
})

describe('escapeCsvCell', () => {
  it('prefixes a formula trigger with a single apostrophe', () => {
    expect(escapeCsvCell('=1+1')).toBe("'=1+1")
    expect(escapeCsvCell('+49')).toBe("'+49")
    expect(escapeCsvCell('-5')).toBe("'-5")
    expect(escapeCsvCell('@handle')).toBe("'@handle")
    expect(escapeCsvCell("'=x")).toBe("''=x")
  })

  it('applies RFC 4180 quoting for comma, quote and newline', () => {
    expect(escapeCsvCell('a,b')).toBe('"a,b"')
    expect(escapeCsvCell('a"b')).toBe('"a""b"')
    expect(escapeCsvCell('a\nb')).toBe('"a\nb"')
  })

  it('guards then quotes a value that both triggers and needs quoting', () => {
    expect(escapeCsvCell('=a,b')).toBe('"\'=a,b"')
  })

  it('leaves an ordinary value untouched', () => {
    expect(escapeCsvCell('Sam Example')).toBe('Sam Example')
    expect(escapeCsvCell('')).toBe('')
  })
})

describe('buildPlayersCsv', () => {
  it('starts with a BOM and the header row', () => {
    const csv = buildPlayersCsv(ROWS)
    expect(csv.startsWith(BOM)).toBe(true)
    const lines = csv.slice(BOM.length).split(CRLF)
    expect(lines[0]).toBe('Player ID,Player Name,Season,Team,Registration Status,Shirt Number,Registered Date,Last Updated')
  })

  it('renders status capitalised, an Unassigned team and null shirt/date as empty cells', () => {
    const csv = buildPlayersCsv(ROWS)
    const lines = csv.slice(BOM.length).split(CRLF)
    expect(lines[1]).toBe(
      '9f2b6c1e-0d4a-4a7e-9c1b-2f3d4e5a6b7c,Sam Example,2026/27,Titans,Registered,7,2026-07-01,2026-07-10T12:00:00+00:00',
    )
    expect(lines[2]).toBe('1a2b3c4d-0d4a-4a7e-9c1b-2f3d4e5a6b7c,Robin Sample,2026/27,,Pending,,,2026-07-11T09:00:00+00:00')
  })

  it('escapes a formula-injecting name in the file', () => {
    const evil: ExportPlayerRow = { ...ROWS[0], player_name: '=HYPERLINK("http://x")' }
    const csv = buildPlayersCsv([evil])
    const dataLine = csv.slice(BOM.length).split(CRLF)[1]
    // Guarded with a leading apostrophe, then quoted because it contains commas
    // and quotes.
    expect(dataLine).toContain('"\'=HYPERLINK(""http://x"")"')
    expect(dataLine.startsWith('9f2b6c1e')).toBe(true)
  })
})

describe('buildPlayersXlsx', () => {
  it('is a single Players worksheet whose every cell is a text cell', () => {
    const rows: ExportPlayerRow[] = [{ ...ROWS[0], player_name: '=SUM(A1)' }]
    const wb = XLSX.read(buildPlayersXlsx(rows), { type: 'array' })
    expect(wb.SheetNames).toEqual(['Players'])
    const ws = wb.Sheets['Players']
    const cells = Object.keys(ws).filter((k) => !k.startsWith('!'))
    // Every cell is a string (text) cell: no numeric cell (so a shirt number is
    // text) and no formula cell (so an = value can never execute).
    for (const addr of cells) {
      expect(ws[addr].t).toBe('s')
      expect(ws[addr].f).toBeUndefined()
    }
    expect(ws['A1'].v).toBe('Player ID')
    // The formula-looking name is stored verbatim as text, not evaluated.
    const formulaCell = cells.find((a) => ws[a].v === '=SUM(A1)')
    expect(formulaCell).toBeTruthy()
  })
})

describe('template builders', () => {
  it('the CSV template is the BOM, the seven headers, and one line break', () => {
    expect(buildTemplateCsv()).toBe(
      BOM + 'Player ID,Player Name,Season,Team,Registration Status,Shirt Number,Registered Date' + CRLF,
    )
  })

  it('the XLSX template is a Players sheet with the seven header cells', () => {
    const wb = XLSX.read(buildTemplateXlsx(), { type: 'array' })
    expect(wb.SheetNames).toEqual(['Players'])
    const ws = wb.Sheets['Players']
    expect(ws['A1'].v).toBe('Player ID')
    expect(ws['G1'].v).toBe('Registered Date')
    // No Last Updated column and no data rows in the blank template.
    expect(ws['H1']).toBeUndefined()
    expect(ws['A2']).toBeUndefined()
  })
})

describe('exportFilename and seasonSlug', () => {
  it('slugs a season name to a filesystem safe form', () => {
    expect(seasonSlug('2026/27')).toBe('2026-27')
    expect(seasonSlug('A/B C')).toBe('A-B-C')
    expect(seasonSlug('')).toBe('season')
  })

  it('builds registered-players-<season>-<YYYYMMDD-HHmm>.<ext>, never player data', () => {
    const at = new Date(2026, 6, 18, 16, 42, 0) // 2026-07-18 16:42 local
    expect(exportFilename('2026/27', 'csv', at)).toBe('registered-players-2026-27-20260718-1642.csv')
    expect(exportFilename('2026/27', 'xlsx', at)).toBe('registered-players-2026-27-20260718-1642.xlsx')
  })
})
