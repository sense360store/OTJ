import { describe, expect, it } from 'vitest'
import { bottomItemsFor } from './nav'

// bottomItemsFor is the mobile bottom nav pulled out as a pure function over
// the capability set, the same style as the sidebar nav. A parent gets the
// same two destinations as the sidebar; a coach keeps the planner row.

function ids(caps: Set<string>): string[] {
  return bottomItemsFor(caps).map((it) => it.id)
}

describe('Bottom navigation', () => {
  it('shows a parent exactly Home and Sessions', () => {
    expect(ids(new Set())).toEqual(['home', 'sessions'])
  })

  it('keeps the planner and library rows for a coach', () => {
    const coach = ids(new Set(['sessions.create']))
    expect(coach).toContain('planner')
    expect(coach).toContain('library')
  })

  it('shows a coach the Roster row but never a parent', () => {
    // The Roster carries the Import from Spond action, so a coach reaches it
    // from the bottom nav; a parent, holding no sessions.create, does not.
    expect(ids(new Set(['sessions.create']))).toContain('roster')
    expect(ids(new Set())).not.toContain('roster')
  })
})
