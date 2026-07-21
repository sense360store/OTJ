import { describe, expect, it, vi } from 'vitest'
import {
  canNativeShare,
  canonicalPath,
  canonicalUrl,
  copyLink,
  createShareRunner,
  currentOrigin,
  shareFeedback,
  shareLink,
  SHARE_COPY_FAILED,
  type ShareCapableNavigator,
  type SharePayload,
  type ShareResult,
} from './share'

// The internal share helper is pure and injectable, so every branch is proven
// without a DOM: canonical URL construction, navigator.share detection and
// invocation, the clipboard fallback, and the deterministic result the UI maps
// to plain-language feedback. Navigators here are minimal stubs; no test opens a
// real share sheet or touches a real clipboard.

const ORIGIN = 'https://hub.ossetttownjnr.example'

function deferred<R>() {
  let resolve!: (value: R) => void
  let reject!: (err: unknown) => void
  const promise = new Promise<R>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0))

const payload = (over: Partial<SharePayload> = {}): SharePayload => ({
  url: `${ORIGIN}/drill/d1`,
  title: 'Rondo 4v1',
  text: 'Rondo 4v1',
  ...over,
})

describe('canonical URLs', () => {
  it('builds the session, drill and programme paths to match the app router', () => {
    expect(canonicalPath('session', 's1')).toBe('/session-day/s1')
    expect(canonicalPath('drill', 'd1')).toBe('/drill/d1')
    expect(canonicalPath('programme', 'p1')).toBe('/programmes/p1')
  })

  it('joins an injected origin to the canonical path', () => {
    expect(canonicalUrl('session', 's1', ORIGIN)).toBe(`${ORIGIN}/session-day/s1`)
    expect(canonicalUrl('drill', 'd1', ORIGIN)).toBe(`${ORIGIN}/drill/d1`)
    expect(canonicalUrl('programme', 'p1', ORIGIN)).toBe(`${ORIGIN}/programmes/p1`)
  })

  it('falls back to an empty origin off a browser, so the path is still exact', () => {
    // The unit environment has no window, so currentOrigin is empty and the URL
    // is just the canonical path. In the browser the real origin prefixes it.
    expect(currentOrigin()).toBe('')
    expect(canonicalUrl('drill', 'd1')).toBe('/drill/d1')
  })

  it('adds no query string, fragment or secret: the URL is exactly origin plus path', () => {
    const url = canonicalUrl('session', 's1', ORIGIN)
    expect(url).toBe(`${ORIGIN}/session-day/s1`)
    expect(url).not.toContain('?')
    expect(url).not.toContain('#')
    expect(url).not.toContain('token')
    expect(url).not.toContain('share')
  })
})

describe('native share', () => {
  it('uses navigator.share when available, with the exact title, text and url', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    const writeText = vi.fn()
    const nav: ShareCapableNavigator = { share, clipboard: { writeText } }
    const p = payload()
    const result = await shareLink(p, nav)
    expect(result).toBe('shared')
    expect(share).toHaveBeenCalledTimes(1)
    expect(share).toHaveBeenCalledWith({ title: p.title, text: p.text, url: p.url })
    // A successful native share never also copies.
    expect(writeText).not.toHaveBeenCalled()
  })

  it('treats a user cancellation as neutral, never a copy and never an error', async () => {
    const abort = Object.assign(new Error('user cancelled'), { name: 'AbortError' })
    const share = vi.fn().mockRejectedValue(abort)
    const writeText = vi.fn().mockResolvedValue(undefined)
    const nav: ShareCapableNavigator = { share, clipboard: { writeText } }
    const result = await shareLink(payload(), nav)
    expect(result).toBe('cancelled')
    // A cancellation must not silently fall back to the clipboard.
    expect(writeText).not.toHaveBeenCalled()
  })

  it('falls back to the clipboard when the native sheet fails for any other reason', async () => {
    const share = vi.fn().mockRejectedValue(new Error('sheet unavailable'))
    const writeText = vi.fn().mockResolvedValue(undefined)
    const nav: ShareCapableNavigator = { share, clipboard: { writeText } }
    const p = payload()
    const result = await shareLink(p, nav)
    expect(result).toBe('copied')
    expect(writeText).toHaveBeenCalledWith(p.url)
  })

  it('reports an error when the native sheet fails and the clipboard fails too', async () => {
    const share = vi.fn().mockRejectedValue(new Error('sheet unavailable'))
    const writeText = vi.fn().mockRejectedValue(new Error('denied'))
    const nav: ShareCapableNavigator = { share, clipboard: { writeText } }
    expect(await shareLink(payload(), nav)).toBe('error')
  })

  it('detects native share support from the navigator', () => {
    expect(canNativeShare({ share: vi.fn() })).toBe(true)
    expect(canNativeShare({ clipboard: { writeText: vi.fn() } })).toBe(false)
    expect(canNativeShare({})).toBe(false)
  })
})

