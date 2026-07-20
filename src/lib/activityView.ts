// Pure view logic for the club wide Activity page (docs/product/registered-players-ux.md
// section 11): the filter model and its (batch only) URL round trip, the safe
// event renderer, the source and action vocabularies, the entity reference
// resolver, and the keyset pagination helpers. Kept out of the component so
// every reducer is provable without a DOM or a network, matching the repo rule
// that ordering, filtering and pagination are unit tested (src/lib/playersView.ts,
// src/lib/contentOrder.ts).
//
// PRIVACY BOUNDARY (docs/security/app-audit-boundary.md). The Activity feed is
// pseudonymous and name free. This module never receives, resolves or renders a
// child name from an audit event: descriptions are built from the action, the
// safe changed fields and ids resolved to non child labels (team and season
// names, "Deleted player", "Deleted team"). A display name correction renders
// as the fixed copy "Player name corrected", never the old or new value. The
// ActivityEvent type deliberately omits metadata and request_id, so raw JSON
// and correlation ids never reach the renderer at all.
import { describeHistoryEntry } from './playersView'

// The audit entity vocabulary (docs/security/app-audit-boundary.md). The Entity
// filter maps one to one onto these, with "Import" meaning import_batch.
export type AuditEntityType = 'player' | 'season' | 'import_batch' | 'export'

// The source (provenance) vocabulary, exactly the audit_events.source CHECK.
export type AuditSource =
  | 'manual'
  | 'csv_import'
  | 'xlsx_import'
  | 'spond_import'
  | 'renewal'
  | 'system'
  | 'edge_function'
  | 'database_trigger'

// One audit event as the Activity page consumes it. It carries ONLY the safe
// fields the renderer needs; metadata and request_id are intentionally not part
// of the type and are never selected by the query, so the browser never holds
// the raw metadata JSON or the correlation id. safe_changes is bounded by the
// 0030 check constraint to the approved allow list (team_id, status,
// shirt_number, registered_date, season_id) and never a display_name value.
export interface ActivityEvent {
  id: string
  occurredAt: string
  actorId: string | null
  actorName: string | null
  action: string
  entityType: string
  entityId: string | null
  seasonId: string | null
  teamId: string | null
  source: string
  changedFields: string[] | null
  safeChanges: Record<string, { old?: unknown; new?: unknown }> | null
  batchId: string | null
}

// The columns the Activity query selects, as a single comma list. It is EXACTLY
// the safe fields above: metadata and request_id are deliberately excluded, so
// no raw JSON, no correlation id and (by the 0030 design) no name shaped value
// can ever leave the database toward this page. club_id is not selected either:
// the row's club is enforced by RLS, not shown.
export const ACTIVITY_SELECT_COLUMNS =
  'id, occurred_at, actor_id, actor_name, action, entity_type, entity_id, season_id, team_id, source, changed_fields, safe_changes, batch_id'

// The full filter state the page holds. Only batchId persists in the URL in v1
// (parseActivityFilters / activityFiltersToParams); every other field lives in
// page state, exactly as the Registered players page keeps its name search out
// of the URL. An empty string means "any" for each dimension.
export interface ActivityFilters {
  from: string // 'YYYY-MM-DD' or ''
  to: string // 'YYYY-MM-DD' or ''
  actorId: string
  entity: '' | AuditEntityType
  action: string
  teamId: string
  seasonId: string
  source: '' | AuditSource
  batchId: string // a uuid, the one URL persisted filter (deep link target)
}

