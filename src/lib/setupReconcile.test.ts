// =====================================================================
// COACH-4 at the seam: reconciliation preserves the coach's work.
//
// The one behaviour under test, stated as the brief states it: a saved
// arrangement plus fresh replies changes ONLY what genuinely changed. A
// departure empties one place and moves nobody. A newcomer takes one
// place and moves nobody. Everybody else keeps the assignment the coach
// already made, whoever made it, with no provenance to remember who did.
//
// The invariant block at the bottom is a tripwire in the house style: it
// reads source text, so it catches somebody typing the obvious thing and
// nothing more. The behavioural tests above it are the proof.
//
// Names in fixtures are invented. No real child or coach appears.
// =====================================================================
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { reconcileSetup, reconciliationNote } from './setupReconcile'
import {
  type TonightChange,
  type TonightDraft,
  type TonightRow,
  draftDelta,
  draftFromEntries,
  draftIncluded,
  draftBib,
  draftRemovals,
  tonightGroups,
} from './tonight'
import { BIB_NONE } from './bibs'
import type { RegisterEntry } from './register'
import type { RsvpStatus } from './spondRsvp'

let seq = 0
const row = (over: Partial<TonightRow> = {}): TonightRow => {
  seq += 1
  return {
    playerId: `p${seq}`,
    displayName: `Player ${seq}`,
    shirtNumber: null,
    teamId: 't1',
    teamName: 'One',
    teamBib: null,
    response: null,
    manual: false,
    ...over,
  }
}

const squad = (
  n: number,
  teamId: string,
  teamName: string,
  teamBib: string | null = null,
  response: RsvpStatus | null = null,
) => Array.from({ length: n }, () => row({ teamId, teamName, teamBib, response }))

const draftWith = (over: Partial<TonightDraft> = {}): TonightDraft => ({
  included: {},
  attendance: {},
  bibs: {},
  added: {},
  touched: {},
  ...over,
})

// A SAVED arrangement: included seeded, nothing touched, exactly as
// draftFromEntries seeds a screen from stored rows.
const includeAll = (rows: TonightRow[], bibs: Record<string, string | null> = {}) =>
  draftWith({ included: Object.fromEntries(rows.map((r) => [r.playerId, true])), bibs })

const entryFor = (r: TonightRow, included: boolean, bib: string | null = null, present = false): RegisterEntry => ({
  sessionId: 's1',
  playerId: r.playerId,
  present,
  includedInGroups: included,
  bibColourOverride: bib,
  source: r.manual ? 'manual' : 'roster',
})

// The readback a save produces, simulated from the delta the module's
// draft would send through the existing Save groups path.
function persisted(entries: RegisterEntry[], changes: TonightChange[], removals: string[]): RegisterEntry[] {
  const byId = new Map(entries.map((e) => [e.playerId, e]))
  for (const id of removals) byId.delete(id)
  for (const c of changes) {
    byId.set(c.playerId, {
      sessionId: c.sessionId,
      playerId: c.playerId,
      present: c.present,
      includedInGroups: c.includedInGroups,
      bibColourOverride: c.bibColourOverride,
      source: c.source,
    })
  }
  return [...byId.values()]
}

// Every field of every child the reconciliation claims to retain, read
// back through the canonical readers before and after.
function fieldsOf(draft: TonightDraft, rows: TonightRow[]) {
  return rows.map((r) => ({
    id: r.playerId,
    included: draftIncluded(draft, r.playerId),
    bib: draftBib(draft, r.playerId),
    present: draft.attendance[r.playerId] === true,
  }))
}

// ---------------------------------------------------------------------

