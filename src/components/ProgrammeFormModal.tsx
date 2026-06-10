// Create and edit a programme by hand: the manual route, covering any
// programme that exists only as a PDF or in a coach's head. One modal serves
// both; pass a programme (and its current week templates) to prefill and
// update, omit them to create.
//
// Assigning a template to a week offers two routes. Add a copy inserts a
// duplicate owned by the programme, open to every coaching role through the
// templates insert policy. Attach the original repoints the existing
// template, which is a templates update and therefore curation: the RLS
// reserves it for admins, so only admins see it, and only admins can move or
// remove a week that is already saved. The programmes RLS (owner, or admin)
// governs the programme row itself; the screens only decide what to surface.
import { useState } from 'react'
import { Icon } from './icons'
import { ListInput, Loading, MediaThumb, Modal } from './ui'
import {
  useAssignTemplateWeek,
  useCopyTemplateToWeek,
  useInsertProgramme,
  useMedia,
  useTemplates,
  useUpdateProgramme,
} from '../lib/queries'
import type { ProgrammeInput } from '../lib/queries'
import { useAuth } from '../hooks/useAuth'
import { sessionMinutes } from '../lib/data'
import type { Programme, Template } from '../lib/data'

const MAX_WEEKS = 12

interface WeekSlot {
  template: Template
  // existing rows are already saved against this programme; attach repoints
  // the original on save (admin only); copy inserts a duplicate on save.
  mode: 'existing' | 'attach' | 'copy'
}

function fromProgramme(programme?: Programme): ProgrammeInput {
  return {
    name: programme?.name ?? '',
    focus: programme?.focus ?? '',
    summary: programme?.summary ?? '',
    intentions: programme?.intentions ?? [],
    weeks: programme?.weeks ?? 6,
    pdfMediaId: programme?.pdfMediaId ?? null,
    sourceUrl: programme?.sourceUrl ?? '',
  }
}

// The attached PDF comes from the media library (an uploaded copy of a
// downloaded FA PDF, or the club's own), so it rides the existing storage
// and signed URL paths. Only PDF items are offered, plus none.
function PdfPicker({ value, onChange }: { value: string | null; onChange: (id: string | null) => void }) {
  const { data: media = [], isLoading } = useMedia()
  if (isLoading) return <Loading label="Loading media…" />
  const pdfs = media.filter((m) => m.type === 'pdf')
  const tile = (on: boolean) => ({
    display: 'flex',
    gap: 10,
    alignItems: 'center',
    textAlign: 'left' as const,
    padding: 8,
    borderRadius: 12,
    border: '1.5px solid ' + (on ? 'var(--navy)' : 'var(--line)'),
    background: on ? 'color-mix(in srgb, var(--navy) 5%, var(--card))' : 'var(--card)',
    cursor: 'pointer',
    minHeight: 44,
  })
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(210px,1fr))', gap: 8 }}>
      <button type="button" style={tile(value === null)} onClick={() => onChange(null)}>
        <div
          style={{
            width: 58,
            height: 40,
            borderRadius: 8,
            flex: '0 0 58px',
            display: 'grid',
            placeItems: 'center',
            border: '1px dashed var(--line)',
            color: 'var(--slate-2)',
          }}
        >
          <Icon.x style={{ width: 16, height: 16 }} />
        </div>
        <div style={{ fontWeight: 700, fontSize: 13.5 }}>No PDF</div>
      </button>
      {pdfs.map((m) => {
        const on = value === m.id
        return (
          <button type="button" key={m.id} style={tile(on)} onClick={() => onChange(on ? null : m.id)}>
            <div style={{ width: 58, height: 40, borderRadius: 8, overflow: 'hidden', flex: '0 0 58px' }}>
              <MediaThumb media={m} showPlay={false} showBadge={false} label="" />
            </div>
            <div
              style={{ fontWeight: 700, fontSize: 13.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
            >
              {m.name}
            </div>
          </button>
        )
      })}
      {pdfs.length === 0 && (
        <p className="muted" style={{ fontSize: 12.5, margin: 0, alignSelf: 'center' }}>
          No PDFs in the media library yet. Upload one there first.
        </p>
      )}
    </div>
  )
}

