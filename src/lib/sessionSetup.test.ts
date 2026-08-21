// =====================================================================
// COACH-3, the suggested setup, at the seam.
//
// Everything here is a pure function over rows and a draft, which is the
// whole reason this slice ships as its own PR: the rules are provable
// without a screen, and the screen that renders them can then be a thin
// shell over answers that are already correct.
//
// THE HEADLINE CASES, from the brief:
//   23 recommends four, 24 recommends five, three is never recommended.
//   A missing or failed Spond integration never yields a zero-player
//   recommendation.
//   Unanswered and waiting are not attending.
//   Colours are unique and follow the vocabulary order.
//   Teams are kept whole where possible; only adjacent bands combine.
//   With no club team order it keeps teams whole and SAYS the order is
//   unset rather than treating alphabetical as ability.
//   Nothing produced here is destined for a team, a player or a
//   registration.
//
// Names in fixtures are invented. No real child or coach appears.
// =====================================================================
import { describe, expect, it } from 'vitest'
import {
  FIVE_STATION_THRESHOLD,
  SETUP_ISSUE_FIXES,
  SETUP_NOTES,
  type TeamOrder,
  expectedAttendance,
  expectedAttendanceNote,
  groupStartStation,
  planBibOverrides,
  planSetup,
  recommendSetup,
  setupReadiness,
  applySetup,
  stationAdvice,
  stationFitNote,
} from './sessionSetup'
import { MAX_STATIONS, MIN_STATIONS } from './activityStructure'
import { BIB_COLOURS, BIB_NONE } from './bibs'
import { ACTIVITY_STRUCTURE_WARNINGS } from './activityStructure'
import {
  type TonightDraft,
  type TonightRow,
  draftDelta,
  draftFromEntries,
  draftIsDirty,
} from './tonight'
import type { StructuredActivity } from './activityStructure'
import type { RsvpStatus } from './spondRsvp'

const emptyDraft = (): TonightDraft => ({
  included: {},
  attendance: {},
  bibs: {},
  added: {},
  touched: {},
})

const draftWith = (over: Partial<TonightDraft>): TonightDraft => ({ ...emptyDraft(), ...over })

let seq = 0
function row(over: Partial<TonightRow> = {}): TonightRow {
  seq += 1
  return {
    playerId: `p${seq}`,
    displayName: `Player ${seq}`,
    shirtNumber: null,
    teamId: 'team-a',
    teamName: 'Team A',
    teamBib: null,
    response: null,
    manual: false,
    ...over,
  }
}

// n children on one team, with that team's default bib.
function squad(n: number, teamId: string, teamName: string, teamBib: string | null = null): TonightRow[] {
  return Array.from({ length: n }, () => row({ teamId, teamName, teamBib }))
}

function replied(rows: TonightRow[], status: RsvpStatus): TonightRow[] {
  return rows.map((r) => ({ ...r, response: status }))
}

const includeAll = (rows: TonightRow[]): TonightDraft =>
  draftWith({ included: Object.fromEntries(rows.map((r) => [r.playerId, true])) })

// ---------------------------------------------------------------------

