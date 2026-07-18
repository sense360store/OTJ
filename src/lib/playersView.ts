// Pure view logic for the Registered players page: the filter model, its URL
// round trip, filtering, sorting, counts, the status badge vocabulary and the
// board eligibility selector. Kept out of the component so every reducer is
// provable without a DOM, matching the repo rule that ordering and filtering
// are unit tested (src/lib/contentOrder.ts). No child name leaves this module
// except a display name the caller already holds; nothing here logs or encodes
// a name into the URL.
import type { PlayerHistoryEntry, RegisteredPlayer, RegistrationStatus } from './data'

// The status filter values. The default is the Pending plus Registered pair,
// which hides Withdrawn rows from the default view (a product decision); the
// four explicit values widen or narrow it.
export type StatusFilter = 'pending_registered' | 'pending' | 'registered' | 'withdrawn' | 'all'

// The team filter value: every team, a specific team by id, or the Unassigned
// pool (registrations with a null team). Team is a filter, never an access
// boundary, so every viewer can select Unassigned.
export type TeamFilter = 'all' | 'unassigned' | string

// The sort keys, each with a fixed direction (see sortRows). Player id is the
// deterministic tiebreak everywhere.
export type SortKey = 'name' | 'team' | 'status' | 'shirt' | 'registered' | 'updated'

const SORT_KEYS: SortKey[] = ['name', 'team', 'status', 'shirt', 'registered', 'updated']
const STATUS_FILTERS: StatusFilter[] = ['pending_registered', 'pending', 'registered', 'withdrawn', 'all']

export const DEFAULT_STATUS_FILTER: StatusFilter = 'pending_registered'
export const DEFAULT_SORT: SortKey = 'name'

// The full filter state the page holds. seasonId null means "the current
// season" (resolved by the page once the current season is known), so a bare
// /players opens on the current season without the id in the URL. The free
// text search q is deliberately NOT part of the URL scheme: a search term a
// coach types can be a child's name, and no child name may enter the URL, so q
// lives in page state only and is merged in for filtering. The structural
// filters below are the URL-persisted, shareable ones.
export interface PlayersFilters {
  seasonId: string | null
  team: TeamFilter
  status: StatusFilter
  q: string
  sort: SortKey
}

export const DEFAULT_FILTERS: PlayersFilters = {
  seasonId: null,
  team: 'all',
  status: DEFAULT_STATUS_FILTER,
  q: '',
  sort: DEFAULT_SORT,
}

// Parse the filter state from URL search params. Unknown or malformed values
// fall back to the default, so a hand edited or stale URL never throws. season
// is passed through verbatim (the page validates it against the seasons it can
// read); an absent season means the current season.
export function parseFilters(params: URLSearchParams): PlayersFilters {
  const seasonId = params.get('season')
  const team = params.get('team')
  const statusRaw = params.get('status')
  const sortRaw = params.get('sort')
  const status = statusRaw && STATUS_FILTERS.includes(statusRaw as StatusFilter)
    ? (statusRaw as StatusFilter)
    : DEFAULT_STATUS_FILTER
  const sort = sortRaw && SORT_KEYS.includes(sortRaw as SortKey) ? (sortRaw as SortKey) : DEFAULT_SORT
  return {
    seasonId: seasonId && seasonId.trim() !== '' ? seasonId : null,
    team: team && team.trim() !== '' ? team : 'all',
    status,
    // q is never read from the URL (see PlayersFilters): a search term can be a
    // child's name, so it stays in page state, never the address bar.
    q: '',
    sort,
  }
}

// Serialize the filter state to URL search params, omitting every value that
// equals its default so the common view carries a clean URL and the round trip
// is stable. The status default (the pending/registered pair) is never written;
// the four explicit values are.
export function filtersToParams(f: PlayersFilters): URLSearchParams {
  const params = new URLSearchParams()
  if (f.seasonId) params.set('season', f.seasonId)
  if (f.team !== 'all') params.set('team', f.team)
  if (f.status !== DEFAULT_STATUS_FILTER) params.set('status', f.status)
  // q is intentionally omitted: a search term can be a child's name, and no
  // child name may enter the URL. Search is page state only.
  if (f.sort !== DEFAULT_SORT) params.set('sort', f.sort)
  return params
}

