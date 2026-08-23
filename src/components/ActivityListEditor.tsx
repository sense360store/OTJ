// =====================================================================
// COACH-10: the one authoring seam.
//
// The dated-session planner (src/routes/Planner.tsx) and the week-plan
// editor (src/components/TemplateFormModal.tsx) stop maintaining two
// activity editors. This file owns the common editing experience: the
// list in source order, the add bar, the activity row, reorder, phase and
// duration, and the mount of the shared Session role row. The hosts
// supply what genuinely differs and nothing else.
//
// A REFACTOR, NOT A REDESIGN. Every piece of markup here moved verbatim
// from the host that owned it, class names and inline styles included,
// so a coach can tell nothing shipped. The only new structure is that the
// three control clusters both rows carried as identical copies (the phase
// select, the duration field, the remove button) are now written once.
//
// THE VARIANT IS EXPLICIT, NOT INFERRED. The two hosts genuinely differ
// and the differences arrive as one discriminated union rather than as
// boolean soup or hidden heuristics:
//
//   session   the dated planner. Draggable rows with an expandable drill
//             panel, a read-only viewer state, the busy freeze while a
//             save or start is in flight, the session-local stand-down,
//             and a host-supplied empty state. The host resolves each
//             row's drill, media and diagram nodes, because those reads
//             (and the drillDiagram display rules) are planner business.
//   plan      the week-plan editor. Dense act-edit rows reordered with
//             the Move up and Move down buttons, no stand-down ever
//             (`skipped` is session local and reusable content must not
//             carry it), and no busy freeze, which is that host's
//             deliberate current behaviour: its whole form submits
//             through the modal footer and no activity control froze
//             before this seam existed, so none freezes now.
//
// WHAT THIS FILE MUST NOT KNOW. No query or mutation hook, no Supabase,
// no idea whether it is editing a dated session or a reusable week: every
// edit leaves through a host callback and lands in host state. Role and
// structure meaning stay where they were: ../lib/activityRole owns what a
// press writes, ../lib/activityStructure owns what the plan derives, and
// ActivityRoleControls renders both. Nothing here reads `slot` or
// `skipped`, infers from `phase`, or stores a station number.
import type { DragEventHandler, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from './icons'
import type { IconComponent } from './icons'
import { PHASE_COLOR } from './ui'
import { ActivityRoleRow } from './ActivityRoleControls'
import type { ActivityRole } from '../lib/activityRole'
import { PHASES } from '../lib/data'
import type { Activity, Drill, Phase } from '../lib/data'

export interface DragHandlers {
  onDragStart: DragEventHandler<HTMLDivElement>
  onDragEnter: DragEventHandler<HTMLDivElement>
  onDragEnd: DragEventHandler<HTMLDivElement>
  onDragOver: DragEventHandler<HTMLDivElement>
}

// ---- The three control clusters both rows carried as copies ----------

// The phase select. Explicit and never inferred: changing it writes the
// phase and nothing else, which the wiring tests pin from the outside.
function PhaseSelect({
  value,
  onChange,
  disabled = false,
}: {
  value: Phase
  onChange: (phase: Phase) => void
  disabled?: boolean
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as Phase)}
      style={{
        height: 34,
        borderRadius: 8,
        border: '1px solid var(--line)',
        background: 'var(--bg)',
        fontSize: 12.5,
        fontWeight: 700,
        color: 'var(--ink)',
        padding: '0 6px',
      }}
    >
      {PHASES.map((p) => (
        <option key={p} value={p}>
          {p}
        </option>
      ))}
    </select>
  )
}

// The duration field. The `parseInt || 0` shape is the behaviour both
// hosts already had: a cleared input reads as zero rather than NaN.
function DurationField({
  value,
  onChange,
  disabled = false,
}: {
  value: number
  onChange: (duration: number) => void
  disabled?: boolean
}) {
  return (
    <div className="row" style={{ gap: 4 }}>
      <input
        type="number"
        value={value}
        min="1"
        max="90"
        disabled={disabled}
        onChange={(e) => onChange(parseInt(e.target.value) || 0)}
        style={{
          width: 52,
          height: 34,
          borderRadius: 8,
          border: '1px solid var(--line)',
          background: 'var(--bg)',
          textAlign: 'center',
          fontWeight: 800,
          fontSize: 13,
          color: 'var(--ink)',
        }}
      />
      <span className="muted" style={{ fontSize: 12, fontWeight: 700 }}>
        min
      </span>
    </div>
  )
}

