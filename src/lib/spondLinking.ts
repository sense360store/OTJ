// The linking screen's pure logic (ADR-0008, the amended boundary in
// docs/security/spond-data-boundary.md). Candidates arrive transiently from
// the spond-link-members function as opaque id and display name pairs;
// players were originally imported from Spond, so automatic matching by
// normalised name is expected to succeed for most, and a review screen
// confirms the matches and resolves the rest by hand. What may be STORED is
// only what migration 0045 allows: the ids and the match bookkeeping, never
// a name. linkRowsForConfirm is the one place a confirmation becomes insert
// payloads and its output carries no name field, pinned by the tests.

export interface SpondLinkCandidate {
  spondMemberId: string
  displayName: string
}

export interface PlayerIdentityLite {
  id: string
  displayName: string
}

export interface PlayerSpondLink {
  id: string
  playerId: string
  spondMemberId: string
  matchedBy: 'auto' | 'manual'
  confirmedAt: string | null
}

// Matching key: case, surrounding and internal whitespace and diacritics do
// not distinguish children. "Jack  Thompson" and "jack thompson" are the
// same key; two genuinely distinct children who normalise identically are
// ambiguous and never auto matched.
export function normaliseName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

export interface LinkedRow {
  candidate: SpondLinkCandidate
  link: PlayerSpondLink
  // Resolved for display through the players read; null when the linked
  // player no longer resolves (should not happen, the link cascades).
  playerName: string | null
}

export interface UnlinkedRow {
  candidate: SpondLinkCandidate
  // The automatic match: exactly one unlinked player carries this
  // normalised name, and no other candidate claims it. Null when none or
  // ambiguous; the screen offers a manual pick either way.
  autoPlayerId: string | null
  // More than one player (or more than one candidate) carries the name, so
  // automatic matching refused to guess.
  ambiguous: boolean
}

export interface SpondLinkingPlan {
  linked: LinkedRow[]
  unlinked: UnlinkedRow[]
}

// The screen's working set: candidates split into already linked (shown
// with the resolved player, offering unlink) and unlinked (offered an
// automatic match where safe). Players already linked to some member are
// out of the match pool, so a confirmation can never violate the one to
// one link constraints.
export function planSpondLinking(
  candidates: SpondLinkCandidate[],
  players: PlayerIdentityLite[],
  links: PlayerSpondLink[],
): SpondLinkingPlan {
  const linkByMemberId = new Map(links.map((l) => [l.spondMemberId, l]))
  const linkedPlayerIds = new Set(links.map((l) => l.playerId))
  const playerNameById = new Map(players.map((p) => [p.id, p.displayName]))

  // The unlinked players by normalised name. A name carried by more than
  // one unlinked player maps to 'ambiguous'.
  const poolByName = new Map<string, string | 'ambiguous'>()
  for (const p of players) {
    if (linkedPlayerIds.has(p.id)) continue
    const key = normaliseName(p.displayName)
    if (!key) continue
    poolByName.set(key, poolByName.has(key) ? 'ambiguous' : p.id)
  }

  // Candidate names that appear more than once can never safely claim a
  // player.
  const candidateNameCounts = new Map<string, number>()
  for (const c of candidates) {
    if (linkByMemberId.has(c.spondMemberId)) continue
    const key = normaliseName(c.displayName)
    candidateNameCounts.set(key, (candidateNameCounts.get(key) ?? 0) + 1)
  }

  const linked: LinkedRow[] = []
  const unlinked: UnlinkedRow[] = []
  for (const candidate of candidates) {
    const link = linkByMemberId.get(candidate.spondMemberId)
    if (link) {
      linked.push({ candidate, link, playerName: playerNameById.get(link.playerId) ?? null })
      continue
    }
    const key = normaliseName(candidate.displayName)
    const pooled = poolByName.get(key)
    const duplicateCandidate = (candidateNameCounts.get(key) ?? 0) > 1
    if (pooled && pooled !== 'ambiguous' && !duplicateCandidate) {
      unlinked.push({ candidate, autoPlayerId: pooled, ambiguous: false })
    } else {
      unlinked.push({ candidate, autoPlayerId: null, ambiguous: pooled === 'ambiguous' || duplicateCandidate })
    }
  }
  return { linked, unlinked }
}

// One confirmed selection: the member and the chosen player, and whether
// the choice was the automatic match or a manual pick.
export interface LinkSelection {
  spondMemberId: string
  playerId: string
  auto: boolean
}

// The insert payloads a confirmation writes: ids and the match origin
// ONLY. No name field exists on this shape, which is the point; club_id
// and created_by are pinned by the writing hook and the RLS.
export interface SpondLinkInsertRow {
  player_id: string
  spond_member_id: string
  matched_by: 'auto' | 'manual'
}

export function linkRowsForConfirm(selections: LinkSelection[]): SpondLinkInsertRow[] {
  const seenMembers = new Set<string>()
  const seenPlayers = new Set<string>()
  const rows: SpondLinkInsertRow[] = []
  for (const s of selections) {
    if (!s.playerId || !s.spondMemberId) continue
    // The one to one constraints, enforced here too so a malformed
    // selection state cannot send a doomed batch.
    if (seenMembers.has(s.spondMemberId) || seenPlayers.has(s.playerId)) continue
    seenMembers.add(s.spondMemberId)
    seenPlayers.add(s.playerId)
    rows.push({ player_id: s.playerId, spond_member_id: s.spondMemberId, matched_by: s.auto ? 'auto' : 'manual' })
  }
  return rows
}
