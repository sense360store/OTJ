// Registered players import, stage one part B: the plan. This turns the parsed
// grid (playersImportParse.ts) into the preview classification, entirely in the
// browser and without a single write. It is pure and deterministic so every
// matching and validation rule is provable without a DOM, the same discipline
// as playersView.ts.
//
// The rules it implements are fixed in docs/product/registered-players-import-export.md
// (Import workflow, Import matching and duplicates) and
// docs/adr/ADR-0007-player-import-export-architecture.md. The governing rule:
// a child is NEVER auto merged, updated or skipped from a name match; the only
// deterministic update key is a valid Player ID belonging to the caller's club.
// A name collision becomes "needs your choice", resolved per row by the user.
//
// PR 5 scope: this classifies and previews only. The server (a later PR)
// re-validates and re-matches every row it is sent and trusts nothing here; the
// preview is advisory display, and it never coerces an invalid row into a valid
// write candidate.
import type { RegisteredPlayer, RegistrationStatus, Team } from './data'
import type { FieldMap, ParsedRow, ParsedSheet } from './playersImportParse'
import { parseShirt, statusTransitions } from './playersView'

// The five primary classes. Every data row lands in exactly one, and the five
// counts sum to the total. Warnings are an overlay, never a sixth class.
export type RowClass = 'new' | 'update' | 'already_present' | 'needs_choice' | 'invalid'

// The user's per row decision for a needs-your-choice collision. Undefined until
// they pick; an unresolved row is never actionable.
export type Choice = 'skip' | 'new'

// One reason attached to a column, used for the detail line and the rejected row
// report. code lets the summary count unknown teams separately without string
// matching.
export interface RowIssue {
  column: string
  message: string
  code?: string
}

export interface PlanRow {
  rowNumber: number
  // The Player Name cell as read from the file (cleaned). Shown in the preview
  // and the rejected report; on this device only, never logged or uploaded.
  playerName: string
  class: RowClass
  // The single line shown under the name in the preview.
  detail: string
  // Every field validation failure (for the rejected report). Empty unless invalid.
  issues: RowIssue[]
  // Overlay warnings (DD/MM/YYYY date, a Player ID row whose name differs from
  // the stored name). Never on an invalid row.
  warnings: RowIssue[]
  // The resolved player id for an update row (an id-keyed row). Undefined otherwise.
  matchPlayerId?: string
  // The resolved team id (null for a blank Team cell, importing as Unassigned).
  // Set for every row after classification; drives the Unassigned summary line,
  // and only importable rows are counted there.
  resolvedTeamId?: string | null
  // The full resolved registration fields (team, status, shirt, date) a write
  // for this row would carry: the minimum an operation sends to the server.
  // Attached for every row from the field validation; only read for actionable
  // rows (new, update, needs-your-choice resolved to Import as new). Invalid
  // rows carry it too but are never sent (the commit builder skips them by
  // class). The server re-validates every field regardless, trusting none of it.
  resolved?: { teamId: string | null; status: RegistrationStatus; shirt: number | null; date: string | null }
}

export interface Plan {
  rows: PlanRow[]
  blankRows: number
  ignoredHeaders: string[]
}

export interface PlanContext {
  // The season the import targets, for the Season column cross check.
  seasonName: string
  // Registrations in the SELECTED season: the basis for update, already present
  // and name-collision detection. Club wide (no team arm), exactly what the page
  // already holds.
  seasonRows: RegisteredPlayer[]
  // Every player identity in the club, id to display name. Verifies Player ID
  // ownership (a valid uuid not in this set does not belong to the club) and
  // supplies the stored name for the rename warning on a cross season update.
  clubIdentities: Map<string, string>
  // The club's teams, for resolving a Team name to an id (and back for messages).
  teams: Team[]
}

// Column labels for issues and the report.
const COLUMN = {
  playerId: 'Player ID',
  playerName: 'Player Name',
  season: 'Season',
  team: 'Team',
  status: 'Registration Status',
  shirt: 'Shirt Number',
  registeredDate: 'Registered Date',
} as const

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// True when a name carries a control character that must never be stored:
// the C0 range (except regular whitespace, already trimmed) or the C1 range.
// Written as a code-point test so no control character sits in a regex.
function hasControlChar(s: string): boolean {
  for (const ch of s) {
    const c = ch.codePointAt(0) as number
    if (c <= 8 || c === 11 || c === 12 || (c >= 14 && c <= 31) || (c >= 127 && c <= 159)) return true
  }
  return false
}

