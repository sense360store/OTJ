// The club wide Activity page (Registered Players PR 7). Holders of audit.view
// (managers and admins by default) read the club's operational history: who
// changed what, when, and where from. Parents and coaches without audit.view
// never reach it (the RequireCap guard in App.tsx and the audit_events RLS both
// refuse them). The feed is server paginated by a keyset cursor, filterable, and
// deliberately NAME FREE: no child name, raw metadata, JSON, filename, search
// term, token, email or secret ever reaches this page. Player references resolve
// to "View history" (existing) or a neutral "Deleted player"; the child's name
// appears only inside the gated History modal, never in the feed. REVIEW: this
// page renders the audit boundary; the safe field discipline is the review gate.
import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuditActivity, useClubPlayerIdentities, useMyCapabilities, useProfiles, useSeasons, useTeams } from '../lib/queries'
import {
  ACTION_OPTIONS,
  ENTITY_OPTIONS,
  EMPTY_FILTERS,
  SOURCE_OPTIONS,
  activeFilterCount,
  activityBatchHref,
  activityFiltersToParams,
  describeActivityEvent,
  entityRef,
  filtersAreActive,
  flattenPages,
  parseActivityFilters,
  sourceLabel,
  type ActivityEvent,
  type ActivityFilters,
  type EntityRef,
} from '../lib/activityView'
import { fmtActivityTime, fmtRegDate } from '../lib/playersFormat'
import type { Member, Season, Team } from '../lib/data'
import { Icon } from '../components/icons'
import { Empty, ErrorNote, Loading, Modal } from '../components/ui'
import { PlayerHistoryModal } from '../components/PlayerHistoryModal'

// The resolvers an ActivityItem needs, threaded from the page's cached reads.
// Kept as a plain object so the row stays a pure presentational component the
// static test can render.
export interface ActivityItemContext {
  teamName: (id: string | null | undefined) => string
  seasonName: (id: string) => string | null
  formatDate: (iso: string) => string
  canSeeNames: boolean
  playerExists: (id: string) => boolean
  onViewHistory: (playerId: string) => void
}

// One event, rendered as a list item that reflows from a desktop row to a mobile
// card by CSS alone. There is no separate desktop table, so the mobile card is
// never a second copy of a desktop layout. Every string here is a safe field:
// the time, the actor snapshot (or "System"), the safe description, a resolved
// entity reference, the source label and an optional batch deep link.
export function ActivityItem({ event, ctx }: { event: ActivityEvent; ctx: ActivityItemContext }) {
  const description = describeActivityEvent(event, { teamName: ctx.teamName, formatDate: ctx.formatDate })
  const ref = entityRef(event, {
    canSeeNames: ctx.canSeeNames,
    playerExists: ctx.playerExists,
    seasonName: ctx.seasonName,
  })
  return (
    <li className="activity-item">
      <div className="activity-time mono">{fmtActivityTime(event.occurredAt)}</div>
      <div className="activity-body">
        <div className="activity-line">
          <b className="activity-actor">{event.actorName ?? 'System'}</b>
          <span className="activity-sep" aria-hidden="true">
            {' · '}
          </span>
          <span className="activity-desc">{description}</span>
        </div>
        <div className="activity-meta">
          <EntityRefView refr={ref} />
          <span className="activity-chip">{sourceLabel(event.source)}</span>
          {/* The per row batch link, when the event belongs to an import or
              renewal batch and is not itself the batch summary (whose entity
              reference is already the batch link). */}
          {event.batchId && event.entityType !== 'import_batch' && (
            <Link className="activity-chip activity-batch" to={activityBatchHref(event.batchId)}>
              <Icon.layers style={{ width: 12, height: 12 }} />
              Batch
            </Link>
          )}
        </div>
      </div>
      <div className="activity-actions">
        {ref.kind === 'player-history' && (
          <button className="btn btn-ghost btn-sm" onClick={() => ctx.onViewHistory(ref.playerId)}>
            View history
          </button>
        )}
      </div>
    </li>
  )
}

// The entity reference cell: a "View history" surface for an existing player, a
// neutral label for a deleted or unnameable one, the season name, an import
// batch deep link, or an export. Never a child name.
function EntityRefView({ refr }: { refr: EntityRef }) {
  switch (refr.kind) {
    case 'player-history':
      // The actionable affordance is the View history button in the actions
      // cell; the reference itself stays neutral so the feed shows no name.
      return <span className="activity-entity muted-cell">Player</span>
    case 'player-deleted':
      return <span className="activity-entity muted-cell">Deleted player</span>
    case 'player-anon':
      return <span className="activity-entity muted-cell">Player</span>
    case 'season':
      return <span className="activity-entity">{refr.label}</span>
    case 'batch':
      return (
        <Link className="activity-entity activity-batch" to={activityBatchHref(refr.batchId)}>
          <Icon.layers style={{ width: 12, height: 12 }} />
          Import batch
        </Link>
      )
    case 'export':
      return <span className="activity-entity">Export</span>
    case 'none':
    default:
      return null
  }
}

