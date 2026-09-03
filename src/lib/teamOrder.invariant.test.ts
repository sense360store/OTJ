// The club's team order has ONE reviewed consumer, and this pins its edge.
//
// COACH-1A shipped the column (migration 0051_team_sort_order: teams
// sort_order, nullable, with a partial unique index per club) with no
// consumer at all, and the first version of this file pinned exactly that.
// COACH-1B is the reviewed consumer: the teams read carries the column, the
// Team model carries it as sortOrder, src/lib/teamOrder.ts holds every rule
// about it, the Teams admin screen renders and saves it through the one
// mutation in queries.ts, and NOTHING ELSE reads it. In particular the
// grouping suggestion still takes the order as a parameter and the register
// screen still hands it null; wiring the two together is a later slice's
// decision, made in the open rather than by a column quietly arriving in a
// select list. These pin that boundary, because the column exists in every
// row now and a well meaning read of it is the easiest thing to add.
//
//   * the teams read selects an explicit column list that names it, and
//     still orders by NAME, because the read order is the product's
//     display order and the club order is a separate answer;
//   * the Team model carries sortOrder, so a consumer reads a typed field
//     rather than a raw row, and no player level field of any such name
//     exists anywhere;
//   * the only application sources that name the column or the field, by
//     either spelling, are the reviewed COACH-1B path;
//   * the grouping suggestion names no column a write would target and the
//     register passes it no order (both restated here by reference and
//     pinned beside them in sessionSetup.invariant.test.ts);
//   * the label every session surface shows stays alphabetical, whatever
//     order the Team objects carry;
//   * no Edge Function reads or forwards it.
//
// Source text tripwires, not proofs: they catch the realistic mistake (a
// field read off a Team in a screen, a column typed into a select list) and
// say nothing about a value that reaches a consumer through a variable. The
// blind spots, named so a pass is read for what it is: a column name
// assembled from parts ('sort_' + 'order'), a select('*') on teams that would
// carry the column without naming it, a Team spread into another shape and
// read there under another name, and a mention after a URL on the same line,
// which the comment stripping below leaves on the scanned side only up to
// the colon.

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

/* The reviewed COACH-1B boundary: the only application sources that may
   name the column or the field. Widening this list is a product decision
   (a consumer of the order), made in a reviewed change that also says what
   the consumer does with it. */
const REVIEWED_CONSUMERS = [
  'src/lib/data.ts', // the Team model carries sortOrder
  'src/lib/queries.ts', // the read carries sort_order; the save writes it and nothing else
  'src/lib/teamOrder.ts', // every rule about the order
]
/* The one screen. It never names the column or the field itself: it reads
   the order through teamOrder.ts and saves it through the one mutation, so
   a screen that started reading `team.sortOrder` directly would show up in
   the sweep below like any other consumer. */
const REVIEWED_SCREEN = 'src/routes/AdminTeams.tsx'

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

function mentions(rel: string): string[] {
  const code = withoutComments(readFileSync(join(process.cwd(), rel), 'utf8'))
  const found: string[] = []
  code.split('\n').forEach((line, i) => {
    if (/sort_order|sortOrder/.test(line)) found.push(`${rel}:${i + 1}: ${line.trim()}`)
  })
  return found
}

