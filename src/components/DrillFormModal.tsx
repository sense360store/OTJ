// Create and edit a drill. One modal serves both: pass a drill to prefill and
// update, omit it to insert. The fields mirror what the seeded drills carry
// plus the FA session model fields (setup notes, STEP adaptations, theme,
// format, source link). The list inputs are plain chip editors; ages toggle
// against the fixed age taxonomy. The media picker lists the club's media
// with thumbnails and allows none.
import { useState } from 'react'
import { Icon } from './icons'
import { Chip, ListInput, Loading, MediaThumb, MEDIA_META, Modal } from './ui'
import { useInsertDrill, useMedia, useUpdateDrill } from '../lib/queries'
import type { DrillInput } from '../lib/queries'
import { AGES, CORNERS, LEVELS } from '../lib/data'
import type { CornerKey, Drill, Level } from '../lib/data'
import { FA_FORMATS, FA_PLAYER_SKILLS, FA_THEMES, withExistingValues } from '../lib/fa'

// The club's media with thumbnails. One tile per item plus a none tile; the
// selection sets mediaId or clears it.
function MediaPicker({ value, onChange }: { value: string | null; onChange: (id: string | null) => void }) {
  const { data: media = [], isLoading } = useMedia()
  if (isLoading) return <Loading label="Loading media…" />
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
  })
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
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
        <div style={{ fontWeight: 700, fontSize: 13.5 }}>No media</div>
      </button>
      {media.map((m) => {
        const on = value === m.id
        return (
          <button type="button" key={m.id} style={tile(on)} onClick={() => onChange(on ? null : m.id)}>
            <div style={{ width: 58, height: 40, borderRadius: 8, overflow: 'hidden', flex: '0 0 58px' }}>
              <MediaThumb media={m} showPlay={false} showBadge={false} label="" />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 13.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {m.name}
              </div>
              <div className="muted" style={{ fontSize: 12 }}>
                {MEDIA_META[m.type].label}
              </div>
            </div>
          </button>
        )
      })}
    </div>
  )
}

function fromDrill(drill?: Drill): DrillInput {
  return {
    title: drill?.title ?? '',
    summary: drill?.summary ?? '',
    corner: drill?.corner ?? 'technical',
    skill: drill?.skill || 'Passing',
    level: drill?.level ?? 'Foundation',
    ages: drill?.ages ?? [],
    duration: drill?.duration || 10,
    players: drill?.players ?? '',
    area: drill?.area ?? '',
    equipment: drill?.equipment ?? [],
    points: drill?.points ?? [],
    tags: drill?.tags ?? [],
    mediaId: drill?.mediaId ?? null,
    setupNotes: drill?.setupNotes ?? '',
    easier: drill?.easier ?? [],
    harder: drill?.harder ?? [],
    theme: drill?.theme ?? '',
    format: drill?.format ?? '',
    sourceUrl: drill?.sourceUrl ?? '',
  }
}

