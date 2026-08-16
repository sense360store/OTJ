// The team reconciliation rule, over the production shapes it was built for.
//
// PRODUCTION, 16 August 2026. The Spond links screen for Argonauts reported
// three mismatches it could only describe: a child whose Spond member sits
// in Gladiators' subgroup, one whose member sits in Spartans', and one whose
// member is in the club's parent group with no team at all. Those three are
// the first three describes below, and the club's real shape is the fixture:
// one parent group, five teams, five mapped subgroups, no whole group
// mapping. Names, ids and subgroup ids are synthetic throughout.
//
// The rule that outranks every other rule here: a name is not an identity.
// Every test that ends in a move starts from a stored link.
import { describe, expect, it } from 'vitest'
import {
  applicableMoves,
  canApplyAll,
  clubMapsWholeGroup,
  destinationLabel,
  destinationTeamId,
  elsewhereMemberIds,
  memberVerdict,
  spondReconcile,
  type SpondReconcileContext,
} from './spondReconcile'
import { subgroupIndex } from './spondLinking'
import type { LinkCandidate, SpondGroupMember, SpondLink, SubgroupIndex } from './spondLinking'
import type { RegisteredPlayer } from './data'

// ---- The club, as production has it ---------------------------------------

const ARGONAUTS = 'team-argonauts'
const GLADIATORS = 'team-gladiators'
const SPARTANS = 'team-spartans'

const SG_ARGONAUTS = 'SUBGROUPARGONAUTS00000000000000A'
const SG_GLADIATORS = 'SUBGROUPGLADIATORS0000000000000B'
const SG_SPARTANS = 'SUBGROUPSPARTANS000000000000000C'
const SG_UNMAPPED = 'SUBGROUPNOBODYMAPSTHIS000000000D'
// A subgroup two teams both claim. Distinct from SG_UNMAPPED on purpose:
// nobody claiming a subgroup is silence, two teams claiming it is a conflict,
// and only the second one can hide a second team assignment.
const SG_CONTESTED = 'SUBGROUPTWOTEAMSCLAIMTHIS00000E'

// The club's mapped subgroups as one value, exactly as subgroupIndex returns
// them. Built through the real function wherever a test is about the
// contested rule, so the fixture cannot disagree with the resolver.
const SUBGROUPS: SubgroupIndex = subgroupIndex([
  { subgroupId: SG_ARGONAUTS, teamId: ARGONAUTS, teamName: 'Argonauts' },
  { subgroupId: SG_GLADIATORS, teamId: GLADIATORS, teamName: 'Gladiators' },
  { subgroupId: SG_SPARTANS, teamId: SPARTANS, teamName: 'Spartans' },
])
// The same club, plus one subgroup Gladiators and Spartans both claim.
const SUBGROUPS_CONTESTED: SubgroupIndex = subgroupIndex([
  { subgroupId: SG_ARGONAUTS, teamId: ARGONAUTS, teamName: 'Argonauts' },
  { subgroupId: SG_GLADIATORS, teamId: GLADIATORS, teamName: 'Gladiators' },
  { subgroupId: SG_SPARTANS, teamId: SPARTANS, teamName: 'Spartans' },
  { subgroupId: SG_CONTESTED, teamId: GLADIATORS, teamName: 'Gladiators' },
  { subgroupId: SG_CONTESTED, teamId: SPARTANS, teamName: 'Spartans' },
])

// Synthetic uppercase hex member ids, the only shape the links table accepts.
const M_JOEY = '0123456789ABCDEF0123456789ABCDEF'
const M_OTHER = 'FEDCBA9876543210FEDCBA9876543210'
const M_THIRD = 'AAAABBBBCCCCDDDDEEEEFFFF00001111'

const player = (id: string, name: string, over: Partial<RegisteredPlayer> = {}): RegisteredPlayer => ({
  registrationId: `r-${id}`,
  playerId: id,
  seasonId: 'season-2026',
  teamId: ARGONAUTS,
  displayName: name,
  shirtNumber: null,
  status: 'registered',
  registeredDate: null,
  createdBy: null,
  updatedAt: '2026-08-16T00:00:00Z',
  ...over,
})

