// The arithmetic that used to live in the stylesheet.
//
// A review of #189 refused `max-width: calc(var(--dd-cap) * var(--dd-ratio, 1))`
// because calc() multiplying two custom properties is dropped whole on engines
// that will not do that arithmetic, iOS Safari 18.x and Chromium before 140
// among them. A dropped width cap leaves the height cap standing alone, which
// is the letterboxed wide-grass box the cap existed to prevent. The
// multiplication moved here, so what these tests pin is that the renderer can
// emit a PLAIN LENGTH and never a calc().
import { describe, expect, it } from 'vitest'
import { DIAGRAM_HEIGHT_CAP, diagramWidthCap } from './drillDiagramSize'
import { surfaceSize } from './drillDiagramGeometry'

const ratioOf = (surface: Parameters<typeof surfaceSize>[0]) => {
  const s = surfaceSize(surface)
  return s.width / s.height
}

describe('the width a height cap implies', () => {
  it('is a plain CSS length, never an expression', () => {
    // The whole point. Nothing an engine has to evaluate, no var(), no calc(),
    // no unit arithmetic: a number and a unit.
    for (const cap of Object.values(DIAGRAM_HEIGHT_CAP)) {
      const out = diagramWidthCap(cap, 0.75)
      expect(out, cap).toMatch(/^\d+(\.\d+)?(px|vh)$/)
      expect(out).not.toContain('calc')
      expect(out).not.toContain('var(')
      expect(out).not.toContain('*')
    }
  })

  it('keeps the cap in its own unit, so a viewport cap stays a viewport cap', () => {
    // 42vh of a phone is a different number of pixels on every phone, which is
    // exactly why the live cap is expressed that way. Converting it to px here
    // would have to guess a viewport.
    expect(diagramWidthCap('42vh', 0.5)).toBe('21vh')
    expect(diagramWidthCap('340px', 0.5)).toBe('170px')
  })

  it('bounds the real session surfaces to the drawing and no more', () => {
    // A portrait full pitch is the tall case the caps exist for: 680 by 1050
    // view units, so its height is about one and a half times its width.
    const portrait = ratioOf({ kind: 'full_pitch', orientation: 'portrait' })
    expect(portrait).toBeLessThan(1)
    // Session day caps at 340px tall, so the box may be at most 340 x ratio
    // wide. Any wider and the difference is grass either side of the pitch.
    expect(diagramWidthCap(DIAGRAM_HEIGHT_CAP.sessionDay, portrait)).toBe('220.1905px')
    expect(diagramWidthCap(DIAGRAM_HEIGHT_CAP.live, portrait)).toBe('27.2vh')
  })

  it('leaves a landscape surface wider than it is tall', () => {
    const landscape = ratioOf({ kind: 'full_pitch', orientation: 'landscape' })
    expect(landscape).toBeGreaterThan(1)
    const width = diagramWidthCap(DIAGRAM_HEIGHT_CAP.sessionDay, landscape)
    // Wider than the height cap, which is what a landscape pitch is. The column
    // is what actually stops it, through .dd-surface's width:100%.
    expect(Number(width!.replace('px', ''))).toBeGreaterThan(340)
  })

  it('is the cap itself for a square surface', () => {
    expect(diagramWidthCap('340px', 1)).toBe('340px')
  })

  it('refuses anything it cannot compute, so the renderer drops BOTH caps', () => {
    // Failing towards an uncapped diagram is deliberate: a large picture is a
    // worse layout than a small one, but a height cap with no width cap is the
    // letterboxed box, which is worse than either.
    for (const bad of ['', 'auto', '340', 'px', 'calc(340px * 2)', '0px', '-10px']) {
      expect(diagramWidthCap(bad, 0.65), bad).toBeUndefined()
    }
    for (const ratio of [0, -1, NaN, Infinity]) {
      expect(diagramWidthCap('340px', ratio), String(ratio)).toBeUndefined()
    }
  })

  it('tolerates the whitespace a hand written cap might carry', () => {
    expect(diagramWidthCap(' 340px ', 0.5)).toBe('170px')
  })
})

describe('the caps themselves', () => {
  it('are lengths this module can actually read', () => {
    // A cap that diagramWidthCap cannot parse would silently uncap its surface,
    // so the constants and the parser are checked against each other rather
    // than assumed to agree.
    for (const cap of Object.values(DIAGRAM_HEIGHT_CAP)) {
      expect(diagramWidthCap(cap, 1), cap).toBe(cap)
    }
  })

  it('bound height where height is the hazard, in the unit that hazard has', () => {
    // Session day is a card in a column, so a fixed height reads the same on
    // every screen. Live is a phone in a coach's hand, so the hazard is the
    // viewport and the cap is measured in it.
    expect(DIAGRAM_HEIGHT_CAP.sessionDay).toMatch(/px$/)
    expect(DIAGRAM_HEIGHT_CAP.live).toMatch(/vh$/)
  })
})
