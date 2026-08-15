// =====================================================================
// The five populations Tonight counts, and why two of them differ.
//
// WRITTEN BEFORE THE MODEL, from a real reconciliation of the club's own
// data on 2026-08-11. A coach reported "19 vs 11" and asked which number
// was wrong. Neither was. They are two different populations wearing the
// same word:
//
//   19  the Spond EVENT AGGREGATE: every member Spond invited who pressed
//       Going. The event's audience was 46 to 50 people, which includes
//       members the Hub has never bound to a roster child.
//   11  TONIGHT'S GOING CHIP: covered Hub players, bound to a Spond
//       member, whose member accepted.
//
// The reconciliation that proved it (Training, 2026-08-11):
//
//   audience 50 = 27 linked + 23 members who are not Hub roster children
//   accepted 21 = 11 linked accepted + 10 unlinked accepted
//   declined 23 = 13 linked declined + 10 unlinked declined
//   unanswered 6 =  3 linked unanswered + 3 unlinked unanswered
//   covered 40 = 27 linked + 13 unlinked
//
// Every identity held, so there was no arithmetic to fix. What was broken
// was that nothing on screen said which population either number counted.
//
// FIVE CONCEPTS, NEVER COLLAPSED: the covered roster, the linked subset of
// it, the replies stored for THIS event, the coach's selection, and the raw
// event aggregate. This file pins each one separately and pins that no
// arithmetic path lets one leak into another.
//
// Names in fixtures are invented. No real child appears in this repo.
// =====================================================================
import { describe, expect, it } from 'vitest'
import {
  countByResponse,
  tonightCounts,
  tonightLinkNote,
  tonightUnlinkedNote,
  unlinkedByTeam,
  visibleRows,
  draftFromEntries,
  quickAdd,
  toggleIncluded,
  RESPONSE_FILTERS,
  type TonightDraft,
  type TonightRow,
} from './tonight'
import { spondAudience, spondAudienceNote, SPOND_AUDIENCE_CAPTION } from './spond'
import type { RegisterEntry } from './register'
import type { SpondEvent } from './data'
import type { RsvpStatus } from './spondRsvp'

const row = (id: string, over: Partial<TonightRow> = {}): TonightRow => ({
  playerId: id,
  displayName: id,
  shirtNumber: null,
  teamId: 'titans',
  teamName: 'Titans',
  teamBib: 'blue',
  response: null,
  manual: false,
  ...over,
})

// The club's own shape on the night the discrepancy was reported, built
// from the read only reconciliation above: 40 covered children, 27 of them
// bound to a Spond member, and every one of those 27 carrying a reply.
function squad({
  covered = 40,
  linked = 27,
  going = 11,
  notGoing = 13,
  noReply = 3,
  waiting = 0,
}: Partial<Record<'covered' | 'linked' | 'going' | 'notGoing' | 'noReply' | 'waiting', number>> = {}) {
  const rows: TonightRow[] = []
  const linkedIds = new Set<string>()
  // The linked children first, each carrying the reply the mirror stored.
  const replies: RsvpStatus[] = [
    ...Array<RsvpStatus>(going).fill('accepted'),
    ...Array<RsvpStatus>(notGoing).fill('declined'),
    ...Array<RsvpStatus>(noReply).fill('unanswered'),
    ...Array<RsvpStatus>(waiting).fill('waiting'),
  ]
  for (let i = 0; i < linked; i++) {
    const id = `linked-${i}`
    linkedIds.add(id)
    // A linked child past the end of the reply list is LINKED WITH NO
    // STORED REPLY: their member was not invited to this event, or the
    // link was made after the last sync. Real, and seen in production.
    rows.push(row(id, { response: replies[i] ?? null }))
  }
  for (let i = linked; i < covered; i++) rows.push(row(`unlinked-${i}`))
  return { rows, linkedIds }
}

const EMPTY: TonightDraft = { included: {}, attendance: {}, bibs: {}, added: {}, touched: {} }

const ids = (rows: TonightRow[]) => rows.map((r) => r.playerId)

