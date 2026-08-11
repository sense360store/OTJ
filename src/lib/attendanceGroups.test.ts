// =====================================================================
// Three facts, three fields, and none of them writes another.
//
// WHAT HAPPENED. register_entries.present was created to mean "this child
// was at this session". The Tonight release reused it to mean "this child
// is in tonight's working groups", because one tick happened to set both.
// From then on the column answered two questions with one bit, and every
// read of it was a guess.
//
// The three facts, which disagree constantly and legitimately:
//
//   SPOND RESPONSE   what the parent said. Read only, and context.
//   ATTENDANCE       whether the child actually turned up.
//   GROUP INCLUSION  whether the coach put them in a working group.
//
// A Going child can be absent. A Not going child can be standing on the
// pitch. A child who attended need not be in a group, and a coach can
// arrange groups in advance for children who have not arrived. Every one
// of those is a real Tuesday, so every one of them has to be storable.
//
// These tests are the behavioural half. The schema half is
// supabase/migrations/0047_register_group_inclusion.sql, whose own
// self-verification refuses to let either column be backfilled from the
// other.
// =====================================================================
import { describe, expect, it } from 'vitest'
import type { RegisterEntry } from './register'
import {
  draftDelta,
  draftEntries,
  draftFromEntries,
  draftIsDirty,
  draftRemovals,
  quickAdd,
  selectAll,
  setDraftBib,
  toggleAttendance,
  toggleIncluded,
  tonightGroups,
  tonightUpsertBatches,
  tonightUpsertRows,
  type TonightDraft,
  type TonightRow,
} from './tonight'

const SESSION = 'session-1'
const CLUB = 'club-1'

function entry(over: Partial<RegisterEntry> = {}): RegisterEntry {
  return {
    sessionId: SESSION,
    playerId: 'p1',
    present: false,
    includedInGroups: false,
    bibColourOverride: null,
    source: 'roster',
    ...over,
  }
}

function row(over: Partial<TonightRow> = {}): TonightRow {
  return {
    playerId: 'p1',
    displayName: 'Alpha Synthetic',
    shirtNumber: null,
    teamId: 'titans',
    teamName: 'Titans',
    teamBib: 'red',
    response: null,
    manual: false,
    ...over,
  }
}

const upserts = (draft: TonightDraft, entries: RegisterEntry[]) =>
  tonightUpsertRows(draftDelta(draft, entries, SESSION), CLUB)

// REQUIREMENT 10. The new field is persisted and read back on its own.
describe('group inclusion is its own stored field', () => {
  it('is read from included_in_groups, not from present', () => {
    const draft = draftFromEntries([entry({ present: true, includedInGroups: false })])
    expect(draft.included.p1).toBe(false)
    expect(draft.attendance.p1).toBe(true)
  })

  it('round trips independently of attendance', () => {
    const draft = draftFromEntries([entry({ present: false, includedInGroups: true })])
    expect(draft.included.p1).toBe(true)
    expect(draft.attendance.p1).toBe(false)
  })

  it('writes the column the coach actually changed', () => {
    const stored = [entry({ present: false, includedInGroups: false })]
    const rows = upserts(toggleIncluded(draftFromEntries(stored), 'p1'), stored)
    expect(rows).toEqual([
      { session_id: SESSION, player_id: 'p1', club_id: CLUB, included_in_groups: true },
    ])
    // The attendance column is ABSENT from the payload, not sent as false.
    expect(Object.keys(rows[0])).not.toContain('present')
  })
})