const candidate = (id: string, name: string): LinkCandidate => ({ spondMemberId: id, displayName: name })

const link = (memberId: string, playerId: string): SpondLink => ({
  spondMemberId: memberId,
  playerId,
  matchedBy: 'chosen',
  createdAt: '2026-08-16T00:00:00Z',
})

const outside = (name: string, subgroupIds: string[], id = ''): SpondGroupMember => ({
  displayName: name,
  spondMemberId: id,
  subgroupIds,
})

// The Argonauts view, everything proved unless a test says otherwise.
function run(over: Partial<SpondReconcileContext> = {}) {
  const base: SpondReconcileContext = {
    pool: [],
    clubRoster: [],
    links: [],
    candidates: [],
    candidatesComplete: true,
    outsideMembers: [],
    outsideComplete: true,
    subgroups: SUBGROUPS,
    subgroupMappingComplete: true,
    teamId: ARGONAUTS,
    teamName: 'Argonauts',
  }
  const ctx = { ...base, ...over }
  // The club list defaults to the team list, which is the honest default for
  // a one team fixture and is overridden wherever a second team matters.
  if (!over.clubRoster) ctx.clubRoster = ctx.pool
  return spondReconcile(ctx)
}

// ---- 1. A linked child Spond has moved to another team ---------------------

describe('a linked player whose Spond member is in another team subgroup', () => {
  const joey = player('p-joey', 'Joey Synthetic')

  it('offers Argonauts to Gladiators, from the link and never from the name', () => {
    const { rows, blocker } = run({
      pool: [joey],
      links: [link(M_JOEY, 'p-joey')],
      outsideMembers: [outside('Joey Synthetic', [SG_GLADIATORS], M_JOEY)],
    })
    expect(blocker).toBeNull()
    expect(rows).toHaveLength(1)
    expect(rows[0].state).toBe('move')
    expect(destinationLabel(rows[0].from)).toBe('Argonauts')
    expect(rows[0].to && destinationLabel(rows[0].to)).toBe('Gladiators')
    expect(destinationTeamId(rows[0].to!)).toBe(GLADIATORS)
    // A proved row names the member the destination came FROM, so the RPC can
    // refuse a link that has been repointed since the scan. It carries no
    // display name: there is nothing left for a human to recognise.
    expect(rows[0].memberId).toBe(M_JOEY)
    expect(rows[0].confirmName).toBeNull()
  })

  it('is decided by the member id, so a name that agrees with nobody changes nothing', () => {
    // The Spond member's display name here is somebody else's entirely. The
    // move still happens, because the link is the identity and the name is
    // not consulted at all on this path.
    const { rows } = run({
      pool: [joey],
      links: [link(M_JOEY, 'p-joey')],
      outsideMembers: [outside('Completely Different Synthetic', [SG_GLADIATORS], M_JOEY)],
    })
    expect(rows.map((r) => r.state)).toEqual(['move'])
    expect(rows[0].player.playerId).toBe('p-joey')
  })

  it('reads Spartans as Spartans, so the destination is the mapping and not a fixed pair', () => {
    const { rows } = run({
      pool: [joey],
      links: [link(M_JOEY, 'p-joey')],
      outsideMembers: [outside('Joey Synthetic', [SG_SPARTANS], M_JOEY)],
    })
    expect(rows[0].to && destinationLabel(rows[0].to)).toBe('Spartans')
  })
})

// ---- 2. A linked child Spond has in no team --------------------------------

