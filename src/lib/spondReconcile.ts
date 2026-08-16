// Making OTJ's team assignment agree with Spond's, without ever guessing
// who anybody is.
//
// THE PRODUCT RULE. Spond is where the club moves a child between teams, so
// Spond is the source of truth for which team a child is currently in. The
// linking screen could already SEE the disagreement (production, 16 August:
// three Argonauts registrations whose Spond member sat in Gladiators, in
// Spartans, and in no subgroup at all) and could only describe it. This
// module turns a described mismatch into an offered change.
//
// THE IDENTITY RULE, WHICH OUTRANKS IT. A name is not an identity. The
// shared roster import already refuses to move a child across teams for
// exactly this reason, and says so in its own words: "Refusing on a false
// name match declines one import and reports it, which a manager can see and
// undo. Acting on a false name match would move a different child's
// registration to another team silently, and it would look correct. Moving
// on a proved identity is the reconciliation that the durable Spond member
// link makes possible; it is deliberately not attempted here."
// (planRosterImport, supabase/functions/_shared/spond.ts.) This is that
// reconciliation, and it is built on the link rather than on the name:
//
//   * A child with a player_spond_links row is PROVED. Their Spond team is
//     read from the member id, and the name never enters the decision.
//   * A child with no link is NOT proved, and no amount of name agreement
//     makes them proved. The most this module will do is offer a human the
//     chance to CONFIRM the identity, and the move rides on that
//     confirmation being made, in one transaction, by the database.
//
// WHAT THIS MODULE DOES NOT DO. It writes nothing and it decides nothing on
// its own. It reads what one team's Spond scan proved, states one verdict
// per registered child, and names which of them a manager may act on. Every
// action is a press. The write is the spond_reconcile_player_team RPC
// (supabase/migrations/0049_spond_team_reconcile.sql), which re-derives the
// club, the actor, the capability and the current season server side and
// refuses to move an unlinked child at all, so none of the rules below are
// load bearing for safety on their own.
//
// EVERY AMBIGUITY RESOLVES TOWARDS DOING NOTHING. That is the opposite
// asymmetry to the training classifier, deliberately: there, the cost of the
// two mistakes is a glance versus a lost session, so the rules that can hide
// are narrow. Here, the cost of the two mistakes is a mismatch left on
// screen versus a child silently filed under the wrong team, so the rules
// that can ACT are the narrow ones.
import {
  normaliseName,
  spondSetupRows,
  type LinkCandidate,
  type SpondGroupMember,
  type SpondLink,
  type SubgroupTeam,
} from './spondLinking'
import type { RegisteredPlayer } from './data'

// Where a child is, and where Spond says they should be. Unassigned is a
// real destination and not an absence: `player_registrations.team_id` is
// nullable precisely so a registered child can belong to no team, and Spond
// having no subgroup for a member is a positive statement that they are
// currently in no squad.
export type SpondDestination =
  | { kind: 'team'; teamId: string; teamName: string }
  | { kind: 'unassigned' }

export const UNASSIGNED: SpondDestination = { kind: 'unassigned' }

export function destinationLabel(d: SpondDestination): string {
  return d.kind === 'team' ? d.teamName : 'Unassigned'
}

export function sameDestination(a: SpondDestination, b: SpondDestination): boolean {
  if (a.kind !== b.kind) return false
  return a.kind !== 'team' || b.kind !== 'team' || a.teamId === b.teamId
}

// The destination as the RPC takes it: a team id, or null for Unassigned.
export function destinationTeamId(d: SpondDestination): string | null {
  return d.kind === 'team' ? d.teamId : null
}

export type ReconcileState =
  // Spond and OTJ agree. Nothing is offered and nothing is shown.
  | 'match'
  // Proved identity, one unambiguous destination, and it differs from the
  // OTJ registration. The one state that may be applied without a human
  // first settling a question.
  | 'move'
  // No durable link, but the scan found exactly one Spond member of this
  // name and exactly one registered child of it, and that member has one
  // unambiguous destination. Offered ONLY as confirm-then-move: the
  // confirmation creates the link, and the move rides on it.
  | 'confirm'
  // Spond puts this member in more than one mapped team's subgroup, so
  // Spond's own answer is not single valued. Nothing is offered.
  | 'ambiguous'
  // Spond puts this member in a subgroup no OTJ team maps, or in one two
  // teams both claim. There IS a Spond team; we cannot say which OTJ team it
  // is. Deliberately NOT read as Unassigned, which would move a child out of
  // a squad on the strength of a missing mapping.
  | 'unmapped'

