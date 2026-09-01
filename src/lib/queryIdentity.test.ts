// =====================================================================
// The cache boundary between one signed in identity and the next.
//
// WHAT THIS PROVES. Club A signs in and browses, club B signs in on the same
// tab, and B cannot be handed A's rows out of cache before B's own read
// answers. It drives the product's own boundary, createIdentityBoundary, the
// function hooks/useAuth.tsx calls on every auth observation, over a real
// QueryClient with real QueryObservers. A subscribed QueryObserver is exactly
// what a mounted useQuery holds, so what these assertions read is what a
// screen would render.
//
// WHY THE CONTROL COMES FIRST. Every guard below is of the form "B cannot see
// A's data", which a test that never put A's data anywhere would also pass.
// The control fills the same cache with the same rows and no boundary, and
// proves the leak IS observable. The guard cannot go vacuous without the
// control going red beside it.
//
// WHAT THIS DOES NOT DO. This project has no DOM, so it cannot mount
// AuthProvider and run its effects. That the provider calls the boundary at
// all, and calls it BEFORE the session state that renders the new member's
// screens, is pinned by queryIdentity.invariant.test.ts, which reads the
// source. Neither half is sufficient alone.
//
// Ids and paths here are invented.
// =====================================================================
import { describe, expect, it } from 'vitest'
import { MutationObserver, QueryClient, QueryObserver } from '@tanstack/react-query'
import {
  ANONYMOUS_QUERY_FAMILIES,
  createIdentityBoundary,
  dropIdentityBoundData,
  isIdentityBound,
} from './queryIdentity'

const A = 'user-a-00000000'
const B = 'user-b-11111111'

/* The read families a coach's screens fill, keyed exactly as queries.ts keys
   them. Every one is a bare global literal carrying no identity, which is the
   mechanism this closes. Teams is the family the reported defect ran through;
   the rest are here so the guard proves a rule about the cache rather than a
   patch on one key. */
const FAMILIES: readonly (readonly unknown[])[] = [
  ['teams'],
  ['drills'],
  ['sessions'],
  ['club'],
  ['players', 'season-1'],
  ['register_entries', 'session-1'],
  ['media-url', 'clubs/a/crest.png'],
]

const SHARE: readonly unknown[] = ['public-share', 'share-1']

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } })
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

/* A mounted useQuery, as far as the cache is concerned. */
function mount<T>(qc: QueryClient, queryKey: readonly unknown[], queryFn: () => Promise<T>) {
  const observer = new QueryObserver(qc, { queryKey, queryFn })
  const unsubscribe = observer.subscribe(() => {})
  return { observer, unsubscribe, read: () => observer.getCurrentResult() }
}

/* Club A signs in and browses: every family is read and cached. */
async function browseAs(qc: QueryClient, club: string) {
  const mounted = FAMILIES.map((key) => mount(qc, key, async () => [`${club}-row`]))
  mounted.push(mount(qc, SHARE, async () => [`${club}-share`]))
  await settle()
  return () => mounted.forEach((m) => m.unsubscribe())
}

/* Club B's screens mount and their reads have not answered yet. This is the
   exact instant the defect lives in: TanStack hands a mounted query whatever
   the key already holds and revalidates behind it. */
function mountPendingReads(qc: QueryClient) {
  const pending = deferred<string[]>()
  const mounted = FAMILIES.map((key) => mount(qc, key, () => pending.promise))
  return {
    mounted,
    release: () => {
      mounted.forEach((m) => m.unsubscribe())
      pending.resolve(['b-row'])
    },
  }
}

describe('the leak, with no boundary', () => {
  it('hands the next member the previous club rows before their own read answers', async () => {
    const qc = client()
    const unmount = await browseAs(qc, 'a')
    // Sign out navigates to /login and unmounts the screens. The entries stay
    // in the cache: the default gcTime is five minutes.
    unmount()

    const { mounted, release } = mountPendingReads(qc)
    for (const m of mounted) {
      expect(m.read().data, `${JSON.stringify(m.observer.options.queryKey)} leaked`).toEqual(['a-row'])
      expect(m.read().status).toBe('success')
    }
    release()
  })
})

describe('club A, sign out, club B sign in, same tab', () => {
  it('leaves club B nothing of club A to read, in every family', async () => {
    const qc = client()
    const observeIdentity = createIdentityBoundary(qc)

    observeIdentity(A)
    const unmount = await browseAs(qc, 'a')
    for (const key of FAMILIES) expect(qc.getQueryData(key)).toEqual(['a-row'])

    observeIdentity(null)
    unmount()
    observeIdentity(B)

    const { mounted, release } = mountPendingReads(qc)
    for (const m of mounted) {
      const key = JSON.stringify(m.observer.options.queryKey)
      expect(m.read().data, `${key} still served club A`).toBeUndefined()
      expect(m.read().status, `${key} claimed an answer it does not have`).toBe('pending')
    }
    release()
  })

  it('removes the entries rather than only refusing to serve them', async () => {
    const qc = client()
    const observeIdentity = createIdentityBoundary(qc)
    observeIdentity(A)
    const unmount = await browseAs(qc, 'a')
    unmount()

    observeIdentity(null)

    for (const key of FAMILIES) expect(qc.getQueryData(key)).toBeUndefined()
    // Nothing identity bound is retained in the tab at all, which club scoped
    // keys would not have achieved: they stop the rows being served and leave
    // them in memory until gcTime.
    const retained = qc
      .getQueryCache()
      .getAll()
      .map((q) => q.queryKey)
    expect(retained.filter((key) => isIdentityBound(key))).toEqual([])
  })
})