describe('a linked player whose Spond member has no subgroup', () => {
  it('offers Argonauts to Unassigned', () => {
    const { rows } = run({
      pool: [player('p-noteam', 'Noteam Synthetic')],
      links: [link(M_JOEY, 'p-noteam')],
      outsideMembers: [outside('Noteam Synthetic', [], M_JOEY)],
    })
    expect(rows).toHaveLength(1)
    expect(rows[0].state).toBe('move')
    expect(rows[0].to).toEqual({ kind: 'unassigned' })
    expect(destinationTeamId(rows[0].to!)).toBeNull()
  })

  it('is not the same answer as a subgroup nobody maps', () => {
    // The distinction this rule exists for. No subgroup is Spond SAYING no
    // team. A subgroup no OTJ team maps is Spond saying a team this cannot
    // name, and reading it as Unassigned would take a child out of a squad
    // because a mapping is missing.
    const { rows } = run({
      pool: [player('p-unmapped', 'Unmapped Synthetic')],
      links: [link(M_JOEY, 'p-unmapped')],
      outsideMembers: [outside('Unmapped Synthetic', [SG_UNMAPPED], M_JOEY)],
    })
    expect(rows.map((r) => r.state)).toEqual(['unmapped'])
    expect(rows[0].to).toBeNull()
    expect(applicableMoves(rows)).toEqual([])
  })
})

// ---- 3. Agreement is silence -----------------------------------------------

describe('a linked player Spond already has on this team', () => {
  it('offers nothing, because the member is in this team mapped subgroup', () => {
    const { rows } = run({
      pool: [player('p-here', 'Here Synthetic')],
      links: [link(M_JOEY, 'p-here')],
      candidates: [candidate(M_JOEY, 'Here Synthetic')],
      outsideMembers: [],
    })
    expect(rows).toEqual([])
  })

  it('offers nothing when the scan places them here by subgroup either', () => {
    // The same answer through the other route: a member the diagnostics
    // happened to return whose subgroup resolves to the selected team.
    const { rows } = run({
      pool: [player('p-here', 'Here Synthetic')],
      links: [link(M_JOEY, 'p-here')],
      outsideMembers: [outside('Here Synthetic', [SG_ARGONAUTS], M_JOEY)],
    })
    expect(rows).toEqual([])
  })
})

// ---- 4. Ambiguity, in both of its shapes -----------------------------------

describe('a linked player whose Spond member is in more than one mapped subgroup', () => {
  it('fails closed and offers nothing', () => {
    const { rows } = run({
      pool: [player('p-two', 'Twoteams Synthetic')],
      links: [link(M_JOEY, 'p-two')],
      outsideMembers: [outside('Twoteams Synthetic', [SG_GLADIATORS, SG_SPARTANS], M_JOEY)],
    })
    expect(rows.map((r) => r.state)).toEqual(['ambiguous'])
    expect(rows[0].to).toBeNull()
    expect(applicableMoves(rows)).toEqual([])
  })

  it('treats a subgroup two teams both claim as AMBIGUOUS, never as either team', () => {
    // A review finding. A contested subgroup is membership of a MAPPED team
    // that cannot be named, which is a conflict, not silence. Reading it as
    // "unmapped" was the first version and was wrong in the companion case
    // below.
    const { rows } = run({
      pool: [player('p-contested', 'Contested Synthetic')],
      links: [link(M_JOEY, 'p-contested')],
      outsideMembers: [outside('Contested Synthetic', [SG_CONTESTED], M_JOEY)],
      subgroups: SUBGROUPS_CONTESTED,
    })
    expect(rows.map((r) => r.state)).toEqual(['ambiguous'])
    expect(rows[0].to).toBeNull()
    expect(rows[0].memberId).toBeNull()
    expect(applicableMoves(rows)).toEqual([])
  })
})

// ---- 4b. The contested companion subgroup, in every shape ------------------
//
// A REVIEW FINDING, and the reason the contested ids are carried rather than
// deleted. When a member is in one subgroup that maps uniquely to team A AND
// in another that two teams both claim, the first version resolved only the
// nameable one and offered an actionable move to A. That is acting on half
// the evidence: the member is in TWO mapped teams' subgroups, and one of them
// happens to be the one this club cannot name. Contested membership must
// outrank a simultaneous unique mapping.

