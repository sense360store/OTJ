// The covered teams control, shared by the two planner surfaces.
//
// It lived inside src/routes/Planner.tsx until COACH-14A gave the planner a
// second surface. The guided builder asks the same question on its first
// step, and a component in src/components importing from src/routes would be
// a cycle (the planner imports the guide, the guide imports the planner), so
// the control moved down here rather than being written twice. Planner.tsx
// re-exports it, exactly as it re-exports the shared activity list editor's
// row, so every existing import path still resolves.
//
// The markup moved verbatim. Nothing about what a coach sees changed.
import type { Team } from '../lib/data'

// Coverage is a set, not one team: a Thursday night that runs Titans and
// Trojans together is the normal case, and the register lists exactly what
// is ticked here. Nothing ticked is a real state and says so, rather than
// being read as the whole club.
export function CoveredTeamsField({
  teams,
  selected,
  disabled,
  readOnly,
  onToggle,
  onAll,
}: {
  teams: Team[]
  selected: string[]
  disabled: boolean
  readOnly: boolean
  onToggle: (teamId: string) => void
  onAll: () => void
}) {
  const all = teams.length > 0 && teams.every((t) => selected.includes(t.id))
  if (readOnly) {
    const names = teams.filter((t) => selected.includes(t.id)).map((t) => t.name)
    return (
      <div className="field">
        <label>Teams</label>
        {names.length === 0 ? (
          <span className="muted" style={{ fontSize: 13 }}>
            Not set
          </span>
        ) : (
          <div className="row wrap" style={{ gap: 6 }}>
            {(all ? ['All teams'] : names).map((n) => (
              <span key={n} className="pill">
                {n}
              </span>
            ))}
          </div>
        )}
      </div>
    )
  }
  return (
    <div className="field">
      <label>Teams</label>
      {/* The chips are a group of toggles rather than one control, so the
          label above them names nothing on its own; the group carries the
          name so assistive technology reads the chips as the answer to
          "Teams" rather than as four loose buttons. */}
      <div className="row wrap" role="group" aria-label="Teams" style={{ gap: 7 }}>
        <button
          type="button"
          className={'chip' + (all ? ' on' : '')}
          style={{ minHeight: 44 }}
          aria-pressed={all}
          disabled={disabled || teams.length === 0}
          onClick={onAll}
        >
          All teams
        </button>
        {teams.map((t) => {
          const on = selected.includes(t.id)
          return (
            <button
              key={t.id}
              type="button"
              className={'chip' + (on ? ' on' : '')}
              style={{ minHeight: 44 }}
              aria-pressed={on}
              disabled={disabled}
              onClick={() => onToggle(t.id)}
            >
              {t.name}
            </button>
          )
        })}
      </div>
      {selected.length === 0 && (
        <span className="muted" style={{ fontSize: 12.5, marginTop: 6, display: 'block' }}>
          No teams selected, so the register will list nobody.
        </span>
      )}
    </div>
  )
}
