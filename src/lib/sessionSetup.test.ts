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
  type ExpectedAttendance,
  type TeamOrder,
  expectedAttendance,
  expectedAttendanceNote,
  groupStartStation,
  planBibChanges,
  planBibTargets,
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
  tonightGroups,
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

  it('answers locally for a child with no Spond link, rather than reading them as absent', () => {
    // No link means nobody asked them, so the RSVP source has nothing to
    // say about them and the LOCAL rule answers instead. Deciding the
    // branch once for the whole session read partial link coverage as
    // complete context and silently dropped every unlinked child.
    const rows = [...replied(squad(5, 't1', 'One'), 'accepted'), ...squad(20, 't1', 'One')]
    const e = expectedAttendance(rows, emptyDraft())
    expect(e.source).toBe('rsvp-partial')
    expect(e.count).toBe(25)
    expect(e.goingInSpond).toBe(5)
    expect(e.withoutSpondAnswer).toBe(20)
    expect(e.countedLocally).toBe(20)
  })

  it('never lets one reply turn twenty unasked children into a zero', () => {
    // The reported case, reproduced before it was fixed: one linked child
    // who declined beside twenty nobody asked produced an authoritative
    // "0 expected", which is the data-gap-as-zero this resolver exists to
    // prevent, one level below where it was being prevented.
    const rows = [...replied(squad(1, 't1', 'One'), 'declined'), ...squad(20, 't1', 'One')]
    const e = expectedAttendance(rows, emptyDraft())
    expect(e.count).toBe(20)
    expect(e.source).toBe('rsvp-partial')
  })

  it('counts this club s real link coverage honestly', () => {
    // 40 covered, 27 linked, 20 accepted, 13 with no link at all. Counting
    // only the accepted recommends four stations for a night 33 children
    // may well attend.
    const rows = [
      ...replied(squad(20, 't1', 'One'), 'accepted'),
      ...replied(squad(7, 't1', 'One'), 'declined'),
      ...squad(13, 't1', 'One'),
    ]
    const e = expectedAttendance(rows, emptyDraft())
    expect(e.count).toBe(33)
    expect(recommendSetup(e).stations).toBe(5)
  })

  it('says rsvp, not partial, when every covered child is linked', () => {
    const rows = [...replied(squad(5, 't1', 'One'), 'accepted'), ...replied(squad(5, 't1', 'One'), 'declined')]
    const e = expectedAttendance(rows, emptyDraft())
    expect(e.source).toBe('rsvp')
    expect(e.withoutSpondAnswer).toBe(0)
  })

  it('prefers the coach s selection among the unlinked once they have started', () => {
    const linked = replied(squad(4, 't1', 'One'), 'accepted')
    const unlinked = squad(10, 't1', 'One')
    const e = expectedAttendance([...linked, ...unlinked], includeAll(unlinked.slice(0, 3)))
    expect(e.count).toBe(7)
    expect(e.countedLocally).toBe(3)
    expect(e.withoutSpondAnswer).toBe(10)
  })

  it('counts the coach s selection when there is no RSVP context at all', () => {
    const rows = squad(30, 't1', 'One')
    const chosen = rows.slice(0, 18)
    const e = expectedAttendance(rows, includeAll(chosen))
    expect(e.source).toBe('included')
    expect(e.count).toBe(18)
  })

  it('reports the population and the counted subset apart on the pure local branch too', () => {
    // No RSVP context anywhere and five of twenty selected. The population
    // with no Spond answer is twenty; the count is five. Collapsing the two
    // is the same defect as on the mixed branch and is just as invisible,
    // so it is pinned on both.
    const rows = squad(20, 't1', 'One')
    const e = expectedAttendance(rows, includeAll(rows.slice(0, 5)))
    expect(e.source).toBe('included')
    expect(e.count).toBe(5)
    expect(e.countedLocally).toBe(5)
    expect(e.withoutSpondAnswer).toBe(20)
  })

  it('counts the covered squad before the coach has selected anybody', () => {
    // The generator exists to run 24 to 48 hours out, when the selection is
    // empty by definition. Answering "nobody" then would make it useless on
    // the only day it matters.
    const rows = squad(26, 't1', 'One')
    const e = expectedAttendance(rows, emptyDraft())
    expect(e.source).toBe('listed')
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

  it('still reports a true zero when every covered child was asked and declined', () => {
    // A real zero, and the only shape that can produce one on the RSVP
    // side: every covered child is linked, so nobody is unaccounted for.
    // Different from a broken integration, and `source` tells them apart.
    const rows = replied(squad(12, 't1', 'One'), 'declined')
    const e = expectedAttendance(rows, emptyDraft())
    expect(e.source).toBe('rsvp')
    expect(e.count).toBe(0)
  })

  it('leaves a guest out of the RSVP count and in the local one', () => {
    const covered = replied(squad(4, 't1', 'One'), 'accepted')
    const guest = { ...row({ teamId: 't9', teamName: 'Nine', manual: true }), response: 'accepted' as RsvpStatus }
    // The guest has no external fact for THIS session, so they are counted
    // locally beside the four who accepted rather than dropped.
    expect(expectedAttendance([...covered, guest], emptyDraft()).count).toBe(5)
    // With no covered reply there is no context, and the child standing in
    // front of the coach is expected whatever the mirror knows.
    expect(expectedAttendance([{ ...guest }], emptyDraft()).source).toBe('listed')
    expect(expectedAttendance([{ ...guest }], emptyDraft()).count).toBe(1)
  })

  it('never calls a guest a member of the squad', () => {
    // `manual: true` says in as many words that this child is outside the
    // covered squad, so a sentence claiming squad membership is
    // contradicted by the row it counted.
    const guest = row({ manual: true, teamId: 't9', teamName: 'Nine' })
    const note = expectedAttendanceNote(expectedAttendance([guest], emptyDraft()))
    expect(note).not.toMatch(/\bsquad\b/)
  })

  it('never claims squad membership on the local branch at all', () => {
    // The set is every child the session lists, guests included, so no arm
    // of the sentence may name it as the squad.
    for (const rows of [squad(9, 't1', 'One'), [row({ manual: true }), ...squad(3, 't1', 'One')]]) {
      for (const draft of [emptyDraft(), includeAll(rows.slice(0, 2))]) {
        expect(expectedAttendanceNote(expectedAttendance(rows, draft))).not.toMatch(/\bsquad\b/)
      }
    }
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
      (['rsvp', 'rsvp-partial', 'included', 'listed'] as const).map((source) =>
        expectedAttendanceNote({ source, count: 4, children: [], goingInSpond: 1, withoutSpondAnswer: 3, countedLocally: 3, localSource: 'listed' }),
      ),
    )
    expect(notes.size).toBe(4)
    // The mixed sentence names BOTH halves, because the count is made of
    // both and a bare figure would be the same confident falsehood as a
    // bare aggregate.
    const mixed = expectedAttendanceNote({
      source: 'rsvp-partial',
      count: 33,
      children: [],
      goingInSpond: 20,
      withoutSpondAnswer: 13,
      countedLocally: 13,
      localSource: 'listed',
    })
    expect(mixed).toContain('20')
    expect(mixed).toContain('13')
    expect(mixed).toContain('33')
    expect(expectedAttendanceNote({ source: 'rsvp', count: 1, children: [], goingInSpond: 0, withoutSpondAnswer: 1, countedLocally: 1, localSource: 'listed' })).toContain('1 player ')
  })

  it('never labels a counted subset as though it were the whole population', () => {
    // Four accepted, ten with no Spond answer, three of them selected. The
    // count is 7, and the sentence must not say "3 not linked" while ten
    // are unlinked: that is a selection figure wearing a link-coverage
    // label, which is exactly how "19 vs 11" came to look like a
    // contradiction when both numbers were right.
    const note = expectedAttendanceNote({
      source: 'rsvp-partial',
      count: 7,
      children: [],
      goingInSpond: 4,
      withoutSpondAnswer: 10,
      countedLocally: 3,
      localSource: 'included',
    })
    expect(note).toContain('3 selected from 10')
    expect(note).not.toMatch(/\bnot linked\b/)
  })

  it('never claims anything about linking, because a guest may well be linked', () => {
    // A quick added guest has no Spond answer for THIS session, which is a
    // fact about the event rather than about whether they have a link.
    // Calling them "not linked" is a claim this module cannot make.
    for (const localSource of ['included', 'listed'] as const) {
      const note = expectedAttendanceNote({
        source: 'rsvp-partial',
        count: 5,
        children: [],
        goingInSpond: 4,
        withoutSpondAnswer: 1,
        countedLocally: 1,
        localSource,
      })
      expect(note, localSource).not.toMatch(/\blinked\b/)
      expect(note, localSource).toContain('no Spond answer')
    }
  })

  it('always splits the count into exactly its two halves', () => {
    // count === goingInSpond + countedLocally, and the locally counted set
    // can never exceed the population it came out of. Those two hold for
    // any mix of rows, which is what stops a figure drifting from its label.
    const cases: TonightRow[][] = [
      [...replied(squad(4, 't1', 'One'), 'accepted'), ...squad(10, 't1', 'One')],
      [...replied(squad(4, 't1', 'One'), 'accepted'), ...replied(squad(3, 't1', 'One'), 'declined')],
      squad(9, 't1', 'One'),
      [...replied(squad(2, 't1', 'One'), 'waiting'), ...squad(5, 't1', 'One')],
    ]
    for (const rows of cases) {
      for (const draft of [emptyDraft(), includeAll(rows.slice(0, 2))]) {
        const e = expectedAttendance(rows, draft)
        expect(e.goingInSpond + e.countedLocally).toBe(e.count)
        expect(e.countedLocally).toBeLessThanOrEqual(e.withoutSpondAnswer)
      }
    }
  })
})

