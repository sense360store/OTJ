// The cache boundary between one signed in identity and the next.
//
// The QueryClient is module level (src/main.tsx) and lives for the lifetime
// of the tab, so a second member signing in on the same tab meets a cache the
// first member filled. Almost every read key in queries.ts is a bare global
// literal (['teams'], ['drills'], ['sessions'], ['players', seasonId]), and
// TanStack serves cached data first and revalidates behind it, so the first
// thing the second member's screen renders is the first member's club. A read
// corrects itself within a round trip. A write started from that render does
// not: it can submit the previous club's ids under the new identity's JWT,
// and a session insert that commits before its coverage write is refused
// leaves a session nobody covers.
//
// The rule here is about the cache rather than about keys: on any change of
// the signed in user id, every identity bound query is dropped. Scoping the
// keys by club instead was the alternative and is weaker in three ways. It
// stops the previous identity's rows being served without removing them from
// the tab. It needs a club id that is itself an async read, so every key
// would re-key mid flight through a shared undefined, which is this same bug
// with more steps. And it is a rule that roughly fifty existing read families
// and every future one have to remember, where forgetting is silent and
// presents exactly like the defect it was meant to prevent.
import type { QueryClient, QueryKey } from '@tanstack/react-query'

// The query families holding nothing bound to a signed in identity. The
// default runs the other way: anything not named here is dropped, so a read
// family added tomorrow is covered the day it is written, and widening this
// list is a deliberate act somebody reviews.
//
// The public share page reads an anonymous snapshot addressed by a share id
// and a secret carried in the URL, and its route mounts outside the auth
// guard and outside every authenticated provider (src/App.tsx). A session
// expiring while a recipient reads one would otherwise blank the page they
// are looking at.
export const ANONYMOUS_QUERY_FAMILIES: readonly string[] = ['public-share']

// Whether a cached query belongs to whoever was signed in when it was read.
// Unknown families are identity bound, which is the direction that fails
// towards dropping too much rather than serving one club's data to another.
export function isIdentityBound(queryKey: QueryKey): boolean {
  const family = Array.isArray(queryKey) ? queryKey[0] : queryKey
  return !(typeof family === 'string' && ANONYMOUS_QUERY_FAMILIES.includes(family))
}

// Reset AND remove, because neither alone is sufficient, which is measured
// rather than assumed (see queryIdentity.test.ts):
//
//   removeQueries empties the cache but leaves a mounted observer still
//   reporting the previous identity's data with status 'success'. On the path
//   where nothing unmounts, an invite or recovery link opened in a tab
//   somebody else is signed into, that is the entire defect surviving the
//   fix.
//
//   resetQueries empties the observer but keeps the entry and refetches every
//   active query at once, so a sign out fires that burst with no JWT to carry
//   it.
//
// Resetting each query and then removing it does both halves and starts
// nothing: a mounted screen drops to pending in the same tick, and React's
// next commit, which the reset itself provokes by notifying, starts the new
// identity's read. Reset also destroys the query, so a read still in flight
// for the previous identity is cancelled and cannot write its rows back after
// the drop.
export function dropIdentityBoundData(client: QueryClient): void {
  const cache = client.getQueryCache()
  for (const query of cache.findAll({ predicate: (q) => isIdentityBound(q.queryKey) })) {
    query.reset()
    cache.remove(query)
  }
  // No mutation in this app carries a mutationKey, so nothing here is shared
  // between observers, but the cache still holds the previous identity's
  // variables and results and there is no reason to carry those across.
  // Clearing notifies and drops; it does not cancel a mutation in flight, so
  // a save awaiting its own promise still settles.
  client.getMutationCache().clear()
}

// Nothing has been observed yet. A separate value from null, which is a real
// answer meaning signed out.
const UNOBSERVED = Symbol('unobserved')

// Tracks the signed in user id and drops the cache when it changes. Every
// auth observation goes through this, so a token refresh, a user update and a
// repeated initial session all report the same id and drop nothing: blowing
// the cache on each hourly refresh would be a loading flash and a refetch of
// the whole screen for no reason.
//
// The first observation counts as a change. At boot the cache holds nothing
// bound to an identity, so the drop is a no-op, and treating boot as a
// special case would be one more thing to get wrong.
export function createIdentityBoundary(client: QueryClient): (userId: string | null) => void {
  let observed: string | null | typeof UNOBSERVED = UNOBSERVED
  return (userId: string | null) => {
    if (observed === userId) return
    // Dropped before the transition is recorded, so a drop that threw part
    // way is retried on the next observation rather than recorded as done.
    dropIdentityBoundData(client)
    observed = userId
  }
}
