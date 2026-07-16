import { describe, expect, it } from 'vitest'
import { compareNewestFirst, newestFirst, oldestFirst, relatedDrills, sortLibraryDrills } from './contentOrder'

// Minimal drill-shaped rows: the sorts only read id, createdAt, title and
// duration. Built oldest first so a pass-through would look like the old
// ascending read and fail the newest first assertions.
const drills = [
  { id: 'd1', createdAt: '2026-01-05T10:00:00Z', title: 'Rondo', duration: 15 },
  { id: 'd2', createdAt: '2026-03-20T10:00:00Z', title: 'Arrival activity', duration: 10 },
  { id: 'd3', createdAt: '2026-07-01T10:00:00Z', title: 'Finishing circuit', duration: 25 },
]

describe('newestFirst', () => {
  it('puts the newest item first', () => {
    expect(newestFirst(drills).map((d) => d.id)).toEqual(['d3', 'd2', 'd1'])
  })

  it('does not rely on the incoming order', () => {
    const shuffled = [drills[1], drills[2], drills[0]]
    expect(newestFirst(shuffled).map((d) => d.id)).toEqual(['d3', 'd2', 'd1'])
  })

  it('breaks equal timestamps deterministically by id', () => {
    const when = '2026-06-01T09:00:00Z'
    const a = { id: 'aaa', createdAt: when }
    const b = { id: 'bbb', createdAt: when }
    expect(newestFirst([a, b]).map((d) => d.id)).toEqual(['aaa', 'bbb'])
    expect(newestFirst([b, a]).map((d) => d.id)).toEqual(['aaa', 'bbb'])
  })

  it('sinks missing or unparseable created_at values without crashing', () => {
    const items = [
      { id: 'missing', createdAt: undefined },
      { id: 'valid', createdAt: '2026-02-02T00:00:00Z' },
      { id: 'garbage', createdAt: 'not a date' },
    ]
    expect(newestFirst(items).map((d) => d.id)).toEqual(['valid', 'garbage', 'missing'])
  })

  it('does not mutate its input', () => {
    const input = [...drills]
    newestFirst(input)
    expect(input.map((d) => d.id)).toEqual(['d1', 'd2', 'd3'])
  })
})

describe('oldestFirst', () => {
  // The FA attach fallback and the programme week dedupe depend on creation
  // order; oldestFirst restores it from a newest first list.
  it('restores creation order from a newest first list', () => {
    expect(oldestFirst(newestFirst(drills)).map((d) => d.id)).toEqual(['d1', 'd2', 'd3'])
  })

  it('breaks equal timestamps by id, same direction as the old read', () => {
    const when = '2026-06-01T09:00:00Z'
    const a = { id: 'aaa', createdAt: when }
    const b = { id: 'bbb', createdAt: when }
    expect(oldestFirst([b, a]).map((d) => d.id)).toEqual(['aaa', 'bbb'])
  })
})

describe('sortLibraryDrills', () => {
  it('Recent sorts newest first whatever order the read returned', () => {
    expect(sortLibraryDrills(drills, 'recent').map((d) => d.id)).toEqual(['d3', 'd2', 'd1'])
    expect(sortLibraryDrills([drills[2], drills[0], drills[1]], 'recent').map((d) => d.id)).toEqual([
      'd3',
      'd2',
      'd1',
    ])
  })

  it('A to Z stays alphabetical by title', () => {
    expect(sortLibraryDrills(drills, 'az').map((d) => d.title)).toEqual([
      'Arrival activity',
      'Finishing circuit',
      'Rondo',
    ])
  })

  it('Shortest stays ordered by ascending duration', () => {
    expect(sortLibraryDrills(drills, 'duration').map((d) => d.duration)).toEqual([10, 15, 25])
  })
})

describe('compareNewestFirst', () => {
  // The hooks re-sort every content list read (drills, media, templates,
  // programmes) through this one comparator, so media, template and
  // programme shaped rows order newest first the same way drills do.
  it('orders media, template and programme shaped rows newest first', () => {
    const media = [
      { id: 'm-old', name: 'Old diagram', type: 'image', createdAt: '2025-11-01T00:00:00Z' },
      { id: 'm-new', name: 'New clip', type: 'video', createdAt: '2026-06-30T00:00:00Z' },
    ]
    const templates = [
      { id: 't-old', name: 'Autumn shell', activities: [], createdAt: '2025-09-01T00:00:00Z' },
      { id: 't-new', name: 'Summer shell', activities: [], createdAt: '2026-07-01T00:00:00Z' },
    ]
    const programmes = [
      { id: 'p-old', name: 'Ball mastery', weeks: 6, createdAt: '2026-01-01T00:00:00Z' },
      { id: 'p-new', name: 'Defending', weeks: 6, createdAt: '2026-05-01T00:00:00Z' },
    ]
    expect([...media].sort(compareNewestFirst)[0].id).toBe('m-new')
    expect([...templates].sort(compareNewestFirst)[0].id).toBe('t-new')
    expect([...programmes].sort(compareNewestFirst)[0].id).toBe('p-new')
  })
})

