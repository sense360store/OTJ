// =====================================================================
// Tonight: who is expected, and how are we splitting them up.
//
// Written before the module. The product question this answers is NOT
// "who arrived?" — it is "who am I including in tonight's groups, and
// what bib do they need?". Spond suggests the pool; the coach decides.
//
// Two facts live on every row and they are independent:
//
//   RESPONSE   what the child's parent said in Spond. Read only, and a
//              child with no Spond link has no response at all, which is
//              NOT the same as not having replied.
//   INCLUDED   whether the coach is putting them in tonight's groups.
//              A Going child need not be included; a Not going child may
//              be, because they turned up anyway.
//
// Everything here is pure so the screen is a thin shell and the rules
// that matter are tested rather than argued about.
//
// Names in fixtures are invented. No real child appears in this repo.
// =====================================================================
import { describe, expect, it } from 'vitest'
import {
  countByResponse,
  DEFAULT_RESPONSE_FILTER,
  draftFromEntries,
  draftIsDirty,
  draftDelta,
  matchesResponse,
  RESPONSE_FILTERS,
  RESPONSE_FILTER_LABELS,
  selectAll,
  clearSelection,
  setDraftBib,
  toggleIncluded,
  buildTonightRows,
  tonightGroups,
  tonightUpsertRows,
  visibleRows,
  type TonightRow,
} from './tonight'
import { buildRegister, type RegisterEntry } from './register'
import type { Player, Team } from './data'

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

// A club night: four linked children with each reply state, and one
// child nobody has linked to Spond at all.
const going = row('anna', { displayName: 'Anna Synthetic', response: 'accepted' })
const quiet = row('ben', { displayName: 'Ben Synthetic', response: 'unanswered' })
const out = row('cara', { displayName: 'Cara Synthetic', response: 'declined' })
const waiting = row('dan', { displayName: 'Dan Synthetic', response: 'waiting' })
const unlinked = row('eve', { displayName: 'Eve Synthetic', response: null })
const ROWS = [going, quiet, out, waiting, unlinked]

const ids = (rows: TonightRow[]) => rows.map((r) => r.playerId)

// ---- 1 to 7. The response filters and their counts -------------------

describe('the response filters', () => {
  it('offers the five states in the order a coach reads them', () => {
    expect(RESPONSE_FILTERS).toEqual(['going', 'unanswered', 'declined', 'waiting', 'all'])
    expect(RESPONSE_FILTER_LABELS).toEqual({
      going: 'Going',
      unanswered: 'No reply',
      declined: 'Not going',
      waiting: 'Waiting',
      all: 'Everyone',
    })
  })

  it('opens on Going', () => {
    expect(DEFAULT_RESPONSE_FILTER).toBe('going')
  })

  it('puts a linked accepted child in Going', () => {
    expect(ids(visibleRows(ROWS, 'going'))).toEqual(['anna'])
  })

  it('puts a linked unanswered child in No reply', () => {
    expect(ids(visibleRows(ROWS, 'unanswered'))).toEqual(['ben'])
  })

  it('puts a linked declined child in Not going', () => {
    expect(ids(visibleRows(ROWS, 'declined'))).toEqual(['cara'])
  })

  it('puts a linked waiting child in Waiting', () => {
    expect(ids(visibleRows(ROWS, 'waiting'))).toEqual(['dan'])
  })

  it('shows an unlinked child under Everyone and nowhere else', () => {
    expect(ids(visibleRows(ROWS, 'all'))).toEqual(['anna', 'ben', 'cara', 'dan', 'eve'])
    for (const f of ['going', 'unanswered', 'declined', 'waiting'] as const) {
      expect(ids(visibleRows(ROWS, f))).not.toContain('eve')
    }
  })

  it('never counts an unlinked child as No reply', () => {
    // The distinction the whole model turns on. "No reply" is a linked
    // child whose parent has not answered. An unlinked child has no reply
    // to give, and calling them No reply would put a number on a screen
    // that is simply not true.
    expect(matchesResponse(unlinked, 'unanswered')).toBe(false)
    expect(countByResponse(ROWS).unanswered).toBe(1)
  })
})

