// The cache boundary between one signed in identity and the next.
//
// THE DEFECT. The QueryClient used to be module level (src/main.tsx) and to
// live for the lifetime of the tab, and sign out cleared nothing, so a second
// member signing in on the same tab met a cache the first member filled.
// Almost every read key in queries.ts is a bare global literal (['teams'],
// ['drills'], ['sessions'], ['players', seasonId]), and TanStack serves
// cached data first and revalidates behind it, so the first thing the second
// member's screen rendered was the first member's club. A read corrects
// itself within a round trip. A write started from that render does not: it
// can submit the previous club's ids under the new identity's JWT, and a
// session insert that commits before its coverage write is refused leaves a
// session nobody covers.
//
// THE RULE. A change of signed in user id gets a NEW QueryClient, and the
// tree under it is remounted so every observer rebuilds against it. The
// previous identity's client is simply let go: nothing renders from it, and
// it is collected once the work still holding it finishes.
//
// WHY A NEW CLIENT RATHER THAN CLEARING THE OLD ONE, which is the obvious fix
// and the one this started as. Clearing is a statement about one moment, and
// the previous identity has work outstanding that lands after that moment.
// Clearing the mutation cache does not cancel a mutation in flight and does
// not stop its callbacks, and several of those callbacks write to the cache:
// useUpsertSession's onError rolls back by writing the previous identity's
// row onto the GLOBAL ['sessions'] key, and a sign out makes exactly that
// error likely, because the request it rolls back lost the JWT it was sent
// under. So a cleared cache repopulates itself with the previous club a beat
// later. Every way of policing those late writes in place needs either a rule
// at each of the call sites that write (which one forgotten call site
// silently undoes) or a dependency on the order in which query-core fires a
// mutation's callbacks against its own state dispatch (which is internal, and
// would make this a race rather than a boundary). A callback belonging to the
// previous identity closed over the previous identity's client, so it writes
// where nobody is reading. That needs no bookkeeping and cannot be forgotten
// by a call site that has not been written yet.
//
// WHY NOT SCOPE THE KEYS BY CLUB, the other obvious fix. It stops the
// previous identity's rows being served without removing them from the tab,
// it needs a club id that is itself an async read so every key would re-key
// mid flight through a shared undefined, and it is a rule roughly fifty
// existing read families and every future one have to remember, where
// forgetting is silent and presents exactly like the defect.
import { QueryClient } from '@tanstack/react-query'

export interface QueryScope {
  // The signed in user id this cache belongs to, null for signed out.
  identity: string | null
  // Whether an auth answer has been seen at all. Separate from `identity`,
  // because null is a real answer meaning signed out and this is the absence
  // of any answer.
  identified: boolean
  // Bumped only when the client is replaced. It is the remount key, so it
  // must not move for anything else.
  generation: number
  client: QueryClient
}

export function initialQueryScope(): QueryScope {
  return { identity: null, identified: false, generation: 0, client: new QueryClient() }
}

// The scope that should be current, given what auth now says. Returns the
// SAME object when nothing should change, so the caller can compare by
// identity and a render that changes nothing costs nothing.
//
// Three rules, in order:
//
//   An unresolved auth answer changes nothing. At boot `loading` is true
//   while getSession runs, and treating that as signed out would replace the
//   client on the first page load of every session.
//
//   The first answer is adopted in place, keeping the client. Nothing bound
//   to an identity can be in a cache that has existed for one paint, and
//   remounting the tree at boot would throw away the reads already in flight.
//
//   Anything else that moves the user id replaces the client. A token
//   refresh, a user update and a repeated initial session all report the same
//   id and are not a move, so the cache is not thrown away hourly.
export function nextQueryScope(scope: QueryScope, userId: string | null, loading: boolean): QueryScope {
  if (loading) return scope
  if (!scope.identified) return { ...scope, identity: userId, identified: true }
  if (scope.identity === userId) return scope
  return { identity: userId, identified: true, generation: scope.generation + 1, client: new QueryClient() }
}
