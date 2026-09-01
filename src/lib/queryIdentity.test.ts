// =====================================================================
// The cache boundary between one signed in identity and the next.
//
// WHAT THIS PROVES. Club A signs in and browses, club B signs in on the same
// tab, and B cannot be handed A's rows before B's own read answers. It drives
// the product's own rule, nextQueryScope, over real QueryClients and real
// QueryObservers. A subscribed QueryObserver is exactly what a mounted
// useQuery holds, so what these assertions read is what a screen would
// render.
//
// WHY THE CONTROL COMES FIRST. Every guard here is of the form "B cannot see
// A's data", which a test that never put A's data anywhere would also pass.
// The control fills one shared client the way the product used to and proves
// the leak IS observable. The guards cannot go vacuous without the control
// going red beside them.
//
// THE LATE WRITE is the case that decided the design, and it has its own
// section below. A cleared cache is a statement about one moment; the
// previous identity has work that lands after that moment and writes to the
// cache when it does.
//
// WHAT THIS DOES NOT DO. This project has no DOM, so it cannot mount the
// scope component and watch React remount the tree. That the product mounts
// it, above everything that reads the query layer and below the auth
// provider, is pinned by queryIdentity.invariant.test.ts reading the source.
// Neither half is sufficient alone.
//
// Ids and paths here are invented.
// =====================================================================
import { describe, expect, it } from 'vitest'
import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { initialQueryScope, nextQueryScope } from './queryIdentity'
import type { QueryScope } from './queryIdentity'

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
  await settle()
  return () => mounted.forEach((m) => m.unsubscribe())
}

/* Club B's screens mount and their reads have not answered yet. That instant
   is where the defect lives: TanStack hands a mounted query whatever the key
   already holds and revalidates behind it. */
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

/* The product's own transition, driven the way the scope component drives it:
   boot, then club A, then sign out, then club B. Returns the scope B's
   screens would mount under. */
function sameTabClubSwitch(): { boot: QueryScope; underA: QueryScope; underB: QueryScope } {
  let scope = initialQueryScope()
  const boot = scope
  scope = nextQueryScope(scope, null, true) // getSession has not answered
  scope = nextQueryScope(scope, A, false) // club A is signed in
  const underA = scope
  scope = nextQueryScope(scope, null, false) // SIGNED_OUT
  scope = nextQueryScope(scope, B, false) // club B signs in
  return { boot, underA, underB: scope }
}

describe('the leak, on one client that outlives a sign out', () => {
  it('hands the next member the previous club rows before their own read answers', async () => {
    const shared = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const unmount = await browseAs(shared, 'a')
    // Sign out navigates to /login and unmounts the screens. The entries stay
    // in the cache: the default gcTime is five minutes.
    unmount()

    const { mounted, release } = mountPendingReads(shared)
    for (const m of mounted) {
      expect(m.read().data, `${JSON.stringify(m.observer.options.queryKey)} leaked`).toEqual(['a-row'])
      expect(m.read().status).toBe('success')
    }
    release()
  })
})

describe('club A, sign out, club B sign in, same tab', () => {
  it('gives club B a different client from club A', () => {
    const { underA, underB } = sameTabClubSwitch()
    expect(underB.client).not.toBe(underA.client)
    expect(underB.generation).not.toBe(underA.generation)
  })

  it('leaves club B nothing of club A to read, in every family', async () => {
    const { underA, underB } = sameTabClubSwitch()
    const unmount = await browseAs(underA.client, 'a')
    for (const key of FAMILIES) expect(underA.client.getQueryData(key)).toEqual(['a-row'])
    unmount()

    const { mounted, release } = mountPendingReads(underB.client)
    for (const m of mounted) {
      const key = JSON.stringify(m.observer.options.queryKey)
      expect(m.read().data, `${key} still served club A`).toBeUndefined()
      expect(m.read().status, `${key} claimed an answer it does not have`).toBe('pending')
    }
    release()
  })

  it('and answers with club B once club B has read', async () => {
    const { underB } = sameTabClubSwitch()
    const unmount = await browseAs(underB.client, 'b')
    for (const key of FAMILIES) expect(underB.client.getQueryData(key)).toEqual(['b-row'])
    unmount()
  })
})