// ---- normalisation ---------------------------------------------------------
// Name normalisation for matching: trim, collapse internal whitespace, canonical
// compose, case fold. The near-match adds NFKD diacritic folding on top.
export function normName(s: string): string {
  return s.replace(/\s+/g, ' ').trim().normalize('NFC').toLowerCase()
}
export function foldName(s: string): string {
  return normName(s)
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
}
function normTeam(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase()
}
function normSeason(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase()
}

// A Map, not a plain object, so an untrusted cell value that names an inherited
// Object.prototype property (constructor, __proto__) resolves to undefined and
// is refused, never accepted as a status.
const STATUS_WORDS = new Map<string, RegistrationStatus>([
  ['pending', 'pending'],
  ['registered', 'registered'],
  ['withdrawn', 'withdrawn'],
])

// ---- date parsing ----------------------------------------------------------
function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}
function isRealYmd(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12) return false
  if (d < 1) return false
  return d <= daysInMonth(y, m)
}

type DateParse =
  | { kind: 'ok'; value: string | null }
  | { kind: 'warn'; value: string }
  | { kind: 'invalid' }

export function parseRegisteredDate(raw: string): DateParse {
  const v = raw.trim()
  if (v === '') return { kind: 'ok', value: null }
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v)
  if (iso) {
    const y = +iso[1]
    const m = +iso[2]
    const d = +iso[3]
    return isRealYmd(y, m, d) ? { kind: 'ok', value: v } : { kind: 'invalid' }
  }
  const uk = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v)
  if (uk) {
    const d = +uk[1]
    const m = +uk[2]
    const y = +uk[3]
    if (!isRealYmd(y, m, d)) return { kind: 'invalid' }
    const value = `${uk[3]}-${uk[2]}-${uk[1]}`
    return { kind: 'warn', value }
  }
  return { kind: 'invalid' }
}

// ---- per row field validation ---------------------------------------------
interface Interim {
  rowNumber: number
  playerName: string
  issues: RowIssue[]
  warnings: RowIssue[]
  resolved: { teamId: string | null; status: RegistrationStatus; shirt: number | null; date: string | null }
  id: { kind: 'empty' } | { kind: 'invalid' } | { kind: 'id'; id: string }
}

