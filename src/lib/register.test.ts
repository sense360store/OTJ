import { describe, expect, it } from 'vitest'
import {
  activeRoster,
  buildRegister,
  quickAddPool,
  registerSummary,
  rosterForSession,
  UNASSIGNED_GROUP,
  type RegisterEntry,
} from './register'
import { BIB_NONE } from './bibs'
import type { Player, RegisteredPlayer, Team } from './data'

// The register's composition rules. The load bearing property, asserted
// throughout: none of this takes Spond links, RSVP or any Spond argument
// at all. A club that has never configured Spond gets the full register.
// Names are synthetic, never real children.

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

const entry = (playerId: string, over: Partial<RegisterEntry> = {}): RegisterEntry => ({
  sessionId: 's1',
  playerId,
  present: false,
  bibColourOverride: null,
  source: 'roster',
  ...over,
})

const alpha = player('p1', 'Alpha Synthetic', 't1', 7)
const beta = player('p2', 'Beta Synthetic', 't1')
const gamma = player('p3', 'Gamma Synthetic', 't2')
const nomad = player('p4', 'Nomad Synthetic', null)
const players = [alpha, beta, gamma, nomad]

const registration = (
  playerId: string,
  name: string,
  status: RegisteredPlayer['status'],
  teamId: string | null = 't1',
): RegisteredPlayer => ({
  registrationId: 'r-' + playerId,
  playerId,
  seasonId: 'season',
  teamId,
  displayName: name,
  shirtNumber: null,
  status,
  registeredDate: null,
  createdBy: null,
  updatedAt: '2026-08-01T00:00:00Z',
})

describe('activeRoster', () => {
  it('drops withdrawn registrations and keeps pending ones', () => {
    // Pending paperwork does not stop a child standing in front of a coach;
    // a withdrawal does mean they are no longer on this roster.
    const rows = [
      registration('p1', 'Alpha Synthetic', 'registered'),
      registration('p2', 'Beta Synthetic', 'pending'),
      registration('p3', 'Gamma Synthetic', 'withdrawn'),
    ]
    expect(activeRoster(rows).map((p) => p.id)).toEqual(['p1', 'p2'])
  })

  it('carries the seasonal team and shirt through to the register shape', () => {
    const rows = [{ ...registration('p1', 'Alpha Synthetic', 'registered', 't2'), shirtNumber: 9 }]
    expect(activeRoster(rows)[0]).toEqual({
      id: 'p1',
      teamId: 't2',
      displayName: 'Alpha Synthetic',
      shirtNumber: 9,
      createdBy: null,
    })
  })
})

describe('rosterForSession: who is listed', () => {
  it('a session covering some teams lists exactly those teams', () => {
    expect(rosterForSession(players, ['t1'], false).map((p) => p.id)).toEqual(['p1', 'p2'])
  })

  it('a whole club session lists everyone, unassigned children included', () => {
    // The decision this test pins: on a night that covers the whole club,
    // a child with no team yet is expected, so hiding them until a coach
    // hunts through quick add is the surprising option, not the safe one.
    expect(rosterForSession(players, ['t1', 't2'], true).map((p) => p.id)).toEqual(['p1', 'p2', 'p3', 'p4'])
  })

  it('a session covering nothing lists nobody', () => {
    expect(rosterForSession(players, [], false)).toEqual([])
  })

  it('never lists an unassigned child on a team scoped session', () => {
    expect(rosterForSession(players, ['t1', 't2'], false).map((p) => p.id)).toEqual(['p1', 'p2', 'p3'])
  })
})