export interface ReconcileRow {
  player: RegisteredPlayer
  state: ReconcileState
  // Where the OTJ current season registration has them now.
  from: SpondDestination
  // Where Spond says they are. Null on the two states that establish no
  // destination.
  to: SpondDestination | null
  // THE MEMBER THE DESTINATION WAS DERIVED FROM, and the whole reason this
  // field exists rather than a boolean. On 'move' it is the member this child
  // is already linked to, and the RPC re-checks that the link STILL points at
  // it: between the scan and the press another manager can unlink that member
  // and correctly link the child to a different one, whose Spond team may be
  // somewhere else, and the child's OTJ team need not have changed, so
  // nothing else on this row would notice. On 'confirm' it is the member a
  // human must confirm, which the RPC then binds. Null on the states that
  // establish no destination, exactly as `to` is.
  memberId: string | null
  // Only on 'confirm': the transient Spond display name, so the dialog can
  // name the person a manager is being asked to recognise. There is nothing
  // to recognise on a proved row, so it stays null there.
  confirmName: string | null
}

// Why the whole section can be unable to say anything, as its own closed
// vocabulary rather than a boolean plus a comment.
export type ReconcileBlocker =
  // No team is selected yet.
  | 'no_team'
  // The member list, or the parent group scan behind it, is not provably
  // whole. An absence proves nothing on a short list, and neither does a
  // presence: the member this scan did not see could be the second holder of
  // a name, or the very member a child is linked to.
  | 'not_proved'
  // Some team in the club is mapped to a WHOLE Spond group rather than to a
  // subgroup. A whole group mapping says "everyone in this group is on this
  // team", which is a team assignment carried by no subgroup id, so no
  // subgroup based reading of Spond can be complete while one exists: a
  // member with no subgroup might be that team's, and a member in one team's
  // subgroup might be in another team's whole group as well. Rather than
  // reason about which of those bite, the section states nothing at all.
  | 'whole_group_mapping'

// Whether any mapping in the CLUB maps a whole Spond group. Club wide, not
// per team: the destinations are resolved club wide, so another team's whole
// group mapping is just as capable of hiding a second team assignment as the
// selected team's own is.
export function clubMapsWholeGroup(
  mappings: readonly { subgroupId: string | null }[],
): boolean {
  return mappings.some((m) => !m.subgroupId)
}

export interface SpondReconcileContext {
  // The selected team's current season registrations, withdrawn excluded:
  // exactly the pool a suggestion may match (suggestionPool), so the set
  // being reconciled and the set being linked are the same set. A withdrawn
  // child is not on a team in any operational sense and is not moved.
  pool: readonly RegisteredPlayer[]
  // The club's current season registrations, for the diagnostics' own cross
  // team ambiguity rule.
  clubRoster: readonly RegisteredPlayer[]
  links: readonly SpondLink[]
  // The selected team's mapped subgroup members. Their presence here IS the
  // proof that Spond puts them in this team's subgroup; the scan is scoped
  // to it.
  candidates: readonly LinkCandidate[]
  // Whether that member list is provably the whole mapped subgroup
  // (linkLoadComplete) and whether the parent group scan behind the
  // diagnostics saw the whole group (diagnosticsProved, server side).
  candidatesComplete: boolean
  outsideMembers: readonly SpondGroupMember[] | null
  outsideComplete: boolean
  // Mapped Spond subgroup to OTJ team, club wide, from teamsBySubgroup. A
  // subgroup two mappings contest is already absent from it, which lands
  // here as 'unmapped' rather than as a guess.
  teamBySubgroup: ReadonlyMap<string, SubgroupTeam>
  // True when NO mapping in the club maps a whole group.
  subgroupMappingComplete: boolean
  // The selected team.
  teamId: string | null
  teamName: string | null
}

export interface ReconcileResult {
  rows: ReconcileRow[]
  // Null when the section has something to say, even if that something is
  // an empty list because everybody agrees.
  blocker: ReconcileBlocker | null
}

// The teams a set of Spond subgroups resolves to, club wide. A subgroup no
// mapping claims, and one two mappings contest, both contribute nothing:
// teamsBySubgroup has already dropped the contested ones for the reason this
// module needs, which is that a wrong team name is worse than none.
function resolveTeams(
  subgroupIds: readonly string[],
  teamBySubgroup: ReadonlyMap<string, SubgroupTeam>,
): SubgroupTeam[] {
  const out = new Map<string, SubgroupTeam>()
  for (const id of subgroupIds) {
    const team = teamBySubgroup.get(id)
    if (team) out.set(team.teamId, team)
  }
  return [...out.values()]
}

