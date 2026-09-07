import { describe, expect, it } from 'vitest'
import type { Season } from './data'
import {
  LAYOUT_SHAPES,
  MAX_ZONE_NAME,
  MIN_ZONE_SIZE,
  VENUE_LAYOUT_VERSION,
  completeZones,
  defaultZones,
  describeNoLayout,
  emptyLayoutZones,
  findVenueLayout,
  fitZone,
  isLayoutShape,
  layoutShapeLabel,
  layoutSignature,
  layoutsForScope,
  moveZone,
  parseVenueLayoutZones,
  renameZone,
  resizeZone,
  resolveLayoutScope,
  resolveSeason,
  serialiseVenueLayoutZones,
  zoneLabel,
  type LayoutShape,
  type NoLayoutState,
  type VenueLayout,
} from './venueLayout'

const FOUR: LayoutShape = { kind: 'stations', slots: 4 }
const FIVE: LayoutShape = { kind: 'stations', slots: 5 }
const ONE: LayoutShape = { kind: 'games', slots: 1 }
const TWO: LayoutShape = { kind: 'games', slots: 2 }

// The canonical stored form the migration's self verification accepts.
const STORED_FOUR = {
  version: 1,
  size: { metres_wide: 60, metres_long: 40 },
  zones: [
    { n: 1, name: 'Top left', x: 0.02, y: 0.02, w: 0.45, h: 0.45 },
    { n: 2, x: 0.53, y: 0.02, w: 0.45, h: 0.45 },
    { n: 3, x: 0.02, y: 0.53, w: 0.45, h: 0.45 },
    { n: 4, x: 0.53, y: 0.53, w: 0.45, h: 0.45 },
  ],
}

describe('the vocabulary', () => {
  it('holds exactly four shapes: four and five stations, one and two games', () => {
    expect(LAYOUT_SHAPES).toEqual([FOUR, FIVE, ONE, TWO])
    expect(isLayoutShape('stations', 3)).toBe(false)
    expect(isLayoutShape('stations', 6)).toBe(false)
    expect(isLayoutShape('games', 3)).toBe(false)
    expect(isLayoutShape('games', 2)).toBe(true)
  })

  it('names each shape and each zone in words', () => {
    expect(LAYOUT_SHAPES.map(layoutShapeLabel)).toEqual(['Four stations', 'Five stations', 'One game', 'Two games'])
    expect(zoneLabel('stations', 3)).toBe('Station 3')
    expect(zoneLabel('games', 2)).toBe('Game 2')
  })
})

