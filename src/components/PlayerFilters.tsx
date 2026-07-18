// The Registered players filter bar: a name search and a sort select, then the
// team and status filters. Every control is labelled (a visible label or an
// aria-label), and each change is a partial filter update the page folds into
// the URL. Team offers All teams, each team, then Unassigned (a filter, not an
// access boundary, so it shows for every viewer).
import type { PlayersFilters, SortKey, StatusFilter, TeamFilter } from '../lib/playersView'
import type { Team } from '../lib/data'
import { Icon } from './icons'

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'name', label: 'Sort: Name' },
  { key: 'team', label: 'Sort: Team' },
  { key: 'status', label: 'Sort: Status' },
  { key: 'shirt', label: 'Sort: Shirt number' },
  { key: 'registered', label: 'Sort: Registered date' },
  { key: 'updated', label: 'Sort: Last updated' },
]

const STATUS_OPTIONS: { key: StatusFilter; label: string }[] = [
  { key: 'pending_registered', label: 'Pending and registered' },
  { key: 'pending', label: 'Pending' },
  { key: 'registered', label: 'Registered' },
  { key: 'withdrawn', label: 'Withdrawn' },
  { key: 'all', label: 'All' },
]

export function PlayerFilters({
  filters,
  onChange,
  teams,
}: {
  filters: PlayersFilters
  onChange: (patch: Partial<PlayersFilters>) => void
  teams: Team[]
}) {
  return (
    <div>
      <div className="reg-toolbar">
        <div className="search-lg">
          <Icon.search />
          <input
            value={filters.q}
            onChange={(e) => onChange({ q: e.target.value })}
            placeholder="Search by name…"
            aria-label="Search players by name"
            type="search"
          />
        </div>
        <select
          className="select"
          value={filters.sort}
          onChange={(e) => onChange({ sort: e.target.value as SortKey })}
          aria-label="Sort players"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      <div className="reg-filters">
        <div className="field">
          <label htmlFor="filter-team">Team</label>
          <select
            id="filter-team"
            className="select"
            value={filters.team}
            onChange={(e) => onChange({ team: e.target.value as TeamFilter })}
          >
            <option value="all">All teams</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
            <option value="unassigned">Unassigned</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="filter-status">Status</label>
          <select
            id="filter-status"
            className="select"
            value={filters.status}
            onChange={(e) => onChange({ status: e.target.value as StatusFilter })}
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  )
}
