// Create and edit a session template. One modal serves both: pass a template
// to prefill and update, omit it to insert. Creating is curation like every
// other template write here, so the screens surface this for admins; the
// templates RLS enforces the same boundary on update and delete.
//
// The activities editor mirrors the planner: add drills from the library,
// add a custom activity, set the phase and minutes, reorder, remove. An
// activity whose drill has since been deleted renders the removed drill
// placeholder and stays editable, so the template survives the gap.
import { useState } from 'react'
import { Icon } from './icons'
import { ListInput, Modal } from './ui'
import { AddDrillModal } from './AddDrillModal'
import { RightsControl, RightsNewNote } from './RightsControl'
import { useActivityTitle, useDrillMap, useInsertTemplate, useUpdateTemplate } from '../lib/queries'
import type { TemplateInput } from '../lib/queries'
import { ActivityStructureSummary } from './ActivityRoleControls'
import { type ActivityRole, applyRole } from '../lib/activityRole'
import { ActivityListEditor } from './ActivityListEditor'

// COACH-10: the activity row, the add bar and the list itself live in the
// shared authoring seam now, mounted below and by the dated-session planner
// alike. Re-exported so existing imports (and the suites that pin the row's
// behaviour) keep their one path.
export { TemplateActivityRow } from './ActivityListEditor'
import { sessionMinutes } from '../lib/data'
import type { Activity, Template } from '../lib/data'

function fromTemplate(template?: Template): TemplateInput {
  return {
    name: template?.name ?? '',
    focus: template?.focus ?? '',
    intentions: template?.intentions ?? [],
    activities: template ? (JSON.parse(JSON.stringify(template.activities)) as Activity[]) : [],
    sourceUrl: template?.sourceUrl ?? '',
  }
}