// The raw event row as spond_events stores it: the four counts over
// everybody Spond invited, and nothing about who they are.
const event = (over: Partial<SpondEvent> = {}): SpondEvent => ({
  id: 'evt',
  title: 'Training',
  startsAt: '2026-08-11T17:00:00Z',
  teamId: null,
  teamName: null,
  spondType: null,
  accepted: 21,
  declined: 23,
  unanswered: 6,
  waiting: 0,
  cancelled: false,
  syncedAt: '2026-08-11T15:38:08Z',
  ...over,
})

// ---- 1. The reported case, proved to be two populations ---------------

describe('the 19 vs 11 case', () => {
  const { rows, linkedIds } = squad()
  const counts = tonightCounts(rows, EMPTY, linkedIds)

  it('counts 11 going over covered Hub players, not over the event audience', () => {
    expect(counts.responses.going).toBe(11)
  })

  it('counts 19 going over the Spond event audience, which is a different set', () => {
    // The two training events either side of the report both stored
    // accepted_count 19 while Tonight showed 10 going.
    const e = event({ accepted: 19, declined: 21, unanswered: 6, waiting: 0 })
    expect(e.accepted).toBe(19)
    expect(spondAudience(e)).toBe(46)
  })

  it('proves the two numbers describe different sized populations', () => {
    const e = event()
    // 50 people were invited to the Spond event; 27 of the 40 covered Hub
    // children are bound to one of them. The gap is not an error.
    expect(spondAudience(e)).toBe(50)
    expect(counts.covered).toBe(40)
    expect(counts.linked).toBe(27)
    expect(spondAudience(e)).toBeGreaterThan(counts.covered)
  })

  it('never claims the two are comparable, because neither note omits its population', () => {
    const linkNote = tonightLinkNote(counts, true)
    const audienceNote = spondAudienceNote(event())
    // Each sentence names who it counted. A bare "19" beside a bare "11"
    // is exactly the defect this fixes.
    expect(linkNote).toMatch(/players linked to Spond/)
    expect(audienceNote).toMatch(/Spond audience/)
    expect(audienceNote).toMatch(/invited/)
    // And the aggregate no longer carries a going figure at all. It used
    // to read "…, 21 going" directly beside a Going chip saying 11, which
    // is the pair of numbers this whole file exists for.
    expect(audienceNote).not.toMatch(/going/i)
    expect(audienceNote).not.toContain('21')
  })
})

// ---- 2. The populations are disjoint and complete ---------------------

describe('the identities that must hold', () => {
  const { rows, linkedIds } = squad()
  const counts = tonightCounts(rows, EMPTY, linkedIds)

  it('covered = linked + unlinked', () => {
    expect(counts.linked! + counts.unlinked!).toBe(counts.covered)
  })

  it('the four reply states are disjoint and sum to the players carrying a reply', () => {
    const r = counts.responses
    expect(r.going + r.notGoing + r.noReply + r.waiting).toBe(counts.withResponse)
  })

  it('linked = with a reply + awaiting one', () => {
    expect(counts.withResponse + counts.awaiting!).toBe(counts.linked)
  })

  it('everyone is the covered roster, linked or not', () => {
    expect(counts.responses.everyone).toBe(counts.covered)
    expect(counts.responses.everyone).toBe(40)
  })
})

// ---- 3. Unlinked is never a reply state ------------------------------

describe('an unlinked player has no reply to give', () => {
  const { rows, linkedIds } = squad({ covered: 5, linked: 2, going: 1, notGoing: 1, noReply: 0, waiting: 0 })
  const counts = tonightCounts(rows, EMPTY, linkedIds)

  it('does not count the three unlinked children under No reply', () => {
    expect(counts.unlinked).toBe(3)
    expect(counts.responses.noReply).toBe(0)
  })

  it('counts them under Everyone and nowhere else', () => {
    expect(counts.responses.everyone).toBe(5)
    const named = counts.responses.going + counts.responses.notGoing + counts.responses.noReply + counts.responses.waiting
    expect(named).toBe(2)
  })
})

// ---- 4. Linked, but no stored reply for THIS event --------------------