// REQUIREMENTS 5 and 6. Neither tick moves the other.
describe('the two ticks are independent', () => {
  it('toggling group inclusion does not alter attendance', () => {
    const stored = [entry({ present: true, includedInGroups: false })]
    const draft = toggleIncluded(draftFromEntries(stored), 'p1')
    expect(draft.attendance.p1).toBe(true)
    const rows = upserts(draft, stored)
    expect(rows).toHaveLength(1)
    expect(rows[0].included_in_groups).toBe(true)
    expect(rows[0]).not.toHaveProperty('present')
  })

  it('marking attendance does not alter group inclusion', () => {
    const stored = [entry({ present: false, includedInGroups: true })]
    const draft = toggleAttendance(draftFromEntries(stored), 'p1')
    expect(draft.included.p1).toBe(true)
    const rows = upserts(draft, stored)
    expect(rows).toHaveLength(1)
    expect(rows[0].present).toBe(true)
    expect(rows[0]).not.toHaveProperty('included_in_groups')
  })

  it('un-marking attendance leaves a child in their group', () => {
    // A coach corrects a mis-tap. The group they built does not dissolve.
    const stored = [entry({ present: true, includedInGroups: true })]
    const draft = toggleAttendance(draftFromEntries(stored), 'p1')
    expect(draft.included.p1).toBe(true)
    expect(upserts(draft, stored)[0]).toEqual({
      session_id: SESSION,
      player_id: 'p1',
      club_id: CLUB,
      present: false,
    })
  })

  it('taking a child out of a group leaves their attendance recorded', () => {
    const stored = [entry({ present: true, includedInGroups: true })]
    const draft = toggleIncluded(draftFromEntries(stored), 'p1')
    expect(draft.attendance.p1).toBe(true)
    expect(upserts(draft, stored)[0]).toEqual({
      session_id: SESSION,
      player_id: 'p1',
      club_id: CLUB,
      included_in_groups: false,
    })
  })

  it('stores all four combinations', () => {
    for (const present of [false, true]) {
      for (const includedInGroups of [false, true]) {
        const draft = draftFromEntries([entry({ present, includedInGroups })])
        expect(draft.attendance.p1).toBe(present)
        expect(draft.included.p1).toBe(includedInGroups)
      }
    }
  })

  it('sends both columns when the coach genuinely changed both', () => {
    const stored = [entry({ present: false, includedInGroups: false })]
    const draft = toggleAttendance(toggleIncluded(draftFromEntries(stored), 'p1'), 'p1')
    expect(upserts(draft, stored)[0]).toEqual({
      session_id: SESSION,
      player_id: 'p1',
      club_id: CLUB,
      present: true,
      included_in_groups: true,
    })
  })
})

// REQUIREMENTS 7 and 8. Spond is context and nothing else.
describe('the Spond reply sets neither of them', () => {
  const going = row({ response: 'accepted' })
  const notGoing = row({ playerId: 'p2', displayName: 'Bravo Synthetic', response: 'declined' })

  it('Going does not mark attendance or group inclusion', () => {
    // The rows carry a reply; the draft is built from the stored entries,
    // which is the only place either fact can come from.
    const draft = draftFromEntries([entry({ playerId: going.playerId })])
    expect(draft.attendance[going.playerId]).toBe(false)
    expect(draft.included[going.playerId]).toBe(false)
    expect(upserts(draft, [entry({ playerId: going.playerId })])).toEqual([])
  })

  it('Not going does not prevent recording attendance', () => {
    // They turned up anyway. Nothing about a declined reply may stand in
    // the way of the coach recording that.
    const stored = [entry({ playerId: notGoing.playerId })]
    const draft = toggleAttendance(draftFromEntries(stored), notGoing.playerId)
    expect(draft.attendance[notGoing.playerId]).toBe(true)
    expect(upserts(draft, stored)[0].present).toBe(true)
  })

  it('Not going does not prevent putting them in a group', () => {
    const stored = [entry({ playerId: notGoing.playerId })]
    const draft = toggleIncluded(draftFromEntries(stored), notGoing.playerId)
    expect(upserts(draft, stored)[0].included_in_groups).toBe(true)
  })

  it('never puts a Spond reply anywhere near the write payload', () => {
    const stored = [entry({ present: true, includedInGroups: true })]
    const rows = upserts(toggleIncluded(draftFromEntries(stored), 'p1'), stored)
    for (const key of Object.keys(rows[0])) {
      expect(key).not.toMatch(/spond|response|rsvp/i)
    }
  })
})

