// =====================================================================
// A GUEST'S WHOLE LIFE, from quick add to removed and gone.
//
// THE DEFECT THIS FILE EXISTS FOR. Removing a stored guest never settled.
// The coach unticked them, saved, the row was deleted, the readback came
// back without it, and the very next diff proposed CREATING the same child
// again. Pressing Save again inserted them, the read after that made the
// row removable, and the save after that deleted them: recreate, delete,
// recreate, with the status line stuck on "Unsaved changes" throughout.
//
// THE CAUSE WAS ONE FLAG MEANING TWO THINGS. `draft.added` was seeded from
// every stored row whose source was 'manual', so it read as "is a guest".
// It was consumed as "was created in this draft and therefore has no stored
// row yet", which is what exempted it from the write payload's "nothing to
// write" guard. Those two meanings agree right up until the row is deleted,
// and then they point in opposite directions.
//
// SO THE MODEL NOW SEPARATES FOUR STATES, and the tests below are grouped
// by them:
//
//   STORED GUEST      a row in `entries` with source 'manual'. Their guest
//                     identity is on the row and is read from there.
//   NEW GUEST         quick added in this draft, no stored row. The only
//                     thing `draft.added` means.
//   REMOVAL PENDING   a stored guest whose effective fields record nothing.
//                     Derived by draftRemovals from the stored row.
//   GONE              no stored row, and not new either. Nothing to write,
//                     nothing to delete, nothing on screen.
//
// Everything here is keyed on player id. No rule in this module has ever
// matched on a name and the same name test below is what keeps it that way.
//
// The save harness models useSaveTonight faithfully rather than mocking it:
// the batched upsert writes ONLY the keys a row carries, the delete runs
// after it, and the readback is the authoritative result the screen then
// compares against. That is what makes "the next diff is empty" a claim
// about the real round trip and not about a hand written fixture.
// =====================================================================
import { describe, expect, it } from 'vitest'
import {
  draftAfterSave,
  draftDelta,
  draftEntries,
  draftFromEntries,
  draftIsDirty,
  draftRemovals,
  quickAdd,
  saveState,
  setDraftBib,
  toggleAttendance,
  toggleIncluded,
  tonightUpsertBatches,
  type TonightChange,
  type TonightDraft,
} from './tonight'
import type { RegisterEntry } from './register'

const SESSION = 's1'
const CLUB = 'club-1'

const entry = (playerId: string, over: Partial<RegisterEntry> = {}): RegisterEntry => ({
  sessionId: SESSION,
  playerId,
  present: false,
  includedInGroups: true,
  bibColourOverride: null,
  source: 'manual',
  ...over,
})

const rosterEntry = (playerId: string, over: Partial<RegisterEntry> = {}) =>
  entry(playerId, { source: 'roster', ...over })

// ---- The round trip, modelled on useSaveTonight ----------------------

interface SaveResult {
  // What came back from the readback: what the database now holds.
  persisted: RegisterEntry[]
  // Every row proposed to the database, in batches, so a test can count
  // inserts rather than infer them.
  upserted: TonightChange[]
  deleted: string[]
}

// One save: the batched upsert, then the delete, then the readback.
//
// The upsert applies ONLY the keys each row carries, which is the whole
// point of tonightUpsertBatches: an omitted key leaves the stored value
// alone. Modelling that rather than replacing the row wholesale is what
// lets the concurrency tests below mean anything.
function runSave(stored: RegisterEntry[], draft: TonightDraft): SaveResult {
  const changes = draftDelta(draft, stored, SESSION)
  const removals = draftRemovals(draft, stored)
  const rows = new Map(stored.map((e) => [e.playerId, { ...e }]))
  for (const batch of tonightUpsertBatches(changes, CLUB)) {
    for (const row of batch) {
      const existing = rows.get(row.player_id)
      const next: RegisterEntry = existing
        ? { ...existing }
        : {
            sessionId: row.session_id,
            playerId: row.player_id,
            present: false,
            includedInGroups: false,
            bibColourOverride: null,
            source: 'roster',
          }
      if ('present' in row) next.present = row.present as boolean
      if ('included_in_groups' in row) next.includedInGroups = row.included_in_groups as boolean
      if ('bib_colour_override' in row) next.bibColourOverride = row.bib_colour_override as string | null
      if ('source' in row) next.source = row.source as 'roster' | 'manual'
      rows.set(row.player_id, next)
    }
  }
  for (const id of removals) rows.delete(id)
  return { persisted: [...rows.values()], upserted: changes, deleted: removals }
}

