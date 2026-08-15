// The Add from library selection model.
//
// SPEC. The modal's selection is a set of drill ids, independent of what
// the current filter shows: filtering a selected drill out of view never
// unselects it, the Add count is the whole set, and confirm adds exactly
// the selected drills once each, drawn from the FULL library list.
//
// THE ORDERING RULE, pinned here because it used to be an accident. The
// historical confirm was `drills.filter(picked)` over the useDrills read,
// which is newest first, so activities landed in Recent order. The rule is
// now stated: confirm adds the selected drills in the modal's current sort
// applied over the whole selected set. Under the default Recent sort that
// is byte-identical to the historical order; under A to Z or Shortest it
// follows what the coach is looking at. It is never the order the coach
// happened to tick.
import { describe, expect, it } from 'vitest'
import type { Drill } from './data'
import { applyDrillFilter, clearedRefinements, DEFAULT_DRILL_FILTER } from './drillFilter'
import type { DrillFilter } from './drillFilter'
import { hiddenSelectedCount, phaseFor, pickerEmptyState, selectedActivities, selectedCount } from './drillPicker'

const drill = (over: Partial<Drill> & Pick<Drill, 'id' | 'title'>): Drill => ({
  corner: null,
  skill: '',
  ages: [],
  level: 'Foundation',
  duration: 10,
  players: '',
  area: '',
  equipment: [],
  mediaId: null,
  summary: '',
  points: [],
  tags: [],
  setupNotes: '',
  easier: [],
  harder: [],
  theme: '',
  format: '',
  sourceUrl: '',
  sourceLabel: '',
  sourceKey: '',
  rights: 'internal_only',
  createdAt: '2026-01-01T00:00:00Z',
  ...over,
})

const f = (over: Partial<DrillFilter>): DrillFilter => ({ ...DEFAULT_DRILL_FILTER, ...over })

describe('phaseFor', () => {
  it('is unchanged: physical warms up, social plays, everything else is a skill', () => {
    expect(phaseFor('physical')).toBe('Warm-Up')
    expect(phaseFor('social')).toBe('Game')
    expect(phaseFor('technical')).toBe('Skill')
    expect(phaseFor('psychological')).toBe('Skill')
    expect(phaseFor(null)).toBe('Skill')
  })
})

describe('selectedActivities', () => {
  // The list arrives newest first, the order useDrills returns.
  const newest = drill({ id: 'newest', title: 'Zonal defending', corner: 'physical', duration: 10, createdAt: '2026-03-01T00:00:00Z' })
  const middle = drill({ id: 'middle', title: 'Attacking waves', corner: 'social', duration: 5, createdAt: '2026-02-01T00:00:00Z' })
  const oldest = drill({ id: 'oldest', title: 'Mirror game', corner: null, duration: 20, createdAt: '2026-01-01T00:00:00Z' })
  const drills = [newest, middle, oldest]

  it('adds exactly the selected drills once each, with the drill duration and phase', () => {
    const items = selectedActivities(drills, { newest: true, oldest: true, middle: false }, 'recent')
    expect(items).toEqual([
      { phase: 'Warm-Up', drillId: 'newest', duration: 10 },
      { phase: 'Skill', drillId: 'oldest', duration: 20 },
    ])
  })

  it('under the default Recent sort reproduces the historical library order, not the tick order', () => {
    // Ticked oldest first; added newest first, as `drills.filter(picked)`
    // over the newest-first read always did.
    const items = selectedActivities(drills, { oldest: true, newest: true }, 'recent')
    expect(items.map((a) => a.drillId)).toEqual(['newest', 'oldest'])
  })

  it('follows the display sort the coach is looking at', () => {
    const all = { newest: true, middle: true, oldest: true }
    expect(selectedActivities(drills, all, 'az').map((a) => a.drillId)).toEqual(['middle', 'oldest', 'newest'])
    expect(selectedActivities(drills, all, 'duration').map((a) => a.drillId)).toEqual(['middle', 'newest', 'oldest'])
  })

  it('ignores an id the library no longer holds rather than inventing an activity', () => {
    const items = selectedActivities(drills, { newest: true, gone: true }, 'recent')
    expect(items.map((a) => a.drillId)).toEqual(['newest'])
  })
})

describe('selectedCount and hiddenSelectedCount', () => {
  const library = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

  it('counts the whole selected set, never only the visible rows', () => {
    expect(selectedCount(library, { a: true, b: true, c: false })).toBe(2)
  })

  it('says how many selected drills the current filter hides', () => {
    expect(hiddenSelectedCount(library, [{ id: 'b' }], { a: true, b: true, c: false })).toBe(1)
    expect(hiddenSelectedCount(library, [{ id: 'a' }, { id: 'b' }], { a: true, b: true })).toBe(0)
  })

  it('an id the library no longer holds is neither counted nor called hidden', () => {
    // A drill deleted while the modal was open, surfaced by a background
    // refetch. Confirm will not add it, so the count must not promise it,
    // and "hidden by filters" would be a lie: clearing the filters cannot
    // reveal it.
    expect(selectedCount(library, { a: true, gone: true })).toBe(1)
    expect(hiddenSelectedCount(library, [{ id: 'a' }], { a: true, gone: true })).toBe(0)
  })
})

describe('pickerEmptyState', () => {
  it('tells an empty library apart from filters that match nothing', () => {
    expect(pickerEmptyState(0, 0)).toBe('empty-library')
    expect(pickerEmptyState(4, 0)).toBe('no-match')
    expect(pickerEmptyState(4, 2)).toBe(null)
  })
})

describe('the browse-and-pick sequence', () => {
  const passing = drill({ id: 'passing', title: 'Rondo keep-ball', skill: 'Passing', createdAt: '2026-03-01T00:00:00Z' })
  const tackling = drill({ id: 'tackling', title: 'Shield and steal', skill: 'Tackling', createdAt: '2026-01-01T00:00:00Z' })
  const drills = [passing, tackling]

  it('select A, filter it out, select B, clear: both stay selected and both are added', () => {
    let picked: Record<string, boolean> = {}
    picked = { ...picked, passing: true }

    // The Tackling filter hides the selected Passing drill.
    const narrowed = f({ skill: 'Tackling' })
    const hidden = applyDrillFilter(drills, narrowed)
    expect(hidden.results.map((d) => d.id)).toEqual(['tackling'])
    expect(hiddenSelectedCount(drills, hidden.results, picked)).toBe(1)

    picked = { ...picked, tackling: true }

    // Clearing the filter brings every drill back and loses nothing.
    const cleared = applyDrillFilter(drills, clearedRefinements(narrowed))
    expect(cleared.results).toHaveLength(2)
    expect(selectedCount(drills, picked)).toBe(2)
    expect(selectedActivities(drills, picked, 'recent').map((a) => a.drillId)).toEqual(['passing', 'tackling'])
  })
})
