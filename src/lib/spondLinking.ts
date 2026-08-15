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

export interface NeedsDecision {
  candidate: LinkCandidate
  // The single unambiguous roster match, or null. Never preselected: a
  // suggestion is something a manager accepts, not something already
  // ticked on their behalf.
  suggestion: RegisteredPlayer | null
  // Why there is no suggestion, so the row can say which case this is
  // rather than looking identical to every other unmatched member.
  reason: 'suggested' | 'ambiguous' | 'not_on_roster'
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
  for (const p of roster) {
    if (linkedPlayerIds.has(p.playerId)) continue
    const key = normaliseName(p.displayName)
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
      needsDecision.push({ candidate, suggestion: null, reason: 'not_on_roster' })
    } else if (matches.length > 1 || (candidateNameCount.get(key) ?? 0) > 1) {
      needsDecision.push({ candidate, suggestion: null, reason: 'ambiguous' })
    } else {
      needsDecision.push({ candidate, suggestion: matches[0], reason: 'suggested' })
    }
  }

  const orphans: LinkedRow[] = []
  for (const link of links) {
    if (candidateByMember.has(link.spondMemberId)) continue
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
  // subgroup" rather than naming a team it cannot prove.
  otherTeam: string | null
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
  // Mapped Spond subgroup id to OTJ team name, club wide, from
  // teamNameBySubgroup below.
  teamBySubgroup: ReadonlyMap<string, string>
}

// The club's mapped subgroups, keyed for resolution. A subgroup two
// mappings claim for two different teams names neither: the point of the
// diagnosis is to be actionable, and a wrong team name is worse than none.
export function teamNameBySubgroup(
  mappings: readonly { subgroupId: string | null; teamName: string }[],
): Map<string, string> {
  const out = new Map<string, string>()
  const contested = new Set<string>()
  for (const m of mappings) {
    if (!m.subgroupId || !m.teamName) continue
    const held = out.get(m.subgroupId)
    if (held !== undefined && held !== m.teamName) contested.add(m.subgroupId)
    else out.set(m.subgroupId, m.teamName)
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
  teamBySubgroup: ReadonlyMap<string, string>,
): string | null {
  const names = new Set<string>()
  for (const id of subgroupIds) {
    const name = teamBySubgroup.get(id)
    if (name) names.add(name)
  }
  return names.size === 1 ? [...names][0] : null
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
export function spondSetupRows(ctx: SpondSetupContext): SpondSetupRow[] {
  const unmatched = unmatchedPlayers(ctx.candidates, ctx.links, ctx.pool)
  const outside = ctx.outsideMembers
  if (outside === null || !ctx.outsideComplete) {
    return unmatched.map((player) => ({ player, state: 'unknown' as const, otherTeam: null }))
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

  return unmatched.map((player) => {
    const key = normaliseName(player.displayName)
    const inside = insideByName.get(key) ?? 0
    const matches = outsideByName.get(key) ?? []
    if (inside + matches.length > 1) return { player, state: 'ambiguous' as const, otherTeam: null }
    if (inside === 1) return { player, state: 'name_taken' as const, otherTeam: null }
    const member = matches[0]
    if (!member) return { player, state: 'not_found' as const, otherTeam: null }
    if (member.subgroupIds.length === 0) return { player, state: 'no_subgroup' as const, otherTeam: null }
    return {
      player,
      state: 'other_subgroup' as const,
      otherTeam: resolveOtherTeam(member.subgroupIds, ctx.teamBySubgroup),
    }
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