// The screen: what is stored, and the coach's draft over it. `null` means
// the coach has touched nothing, which is exactly what the container holds.
interface Screen {
  stored: RegisterEntry[]
  draft: TonightDraft | null
}

const live = (s: Screen): TonightDraft => s.draft ?? draftFromEntries(s.stored)
const status = (s: Screen, saving = false, failed = false) =>
  saveState(draftIsDirty(live(s), s.stored), saving, failed)

// A save that succeeds: the readback becomes what is stored and the draft
// is settled against it, exactly as the container's onSuccess does.
function save(s: Screen): { screen: Screen; result: SaveResult } {
  const result = runSave(s.stored, live(s))
  return {
    screen: { stored: result.persisted, draft: draftAfterSave(live(s), result.persisted) },
    result,
  }
}

// A refetch landing: the stored rows are replaced, the draft is untouched.
const refetch = (s: Screen, rows: RegisterEntry[]): Screen => ({ ...s, stored: rows })

const listed = (s: Screen) => draftEntries(live(s), s.stored, SESSION).map((e) => e.playerId)

// ---- 1. The reported defect ------------------------------------------

describe('a stored guest the coach removes', () => {
  const stored = [entry('zed'), rosterEntry('anna')]
  const removed = (): Screen => ({ stored, draft: toggleIncluded(draftFromEntries(stored), 'zed') })

  it('is deleted exactly once and never proposed for creation', () => {
    const { result } = save(removed())
    expect(result.deleted).toEqual(['zed'])
    expect(result.upserted.map((c) => c.playerId)).not.toContain('zed')
    expect(result.persisted.map((e) => e.playerId)).toEqual(['anna'])
  })

  it('computes NO mutation on the save after it, which is the whole bug', () => {
    // THE PROOF. Before the fix this delta held one row: player zed,
    // isNew true, every field flagged as changed, ready to insert the
    // child the delete had just removed.
    const { screen } = save(removed())
    expect(draftDelta(live(screen), screen.stored, SESSION)).toEqual([])
    expect(draftRemovals(live(screen), screen.stored)).toEqual([])
  })

  it('settles to Saved and stays there over repeated renders', () => {
    const { screen } = save(removed())
    expect(status(screen)).toBe('saved')
    // The draft is cleared, so every later render rebuilds from the
    // readback and reaches the same answer rather than drifting.
    expect(screen.draft).toBeNull()
    expect(status({ ...screen })).toBe('saved')
  })

  it('leaves the guest gone from the list', () => {
    const { screen } = save(removed())
    expect(listed(screen)).not.toContain('zed')
    expect(listed(screen)).toContain('anna')
  })

  it('runs the whole loop three times without a single further write', () => {
    // The oscillation was only visible over repeated saves, so this drives
    // the round trip until it would have shown: save, settle, save again.
    let screen = save(removed()).screen
    for (let i = 0; i < 3; i++) {
      const next = save(screen)
      expect(next.result.upserted).toEqual([])
      expect(next.result.deleted).toEqual([])
      expect(next.result.persisted.map((e) => e.playerId)).toEqual(['anna'])
      screen = next.screen
      expect(status(screen)).toBe('saved')
    }
  })
})

// ---- 2. A stale read arriving after the delete ------------------------

