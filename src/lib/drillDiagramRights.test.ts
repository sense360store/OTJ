import { describe, expect, it } from 'vitest'
import { diagramEditDecision, diagramForDisplay, FA_DIAGRAM_NOTE, NOT_YOURS_NOTE } from './drillDiagramRights'
import { DRILL_DIAGRAM_VERSION, emptyDiagram, type DrillDiagram } from './drillDiagram'
import { FA_SOURCE_LABEL } from './fa'

// Who may draw a drill's diagram. Two rules from two places: the existing
// ownership rule, and the England Football recreation limit, which is stricter
// than the rights lock in migration 0043 and deliberately so. See the module
// header for the evidence behind that.

const NO_SOURCE = {}

describe('ownership', () => {
  it('lets an owner or a manager draw', () => {
    expect(diagramEditDecision({ canManage: true, source: NO_SOURCE })).toEqual({ canEdit: true, reason: null })
  })

  it('refuses somebody who could not edit the drill either, and says why', () => {
    const d = diagramEditDecision({ canManage: false, source: NO_SOURCE })
    expect(d.canEdit).toBe(false)
    expect(d.reason).toBe(NOT_YOURS_NOTE)
  })

  it('takes the caller ownership decision as given rather than recomputing it', () => {
    // The one rule that decides Edit drill decides Edit diagram. A second
    // implementation here is how the two would drift apart.
    expect(diagramEditDecision({ canManage: false, source: NO_SOURCE }).canEdit).toBe(false)
    expect(diagramEditDecision({ canManage: true, source: NO_SOURCE }).canEdit).toBe(true)
  })
})

describe('England Football derived drills', () => {
  const FA_URL = { sourceUrl: 'https://learn.englandfootball.com/coaching/activity/abc' }
  const FA_KEY = { sourceKey: 'https://learn.englandfootball.com/coaching/activity/abc#1' }
  const FA_LABEL = { sourceLabel: FA_SOURCE_LABEL }

  it('gets no hand drawn diagram, however senior the person asking', () => {
    // Not a permission the club can grant: the limit is the licence, which
    // says the FA's images are used unmodified and never redrawn.
    for (const source of [FA_URL, FA_KEY, FA_LABEL]) {
      const d = diagramEditDecision({ canManage: true, source })
      expect(d.canEdit).toBe(false)
      expect(d.reason).toBe(FA_DIAGRAM_NOTE)
    }
  })

  it('gives the England Football reason rather than the ownership one, even when both apply', () => {
    // The reason a coach reads has to be the real one. "It is not yours" would
    // send them to find the owner, who also cannot do it.
    expect(diagramEditDecision({ canManage: false, source: FA_URL }).reason).toBe(FA_DIAGRAM_NOTE)
  })

  it('explains itself in the club words, naming England Football Learning', () => {
    expect(FA_DIAGRAM_NOTE).toContain('England Football Learning')
  })

  it('recognises an England Football source held on any of the three columns', () => {
    for (const source of [FA_URL, FA_KEY, FA_LABEL]) {
      expect(diagramEditDecision({ canManage: true, source }).canEdit).toBe(false)
    }
  })

  it('recognises an England Football host through a user info trick', () => {
    // Mirrors the host rule migration 0043 corrected. A permissive reading here
    // would open the recreation route it closes.
    expect(
      diagramEditDecision({ canManage: true, source: { sourceUrl: 'https://x@learn.englandfootball.com/a' } }).canEdit,
    ).toBe(false)
  })

  it('does not treat a look-alike host as England Football', () => {
    expect(
      diagramEditDecision({ canManage: true, source: { sourceUrl: 'https://learn.englandfootball.com.evil.test/a' } })
        .canEdit,
    ).toBe(true)
  })
})

// ---- Showing a saved diagram inside a session (DRILL-02) -----------------
//
// diagramForDisplay is the read only twin of diagramEditDecision and the ONE
// rule behind the planner panel, session day and both live stages. Its whole
// job is that four surfaces cannot disagree about an England Football drill.