describe('a contested subgroup outranks any unique mapping beside it', () => {
  const withSubgroups = (subgroupIds: string[]) =>
    run({
      pool: [player('p-x', 'Contested Synthetic')],
      links: [link(M_JOEY, 'p-x')],
      outsideMembers: [outside('Contested Synthetic', subgroupIds, M_JOEY)],
      subgroups: SUBGROUPS_CONTESTED,
    })

  it('unique + contested is ambiguous, not the unique team', () => {
    const { rows } = withSubgroups([SG_GLADIATORS, SG_CONTESTED])
    expect(rows.map((r) => r.state)).toEqual(['ambiguous'])
    expect(rows[0].to).toBeNull()
    expect(rows[0].memberId).toBeNull()
    expect(applicableMoves(rows)).toEqual([])
    expect(canApplyAll(rows)).toBe(false)
  })

  it('and the order of the two subgroups changes nothing', () => {
    const { rows } = withSubgroups([SG_CONTESTED, SG_GLADIATORS])
    expect(rows.map((r) => r.state)).toEqual(['ambiguous'])
  })

  it('contested only is ambiguous, and never Unassigned', () => {
    const { rows } = withSubgroups([SG_CONTESTED])
    expect(rows.map((r) => r.state)).toEqual(['ambiguous'])
    expect(rows[0].to).toBeNull()
  })

  it('two unique teams is ambiguous, as it always was', () => {
    const { rows } = withSubgroups([SG_GLADIATORS, SG_SPARTANS])
    expect(rows.map((r) => r.state)).toEqual(['ambiguous'])
  })

  it('unique only is actionable', () => {
    const { rows } = withSubgroups([SG_GLADIATORS])
    expect(rows.map((r) => r.state)).toEqual(['move'])
    expect(rows[0].to && destinationLabel(rows[0].to)).toBe('Gladiators')
    expect(canApplyAll(rows)).toBe(true)
  })

  it('unmapped only stays unmapped, because nobody claiming it is not a conflict', () => {
    const { rows } = withSubgroups([SG_UNMAPPED])
    expect(rows.map((r) => r.state)).toEqual(['unmapped'])
  })

  it('unmapped + unique is still the unique team: silence hides nothing', () => {
    // The companion case that proves the contested rule is about CONFLICT
    // rather than about "an id we could not resolve". A subgroup nobody maps
    // cannot be a second team, so it does not make the answer plural.
    const { rows } = withSubgroups([SG_UNMAPPED, SG_GLADIATORS])
    expect(rows.map((r) => r.state)).toEqual(['move'])
  })

  it('a contested member never reaches the bulk apply, even beside proved rows', () => {
    const clean = player('p-clean', 'Clean Synthetic')
    const dirty = player('p-dirty', 'Contested Synthetic')
    const { rows } = run({
      pool: [clean, dirty],
      clubRoster: [clean, dirty],
      links: [link(M_JOEY, 'p-clean'), link(M_OTHER, 'p-dirty')],
      outsideMembers: [
        outside('Clean Synthetic', [SG_GLADIATORS], M_JOEY),
        outside('Contested Synthetic', [SG_SPARTANS, SG_CONTESTED], M_OTHER),
      ],
      subgroups: SUBGROUPS_CONTESTED,
    })
    expect(rows.map((r) => r.state).sort()).toEqual(['ambiguous', 'move'])
    const bulk = applicableMoves(rows)
    expect(bulk).toHaveLength(1)
    expect(bulk[0].player.playerId).toBe('p-clean')
    expect(bulk.map((r) => r.player.playerId)).not.toContain('p-dirty')
  })

  it('and an UNLINKED child in a contested subgroup is offered no confirmation', () => {
    // The confirm path is the other way a contested member could be acted on.
    // It rides spondSetupRows, which reports the ambiguity and carries no
    // member, so nothing here has an identity to bind.
    const { rows } = run({
      pool: [player('p-gap', 'Gap Synthetic')],
      outsideMembers: [outside('Gap Synthetic', [SG_GLADIATORS, SG_CONTESTED], M_OTHER)],
      subgroups: SUBGROUPS_CONTESTED,
    })
    expect(rows).toEqual([])
  })
})

// ---- 5. The unlinked child: describe, never move ---------------------------

