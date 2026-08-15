import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useNav } from '../hooks/useNav'
import { useAuth } from '../hooks/useAuth'
import { useDrills, useMyCapabilities } from '../lib/queries'
import { CORNERS, FA_IMPORT_CAPS, hasAllCaps } from '../lib/data'
import type { CornerKey, Drill } from '../lib/data'
import {
  applyDrillFilter,
  clearedRefinements,
  countRefinements,
  DEFAULT_DRILL_FILTER,
  drillFilterOptions,
} from '../lib/drillFilter'
import type { DrillFilter } from '../lib/drillFilter'
import type { LibrarySort } from '../lib/contentOrder'
import { Icon } from '../components/icons'
import { Chip, DrillCard, Empty, ErrorNote, Loading } from '../components/ui'
import { DrillFormModal } from '../components/DrillFormModal'
import { DeleteDrillModal } from '../components/DeleteDrillModal'
import { ImportFAModal } from '../components/ImportFAModal'

export function Library() {
  const nav = useNav()
  const { user } = useAuth()
  const { caps } = useMyCapabilities()
  // The affordances follow the capability set, granting on any held role.
  // The FA import writes a template plus its drills and media, so it needs
  // every capability the call would use. The RLS is the real enforcement.
  const canCreate = caps.has('drills.create')
  const canPlan = caps.has('sessions.create')
  const canImport = hasAllCaps(caps, FA_IMPORT_CAPS)
  // Edit and delete on a card mirror the drills RLS arms: drills.manage on
  // any drill, an owner holding drills.create on their own. Seeded drills
  // have no creator, so only a manage holder touches them. The database is
  // the real enforcement; this only decides whether to surface the actions.
  const canManage = (d: Drill) =>
    caps.has('drills.manage') || (canCreate && !!d.createdBy && d.createdBy === user?.id)
  const [searchParams, setSearchParams] = useSearchParams()
  const presetCorner = searchParams.get('corner')
  const initialCorner = presetCorner && presetCorner in CORNERS ? (presetCorner as CornerKey) : null

  // One state object for the whole filter, the shape lib/drillFilter reads.
  // The rules themselves live there, shared with the planner's Add from
  // library so the two screens cannot drift apart.
  const [filter, setFilter] = useState<DrillFilter>({ ...DEFAULT_DRILL_FILTER, corner: initialCorner })
  const set = (patch: Partial<DrillFilter>) => setFilter((f) => ({ ...f, ...patch }))
  const [addOpen, setAddOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [editing, setEditing] = useState<Drill | null>(null)
  const [deleting, setDeleting] = useState<Drill | null>(null)
  const { data: drills = [], isLoading, isError } = useDrills()

  // Apply the corner preset from the URL once, then clear it.
  useEffect(() => {
    if (searchParams.get('corner')) setSearchParams({}, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The filter options are the FA taxonomy plus any values already stored on
  // drills, so existing values keep appearing (lib/drillFilter).
  const options = useMemo(() => drillFilterOptions(drills), [drills])

  // One pass applies every refinement except the corner, which yields both
  // the visible results and the corner distribution. The distribution stays
  // filter-aware but ignores the corner filter itself, so the strip remains a
  // way to pick a corner. It moved here from Home, where the dashboard
  // retired the corner block. The rules live in lib/drillFilter.
  const { results, cornerCounts } = useMemo(() => applyDrillFilter(drills, filter), [drills, filter])
  const cornerTotal = Object.values(cornerCounts).reduce((a, b) => a + b, 0)

  const activeFilters = countRefinements(filter)

  if (isLoading) return <Loading />
  if (isError) return <ErrorNote />

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Drill Library</h2>
          <div className="sub">Every drill and skill, tagged to the FA four-corner model.</div>
        </div>
        {(canImport || canPlan || canCreate) && (
          <div className="row wrap">
            {canImport && (
              <button className="btn btn-ghost" onClick={() => setImportOpen(true)}>
                <Icon.download />
                Import from England Football
              </button>
            )}
            {canPlan && (
              <button className="btn btn-ghost" onClick={() => nav('planner')}>
                <Icon.layers />
                Build a session
              </button>
            )}
            {canCreate && (
              <button className="btn btn-primary" onClick={() => setAddOpen(true)}>
                <Icon.plus />
                Add drill
              </button>
            )}
          </div>
        )}
      </div>

      <div className="filterbar">
        <div className="filter-row">
          <div className="search-lg">
            <Icon.search />
            <input
              placeholder="Search drills, skills or tags…"
              value={filter.q}
              onChange={(e) => set({ q: e.target.value })}
            />
          </div>
          <select className="select" value={filter.sort} onChange={(e) => set({ sort: e.target.value as LibrarySort })}>
            <option value="recent">Sort: Recent</option>
            <option value="az">Sort: A–Z</option>
            <option value="duration">Sort: Shortest</option>
          </select>
        </div>

        <div className="filter-row">
          <span className="filter-label">Corner</span>
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
          <span className="filter-label">Refine</span>
          <select className="select" value={filter.skill} onChange={(e) => set({ skill: e.target.value })} style={{ height: 40 }}>
            <option value="">All skills</option>
            {options.skills.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select className="select" value={filter.theme} onChange={(e) => set({ theme: e.target.value })} style={{ height: 40 }}>
            <option value="">All themes</option>
            {options.themes.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <select className="select" value={filter.format} onChange={(e) => set({ format: e.target.value })} style={{ height: 40 }}>
            <option value="">All formats</option>
            {options.formats.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
          <select className="select" value={filter.age} onChange={(e) => set({ age: e.target.value })} style={{ height: 40 }}>
            <option value="">All ages</option>
            {options.ages.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <select className="select" value={filter.level} onChange={(e) => set({ level: e.target.value })} style={{ height: 40 }}>
            <option value="">All levels</option>
            {options.levels.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
          {activeFilters > 0 && (
            <button className="btn btn-quiet btn-sm" onClick={() => setFilter(clearedRefinements)}>
              <Icon.x />
              Clear ({activeFilters})
            </button>
          )}
        </div>
      </div>

      {/* Results count plus the corner distribution strip. Tapping a corner
          toggles the same filter as the chips above. */}
      <div className="row wrap" style={{ gap: 12, marginBottom: 14, alignItems: 'center' }}>
        <div className="muted" style={{ fontSize: 13.5, fontWeight: 600 }}>
          {results.length} drill{results.length !== 1 ? 's' : ''}
        </div>
        {cornerTotal > 0 && (
          <>
            <div
              aria-hidden="true"
              style={{
                display: 'flex',
                gap: 2,
                height: 8,
                borderRadius: 4,
                overflow: 'hidden',
                flex: 1,
                minWidth: 140,
                maxWidth: 380,
              }}
            >
              {Object.values(CORNERS).map((c) =>
                cornerCounts[c.key] > 0 ? (
                  <div
                    key={c.key}
                    title={`${c.label}: ${cornerCounts[c.key]}`}
                    style={{
                      flex: cornerCounts[c.key],
                      background: c.color,
                      opacity: filter.corner && filter.corner !== c.key ? 0.25 : 1,
                      transition: 'opacity .15s',
                    }}
                  />
                ) : null,
              )}
            </div>
            <div className="row wrap" style={{ gap: 6 }}>
              {Object.values(CORNERS).map((c) => (
                <button
                  key={c.key}
                  className="pill"
                  title={c.label}
                  onClick={() => set({ corner: filter.corner === c.key ? null : c.key })}
                  style={{ cursor: 'pointer', border: 0, opacity: filter.corner && filter.corner !== c.key ? 0.45 : 1 }}
                >
                  <span
                    style={{ width: 8, height: 8, borderRadius: '50%', background: c.color, display: 'inline-block' }}
                  ></span>
                  {c.short} {cornerCounts[c.key]}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {results.length === 0 ? (
        <Empty icon={Icon.search} title="No drills match">
          Try clearing a filter or searching something broader.
        </Empty>
      ) : (
        <div className="grid-drills">
          {results.map((d) => (
            <DrillCard
              key={d.id}
              drill={d}
              onClick={() => nav('drill', { drillId: d.id })}
              action={
                canManage(d) ? (
                  // The action row sits inside the clickable card, so it stops
                  // the click from also opening the drill.
                  <div className="row" style={{ gap: 8, marginTop: 2 }} onClick={(e) => e.stopPropagation()}>
                    <button className="btn btn-ghost btn-sm" style={{ flex: 1 }} onClick={() => setEditing(d)}>
                      <Icon.edit />
                      Edit
                    </button>
                    <button
                      className="btn btn-ghost btn-sm icon-only"
                      style={{ width: 38, padding: 0, alignSelf: 'stretch', height: 'auto' }}
                      aria-label={'Delete ' + d.title}
                      onClick={() => setDeleting(d)}
                    >
                      <Icon.trash />
                    </button>
                  </div>
                ) : undefined
              }
            />
          ))}
        </div>
      )}

      {addOpen && <DrillFormModal onClose={() => setAddOpen(false)} />}
      {editing && <DrillFormModal drill={editing} onClose={() => setEditing(null)} />}
      {deleting && <DeleteDrillModal drill={deleting} onClose={() => setDeleting(null)} />}
      {importOpen && <ImportFAModal onClose={() => setImportOpen(false)} />}
    </div>
  )
}
