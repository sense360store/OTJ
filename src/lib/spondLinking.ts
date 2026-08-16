// Deciding which Spond member is which child.
//
// Everything here is pure and runs in the browser. There is no server
// side name matcher: the suggestions below are computed from the
// transient candidate list spond-link-members returns, and every link row
// written afterwards exists because a manager pressed something. That is
// what player_spond_links.matched_by records, and why its vocabulary is
// ('suggested', 'chosen') with no 'auto'.
//
// Nothing here is stored. The Spond display names live only in this
// screen's state for the length of the visit.
import type { RegisteredPlayer } from './data'

// One Spond member offered for linking, exactly the closed shape
// spond-link-members returns.
export interface LinkCandidate {
  spondMemberId: string
  displayName: string
}

// The character class player_spond_links.spond_member_id enforces, restated
// on the client so an id that the database would refuse is never offered as
// something to press. Uppercase hex admits no space, no '@', no '+', no '.'
// and no lowercase letter, so a name, an email address and a phone number
// are all unrepresentable as an identity here, exactly as they are in the
// column. Kept beside the link types rather than in a screen: the Edge
// reduction, the column check and this must all say one thing.
export const SPOND_MEMBER_ID = /^[0-9A-F]{16,64}$/

export function isSpondMemberId(value: unknown): value is string {
  return typeof value === 'string' && SPOND_MEMBER_ID.test(value)
}

// One stored binding.
export interface SpondLink {
  spondMemberId: string
  playerId: string
  matchedBy: 'suggested' | 'chosen'
  createdAt: string
}

// Compare names the way a person would, not the way a byte comparison
// does: decompose, drop combining marks so "Zoë" and "Zoe" agree, fold
// case, and collapse runs of whitespace. Nothing is stored in this form;
// it exists only to decide whether two strings name the same child.
export function normaliseName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

// The pool a suggestion may match: ONE team's registrations, withdrawn
// children excluded. The caller hands buildLinkSections this and nothing
// wider, and the scoping lives here as a pure rule rather than inline in
// the screen so the test suite can pin the two failure modes a wide pool
// invites: a club wide pool lets a Titans member match a same named child
// on Gladiators, and a season blind one (already excluded by reading the
// current season's registrations) a child who left two seasons ago.
export function suggestionPool(
  roster: readonly RegisteredPlayer[],
  teamId: string | null,
): RegisteredPlayer[] {
  return roster.filter((p) => p.teamId === teamId && p.status !== 'withdrawn')
}

// Why a member row reads the way it does. One home for the vocabulary,
// imported by the screen rather than retyped there: the union was written
// out twice, and the copy is what let a fourth case render through the
// third one's sentence.
export type NeedsDecisionReason =
  // Exactly one unlinked registered player of this name, and exactly one
  // member of it. Offered, never preselected.
  | 'suggested'
  // More than one member or more than one child could be meant, so the
  // product refuses to guess. Both sides of that count.
  | 'ambiguous'
  // A registered player of this name exists in the same pool a suggestion
  // may match, and their one link is already spent on a DIFFERENT Spond
  // member. Says only that. It does not say the two members are the same
  // child, that either is a duplicate, or that either Spond record is
  // wrong: two equal names prove none of those, and a club may hold two
  // children of one name. The mirror of the player side's 'name_taken',
  // and named for it.
  | 'name_taken'
  // No registered player of this name in the pool at all, linked or not.
  // The screen's highest value finding, so it stays narrow.
  | 'not_on_roster'

export interface NeedsDecision {
  candidate: LinkCandidate
  // The single unambiguous roster match, or null. Never preselected: a
  // suggestion is something a manager accepts, not something already
  // ticked on their behalf.
  suggestion: RegisteredPlayer | null
  // Why there is no suggestion, so the row can say which case this is
  // rather than looking identical to every other unmatched member.
  reason: NeedsDecisionReason
}

export interface LinkedRow {
  link: SpondLink
  player: RegisteredPlayer | null
  candidate: LinkCandidate | null
}

