import { useMemo, useState } from 'react'
import { Chip, Empty, Loading, Modal, MediaThumb } from './ui'
import { Icon } from './icons'
import { useDrills, useMediaMap } from '../lib/queries'
import { CORNERS } from '../lib/data'
import type { Activity } from '../lib/data'
import {
  applyDrillFilter,
  clearedRefinements,
  countRefinements,
  DEFAULT_DRILL_FILTER,
  drillFilterOptions,
} from '../lib/drillFilter'
import type { DrillFilter } from '../lib/drillFilter'
import { hiddenSelectedCount, pickerEmptyState, selectedActivities, selectedCount } from '../lib/drillPicker'
import type { LibrarySort } from '../lib/contentOrder'
import './AddDrillModal.css'

// Test seam. The modal owns real state and there is no DOM under test, so
// the static renderer opens it in a given state through `initial`, the way
// a default value opens an uncontrolled input. Production callers pass
// nothing.
export interface AddDrillModalInitial {
  filter?: Partial<DrillFilter>
  picked?: Record<string, boolean>
  refineOpen?: boolean
}

// Browse the library and pick drills for the session. The filtering is the
// Drill Library's, through the one shared implementation in lib/drillFilter;
// the selection is a set of ids independent of what the filter shows, so
// narrowing the list never unselects a drill (lib/drillPicker).
export function AddDrillModal({
  onClose,
  onAdd,
  initial,
}: {
  onClose: () => void
  onAdd: (items: Activity[]) => void
  initial?: AddDrillModalInitial
}) {
  const [filter, setFilter] = useState<DrillFilter>({ ...DEFAULT_DRILL_FILTER, ...initial?.filter })
  const [picked, setPicked] = useState<Record<string, boolean>>(initial?.picked ?? {})
  const [refineOpen, setRefineOpen] = useState(initial?.refineOpen ?? false)
  const { data: drills = [], isLoading } = useDrills()
  const mediaById = useMediaMap()

  const set = (patch: Partial<DrillFilter>) => setFilter((f) => ({ ...f, ...patch }))
  const { results } = useMemo(() => applyDrillFilter(drills, filter), [drills, filter])
  const options = useMemo(() => drillFilterOptions(drills), [drills])

  const count = selectedCount(drills, picked)
  const hidden = hiddenSelectedCount(drills, results, picked)
  const active = countRefinements(filter)
  // The corner has its own visible chips, so the collapsed Refine toggle
  // only advertises the filters it is hiding.
  const refineActive = active - (filter.corner ? 1 : 0)

  const confirm = () => onAdd(selectedActivities(drills, picked, filter.sort))

  const emptyState = pickerEmptyState(drills.length, results.length)

  return (
    <Modal
      title="Add from library"
      sub="Select drills to drop into your session"
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!count} onClick={confirm}>
            <Icon.plus />
            Add {count || ''} drill{count !== 1 ? 's' : ''}
          </button>
        </>
      }
    >
      <div className="add-drill-controls">
        <div className="filter-row">
          <div className="search-lg">
            <Icon.search />
            <input
              placeholder="Search drills, skills or tags…"
              value={filter.q}
              onChange={(e) => set({ q: e.target.value })}
              autoFocus
            />
          </div>
          <select
            className="select"
            aria-label="Sort drills"
            value={filter.sort}
            onChange={(e) => set({ sort: e.target.value as LibrarySort })}
          >
            <option value="recent">Sort: Recent</option>
            <option value="az">Sort: A–Z</option>
            <option value="duration">Sort: Shortest</option>
          </select>
        </div>

        <div className="filter-row">
          {Object.values(CORNERS).map((c) => (
            <Chip
              key={c.key}
              on={filter.corner === c.key}
              dot={c.color}
              onClick={() => set({ corner: filter.corner === c.key ? null : c.key })}
            >
              {c.label}
            </Chip>
          ))}
        </div>

        <div className="filter-row">
          <Chip on={refineOpen} icon={Icon.filter} onClick={() => setRefineOpen((o) => !o)}>
            Refine{refineActive > 0 ? ` (${refineActive})` : ''}
          </Chip>
          {active > 0 && (
            <button className="btn btn-quiet btn-sm" onClick={() => setFilter(clearedRefinements)}>
              <Icon.x />
              Clear ({active})
            </button>
          )}
        </div>

        {refineOpen && (
          <div className="filter-row">
            <select className="select" aria-label="Age" value={filter.age} onChange={(e) => set({ age: e.target.value })}>
              <option value="">All ages</option>
              {options.ages.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
            <select
              className="select"
              aria-label="Skill"
              value={filter.skill}
              onChange={(e) => set({ skill: e.target.value })}
            >
              <option value="">All skills</option>
              {options.skills.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <select
              className="select"
              aria-label="Theme"
              value={filter.theme}
              onChange={(e) => set({ theme: e.target.value })}
            >
              <option value="">All themes</option>
              {options.themes.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <select
              className="select"
              aria-label="Format"
              value={filter.format}
              onChange={(e) => set({ format: e.target.value })}
            >
              <option value="">All formats</option>
              {options.formats.map((fmt) => (
                <option key={fmt} value={fmt}>
                  {fmt}
                </option>
              ))}
            </select>
            <select
              className="select"
              aria-label="Level"
              value={filter.level}
              onChange={(e) => set({ level: e.target.value })}
            >
              <option value="">All levels</option>
              {options.levels.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {isLoading ? (
        <Loading />
      ) : (
        <>
          {count > 0 && (
            <div className="muted add-drill-status">
              {count} selected
              {hidden > 0 ? ` · ${hidden} hidden by filters` : ''}
            </div>
          )}
          {emptyState === 'empty-library' ? (
            <Empty icon={Icon.book} title="The library is empty">
              Add drills in the Drill Library first, then build your session here.
            </Empty>
          ) : emptyState === 'no-match' ? (
            <Empty icon={Icon.search} title="No drills match">
              <div style={{ marginBottom: 10 }}>Try clearing a filter or searching something broader.</div>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setFilter((f) => ({ ...clearedRefinements(f), q: '' }))}
              >
                <Icon.x />
                Clear search and filters
              </button>
            </Empty>
          ) : (
            <div className="add-drill-grid">
              {results.map((d) => {
                const media = d.mediaId ? mediaById[d.mediaId] : undefined
                const on = !!picked[d.id]
                return (
                  <button
                    key={d.id}
                    className={'add-drill-row' + (on ? ' on' : '')}
                    aria-pressed={on}
                    onClick={() => setPicked((p) => ({ ...p, [d.id]: !p[d.id] }))}
                  >
                    <div className="add-drill-thumb">
                      <MediaThumb media={media} showPlay={false} showBadge={false} label="" />
                    </div>
                    <div className="add-drill-main">
                      <div className="add-drill-title">{d.title}</div>
                      <div className="muted add-drill-meta">
                        {d.skill ? `${d.skill} · ` : ''}
                        {d.duration}m
                      </div>
                    </div>
                    <span className="add-drill-tick">{on && <Icon.check style={{ width: 14, height: 14 }} />}</span>
                  </button>
                )
              })}
            </div>
          )}
        </>
      )}
    </Modal>
  )
}