// True when the filters differ from the default view (any team, the default
// status pair, empty search). Drives the "Showing n of m" line and the Clear
// filters affordance. The selected season and sort do not count as narrowing.
export function filtersAreActive(f: PlayersFilters): boolean {
  return f.team !== 'all' || f.status !== DEFAULT_STATUS_FILTER || f.q.trim() !== ''
}

// The statuses a status filter admits. The default pair is Pending plus
// Registered; 'all' admits every status; each explicit value admits itself.
export function statusesForFilter(status: StatusFilter): RegistrationStatus[] {
  switch (status) {
    case 'all':
      return ['pending', 'registered', 'withdrawn']
    case 'pending_registered':
      return ['pending', 'registered']
    default:
      return [status]
  }
}

function matchesTeam(row: RegisteredPlayer, team: TeamFilter): boolean {
  if (team === 'all') return true
  if (team === 'unassigned') return row.teamId === null
  return row.teamId === team
}

// Apply the team, status and search filters. Search is a case insensitive
// substring on the display name, trimmed; an empty search matches everything.
export function filterRows(rows: RegisteredPlayer[], f: PlayersFilters): RegisteredPlayer[] {
  const admitted = new Set(statusesForFilter(f.status))
  const needle = f.q.trim().toLowerCase()
  return rows.filter(
    (r) =>
      matchesTeam(r, f.team) &&
      admitted.has(r.status) &&
      (needle === '' || r.displayName.toLowerCase().includes(needle)),
  )
}

const STATUS_ORDER: Record<RegistrationStatus, number> = { pending: 0, registered: 1, withdrawn: 2 }

// Sort the rows for a key, each with its fixed direction, player id ascending as
// the deterministic tiebreak. teamName resolves a team id to its display name
// for the Team sort; an Unassigned (null) team sorts last. The input is not
// mutated (a copy is sorted), so a memoized list is never reordered in place.
export function sortRows(
  rows: RegisteredPlayer[],
  sort: SortKey,
  teamName: (id: string | null) => string,
): RegisteredPlayer[] {
  const copy = rows.slice()
  const tiebreak = (a: RegisteredPlayer, b: RegisteredPlayer) => a.playerId.localeCompare(b.playerId)
  copy.sort((a, b) => {
    let cmp = 0
    switch (sort) {
      case 'name':
        cmp = a.displayName.localeCompare(b.displayName)
        break
      case 'team': {
        // Unassigned last, then by team name ascending.
        const au = a.teamId === null ? 1 : 0
        const bu = b.teamId === null ? 1 : 0
        if (au !== bu) cmp = au - bu
        else cmp = teamName(a.teamId).localeCompare(teamName(b.teamId))
        break
      }
      case 'status':
        cmp = STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
        break
      case 'shirt': {
        // Ascending with blanks last.
        const as = a.shirtNumber
        const bs = b.shirtNumber
        if (as !== bs) {
          if (as === null) cmp = 1
          else if (bs === null) cmp = -1
          else cmp = as - bs
        }
        break
      }
      case 'registered': {
        // Newest first, blanks last.
        const ad = a.registeredDate
        const bd = b.registeredDate
        if (ad !== bd) {
          if (ad === null) cmp = 1
          else if (bd === null) cmp = -1
          else cmp = bd.localeCompare(ad)
        }
        break
      }
      case 'updated':
        // Newest first.
        cmp = b.updatedAt.localeCompare(a.updatedAt)
        break
    }
    return cmp !== 0 ? cmp : tiebreak(a, b)
  })
  return copy
}

// The season's per status and total counts, over the unfiltered season rows so
// the summary never understates the register (Withdrawn is counted even while
// hidden by the default filter).
export interface StatusCounts {
  pending: number
  registered: number
  withdrawn: number
  total: number
}

export function statusCounts(rows: RegisteredPlayer[]): StatusCounts {
  const counts: StatusCounts = { pending: 0, registered: 0, withdrawn: 0, total: rows.length }
  for (const r of rows) counts[r.status] += 1
  return counts
}