export interface LinkSections {
  needsDecision: NeedsDecision[]
  linked: LinkedRow[]
  // Links whose Spond member is absent from the loaded candidate list.
  // They still consume a child through the one to one constraint, so they
  // are shown and unlinkable rather than invisible.
  orphans: LinkedRow[]
}

// Resolve the loaded candidates and the stored links against the roster
// the manager is working through.
//
// The pool a suggestion may match is `roster`, which the caller scopes to
// the team being linked in the current season. A club wide, season blind
// pool would let a Titans member match a same named child on Gladiators,
// or one who left two seasons ago.
//
// The ambiguity rule is two sided, and both sides matter. A suggestion is
// offered only when exactly one UNLINKED roster child carries the
// normalised name AND no other candidate carries that same name. One
// "Alex Smith" in Spond and two on the roster is ambiguous; two "Alex
// Smith" in Spond and one on the roster is equally ambiguous, and the
// second case is the one a naive lookup gets wrong.
export function buildLinkSections(
  candidates: readonly LinkCandidate[],
  links: readonly SpondLink[],
  roster: readonly RegisteredPlayer[],
  // The member ids the parent group scan DID see outside this team's mapped
  // subgroup. A link whose member is in there has not left the group, it has
  // moved within it, and calling that an orphan is a false sentence the
  // screen used to print: "no longer offered from the team's Spond group" is
  // exactly wrong about a member who is one subgroup away, and unlinking on
  // the strength of it would drain that child's stored replies for a reason
  // that was never true. Those children belong to the team reconciliation
  // section instead. Defaulting to empty keeps every caller that has no scan
  // (and every existing test) on the behaviour it had.
  elsewhereMemberIds: ReadonlySet<string> = new Set(),
): LinkSections {
  const linkByMember = new Map(links.map((l) => [l.spondMemberId, l]))
  const candidateByMember = new Map(candidates.map((c) => [c.spondMemberId, c]))
  const playerById = new Map(roster.map((p) => [p.playerId, p]))
  const linkedPlayerIds = new Set(links.map((l) => l.playerId))

  // How many candidates share each normalised name, so a duplicate on the
  // Spond side blocks a suggestion just as a duplicate on the roster does.
  const candidateNameCount = new Map<string, number>()
  for (const c of candidates) {
    const key = normaliseName(c.displayName)
    candidateNameCount.set(key, (candidateNameCount.get(key) ?? 0) + 1)
  }

  // Unlinked roster children by normalised name.
  const unlinkedByName = new Map<string, RegisteredPlayer[]>()
  // And its complement over the SAME pool: names carried by a child whose
  // one link is already spent. Linking a child removes them from
  // unlinkedByName, so without this a second member of that name finds no
  // match and reads as unregistered, which is false about a child who is
  // both registered and linked. Same pool as the suggestions, so this can
  // no more reach across teams or seasons than a suggestion can.
  const takenNames = new Set<string>()
  for (const p of roster) {
    const key = normaliseName(p.displayName)
    if (linkedPlayerIds.has(p.playerId)) {
      takenNames.add(key)
      continue
    }
    const list = unlinkedByName.get(key)
    if (list) list.push(p)
    else unlinkedByName.set(key, [p])
  }

  const needsDecision: NeedsDecision[] = []
  const linked: LinkedRow[] = []
  for (const candidate of candidates) {
    const link = linkByMember.get(candidate.spondMemberId)
    if (link) {
      linked.push({ link, player: playerById.get(link.playerId) ?? null, candidate })
      continue
    }
    const key = normaliseName(candidate.displayName)
    const matches = unlinkedByName.get(key) ?? []
    if (matches.length === 0) {
      // Nothing free of this name. Either no registered player carries it
      // at all, or one does and is already linked. This candidate is
      // unlinked (the branch above took the linked ones), so a taken name
      // is necessarily taken by a DIFFERENT member, which is the whole of
      // what the row then claims. Ambiguity among the members does not
      // change the answer here: with no free child to link, there is
      // nothing for them to be ambiguous about, and the more specific
      // sentence is the one a manager can act on.
      const reason = takenNames.has(key) ? 'name_taken' : 'not_on_roster'
      needsDecision.push({ candidate, suggestion: null, reason })
    } else if (matches.length > 1 || (candidateNameCount.get(key) ?? 0) > 1) {
      needsDecision.push({ candidate, suggestion: null, reason: 'ambiguous' })
    } else {
      needsDecision.push({ candidate, suggestion: matches[0], reason: 'suggested' })
    }
  }

  const orphans: LinkedRow[] = []
  for (const link of links) {
    if (candidateByMember.has(link.spondMemberId)) continue
    // Seen elsewhere in the parent group: present, not gone. See the
    // parameter's own note.
    if (elsewhereMemberIds.has(link.spondMemberId)) continue
    // Only links whose child is on this roster: a link belonging to
    // another team is that team's business, not an orphan here.
    const player = playerById.get(link.playerId)
    if (!player) continue
    orphans.push({ link, player, candidate: null })
  }

  return { needsDecision, linked, orphans }
}