// What Spond says about ONE member, from that member's subgroup list.
// Exported because it is the whole of the destination rule and its four
// outcomes are what the tests enumerate.
export type MemberVerdict =
  | { kind: 'destination'; to: SpondDestination }
  | { kind: 'ambiguous' }
  | { kind: 'unmapped' }

export function memberVerdict(
  subgroupIds: readonly string[],
  teamBySubgroup: ReadonlyMap<string, SubgroupTeam>,
): MemberVerdict {
  // No subgroup at all is a positive statement, not missing data: Spond has
  // this member in the parent group and in no squad.
  if (subgroupIds.length === 0) return { kind: 'destination', to: UNASSIGNED }
  const teams = resolveTeams(subgroupIds, teamBySubgroup)
  if (teams.length === 1) {
    return { kind: 'destination', to: { kind: 'team', teamId: teams[0].teamId, teamName: teams[0].teamName } }
  }
  // More than one mapped team claims this member. Spond's answer is real and
  // it is plural, which is not an answer this can act on.
  if (teams.length > 1) return { kind: 'ambiguous' }
  // Subgroups exist and none of them maps to exactly one OTJ team. There IS
  // a Spond team; nothing here can name it. Never Unassigned.
  return { kind: 'unmapped' }
}

// Every registered child on the selected team, and what Spond says about
// them. Composes spondSetupRows rather than re-deriving the unlinked side,
// so the two sided ambiguity rules that live there (one Spond member of the
// name AND one registered child of it, across the whole scan, with a member
// filed under a team that already holds the name failing closed) decide the
// confirm path exactly as they decide the description of it. There is one
// name matcher on this screen and it is not in this file.
export function spondReconcile(ctx: SpondReconcileContext): ReconcileResult {
  if (!ctx.teamId || !ctx.teamName) return { rows: [], blocker: 'no_team' }
  if (!ctx.subgroupMappingComplete) return { rows: [], blocker: 'whole_group_mapping' }
  // One gate for both halves of the scan. A member list that is short, or a
  // parent group read that did not complete, cannot support a positive claim
  // about where somebody is any more than it can support a negative one.
  if (!ctx.candidatesComplete || ctx.outsideMembers === null || !ctx.outsideComplete) {
    return { rows: [], blocker: 'not_proved' }
  }

  const here: SpondDestination = { kind: 'team', teamId: ctx.teamId, teamName: ctx.teamName }
  const candidateIds = new Set(ctx.candidates.map((c) => c.spondMemberId))
  // Only members the scan could identify. An unusable id is no identity, so
  // such a member takes part in the name based description above and in no
  // decision here.
  const outsideById = new Map<string, SpondGroupMember>()
  for (const m of ctx.outsideMembers) {
    if (m.spondMemberId) outsideById.set(m.spondMemberId, m)
  }
  const linkByPlayer = new Map(ctx.links.map((l) => [l.playerId, l]))

  const rows: ReconcileRow[] = []

  // ---- The proved half: a child whose identity is already bound. --------
  for (const player of ctx.pool) {
    const link = linkByPlayer.get(player.playerId)
    if (!link) continue
    // In this team's own mapped subgroup: Spond agrees, and it says so with
    // the strongest evidence the scan holds, because the candidate list is
    // scoped to that subgroup by construction.
    //
    // The residual, stated rather than hidden: a member who is ALSO in
    // another team's subgroup reads as agreeing here, because LinkCandidate
    // deliberately carries no subgroup list (its two field shape is a
    // boundary the deploy workflow asserts, and widening it would buy
    // nothing this needs). The cost is exactly one row that says nothing
    // when it might have said "ambiguous". Both readings offer no action.
    if (candidateIds.has(link.spondMemberId)) continue
    const member = outsideById.get(link.spondMemberId)
    // The scan did not see this member. That is the orphan question, not
    // this one, and the link section answers it.
    if (!member) continue
    const verdict = memberVerdict(member.subgroupIds, ctx.teamBySubgroup)
    if (verdict.kind === 'ambiguous') {
      rows.push({ player, state: 'ambiguous', from: here, to: null, memberId: null, confirmName: null })
      continue
    }
    if (verdict.kind === 'unmapped') {
      rows.push({ player, state: 'unmapped', from: here, to: null, memberId: null, confirmName: null })
      continue
    }
    if (sameDestination(verdict.to, here)) continue
    // The member id travels with the row: it is what the RPC is told to
    // expect, so a link repointed since the scan refuses instead of applying
    // a destination derived from somebody this child no longer is.
    rows.push({
      player,
      state: 'move',
      from: here,
      to: verdict.to,
      memberId: link.spondMemberId,
      confirmName: null,
    })
  }

  // ---- The unproved half: a child with no link at all. ------------------
  //
  // spondSetupRows already narrowed these to the children the member list
  // cannot reach and attached a state to each. Only its two POSITIVE states
  // carry a member, and only those two can become an offer. Everything else
  // it found is a sentence in its own section and no action anywhere.
  const setup = spondSetupRows({
    candidates: ctx.candidates,
    links: ctx.links,
    pool: ctx.pool,
    outsideMembers: ctx.outsideMembers,
    outsideComplete: ctx.outsideComplete,
    teamBySubgroup: ctx.teamBySubgroup,
    clubRoster: ctx.clubRoster,
  })
  for (const row of setup) {
    const member = row.member
    if (!member) continue
    // No identity to bind means nothing to confirm. Silence, not a guess.
    if (!member.spondMemberId) continue
    // A second child of this name anywhere in the club's current season is
    // the case the setup rules already fail closed on for the SELECTED
    // team's own list; this widens the same refusal to the whole club,
    // because confirming an identity is a bigger claim than describing one
    // and the confirmation is what a later move rides on.
    if (nameIsSharedInClub(ctx.clubRoster, row.player)) continue
    const verdict = memberVerdict(member.subgroupIds, ctx.teamBySubgroup)
    if (verdict.kind !== 'destination') continue
    if (sameDestination(verdict.to, here)) continue
    rows.push({
      player: row.player,
      state: 'confirm',
      from: here,
      to: verdict.to,
      memberId: member.spondMemberId,
      confirmName: member.displayName,
    })
  }

  rows.sort((a, b) => a.player.displayName.localeCompare(b.player.displayName))
  return { rows, blocker: null }
}

