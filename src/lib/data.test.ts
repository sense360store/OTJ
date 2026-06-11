import { describe, expect, it } from 'vitest'
import { embedSrc, isSampleMedia, sessionMinutes } from './data'

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