function validateFields(
  row: ParsedRow,
  ctx: PlanContext,
  teamByNorm: Map<string, string>,
  idCount: Map<string, number>,
): Interim {
  const f: FieldMap = row.fields
  const issues: RowIssue[] = []
  const warnings: RowIssue[] = []

  // Player ID. Assigned on every branch below.
  let id: Interim['id']
  if (f.playerId.badType) {
    issues.push({ column: COLUMN.playerId, message: f.playerId.badType })
    id = { kind: 'invalid' }
  } else {
    const raw = f.playerId.value
    if (raw === '') {
      id = { kind: 'empty' }
    } else if (!UUID_RE.test(raw)) {
      issues.push({ column: COLUMN.playerId, message: `Player ID "${raw}" is not a valid identifier.` })
      id = { kind: 'invalid' }
    } else {
      const key = raw.toLowerCase()
      if ((idCount.get(key) ?? 0) > 1) {
        issues.push({
          column: COLUMN.playerId,
          message: 'This Player ID appears on more than one row; each ID may appear once.',
        })
        id = { kind: 'invalid' }
      } else if (!ctx.clubIdentities.has(key)) {
        issues.push({ column: COLUMN.playerId, message: 'Player ID does not belong to this club.' })
        id = { kind: 'invalid' }
      } else {
        id = { kind: 'id', id: key }
      }
    }
  }

  // Player Name (the only required column).
  const playerName = f.playerName.badType ? '' : f.playerName.value
  if (f.playerName.badType) {
    issues.push({ column: COLUMN.playerName, message: f.playerName.badType })
  } else if (playerName === '') {
    issues.push({ column: COLUMN.playerName, message: 'Player name is required.' })
  } else if ([...playerName].length > 40) {
    issues.push({ column: COLUMN.playerName, message: 'Player name is longer than 40 characters.' })
  } else if (hasControlChar(playerName)) {
    issues.push({ column: COLUMN.playerName, message: 'Player name contains characters that are not allowed.' })
  }

  // Season cross check.
  if (f.season.badType) {
    issues.push({ column: COLUMN.season, message: f.season.badType })
  } else if (f.season.value !== '' && normSeason(f.season.value) !== normSeason(ctx.seasonName)) {
    issues.push({
      column: COLUMN.season,
      message: `Season "${f.season.value}" does not match ${ctx.seasonName}. Clear the Season column to import into ${ctx.seasonName}.`,
    })
  }

  // Team.
  let teamId: string | null = null
  if (f.team.badType) {
    issues.push({ column: COLUMN.team, message: f.team.badType })
  } else if (f.team.value !== '') {
    const resolved = teamByNorm.get(normTeam(f.team.value))
    if (resolved === undefined) {
      issues.push({ column: COLUMN.team, message: `Unknown team "${f.team.value}".`, code: 'unknown_team' })
    } else {
      teamId = resolved
    }
  }

  // Registration Status (blank maps to Pending).
  let status: RegistrationStatus = 'pending'
  if (f.status.badType) {
    issues.push({ column: COLUMN.status, message: f.status.badType })
  } else if (f.status.value !== '') {
    const word = STATUS_WORDS.get(f.status.value.toLowerCase())
    if (word === undefined) {
      issues.push({ column: COLUMN.status, message: `Unknown registration status "${f.status.value}".` })
    } else {
      status = word
    }
  }

  // Shirt Number.
  let shirt: number | null = null
  if (f.shirt.badType) {
    issues.push({ column: COLUMN.shirt, message: f.shirt.badType })
  } else {
    const parsed = parseShirt(f.shirt.value)
    if (parsed === undefined) {
      issues.push({
        column: COLUMN.shirt,
        message: `Shirt number "${f.shirt.value}" must be a whole number from 1 to 99.`,
      })
    } else {
      shirt = parsed
    }
  }

  // Registered Date.
  let date: string | null = null
  if (f.registeredDate.badType) {
    issues.push({ column: COLUMN.registeredDate, message: f.registeredDate.badType })
  } else {
    const parsed = parseRegisteredDate(f.registeredDate.value)
    if (parsed.kind === 'invalid') {
      issues.push({
        column: COLUMN.registeredDate,
        message: `Registered Date "${f.registeredDate.value}" is not a valid date (use YYYY-MM-DD).`,
      })
    } else if (parsed.kind === 'warn') {
      date = parsed.value
      warnings.push({
        column: COLUMN.registeredDate,
        message: `Registered Date "${f.registeredDate.value}" read as day/month/year.`,
      })
    } else {
      date = parsed.value
    }
  }

  return { rowNumber: row.rowNumber, playerName, issues, warnings, resolved: { teamId, status, shirt, date }, id }
}

