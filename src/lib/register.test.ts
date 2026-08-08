import { describe, expect, it } from 'vitest'
import { applyRegisterPatch, toRegisterEntry } from './queries'
import {
  badgeFor,
  BIB_NONE,
  buildRegister,
  quickAddPool,
  REGISTER_BADGE_META,
  splitDeclined,
  type RegisterEntry,
  type SpondResponseLite,
} from './register'
import type { Player, Team } from './data'
import type { PlayerSpondLink } from './spondLinking'

// The Register's pure composition. Names are synthetic, never real
// children. The badge ladder is the locked product rule: RSVP is never
// attendance, going first, no reply shapes together, declined last and
// collapsed by the screen but never hidden.

const teams: Team[] = [
  { id: 't1', name: 'Titans', bibColour: 'red' },
  { id: 't2', name: 'Trojans', bibColour: null },
]

const player = (id: string, name: string, teamId: string | null, shirt: number | null = null): Player => ({
  id,
  teamId,
  displayName: name,
  shirtNumber: shirt,
  createdBy: null,
})

const link = (playerId: string, memberId: string): PlayerSpondLink => ({
  id: 'link-' + playerId,
  playerId,
  spondMemberId: memberId,
  matchedBy: 'auto',
  confirmedAt: null,
})

const response = (memberId: string, status: SpondResponseLite['status']): SpondResponseLite => ({
  spondMemberId: memberId,
  status,
})

const entry = (playerId: string, over: Partial<RegisterEntry> = {}): RegisterEntry => ({
  sessionId: 's1',
  playerId,
  present: false,
  bibColourOverride: null,
  source: 'spond',
  ...over,
})

describe('badgeFor', () => {
  it('resolves through the link to the response status', () => {
    const links = new Map([['p1', link('p1', 'FAKE-MEMBER-1')]])
    const statuses = new Map([['FAKE-MEMBER-1', 'accepted' as const]])
    expect(badgeFor('p1', links, statuses)).toBe('accepted')
  })

  it('a linked player with no response row reads none, an unlinked player reads unlinked', () => {
    const links = new Map([['p1', link('p1', 'FAKE-MEMBER-1')]])
    expect(badgeFor('p1', links, new Map())).toBe('none')
    expect(badgeFor('p2', links, new Map())).toBe('unlinked')
  })
})

describe('buildRegister', () => {
  const players = [
    player('p1', 'Alpha Synthetic', 't1'),
    player('p2', 'Beta Synthetic', 't1'),
    player('p3', 'Gamma Synthetic', 't1'),
    player('p4', 'Delta Synthetic', 't2'),
  ]
  const links = [link('p1', 'M1'), link('p2', 'M2')]
  const responses = [response('M1', 'declined'), response('M2', 'accepted')]

  it('groups by covered team, going first, no reply shapes together, declined last', () => {
    const view = buildRegister(players, ['t1'], teams, links, responses, [])
    expect(view.groups).toHaveLength(1)
    const rows = view.groups[0].rows
    // Beta accepted first, Gamma unlinked next, Alpha declined last.
    expect(rows.map((r) => r.player.id)).toEqual(['p2', 'p3', 'p1'])
    expect(rows.map((r) => r.badge)).toEqual(['accepted', 'unlinked', 'declined'])
  })

  it('an unlinked player is listed and tickable state still composes', () => {
    const view = buildRegister(players, ['t1'], teams, links, responses, [entry('p3', { present: true })])
    const gamma = view.groups[0].rows.find((r) => r.player.id === 'p3')!
    expect(gamma.badge).toBe('unlinked')
    expect(gamma.present).toBe(true)
  })

  it('never hides a non responder: every covered team player lists whatever Spond says', () => {
    const view = buildRegister(players, ['t1', 't2'], teams, links, responses, [])
    expect(view.playerTotal).toBe(4)
  })

  it('bib colour resolves override over team default', () => {
    const view = buildRegister(players, ['t1'], teams, links, responses, [
      entry('p1', { bibColourOverride: 'blue' }),
    ])
    const alpha = view.groups[0].rows.find((r) => r.player.id === 'p1')!
    const beta = view.groups[0].rows.find((r) => r.player.id === 'p2')!
    expect(alpha.bibColour).toBe('blue')
    expect(alpha.overridden).toBe(true)
    expect(alpha.bibValue).toBe('blue')
    expect(beta.bibColour).toBe('red')
    expect(beta.overridden).toBe(false)
    expect(beta.bibValue).toBe('')
  })

  it('the no bib sentinel overrides a team default to no bib at all', () => {
    const view = buildRegister(players, ['t1'], teams, links, responses, [
      entry('p1', { bibColourOverride: BIB_NONE }),
    ])
    const alpha = view.groups[0].rows.find((r) => r.player.id === 'p1')!
    expect(alpha.bibColour).toBeNull()
    expect(alpha.bibSwatch).toBeNull()
    expect(alpha.overridden).toBe(true)
    expect(alpha.bibValue).toBe(BIB_NONE)
  })

  it('a quick added player from outside the covered teams appears under their own team', () => {
    const view = buildRegister(players, ['t1'], teams, links, responses, [
      entry('p4', { present: true, source: 'manual' }),
    ])
    expect(view.groups.map((g) => g.teamName)).toEqual(['Titans', 'Trojans'])
    const guest = view.groups[1].rows[0]
    expect(guest.player.id).toBe('p4')
    expect(guest.manual).toBe(true)
    expect(view.presentTotal).toBe(1)
  })

  it('counts the present per group and in total', () => {
    const view = buildRegister(players, ['t1'], teams, links, responses, [
      entry('p1', { present: true }),
      entry('p2', { present: true }),
    ])
    expect(view.groups[0].presentCount).toBe(2)
    expect(view.presentTotal).toBe(2)
    expect(view.playerTotal).toBe(3)
  })
})

