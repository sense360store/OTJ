// Pure classification for the season Renew preview (PR 6). Renew copies chosen
// registrations from a source season into a target season as Pending, carrying
// team and shirt forward and leaving the registered date empty (ADR-0005
// decision 10; delivery plan PR 6). This module classifies each source-season
// registration against the target season and computes the default selection and
// the commit payload, all without a database, so the modal's logic is unit
// tested like the import planner. The server (renew_registrations, 0036) is the
// authority: it re-reads team and shirt from the source registration, refuses a
// cross club or archived season, and is idempotent per (player, season), so the
// classification here is advisory display only and never a write instruction.
import type { RegisteredPlayer, RegistrationStatus } from './data'

// eligible: a registered or pending source registration not yet in the target,
//   selected by default.
// needs_decision: a withdrawn source registration; renewing a player who left is
//   a deliberate act, so it is shown but unselected by default (the export/import
//   renewal round trip likewise excludes Withdrawn by default).
// already_in_target: the player already holds a registration in the target
//   season, so renewing again is a no-op; shown for context, never selectable.
export type RenewClass = 'eligible' | 'needs_decision' | 'already_in_target'

export interface RenewRow {
  playerId: string
  displayName: string
  teamId: string | null
  shirtNumber: number | null
  sourceStatus: RegistrationStatus
  klass: RenewClass
}

export function planRenew(source: RegisteredPlayer[], targetPlayerIds: Iterable<string>): RenewRow[] {
  const inTarget = new Set(targetPlayerIds)
  return source.map((r) => {
    let klass: RenewClass
    if (inTarget.has(r.playerId)) klass = 'already_in_target'
    else if (r.status === 'withdrawn') klass = 'needs_decision'
    else klass = 'eligible'
    return {
      playerId: r.playerId,
      displayName: r.displayName,
      teamId: r.teamId,
      shirtNumber: r.shirtNumber,
      sourceStatus: r.status,
      klass,
    }
  })
}

// A row can be selected for renewal unless it is already in the target season.
export function isRenewSelectable(row: RenewRow): boolean {
  return row.klass !== 'already_in_target'
}

// The default selection: every eligible row, none of the needs-decision or
// already-in-target rows. A withdrawn source registration is only renewed when
// the user explicitly ticks it.
export function defaultRenewSelection(rows: RenewRow[]): Set<string> {
  return new Set(rows.filter((r) => r.klass === 'eligible').map((r) => r.playerId))
}

export interface RenewCounts {
  total: number
  eligible: number
  needsDecision: number
  alreadyInTarget: number
  selected: number
}

export function renewCounts(rows: RenewRow[], selected: Set<string>): RenewCounts {
  let eligible = 0
  let needsDecision = 0
  let alreadyInTarget = 0
  for (const r of rows) {
    if (r.klass === 'eligible') eligible++
    else if (r.klass === 'needs_decision') needsDecision++
    else alreadyInTarget++
  }
  return { total: rows.length, eligible, needsDecision, alreadyInTarget, selected: countSelected(rows, selected) }
}

// The player ids to send to renew_registrations: the selected set restricted to
// selectable rows (already-in-target rows can never be selected, so they are
// excluded by construction). Deterministic order for a stable payload.
export function renewPayloadIds(rows: RenewRow[], selected: Set<string>): string[] {
  return rows.filter((r) => isRenewSelectable(r) && selected.has(r.playerId)).map((r) => r.playerId)
}

function countSelected(rows: RenewRow[], selected: Set<string>): number {
  return rows.filter((r) => isRenewSelectable(r) && selected.has(r.playerId)).length
}

// The result screen's non-overlapping partition. renewed and alreadyInTarget are
// server derived counts from the RPC; skipped is the RPC's count of chosen ids
// that had no source registration at commit (a race or a stale preview).
export interface RenewOutcome {
  renewed: number
  alreadyInTarget: number
  skipped: number
}