describe('reading a stored value', () => {
  it('round trips the canonical form through the parser and the serialiser', () => {
    const parsed = parseVenueLayoutZones(STORED_FOUR, 4)
    expect(parsed).not.toBeNull()
    expect(serialiseVenueLayoutZones(parsed!, FOUR)).toEqual(STORED_FOUR)
  })

  it('yields no layout for an unknown version, rather than a mis drawn one', () => {
    expect(parseVenueLayoutZones({ ...STORED_FOUR, version: 2 }, 4)).toBeNull()
    expect(parseVenueLayoutZones({ ...STORED_FOUR, version: '1' }, 4)).toBeNull()
    expect(parseVenueLayoutZones({ zones: [] }, 4)).toBeNull()
  })

  it('yields no layout for a value that is not an object with a zones array', () => {
    expect(parseVenueLayoutZones(null, 4)).toBeNull()
    expect(parseVenueLayoutZones('{}', 4)).toBeNull()
    expect(parseVenueLayoutZones([], 4)).toBeNull()
    expect(parseVenueLayoutZones({ version: 1, zones: 'nope' }, 4)).toBeNull()
  })

  it('drops a corrupt zone and keeps the rest, rather than taking the layout with it', () => {
    const value = {
      version: 1,
      zones: [
        { n: 1, x: 0.1, y: 0.1, w: 0.3, h: 0.3 },
        { n: 2, x: 'half', y: 0.1, w: 0.3, h: 0.3 },
        'not a zone',
        { n: 3, x: 0.1, y: 0.5, w: 0.3, h: 0.3, name: 'Kept' },
      ],
    }
    const parsed = parseVenueLayoutZones(value, 4)!
    expect(parsed.zones.map((z) => z.n)).toEqual([1, 3])
    expect(parsed.zones[1].name).toBe('Kept')
  })

  it('drops a zone numbered outside 1..slots, and keeps the first of two sharing a number', () => {
    const value = {
      version: 1,
      zones: [
        { n: 5, x: 0.1, y: 0.1, w: 0.3, h: 0.3 },
        { n: 0, x: 0.1, y: 0.1, w: 0.3, h: 0.3 },
        { n: 1.5, x: 0.1, y: 0.1, w: 0.3, h: 0.3 },
        { n: 2, x: 0.6, y: 0.6, w: 0.3, h: 0.3, name: 'first' },
        { n: 2, x: 0.1, y: 0.1, w: 0.3, h: 0.3, name: 'second' },
        { n: 1, x: 0.1, y: 0.1, w: 0.3, h: 0.3 },
      ],
    }
    const parsed = parseVenueLayoutZones(value, 4)!
    expect(parsed.zones.map((z) => [z.n, z.name])).toEqual([
      [1, ''],
      [2, 'first'],
    ])
  })

  it('clamps an out of range coordinate onto the surface and grows a sliver to the minimum', () => {
    const value = { version: 1, zones: [{ n: 1, x: 1.4, y: -0.2, w: 0.01, h: 2 }] }
    const [z] = parseVenueLayoutZones(value, 1)!.zones
    expect(z.w).toBe(MIN_ZONE_SIZE)
    expect(z.h).toBe(1)
    expect(z.x).toBe(1 - MIN_ZONE_SIZE)
    expect(z.y).toBe(0)
  })

  it('never lets a key it does not name survive a read', () => {
    const value = {
      version: 1,
      lat: 53.6,
      zones: [{ n: 1, x: 0.1, y: 0.1, w: 0.3, h: 0.3, player_id: 'abc', address: 'Church Lane' }],
    }
    const parsed = parseVenueLayoutZones(value, 1)!
    expect(Object.keys(parsed)).toEqual(['version', 'size', 'zones'])
    expect(Object.keys(parsed.zones[0]).sort()).toEqual(['h', 'n', 'name', 'w', 'x', 'y'])
    expect(JSON.stringify(serialiseVenueLayoutZones(parsed, ONE))).not.toContain('player_id')
    expect(JSON.stringify(serialiseVenueLayoutZones(parsed, ONE))).not.toContain('lat')
  })

  it('caps a zone name and drops a non string one', () => {
    const value = {
      version: 1,
      zones: [
        { n: 1, x: 0.1, y: 0.1, w: 0.3, h: 0.3, name: 'x'.repeat(40) },
        { n: 2, x: 0.5, y: 0.5, w: 0.3, h: 0.3, name: 7 },
      ],
    }
    const parsed = parseVenueLayoutZones(value, 2)!
    expect(parsed.zones[0].name).toHaveLength(MAX_ZONE_NAME)
    expect(parsed.zones[1].name).toBe('')
  })

  it('reads the declared size as whole metres within its bounds, and absent as null', () => {
    expect(parseVenueLayoutZones({ version: 1, zones: [] }, 1)!.size).toEqual({ metresWide: null, metresLong: null })
    expect(parseVenueLayoutZones({ version: 1, size: { metres_wide: 2, metres_long: 999.6 }, zones: [] }, 1)!.size).toEqual({
      metresWide: 5,
      metresLong: 300,
    })
    expect(parseVenueLayoutZones({ version: 1, size: { metres_wide: 'sixty' }, zones: [] }, 1)!.size.metresWide).toBeNull()
  })
})