describe('preservation', () => {
  it('unchanged attendance keeps the exact same assignments, as the same object', () => {
    const rows = [...squad(4, 'a', 'A', 'red', 'accepted'), ...squad(4, 'b', 'B', 'blue', 'accepted')]
    const draft = includeAll(rows)
    const rec = reconcileSetup(rows, draft)
    expect(rec.changed).toBe(false)
    expect(rec.departures).toEqual([])
    expect(rec.newcomers).toEqual([])
    expect(rec.retained.map((r) => r.playerId).sort()).toEqual(rows.map((r) => r.playerId).sort())
    // Identity, not equality: a screen handing this back to state must not
    // re-render, and nothing downstream can mistake it for an edit.
    expect(rec.draft).toBe(draft)
  })

  it('a newcomer is placed and no retained child moves', () => {
    const rows = [...squad(4, 'a', 'A', 'red', 'accepted'), ...squad(4, 'b', 'B', 'blue', 'accepted')]
    const arriving = row({ teamId: 'c', teamName: 'C', teamBib: null, response: 'accepted' })
    const draft = includeAll(rows)
    const before = fieldsOf(draft, rows)
    const rec = reconcileSetup([...rows, arriving], draft)
    expect(rec.newcomers.map((p) => p.row.playerId)).toEqual([arriving.playerId])
    expect(rec.departures).toEqual([])
    expect(fieldsOf(rec.draft, rows)).toEqual(before)
    expect(draftIncluded(rec.draft, arriving.playerId)).toBe(true)
    // The gestures stamped belong to the newcomer alone.
    for (const key of Object.keys(rec.draft.touched)) {
      expect(key.startsWith(`${arriving.playerId}:`)).toBe(true)
    }
  })

  it('a departure is removed and no retained child moves', () => {
    const leaving = row({ teamId: 'a', teamName: 'A', teamBib: 'red', response: 'declined' })
    const rows = [leaving, ...squad(3, 'a', 'A', 'red', 'accepted'), ...squad(4, 'b', 'B', 'blue', 'accepted')]
    const others = rows.filter((r) => r !== leaving)
    const draft = includeAll(rows)
    const before = fieldsOf(draft, others)
    const rec = reconcileSetup(rows, draft)
    expect(rec.departures.map((r) => r.playerId)).toEqual([leaving.playerId])
    expect(draftIncluded(rec.draft, leaving.playerId)).toBe(false)
    expect(fieldsOf(rec.draft, others)).toEqual(before)
    for (const key of Object.keys(rec.draft.touched)) {
      expect(key).toBe(`${leaving.playerId}:included`)
    }
  })

  it('preserves a manual-looking override and an inherited assignment alike, with no provenance', () => {
    // One child the coach moved to black by hand, one following their team
    // default. The reconciliation cannot tell them apart and must not
    // need to: both are saved assignments and both survive a departure and
    // a newcomer in the same pass.
    const moved = row({ teamId: 'a', teamName: 'A', teamBib: 'red', response: 'accepted' })
    const inheriting = row({ teamId: 'a', teamName: 'A', teamBib: 'red', response: 'accepted' })
    const leaving = row({ teamId: 'b', teamName: 'B', teamBib: 'blue', response: 'declined' })
    const arriving = row({ teamId: 'b', teamName: 'B', teamBib: 'blue', response: 'accepted' })
    const rows = [moved, inheriting, leaving, arriving]
    const draft = includeAll([moved, inheriting, leaving], { [moved.playerId]: 'black' })
    const rec = reconcileSetup(rows, draft)
    expect(rec.changed).toBe(true)
    expect(draftBib(rec.draft, moved.playerId)).toBe('black')
    expect(draftBib(rec.draft, inheriting.playerId)).toBeNull()
    expect(draftIncluded(rec.draft, moved.playerId)).toBe(true)
    expect(draftIncluded(rec.draft, inheriting.playerId)).toBe(true)
  })

  it('keeps a departed child\'s bib where the coach left it', () => {
    // Only inclusion moves. A child who un-declines later walks back into
    // the same colour, and clearing it would erase an assignment for no
    // operational gain.
    const leaving = row({ teamId: 'a', teamName: 'A', teamBib: 'red', response: 'declined' })
    const rows = [leaving, ...squad(3, 'a', 'A', 'red', 'accepted')]
    const draft = includeAll(rows, { [leaving.playerId]: 'green' })
    const rec = reconcileSetup(rows, draft)
    expect(draftBib(rec.draft, leaving.playerId)).toBe('green')
  })

  it('never consults the generator: a saved bib the plan disagrees with survives', () => {
    // Two teams both red. planSetup would hand one of them a different
    // colour; the coach instead moved one single child to yellow and saved
    // that. The reconciliation keeps the coach's answer for every retained
    // child, including the ones a fresh plan would move.
    const rows = [...squad(4, 'a', 'A', 'red', 'accepted'), ...squad(4, 'b', 'B', 'red', 'accepted')]
    const moved = rows[4]
    const arriving = row({ teamId: 'b', teamName: 'B', teamBib: 'red', response: 'accepted' })
    const draft = includeAll(rows, { [moved.playerId]: 'yellow' })
    const rec = reconcileSetup([...rows, arriving], draft)
    expect(draftBib(rec.draft, moved.playerId)).toBe('yellow')
    for (const r of rows.filter((x) => x !== moved)) {
      expect(draftBib(rec.draft, r.playerId)).toBeNull()
    }
  })
})

