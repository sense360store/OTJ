// Admin: the managed filter taxonomies (filter_options), kind by kind. Add a
// value, rename it, retire it (it drops out of pickers and filter rows while
// existing content keeps its stored text), restore it, and reorder. In-use
// counts are computed from drills client side. Corners and levels are
// structural and stay fixed in code. The 0010 RLS (filters.manage) is the
// real enforcement. REVIEW: role gated admin surface.
import { useState } from 'react'
import { useAddFilterOption, useDrills, useFilterOptions, useUpdateFilterOption } from '../lib/queries'
import { FILTER_KINDS } from '../lib/data'
import type { Drill, FilterKind, FilterOption } from '../lib/data'
import { agesOverlap } from '../lib/roleFilters'
import { Icon } from '../components/icons'
import { ErrorNote, Loading } from '../components/ui'

// How many drills use a value. coach_skill has no drill field, so it shows
// no count; age bands match the drill age lists tolerantly (U8 sits inside
// 5-11), the rest are the exact field matches the library filters use.
function usedInDrills(kind: FilterKind, value: string, drills: Drill[]): number | null {
  switch (kind) {
    case 'theme':
      return drills.filter((d) => d.theme === value).length
    case 'player_skill':
      return drills.filter((d) => d.skill === value).length
    case 'format':
      return drills.filter((d) => d.format === value).length
    case 'age_band':
      return drills.filter((d) => d.ages.some((a) => agesOverlap(value, a))).length
    case 'coach_skill':
      return null
  }
}

function OptionRow({
  option,
  drills,
  onMove,
  isFirst,
  isLast,
}: {
  option: FilterOption
  drills: Drill[]
  onMove: (dir: -1 | 1) => void
  isFirst: boolean
  isLast: boolean
}) {
  const update = useUpdateFilterOption()
  const [draft, setDraft] = useState(option.value)
  const changed = draft.trim() !== option.value && draft.trim() !== ''
  const used = usedInDrills(option.kind, option.value, drills)
  return (
    <div
      className="row"
      style={{ gap: 8, padding: '8px 0', borderTop: '1px solid var(--line)', opacity: option.active ? 1 : 0.55 }}
    >
      <div className="row" style={{ gap: 2 }}>
        <button
          className="icon-btn"
          style={{ width: 26, height: 26 }}
          aria-label={'Move ' + option.value + ' up'}
          disabled={isFirst || update.isPending}
          onClick={() => onMove(-1)}
        >
          <Icon.chevDown style={{ width: 13, height: 13, transform: 'rotate(180deg)' }} />
        </button>
        <button
          className="icon-btn"
          style={{ width: 26, height: 26 }}
          aria-label={'Move ' + option.value + ' down'}
          disabled={isLast || update.isPending}
          onClick={() => onMove(1)}
        >
          <Icon.chevDown style={{ width: 13, height: 13 }} />
        </button>
      </div>
      <div className="field" style={{ flex: 1, marginBottom: 0, minWidth: 140 }}>
        <input value={draft} onChange={(e) => setDraft(e.target.value)} disabled={!option.active} />
      </div>
      <button
        className="btn btn-ghost btn-sm"
        disabled={!changed || !option.active || update.isPending}
        onClick={() => update.mutate({ id: option.id, value: draft.trim() })}
      >
        <Icon.check />
        Rename
      </button>
      {used !== null && (
        <span className="pill" title="Drills using this value" style={{ minWidth: 76, justifyContent: 'center' }}>
          {used} drill{used !== 1 ? 's' : ''}
        </span>
      )}
      {option.active ? (
        <button
          className="btn btn-ghost btn-sm"
          title="Retired values drop out of pickers and filters; existing content keeps its text."
          disabled={update.isPending}
          onClick={() => update.mutate({ id: option.id, active: false })}
        >
          <Icon.eye />
          Retire
        </button>
      ) : (
        <button
          className="btn btn-ghost btn-sm"
          disabled={update.isPending}
          onClick={() => update.mutate({ id: option.id, active: true })}
        >
          <Icon.rotate />
          Restore
        </button>
      )}
    </div>
  )
}

function KindCard({ kind, label, options, drills }: { kind: FilterKind; label: string; options: FilterOption[]; drills: Drill[] }) {
  const add = useAddFilterOption()
  const update = useUpdateFilterOption()
  const [name, setName] = useState('')
  const maxSort = options.reduce((a, o) => Math.max(a, o.sort), -1)
  const submit = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    add.mutate({ kind, value: trimmed, sort: maxSort + 1 }, { onSuccess: () => setName('') })
  }
  // Reorder swaps the sort of two neighbours; the list is already in sort
  // order, so the swap is what the arrows mean visually.
  const move = (index: number, dir: -1 | 1) => {
    const a = options[index]
    const b = options[index + dir]
    if (!a || !b) return
    update.mutate({ id: a.id, sort: b.sort })
    update.mutate({ id: b.id, sort: a.sort })
  }
  return (
    <div className="card" style={{ padding: 18 }}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
        <h3 style={{ fontSize: 17 }}>{label}</h3>
        <span className="pill">{options.filter((o) => o.active).length} active</span>
      </div>
      <div className="row" style={{ gap: 8 }}>
        <div className="field" style={{ flex: 1, marginBottom: 0 }}>
          <input
            placeholder={'Add a value to ' + label.toLowerCase()}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
        </div>
        <button className="btn btn-primary btn-sm" style={{ height: 40 }} disabled={!name.trim() || add.isPending} onClick={submit}>
          <Icon.plus />
          Add
        </button>
      </div>
      {add.isError && (
        <p className="muted" style={{ fontSize: 12.5, color: 'var(--m-pdf)', marginTop: 6, marginBottom: 0 }}>
          Could not add the value. It may already exist.
        </p>
      )}
      <div style={{ marginTop: 10 }}>
        {options.map((o, i) => (
          <OptionRow
            key={o.id}
            option={o}
            drills={drills}
            isFirst={i === 0}
            isLast={i === options.length - 1}
            onMove={(dir) => move(i, dir)}
          />
        ))}
        {options.length === 0 && (
          <p className="muted" style={{ fontSize: 13.5 }}>
            No values yet. Add the first one above.
          </p>
        )}
      </div>
    </div>
  )
}

export function AdminFilters() {
  const { data: options = [], isLoading, isError } = useFilterOptions()
  const { data: drills = [] } = useDrills()
  if (isLoading) return <Loading />
  if (isError) return <ErrorNote />
  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Filters</h2>
          <div className="sub">
            The value lists behind the pickers and filter rows: themes, skills, formats and age bands.
          </div>
        </div>
      </div>
      <div className="card" style={{ padding: '14px 18px', marginBottom: 18 }}>
        <p className="muted" style={{ fontSize: 13, lineHeight: 1.5, margin: 0 }}>
          The four corners and the three levels are structural and stay fixed: screens, colours and the data model
          lean on them. Everything here is data and yours to shape. Retiring a value hides it from pickers and filter
          rows; drills that already carry the text keep it.
        </p>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))', gap: 18 }}>
        {FILTER_KINDS.map((k) => (
          <KindCard
            key={k.kind}
            kind={k.kind}
            label={k.label}
            drills={drills}
            options={options.filter((o) => o.kind === k.kind)}
          />
        ))}
      </div>
    </div>
  )
}