describe('the expected count has one rule and says which source it used', () => {
  it('counts only accepted replies when there is RSVP context', () => {
    const rows = [
      ...replied(squad(6, 't1', 'One'), 'accepted'),
      ...replied(squad(4, 't1', 'One'), 'declined'),
      ...replied(squad(3, 't1', 'One'), 'unanswered'),
      ...replied(squad(2, 't1', 'One'), 'waiting'),
    ]
    const e = expectedAttendance(rows, emptyDraft())
    expect(e.source).toBe('rsvp')
    expect(e.count).toBe(6)
  })

  it('treats waiting exactly like unanswered: not attending', () => {
    // Both are "no bib, no group, no game", and both stay visible under
    // Everyone. Neither is a reason to expect a child.
    for (const status of ['unanswered', 'waiting'] as const) {
      const rows = [...replied(squad(1, 't1', 'One'), 'accepted'), ...replied(squad(9, 't1', 'One'), status)]
      expect(expectedAttendance(rows, emptyDraft()).count).toBe(1)
    }
  })

  it('does not read a child with no Spond link as a fourth reply state', () => {
    // No link means nobody asked them. They are not "unanswered", so they
    // are not counted as having declined to attend either: with any real
    // reply on the session the RSVP branch runs, and an unlinked child
    // simply is not in it.
    const rows = [...replied(squad(5, 't1', 'One'), 'accepted'), ...squad(20, 't1', 'One')]
    const e = expectedAttendance(rows, emptyDraft())
    expect(e.source).toBe('rsvp')
    expect(e.count).toBe(5)
    expect(e.children.every((c) => c.response === 'accepted')).toBe(true)
  })

  it('counts the coach s selection when there is no RSVP context at all', () => {
    const rows = squad(30, 't1', 'One')
    const chosen = rows.slice(0, 18)
    const e = expectedAttendance(rows, includeAll(chosen))
    expect(e.source).toBe('included')
    expect(e.count).toBe(18)
  })

  it('counts the covered squad before the coach has selected anybody', () => {
    // The generator exists to run 24 to 48 hours out, when the selection is
    // empty by definition. Answering "nobody" then would make it useless on
    // the only day it matters.
    const rows = squad(26, 't1', 'One')
    const e = expectedAttendance(rows, emptyDraft())
    expect(e.source).toBe('squad')
    expect(e.count).toBe(26)
  })

  it('never yields a zero-player recommendation from a missing or failed integration', () => {
    // A session with no linked event, a read still in flight and a read
    // that failed all arrive as rows carrying no response. None of them is
    // evidence that nobody is coming.
    const rows = squad(24, 't1', 'One')
    const e = expectedAttendance(rows, emptyDraft())
    expect(e.count).toBe(24)
    expect(recommendSetup(e).stations).toBe(5)
  })

  it('still reports a true zero when Spond says everybody declined', () => {
    // Different from a broken integration, and the source is what tells
    // them apart.
    const rows = replied(squad(12, 't1', 'One'), 'declined')
    const e = expectedAttendance(rows, emptyDraft())
    expect(e.source).toBe('rsvp')
    expect(e.count).toBe(0)
  })

  it('leaves a guest out of the RSVP count and in the local one', () => {
    const covered = replied(squad(4, 't1', 'One'), 'accepted')
    const guest = { ...row({ teamId: 't9', teamName: 'Nine', manual: true }), response: 'accepted' as RsvpStatus }
    expect(expectedAttendance([...covered, guest], emptyDraft()).count).toBe(4)
    // With no covered reply there is no context, and the child standing in
    // front of the coach is expected whatever the mirror knows.
    expect(expectedAttendance([{ ...guest }], emptyDraft()).source).toBe('squad')
    expect(expectedAttendance([{ ...guest }], emptyDraft()).count).toBe(1)
  })

  it('counts a duplicated row once', () => {
    const one = row({ response: 'accepted' })
    expect(expectedAttendance([one, { ...one }], emptyDraft()).count).toBe(1)
  })

  it('reports the children it counted, so nothing downstream places a different set', () => {
    const rows = [...replied(squad(7, 't1', 'One'), 'accepted'), ...replied(squad(5, 't1', 'One'), 'declined')]
    const e = expectedAttendance(rows, emptyDraft())
    expect(e.children).toHaveLength(e.count)
  })

  it('names the population in the sentence, differently for each source', () => {
    const notes = new Set(
      [
        expectedAttendanceNote({ source: 'rsvp', count: 4, children: [] }),
        expectedAttendanceNote({ source: 'included', count: 4, children: [] }),
        expectedAttendanceNote({ source: 'squad', count: 4, children: [] }),
      ],
    )
    expect(notes.size).toBe(3)
    expect(expectedAttendanceNote({ source: 'rsvp', count: 1, children: [] })).toContain('1 player ')
  })
})

describe('the recommendation', () => {
  const at = (count: number) => recommendSetup({ source: 'squad', count, children: [] })

  it('recommends four at 23 and five at 24', () => {
    expect(at(23).stations).toBe(4)
    expect(at(24).stations).toBe(5)
    expect(FIVE_STATION_THRESHOLD).toBe(24)
  })

  it('recommends one group per station', () => {
    expect(at(23).groups).toBe(4)
    expect(at(24).groups).toBe(5)
  })

  it('never recommends three, at any count', () => {
    for (let n = 0; n <= 120; n++) {
      expect(at(n).stations).not.toBe(3)
      expect(at(n).stations).toBeGreaterThanOrEqual(MIN_STATIONS)
      expect(at(n).stations).toBeLessThanOrEqual(MAX_STATIONS)
    }
  })

  it('runs the same rule on both branches', () => {
    // No club gets a different threshold for having configured Spond.
    for (const source of ['rsvp', 'included', 'squad'] as const) {
      expect(recommendSetup({ source, count: 24, children: [] }).stations).toBe(5)
      expect(recommendSetup({ source, count: 23, children: [] }).stations).toBe(4)
    }
  })

  it('takes its bounds from the carousel rule rather than from its own literals', () => {
    expect(at(0).stations).toBe(MIN_STATIONS)
    expect(at(999).stations).toBe(MAX_STATIONS)
  })
})

