import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useNav } from '../hooks/useNav'
import { useDrills } from '../lib/queries'
import { CORNERS, AGES, LEVELS } from '../lib/data'
import type { CornerKey } from '../lib/data'
import { FA_FORMATS, FA_PLAYER_SKILLS, FA_THEMES, withExistingValues } from '../lib/fa'
import { Icon } from '../components/icons'
import { Chip, DrillCard, Empty, ErrorNote, Loading } from '../components/ui'
import { DrillFormModal } from '../components/DrillFormModal'
import { ImportFAModal } from '../components/ImportFAModal'

export function Library() {
  const nav = useNav()
  const [searchParams, setSearchParams] = useSearchParams()
  const presetCorner = searchParams.get('corner')
  const initialCorner = presetCorner && presetCorner in CORNERS ? (presetCorner as CornerKey) : null

  const [q, setQ] = useState('')
  const [corner, setCorner] = useState<CornerKey | null>(initialCorner)
  const [skill, setSkill] = useState('')
  const [theme, setTheme] = useState('')
  const [format, setFormat] = useState('')
  const [age, setAge] = useState('')
  const [level, setLevel] = useState('')
  const [sort, setSort] = useState('recent')
  const [addOpen, setAddOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const { data: drills = [], isLoading, isError } = useDrills()

  // Apply the corner preset from the URL once, then clear it.
  useEffect(() => {
    if (searchParams.get('corner')) setSearchParams({}, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The filter options are the FA taxonomy plus any values already stored on
  // drills, so existing values keep appearing.
  const skillOptions = useMemo(() => withExistingValues(FA_PLAYER_SKILLS, drills.map((d) => d.skill)), [drills])
  const themeOptions = useMemo(() => withExistingValues(FA_THEMES, drills.map((d) => d.theme)), [drills])
  const formatOptions = useMemo(() => withExistingValues(FA_FORMATS, drills.map((d) => d.format)), [drills])

  const results = useMemo(() => {
    let r = drills.filter((d) => {
      if (corner && d.corner !== corner) return false
      if (skill && d.skill !== skill) return false
      if (theme && d.theme !== theme) return false
      if (format && d.format !== format) return false
      if (age && !d.ages.includes(age)) return false
      if (level && d.level !== level) return false
      if (q) {
        const hay = (d.title + ' ' + d.summary + ' ' + d.skill + ' ' + d.tags.join(' ')).toLowerCase()
        if (!hay.includes(q.toLowerCase())) return false
      }
      return true
    })
    if (sort === 'duration') r = [...r].sort((a, b) => a.duration - b.duration)
    if (sort === 'az') r = [...r].sort((a, b) => a.title.localeCompare(b.title))
    return r
  }, [drills, q, corner, skill, theme, format, age, level, sort])

  const activeFilters = [corner, skill, theme, format, age, level].filter(Boolean).length

  if (isLoading) return <Loading />
  if (isError) return <ErrorNote />

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Drill Library</h2>
          <div className="sub">Every drill and skill, tagged to the FA four-corner model.</div>
        </div>
        <div className="row wrap">
          <button className="btn btn-ghost" onClick={() => setImportOpen(true)}>
            <Icon.download />
            Import from England Football
          </button>
          <button className="btn btn-ghost" onClick={() => nav('planner')}>
            <Icon.layers />
            Build a session
          </button>
          <button className="btn btn-primary" onClick={() => setAddOpen(true)}>
            <Icon.plus />
            Add drill
          </button>
        </div>
      </div>

      <div className="filterbar">
        <div className="filter-row">
          <div className="search-lg">
            <Icon.search />
            <input placeholder="Search drills, skills or tags…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <select className="select" value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="recent">Sort: Recent</option>
            <option value="az">Sort: A–Z</option>
            <option value="duration">Sort: Shortest</option>
          </select>
        </div>

        <div className="filter-row">
          <span className="filter-label">Corner</span>
          {Object.values(CORNERS).map((c) => (
            <Chip key={c.key} on={corner === c.key} dot={c.color} onClick={() => setCorner(corner === c.key ? null : c.key)}>
              {c.label}
            </Chip>
          ))}
        </div>

        <div className="filter-row">
          <span className="filter-label">Refine</span>
          <select className="select" value={skill} onChange={(e) => setSkill(e.target.value)} style={{ height: 40 }}>
            <option value="">All skills</option>
            {skillOptions.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select className="select" value={theme} onChange={(e) => setTheme(e.target.value)} style={{ height: 40 }}>
            <option value="">All themes</option>
            {themeOptions.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <select className="select" value={format} onChange={(e) => setFormat(e.target.value)} style={{ height: 40 }}>
            <option value="">All formats</option>
            {formatOptions.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
          <select className="select" value={age} onChange={(e) => setAge(e.target.value)} style={{ height: 40 }}>
            <option value="">All ages</option>
            {AGES.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <select className="select" value={level} onChange={(e) => setLevel(e.target.value)} style={{ height: 40 }}>
            <option value="">All levels</option>
            {LEVELS.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
          {activeFilters > 0 && (
            <button
              className="btn btn-quiet btn-sm"
              onClick={() => {
                setCorner(null)
                setSkill('')
                setTheme('')
                setFormat('')
                setAge('')
                setLevel('')
              }}
            >
              <Icon.x />
              Clear ({activeFilters})
            </button>
          )}
        </div>
      </div>

      <div className="muted" style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 14 }}>
        {results.length} drill{results.length !== 1 ? 's' : ''}
      </div>

      {results.length === 0 ? (
        <Empty icon={Icon.search} title="No drills match">
          Try clearing a filter or searching something broader.
        </Empty>
      ) : (
        <div className="grid-drills">
          {results.map((d) => (
            <DrillCard key={d.id} drill={d} onClick={() => nav('drill', { drillId: d.id })} />
          ))}
        </div>
      )}

      {addOpen && <DrillFormModal onClose={() => setAddOpen(false)} />}
      {importOpen && <ImportFAModal onClose={() => setImportOpen(false)} />}
    </div>
  )
}
