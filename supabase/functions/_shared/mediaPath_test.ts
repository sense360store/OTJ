import { assertEquals } from 'jsr:@std/assert@1'
import {
  isCanonicalMediaPath,
  isCanonicalMediaPathShape,
  MEDIA_PATH_MAX_LENGTH,
} from './mediaPath.ts'

// The shared case list. Resolved relative to this file so the suite does not
// depend on the working directory CI happens to run deno from.
const repoRoot = new URL('../../../', import.meta.url)
const fixtureUrl = new URL('tests/fixtures/media-path-cases.json', repoRoot)

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

const fixture: Fixture = JSON.parse(await Deno.readTextFile(fixtureUrl))

Deno.test('the shared fixture is non trivial', () => {
  // Guards against an empty or truncated fixture silently passing the suite.
  const valid = fixture.cases.filter((c) => c.valid).length
  const invalid = fixture.cases.length - valid
  assertEquals(valid > 0 && invalid > 20, true)
})

for (const testCase of fixture.cases) {
  Deno.test(`canonical media path: ${testCase.name}`, () => {
    assertEquals(isCanonicalMediaPath(testCase.path, fixture.clubId), testCase.valid)
  })
}

Deno.test('a path valid for one club is never valid for another', () => {
  for (const testCase of fixture.cases) {
    if (!testCase.valid) continue
    assertEquals(isCanonicalMediaPath(testCase.path, fixture.otherClubId), false)
  }
})

Deno.test('a non string path or club is refused', () => {
  for (const bad of [null, undefined, 42, {}, [], true]) {
    assertEquals(isCanonicalMediaPath(bad, fixture.clubId), false)
    assertEquals(isCanonicalMediaPath(`${fixture.clubId}/file.png`, bad), false)
  }
})

Deno.test('a malformed club id is refused even with a matching prefix', () => {
  assertEquals(isCanonicalMediaPath('not-a-uuid/file.png', 'not-a-uuid'), false)
  assertEquals(isCanonicalMediaPath('/file.png', ''), false)
})

Deno.test('the length cap is exact', () => {
  const club = fixture.clubId
  const room = MEDIA_PATH_MAX_LENGTH - club.length - 1
  assertEquals(isCanonicalMediaPath(`${club}/${'a'.repeat(room)}`, club), true)
  assertEquals(isCanonicalMediaPath(`${club}/${'a'.repeat(room + 1)}`, club), false)
})

// Drift guard: the browser mirror must state the same grammar. Comparing the
// four grammar constants verbatim catches an edit to one file that was not made
// to the other, which the per case assertions above would not catch because
// each suite imports only its own implementation.
Deno.test('the browser mirror states an identical grammar', async () => {
  const grammarOf = (source: string) =>
    source
      .split('\n')
      .filter((line) => /^const (SEGMENT|PATH_CHARSET|RESERVED_SEGMENTS|UUID) =/.test(line))
      .join('\n')

  const deno = await Deno.readTextFile(new URL('mediaPath.ts', import.meta.url))
  const browser = await Deno.readTextFile(new URL('src/lib/mediaPath.ts', repoRoot))

  const denoGrammar = grammarOf(deno)
  assertEquals(denoGrammar.split('\n').length, 4)
  assertEquals(grammarOf(browser), denoGrammar)

  const capOf = (source: string) => /MEDIA_PATH_MAX_LENGTH = (\d+)/.exec(source)?.[1]
  assertEquals(capOf(browser), capOf(deno))
})

// The club agnostic half of the grammar, used by read-content-share as the last
// gate before the service role signs. It agrees with the full validator on every
// case except the one that is wrong ONLY because it names a different club,
// which this half deliberately cannot see. An uppercase club id is not in that
// set: the shape guard's uuid pattern is lowercase only, so it refuses one for
// its own reasons.
const OTHER_CLUB_ONLY = new Set(['another club prefix'])

for (const testCase of fixture.cases) {
  Deno.test(`canonical media path shape: ${testCase.name}`, () => {
    const expected = OTHER_CLUB_ONLY.has(testCase.name) ? true : testCase.valid
    assertEquals(isCanonicalMediaPathShape(testCase.path), expected)
  })
}

Deno.test('the shape guard still refuses a first segment that is not a uuid', () => {
  assertEquals(isCanonicalMediaPathShape('notauuid/file.png'), false)
  assertEquals(isCanonicalMediaPathShape('avatars/file.png'), false)
  assertEquals(isCanonicalMediaPathShape('file.png'), false)
})

Deno.test('the shape guard refuses a non string', () => {
  for (const bad of [null, undefined, 42, {}, [], true]) {
    assertEquals(isCanonicalMediaPathShape(bad), false)
  }
})

Deno.test('anything the full validator accepts, the shape guard accepts', () => {
  // The read path must never drop a path the definer function legitimately
  // named, or a valid share would silently render without its media.
  for (const testCase of fixture.cases) {
    if (!testCase.valid) continue
    assertEquals(isCanonicalMediaPathShape(testCase.path), true, testCase.name)
  }
})