describe('the teams read carries the column and keeps the display order', () => {
  it('selects an explicit column list that names sort_order, never select(*)', () => {
    const src = read('lib/queries.ts')
    const match = /const TEAM_COLS = '([^']+)'/.exec(src)
    expect(match, 'TEAM_COLS must be a literal column list').not.toBeNull()
    // Exact, so widening it again is a deliberate change rather than drift.
    expect(match![1]).toBe('id, club_id, name, bib_colour, created_at, sort_order')
    expect(withoutComments(src)).not.toMatch(/from\('teams'\)\s*\.select\('\*'\)/)
  })

  it('still orders the read by name, so the club order never becomes the display order by accident', () => {
    const src = withoutComments(read('lib/queries.ts'))
    const readSite = src.match(/from\('teams'\)\.select\(TEAM_COLS\)\.order\('([^']+)'/)
    expect(readSite, 'the teams read orders by a column').not.toBeNull()
    expect(readSite![1]).toBe('name')
  })

  it('maps sort_order to sortOrder on the Team model, null for null', () => {
    const src = withoutComments(read('lib/queries.ts'))
    expect(src).toMatch(/sortOrder: r\.sort_order \?\? null/)
    const shape = /export interface Team \{([^}]*)\}/.exec(read('lib/data.ts'))
    expect(shape).not.toBeNull()
    expect(shape![1]).toMatch(/sortOrder: number \| null/)
  })

  it('writes only sort_order from the save, never a name, a bib or any other team field', () => {
    const src = withoutComments(read('lib/queries.ts'))
    const store = src.slice(src.indexOf('const teamOrderStore'), src.indexOf('export function useSaveTeamOrder'))
    expect(store.length).toBeGreaterThan(0)
    // Every update in the store sets sort_order and nothing else.
    const updates = [...store.matchAll(/\.update\(\{([^}]*)\}\)/g)].map((m) => m[1].trim())
    expect(updates.length).toBe(2)
    // Exactly the two payloads: a null for the clearing phase and the
    // position for the placing phase. A second key in either would be a
    // second field the save writes.
    expect(updates.sort()).toEqual(['sort_order: null', 'sort_order: position'])
    for (const u of updates) expect(u).toMatch(/^sort_order: (null|position)$/)
    expect(store).not.toMatch(/\bname\b|bib_colour|club_id|created_at|upsert|insert\(|delete\(/)
  })

  it('every write is a compare and set: a clear on the position the read saw, a placement on null', () => {
    // Two admins can both read before either writes; without these
    // conditions the second to finish would overwrite the first, and the
    // unique index would allow it because the result is a valid
    // permutation.
    const src = withoutComments(read('lib/queries.ts'))
    const store = src.slice(src.indexOf('const teamOrderStore'), src.indexOf('export function useSaveTeamOrder'))
    const clear = /\.update\(\{ sort_order: null \}\)\s*\.eq\('id', id\)\s*\.eq\('sort_order', from\)\s*\.select\('id, sort_order'\)/
    const place = /\.update\(\{ sort_order: position \}\)\s*\.eq\('id', id\)\s*\.is\('sort_order', null\)\s*\.select\('id, sort_order'\)/
    expect(store).toMatch(clear)
    expect(store).toMatch(place)
    // One row per write, never a set: an `.in(` would clear rows this
    // save had not compared.
    expect(store).not.toMatch(/\.in\(/)
  })

  it('the teams read itself never touches the field: the club order is a separate answer', () => {
    // A `.order('sort_order')` or a sort on `sortOrder` inside useTeams would
    // make the club order the display order on every screen at once. The
    // read body is pinned as naming neither spelling; the column reaches it
    // only through TEAM_COLS and toTeam, which are checked above.
    const src = withoutComments(read('lib/queries.ts'))
    const body = /export function useTeams\(\) \{([\s\S]*?)\n\}/.exec(src)
    expect(body, 'useTeams').not.toBeNull()
    expect(body![1]).not.toMatch(/sortOrder|sort_order/)
    expect(body![1]).toContain("select(TEAM_COLS).order('name'")
  })
})

describe('no player level ability field exists', () => {
  it('the Player shape carries no ability, rating, level or band', () => {
    const src = withoutComments(read('lib/data.ts'))
    const player = /export interface Player \{([^}]*)\}/.exec(src)
    expect(player, 'the Player model').not.toBeNull()
    expect(player![1]).not.toMatch(/\b(ability|rating|level|band|skill|sortOrder|sort_order)\w*\s*[:?]/i)
  })

  it('no application source names a player ability column', () => {
    const offenders: string[] = []
    for (const rel of applicationSources()) {
      const code = withoutComments(readFileSync(join(process.cwd(), rel), 'utf8'))
      if (/player_(ability|rating|level|band)|players\.(ability|rating|level|band)/.test(code)) offenders.push(rel)
    }
    expect(offenders).toEqual([])
  })
})