describe('the groups', () => {
  const order = (ids: string[]): TeamOrder => ({
    positionByTeam: new Map(ids.map((id, i) => [id, i + 1])),
  })

  it('keeps normal teams whole when the counts allow it', () => {
    const rows = [
      ...squad(6, 't1', 'One'),
      ...squad(6, 't2', 'Two'),
      ...squad(6, 't3', 'Three'),
      ...squad(6, 't4', 'Four'),
    ]
    const plan = planSetup(rows, includeAll(rows), order(['t1', 't2', 't3', 't4']))
    expect(plan.recommendation.groups).toBe(5)
    // Five recommended, four teams: one team is split rather than every
    // team being reshuffled.
    expect(plan.groups).toHaveLength(5)
    const whole = plan.groups.filter((g) => g.teamNames.length === 1)
    expect(whole.length).toBeGreaterThanOrEqual(3)
  })

  it('gives one group per team when the counts line up exactly', () => {
    const rows = [
      ...squad(4, 't1', 'One'),
      ...squad(4, 't2', 'Two'),
      ...squad(4, 't3', 'Three'),
      ...squad(4, 't4', 'Four'),
    ]
    // 16 expected recommends four groups, and there are four teams.
    const plan = planSetup(rows, includeAll(rows), order(['t1', 't2', 't3', 't4']))
    expect(plan.recommendation.groups).toBe(4)
    expect(plan.groups).toHaveLength(4)
    for (const g of plan.groups) expect(g.teamNames).toHaveLength(1)
    expect(plan.notes).not.toContain('team-split')
    expect(plan.notes).not.toContain('teams-combined')
  })

  it('combines only adjacent bands', () => {
    // Five teams in stated club order, 20 children, so four groups: one
    // pair must combine, and it must be a pair that sits together in the
    // order. A group holding the first and last team would be the defect.
    const rows = [
      ...squad(4, 't1', 'One'),
      ...squad(4, 't2', 'Two'),
      ...squad(4, 't3', 'Three'),
      ...squad(4, 't4', 'Four'),
      ...squad(4, 't5', 'Five'),
    ]
    const plan = planSetup(rows, includeAll(rows), order(['t1', 't2', 't3', 't4', 't5']))
    expect(plan.recommendation.groups).toBe(4)
    expect(plan.groups).toHaveLength(4)
    expect(plan.notes).toContain('teams-combined')
    const position = new Map([
      ['One', 1],
      ['Two', 2],
      ['Three', 3],
      ['Four', 4],
      ['Five', 5],
    ])
    for (const g of plan.groups) {
      if (g.teamNames.length < 2) continue
      const ps = g.teamNames.map((n) => position.get(n) as number).sort((a, b) => a - b)
      expect(ps[ps.length - 1] - ps[0]).toBe(ps.length - 1)
    }
  })

  it('combines the smallest adjacent pair, so the numbers stay sensible', () => {
    // Five teams in club order sized 10, 9, 2, 3 and 8, and four groups.
    // Exactly one adjacent pair must combine, and combining the two small
    // ones in the middle keeps every group workable. Combining any other
    // adjacent pair makes a group of 17 or more beside a group of 2.
    // Sizes 6, 2, 2, 5, 5 in club order, and four groups. The smallest
    // adjacent pair is Two and Three, and it sits at an ODD position on
    // purpose: a search that skipped alternate pairs would still find a
    // plausible-looking answer on an even-indexed fixture and pass.
    const rows = [
      ...squad(6, 't1', 'One'),
      ...squad(2, 't2', 'Two'),
      ...squad(2, 't3', 'Three'),
      ...squad(5, 't4', 'Four'),
      ...squad(5, 't5', 'Five'),
    ]
    const plan = planSetup(rows, includeAll(rows), order(['t1', 't2', 't3', 't4', 't5']))
    expect(plan.recommendation.groups).toBe(4)
    const combined = plan.groups.filter((g) => g.teamNames.length > 1)
    expect(combined).toHaveLength(1)
    expect(combined[0].teamNames).toEqual(['Two', 'Three'])
    // Nothing lopsided: combining any other adjacent pair leaves a group of
    // two on its own beside a group of eight or ten.
    expect(plan.groups.map((g) => g.children.length)).toEqual([6, 4, 5, 5])
  })

  it('weighs the PAIR, not just the smaller side of it', () => {
    // Sizes 2, 12, 3, 4, 2 in club order, and four groups. The smallest
    // single team is One at the front, but merging it costs 14 because its
    // only neighbour is the big one; the cheapest PAIR is Four and Five at
    // 6. A rule that reached for the smallest team rather than the smallest
    // pair would put 14 children on one station and leave 2 on another.
    const rows = [
      ...squad(2, 't1', 'One'),
      ...squad(12, 't2', 'Two'),
      ...squad(3, 't3', 'Three'),
      ...squad(4, 't4', 'Four'),
      ...squad(2, 't5', 'Five'),
    ]
    const plan = planSetup(rows, includeAll(rows), order(['t1', 't2', 't3', 't4', 't5']))
    expect(plan.recommendation.groups).toBe(4)
    const combined = plan.groups.filter((g) => g.teamNames.length > 1)
    expect(combined).toHaveLength(1)
    expect(combined[0].teamNames).toEqual(['Four', 'Five'])
    // Two stays whole at twelve, which is the brief's own priority order:
    // team continuity first, and splitting a squad only as a last resort.
    expect(plan.groups.map((g) => g.children.length)).toEqual([2, 12, 3, 6])
  })

  it('prefers uneven groups over splitting two squads', () => {
    // 6/5/5/4 beats 5/5/5/5 bought by breaking up two teams. Four teams of
    // 6, 5, 5 and 4 already fit four groups, so nothing is split.
    const rows = [
      ...squad(6, 't1', 'One'),
      ...squad(5, 't2', 'Two'),
      ...squad(5, 't3', 'Three'),
      ...squad(4, 't4', 'Four'),
    ]
    const plan = planSetup(rows, includeAll(rows), order(['t1', 't2', 't3', 't4']))
    expect(plan.recommendation.groups).toBe(4)
    expect(plan.groups.map((g) => g.children.length).sort((a, b) => b - a)).toEqual([6, 5, 5, 4])
    expect(plan.notes).not.toContain('team-split')
  })

  it('keeps teams whole and says the order is unset when the club has none', () => {
    // COACH-1 has not shipped, so this is the production case today.
    const rows = [...squad(5, 't1', 'One'), ...squad(5, 't2', 'Two'), ...squad(5, 't3', 'Three'), ...squad(5, 't4', 'Four')]
    const plan = planSetup(rows, includeAll(rows), null)
    expect(plan.bandingKnown).toBe(false)
    expect(plan.notes).toContain('team-order-unset')
    expect(SETUP_NOTES['team-order-unset']).toMatch(/order/i)
    for (const g of plan.groups) expect(g.teamNames).toHaveLength(1)
  })

  it('reports banding as known once the club has stated an order', () => {
    const rows = squad(8, 't1', 'One')
    expect(planSetup(rows, includeAll(rows), order(['t1'])).bandingKnown).toBe(true)
    expect(planSetup(rows, includeAll(rows), order(['t1'])).notes).not.toContain('team-order-unset')
  })

  it('follows the club order rather than the arrival order when it has one', () => {
    // The rows arrive Three, One, Two; the club says One, Two, Three. The
    // groups must read in the club's order, because that is what makes
    // "combine only adjacent bands" mean anything.
    const rows = [...squad(6, 't3', 'Three'), ...squad(6, 't1', 'One'), ...squad(6, 't2', 'Two')]
    const plan = planSetup(rows, includeAll(rows), order(['t1', 't2', 't3']))
    const seen: string[] = []
    for (const name of plan.groups.flatMap((g) => g.teamNames)) {
      if (seen[seen.length - 1] !== name) seen.push(name)
    }
    expect(seen).toEqual(['One', 'Two', 'Three'])
  })

  it('places every expected child exactly once', () => {
    const rows = [...squad(7, 't1', 'One'), ...squad(9, 't2', 'Two'), ...squad(11, 't3', 'Three')]
    const plan = planSetup(rows, includeAll(rows), order(['t1', 't2', 't3']))
    const placed = plan.groups.flatMap((g) => g.children.map((c) => c.playerId))
    expect(placed).toHaveLength(plan.recommendation.expected.count)
    expect(new Set(placed).size).toBe(placed.length)
  })

  it('never places a child who is not expected', () => {
    const going = replied(squad(6, 't1', 'One'), 'accepted')
    const notGoing = replied(squad(6, 't1', 'One'), 'declined')
    const plan = planSetup([...going, ...notGoing], emptyDraft(), null)
    const placed = new Set(plan.groups.flatMap((g) => g.children.map((c) => c.playerId)))
    for (const c of notGoing) expect(placed.has(c.playerId)).toBe(false)
  })

  it('makes no groups and says so when nobody is expected', () => {
    const plan = planSetup(replied(squad(5, 't1', 'One'), 'declined'), emptyDraft(), null)
    expect(plan.groups).toEqual([])
    expect(plan.notes).toContain('nobody-to-place')
  })

  it('says when there are too few players to fill the recommended groups', () => {
    const rows = squad(3, 't1', 'One')
    const plan = planSetup(rows, includeAll(rows), null)
    expect(plan.recommendation.groups).toBe(4)
    expect(plan.groups.length).toBeLessThan(4)
    expect(plan.notes).toContain('fewer-groups-than-recommended')
  })

  it('keeps a child with no team as their own place rather than folding them into a squad', () => {
    const rows = [...squad(8, 't1', 'One'), row({ teamId: null, teamName: null })]
    const plan = planSetup(rows, includeAll(rows), null)
    const placed = plan.groups.flatMap((g) => g.children)
    expect(placed.filter((c) => c.teamId === null)).toHaveLength(1)
  })
})