// The status badge vocabulary: the word (always shown, never colour alone) and
// its colour token. Withdrawn is the muted slate; the row it sits on is also
// slightly muted (the component applies that). Registered green, Pending amber.
export const STATUS_META: Record<RegistrationStatus, { label: string; dot: string; muted: boolean }> = {
  pending: { label: 'Pending', dot: 'var(--c-social)', muted: false },
  registered: { label: 'Registered', dot: 'var(--c-physical)', muted: false },
  withdrawn: { label: 'Withdrawn', dot: 'var(--slate-2)', muted: true },
}

// The valid next statuses offered in the Edit modal's status select, given the
// current status. Withdrawn is offered from pending or registered but routes
// through the Withdraw confirmation rather than saving directly (the component
// handles that); a withdrawn registration offers no transitions here (Restore
// is the route back). Mirrors the server enforced transitions (0032) so the UI
// never offers an invalid move.
export function statusTransitions(current: RegistrationStatus): RegistrationStatus[] {
  switch (current) {
    case 'pending':
      return ['pending', 'registered', 'withdrawn']
    case 'registered':
      return ['registered', 'withdrawn']
    case 'withdrawn':
      return ['withdrawn']
  }
}

// The row action keys available for a registration, given the capabilities and
// whether the season is writable. Kept pure so the gating is provable without a
// DOM: a read-only viewer or an archived season yields no actions; Move team and
// Withdraw/Restore need players.manage on a writable season; Delete permanently
// additionally needs players.delete. Edit and History are separate buttons, not
// menu items, so they are not listed here.
export function rowActionKeys(
  status: RegistrationStatus,
  opts: { canManage: boolean; canDelete: boolean; writable: boolean },
): string[] {
  if (!opts.canManage || !opts.writable) return []
  const keys = ['move']
  if (status === 'withdrawn') keys.push('restore')
  else keys.push('withdraw')
  if (opts.canDelete) keys.push('delete')
  return keys
}

// The board eligibility selector (docs/product/registered-players-spec.md):
// current season registered players on the selected team by default; Pending
// only when the picker's toggle is on; Withdrawn never; Unassigned (team null)
// only when the picker's team selector is explicitly Unassigned. The caller
// passes the current season's rows and the selected team (a team id, or null
// for the Unassigned pool). Withdrawn is always excluded.
export function eligibleForBoard(
  rows: RegisteredPlayer[],
  team: string | null,
  includePending: boolean,
): RegisteredPlayer[] {
  return rows.filter((r) => {
    if (r.teamId !== team) return false
    if (r.status === 'withdrawn') return false
    if (r.status === 'pending' && !includePending) return false
    return true
  })
}

// A plain-language description of a History entry, built from the action and
// the safe changed fields only, so no child name is ever assembled here (names
// of the actor and player resolve elsewhere; this describes what changed).
// teamName resolves a team id (or null) to a label; formatDate renders a
// YYYY-MM-DD value. Both are injected so the function stays pure and unit
// testable without a clock or a teams query.
export function describeHistoryEntry(
  entry: Pick<PlayerHistoryEntry, 'action' | 'safeChanges' | 'changedFields'>,
  opts: { teamName: (id: string | null | undefined) => string; formatDate: (iso: string) => string },
): string {
  const s = entry.safeChanges ?? {}
  const statusText = (v: unknown): string => STATUS_META[v as RegistrationStatus]?.label ?? String(v)
  const shirtText = (v: unknown): string => (v == null ? 'none' : String(v))
  switch (entry.action) {
    case 'player.created':
      return 'Player added'
    case 'player.deleted':
      return 'Player deleted'
    case 'player.updated':
      return 'Name changed'
    case 'player.registration_created':
      return 'Registration created'
    case 'player.renewed':
      return 'Registration renewed'
    case 'player.withdrawn':
      return 'Withdrawn'
    case 'player.restored':
      return s.status ? `Restored: ${statusText(s.status.old)} to ${statusText(s.status.new)}` : 'Restored'
    case 'player.status_changed':
      return s.status
        ? `Registration changed: ${statusText(s.status.old)} to ${statusText(s.status.new)}`
        : 'Registration changed'
    case 'player.team_changed':
      return s.team_id
        ? `Team changed: ${opts.teamName(s.team_id.old as string | null)} to ${opts.teamName(s.team_id.new as string | null)}`
        : 'Team changed'
    case 'player.registration_updated': {
      const parts: string[] = []
      if (s.shirt_number)
        parts.push(`Shirt number changed: ${shirtText(s.shirt_number.old)} to ${shirtText(s.shirt_number.new)}`)
      if (s.registered_date && s.registered_date.new != null)
        parts.push(`Registered date set: ${opts.formatDate(String(s.registered_date.new))}`)
      return parts.length > 0 ? parts.join('; ') : 'Registration updated'
    }
    default:
      return entry.action
  }
}

