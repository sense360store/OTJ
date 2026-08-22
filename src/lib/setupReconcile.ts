// =====================================================================
// COACH-4: keeping the coach's work when attendance changes.
//
// A coach arranges and saves the night while replies are still arriving.
// This module answers what a fresh set of replies means for that saved
// arrangement, and its one rule is PRESERVATION: every assignment already
// made is kept, whoever made it. There is no provenance and none is
// needed, because the rule is not "preserve the manual ones", it is
// "preserve all of them".
//
// PURE. No React, no queries, no I/O, and NOTHING HERE PERSISTS. The
// result carries a new draft built entirely from the existing gesture
// helpers, and that draft reaches storage only through Save groups,
// exactly as every other edit on Players & groups does. This module holds
// no reference to a mutation, a client or a table.
//
// IT NEVER CONSULTS THE GENERATOR. planSetup answers a different question
// (what would a blank night look like) and rerunning it here would move
// retained children to wherever a fresh plan puts them, which is the
// precise destruction this slice exists to stop. The reconciliation reads
// only the arrangement in hand and the replies beside it.
//
// THE BOUNDARY WITH COACH-3 IS EXPLICIT DATA, not timing: a night with
// nobody included is unarranged and belongs to the suggested setup, so
// this module reconciles it to nothing. A night with anybody included is
// arranged, and from then on the arrangement is only ever edited at the
// margins this file defines.
// =====================================================================
import { effectiveBib } from './bibs'
import {
  type TonightDraft,
  type TonightRow,
  clearSelection,
  draftBib,
  draftIncluded,
  hasResponseContext,
  matchesResponse,
  selectAll,
  setDraftBib,
  tonightGroups,
} from './tonight'

// Where one newcomer goes.
export interface NewcomerPlacement {
  row: TonightRow
  // The colour of the EXISTING group this child joins. Null when the
  // arrangement holds no coloured group at all, in which case the child is
  // included and nothing is aimed at: a club that runs without bibs keeps
  // its one plain group and the newcomer simply joins the night.
  colour: string | null
  // The bib gesture that lands them there. Null means no gesture is made;
  // { target: null } is the inherit gesture, clearing any dormant override
  // because the team default already resolves to the group's colour; a
  // string target is an ordinary session override. The sentinel meaning
  // "no bib" is never produced here, for the same reason planBibTargets
  // never produces it: a generator that took a bib off a child nobody
  // asked it to would be making a decision that is not its to make.
  bib: { target: string | null } | null
}

export interface SetupReconciliation {
  // Anybody included: the explicit data boundary with COACH-3. False means
  // the night is unarranged, the suggested setup owns it, and this result
  // says nothing and changes nothing.
  arranged: boolean
  // Whether this session has any external reply to reconcile against, from
  // the same seam the response chips use. False renders as silence rather
  // than as "no changes", because a club with no Spond has nothing for
  // attendance to update.
  contextKnown: boolean
  // Included children who stay, which is everybody included except the
  // departures. Their inclusion, their bib and their attendance are
  // untouched by construction: no code path below writes to them.
  retained: TonightRow[]
  // Included children whose OWN reply now says Not going. That is the one
  // authoritative not attending fact, and it is read through
  // matchesResponse so a child with no link, a guest, a failed read and an
  // unanswered parent all stay exactly where the coach put them. Absence
  // of a fact is never a departure.
  departures: TonightRow[]
  // Children whose own reply says Going and whom the arrangement does not
  // hold, each with the existing group they join. A guest is refused by
  // matchesResponse here too: their reply is a fact about their own
  // team's event.
  newcomers: NewcomerPlacement[]
  changed: boolean
  // The resulting draft, built by the same gesture helpers a tap uses so
  // touched is stamped exactly as a tap stamps it. THE SAME OBJECT as the
  // input when nothing changed, so a screen can hand it back to setState
  // without a re-render and a test can assert identity.
  draft: TonightDraft
}

// A row appearing twice cannot classify twice. tonightCounts and
// sessionSetup take the same precaution over the same rows.
function uniqueByPlayer(rows: readonly TonightRow[]): TonightRow[] {
  const byPlayer = new Map<string, TonightRow>()
  for (const r of rows) if (!byPlayer.has(r.playerId)) byPlayer.set(r.playerId, r)
  return [...byPlayer.values()]
}