describe('the colours', () => {
  const rows4 = () => [
    ...squad(4, 't1', 'One'),
    ...squad(4, 't2', 'Two'),
    ...squad(4, 't3', 'Three'),
    ...squad(4, 't4', 'Four'),
  ]

  it('gives every group a unique colour', () => {
    const rows = rows4()
    const plan = planSetup(rows, includeAll(rows), null)
    const colours = plan.groups.map((g) => g.colour)
    expect(new Set(colours).size).toBe(colours.length)
  })

  it('takes them in the fixed vocabulary order', () => {
    const rows = rows4()
    const plan = planSetup(rows, includeAll(rows), null)
    expect(plan.groups.map((g) => g.colour)).toEqual(BIB_COLOURS.slice(0, 4).map((b) => b.value))
  })

  it('lets a whole team keep its own default colour where it is free', () => {
    // The suggestion does not rewrite a club's established colours for no
    // reason, which is also what keeps the number of stored overrides down.
    const rows = [
      ...squad(4, 't1', 'One', 'green'),
      ...squad(4, 't2', 'Two', 'purple'),
      ...squad(4, 't3', 'Three', null),
      ...squad(4, 't4', 'Four', null),
    ]
    const plan = planSetup(rows, includeAll(rows), null)
    const byTeam = new Map(plan.groups.map((g) => [g.teamNames[0], g.colour]))
    expect(byTeam.get('One')).toBe('green')
    expect(byTeam.get('Two')).toBe('purple')
    expect(new Set(plan.groups.map((g) => g.colour)).size).toBe(4)
  })

  it('never hands two teams one colour even when they share a default', () => {
    const rows = [
      ...squad(4, 't1', 'One', 'red'),
      ...squad(4, 't2', 'Two', 'red'),
      ...squad(4, 't3', 'Three', 'red'),
      ...squad(4, 't4', 'Four', 'red'),
    ]
    const plan = planSetup(rows, includeAll(rows), null)
    expect(new Set(plan.groups.map((g) => g.colour)).size).toBe(4)
  })

  it('only ever names a colour the club vocabulary holds', () => {
    const rows = [...squad(8, 't1', 'One', 'chartreuse'), ...squad(8, 't2', 'Two', BIB_NONE)]
    const plan = planSetup(rows, includeAll(rows), null)
    const vocabulary = new Set(BIB_COLOURS.map((b) => b.value))
    for (const g of plan.groups) expect(vocabulary.has(g.colour)).toBe(true)
  })

  it('labels the group the way the grass does', () => {
    const rows = squad(8, 't1', 'One')
    const plan = planSetup(rows, includeAll(rows), null)
    expect(plan.groups[0].label).toBe('Red bibs')
  })
})