describe('a linked player with no reply stored for this event', () => {
  // The 2026-08-01 training event: 27 linked covered children, 24 replies.
  // The other three were linked after that sync ran.
  const { rows, linkedIds } = squad({ covered: 40, linked: 27, going: 10, notGoing: 11, noReply: 3, waiting: 0 })
  const counts = tonightCounts(rows, EMPTY, linkedIds)

  it('is counted as linked', () => {
    expect(counts.linked).toBe(27)
  })

  it('is not counted under any reply state', () => {
    expect(counts.withResponse).toBe(24)
    expect(counts.awaiting).toBe(3)
    const named = counts.responses.going + counts.responses.notGoing + counts.responses.noReply + counts.responses.waiting
    expect(named).toBe(24)
  })

  it('is said out loud rather than silently disappearing', () => {
    // Without this the three read exactly like unlinked children: no pill,
    // no chip, present only under Everyone, and the screen claiming 27
    // linked while showing 24 replies with no explanation.
    expect(tonightLinkNote(counts, true)).toMatch(/24/)
    expect(tonightLinkNote(counts, true)).toMatch(/27 of 40/)
  })

  it('adds no reply clause when every linked player has a reply', () => {
    const full = tonightCounts(squad().rows, EMPTY, squad().linkedIds)
    expect(full.awaiting).toBe(0)
    expect(tonightLinkNote(full, true)).toBe('27 of 40 players linked to Spond · 13 not linked')
  })
})

// ---- 5. The raw aggregate cannot reach the chips ----------------------

describe('the Spond event aggregate never drives a Tonight count', () => {
  it('takes no event, so an audience of fifty cannot inflate a chip', () => {
    const { rows, linkedIds } = squad()
    // tonightCounts is handed rows and links only. There is no parameter
    // an aggregate could arrive through, which is the structural half of
    // the rule; the wording half is tested above.
    expect(tonightCounts(rows, EMPTY, linkedIds).responses.going).toBe(11)
    expect(tonightCounts.length).toBe(3)
  })

  it('reports the audience under its own name, as a separate concept', () => {
    expect(spondAudience(event())).toBe(50)
    expect(spondAudienceNote(event())).toBe('Spond audience: 50 people invited')
  })

  it('states a headcount and nothing a coach can read as a reply split', () => {
    // Requirement 10, at the seam: the aggregate has exactly one number
    // and it is labelled as people invited. None of the four reply words
    // may appear beside a figure from this event.
    const note = spondAudienceNote(event())
    for (const word of ['accepted', 'declined', 'unanswered', 'waiting', 'going']) {
      expect(note.toLowerCase()).not.toContain(word)
    }
    expect(note.match(/\d+/g)).toEqual(['50'])
  })

  it('captions the aggregate so a reader knows who it counted', () => {
    expect(SPOND_AUDIENCE_CAPTION).toMatch(/invited/i)
    expect(SPOND_AUDIENCE_CAPTION).toMatch(/Spond event/i)
  })
})

// ---- 6. Coverage restricts what Tonight counts ------------------------

describe('a player outside this session s coverage', () => {
  it('cannot inflate any count, because they are not a row', () => {
    // buildTonightRows composes from the register view, which lists only
    // the covered squad. A child on another team is simply absent, so this
    // pins the consequence: the link set may be club wide, the counts are
    // not.
    const { rows, linkedIds } = squad({ covered: 5, linked: 3, going: 2, notGoing: 1, noReply: 0, waiting: 0 })
    // Three more children the club has linked, on teams this session does
    // not cover. The club wide link set knows them; Tonight must not.
    const clubWide = new Set([...linkedIds, 'other-team-a', 'other-team-b', 'other-team-c'])
    const counts = tonightCounts(rows, EMPTY, clubWide)
    expect(counts.covered).toBe(5)
    expect(counts.linked).toBe(3)
    expect(counts.unlinked).toBe(2)
    expect(tonightLinkNote(counts, true)).toBe('3 of 5 players linked to Spond · 2 not linked')
  })
})

// ---- 7. Selected is independent of every reply ------------------------