describe('clipboard fallback', () => {
  it('copies the exact canonical URL when native share is unavailable', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    const nav: ShareCapableNavigator = { clipboard: { writeText } }
    const p = payload()
    const result = await shareLink(p, nav)
    expect(result).toBe('copied')
    expect(writeText).toHaveBeenCalledTimes(1)
    expect(writeText).toHaveBeenCalledWith(p.url)
  })

  it('reports an error when the clipboard write is refused', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('not allowed'))
    const nav: ShareCapableNavigator = { clipboard: { writeText } }
    expect(await shareLink(payload(), nav)).toBe('error')
  })

  it('reports an error when there is no clipboard at all', async () => {
    expect(await shareLink(payload(), {})).toBe('error')
    expect(await copyLink(`${ORIGIN}/drill/d1`, {})).toBe('error')
  })
})

describe('share feedback mapping', () => {
  it('announces successes through status and failures through alert, cancellation silent', () => {
    expect(shareFeedback('shared')).toEqual({ role: 'status', message: 'Shared' })
    expect(shareFeedback('copied')).toEqual({ role: 'status', message: 'Link copied' })
    expect(shareFeedback('cancelled')).toEqual({ role: null, message: '' })
    expect(shareFeedback('error')).toEqual({ role: 'alert', message: SHARE_COPY_FAILED })
  })

  it('keeps the failure wording calm, with no browser internals', () => {
    expect(shareFeedback('error').message).toBe(SHARE_COPY_FAILED)
    expect(shareFeedback('error').message).not.toMatch(/DOMException|NotAllowed|navigator|clipboard/i)
  })
})

describe('createShareRunner', () => {
  it('fires a single share for rapid duplicate clicks while one is in flight', async () => {
    const results: ShareResult[] = []
    const waiting: Array<ReturnType<typeof deferred<ShareResult>>> = []
    const perform = vi.fn(() => {
      const d = deferred<ShareResult>()
      waiting.push(d)
      return d.promise
    })
    const runner = createShareRunner((r) => results.push(r), perform)
    const first = runner.run(payload())
    void runner.run(payload())
    void runner.run(payload())
    expect(perform).toHaveBeenCalledTimes(1)
    waiting[0].resolve('copied')
    await first
    await flush()
    expect(perform).toHaveBeenCalledTimes(1)
    expect(results).toEqual(['copied'])
  })

  it('accepts a fresh attempt once the previous one settles', async () => {
    const results: ShareResult[] = []
    const waiting: Array<ReturnType<typeof deferred<ShareResult>>> = []
    const perform = vi.fn(() => {
      const d = deferred<ShareResult>()
      waiting.push(d)
      return d.promise
    })
    const runner = createShareRunner((r) => results.push(r), perform)
    const first = runner.run(payload())
    waiting[0].resolve('shared')
    await first
    const second = runner.run(payload())
    expect(perform).toHaveBeenCalledTimes(2)
    waiting[1].resolve('copied')
    await second
    expect(results).toEqual(['shared', 'copied'])
  })

  it('reports nothing for a share that settles after the surface has gone', async () => {
    const onResult = vi.fn()
    const d = deferred<ShareResult>()
    const runner = createShareRunner(onResult, () => d.promise)
    const done = runner.run(payload())
    // The surface unmounts while the share is still resolving.
    runner.setActive(false)
    d.resolve('copied')
    await done
    expect(onResult).not.toHaveBeenCalled()
  })

  it('reports the outcome for a normal completed share', async () => {
    const onResult = vi.fn()
    const runner = createShareRunner(onResult, () => Promise.resolve('shared'))
    await runner.run(payload())
    expect(onResult).toHaveBeenCalledWith('shared')
  })
})