// The filter controls, shared by the desktop inline bar and the mobile filter
// sheet. Every control carries a visible label and a programmatic one
// (aria-label), and no control uses an id/htmlFor pair, so the two mount points
// never collide. Selecting a value is a partial filter patch the page folds in.
export function ActivityFilterControls({
  filters,
  onChange,
  actors,
  teams,
  seasons,
}: {
  filters: ActivityFilters
  onChange: (patch: Partial<ActivityFilters>) => void
  actors: Member[]
  teams: Team[]
  seasons: Season[]
}) {
  return (
    <div className="activity-filter-grid">
      <label className="field">
        <span className="filter-label">From date</span>
        <input
          type="date"
          className="select"
          value={filters.from}
          onChange={(e) => onChange({ from: e.target.value })}
          aria-label="Filter from date"
        />
      </label>
      <label className="field">
        <span className="filter-label">To date</span>
        <input
          type="date"
          className="select"
          value={filters.to}
          onChange={(e) => onChange({ to: e.target.value })}
          aria-label="Filter to date"
        />
      </label>
      <label className="field">
        <span className="filter-label">Actor</span>
        <select
          className="select"
          value={filters.actorId}
          onChange={(e) => onChange({ actorId: e.target.value })}
          aria-label="Filter by actor"
        >
          <option value="">Anyone</option>
          {actors.map((a) => (
            <option key={a.id} value={a.id}>
              {a.fullName}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="filter-label">Entity</span>
        <select
          className="select"
          value={filters.entity}
          onChange={(e) => onChange({ entity: e.target.value as ActivityFilters['entity'] })}
          aria-label="Filter by entity type"
        >
          <option value="">Any type</option>
          {ENTITY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="filter-label">Action</span>
        <select
          className="select"
          value={filters.action}
          onChange={(e) => onChange({ action: e.target.value })}
          aria-label="Filter by action"
        >
          <option value="">Any action</option>
          {ACTION_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="filter-label">Team</span>
        <select
          className="select"
          value={filters.teamId}
          onChange={(e) => onChange({ teamId: e.target.value })}
          aria-label="Filter by team"
        >
          <option value="">Any team</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="filter-label">Season</span>
        <select
          className="select"
          value={filters.seasonId}
          onChange={(e) => onChange({ seasonId: e.target.value })}
          aria-label="Filter by season"
        >
          <option value="">Any season</option>
          {seasons.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="filter-label">Source</span>
        <select
          className="select"
          value={filters.source}
          onChange={(e) => onChange({ source: e.target.value as ActivityFilters['source'] })}
          aria-label="Filter by source"
        >
          <option value="">Any source</option>
          {SOURCE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}

// The two empty states, exactly per the spec: with no filters, "No activity
// yet."; with filters active, "No activity in this range." plus a Clear filters
// button. Exported so the static test pins both copies without mounting the
// stateful page.
export function ActivityEmpty({ active, onClear }: { active: boolean; onClear: () => void }) {
  return active ? (
    <Empty icon={Icon.search} title="No activity in this range.">
      Nothing matches the current filters.{' '}
      <button className="btn btn-ghost" style={{ marginTop: 12 }} onClick={onClear}>
        Clear filters
      </button>
    </Empty>
  ) : (
    <Empty icon={Icon.clock} title="No activity yet.">
      Changes to players and seasons will appear here.
    </Empty>
  )
}

type ModalState = { kind: 'filters' } | { kind: 'history'; playerId: string; displayName: string } | null

export function Activity() {
  const [searchParams, setSearchParams] = useSearchParams()
  // The batch filter is the one URL persisted dimension (a shareable deep link);
  // every other filter lives in page state, exactly as the Registered players
  // page keeps its name search out of the URL. The effective filter set merges
  // the URL batch over the page state, so a batch link composes with whatever
  // else is applied.
  const urlBatch = useMemo(() => parseActivityFilters(searchParams).batchId, [searchParams])
  const [stateFilters, setStateFilters] = useState<ActivityFilters>(EMPTY_FILTERS)
  const filters = useMemo<ActivityFilters>(() => ({ ...stateFilters, batchId: urlBatch }), [stateFilters, urlBatch])

  const patch = (p: Partial<ActivityFilters>) => {
    // Batch changes flow through the URL (the deep link); everything else is
    // page state. The batch chip navigates the URL directly, so patch never
    // needs to set it.
    const { batchId, ...rest } = p
    if (batchId !== undefined) setSearchParams(activityFiltersToParams({ ...filters, batchId }), { replace: true })
    if (Object.keys(rest).length > 0) setStateFilters((f) => ({ ...f, ...rest }))
  }
  const clearFilters = () => {
    setStateFilters(EMPTY_FILTERS)
    setSearchParams(new URLSearchParams(), { replace: true })
  }

  const { caps } = useMyCapabilities()
  const canView = caps.has('audit.view')
  const canSeeNames = caps.has('players.view')

  const {
    data,
    isLoading,
    isError,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  } = useAuditActivity(filters, canView)
  const { data: profiles = [] } = useProfiles()
  const { data: teams = [] } = useTeams()
  const { data: seasons = [] } = useSeasons(canView)
  const { data: playerNames } = useClubPlayerIdentities(canView && canSeeNames)

  const teamMap = useMemo(() => new Map(teams.map((t) => [t.id, t.name])), [teams])
  const seasonMap = useMemo(() => new Map(seasons.map((s) => [s.id, s.name])), [seasons])
  const teamName = (id: string | null | undefined): string =>
    id == null ? 'Unassigned' : (teamMap.get(id) ?? 'Deleted team')
  const seasonName = (id: string): string | null => seasonMap.get(id) ?? null
  const playerExists = (id: string): boolean => !!playerNames?.has(id.toLowerCase())
  const actors = useMemo<Member[]>(
    () => [...profiles].sort((a, b) => a.fullName.localeCompare(b.fullName)),
    [profiles],
  )

  const events = useMemo<ActivityEvent[]>(() => flattenPages(data?.pages ?? []), [data])
  const active = filtersAreActive(filters)
  const count = activeFilterCount(filters)

  const [modal, setModal] = useState<ModalState>(null)
  const openHistory = (playerId: string) => {
    // Resolve the current display name for the modal title through the
    // players.view gated map (never an audit field). Only offered when the
    // player exists, so the name is always present here.
    const displayName = playerNames?.get(playerId.toLowerCase()) ?? 'Player'
    setModal({ kind: 'history', playerId, displayName })
  }

  // Only claim to resolve names once the map has actually loaded, so an existing
  // player never flashes as "Deleted player" during the initial load (or if the
  // names read errors): until then player references fall back to a neutral
  // label with no history and no deletion claim.
  const ctx: ActivityItemContext = {
    teamName,
    seasonName,
    formatDate: fmtRegDate,
    canSeeNames: canSeeNames && playerNames !== undefined,
    playerExists,
    onViewHistory: openHistory,
  }

  // The route guard already redirects a non holder; this is belt and braces for
  // the brief moment before the capability read settles or a direct mount.
  if (!canView) return null

  const filterControls = (
    <ActivityFilterControls filters={filters} onChange={patch} actors={actors} teams={teams} seasons={seasons} />
  )

  const results = () => {
    if (isLoading) return <Loading />
    if (isError) return <ErrorNote />
    if (events.length === 0) return <ActivityEmpty active={active} onClear={clearFilters} />
    return (
      <>
        <ul className="activity-list">
          {events.map((e) => (
            <ActivityItem key={e.id} event={e} ctx={ctx} />
          ))}
        </ul>
        {hasNextPage && (
          <div className="activity-more">
            <button className="btn btn-ghost" onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
              {isFetchingNextPage ? 'Loading…' : 'Load more'}
            </button>
          </div>
        )}
      </>
    )
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Activity</h2>
          <div className="sub">Who changed what, across the club.</div>
        </div>
        <button
          className="btn btn-ghost activity-filters-btn"
          aria-label={count > 0 ? `Filters, ${count} active` : 'Filters'}
          aria-haspopup="dialog"
          onClick={() => setModal({ kind: 'filters' })}
        >
          <Icon.filter />
          Filters{count > 0 ? ` (${count})` : ''}
        </button>
      </div>

      {/* Desktop inline filters. Hidden below 900px, where the Filters button
          opens the same controls in a dialog (the shared Modal). */}
      <div className="activity-filters">
        {filterControls}
        {active && (
          <button className="btn btn-ghost activity-clear" onClick={clearFilters}>
            Clear filters
          </button>
        )}
      </div>

      {active && urlBatch && (
        <p className="muted activity-filter-note" style={{ fontSize: 13.5, marginBottom: 12 }}>
          Filtered to one import batch.
        </p>
      )}

      {/* Announce loading, error and empty transitions politely for assistive
          technology; aria-busy signals the pending fetch. */}
      <div aria-live="polite" aria-busy={isLoading || isFetchingNextPage}>
        {results()}
      </div>

      {modal?.kind === 'filters' && (
        <Modal title="Filters" sub={count > 0 ? `${count} active` : 'None active'} onClose={() => setModal(null)}
          footer={
            <>
              {active && (
                <button
                  className="btn btn-ghost"
                  onClick={() => {
                    clearFilters()
                    setModal(null)
                  }}
                >
                  Clear filters
                </button>
              )}
              <button className="btn btn-primary" onClick={() => setModal(null)}>
                Done
              </button>
            </>
          }
        >
          {filterControls}
        </Modal>
      )}

      {modal?.kind === 'history' && (
        <PlayerHistoryModal
          playerId={modal.playerId}
          displayName={modal.displayName}
          teams={teams}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  )
}