describe('missing data removes nobody', () => {
  it('a session with no reply context reconciles to nothing', () => {
    // No Spond, a failed sync and a read still in flight all reach this
    // module as rows carrying no response. None of them is a departure.
    const rows = squad(8, 'a', 'A', 'red')
    const draft = includeAll(rows)
    const rec = reconcileSetup(rows, draft)
    expect(rec.contextKnown).toBe(false)
    expect(rec.changed).toBe(false)
    expect(rec.departures).toEqual([])
    expect(rec.draft).toBe(draft)
  })

  it('partial coverage preserves every child lacking an external fact', () => {
    const linked = squad(3, 'a', 'A', 'red', 'accepted')
    const unlinked = squad(5, 'a', 'A', 'red', null)
    const rows = [...linked, ...unlinked]
    const rec = reconcileSetup(rows, includeAll(rows))
    expect(rec.changed).toBe(false)
    expect(rec.retained.map((r) => r.playerId).sort()).toEqual(rows.map((r) => r.playerId).sort())
  })

  it('an unlinked child is never read as declined, and never as arriving', () => {
    const included = row({ response: null })
    const outside = row({ response: null })
    const context = row({ response: 'accepted' })
    const rec = reconcileSetup([included, outside, context], includeAll([included, context]))
    expect(rec.departures).toEqual([])
    expect(rec.newcomers).toEqual([])
  })

  it('an unanswered or waiting reply is not a departure', () => {
    // The coach included them knowing the reply. Only Not going is the
    // authoritative fact that a child is no longer attending; silence and
    // a waiting list place are not.
    const noReply = row({ teamBib: 'red', response: 'unanswered' })
    const waiting = row({ teamBib: 'red', response: 'waiting' })
    const rows = [noReply, waiting, ...squad(2, 'a', 'A', 'red', 'accepted')]
    const rec = reconcileSetup(rows, includeAll(rows))
    expect(rec.departures).toEqual([])
    expect(rec.changed).toBe(false)
  })
})