// ---- classification --------------------------------------------------------
export function classify(sheet: ParsedSheet, ctx: PlanContext): Plan {
  const teamByNorm = new Map<string, string>()
  const teamNameById = new Map<string, string>()
  for (const t of ctx.teams) {
    teamByNorm.set(normTeam(t.name), t.id)
    teamNameById.set(t.id, t.name)
  }

  const seasonByPlayerId = new Map<string, RegisteredPlayer>()
  const seasonByNorm = new Map<string, RegisteredPlayer[]>()
  const seasonByFold = new Map<string, RegisteredPlayer[]>()
  for (const r of ctx.seasonRows) {
    seasonByPlayerId.set(r.playerId, r)
    const nn = normName(r.displayName)
    const fn = foldName(r.displayName)
    ;(seasonByNorm.get(nn) ?? seasonByNorm.set(nn, []).get(nn)!).push(r)
    ;(seasonByFold.get(fn) ?? seasonByFold.set(fn, []).get(fn)!).push(r)
  }

  // Pre-scan: count each syntactically valid Player ID across the file, so a
  // duplicate id classifies every such row invalid (malformed input).
  const idCount = new Map<string, number>()
  for (const row of sheet.rows) {
    if (row.fields.playerId.badType) continue
    const raw = row.fields.playerId.value
    if (raw !== '' && UUID_RE.test(raw)) {
      const key = raw.toLowerCase()
      idCount.set(key, (idCount.get(key) ?? 0) + 1)
    }
  }

  const interims = sheet.rows.map((row) => validateFields(row, ctx, teamByNorm, idCount))

  // File-wide duplicate name detection, over field-valid rows with no Player ID.
  const fileNameRows = new Map<string, number[]>()
  for (const it of interims) {
    if (it.issues.length > 0 || it.id.kind !== 'empty') continue
    const nn = normName(it.playerName)
    ;(fileNameRows.get(nn) ?? fileNameRows.set(nn, []).get(nn)!).push(it.rowNumber)
  }

  const teamLabel = (id: string | null): string => (id == null ? 'Unassigned' : (teamNameById.get(id) ?? 'another team'))

  const rows: PlanRow[] = interims.map((it) => {
    // 1. Field validation failures are invalid regardless of any match.
    if (it.issues.length > 0) {
      return {
        rowNumber: it.rowNumber,
        playerName: it.playerName,
        class: 'invalid',
        detail: it.issues[0].message,
        issues: it.issues,
        warnings: [],
      }
    }

    // 2. Id-keyed rows resolve deterministically by Player ID.
    if (it.id.kind === 'id') {
      const id = it.id.id
      const storedName = ctx.clubIdentities.get(id) ?? ''
      const warnings = it.warnings.slice()
      if (normName(it.playerName) !== normName(storedName)) {
        warnings.push({
          column: COLUMN.playerName,
          message: 'Name in the file differs from the stored name; import never renames a player.',
        })
      }
      const stored = seasonByPlayerId.get(id)
      if (stored) {
        // 5. Status transition validation runs last, needing the stored status.
        if (it.resolved.status !== stored.status && !statusTransitions(stored.status).includes(it.resolved.status)) {
          return {
            rowNumber: it.rowNumber,
            playerName: it.playerName,
            class: 'invalid',
            detail: `Cannot change this registration from ${stored.status} to ${it.resolved.status}.`,
            issues: [
              {
                column: COLUMN.status,
                message: `Cannot change this registration from ${stored.status} to ${it.resolved.status}.`,
              },
            ],
            warnings: [],
          }
        }
        const unchanged =
          it.resolved.teamId === stored.teamId &&
          it.resolved.status === stored.status &&
          it.resolved.shirt === stored.shirtNumber &&
          it.resolved.date === stored.registeredDate
        if (unchanged) {
          return {
            rowNumber: it.rowNumber,
            playerName: it.playerName,
            class: 'already_present',
            detail: 'Already registered with these details; nothing to change.',
            issues: [],
            warnings,
            matchPlayerId: id,
          }
        }
        return {
          rowNumber: it.rowNumber,
          playerName: it.playerName,
          class: 'update',
          detail: 'Updates this player’s registration for the season.',
          issues: [],
          warnings,
          matchPlayerId: id,
        }
      }
      // A club player with no registration in the selected season: the row
      // creates that registration. Still an update by id, never a name merge.
      return {
        rowNumber: it.rowNumber,
        playerName: it.playerName,
        class: 'update',
        detail: `Adds this player’s registration to ${ctx.seasonName}.`,
        issues: [],
        warnings,
        matchPlayerId: id,
      }
    }

    // 3 and 4. No Player ID: resolve by name only to surface possibilities.
    const nn = normName(it.playerName)
    const fn = foldName(it.playerName)

    // In-file duplicate name.
    const inFile = fileNameRows.get(nn) ?? []
    if (inFile.length > 1) {
      const other = inFile.find((n) => n !== it.rowNumber)
      return {
        rowNumber: it.rowNumber,
        playerName: it.playerName,
        class: 'needs_choice',
        detail: `Same name as row ${other} in this file; choose Skip or Import as new.`,
        issues: [],
        warnings: it.warnings,
      }
    }

    // Exact name collision with a registration in the selected season.
    const exact = seasonByNorm.get(nn)
    if (exact && exact.length > 0) {
      // Prefer a match on the same allocation for the wording, else name the
      // matched team as a possible duplicate on another team.
      const sameTeam = exact.find((m) => m.teamId === it.resolved.teamId)
      const match = sameTeam ?? exact[0]
      const where = teamLabel(match.teamId)
      const detail =
        match.teamId === it.resolved.teamId
          ? `Possible duplicate: same name ${match.teamId == null ? 'in Unassigned' : `on ${where}`}; choose Skip or Import as new.`
          : `Possible duplicate: same name on ${where}; choose Skip or Import as new.`
      return {
        rowNumber: it.rowNumber,
        playerName: it.playerName,
        class: 'needs_choice',
        detail,
        issues: [],
        warnings: it.warnings,
      }
    }

    // Near match: equal after diacritic folding but not exact normalisation.
    const near = seasonByFold.get(fn)
    if (near && near.length > 0) {
      return {
        rowNumber: it.rowNumber,
        playerName: it.playerName,
        class: 'needs_choice',
        detail: 'Possible near match: a similar name is already registered; choose Skip or Import as new.',
        issues: [],
        warnings: it.warnings,
      }
    }

    // No collision: a genuinely new identity and registration.
    return {
      rowNumber: it.rowNumber,
      playerName: it.playerName,
      class: 'new',
      detail: `New player; will be added to ${ctx.seasonName}.`,
      issues: [],
      warnings: it.warnings,
    }
  })

  // Attach the resolved fields to every row (rows and interims share order): the
  // team drives the Unassigned summary, and the full set is the operation
  // payload the commit builder reads for an actionable row.
  rows.forEach((row, i) => {
    row.resolvedTeamId = interims[i].resolved.teamId
    row.resolved = interims[i].resolved
  })

  return { rows, blankRows: sheet.blankRows, ignoredHeaders: sheet.ignoredHeaders }
}