describe('what the plan derives and what it would store', () => {
  it('starts group 1 at station 1, derived rather than stored', () => {
    const rows = [...squad(6, 't1', 'One'), ...squad(6, 't2', 'Two'), ...squad(6, 't3', 'Three'), ...squad(6, 't4', 'Four')]
    const plan = planSetup(rows, includeAll(rows), null)
    plan.groups.forEach((g, i) => {
      expect(g.index).toBe(i + 1)
      expect(groupStartStation(g)).toBe(i + 1)
    })
  })

  it('writes an override only where the canonical rule does not already answer', () => {
    // A child whose team default already IS the group colour needs no
    // override, and giving them one would pin them to a colour their team
    // later moves away from. Four teams of four is four whole groups, so
    // every team keeps its own colour and nothing is stored at all.
    const rows = [
      ...squad(4, 't1', 'One', 'red'),
      ...squad(4, 't2', 'Two', 'blue'),
      ...squad(4, 't3', 'Three', 'green'),
      ...squad(4, 't4', 'Four', 'yellow'),
    ]
    const draft = includeAll(rows)
    const plan = planSetup(rows, draft, null)
    expect(plan.groups.map((g) => g.colour)).toEqual(['red', 'blue', 'green', 'yellow'])
    expect(planBibOverrides(plan, draft)).toEqual({})
  })

  it('writes an override for a child the group colour moves', () => {
    // Two teams share red, so one keeps it and the other is moved. Exactly
    // one squad is written for, and every child in it gets one colour.
    const rows = [
      ...squad(4, 't1', 'One', 'red'),
      ...squad(4, 't2', 'Two', 'red'),
      ...squad(4, 't3', 'Three', 'green'),
      ...squad(4, 't4', 'Four', 'yellow'),
    ]
    const draft = includeAll(rows)
    const plan = planSetup(rows, draft, null)
    const overrides = planBibOverrides(plan, draft)
    expect(Object.keys(overrides)).toHaveLength(4)
    expect(new Set(Object.values(overrides)).size).toBe(1)
    // The moved squad is the SECOND to claim red, never the first.
    const moved = new Set(Object.keys(overrides))
    expect(rows.slice(4, 8).every((r) => moved.has(r.playerId))).toBe(true)
  })

  it('produces nothing but bib colours keyed by player', () => {
    // ASSERTED DIRECTLY, because a well-meaning "also update their team"
    // convenience is the most plausible regression in this programme.
    // Moving a child into a different group for one session must say
    // nothing about their team, their default next week, or their Spond
    // membership.
    const rows = [...squad(5, 't1', 'One', 'blue'), ...squad(5, 't2', 'Two', 'blue')]
    const draft = includeAll(rows)
    const plan = planSetup(rows, draft, null)
    const overrides = planBibOverrides(plan, draft)
    const ids = new Set(rows.map((r) => r.playerId))
    const vocabulary = new Set(BIB_COLOURS.map((b) => b.value))
    for (const [key, value] of Object.entries(overrides)) {
      expect(ids.has(key)).toBe(true)
      expect(vocabulary.has(value)).toBe(true)
    }
    // Nothing in the plan itself carries a team id destined for a write:
    // the groups hold rows, and a row is a read of the register.
    expect(Object.values(overrides).every((v) => typeof v === 'string')).toBe(true)
  })

  it('respects an override the coach has already set', () => {
    const rows = squad(4, 't1', 'One', 'red')
    const draft = draftWith({
      included: Object.fromEntries(rows.map((r) => [r.playerId, true])),
      bibs: { [rows[0].playerId]: 'black' },
    })
    const plan = planSetup(rows, draft, null)
    const overrides = planBibOverrides(plan, draft)
    // The group is red and this child is black, so the plan proposes
    // moving them back rather than silently reading them as already right.
    expect(overrides[rows[0].playerId]).toBe(plan.groups[0].colour)
  })
})

