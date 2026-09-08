// =====================================================================
// COACH-11: the draft that survives a trip to the Drill Maker.
//
// Both planning hosts hold an unsaved draft, and leaving to draw must
// not lose either. The rule is decided once here: the draft is stashed
// ONE SHOT under a random token that only the return address carries,
// bound to the signed in user, and taken exactly once by the host that
// mounts on the way back. Everything in this file is pure over an
// injected storage, so a private window, a full storage and a stash left
// by somebody else are all cases rather than surprises.
// =====================================================================
import { describe, expect, it } from 'vitest'
import {
  AUTHORING_STASH_KEY,
  DRAFT_PARAM,
  RETURN_PARAM,
  drawPath,
  readDraftToken,
  safeReturnPath,
  dropDraft,
  peekDraft,
  stashDraft,
  takeDraft,
  withDraftToken,
  type StorageLike,
} from './authoringReturn'

function memoryStorage(): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>()
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v)
    },
    removeItem: (k) => {
      map.delete(k)
    },
  }
}

const ME = 'coach-me'
const stash = (over: Partial<Parameters<typeof stashDraft>[1]> = {}) => ({
  token: 'tok-1',
  userId: ME,
  host: 'planner' as const,
  id: 'session-1',
  draft: { name: 'Tuesday', activities: [{ phase: 'Skill', drillId: 'd-new', duration: 10 }] },
  ...over,
})

describe('stashDraft and takeDraft', () => {
  it('round trips a draft once, then the stash is gone', () => {
    const s = memoryStorage()
    expect(stashDraft(s, stash())).toBe(true)
    expect(s.map.has(AUTHORING_STASH_KEY)).toBe(true)
    const taken = takeDraft<{ name: string }>(s, { host: 'planner', token: 'tok-1', userId: ME })
    expect(taken).toEqual({ id: 'session-1', draft: stash().draft })
    // ONE SHOT. A second read, a refresh of the return address included,
    // finds nothing rather than restoring the same draft twice.
    expect(takeDraft(s, { host: 'planner', token: 'tok-1', userId: ME })).toBeNull()
    expect(s.map.has(AUTHORING_STASH_KEY)).toBe(false)
  })

  it('refuses a stash left by a different signed in user, and clears it', () => {
    // The tab can change hands: an invite link opened in a tab somebody
    // else was signed into emits SIGNED_IN with no SIGNED_OUT (see the
    // cache boundary in CLAUDE.md). A draft names a session, so it never
    // crosses an identity.
    const s = memoryStorage()
    stashDraft(s, stash())
    expect(takeDraft(s, { host: 'planner', token: 'tok-1', userId: 'coach-them' })).toBeNull()
    expect(s.map.has(AUTHORING_STASH_KEY)).toBe(false)
  })

  it('refuses a token that is not the one the return address carries, and clears it', () => {
    const s = memoryStorage()
    stashDraft(s, stash())
    expect(takeDraft(s, { host: 'planner', token: 'tok-other', userId: ME })).toBeNull()
    expect(s.map.has(AUTHORING_STASH_KEY)).toBe(false)
  })

  it('refuses a stash made for the other host, and clears it', () => {
    // A planner draft restored into the week plan editor would be a
    // session's fields read as a template's. The host is part of the match.
    const s = memoryStorage()
    stashDraft(s, stash({ host: 'template', id: null }))
    expect(takeDraft(s, { host: 'planner', token: 'tok-1', userId: ME })).toBeNull()
    expect(s.map.has(AUTHORING_STASH_KEY)).toBe(false)
  })

  it('keeps a null id as a real value, which is how a new session or template is named', () => {
    const s = memoryStorage()
    stashDraft(s, stash({ id: null }))
    expect(takeDraft(s, { host: 'planner', token: 'tok-1', userId: ME })).toEqual({ id: null, draft: stash().draft })
  })

  it('writes nothing without a signed in user, and says so', () => {
    const s = memoryStorage()
    expect(stashDraft(s, stash({ userId: '' }))).toBe(false)
    expect(s.map.size).toBe(0)
  })

  it('reports a storage that cannot be written rather than throwing', () => {
    // Safari private mode and a full quota both throw on setItem. The
    // caller must not navigate on a false, because the draft would be lost.
    const s: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
      removeItem: () => {},
    }
    expect(stashDraft(s, stash())).toBe(false)
    expect(stashDraft(null, stash())).toBe(false)
  })

  it('reads a corrupt or foreign entry as nothing, and clears it', () => {
    const s = memoryStorage()
    s.setItem(AUTHORING_STASH_KEY, '{not json')
    expect(takeDraft(s, { host: 'planner', token: 'tok-1', userId: ME })).toBeNull()
    expect(s.map.has(AUTHORING_STASH_KEY)).toBe(false)
    s.setItem(AUTHORING_STASH_KEY, JSON.stringify({ token: 'tok-1', userId: ME }))
    expect(takeDraft(s, { host: 'planner', token: 'tok-1', userId: ME })).toBeNull()
    expect(takeDraft(null, { host: 'planner', token: 'tok-1', userId: ME })).toBeNull()
  })

  it('takes nothing without a token, and touches nothing', () => {
    // No token means the host was opened normally. A stash somebody left
    // earlier in the tab stays for the return trip it belongs to.
    const s = memoryStorage()
    stashDraft(s, stash())
    expect(takeDraft(s, { host: 'planner', token: null, userId: ME })).toBeNull()
    expect(s.map.has(AUTHORING_STASH_KEY)).toBe(true)
  })
})