describe('what the coach selected is their own decision', () => {
  const { rows, linkedIds } = squad({ covered: 5, linked: 4, going: 1, notGoing: 1, noReply: 1, waiting: 1 })

  it('starts at zero with a full squad of replies', () => {
    expect(tonightCounts(rows, EMPTY, linkedIds).selected).toBe(0)
  })

  it('does not move when a reply says Going', () => {
    const counts = tonightCounts(rows, EMPTY, linkedIds)
    expect(counts.responses.going).toBe(1)
    expect(counts.selected).toBe(0)
  })

  it('counts a Not going child the coach included, because they turned up', () => {
    const notGoing = rows.find((r) => r.response === 'declined')!
    const draft = toggleIncluded(EMPTY, notGoing.playerId)
    const counts = tonightCounts(rows, draft, linkedIds)
    expect(counts.selected).toBe(1)
    expect(counts.responses.going).toBe(1)
  })

  it('counts an unlinked child the coach included', () => {
    const unlinked = rows.find((r) => !linkedIds.has(r.playerId))!
    const counts = tonightCounts(rows, toggleIncluded(EMPTY, unlinked.playerId), linkedIds)
    expect(counts.selected).toBe(1)
    expect(counts.withResponse).toBe(4)
  })
})

// ---- 8. A guest does not change link coverage -------------------------

describe('a quick added guest', () => {
  const { rows, linkedIds } = squad({ covered: 4, linked: 2, going: 1, notGoing: 1, noReply: 0, waiting: 0 })
  const guest = row('guest', { manual: true, response: 'accepted' })

  it('is counted in the squad on screen but is not evidence about it', () => {
    const counts = tonightCounts([...rows, guest], quickAdd(EMPTY, 'guest'), linkedIds)
    // They are on the list, so Everyone counts them.
    expect(counts.responses.everyone).toBe(5)
    // But link coverage is a claim about the SQUAD this session covers, and
    // a visitor from another team cannot make it look better or worse.
    expect(counts.covered).toBe(4)
    expect(counts.linked).toBe(2)
    expect(counts.guests).toBe(1)
    expect(tonightLinkNote(counts, true)).toBe('2 of 4 players linked to Spond · 2 not linked')
  })

  it('is selected, because that is why the coach added them', () => {
    const counts = tonightCounts([...rows, guest], quickAdd(EMPTY, 'guest'), linkedIds)
    expect(counts.selected).toBe(1)
  })
})

// ---- 8b. The reply split is the covered squad, guests included nowhere in it
//
// CODEX REVIEW, P2. The four reply states came from countByResponse over
// every row, guests included, while withResponse, linked and awaiting
// deliberately skipped a guest. So one visitor carrying a reply made the
// split describe a different population from the coverage figures beside
// it, and the identity below silently stopped holding.
//
// The module already had the answer and only half applied it:
// hasResponseContext refuses a guest's reply as evidence about the covered
// squad ("a fact about their own team's event"), so a guest's reply cannot
// OPEN the filters. It could still inflate them and appear inside them,
// which is the same inconsistency seen from the other side.
//
// So the reply split, the chips and the rows a chip filters to are all the
// covered squad. A guest stays on Everyone, stays selectable, and stays in
// the groups.

