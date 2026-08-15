// The one drill filter, shared by the Library and Add from library.
//
// SPEC. The Drill Library and the planner's Add from library modal browse
// the same club library, so they filter it with the same rules. Those rules
// lived inline in Library.tsx; the modal had its own, poorer copy (text
// search only, over a concatenation without separators). This module is the
// single implementation both screens call, with the Library's semantics
// preserved exactly:
//
//  - text search over title, summary, skill and tags, case-insensitive,
//    with the fields space-joined so a query never matches across a field
//    boundary;
//  - corner is an exact match, applied after the other refinements so the
//    corner distribution stays a way to pick a corner;
//  - skill, format and level are exact matches;
//  - theme matches the stored theme OR any topic tag;
//  - age matches when the drill's ages list includes the pick;
//  - every active filter must hold at once (AND, never OR);
//  - sorting is the Library's three: Recent (newest first), A to Z,
//    Shortest, through contentOrder's sortLibraryDrills;
//  - the select options are the FA taxonomy plus every value already
//    stored, so existing free-text values keep appearing.
import { describe, expect, it } from 'vitest'
import type { Drill } from './data'
import { AGES, LEVELS } from './data'
import { FA_FORMATS, FA_PLAYER_SKILLS, FA_THEMES } from './fa'
import {
  applyDrillFilter,
  clearedRefinements,
  countRefinements,
  DEFAULT_DRILL_FILTER,
  drillFilterOptions,
} from './drillFilter'
import type { DrillFilter } from './drillFilter'

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

const ids = (drills: readonly Drill[], filter: DrillFilter): string[] =>
  applyDrillFilter(drills, filter).results.map((d) => d.id)

describe('text search', () => {
  const rondo = drill({
    id: 'rondo',
    title: 'Rondo keep-ball',
    skill: 'Passing',
    summary: 'Quick transitions under pressure.',
    tags: ['rondo'],
  })
  const shield = drill({ id: 'shield', title: 'Shield and steal', skill: 'Tackling' })
  const all = [rondo, shield]

  it('matches the title, case-insensitively', () => {
    expect(ids(all, f({ q: 'RONDO KEEP' }))).toEqual(['rondo'])
  })

  it('matches the summary, which the old modal never searched', () => {
    expect(ids(all, f({ q: 'transitions' }))).toEqual(['rondo'])
  })

  it('matches the skill and the tags', () => {
    expect(ids(all, f({ q: 'tackling' }))).toEqual(['shield'])
    expect(ids(all, f({ q: 'rondo' }))).toEqual(['rondo'])
  })

  it('never matches across a field boundary, unlike the old concatenation', () => {
    // The old modal searched title + skill + tags with no separator, so
    // 'ballpassing' matched this drill through 'keep-ballPassing'.
    expect(ids(all, f({ q: 'ballpassing' }))).toEqual([])
  })

  it('excludes what nothing contains', () => {
    expect(ids(all, f({ q: 'gymnastics' }))).toEqual([])
  })
})

describe('corner', () => {
  const tech = drill({ id: 'tech', title: 'A', corner: 'technical' })
  const phys = drill({ id: 'phys', title: 'B', corner: 'physical' })
  const unclassified = drill({ id: 'none', title: 'C' })
  const all = [tech, phys, unclassified]

  it('keeps only the picked corner and drops the unclassified', () => {
    expect(ids(all, f({ corner: 'physical' }))).toEqual(['phys'])
  })

  it('keeps everything when no corner is picked', () => {
    expect(ids(all, f({}))).toHaveLength(3)
  })
})

describe('age', () => {
  const spread = drill({ id: 'spread', title: 'A', ages: ['U8', 'U10'] })
  const single = drill({ id: 'single', title: 'B', ages: ['U9'] })
  const all = [spread, single]

  it('matches any listed age, not only the first', () => {
    expect(ids(all, f({ age: 'U10' }))).toEqual(['spread'])
  })

  it('excludes a drill whose ages do not include the pick', () => {
    expect(ids(all, f({ age: 'U7' }))).toEqual([])
  })
})

describe('theme', () => {
  const themed = drill({ id: 'themed', title: 'A', theme: 'Attacking' })
  const tagged = drill({ id: 'tagged', title: 'B', tags: ['Defending', 'Marking'] })
  const all = [themed, tagged]

  it('matches the stored theme', () => {
    expect(ids(all, f({ theme: 'Attacking' }))).toEqual(['themed'])
  })

  it('matches a topic tag, so FA imports tagged Defending surface under Defending', () => {
    expect(ids(all, f({ theme: 'Marking' }))).toEqual(['tagged'])
  })

  it('excludes a drill matching neither theme nor tags', () => {
    expect(ids(all, f({ theme: 'Goalkeeping' }))).toEqual([])
  })
})