describe('writing a value', () => {
  it('writes only the allow listed keys, in a fixed order, with the name only when there is one', () => {
    const out = serialiseVenueLayoutZones(emptyLayoutZones(TWO), TWO) as { version: number; size?: unknown; zones: object[] }
    expect(Object.keys(out)).toEqual(['version', 'zones'])
    expect(out.version).toBe(VENUE_LAYOUT_VERSION)
    expect(out.zones.map((z) => Object.keys(z))).toEqual([
      ['n', 'x', 'y', 'w', 'h'],
      ['n', 'x', 'y', 'w', 'h'],
    ])
  })

  it('completes a short value to the shape s slot count, so the stored row is always whole', () => {
    const short = { version: 1 as const, size: { metresWide: null, metresLong: null }, zones: [{ n: 3, name: '', x: 0.1, y: 0.1, w: 0.2, h: 0.2 }] }
    const out = serialiseVenueLayoutZones(short, FIVE) as { zones: { n: number; x: number }[] }
    expect(out.zones.map((z) => z.n)).toEqual([1, 2, 3, 4, 5])
    expect(out.zones[2].x).toBe(0.1)
  })

  it('rounds to four places and keeps the rectangle inside the surface after rounding', () => {
    const v = { version: 1 as const, size: { metresWide: null, metresLong: null }, zones: [{ n: 1, name: '', x: 0.53334, y: 0.1, w: 0.46667, h: 0.5 }] }
    const [z] = (serialiseVenueLayoutZones(v, ONE) as { zones: { x: number; w: number }[] }).zones
    expect(z.w).toBe(0.4667)
    expect(z.x + z.w).toBeLessThanOrEqual(1)
  })

  it('trims and caps the name on the way out, and writes size only when set', () => {
    const v = {
      version: 1 as const,
      size: { metresWide: 60, metresLong: null },
      zones: [{ n: 1, name: '  Main pitch  ', x: 0.1, y: 0.1, w: 0.8, h: 0.8 }],
    }
    expect(serialiseVenueLayoutZones(v, ONE)).toEqual({
      version: 1,
      size: { metres_wide: 60 },
      zones: [{ n: 1, name: 'Main pitch', x: 0.1, y: 0.1, w: 0.8, h: 0.8 }],
    })
  })

  it('gives a stable signature that changes on a move, a resize, a rename or a size change', () => {
    const base = emptyLayoutZones(FOUR)
    const same = emptyLayoutZones(FOUR)
    expect(layoutSignature(base, FOUR)).toBe(layoutSignature(same, FOUR))
    expect(layoutSignature({ ...base, zones: moveZone(base.zones, 1, 0.01, 0) }, FOUR)).not.toBe(layoutSignature(base, FOUR))
    expect(layoutSignature({ ...base, zones: resizeZone(base.zones, 1, 0.01, 0) }, FOUR)).not.toBe(layoutSignature(base, FOUR))
    expect(layoutSignature({ ...base, zones: renameZone(base.zones, 1, 'Goal end') }, FOUR)).not.toBe(layoutSignature(base, FOUR))
    expect(layoutSignature({ ...base, size: { metresWide: 50, metresLong: null } }, FOUR)).not.toBe(layoutSignature(base, FOUR))
  })
})

describe('defaults and editing', () => {
  it('starts every shape with exactly its slot count of zones, numbered 1..n, all inside the surface', () => {
    for (const shape of LAYOUT_SHAPES) {
      const zones = defaultZones(shape)
      expect(zones.map((z) => z.n)).toEqual(Array.from({ length: shape.slots }, (_, i) => i + 1))
      for (const z of zones) {
        expect(z.x + z.w).toBeLessThanOrEqual(1)
        expect(z.y + z.h).toBeLessThanOrEqual(1)
        expect(z.w).toBeGreaterThanOrEqual(MIN_ZONE_SIZE)
        expect(z.h).toBeGreaterThanOrEqual(MIN_ZONE_SIZE)
      }
    }
  })

  it('completes a read that lost a zone with that zone s default, keeping the others where they were', () => {
    const kept = { n: 2, name: 'Kept', x: 0.2, y: 0.2, w: 0.2, h: 0.2 }
    const out = completeZones([kept, { ...kept, n: 9 }], FOUR)
    expect(out.map((z) => z.n)).toEqual([1, 2, 3, 4])
    expect(out[1]).toEqual(kept)
    expect(out[0]).toEqual(defaultZones(FOUR)[0])
  })

  it('moves and resizes one zone within the surface and leaves the others alone', () => {
    const zones = defaultZones(TWO)
    const moved = moveZone(zones, 2, 5, 5)
    expect(moved[1].x).toBe(1 - moved[1].w)
    expect(moved[1].y).toBe(1 - moved[1].h)
    expect(moved[0]).toEqual(zones[0])
    const shrunk = resizeZone(zones, 1, -5, -5)
    expect(shrunk[0].w).toBe(MIN_ZONE_SIZE)
    expect(shrunk[0].h).toBe(MIN_ZONE_SIZE)
    expect(shrunk[1]).toEqual(zones[1])
  })

  it('growing a zone past the edge widens it to the edge and never moves its other side', () => {
    const zones = defaultZones(FOUR)
    const grown = resizeZone(zones, 2, 5, 5)
    expect(grown[1].x).toBe(zones[1].x)
    expect(grown[1].y).toBe(zones[1].y)
    expect(grown[1].x + grown[1].w).toBeCloseTo(1, 10)
    expect(grown[1].y + grown[1].h).toBeCloseTo(1, 10)
  })

  it('fits a zone that grew past the edge by pulling its position back, not by cutting it', () => {
    const z = fitZone({ n: 1, name: '', x: 0.8, y: 0.8, w: 0.5, h: 0.5 })
    expect(z).toEqual({ n: 1, name: '', x: 0.5, y: 0.5, w: 0.5, h: 0.5 })
  })
})

