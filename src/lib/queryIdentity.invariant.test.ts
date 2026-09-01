// =====================================================================
// A tripwire, not a proof.
//
// queryIdentity.test.ts drives the boundary over a real cache and proves what
// it does. It cannot prove that the product CALLS it, because this project has
// no DOM and AuthProvider's effects never run under a static render. So this
// file reads the source instead and fails the build on the realistic ways the
// wiring gets lost: a third auth observation added without the boundary, the
// boundary moved to after the session state it is supposed to precede, a
// second listener registered somewhere else where ordering becomes a race,
// and a second implementation of the drop.
//
// A pass means nobody typed the obvious thing. It does not mean the wiring is
// correct: see the shapes named in the last describe below, which this file
// cannot catch and does not pretend to.
// =====================================================================
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (name: string) => readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8')
const AUTH = read('../hooks/useAuth.tsx')
const BOUNDARY = read('./queryIdentity.ts')
const MAIN = read('../main.tsx')

const SRC = fileURLToPath(new URL('..', import.meta.url))
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = `${dir}/${entry}`
    if (statSync(full).isDirectory()) return sourceFiles(full)
    if (!/\.tsx?$/.test(entry) || /\.test\.tsx?$/.test(entry)) return []
    return [full]
  })
}
const ALL = sourceFiles(SRC).map((path) => ({ path: path.slice(SRC.length), body: readFileSync(path, 'utf8') }))

describe('the auth path calls the boundary', () => {
  it('builds one, from the shared factory', () => {
    expect(AUTH).toContain("import { createIdentityBoundary } from '../lib/queryIdentity'")
    expect(AUTH).toMatch(/useState\(\(\)\s*=>\s*createIdentityBoundary\(queryClient\)\)/)
  })

  it('observes the identity before the session state that renders the new member screens', () => {
    // The ordering is the whole point. setSession is what mounts the incoming
    // member's tree, and useQuery reads the cache during render, so a drop
    // that happens after it has already been beaten by one commit.
    const lines = AUTH.split('\n')
    const sets = lines.map((line, i) => [line, i] as const).filter(([line]) => line.includes('setSession('))
    expect(sets.length, 'a new session write needs the boundary in front of it, so look at this').toBe(2)
    for (const [, i] of sets) {
      const before = lines.slice(0, i).reverse().find((line) => line.trim() !== '') ?? ''
      expect(before, `the line above setSession on line ${i + 1} is not the boundary`).toContain('observeIdentity(')
    }
  })

  it('reads the identity off the auth observation itself, not off React state', () => {
    // session state lags the event by a commit, so reading it here would drop
    // the cache one identity late.
    expect(AUTH).toContain('observeIdentity(data.session?.user?.id ?? null)')
    expect(AUTH).toContain('observeIdentity(next?.user?.id ?? null)')
  })
})

describe('one listener, one implementation', () => {
  it('subscribes to auth state in exactly one place', () => {
    // A second onAuthStateChange listener would make the drop depend on
    // registration order against the one that sets the session.
    const listeners = ALL.filter((f) => f.body.includes('onAuthStateChange')).map((f) => f.path)
    expect(listeners).toEqual(['/hooks/useAuth.tsx'])
    expect(BOUNDARY).not.toContain('onAuthStateChange')
    expect(BOUNDARY).not.toContain('supabase')
  })

  it('reaches into the cache in exactly one place', () => {
    const reachers = ALL.filter((f) => /getQueryCache\(|getMutationCache\(|\bresetQueries\(/.test(f.body)).map((f) => f.path)
    expect(reachers).toEqual(['/lib/queryIdentity.ts'])
  })

  it('keeps the QueryClient module level, which is why the boundary is needed at all', () => {
    // If this ever became per-session, the boundary would be dead code rather
    // than silently half working, and this test is where that gets noticed.
    expect(MAIN).toContain('const queryClient = new QueryClient()')
  })

  it('drops by default and names the anonymous families in one closed list', () => {
    expect(BOUNDARY).toMatch(/export const ANONYMOUS_QUERY_FAMILIES: readonly string\[\] = \['public-share'\]/)
    // The predicate answers from the list. An added `|| family === 'x'` is a
    // second list, and the point of the list is that there is only one.
    const predicate = BOUNDARY.slice(BOUNDARY.indexOf('export function isIdentityBound'))
    expect(predicate.slice(0, predicate.indexOf('\n}'))).toContain('ANONYMOUS_QUERY_FAMILIES.includes(family)')
  })

  it('resets as well as removes', () => {
    // Measured in queryIdentity.test.ts: removing alone leaves a mounted
    // observer still reporting the previous identity's rows as a success.
    const drop = BOUNDARY.slice(BOUNDARY.indexOf('export function dropIdentityBoundData'))
    const body = drop.slice(0, drop.indexOf('\n}'))
    expect(body).toContain('query.reset()')
    expect(body).toContain('cache.remove(query)')
  })
})

describe('what this file cannot catch', () => {
  it('names them, so a green run is not read as more than it is', () => {
    // 1. The boundary called through a variable or a wrapper, so the literal
    //    `observeIdentity(` never appears above setSession.
    // 2. A drop made conditional inside createIdentityBoundary on something
    //    that is false in production.
    // 3. A new authenticated read reaching for data some other way than a
    //    query key, which no cache rule covers.
    // 4. Whether the identity a screen renders under is the one its rows were
    //    read under, which is a question about React commits and needs a DOM.
    // The behavioural half is queryIdentity.test.ts; the browser half is
    // tools/visual.
    expect(true).toBe(true)
  })
})