describe('the return address', () => {
  it('carries the token as its own query parameter, whichever shape the path has', () => {
    expect(withDraftToken('/planner', 'tok')).toBe(`/planner?${DRAFT_PARAM}=tok`)
    expect(withDraftToken('/planner?sessionId=s1', 'tok')).toBe(`/planner?sessionId=s1&${DRAFT_PARAM}=tok`)
    expect(withDraftToken('/programmes/p1', 'tok')).toBe(`/programmes/p1?${DRAFT_PARAM}=tok`)
  })

  it('reads the token back from a search string, and nothing from a search without one', () => {
    expect(readDraftToken(`?sessionId=s1&${DRAFT_PARAM}=tok`)).toBe('tok')
    expect(readDraftToken('?sessionId=s1')).toBeNull()
    expect(readDraftToken('')).toBeNull()
  })

  it('opens the Drill Maker on the new drill with the return address encoded whole', () => {
    const p = drawPath('d-new', '/planner?sessionId=s1&draft=tok')
    expect(p).toBe(`/drill/d-new/diagram?${RETURN_PARAM}=${encodeURIComponent('/planner?sessionId=s1&draft=tok')}`)
    // Decoded by the same grammar the editor reads it with.
    const url = new URL(p, 'http://x')
    expect(url.searchParams.get(RETURN_PARAM)).toBe('/planner?sessionId=s1&draft=tok')
  })
})

describe('safeReturnPath', () => {
  it('accepts only the two planning surfaces and the programme page', () => {
    expect(safeReturnPath('/planner')).toBe('/planner')
    expect(safeReturnPath('/planner?sessionId=s1&draft=tok')).toBe('/planner?sessionId=s1&draft=tok')
    expect(safeReturnPath('/templates?draft=tok')).toBe('/templates?draft=tok')
    expect(safeReturnPath('/programmes/p1?draft=tok')).toBe('/programmes/p1?draft=tok')
  })

  it('refuses anything that could leave the app or land somewhere else', () => {
    // A parameter in a URL is attacker typed text. Back never goes off site,
    // never to a scheme, and never to a screen this flow did not come from.
    for (const bad of [
      null,
      undefined,
      '',
      'https://example.com/planner',
      '//example.com',
      '/\\example.com',
      'javascript:alert(1)',
      '/library',
      '/drill/d1',
      '/plannerx',
      '/programmes',
      'planner',
      '/planner\nX',
    ]) {
      expect(safeReturnPath(bad), String(bad)).toBeNull()
    }
  })
})

// COACH-11, Codex's fourth finding. The stash is read from a lazy useState
// initializer, which React runs DURING RENDER and may run twice (StrictMode
// does exactly that) or throw away before committing. A read that removed
// the entry there could destroy the only copy on a render nobody adopted,
// and the next one would find nothing and fall back to the saved or blank
// plan, losing the draft the whole flow exists to carry. So the read is
// pure and the removal is the host's, from a committed effect.
describe('the read is pure and the removal is separate', () => {
  it('peekDraft returns the draft and leaves it where it was', () => {
    const s = memoryStorage()
    stashDraft(s, stash())
    const expect_ = { host: 'planner' as const, token: 'tok-1', userId: ME }
    const first = peekDraft(s, expect_)
    expect(first).toEqual({ id: 'session-1', draft: stash().draft })
    // The entry is still there, which is the whole point.
    expect(s.map.has(AUTHORING_STASH_KEY)).toBe(true)
  })

  it('survives a render that is double invoked and then abandoned', () => {
    // The exact shape StrictMode produces: the initializer runs, runs
    // again, and only then does a render commit and the effect clear.
    // Every peek must answer the same, because any of them could be the
    // one whose result React keeps.
    const s = memoryStorage()
    stashDraft(s, stash())
    const expect_ = { host: 'planner' as const, token: 'tok-1', userId: ME }
    const a = peekDraft(s, expect_)
    const b = peekDraft(s, expect_)
    const c = peekDraft(s, expect_)
    expect(a).toEqual(b)
    expect(b).toEqual(c)
    expect(c).toEqual({ id: 'session-1', draft: stash().draft })
    // Then the committed effect clears it, once.
    dropDraft(s)
    expect(s.map.has(AUTHORING_STASH_KEY)).toBe(false)
    expect(peekDraft(s, expect_)).toBeNull()
  })

  it('dropDraft clears a stash that did NOT match, which is the stale rule', () => {
    // The combined read always cleared on a mismatch, because an entry
    // that did not match this trip is nobody's. Splitting the two halves
    // must not quietly drop that.
    const s = memoryStorage()
    stashDraft(s, stash())
    expect(peekDraft(s, { host: 'planner', token: 'other-token', userId: ME })).toBeNull()
    dropDraft(s)
    expect(s.map.has(AUTHORING_STASH_KEY)).toBe(false)
  })

  it('dropDraft on a storage that throws is silent, and takeDraft still composes the two', () => {
    expect(() => dropDraft({ getItem: () => null, setItem: () => {}, removeItem: () => { throw new Error('nope') } })).not.toThrow()
    expect(() => dropDraft(null)).not.toThrow()
    // takeDraft is the two halves together and behaves exactly as before.
    const s = memoryStorage()
    stashDraft(s, stash())
    expect(takeDraft(s, { host: 'planner', token: 'tok-1', userId: ME })).toEqual({ id: 'session-1', draft: stash().draft })
    expect(s.map.has(AUTHORING_STASH_KEY)).toBe(false)
  })
})

