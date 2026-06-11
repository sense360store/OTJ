import { describe, expect, it } from 'vitest'
import { primaryRole, seesAllTeams, sessionMinutes } from './data'

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

describe('primaryRole', () => {
  it('picks the highest privilege role held', () => {
    expect(primaryRole(['coach', 'admin'])).toBe('admin')
    expect(primaryRole(['coach', 'manager'])).toBe('manager')
    expect(primaryRole(['parent', 'coach'])).toBe('coach')
  })

  it('is order independent', () => {
    expect(primaryRole(['admin', 'coach'])).toBe(primaryRole(['coach', 'admin']))
  })

  it('returns the single role when only one is held', () => {
    expect(primaryRole(['parent'])).toBe('parent')
  })
})

describe('seesAllTeams', () => {
  it('is true for admin or manager', () => {
    expect(seesAllTeams(['admin'])).toBe(true)
    expect(seesAllTeams(['coach', 'manager'])).toBe(true)
  })

  it('is false for a coach or parent without a managing role', () => {
    expect(seesAllTeams(['coach'])).toBe(false)
    expect(seesAllTeams(['parent'])).toBe(false)
    expect(seesAllTeams(['coach', 'parent'])).toBe(false)
  })
})
