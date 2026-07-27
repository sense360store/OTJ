import { describe, it, expect } from 'vitest'
// Imported raw rather than as a JSON module: tsconfig.app.json includes only
// `src`, so a structural JSON import from tests/ would not typecheck. `?raw` is
// declared by vite/client and gives the file back as a string.
import fixtureRaw from '../../tests/fixtures/media-path-cases.json?raw'
import { isCanonicalMediaPath, MEDIA_PATH_MAX_LENGTH } from './mediaPath'

interface Case {
  name: string
  path: string
  valid: boolean
}
interface Fixture {
  clubId: string
  otherClubId: string
  cases: Case[]
}

const fixture = JSON.parse(fixtureRaw) as Fixture

describe('isCanonicalMediaPath', () => {
  it('reads a non trivial shared fixture', () => {
    const valid = fixture.cases.filter((c) => c.valid).length
    expect(valid).toBeGreaterThan(0)
    expect(fixture.cases.length - valid).toBeGreaterThan(20)
  })

  // The same case list the Deno validator and the Postgres function are tested
  // against. All three must agree on every case.
  it.each(fixture.cases.map((c) => [c.name, c.path, c.valid] as const))(
    'case: %s',
    (_name, path, valid) => {
      expect(isCanonicalMediaPath(path, fixture.clubId)).toBe(valid)
    },
  )

  it('never accepts another club as the owner of a valid path', () => {
    for (const testCase of fixture.cases) {
      if (!testCase.valid) continue
      expect(isCanonicalMediaPath(testCase.path, fixture.otherClubId)).toBe(false)
    }
  })

  it('refuses a non string path or club', () => {
    for (const bad of [null, undefined, 42, {}, [], true]) {
      expect(isCanonicalMediaPath(bad, fixture.clubId)).toBe(false)
      expect(isCanonicalMediaPath(`${fixture.clubId}/file.png`, bad)).toBe(false)
    }
  })

  it('refuses a malformed club id even when the prefix matches', () => {
    expect(isCanonicalMediaPath('not-a-uuid/file.png', 'not-a-uuid')).toBe(false)
    expect(isCanonicalMediaPath('/file.png', '')).toBe(false)
  })

  it('applies the length cap exactly', () => {
    const club = fixture.clubId
    const room = MEDIA_PATH_MAX_LENGTH - club.length - 1
    expect(isCanonicalMediaPath(`${club}/${'a'.repeat(room)}`, club)).toBe(true)
    expect(isCanonicalMediaPath(`${club}/${'a'.repeat(room + 1)}`, club)).toBe(false)
  })
})