describe('the covered squad reply split', () => {
  const covered = row('anna', { response: 'accepted' })
  const coveredOut = row('ben', { response: 'declined' })
  const unlinkedChild = row('cara')
  const guestGoing = row('zed', { manual: true, response: 'accepted' })
  const all = [covered, coveredOut, unlinkedChild, guestGoing]
  const linked = new Set(['anna', 'ben', 'zed'])

  it('counts a covered linked child who accepted under Going and withResponse', () => {
    const counts = tonightCounts([covered], EMPTY, new Set(['anna']))
    expect(counts.responses.going).toBe(1)
    expect(counts.withResponse).toBe(1)
    expect(counts.linked).toBe(1)
    expect(counts.awaiting).toBe(0)
  })

  it('does not let a guest s reply inflate Going', () => {
    // Two rows carry an accepted reply; only one of them is covered squad.
    const counts = tonightCounts(all, EMPTY, linked)
    expect(counts.responses.going).toBe(1)
  })

  it('does not let a guest s reply inflate withResponse', () => {
    const counts = tonightCounts(all, EMPTY, linked)
    expect(counts.withResponse).toBe(2)
  })

  it('keeps the reply states summing to withResponse with a guest present', () => {
    const r = tonightCounts(all, EMPTY, linked).responses
    const counts = tonightCounts(all, EMPTY, linked)
    expect(r.going + r.noReply + r.notGoing + r.waiting).toBe(counts.withResponse)
  })

  it('keeps the coverage identities with a guest present', () => {
    const counts = tonightCounts(all, EMPTY, linked)
    expect(counts.covered).toBe(3)
    expect(counts.guests).toBe(1)
    expect(counts.linked! + counts.unlinked!).toBe(counts.covered)
    expect(counts.withResponse + counts.awaiting!).toBe(counts.linked)
  })

  it('still shows the guest under Everyone', () => {
    const counts = tonightCounts(all, EMPTY, linked)
    expect(counts.responses.everyone).toBe(4)
    expect(ids(visibleRows(all, 'all'))).toContain('zed')
  })

  it('leaves the chip number equal to the rows that chip shows', () => {
    // The rule the whole PR rests on. Excluding the guest from the count
    // while leaving them in the list would swap one mismatch for another.
    const counts = tonightCounts(all, EMPTY, linked)
    expect(visibleRows(all, 'going')).toHaveLength(counts.responses.going)
    expect(visibleRows(all, 'all')).toHaveLength(counts.responses.everyone)
    expect(ids(visibleRows(all, 'going'))).toEqual(['anna'])
  })

  it('still counts the guest as selected, independently of any reply', () => {
    const counts = tonightCounts(all, quickAdd(EMPTY, 'zed'), linked)
    expect(counts.selected).toBe(1)
    expect(counts.responses.going).toBe(1)
  })

  it('leaves an ordinary covered linked child untouched', () => {
    const counts = tonightCounts(all, EMPTY, linked)
    expect(counts.responses.notGoing).toBe(1)
    expect(ids(visibleRows(all, 'declined'))).toEqual(['ben'])
  })

  it('still counts no unlinked child as No reply', () => {
    const counts = tonightCounts(all, EMPTY, linked)
    expect(counts.responses.noReply).toBe(0)
    expect(ids(visibleRows(all, 'unanswered'))).toEqual([])
  })

  it('leaves the 19 vs 11 reconciliation exactly as it was', () => {
    // No guest in the reported case, so nothing about it may move.
    const { rows: squadRows, linkedIds } = squad()
    const counts = tonightCounts(squadRows, EMPTY, linkedIds)
    expect(counts.responses.going).toBe(11)
    expect(counts.covered).toBe(40)
    expect(counts.linked).toBe(27)
    expect(counts.withResponse).toBe(27)
    expect(spondAudience(event())).toBe(50)
  })
})

// ---- 9. Unknown is never rendered as zero -----------------------------

describe('when the link set cannot be read', () => {
  const { rows } = squad({ covered: 6, linked: 0, going: 0, notGoing: 0, noReply: 0, waiting: 0 })

  it('reports linked as unknown rather than as none', () => {
    const counts = tonightCounts(rows, EMPTY, null)
    expect(counts.linked).toBeNull()
    expect(counts.unlinked).toBeNull()
    expect(counts.awaiting).toBeNull()
  })

  it('says nothing rather than "0 of 6 linked", which would be a confident falsehood', () => {
    expect(tonightLinkNote(tonightCounts(rows, EMPTY, null), true)).toBe('')
  })

  it('still counts the squad and the replies it can see', () => {
    const counts = tonightCounts(rows, EMPTY, null)
    expect(counts.covered).toBe(6)
    expect(counts.withResponse).toBe(0)
  })
})

// ---- 10. Nothing to say when everyone is linked ----------------------

describe('a fully linked squad', () => {
  it('says so plainly rather than staying silent', () => {
    const { rows, linkedIds } = squad({ covered: 3, linked: 3, going: 2, notGoing: 1, noReply: 0, waiting: 0 })
    const counts = tonightCounts(rows, EMPTY, linkedIds)
    // The old screen printed the line only when linked < covered, so a
    // fully linked squad lost the one sentence that says which population
    // the chips describe.
    expect(tonightLinkNote(counts, true)).toBe('3 of 3 players linked to Spond')
  })

  it('says nothing at all for a squad with nobody on it', () => {
    expect(tonightLinkNote(tonightCounts([], EMPTY, new Set()), true)).toBe('')
  })
})

// ---- 11. Duplicates cannot double count ------------------------------