describe('a stale read landing after the guest was deleted', () => {
  const stored = [entry('zed'), rosterEntry('anna')]
  const stale = stored

  it('never proposes creating the guest again', () => {
    // The read is behind, not authoritative. Whatever it shows, the screen
    // must not write: the guest's row is either already gone, in which case
    // there is nothing to do, or still there, in which case the pending
    // removal deletes it. Neither branch inserts.
    const removed: Screen = { stored, draft: toggleIncluded(draftFromEntries(stored), 'zed') }
    const settled = save(removed).screen
    const behind = refetch(settled, stale)
    const next = runSave(behind.stored, live(behind))
    expect(next.upserted.map((c) => c.playerId)).not.toContain('zed')
  })

  it('re-deletes rather than recreates while the removal is still the coach s intent', () => {
    // The draft survives this save because the coach ticked another child
    // while the write was in flight, so their removal is still live. A
    // stale read putting the row back must resolve as "delete it again",
    // which is idempotent, never as "create it", which is the loop.
    const removed: Screen = { stored, draft: toggleIncluded(draftFromEntries(stored), 'zed') }
    const result = runSave(stored, live(removed))
    const inFlightEdit = toggleIncluded(live(removed), 'anna')
    const kept = draftAfterSave(inFlightEdit, result.persisted)
    expect(kept).not.toBeNull()

    const behind: Screen = { stored: stale, draft: kept }
    const next = runSave(behind.stored, live(behind))
    expect(next.deleted).toEqual(['zed'])
    expect(next.upserted.map((c) => c.playerId)).not.toContain('zed')
    expect(next.persisted.map((e) => e.playerId)).not.toContain('zed')
  })

  it('shows what the read says but writes nothing once the draft has settled', () => {
    // A save that fully succeeded clears the draft, so there is no local
    // intent left to be authoritative and the screen simply renders the
    // rows it was handed. That is the honest behaviour and it is safe: the
    // stale row produces no mutation, and the invalidate behind it brings
    // the real answer. What must never happen is a WRITE off a stale read.
    const removed: Screen = { stored, draft: toggleIncluded(draftFromEntries(stored), 'zed') }
    const settled = save(removed).screen
    expect(settled.draft).toBeNull()
    const behind = refetch(settled, stale)
    const next = runSave(behind.stored, live(behind))
    expect(next.upserted).toEqual([])
    expect(next.deleted).toEqual([])
    expect(status(behind)).toBe('saved')
  })

  it('settles once the read catches up', () => {
    const removed: Screen = { stored, draft: toggleIncluded(draftFromEntries(stored), 'zed') }
    const settled = save(removed).screen
    const caughtUp = refetch(settled, [rosterEntry('anna')])
    expect(status(caughtUp)).toBe('saved')
    expect(listed(caughtUp)).not.toContain('zed')
  })
})

// ---- 3. The delete failing -------------------------------------------

describe('a delete the database refuses', () => {
  const stored = [entry('zed')]

  it('keeps the guest recoverable and does not claim Saved', () => {
    // A failed mutation never reaches onSuccess, so the draft is not
    // settled and the stored rows are unchanged. The coach still sees the
    // guest, still holds the removal, and the status says so.
    const failedScreen: Screen = { stored, draft: toggleIncluded(draftFromEntries(stored), 'zed') }
    expect(status(failedScreen, false, true)).toBe('failed')
    expect(status(failedScreen)).not.toBe('saved')
    expect(listed(failedScreen)).toContain('zed')
    expect(draftRemovals(live(failedScreen), failedScreen.stored)).toEqual(['zed'])
  })

  it('removes the guest on the retry, still without an insert', () => {
    const failedScreen: Screen = { stored, draft: toggleIncluded(draftFromEntries(stored), 'zed') }
    const { screen, result } = save(failedScreen)
    expect(result.deleted).toEqual(['zed'])
    expect(result.upserted).toEqual([])
    expect(status(screen)).toBe('saved')
  })

  it('keeps the arrangement that did land when only the delete failed', () => {
    // useSaveTonight upserts before it deletes, so a delete that fails
    // leaves the upsert written. The retry must send the delete and NOT
    // rewrite the field that already landed.
    const both = [entry('zed'), rosterEntry('anna')]
    const draft = setDraftBib(toggleIncluded(draftFromEntries(both), 'zed'), 'anna', 'blue')
    // The upsert landed; the delete did not; the refetch shows both.
    const afterPartial = [entry('zed'), rosterEntry('anna', { bibColourOverride: 'blue' })]
    const retry: Screen = { stored: afterPartial, draft }
    const next = runSave(retry.stored, live(retry))
    expect(next.deleted).toEqual(['zed'])
    expect(next.upserted).toEqual([])
    expect(next.persisted).toEqual([rosterEntry('anna', { bibColourOverride: 'blue' })])
  })
})

