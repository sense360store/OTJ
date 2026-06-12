import { describe, expect, it } from 'vitest'
import { bySpondEventCloseness, parseSpondMappingInput, syncedAgo } from './spond'

// Real Spond ids are 32 character uppercase hex strings.
const GROUP = 'A1B2C3D4E5F60718293A4B5C6D7E8F90'
const SUB = '0F1E2D3C4B5A69788796A5B4C3D2E1F0'

describe('parseSpondMappingInput', () => {
  it('extracts group and subgroup from a full client URL with -S-', () => {
    expect(parseSpondMappingInput(`https://spond.com/client/groups/${GROUP}-S-${SUB}`)).toEqual({
      groupId: GROUP,
      subgroupId: SUB,
    })
  })

  it('extracts a whole group mapping from a full client URL without -S-', () => {
    expect(parseSpondMappingInput(`https://spond.com/client/groups/${GROUP}`)).toEqual({
      groupId: GROUP,
      subgroupId: null,
    })
  })

  it('accepts a raw group id', () => {
    expect(parseSpondMappingInput(GROUP)).toEqual({ groupId: GROUP, subgroupId: null })
  })

  it('accepts a raw group-S-subgroup pair', () => {
    expect(parseSpondMappingInput(`${GROUP}-S-${SUB}`)).toEqual({ groupId: GROUP, subgroupId: SUB })
  })

  it('rejects garbage input', () => {
    expect(parseSpondMappingInput('')).toBeNull()
    expect(parseSpondMappingInput('not a spond id')).toBeNull()
    expect(parseSpondMappingInput('DEADBEEF')).toBeNull() // hex, but far too short
    expect(parseSpondMappingInput(`${GROUP}-S-`)).toBeNull()
    expect(parseSpondMappingInput(`${GROUP}-S-${SUB}-S-${SUB}`)).toBeNull()
    expect(parseSpondMappingInput(`https://example.com/client/groups/${GROUP}`)).toBeNull()
    expect(parseSpondMappingInput('https://spond.com/client/groups/')).toBeNull()
    expect(parseSpondMappingInput(`https://spond.com/landing/${GROUP}`)).toBeNull()
  })

  it('normalises case and whitespace, and ignores a URL path after the id', () => {
    expect(parseSpondMappingInput(`  ${GROUP.toLowerCase()}  `)).toEqual({ groupId: GROUP, subgroupId: null })
    expect(parseSpondMappingInput(`https://www.spond.com/client/groups/${GROUP}-S-${SUB}/overview?x=1`)).toEqual({
      groupId: GROUP,
      subgroupId: SUB,
    })
  })
})

describe('bySpondEventCloseness', () => {
  const events = [
    { startsAt: '2026-06-01T17:30:00Z' },
    { startsAt: '2026-06-16T17:30:00Z' },
    { startsAt: '2026-07-20T10:00:00Z' },
  ]

  it('orders events nearest to the session date first', () => {
    const sorted = [...events].sort(bySpondEventCloseness('2026-06-15', '17:30'))
    expect(sorted.map((e) => e.startsAt)).toEqual([
      '2026-06-16T17:30:00Z',
      '2026-06-01T17:30:00Z',
      '2026-07-20T10:00:00Z',
    ])
  })

  it('falls back to start order when the session has no date', () => {
    const sorted = [...events].sort(bySpondEventCloseness('', ''))
    expect(sorted.map((e) => e.startsAt)).toEqual([
      '2026-06-01T17:30:00Z',
      '2026-06-16T17:30:00Z',
      '2026-07-20T10:00:00Z',
    ])
  })
})

describe('syncedAgo', () => {
  const now = new Date('2026-06-12T12:00:00Z')

  it('labels freshness coarsely', () => {
    expect(syncedAgo('2026-06-12T11:59:40Z', now)).toBe('synced just now')
    expect(syncedAgo('2026-06-12T11:40:00Z', now)).toBe('synced 20 minutes ago')
    expect(syncedAgo('2026-06-12T09:00:00Z', now)).toBe('synced 3 hours ago')
    expect(syncedAgo('2026-06-10T09:00:00Z', now)).toBe('synced 2 days ago')
  })

  it('returns nothing for an unreadable timestamp', () => {
    expect(syncedAgo('not a time', now)).toBe('')
  })
})
