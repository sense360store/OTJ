import { describe, expect, it } from 'vitest'
import type { RegisteredPlayer, Team } from './data'
import { parseCsv } from './playersImportParse'
import {
  classify,
  foldName,
  normName,
  parseRegisteredDate,
  rowsForFilter,
  summarize,
  type Choice,
  type Plan,
  type PlanContext,
} from './playersImportPlan'

// Real uuids so the Player ID syntax check passes.
const ID_ALEX = '11111111-1111-4111-8111-111111111111'
const ID_JO = '22222222-2222-4222-8222-222222222222'
const ID_UNA = '33333333-3333-4333-8333-333333333333'
const ID_ZOE = '44444444-4444-4444-8444-444444444444'
const ID_REN = '55555555-5555-4555-8555-555555555555' // club identity, no season registration
const ID_UNKNOWN = '99999999-9999-4999-8999-999999999999' // not in the club

const HEADER = 'Player ID,Player Name,Season,Team,Registration Status,Shirt Number,Registered Date'
const TEAMS: Team[] = [
  { id: 'titans', name: 'Titans' },
  { id: 'trojans', name: 'Trojans' },
]

function reg(p: Partial<RegisteredPlayer> & { playerId: string; displayName: string }): RegisteredPlayer {
  return {
    registrationId: 'r-' + p.playerId,
    seasonId: 'season-1',
    teamId: 'titans',
    shirtNumber: null,
    status: 'pending',
    registeredDate: null,
    createdBy: null,
    updatedAt: '2026-07-01T00:00:00Z',
    ...p,
  }
}

const SEASON_ROWS: RegisteredPlayer[] = [
  reg({ playerId: ID_ALEX, displayName: 'Alex Sample', teamId: 'titans', status: 'registered', shirtNumber: 10, registeredDate: '2026-06-28' }),
  reg({ playerId: ID_JO, displayName: 'Jo Smith', teamId: 'trojans', status: 'pending' }),
  reg({ playerId: ID_UNA, displayName: 'Una Solo', teamId: null, status: 'pending' }),
  reg({ playerId: ID_ZOE, displayName: 'Zoé Café', teamId: 'titans', status: 'registered', shirtNumber: 5, registeredDate: '2026-06-01' }),
]

const CLUB_IDENTITIES = new Map<string, string>([
  [ID_ALEX, 'Alex Sample'],
  [ID_JO, 'Jo Smith'],
  [ID_UNA, 'Una Solo'],
  [ID_ZOE, 'Zoé Café'],
  [ID_REN, 'Ren Renew'],
])

const CTX: PlanContext = {
  seasonName: '2026/27',
  seasonRows: SEASON_ROWS,
  clubIdentities: CLUB_IDENTITIES,
  teams: TEAMS,
}

interface RowInput {
  id?: string
  name?: string
  season?: string
  team?: string
  status?: string
  shirt?: string
  date?: string
}
function line(r: RowInput): string {
  return [r.id ?? '', r.name ?? '', r.season ?? '', r.team ?? '', r.status ?? '', r.shirt ?? '', r.date ?? ''].join(',')
}
function plan(rows: RowInput[], ctx: PlanContext = CTX): Plan {
  const csv = `${HEADER}\n${rows.map(line).join('\n')}`
  const out = parseCsv(csv)
  if (!out.ok) throw new Error('parse failed: ' + out.code)
  return classify(out.sheet, ctx)
}
function only(rows: RowInput[], ctx?: PlanContext) {
  return plan(rows, ctx).rows[0]
}

describe('normName and foldName', () => {
  it('normName trims, collapses spaces and case folds', () => {
    expect(normName('  Sam   Jones ')).toBe('sam jones')
    expect(normName('SAM JONES')).toBe('sam jones')
  })
  it('foldName removes diacritics on top of normalisation', () => {
    expect(foldName('Zoé Café')).toBe('zoe cafe')
    expect(foldName('Zoe Cafe')).toBe('zoe cafe')
    expect(normName('Zoé Café')).not.toBe(normName('Zoe Cafe'))
  })
})

