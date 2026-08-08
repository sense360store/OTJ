// Three realistic drill layouts, the renderer's and the tests' shared
// fixtures. Deliberately shipped: the renderer's empty states and the
// editor's examples read them, and keeping them beside the model keeps them
// honest against it (the tests assert each one validates). All content is
// generic coaching material; labels are positional tags, never names.
import type { DrillLayout } from './drillLayout'

// A 12 by 12 passing square: four cones, four players, one ball, the
// passing pattern drawn solid. One phase.
export const FIXTURE_PASSING_SQUARE: DrillLayout = {
  version: 1,
  area: { width: 12, length: 12 },
  frames: [
    {
      entities: [
        { id: 'c1', kind: 'cone', x: 1, y: 1 },
        { id: 'c2', kind: 'cone', x: 11, y: 1 },
        { id: 'c3', kind: 'cone', x: 11, y: 11 },
        { id: 'c4', kind: 'cone', x: 1, y: 11 },
        { id: 'p1', kind: 'player', team: 'attack', label: 'A', x: 1.6, y: 1.6 },
        { id: 'p2', kind: 'player', team: 'attack', label: 'B', x: 10.4, y: 1.6 },
        { id: 'p3', kind: 'player', team: 'attack', label: 'C', x: 10.4, y: 10.4 },
        { id: 'p4', kind: 'player', team: 'attack', label: 'D', x: 1.6, y: 10.4 },
        { id: 'b1', kind: 'ball', x: 2.2, y: 2 },
      ],
      zones: [],
      arrows: [
        { id: 'a1', kind: 'pass', from: { x: 2, y: 2 }, to: { x: 10, y: 2 } },
        { id: 'a2', kind: 'pass', from: { x: 10.4, y: 2.4 }, to: { x: 10.4, y: 9.6 } },
        { id: 'a3', kind: 'pass', from: { x: 10, y: 10.4 }, to: { x: 2.4, y: 10.4 } },
        { id: 'a4', kind: 'pass', from: { x: 1.6, y: 10 }, to: { x: 1.6, y: 2.4 } },
      ],
      note: 'Pass and follow. Two touches, then one.',
    },
  ],
}

// A 15 by 10 1v1 to a mini goal, two phases sharing the pieces: the feed,
// then the duel, the defender's recovery run dashed.
export const FIXTURE_ONE_V_ONE: DrillLayout = {
  version: 1,
  area: { width: 15, length: 10 },
  frames: [
    {
      entities: [
        { id: 'g1', kind: 'mini_goal', x: 14, y: 5, rotation: 90 },
        { id: 'srv', kind: 'player', team: 'neutral', label: 'S', x: 1, y: 5 },
        { id: 'att', kind: 'player', team: 'attack', label: 'A', x: 4, y: 5 },
        { id: 'def', kind: 'player', team: 'defence', label: 'D', x: 12, y: 5 },
        { id: 'b1', kind: 'ball', x: 1.5, y: 5 },
      ],
      zones: [{ id: 'z1', x: 3, y: 1, width: 11, height: 8, label: 'Duel zone' }],
      arrows: [{ id: 'a1', kind: 'pass', from: { x: 1.5, y: 5 }, to: { x: 4, y: 5 } }],
      note: 'Server feeds the attacker to start the duel.',
    },
    {
      entities: [
        { id: 'g1', kind: 'mini_goal', x: 14, y: 5, rotation: 90 },
        { id: 'srv', kind: 'player', team: 'neutral', label: 'S', x: 1, y: 5 },
        { id: 'att', kind: 'player', team: 'attack', label: 'A', x: 8, y: 4 },
        { id: 'def', kind: 'player', team: 'defence', label: 'D', x: 10, y: 5 },
        { id: 'b1', kind: 'ball', x: 8.4, y: 4.2 },
      ],
      zones: [{ id: 'z1', x: 3, y: 1, width: 11, height: 8, label: 'Duel zone' }],
      arrows: [
        { id: 'a1', kind: 'dribble', from: { x: 8.4, y: 4.2 }, to: { x: 12.5, y: 4.5 } },
        { id: 'a2', kind: 'run', from: { x: 10, y: 5 }, to: { x: 12.5, y: 5 } },
        { id: 'a3', kind: 'shot', from: { x: 12.5, y: 4.5 }, to: { x: 14, y: 5 } },
      ],
      note: 'Attacker takes on the defender and finishes.',
    },
  ],
}

// A 30 by 20 small sided game: two goals, four a side plus keepers, a
// halfway zone. One phase.
export const FIXTURE_SMALL_SIDED_GAME: DrillLayout = {
  version: 1,
  area: { width: 30, length: 20 },
  frames: [
    {
      entities: [
        { id: 'gl', kind: 'goal', x: 0.8, y: 10, rotation: 270 },
        { id: 'gr', kind: 'goal', x: 29.2, y: 10, rotation: 90 },
        { id: 'gk1', kind: 'player', team: 'attack', label: 'GK', x: 2, y: 10 },
        { id: 'gk2', kind: 'player', team: 'defence', label: 'GK', x: 28, y: 10 },
        { id: 'h1', kind: 'player', team: 'attack', x: 8, y: 5 },
        { id: 'h2', kind: 'player', team: 'attack', x: 8, y: 15 },
        { id: 'h3', kind: 'player', team: 'attack', x: 13, y: 8 },
        { id: 'h4', kind: 'player', team: 'attack', x: 13, y: 12 },
        { id: 'w1', kind: 'player', team: 'defence', x: 22, y: 5 },
        { id: 'w2', kind: 'player', team: 'defence', x: 22, y: 15 },
        { id: 'w3', kind: 'player', team: 'defence', x: 17, y: 8 },
        { id: 'w4', kind: 'player', team: 'defence', x: 17, y: 12 },
        { id: 'b1', kind: 'ball', x: 15, y: 10 },
      ],
      zones: [{ id: 'z1', x: 12, y: 0, width: 6, height: 20, label: 'Midfield build zone' }],
      arrows: [],
      note: 'Four a side plus keepers. Score only after a pass through the build zone.',
    },
  ],
}

export const LAYOUT_FIXTURES = [FIXTURE_PASSING_SQUARE, FIXTURE_ONE_V_ONE, FIXTURE_SMALL_SIDED_GAME] as const