describe('the counts on the chips', () => {
  it('counts the Hub players on THIS session, not the Spond audience', () => {
    // The raw event aggregate can hold fifty people from a whole parent
    // group. These chips are actionable: tapping one filters this list, so
    // its number has to be the number of rows that appear.
    const counts = countByResponse(ROWS)
    expect(counts).toEqual({ going: 1, unanswered: 1, declined: 1, waiting: 1, all: 5 })
    for (const f of RESPONSE_FILTERS) {
      expect(visibleRows(ROWS, f)).toHaveLength(counts[f])
    }
  })

  it('counts Everyone as the complete covered roster, linked or not', () => {
    expect(countByResponse(ROWS).all).toBe(ROWS.length)
  })

  it('reports zeros rather than nothing for a club with no Spond at all', () => {
    const bare = ROWS.map((r) => ({ ...r, response: null }))
    expect(countByResponse(bare)).toEqual({ going: 0, unanswered: 0, declined: 0, waiting: 0, all: 5 })
  })
})

// ---- 12 to 19. Selection -------------------------------------------

const entries: RegisterEntry[] = []

describe('the draft', () => {
  it('starts from what is already saved', () => {
    const saved: RegisterEntry[] = [
      { sessionId: 's', playerId: 'anna', present: true, bibColourOverride: 'red', source: 'roster' },
    ]
    const d = draftFromEntries(saved)
    expect(d.included.anna).toBe(true)
    expect(d.bibs.anna).toBe('red')
    expect(draftIsDirty(d, saved)).toBe(false)
  })

  it('includes and uninclude a single child without touching anyone else', () => {
    const d = toggleIncluded(draftFromEntries(entries), 'anna')
    expect(d.included.anna).toBe(true)
    expect(d.included.ben).toBeUndefined()
    expect(toggleIncluded(d, 'anna').included.anna).toBe(false)
  })

  it('selects every visible Going child and only those', () => {
    const d = selectAll(draftFromEntries(entries), visibleRows(ROWS, 'going'))
    expect(d.included).toEqual({ anna: true })
  })

  it('selects every visible No reply child and only those', () => {
    const d = selectAll(draftFromEntries(entries), visibleRows(ROWS, 'unanswered'))
    expect(d.included).toEqual({ ben: true })
  })

  it('selects the whole visible roster under Everyone', () => {
    const d = selectAll(draftFromEntries(entries), visibleRows(ROWS, 'all'))
    expect(Object.keys(d.included).sort()).toEqual(['anna', 'ben', 'cara', 'dan', 'eve'])
  })

  it('never reaches a child the current filter is hiding', () => {
    // Select all is scoped to what the coach can see. Reaching further
    // would put children in tonight's groups that they never looked at.
    const d = selectAll(draftFromEntries(entries), visibleRows(ROWS, 'going'))
    expect(d.included.ben).toBeUndefined()
    expect(d.included.eve).toBeUndefined()
  })

  it('clears only the visible selection, leaving the rest alone', () => {
    const everyone = selectAll(draftFromEntries(entries), ROWS)
    const cleared = clearSelection(everyone, visibleRows(ROWS, 'going'))
    expect(cleared.included.anna).toBe(false)
    expect(cleared.included.ben).toBe(true)
  })

  it('lets a Going child stay out, and a Not going child come in', () => {
    // Spond suggests the pool; the coach decides tonight's groups.
    const d = toggleIncluded(draftFromEntries(entries), 'cara')
    expect(d.included.cara).toBe(true)
    expect(d.included.anna).toBeUndefined()
  })
})

// ---- 20 to 28. Dirty, delta and save --------------------------------

describe('dirty tracking', () => {
  const saved: RegisterEntry[] = [
    { sessionId: 's', playerId: 'anna', present: true, bibColourOverride: null, source: 'roster' },
  ]

  it('is clean when the draft matches what is saved', () => {
    expect(draftIsDirty(draftFromEntries(saved), saved)).toBe(false)
  })

  it('goes dirty when a child is included', () => {
    expect(draftIsDirty(toggleIncluded(draftFromEntries(saved), 'ben'), saved)).toBe(true)
  })

  it('goes dirty when a bib changes', () => {
    expect(draftIsDirty(setDraftBib(draftFromEntries(saved), 'anna', 'red'), saved)).toBe(true)
  })

  it('goes clean again when a change is undone', () => {
    const d = toggleIncluded(toggleIncluded(draftFromEntries(saved), 'ben'), 'ben')
    expect(draftIsDirty(d, saved)).toBe(false)
  })
})