export function TemplateFormModal({ template, onClose }: { template?: Template; onClose: () => void }) {
  const insert = useInsertTemplate()
  const update = useUpdateTemplate()
  const drillById = useDrillMap()
  const actTitle = useActivityTitle()
  const [form, setForm] = useState<TemplateInput>(() => fromTemplate(template))
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pending = insert.isPending || update.isPending

  const set = <K extends keyof TemplateInput>(k: K, v: TemplateInput[K]) => setForm((f) => ({ ...f, [k]: v }))
  // COACH-2B. A role press REPLACES the activity rather than patching it,
  // because applyRole removes `slot`, and setAct's spread can only add keys.
  // A week plan may declare a role; it never carries a stand-down, so no
  // stand-down control is offered here and `skipped` has nothing to strip.
  //
  // Not frozen while a save is in flight, deliberately: neither is the phase
  // select, the duration, the reorder or the remove beside it, and a control
  // that froze alone would read as a bug. Freezing this modal's whole
  // activity list is the authoring seam's job (COACH-10), not this slice's.
  const setRole = (i: number, role: ActivityRole) =>
    setForm((f) => {
      const a = [...f.activities]
      a[i] = applyRole(a[i], role)
      return { ...f, activities: a }
    })
  const setAct = (i: number, patch: Partial<Activity>) =>
    setForm((f) => {
      const a = [...f.activities]
      a[i] = { ...a[i], ...patch }
      return { ...f, activities: a }
    })
  const removeAct = (i: number) =>
    set(
      'activities',
      form.activities.filter((_, j) => j !== i),
    )
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= form.activities.length) return
    setForm((f) => {
      const a = [...f.activities]
      ;[a[i], a[j]] = [a[j], a[i]]
      return { ...f, activities: a }
    })
  }

  const submit = () => {
    setError(null)
    const input = { ...form, name: form.name.trim() }
    const opts = { onSuccess: onClose, onError: (e: Error) => setError(e.message) }
    if (template) update.mutate({ id: template.id, input }, opts)
    else insert.mutate(input, opts)
  }

  return (
    <Modal
      title={template ? 'Edit template' : 'New template'}
      sub={template ? template.name : 'A reusable session shell any coach can build a plan from.'}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={pending}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={!form.name.trim() || pending}>
            <Icon.check />
            {pending ? 'Saving…' : template ? 'Save changes' : 'Create template'}
          </button>
        </>
      }
    >
      <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
        <div className="field" style={{ flex: 2, minWidth: 200 }}>
          <label>Name</label>
          <input value={form.name} autoFocus={!template} placeholder="Template name" onChange={(e) => set('name', e.target.value)} />
        </div>
        <div className="field" style={{ flex: 1, minWidth: 140 }}>
          <label>Focus</label>
          <input value={form.focus} placeholder="e.g. Passing" onChange={(e) => set('focus', e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label>Session intentions</label>
        <ListInput
          value={form.intentions}
          onChange={(v) => set('intentions', v)}
          placeholder="Type an intention and press enter"
        />
      </div>

      <div className="field">
        <label>Activities</label>
        <TemplateActivitiesHeader activities={form.activities} />
        {/* COACH-10: the one shared activity-list editor, mounted here and
            by the dated-session planner. This host supplies what only it
            owns: the resolved title and skill, the Move up and Move down
            reorder, and its own form state behind every callback. No
            stand-down exists on this surface, which the variant makes
            structurally true rather than merely omitted. */}
        <ActivityListEditor
          activities={form.activities}
          variant={{
            kind: 'plan',
            meta: (a) => {
              const drill = a.drillId ? drillById[a.drillId] : null
              return { title: actTitle(a), skill: drill?.skill ?? null }
            },
            onMove: move,
          }}
          onPhase={(i, phase) => setAct(i, { phase })}
          onDuration={(i, duration) => setAct(i, { duration })}
          onRole={setRole}
          onRemove={removeAct}
          onAddLibrary={() => setAdding(true)}
          onAddCustom={() => set('activities', [...form.activities, { phase: 'Skill', title: 'Custom activity', duration: 10 }])}
        />
      </div>

      <div className="field">
        <label>Source link</label>
        <input
          type="url"
          value={form.sourceUrl}
          placeholder="https://… where this template came from (optional)"
          onChange={(e) => set('sourceUrl', e.target.value)}
        />
      </div>
      {/* The sharing level lives in the ordinary edit flow, next to the source
          it depends on. It saves on its own, explicitly: saving the week does
          not change it, and neither does pressing Share. */}
      <div className="field">
        <label>Sharing</label>
        {template ? (
          <RightsControl
            kind="template"
            id={template.id}
            current={template.rights}
            source={{ sourceUrl: template.sourceUrl, sourceLabel: template.sourceLabel }}
            draftSource={{ sourceUrl: form.sourceUrl }}
            canEdit
          />
        ) : (
          <RightsNewNote noun="week" />
        )}
      </div>
      {error && (
        <p className="muted" style={{ color: 'var(--danger)', fontSize: 13.5 }}>
          {error}
        </p>
      )}

      {adding && (
        <AddDrillModal
          onClose={() => setAdding(false)}
          onAdd={(items) => {
            set('activities', [...form.activities, ...items])
            setAdding(false)
          }}
        />
      )}
    </Modal>
  )
}

// The week-plan editor's activities header: how many, how long, and the
// COACH-2B structure sentence. Pulled out as a presentational view, no hooks,
// for the same reason TemplateActivityRow was: so the static suite can render
// the REAL editor surface rather than the summary component on its own. A test
// that renders ActivityStructureSummary directly proves the component works
// and says nothing about whether this editor uses it.
export function TemplateActivitiesHeader({ activities }: { activities: readonly Activity[] }) {
  return (
    <>
      <div className="row" style={{ gap: 8, marginBottom: 8 }}>
        <span className="role-badge" style={{ fontSize: 12 }}>
          {activities.length} activities
        </span>
        <span className="pill">
          <Icon.clock />
          {sessionMinutes({ activities: [...activities] })} min
        </span>
      </div>
      {/* The same sentence the dated-session planner shows, from the same pure
          composer, so a week plan and the session started from it cannot
          describe their structure differently. */}
      <div style={{ marginBottom: 8 }}>
        <ActivityStructureSummary activities={activities} />
      </div>
    </>
  )
}