describe('quickAddPool and splitDeclined', () => {
  it('offers only players outside the covered teams who are not already added', () => {
    const players = [player('p1', 'Alpha Synthetic', 't1'), player('p4', 'Delta Synthetic', 't2')]
    expect(quickAddPool(players, ['t1'], []).map((p) => p.id)).toEqual(['p4'])
    expect(quickAddPool(players, ['t1'], [entry('p4')])).toEqual([])
  })

  it('splits declined for the collapse, never dropping them', () => {
    const rows = buildRegister(
      [player('p1', 'Alpha Synthetic', 't1'), player('p2', 'Beta Synthetic', 't1')],
      ['t1'],
      teams,
      [link('p1', 'M1')],
      [response('M1', 'declined')],
      [],
    ).groups[0].rows
    const { active, declined } = splitDeclined(rows)
    expect(active.map((r) => r.player.id)).toEqual(['p2'])
    expect(declined.map((r) => r.player.id)).toEqual(['p1'])
  })
})

describe('register entry plumbing', () => {
  it('maps a row to the app shape', () => {
    expect(
      toRegisterEntry({
        session_id: 's1',
        player_id: 'p1',
        present: true,
        bib_colour_override: 'blue',
        source: 'manual',
      }),
    ).toEqual({ sessionId: 's1', playerId: 'p1', present: true, bibColourOverride: 'blue', source: 'manual' })
  })

  it('applyRegisterPatch creates a defaulted row and preserves untouched fields', () => {
    const created = applyRegisterPatch(undefined, { sessionId: 's1', playerId: 'p1', present: true })
    expect(created).toEqual([
      { sessionId: 's1', playerId: 'p1', present: true, bibColourOverride: null, source: 'spond' },
    ])
    const patched = applyRegisterPatch(created, { sessionId: 's1', playerId: 'p1', bibColourOverride: 'red' })
    expect(patched[0]).toEqual({
      sessionId: 's1',
      playerId: 'p1',
      present: true,
      bibColourOverride: 'red',
      source: 'spond',
    })
    // Clearing the override is a real change, distinct from leaving it be.
    const cleared = applyRegisterPatch(patched, { sessionId: 's1', playerId: 'p1', bibColourOverride: null })
    expect(cleared[0].bibColourOverride).toBeNull()
  })

  it('a manual quick add keeps its source across later patches', () => {
    const added = applyRegisterPatch([], { sessionId: 's1', playerId: 'p4', present: true, source: 'manual' })
    const toggled = applyRegisterPatch(added, { sessionId: 's1', playerId: 'p4', present: false })
    expect(toggled[0].source).toBe('manual')
  })

  it('applying the same patch twice is idempotent, including the explicit bib clear', () => {
    // The mutation applies the patch in onMutate and recomputes over the
    // already patched cache, so double application must be a fixed point.
    const input = { sessionId: 's1', playerId: 'p1', present: true, bibColourOverride: null }
    const once = applyRegisterPatch([entry('p1', { bibColourOverride: 'red' })], input)
    const twice = applyRegisterPatch(once, input)
    expect(twice).toEqual(once)
    expect(twice[0].bibColourOverride).toBeNull()
  })
})

describe('badge metadata', () => {
  it('covers every badge with UK English labels', () => {
    for (const meta of Object.values(REGISTER_BADGE_META)) {
      expect(meta.label.length).toBeGreaterThan(0)
    }
    expect(REGISTER_BADGE_META.accepted.label).toBe('Going')
    expect(REGISTER_BADGE_META.unanswered.label).toBe('No reply')
    expect(REGISTER_BADGE_META.unlinked.label).toBe('Not linked')
  })
})