describe('showing a saved diagram', () => {
  const FA_URL = { sourceUrl: 'https://learn.englandfootball.com/coaching/activity/abc' }
  const FA_KEY = { sourceKey: 'https://learn.englandfootball.com/coaching/activity/abc#1' }
  const FA_LABEL = { sourceLabel: FA_SOURCE_LABEL }
  const drawn: DrillDiagram = {
    version: DRILL_DIAGRAM_VERSION,
    surface: { kind: 'full_pitch', orientation: 'portrait' },
    elements: [{ type: 'cone', id: 'cone-1', x: 0.5, y: 0.5, colour: 'orange' }],
  }

  it('shows a club drawn diagram unchanged', () => {
    expect(diagramForDisplay(drawn, NO_SOURCE)).toBe(drawn)
  })

  it('shows nothing while the read has not answered', () => {
    // undefined is "not known yet". Drawing an empty frame and then a pitch a
    // moment later is worse than drawing nothing.
    expect(diagramForDisplay(undefined, NO_SOURCE)).toBeNull()
  })

  it('shows nothing for a drill with no diagram', () => {
    expect(diagramForDisplay(null, NO_SOURCE)).toBeNull()
  })

  it('shows nothing for an empty diagram', () => {
    // A saved surface with no elements is a blank pitch, which says nothing
    // about the drill. Most drills have no diagram at all.
    expect(diagramForDisplay(emptyDiagram(), NO_SOURCE)).toBeNull()
  })

  it('shows no diagram on an England Football derived drill, on any of the three columns', () => {
    // The case that matters most: a coach draws a diagram on their own drill
    // and an England Football source is recorded on it afterwards, stranding
    // one on the row. The drill page states that and offers to remove it; every
    // other surface simply does not show it, because the licence excludes a
    // redrawn FA diagram wherever it renders and not only where it was made.
    for (const source of [FA_URL, FA_KEY, FA_LABEL]) {
      expect(diagramForDisplay(drawn, source)).toBeNull()
    }
  })

  it('recognises an England Football host through a user info trick', () => {
    expect(diagramForDisplay(drawn, { sourceUrl: 'https://x@learn.englandfootball.com/a' })).toBeNull()
  })

  it('does not treat a look-alike host as England Football', () => {
    expect(diagramForDisplay(drawn, { sourceUrl: 'https://learn.englandfootball.com.evil.test/a' })).toBe(drawn)
  })

  it('shows a diagram on a drill from some other recorded source', () => {
    // A recorded source is evidence, not proof of a restriction. Only the
    // England Football case is proven and only it is refused, exactly as the
    // edit rule treats it.
    expect(diagramForDisplay(drawn, { sourceUrl: 'https://example.test/x' })).toBe(drawn)
  })

  it('answers the same way as the edit rule about who is England Football derived', () => {
    // The two questions differ ("may this be drawn" vs "may this be shown") and
    // the FA answer must not. This is the pairing that keeps them together.
    for (const source of [NO_SOURCE, FA_URL, FA_KEY, FA_LABEL, { sourceUrl: 'https://example.test/x' }]) {
      const blockedFromDrawing = diagramEditDecision({ canManage: true, source }).reason === FA_DIAGRAM_NOTE
      expect(diagramForDisplay(drawn, source) === null).toBe(blockedFromDrawing)
    }
  })

  it('never invents a diagram for a drill that has none, England Football or not', () => {
    // The licence limit is not a reason to substitute anything. A restricted
    // drill keeps its England Football media through the media path and gets no
    // drawn stand-in here.
    for (const source of [NO_SOURCE, FA_URL]) {
      expect(diagramForDisplay(null, source)).toBeNull()
      expect(diagramForDisplay(undefined, source)).toBeNull()
    }
  })
})

describe('other sources', () => {
  it('lets a coach draw on a drill from some other source', () => {
    // A recorded source is evidence, not proof of a restriction. Only the
    // England Football case is proven, and only it is refused.
    expect(diagramEditDecision({ canManage: true, source: { sourceUrl: 'https://example.test/x' } }).canEdit).toBe(true)
  })

  it('lets a coach draw on a drill the club wrote itself', () => {
    expect(diagramEditDecision({ canManage: true, source: { sourceUrl: '', sourceLabel: '', sourceKey: '' } }).canEdit).toBe(
      true,
    )
  })
})