// REQUIREMENT 11. Field level write protection, both ways.
// THE CONCURRENCY CASE THE OTHER BLOCK CANNOT SEE.
//
// Every test below passes a DIFFERENT array as the draft's seed and as the
// delta's baseline, because that is what actually happens: the draft is
// frozen at the coach's first tap and the stored entries behind it keep
// refetching (TanStack Query refetches on window focus, which is a phone
// unlocking on a touchline). Holding the baseline still, as the block
// above does, asserts the guarantee in the one configuration where it is
// trivially true.
describe('two coaches editing different facts, with the baseline moving underneath', () => {
  const atLoad = [entry({ present: false, includedInGroups: false, bibColourOverride: null })]

  it('a group save does not overwrite an attendance mark made meanwhile', () => {
    // Coach A taps the row. Coach B presses Here. A saves.
    const draftA = toggleIncluded(draftFromEntries(atLoad), 'p1')
    const afterB = [entry({ present: true, includedInGroups: false })]
    const row = upserts(draftA, afterB)[0]
    expect(row.included_in_groups).toBe(true)
    expect(row).not.toHaveProperty('present')
  })

  it('an attendance save does not overwrite a group tick made meanwhile', () => {
    const draftA = toggleAttendance(draftFromEntries(atLoad), 'p1')
    const afterB = [entry({ present: false, includedInGroups: true })]
    const row = upserts(draftA, afterB)[0]
    expect(row.present).toBe(true)
    expect(row).not.toHaveProperty('included_in_groups')
  })

  it('a bib save overwrites neither', () => {
    const draftA = setDraftBib(draftFromEntries(atLoad), 'p1', 'yellow')
    const afterB = [entry({ present: true, includedInGroups: true })]
    const row = upserts(draftA, afterB)[0]
    expect(row).toEqual({ session_id: SESSION, player_id: 'p1', club_id: CLUB, bib_colour_override: 'yellow' })
  })

  it('writes nothing at all when this coach changed nothing and another coach changed everything', () => {
    const untouched = draftFromEntries(atLoad)
    const afterB = [entry({ present: true, includedInGroups: true, bibColourOverride: 'red' })]
    expect(upserts(untouched, afterB)).toEqual([])
    expect(draftIsDirty(untouched, afterB)).toBe(false)
  })

  it('still sends a touched field whose stored value moved, because that is the coach s own write', () => {
    // The other half. Touch gating must not become "never write".
    const draftA = toggleIncluded(draftFromEntries(atLoad), 'p1')
    const afterB = [entry({ present: true, includedInGroups: false })]
    expect(upserts(draftA, afterB)[0].included_in_groups).toBe(true)
  })

  it('sends nothing for a field the coach toggled and toggled back', () => {
    const there = toggleIncluded(draftFromEntries(atLoad), 'p1')
    const andBack = toggleIncluded(there, 'p1')
    expect(upserts(andBack, atLoad)).toEqual([])
  })
})

describe('two coaches editing different facts about one child', () => {
  const stored = [entry({ present: true, includedInGroups: true, bibColourOverride: 'blue' })]

  it('a group change carries no attendance value to overwrite with', () => {
    // Coach A unticks the group while coach B is marking attendance. A's
    // payload names one column, so B's write survives it.
    const rows = upserts(toggleIncluded(draftFromEntries(stored), 'p1'), stored)
    expect(rows[0]).not.toHaveProperty('present')
    expect(rows[0]).not.toHaveProperty('bib_colour_override')
  })

  it('an attendance change carries no group or bib value to overwrite with', () => {
    const rows = upserts(toggleAttendance(draftFromEntries(stored), 'p1'), stored)
    expect(rows[0]).not.toHaveProperty('included_in_groups')
    expect(rows[0]).not.toHaveProperty('bib_colour_override')
  })

  it('a bib change carries neither', () => {
    const rows = upserts(setDraftBib(draftFromEntries(stored), 'p1', 'yellow'), stored)
    expect(rows[0]).toEqual({
      session_id: SESSION,
      player_id: 'p1',
      club_id: CLUB,
      bib_colour_override: 'yellow',
    })
  })

  it('writes nothing at all when nothing changed', () => {
    expect(upserts(draftFromEntries(stored), stored)).toEqual([])
    expect(draftIsDirty(draftFromEntries(stored), stored)).toBe(false)
  })

  it('sends an explicit null to clear a bib, rather than omitting it', () => {
    // Omitting would leave the stored colour alone, so "back to the team
    // default" would silently not happen.
    const rows = upserts(setDraftBib(draftFromEntries(stored), 'p1', null), stored)
    expect(rows[0]).toHaveProperty('bib_colour_override', null)
  })
})