describe('the delta a save writes', () => {
  const saved: RegisterEntry[] = [
    { sessionId: 's', playerId: 'anna', present: true, bibColourOverride: null, source: 'roster' },
    { sessionId: 's', playerId: 'ben', present: false, bibColourOverride: 'red', source: 'manual' },
  ]

  it('is empty when nothing changed, so saving writes nothing', () => {
    expect(draftDelta(draftFromEntries(saved), saved, 's')).toEqual([])
  })

  it('writes only the rows that changed', () => {
    const d = toggleIncluded(draftFromEntries(saved), 'anna')
    const delta = draftDelta(d, saved, 's')
    expect(delta).toHaveLength(1)
    expect(delta[0].playerId).toBe('anna')
    expect(delta[0].present).toBe(false)
  })

  it('keeps a quick added child manual, so a guest never becomes a squad member', () => {
    const d = setDraftBib(draftFromEntries(saved), 'ben', 'blue')
    const delta = draftDelta(d, saved, 's')
    expect(delta[0].source).toBe('manual')
  })

  it('carries the bib and the inclusion together in one row', () => {
    const d = setDraftBib(toggleIncluded(draftFromEntries(saved), 'cara'), 'cara', 'green')
    const delta = draftDelta(d, saved, 's')
    expect(delta).toHaveLength(1)
    expect(delta[0]).toMatchObject({ playerId: 'cara', present: true, bibColourOverride: 'green' })
  })

  it('preserves a bib on a child who is not included', () => {
    // Setting a bib on an unselected child is a legitimate preparation
    // step and must not be silently dropped.
    const d = setDraftBib(draftFromEntries([]), 'dan', 'red')
    const delta = draftDelta(d, [], 's')
    expect(delta[0]).toMatchObject({ playerId: 'dan', present: false, bibColourOverride: 'red' })
  })
})

describe('what Saved is allowed to mean', () => {
  it('is only clean when the readback equals the draft, field for field', () => {
    // The rule the status line depends on: never say Saved on the strength
    // of a mutation returning without an error. Compare with what came
    // back.
    const draft = setDraftBib(toggleIncluded(draftFromEntries([]), 'anna'), 'anna', 'red')
    const persisted: RegisterEntry[] = [
      { sessionId: 's', playerId: 'anna', present: true, bibColourOverride: 'red', source: 'roster' },
    ]
    expect(draftIsDirty(draft, persisted)).toBe(false)
  })

  it('stays dirty when only some of the rows landed', () => {
    // One row refused by RLS while the others succeed is a partial write,
    // and a partial write is not a save.
    const draft = selectAll(draftFromEntries([]), [going, quiet])
    const partial: RegisterEntry[] = [
      { sessionId: 's', playerId: 'anna', present: true, bibColourOverride: null, source: 'roster' },
    ]
    expect(draftIsDirty(draft, partial)).toBe(true)
  })

  it('stays dirty when a field came back different from what was sent', () => {
    const draft = setDraftBib(draftFromEntries([]), 'anna', 'red')
    const wrong: RegisterEntry[] = [
      { sessionId: 's', playerId: 'anna', present: false, bibColourOverride: 'blue', source: 'roster' },
    ]
    expect(draftIsDirty(draft, wrong)).toBe(true)
  })
})

// ---- 29 to 34. Groups and bibs --------------------------------------

describe('the groups on the grass', () => {
  const teamless = row('finn', { displayName: 'Finn Synthetic', teamId: null, teamName: null, teamBib: null })

  it('applies the team bib with no per child work at all', () => {
    const d = selectAll(draftFromEntries([]), [going, quiet])
    const groups = tonightGroups([going, quiet], d)
    expect(groups).toHaveLength(1)
    expect(groups[0].bib).toBe('blue')
    expect(ids(groups[0].rows)).toEqual(['anna', 'ben'])
  })

  it('lets an override win, and move the child into another group', () => {
    const d = setDraftBib(selectAll(draftFromEntries([]), [going, quiet]), 'ben', 'red')
    const groups = tonightGroups([going, quiet], d)
    expect(groups.map((g) => g.bib)).toEqual(['blue', 'red'])
    expect(ids(groups[1].rows)).toEqual(['ben'])
  })

  it('shows a change of bib in the draft, before anything is saved', () => {
    // The organisation is previewable. Save commits it; it does not
    // create it.
    const before = tonightGroups([going], selectAll(draftFromEntries([]), [going]))
    const after = tonightGroups([going], setDraftBib(selectAll(draftFromEntries([]), [going]), 'anna', 'green'))
    expect(before[0].bib).toBe('blue')
    expect(after[0].bib).toBe('green')
  })

  it('says so honestly when a team has no bib configured', () => {
    const groups = tonightGroups([teamless], selectAll(draftFromEntries([]), [teamless]))
    expect(groups[0].bib).toBeNull()
    expect(groups[0].label).toBe('No team bib')
  })

  it('treats a stored override of none as wearing no bib, not as falling back', () => {
    const d = setDraftBib(selectAll(draftFromEntries([]), [going]), 'anna', 'none')
    expect(tonightGroups([going], d)[0].bib).toBeNull()
  })

  it('groups only the children the coach selected', () => {
    // The group counts are the working answer to "how do I split these
    // kids up", so an unselected child is not in a group.
    const d = selectAll(draftFromEntries([]), [going])
    const groups = tonightGroups(ROWS, d)
    expect(groups.flatMap((g) => ids(g.rows))).toEqual(['anna'])
    expect(groups[0].count).toBe(1)
  })

  it('keeps team identity beside the bib', () => {
    const d = selectAll(draftFromEntries([]), [going])
    expect(tonightGroups([going], d)[0].teamNames).toEqual(['Titans'])
  })

  it('does not move a selected child out when their Spond reply changes', () => {
    // A reply arriving mid-organisation must not reorganise the coach's
    // groups under them. Response and inclusion are different facts.
    const d = selectAll(draftFromEntries([]), [going])
    const nowDeclined = { ...going, response: 'declined' as const }
    expect(ids(tonightGroups([nowDeclined], d)[0].rows)).toEqual(['anna'])
  })
})

