import { describe, expect, it } from 'vitest'
import {
  surfaceSize,
  toView,
  arrowHeadPoints,
  arrowShaft,
  wavyPath,
  pitchMarkings,
  goalRect,
  goalHitRect,
  goalOutline,
  zoneHitBand,
  HIT_MIN,
  pointerFraction,
  type Marking,
} from './drillDiagramGeometry'
import type { DiagramSurface } from './drillDiagram'

// The geometry the editor and the read only view SHARE. Everything that turns
// a stored fraction into something on screen lives here, so the two surfaces
// cannot drift apart: a change that moved an element in the editor but not in
// the viewer would have to change this file, and these tests.

const surface = (over: Partial<DiagramSurface> = {}): DiagramSurface => ({
  kind: 'full_pitch',
  orientation: 'portrait',
  ...over,
})

describe('the surface box', () => {
  it('draws a full pitch at real pitch proportions, taller than wide facing up the screen', () => {
    const s = surfaceSize(surface())
    expect(s.height).toBeGreaterThan(s.width)
    expect(s.width / s.height).toBeCloseTo(68 / 105, 2)
  })

  it('turns the pitch on its side when the play runs across the screen', () => {
    const p = surfaceSize(surface())
    const l = surfaceSize(surface({ orientation: 'landscape' }))
    expect(l.width).toBe(p.height)
    expect(l.height).toBe(p.width)
  })

  it('gives a half pitch half the playing length of a full one', () => {
    const full = surfaceSize(surface())
    const half = surfaceSize(surface({ kind: 'half_pitch' }))
    expect(half.width).toBe(full.width)
    expect(half.height).toBeCloseTo(full.height / 2, 0)
  })

  it('gives a blank area its own box, with no pitch proportions to imply', () => {
    const s = surfaceSize(surface({ kind: 'blank' }))
    expect(s.width).toBeGreaterThan(0)
    expect(s.height).toBeGreaterThan(0)
  })

  it('is positive for every surface and orientation', () => {
    for (const kind of ['full_pitch', 'half_pitch', 'blank'] as const) {
      for (const orientation of ['portrait', 'landscape'] as const) {
        const s = surfaceSize({ kind, orientation })
        expect(Number.isFinite(s.width) && s.width > 0).toBe(true)
        expect(Number.isFinite(s.height) && s.height > 0).toBe(true)
      }
    }
  })
})

describe('placing a stored fraction on the surface', () => {
  it('puts nought point five in the middle, whatever the surface', () => {
    for (const kind of ['full_pitch', 'half_pitch', 'blank'] as const) {
      const s = surfaceSize({ kind, orientation: 'portrait' })
      expect(toView({ kind, orientation: 'portrait' }, 0.5, 0.5)).toEqual({ x: s.width / 2, y: s.height / 2 })
    }
  })

  it('puts zero and one on the two edges', () => {
    const s = surfaceSize(surface())
    expect(toView(surface(), 0, 0)).toEqual({ x: 0, y: 0 })
    expect(toView(surface(), 1, 1)).toEqual({ x: s.width, y: s.height })
  })

  it('never leaves the box, even for a value that escaped the model', () => {
    const s = surfaceSize(surface())
    const p = toView(surface(), 4, -4)
    expect(p.x).toBeLessThanOrEqual(s.width)
    expect(p.y).toBeGreaterThanOrEqual(0)
  })

  it('scales with the surface, so the same fraction lands differently on a taller box', () => {
    const p = toView(surface(), 0.5, 0.5)
    const l = toView(surface({ orientation: 'landscape' }), 0.5, 0.5)
    expect(p).not.toEqual(l)
  })
})