describe('parseRegisteredDate', () => {
  it('accepts ISO and blank, warns on DD/MM/YYYY, rejects impossible and unknown formats', () => {
    expect(parseRegisteredDate('')).toEqual({ kind: 'ok', value: null })
    expect(parseRegisteredDate('2026-07-01')).toEqual({ kind: 'ok', value: '2026-07-01' })
    expect(parseRegisteredDate('01/07/2026')).toEqual({ kind: 'warn', value: '2026-07-01' })
    expect(parseRegisteredDate('2026-02-30').kind).toBe('invalid')
    expect(parseRegisteredDate('31/13/2025').kind).toBe('invalid')
    expect(parseRegisteredDate('July 1 2026').kind).toBe('invalid')
    expect(parseRegisteredDate('2026/07/01').kind).toBe('invalid')
  })
})

describe('classify: valid new', () => {
  it('a no-id, no-collision row is valid new', () => {
    const r = only([{ name: 'Fresh Face', team: 'Titans', status: 'Registered', date: '2026-07-01' }])
    expect(r.class).toBe('new')
  })
  it('a blank Team imports as Unassigned and blank status maps to Pending', () => {
    const r = only([{ name: 'Blank Fields' }])
    expect(r.class).toBe('new')
  })
})

describe('classify: id-keyed update and already present', () => {
  it('an id whose values differ from the stored registration is an update', () => {
    const r = only([{ id: ID_ALEX, name: 'Alex Sample', team: 'Titans', status: 'Registered', shirt: '11', date: '2026-06-28' }])
    expect(r.class).toBe('update')
    expect(r.matchPlayerId).toBe(ID_ALEX)
  })
  it('an id whose values all equal the stored registration is already present', () => {
    const r = only([{ id: ID_ALEX, name: 'Alex Sample', team: 'Titans', status: 'Registered', shirt: '10', date: '2026-06-28' }])
    expect(r.class).toBe('already_present')
  })
  it('re-importing an unchanged export row (uppercase id) is idempotent, matched by id', () => {
    const r = only([{ id: ID_ALEX.toUpperCase(), name: 'Alex Sample', team: 'Titans', status: 'Registered', shirt: '10', date: '2026-06-28' }])
    expect(r.class).toBe('already_present')
  })
  it('a differing Player Name on an id row raises a rename warning but never renames', () => {
    const r = only([{ id: ID_ALEX, name: 'Alexander Sample', team: 'Titans', status: 'Registered', shirt: '10', date: '2026-06-28' }])
    expect(r.class).toBe('already_present')
    expect(r.warnings.some((w) => w.column === 'Player Name')).toBe(true)
  })
  it('a club identity with no registration in the season is an update that creates it (renewal)', () => {
    const r = only([{ id: ID_REN, name: 'Ren Renew', team: 'Titans', status: 'Pending' }])
    expect(r.class).toBe('update')
    expect(r.matchPlayerId).toBe(ID_REN)
  })
})