describe('buildRegister', () => {
  it('groups by covered team in club order and counts the present', () => {
    const view = buildRegister(players, ['t1'], teams, [entry('p1', { present: true })], false)
    expect(view.groups.map((g) => g.teamName)).toEqual(['Titans'])
    expect(view.groups[0].rows.map((r) => r.player.id)).toEqual(['p1', 'p2'])
    expect(view.groups[0].presentCount).toBe(1)
    expect(view.playerTotal).toBe(2)
    expect(view.presentTotal).toBe(1)
  })

  it('gives a covered team with nobody in it a group anyway', () => {
    const view = buildRegister([alpha], ['t1', 't2'], teams, [], false)
    expect(view.groups.map((g) => g.teamName)).toEqual(['Titans', 'Trojans'])
    expect(view.groups[1].rows).toEqual([])
  })

  it('puts unassigned children in their own group on a whole club night', () => {
    const view = buildRegister(players, ['t1', 't2'], teams, [], true)
    expect(view.groups.map((g) => g.teamName)).toEqual(['Titans', 'Trojans', UNASSIGNED_GROUP])
    expect(view.groups[2].rows.map((r) => r.player.id)).toEqual(['p4'])
  })

  it('omits the unassigned group when there is nobody in it', () => {
    const view = buildRegister([alpha, gamma], ['t1', 't2'], teams, [], true)
    expect(view.groups.map((g) => g.teamName)).toEqual(['Titans', 'Trojans'])
  })

  it('works with no entries at all: the register a coach has not opened yet', () => {
    const view = buildRegister(players, ['t1'], teams, [], false)
    expect(view.presentTotal).toBe(0)
    expect(view.groups[0].rows.every((r) => !r.present)).toBe(true)
  })

  it('lists alphabetically, not by shirt number', () => {
    // At a gate a coach matches the name a parent just said, and half a
    // junior squad has no shirt number, so number-first order scatters the
    // children they are looking for.
    const zed = player('p9', 'Aardvark Synthetic', 't1', 99)
    const view = buildRegister([alpha, beta, zed], ['t1'], teams, [], false)
    expect(view.groups[0].rows.map((r) => r.player.displayName)).toEqual([
      'Aardvark Synthetic',
      'Alpha Synthetic',
      'Beta Synthetic',
    ])
  })

  it('never drops a listed child whose team is missing from the team list', () => {
    // The failure this guards: a stale team cache silently omitting a
    // child who is standing in front of the coach.
    const stray = player('p8', 'Stray Synthetic', 'gone')
    const view = buildRegister([alpha, stray], ['t1', 'gone'], teams, [], false)
    const ids = view.groups.flatMap((g) => g.rows.map((r) => r.player.id))
    expect(ids).toContain('p8')
    expect(view.playerTotal).toBe(2)
  })

  it('takes no Spond argument and needs no linking to be complete', () => {
    // buildRegister's whole signature: players, coverage, teams, entries,
    // wholeClub. Five arguments, none of them Spond.
    expect(buildRegister.length).toBe(5)
  })
})

describe('bibs on the register', () => {
  it('a player wears their team default until they are overridden', () => {
    const view = buildRegister([alpha, gamma], ['t1', 't2'], teams, [], false)
    const titan = view.groups[0].rows[0]
    const trojan = view.groups[1].rows[0]
    expect(titan.bibColour).toBe('red')
    expect(titan.overridden).toBe(false)
    expect(titan.bibValue).toBe('')
    expect(titan.bibSwatch).toBe('#e23b3b')
    expect(trojan.bibColour).toBeNull()
  })

  it('an override wins over the team default', () => {
    const view = buildRegister([alpha], ['t1'], teams, [entry('p1', { bibColourOverride: 'blue' })], false)
    const row = view.groups[0].rows[0]
    expect(row.bibColour).toBe('blue')
    expect(row.overridden).toBe(true)
    expect(row.bibValue).toBe('blue')
  })

  it('no bib is a real choice, distinct from taking the team default', () => {
    const view = buildRegister([alpha], ['t1'], teams, [entry('p1', { bibColourOverride: BIB_NONE })], false)
    const row = view.groups[0].rows[0]
    expect(row.bibColour).toBeNull()
    expect(row.bibSwatch).toBeNull()
    expect(row.overridden).toBe(true)
    expect(row.bibValue).toBe(BIB_NONE)
  })
})

describe('guests and quick add', () => {
  it('a quick added child from another team appears under their own team', () => {
    const view = buildRegister(players, ['t1'], teams, [entry('p3', { present: true, source: 'manual' })], false)
    expect(view.groups.map((g) => g.teamName)).toEqual(['Titans', 'Trojans'])
    const guest = view.groups[1].rows[0]
    expect(guest.player.id).toBe('p3')
    expect(guest.manual).toBe(true)
    expect(view.presentTotal).toBe(1)
  })

  it('manual comes from the stored source, never from whether the team is covered', () => {
    // A genuine roster row whose player later moved to another team must
    // not become deletable as though it were a quick add.
    const moved = buildRegister(players, ['t1'], teams, [entry('p3', { source: 'roster' })], false)
    const guest = moved.groups[1].rows[0]
    expect(guest.player.id).toBe('p3')
    expect(guest.manual).toBe(false)
  })

  it('offers everyone not already listed, including unassigned children', () => {
    expect(quickAddPool(players, ['t1'], [], false).map((p) => p.id)).toEqual(['p3', 'p4'])
  })

  it('never offers someone already on the register', () => {
    expect(quickAddPool(players, ['t1'], [entry('p3')], false).map((p) => p.id)).toEqual(['p4'])
  })

  it('offers nobody once a whole club session already lists everyone', () => {
    expect(quickAddPool(players, ['t1', 't2'], [], true)).toEqual([])
  })
})

describe('registerSummary', () => {
  it('reads as a count a coach can shout across a pitch', () => {
    const view = buildRegister(players, ['t1'], teams, [entry('p1', { present: true })], false)
    expect(registerSummary(view)).toBe('1 of 2 in')
  })
})

describe('an empty club', () => {
  it('produces an empty view rather than throwing', () => {
    const view = buildRegister([], [], [], [], false)
    expect(view.groups).toEqual([])
    expect(view.playerTotal).toBe(0)
    expect(registerSummary(view)).toBe('0 of 0 in')
  })
})