describe('newcomers', () => {
  it('enters exactly once, even from a duplicated row', () => {
    const arriving = row({ teamId: 'b', teamName: 'B', response: 'accepted' })
    const rows = [...squad(3, 'a', 'A', 'red', 'accepted'), arriving, { ...arriving }]
    const rec = reconcileSetup(rows, includeAll(rows.slice(0, 3)))
    expect(rec.newcomers).toHaveLength(1)
  })

  it('joins the group their own resolution already lands in, whatever its size', () => {
    // Five in red, two in blue. The arriving child's team default is red,
    // so they join red at six rather than being re-bibbed into blue to
    // make the numbers prettier: team continuity beats symmetry, and no
    // override is written because inherit already answers.
    const rows = [...squad(5, 'a', 'A', 'red', 'accepted'), ...squad(2, 'b', 'B', 'blue', 'accepted')]
    const arriving = row({ teamId: 'a', teamName: 'A', teamBib: 'red', response: 'accepted' })
    const rec = reconcileSetup([...rows, arriving], includeAll(rows))
    expect(rec.newcomers[0].colour).toBe('red')
    expect(rec.newcomers[0].bib).toEqual({ target: null })
    expect(draftBib(rec.draft, arriving.playerId)).toBeNull()
  })

  it('a dormant override walks a returning child back into the colour the coach last gave them', () => {
    const returning = row({ teamId: 'a', teamName: 'A', teamBib: 'red', response: 'accepted' })
    const rows = [...squad(3, 'a', 'A', 'red', 'accepted'), ...squad(3, 'b', 'B', 'green', 'accepted')]
    const draft = includeAll(rows, { [returning.playerId]: 'green' })
    const rec = reconcileSetup([...rows, returning], draft)
    expect(rec.newcomers[0].colour).toBe('green')
  })

  it('otherwise takes the smallest existing group, deterministically', () => {
    // Red holds four, blue holds two. A child with no team colour goes to
    // blue with an ordinary session override; running the same input again
    // reads the same twice.
    const rows = [...squad(4, 'a', 'A', 'red', 'accepted'), ...squad(2, 'b', 'B', 'blue', 'accepted')]
    const arriving = row({ teamId: 'c', teamName: 'C', teamBib: null, response: 'accepted' })
    const rec = reconcileSetup([...rows, arriving], includeAll(rows))
    const again = reconcileSetup([...rows, arriving], includeAll(rows))
    expect(rec.newcomers[0].colour).toBe('blue')
    expect(rec.newcomers[0].bib).toEqual({ target: 'blue' })
    expect(again.newcomers.map((p) => [p.row.playerId, p.colour])).toEqual(
      rec.newcomers.map((p) => [p.row.playerId, p.colour]),
    )
  })

  it('several arrivals spread across the existing groups and move nobody', () => {
    const rows = [...squad(2, 'a', 'A', 'red', 'accepted'), ...squad(3, 'b', 'B', 'blue', 'accepted')]
    const arrivals = squad(3, 'c', 'C', null, 'accepted')
    const draft = includeAll(rows)
    const before = fieldsOf(draft, rows)
    const rec = reconcileSetup([...rows, ...arrivals], draft)
    expect(rec.newcomers).toHaveLength(3)
    expect(fieldsOf(rec.draft, rows)).toEqual(before)
    // Each placement counted in the next: 2/3 becomes 4/4, never 5/3.
    const groups = tonightGroups([...rows, ...arrivals], rec.draft)
    expect(groups.map((g) => [g.bib, g.count])).toEqual([
      ['red', 4],
      ['blue', 4],
    ])
  })

  it('opens no new colour: every placement lands in a group that already exists', () => {
    const rows = [...squad(6, 'a', 'A', 'red', 'accepted'), ...squad(6, 'b', 'B', 'blue', 'accepted')]
    const arrivals = squad(4, 'c', 'C', null, 'accepted')
    const rec = reconcileSetup([...rows, ...arrivals], includeAll(rows))
    for (const p of rec.newcomers) {
      expect(['red', 'blue']).toContain(p.colour)
    }
  })

  it('a club without bibs gets the newcomer with no bib gesture at all', () => {
    const rows = squad(6, 'a', 'A', null, 'accepted')
    const arriving = row({ teamId: 'a', teamName: 'A', teamBib: null, response: 'accepted' })
    const rec = reconcileSetup([...rows, arriving], includeAll(rows))
    expect(rec.newcomers[0]).toMatchObject({ colour: null, bib: null })
    expect(draftIncluded(rec.draft, arriving.playerId)).toBe(true)
    expect(`${arriving.playerId}:bib` in rec.draft.touched).toBe(false)
  })

  it('never produces the no-bib sentinel', () => {
    // A child whose dormant choice was no bib is being placed into a real
    // group, so the placement writes the group's colour, never 'none'.
    const rows = [...squad(3, 'a', 'A', 'red', 'accepted'), ...squad(3, 'b', 'B', 'blue', 'accepted')]
    const arriving = row({ teamId: 'a', teamName: 'A', teamBib: 'red', response: 'accepted' })
    const draft = includeAll(rows, { [arriving.playerId]: BIB_NONE })
    const rec = reconcileSetup([...rows, arriving], draft)
    for (const p of rec.newcomers) {
      expect(p.bib?.target).not.toBe(BIB_NONE)
    }
    expect(draftBib(rec.draft, arriving.playerId)).not.toBe(BIB_NONE)
  })

  it('a guest\'s reply is about their own team\'s event, so a guest never arrives or departs by it', () => {
    const guestIn = row({ manual: true, response: 'declined' })
    const guestOut = row({ manual: true, response: 'accepted' })
    const rows = [...squad(3, 'a', 'A', 'red', 'accepted'), guestIn, guestOut]
    const rec = reconcileSetup(rows, includeAll([...rows.slice(0, 3), guestIn]))
    expect(rec.departures).toEqual([])
    expect(rec.newcomers).toEqual([])
    expect(draftIncluded(rec.draft, guestIn.playerId)).toBe(true)
  })
})