// Pick a template for a week. Attach the original is curation (admin, and
// only for templates not already in a programme); a copy is open to every
// coaching role and leaves the original untouched.
function TemplatePicker({
  onPick,
  onClose,
  usedIds,
}: {
  onPick: (t: Template, mode: 'attach' | 'copy') => void
  onClose: () => void
  usedIds: Set<string>
}) {
  const { role } = useAuth()
  const { data: templates = [], isLoading } = useTemplates()
  const [q, setQ] = useState('')
  const admin = role === 'admin'
  if (isLoading) return <Loading label="Loading templates…" />
  const list = templates.filter(
    (t) => !usedIds.has(t.id) && (!q || t.name.toLowerCase().includes(q.toLowerCase())),
  )
  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 10, background: 'var(--bg-2)' }}>
      <div className="row" style={{ gap: 8, marginBottom: 8 }}>
        <input placeholder="Search templates…" value={q} autoFocus onChange={(e) => setQ(e.target.value)} style={{ flex: 1 }} />
        <button className="btn btn-ghost btn-sm" onClick={onClose}>
          Cancel
        </button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 260, overflow: 'auto' }}>
        {list.length === 0 && (
          <p className="muted" style={{ fontSize: 13, margin: '6px 2px' }}>
            No templates match.
          </p>
        )}
        {list.map((t) => (
          <div
            key={t.id}
            className="row"
            style={{ gap: 8, padding: '8px 10px', borderRadius: 10, background: 'var(--card)', border: '1px solid var(--line)' }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {t.name}
              </div>
              <div className="muted" style={{ fontSize: 12 }}>
                {t.activities.length} activities · {sessionMinutes({ activities: t.activities })} min
                {t.programmeId ? ' · in a programme' : ''}
              </div>
            </div>
            {admin && !t.programmeId && (
              <button className="btn btn-ghost btn-sm" onClick={() => onPick(t, 'attach')}>
                Attach
              </button>
            )}
            <button className="btn btn-primary btn-sm" onClick={() => onPick(t, 'copy')}>
              Add a copy
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

export function ProgrammeFormModal({
  programme,
  weekTemplates,
  onClose,
  onSaved,
}: {
  programme?: Programme
  weekTemplates?: Record<number, Template>
  onClose: () => void
  onSaved?: (id: string) => void
}) {
  const { role } = useAuth()
  const admin = role === 'admin'
  const insert = useInsertProgramme()
  const update = useUpdateProgramme()
  const assign = useAssignTemplateWeek()
  const copy = useCopyTemplateToWeek()

  const [form, setForm] = useState<ProgrammeInput>(() => fromProgramme(programme))
  const [slots, setSlots] = useState<(WeekSlot | null)[]>(() => {
    const assigned = weekTemplates ?? {}
    const highest = Math.max(programme?.weeks ?? 6, ...Object.keys(assigned).map(Number), 1)
    return Array.from({ length: highest }, (_, i) => {
      const t = assigned[i + 1]
      return t ? { template: t, mode: 'existing' as const } : null
    })
  })
  const [pickerAt, setPickerAt] = useState<number | null>(null)
  const [removed, setRemoved] = useState<Template[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const set = <K extends keyof ProgrammeInput>(k: K, v: ProgrammeInput[K]) => setForm((f) => ({ ...f, [k]: v }))

  // A saved week only moves or clears through a templates update, so those
  // controls are admin only; everything still unsaved rearranges freely.
  const canTouch = (slot: WeekSlot | null) => !slot || slot.mode !== 'existing' || admin

  const setWeeks = (n: number) => {
    const wanted = Math.max(1, Math.min(MAX_WEEKS, Math.round(n) || 1))
    // Shrinking cannot silently drop a saved week a coach could not restore.
    const lastKept = slots.reduce((acc, s, i) => (s && !canTouch(s) ? i + 1 : acc), 0)
    const next = Math.max(wanted, lastKept)
    setSlots((old) => {
      if (next >= old.length) return [...old, ...Array.from({ length: next - old.length }, () => null)]
      const dropped = old.slice(next).filter((s): s is WeekSlot => !!s && s.mode === 'existing')
      if (dropped.length) setRemoved((r) => [...r, ...dropped.map((s) => s.template)])
      return old.slice(0, next)
    })
    set('weeks', next)
  }

  const clearSlot = (i: number) => {
    setSlots((old) => {
      const s = old[i]
      if (s?.mode === 'existing') setRemoved((r) => [...r, s.template])
      const next = [...old]
      next[i] = null
      return next
    })
  }

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= slots.length) return
    setSlots((old) => {
      const next = [...old]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }

  const pick = (i: number, t: Template, mode: 'attach' | 'copy') => {
    setSlots((old) => {
      const next = [...old]
      next[i] = { template: t, mode }
      return next
    })
    setPickerAt(null)
  }

  // Templates already attached (or about to be) cannot be picked again;
  // copies can repeat because each save inserts a fresh row.
  const usedIds = new Set(slots.filter((s): s is WeekSlot => !!s && s.mode !== 'copy').map((s) => s.template.id))

  const save = async () => {
    setError(null)
    if (!form.name.trim()) {
      setError('Give the programme a name.')
      return
    }
    setSaving(true)
    try {
      const input: ProgrammeInput = { ...form, name: form.name.trim(), weeks: slots.length }
      const saved = programme
        ? await update.mutateAsync({ id: programme.id, input })
        : await insert.mutateAsync(input)
      // Week writes run after the programme row exists. A failure here stops
      // the run and surfaces; whatever already landed is real and the caches
      // refetch, so reopening the builder shows the true state.
      for (const t of removed) {
        await assign.mutateAsync({ templateId: t.id, programmeId: null, week: null })
      }
      for (let i = 0; i < slots.length; i++) {
        const slot = slots[i]
        if (!slot) continue
        const week = i + 1
        if (slot.mode === 'copy') {
          await copy.mutateAsync({ template: slot.template, programmeId: saved.id, week })
        } else if (slot.mode === 'attach' || slot.template.programmeWeek !== week) {
          await assign.mutateAsync({ templateId: slot.template.id, programmeId: saved.id, week })
        }
      }
      onSaved?.(saved.id)
      onClose()
    } catch (e) {
      const message = e instanceof Error ? e.message : ''
      setError(
        message.includes('duplicate key')
          ? 'A programme with that name already exists.'
          : message || 'Could not save the programme. Try again.',
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title={programme ? 'Edit programme' : 'New programme'}
      sub="An ordered set of weekly sessions, the FA six-week format being the model."
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => void save()} disabled={saving}>
            <Icon.check />
            {saving ? 'Saving…' : programme ? 'Save changes' : 'Create programme'}
          </button>
        </>
      }
    >
      <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
        <div className="field" style={{ flex: 2, minWidth: 200 }}>
          <label>Name</label>
          <input value={form.name} autoFocus={!programme} onChange={(e) => set('name', e.target.value)} />
        </div>
        <div className="field" style={{ flex: 1, minWidth: 140 }}>
          <label>Focus</label>
          <input value={form.focus} placeholder="e.g. Moving with the ball" onChange={(e) => set('focus', e.target.value)} />
        </div>
        <div className="field" style={{ width: 96 }}>
          <label>Weeks</label>
          <input
            type="number"
            min={1}
            max={MAX_WEEKS}
            value={slots.length}
            onChange={(e) => setWeeks(parseInt(e.target.value, 10))}
          />
        </div>
      </div>
      <div className="field">
        <label>Summary</label>
        <textarea rows={2} value={form.summary} onChange={(e) => set('summary', e.target.value)} />
      </div>
      <div className="field">
        <label>Intentions</label>
        <ListInput
          value={form.intentions}
          onChange={(v) => set('intentions', v)}
          placeholder="Type an intention and press enter"
        />
      </div>

      <div className="field">
        <label>Weeks</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {slots.map((slot, i) => (
            <div key={i}>
              <div
                className="row"
                style={{ gap: 8, padding: '8px 10px', borderRadius: 12, border: '1px solid var(--line)', background: 'var(--card)' }}
              >
                <span className="role-badge" style={{ fontSize: 12, flex: '0 0 auto' }}>
                  Week {i + 1}
                </span>
                {slot ? (
                  <>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{ fontWeight: 700, fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      >
                        {slot.template.name}
                      </div>
                      <div className="muted" style={{ fontSize: 12 }}>
                        {slot.template.activities.length} activities · {sessionMinutes({ activities: slot.template.activities })} min
                        {slot.mode === 'attach' ? ' · attaches the original' : slot.mode === 'copy' ? ' · adds a copy' : ''}
                      </div>
                    </div>
                    <button
                      className="icon-btn"
                      style={{ width: 34, height: 34 }}
                      aria-label="Move up"
                      disabled={i === 0 || !canTouch(slot) || !canTouch(slots[i - 1])}
                      onClick={() => move(i, -1)}
                    >
                      <Icon.chevDown style={{ width: 15, height: 15, transform: 'rotate(180deg)' }} />
                    </button>
                    <button
                      className="icon-btn"
                      style={{ width: 34, height: 34 }}
                      aria-label="Move down"
                      disabled={i === slots.length - 1 || !canTouch(slot) || !canTouch(slots[i + 1])}
                      onClick={() => move(i, 1)}
                    >
                      <Icon.chevDown style={{ width: 15, height: 15 }} />
                    </button>
                    {canTouch(slot) && (
                      <button className="icon-btn" style={{ width: 34, height: 34 }} aria-label="Remove from week" onClick={() => clearSlot(i)}>
                        <Icon.x style={{ width: 15, height: 15 }} />
                      </button>
                    )}
                  </>
                ) : (
                  <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setPickerAt(pickerAt === i ? null : i)}>
                    <Icon.plus />
                    Choose template
                  </button>
                )}
              </div>
              {pickerAt === i && !slot && (
                <div style={{ marginTop: 6 }}>
                  <TemplatePicker usedIds={usedIds} onPick={(t, mode) => pick(i, t, mode)} onClose={() => setPickerAt(null)} />
                </div>
              )}
            </div>
          ))}
        </div>
        {!admin && slots.some((s) => s?.mode === 'existing') && (
          <p className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>
            Saved weeks are curated templates, so moving or removing them is for admins. You can fill empty weeks with copies.
          </p>
        )}
      </div>

      <div className="field">
        <label>Programme PDF</label>
        <PdfPicker value={form.pdfMediaId} onChange={(id) => set('pdfMediaId', id)} />
      </div>
      <div className="field">
        <label>Source link</label>
        <input
          type="url"
          value={form.sourceUrl}
          placeholder="https://… where this programme came from (optional)"
          onChange={(e) => set('sourceUrl', e.target.value)}
        />
      </div>
      {error && (
        <p className="muted" style={{ color: 'var(--m-pdf)', fontSize: 13.5 }}>
          {error}
        </p>
      )}
    </Modal>
  )
}
