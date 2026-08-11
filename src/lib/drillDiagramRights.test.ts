import { describe, expect, it } from 'vitest'
import { diagramEditDecision, FA_DIAGRAM_NOTE, NOT_YOURS_NOTE } from './drillDiagramRights'
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