describe('the recommendation', () => {
  const at = (count: number) =>
    recommendSetup({ source: 'listed', count, children: [], goingInSpond: 0, withoutSpondAnswer: count, countedLocally: count, localSource: 'listed' })

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
    for (const source of ['rsvp', 'rsvp-partial', 'included', 'listed'] as const) {
      const e = (count: number): ExpectedAttendance => ({
        source,
        count,
        children: [],
        goingInSpond: 0,
        withoutSpondAnswer: count,
        countedLocally: count,
        localSource: 'listed',
      })
      expect(recommendSetup(e(24)).stations).toBe(5)
      expect(recommendSetup(e(23)).stations).toBe(4)
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

  it('treats a partial club order as unknown, and says which kind of unknown', () => {
    // The dangerous shape. bucketByTeam places the teams an order does not
    // mention by ARRIVAL order behind the ones it does, and fitToTarget then
    // combines "adjacent" pairs out of that mixture. Claiming the banding
    // was known suppressed the only sentence saying otherwise.
    const rows = [
      ...squad(4, 't1', 'One'),
      ...squad(4, 't2', 'Two'),
      ...squad(4, 't3', 'Three'),
      ...squad(4, 't4', 'Four'),
      ...squad(4, 't5', 'Five'),
    ]
    const plan = planSetup(rows, includeAll(rows), order(['t1', 't2']))
    expect(plan.bandingKnown).toBe(false)
    expect(plan.notes).toContain('team-order-incomplete')
    // And it is a DIFFERENT sentence from having stated nothing at all,
    // because those are different facts about the club.
    expect(plan.notes).not.toContain('team-order-unset')
    expect(SETUP_NOTES['team-order-incomplete']).not.toBe(SETUP_NOTES['team-order-unset'])
  })

  it('says the order is unset, not incomplete, when the club has stated nothing', () => {
    const rows = [...squad(4, 't1', 'One'), ...squad(4, 't2', 'Two')]
    const plan = planSetup(rows, includeAll(rows), null)
    expect(plan.notes).toContain('team-order-unset')
    expect(plan.notes).not.toContain('team-order-incomplete')
  })

  it('does not hold a child with no team against the club s order', () => {
    // The club's ordering of its teams cannot be expected to place somebody
    // who is on none of them.
    const rows = [...squad(4, 't1', 'One'), ...squad(4, 't2', 'Two'), row({ teamId: null, teamName: null })]
    const plan = planSetup(rows, includeAll(rows), order(['t1', 't2']))
    expect(plan.bandingKnown).toBe(true)
    expect(plan.notes).not.toContain('team-order-incomplete')
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

  it('does not say teams were combined when no group holds two teams', () => {
    // Five children with no team are five buckets, so reaching four groups
    // merges twice while no group holds a second team. Merging buckets and
    // combining squads are different facts, and the note names the second.
    const rows = Array.from({ length: 5 }, () => row({ teamId: null, teamName: null }))
    const plan = planSetup(rows, includeAll(rows), null)
    expect(plan.groups.every((g) => g.teamNames.length <= 1)).toBe(true)
    expect(plan.notes).not.toContain('teams-combined')
  })

  it('says teams were combined exactly when a group holds two of them', () => {
    const rows = [
      ...squad(4, 't1', 'One'),
      ...squad(4, 't2', 'Two'),
      ...squad(4, 't3', 'Three'),
      ...squad(4, 't4', 'Four'),
      ...squad(4, 't5', 'Five'),
    ]
    const plan = planSetup(rows.slice(0, 20), includeAll(rows.slice(0, 20)), order(['t1', 't2', 't3', 't4', 't5']))
    const combined = plan.groups.some((g) => g.teamNames.length > 1)
    expect(plan.notes.includes('teams-combined')).toBe(combined)
  })

  it('says a team was split exactly when one appears in two groups', () => {
    const rows = squad(12, 't1', 'One')
    const plan = planSetup(rows, includeAll(rows), null)
    const counts = new Map<string, number>()
    for (const g of plan.groups) for (const t of g.teamNames) counts.set(t, (counts.get(t) ?? 0) + 1)
    const split = [...counts.values()].some((n) => n > 1)
    expect(plan.notes.includes('team-split')).toBe(split)
  })

  it('does not call merged teamless children a split team', () => {
    const rows = Array.from({ length: 7 }, () => row({ teamId: null, teamName: null }))
    const plan = planSetup(rows, includeAll(rows), null)
    expect(plan.notes).not.toContain('team-split')
  })

  it('states each note at most once', () => {
    const rows = [...squad(6, 't1', 'One'), ...squad(6, 't2', 'Two'), ...squad(6, 't3', 'Three')]
    const plan = planSetup(rows, includeAll(rows), null)
    expect(new Set(plan.notes).size).toBe(plan.notes.length)
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

  it('numbers the groups in bib vocabulary order, the way the screen sorts them', () => {
    // tonightGroups sorts the saved groups by BIB_COLOURS. Numbering in
    // team order instead made the plan read green, purple, red, blue while
    // the screen read red, blue, green, purple, so "group 1 starts at
    // station 1" answered differently on two surfaces about one night.
    const rows = [
      ...squad(4, 't1', 'One', 'green'),
      ...squad(4, 't2', 'Two', 'purple'),
      ...squad(4, 't3', 'Three', null),
      ...squad(4, 't4', 'Four', null),
    ]
    const plan = planSetup(rows, includeAll(rows), null)
    expect(plan.groups.map((g) => g.colour)).toEqual(['red', 'blue', 'green', 'purple'])
    expect(plan.groups.map((g) => g.index)).toEqual([1, 2, 3, 4])
  })

  it('numbers them the same way the register would group them', () => {
    // The two orderings compared directly, over a plan where team order and
    // colour order genuinely disagree.
    const rows = [
      ...squad(4, 't1', 'One', 'black'),
      ...squad(4, 't2', 'Two', 'white'),
      ...squad(4, 't3', 'Three', null),
      ...squad(4, 't4', 'Four', null),
    ]
    const draft = includeAll(rows)
    const plan = planSetup(rows, draft, null)
    const applied = applySetup(draft, plan)
    const onScreen = tonightGroups(rows, applied)
    expect(onScreen.map((g) => g.bib)).toEqual(plan.groups.map((g) => g.colour))
    // And therefore the derived starting station agrees on both surfaces.
    plan.groups.forEach((g, i) => expect(groupStartStation(g)).toBe(i + 1))
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

  it('targets inherit, not a colour, where the team default already answers', () => {
    // A child whose team default already IS the group colour is targeted at
    // null: the row stores nothing, so they go on following their team and
    // a later change of team default still moves them. Storing a colour
    // here would pin them to one their team has left.
    const rows = [
      ...squad(4, 't1', 'One', 'red'),
      ...squad(4, 't2', 'Two', 'blue'),
      ...squad(4, 't3', 'Three', 'green'),
      ...squad(4, 't4', 'Four', 'yellow'),
    ]
    const draft = includeAll(rows)
    const plan = planSetup(rows, draft, null)
    expect(plan.groups.map((g) => g.colour)).toEqual(['red', 'blue', 'green', 'yellow'])
    const targets = planBibTargets(plan)
    expect(Object.keys(targets)).toHaveLength(16)
    expect(Object.values(targets).every((v) => v === null)).toBe(true)
    // And nothing actually changes, so the screen promises no edits.
    expect(planBibChanges(plan, draft)).toEqual({})
  })

  it('targets a colour for a child the group colour moves', () => {
    // Two teams share red, so one keeps it and the other is moved.
    const rows = [
      ...squad(4, 't1', 'One', 'red'),
      ...squad(4, 't2', 'Two', 'red'),
      ...squad(4, 't3', 'Three', 'green'),
      ...squad(4, 't4', 'Four', 'yellow'),
    ]
    const draft = includeAll(rows)
    const plan = planSetup(rows, draft, null)
    const changes = planBibChanges(plan, draft)
    expect(Object.keys(changes)).toHaveLength(4)
    expect(new Set(Object.values(changes)).size).toBe(1)
    // The moved squad is the SECOND to claim red, never the first.
    const moved = new Set(Object.keys(changes))
    expect(rows.slice(4, 8).every((r) => moved.has(r.playerId))).toBe(true)
  })

  it('targets every placed child, so the gesture is recorded for all of them', () => {
    // NOT ONLY the ones whose value differs from this draft. The draft is
    // frozen while the stored rows keep refetching, so a child the plan
    // "leaves alone" is a child whose bib another coach may have changed
    // since; without a stamp the save carries THEIR value and the plan's
    // colour silently never lands.
    const rows = [...squad(4, 't1', 'One', 'red'), ...squad(4, 't2', 'Two', 'red')]
    const draft = includeAll(rows)
    const plan = planSetup(rows, draft, null)
    const placed = plan.groups.flatMap((g) => g.children).map((c) => c.playerId)
    expect(Object.keys(planBibTargets(plan)).sort()).toEqual([...placed].sort())
  })

  it('produces nothing but a bib colour or inherit, keyed by player', () => {
    // ASSERTED DIRECTLY, because a well-meaning "also update their team"
    // convenience is the most plausible regression in this programme.
    // Moving a child into a different group for one session must say
    // nothing about their team, their default next week, or their Spond
    // membership.
    const rows = [...squad(5, 't1', 'One', 'blue'), ...squad(5, 't2', 'Two', 'blue')]
    const draft = includeAll(rows)
    const plan = planSetup(rows, draft, null)
    const ids = new Set(rows.map((r) => r.playerId))
    const vocabulary = new Set(BIB_COLOURS.map((b) => b.value))
    for (const [key, value] of Object.entries(planBibTargets(plan))) {
      expect(ids.has(key)).toBe(true)
      expect(value === null || vocabulary.has(value)).toBe(true)
    }
  })

  it('never targets the no-bib sentinel', () => {
    // Inherit is null. `none` is a coach's positive choice to wear nothing,
    // and a generator that produced it would be taking a bib off a child
    // nobody asked it to.
    const rows = [...squad(4, 't1', 'One', 'red'), ...squad(4, 't2', 'Two', null)]
    const plan = planSetup(rows, includeAll(rows), null)
    expect(Object.values(planBibTargets(plan))).not.toContain(BIB_NONE)
  })

  it('moves a child back who the coach had set to something else', () => {
    const rows = squad(4, 't1', 'One', 'red')
    const draft = draftWith({
      included: Object.fromEntries(rows.map((r) => [r.playerId, true])),
      bibs: { [rows[0].playerId]: 'black' },
    })
    const plan = planSetup(rows, draft, null)
    // The group is red and the team default is red, so the target is
    // inherit: clearing the override puts them back in the group's colour
    // without pinning them to it.
    expect(planBibTargets(plan)[rows[0].playerId]).toBeNull()
    expect(rows[0].playerId in planBibChanges(plan, draft)).toBe(true)
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

  it('does not blame the colours when the only problem is a bibless child', () => {
    // Four children in four distinct colours plus one with no bib, against
    // five groups. No colour is duplicated, so telling the coach to change
    // a bib names a fix that does not apply and sends them looking for a
    // clash that is not there.
    const rows = [
      ...squad(1, 'a', 'A', 'red'),
      ...squad(1, 'b', 'B', 'blue'),
      ...squad(1, 'c', 'C', 'green'),
      ...squad(1, 'd', 'D', 'yellow'),
      ...squad(1, 'e', 'E', null),
    ]
    const r = setupReadiness(rows, includeAll(rows), 5)
    expect(r.issues).toEqual(['child-without-bib'])
  })

  it('still reports a real clash when enough bibbed children share colours', () => {
    const rows = [
      ...squad(2, 'a', 'A', 'red'),
      ...squad(1, 'b', 'B', 'blue'),
      ...squad(1, 'c', 'C', 'green'),
      ...squad(1, 'd', 'D', 'yellow'),
    ]
    const r = setupReadiness(rows, includeAll(rows), 5)
    expect(r.issues).toContain('groups-share-colour')
    expect(r.issues).not.toContain('child-without-bib')
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
    planBibTargets(plan)
    planBibChanges(plan, draft)
    applySetup(draft, plan)
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
  const rec = (count: number) =>
    recommendSetup({ source: 'listed', count, children: [], goingInSpond: 0, withoutSpondAnswer: count, countedLocally: count, localSource: 'listed' })

  it('says nothing when the plan already matches', () => {
    const fit = stationAdvice(rec(24), stations(5))
    expect(fit.kind).toBe('matches')
    expect(stationFitNote(fit)).toBe('')
  })

  it('names both numbers when they disagree', () => {
    const fewer = stationAdvice(rec(24), stations(4))
    expect(fewer.kind).toBe('plan-runs-fewer')
    expect(stationFitNote(fewer)).toContain('4')
    expect(stationFitNote(fewer)).toContain('5')

    const more = stationAdvice(rec(10), stations(5))
    expect(more.kind).toBe('plan-runs-more')
  })

  it('tells an undeclared plan apart from one stood all the way down', () => {
    // Two different facts. Reading the second as the first would tell a
    // coach to declare stations they have already declared.
    expect(stationAdvice(rec(24), []).kind).toBe('no-stations-declared')
    expect(stationAdvice(rec(24), [act(), act()]).kind).toBe('no-stations-declared')
    const down = stationAdvice(rec(24), stations(4, { skipped: true }))
    expect(down.kind).toBe('all-stations-stood-down')
    expect(down.declared).toBe(4)
    expect(down.running).toBe(0)
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
    const fit = stationAdvice(rec(24), mixed)
    // Two different numbers, and neither stands in for the other: three
    // run, five are declared.
    expect(fit.running).toBe(3)
    expect(fit.declared).toBe(5)
  })

  it('never reports the running count as the declared one', () => {
    // A plan declaring five with one stood down runs four. Naming the
    // running figure `declared` made it assert something about the coach's
    // plan that the plan contradicts, and `matches` compounded it.
    const acts = [...stations(4), ...stations(1, { skipped: true })]
    const fit = stationAdvice(rec(10), acts)
    expect(fit.running).toBe(4)
    expect(fit.declared).toBe(5)
    expect(fit.kind).toBe('matches')
  })

  it('names the RUNNING count in the sentence, not the declared one', () => {
    // Five declared, one stood down, five recommended. The sentence must
    // say four: naming the declared figure here would read "runs 5 and the
    // numbers suggest 5" while telling the coach they disagree.
    const acts = [...stations(4), ...stations(1, { skipped: true })]
    const fit = stationAdvice(rec(24), acts)
    expect(fit.kind).toBe('plan-runs-fewer')
    expect(stationFitNote(fit)).toBe('This plan runs 4 stations and the numbers suggest 5.')
  })

  it('keeps running and declared apart on every arm', () => {
    const cases: StructuredActivity[][] = [
      [],
      stations(4),
      [...stations(3), ...stations(2, { skipped: true })],
      stations(5, { skipped: true }),
      stations(6),
    ]
    for (const acts of cases) {
      const fit = stationAdvice(rec(24), acts)
      // Running can never exceed declared, and a stood-down plan proves it.
      expect(fit.running).toBeLessThanOrEqual(fit.declared)
    }
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
    for (const playerId of Object.keys(planBibChanges(plan, open))) {
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

  it('stamps a bib gesture for every placed child, and stores a colour for only the moved ones', () => {
    const rows = rows4()
    const plan = planSetup(rows, emptyDraft(), null)
    const next = applySetup(emptyDraft(), plan)
    const placed = plan.groups.flatMap((g) => g.children).map((c) => c.playerId)
    // Every placed child carries a gesture, so a concurrent change cannot
    // quietly win the field.
    expect(Object.keys(next.bibs).sort()).toEqual([...placed].sort())
    // But only the moved squad carries an actual colour; the other three
    // teams are targeted at inherit and store nothing.
    const colours = Object.values(next.bibs).filter((v) => v !== null)
    expect(colours).toHaveLength(4)
  })

  it('sends nothing for a child whose stored bib already matches the gesture', () => {
    // Stamping everybody must not turn a no-op into a write. draftDelta
    // marks the bib changed only when there is actually something to move.
    const rows = rows4()
    const stored = rows.map((r) => ({
      sessionId: 'session-1',
      playerId: r.playerId,
      present: false,
      includedInGroups: true,
      bibColourOverride: null,
      source: 'roster' as const,
    }))
    const open = draftFromEntries(stored)
    const plan = planSetup(rows, open, null)
    const next = applySetup(open, plan)
    const changes = draftDelta(next, stored, 'session-1')
    // Only the squad the plan actually recolours is written for.
    expect(changes.filter((c) => c.bibChanged)).toHaveLength(4)
  })

  it('reasserts the plan colour over a change another coach made since the draft opened', () => {
    // The reported defect. The frozen draft agreed with the plan, so no
    // gesture was stamped, and draftDelta carried the other coach's stored
    // value forward: the child came out black on a red station and nothing
    // said so.
    const rows = squad(8, 't1', 'One', 'red')
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
    const refetched = stored.map((e) =>
      e.playerId === rows[0].playerId ? { ...e, bibColourOverride: 'black' } : e,
    )
    const change = draftDelta(next, refetched, 'session-1').find((c) => c.playerId === rows[0].playerId)
    expect(change?.bibChanged).toBe(true)
    expect(change?.bibColourOverride).toBeNull()
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