describe('readiness names the fix', () => {
  it('is ready when every selected child has a colour and the groups are distinct', () => {
    const rows = [...squad(4, 't1', 'One', 'red'), ...squad(4, 't2', 'Two', 'blue')]
    expect(setupReadiness(rows, includeAll(rows), 2)).toEqual({ ready: true, issues: [] })
  })

  it('is not ready when a selected child has no effective bib', () => {
    const rows = [...squad(4, 't1', 'One', 'red'), ...squad(4, 't2', 'Two', null)]
    const r = setupReadiness(rows, includeAll(rows), 2)
    expect(r.ready).toBe(false)
    expect(r.issues).toContain('child-without-bib')
    expect(SETUP_ISSUE_FIXES['child-without-bib']).toMatch(/bib/i)
  })

  it('counts a stored no-bib choice as no bib, not as a colour', () => {
    const rows = squad(4, 't1', 'One', 'red')
    const draft = draftWith({
      included: Object.fromEntries(rows.map((r) => [r.playerId, true])),
      bibs: { [rows[0].playerId]: BIB_NONE },
    })
    expect(setupReadiness(rows, draft, 1).issues).toContain('child-without-bib')
  })

  it('is not ready when two groups would wear one colour', () => {
    // The register resolves groups BY colour, so two groups in red are one
    // group on the grass.
    const rows = [...squad(4, 't1', 'One', 'red'), ...squad(4, 't2', 'Two', 'red')]
    const r = setupReadiness(rows, includeAll(rows), 2)
    expect(r.ready).toBe(false)
    expect(r.issues).toContain('groups-share-colour')
    expect(SETUP_ISSUE_FIXES['groups-share-colour']).toMatch(/different bib/i)
  })

  it('does not blame the colours when the problem is too few players', () => {
    // Six children for five groups is a player shortage, not a colour
    // clash, and naming the wrong fix sends a coach to the wrong screen.
    const rows = squad(3, 't1', 'One', 'red')
    expect(setupReadiness(rows, includeAll(rows), 5).issues).not.toContain('groups-share-colour')
  })

  it('says nothing at all before the coach has selected anybody', () => {
    const rows = squad(20, 't1', 'One', null)
    expect(setupReadiness(rows, emptyDraft(), 4)).toEqual({ ready: true, issues: [] })
  })

  it('ignores a child the coach has not selected', () => {
    const rows = [...squad(4, 't1', 'One', 'red'), ...squad(4, 't2', 'Two', null)]
    const draft = includeAll(rows.slice(0, 4))
    expect(setupReadiness(rows, draft, 1)).toEqual({ ready: true, issues: [] })
  })

  it('names a fix for every issue it can raise', () => {
    for (const fix of Object.values(SETUP_ISSUE_FIXES)) expect(fix.length).toBeGreaterThan(20)
  })
})

