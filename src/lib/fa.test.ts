import { describe, expect, it } from 'vitest'
import { FA_AGE_BANDS, FA_COACH_SKILLS, FA_FORMATS, FA_PLAYER_SKILLS, FA_THEMES, isFaUrl, isFaVideo } from './fa'

const lists: Record<string, string[]> = {
  FA_THEMES,
  FA_PLAYER_SKILLS,
  FA_COACH_SKILLS,
  FA_FORMATS,
  FA_AGE_BANDS,
}

describe('FA option lists', () => {
  for (const [name, list] of Object.entries(lists)) {
    it(`${name} is non-empty`, () => {
      expect(list.length).toBeGreaterThan(0)
    })

    it(`${name} has no duplicates`, () => {
      expect(new Set(list).size).toBe(list.length)
    })
  }
})

describe('isFaUrl', () => {
  it('accepts England Football Learning pages and the FA CDN', () => {
    expect(isFaUrl('https://learn.englandfootball.com/sessions/some-session')).toBe(true)
    expect(isFaUrl('https://cdn.englandfootball.com/image.png')).toBe(true)
  })

  it('rejects other hosts, junk and empty values', () => {
    expect(isFaUrl('https://example.com/learn.englandfootball.com')).toBe(false)
    expect(isFaUrl('https://player.vimeo.com/video/1')).toBe(false)
    expect(isFaUrl('not a url')).toBe(false)
    expect(isFaUrl('')).toBe(false)
    expect(isFaUrl(undefined)).toBe(false)
  })
})

describe('isFaVideo', () => {
  const fa = {
    type: 'video' as const,
    embedUrl: 'https://player.vimeo.com/video/129532422',
    sourceUrl: 'https://learn.englandfootball.com/sessions/some-session',
  }

  it('spots a video streamed from an embed with an FA source page', () => {
    expect(isFaVideo(fa)).toBe(true)
  })

  it('needs the video kind, an embed URL and an FA source', () => {
    expect(isFaVideo({ ...fa, type: 'youtube' })).toBe(false)
    expect(isFaVideo({ ...fa, embedUrl: undefined })).toBe(false)
    expect(isFaVideo({ ...fa, sourceUrl: 'https://vimeo.com/129532422' })).toBe(false)
    expect(isFaVideo({ ...fa, sourceUrl: undefined })).toBe(false)
  })
})
