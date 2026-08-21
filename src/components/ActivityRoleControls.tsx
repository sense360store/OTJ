// The COACH-2B authoring affordances, shared by the two surfaces that
// edit a plan's activities: the dated-session planner (src/routes/Planner.tsx)
// and the week-plan editor (src/components/TemplateFormModal.tsx).
//
// PRESENTATIONAL ONLY. No hooks, no queries, no state. Every decision
// about what a press means lives in src/lib/activityRole.ts, so the two
// surfaces cannot drift and the rules stay testable without a screen.
// This file is deliberately not the shared authoring seam: that is
// COACH-10, and it owns the whole activity row.
import {
  ACTIVITY_ROLES,
  ACTIVITY_ROLE_GROUP_LABEL,
  ACTIVITY_ROLE_LABELS,
  NOT_RUNNING_LABEL,
  type ActivityRole,
  activityRoleBadge,
  canStandDown,
  roleOf,
  structureSummary,
} from '../lib/activityRole'
import { type StructuredActivity, isStoodDown } from '../lib/activityStructure'
import { Chip } from './ui'

// The role control. Three chips in a labelled group, using the shared
// Chip primitive so it looks like every other selection in OTJ and
// carries aria-pressed rather than conveying the choice by colour alone.
//
// Chips with aria-pressed rather than a radiogroup because that is this
// repo's settled pattern for an exclusive choice (DrillDiagramEditor's
// tool and colour pickers), and consistency is worth more here than the
// marginally tighter role semantics of radio inputs. Each chip is a real
// button with a real text label, so keyboard and screen reader use come
// for free.
export function ActivityRoleControl({
  role,
  onRole,
  disabled = false,
  idPrefix,
}: {
  role: ActivityRole
  onRole: (role: ActivityRole) => void
  disabled?: boolean
  // Distinguishes one row's group from another's for assistive
  // technology when several rows are on screen at once.
  idPrefix?: string
}) {
  return (
    <div
      role="group"
      aria-label={idPrefix ? `${ACTIVITY_ROLE_GROUP_LABEL}, ${idPrefix}` : ACTIVITY_ROLE_GROUP_LABEL}
      className="row"
      style={{ gap: 6, flexWrap: 'wrap' }}
    >
      <span className="muted" style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: '.04em' }}>
        {ACTIVITY_ROLE_GROUP_LABEL}
      </span>
      {ACTIVITY_ROLES.map((r) => (
        <Chip key={r} on={role === r} disabled={disabled} onClick={() => onRole(r)}>
          {ACTIVITY_ROLE_LABELS[r]}
        </Chip>
      ))}
    </div>
  )
}

// The dated-session stand-down. A real labelled checkbox: the state is
// carried by the control itself, never by colour, and the label is the
// coach's sentence rather than a model word.
export function ActivityStandDownToggle({
  standingDown,
  onStandDown,
  disabled = false,
  describedBy,
}: {
  standingDown: boolean
  onStandDown: (on: boolean) => void
  disabled?: boolean
  describedBy?: string
}) {
  return (
    <label
      className="row"
      style={{ gap: 6, fontSize: 12.5, fontWeight: 700, color: 'var(--slate)', cursor: disabled ? 'default' : 'pointer' }}
    >
      <input
        type="checkbox"
        checked={standingDown}
        disabled={disabled}
        aria-label={describedBy ? `${NOT_RUNNING_LABEL}, ${describedBy}` : NOT_RUNNING_LABEL}
        onChange={(e) => onStandDown(e.target.checked)}
        style={{ width: 16, height: 16 }}
      />
      {NOT_RUNNING_LABEL}
    </label>
  )
}

// The secondary row on an activity card: the role control, the derived
// badge, and the stand-down where it applies.
//
// A SECOND ROW ON PURPOSE. The activity card's top row already carries
// the grip, thumbnail, title, phase select, duration and remove, and it
// is tight at phone width; squeezing a third select in there would cost
// the drill title the space that keeps it legible. The role sits below
// it with room for a real tap target.
export function ActivityRoleRow({
  activities,
  index,
  onRole,
  onStandDown,
  disabled = false,
  // A dated session only. A week plan never offers the stand-down,
  // because `skipped` is session local.
  dated,
  label,
}: {
  activities: readonly StructuredActivity[]
  index: number
  onRole: (role: ActivityRole) => void
  onStandDown?: (on: boolean) => void
  disabled?: boolean
  dated: boolean
  // The activity's title, so each row's controls are distinguishable to
  // a screen reader when the list is long.
  label?: string
}) {
  // roleOf and canStandDown, never a local comparison. Re-deriving
  // either here is how the two surfaces would come to disagree, and how
  // a malformed stored slot would start reading as a declaration.
  const activity = activities[index]
  const role = roleOf(activity)
  const badge = activityRoleBadge(activities, index)
  const standDown = canStandDown(activity, { dated }) && onStandDown !== undefined
  return (
    <div className="act-role-row">
      <ActivityRoleControl role={role} onRole={onRole} disabled={disabled} idPrefix={label} />
      {badge && (
        <span className="role-badge" style={{ fontSize: 11.5 }}>
          {badge}
        </span>
      )}
      {standDown && (
        <ActivityStandDownToggle
          standingDown={isStoodDown(activity)}
          onStandDown={onStandDown}
          disabled={disabled}
          describedBy={label}
        />
      )}
    </div>
  )
}

// The one structure sentence, on both authoring surfaces. Warnings are
// shown and never block: Save stays available whatever this says.
export function ActivityStructureSummary({
  activities,
}: {
  activities: readonly StructuredActivity[]
}) {
  const summary = structureSummary(activities)
  if (activities.length === 0) return null
  return (
    <div className="act-structure" role="status">
      <div style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--ink)' }}>{summary.headline}</div>
      {summary.notes.map((note) => (
        <div key={note} className="muted" style={{ fontSize: 12, fontWeight: 600 }}>
          {note}
        </div>
      ))}
    </div>
  )
}