describe('only the reviewed COACH-1B boundary consumes the column', () => {
  it('no application source outside the reviewed list names sort_order or sortOrder outside a comment', () => {
    const offenders: string[] = []
    for (const rel of applicationSources()) {
      if (REVIEWED_CONSUMERS.includes(rel)) continue
      offenders.push(...mentions(rel))
    }
    expect(offenders).toEqual([])
  })

  it('every reviewed consumer actually names it, so the list cannot carry a file that stopped being one', () => {
    for (const rel of REVIEWED_CONSUMERS) expect(mentions(rel), rel).not.toEqual([])
  })

  it('the Teams screen is the only screen on the order, and reaches it through the helper and the one mutation', () => {
    const screen = withoutComments(read('routes/AdminTeams.tsx'))
    expect(screen).toMatch(/from '\.\.\/lib\/teamOrder'/)
    expect(screen).toMatch(/useSaveTeamOrder/)
    // The snapshot the save refuses against is built by the helper, so the
    // screen never reads the field itself (the sweep above would list it).
    expect(screen).toMatch(/expected: draft\?\.expected \?\? teamPositions\(teams\)/)
    // The snapshot is never rebuilt from a later read: it is taken when the
    // draft is created and checked against each fresh read.
    // A later move keeps the draft's snapshot as it is, a null left by a
    // failed save included, rather than taking a fresh one.
    expect(screen).toMatch(/expected: draft \? draft\.expected : teamPositions\(teams\) \}\)/)
    expect(screen).toMatch(/snapshotAfterRead\(draft\.expected, read\)/)
    // After its own save the snapshot is what the save wrote, never a read,
    // and a draft is made for that comparison whether or not one existed.
    expect(screen).toMatch(/const intended = intendedPositions\(vars\.orderedIds\)/)
    expect(screen).toMatch(/setDraft\(\{ ids: vars\.orderedIds, expected: intended \}\)/)
    // The success note is derived from the read agreeing with what was
    // saved, never a flag set true on success and cleared by hand.
    expect(screen).toMatch(/const orderSaved = savedAs !== null && positionsAgree\(savedAs, teamPositions\(teams\)\)/)
    expect(screen).not.toMatch(/setOrderSaved/)
    // No other route, component or hook touches the helper or the mutation.
    const others = applicationSources().filter(
      (rel) => rel !== REVIEWED_SCREEN && !REVIEWED_CONSUMERS.includes(rel) && rel.startsWith('src/'),
    )
    const offenders = others.filter((rel) => {
      const code = withoutComments(readFileSync(join(process.cwd(), rel), 'utf8'))
      // Any import specifier that resolves to the helper, from any depth
      // (`./teamOrder` beside it, `../lib/teamOrder` from a route, and the
      // deeper relative forms a component or a hook would use), plus the
      // mutation and the helper's own names.
      return /from '(\.\.?\/)+(lib\/)?teamOrder'|useSaveTeamOrder|clubOrder\(|moveTeam\(|teamOrderWrites\(|saveTeamOrder\(/.test(code)
    })
    expect(offenders).toEqual([])
  })

  it('the save outcome is handled in the hook\'s own callbacks, ahead of the awaited invalidation', () => {
    // TanStack awaits the hook level onSuccess, then onSettled, before the
    // per-call callbacks run, and onSettled returns the invalidation, which
    // resolves when the teams refetch has landed. So anything the screen
    // must have in place before that read (the snapshot it is compared
    // against) goes through the hook's callbacks, and the flag that says a
    // read is awaited is armed before the write goes out.
    const src = withoutComments(read('lib/queries.ts'))
    const hook = src.slice(src.indexOf('export function useSaveTeamOrder'), src.indexOf('// ---- Spond RSVP context'))
    expect(hook).toMatch(/onSuccess: \(_data, vars\) => callbacks\?\.onSuccess\?\.\(vars\)/)
    expect(hook).toMatch(/onError: \(error, vars\) => callbacks\?\.onError\?\.\(error, vars\)/)
    expect(hook).toMatch(/onSettled: \(\) => qc\.invalidateQueries\(\{ queryKey: \['teams'\] \}\)/)
    expect(hook.indexOf('onSuccess:')).toBeLessThan(hook.indexOf('onSettled:'))
    expect(hook.indexOf('onError:')).toBeLessThan(hook.indexOf('onSettled:'))
    const screen = withoutComments(read('routes/AdminTeams.tsx'))
    expect(screen).toMatch(/useSaveTeamOrder\(\{/)
    // A failure that is not a refused concurrency keeps the arrangement
    // that was SENT as the draft, whether or not one existed, so a no
    // move save on an incomplete club never adopts a half written order.
    expect(screen).toMatch(/else setDraft\(\{ ids: vars\.orderedIds, expected: null \}\)/)
    expect(screen).not.toMatch(/d === null \? null/)
    // A failure on the fresh read wrote nothing, so the snapshot it carried
    // is kept: a later read that differs is somebody else's change, not
    // this save's, and must drop the draft rather than be adopted.
    expect(screen).toMatch(
      /else if \(error instanceof TeamOrderReadFailed\) setDraft\(\{ ids: vars\.orderedIds, expected: vars\.expected \}\)/,
    )
    // The mutate call carries the variables and nothing else.
    expect(screen).toMatch(/save\.mutate\(\{ orderedIds: draftIds, expected: draft\?\.expected \?\? teamPositions\(teams\) \}\)/)
    expect(screen).not.toMatch(/save\.mutate\([^)]*onSuccess/)
    // Armed before each write, not in its callbacks.
    const saveOrder = screen.slice(screen.indexOf('const saveOrder = () => {'), screen.indexOf('save.mutate('))
    expect(saveOrder).toContain('setAwaitingRead(true)')
    const add = screen.slice(screen.indexOf('const add = () => {'), screen.indexOf('insert.mutate('))
    expect(add).toContain('setAwaitingRead(true)')
  })

  it('the Teams screen saves only on a press: no effect calls the mutation', () => {
    // Opening the screen writes nothing. The realistic way to break that is
    // an effect that "keeps the order in sync"; every useEffect body on the
    // screen is read and none may reach `.mutate(`. The pure tests cover
    // the rest of the rule (a render writes nothing is pinned by the screen
    // test, which counts the mutations a static render makes).
    const screen = withoutComments(read('routes/AdminTeams.tsx'))
    const effects = [...screen.matchAll(/useEffect\(\(\) => \{([\s\S]*?)\n {2}\}, \[/g)].map((m) => m[1])
    expect(effects.length).toBeGreaterThanOrEqual(1)
    for (const body of effects) expect(body).not.toMatch(/\.mutate\(|mutateAsync/)
  })

  it('no Edge Function reads or forwards it', () => {
    for (const rel of applicationSources().filter((f) => f.startsWith('supabase/functions/'))) {
      expect(mentions(rel), rel).toEqual([])
    }
  })

  it('the grouping suggestion still names no column, and the register still hands it no order', () => {
    // sessionSetup.invariant.test.ts bans the column name from the generator
    // body; this checks that ban is still there and that the register's one
    // call still passes null, so the files cannot be loosened one at a time.
    const guard = read('lib/sessionSetup.invariant.test.ts')
    expect(guard).toContain("expect(src).not.toMatch(/\\bsort_order\\b/)")
    const register = withoutComments(read('routes/SessionRegister.tsx'))
    const calls = [...register.matchAll(/planSetup\(([^)]*)\)/g)].map((m) => m[1].replace(/\s+/g, ' ').trim())
    expect(calls).toEqual(['rows, live, null'])
    expect(register).not.toMatch(/teamOrder|clubOrder|positionByTeam/)
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
})

describe('labels stay alphabetical whatever order the club states', () => {
  it('sessionTeamsLabel sorts by name even when every Team carries a contrary club position', () => {
    // The club order is deliberately the REVERSE of the alphabetical one,
    // and the insertion order agrees with neither, so a label that read
    // either would come out differently.
    const teams: Record<string, Team | undefined> = {
      t1: { id: 't1', name: 'Zulu', bibColour: null, sortOrder: 1 },
      t2: { id: 't2', name: 'Alpha', bibColour: 'red', sortOrder: 4 },
      t3: { id: 't3', name: 'Mike', bibColour: null, sortOrder: 2 },
      t4: { id: 't4', name: 'Bravo', bibColour: null, sortOrder: 3 },
    }
    expect(sessionTeamsLabel({ teamId: null, teamIds: ['t1', 't3', 't2'] }, teams)).toBe('Alpha, Mike, Zulu')
    expect(sessionTeamsLabel({ teamId: null, teamIds: ['t4', 't2'] }, teams)).toBe('Alpha, Bravo')
    expect(sessionTeamsLabel({ teamId: null, teamIds: ['t1', 't2', 't3', 't4'] }, teams)).toBe('All teams')
  })

  it('the label module never reads the field', () => {
    expect(withoutComments(read('lib/sessionTeams.ts'))).not.toMatch(/sortOrder|sort_order/)
  })
})
