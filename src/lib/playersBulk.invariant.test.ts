// =====================================================================
// The bulk permanent deletion rules that would be quietly expensive to lose
// (roadmap PLAYERS-01), pinned by reading source.
//
// A tripwire, not a proof, in the house tradition. It catches the realistic
// mistakes on a destructive path: a per player loop reappearing, the browser
// deriving its own dependency counts, a second delete path, a name reaching a
// URL or a query key, or the confirmation gate being copied instead of shared.
// The last describe names the shapes it cannot catch, which are worth reading
// before a pass is mistaken for a guarantee. The behavioural halves are
// src/lib/playersBulk.test.ts, src/routes/Players.bulk.test.tsx, the migration's
// own SQL behaviour proof and tests/security/players-bulk-delete.test.ts.
// =====================================================================
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(import.meta.dirname, '..')
const ROOT = join(import.meta.dirname, '../..')

const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8')
const isTest = (f: string) => /\.test\.tsx?$/.test(f)

function sources(): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.tsx?$/.test(entry.name) && !isTest(entry.name)) out.push({ path: full, text: readFileSync(full, 'utf8') })
    }
  }
  walk(SRC)
  return out
}

// Comments removed, so a rule stated in prose does not satisfy itself.
const code = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n')

describe('one transactional delete path, never a loop', () => {
  it('the bulk surface calls the RPC and never the single row delete hook', () => {
    const modal = code(read('components/BulkDeletePlayersModal.tsx'))
    expect(modal).toContain('useBulkDeletePlayers')
    // useDeletePlayer is the one player path. Reaching for it here is how a
    // "for each player, await delete" loop gets written.
    expect(modal).not.toMatch(/useDeletePlayer\b/)
    expect(modal).not.toMatch(/for\s*\(.*of\s+playerIds/)
  })

  it('exactly one place in the app calls the delete_players RPC', () => {
    const callers = sources().filter((f) => /['"]delete_players['"]/.test(code(f.text)))
    expect(callers.map((f) => f.path.replace(ROOT + '/', ''))).toEqual(['src/lib/queries.ts'])
  })

  it('the bulk delete never issues its own table delete against players', () => {
    const queries = code(read('lib/queries.ts'))
    // The single row path keeps its one table delete; there must not be a
    // second one, and certainly not one taking a list.
    expect(queries.match(/from\('players'\)\s*\.delete\(\)/g) ?? []).toHaveLength(1)
    expect(queries).not.toMatch(/from\('players'\)[\s\S]{0,80}\.delete\(\)[\s\S]{0,40}\.in\(/)
  })
})

describe('the drop-on-filter-change rule stays in the filter handler', () => {
  it('the page calls selectionAfterFilterChange from patch, not from an effect', () => {
    const page = code(read('routes/Players.tsx'))
    const patch = page.slice(page.indexOf('const patch = '), page.indexOf('const { caps'))
    expect(patch).toContain('selectionAfterFilterChange')
    // A reaction after the fact leaves a window where a hidden player is still
    // selected, and it is what the lint rule against setState in an effect is
    // warning about. There must be no effect touching the selection at all.
    expect(page).not.toMatch(/useEffect\([\s\S]{0,200}setSelected/)
  })

  it('the page decides nothing about which filters narrow the view', () => {
    // The key list lives in playersBulk.ts so it has one test. A component
    // rebuilding it is how the two drift.
    const page = code(read('routes/Players.tsx'))
    expect(page).not.toMatch(/VIEW_KEYS/)
    expect(page).not.toMatch(/p\.team !== undefined[\s\S]{0,60}setSelected/)
  })
})

describe('the dependency counts come from the server, never from the browser', () => {
  it('the model adapts the RPC reply and computes no count of its own', () => {
    const model = code(read('lib/playersBulk.ts'))
    expect(model).toContain('parseDeletePreview')
    // No arithmetic that could be a count being derived rather than read.
    expect(model).not.toMatch(/\.filter\([^)]*\)\.length/)
    expect(model).not.toMatch(/\breduce\(/)
  })

  it('the dialog reads the preview it was given and counts nothing itself', () => {
    const modal = code(read('components/BulkDeletePlayersModal.tsx'))
    expect(modal).toContain('useDeletePlayersPreview')
    expect(modal).not.toMatch(/registrations|register_entries|spond_replies|board_tokens/)
  })

  it('the preview is never served from cache, because a stale count is the failure mode', () => {
    const queries = code(read('lib/queries.ts'))
    const hook = queries.slice(queries.indexOf('useDeletePlayersPreview'))
    expect(hook.slice(0, 900)).toMatch(/staleTime:\s*0/)
    expect(hook.slice(0, 900)).toMatch(/gcTime:\s*0/)
  })
})

describe('the confirmation gate has one implementation', () => {
  it('nothing rebuilds the typed phrase or its comparison', () => {
    for (const file of sources()) {
      if (file.path.endsWith('lib/playersBulk.ts')) continue
      const text = code(file.text)
      // The literal phrase may only be assembled in the model.
      expect(text, file.path).not.toMatch(/['"`]DELETE \$\{/)
      expect(text, file.path).not.toMatch(/DELETE \d+ PLAYERS/)
    }
  })

  it('the dialog arms on bulkDeleteConfirmed and on the preview having settled', () => {
    const modal = code(read('components/BulkDeletePlayersModal.tsx'))
    expect(modal).toContain('bulkDeleteConfirmed')
    expect(modal).toContain('previewIsStale')
    expect(modal).toMatch(/disabled=\{!confirmed \|\| deleting\}/)
  })
})

describe('no child name leaves the page', () => {
  it('the preview query key carries ids, never a name or the search term', () => {
    const queries = code(read('lib/queries.ts'))
    const hook = queries.slice(queries.indexOf('useDeletePlayersPreview'), queries.indexOf('isStaleBulkSelection'))
    expect(hook).toMatch(/queryKey: \['player-delete-preview', key\]/)
    expect(hook).not.toMatch(/displayName|display_name/)
  })

  it('the model writes no name into any string it builds', () => {
    const model = code(read('lib/playersBulk.ts'))
    expect(model).not.toMatch(/displayName/)
  })
})

describe('what this cannot catch', () => {
  it('names its own blind spots', () => {
    // Stated rather than implied, because a green run says nothing about any
    // of these:
    //
    //  1. A per player loop written through a helper, a map of promises or a
    //     variable holding the hook, rather than the literal shapes matched
    //     above. What actually rules a loop out is that the SERVER takes an
    //     array and refuses a partial run, which the migration's behaviour
    //     proof and the security suite cover.
    //  2. A count derived in a component that this file does not read by
    //     name. The three files it reads are the three that exist; a fourth
    //     surface would need adding here.
    //  3. A name reaching a log or an analytics call at runtime through a
    //     variable. Source text cannot see that; the repo's no names rule and
    //     review are what govern it.
    //  4. Anything about whether the SQL is right. The dependency graph, the
    //     transaction, the lock ordering and the audit shape are proved by
    //     executing the migration, not by reading TypeScript.
    expect(true).toBe(true)
  })
})
