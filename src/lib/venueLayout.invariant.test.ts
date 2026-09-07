// =====================================================================
// Venue layouts (COACH-5), pinned.
//
// A tripwire, not a proof, in the style of eventKind.invariant and
// sessionLifecycle.invariant. It reads source text, so it catches the
// realistic mistakes and it names what it cannot catch: a write that
// reaches the table through a variable holding the table name, a season
// picked through a helper that hides the is_current read, a literal age
// group list assembled at runtime. Treat a pass as "nobody typed the
// obvious thing".
//
// What it pins:
//   * ONE shape boundary: venue_layouts.zones is read and written by
//     src/lib/venueLayout.ts alone, and the client's bounds are the
//     database's bounds.
//   * ONE writer: the table is written only from src/lib/queries.ts, and the
//     admin layouts screen is the one consumer of those writes.
//   * Season resolution never consults is_current: the model has no such
//     read, and no screen resolves a dated session's season itself.
//   * ONE age group list: the planner's and the programme modal's literals
//     are gone, and the only literal left is the fallback in ageGroups.ts.
//   * The five no-layout states are one closed vocabulary.
// =====================================================================
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const srcDir = fileURLToPath(new URL('..', import.meta.url))
const repoDir = join(srcDir, '..')

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    return statSync(full).isDirectory() ? walk(full) : [full]
  })
}

const sourceFiles = walk(srcDir).filter((f) => (f.endsWith('.ts') || f.endsWith('.tsx')) && !f.includes('.test.'))
const read = (f: string) => readFileSync(f, 'utf8')
// The executable half only: a word in a comment is prose, not a read.
const code = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
const rel = (f: string) => f.slice(srcDir.length)
const model = read(join(srcDir, 'lib/venueLayout.ts'))
const modelCode = code(join(srcDir, 'lib/venueLayout.ts'))
const migration = read(join(repoDir, 'supabase/migrations/0053_venue_layouts.sql'))

describe('one shape boundary', () => {
  it('parses and serialises the stored value in the model alone', () => {
    const outside = sourceFiles.filter(
      (f) => rel(f) !== 'lib/venueLayout.ts' && /parseVenueLayoutZones\s*\(|serialiseVenueLayoutZones\s*\(/.test(code(f)),
    )
    // queries.ts calls both at the seam; nothing else touches the value.
    expect(outside.map(rel).sort()).toEqual(['lib/queries.ts'])
  })

  it('mirrors the database bounds exactly', () => {
    expect(model).toContain('export const MIN_ZONE_SIZE = 0.05')
    expect(migration).toContain("between 0.05 and 1")
    expect(model).toContain('export const MAX_ZONE_NAME = 30')
    expect(migration).toContain("char_length(p_zone ->> 'name') <= 30")
    expect(model).toContain('export const MIN_SIZE_METRES = 5')
    expect(model).toContain('export const MAX_SIZE_METRES = 300')
    expect(migration).toContain('between 5 and 300')
    expect(model).toContain('export const VENUE_LAYOUT_VERSION = 1')
    expect(migration).toContain("p_layout ->> 'version' = '1'")
  })

  it('never spreads its input on the way in', () => {
    // The parser rebuilds a zone from named fields. A spread of `raw` would
    // let any key through.
    const parse = model.slice(model.indexOf('function parseZone('), model.indexOf('export function fitZone('))
    expect(parse).not.toMatch(/\.\.\.raw\b/)
  })

  it('offers exactly the four shapes the constraint stores', () => {
    expect(model).toContain("{ kind: 'stations', slots: 4 },\n  { kind: 'stations', slots: 5 },\n  { kind: 'games', slots: 1 },\n  { kind: 'games', slots: 2 },")
    expect(migration).toContain("(kind = 'stations' and slots in (4, 5))")
    expect(migration).toContain("(kind = 'games' and slots in (1, 2))")
  })
})

describe('one writer, one consumer', () => {
  it('writes venue_layouts only from the query seam', () => {
    const writers = sourceFiles.filter((f) => /from\('venue_layouts'\)/.test(code(f)))
    expect(writers.map(rel)).toEqual(['lib/queries.ts'])
  })

  it('has the admin layouts screen as the one consumer of the save and delete hooks', () => {
    const consumers = sourceFiles.filter(
      (f) => rel(f) !== 'lib/queries.ts' && /useSaveVenueLayout|useDeleteVenueLayout/.test(code(f)),
    )
    expect(consumers.map(rel)).toEqual(['routes/AdminVenueLayouts.tsx'])
  })

  it('writes clubs.age_groups only through useUpdateClub', () => {
    const writers = sourceFiles.filter((f) => rel(f) !== 'lib/queries.ts' && /age_groups/.test(code(f)))
    // useAuth selects profiles.age_groups, the per coach column this feature
    // deliberately does not read as a club list.
    expect(writers.map(rel).sort()).toEqual(['hooks/useAuth.tsx'])
  })
})

describe('season resolution fails closed', () => {
  it('never reads is_current or isCurrent in the model', () => {
    expect(modelCode).not.toMatch(/isCurrent|is_current/)
  })

  it('is the one implementation: no screen compares a session date with a season itself', () => {
    const outside = sourceFiles.filter(
      (f) => rel(f) !== 'lib/venueLayout.ts' && /startsOn\s*<=|<=\s*\w+\.endsOn|resolveSeason\s*\(/.test(code(f)),
    )
    expect(outside.map(rel)).toEqual([])
  })

  it('names exactly the five no-layout states, plus the one found state', () => {
    const states = [...model.matchAll(/^\s+\| '([a-z-]+)'\s+\/\//gm)].map((m) => m[1])
    expect(states).toEqual(['no-venue', 'no-age-group', 'season-unresolved', 'season-ambiguous', 'not-drawn', 'slot-count'])
  })
})

describe('one age group list', () => {
  it('keeps the only age group literal in ageGroups.ts, as the fallback', () => {
    const literal = /'U6s'\s*,\s*'U7s'|'U7s'\s*,\s*'U8s'\s*,\s*'U9s'/
    const holders = sourceFiles.filter((f) => literal.test(code(f)))
    expect(holders.map(rel)).toEqual(['lib/ageGroups.ts'])
  })

  it('reads the club list on both session controls', () => {
    expect(read(join(srcDir, 'routes/Planner.tsx'))).toContain('ageGroupOptions(ageGroups, session.ageGroup)')
    expect(read(join(srcDir, 'components/ApplyProgrammeModal.tsx'))).toContain('ageGroupOptions(ageGroups, ageGroup)')
  })

  it('mirrors the database bounds', () => {
    const rules = read(join(srcDir, 'lib/ageGroups.ts'))
    expect(rules).toContain('export const AGE_GROUP_MAX_LENGTH = 20')
    expect(rules).toContain('export const MAX_AGE_GROUPS = 30')
    expect(migration).toContain('char_length(g.label) > 20')
    expect(migration).toContain('array_length(p_groups, 1), 0) <= 30')
  })
})

describe('what this file cannot catch', () => {
  it('a table name reaching from() through a variable', () => {
    // `const t = 'venue_layouts'; supabase.from(t)` would pass the writer
    // check. It is named here so a green run is not read as a proof.
    expect(true).toBe(true)
  })
})
