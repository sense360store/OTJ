import { describe, expect, it } from 'vitest'
import { FA_AGE_BANDS, FA_COACH_SKILLS, FA_FORMATS, FA_PLAYER_SKILLS, FA_THEMES } from './fa'

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