describe('nothing here persists', () => {
  it('leaves the draft untouched', () => {
    // The suggestion is a draft the coach edits, and Save groups is the
    // only thing that writes. A generator that mutated the draft in place
    // would persist on the next save whether the coach accepted it or not.
    const rows = [...squad(6, 't1', 'One', 'red'), ...squad(6, 't2', 'Two', null)]
    const draft = includeAll(rows)
    const before = JSON.stringify(draft)
    const plan = planSetup(rows, draft, null)
    planBibOverrides(plan, draft)
    setupReadiness(rows, draft, plan.recommendation.groups)
    expect(JSON.stringify(draft)).toBe(before)
  })

  it('leaves the rows untouched', () => {
    const rows = [...squad(6, 't1', 'One', 'red'), ...squad(6, 't2', 'Two', null)]
    const before = JSON.stringify(rows)
    planSetup(rows, includeAll(rows), null)
    expect(JSON.stringify(rows)).toBe(before)
  })

  it('never stands a station down', () => {
    // Recommending four where a plan declares five is advice about the
    // plan, not an edit to it. Nothing in this module produces `skipped`.
    const rows = squad(10, 't1', 'One')
    const plan = planSetup(rows, includeAll(rows), null)
    expect(JSON.stringify(plan)).not.toContain('skipped')
    expect(JSON.stringify(plan)).not.toContain('slot')
  })
})

describe('what the plan says about the coach s own session plan', () => {
  const act = (over: Partial<StructuredActivity> = {}): StructuredActivity =>
    ({ duration: 10, ...over }) as StructuredActivity
  const stations = (n: number, over: Partial<StructuredActivity> = {}) =>
    Array.from({ length: n }, () => act({ slot: 'station', ...over }))
  const rec = (count: number) => recommendSetup({ source: 'squad', count, children: [] })

  it('says nothing when the plan already matches', () => {
    const fit = stationAdvice(rec(24), stations(5))
    expect(fit.kind).toBe('matches')
    expect(stationFitNote(fit)).toBe('')
  })

  it('names both numbers when they disagree', () => {
    const fewer = stationAdvice(rec(24), stations(4))
    expect(fewer.kind).toBe('plan-declares-fewer')
    expect(stationFitNote(fewer)).toContain('4')
    expect(stationFitNote(fewer)).toContain('5')

    const more = stationAdvice(rec(10), stations(5))
    expect(more.kind).toBe('plan-declares-more')
  })

  it('tells an undeclared plan apart from one stood all the way down', () => {
    // Two different facts. Reading the second as the first would tell a
    // coach to declare stations they have already declared.
    expect(stationAdvice(rec(24), []).kind).toBe('no-stations-declared')
    expect(stationAdvice(rec(24), [act(), act()]).kind).toBe('no-stations-declared')
    const down = stationAdvice(rec(24), stations(4, { skipped: true }))
    expect(down.kind).toBe('all-stations-stood-down')
    expect(down.declared).toBe(4)
  })

  it('borrows the planner s own wording for the two zero cases', () => {
    // The coach reads the same sentence here that the plan already showed
    // them, rather than a second phrasing of one fact.
    expect(stationFitNote(stationAdvice(rec(24), []))).toBe(
      ACTIVITY_STRUCTURE_WARNINGS['no-stations-declared'],
    )
    expect(stationFitNote(stationAdvice(rec(24), stations(4, { skipped: true })))).toBe(
      ACTIVITY_STRUCTURE_WARNINGS['all-stations-stood-down'],
    )
  })

  it('counts only the stations that are running', () => {
    const mixed = [...stations(3), ...stations(2, { skipped: true })]
    expect(stationAdvice(rec(24), mixed).declared).toBe(3)
  })

  it('is advice: it never edits the plan', () => {
    // The explicit rule. A station is NEVER stood down because four rather
    // than five is recommended.
    const plan = stations(5)
    const before = JSON.stringify(plan)
    stationAdvice(rec(10), plan)
    expect(JSON.stringify(plan)).toBe(before)
    expect(plan.every((a) => !('skipped' in a))).toBe(true)
  })

  it('says nothing at all about a plan when there is no note to make', () => {
    expect(stationFitNote(stationAdvice(rec(23), stations(4)))).toBe('')
  })
})