describe('duplicate data', () => {
  it('counts a player once even if their row appears twice', () => {
    const r = row('anna', { response: 'accepted' })
    const counts = tonightCounts([r, r], EMPTY, new Set(['anna']))
    expect(counts.covered).toBe(1)
    expect(counts.linked).toBe(1)
    expect(counts.responses.going).toBe(1)
    expect(counts.responses.everyone).toBe(1)
  })

  it('counts a selected player once even if their row appears twice', () => {
    const r = row('anna', { response: 'accepted' })
    const counts = tonightCounts([r, r], toggleIncluded(EMPTY, 'anna'), new Set(['anna']))
    expect(counts.selected).toBe(1)
  })
})

// ---- 12. A linked event with no usable replies -----------------------

describe('a linked event that has no stored replies at all', () => {
  // The Clifton moor gala: mirrored, linked, and not one of the club's 27
  // linked members is on it.
  const { rows, linkedIds } = squad({ covered: 40, linked: 27, going: 0, notGoing: 0, noReply: 0, waiting: 0 })
  const counts = tonightCounts(rows, EMPTY, linkedIds)

  it('still reports the squad as linked, because it is', () => {
    expect(counts.linked).toBe(27)
    expect(counts.withResponse).toBe(0)
    expect(counts.awaiting).toBe(27)
  })

  it('says the replies are missing rather than implying nobody is coming', () => {
    expect(tonightLinkNote(counts, true)).toBe(
      '27 of 40 players linked to Spond · 13 not linked · 0 with a reply for this event',
    )
  })

  it('does not report a zero Going as a fact about the squad', () => {
    // Every named state is zero, which countByResponse also reports. The
    // screen must not read that as "nobody is coming"; hasResponseContext
    // is what stops it, and it is unchanged.
    expect(counts.responses.going).toBe(0)
    expect(counts.responses.everyone).toBe(40)
  })
})

// ---- 12b. A reply read that has not landed --------------------------
//
// ADVERSARIAL REVIEW, lens "can stale or missing data produce a confident
// false count?". It could. A reply query still in flight, or one that
// failed, hands the screen rows carrying no response, which is
// arithmetically identical to an event nobody replied to. The note then
// read "27 of 40 players linked to Spond · 0 with a reply for this event"
// while the answer was simply not back yet.
//
// So the caller states whether the replies are KNOWN, exactly as it
// already states whether the link set is. Absence is never counted.

describe('while the replies are still unknown', () => {
  const { rows, linkedIds } = squad({ covered: 40, linked: 27, going: 0, notGoing: 0, noReply: 0, waiting: 0 })
  const counts = tonightCounts(rows, EMPTY, linkedIds)

  it('claims no reply figure at all', () => {
    expect(tonightLinkNote(counts, false)).toBe('27 of 40 players linked to Spond · 13 not linked')
  })

  it('still states the link coverage, which the reply read does not affect', () => {
    expect(tonightLinkNote(counts, false)).toContain('27 of 40')
  })

  it('adds the reply figure the moment the read lands', () => {
    expect(tonightLinkNote(counts, true)).toContain('0 with a reply')
  })

  it('never claims a reply figure it could not have, whatever the link state', () => {
    expect(tonightLinkNote(tonightCounts(rows, EMPTY, null), false)).toBe('')
  })
})

// ---- 13. The chips and the model agree -------------------------------

describe('the chips consume the canonical model', () => {
  it('countByResponse and tonightCounts never disagree about a state', () => {
    const { rows, linkedIds } = squad()
    const chips = countByResponse(rows)
    const counts = tonightCounts(rows, EMPTY, linkedIds)
    expect(counts.responses.going).toBe(chips.going)
    expect(counts.responses.noReply).toBe(chips.unanswered)
    expect(counts.responses.notGoing).toBe(chips.declined)
    expect(counts.responses.waiting).toBe(chips.waiting)
    expect(counts.responses.everyone).toBe(chips.all)
  })
})

// ---- 14. Selected reads the same draft the groups do ------------------