describe('an unlinked player whose name matches a member on another Spond team', () => {
  const gaps = {
    pool: [player('p-gap', 'Gap Synthetic')],
    outsideMembers: [outside('Gap Synthetic', [SG_GLADIATORS], M_OTHER)],
  }

  it('is offered as confirm, never as a move', () => {
    const { rows } = run(gaps)
    expect(rows).toHaveLength(1)
    expect(rows[0].state).toBe('confirm')
    expect(rows[0].to && destinationLabel(rows[0].to)).toBe('Gladiators')
    expect(rows[0].memberId).toBe(M_OTHER)
    expect(rows[0].confirmName).toBe('Gap Synthetic')
    // The identity rule, stated as a property of the output: nothing that
    // can be applied without a human first settling who this child is.
    expect(applicableMoves(rows)).toEqual([])
    expect(canApplyAll(rows)).toBe(false)
  })

  it('is not offered at all when the member carries no usable id', () => {
    // An id the links table would refuse is no identity to bind, so there
    // is nothing to confirm and the row stays a description in its own
    // section.
    const { rows } = run({
      pool: [player('p-gap', 'Gap Synthetic')],
      outsideMembers: [outside('Gap Synthetic', [SG_GLADIATORS], '')],
    })
    expect(rows).toEqual([])
  })

  it('offers Unassigned for a member Spond has in no team', () => {
    const { rows } = run({
      pool: [player('p-gap', 'Gap Synthetic')],
      outsideMembers: [outside('Gap Synthetic', [], M_OTHER)],
    })
    expect(rows.map((r) => r.state)).toEqual(['confirm'])
    expect(rows[0].to).toEqual({ kind: 'unassigned' })
  })
})

describe('duplicate names fail closed on both sides', () => {
  it('two Spond members of one name offer nothing', () => {
    const { rows } = run({
      pool: [player('p-gap', 'Gap Synthetic')],
      outsideMembers: [
        outside('Gap Synthetic', [SG_GLADIATORS], M_OTHER),
        outside('Gap Synthetic', [SG_SPARTANS], M_THIRD),
      ],
    })
    expect(rows).toEqual([])
  })

  it('two registered children of one name on the same team offer nothing', () => {
    const both = [player('p-a', 'Gap Synthetic'), player('p-b', 'Gap Synthetic')]
    const { rows } = run({
      pool: both,
      clubRoster: both,
      outsideMembers: [outside('Gap Synthetic', [SG_GLADIATORS], M_OTHER)],
    })
    expect(rows).toEqual([])
  })

  it('two registered children of one name on DIFFERENT teams offer nothing either', () => {
    // The club wide half. The setup rules scope their own two sided
    // ambiguity to the team being worked through, which is right for
    // describing a gap and not enough for confirming an identity: the
    // second child is on Gladiators, which is exactly where this member
    // sits, so a confirmation here would be as likely to be that child.
    const here = player('p-a', 'Gap Synthetic')
    const there = player('p-b', 'Gap Synthetic', { playerId: 'p-b', teamId: SPARTANS })
    const { rows } = run({
      pool: [here],
      clubRoster: [here, there],
      outsideMembers: [outside('Gap Synthetic', [SG_GLADIATORS], M_OTHER)],
    })
    expect(rows).toEqual([])
  })

  it('a withdrawn namesake does not block a confirmation', () => {
    // A withdrawn child is not on a team in any operational sense and is
    // never a candidate for a move, so counting them as a second claimant
    // would refuse a real reconciliation for no benefit.
    const here = player('p-a', 'Gap Synthetic')
    const gone = player('p-b', 'Gap Synthetic', { playerId: 'p-b', status: 'withdrawn' })
    const { rows } = run({
      pool: [here],
      clubRoster: [here, gone],
      outsideMembers: [outside('Gap Synthetic', [SG_GLADIATORS], M_OTHER)],
    })
    expect(rows.map((r) => r.state)).toEqual(['confirm'])
  })
})

// ---- 6. Nothing is stated off evidence that proves nothing -----------------

