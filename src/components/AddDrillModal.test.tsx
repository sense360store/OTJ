// Add from library, rendered as a coach opens it.
//
// The pure halves live in ../lib/drillFilter and ../lib/drillPicker and are
// proved there. This file proves the SCREEN uses them: the same adversarial
// lesson as trainingFirst.screens.test.tsx, where every seam was correct and
// a container quietly stopped calling one. There is no DOM in this project,
// so this is static render only. What a click would change is proved on the
// pure model; what this file proves is what the modal SHOWS for a given
// state, reached through the `initial` seam the way a default value opens an
// uncontrolled input.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Drill } from '../lib/data'
import type { AddDrillModalInitial } from './AddDrillModal'

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

// Newest first, the order useDrills returns.
const RONDO = drill({
  id: 'd-rondo',
  title: 'Rondo keep-ball',
  corner: 'technical',
  skill: 'Passing',
  summary: 'Quick transitions under pressure.',
  tags: ['rondo'],
  ages: ['U8', 'U10'],
  level: 'Developing',
  duration: 15,
  format: '1-4 per side',
  createdAt: '2026-03-01T00:00:00Z',
})
const JUGGLE = drill({
  id: 'd-juggle',
  title: 'Juggling ladder',
  skill: 'Juggling',
  ages: ['U10'],
  duration: 5,
  createdAt: '2026-02-01T00:00:00Z',
})
const SHIELD = drill({
  id: 'd-shield',
  title: 'Shield and steal',
  corner: 'physical',
  skill: 'Tackling',
  tags: ['Defending'],
  ages: ['U9'],
  duration: 10,
  createdAt: '2026-01-01T00:00:00Z',
})

let drills: Drill[] = []

vi.mock('../lib/queries', () => ({
  useDrills: () => ({ data: drills, isLoading: false }),
  useMediaMap: () => ({}),
  // MediaThumb (ui.tsx) reads this from the same module; the rows here carry
  // no media, so a dead signed-URL hook is all the render needs.
  useMediaSrc: () => ({ src: null, isLoading: false, broken: false, onError: () => {}, onLoad: () => {} }),
}))

const { AddDrillModal } = await import('./AddDrillModal')

const noop = () => {}
const html = (initial?: AddDrillModalInitial) =>
  renderToStaticMarkup(<AddDrillModal onClose={noop} onAdd={noop} initial={initial} />)

beforeEach(() => {
  drills = [RONDO, JUGGLE, SHIELD]
})

describe('as it opens', () => {
  it('browses the whole library with the Library controls', () => {
    const out = html()
    expect(out).toContain('Search drills, skills or tags…')
    expect(out).toContain('Sort: Recent')
    for (const label of ['Technical', 'Physical', 'Social', 'Psychological']) expect(out).toContain(label)
    expect(out).toContain('Refine')
    for (const d of drills) expect(out).toContain(d.title)
  })

  it('lays the results out through the one-column responsive grid, never a hard two column split', () => {
    const out = html()
    expect(out).toContain('add-drill-grid')
    // The old defect was an inline style forcing 1fr 1fr at every width.
    expect(out).not.toContain('grid-template-columns')
  })

  it('shows Recent order, newest first', () => {
    const out = html()
    expect(out.indexOf('Rondo keep-ball')).toBeLessThan(out.indexOf('Juggling ladder'))
    expect(out.indexOf('Juggling ladder')).toBeLessThan(out.indexOf('Shield and steal'))
  })

  it('marks nothing selected', () => {
    expect(html()).not.toContain('aria-pressed="true"')
  })
})