// The reconciliation.
//
// THREE CLASSES AND NOTHING ELSE. A child is retained, a departure, or a
// newcomer, and the classes are decided per child from the child's own
// reply through the one canonical predicate:
//
//   DEPARTURE   included, and their reply says Not going. Not unanswered,
//               not waiting, not unlinked, not a failed read: those are
//               all either no fact or no definitive fact, and a coach who
//               deliberately included a child without a Yes keeps them.
//   NEWCOMER    not included, and their reply says Going.
//   RETAINED    everybody else who is included. Nothing below touches any
//               field of theirs, which is what "preserve all of them"
//               means mechanically.
//
// A departure empties one place and moves nobody. A newcomer takes one
// place and moves nobody. No case requires a retained child to move for
// the result to be operational, so there is no rebalancing here at all,
// and prettier numbers are never a reason to shuffle a child a coach has
// already placed.
export function reconcileSetup(rows: readonly TonightRow[], draft: TonightDraft): SetupReconciliation {
  const unique = uniqueByPlayer(rows)
  const contextKnown = hasResponseContext([...unique])
  const arranged = unique.some((r) => draftIncluded(draft, r.playerId))
  if (!arranged) {
    // Unarranged nights belong to the suggested setup. Reconciling one
    // would re-derive COACH-3 badly, so the boundary is stated here as
    // data rather than left to the screen's judgement.
    return { arranged, contextKnown, retained: [], departures: [], newcomers: [], changed: false, draft }
  }

  const departures: TonightRow[] = []
  const retained: TonightRow[] = []
  const arrivals: TonightRow[] = []
  for (const r of unique) {
    if (draftIncluded(draft, r.playerId)) {
      if (matchesResponse(r, 'declined')) departures.push(r)
      else retained.push(r)
    } else if (matchesResponse(r, 'going')) {
      arrivals.push(r)
    }
  }

  // Departures first, so a freed place is visible to the placements below
  // and a group a child left may stay smaller. Only their inclusion moves:
  // their bib override stays where the coach left it, so a child who
  // un-declines later walks back into the same colour, and their
  // attendance is a different fact this module never reads or writes.
  let working = departures.length > 0 ? clearSelection(draft, departures) : draft

  // Newcomers join the groups that already exist, one at a time in row
  // order so the result is deterministic and several arrivals spread out
  // rather than piling into the one group that was smallest first.
  //
  // The groups are read through tonightGroups on each step, which is the
  // one grouping implementation the product has, over the working draft so
  // each placement counts in the next. NO NEW COLOUR IS EVER OPENED: a
  // valid operational result never requires one, because every group the
  // coach saved keeps its children and a newcomer in any existing group is
  // operational. Restructuring the night is the suggestion's business on
  // an unarranged screen, and nobody's here.
  const newcomers: NewcomerPlacement[] = []
  for (const row of arrivals) {
    const coloured = tonightGroups([...rows], working).filter((g) => g.bib !== null)
    if (coloured.length === 0) {
      // Nothing to aim at. The child joins the night; the bib rule (their
      // override, else their team default, else none) answers as it
      // always does, and stamping a guess would take a decision that is
      // the coach's.
      working = selectAll(working, [row])
      newcomers.push({ row, colour: null, bib: null })
      continue
    }
    // Where they already land, first. A child whose current resolution is
    // one of the groups on the grass joins their own group, whatever its
    // size: team continuity beats symmetrical numbers, and a dormant
    // override from an earlier arrangement walks them back to the colour
    // the coach last gave them.
    const resolved = effectiveBib(draftBib(working, row.playerId), row.teamBib)
    let joined = coloured.find((g) => g.bib === resolved)
    if (!joined) {
      // Otherwise the smallest existing group. tonightGroups orders by the
      // club's bib vocabulary, so "first smallest in that order" is the
      // deterministic tie break and reads the same twice.
      joined = coloured.reduce((best, g) => (g.count < best.count ? g : best))
    }
    const colour = joined.bib as string
    // The same inherit rule the suggestion uses: no override where the
    // team default already resolves to the group's colour, so a later
    // change of team default still moves the child, and an ordinary
    // session override otherwise.
    const target = effectiveBib(null, row.teamBib) === colour ? null : colour
    working = setDraftBib(selectAll(working, [row]), row.playerId, target)
    newcomers.push({ row, colour, bib: { target } })
  }

  const changed = departures.length > 0 || newcomers.length > 0
  return {
    arranged,
    contextKnown,
    retained,
    departures,
    newcomers,
    changed,
    draft: changed ? working : draft,
  }
}

// The one sentence, and the only formatter.
//
// Counts, never algorithm prose, and the shapes are fixed: what arrived,
// what left, and the standing promise that the groups the coach saved are
// kept. Empty for an unarranged night (the suggestion speaks there) and
// for a session with no reply context (a club with no Spond has nothing
// for attendance to update, and "no changes" would claim a comparison
// that never ran).
//
// There is no "reassigned" arm because no reachable result moves a
// retained child: the reconciliation writes only to departures and
// newcomers, so the sentence for a move would be a sentence about a state
// this module cannot produce.
export function reconciliationNote(rec: SetupReconciliation): string {
  if (!rec.arranged || !rec.contextKnown) return ''
  if (!rec.changed) return 'No group changes needed.'
  const parts: string[] = []
  if (rec.newcomers.length > 0) parts.push(`${rec.newcomers.length} added`)
  if (rec.departures.length > 0) parts.push(`${rec.departures.length} removed`)
  return `Attendance updated: ${parts.join(', ')}. Existing groups kept.`
}