describe('the section states nothing rather than guessing', () => {
  const linked = {
    pool: [player('p-joey', 'Joey Synthetic')],
    links: [link(M_JOEY, 'p-joey')],
    outsideMembers: [outside('Joey Synthetic', [SG_GLADIATORS], M_JOEY)],
  }

  it('with no team chosen', () => {
    expect(run({ ...linked, teamId: null, teamName: null })).toEqual({ rows: [], blocker: 'no_team' })
  })

  it('with a member list that is not provably whole', () => {
    expect(run({ ...linked, candidatesComplete: false }).blocker).toBe('not_proved')
  })

  it('with a parent group scan that did not complete', () => {
    expect(run({ ...linked, outsideComplete: false }).blocker).toBe('not_proved')
  })

  it('with a deployment that does not answer the diagnostics at all', () => {
    expect(run({ ...linked, outsideMembers: null }).blocker).toBe('not_proved')
  })

  it('while any team in the club is mapped to a whole Spond group', () => {
    // A whole group mapping is a team assignment carried by no subgroup id,
    // so a subgroup based reading of Spond cannot be complete while one
    // exists. Production has none; the refusal is what keeps that true
    // rather than assumed.
    expect(run({ ...linked, subgroupMappingComplete: false }).blocker).toBe('whole_group_mapping')
  })

  it('and every blocked case offers nothing at all, not a shorter list', () => {
    for (const over of [
      { teamId: null, teamName: null },
      { candidatesComplete: false },
      { outsideComplete: false },
      { outsideMembers: null },
      { subgroupMappingComplete: false },
    ]) {
      expect(run({ ...linked, ...over }).rows).toEqual([])
    }
  })

  it('when the scan never saw the linked member at all', () => {
    // Not an error and not a mismatch: this is the orphan question, and the
    // link section answers it.
    const { rows, blocker } = run({
      pool: [player('p-joey', 'Joey Synthetic')],
      links: [link(M_JOEY, 'p-joey')],
      outsideMembers: [],
    })
    expect(blocker).toBeNull()
    expect(rows).toEqual([])
  })
})

// ---- 7. The pure destination rule, enumerated ------------------------------

describe('memberVerdict', () => {
  it('reads no subgroup as Unassigned', () => {
    expect(memberVerdict([], SUBGROUPS)).toEqual({ kind: 'destination', to: { kind: 'unassigned' } })
  })

  it('reads one mapped subgroup as that team', () => {
    expect(memberVerdict([SG_GLADIATORS], SUBGROUPS)).toEqual({
      kind: 'destination',
      to: { kind: 'team', teamId: GLADIATORS, teamName: 'Gladiators' },
    })
  })

  it('reads two subgroups of ONE team as that team, not as ambiguity', () => {
    const twoWays = subgroupIndex([
      { subgroupId: SG_GLADIATORS, teamId: GLADIATORS, teamName: 'Gladiators' },
      { subgroupId: 'SUBGROUPGLADIATORSSECOND000000FF', teamId: GLADIATORS, teamName: 'Gladiators' },
    ])
    expect(memberVerdict([SG_GLADIATORS, 'SUBGROUPGLADIATORSSECOND000000FF'], twoWays)).toEqual({
      kind: 'destination',
      to: { kind: 'team', teamId: GLADIATORS, teamName: 'Gladiators' },
    })
  })

  it('reads two teams as ambiguous', () => {
    expect(memberVerdict([SG_GLADIATORS, SG_SPARTANS], SUBGROUPS)).toEqual({ kind: 'ambiguous' })
  })

  it('reads a subgroup nobody maps as unmapped, never as Unassigned', () => {
    expect(memberVerdict([SG_UNMAPPED], SUBGROUPS)).toEqual({ kind: 'unmapped' })
  })

  it('reads a CONTESTED subgroup as ambiguous, which is not the same as unmapped', () => {
    expect(memberVerdict([SG_CONTESTED], SUBGROUPS_CONTESTED)).toEqual({ kind: 'ambiguous' })
  })

  it('lets a contested subgroup outrank a unique one, whichever way round', () => {
    expect(memberVerdict([SG_GLADIATORS, SG_CONTESTED], SUBGROUPS_CONTESTED)).toEqual({ kind: 'ambiguous' })
    expect(memberVerdict([SG_CONTESTED, SG_GLADIATORS], SUBGROUPS_CONTESTED)).toEqual({ kind: 'ambiguous' })
  })

  it('lets a contested subgroup outrank an empty list too, so it is never Unassigned', () => {
    // Vacuously true (an empty list contains no contested id) and asserted
    // anyway, because the ordering of these two branches is what a future
    // edit could get wrong.
    expect(memberVerdict([], SUBGROUPS_CONTESTED)).toEqual({ kind: 'destination', to: { kind: 'unassigned' } })
  })

  it('reads a mapped subgroup beside an unmapped one as the mapped team', () => {
    expect(memberVerdict([SG_UNMAPPED, SG_SPARTANS], SUBGROUPS)).toEqual({
      kind: 'destination',
      to: { kind: 'team', teamId: SPARTANS, teamName: 'Spartans' },
    })
  })
})