// The typed confirmation gate for a permanent deletion: the admin must type the
// player's current display name exactly (trimmed) before the destructive button
// enables. Ported from the interim Roster (rosterHelpers.ts) unchanged; the
// approved confirmation is the typed name, not a fixed word.
export function deleteConfirmed(typed: string, displayName: string): boolean {
  return typed.trim() !== '' && typed.trim() === displayName.trim()
}

// Parse the optional shirt number field: empty clears it (null), a 1..99 integer
// sets it, anything else is invalid (undefined) so the input never sends a value
// the column CHECK would reject. Shared by the Add and Edit modals.
export function parseShirt(raw: string): number | null | undefined {
  const trimmed = raw.trim()
  if (trimmed === '') return null
  const n = Number(trimmed)
  if (!Number.isInteger(n) || n < 1 || n > 99) return undefined
  return n
}

// The registered date an Add submits, from the chosen status and the date field.
// A registration date is a registered-only fact: a Pending player never carries
// one, so a Pending add always sends null, whatever the (disabled) date field
// holds, and switching Registered back to Pending clears it. A Registered add
// sends the entered date, or null when blank so the server fills today. Pure so
// the pending/date rule is provable without a DOM.
//
// Defect (PR 3): the Add form showed an always-editable registered date and sent
// it verbatim, so a Pending player could be submitted carrying a registration
// date, a contradictory record the database has no guard against. This is the
// single source of truth for the date a Pending or Registered add sends.
export function registeredDateForAdd(status: 'pending' | 'registered', dateValue: string): string | null {
  if (status !== 'registered') return null
  const trimmed = dateValue.trim()
  return trimmed === '' ? null : trimmed
}

// The atomic edit an Edit submits: only the fields that actually changed,
// mirroring update_player's supplied-fields-only contract (an omitted field is
// left as is, not rewritten). displayName is a trimmed, non-empty, changed name;
// shirtNumber is included (possibly null, to clear the shirt) only when it is a
// valid entry that differs from the current value. Pure so the edit decision is
// provable without a DOM.
//
// Defect (PR 3): the Add/Edit modal built its submit closure once, at first
// render, so an edit ran against the modal's initial values and a shirt typed
// after opening was never seen: a shirt-only change was silently dropped, wrote
// nothing and recorded no history. The fix computes this at submit time from the
// live fields and passes it through the guarded submit input.
export interface PlayerEdit {
  displayName?: string
  shirtNumber?: number | null
}

export function planPlayerEdit(
  current: { displayName: string; shirtNumber: number | null },
  entered: { trimmedName: string; parsedShirt: number | null | undefined },
): PlayerEdit {
  const edit: PlayerEdit = {}
  if (entered.trimmedName !== '' && entered.trimmedName !== current.displayName) {
    edit.displayName = entered.trimmedName
  }
  // undefined is an invalid shirt entry, never a change; a valid null clears the
  // shirt. Only a genuine difference is written, so a no-op edit stays a no-op.
  if (entered.parsedShirt !== undefined && entered.parsedShirt !== current.shirtNumber) {
    edit.shirtNumber = entered.parsedShirt
  }
  return edit
}

export function playerEditHasChange(edit: PlayerEdit): boolean {
  return 'displayName' in edit || 'shirtNumber' in edit
}
