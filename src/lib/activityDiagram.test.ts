import { describe, expect, it } from 'vitest'
import {
  activityDiagram,
  activityDrillIds,
  anyActivityDiagram,
  drillMayShowDiagram,
  drillSource,
} from './activityDiagram'
import { emptyDiagram, type DrillDiagram } from './drillDiagram'
import type { Activity, Drill } from './data'

// Synthetic throughout: invented drill ids, invented titles, and the one
// England Football URL shape the provenance rule keys on.
const drill = (id: string, over: Partial<Drill> = {}): Drill => ({
  id,
  title: `Drill ${id}`,
  corner: null,
  skill: 'Passing',
  ages: [],
  level: 'Foundation',
  duration: 15,
  players: '8',
  area: '30x20',
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
  createdAt: '2026-08-16T00:00:00Z',
  ...over,
})

const act = (drillId?: string): Activity => ({ phase: 'Skill', drillId, duration: 15 })

// A diagram with something in it, which is what the empty rule turns on.
// The id is a parameter so two drills can hold DIFFERENT diagrams: with one
// shape for every drill, a resolver that ignored the activity's drill and
// returned whatever was first in the map would be indistinguishable from a
// correct one. A mutation proved that gap was real before this argument
// existed.
function drawn(id = 'cone-1'): DrillDiagram {
  const d = emptyDiagram()
  return {
    ...d,
    elements: [{ type: 'cone', id, x: 0.5, y: 0.5, colour: 'orange' }],
  } as DrillDiagram
}

const FA_URL = 'https://learn.englandfootball.com/some-activity'

describe('drillMayShowDiagram, the licence rule', () => {
  it('lets an ordinary drill show one', () => {
    expect(drillMayShowDiagram(drill('d1'))).toBe(true)
  })

  it('refuses an England Football derived drill, by url, key or label', () => {
    expect(drillMayShowDiagram(drill('d1', { sourceUrl: FA_URL }))).toBe(false)
    expect(drillMayShowDiagram(drill('d1', { sourceKey: `${FA_URL}#3` }))).toBe(false)
    expect(drillMayShowDiagram(drill('d1', { sourceLabel: 'England Football Learning' }))).toBe(false)
  })

  it('does not refuse a non England Football source', () => {
    // third_party is not fa: the licence rule is about the FA's own terms,
    // not about attribution in general.
    expect(drillMayShowDiagram(drill('d1', { sourceLabel: 'A coaching book' }))).toBe(true)
  })

  it('reads the three source fields and nothing else', () => {
    expect(Object.keys(drillSource(drill('d1'))).sort()).toEqual(['sourceKey', 'sourceLabel', 'sourceUrl'])
  })
})

describe('activityDiagram', () => {
  const drills = { d1: drill('d1') }

  it('returns the drill diagram for an ordinary activity', () => {
    const d = drawn()
    expect(activityDiagram(act('d1'), drills, { d1: d })).toBe(d)
  })

  it('shows nothing for an activity with no drill', () => {
    expect(activityDiagram(act(undefined), drills, {})).toBeNull()
  })

  it('shows nothing when the drill has been deleted since planning', () => {
    // A real state: the session keeps the id, the drill is gone. Without the
    // drill there is no provenance to check, so nothing is drawn.
    expect(activityDiagram(act('gone'), drills, { gone: drawn() })).toBeNull()
  })

  it('shows nothing when the drill has no diagram', () => {
    expect(activityDiagram(act('d1'), drills, {})).toBeNull()
    expect(activityDiagram(act('d1'), drills, { d1: null })).toBeNull()
  })

  it('treats an empty diagram as no diagram', () => {
    // A coach opened Drill Maker and saved without drawing. An empty pitch
    // under every activity is worse than nothing.
    expect(activityDiagram(act('d1'), drills, { d1: emptyDiagram() })).toBeNull()
  })

  it('REFUSES an England Football derived drill that is holding a diagram', () => {
    // The reachable production state DrillDetail records: a coach drew on
    // their own drill, then recorded an England Football source on it. The
    // drill page suppresses it; every session surface must too, because the
    // limit is the club's licence and not a permission.
    const fa = { d1: drill('d1', { sourceUrl: FA_URL }) }
    expect(activityDiagram(act('d1'), fa, { d1: drawn() })).toBeNull()
  })

  it('refuses it for every viewer, since there is no viewer argument to vary', () => {
    // Stated as a test because the rule being viewer independent is the
    // whole point: an admin does not get to see it either.
    const fa = { d1: drill('d1', { sourceLabel: 'England Football Learning' }) }
    expect(activityDiagram(act('d1'), fa, { d1: drawn() })).toBeNull()
    expect(activityDiagram.length).toBe(3)
  })

  it('resolves the same drill used twice identically', () => {
    const d = drawn()
    const a = act('d1')
    const b = act('d1')
    expect(activityDiagram(a, drills, { d1: d })).toBe(activityDiagram(b, drills, { d1: d }))
  })

  it('gives each activity ITS OWN drill diagram, not whichever loaded first', () => {
    // The mapping itself, which nothing else here pins: every other test
    // holds one diagram, so a resolver that ignored the activity's drill and
    // returned the first entry in the map would pass them all. A mutation
    // that did exactly that survived until this test existed.
    const two = { d1: drill('d1'), d2: drill('d2') }
    const first = drawn('cone-d1')
    const second = drawn('cone-d2')
    const map = { d1: first, d2: second }
    expect(activityDiagram(act('d1'), two, map)).toBe(first)
    expect(activityDiagram(act('d2'), two, map)).toBe(second)
    // And in the order a session would ask, so an insertion ordered map
    // cannot make the wrong answer look right.
    expect(activityDiagram(act('d2'), two, map)).not.toBe(first)
  })

  it('reads no media, so a drill with media and no diagram still shows none', () => {
    // Media and diagram answer different questions and both are shown where
    // both exist. Nothing here ranks them, and a media id is not a diagram.
    const withMedia = { d1: drill('d1', { mediaId: 'm1' }) }
    expect(activityDiagram(act('d1'), withMedia, {})).toBeNull()
  })
})

describe('activityDrillIds', () => {
  it('dedupes and keeps first appearance order', () => {
    expect(activityDrillIds([act('d2'), act('d1'), act('d2'), act(undefined)])).toEqual(['d2', 'd1'])
  })

  it('is empty for a session that plans no drills', () => {
    expect(activityDrillIds([])).toEqual([])
    expect(activityDrillIds([act(undefined)])).toEqual([])
  })

  it('includes a drill whose diagram will be refused, because it cannot know yet', () => {
    // The read is keyed on ids before the drill map has necessarily
    // resolved. Filtering here would make a cold load show no diagrams.
    expect(activityDrillIds([act('d1')])).toEqual(['d1'])
  })
})

describe('anyActivityDiagram', () => {
  it('is true only when something would actually render', () => {
    const drills = { d1: drill('d1'), fa: drill('fa', { sourceUrl: FA_URL }) }
    expect(anyActivityDiagram([act('d1')], drills, { d1: drawn() })).toBe(true)
    expect(anyActivityDiagram([act('d1')], drills, { d1: emptyDiagram() })).toBe(false)
    expect(anyActivityDiagram([act('fa')], drills, { fa: drawn() })).toBe(false)
    expect(anyActivityDiagram([], drills, {})).toBe(false)
  })
})