// The registered players the loaded member list cannot reach: unlinked,
// and no candidate carries their name. Production, 15 August: eleven such
// children across two teams, invisible, because every section above is
// candidate led and these children have no candidate. Their Spond member
// is not in the mapped subgroup, or the family is not in the group at
// all, or the child goes by a different name there; all three are fixed
// in Spond or resolved by Choose on a member row, and the first step of
// either is a screen that says who they are.
//
// A child counts as matched only by a candidate a manager could still
// link: an UNLINKED one. The first version of this rule excluded by name
// alone, and a review produced the hole that allows: two same named
// children with the shared name's one candidate correctly linked left
// the second child in no section at all, because Change would break the
// correct link, so that member was never a way to reach them. The name
// rule is normaliseName, the same comparison the suggestions use, and
// the suggestions also only ever offer unlinked candidates, so this
// list is exactly the unlinked children the member rows cannot reach.
//
// The caller must only show this when the loaded list is COMPLETE
// (linkLoadComplete below): on a truncated or unproven read, absence is
// not evidence, the same rule the orphan section follows.
export function unmatchedPlayers(
  candidates: readonly LinkCandidate[],
  links: readonly SpondLink[],
  roster: readonly RegisteredPlayer[],
): RegisteredPlayer[] {
  const linkedMemberIds = new Set(links.map((l) => l.spondMemberId))
  const linkedPlayerIds = new Set(links.map((l) => l.playerId))
  const reachableNames = new Set(
    candidates.filter((c) => !linkedMemberIds.has(c.spondMemberId)).map((c) => normaliseName(c.displayName)),
  )
  return roster
    .filter((p) => !linkedPlayerIds.has(p.playerId) && !reachableNames.has(normaliseName(p.displayName)))
    .sort((a, b) => a.displayName.localeCompare(b.displayName))
}

// ---- Why a registered player has no Spond member to link -------------------
//
// "Registered players not matched yet" named the children the screen could
// not reach, which was the whole of the last fix and not enough to act on.
// Production, 15 August: an Argonauts player sat in that list, and Spond
// showed them present in the club's group with no team assigned. The
// screen could not say so, because the candidate list is scoped to the
// team's mapped subgroup and a member outside it is simply absent, which
// looks identical to a member who is in another subgroup and identical
// again to a family who is not in the group at all. Three different fixes,
// one unexplained list.
//
// spond-link-members now returns, from the SAME group payload, the parent
// group members its mappings do not reach. These rules turn that into one
// sentence per player. Everything here is pure and nothing is stored: the
// names arrive transiently with the candidates and leave with the screen.
//
// NOTHING HERE LINKS ANYBODY. A diagnostic row carries no member id, so
// there is no identity to act on and no affordance to act with; the fix is
// in Spond, and the only linking path remains a manager pressing Accept or
// Choose on a candidate.