// ---- summary and actionable count -----------------------------------------
export interface PlanSummary {
  total: number
  newCount: number
  updateCount: number
  alreadyPresent: number
  needsChoice: number
  invalid: number
  warnings: number
  unknownTeams: number
  // Importable rows (new or update) with a blank Team cell, landing as
  // Unassigned. Shown as a preview summary line so the number of children
  // landing without a team is visible before Confirm.
  unassignedRows: number
  blankRows: number
  // Rows that will be written on confirm: new, update, and needs-your-choice
  // rows the user resolved to Import as new. Skipped, unresolved, already
  // present and invalid rows are never actionable.
  actionable: number
}

export function summarize(plan: Plan, choices: Record<number, Choice>): PlanSummary {
  const s: PlanSummary = {
    total: plan.rows.length,
    newCount: 0,
    updateCount: 0,
    alreadyPresent: 0,
    needsChoice: 0,
    invalid: 0,
    warnings: 0,
    unknownTeams: 0,
    unassignedRows: 0,
    blankRows: plan.blankRows,
    actionable: 0,
  }
  for (const r of plan.rows) {
    switch (r.class) {
      case 'new':
        s.newCount += 1
        s.actionable += 1
        if (r.resolvedTeamId == null) s.unassignedRows += 1
        break
      case 'update':
        s.updateCount += 1
        s.actionable += 1
        if (r.resolvedTeamId == null) s.unassignedRows += 1
        break
      case 'already_present':
        s.alreadyPresent += 1
        break
      case 'needs_choice':
        s.needsChoice += 1
        if (choices[r.rowNumber] === 'new') s.actionable += 1
        break
      case 'invalid':
        s.invalid += 1
        if (r.issues.some((i) => i.code === 'unknown_team')) s.unknownTeams += 1
        break
    }
    if (r.class !== 'invalid' && r.warnings.length > 0) s.warnings += 1
  }
  return s
}

// The preview filter chips. 'all' shows every row; a class shows that class;
// 'warnings' shows any non-invalid row carrying a warning.
export type PreviewFilter = RowClass | 'all' | 'warnings'

export function rowsForFilter(plan: Plan, filter: PreviewFilter): PlanRow[] {
  if (filter === 'all') return plan.rows
  if (filter === 'warnings') return plan.rows.filter((r) => r.class !== 'invalid' && r.warnings.length > 0)
  return plan.rows.filter((r) => r.class === filter)
}
