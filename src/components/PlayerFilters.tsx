// The Registered players filter bar: a name search and a sort select, then the
// team and status filters. Every control is labelled (a visible label or an
// aria-label), and each change is a partial filter update the page folds into
// the URL. Team offers All teams, each team, then Unassigned (a filter, not an
// access boundary, so it shows for every viewer).
//
// Team and Status are the shared SelectField: a real <label> bound to a native
// select. The search and the sort control keep an aria-label rather than
// gaining a visible one, because each already names itself in the control (the
// placeholder "Search by name…", and every sort option reading "Sort: Name").
// 2.6's rule is that a label is a real <label> rather than a styled <div>, not
// that an accessible name must be visible; adding a visible "Sort" label above
// options that already begin "Sort:" would state it twice.
import type { PlayersFilters, SortKey, StatusFilter, TeamFilter } from '../lib/playersView'
import type { Team } from '../lib/data'
import { Icon } from './icons'
import { SelectField } from './primitives'

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
        <SelectField
          id="filter-team"
          label="Team"
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
        </SelectField>
        <SelectField
          id="filter-status"
          label="Status"
          value={filters.status}
          onChange={(e) => onChange({ status: e.target.value as StatusFilter })}
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </SelectField>
      </div>
    </div>
  )
}