export const EMPTY_FILTERS: ActivityFilters = {
  from: '',
  to: '',
  actorId: '',
  entity: '',
  action: '',
  teamId: '',
  seasonId: '',
  source: '',
  batchId: '',
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// A strict uuid check, so a hand edited or malformed ?batch= value is ignored
// rather than sent to the database (a forged or garbage batch id must never
// throw or query; it degrades to no batch filter). Trimmed and case folded so
// the round trip is stable.
export function isUuid(v: string): boolean {
  return UUID_RE.test(v.trim())
}

// Parse the filter state from URL search params. Only the batch filter is read
// from the URL in v1; a malformed batch value is dropped, never queried. Every
// other filter defaults to "any" and lives in page state.
export function parseActivityFilters(params: URLSearchParams): ActivityFilters {
  const batch = params.get('batch') ?? ''
  return { ...EMPTY_FILTERS, batchId: isUuid(batch) ? batch.trim().toLowerCase() : '' }
}

// Serialize to URL search params: only the batch filter is written, and only
// when it is a valid uuid, so the address bar carries a clean, shareable deep
// link and nothing else. No child name and no free text can enter the URL.
export function activityFiltersToParams(f: ActivityFilters): URLSearchParams {
  const params = new URLSearchParams()
  if (f.batchId && isUuid(f.batchId)) params.set('batch', f.batchId)
  return params
}

// The individual non empty filter dimensions, so the "Filters, N active" button
// and the Clear filters affordance track exactly what is applied.
export function activeFilterCount(f: ActivityFilters): number {
  return [f.from, f.to, f.actorId, f.entity, f.action, f.teamId, f.seasonId, f.source, f.batchId].filter(
    (v) => v !== '',
  ).length
}

export function filtersAreActive(f: ActivityFilters): boolean {
  return activeFilterCount(f) > 0
}

// The inclusive From boundary: the start of the given day, in UTC. Returns null
// for a blank or malformed date so a partial input never produces a bound.
export function fromBoundaryIso(date: string): string | null {
  if (!DATE_RE.test(date)) return null
  return `${date}T00:00:00.000Z`
}

// The exclusive To boundary: the start of the day AFTER the given day, in UTC,
// so the whole To day is included (occurred_at < next midnight). Date maths is
// deterministic given the input string.
export function toBoundaryExclusiveIso(date: string): string | null {
  if (!DATE_RE.test(date)) return null
  const d = new Date(`${date}T00:00:00.000Z`)
  if (Number.isNaN(d.getTime())) return null
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString()
}

// A single PostgREST filter predicate, applied by the query hook. Kept as data
// so the exact set of predicates a filter state produces is unit testable.
export interface QueryCondition {
  column: string
  op: 'eq' | 'gte' | 'lt'
  value: string
}

// The column predicates for a filter state. IMPORTANT: there is no club_id
// predicate here. Club scope is enforced server side by the audit_events select
// policy (club_id = my_club()); the client neither sends nor is trusted for the
// club identity. A malformed batch id contributes no predicate (it is dropped),
// so a forged ?batch= value cannot widen or break the query.
export function activityQueryConditions(f: ActivityFilters): QueryCondition[] {
  const c: QueryCondition[] = []
  const from = fromBoundaryIso(f.from)
  if (from) c.push({ column: 'occurred_at', op: 'gte', value: from })
  const to = toBoundaryExclusiveIso(f.to)
  if (to) c.push({ column: 'occurred_at', op: 'lt', value: to })
  if (f.actorId) c.push({ column: 'actor_id', op: 'eq', value: f.actorId })
  if (f.entity) c.push({ column: 'entity_type', op: 'eq', value: f.entity })
  if (f.action) c.push({ column: 'action', op: 'eq', value: f.action })
  if (f.teamId) c.push({ column: 'team_id', op: 'eq', value: f.teamId })
  if (f.seasonId) c.push({ column: 'season_id', op: 'eq', value: f.seasonId })
  if (f.source) c.push({ column: 'source', op: 'eq', value: f.source })
  if (f.batchId && isUuid(f.batchId)) c.push({ column: 'batch_id', op: 'eq', value: f.batchId })
  return c
}

// ---- Keyset pagination ------------------------------------------------------
// The feed is server paginated by a keyset (seek) cursor, never OFFSET, so
// pages stay stable while newer events are inserted between requests. The total
// order is occurred_at descending with id descending as the tiebreak (id breaks
// the ties that a bulk import creates, where every row shares one occurred_at).
// A cursor is the (occurred_at, id) of the last row of a page; the next page is
// the rows strictly after it in that order. Because a newer event has a larger
// (occurred_at, id) than any cursor, it can only ever appear ABOVE the current
// position (on a fresh first page), never inside an already fetched window, so
// existing rows are partitioned into disjoint, complete windows regardless of
// concurrent inserts.

export const ACTIVITY_PAGE_SIZE = 50

export interface ActivityCursor {
  occurredAt: string
  id: string
}

// The cursor for the NEXT page, or null when the feed is exhausted. A page
// shorter than the page size means there is nothing more to fetch.
export function nextCursor(page: ActivityEvent[], pageSize = ACTIVITY_PAGE_SIZE): ActivityCursor | null {
  if (page.length < pageSize) return null
  const last = page[page.length - 1]
  return { occurredAt: last.occurredAt, id: last.id }
}

// The PostgREST `or` predicate expressing "strictly after the cursor" in
// occurred_at desc, id desc order: an older occurred_at, OR the same instant
// with a smaller id. Returns null for the first page. The occurred_at value is
// the exact string the server returned, so the equality arm matches that
// instant to the microsecond.
export function keysetOrFilter(cursor: ActivityCursor | null): string | null {
  if (!cursor) return null
  return `occurred_at.lt.${cursor.occurredAt},and(occurred_at.eq.${cursor.occurredAt},id.lt.${cursor.id})`
}

// The total order the feed presents, as a comparator: occurred_at desc, then id
// desc. Exported so tests can prove the page windows reassemble the globally
// sorted sequence with no gaps and no reordering.
export function compareActivity(a: ActivityEvent, b: ActivityEvent): number {
  if (a.occurredAt !== b.occurredAt) return a.occurredAt < b.occurredAt ? 1 : -1
  if (a.id !== b.id) return a.id < b.id ? 1 : -1
  return 0
}

// Flatten fetched pages into one list, de-duplicating by id. The keyset already
// prevents a row appearing on two pages; this is a defensive belt so a
// concurrent insert that shifted a boundary can never surface a duplicate row
// in the rendered list. Order within and across pages is preserved.
export function flattenPages(pages: ActivityEvent[][]): ActivityEvent[] {
  const seen = new Set<string>()
  const out: ActivityEvent[] = []
  for (const page of pages) {
    for (const e of page) {
      if (seen.has(e.id)) continue
      seen.add(e.id)
      out.push(e)
    }
  }
  return out
}

// ---- Vocabularies for the filter selects -----------------------------------

export const ENTITY_OPTIONS: { value: AuditEntityType; label: string }[] = [
  { value: 'player', label: 'Player' },
  { value: 'season', label: 'Season' },
  { value: 'import_batch', label: 'Import' },
  { value: 'export', label: 'Export' },
]

export const SOURCE_OPTIONS: { value: AuditSource; label: string }[] = [
  { value: 'manual', label: 'Manual' },
  { value: 'csv_import', label: 'CSV import' },
  { value: 'xlsx_import', label: 'XLSX import' },
  { value: 'spond_import', label: 'Spond import' },
  { value: 'renewal', label: 'Renewal' },
  { value: 'system', label: 'System' },
  { value: 'edge_function', label: 'Edge function' },
  { value: 'database_trigger', label: 'Database trigger' },
]

// The action catalogue as filter options, human labelled. Covers every action a
// launch writer or trigger can emit (docs/security/app-audit-boundary.md action
// catalogue). Grows as the audit rolls out to other domains (PR 8), never
// shrinks.
export const ACTION_OPTIONS: { value: string; label: string }[] = [
  { value: 'player.created', label: 'Player added' },
  { value: 'player.registration_created', label: 'Registration created' },
  { value: 'player.renewed', label: 'Registration renewed' },
  { value: 'player.updated', label: 'Player name corrected' },
  { value: 'player.registration_updated', label: 'Registration updated' },
  { value: 'player.team_changed', label: 'Team changed' },
  { value: 'player.status_changed', label: 'Status changed' },
  { value: 'player.withdrawn', label: 'Withdrawn' },
  { value: 'player.restored', label: 'Restored' },
  { value: 'player.deleted', label: 'Player deleted' },
  { value: 'players.import_completed', label: 'Import completed' },
  { value: 'players.import_failed', label: 'Import failed' },
  { value: 'players.exported', label: 'Players exported' },
  { value: 'players.spond_imported', label: 'Spond import' },
  { value: 'season.created', label: 'Season created' },
  { value: 'season.updated', label: 'Season updated' },
  { value: 'season.activated', label: 'Season activated' },
  { value: 'season.archived', label: 'Season archived' },
]

// The source label, from the fixed vocabulary. Falls back to the raw value for
// any future source the catalogue adds before this map does (never user data:
// source is a bounded enum column).
const SOURCE_LABELS: Record<string, string> = Object.fromEntries(
  SOURCE_OPTIONS.map((o) => [o.value, o.label]),
)

export function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source
}

