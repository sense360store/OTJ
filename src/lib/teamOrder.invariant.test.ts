// COACH-1A ships the club's team order as a COLUMN (migration
// 0051_team_sort_order: teams.sort_order, nullable, with a partial unique
// index per club) and deliberately NO consumer. COACH-1B, a separate
// frontend pull request, reads and writes it. Until then these pin what
// "no consumer" means, because the column exists in the database from the
// day the migration is applied and a well-meaning read of it is the
// easiest thing to add by accident:
//
//   * the teams read selects an explicit column list that does not name
//     it, so the deployed client never sees the column and every write it
//     sends omits it;
//   * no application source reads or writes it, by either spelling, other
//     than a comment naming what a later slice will do;
//   * the grouping suggestion still takes the order as a parameter and
//     names no column a write would target (pinned beside it in
//     sessionSetup.invariant.test.ts, and restated here by reference);
//   * the label every session surface shows stays alphabetical, which is
//     the one order the product has today and is not what the column will
//     mean. Two orders will coexist and must not be confused.
//
// Source text tripwires, not proofs: they catch the realistic mistake
// (a column typed into a select list, a field read off a row) and say
// nothing about a value that reaches a consumer through a variable. The
// blind spots, named so a pass is read for what it is: a column name
// assembled from parts ('sort_' + 'order'), a select('*') on teams that
// would carry the column without naming it, a row spread into another
// shape, and a mention after a URL on the same line, which the comment
// stripping below leaves on the scanned side only up to the colon.

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { sessionTeamsLabel } from './sessionTeams'
import type { Team } from './data'

const SRC = join(process.cwd(), 'src')
// The Edge Functions are application source too: a snapshot builder or a
// sync that read the column would be a consumer the browser tripwire could
// not see, and the public share deny lists are exactly where a new column
// tends to arrive by accident.
const FUNCTIONS = join(process.cwd(), 'supabase', 'functions')

function read(rel: string): string {
  return readFileSync(join(SRC, rel), 'utf8')
}

// Comments are stripped BEFORE matching rather than whole lines classified
// by their first token: a line that opens with a closed block comment and
// carries a read after it is code, and an interior line of a block comment
// with no leading asterisk is not. Block comments are removed across lines
// with their newlines kept, so a reported line number is the file's own; a
// `//` tail is removed unless it follows a colon, which keeps the rest of a
// URL inside a string on the scanned side.
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ''))
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function applicationSources(): string[] {
  const out: string[] = []
  for (const root of [SRC, FUNCTIONS]) {
    for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue
      if (!/\.(ts|tsx)$/.test(entry.name)) continue
      if (/(\.test\.tsx?|_test\.ts)$/.test(entry.name)) continue
      out.push(relative(process.cwd(), join(entry.parentPath, entry.name)))
    }
  }
  return out.sort()
}

describe('the team order column has no consumer yet', () => {
  it('the teams read selects an explicit column list that does not name sort_order', () => {
    const src = read('lib/queries.ts')
    const match = /const TEAM_COLS = '([^']+)'/.exec(src)
    expect(match, 'TEAM_COLS must be a literal column list').not.toBeNull()
    // Exact, so widening it is a deliberate change in the slice that owns
    // the consumer rather than a drift this test lets through.
    expect(match![1]).toBe('id, club_id, name, bib_colour, created_at')
    expect(match![1]).not.toContain('sort_order')
  })

  it('the client Team shape carries no order', () => {
    const src = read('lib/data.ts')
    const shape = /export interface Team \{([^}]*)\}/.exec(src)
    expect(shape).not.toBeNull()
    expect(shape![1]).not.toMatch(/sortOrder|sort_order/)
  })

  it('no application source, browser or Edge, reads or writes sort_order or sortOrder outside a comment', () => {
    const offenders: string[] = []
    for (const rel of applicationSources()) {
      // A comment naming what COACH-1B will do is the only permitted
      // mention. Anything else is a consumer arriving early.
      const code = withoutComments(readFileSync(join(process.cwd(), rel), 'utf8'))
      code.split('\n').forEach((line, i) => {
        if (!/sort_order|sortOrder/.test(line)) return
        offenders.push(`${rel}:${i + 1}: ${line.trim()}`)
      })
    }
    expect(offenders).toEqual([])
  })

  it('the comment stripping keeps code beside a closed block comment and drops a block comment interior', () => {
    // The two shapes the first version of this file got wrong, pinned so
    // the rule cannot quietly regress to classifying lines by their first
    // token: a read hiding behind a leading closed block comment was let
    // through, and a plain sentence inside a block comment failed the build.
    const hidden = '/* note */ return t.sort_order'
    expect(withoutComments(hidden)).toContain('sort_order')
    const interior = ['/*', 'sort_order arrives with COACH-1B', '*/', 'const x = 1'].join('\n')
    const stripped = withoutComments(interior)
    expect(stripped).not.toContain('sort_order')
    // Newlines survive, so a reported line number is the file's own.
    expect(stripped.split('\n')).toHaveLength(4)
    expect(stripped.split('\n')[3]).toBe('const x = 1')
    expect(withoutComments('const y = 2 // sortOrder later')).not.toContain('sortOrder')
    expect(withoutComments("const u = 'https://example.test/sort_order'")).toContain('sort_order')
  })

  it('the grouping suggestion keeps its own tripwire against the column', () => {
    // sessionSetup.invariant.test.ts bans the column name from the
    // generator body; this only checks that ban is still there, so the two
    // files cannot be loosened one at a time without noticing.
    const guard = read('lib/sessionSetup.invariant.test.ts')
    expect(guard).toContain("expect(src).not.toMatch(/\\bsort_order\\b/)")
  })
})

describe('labels stay alphabetical whatever order the club states', () => {
  it('sessionTeamsLabel sorts by name, not by insertion order', () => {
    // Insertion order is deliberately not alphabetical, and the ids are
    // chosen so that neither id order nor insertion order agrees with the
    // name order the label must show.
    const teams: Record<string, Team | undefined> = {
      t1: { id: 't1', name: 'Zulu', bibColour: null },
      t2: { id: 't2', name: 'Alpha', bibColour: 'red' },
      t3: { id: 't3', name: 'Mike', bibColour: null },
      t4: { id: 't4', name: 'Bravo', bibColour: null },
    }
    expect(sessionTeamsLabel({ teamId: null, teamIds: ['t1', 't3', 't2'] }, teams)).toBe('Alpha, Mike, Zulu')
    expect(sessionTeamsLabel({ teamId: null, teamIds: ['t4', 't2'] }, teams)).toBe('Alpha, Bravo')
    expect(sessionTeamsLabel({ teamId: null, teamIds: ['t1', 't2', 't3', 't4'] }, teams)).toBe('All teams')
  })
})