describe('work the previous identity left in flight', () => {
  /* THE CASE THAT DECIDED THE DESIGN. Clearing the cache on sign out is a
     statement about one moment, and this lands after it. Clearing the
     mutation cache does not cancel a mutation and does not stop its
     callbacks, and useUpsertSession's onError rolls back by writing the
     previous identity's row onto the GLOBAL ['sessions'] key. A sign out
     makes that error likely rather than exotic: the request being rolled back
     lost the JWT it was sent under. */
  it('cannot reach club B, because it writes where nobody is reading', async () => {
    const { underA, underB } = sameTabClubSwitch()

    // Club A's save was in flight across the switch. Its rollback closed over
    // the client that was current when the hook ran, which is club A's.
    const rollbackClient = underA.client
    const clubASession = [{ id: 'A-session', name: 'Titans training' }]
    rollbackClient.setQueryData(['sessions'], clubASession)
    rollbackClient.setQueryData(['sessions', 'A-session'], clubASession[0])

    expect(underB.client.getQueryData(['sessions'])).toBeUndefined()
    expect(underB.client.getQueryData(['sessions', 'A-session'])).toBeUndefined()

    // And a screen of club B's mounted on that key sees nothing of it.
    const bRead = deferred<unknown[]>()
    const { read, unsubscribe } = mount(underB.client, ['sessions'], () => bRead.promise)
    expect(read().data).toBeUndefined()
    expect(read().status).toBe('pending')
    unsubscribe()
    bRead.resolve([])
    await settle()
  })

  it('CONTROL: the same write on one shared client is served straight to club B', () => {
    const shared = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    shared.setQueryData(['sessions'], [{ id: 'A-session', name: 'Titans training' }])
    expect(shared.getQueryData(['sessions'])).toHaveLength(1)
  })
})

describe('what does not replace the client', () => {
  it('an auth answer that has not arrived', () => {
    const boot = initialQueryScope()
    // At boot getSession is still running. Reading that as signed out would
    // replace the client on the first page load of every session.
    expect(nextQueryScope(boot, null, true)).toBe(boot)
    expect(nextQueryScope(boot, A, true)).toBe(boot)
  })

  it('the first answer, which is adopted in place', () => {
    const boot = initialQueryScope()
    const first = nextQueryScope(boot, A, false)
    expect(first.client, 'the tree was remounted at boot').toBe(boot.client)
    expect(first.generation).toBe(boot.generation)
    expect(first.identity).toBe(A)
    expect(first.identified).toBe(true)
  })

  it('the same member observed again', () => {
    let scope = nextQueryScope(initialQueryScope(), A, false)
    const settled = scope
    // A token refresh, a user update, and the initial session arriving twice
    // under StrictMode all report the same id. Replacing the client on each
    // would reload every screen hourly for no reason.
    scope = nextQueryScope(scope, A, false)
    scope = nextQueryScope(scope, A, false)
    expect(scope).toBe(settled)
  })

  it('but signing out does, and signed out is a real answer rather than an absent one', () => {
    const signedIn = nextQueryScope(initialQueryScope(), A, false)
    const signedOut = nextQueryScope(signedIn, null, false)
    expect(signedOut.client).not.toBe(signedIn.client)
    expect(signedOut.identity).toBeNull()
    expect(signedOut.identified).toBe(true)
    expect(signedOut.generation).toBe(signedIn.generation + 1)
  })
})

describe('club A to club B with nothing unmounting', () => {
  /* An invite or recovery link opened in a tab somebody else is signed into.
     GoTrue consumes the hash and emits SIGNED_IN for the new user with no
     SIGNED_OUT before it, so the guard never sends anyone to /login and the
     screens stay mounted throughout. */
  it('still replaces the client, and moves the remount key that rebuilds the observers', () => {
    const signedIn = nextQueryScope(initialQueryScope(), A, false)
    const direct = nextQueryScope(signedIn, B, false)
    expect(direct.client).not.toBe(signedIn.client)
    // The key is what makes a new client reach a mounted screen at all:
    // useQuery builds its observer once, against whichever client was current
    // then, and never moves it to another.
    expect(direct.generation).toBe(signedIn.generation + 1)
  })

  it('and club A data written before the switch is unreachable after it', async () => {
    const signedIn = nextQueryScope(initialQueryScope(), A, false)
    const unmount = await browseAs(signedIn.client, 'a')
    const direct = nextQueryScope(signedIn, B, false)
    for (const key of FAMILIES) expect(direct.client.getQueryData(key)).toBeUndefined()
    unmount()
  })
})