// ---- Scope resolution ------------------------------------------------------

const season = (id: string, name: string, startsOn: string, endsOn: string, isCurrent = false): Season => ({
  id,
  name,
  startsOn,
  endsOn,
  isCurrent,
  archivedAt: null,
})
const S2526 = { ...season('s25', '2025/26', '2025-07-01', '2026-06-30'), archivedAt: '2026-07-02T00:00:00Z' }
const S2627 = season('s26', '2026/27', '2026-07-01', '2027-06-30', true)
// The production shape: a 2028/29 row dated inside 2026/27.
const OVERLAP = season('s28', '2028/29', '2027-01-20', '2028-01-20')

describe('season resolution fails closed', () => {
  it('resolves exactly one containing season, inclusive at both ends', () => {
    expect(resolveSeason('2026-07-01', [S2526, S2627])).toEqual({ kind: 'one', season: S2627 })
    expect(resolveSeason('2026-06-30', [S2526, S2627])).toEqual({ kind: 'one', season: S2526 })
  })

  it('a 2025 session resolves its archived 2025/26 season and never the current one', () => {
    expect(resolveSeason('2025-10-14', [S2526, S2627])).toEqual({ kind: 'one', season: S2526 })
  })

  it('resolves nothing when the date falls in no season, however current a season is', () => {
    expect(resolveSeason('2024-03-01', [S2526, S2627])).toEqual({ kind: 'none' })
    expect(resolveSeason('2029-03-01', [S2526, S2627])).toEqual({ kind: 'none' })
    expect(resolveSeason('2026-08-01', [])).toEqual({ kind: 'none' })
  })

  it('names an ambiguous date rather than picking, and does not consult is_current to break the tie', () => {
    const r = resolveSeason('2027-03-01', [S2526, S2627, OVERLAP])
    expect(r.kind).toBe('ambiguous')
    if (r.kind === 'ambiguous') expect(r.seasons.map((s) => s.id).sort()).toEqual(['s26', 's28'])
  })

  it('treats a missing or unreadable date as falling in no season', () => {
    expect(resolveSeason('', [S2627])).toEqual({ kind: 'none' })
    expect(resolveSeason(null, [S2627])).toEqual({ kind: 'none' })
    expect(resolveSeason('16/06/2026', [S2627])).toEqual({ kind: 'none' })
  })
})

const layout = (over: Partial<VenueLayout>): VenueLayout => ({
  id: 'l1',
  venueId: 'haggs',
  seasonId: 's26',
  ageGroup: 'U8s',
  kind: 'stations',
  slots: 4,
  zones: emptyLayoutZones(FOUR),
  ...over,
})