describe('departures', () => {
  it('a departure empties one place and moves nobody, and the smaller group stands', () => {
    const leaving = row({ teamId: 'a', teamName: 'A', teamBib: 'red', response: 'declined' })
    const rows = [leaving, ...squad(3, 'a', 'A', 'red', 'accepted'), ...squad(4, 'b', 'B', 'blue', 'accepted')]
    const rec = reconcileSetup(rows, includeAll(rows))
    const groups = tonightGroups(rows, rec.draft)
    // Three against four is the honest answer. Nothing rebalances a night
    // to make the numbers symmetrical.
    expect(groups.map((g) => [g.bib, g.count])).toEqual([
      ['red', 3],
      ['blue', 4],
    ])
  })

  it('touches no register fact but inclusion, so a present mark survives the save', () => {
    // 0047 split attendance from inclusion precisely so an edit to one
    // cannot move the other. The delta a reconciled draft sends carries
    // included_in_groups for the departure and nothing else.
    const leaving = row({ teamId: 'a', teamName: 'A', teamBib: 'red', response: 'declined' })
    const staying = squad(3, 'a', 'A', 'red', 'accepted')
    const rows = [leaving, ...staying]
    const entries = [entryFor(leaving, true, null, true), ...staying.map((r) => entryFor(r, true))]
    const draft = draftFromEntries(entries)
    const rec = reconcileSetup(rows, draft)
    const delta = draftDelta(rec.draft, entries, 's1')
    expect(delta.map((c) => c.playerId)).toEqual([leaving.playerId])
    expect(delta[0]).toMatchObject({ includedChanged: true, presentChanged: false, bibChanged: false })
  })
})

describe('save and idempotence', () => {
  it('reconciling the same facts twice produces no second change', () => {
    const leaving = row({ teamBib: 'red', response: 'declined' })
    const arriving = row({ teamBib: 'red', response: 'accepted' })
    const rows = [leaving, ...squad(3, 'a', 'A', 'red', 'accepted'), arriving]
    const first = reconcileSetup(rows, includeAll([leaving, ...rows.slice(1, 4)]))
    expect(first.changed).toBe(true)
    const second = reconcileSetup(rows, first.draft)
    expect(second.changed).toBe(false)
    expect(second.draft).toBe(first.draft)
  })

  it('save, refresh and save again settles: the readback reconciles to nothing and writes nothing', () => {
    const leaving = row({ teamId: 'a', teamName: 'A', teamBib: 'red', response: 'declined' })
    const staying = squad(3, 'a', 'A', 'red', 'accepted')
    const arriving = row({ teamId: 'b', teamName: 'B', teamBib: null, response: 'accepted' })
    const rows = [leaving, ...staying, arriving]
    const entries = [entryFor(leaving, true), ...staying.map((r) => entryFor(r, true))]
    const rec = reconcileSetup(rows, draftFromEntries(entries))
    expect(rec.changed).toBe(true)
    const readback = persisted(entries, draftDelta(rec.draft, entries, 's1'), draftRemovals(rec.draft, entries))
    const reopened = draftFromEntries(readback)
    const again = reconcileSetup(rows, reopened)
    expect(again.changed).toBe(false)
    expect(draftDelta(again.draft, readback, 's1')).toEqual([])
    expect(draftRemovals(again.draft, readback)).toEqual([])
  })

  it('performs no write and does not mutate its inputs', () => {
    const rows = [...squad(3, 'a', 'A', 'red', 'accepted'), row({ response: 'accepted' })]
    const draft = includeAll(rows.slice(0, 3))
    const snapshot = JSON.parse(JSON.stringify(draft))
    const frozen = Object.freeze({ ...draft, included: Object.freeze({ ...draft.included }) })
    reconcileSetup(rows, frozen as TonightDraft)
    reconcileSetup(rows, draft)
    expect(draft).toEqual(snapshot)
  })
})