describe('accepting the suggestion', () => {
  const rows4 = () => [
    ...squad(4, 't1', 'One', 'red'),
    ...squad(4, 't2', 'Two', 'red'),
    ...squad(4, 't3', 'Three', 'green'),
    ...squad(4, 't4', 'Four', 'yellow'),
  ]

  it('includes every child the plan placed', () => {
    const rows = rows4()
    const plan = planSetup(rows, emptyDraft(), null)
    const next = applySetup(emptyDraft(), plan)
    for (const c of plan.groups.flatMap((g) => g.children)) {
      expect(next.included[c.playerId]).toBe(true)
    }
  })

  it('stamps every field it wrote, so the save actually sends them', () => {
    // `touched` is how draftDelta recognises a change AT FIELD LEVEL, and a
    // draft assembled by writing `included` and `bibs` directly looks
    // identical on screen while sending NOTHING for the unstamped fields.
    //
    // THIS MUST BE MEASURED AGAINST STORED ROWS. With no stored entry every
    // row is `isNew`, which forces all three flags true on its own, so the
    // same assertion over an empty entry list passes whether or not
    // anything was stamped. That is not a hypothetical: the first version
    // of this test did exactly that and a mutation removing the stamp
    // survived it.
    const rows = rows4()
    const stored = rows.map((r) => ({
      sessionId: 'session-1',
      playerId: r.playerId,
      present: false,
      includedInGroups: false,
      bibColourOverride: null,
      source: 'roster' as const,
    }))
    const open = draftFromEntries(stored)
    const plan = planSetup(rows, open, null)
    const next = applySetup(open, plan)
    const byPlayer = new Map(draftDelta(next, stored, 'session-1').map((c) => [c.playerId, c]))
    const placed = plan.groups.flatMap((g) => g.children)
    expect(placed.length).toBeGreaterThan(0)
    for (const c of placed) {
      const change = byPlayer.get(c.playerId)
      expect(change, c.playerId).toBeDefined()
      expect(change?.includedChanged, c.playerId).toBe(true)
      expect(change?.includedInGroups, c.playerId).toBe(true)
      // And it moves NO attendance, so a coach marking arrivals beside this
      // one cannot be overwritten by accepting a suggestion.
      expect(change?.presentChanged, c.playerId).toBe(false)
    }
    for (const playerId of Object.keys(planBibOverrides(plan, open))) {
      expect(byPlayer.get(playerId)?.bibChanged, playerId).toBe(true)
    }
    expect(draftIsDirty(next, stored)).toBe(true)
  })

  it('never unticks anybody', () => {
    // Removing a child who is no longer coming is COACH-4. Nothing in this
    // slice takes a child out of the coach's arrangement.
    const rows = rows4()
    const keep = rows[0].playerId
    const before = draftWith({ included: { [keep]: true } })
    // A plan built from RSVP that excludes them entirely.
    const going = rows.slice(4).map((r) => ({ ...r, response: 'accepted' as RsvpStatus }))
    const plan = planSetup([{ ...rows[0], response: 'declined' as RsvpStatus }, ...going], before, null)
    const next = applySetup(before, plan)
    expect(next.included[keep]).toBe(true)
  })

  it('sets no attendance', () => {
    // Being in a group and having turned up are two facts, and a
    // suggestion made a day early knows nothing about the second.
    const rows = rows4()
    const plan = planSetup(rows, emptyDraft(), null)
    expect(applySetup(emptyDraft(), plan).attendance).toEqual({})
  })

  it('creates no guest', () => {
    const rows = rows4()
    const plan = planSetup(rows, emptyDraft(), null)
    expect(applySetup(emptyDraft(), plan).added).toEqual({})
  })

  it('writes a bib only where the group colour moves the child', () => {
    const rows = rows4()
    const plan = planSetup(rows, emptyDraft(), null)
    const next = applySetup(emptyDraft(), plan)
    // Three teams keep their own colour; one shares red and is moved.
    expect(Object.keys(next.bibs)).toHaveLength(4)
  })

  it('does not mutate the draft it was given', () => {
    const rows = rows4()
    const draft = emptyDraft()
    const before = JSON.stringify(draft)
    applySetup(draft, planSetup(rows, draft, null))
    expect(JSON.stringify(draft)).toBe(before)
  })

  it('is idempotent', () => {
    // Pressing it twice is the same as pressing it once, so a coach who
    // taps again has not quietly changed the night.
    const rows = rows4()
    const plan = planSetup(rows, emptyDraft(), null)
    const once = applySetup(emptyDraft(), plan)
    const twice = applySetup(once, planSetup(rows, once, null))
    expect(twice.included).toEqual(once.included)
    expect(twice.bibs).toEqual(once.bibs)
  })

  it('leaves the night ready once applied', () => {
    const rows = rows4()
    const plan = planSetup(rows, emptyDraft(), null)
    const next = applySetup(emptyDraft(), plan)
    expect(setupReadiness(rows, next, plan.groups.length)).toEqual({ ready: true, issues: [] })
  })
})