// The deep link that applies the batch filter, used by import batch references
// and per row batch chips. The batch id is the only URL persisted filter, so a
// batch link is a complete, shareable view. A non uuid id yields the bare page
// (defensive; the page ignores a malformed batch anyway).
export function activityBatchHref(batchId: string): string {
  return isUuid(batchId) ? `/activity?batch=${batchId}` : '/activity'
}

// ---- The safe event description --------------------------------------------
// The same grammar as per player History for player events (describeHistoryEntry,
// shared), extended here for season, import and export actions. No child name is
// ever assembled: player descriptions come from the action and the safe changed
// fields, and a display name correction is the fixed copy string. teamName
// resolves a team id (or null) to a non child label; formatDate renders a
// YYYY-MM-DD value. Both are injected so this stays pure and clock free.
export function describeActivityEvent(
  e: Pick<ActivityEvent, 'action' | 'safeChanges' | 'changedFields'>,
  opts: { teamName: (id: string | null | undefined) => string; formatDate: (iso: string) => string },
): string {
  if (e.action.startsWith('player.')) {
    // Player grammar is shared with the History panel so the two surfaces read
    // identically; it renders no name (player.updated is "Player name corrected").
    return describeHistoryEntry(e, opts)
  }
  switch (e.action) {
    case 'season.created':
      return 'Season created'
    case 'season.updated':
      return 'Season updated'
    case 'season.activated':
      return 'Season activated'
    case 'season.archived':
      return 'Season archived'
    case 'players.import_completed':
      return 'Players imported'
    case 'players.import_failed':
      return 'Player import failed'
    case 'players.exported':
      return 'Players exported'
    case 'players.spond_imported':
      return 'Players imported from Spond'
    default:
      // A future action not yet mapped: show the bare action key. It is a fixed
      // enum string chosen by a server writer, never user or child data.
      return e.action
  }
}