describe('the boundary with the suggestion', () => {
  it('an unarranged night reconciles to nothing, whatever the replies say', () => {
    // Nobody is included, so there is no arrangement to preserve and the
    // suggested setup owns the whole question.
    const rows = [...squad(4, 'a', 'A', 'red', 'accepted'), ...squad(2, 'b', 'B', 'blue', 'declined')]
    const draft = draftFromEntries([])
    const rec = reconcileSetup(rows, draft)
    expect(rec.arranged).toBe(false)
    expect(rec.changed).toBe(false)
    expect(rec.newcomers).toEqual([])
    expect(rec.departures).toEqual([])
    expect(rec.draft).toBe(draft)
    expect(reconciliationNote(rec)).toBe('')
  })
})

describe('the sentence', () => {
  const base = { arranged: true, contextKnown: true, retained: [], changed: true, draft: draftWith() }
  const placed = (n: number) =>
    squad(n, 'a', 'A', 'red', 'accepted').map((r) => ({ row: r, colour: 'red', bib: { target: null } }))

  it('names an arrival, a departure, and both, in counts', () => {
    expect(reconciliationNote({ ...base, departures: [], newcomers: placed(1) })).toBe(
      'Attendance updated: 1 added. Existing groups kept.',
    )
    expect(reconciliationNote({ ...base, departures: squad(1, 'a', 'A', 'red', 'declined'), newcomers: [] })).toBe(
      'Attendance updated: 1 removed. Existing groups kept.',
    )
    expect(
      reconciliationNote({ ...base, departures: squad(1, 'a', 'A', 'red', 'declined'), newcomers: placed(2) }),
    ).toBe('Attendance updated: 2 added, 1 removed. Existing groups kept.')
  })

  it('says no changes were needed only when a comparison actually ran', () => {
    expect(reconciliationNote({ ...base, changed: false, departures: [], newcomers: [] })).toBe(
      'No group changes needed.',
    )
    expect(
      reconciliationNote({ ...base, contextKnown: false, changed: false, departures: [], newcomers: [] }),
    ).toBe('')
  })

  it('has no reassigned arm, because no reachable result moves a retained child', () => {
    // Even under several departures and several arrivals at once, every
    // field of every retained child is identical before and after, so the
    // formatter has nothing to say about moves and a sentence it cannot
    // produce cannot mislead a coach.
    const kept = [...squad(4, 'a', 'A', 'red', 'accepted'), ...squad(3, 'b', 'B', 'blue', 'unanswered')]
    const leaving = squad(2, 'b', 'B', 'blue', 'declined')
    const arrivals = squad(3, 'c', 'C', null, 'accepted')
    const draft = includeAll([...kept, ...leaving], { [kept[0].playerId]: 'yellow' })
    const before = fieldsOf(draft, kept)
    const rec = reconcileSetup([...kept, ...leaving, ...arrivals], draft)
    expect(rec.departures).toHaveLength(2)
    expect(rec.newcomers).toHaveLength(3)
    expect(fieldsOf(rec.draft, kept)).toEqual(before)
    expect(reconciliationNote(rec)).toBe('Attendance updated: 3 added, 2 removed. Existing groups kept.')
    // The word may appear in the module's own commentary explaining why it
    // is absent; what must not exist is code that could say it.
    const body = readFileSync(join(import.meta.dirname, 'setupReconcile.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((l) => !l.trim().startsWith('//'))
      .join('\n')
    expect(body).not.toMatch(/reassigned/)
  })
})

// ---------------------------------------------------------------------
// The tripwire. Source text only: it catches the obvious typing, and the
// behavioural half above is the proof.
// ---------------------------------------------------------------------

const SRC = join(import.meta.dirname, '..')
const read = (f: string) => readFileSync(join(SRC, f), 'utf8')
const code = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n')
const MODULE = 'lib/setupReconcile.ts'

describe('the reconciliation stays pure and consults nothing it must not', () => {
  it('imports no React, no client, no query layer and no mutation', () => {
    const src = read(MODULE)
    expect(src).not.toMatch(/from '[^']*\breact\b/)
    expect(src).not.toMatch(/from '\.\/supabase'|from '\.\/queries'/)
    expect(code(src)).not.toMatch(/\.mutate\(|\.from\(|\.upsert\(|\.insert\(|\.update\(|\.delete\(/)
  })

  it('never consults the generator', () => {
    // Rerunning planSetup over an arranged night is the destruction this
    // slice exists to stop, so the module must not even be able to reach
    // it by name.
    expect(code(read(MODULE))).not.toMatch(/\bplanSetup\b|\bapplySetup\b|\brecommendSetup\b/)
  })

  it('classifies replies through the one predicate, and reads the draft through the readers', () => {
    const src = code(read(MODULE))
    expect(src).toMatch(/matchesResponse\(/)
    expect(src).toMatch(/hasResponseContext\(/)
    expect(src).toMatch(/draftIncluded\(/)
    expect(src).toMatch(/draftBib\(/)
    expect(src).not.toMatch(/\.response\s*(===|!==|==|!=)/)
    expect(src).not.toMatch(/['"`]accepted['"`]/)
    expect(src).not.toMatch(/draft\.(included|bibs|attendance)\[/)
  })

  it('groups through tonightGroups and edits through the gesture helpers alone', () => {
    const src = code(read(MODULE))
    expect(src).toMatch(/tonightGroups\(/)
    expect(src).toMatch(/selectAll\(/)
    expect(src).toMatch(/clearSelection\(/)
    expect(src).toMatch(/setDraftBib\(/)
    // No colour vocabulary of its own, and no second effective-bib chain.
    for (const colour of ['red', 'blue', 'green', 'yellow', 'orange', 'purple', 'pink']) {
      expect(src, colour).not.toMatch(new RegExp(`['"\`]${colour}['"\`]`))
    }
    expect(src).toMatch(/effectiveBib\(/)
  })

  it('names no table, no writable column and no time of day', () => {
    const src = code(read(MODULE))
    for (const name of ['register_entries', 'player_registrations', 'team_id', 'included_in_groups']) {
      expect(src, name).not.toContain(name)
    }
    expect(src).not.toMatch(/['"`][^'"`\n/]*\btonight\b[^'"`\n/]*['"`]/i)
  })

  it('offers no reset anywhere in the slice', () => {
    // COACH-4 preserves; a deliberate Reset that regenerates is explicitly
    // later work. Neither the module, the card nor the screen may grow a
    // control or a sentence that discards the arrangement.
    for (const f of [MODULE, 'components/SetupSuggestion.tsx', 'routes/SessionRegister.tsx']) {
      const strings = code(read(f)).match(/['"`][^'"`\n]*['"`]/g) ?? []
      for (const s of strings) {
        expect(s, f).not.toMatch(/\breset\b|\brebuild\b|\bregenerate\b|\bstart over\b/i)
      }
    }
  })

  it('adds no provenance', () => {
    for (const f of [MODULE, 'lib/tonight.ts', 'components/SetupSuggestion.tsx', 'routes/SessionRegister.tsx']) {
      const src = code(read(f))
      expect(src, f).not.toMatch(/generated_by|manually_changed|source_of_assignment|generatedBy|manuallyChanged/)
    }
  })
})