// ---- 8. The bulk button ----------------------------------------------------

describe('Apply all safe Spond changes', () => {
  const proved = (id: string, name: string, subgroup: string) => ({
    player: player(id, name),
    link: link(id.toUpperCase().padEnd(32, '0').slice(0, 32), id),
    member: outside(name, [subgroup], id.toUpperCase().padEnd(32, '0').slice(0, 32)),
  })

  it('is offered when every actionable row is proved, and covers exactly those rows', () => {
    const a = proved('paaaaaaa', 'Alpha Synthetic', SG_GLADIATORS)
    const b = proved('pbbbbbbb', 'Beta Synthetic', SG_SPARTANS)
    const { rows } = run({
      pool: [a.player, b.player],
      links: [a.link, b.link],
      outsideMembers: [a.member, b.member],
    })
    expect(rows.map((r) => r.state)).toEqual(['move', 'move'])
    expect(canApplyAll(rows)).toBe(true)
    expect(applicableMoves(rows)).toHaveLength(2)
  })

  it('is hidden outright as soon as one row needs an identity confirmed', () => {
    // The stricter of the two readings, on purpose: a button that silently
    // covers part of a list is how a manager comes to believe rows were
    // handled that were not.
    const a = proved('paaaaaaa', 'Alpha Synthetic', SG_GLADIATORS)
    const gap = player('p-gap', 'Gap Synthetic')
    const { rows } = run({
      pool: [a.player, gap],
      links: [a.link],
      outsideMembers: [a.member, outside('Gap Synthetic', [SG_SPARTANS], M_THIRD)],
    })
    expect(rows.map((r) => r.state).sort()).toEqual(['confirm', 'move'])
    expect(canApplyAll(rows)).toBe(false)
  })

  it('is hidden when there is nothing to apply', () => {
    const { rows } = run({
      pool: [player('p-two', 'Twoteams Synthetic')],
      links: [link(M_JOEY, 'p-two')],
      outsideMembers: [outside('Twoteams Synthetic', [SG_GLADIATORS, SG_SPARTANS], M_JOEY)],
    })
    expect(canApplyAll(rows)).toBe(false)
  })
})

// ---- 9. The orphan correction ----------------------------------------------

describe('elsewhereMemberIds', () => {
  it('names the members the scan saw, so a link pointing at one is not an orphan', () => {
    const ids = elsewhereMemberIds([outside('A', [SG_GLADIATORS], M_JOEY), outside('B', [], '')], true)
    expect([...ids]).toEqual([M_JOEY])
  })

  it('narrows nothing off a scan that proved nothing', () => {
    expect(elsewhereMemberIds([outside('A', [SG_GLADIATORS], M_JOEY)], false).size).toBe(0)
    expect(elsewhereMemberIds(null, true).size).toBe(0)
  })
})

describe('clubMapsWholeGroup', () => {
  it('is false for the production shape: five teams, five subgroups', () => {
    expect(
      clubMapsWholeGroup([
        { subgroupId: SG_ARGONAUTS },
        { subgroupId: SG_GLADIATORS },
        { subgroupId: SG_SPARTANS },
      ]),
    ).toBe(false)
  })

  it('is true when any single mapping in the club maps a whole group', () => {
    expect(clubMapsWholeGroup([{ subgroupId: SG_ARGONAUTS }, { subgroupId: null }])).toBe(true)
  })
})