describe('turning a pointer position back into a fraction', () => {
  // REGRESSION. The editor used to divide by the SVG element's own box, which
  // is only right while that box has exactly the surface's aspect ratio. It
  // does not: the canvas is capped by max-height as well as max-width, so on a
  // short viewport (a phone held sideways) the box is wider than the pitch and
  // the SVG letterboxes inside it. Every placement then landed away from the
  // finger, by more the shorter the screen. The mapping now does the letterbox
  // arithmetic itself, so no CSS change can move it again.
  const rect = (width: number, height: number, left = 0, top = 0) => ({ left, top, width, height })

  it('reads the centre of a box that matches the surface exactly', () => {
    const s = surfaceSize(surface())
    const f = pointerFraction(surface(), rect(s.width, s.height), s.width / 2, s.height / 2)
    expect(f).toEqual({ x: 0.5, y: 0.5 })
  })

  it('reads the centre of a box that is WIDER than the surface, where the pitch is letterboxed', () => {
    // 400 wide by 200 tall for a portrait pitch: the pitch is drawn 129.5 wide,
    // centred, with bars either side. The middle of the box is still the middle
    // of the pitch.
    const f = pointerFraction(surface(), rect(400, 200), 200, 100)!
    expect(f.x).toBeCloseTo(0.5, 6)
    expect(f.y).toBeCloseTo(0.5, 6)
  })

  it('reads the centre of a box that is TALLER than the surface', () => {
    const f = pointerFraction(surface(), rect(200, 900), 100, 450)!
    expect(f.x).toBeCloseTo(0.5, 6)
    expect(f.y).toBeCloseTo(0.5, 6)
  })

  it('puts the pitch corners at nought and one however the box is shaped', () => {
    for (const [w, h] of [[400, 200], [200, 900], [340, 525], [1000, 1000]]) {
      const s = surfaceSize(surface())
      const scale = Math.min(w / s.width, h / s.height)
      const offX = (w - s.width * scale) / 2
      const offY = (h - s.height * scale) / 2
      const topLeft = pointerFraction(surface(), rect(w, h), offX, offY)!
      expect(topLeft.x, `${w}x${h}`).toBeCloseTo(0, 6)
      expect(topLeft.y, `${w}x${h}`).toBeCloseTo(0, 6)
      const bottomRight = pointerFraction(surface(), rect(w, h), offX + s.width * scale, offY + s.height * scale)!
      expect(bottomRight.x, `${w}x${h}`).toBeCloseTo(1, 6)
      expect(bottomRight.y, `${w}x${h}`).toBeCloseTo(1, 6)
    }
  })

  it('accounts for where the box sits on the page', () => {
    const s = surfaceSize(surface())
    const f = pointerFraction(surface(), rect(s.width, s.height, 100, 60), 100 + s.width / 2, 60 + s.height / 2)
    expect(f).toEqual({ x: 0.5, y: 0.5 })
  })

  it('clamps a press in the letterbox bar onto the pitch rather than off it', () => {
    const f = pointerFraction(surface(), rect(400, 200), 2, 100)!
    expect(f.x).toBe(0)
    expect(f.y).toBeGreaterThanOrEqual(0)
    expect(f.y).toBeLessThanOrEqual(1)
  })

  it('gives up rather than guessing when the box has not measured yet', () => {
    expect(pointerFraction(surface(), rect(0, 0), 10, 10)).toBeNull()
    expect(pointerFraction(surface(), rect(300, 0), 10, 10)).toBeNull()
  })

  it('never returns a value that is not a number', () => {
    for (const [w, h] of [[400, 200], [200, 900], [1, 1]]) {
      const f = pointerFraction(surface(), rect(w, h), Number.NaN, 50)
      if (f) {
        expect(Number.isFinite(f.x)).toBe(true)
        expect(Number.isFinite(f.y)).toBe(true)
      }
    }
  })

  it('works for every surface and orientation', () => {
    for (const kind of ['full_pitch', 'half_pitch', 'blank'] as const) {
      for (const orientation of ['portrait', 'landscape'] as const) {
        const f = pointerFraction({ kind, orientation }, rect(500, 300), 250, 150)
        expect(f!.x, `${kind} ${orientation}`).toBeCloseTo(0.5, 6)
        expect(f!.y, `${kind} ${orientation}`).toBeCloseTo(0.5, 6)
      }
    }
  })
})

