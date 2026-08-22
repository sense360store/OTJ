// =====================================================================
// COACH-3 on the Players and groups screen.
//
// The second half of COACH-3. The first (#203) settled every rule as pure
// functions in ../lib/sessionSetup; this renders them and nothing more.
//
// PRESENTATIONAL ONLY, and that is the whole point of the split. There is
// no counting here, no threshold, no colour vocabulary, no grouping and no
// comparison against the plan: every number and every sentence arrives
// already decided, so the screen and the generator cannot disagree about
// the night they are both describing. If this file ever needs to work
// something out, the working out belongs in the module.
//
// NOTHING HERE PERSISTS. Apply hands the coach's draft to `applySetup` and
// puts the result back in local state, exactly as ticking a row does. The
// write happens on Save groups, through the one existing path.
import {
  SETUP_ISSUE_FIXES,
  SETUP_NOTES,
  type SetupPlan,
  type SetupReadiness,
  type StationFit,
  expectedAttendanceNote,
  groupStartStation,
  stationFitNote,
} from '../lib/sessionSetup'
import { bibSwatch } from '../lib/bibs'

// The name a coach reads. "Suggested" rather than "Generated", because
// what it produces is a draft they edit and Save, and the word has to
// carry that or the Apply button reads as a commitment.
export const SETUP_SUGGESTION_TITLE = 'Suggested setup'

// The sentence for a night nobody has arranged yet. NOT "not ready":
// `setupReadiness` keeps those apart precisely so this can say the true
// one, and an untouched session must not read as a failed one.
export const SETUP_NOT_STARTED = 'Nobody is in a group yet.'
export const SETUP_READY = 'Every selected player has a bib and every group has its own colour.'

function GroupLine({ group }: { group: SetupPlan['groups'][number] }) {
  const swatch = bibSwatch(group.colour)
  return (
    <div className="setup-group">
      <span
        className="setup-swatch"
        style={{ background: swatch ?? 'transparent' }}
        aria-hidden="true"
      />
      <span className="setup-group-name">{group.label}</span>
      {/* Derived on every read, never stored, and never computed here:
          groupStartStation is the one answer to which station a group
          begins at, and it is the same one the plan uses. */}
      <span className="muted setup-group-meta">
        Group {group.index} · starts at station {groupStartStation(group)} ·{' '}
        {group.children.length} {group.children.length === 1 ? 'player' : 'players'}
      </span>
      {group.teamNames.length > 0 && (
        <span className="muted setup-group-teams">{group.teamNames.join(' · ')}</span>
      )}
    </div>
  )
}

export function SetupSuggestionView({
  plan,
  fit,
  readiness,
  canEdit,
  onApply,
}: {
  // Every figure and every group, already decided by ../lib/sessionSetup.
  plan: SetupPlan
  // How the recommendation compares with the coach's own plan. Advice: it
  // never edits an activity and never stands a station down.
  fit: StationFit
  readiness: SetupReadiness
  canEdit: boolean
  onApply?: () => void
}) {
  const { recommendation, groups, notes } = plan
  // The sentence naming which population the count came from, so a coach
  // reading "five stations" can see why it said five. Built by the module,
  // because the two figures behind a partial count have to stay attached
  // to the words that name them.
  const expected = expectedAttendanceNote(recommendation.expected)
  const fitNote = stationFitNote(fit)

  return (
    <section className="setup-card" aria-label={SETUP_SUGGESTION_TITLE}>
      <div className="setup-head">
        <h3 className="setup-title">{SETUP_SUGGESTION_TITLE}</h3>
        {canEdit && onApply && (
          <button
            className="btn"
            onClick={onApply}
            disabled={groups.length === 0}
            title={groups.length === 0 ? 'There is nobody to put in a group yet.' : undefined}
          >
            Apply
          </button>
        )}
      </div>

      <div className="setup-lead">
        <span className="setup-figure">
          {recommendation.stations} stations · {recommendation.groups} groups
        </span>
        <span className="muted setup-expected">{expected}</span>
      </div>

      {fitNote && <div className="setup-note setup-note-plan">{fitNote}</div>}

      {notes.map((note) => (
        <div key={note} className="setup-note muted">
          {SETUP_NOTES[note]}
        </div>
      ))}

      {groups.length > 0 && (
        <div className="setup-groups">
          {groups.map((g) => (
            <GroupLine key={g.index} group={g} />
          ))}
        </div>
      )}

      {/* Readiness, in the coach's own words and never as a blocker. Save
          stays available whatever this says: the brief's rule is that a
          warning is shown, not that it stops anybody. */}
      <div className="setup-readiness" role="status">
        {!readiness.started ? (
          <span className="muted">{SETUP_NOT_STARTED}</span>
        ) : readiness.issues.length === 0 ? (
          <span className="muted">{SETUP_READY}</span>
        ) : (
          readiness.issues.map((issue) => (
            <div key={issue} className="setup-issue">
              {SETUP_ISSUE_FIXES[issue]}
            </div>
          ))
        )}
      </div>
    </section>
  )
}