// Whether more than one registered child in the CLUB's current season goes
// by this player's name. Production carried zero shared names on 16 August,
// so this refuses nothing today; it exists because the day it stops being
// zero is the day a name based confirmation would otherwise offer a manager
// two children and one Spond person with no way to tell which.
function nameIsSharedInClub(
  clubRoster: readonly RegisteredPlayer[],
  player: RegisteredPlayer,
): boolean {
  const key = normaliseName(player.displayName)
  let seen = 0
  for (const p of clubRoster) {
    if (p.status === 'withdrawn') continue
    if (normaliseName(p.displayName) !== key) continue
    seen++
    if (seen > 1) return true
  }
  return false
}

// The rows an "Apply all safe Spond changes" press would send, and nothing
// else. Only the PROVED state qualifies: a confirm row has no durable
// identity yet, and binding one to a child is a decision a person makes one
// at a time, not a side effect of a bulk button.
export function applicableMoves(rows: readonly ReconcileRow[]): ReconcileRow[] {
  return rows.filter((r) => r.state === 'move')
}

// Whether the bulk button may be offered at all. It is hidden outright while
// ANY row still needs a human to settle an identity, so a manager can never
// press "apply all" and believe those rows were included in it. The stricter
// of the two readings, on purpose: a button that silently covers some of a
// list is the shape of every mistake this feature exists to avoid.
export function canApplyAll(rows: readonly ReconcileRow[]): boolean {
  if (rows.some((r) => r.state === 'confirm')) return false
  return applicableMoves(rows).length > 0
}

// The member ids the parent group scan saw OUTSIDE the team's mapped
// subgroup, for buildLinkSections' orphan rule. A link pointing at one of
// these has not lost its member; the member has moved within the group.
export function elsewhereMemberIds(
  outsideMembers: readonly SpondGroupMember[] | null,
  outsideComplete: boolean,
): Set<string> {
  // An unproved scan proves no presence either, so it narrows nothing and
  // the orphan section keeps the behaviour it had.
  if (outsideMembers === null || !outsideComplete) return new Set()
  const out = new Set<string>()
  for (const m of outsideMembers) if (m.spondMemberId) out.add(m.spondMemberId)
  return out
}