describe('filtering, through the shared Library semantics', () => {
  it('search reaches the summary', () => {
    const out = html({ filter: { q: 'transitions' } })
    expect(out).toContain('Rondo keep-ball')
    expect(out).not.toContain('Shield and steal')
  })

  it('search never matches across a field boundary', () => {
    // The old concatenation matched 'ballpassing' through 'keep-ballPassing'.
    const out = html({ filter: { q: 'ballpassing' } })
    expect(out).not.toContain('Rondo keep-ball')
    expect(out).toContain('No drills match')
  })

  it('corner narrows to the picked corner', () => {
    const out = html({ filter: { corner: 'physical' } })
    expect(out).toContain('Shield and steal')
    expect(out).not.toContain('Rondo keep-ball')
    expect(out).not.toContain('Juggling ladder')
  })

  it('age matches any listed age, not only the first', () => {
    const out = html({ filter: { age: 'U10' } })
    expect(out).toContain('Rondo keep-ball')
    expect(out).toContain('Juggling ladder')
    expect(out).not.toContain('Shield and steal')
  })

  it('theme matches a topic tag', () => {
    const out = html({ filter: { theme: 'Defending' } })
    expect(out).toContain('Shield and steal')
    expect(out).not.toContain('Rondo keep-ball')
  })

  it('active filters AND together', () => {
    // Rondo matches the skill only, Shield the age only: neither survives.
    const out = html({ filter: { skill: 'Passing', age: 'U9' } })
    expect(out).toContain('No drills match')
  })

  it('the other sorts follow the Library', () => {
    const az = html({ filter: { sort: 'az' } })
    expect(az.indexOf('Juggling ladder')).toBeLessThan(az.indexOf('Rondo keep-ball'))
    expect(az.indexOf('Rondo keep-ball')).toBeLessThan(az.indexOf('Shield and steal'))
    const shortest = html({ filter: { sort: 'duration' } })
    expect(shortest.indexOf('Juggling ladder')).toBeLessThan(shortest.indexOf('Shield and steal'))
    expect(shortest.indexOf('Shield and steal')).toBeLessThan(shortest.indexOf('Rondo keep-ball'))
  })

  it('offers stored taxonomy values, not only the FA lists', () => {
    // The option markup, not the word: 'Juggling' also appears in a title.
    const out = html({ refineOpen: true })
    expect(out).toContain('value="Juggling"')
    expect(out).toContain('value="Passing"')
    // Collapsed, the refine selects are not rendered at all.
    expect(html()).not.toContain('value="Juggling"')
  })
})

describe('selection', () => {
  it('keeps a drill the filter hides selected, counted and announced', () => {
    const out = html({ picked: { 'd-rondo': true, 'd-shield': true }, filter: { skill: 'Tackling' } })
    // The visible row is unmistakably selected.
    expect(out).toContain('aria-pressed="true"')
    // The Add count is the whole set, not the visible rows.
    expect(out).toContain('Add 2 drills')
    // The hidden half is said out loud rather than left to surprise.
    expect(out).toContain('2 selected')
    expect(out).toContain('1 hidden by filters')
  })

  it('counts every selected drill when all are visible, with nothing hidden to announce', () => {
    const out = html({ picked: { 'd-rondo': true, 'd-juggle': true } })
    expect(out).toContain('Add 2 drills')
    expect(out).not.toContain('hidden by filters')
  })

  it('neither counts nor announces a selection the library no longer holds', () => {
    // A drill deleted while the modal was open. Confirm will not add it, so
    // the button must not promise it, and it is not "hidden by filters".
    const out = html({ picked: { 'd-rondo': true, ghost: true } })
    expect(out).toContain('Add 1 drill')
    expect(out).not.toContain('Add 2 drills')
    expect(out).not.toContain('hidden by filters')
  })
})

describe('clearing', () => {
  it('offers Clear once refinements are active', () => {
    const out = html({ filter: { corner: 'technical', age: 'U8' } })
    expect(out).toContain('Clear (2)')
  })

  it('offers no Clear when only the search text is set, as the Library does', () => {
    const out = html({ filter: { q: 'rondo' } })
    expect(out).not.toContain('Clear (')
  })
})

describe('empty states', () => {
  it('a library with drills that match nothing offers a way out', () => {
    const out = html({ filter: { q: 'zzz nothing' } })
    expect(out).toContain('No drills match')
    expect(out).toContain('Clear search and filters')
    expect(out).not.toContain('The library is empty')
  })

  it('an empty library says so instead of pretending filters are the problem', () => {
    drills = []
    const out = html()
    expect(out).toContain('The library is empty')
    expect(out).not.toContain('No drills match')
    expect(out).not.toContain('Clear search and filters')
  })
})