// ---- 4. A guest added and removed before any save ---------------------

describe('a new guest the coach adds and takes off again before saving', () => {
  const added = () => quickAdd(draftFromEntries([]), 'zed')
  const cancelled = () => toggleIncluded(added(), 'zed')

  it('writes nothing at all: no insert, no delete', () => {
    // The old model INSERTED a row saying this child is not here, not in a
    // group and has no bib, purely so the row would stay on screen. That
    // row was removable the moment it existed, so the next save deleted it.
    const result = runSave([], cancelled())
    expect(result.upserted).toEqual([])
    expect(result.deleted).toEqual([])
    expect(result.persisted).toEqual([])
  })

  it('reports nothing to save, because the two gestures cancel', () => {
    expect(status({ stored: [], draft: cancelled() })).toBe('saved')
  })

  it('still keeps their row on screen, so it is not snatched from under a thumb', () => {
    // The reason the exemption existed. It is met by the composed list
    // rather than by the write payload, which is the actual fix.
    const screen: Screen = { stored: [], draft: cancelled() }
    expect(listed(screen)).toContain('zed')
    const row = draftEntries(live(screen), [], SESSION).find((e) => e.playerId === 'zed')
    expect(row).toMatchObject({ includedInGroups: false, present: false, source: 'manual' })
  })

  it('writes them the moment the coach ticks them back on', () => {
    const back = toggleIncluded(cancelled(), 'zed')
    const result = runSave([], back)
    expect(result.upserted).toHaveLength(1)
    expect(result.upserted[0]).toMatchObject({ playerId: 'zed', isNew: true, source: 'manual' })
  })
})

// ---- 5. Added, saved, then removed ------------------------------------

