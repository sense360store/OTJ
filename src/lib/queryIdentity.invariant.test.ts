// =====================================================================
// A tripwire, not a proof.
//
// queryIdentity.test.ts drives the rule over real clients and proves what it
// does. It cannot prove the product MOUNTS it, because this project has no
// DOM and main.tsx is never rendered under test. So this file reads the
// source and fails the build on the realistic ways the boundary gets lost: a
// module level client coming back, the scope dropped out of the tree, the
// provider order inverted so the auth answer arrives below the cache it
// decides, or the remount key removed so a new client never reaches a screen
// that stayed mounted.
//
// A pass means nobody typed the obvious thing. It does not mean the wiring is
// correct: see the shapes named in the last describe, which this file cannot
// catch and does not pretend to.
// =====================================================================
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (name: string) => readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8')
const MAIN = read('../main.tsx')
const SCOPE = read('../components/QueryIdentityScope.tsx')
const RULE = read('./queryIdentity.ts')
const AUTH = read('../hooks/useAuth.tsx')

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

describe('the product mounts one scope and no client beside it', () => {
  it('creates a QueryClient in exactly one place, and not at module level', () => {
    const creators = ALL.filter((f) => f.body.includes('new QueryClient(')).map((f) => f.path)
    expect(creators).toEqual(['/lib/queryIdentity.ts'])
    // The defect in one line. A client built at module load lives for the tab
    // and outlives every sign out in it.
    expect(MAIN).not.toContain('new QueryClient')
  })

  it('provides the client in exactly one place', () => {
    const providers = ALL.filter((f) => f.body.includes('<QueryClientProvider')).map((f) => f.path)
    expect(providers).toEqual(['/components/QueryIdentityScope.tsx'])
  })

  it('mounts the scope below the auth answer and above everything that reads the cache', () => {
    // The order is the boundary. The scope asks useAuth who is signed in, so
    // it must sit inside AuthProvider; everything that reads the query layer
    // must sit inside the scope.
    const at = (needle: string) => MAIN.indexOf(needle)
    expect(at('<AuthProvider>')).toBeGreaterThan(-1)
    expect(at('<QueryIdentityScope>')).toBeGreaterThan(at('<AuthProvider>'))
    expect(at('<BrowserRouter>')).toBeGreaterThan(at('<QueryIdentityScope>'))
    expect(at('</QueryIdentityScope>')).toBeGreaterThan(at('</BrowserRouter>'))
  })

  it('keys the tree on the generation, which is what reaches a screen that stayed mounted', () => {
    // useQuery builds its observer once against whichever client was current
    // then. Without the remount a new client is invisible to every screen
    // already on the page, which is the whole of the direct A to B case.
    expect(SCOPE).toMatch(/key=\{next\.generation\}/)
    expect(SCOPE).toContain('client={next.client}')
  })

  it('reads the identity during render rather than from an effect', () => {
    // useQuery reads the cache while rendering, so an effect would be a
    // commit too late: the incoming member's first render would be the one
    // that reads the outgoing member's club.
    expect(SCOPE).not.toContain('useEffect')
    expect(SCOPE).toMatch(/const next = nextQueryScope\(scope, user\?\.id \?\? null, loading\)/)
  })

  it('leaves the auth flow out of the cache entirely', () => {
    // The auth flow reads Supabase directly and needs no client. Reaching for
    // one there would put it below the boundary it decides.
    expect(AUTH).not.toContain('useQueryClient')
    expect(AUTH).not.toContain('QueryClient')
  })
})

describe('the rule itself', () => {
  it('replaces the client only on a move of the user id', () => {
    const body = RULE.slice(RULE.indexOf('export function nextQueryScope'))
    expect(body).toContain('if (loading) return scope')
    expect(body).toContain('if (scope.identity === userId) return scope')
    expect(body).toContain('generation: scope.generation + 1')
    expect(body).toContain('client: new QueryClient()')
  })

  it('does not try to police the old cache instead of replacing it', () => {
    // Clearing is a statement about one moment, and the previous identity has
    // callbacks that land after it and write to the cache. If one of these
    // comes back, the design has quietly reverted to the one that could not
    // hold.
    for (const banned of ['queryClient.clear', 'removeQueries', 'resetQueries', 'getMutationCache']) {
      expect(RULE, `${banned} is the approach this replaced`).not.toContain(banned)
    }
  })
})

describe('what this file cannot catch', () => {
  it('names them, so a green run is not read as more than it is', () => {
    // 1. A client provided through a variable or a wrapper, so the literal
    //    `<QueryClientProvider` never appears.
    // 2. Nesting read by string position rather than by parsing, which a
    //    reformat or a conditional branch could satisfy while the runtime
    //    tree differs.
    // 3. Whether React actually remounts on a changed key, which is React's
    //    behaviour and needs a DOM to observe.
    // 4. A read that reaches for data some other way than a query key, which
    //    no cache rule covers.
    // The behavioural half is queryIdentity.test.ts.
    expect(true).toBe(true)
  })
})
