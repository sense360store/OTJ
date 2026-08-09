import { describe, expect, it } from 'vitest'
import {
  acceptableSuggestions,
  buildLinkSections,
  normaliseName,
  pickerOptions,
  type LinkCandidate,
  type SpondLink,
} from './spondLinking'
import type { RegisteredPlayer } from './data'

// Synthetic throughout: invented uppercase hex member ids, invented names.
const M1 = '0123456789ABCDEF0123456789ABCDEF'
const M2 = 'FEDCBA9876543210FEDCBA9876543210'
const M3 = 'AAAABBBBCCCCDDDDEEEEFFFF00001111'

const player = (id: string, name: string, over: Partial<RegisteredPlayer> = {}): RegisteredPlayer => ({
  registrationId: `r-${id}`,
  playerId: id,
  seasonId: 'season',
  teamId: 't1',
  displayName: name,
  shirtNumber: null,
  status: 'registered',
  registeredDate: null,
  createdBy: null,
  updatedAt: '2026-08-09T00:00:00Z',
  ...over,
})

const candidate = (id: string, name: string): LinkCandidate => ({ spondMemberId: id, displayName: name })

const link = (memberId: string, playerId: string, matchedBy: 'suggested' | 'chosen' = 'chosen'): SpondLink => ({
  spondMemberId: memberId,
  playerId,
  matchedBy,
  createdAt: '2026-08-09T00:00:00Z',
})

describe('normaliseName', () => {
  it('compares names the way a person would', () => {
    expect(normaliseName('  Alpha   Synthetic ')).toBe('alpha synthetic')
    expect(normaliseName('Zoë Synthetic')).toBe(normaliseName('Zoe Synthetic'))
    expect(normaliseName('ALPHA SYNTHETIC')).toBe('alpha synthetic')
  })

  it('does not conflate two different children', () => {
    expect(normaliseName('Alpha Synthetic')).not.toBe(normaliseName('Alpha Synthetics'))
  })
})

describe('buildLinkSections', () => {
  const roster = [player('p1', 'Alpha Synthetic'), player('p2', 'Beta Synthetic')]

  it('suggests the single unambiguous match, and never preselects it', () => {
    const sections = buildLinkSections([candidate(M1, 'Alpha Synthetic')], [], roster)
    expect(sections.needsDecision).toHaveLength(1)
    expect(sections.needsDecision[0].reason).toBe('suggested')
    expect(sections.needsDecision[0].suggestion?.playerId).toBe('p1')
    // Nothing is written until somebody presses; the suggestion is data,
    // not a pending action.
    expect(sections.linked).toHaveLength(0)
  })

  it('refuses to suggest when two children share the name', () => {
    const sections = buildLinkSections(
      [candidate(M1, 'Alpha Synthetic')],
      [],
      [...roster, player('p3', 'Alpha Synthetic')],
    )
    expect(sections.needsDecision[0].reason).toBe('ambiguous')
    expect(sections.needsDecision[0].suggestion).toBeNull()
  })

  it('refuses to suggest when two Spond members share the name, the side a lookup gets wrong', () => {
    const sections = buildLinkSections(
      [candidate(M1, 'Alpha Synthetic'), candidate(M2, 'Alpha Synthetic')],
      [],
      roster,
    )
    expect(sections.needsDecision.map((r) => r.reason)).toEqual(['ambiguous', 'ambiguous'])
  })

  it('names the highest value case: in Spond, missing from the roster', () => {
    const sections = buildLinkSections([candidate(M3, 'Gamma Synthetic')], [], roster)
    expect(sections.needsDecision[0].reason).toBe('not_on_roster')
  })

  it('never suggests a child who is already linked', () => {
    const sections = buildLinkSections(
      [candidate(M1, 'Alpha Synthetic'), candidate(M2, 'Alpha Synthetic')],
      [link(M2, 'p1')],
      roster,
    )
    // M2 holds Alpha, so Alpha is no longer an available match for M1,
    // which therefore has nobody left to match.
    const m1 = sections.needsDecision.find((r) => r.candidate.spondMemberId === M1)
    expect(m1?.reason).toBe('not_on_roster')
    expect(sections.linked.map((r) => r.link.spondMemberId)).toEqual([M2])
  })

  it('shows a stored link with the child it resolves to', () => {
    const sections = buildLinkSections([candidate(M1, 'Alpha Synthetic')], [link(M1, 'p1', 'suggested')], roster)
    expect(sections.linked).toHaveLength(1)
    expect(sections.linked[0].player?.displayName).toBe('Alpha Synthetic')
    expect(sections.linked[0].link.matchedBy).toBe('suggested')
  })

  it('surfaces a link whose Spond member has gone rather than hiding it', () => {
    const sections = buildLinkSections([candidate(M2, 'Beta Synthetic')], [link(M1, 'p1')], roster)
    expect(sections.orphans).toHaveLength(1)
    expect(sections.orphans[0].player?.playerId).toBe('p1')
    // And the child it holds is not offered as a fresh suggestion.
    expect(sections.needsDecision.find((r) => r.candidate.spondMemberId === M2)?.suggestion?.playerId).toBe('p2')
  })

  it('a link belonging to another team is not this team orphan', () => {
    const sections = buildLinkSections([], [link(M1, 'other-team-child')], roster)
    expect(sections.orphans).toHaveLength(0)
  })

  it('nothing loaded yet means nothing to decide, not an empty club', () => {
    const sections = buildLinkSections([], [], roster)
    expect(sections.needsDecision).toHaveLength(0)
    expect(sections.linked).toHaveLength(0)
  })
})

describe('acceptableSuggestions', () => {
  const roster = [player('p1', 'Alpha Synthetic'), player('p2', 'Beta Synthetic')]

  it('offers exactly the unambiguous matches, and nothing else', () => {
    const sections = buildLinkSections(
      [candidate(M1, 'Alpha Synthetic'), candidate(M2, 'Gamma Synthetic')],
      [],
      roster,
    )
    expect(acceptableSuggestions(sections)).toEqual([{ spondMemberId: M1, playerId: 'p1' }])
  })

  it('carries no name into the write payload', () => {
    const sections = buildLinkSections([candidate(M1, 'Alpha Synthetic')], [], roster)
    const flat = JSON.stringify(acceptableSuggestions(sections))
    expect(flat).not.toContain('Alpha Synthetic')
    expect(Object.keys(acceptableSuggestions(sections)[0]).sort()).toEqual(['playerId', 'spondMemberId'])
  })

  it('is empty when nothing is unambiguous, so the bulk button does not appear', () => {
    const sections = buildLinkSections([candidate(M1, 'Gamma Synthetic')], [], roster)
    expect(acceptableSuggestions(sections)).toEqual([])
  })
})

describe('pickerOptions', () => {
  const roster = [player('p2', 'Beta Synthetic'), player('p1', 'Alpha Synthetic')]

  it('orders by name and marks the already linked rather than hiding them', () => {
    const options = pickerOptions(roster, [link(M1, 'p1')], '')
    expect(options.map((o) => o.player.displayName)).toEqual(['Alpha Synthetic', 'Beta Synthetic'])
    expect(options[0].linkedAlready).toBe(true)
    expect(options[1].linkedAlready).toBe(false)
  })

  it('searches the way names compare, not the way bytes do', () => {
    expect(pickerOptions(roster, [], 'ALPHA').map((o) => o.player.playerId)).toEqual(['p1'])
    expect(pickerOptions(roster, [], 'synthetic')).toHaveLength(2)
    expect(pickerOptions(roster, [], 'nobody')).toHaveLength(0)
  })
})
