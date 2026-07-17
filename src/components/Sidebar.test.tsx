import { describe, expect, it } from 'vitest'
import { navItemsFor } from './nav'

// navItemsFor is the sidebar nav model as a pure function over the capability
// set, so the static suite covers the parent and coach layouts without a DOM
// or a query client, the same style as HomeSwitch. The Sidebar renders the
// same sections; this pins which destinations each set sees.

function ids(caps: Set<string>): string[] {
  return navItemsFor(caps).map((it) => it.id)
}

describe('Sidebar navigation', () => {
  it('shows a parent exactly two destinations, Home and Sessions', () => {
    // sessions.create is the coaching write capability and the same test the
    // Home dispatch uses; a member without it is a parent.
    expect(ids(new Set())).toEqual(['home', 'sessions'])
  })

  it('drops the drill library, planner, programmes, templates and media for a parent', () => {
    const parent = ids(new Set())
    for (const hidden of ['library', 'planner', 'programmes', 'templates', 'media']) {
      expect(parent).not.toContain(hidden)
    }
  })

  it('gives a coach the full Plan and Content groups', () => {
    const coach = ids(new Set(['sessions.create']))
    for (const shown of ['home', 'library', 'sessions', 'planner', 'programmes', 'templates', 'media']) {
      expect(coach).toContain(shown)
    }
  })

  it('shows a coach the Roster entry but never a parent', () => {
    // The Roster sits in the Plan group (sessions.create) and additionally
    // gates on players.view since PR 2, so a coach holding both sees it and a
    // parent holding neither does not; the route guard and players RLS enforce
    // the same boundary.
    expect(ids(new Set(['sessions.create', 'players.view']))).toContain('roster')
    expect(ids(new Set())).not.toContain('roster')
  })

  it('keeps the full nav for a member holding both a coaching role and parent', () => {
    // The parent role grants no write capabilities, so a member who also
    // coaches still holds sessions.create and keeps the full nav.
    expect(ids(new Set(['sessions.create', 'drills.create']))).toContain('library')
  })

  it('adds only the admin rows the capabilities open, in either nav', () => {
    // A member with an admin capability but no sessions.create still gets the
    // two item nav plus the admin rows that capability opens: admin logic is
    // untouched by the parent split.
    const adminOnly = ids(new Set(['users.manage']))
    expect(adminOnly).toEqual(['home', 'sessions', 'admin-users'])
    const adminCoach = ids(new Set(['sessions.create', 'users.manage']))
    expect(adminCoach).toContain('library')
    expect(adminCoach).toContain('admin-users')
  })
})