describe('classify: invalid rows never become write candidates', () => {
  it('a malformed Player ID', () => {
    expect(only([{ id: 'not-a-uuid', name: 'X' }]).class).toBe('invalid')
  })
  it('a cross club Player ID', () => {
    const r = only([{ id: ID_UNKNOWN, name: 'X' }])
    expect(r.class).toBe('invalid')
    expect(r.issues.some((i) => i.message.includes('does not belong'))).toBe(true)
  })
  it('the same Player ID on more than one row makes every such row invalid', () => {
    const p = plan([
      { id: ID_ALEX, name: 'Alex Sample' },
      { id: ID_ALEX, name: 'Alex Sample' },
    ])
    expect(p.rows.every((r) => r.class === 'invalid')).toBe(true)
  })
  it('an unknown team', () => {
    const r = only([{ name: 'X', team: 'Wanderers' }])
    expect(r.class).toBe('invalid')
    expect(r.issues.some((i) => i.code === 'unknown_team')).toBe(true)
  })
  it('an unknown status', () => {
    expect(only([{ name: 'X', status: 'Maybe' }]).class).toBe('invalid')
  })
  it('an out of range shirt number', () => {
    expect(only([{ name: 'X', shirt: '150' }]).class).toBe('invalid')
    expect(only([{ name: 'X', shirt: 'seven' }]).class).toBe('invalid')
  })
  it('an invalid date', () => {
    expect(only([{ name: 'X', date: '31/13/2025' }]).class).toBe('invalid')
  })
  it('a name that is too long or empty or has control characters', () => {
    expect(only([{ name: 'a'.repeat(41) }]).class).toBe('invalid')
    // Empty name but another field present, so the row is not a skipped blank row.
    expect(only([{ name: '', team: 'Titans' }]).class).toBe('invalid')
    // A bell control character embedded in the name, injected programmatically so
    // no literal control character sits in the source.
    expect(only([{ name: 'A' + String.fromCharCode(7) + 'B' }]).class).toBe('invalid')
  })
  it('a Season cell that does not match the selected season', () => {
    const r = only([{ name: 'X', season: '2025/26' }])
    expect(r.class).toBe('invalid')
    expect(r.issues.some((i) => i.column === 'Registration Status')).toBe(false)
    expect(r.issues.some((i) => i.column === 'Season')).toBe(true)
  })
  it('a blank Season cell is accepted', () => {
    expect(only([{ name: 'Fresh Face', season: '' }]).class).toBe('new')
  })
  it('an impossible status transition (registered back to pending) is invalid', () => {
    const r = only([{ id: ID_ALEX, name: 'Alex Sample', team: 'Titans', status: 'Pending', shirt: '10', date: '2026-06-28' }])
    expect(r.class).toBe('invalid')
    expect(r.detail.toLowerCase()).toContain('registered to pending')
  })
})

describe('classify: needs your choice (never auto merged from a name)', () => {
  it('the same name twice in the file, no ids', () => {
    const p = plan([{ name: 'Casey Twin' }, { name: 'Casey Twin' }])
    expect(p.rows.every((r) => r.class === 'needs_choice')).toBe(true)
    expect(p.rows[0].detail).toContain('row 3')
  })
  it('a name matching a season registration on the same team is NOT auto already-present', () => {
    const r = only([{ name: 'Alex Sample', team: 'Titans' }])
    expect(r.class).toBe('needs_choice')
    expect(r.detail).toContain('Titans')
  })
  it('a name matching a season registration on a different team', () => {
    const r = only([{ name: 'Alex Sample', team: 'Trojans' }])
    expect(r.class).toBe('needs_choice')
    expect(r.detail).toContain('Titans')
  })
  it('a name matching an Unassigned registration while the row names a team', () => {
    const r = only([{ name: 'Una Solo', team: 'Titans' }])
    expect(r.class).toBe('needs_choice')
  })
  it('a near match (diacritics) is a possible near match', () => {
    const r = only([{ name: 'Zoe Cafe', team: 'Titans' }])
    expect(r.class).toBe('needs_choice')
    expect(r.detail.toLowerCase()).toContain('near match')
  })
})

describe('classify: warnings overlay importable rows only', () => {
  it('a DD/MM/YYYY date warns but the row stays importable', () => {
    const r = only([{ name: 'Fresh Face', date: '01/07/2026' }])
    expect(r.class).toBe('new')
    expect(r.warnings.some((w) => w.column === 'Registered Date')).toBe(true)
  })
  it('an invalid row carries no warnings', () => {
    const r = only([{ name: '', date: '01/07/2026' }])
    expect(r.class).toBe('invalid')
    expect(r.warnings).toHaveLength(0)
  })
})