describe('selected matches what a save would store', () => {
  it('follows the draft, so a stored row the coach unticked is not counted', () => {
    const { rows, linkedIds } = squad({ covered: 3, linked: 3, going: 3, notGoing: 0, noReply: 0, waiting: 0 })
    const stored: RegisterEntry[] = rows.map((r) => ({
      sessionId: 's',
      playerId: r.playerId,
      // Selected into a group. Attendance is a different field and this
      // test says nothing about it.
      present: false,
      includedInGroups: true,
      bibColourOverride: null,
      source: 'roster',
    }))
    const draft = draftFromEntries(stored)
    expect(tonightCounts(rows, draft, linkedIds).selected).toBe(3)
    const after = toggleIncluded(draft, rows[0].playerId)
    expect(tonightCounts(rows, after, linkedIds).selected).toBe(2)
  })
})

// ---- 15. The 15 August morning session, reconciled -------------------
//
// Production, read only, on 2026-08-15. The one Hub session that day was
// Training at 10:00, covering all five teams: 40 registered players, 27
// of them bound to a Spond member, the gap concentrated in two teams
// (8 and 5 children). The linked Spond event's own aggregate was 20
// accepted, 18 declined, 11 unanswered, 0 waiting, an audience of 49
// people. The stored replies for the event were 12 accepted, 11 declined,
// 4 unanswered, 0 waiting, exactly one per linked member.
//
// 12 + 4 + 11 + 0 = 27, which is the linked set, not an error. The sync
// derives the aggregate and the per member rows from the SAME four payload
// arrays (supabase/functions/_shared/spond.ts, deriveCounts and
// deriveMemberStatuses), differing only by the linked filter, so the two
// splits cannot disagree about a member. What was missing on screen was
// the size of the gap and where it lives, which the notes below now say.
//
// Names in fixtures are synthetic. No real child appears in this repo.

describe('the 15 August morning session', () => {
  const shape = { covered: 40, linked: 27, going: 12, notGoing: 11, noReply: 4, waiting: 0 }
  const { rows, linkedIds } = squad(shape)
  const counts = tonightCounts(rows, EMPTY, linkedIds)
  const aggregate = event({ accepted: 20, declined: 18, unanswered: 11, waiting: 0 })

  it('counts Everyone as the covered squad, 40', () => {
    expect(counts.responses.everyone).toBe(40)
  })

  it('counts the four reply states as the stored linked replies, 12 4 11 0', () => {
    expect(counts.responses.going).toBe(12)
    expect(counts.responses.noReply).toBe(4)
    expect(counts.responses.notGoing).toBe(11)
    expect(counts.responses.waiting).toBe(0)
  })

  it('sums the reply states to the linked set, 27', () => {
    const r = counts.responses
    expect(r.going + r.noReply + r.notGoing + r.waiting).toBe(27)
    expect(counts.linked).toBe(27)
    expect(counts.withResponse).toBe(27)
  })

  it('keeps the 13 unlinked players out of every reply state', () => {
    expect(counts.unlinked).toBe(13)
    // An unlinked child is in Everyone and in none of the four states.
    const unlinkedRow = rows.find((r) => !linkedIds.has(r.playerId))!
    expect(visibleRows([unlinkedRow], 'all')).toHaveLength(1)
    for (const f of ['going', 'unanswered', 'declined', 'waiting'] as const) {
      expect(visibleRows([unlinkedRow], f)).toHaveLength(0)
    }
  })

  it('never lets the 49 person audience near a chip', () => {
    // 20, 18 and 49 are the aggregate's figures. The builder cannot even
    // receive them: it takes rows and links only.
    expect(spondAudience(aggregate)).toBe(49)
    expect(counts.responses.going).not.toBe(aggregate.accepted)
    expect(counts.responses.notGoing).not.toBe(aggregate.declined)
    expect(counts.responses.everyone).not.toBe(spondAudience(aggregate))
    expect(spondAudienceNote(aggregate)).toBe('Spond audience: 49 people invited')
  })

  it('says both halves of the coverage sentence', () => {
    expect(tonightLinkNote(counts, true)).toBe('27 of 40 players linked to Spond · 13 not linked')
  })

  it('gives every chip exactly the rows that chip lists', () => {
    for (const f of RESPONSE_FILTERS) {
      const chips = countByResponse(rows)
      expect(visibleRows(rows, f)).toHaveLength(chips[f])
    }
  })

  it('is indifferent to row order, so sorting can never change a count', () => {
    const reversed = [...rows].reverse()
    const rotated = [...rows.slice(17), ...rows.slice(0, 17)]
    for (const variant of [reversed, rotated]) {
      const c = tonightCounts(variant, EMPTY, linkedIds)
      expect(c).toEqual(counts)
      for (const f of RESPONSE_FILTERS) {
        expect(visibleRows(variant, f)).toHaveLength(visibleRows(rows, f).length)
      }
    }
  })
})