describe('skill, format and level', () => {
  const a = drill({ id: 'a', title: 'A', skill: 'Passing', format: '1-4 per side', level: 'Developing' })
  const b = drill({ id: 'b', title: 'B', skill: 'Pass', format: '5-8 per side', level: 'Advanced' })
  const all = [a, b]

  it('are exact matches, never substring matches', () => {
    expect(ids(all, f({ skill: 'Passing' }))).toEqual(['a'])
    expect(ids(all, f({ skill: 'Pass' }))).toEqual(['b'])
    expect(ids(all, f({ format: '1-4 per side' }))).toEqual(['a'])
    expect(ids(all, f({ level: 'Advanced' }))).toEqual(['b'])
  })

  it('an empty filter keeps everything', () => {
    expect(ids(all, f({}))).toHaveLength(2)
  })
})

describe('combination', () => {
  const skillOnly = drill({ id: 'skill-only', title: 'A', skill: 'Passing', ages: ['U8'] })
  const ageOnly = drill({ id: 'age-only', title: 'B', skill: 'Tackling', ages: ['U10'] })
  const both = drill({ id: 'both', title: 'C', skill: 'Passing', ages: ['U10'] })
  const all = [skillOnly, ageOnly, both]

  it('ANDs every active filter: matching only one is not enough', () => {
    expect(ids(all, f({ skill: 'Passing', age: 'U10' }))).toEqual(['both'])
  })
})

describe('sorting', () => {
  const oldest = drill({ id: 'oldest', title: 'Mirror game', duration: 20, createdAt: '2026-01-01T00:00:00Z' })
  const middle = drill({ id: 'middle', title: 'Attacking waves', duration: 5, createdAt: '2026-02-01T00:00:00Z' })
  const newest = drill({ id: 'newest', title: 'Zonal defending', duration: 10, createdAt: '2026-03-01T00:00:00Z' })
  // Handed over in neither creation nor display order, so the sort is
  // proved to reorder rather than preserve.
  const all = [middle, newest, oldest]

  it('Recent is newest first', () => {
    expect(ids(all, f({ sort: 'recent' }))).toEqual(['newest', 'middle', 'oldest'])
  })

  it('A to Z is alphabetical by title', () => {
    expect(ids(all, f({ sort: 'az' }))).toEqual(['middle', 'oldest', 'newest'])
  })

  it('Shortest is ascending duration', () => {
    expect(ids(all, f({ sort: 'duration' }))).toEqual(['middle', 'newest', 'oldest'])
  })
})

describe('corner counts', () => {
  const tech = drill({ id: 'tech', title: 'A', corner: 'technical', skill: 'Passing' })
  const phys = drill({ id: 'phys', title: 'B', corner: 'physical', skill: 'Tackling' })
  const unclassified = drill({ id: 'none', title: 'C', skill: 'Passing' })
  const all = [tech, phys, unclassified]

  it('respect the other refinements but never the corner filter itself', () => {
    const { cornerCounts } = applyDrillFilter(all, f({ skill: 'Passing', corner: 'physical' }))
    // The skill refinement removes phys; the corner pick removes nothing
    // from the distribution, which stays a way to change corner.
    expect(cornerCounts).toEqual({ technical: 1, physical: 0, social: 0, psychological: 0 })
  })

  it('leave unclassified drills outside the distribution', () => {
    const { cornerCounts } = applyDrillFilter(all, f({}))
    expect(cornerCounts.technical + cornerCounts.physical + cornerCounts.social + cornerCounts.psychological).toBe(2)
  })
})

describe('active refinements', () => {
  it('counts the six refinements, never the search text or the sort', () => {
    expect(countRefinements(f({}))).toBe(0)
    expect(countRefinements(f({ q: 'rondo', sort: 'az' }))).toBe(0)
    expect(
      countRefinements(f({ corner: 'technical', skill: 'Passing', theme: 'Attacking', format: '1-4 per side', age: 'U8', level: 'Foundation' })),
    ).toBe(6)
  })

  it('clearing resets the six and keeps the search text and sort, as the Library Clear does', () => {
    const cleared = clearedRefinements(
      f({ q: 'rondo', sort: 'az', corner: 'technical', skill: 'Passing', theme: 'Attacking', format: '1-4 per side', age: 'U8', level: 'Foundation' }),
    )
    expect(cleared).toEqual(f({ q: 'rondo', sort: 'az' }))
  })
})

describe('filter options', () => {
  const stored = [
    drill({ id: 'a', title: 'A', skill: 'Juggling', theme: 'Set pieces', format: '3v3 arrows', tags: ['Overloads'] }),
  ]

  it('offer the FA taxonomy plus every stored value, so free text keeps appearing', () => {
    const options = drillFilterOptions(stored)
    for (const s of FA_PLAYER_SKILLS) expect(options.skills).toContain(s)
    expect(options.skills).toContain('Juggling')
    for (const t of FA_THEMES) expect(options.themes).toContain(t)
    expect(options.themes).toContain('Set pieces')
    // The theme options carry topic tags too, so an FA import's tag becomes
    // selectable as soon as a drill carries it.
    expect(options.themes).toContain('Overloads')
    for (const fmt of FA_FORMATS) expect(options.formats).toContain(fmt)
    expect(options.formats).toContain('3v3 arrows')
  })

  it('use the club age and level lists unchanged', () => {
    const options = drillFilterOptions(stored)
    expect(options.ages).toEqual(AGES)
    expect(options.levels).toEqual(LEVELS)
  })
})
