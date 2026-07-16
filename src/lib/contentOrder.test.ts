import { describe, expect, it } from 'vitest'
import { compareNewestFirst, newestFirst, oldestFirst, sortLibraryDrills } from './contentOrder'

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