// ---- 16. Where the gap lives, so a coach is not left hunting ---------
//
// "27 of 40 linked" tells a coach the size of the problem and nothing
// about where to fix it. On an all team session the linking screen then
// asks them to guess which teams hold the 13. The breakdown names the
// teams, from the same rows and the same link set the coverage line uses,
// so the two can never disagree.

describe('unlinkedByTeam', () => {
  const teamRow = (id: string, teamName: string, over: Partial<TonightRow> = {}) =>
    row(id, { teamId: teamName.toLowerCase(), teamName, ...over })

  // The 15 August shape in miniature: two teams fully linked, two with
  // gaps of different sizes.
  const rows15 = [
    teamRow('a1', 'Argonauts'),
    teamRow('a2', 'Argonauts'),
    teamRow('a3', 'Argonauts'),
    teamRow('t1', 'Trojans'),
    teamRow('t2', 'Trojans'),
    teamRow('s1', 'Spartans', { response: 'accepted' }),
    teamRow('s2', 'Spartans'),
  ]
  const linked = new Set(['a3', 's1', 's2'])

  it('counts the unlinked players per team, largest gap first', () => {
    expect(unlinkedByTeam(rows15, linked)).toEqual([
      { teamName: 'Argonauts', count: 2 },
      { teamName: 'Trojans', count: 2 },
    ])
  })

  it('orders two equal gaps by name, so the list is stable', () => {
    const out = unlinkedByTeam(rows15, linked)
    expect(out.map((t) => t.teamName)).toEqual(['Argonauts', 'Trojans'])
  })

  it('sums to exactly the unlinked figure the coverage line prints', () => {
    const total = unlinkedByTeam(rows15, linked).reduce((n, t) => n + t.count, 0)
    expect(total).toBe(tonightCounts(rows15, EMPTY, linked).unlinked)
  })

  it('treats a stored reply as proof of a link, exactly as the counts do', () => {
    // A row carrying a reply is linked even when the link read has not
    // caught up, so the breakdown cannot exceed the coverage line.
    const stale = [teamRow('x1', 'Titans', { response: 'declined' })]
    expect(unlinkedByTeam(stale, new Set())).toEqual([])
  })

  it('skips a quick added guest, who is not part of the covered squad', () => {
    const withGuest = [...rows15, teamRow('g1', 'Gladiators', { manual: true })]
    expect(unlinkedByTeam(withGuest, linked).find((t) => t.teamName === 'Gladiators')).toBeUndefined()
  })

  it('counts a duplicated row once', () => {
    const doubled = [...rows15, rows15[0]]
    expect(unlinkedByTeam(doubled, linked)).toEqual(unlinkedByTeam(rows15, linked))
  })

  it('claims nothing when the link set is unknown', () => {
    // A read in flight or a failed read must not render as "everyone is
    // linked" or as "nobody is": there is no list to make.
    expect(unlinkedByTeam(rows15, null)).toEqual([])
  })
})

describe('tonightUnlinkedNote', () => {
  const teamRow = (id: string, teamName: string, over: Partial<TonightRow> = {}) =>
    row(id, { teamId: teamName.toLowerCase(), teamName, ...over })
  const rows15 = [
    teamRow('a1', 'Argonauts'),
    teamRow('a2', 'Argonauts'),
    teamRow('t1', 'Trojans'),
    teamRow('s1', 'Spartans', { response: 'accepted' }),
  ]
  const linked = new Set(['s1'])

  it('names the teams holding the gap', () => {
    expect(tonightUnlinkedNote(rows15, linked)).toBe('Not linked: Argonauts 2 · Trojans 1')
  })

  it('says nothing when everyone is linked', () => {
    expect(tonightUnlinkedNote(rows15, new Set(['a1', 'a2', 't1', 's1']))).toBe('')
  })

  it('says nothing when the link set is unknown, rather than zero missing', () => {
    expect(tonightUnlinkedNote(rows15, null)).toBe('')
  })
})