// One member of the team's Spond parent group that the team's mappings do
// not reach, exactly the closed shape the function returns.
export interface SpondGroupMember {
  displayName: string
  // The opaque Spond member id, or '' when this member carries none the
  // links table would accept. It is what lets the team reconciliation in
  // ./spondReconcile.ts resolve an ALREADY LINKED child by identity rather
  // than by name, and what a human confirmation has to bind when a child is
  // not linked yet. An empty id is no identity: the reconciliation offers
  // nothing on such a row, and this section's own sentences never read it.
  spondMemberId: string
  // Opaque Spond subgroup ids. Empty is the finding: a member in the
  // group with no team assigned.
  subgroupIds: string[]
}

export type SpondSetupState =
  // A same named member is in the parent group with no subgroup at all.
  | 'no_subgroup'
  // A same named member is in the parent group, in a subgroup, but not
  // one of this team's.
  | 'other_subgroup'
  // More than one Spond member goes by this name, so no row may claim
  // which one this player is. Fails closed by rule.
  | 'ambiguous'
  // A member of this team's own mapped subgroup goes by this name and is
  // already linked to a different registered player. Said out loud
  // because "not found in Spond group data" would be false, and because
  // two children of one name is the case a manager resolves by hand.
  | 'name_taken'
  // No same named member anywhere in the parent group data the organiser
  // account can see. Deliberately NOT "not in Spond": this proves absence
  // from one group, not from Spond.
  | 'not_found'
  // The scan did not see the whole group, or this deployment does not
  // answer yet. Nothing is claimed either way.
  | 'unknown'

export interface SpondSetupRow {
  player: RegisteredPlayer
  state: SpondSetupState
  // For 'other_subgroup' only: the OTJ team that subgroup maps to, when
  // exactly one can be determined. Null where the subgroup is unmapped or
  // resolves to more than one team, and the row then says "another Spond
  // subgroup" rather than naming a team it cannot prove. The team's ID
  // travels with its name because a destination a manager can act on has to
  // be checkable against the club's teams, and a name alone is not.
  otherTeam: SubgroupTeam | null
  // The ONE Spond member this finding is about, and only on the two states
  // that already prove there is exactly one: 'no_subgroup' and
  // 'other_subgroup'. Every other state is a state in which no single
  // member has been established, so there is nothing to carry and nothing
  // to act on. This is what ./spondReconcile.ts offers a human for
  // confirmation, and the ambiguity rules below are what make offering it
  // honest: the row exists only when one Spond member and one registered
  // child of the name were found, across the WHOLE scan.
  member: SpondGroupMember | null
}

export interface SpondSetupContext {
  // The team's loaded candidates and the club's stored links, so the
  // unmatched list and the diagnosis are decided from one set of facts.
  candidates: readonly LinkCandidate[]
  links: readonly SpondLink[]
  // The scoped pool, exactly as buildLinkSections takes it.
  pool: readonly RegisteredPlayer[]
  // The parent group members the team's mappings miss. Null when the
  // deployment does not answer; see LinkCandidatesResult.
  outsideMembers: readonly SpondGroupMember[] | null
  // Whether that scan saw the whole parent group.
  outsideComplete: boolean
  // Mapped Spond subgroup id to the OTJ team it belongs to, club wide,
  // from teamsBySubgroup below.
  teamBySubgroup: ReadonlyMap<string, SubgroupTeam>
  // THE CLUB'S registrations, not this team's. The pool above is scoped to
  // one team because a suggestion must be, but the diagnosis matches names
  // across the whole Spond parent group, which spans every team. Without
  // the club list there is no way to notice that the "Sam Jones" found in
  // Titans' subgroup is Titans' OWN Sam Jones, correctly filed, and not
  // this team's child misplaced. suggestionPool's docstring already
  // records that hazard as real at this club; the diagnostics reintroduced
  // it and this is what closes it.
  clubRoster: readonly RegisteredPlayer[]
}

// One OTJ team a Spond subgroup maps to. The id travels beside the name
// because the name alone cannot be checked against a player list.
export interface SubgroupTeam {
  teamId: string
  teamName: string
}

