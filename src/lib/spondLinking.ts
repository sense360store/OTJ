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