describe('full precision tie-breaks', () => {
  // Date.parse truncates the database's microsecond timestamps to
  // milliseconds. Rows written in one burst tie on the parsed value, so the
  // comparator must fall to the raw strings, which sort chronologically at
  // full precision, before it ever reaches the id. The ids here deliberately
  // disagree with the microsecond order.
  const early = { id: 'zzz', createdAt: '2026-06-01T09:00:00.123456+00:00' }
  const late = { id: 'aaa', createdAt: '2026-06-01T09:00:00.123789+00:00' }

  it('newestFirst orders same-millisecond rows by the raw timestamp, not the id', () => {
    expect(newestFirst([early, late]).map((d) => d.id)).toEqual(['aaa', 'zzz'])
    expect(newestFirst([late, early]).map((d) => d.id)).toEqual(['aaa', 'zzz'])
  })

  it('oldestFirst restores true creation order for same-millisecond rows', () => {
    expect(oldestFirst([late, early]).map((d) => d.id)).toEqual(['zzz', 'aaa'])
  })
})

describe('library tie order', () => {
  // Equal primary keys keep creation order, oldest first, whatever order the
  // read returned: the tie order the screen had when the reads were
  // ascending, held steady as new drills arrive.
  const oldTen = { id: 'd-old', createdAt: '2026-01-01T00:00:00Z', title: 'Same title', duration: 10 }
  const newTen = { id: 'd-new', createdAt: '2026-05-01T00:00:00Z', title: 'Same title', duration: 10 }

  it('equal durations list oldest first under Shortest', () => {
    expect(sortLibraryDrills([newTen, oldTen], 'duration').map((d) => d.id)).toEqual(['d-old', 'd-new'])
    expect(sortLibraryDrills([oldTen, newTen], 'duration').map((d) => d.id)).toEqual(['d-old', 'd-new'])
  })

  it('identical titles list oldest first under A to Z', () => {
    expect(sortLibraryDrills([newTen, oldTen], 'az').map((d) => d.id)).toEqual(['d-old', 'd-new'])
  })
})

describe('relatedDrills', () => {
  // Related drills stay in creation order: the list reads flipped to newest
  // first, but the three related drills a page shows must not change with
  // them. Four candidates share the drill's corner, so oldest first and
  // newest first would pick different threes.
  function drill(id: string, createdAt: string, over: Partial<{ corner: string | null; skill: string; tags: string[] }> = {}) {
    return { id, createdAt, corner: 'technical' as string | null, skill: '', tags: [] as string[], ...over }
  }

  const subject = drill('subject', '2026-01-01T00:00:00Z')
  const r1 = drill('r1', '2026-01-02T00:00:00Z')
  const r2 = drill('r2', '2026-02-02T00:00:00Z')
  const r3 = drill('r3', '2026-03-02T00:00:00Z')
  const r4 = drill('r4', '2026-04-02T00:00:00Z')

  it('picks the three oldest matches even from a newest first list', () => {
    // The list arrives newest first, the order useDrills now returns; a
    // pass-through slice would pick r4, r3, r2.
    const newestFirstList = [r4, r3, r2, r1, subject]
    expect(relatedDrills(subject, newestFirstList).map((d) => d.id)).toEqual(['r1', 'r2', 'r3'])
  })

  it('never relates through a missing corner or skill', () => {
    const bare = drill('bare', '2026-01-05T00:00:00Z', { corner: null })
    const other = drill('other', '2026-01-06T00:00:00Z', { corner: null })
    expect(relatedDrills(bare, [other, bare])).toEqual([])
  })

  it('relates FA drills through overlapping topic tags', () => {
    const fa = drill('fa', '2026-01-05T00:00:00Z', { corner: null, tags: ['Defending'] })
    const match = drill('match', '2026-01-06T00:00:00Z', { corner: null, tags: ['Defending'] })
    expect(relatedDrills(fa, [match, fa]).map((d) => d.id)).toEqual(['match'])
  })
})