// The data-loss trap the split creates if nobody looks for it.
describe('a guest who attended is never deleted by a group edit', () => {
  const guest = entry({ playerId: 'g1', source: 'manual', present: true, includedInGroups: true })

  it('keeps the row when the coach only takes them out of the groups', () => {
    // Before the split, "not included and no bib" meant the row said
    // nothing and could be removed. It now also has to say nothing about
    // ATTENDANCE, or unticking a group would erase the record that a child
    // was at the session.
    const draft = toggleIncluded(draftFromEntries([guest]), 'g1')
    expect(draftRemovals(draft, [guest])).toEqual([])
  })

  it('removes a guest only once nothing at all is recorded about them', () => {
    let draft = draftFromEntries([guest])
    draft = toggleIncluded(draft, 'g1')
    draft = toggleAttendance(draft, 'g1')
    expect(draftRemovals(draft, [guest])).toEqual(['g1'])
  })

  it('never removes a roster child, whatever is unticked', () => {
    const rosterChild = entry({ present: true, includedInGroups: true })
    let draft = draftFromEntries([rosterChild])
    draft = toggleIncluded(draft, 'p1')
    draft = toggleAttendance(draft, 'p1')
    expect(draftRemovals(draft, [rosterChild])).toEqual([])
  })
})

// The partial write has to survive postgrest-js, not just be correct in
// the payload builder. This is the seam the unit tests above cannot see.
describe('a mixed save is split so no column is proposed by accident', () => {
  const stored: RegisterEntry[] = [
    entry({ playerId: 'p1', present: true, includedInGroups: false, bibColourOverride: 'red' }),
    entry({ playerId: 'p2', present: true, includedInGroups: true, bibColourOverride: null }),
  ]

  // One coach changes p1's group; another changes p2's bib. Two shapes.
  const mixed = () => {
    let draft = draftFromEntries(stored)
    draft = toggleIncluded(draft, 'p1')
    draft = setDraftBib(draft, 'p2', 'yellow')
    return draft
  }

  it('produces rows of two different shapes, which is the whole point', () => {
    const rows = tonightUpsertRows(draftDelta(mixed(), stored, SESSION), CLUB)
    expect(rows).toHaveLength(2)
    const shapes = rows.map((r) => Object.keys(r).sort().join(','))
    expect(new Set(shapes).size).toBe(2)
  })

  it('groups them so every batch is internally uniform', () => {
    // postgrest-js sets `columns` to the UNION of the keys across a batch,
    // and does not send Prefer: missing=default, so a key an individual row
    // omits arrives as NULL. A uniform batch has no such key.
    const batches = tonightUpsertBatches(draftDelta(mixed(), stored, SESSION), CLUB)
    expect(batches).toHaveLength(2)
    for (const batch of batches) {
      const shapes = batch.map((r) => Object.keys(r).sort().join(','))
      expect(new Set(shapes).size).toBe(1)
    }
  })

  it('never lets a batch carry a key that would NULL a column it did not mean to write', () => {
    const batches = tonightUpsertBatches(draftDelta(mixed(), stored, SESSION), CLUB)
    const groupBatch = batches.find((b) => 'included_in_groups' in b[0])!
    const bibBatch = batches.find((b) => 'bib_colour_override' in b[0])!
    // The group change proposes nothing about attendance or bibs.
    expect(Object.keys(groupBatch[0]).sort()).toEqual(['club_id', 'included_in_groups', 'player_id', 'session_id'])
    // The bib change proposes nothing about attendance or groups.
    expect(Object.keys(bibBatch[0]).sort()).toEqual(['bib_colour_override', 'club_id', 'player_id', 'session_id'])
  })

  it('puts rows that write the same columns in the same batch', () => {
    // Two children whose groups both changed is one request, not two.
    let draft = draftFromEntries(stored)
    draft = toggleIncluded(draft, 'p1')
    draft = toggleIncluded(draft, 'p2')
    const batches = tonightUpsertBatches(draftDelta(draft, stored, SESSION), CLUB)
    expect(batches).toHaveLength(1)
    expect(batches[0]).toHaveLength(2)
  })

  it('sends nothing at all when nothing changed', () => {
    expect(tonightUpsertBatches(draftDelta(draftFromEntries(stored), stored, SESSION), CLUB)).toEqual([])
  })

  it('still refuses to build a row without a club, before any request is made', () => {
    expect(() => tonightUpsertBatches(draftDelta(mixed(), stored, SESSION), null)).toThrow(/signed in/i)
  })
})