describe('a guest saved and later removed', () => {
  it('is one insert then one delete, and never a loop', () => {
    let screen: Screen = { stored: [], draft: quickAdd(draftFromEntries([]), 'zed') }

    const first = save(screen)
    expect(first.result.upserted).toHaveLength(1)
    expect(first.result.upserted[0]).toMatchObject({ playerId: 'zed', isNew: true, source: 'manual' })
    expect(first.result.deleted).toEqual([])
    screen = first.screen
    expect(status(screen)).toBe('saved')
    expect(screen.stored).toEqual([entry('zed', { present: false, includedInGroups: true })])

    screen = { ...screen, draft: toggleIncluded(live(screen), 'zed') }
    const second = save(screen)
    expect(second.result.deleted).toEqual(['zed'])
    expect(second.result.upserted).toEqual([])
    screen = second.screen
    expect(status(screen)).toBe('saved')

    const third = save(screen)
    expect(third.result.upserted).toEqual([])
    expect(third.result.deleted).toEqual([])
  })

  it('ages the guest out of `added` once a save has passed over them', () => {
    // THE THIRD HALF OF THE FIX, and the only way to observe it is a draft
    // that SURVIVES its save. A save that settles cleanly clears the draft
    // and takes the flag with it, so the flag only ever matters when the
    // coach edited something while the write was in flight.
    const stored = [rosterEntry('anna', { includedInGroups: false })]
    const added = quickAdd(draftFromEntries(stored), 'zed')
    const result = runSave(stored, added)
    // The coach ticks anna while the insert is in flight, so the draft is
    // kept rather than cleared.
    const inFlight = toggleIncluded(added, 'anna')
    const kept = draftAfterSave(inFlight, result.persisted)
    expect(kept).not.toBeNull()
    expect(kept?.added.zed).toBeUndefined()
  })

  it('does not let a kept flag recreate the guest after their delete', () => {
    // What the ageing is FOR. Without it the guest stays "new in this
    // draft" for the life of the draft, so once their row is deleted the
    // very next diff proposes creating them: the reported loop, entered
    // from the other end.
    const stored = [rosterEntry('anna', { includedInGroups: false })]
    const added = quickAdd(draftFromEntries(stored), 'zed')
    const inserted = runSave(stored, added)
    const kept = draftAfterSave(toggleIncluded(added, 'anna'), inserted.persisted) as TonightDraft

    // Now take the guest off again and save.
    const removing = toggleIncluded(kept, 'zed')
    const deleted = runSave(inserted.persisted, removing)
    expect(deleted.deleted).toEqual(['zed'])
    expect(deleted.persisted.map((e) => e.playerId)).not.toContain('zed')

    // The diff after the delete must be empty, not an insert.
    const settled = draftAfterSave(removing, deleted.persisted)
    expect(draftDelta(settled ?? removing, deleted.persisted, SESSION)).toEqual([])
    expect(runSave(deleted.persisted, settled ?? removing).upserted).toEqual([])
  })

  it('keeps a guest new when the readback did not take them, so Saved is not claimed', () => {
    // The one guest that stays new. If the row the save meant to insert is
    // absent from the readback, the coach is still owed it: it stays in the
    // delta, stays a guest rather than turning into a squad member, and the
    // screen stays dirty.
    const draft = quickAdd(draftFromEntries([]), 'zed')
    const settled = draftAfterSave(draft, [])
    expect(settled?.added.zed).toBe(true)
    expect(draftIsDirty(settled as TonightDraft, [])).toBe(true)
    expect(draftDelta(settled as TonightDraft, [], SESSION)[0]).toMatchObject({ source: 'manual' })
  })
})

// ---- 6. Identity is an id, never a name -------------------------------

describe('two guests sharing a name', () => {
  // Same display name, different children. Nothing in the model reads a
  // name, and this is what holds it there.
  const stored = [entry('zed-1'), entry('zed-2')]

  it('removes only the one the coach unticked', () => {
    const draft = toggleIncluded(draftFromEntries(stored), 'zed-1')
    const result = runSave(stored, draft)
    expect(result.deleted).toEqual(['zed-1'])
    expect(result.persisted.map((e) => e.playerId)).toEqual(['zed-2'])
  })

  it('leaves the other one untouched and clean', () => {
    const draft = toggleIncluded(draftFromEntries(stored), 'zed-1')
    const { screen } = save({ stored, draft })
    expect(screen.stored).toEqual([entry('zed-2')])
    expect(status(screen)).toBe('saved')
  })

  it('keeps them apart when both are new in the same draft', () => {
    const draft = toggleIncluded(quickAdd(quickAdd(draftFromEntries([]), 'zed-1'), 'zed-2'), 'zed-1')
    const result = runSave([], draft)
    expect(result.upserted.map((c) => c.playerId)).toEqual(['zed-2'])
  })
})

// ---- 7. A removal beside an unrelated edit ----------------------------