// The club's mapped subgroups, keyed for resolution. A subgroup two
// mappings claim for two different teams names neither: the point of the
// diagnosis is to be actionable, and a wrong team name is worse than none.
export function teamsBySubgroup(
  mappings: readonly { subgroupId: string | null; teamId: string; teamName: string }[],
): Map<string, SubgroupTeam> {
  const out = new Map<string, SubgroupTeam>()
  const contested = new Set<string>()
  for (const m of mappings) {
    if (!m.subgroupId || !m.teamName) continue
    const held = out.get(m.subgroupId)
    if (held !== undefined && held.teamId !== m.teamId) contested.add(m.subgroupId)
    else out.set(m.subgroupId, { teamId: m.teamId, teamName: m.teamName })
  }
  for (const id of contested) out.delete(id)
  return out
}

// The one OTJ team a member's subgroups point at, or null. Null covers
// both "no mapped subgroup" and "more than one team", which is the same
// answer to a manager: this member is somewhere else in Spond and the row
// will not guess where.
function resolveOtherTeam(
  subgroupIds: readonly string[],
  teamBySubgroup: ReadonlyMap<string, SubgroupTeam>,
): SubgroupTeam | null {
  const teams = new Map<string, SubgroupTeam>()
  for (const id of subgroupIds) {
    const team = teamBySubgroup.get(id)
    if (team) teams.set(team.teamId, team)
  }
  return teams.size === 1 ? [...teams.values()][0] : null
}

// One row per registered player the loaded member list cannot reach, each
// carrying what Spond shows for that name.
//
// It composes unmatchedPlayers rather than taking its output, so the set
// being diagnosed and the set being listed are the same set by
// construction. A caller cannot hand it a different list.
//
// THE FAIL CLOSED RULES, both of them:
//
//   * An incomplete scan states NOTHING, not even a positive match. A
//     short list can hide a second member of the same name, so a positive
//     claim off one would assert an identity that was never proved, and a
//     negative one would be an absence claim off data that was never
//     whole. One rule for both directions is easier to hold than two.
//   * A name carried by more than one Spond member, on either side of the
//     mapping, is 'ambiguous' and no category that implies identity is
//     ever assigned to it.
//   * AND THE MIRROR OF THAT, which the first version missed. Ambiguity
//     has two sides, exactly as it does in buildLinkSections: one Spond
//     member and TWO registered children of that name is equally
//     unresolvable, and an adversarial review reproduced what the missing
//     half allows. Two children called "Sam Jones" and one Spond member
//     of that name each read "In Spond, assigned to another team: Titans",
//     which asserts one person's identity against two different children
//     and reads as confirmation to the manager acting on it.
export function spondSetupRows(ctx: SpondSetupContext): SpondSetupRow[] {
  const unmatched = unmatchedPlayers(ctx.candidates, ctx.links, ctx.pool)
  const outside = ctx.outsideMembers
  if (outside === null || !ctx.outsideComplete) {
    return unmatched.map((player) => ({
      player,
      state: 'unknown' as const,
      otherTeam: null,
      member: null,
    }))
  }

  // Inside the mapping: the candidates. A candidate whose name matched an
  // unmatched player is necessarily LINKED to somebody else, because a
  // free one would have made that player reachable.
  const insideByName = new Map<string, number>()
  for (const c of ctx.candidates) {
    const key = normaliseName(c.displayName)
    insideByName.set(key, (insideByName.get(key) ?? 0) + 1)
  }
  const outsideByName = new Map<string, SpondGroupMember[]>()
  for (const m of outside) {
    const key = normaliseName(m.displayName)
    const list = outsideByName.get(key)
    if (list) list.push(m)
    else outsideByName.set(key, [m])
  }

  // The other side of the ambiguity: how many of the children being
  // diagnosed carry each name. Two of them and one Spond member is one
  // member two children could be, which is unresolvable in exactly the
  // way two members and one child is.
  const claimantsByName = new Map<string, number>()
  for (const p of unmatched) {
    const key = normaliseName(p.displayName)
    claimantsByName.set(key, (claimantsByName.get(key) ?? 0) + 1)
  }

  // Every state but the two positive ones carries no member and no team:
  // nothing about a single Spond person has been established, so there is
  // nothing for a caller to name or to act on.
  const nobody = (player: RegisteredPlayer, state: SpondSetupState): SpondSetupRow => ({
    player,
    state,
    otherTeam: null,
    member: null,
  })
  return unmatched.map((player) => {
    const key = normaliseName(player.displayName)
    const inside = insideByName.get(key) ?? 0
    const matches = outsideByName.get(key) ?? []
    if (inside + matches.length > 1) return nobody(player, 'ambiguous')
    const member = matches[0]
    // Nobody in the group carries this name, which is an unambiguous
    // answer however many children share it: neither of them is there.
    if (inside === 0 && !member) return nobody(player, 'not_found')
    // Somebody does, and more than one child could be them.
    if ((claimantsByName.get(key) ?? 1) > 1) return nobody(player, 'ambiguous')
    if (inside === 1) return nobody(player, 'name_taken')
    if (!member) return nobody(player, 'not_found')
    if (member.subgroupIds.length === 0) {
      return { player, state: 'no_subgroup' as const, otherTeam: null, member }
    }
    const team = resolveOtherTeam(member.subgroupIds, ctx.teamBySubgroup)
    // The member sits in a team whose OWN player list already holds this
    // name. They are far more likely to be that team's child, correctly
    // filed, than this team's child misplaced, and the row would otherwise
    // send a manager to "fix" a Spond record that is right. Neither
    // reading is provable from a name, so it fails closed.
    if (team && ctx.clubRoster.some((p) => p.teamId === team.teamId && normaliseName(p.displayName) === key)) {
      return nobody(player, 'ambiguous')
    }
    return { player, state: 'other_subgroup' as const, otherTeam: team, member }
  })
}

