// What an empty event list says, pinned.
//
// The regression this file exists for: a Past view emptied by a kind or a
// team filter printed "No sessions have finished yet" over a club with a
// season of history behind it. That sentence is a claim about the club and
// it was being made about a filter.
import { describe, expect, it } from 'vitest'
import { emptyEventListNote, NO_PAST_SESSIONS_NOTE, type EmptyEventListState } from './sessionEmptyState'

// The shipped default: Training, Upcoming, no team, Mine off, in a club
// that has sessions and has history.
const state = (over: Partial<EmptyEventListState> = {}): EmptyEventListState => ({
  anySessions: true,
  anyPast: true,
  scope: 'upcoming',
  kind: 'training',
  team: false,
  mine: false,
  ...over,
})

describe('a club with nothing in it at all', () => {
  it('is told to plan a session, never to widen a filter it has not set', () => {
    expect(emptyEventListNote(state({ anySessions: false }))).toBe(
      'Plan your first session and it will appear here.',
    )
  })

  it('is told the same thing under Past, rather than a filter lecture', () => {
    expect(emptyEventListNote(state({ anySessions: false, anyPast: false, scope: 'past' }))).toBe(
      'Plan your first session and it will appear here.',
    )
  })
})

describe('the Past view', () => {
  it('says nothing has finished only when nothing has finished', () => {
    expect(emptyEventListNote(state({ scope: 'past', anyPast: false }))).toBe(NO_PAST_SESSIONS_NOTE)
    expect(NO_PAST_SESSIONS_NOTE).toContain('No sessions have finished yet')
    expect(NO_PAST_SESSIONS_NOTE).toContain('Upcoming')
  })

  it('does NOT say it when a kind filter emptied a history that exists', () => {
    // The bug. A club that trains every week, looking at Past under
    // Training, with every past row a fixture: the history is there and
    // the filter is hiding it.
    const note = emptyEventListNote(state({ scope: 'past', anyPast: true }))
    expect(note).not.toContain('No sessions have finished yet')
    expect(note).toBe('Nothing in the past matches this filter. Try All events.')
  })

  it('does NOT say it when a team filter emptied a history that exists', () => {
    const note = emptyEventListNote(state({ scope: 'past', anyPast: true, kind: 'all', team: true }))
    expect(note).not.toContain('No sessions have finished yet')
    expect(note).toBe('Nothing in the past matches this filter. Try another team.')
  })

  it('does NOT say it when the ownership narrowing emptied a history that exists', () => {
    const note = emptyEventListNote(state({ scope: 'past', anyPast: true, kind: 'all', mine: true }))
    expect(note).not.toContain('No sessions have finished yet')
    expect(note).toBe('Nothing in the past matches this filter. Try turn Mine off.')
  })

  it('names every narrowing in effect, so the advice can actually reach the history', () => {
    expect(emptyEventListNote(state({ scope: 'past', anyPast: true, team: true, mine: true }))).toBe(
      'Nothing in the past matches this filter. Try All events, another team, or turn Mine off.',
    )
  })

  it('never offers Past as the way out of Past', () => {
    // Tapping the chip a coach is already on cannot change the result, and
    // reads as the screen not knowing where it is.
    expect(emptyEventListNote(state({ scope: 'past', anyPast: true }))).not.toContain('Try Past')
    expect(emptyEventListNote(state({ scope: 'past', anyPast: true, team: true }))).not.toContain(', Past')
  })
})

describe('the Upcoming view', () => {
  it('offers only the widening that can help on the shipped default', () => {
    // Mine is off and no team is chosen, so suggesting either is advice
    // that cannot change the result. Past is offered because there is
    // history to reach.
    expect(emptyEventListNote(state({ anyPast: false }))).toBe('Nothing matches this filter. Try All events.')
    expect(emptyEventListNote(state({ anyPast: true }))).toBe(
      'Nothing matches this filter. Try All events, or Past.',
    )
  })

  it('does not offer Past when there is no history to reach', () => {
    expect(emptyEventListNote(state({ anyPast: false, team: true }))).toBe(
      'Nothing matches this filter. Try All events, or another team.',
    )
  })

  it('does not offer All events to a coach already on All events', () => {
    expect(emptyEventListNote(state({ kind: 'all', anyPast: false, mine: true }))).toBe(
      'Nothing matches this filter. Try turn Mine off.',
    )
  })
})

describe('the sentence with nothing to suggest', () => {
  it('says less rather than inventing a widening', () => {
    // Unreachable from either screen, because a fully widened view can
    // only be empty when there is nothing of that sort at all, and both
    // branches above catch that. Pinned so a future narrowing added
    // without its clause degrades to a true sentence instead of "Try .".
    expect(emptyEventListNote(state({ kind: 'all', anyPast: false }))).toBe('Nothing matches this filter.')
    expect(emptyEventListNote(state({ kind: 'all', scope: 'past', anyPast: true }))).toBe(
      'Nothing in the past matches this filter.',
    )
  })
})