describe('an arrow', () => {
  it('points from its start towards its end', () => {
    const head = arrowHeadPoints(100, 100, 300, 100)
    const xs = head.map((p) => p.x)
    expect(Math.max(...xs)).toBeCloseTo(300, 5)
  })

  it('has real depth along the vector, so the head is a triangle and not a bar', () => {
    // REGRESSION, found by mutation testing. Collapsing the head's base onto
    // its tip leaves three points that still sit at the arrow's end and still
    // differ between one direction and another, so every earlier check here
    // passed while the arrow had no visible direction at all: it drew a short
    // line across the end. The direction is only visible because the tip is
    // FURTHER ALONG the vector than the base corners, so that is what is
    // measured, by projecting each point onto the unit vector.
    for (const [x1, y1, x2, y2] of [
      [100, 100, 300, 100],
      [300, 100, 100, 100],
      [100, 100, 100, 300],
      [400, 400, 100, 40],
    ]) {
      const len = Math.hypot(x2 - x1, y2 - y1)
      const ux = (x2 - x1) / len
      const uy = (y2 - y1) / len
      const along = arrowHeadPoints(x1, y1, x2, y2).map((p) => p.x * ux + p.y * uy)
      const tip = along[2]
      const base = Math.max(along[0], along[1])
      expect(tip - base, `${x1},${y1} to ${x2},${y2}: the head has no depth`).toBeGreaterThan(8)
    }
  })

  it('has real width across the vector, so the head is a triangle and not a line', () => {
    const across = arrowHeadPoints(100, 100, 300, 100).map((p) => p.y)
    expect(Math.max(...across) - Math.min(...across)).toBeGreaterThan(8)
  })

  it('turns its head with the vector', () => {
    const right = arrowHeadPoints(100, 100, 300, 100)
    const down = arrowHeadPoints(100, 100, 100, 300)
    expect(right).not.toEqual(down)
    expect(Math.max(...down.map((p) => p.y))).toBeCloseTo(300, 5)
  })

  it('produces three finite points, so a head is always drawable', () => {
    for (const [x1, y1, x2, y2] of [
      [0, 0, 100, 100],
      [500, 500, 0, 0],
      [10, 10, 10, 400],
    ]) {
      const head = arrowHeadPoints(x1, y1, x2, y2)
      expect(head).toHaveLength(3)
      for (const p of head) expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true)
    }
  })

  it('still draws a head when the two ends sit on top of each other', () => {
    // A degenerate arrow must not produce NaN and blank the whole diagram.
    const head = arrowHeadPoints(200, 200, 200, 200)
    for (const p of head) expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true)
  })

  it('stops its shaft short of the head, so the line does not show through the tip', () => {
    const shaft = arrowShaft(100, 100, 300, 100)
    expect(shaft.x2).toBeLessThan(300)
    expect(shaft.x2).toBeGreaterThan(100)
  })

  it('keeps a shaft for a very short arrow rather than reversing it', () => {
    const shaft = arrowShaft(100, 100, 104, 100)
    expect(Number.isFinite(shaft.x2) && Number.isFinite(shaft.y2)).toBe(true)
    expect(shaft.x2).toBeGreaterThanOrEqual(100)
  })

  it('draws a dribble as a wave, not a straight line', () => {
    const path = wavyPath(100, 100, 400, 100)
    expect(path.startsWith('M')).toBe(true)
    // A wave leaves the axis it travels along.
    const ys = [...path.matchAll(/[-\d.]+\s+([-\d.]+)/g)].map((m) => Number(m[1]))
    expect(ys.some((y) => Math.abs(y - 100) > 1)).toBe(true)
  })

  it('produces only finite numbers in a wave, including a degenerate one', () => {
    for (const path of [wavyPath(0, 0, 300, 300), wavyPath(50, 50, 50, 50)]) {
      expect(path).not.toMatch(/NaN|Infinity/)
    }
  })
})

describe('a goal', () => {
  it('spans the fraction of the surface width it was given', () => {
    const s = surfaceSize(surface())
    const g = goalRect(surface(), { type: 'goal', id: 'g1', x: 0.5, y: 0.1, width: 0.5, facing: 'up' })
    expect(g.w).toBeCloseTo(s.width * 0.5, 5)
  })

  it('turns its mouth when it faces sideways', () => {
    const up = goalRect(surface(), { type: 'goal', id: 'g1', x: 0.5, y: 0.5, width: 0.3, facing: 'up' })
    const left = goalRect(surface(), { type: 'goal', id: 'g1', x: 0.5, y: 0.5, width: 0.3, facing: 'left' })
    expect(up.w).not.toBeCloseTo(left.w, 3)
    expect(up.h).not.toBeCloseTo(left.h, 3)
  })

  it('is centred on its stored point', () => {
    const s = surfaceSize(surface())
    const g = goalRect(surface(), { type: 'goal', id: 'g1', x: 0.5, y: 0.5, width: 0.3, facing: 'up' })
    expect(g.x + g.w / 2).toBeCloseTo(s.width / 2, 5)
    expect(g.y + g.h / 2).toBeCloseTo(s.height / 2, 5)
  })
})