// What one load of a team's members proved. Truncated proves nothing
// beyond what it holds. Zero members with zero exclusions is a read that
// may not have seen the group at all, so it proves nothing; zero members
// with exclusions is a real, complete answer, a subgroup holding only
// staff, and treating it as unproven put a false incompleteness note on
// screen while suppressing the no-match section for exactly the
// production shape this module exists to fix.
export interface LinkLoad {
  members: readonly LinkCandidate[]
  truncated: boolean
  staffExcluded: number
  ignoredExcluded: number
}

export function linkLoadComplete(load: LinkLoad): boolean {
  if (load.truncated) return false
  return load.members.length > 0 || load.staffExcluded > 0 || load.ignoredExcluded > 0
}

// The rows an Accept all press would write, and nothing else. Explicit by
// design: nothing on this screen is preselected, so a manager can never
// commit a set they have not looked at, and a suggestion they have decided
// against simply stays a suggestion.
export function acceptableSuggestions(
  sections: LinkSections,
): Array<{ spondMemberId: string; playerId: string }> {
  const out: Array<{ spondMemberId: string; playerId: string }> = []
  for (const row of sections.needsDecision) {
    if (row.reason !== 'suggested' || !row.suggestion) continue
    out.push({ spondMemberId: row.candidate.spondMemberId, playerId: row.suggestion.playerId })
  }
  return out
}

// The roster rows the picker offers for one candidate, ordered by name,
// with the already linked marked rather than omitted: silently hiding a
// child leaves a manager unable to work out why they cannot pick them.
export interface PickerOption {
  player: RegisteredPlayer
  linkedAlready: boolean
}

export function pickerOptions(
  roster: readonly RegisteredPlayer[],
  links: readonly SpondLink[],
  query: string,
): PickerOption[] {
  const linkedPlayerIds = new Set(links.map((l) => l.playerId))
  const needle = normaliseName(query)
  return roster
    .filter((p) => !needle || normaliseName(p.displayName).includes(needle))
    .slice()
    .sort((a, b) => a.displayName.localeCompare(b.displayName))
    .map((p) => ({ player: p, linkedAlready: linkedPlayerIds.has(p.playerId) }))
}