describe('removing a guest while editing somebody else', () => {
  const stored = [
    entry('zed'),
    rosterEntry('anna', { includedInGroups: false }),
    rosterEntry('ben', { includedInGroups: true, present: true }),
  ]

  it('persists both, and neither erases the other', () => {
    let draft = toggleIncluded(draftFromEntries(stored), 'zed')
    draft = toggleIncluded(draft, 'anna')
    draft = setDraftBib(draft, 'anna', 'green')
    const { screen, result } = save({ stored, draft })
    expect(result.deleted).toEqual(['zed'])
    expect(screen.stored).toEqual([
      rosterEntry('anna', { includedInGroups: true, bibColourOverride: 'green' }),
      rosterEntry('ben', { includedInGroups: true, present: true }),
    ])
    expect(status(screen)).toBe('saved')
  })

  it('leaves the untouched child exactly as stored', () => {
    const draft = toggleIncluded(draftFromEntries(stored), 'zed')
    const { screen } = save({ stored, draft })
    expect(screen.stored.find((e) => e.playerId === 'ben')).toEqual(
      rosterEntry('ben', { includedInGroups: true, present: true }),
    )
  })

  it('does not disturb another coach s concurrent edit to a field it never touched', () => {
    // The per field protection from #172, exercised through a removal. This
    // coach only unticked the guest; while their draft was frozen another
    // coach marked ben present and took anna out. The save must carry
    // neither of those fields.
    const draft = toggleIncluded(draftFromEntries(stored), 'zed')
    const moved = [
      entry('zed'),
      rosterEntry('anna', { includedInGroups: false, present: true }),
      rosterEntry('ben', { includedInGroups: false, present: true }),
    ]
    const result = runSave(moved, draft)
    expect(result.deleted).toEqual(['zed'])
    expect(result.upserted).toEqual([])
    expect(result.persisted).toEqual([
      rosterEntry('anna', { includedInGroups: false, present: true }),
      rosterEntry('ben', { includedInGroups: false, present: true }),
    ])
  })
})

// ---- 8. Pressing Save twice -------------------------------------------

describe('a coach pressing Save twice', () => {
  const stored = [entry('zed'), rosterEntry('anna')]

  it('creates nothing on the second press', () => {
    const draft = toggleIncluded(draftFromEntries(stored), 'zed')
    const first = save({ stored, draft })
    const second = save(first.screen)
    expect(second.result.upserted).toEqual([])
    expect(second.result.deleted).toEqual([])
    expect(second.result.persisted).toEqual([rosterEntry('anna')])
  })

  it('is idempotent when the same payload is retried against the same stored rows', () => {
    // A double click can fire two mutations carrying the SAME payload
    // before either readback lands. Both must reach the same database.
    const draft = toggleIncluded(draftFromEntries(stored), 'zed')
    const once = runSave(stored, draft)
    const twice = runSave(once.persisted, draft)
    expect(twice.persisted).toEqual(once.persisted)
    expect(twice.upserted).toEqual([])
  })

  it('is idempotent for the insert half too', () => {
    const draft = quickAdd(draftFromEntries([]), 'zed')
    const once = runSave([], draft)
    const twice = runSave(once.persisted, draft)
    expect(twice.persisted).toEqual(once.persisted)
    expect(twice.persisted).toHaveLength(1)
  })
})

// ---- 9. The guest already gone ----------------------------------------

describe('a refetch where the guest has already gone', () => {
  it('clears the removal intent and settles', () => {
    // Another coach removed them first. The intent has nothing left to act
    // on, so it resolves to nothing rather than to a re-creation.
    const stored = [entry('zed'), rosterEntry('anna')]
    const draft = toggleIncluded(draftFromEntries(stored), 'zed')
    const screen = refetch({ stored, draft }, [rosterEntry('anna')])
    expect(draftRemovals(live(screen), screen.stored)).toEqual([])
    expect(draftDelta(live(screen), screen.stored, SESSION)).toEqual([])
    expect(status(screen)).toBe('saved')
  })

  it('holds even when the coach had also marked the guest present and clear again', () => {
    const stored = [entry('zed')]
    let draft = toggleAttendance(draftFromEntries(stored), 'zed')
    draft = toggleAttendance(draft, 'zed')
    draft = toggleIncluded(draft, 'zed')
    const screen = refetch({ stored, draft }, [])
    expect(draftDelta(live(screen), screen.stored, SESSION)).toEqual([])
    expect(status(screen)).toBe('saved')
  })
})