function RemoveActivityButton({ onClick, disabled = false }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button className="act-x" disabled={disabled} aria-label="Remove activity" onClick={onClick}>
      <Icon.trash />
    </button>
  )
}

// ---- The dated-session row (moved verbatim from Planner.tsx) ---------

// A labelled setup cell, the drill detail's grid square reused at panel size.
function MetaCell({ icon: Ico, k, v }: { icon: IconComponent; k: string; v: string }) {
  return (
    <div className="setup-cell">
      <div className="k">
        <Ico />
        {k}
      </div>
      <div className="v">
        {v || (
          <span className="muted" style={{ fontWeight: 500 }}>
            Not set
          </span>
        )}
      </div>
    </div>
  )
}

// A numbered sentence list (coaching points, the easier and harder STEP
// adaptations), the same shape the drill detail uses. Renders nothing when
// the drill carries none.
function PanelList({ icon: Ico, label, items }: { icon: IconComponent; label: string; items: string[] }) {
  if (!items.length) return null
  return (
    <div>
      <div className="act-panel-label">
        <Ico style={{ width: 13, height: 13 }} />
        {label}
      </div>
      <div className="coach-points">
        {items.map((p, i) => (
          <div className="cp" key={i}>
            <span className="cp-num">{i + 1}</span>
            <span style={{ fontSize: 14, lineHeight: 1.45 }}>{p}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// The planner's drill row, presentational so the expand and collapse
// behaviour and the row controls render in a test without the data hooks.
// The host resolves the drill, its media nodes and the title and passes
// them in. A drill row's body is a button that toggles the detail panel
// beneath; a custom activity (no drill) keeps the old static body with
// nothing to expand.
export function ActivityCardView({
  act,
  idx,
  title,
  drill,
  thumb,
  expandedMedia,
  expandedDiagram,
  drillHref,
  expanded,
  onToggle,
  onRemove,
  onDur,
  onPhase,
  onRole,
  onStandDown,
  activities,
  dragHandlers,
  dragging,
  readOnly,
  busy = false,
}: {
  act: Activity
  idx: number
  title: string
  drill: Drill | null
  thumb: ReactNode
  expandedMedia: ReactNode
  // The drill's saved Drill Maker diagram (DRILL-02), passed in rather than
  // read here so this stays presentational and rendable with no query client.
  // Note the name: `diagram` alone is already taken in the planner by the
  // uploaded image viewer's mode, which is a different thing entirely.
  expandedDiagram: ReactNode
  drillHref: string
  expanded: boolean
  onToggle: () => void
  onRemove: (i: number) => void
  onDur: (i: number, v: number) => void
  onPhase: (i: number, v: Phase) => void
  // COACH-2B. The session role and the dated-session stand-down. The
  // whole plan is passed because a station's NUMBER is its position
  // among the stations running tonight, which one activity cannot know.
  onRole: (i: number, role: ActivityRole) => void
  onStandDown: (i: number, on: boolean) => void
  activities: readonly Activity[]
  dragHandlers: DragHandlers
  dragging: boolean
  readOnly: boolean
  // A Save or Start is in flight on the whole draft; reordering, changing a
  // phase or duration, or removing a row all edit that draft, so they freeze
  // until the write settles. Expanding the detail panel is passive viewing and
  // stays live. readOnly rows are never busy (a viewer starts no write).
  busy?: boolean
}) {
  const panelId = `act-panel-${idx}`
  const frozen = readOnly || busy
  return (
    <div className="act-item">
      <div
        className="act-card"
        style={dragging ? { opacity: 0.4 } : undefined}
        draggable={!frozen}
        {...(frozen ? {} : dragHandlers)}
      >
        {!readOnly && (
          <span className="act-grip">
            <Icon.grip />
          </span>
        )}
        {drill ? (
          <button
            type="button"
            className="ac-toggle"
            aria-expanded={expanded}
            aria-controls={panelId}
            onClick={onToggle}
          >
            <span className="act-thumb" style={{ overflow: 'hidden' }}>
              {thumb}
            </span>
            <span className="ac-toggle-text">
              <span className="ac-title">{title}</span>
              <span className="ac-sub">
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <span className="tag-dot" style={{ background: PHASE_COLOR[act.phase] }}></span>
                  {act.phase}
                </span>
                {drill.skill ? <span>{drill.skill}</span> : null}
              </span>
            </span>
            <span className={'ac-caret' + (expanded ? ' open' : '')}>
              <Icon.chevDown />
            </span>
          </button>
        ) : (
          <>
            <div className="act-thumb" style={{ overflow: 'hidden' }}>
              {thumb}
            </div>
            <div className="ac-body">
              <h4>{title}</h4>
              <div className="ac-sub">
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <span className="tag-dot" style={{ background: PHASE_COLOR[act.phase] }}></span>
                  {act.phase}
                </span>
              </div>
            </div>
          </>
        )}
        <PhaseSelect value={act.phase} disabled={frozen} onChange={(v) => onPhase(idx, v)} />
        <DurationField value={act.duration} disabled={frozen} onChange={(v) => onDur(idx, v)} />
        {!readOnly && <RemoveActivityButton disabled={busy} onClick={() => onRemove(idx)} />}
      </div>

      {/* COACH-2B. What this activity DOES on the night, said explicitly and
          never inferred from its phase. Freezes with every other write control
          while a save is in flight.
          A read-only viewer keeps the derived badge and loses only the
          controls, which is how the phase select and duration already treat
          them: they render disabled rather than vanishing. Removing the whole
          row left a viewer reading "4 stations · 1 not running" on the side
          card with no way to tell WHICH row that was. */}
      <ActivityRoleRow
        activities={activities}
        index={idx}
        label={title}
        dated
        readOnly={readOnly}
        disabled={frozen}
        onRole={(role) => onRole(idx, role)}
        onStandDown={(on) => onStandDown(idx, on)}
      />

      {expanded && drill && (
        <div className="act-panel" id={panelId} role="region" aria-label={`${drill.title} details`}>
          {expandedMedia}
          {/* The saved Drill Maker diagram, beside the uploaded media rather
              than instead of it: a drill may have both, and neither replaces
              the other. It sits in the panel, never in .act-card, because the
              card is the drag source and the row is already full at phone
              width. Read only, and no editing affordance: building a diagram
              belongs to Drill Maker. */}
          {expandedDiagram}
          {drill.summary && <p className="act-panel-summary">{drill.summary}</p>}
          <div className="setup-grid">
            <MetaCell icon={Icon.clock} k="Duration" v={drill.duration + ' min'} />
            <MetaCell icon={Icon.users} k="Players" v={drill.players} />
            <MetaCell icon={Icon.ruler} k="Area" v={drill.area} />
            <MetaCell icon={Icon.target} k="Skill" v={drill.skill} />
          </div>
          <div>
            <div className="act-panel-label">
              <Icon.cone style={{ width: 13, height: 13 }} />
              Equipment
            </div>
            <div className="row wrap" style={{ gap: 7 }}>
              {drill.equipment.length ? (
                drill.equipment.map((e) => (
                  <span className="pill" key={e}>
                    {e}
                  </span>
                ))
              ) : (
                <span className="muted" style={{ fontSize: 13 }}>
                  None needed
                </span>
              )}
            </div>
          </div>
          <PanelList icon={Icon.whistle} label="Coaching points" items={drill.points} />
          <PanelList icon={Icon.chevDown} label="Make it easier" items={drill.easier} />
          <PanelList icon={Icon.bolt} label="Make it harder" items={drill.harder} />
          {/* Reading the detail is passive viewing and stays live, but the link
              OUT to the full drill leaves the planner and would abandon the
              draft, so it freezes with the other navigation controls while a
              write is in flight. A read-only viewer is never busy, so their
              link stays live. */}
          {busy ? (
            <button type="button" className="btn btn-ghost btn-sm act-panel-link" disabled>
              <Icon.external />
              Open full drill
            </button>
          ) : (
            <Link className="btn btn-ghost btn-sm act-panel-link" to={drillHref}>
              <Icon.external />
              Open full drill
            </Link>
          )}
        </div>
      )}
    </div>
  )
}

// ---- The week-plan row (moved verbatim from TemplateFormModal.tsx) ---

// One activity row in the week-plan editor. The title takes the available row
// width while the phase, duration and controls size to their content (the
// act-edit layout), which keeps a long FA drill title legible instead of
// collapsing to a sliver that wraps a letter per line. Presentational, no
// hooks; the host resolves the drill and passes its title and skill in.
export function TemplateActivityRow({
  activity,
  title,
  skill,
  index,
  count,
  onPhase,
  onDuration,
  onMove,
  onRemove,
  activities,
  onRole,
}: {
  activity: Activity
  title: string
  skill?: string | null
  index: number
  count: number
  onPhase: (phase: Phase) => void
  onDuration: (duration: number) => void
  onMove: (dir: -1 | 1) => void
  onRemove: () => void
  // COACH-2B. The whole list, because a station's NUMBER is its position
  // among the stations running, which one activity cannot know.
  activities: readonly Activity[]
  onRole: (role: ActivityRole) => void
}) {
  return (
    <div className="act-item" style={{ marginBottom: 0 }}>
      <div className="act-card act-edit" style={{ marginBottom: 0 }}>
      <span className="tag-dot" style={{ background: PHASE_COLOR[activity.phase], width: 10, height: 10 }}></span>
      <div className="ac-body">
        <h4>{title}</h4>
        <div className="ac-sub">{skill && <span>{skill}</span>}</div>
      </div>
      <PhaseSelect value={activity.phase} onChange={onPhase} />
      <DurationField value={activity.duration} onChange={onDuration} />
      <button
        className="icon-btn"
        style={{ width: 34, height: 34 }}
        aria-label="Move up"
        disabled={index === 0}
        onClick={() => onMove(-1)}
      >
        <Icon.chevDown style={{ width: 15, height: 15, transform: 'rotate(180deg)' }} />
      </button>
      <button
        className="icon-btn"
        style={{ width: 34, height: 34 }}
        aria-label="Move down"
        disabled={index === count - 1}
        onClick={() => onMove(1)}
      >
        <Icon.chevDown style={{ width: 15, height: 15 }} />
      </button>
      <RemoveActivityButton onClick={onRemove} />
      </div>
      {/* COACH-2B. A week plan may declare a station or the games phase, and
          that declaration is copied into every dated session started from it.
          No stand-down here: "Not running tonight" is session local, and this
          is reusable content. */}
      <ActivityRoleRow activities={activities} index={index} label={title} dated={false} onRole={onRole} />
    </div>
  )
}

// ---- The add bar ------------------------------------------------------

// The two "add an activity" buttons under the list. On the dated planner
// adding edits the draft, so both freeze while a write is in flight; the
// week-plan editor passes no busy state, which is its current behaviour.
// marginTop carries the one spacing difference the two hosts already had,
// so neither surface moves by a pixel.
export function AddActivityBar({
  busy,
  onAddLibrary,
  onAddCustom,
  marginTop = 4,
}: {
  busy: boolean
  onAddLibrary: () => void
  onAddCustom: () => void
  marginTop?: number
}) {
  return (
    <div className="row" style={{ gap: 10, marginTop }}>
      <button className="add-slot" style={{ marginBottom: 0 }} disabled={busy} onClick={onAddLibrary}>
        <Icon.plus />
        Add from library
      </button>
      <button className="add-slot" style={{ marginBottom: 0 }} disabled={busy} onClick={onAddCustom}>
        <Icon.edit />
        Add custom
      </button>
    </div>
  )
}

// ---- The one shared editor -------------------------------------------

// One dated row's resolved content. Built by the PLANNER, not here: the
// drill and media lookups, the expanded media preview with its viewer
// modals, and the saved Drill Maker diagram are all planner-owned reads
// and rules, and this seam receives their results as plain nodes.
export interface SessionRowContent {
  title: string
  drill: Drill | null
  thumb: ReactNode
  expandedMedia: ReactNode
  expandedDiagram: ReactNode
  drillHref: string
}

export type ActivityListVariant =
  | {
      kind: 'session'
      readOnly: boolean
      busy: boolean
      // The host's own empty state, shown when the plan has no activities.
      empty: ReactNode
      expandedIdx: number | null
      onToggle: (i: number) => void
      // Session local. The week plan variant structurally cannot receive
      // this, which is what keeps `skipped` off reusable content.
      onStandDown: (i: number, on: boolean) => void
      draggingIdx: number | null
      dragHandlersFor: (i: number) => DragHandlers
      // The drill, media and diagram nodes for one row, resolved by the
      // host: those reads and their display rules are planner business.
      content: (act: Activity) => SessionRowContent
    }
  | {
      kind: 'plan'
      // The title and skill for one row, resolved by the host.
      meta: (act: Activity) => { title: string; skill: string | null }
      onMove: (i: number, dir: -1 | 1) => void
    }

// The shared activity-list editor. Renders the rows in source order, keyed
// by position exactly as both hosts always keyed them, then the add bar.
// Every edit leaves through an indexed host callback; this component holds
// no state, no persistence and no knowledge of what the list is for.
export function ActivityListEditor({
  activities,
  variant,
  onPhase,
  onDuration,
  onRole,
  onRemove,
  onAddLibrary,
  onAddCustom,
}: {
  activities: readonly Activity[]
  variant: ActivityListVariant
  onPhase: (i: number, phase: Phase) => void
  onDuration: (i: number, duration: number) => void
  onRole: (i: number, role: ActivityRole) => void
  onRemove: (i: number) => void
  onAddLibrary: () => void
  onAddCustom: () => void
}) {
  if (variant.kind === 'plan') {
    return (
      <>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {activities.map((a, i) => {
            const { title, skill } = variant.meta(a)
            return (
              <TemplateActivityRow
                key={i}
                activity={a}
                title={title}
                skill={skill}
                index={i}
                count={activities.length}
                onPhase={(phase) => onPhase(i, phase)}
                onDuration={(duration) => onDuration(i, duration)}
                activities={activities}
                onRole={(role) => onRole(i, role)}
                onMove={(dir) => variant.onMove(i, dir)}
                onRemove={() => onRemove(i)}
              />
            )
          })}
        </div>
        <AddActivityBar busy={false} marginTop={8} onAddLibrary={onAddLibrary} onAddCustom={onAddCustom} />
      </>
    )
  }
  return (
    <>
      {activities.length === 0 ? (
        variant.empty
      ) : (
        <div className="timeline">
          {activities.map((act, i) => {
            const c = variant.content(act)
            return (
              <ActivityCardView
                key={i}
                act={act}
                idx={i}
                title={c.title}
                drill={c.drill}
                thumb={c.thumb}
                expandedMedia={c.expandedMedia}
                expandedDiagram={c.expandedDiagram}
                drillHref={c.drillHref}
                expanded={variant.expandedIdx === i}
                onToggle={() => variant.onToggle(i)}
                onRemove={onRemove}
                onDur={onDuration}
                onPhase={onPhase}
                onRole={onRole}
                onStandDown={variant.onStandDown}
                activities={activities}
                dragHandlers={variant.dragHandlersFor(i)}
                dragging={variant.draggingIdx === i}
                readOnly={variant.readOnly}
                busy={variant.busy}
              />
            )
          })}
        </div>
      )}
      {!variant.readOnly && (
        <AddActivityBar busy={variant.busy} onAddLibrary={onAddLibrary} onAddCustom={onAddCustom} />
      )}
    </>
  )
}
