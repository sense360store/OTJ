// Create and edit a drill. One modal serves both: pass a drill to prefill and
// update, omit it to insert. The fields mirror what the seeded drills carry.
// The list inputs (equipment, points, tags) are plain chip editors; ages
// toggle against the fixed age taxonomy. The media picker lists the club's
// media with thumbnails and allows none.
import { useState } from 'react'
import type { KeyboardEvent } from 'react'
import { Icon } from './icons'
import { Chip, Loading, MediaThumb, MEDIA_META, Modal } from './ui'
import { useInsertDrill, useMedia, useUpdateDrill } from '../lib/queries'
import type { DrillInput } from '../lib/queries'
import { AGES, CORNERS, LEVELS, SKILLS } from '../lib/data'
import type { CornerKey, Drill, Level } from '../lib/data'

// Comma or enter adds a chip; points are sentences, so they split on enter
// only and render as a numbered list.
function ListInput({
  value,
  onChange,
  placeholder,
  numbered,
}: {
  value: string[]
  onChange: (v: string[]) => void
  placeholder: string
  numbered?: boolean
}) {
  const [draft, setDraft] = useState('')
  const commit = (text: string) => {
    const parts = numbered ? [text] : text.split(',')
    const items = parts.map((s) => s.trim()).filter((s) => s && !value.includes(s))
    if (items.length) onChange([...value, ...items])
    setDraft('')
  }
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || (!numbered && e.key === ',')) {
      e.preventDefault()
      commit(draft)
    }
  }
  const remove = (i: number) => onChange(value.filter((_, j) => j !== i))
  return (
    <div>
      {value.length > 0 &&
        (numbered ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
            {value.map((v, i) => (
              <div key={i} className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
                <span className="cp-num">{i + 1}</span>
                <span style={{ flex: 1, fontSize: 14, lineHeight: 1.45 }}>{v}</span>
                <button className="icon-btn" style={{ width: 26, height: 26 }} aria-label="Remove" onClick={() => remove(i)}>
                  <Icon.x style={{ width: 13, height: 13 }} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="row wrap" style={{ gap: 6, marginBottom: 8 }}>
            {value.map((v, i) => (
              <span key={i} className="pill">
                {v}
                <button
                  aria-label={'Remove ' + v}
                  onClick={() => remove(i)}
                  style={{ display: 'inline-flex', border: 0, background: 'none', cursor: 'pointer', color: 'inherit', padding: 0 }}
                >
                  <Icon.x style={{ width: 12, height: 12 }} />
                </button>
              </span>
            ))}
          </div>
        ))}
      <input
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKey}
        onBlur={() => draft.trim() && commit(draft)}
      />
    </div>
  )
}

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
    skill: drill?.skill || SKILLS[0],
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
  // A drill edited from before the skill taxonomy stays selectable.
  const skills = form.skill && !SKILLS.includes(form.skill) ? [form.skill, ...SKILLS] : SKILLS

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
        <label>Equipment</label>
        <ListInput value={form.equipment} onChange={(v) => set('equipment', v)} placeholder="Type and press enter to add" />
      </div>
      <div className="field">
        <label>Coaching points</label>
        <ListInput value={form.points} onChange={(v) => set('points', v)} placeholder="Type a point and press enter" numbered />
      </div>
      <div className="field">
        <label>Tags</label>
        <ListInput value={form.tags} onChange={(v) => set('tags', v)} placeholder="Type and press enter to add" />
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
