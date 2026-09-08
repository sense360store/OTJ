// =====================================================================
// COACH-11: keeping a plan's draft across a trip to the Drill Maker.
//
// THE HAZARD, AND IT HAS TWO CASES. A coach writing a plan creates a
// drill and wants to draw it. The Drill Maker is a full screen route
// outside the shell (src/routes/DrillDiagramEditor.tsx), so leaving to
// draw unmounts whichever host they came from, and both hosts hold an
// unsaved draft: the dated session planner's lives in React state behind
// sessionSubmit.ts, and the week plan editor's lives in a modal's own
// form state, which unmounts with the modal. Neither is saved by
// leaving, and nothing here saves it: "nothing persists until Save" is a
// rule of both surfaces and this does not bend it.
//
// THE RULE, DECIDED ONCE. Before the navigation, the host's whole draft
// (the new activity already in it) is written to the tab's session
// storage as ONE entry, under a random token that only the return
// address carries, bound to the signed in user and to the host it came
// from. The Drill Maker is opened with that return address, and its
// Back goes there. The host that mounts on the way back reads the token
// from its own address, takes the entry EXACTLY ONCE and adopts the
// draft as its initial state. A refresh of the return address, a
// different token, a different user, a different host, a corrupt entry
// and a storage that cannot be written are all cases below, and every
// one of them answers "no draft" rather than the wrong draft.
//
// WHY SESSION STORAGE AND NOT MEMORY. The Drill Maker is the pitch side
// screen, and a phone browser discards and reloads a background tab
// under memory pressure; an in memory stash would lose the plan exactly
// there. Session storage is per tab, so two tabs cannot cross, and it
// names no person: a draft carries a session's fields and activity ids.
// The identity check is what the cache boundary in CLAUDE.md asks of any
// state that outlives a sign out in the same tab.
//
// This module is pure over an injected storage so that every case is a
// test. The React halves are in src/components/PlanDrillAuthoring.tsx.
// =====================================================================

export const AUTHORING_STASH_KEY = 'otj_authoring_draft'
// The parameter a host reads its token from, on its own address.
export const DRAFT_PARAM = 'draft'
// The parameter the Drill Maker reads its way back from.
export const RETURN_PARAM = 'return'

export type AuthoringHost = 'planner' | 'template'

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface AuthoringStash<D> {
  token: string
  userId: string
  host: AuthoringHost
  // The session or template being edited, or null for one not yet saved.
  id: string | null
  draft: D
}

// The browser's session storage, or null where touching it throws (some
// private modes throw on access itself, not only on write).
export function browserSessionStorage(): StorageLike | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage
  } catch {
    return null
  }
}

export function newDraftToken(): string {
  return crypto.randomUUID()
}

// Writes the one entry. False means it could not be written, and a caller
// MUST NOT navigate on false: the draft would be lost.
export function stashDraft<D>(storage: StorageLike | null, stash: AuthoringStash<D>): boolean {
  if (!storage || !stash.userId || !stash.token) return false
  try {
    storage.setItem(AUTHORING_STASH_KEY, JSON.stringify(stash))
    return true
  } catch {
    return false
  }
}

// Reads the entry and REMOVES NOTHING. The draft comes back only when the
// token, the user and the host all match. A read with no token is a host
// opened normally and touches nothing.
//
// Pure on purpose, and that is the whole reason this is separate from the
// removal. React reads a host's initial state in a lazy useState
// initializer, which runs DURING RENDER, and a render can be double
// invoked (StrictMode does exactly that) or abandoned before it commits.
// A read that destroyed the stash there could throw the only copy away on
// a render nobody adopted, and the next one would find nothing and fall
// back to the saved or blank plan. So the render half only looks, and the
// host removes the entry from an effect once the render has committed.
export function peekDraft<D>(
  storage: StorageLike | null,
  expect: { host: AuthoringHost; token: string | null; userId: string | null | undefined },
): { id: string | null; draft: D } | null {
  if (!storage || !expect.token) return null
  let raw: string | null
  try {
    raw = storage.getItem(AUTHORING_STASH_KEY)
  } catch {
    return null
  }
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const s = parsed as Partial<AuthoringStash<D>>
  if (s.token !== expect.token || !expect.userId || s.userId !== expect.userId || s.host !== expect.host) return null
  if (!('draft' in s) || s.draft === undefined) return null
  return { id: typeof s.id === 'string' ? s.id : null, draft: s.draft as D }
}

// The destructive half, called once the adopting render has COMMITTED. It
// clears whatever is there, matched or not, which is the same rule the
// combined read always had: an entry that did not match this trip is stale
// and nobody is coming back for it. The caller decides WHETHER to call
// this, and calls it only when it actually attempted a take, so a host
// opened with no token still touches nothing.
export function dropDraft(storage: StorageLike | null): void {
  if (!storage) return
  try {
    storage.removeItem(AUTHORING_STASH_KEY)
  } catch {
    // A storage that refuses a write leaves the entry; the token is one
    // shot in the address either way, so it is never adopted twice.
  }
}

// Read and remove in one call, which is what a caller outside a React
// render wants. Composed from the two halves so there is ONE validation
// rule rather than two that agree today.
export function takeDraft<D>(
  storage: StorageLike | null,
  expect: { host: AuthoringHost; token: string | null; userId: string | null | undefined },
): { id: string | null; draft: D } | null {
  const found = peekDraft<D>(storage, expect)
  if (expect.token) dropDraft(storage)
  return found
}

export function withDraftToken(path: string, token: string): string {
  return `${path}${path.includes('?') ? '&' : '?'}${DRAFT_PARAM}=${encodeURIComponent(token)}`
}

export function readDraftToken(search: string): string | null {
  return new URLSearchParams(search).get(DRAFT_PARAM)
}

export function drawPath(drillId: string, returnTo: string): string {
  return `/drill/${drillId}/diagram?${RETURN_PARAM}=${encodeURIComponent(returnTo)}`
}

// The only addresses Back may go to from a Drill Maker opened by a plan.
// A query parameter is text anybody can type, so this is an allowlist by
// prefix rather than a check for "looks relative": a protocol relative
// address, a scheme, a bare word and every screen this flow does not
// come from are refused.
const RETURN_PREFIXES = ['/planner', '/templates', '/programmes/']

export function safeReturnPath(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null
  if (/[\s\\]/.test(raw)) return null
  if (!raw.startsWith('/') || raw.startsWith('//')) return null
  const ok = RETURN_PREFIXES.some((p) => {
    if (!raw.startsWith(p)) return false
    const rest = raw.slice(p.length)
    // The prefix must be the whole segment: '/plannerx' is not the planner,
    // and '/programmes/' needs an id after it.
    if (p.endsWith('/')) return rest.length > 0 && rest[0] !== '?'
    return rest === '' || rest.startsWith('?')
  })
  return ok ? raw : null
}
