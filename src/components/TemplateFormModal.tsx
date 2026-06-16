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
import { ListInput, Modal, PHASE_COLOR } from './ui'
import { AddDrillModal } from './AddDrillModal'
import { useActivityTitle, useDrillMap, useInsertTemplate, useUpdateTemplate } from '../lib/queries'
import type { TemplateInput } from '../lib/queries'
import { PHASES, sessionMinutes } from '../lib/data'
import type { Activity, Phase, Template } from '../lib/data'

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
  const mins = sessionMinutes({ activities: form.activities })

  const set = <K extends keyof TemplateInput>(k: K, v: TemplateInput[K]) => setForm((f) => ({ ...f, [k]: v }))
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
        <div className="row" style={{ gap: 8, marginBottom: 8 }}>
          <span className="role-badge" style={{ fontSize: 12 }}>
            {form.activities.length} activities
          </span>
          <span className="pill">
            <Icon.clock />
            {mins} min
          </span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {form.activities.map((a, i) => {
            const drill = a.drillId ? drillById[a.drillId] : null
            return (
              <TemplateActivityRow
                key={i}
                activity={a}
                title={actTitle(a)}
                skill={drill?.skill ?? null}
                index={i}
                count={form.activities.length}
                onPhase={(phase) => setAct(i, { phase })}
                onDuration={(duration) => setAct(i, { duration })}
                onMove={(dir) => move(i, dir)}
                onRemove={() => removeAct(i)}
              />
            )
          })}
        </div>
        <div className="row" style={{ gap: 10, marginTop: 8 }}>
          <button className="add-slot" style={{ marginBottom: 0 }} onClick={() => setAdding(true)}>
            <Icon.plus />
            Add from library
          </button>
          <button
            className="add-slot"
            style={{ marginBottom: 0 }}
            onClick={() => set('activities', [...form.activities, { phase: 'Skill', title: 'Custom activity', duration: 10 }])}
          >
            <Icon.edit />
            Add custom
          </button>
        </div>
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
      {error && (
        <p className="muted" style={{ color: 'var(--m-pdf)', fontSize: 13.5 }}>
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

// One activity row in the editor. The title takes the available row width while
// the phase, duration and controls size to their content (the act-edit layout),
// which keeps a long FA drill title legible instead of collapsing to a sliver
// that wraps a letter per line. Pulled out as a presentational row, no hooks,
// so the static suite can pin the layout; the screen resolves the drill and
// passes its title and skill in.
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
}) {
  return (
    <div className="act-card act-edit" style={{ marginBottom: 0 }}>
      <span className="tag-dot" style={{ background: PHASE_COLOR[activity.phase], width: 10, height: 10 }}></span>
      <div className="ac-body">
        <h4>{title}</h4>
        <div className="ac-sub">{skill && <span>{skill}</span>}</div>
      </div>
      <select
        value={activity.phase}
        onChange={(e) => onPhase(e.target.value as Phase)}
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
      <div className="row" style={{ gap: 4 }}>
        <input
          type="number"
          value={activity.duration}
          min="1"
          max="90"
          onChange={(e) => onDuration(parseInt(e.target.value) || 0)}
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
      <button className="act-x" aria-label="Remove activity" onClick={onRemove}>
        <Icon.trash />
      </button>
    </div>
  )
}
