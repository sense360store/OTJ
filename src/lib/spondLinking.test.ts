import { describe, expect, it } from 'vitest'
import {
  acceptableSuggestions,
  buildLinkSections,
  linkLoadComplete,
  normaliseName,
  pickerOptions,
  suggestionPool,
  unmatchedPlayers,
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

describe('suggestionPool, the roster a suggestion may match', () => {
  const club = [
    player('p1', 'Alpha Synthetic', { teamId: 't1' }),
    // The same name on ANOTHER team: the case a club wide pool gets
    // wrong, matching a Titans member to a Gladiators child.
    player('p2', 'Alpha Synthetic', { teamId: 't2' }),
    player('p3', 'Beta Synthetic', { teamId: 't1', status: 'withdrawn' }),
  ]

  it('holds one team only, so a same named child on another team cannot be suggested', () => {
    const pool = suggestionPool(club, 't1')
    expect(pool.map((p) => p.playerId)).toEqual(['p1'])
    // Through the full pipeline: the t1 pool offers the t1 child, and the
    // t2 child of the same name is simply not there to be matched.
    const sections = buildLinkSections([candidate(M1, 'Alpha Synthetic')], [], pool)
    expect(sections.needsDecision[0].reason).toBe('suggested')
    expect(sections.needsDecision[0].suggestion?.playerId).toBe('p1')
  })

  it('never lets the other team s pool suggest across', () => {
    const pool = suggestionPool(club, 't2')
    const sections = buildLinkSections([candidate(M1, 'Alpha Synthetic')], [], pool)
    expect(sections.needsDecision[0].suggestion?.playerId).toBe('p2')
    expect(sections.needsDecision[0].suggestion?.playerId).not.toBe('p1')
  })

  it('excludes a withdrawn child', () => {
    const sections = buildLinkSections([candidate(M2, 'Beta Synthetic')], [], suggestionPool(club, 't1'))
    expect(sections.needsDecision[0].reason).toBe('not_on_roster')
  })

  it('is empty with no team chosen, so nothing club wide can leak through', () => {
    expect(suggestionPool([player('p1', 'Alpha Synthetic')], null)).toEqual([])
  })
})

// ---- The players the screen previously never mentioned ----------------
//
// Production, 15 August: Argonauts held six unlinked registered players
// and Trojans five, none of whom appeared anywhere on the linking screen,
// because every section is candidate led and these children have no
// candidate: their Spond member is not in the mapped subgroup, or the
// family is not in the Spond group at all, or they go by a different
// name there. The screen showed "Needs a decision" with only a staff
// member in it and a manager reasonably concluded there was nothing left
// to do.

describe('unmatchedPlayers', () => {
  it('names the registered players absent from the loaded members', () => {
    const out = unmatchedPlayers(
      [candidate(M1, 'Alpha Synthetic')],
      [],
      [player('p1', 'Alpha Synthetic'), player('p2', 'Beta Synthetic'), player('p3', 'Gamma Synthetic')],
    )
    expect(out.map((p) => p.playerId)).toEqual(['p2', 'p3'])
  })

  it('does not list a linked child, whatever the candidate list holds', () => {
    const out = unmatchedPlayers([], [link(M1, 'p1')], [player('p1', 'Alpha Synthetic')])
    expect(out).toEqual([])
  })

  it('lists a child whose only same named candidate is already linked to somebody else', () => {
    // The reachability rule: a child is matched only by a candidate a
    // manager could still link, an UNLINKED one. A review found the
    // first version of this rule excluded by name alone, which made two
    // same named children, one correctly linked, hide the other in no
    // section at all: Change would break the correct link, so that
    // member is not a way to reach this child, and "no Spond match" is
    // the honest description.
    const out = unmatchedPlayers(
      [candidate(M1, 'Alpha Synthetic')],
      [link(M1, 'p9')],
      [player('p1', 'Alpha Synthetic')],
    )
    expect(out.map((p) => p.playerId)).toEqual(['p1'])
  })

  it('partitions two same named children: one linked, the other named as unmatched', () => {
    // The review's concrete counterexample, pinned: with the shared
    // name's one candidate correctly linked, the second child must not
    // vanish between the sections.
    const out = unmatchedPlayers(
      [candidate(M1, 'Alex Synthetic')],
      [link(M1, 'p1')],
      [player('p1', 'Alex Synthetic'), player('p2', 'Alex Synthetic')],
    )
    expect(out.map((p) => p.playerId)).toEqual(['p2'])
  })

  it('still trusts an unlinked candidate to reach a same named child', () => {
    // One unlinked "Alpha" in Spond, one unlinked Alpha on the list:
    // that child is reachable (a suggestion, or Choose), so they are
    // not unmatched.
    const out = unmatchedPlayers(
      [candidate(M1, 'Alpha Synthetic')],
      [],
      [player('p1', 'Alpha Synthetic')],
    )
    expect(out).toEqual([])
  })

  it('matches names the way the suggestions do, so the two rules cannot disagree', () => {
    const out = unmatchedPlayers(
      [candidate(M1, 'ZOË  synthetic')],
      [],
      [player('p1', 'Zoe Synthetic'), player('p2', 'Beta Synthetic')],
    )
    expect(out.map((p) => p.playerId)).toEqual(['p2'])
  })

  it('orders by name, the way a manager reads a list', () => {
    const out = unmatchedPlayers(
      [],
      [],
      [player('p2', 'Gamma Synthetic'), player('p1', 'Beta Synthetic')],
    )
    expect(out.map((p) => p.displayName)).toEqual(['Beta Synthetic', 'Gamma Synthetic'])
  })
})

// ---- What a load proves ------------------------------------------------
//
// A review found the second way to arrive at zero members: a successful,
// untruncated read whose members were ALL staff, now that staff are
// excluded server side. Reading that as "the read proved nothing" put a
// false incompleteness note on screen and suppressed the no-match
// section for exactly the production shape this work exists to fix, a
// subgroup holding only the manager. The exclusion counts are data, so
// completeness is decided from them, in one pure rule.

describe('linkLoadComplete', () => {
  const load = (members: number, over: Partial<Parameters<typeof linkLoadComplete>[0]> = {}) => ({
    members: Array.from({ length: members }, (_, i) => candidate(M1, `Synthetic ${i}`)),
    truncated: false,
    staffExcluded: 0,
    ignoredExcluded: 0,
    ...over,
  })

  it('a normal read with members is complete', () => {
    expect(linkLoadComplete(load(2))).toBe(true)
  })

  it('a read whose members were all staff is still complete', () => {
    expect(linkLoadComplete(load(0, { staffExcluded: 1 }))).toBe(true)
    expect(linkLoadComplete(load(0, { ignoredExcluded: 1 }))).toBe(true)
  })

  it('a read that returned nothing at all proves nothing', () => {
    expect(linkLoadComplete(load(0))).toBe(false)
  })

  it('a truncated read is never complete, staff or no staff', () => {
    expect(linkLoadComplete(load(3, { truncated: true }))).toBe(false)
    expect(linkLoadComplete(load(0, { truncated: true, staffExcluded: 2 }))).toBe(false)
  })
})
