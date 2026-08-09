import { describe, expect, it } from 'vitest'
import {
  buildRsvpByPlayer,
  isRsvpStatus,
  linkedCounts,
  RSVP_LABELS,
  rsvpStaleNote,
} from './spondRsvp'
import type { RegisteredPlayer } from './data'

// Synthetic throughout: invented uppercase hex member ids, invented names.
const A = '0123456789ABCDEF0123456789ABCDEF'
const B = 'FEDCBA9876543210FEDCBA9876543210'
const C = 'AAAABBBBCCCCDDDDEEEEFFFF00001111'
const NOW = new Date('2026-08-09T18:00:00Z')
const FRESH = '2026-08-09T17:00:00Z'

describe('buildRsvpByPlayer', () => {
  const links = [
    { spond_member_id: A, player_id: 'p1' },
    { spond_member_id: B, player_id: 'p2' },
  ]

  it('resolves each reply onto the child a human bound it to', () => {
    const map = buildRsvpByPlayer(
      [
        { spond_member_id: A, status: 'accepted', synced_at: FRESH },
        { spond_member_id: B, status: 'declined', synced_at: FRESH },
      ],
      links,
    )
    expect(map.p1.status).toBe('accepted')
    expect(map.p2.status).toBe('declined')
  })

  it('drops a reply whose member nobody linked rather than showing it nameless', () => {
    const map = buildRsvpByPlayer([{ spond_member_id: C, status: 'accepted', synced_at: FRESH }], links)
    expect(map).toEqual({})
  })

  it('a linked child with no reply this event simply has no entry', () => {
    const map = buildRsvpByPlayer([{ spond_member_id: A, status: 'accepted', synced_at: FRESH }], links)
    expect(map.p2).toBeUndefined()
  })

  it('an unknown status is dropped rather than rendered as an unknown pill', () => {
    const map = buildRsvpByPlayer([{ spond_member_id: A, status: 'unconfirmed', synced_at: FRESH }], links)
    expect(map).toEqual({})
  })

  it('no links means no context, which renders as nothing', () => {
    expect(buildRsvpByPlayer([{ spond_member_id: A, status: 'accepted', synced_at: FRESH }], [])).toEqual({})
  })

  it('carries the player id only: no member id and no name reach the lookup', () => {
    const flat = JSON.stringify(
      buildRsvpByPlayer([{ spond_member_id: A, status: 'accepted', synced_at: FRESH }], links),
    )
    expect(flat).not.toContain(A)
    expect(flat).not.toContain('spond_member_id')
  })
})

describe('the labels', () => {
  it('never use yes or no, which read as present and absent', () => {
    const words = Object.values(RSVP_LABELS)
    expect(words).toEqual(['Going', 'Not going', 'No reply', 'Waiting'])
    for (const w of words) expect(['Yes', 'No']).not.toContain(w)
  })

  it('the vocabulary is exactly the four the column accepts', () => {
    expect(Object.keys(RSVP_LABELS).sort()).toEqual(['accepted', 'declined', 'unanswered', 'waiting'])
    expect(isRsvpStatus('unconfirmed')).toBe(false)
    expect(isRsvpStatus('accepted')).toBe(true)
  })
})

describe('rsvpStaleNote', () => {
  it('stays quiet when the freshest reply is from today', () => {
    expect(rsvpStaleNote({ p1: { status: 'accepted', syncedAt: FRESH } }, NOW)).toBeNull()
  })

  it('stays quiet when there is no context at all', () => {
    expect(rsvpStaleNote({}, NOW)).toBeNull()
  })

  it('reads the freshest reply, not the oldest', () => {
    const map = {
      p1: { status: 'accepted' as const, syncedAt: '2026-08-01T18:00:00Z' },
      p2: { status: 'declined' as const, syncedAt: FRESH },
    }
    expect(rsvpStaleNote(map, NOW)).toBeNull()
  })

  it('says how old the context is once it is over a day', () => {
    expect(rsvpStaleNote({ p1: { status: 'accepted', syncedAt: '2026-08-08T12:00:00Z' } }, NOW)).toBe(
      'Spond replies from yesterday',
    )
    expect(rsvpStaleNote({ p1: { status: 'accepted', syncedAt: '2026-08-06T12:00:00Z' } }, NOW)).toBe(
      'Spond replies from 3 days ago',
    )
  })

  it('an unreadable timestamp is not treated as infinitely stale', () => {
    expect(rsvpStaleNote({ p1: { status: 'accepted', syncedAt: 'not a date' } }, NOW)).toBeNull()
  })
})

describe('linkedCounts', () => {
  const roster = (ids: string[]): RegisteredPlayer[] =>
    ids.map((id) => ({
      registrationId: `r-${id}`,
      playerId: id,
      seasonId: 'season',
      teamId: 't1',
      displayName: `Synthetic ${id}`,
      shirtNumber: null,
      status: 'registered',
      registeredDate: null,
      createdBy: null,
      updatedAt: '2026-08-09T00:00:00Z',
    }))

  it('counts how much of the squad is bound', () => {
    expect(linkedCounts(roster(['p1', 'p2', 'p3']), new Set(['p1', 'p3']))).toEqual({ linked: 2, total: 3 })
  })

  it('a link for somebody outside this roster does not inflate the count', () => {
    expect(linkedCounts(roster(['p1']), new Set(['p1', 'p9']))).toEqual({ linked: 1, total: 1 })
  })

  it('an empty roster is zero of zero, never a division', () => {
    expect(linkedCounts([], new Set())).toEqual({ linked: 0, total: 0 })
  })
})
