import { describe, expect, it } from 'vitest'
import { sessionMinutes } from './data'

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