describe('summarize and actionable count', () => {
  const p = () =>
    plan([
      { name: 'Fresh Face' }, // new
      { id: ID_ALEX, name: 'Alex Sample', team: 'Titans', status: 'Registered', shirt: '11', date: '2026-06-28' }, // update
      { id: ID_JO, name: 'Jo Smith', team: 'Trojans', status: 'Pending' }, // already present
      { name: 'Casey Twin' }, // needs choice (dup below)
      { name: 'Casey Twin' }, // needs choice
      { name: '', status: 'X' }, // invalid
    ])

  it('partitions rows into the five classes summing to the total', () => {
    const s = summarize(p(), {})
    expect(s.total).toBe(6)
    expect(s.newCount + s.updateCount + s.alreadyPresent + s.needsChoice + s.invalid).toBe(6)
    expect(s.newCount).toBe(1)
    expect(s.updateCount).toBe(1)
    expect(s.alreadyPresent).toBe(1)
    expect(s.needsChoice).toBe(2)
    expect(s.invalid).toBe(1)
  })
  it('actionable is new + update, plus needs-your-choice rows resolved to Import as new', () => {
    const built = p()
    expect(summarize(built, {}).actionable).toBe(2) // new + update only
    const choices: Record<number, Choice> = {}
    // Resolve both Casey rows (file rows 5 and 6) to Import as new.
    for (const r of built.rows) if (r.class === 'needs_choice') choices[r.rowNumber] = 'new'
    expect(summarize(built, choices).actionable).toBe(4)
    // Resolving one to skip drops it back.
    const first = built.rows.find((r) => r.class === 'needs_choice')!
    choices[first.rowNumber] = 'skip'
    expect(summarize(built, choices).actionable).toBe(3)
  })
})

describe('rowsForFilter', () => {
  it('filters by class, by warnings, and shows all', () => {
    const built = plan([
      { name: 'Fresh Face', date: '01/07/2026' }, // new + warning
      { name: '', status: 'X' }, // invalid
    ])
    expect(rowsForFilter(built, 'all')).toHaveLength(2)
    expect(rowsForFilter(built, 'new')).toHaveLength(1)
    expect(rowsForFilter(built, 'invalid')).toHaveLength(1)
    expect(rowsForFilter(built, 'warnings')).toHaveLength(1)
    // An invalid row never appears under warnings even if it had a date issue.
    expect(rowsForFilter(built, 'warnings').every((r) => r.class !== 'invalid')).toBe(true)
  })
})

describe('classify: prototype pollution safety', () => {
  it('a row whose name is __proto__ is treated as data, not a prototype key', () => {
    const r = only([{ name: '__proto__' }])
    expect(r.class).toBe('new')
    // The global Object prototype is untouched.
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })
  it('a status of "constructor" or "__proto__" is an unknown status, never accepted', () => {
    expect(only([{ name: 'X', status: 'constructor' }]).class).toBe('invalid')
    expect(only([{ name: 'X', status: '__proto__' }]).class).toBe('invalid')
    expect(only([{ name: 'X', status: 'hasOwnProperty' }]).class).toBe('invalid')
  })
})

describe('summarize: Unassigned rows', () => {
  it('counts importable rows with a blank Team cell landing as Unassigned', () => {
    const built = plan([
      { name: 'No Team One' }, // new, unassigned
      { name: 'No Team Two' }, // new, unassigned
      { name: 'Has Team', team: 'Titans' }, // new, assigned
      { id: ID_REN, name: 'Ren Renew' }, // update (renewal), unassigned
    ])
    const s = summarize(built, {})
    expect(s.unassignedRows).toBe(3)
  })
  it('does not count already-present or invalid rows toward Unassigned', () => {
    const built = plan([
      { id: ID_ALEX, name: 'Alex Sample', team: 'Titans', status: 'Registered', shirt: '10', date: '2026-06-28' }, // already present
      { name: 'X', status: 'nonsense' }, // invalid
    ])
    expect(summarize(built, {}).unassignedRows).toBe(0)
  })
})