describe('what a finger can grab', () => {
  // REGRESSION, both of these. The first is the one that stopped a coach
  // building the drill they came for.
  it('gives a goal a target no thinner than a thumb, whichever way it faces', () => {
    // A goal is 34 units deep, which is about 12 CSS pixels on a phone: it was
    // a thin strip that could only be grabbed by aiming at the goal line, and
    // with a tool armed the taps that missed dropped a cone just above it.
    for (const facing of ['up', 'down', 'left', 'right'] as const) {
      const r = goalHitRect(surface(), { type: 'goal', id: 'g1', x: 0.5, y: 0.5, width: 0.24, facing })
      expect(Math.min(r.w, r.h), facing).toBeGreaterThanOrEqual(HIT_MIN)
    }
  })

  it('keeps the goal target centred on the goal, so it grows both ways', () => {
    const g = goalRect(surface(), { type: 'goal', id: 'g1', x: 0.5, y: 0.5, width: 0.24, facing: 'up' })
    const r = goalHitRect(surface(), { type: 'goal', id: 'g1', x: 0.5, y: 0.5, width: 0.24, facing: 'up' })
    expect(r.x + r.w / 2).toBeCloseTo(g.x + g.w / 2, 5)
    expect(r.y + r.h / 2).toBeCloseTo(g.y + g.h / 2, 5)
  })

  it('never shrinks a goal target that is already big enough', () => {
    const wide = { type: 'goal' as const, id: 'g1', x: 0.5, y: 0.5, width: 0.6, facing: 'up' as const }
    expect(goalHitRect(surface(), wide).w).toBeGreaterThanOrEqual(goalRect(surface(), wide).w)
  })

  it('makes a zone grabbable by its edge, and lets a tap inside pass through', () => {
    // THE ONE THAT BLOCKED THE DRILL. A zone's target used to be its whole
    // filled rectangle, painted over everything under it, so with the Cone tool
    // armed a tap inside a zone added nothing at all: the canvas saw a press on
    // an element and returned. A coach could not put a single cone inside the
    // area they had just drawn, which is the first thing anyone does. The
    // target is now the BORDER, so the inside belongs to whatever is under it.
    const band = zoneHitBand(surface(), { type: 'zone', id: 'z1', x: 0.2, y: 0.2, w: 0.5, h: 0.4, colour: 'yellow' })
    expect(band.strokeWidth).toBeGreaterThanOrEqual(HIT_MIN)
    expect(band.fill).toBe('none')
  })

  it('gives the zone border a target on both sides of the line', () => {
    const z = { type: 'zone' as const, id: 'z1', x: 0.2, y: 0.2, w: 0.5, h: 0.4, colour: 'yellow' as const }
    const band = zoneHitBand(surface(), z)
    const rect = { x: band.x, y: band.y, w: band.w, h: band.h }
    const drawn = toView(surface(), z.x, z.y)
    // The band is the zone's own rectangle; the thick stroke straddles it.
    expect(rect.x).toBeCloseTo(drawn.x, 5)
    expect(rect.y).toBeCloseTo(drawn.y, 5)
  })
})

describe('the pitch markings', () => {
  const kinds = (m: Marking[]) => m.map((x) => x.shape)

  it('draws a full pitch with a halfway line, a centre circle and two penalty areas', () => {
    const m = pitchMarkings(surface())
    expect(kinds(m)).toContain('line')
    expect(kinds(m)).toContain('circle')
    // Boundary, two penalty areas, two goal areas.
    expect(m.filter((x) => x.shape === 'rect').length).toBeGreaterThanOrEqual(5)
  })

  it('draws a half pitch with one penalty area and no second one', () => {
    const full = pitchMarkings(surface()).filter((x) => x.shape === 'rect').length
    const half = pitchMarkings(surface({ kind: 'half_pitch' })).filter((x) => x.shape === 'rect').length
    expect(half).toBeLessThan(full)
    expect(half).toBeGreaterThanOrEqual(3)
  })

  it('draws nothing on a blank area', () => {
    expect(pitchMarkings(surface({ kind: 'blank' }))).toEqual([])
  })

  it('keeps every unclipped marking inside its own surface box', () => {
    // A clipped marking is exempt on purpose: the half pitch centre circle is
    // drawn whole and clipped to the pitch so it reads as a semicircle, so it
    // is meant to overhang. The next test pins that it is the only one, and
    // that it sits where a semicircle would.
    for (const kind of ['full_pitch', 'half_pitch'] as const) {
      for (const orientation of ['portrait', 'landscape'] as const) {
        const s = surfaceSize({ kind, orientation })
        for (const m of pitchMarkings({ kind, orientation })) {
          if (m.shape === 'circle' && m.clip) continue
          const xs = m.shape === 'rect' ? [m.x, m.x + m.w] : m.shape === 'line' ? [m.x1, m.x2] : [m.cx - m.r, m.cx + m.r]
          const ys = m.shape === 'rect' ? [m.y, m.y + m.h] : m.shape === 'line' ? [m.y1, m.y2] : [m.cy - m.r, m.cy + m.r]
          for (const x of xs) expect(x, `${kind} ${orientation} ${m.shape} x`).toBeGreaterThanOrEqual(-40)
          for (const x of xs) expect(x, `${kind} ${orientation} ${m.shape} x`).toBeLessThanOrEqual(s.width + 40)
          for (const y of ys) expect(y, `${kind} ${orientation} ${m.shape} y`).toBeGreaterThanOrEqual(-40)
          for (const y of ys) expect(y, `${kind} ${orientation} ${m.shape} y`).toBeLessThanOrEqual(s.height + 40)
        }
      }
    }
  })

  it('clips only the half pitch centre circle, and centres it on the open edge', () => {
    // A full pitch clips nothing: its centre circle is wholly inside.
    expect(pitchMarkings(surface()).filter((m) => m.shape === 'circle' && m.clip)).toEqual([])
    const clipped = pitchMarkings(surface({ kind: 'half_pitch' })).filter((m) => m.shape === 'circle' && m.clip)
    expect(clipped).toHaveLength(1)
    const s = surfaceSize(surface({ kind: 'half_pitch' }))
    // Centred on the halfway edge, which is what makes the visible half a
    // semicircle rather than an arc floating on the grass.
    expect(clipped[0].shape === 'circle' && clipped[0].cy).toBeCloseTo(s.height - 30, 5)
  })

  it('turns the markings with the pitch, so a landscape pitch is not a stretched portrait one', () => {
    const p = JSON.stringify(pitchMarkings(surface()))
    const l = JSON.stringify(pitchMarkings(surface({ orientation: 'landscape' })))
    expect(p).not.toBe(l)
  })

  it('keeps the centre circle a circle in both orientations', () => {
    for (const orientation of ['portrait', 'landscape'] as const) {
      const circles = pitchMarkings(surface({ orientation })).filter((m) => m.shape === 'circle')
      expect(circles.length).toBeGreaterThan(0)
      for (const c of circles) expect(c.r).toBeGreaterThan(0)
    }
  })

  it('produces only finite numbers', () => {
    for (const kind of ['full_pitch', 'half_pitch', 'blank'] as const) {
      expect(JSON.stringify(pitchMarkings({ kind, orientation: 'portrait' }))).not.toMatch(/null|NaN/)
    }
  })
})