describe('club A to club B with nothing unmounting', () => {
  /* An invite or recovery link opened in a tab somebody else is signed into.
     GoTrue consumes the hash and emits SIGNED_IN for the new user with no
     SIGNED_OUT before it, so the guard never sends anyone to /login and the
     screens stay mounted throughout. This is the case removeQueries alone
     does not close: it empties the cache and leaves the mounted observer
     still reporting the previous identity's rows with status 'success'. */
  it('drops the mounted screen to pending in the same tick', async () => {
    const qc = client()
    const observeIdentity = createIdentityBoundary(qc)
    observeIdentity(A)

    let club = 'a'
    const options = { queryKey: ['teams'], queryFn: async () => [`${club}-team`] }
    const observer = new QueryObserver(qc, options)
    const unsubscribe = observer.subscribe(() => {})
    await settle()
    expect(observer.getCurrentResult().data).toEqual(['a-team'])

    club = 'b'
    observeIdentity(B)

    expect(observer.getCurrentResult().data, 'the screen was still showing club A').toBeUndefined()
    expect(observer.getCurrentResult().status).toBe('pending')
    unsubscribe()
  })

  it('and picks up club B on the next commit', async () => {
    const qc = client()
    const observeIdentity = createIdentityBoundary(qc)
    observeIdentity(A)

    let club = 'a'
    const options = { queryKey: ['teams'], queryFn: async () => [`${club}-team`] }
    const observer = new QueryObserver(qc, options)
    const unsubscribe = observer.subscribe(() => {})
    await settle()

    club = 'b'
    observeIdentity(B)
    // The reset notifies, so React re-renders and useQuery's effect calls
    // setOptions again. That is the commit the screen is left waiting for,
    // and it is why the boundary starts no fetch of its own: a sign out would
    // fire that burst with no JWT to carry it.
    observer.setOptions(options)
    await settle()

    expect(observer.getCurrentResult().data).toEqual(['b-team'])
    unsubscribe()
  })
})

describe('what the boundary leaves alone', () => {
  it('drops nothing when the same member is observed again', async () => {
    const qc = client()
    const observeIdentity = createIdentityBoundary(qc)
    observeIdentity(A)
    const unmount = await browseAs(qc, 'a')

    // A token refresh, a user update, and the initial session arriving twice
    // under StrictMode all report the same id. Dropping on each would be a
    // whole screen reloading every hour for no reason.
    observeIdentity(A)
    observeIdentity(A)

    for (const key of FAMILIES) expect(qc.getQueryData(key)).toEqual(['a-row'])
    unmount()
  })

  it('keeps the anonymous public share, whose route mounts outside the guard', async () => {
    const qc = client()
    const observeIdentity = createIdentityBoundary(qc)
    observeIdentity(A)
    const unmount = await browseAs(qc, 'a')
    unmount()

    observeIdentity(null)

    expect(qc.getQueryData(SHARE)).toEqual(['a-share'])
  })

  it('names exactly one anonymous family, and treats every unknown family as identity bound', () => {
    expect([...ANONYMOUS_QUERY_FAMILIES]).toEqual(['public-share'])
    expect(isIdentityBound(['public-share', 'x'])).toBe(false)
    // The default direction. A read family written tomorrow is covered
    // without anybody remembering to opt it in.
    expect(isIdentityBound(['a_table_nobody_has_written_yet'])).toBe(true)
    expect(isIdentityBound(['teams'])).toBe(true)
    expect(isIdentityBound([])).toBe(true)
  })
})

describe('a read still in flight for the previous identity', () => {
  it('cannot write its rows back after the drop', async () => {
    const qc = client()
    const observeIdentity = createIdentityBoundary(qc)
    observeIdentity(A)

    const slow = deferred<string[]>()
    const { unsubscribe } = mount(qc, ['teams'], () => slow.promise)
    await settle()
    expect(qc.getQueryData(['teams'])).toBeUndefined()

    observeIdentity(null)
    unsubscribe()
    // Club A's select finally answers, after the boundary has run.
    slow.resolve(['a-team'])
    await settle()
    await settle()

    expect(qc.getQueryData(['teams'])).toBeUndefined()
  })
})

describe('the mutation cache', () => {
  it('does not carry the previous identity variables and results across', async () => {
    const qc = client()
    const observer = new MutationObserver(qc, { mutationFn: async (v: string) => `saved:${v}` })
    await observer.mutate('club-a-session')
    expect(qc.getMutationCache().getAll()).toHaveLength(1)

    dropIdentityBoundData(qc)

    expect(qc.getMutationCache().getAll()).toEqual([])
  })
})
