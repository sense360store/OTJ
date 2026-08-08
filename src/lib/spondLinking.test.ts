import { describe, expect, it } from 'vitest'
import {
  linkRowsForConfirm,
  normaliseName,
  planSpondLinking,
  type PlayerSpondLink,
  type SpondLinkCandidate,
} from './spondLinking'

// The linking screen's pure logic. Names are synthetic, never real
// children. The boundary test at the bottom is the point of the file: a
// confirmation's insert payloads carry ids and the match origin only,
// never a name.

const candidate = (id: string, name: string): SpondLinkCandidate => ({ spondMemberId: id, displayName: name })
const player = (id: string, name: string) => ({ id, displayName: name })
const link = (over: Partial<PlayerSpondLink> & Pick<PlayerSpondLink, 'playerId' | 'spondMemberId'>): PlayerSpondLink => ({
  id: 'link-' + over.spondMemberId,
  matchedBy: 'auto',
  confirmedAt: null,
  ...over,
})

describe('normaliseName', () => {
  it('folds case, whitespace and diacritics', () => {
    expect(normaliseName('  Jack   Thompson ')).toBe('jack thompson')
    expect(normaliseName('JACK THOMPSON')).toBe('jack thompson')
    expect(normaliseName('Zoë Muñoz')).toBe('zoe munoz')
  })
})

describe('planSpondLinking', () => {
  it('auto matches a candidate to the one player with the same normalised name', () => {
    const plan = planSpondLinking(
      [candidate('FAKE-MEMBER-1', 'Madeup Childname')],
      [player('p1', 'madeup childname'), player('p2', 'Other Synthetic')],
      [],
    )
    expect(plan.unlinked).toEqual([
      { candidate: candidate('FAKE-MEMBER-1', 'Madeup Childname'), autoPlayerId: 'p1', ambiguous: false },
    ])
  })

  it('offers no match when no player carries the name', () => {
    const plan = planSpondLinking([candidate('FAKE-MEMBER-1', 'Madeup Childname')], [player('p2', 'Other Synthetic')], [])
    expect(plan.unlinked[0].autoPlayerId).toBeNull()
    expect(plan.unlinked[0].ambiguous).toBe(false)
  })

  it('refuses to guess between two players with the same name', () => {
    const plan = planSpondLinking(
      [candidate('FAKE-MEMBER-1', 'Madeup Childname')],
      [player('p1', 'Madeup Childname'), player('p2', 'madeup  childname')],
      [],
    )
    expect(plan.unlinked[0].autoPlayerId).toBeNull()
    expect(plan.unlinked[0].ambiguous).toBe(true)
  })

  it('refuses to guess between two candidates with the same name', () => {
    const plan = planSpondLinking(
      [candidate('FAKE-MEMBER-1', 'Madeup Childname'), candidate('FAKE-MEMBER-2', 'Madeup Childname')],
      [player('p1', 'Madeup Childname')],
      [],
    )
    expect(plan.unlinked.every((r) => r.autoPlayerId === null && r.ambiguous)).toBe(true)
  })

  it('a player already linked leaves the match pool', () => {
    const plan = planSpondLinking(
      [candidate('FAKE-MEMBER-2', 'Madeup Childname')],
      [player('p1', 'Madeup Childname')],
      [link({ playerId: 'p1', spondMemberId: 'FAKE-MEMBER-1' })],
    )
    expect(plan.unlinked[0].autoPlayerId).toBeNull()
  })

  it('an already linked candidate lands in the linked section with the resolved name', () => {
    const plan = planSpondLinking(
      [candidate('FAKE-MEMBER-1', 'Madeup Childname')],
      [player('p1', 'Madeup Childname')],
      [link({ playerId: 'p1', spondMemberId: 'FAKE-MEMBER-1' })],
    )
    expect(plan.linked).toHaveLength(1)
    expect(plan.linked[0].playerName).toBe('Madeup Childname')
    expect(plan.unlinked).toHaveLength(0)
  })

  it('a linked candidate whose player is gone resolves to a null name, never a guess', () => {
    const plan = planSpondLinking(
      [candidate('FAKE-MEMBER-1', 'Madeup Childname')],
      [],
      [link({ playerId: 'p-gone', spondMemberId: 'FAKE-MEMBER-1' })],
    )
    expect(plan.linked[0].playerName).toBeNull()
  })
})

describe('linkRowsForConfirm', () => {
  it('builds one row per confirmed selection with the match origin', () => {
    const rows = linkRowsForConfirm([
      { spondMemberId: 'FAKE-MEMBER-1', playerId: 'p1', auto: true },
      { spondMemberId: 'FAKE-MEMBER-2', playerId: 'p2', auto: false },
    ])
    expect(rows).toEqual([
      { player_id: 'p1', spond_member_id: 'FAKE-MEMBER-1', matched_by: 'auto' },
      { player_id: 'p2', spond_member_id: 'FAKE-MEMBER-2', matched_by: 'manual' },
    ])
  })

  it('drops empty selections and refuses duplicate members or players', () => {
    const rows = linkRowsForConfirm([
      { spondMemberId: 'FAKE-MEMBER-1', playerId: '', auto: false },
      { spondMemberId: 'FAKE-MEMBER-2', playerId: 'p1', auto: true },
      { spondMemberId: 'FAKE-MEMBER-2', playerId: 'p2', auto: true },
      { spondMemberId: 'FAKE-MEMBER-3', playerId: 'p1', auto: true },
    ])
    expect(rows).toEqual([{ player_id: 'p1', spond_member_id: 'FAKE-MEMBER-2', matched_by: 'auto' }])
  })

  it('the boundary: a confirmation payload carries ids and origin only, never a name', () => {
    const rows = linkRowsForConfirm([{ spondMemberId: 'FAKE-MEMBER-1', playerId: 'p1', auto: true }])
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(['matched_by', 'player_id', 'spond_member_id'])
    }
    const flat = JSON.stringify(rows)
    expect(flat).not.toContain('Madeup')
    expect(flat).not.toContain('display_name')
    expect(flat).not.toContain('displayName')
  })
})