// ---- The entity reference ---------------------------------------------------
// What the row shows for its entity, resolved at read time and degraded to a
// neutral label where the target no longer exists or the viewer cannot name it.
// Never a stored or inferred child name.
export type EntityRef =
  // An existing player the viewer can name: the row offers "View history".
  | { kind: 'player-history'; playerId: string }
  // The viewer holds players.view but the id is absent: the player was deleted.
  | { kind: 'player-deleted' }
  // The viewer lacks players.view, so names never resolve: neutral, no action
  // and no deletion claim (fail closed; never a leak, never a false "deleted").
  | { kind: 'player-anon' }
  | { kind: 'season'; label: string }
  | { kind: 'batch'; batchId: string }
  | { kind: 'export' }
  | { kind: 'none' }

export function entityRef(
  e: Pick<ActivityEvent, 'entityType' | 'entityId'>,
  opts: {
    canSeeNames: boolean
    playerExists: (id: string) => boolean
    seasonName: (id: string) => string | null
  },
): EntityRef {
  switch (e.entityType) {
    case 'player':
      if (!e.entityId) return { kind: 'none' }
      if (!opts.canSeeNames) return { kind: 'player-anon' }
      return opts.playerExists(e.entityId) ? { kind: 'player-history', playerId: e.entityId } : { kind: 'player-deleted' }
    case 'season': {
      const name = e.entityId ? opts.seasonName(e.entityId) : null
      return { kind: 'season', label: name ?? 'Season' }
    }
    case 'import_batch':
      return e.entityId ? { kind: 'batch', batchId: e.entityId } : { kind: 'none' }
    case 'export':
      return { kind: 'export' }
    default:
      return { kind: 'none' }
  }
}
