// Internal club link sharing. PR 0 of the content sharing programme.
//
// An internal club link is a normal protected app URL: the canonical detail
// page for a saved session, a drill or a programme. The recipient signs in and
// must already have club access, and the existing Row Level Security stays the
// only boundary. There is no token, no query-string secret, no temporary public
// URL and no anonymous route: the link is exactly origin + the canonical path,
// so a protected link grants nothing on its own.
//
// This module is pure and injectable so every branch tests without a DOM: the
// canonical URL builders, navigator.share feature detection, native share
// invocation, the clipboard fallback, and a deterministic result the caller
// maps to plain-language feedback (never a raw browser error).

export type ShareKind = 'session' | 'drill' | 'programme'

// The canonical detail path for each content type. These mirror the app's own
// router (src/hooks/useNav.ts and the routes in src/App.tsx) exactly, so a
// shared link opens the same page the app navigates to internally. Ids are
// database uuids, so no escaping is applied here, matching useNav.
const PATHS: Record<ShareKind, (id: string) => string> = {
  session: (id) => `/session-day/${id}`,
  drill: (id) => `/drill/${id}`,
  programme: (id) => `/programmes/${id}`,
}

export function canonicalPath(kind: ShareKind, id: string): string {
  return PATHS[kind](id)
}

// The page origin when running in a browser, empty otherwise (the static
// renderer and tests have no window). Callers may pass an explicit origin.
export function currentOrigin(): string {
  return typeof window !== 'undefined' && window.location ? window.location.origin : ''
}

// origin + canonical path, with nothing appended: no query string, no fragment,
// no secret. Passing the origin keeps the builder pure for tests.
export function canonicalUrl(kind: ShareKind, id: string, origin: string = currentOrigin()): string {
  return origin + canonicalPath(kind, id)
}

// The deterministic outcome of a share attempt. 'shared' and 'copied' are
// successes; 'cancelled' is the user dismissing the native sheet, a neutral
// non-event; 'error' is a genuine failure the caller reports calmly.
export type ShareResult = 'shared' | 'copied' | 'cancelled' | 'error'

export interface SharePayload {
  url: string
  title: string
  text: string
}

// The two Navigator members this module uses, kept as a minimal structural type
// so callers inject a stub in tests without a full Navigator.
export interface ShareCapableNavigator {
  share?: (data: { title?: string; text?: string; url?: string }) => Promise<void>
  clipboard?: { writeText?: (text: string) => Promise<void> }
}

function resolveNavigator(injected?: ShareCapableNavigator): ShareCapableNavigator | undefined {
  if (injected) return injected
  return typeof navigator !== 'undefined' ? (navigator as ShareCapableNavigator) : undefined
}

// Feature detection for the native share sheet.
export function canNativeShare(injected?: ShareCapableNavigator): boolean {
  const nav = resolveNavigator(injected)
  return !!nav && typeof nav.share === 'function'
}

// A user dismissing the native share sheet rejects with a DOMException whose
// name is AbortError. That is a neutral cancellation, never a failure. Checked
// structurally so it works for a real DOMException and a plain test stub alike.
function isAbort(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { name?: string }).name === 'AbortError'
}

// Copy the URL to the clipboard, the fallback when the native sheet is absent or
// fails. Deterministic: 'copied' on success, 'error' when the clipboard is
// missing or rejects. The URL is a protected app link; it is never logged.
export async function copyLink(url: string, injected?: ShareCapableNavigator): Promise<ShareResult> {
  const nav = resolveNavigator(injected)
  const writeText = nav?.clipboard?.writeText
  if (!writeText) return 'error'
  try {
    await writeText.call(nav!.clipboard, url)
    return 'copied'
  } catch {
    return 'error'
  }
}

// Share the canonical link: the native sheet when available, the clipboard
// otherwise. A native share the user cancels returns 'cancelled'. A native
// share that fails for any other reason falls back to the clipboard, so a flaky
// sheet still leaves the link ready to paste. The caller only ever sees a
// ShareResult, never a browser error object.
export async function shareLink(payload: SharePayload, injected?: ShareCapableNavigator): Promise<ShareResult> {
  const nav = resolveNavigator(injected)
  if (nav && typeof nav.share === 'function') {
    try {
      await nav.share({ title: payload.title, text: payload.text, url: payload.url })
      return 'shared'
    } catch (err) {
      if (isAbort(err)) return 'cancelled'
      // A non-cancellation failure falls through to the clipboard fallback.
    }
  }
  return copyLink(payload.url, nav)
}

// How a ShareResult renders. Success announces through role="status"; a failure
// is an actionable role="alert". A cancellation announces nothing.
export interface ShareFeedback {
  role: 'status' | 'alert' | null
  message: string
}

export const SHARE_ACCOUNT_NOTE = 'The recipient will need an OTJ account and access to this club.'
export const SAVE_AND_SHARE_NOTE = 'This saves your changes, then shares the link.'
export const SHARE_COPY_FAILED = "We couldn't copy the link. Try again."

export function shareFeedback(result: ShareResult): ShareFeedback {
  switch (result) {
    case 'shared':
      return { role: 'status', message: 'Shared' }
    case 'copied':
      return { role: 'status', message: 'Link copied' }
    case 'cancelled':
      return { role: null, message: '' }
    case 'error':
      return { role: 'alert', message: SHARE_COPY_FAILED }
  }
}

// A tiny guarded runner around shareLink, mirroring the session write seam
// (createGuardedSubmit): one attempt at a time so rapid duplicate clicks fire a
// single share, and a lifecycle switch so a share settling after its surface is
// gone reports nothing. Kept out of React so both behaviours test without a
// renderer; useShare wires it to component state.
export interface ShareRunner {
  run: (payload: SharePayload) => Promise<void>
  setActive: (active: boolean) => void
}

export function createShareRunner(
  onResult: (result: ShareResult) => void,
  perform: (payload: SharePayload) => Promise<ShareResult> = shareLink,
): ShareRunner {
  let inFlight = false
  let active = true
  return {
    run: async (payload) => {
      if (inFlight) return
      inFlight = true
      const result = await perform(payload)
      inFlight = false
      // A share settling after the surface unmounted reports nothing, so it can
      // never update state on a gone component.
      if (active) onResult(result)
    },
    setActive: (v) => {
      active = v
    },
  }
}