describe('quick add asserts only what the coach pressed', () => {
  it('puts the child in tonight s groups and claims nothing about attendance', () => {
    const draft = quickAdd(draftFromEntries([]), 'g9')
    expect(draft.included.g9).toBe(true)
    expect(draft.attendance.g9).toBeFalsy()
  })

  it('shows up in the composed list before it is saved', () => {
    const draft = quickAdd(draftFromEntries([]), 'g9')
    const composed = draftEntries(draft, [], SESSION)
    expect(composed).toHaveLength(1)
    expect(composed[0]).toMatchObject({ playerId: 'g9', includedInGroups: true, present: false, source: 'manual' })
  })
})

describe('Select all is about groups, and only groups', () => {
  const rows = [row(), row({ playerId: 'p2', displayName: 'Bravo Synthetic' })]

  it('selects the visible children into groups without marking anybody present', () => {
    const draft = selectAll(draftFromEntries([]), rows)
    expect(draft.included).toEqual({ p1: true, p2: true })
    expect(draft.attendance).toEqual({})
  })

  it('leaves an existing attendance mark exactly as it was', () => {
    const stored = [entry({ present: true }), entry({ playerId: 'p2', present: false })]
    const draft = selectAll(draftFromEntries(stored), rows)
    expect(draft.attendance).toEqual({ p1: true, p2: false })
  })
})

describe('the groups on the grass are built from inclusion, not attendance', () => {
  const rows = [
    row({ playerId: 'p1', teamBib: 'red' }),
    row({ playerId: 'p2', displayName: 'Bravo Synthetic', teamBib: 'red' }),
  ]

  it('includes a child who is in a group but has not been marked present', () => {
    const draft = draftFromEntries([
      entry({ playerId: 'p1', includedInGroups: true, present: false }),
      entry({ playerId: 'p2', includedInGroups: false, present: true }),
    ])
    const groups = tonightGroups(rows, draft)
    expect(groups).toHaveLength(1)
    expect(groups[0].rows.map((r) => r.playerId)).toEqual(['p1'])
  })

  it('leaves a present child out of the groups until the coach includes them', () => {
    const draft = draftFromEntries([entry({ playerId: 'p1', present: true, includedInGroups: false })])
    expect(tonightGroups(rows, draft)).toEqual([])
  })
})

// REQUIREMENT 9. What the migration does to data that already exists.
describe('existing register rows keep their attendance meaning', () => {
  it('reads a stored present value as attendance and nothing else', () => {
    // The shape a row has immediately after 0047: present as it was,
    // included_in_groups false because the migration selects nobody.
    const migrated = entry({ present: true, includedInGroups: false })
    const draft = draftFromEntries([migrated])
    expect(draft.attendance.p1).toBe(true)
    expect(draft.included.p1).toBe(false)
  })

  it('does not rewrite it on the next save', () => {
    // Opening Tonight and saving something else must not touch the
    // attendance the migration preserved.
    const migrated = [entry({ present: true, includedInGroups: false })]
    const rows = upserts(setDraftBib(draftFromEntries(migrated), 'p1', 'green'), migrated)
    expect(rows[0]).not.toHaveProperty('present')
  })

  it('leaves a migrated row out of the groups until a coach includes it', () => {
    const migrated = entry({ present: true, includedInGroups: false })
    expect(tonightGroups([row()], draftFromEntries([migrated]))).toEqual([])
  })
})