describe('a goal keeps its size when the pitch is turned', () => {
  it('means the same real mouth in both orientations', () => {
    // REGRESSION. The mouth was a fraction of the SCREEN width, which swaps
    // with the orientation, so turning the pitch grew a goal by half. It is a
    // fraction of the pitch's across measure, which does not.
    const goal = { type: 'goal' as const, id: 'goal-1', x: 0.5, y: 0.2, width: 0.24, facing: 'up' as const }
    const across = 680
    for (const orientation of ['portrait', 'landscape'] as const) {
      const g = goalRect({ kind: 'full_pitch', orientation }, goal)
      expect(Math.max(g.w, g.h), orientation).toBeCloseTo(0.24 * across, 5)
    }
  })

  it('means the same real mouth whichever way it faces', () => {
    const base = { type: 'goal' as const, id: 'goal-1', x: 0.5, y: 0.5, width: 0.3 }
    const up = goalRect(surface(), { ...base, facing: 'up' })
    const left = goalRect(surface(), { ...base, facing: 'left' })
    expect(Math.max(up.w, up.h)).toBeCloseTo(Math.max(left.w, left.h), 5)
  })
})

describe('a goal shows which way it faces', () => {
  // REGRESSION. The goal was a closed rectangle whose only nod to direction was
  // a sideways boolean, so Up and Down drew the same picture and so did Left
  // and Right. A coach could pick Down, watch nothing change, and save a drill
  // that could not say which way the goal pointed.
  const goal = (facing: 'up' | 'down' | 'left' | 'right') => ({
    type: 'goal' as const,
    id: 'goal-1',
    x: 0.5,
    y: 0.5,
    width: 0.24,
    facing,
  })

  it('draws a different outline for each of the four directions', () => {
    const paths = (['up', 'down', 'left', 'right'] as const).map((f) => goalOutline(surface(), goal(f)))
    expect(new Set(paths).size).toBe(4)
  })

  it('leaves the mouth open, so the outline is three sides and not four', () => {
    for (const f of ['up', 'down', 'left', 'right'] as const) {
      const path = goalOutline(surface(), goal(f))
      // Four points, three segments: a closed rectangle would need five or a Z.
      expect(path.match(/[ML]/g), f).toHaveLength(4)
      expect(path, f).not.toContain('Z')
    }
  })

  it('never puts a NaN in the path', () => {
    for (const f of ['up', 'down', 'left', 'right'] as const) {
      expect(goalOutline(surface(), goal(f))).not.toMatch(/NaN|Infinity/)
    }
  })
})