describe('the five no-layout states, and the one found state', () => {
  const seasons = [S2526, S2627, OVERLAP]
  const drawn = [layout({}), layout({ id: 'l2', slots: 5, zones: emptyLayoutZones(FIVE) })]

  it('finds the layout for a resolved scope and shape', () => {
    const r = findVenueLayout({ venueId: 'haggs', ageGroup: 'U8s', date: '2026-09-08' }, seasons, drawn, 'stations', 5)
    expect(r.state).toBe('found')
    if (r.state === 'found') {
      expect(r.layout.id).toBe('l2')
      expect(r.season.id).toBe('s26')
      expect(r.scope).toEqual({ venueId: 'haggs', seasonId: 's26', ageGroup: 'U8s' })
    }
  })

  it('no venue', () => {
    expect(resolveLayoutScope({ venueId: null, ageGroup: 'U8s', date: '2026-09-08' }, seasons)).toEqual({ state: 'no-venue' })
  })

  it('no age group, including whitespace', () => {
    expect(resolveLayoutScope({ venueId: 'haggs', ageGroup: '  ', date: '2026-09-08' }, seasons)).toEqual({ state: 'no-age-group' })
  })

  it('season unresolved', () => {
    expect(resolveLayoutScope({ venueId: 'haggs', ageGroup: 'U8s', date: '2024-09-08' }, seasons)).toEqual({ state: 'season-unresolved' })
  })

  it('season ambiguous, naming the seasons', () => {
    const r = resolveLayoutScope({ venueId: 'haggs', ageGroup: 'U8s', date: '2027-03-01' }, seasons)
    expect(r.state).toBe('season-ambiguous')
    if (r.state === 'season-ambiguous') expect(r.seasons).toHaveLength(2)
  })

  it('not drawn: another age group at the same venue does not see the first s layouts', () => {
    const r = findVenueLayout({ venueId: 'haggs', ageGroup: 'U7s', date: '2026-09-08' }, seasons, drawn, 'stations', 4)
    expect(r.state).toBe('not-drawn')
  })

  it('not drawn: a 2025 session does not load the current season s allocation', () => {
    const r = findVenueLayout({ venueId: 'haggs', ageGroup: 'U8s', date: '2025-10-14' }, seasons, drawn, 'stations', 4)
    expect(r.state).toBe('not-drawn')
    if (r.state === 'not-drawn') expect(r.season.id).toBe('s25')
  })

  it('not drawn: a legacy age group label the club list does not contain resolves no layout', () => {
    const r = findVenueLayout({ venueId: 'haggs', ageGroup: 'U8', date: '2026-09-08' }, seasons, drawn, 'stations', 4)
    expect(r.state).toBe('not-drawn')
  })

  it('not drawn: a row whose value could not be read counts as not drawn', () => {
    const unreadable = [layout({ zones: null })]
    const r = findVenueLayout({ venueId: 'haggs', ageGroup: 'U8s', date: '2026-09-08' }, seasons, unreadable, 'stations', 4)
    expect(r.state).toBe('not-drawn')
  })

  it('slot count: three active stations, or six, is a count no layout can hold, not an admin link', () => {
    for (const slots of [0, 3, 6]) {
      const r = findVenueLayout({ venueId: 'haggs', ageGroup: 'U8s', date: '2026-09-08' }, seasons, drawn, 'stations', slots)
      expect(r.state).toBe('slot-count')
    }
    expect(findVenueLayout({ venueId: 'haggs', ageGroup: 'U8s', date: '2026-09-08' }, seasons, drawn, 'games', 3).state).toBe('slot-count')
  })

  it('the scope questions come first, so a session with no venue is no-venue even at an unsupported count', () => {
    expect(findVenueLayout({ venueId: null, ageGroup: 'U8s', date: '2026-09-08' }, seasons, drawn, 'stations', 3).state).toBe('no-venue')
  })

  it('lists the layouts of one scope for the admin screen', () => {
    const all = [...drawn, layout({ id: 'other', ageGroup: 'U7s' }), layout({ id: 'past', seasonId: 's25' })]
    expect(layoutsForScope(all, { venueId: 'haggs', seasonId: 's26', ageGroup: 'U8s' }).map((l) => l.id)).toEqual(['l1', 'l2'])
  })

  it('has a sentence for every state, each saying who can fix it, and never a blank', () => {
    const states: NoLayoutState[] = ['no-venue', 'no-age-group', 'season-unresolved', 'season-ambiguous', 'not-drawn', 'slot-count']
    for (const s of states) expect(describeNoLayout(s).length).toBeGreaterThan(20)
    expect(describeNoLayout('no-venue')).toContain('venue')
    expect(describeNoLayout('season-ambiguous')).toContain('more than one season')
    expect(describeNoLayout('not-drawn')).toContain('admin')
    // The slot count state does not point at an admin: nobody can draw a
    // three station layout, because the constraint refuses one.
    expect(describeNoLayout('slot-count')).not.toContain('admin')
  })
})