// ---- 10. Registered players are not guests ----------------------------

describe('the guest rules never reach a registered player', () => {
  const stored = [rosterEntry('anna'), rosterEntry('ben', { present: true })]

  it('never deletes a roster row, however empty it is', () => {
    let draft = toggleIncluded(draftFromEntries(stored), 'anna')
    draft = toggleAttendance(draft, 'ben')
    draft = toggleIncluded(draft, 'ben')
    const result = runSave(stored, draft)
    expect(result.deleted).toEqual([])
    expect(result.persisted).toHaveLength(2)
  })

  it('leaves attendance, inclusion and bib behaving exactly as before', () => {
    let draft = toggleAttendance(draftFromEntries(stored), 'anna')
    draft = setDraftBib(draft, 'anna', 'blue')
    const { screen } = save({ stored, draft })
    expect(screen.stored.find((e) => e.playerId === 'anna')).toEqual(
      rosterEntry('anna', { present: true, bibColourOverride: 'blue' }),
    )
    expect(status(screen)).toBe('saved')
  })

  it('gives an untouched roster child no row in the write payload', () => {
    const draft = draftFromEntries(stored)
    expect(draftDelta(draft, stored, SESSION)).toEqual([])
    expect(draftRemovals(draft, stored)).toEqual([])
  })

  it('creates a roster row rather than a guest row for a covered child', () => {
    const draft = toggleIncluded(draftFromEntries([]), 'anna')
    expect(draftDelta(draft, [], SESSION)[0]).toMatchObject({ source: 'roster', isNew: true })
  })
})

// ---- The state model itself, pinned ----------------------------------

describe('what `added` is allowed to mean', () => {
  it('is empty for a draft opened over stored rows, guests included', () => {
    // THE ROOT CAUSE, stated as the thing that must not come back. Seeding
    // this from source === 'manual' is what made a deleted guest look like
    // a child this draft had just created.
    const stored = [entry('zed'), rosterEntry('anna')]
    expect(draftFromEntries(stored).added).toEqual({})
  })

  it('holds a guest this draft created, and only until a save passes over them', () => {
    const draft = quickAdd(draftFromEntries([]), 'zed')
    expect(draft.added).toEqual({ zed: true })
    const stored = [entry('zed', { includedInGroups: true })]
    expect(draftAfterSave(draft, stored)).toBeNull()
  })

  it('still names a stored guest a guest, from the stored row', () => {
    // Dropping the seed must not lose guest identity: it moves to where it
    // was always authoritative rather than disappearing.
    const stored = [entry('zed')]
    expect(draftEntries(draftFromEntries(stored), stored, SESSION)).toEqual(stored)
    expect(draftRemovals(toggleIncluded(draftFromEntries(stored), 'zed'), stored)).toEqual(['zed'])
  })

  it('cannot recreate a deleted guest even if something marks them added again', () => {
    // DEFENCE IN DEPTH, and the mutation test for the guard. Hand the model
    // a draft shaped exactly the way the defective one was, claiming a
    // player with no stored row is new while every field records nothing.
    // The write payload refuses it anyway, because a row that says nothing
    // is never asked for.
    const legacy: TonightDraft = {
      included: { zed: false },
      attendance: { zed: false },
      bibs: { zed: null },
      added: { zed: true },
      touched: { 'zed:included': true },
    }
    expect(draftDelta(legacy, [], SESSION)).toEqual([])
    expect(draftIsDirty(legacy, [])).toBe(false)
  })
})
