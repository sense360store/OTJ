import { describe, expect, it } from 'vitest'
import {
  embedSrc,
  hasAllCaps,
  isSampleMedia,
  memberTeamIds,
  nextPrimaryTeamId,
  primaryRoleKey,
  relatedDrills,
  roleKeyFromLabel,
  sessionMinutes,
  sortRoles,
} from './data'
import type { Drill } from './data'

describe('sessionMinutes', () => {
  it('sums the activity durations', () => {
    const activities = [
      { phase: 'Warm-Up' as const, duration: 10 },
      { phase: 'Skill' as const, duration: 20, drillId: 'd1' },
      { phase: 'Game' as const, duration: 15, drillId: 'd2' },
    ]
    expect(sessionMinutes({ activities })).toBe(45)
  })

  it('is zero for no activities', () => {
    expect(sessionMinutes({ activities: [] })).toBe(0)
  })

  it('treats a NaN duration as zero rather than poisoning the sum', () => {
    const activities = [
      { phase: 'Skill' as const, duration: Number.NaN },
      { phase: 'Game' as const, duration: 25 },
    ]
    expect(sessionMinutes({ activities })).toBe(25)
  })
})

describe('embedSrc', () => {
  it('accepts an allowlisted https player URL unchanged', () => {
    expect(embedSrc('https://player.vimeo.com/video/129532422')).toBe('https://player.vimeo.com/video/129532422')
  })

  it('rejects a host outside the allowlist, including the bare vimeo host', () => {
    expect(embedSrc('https://vimeo.com/129532422')).toBeNull()
    expect(embedSrc('https://evil.example.com/player.vimeo.com')).toBeNull()
  })

  it('rejects non-https, junk and empty input', () => {
    expect(embedSrc('http://player.vimeo.com/video/1')).toBeNull()
    expect(embedSrc('not a url')).toBeNull()
    expect(embedSrc(undefined)).toBeNull()
    expect(embedSrc('')).toBeNull()
  })
})

describe('isSampleMedia', () => {
  it('a row with no file, no YouTube id and no embed is a sample', () => {
    expect(isSampleMedia({ storagePath: undefined, yt: undefined, embedUrl: undefined })).toBe(true)
  })

  it('an embedded video is not a sample', () => {
    expect(isSampleMedia({ embedUrl: 'https://player.vimeo.com/video/1' })).toBe(false)
  })

  it('a stored file is not a sample', () => {
    expect(isSampleMedia({ storagePath: 'club/abc.png' })).toBe(false)
  })
})

// Shorthand for a role shape in the tests below.
const role = (key: string, label: string, system = true) => ({ key, label, system })

describe('sortRoles', () => {
  it('orders system roles by privilege: admin, manager, coach, parent', () => {
    const shuffled = [role('parent', 'Parent'), role('coach', 'Coach'), role('admin', 'Admin'), role('manager', 'Manager')]
    expect(sortRoles(shuffled).map((r) => r.key)).toEqual(['admin', 'manager', 'coach', 'parent'])
  })

  it('puts custom roles after every system role, alphabetically by label', () => {
    const roles = [
      role('zeta', 'Zeta', false),
      role('parent', 'Parent'),
      role('analyst', 'Analyst', false),
      role('admin', 'Admin'),
    ]
    expect(sortRoles(roles).map((r) => r.key)).toEqual(['admin', 'parent', 'analyst', 'zeta'])
  })

  it('does not mutate its input', () => {
    const roles = [role('parent', 'Parent'), role('admin', 'Admin')]
    sortRoles(roles)
    expect(roles.map((r) => r.key)).toEqual(['parent', 'admin'])
  })

  it('treats a custom role reusing a system key as custom', () => {
    const roles = [role('admin', 'Shadow admin', false), role('coach', 'Coach')]
    expect(sortRoles(roles).map((r) => r.label)).toEqual(['Coach', 'Shadow admin'])
  })
})

describe('primaryRoleKey', () => {
  it('picks the highest precedence system role held', () => {
    expect(primaryRoleKey([role('coach', 'Coach'), role('admin', 'Admin')])).toBe('admin')
    expect(primaryRoleKey([role('parent', 'Parent'), role('manager', 'Manager')])).toBe('manager')
    expect(primaryRoleKey([role('parent', 'Parent')])).toBe('parent')
  })

  it('defaults to coach when only custom roles are held, matching invite-user', () => {
    expect(primaryRoleKey([role('analyst', 'Analyst', false)])).toBe('coach')
    expect(primaryRoleKey([])).toBe('coach')
  })

  it('ignores a custom role that reuses a system key', () => {
    expect(primaryRoleKey([role('admin', 'Shadow admin', false), role('parent', 'Parent')])).toBe('parent')
  })
})