export function DrillFormModal({ drill, onClose }: { drill?: Drill; onClose: () => void }) {
  const insert = useInsertDrill()
  const update = useUpdateDrill()
  const [form, setForm] = useState<DrillInput>(() => fromDrill(drill))
  const [error, setError] = useState<string | null>(null)
  const pending = insert.isPending || update.isPending
  const set = <K extends keyof DrillInput>(k: K, v: DrillInput[K]) => setForm((f) => ({ ...f, [k]: v }))
  const toggleAge = (a: string) =>
    set('ages', form.ages.includes(a) ? form.ages.filter((x) => x !== a) : AGES.filter((x) => [...form.ages, a].includes(x)))
  // The selects offer the FA taxonomy; a stored value outside it (a drill
  // from before the FA alignment, or free text) stays selectable.
  const skills = withExistingValues(FA_PLAYER_SKILLS, [form.skill])
  const themes = withExistingValues(FA_THEMES, [form.theme])
  const formats = withExistingValues(FA_FORMATS, [form.format])

  const submit = () => {
    setError(null)
    const input = { ...form, title: form.title.trim() }
    const opts = { onSuccess: onClose, onError: (e: Error) => setError(e.message) }
    if (drill) update.mutate({ id: drill.id, input }, opts)
    else insert.mutate(input, opts)
  }

  return (
    <Modal
      title={drill ? 'Edit drill' : 'Add drill'}
      sub={drill ? drill.title : 'Add a drill to the club library.'}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={pending}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={!form.title.trim() || pending}>
            <Icon.check />
            {pending ? 'Saving…' : drill ? 'Save changes' : 'Add drill'}
          </button>
        </>
      }
    >
      <div className="field">
        <label>Title</label>
        <input value={form.title} placeholder="Drill name" onChange={(e) => set('title', e.target.value)} autoFocus />
      </div>
      <div className="field">
        <label>Summary</label>
        <textarea
          value={form.summary}
          rows={2}
          placeholder="What the drill is and what it works on"
          onChange={(e) => set('summary', e.target.value)}
        />
      </div>
      <div className="field">
        <label>Corner</label>
        <div className="row wrap" style={{ gap: 8 }}>
          {Object.values(CORNERS).map((c) => (
            <Chip key={c.key} on={form.corner === c.key} dot={c.color} onClick={() => set('corner', c.key as CornerKey)}>
              {c.label}
            </Chip>
          ))}
        </div>
      </div>
      <div className="row" style={{ gap: 10 }}>
        <div className="field" style={{ flex: 1 }}>
          <label>Skill</label>
          <select value={form.skill} onChange={(e) => set('skill', e.target.value)}>
            {skills.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>Level</label>
          <select value={form.level} onChange={(e) => set('level', e.target.value as Level)}>
            {LEVELS.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="row" style={{ gap: 10 }}>
        <div className="field" style={{ flex: 1 }}>
          <label>Theme</label>
          <select value={form.theme} onChange={(e) => set('theme', e.target.value)}>
            <option value="">None</option>
            {themes.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>Format</label>
          <select value={form.format} onChange={(e) => set('format', e.target.value)}>
            <option value="">None</option>
            {formats.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="field">
        <label>Ages</label>
        <div className="row wrap" style={{ gap: 8 }}>
          {AGES.map((a) => (
            <Chip key={a} on={form.ages.includes(a)} onClick={() => toggleAge(a)}>
              {a}
            </Chip>
          ))}
        </div>
      </div>
      <div className="row" style={{ gap: 10 }}>
        <div className="field" style={{ width: 110 }}>
          <label>Duration (min)</label>
          <input
            type="number"
            min={1}
            max={90}
            value={form.duration}
            onChange={(e) => set('duration', parseInt(e.target.value) || 0)}
          />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>Players</label>
          <input value={form.players} placeholder="e.g. 3–6 per group" onChange={(e) => set('players', e.target.value)} />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>Area</label>
          <input value={form.area} placeholder="e.g. 20 × 20 yd" onChange={(e) => set('area', e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label>Setup notes</label>
        <textarea
          value={form.setupNotes}
          rows={2}
          placeholder="How to lay the area out before players arrive"
          onChange={(e) => set('setupNotes', e.target.value)}
        />
      </div>
      <div className="field">
        <label>Equipment</label>
        <ListInput value={form.equipment} onChange={(v) => set('equipment', v)} placeholder="Type and press enter to add" />
      </div>
      <div className="field">
        <label>Coaching points</label>
        <ListInput value={form.points} onChange={(v) => set('points', v)} placeholder="Type a point and press enter" numbered />
      </div>
      <div className="field">
        <label>Make it easier</label>
        <ListInput
          value={form.easier}
          onChange={(v) => set('easier', v)}
          placeholder="Type an adaptation and press enter"
          numbered
        />
      </div>
      <div className="field">
        <label>Make it harder</label>
        <ListInput
          value={form.harder}
          onChange={(v) => set('harder', v)}
          placeholder="Type an adaptation and press enter"
          numbered
        />
      </div>
      <div className="field">
        <label>Tags</label>
        <ListInput value={form.tags} onChange={(v) => set('tags', v)} placeholder="Type and press enter to add" />
      </div>
      <div className="field">
        <label>Source link</label>
        <input
          type="url"
          value={form.sourceUrl}
          placeholder="https://… where this drill came from, shown with attribution"
          onChange={(e) => set('sourceUrl', e.target.value)}
        />
      </div>
      <div className="field" style={{ marginBottom: 0 }}>
        <label>Media</label>
        <MediaPicker value={form.mediaId} onChange={(id) => set('mediaId', id)} />
      </div>
      {error && (
        <p className="muted" style={{ color: 'var(--m-pdf)', fontSize: 13.5, marginTop: 10 }}>
          {error}
        </p>
      )}
    </Modal>
  )
}