// ---- 9b. The member the destination came from travels with the row --------
//
// A review found the race this closes. The screen derives the target from ONE
// member's Spond subgroups. Between the scan and the press another manager can
// unlink that member and correctly link the child to a different one, whose
// Spond team may be somewhere else entirely. The child still "has a link", and
// their OTJ team need not have changed, so neither a bare link check nor the
// expected-team check notices. The row therefore names the member it reasoned
// from, and the RPC refuses when the link no longer points at it (stale_link).

describe('every actionable row names the member its destination came from', () => {
  it('a proved row carries the linked member, and no display name', () => {
    const { rows } = run({
      pool: [player('p-joey', 'Joey Synthetic')],
      links: [link(M_JOEY, 'p-joey')],
      outsideMembers: [outside('Joey Synthetic', [SG_GLADIATORS], M_JOEY)],
    })
    expect(rows[0].memberId).toBe(M_JOEY)
    expect(rows[0].confirmName).toBeNull()
  })

  it('a confirm row carries the member to bind, and the name to recognise', () => {
    const { rows } = run({
      pool: [player('p-gap', 'Gap Synthetic')],
      outsideMembers: [outside('Gap Synthetic', [SG_GLADIATORS], M_OTHER)],
    })
    expect(rows[0].memberId).toBe(M_OTHER)
    expect(rows[0].confirmName).toBe('Gap Synthetic')
  })

  it('and it is the member whose subgroups produced the destination, not the child name match', () => {
    // The linked member's display name is somebody else's entirely, and the
    // destination still comes from that member's subgroups. If the row carried
    // a name derived id instead, this would name the wrong person.
    const { rows } = run({
      pool: [player('p-joey', 'Joey Synthetic')],
      links: [link(M_JOEY, 'p-joey')],
      outsideMembers: [
        outside('Completely Different Synthetic', [SG_SPARTANS], M_JOEY),
        outside('Joey Synthetic', [SG_GLADIATORS], M_OTHER),
      ],
    })
    expect(rows[0].memberId).toBe(M_JOEY)
    expect(rows[0].to && destinationLabel(rows[0].to)).toBe('Spartans')
  })

  it('a row that offers nothing names no member either', () => {
    for (const subgroups of [[SG_GLADIATORS, SG_SPARTANS], [SG_UNMAPPED]]) {
      const { rows } = run({
        pool: [player('p-x', 'Ambiguous Synthetic')],
        links: [link(M_JOEY, 'p-x')],
        outsideMembers: [outside('Ambiguous Synthetic', subgroups, M_JOEY)],
      })
      expect(rows[0].to).toBeNull()
      expect(rows[0].memberId).toBeNull()
    }
  })

  it('every actionable row has one, so a press can never reach the RPC unnamed', () => {
    const a = player('p-a', 'Alpha Synthetic')
    const b = player('p-b', 'Beta Synthetic')
    const { rows } = run({
      pool: [a, b],
      clubRoster: [a, b],
      links: [link(M_JOEY, 'p-a')],
      outsideMembers: [
        outside('Alpha Synthetic', [SG_GLADIATORS], M_JOEY),
        outside('Beta Synthetic', [SG_SPARTANS], M_OTHER),
      ],
    })
    expect(rows.map((r) => r.state).sort()).toEqual(['confirm', 'move'])
    for (const r of rows) expect(r.memberId).toBeTruthy()
  })
})

// ---- 10. What this file cannot prove ---------------------------------------

describe('names what it cannot catch', () => {
  it('says so out loud', () => {
    // Every test above runs the rule. None of them runs the WRITE, so
    // nothing here proves that a move touches only the current season, that
    // an unlinked child is refused by the database as well as by this rule,
    // that two managers pressing at once cannot corrupt an assignment, or
    // that a link and a move land together or not at all. Those are
    // properties of spond_reconcile_player_team and are proved against a
    // real PostgreSQL by
    // .github/scripts/production-migration/test_0049_spond_team_reconcile.sh
    // and against a local Supabase stack by tests/security/spond_reconcile.test.ts.
    expect(true).toBe(true)
  })
})