describe('roleKeyFromLabel', () => {
  it('slugs a label to the database key shape', () => {
    expect(roleKeyFromLabel('Team Manager')).toBe('team_manager')
    expect(roleKeyFromLabel('U10s lead!')).toBe('u10s_lead')
  })

  it('strips diacritics and edge punctuation', () => {
    expect(roleKeyFromLabel('  Café crew  ')).toBe('cafe_crew')
    expect(roleKeyFromLabel('---')).toBe('')
    expect(roleKeyFromLabel('')).toBe('')
  })

  it('always satisfies the slug constraint when non-empty', () => {
    for (const label of ['Team Manager', 'Café crew', '9 a side', 'A'.repeat(100)]) {
      const key = roleKeyFromLabel(label)
      expect(key).toMatch(/^[a-z0-9][a-z0-9_]{0,62}$/)
    }
  })
})

describe('memberTeamIds', () => {
  const allIds = ['t1', 't2', 't3']

  it('returns the specific selection while all teams is off', () => {
    expect(memberTeamIds({ allTeams: false, teamIds: ['t2'] }, allIds)).toEqual(['t2'])
  })

  it('returns every club team while all teams is on, whatever is selected', () => {
    expect(memberTeamIds({ allTeams: true, teamIds: ['t2'] }, allIds)).toEqual(allIds)
    expect(memberTeamIds({ allTeams: true, teamIds: [] }, allIds)).toEqual(allIds)
  })

  it('includes a team created after the flag was set', () => {
    const grown = [...allIds, 't4']
    expect(memberTeamIds({ allTeams: true, teamIds: ['t1'] }, grown)).toContain('t4')
  })
})

describe('nextPrimaryTeamId', () => {
  it('keeps the current primary while it stays selected', () => {
    expect(nextPrimaryTeamId('t2', ['t1', 't2'])).toBe('t2')
  })

  it('falls to the first selected team when the primary is dropped', () => {
    expect(nextPrimaryTeamId('t2', ['t1', 't3'])).toBe('t1')
  })

  it('clears the primary when nothing is selected', () => {
    expect(nextPrimaryTeamId('t2', [])).toBeNull()
    expect(nextPrimaryTeamId(null, [])).toBeNull()
  })

  it('sets a primary for a member who had none', () => {
    expect(nextPrimaryTeamId(null, ['t3'])).toBe('t3')
  })
})

describe('hasAllCaps', () => {
  it('is true only when every needed capability is held', () => {
    const caps = new Set(['drills.create', 'media.create', 'templates.create'])
    expect(hasAllCaps(caps, ['drills.create', 'media.create'])).toBe(true)
    expect(hasAllCaps(caps, ['drills.create', 'programmes.create'])).toBe(false)
    expect(hasAllCaps(caps, [])).toBe(true)
  })
})

describe('relatedDrills', () => {
  // Related drills stay in creation order: the list reads flipped to newest
  // first, but the three related drills a page shows must not change with
  // them. Four candidates share the drill's corner, so oldest first and
  // newest first would pick different threes.
  function drill(overrides: Partial<Drill> & { id: string; createdAt: string }): Drill {
    return {
      title: overrides.id,
      corner: 'technical',
      skill: '',
      ages: [],
      level: 'Foundation',
      duration: 10,
      players: '',
      area: '',
      equipment: [],
      mediaId: null,
      summary: '',
      points: [],
      tags: [],
      setupNotes: '',
      easier: [],
      harder: [],
      theme: '',
      format: '',
      sourceUrl: '',
      sourceLabel: '',
      ...overrides,
    }
  }

  const subject = drill({ id: 'subject', createdAt: '2026-01-01T00:00:00Z' })
  const r1 = drill({ id: 'r1', createdAt: '2026-01-02T00:00:00Z' })
  const r2 = drill({ id: 'r2', createdAt: '2026-02-02T00:00:00Z' })
  const r3 = drill({ id: 'r3', createdAt: '2026-03-02T00:00:00Z' })
  const r4 = drill({ id: 'r4', createdAt: '2026-04-02T00:00:00Z' })

  it('picks the three oldest matches even from a newest first list', () => {
    // The list arrives newest first, the order useDrills now returns; a
    // pass-through slice would pick r4, r3, r2.
    const newestFirstList = [r4, r3, r2, r1, subject]
    expect(relatedDrills(subject, newestFirstList).map((d) => d.id)).toEqual(['r1', 'r2', 'r3'])
  })

  it('never relates through a missing corner or skill', () => {
    const bare = drill({ id: 'bare', createdAt: '2026-01-05T00:00:00Z', corner: null })
    const other = drill({ id: 'other', createdAt: '2026-01-06T00:00:00Z', corner: null })
    expect(relatedDrills(bare, [other, bare])).toEqual([])
  })

  it('relates FA drills through overlapping topic tags', () => {
    const fa = drill({ id: 'fa', createdAt: '2026-01-05T00:00:00Z', corner: null, tags: ['Defending'] })
    const match = drill({ id: 'match', createdAt: '2026-01-06T00:00:00Z', corner: null, tags: ['Defending'] })
    expect(relatedDrills(fa, [match, fa]).map((d) => d.id)).toEqual(['match'])
  })
})
