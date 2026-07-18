import { describe, expect, it } from 'vitest'
import { bottomItemsFor, moreItemsFor } from './nav'

// bottomItemsFor is the mobile bottom row pulled out as a pure function over
// the capability set, the same style as the sidebar nav. moreItemsFor is the
// overflow sheet behind the More entry, carrying every other sidebar
// destination the set opens. Together they keep the phone reachable to the
// whole sidebar without the row growing past a thumb's reach.

function rowIds(caps: Set<string>): string[] {
  return bottomItemsFor(caps).map((it) => it.id)
}
function moreIds(caps: Set<string>): string[] {
  return moreItemsFor(caps).map((it) => it.id)
}

describe('Bottom navigation', () => {
  it('shows a parent exactly Home and Sessions in the row', () => {
    expect(rowIds(new Set())).toEqual(['home', 'sessions'])
  })

  it('keeps Home, Plan, Board and Sessions in the row for a coach', () => {
    expect(rowIds(new Set(['sessions.create']))).toEqual(['home', 'planner', 'board', 'sessions'])
  })

  it('shows a coach the Registered players in the More sheet but never a parent', () => {
    // The Players page reads the club register, so a coach holding players.view
    // (with sessions.create for the Plan group) reaches it from the More sheet; a
    // parent, holding neither, does not.
    expect(moreIds(new Set(['sessions.create', 'players.view']))).toContain('players')
    expect(moreIds(new Set())).not.toContain('players')
  })

  it('keeps the secondary browse surfaces reachable through More for a coach', () => {
    // Drills and Media left the row for the More sheet, so they stay reachable
    // on a phone rather than dropping off the bottom nav.
    const more = moreIds(new Set(['sessions.create']))
    expect(more).toContain('library')
    expect(more).toContain('media')
  })

  it('shows an admin the admin items in More but never a parent', () => {
    const admin = moreIds(new Set(['sessions.create', 'club.manage', 'users.manage', 'teams.manage']))
    expect(admin).toEqual(expect.arrayContaining(['admin-club', 'admin-users', 'admin-teams', 'admin-spond']))
    const parent = moreIds(new Set())
    for (const item of ['admin-club', 'admin-users', 'admin-teams', 'admin-spond']) {
      expect(parent).not.toContain(item)
    }
  })

  it('gives a parent holding no admin or coach capability an empty More list', () => {
    // The bottom nav drops the More entry when the list is empty, so a plain
    // parent keeps the two item row and nothing else.
    expect(moreIds(new Set())).toEqual([])
  })

  it('opens only the admin rows a capability grants, gating More by the same map', () => {
    // moreItemsFor reuses navItemsFor and ITEM_CAP, so an admin-only member
    // (no sessions.create) reaches the admin screens their capabilities open
    // and no more: the More sheet tracks the same capability map as the
    // sidebar, never a second copy.
    expect(moreIds(new Set(['users.manage']))).toEqual(['admin-users'])
    expect(moreIds(new Set(['teams.manage']))).toEqual(['admin-teams'])
    expect(moreIds(new Set(['club.manage']))).toEqual(expect.arrayContaining(['admin-club', 'admin-spond']))
  })
})