// ---- The rows a save actually sends ---------------------------------

describe('the rows a save sends to the database', () => {
  const change = {
    sessionId: 's1',
    playerId: 'anna',
    present: true,
    bibColourOverride: 'red' as string | null,
    source: 'roster' as const,
  }

  it('carries the club on every row, because RLS scopes on it', () => {
    const rows = tonightUpsertRows([change], 'club-1')
    expect(rows).toEqual([
      {
        session_id: 's1',
        player_id: 'anna',
        club_id: 'club-1',
        present: true,
        bib_colour_override: 'red',
        source: 'roster',
      },
    ])
  })

  it('sends a cleared bib as null rather than omitting it', () => {
    // Omitting the key would leave the stored override in place, so
    // "back to the team colour" would silently not happen.
    const rows = tonightUpsertRows([{ ...change, bibColourOverride: null }], 'club-1')
    expect(rows[0].bib_colour_override).toBeNull()
  })

  it('never invents a club, because a row without one is a row RLS refuses', () => {
    expect(() => tonightUpsertRows([change], null)).toThrow(/signed in/i)
  })

  it('sends nothing for an empty delta', () => {
    expect(tonightUpsertRows([], 'club-1')).toEqual([])
  })
})

// ---- Composing the rows from what the screen already reads ----------

describe('buildTonightRows', () => {
  const teams: Team[] = [
    { id: 'titans', name: 'Titans', bibColour: 'blue' },
    { id: 'trojans', name: 'Trojans', bibColour: null },
  ]
  const players: Player[] = [
    { id: 'anna', teamId: 'titans', displayName: 'Anna Synthetic', shirtNumber: 7, createdBy: null },
    { id: 'ben', teamId: 'titans', displayName: 'Ben Synthetic', shirtNumber: null, createdBy: null },
  ]

  it('reuses the roster composition, so coverage and guest rules stay in one place', () => {
    const view = buildRegister(players, ['titans'], teams, [], false)
    const rows = buildTonightRows(view, teams, {})
    expect(ids(rows)).toEqual(['anna', 'ben'])
    expect(rows[0]).toMatchObject({ displayName: 'Anna Synthetic', shirtNumber: 7, teamName: 'Titans', teamBib: 'blue' })
  })

  it('attaches each child s own reply, and nothing for an unlinked child', () => {
    const view = buildRegister(players, ['titans'], teams, [], false)
    const rows = buildTonightRows(view, teams, { anna: { status: 'accepted', syncedAt: 'x' } })
    expect(rows.find((r) => r.playerId === 'anna')?.response).toBe('accepted')
    expect(rows.find((r) => r.playerId === 'ben')?.response).toBeNull()
  })

  it('reports no team bib honestly rather than guessing a colour', () => {
    const trojan: Player[] = [{ id: 'cara', teamId: 'trojans', displayName: 'Cara Synthetic', shirtNumber: null, createdBy: null }]
    const view = buildRegister(trojan, ['trojans'], teams, [], false)
    expect(buildTonightRows(view, teams, {})[0].teamBib).toBeNull()
  })

  it('marks a quick added guest as manual', () => {
    const guest: RegisterEntry[] = [
      { sessionId: 's', playerId: 'zed', present: true, bibColourOverride: null, source: 'manual' },
    ]
    const withGuest: Player[] = [
      ...players,
      { id: 'zed', teamId: 'trojans', displayName: 'Zed Synthetic', shirtNumber: null, createdBy: null },
    ]
    const view = buildRegister(withGuest, ['titans'], teams, guest, false)
    expect(buildTonightRows(view, teams, {}).find((r) => r.playerId === 'zed')?.manual).toBe(true)
  })
})
