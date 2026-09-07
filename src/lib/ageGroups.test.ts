import { describe, expect, it } from 'vitest'
import {
  AGE_GROUP_MAX_LENGTH,
  DEFAULT_AGE_GROUPS,
  MAX_AGE_GROUPS,
  ageGroupOptions,
  ageGroupProblem,
  ageGroupsConfigured,
  normaliseAgeGroups,
  trimAgeGroup,
} from './ageGroups'

describe('the club age group list, as the database will store it', () => {
  it('trims the whitespace the database names, not only the space', () => {
    expect(trimAgeGroup(' U8s\t')).toBe('U8s')
    expect(trimAgeGroup('\r\nU8s\n')).toBe('U8s')
  })

  it('normalises to trimmed, non blank, distinct labels in the order given', () => {
    expect(normaliseAgeGroups([' U7s ', 'U8s', '', '  ', 'U8s', 'U9s'])).toEqual(['U7s', 'U8s', 'U9s'])
  })

  it('is idempotent, so a stored list round trips unchanged', () => {
    const stored = ['U7s', 'U8s', 'U9s']
    expect(normaliseAgeGroups(normaliseAgeGroups(stored))).toEqual(stored)
  })

  it('drops a label over the bound rather than truncating it into a different label', () => {
    expect(normaliseAgeGroups(['U8s', 'x'.repeat(AGE_GROUP_MAX_LENGTH + 1)])).toEqual(['U8s'])
    expect(normaliseAgeGroups(['x'.repeat(AGE_GROUP_MAX_LENGTH)])).toHaveLength(1)
  })

  it('stops at the maximum count', () => {
    const many = Array.from({ length: MAX_AGE_GROUPS + 5 }, (_, i) => `G${i}`)
    expect(normaliseAgeGroups(many)).toHaveLength(MAX_AGE_GROUPS)
  })

  it('names the rule a new label breaks, or none', () => {
    expect(ageGroupProblem('  ', [])).toBe('Type an age group first.')
    expect(ageGroupProblem('x'.repeat(21), [])).toBe('An age group is at most 20 characters.')
    expect(ageGroupProblem(' U8s ', ['U8s'])).toBe('U8s is already on the list.')
    expect(ageGroupProblem('U31s', Array.from({ length: MAX_AGE_GROUPS }, (_, i) => `G${i}`))).toBe(
      'The list holds at most 30 age groups.',
    )
    expect(ageGroupProblem('U10s', ['U8s'])).toBeNull()
  })
})

describe('what the session age group control offers', () => {
  it('offers the club list when the club has one', () => {
    expect(ageGroupOptions(['U7s', 'U8s'], 'U8s')).toEqual(['U7s', 'U8s'])
  })

  it('falls back to the previous defaults while the club has configured nothing', () => {
    expect(ageGroupOptions([], 'U8s')).toEqual([...DEFAULT_AGE_GROUPS])
    expect(ageGroupOptions(undefined, 'U8s')).toEqual([...DEFAULT_AGE_GROUPS])
    expect(ageGroupOptions(null, 'U8s')).toEqual([...DEFAULT_AGE_GROUPS])
  })

  it('always keeps the session s own label, last, so a save cannot move it silently', () => {
    expect(ageGroupOptions(['U7s', 'U8s'], 'U12s')).toEqual(['U7s', 'U8s', 'U12s'])
    expect(ageGroupOptions([], 'Under 13')).toEqual([...DEFAULT_AGE_GROUPS, 'Under 13'])
  })

  it('offers nothing extra for an empty current label', () => {
    expect(ageGroupOptions(['U7s'], '')).toEqual(['U7s'])
    expect(ageGroupOptions(['U7s'], '  ')).toEqual(['U7s'])
  })

  it('does not mutate the club list it was handed', () => {
    const list = ['U7s']
    ageGroupOptions(list, 'U9s')
    expect(list).toEqual(['U7s'])
  })

  it('says whether the club configured a list at all', () => {
    expect(ageGroupsConfigured([])).toBe(false)
    expect(ageGroupsConfigured(null)).toBe(false)
    expect(ageGroupsConfigured(['U8s'])).toBe(true)
  })

  it('keeps the defaults exactly the planner s previous literal', () => {
    expect(DEFAULT_AGE_GROUPS).toEqual(['U6s', 'U7s', 'U8s', 'U9s', 'U10s', 'U11s', 'U12s'])
  })
})
