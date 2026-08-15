// =====================================================================
// British English copy, pinned mechanically.
//
// The club speaks British English, and "roster" is the American word for
// what the product calls registered players, the player list or the
// squad. Internal names keep it freely (activeRoster, rosterForSession,
// the /roster redirect, the 'roster' entry source, spond-roster-import),
// because identifiers are not copy. What may never carry it is a string
// a user reads, in the app or in an Edge Function reply that the app
// renders (spond-roster-import's errors reach a modal verbatim).
//
// The excuse rule is mechanical: a quoted literal whose WHOLE content is
// a bare machine token (lowercase letters, digits, underscores, slashes,
// hyphens) is an identifier in quotes, 'not_on_roster' or a route path,
// and stays. Anything with a space, a capital or surrounding prose is a
// sentence and fails. Bare JSX text is always a sentence.
//
// A tripwire, not a proof, in the house tradition: a string assembled at
// runtime or hidden behind a variable escapes it. What it catches is the
// realistic edit, typing the word back into a label.
// =====================================================================
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(import.meta.dirname, '..')
const FUNCTIONS = join(import.meta.dirname, '../../supabase/functions')

const isTest = (f: string) => /\.test\.tsx?$|_test\.ts$/.test(f)

function files(): string[] {
  const out: string[] = []
  const collect = (root: string) => {
    const inner = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) inner(full)
        else if (/\.tsx?$/.test(entry.name) && !isTest(entry.name)) out.push(full)
      }
    }
    inner(root)
  }
  collect(SRC)
  // The Edge Functions whose reply and warning strings render client side.
  for (const fn of ['spond-roster-import', 'spond-link-members', 'spond-sync']) {
    out.push(join(FUNCTIONS, fn, 'index.ts'))
  }
  const shared = join(FUNCTIONS, '_shared')
  for (const entry of readdirSync(shared, { withFileTypes: true })) {
    if (/\.ts$/.test(entry.name) && !isTest(entry.name)) out.push(join(shared, entry.name))
  }
  return out
}

// Source with comments removed, the tonight.invariant.test.ts helper,
// plus console lines: a server log prefix like
// 'spond-roster-import: login failed' is operator output, not copy, and
// the functions' own no-names logging rule already governs it.
const code = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//') && !/^\s*console\./.test(l))
    .join('\n')

const MACHINE_TOKEN = /^[a-z0-9_/-]+$/
const LITERAL = /(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g

describe('no user-visible string says roster', () => {
  it('holds across the app and the Edge Function replies', () => {
    for (const file of files()) {
      const src = code(readFileSync(file, 'utf8'))
      // Bare JSX text is copy by definition.
      expect(src, file).not.toMatch(/>[^<>{}\n]*\broster\b[^<>{}\n]*</i)
      // A quoted literal carrying the word must be a bare machine token.
      for (const match of src.matchAll(LITERAL)) {
        const content = match[2]
        if (!/\broster\b/i.test(content)) continue
        expect(content, `${file}: "${content}"`).toMatch(MACHINE_TOKEN)
      }
    }
  })
})
