// OTJ Training Hub, anonymous public share page (Content Sharing PR 2).
//
// The login-free page an external recipient opens at /share/:shareId#secret. It
// is deliberately minimal: it imports NO authenticated data layer (queries.ts,
// useAuth), NO app shell (sidebar, nav) and NO protected hooks. It reaches
// Supabase only through the public read-content-share function, using the anon
// client, and reads the secret from the URL fragment (never a query string).
//
// Every lifecycle failure (unknown, revoked, expired, disabled) renders the
// identical neutral unavailable state, so the page never reveals which state
// occurred or whether the link ever existed. A transport failure is distinct (a
// retry), because it reveals nothing about the link's lifecycle.
//
// Print / Save as PDF (Content Sharing PR 6, browser print only). The action
// calls window.print() on the already rendered, already validated snapshot DOM.
// It makes NO request, reads NO live row, adds NO database access, needs NO
// Edge Function and generates NO server side PDF. Whatever is on the page is
// what prints, so the printed copy can carry nothing the public projection did
// not already carry. The browser's own print chrome is the exception, and both
// halves of it are handled: document.title is overwritten with neutral copy,
// and the secret is stripped from the address bar for the duration of the print
// (see stripSecretFromUrl) so the URL footer cannot stamp a working credential
// onto the page. Because the printed or saved copy leaves the platform
// entirely, the page states plainly that it cannot be turned off or recalled.

import { useEffect, useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { PublicDrillView } from '../components/PublicDrillView'
import { PublicProgrammeView } from '../components/PublicProgrammeView'
import { PublicSessionView } from '../components/PublicSessionView'
import {
  type PublicDrillSnapshot,
  PRINT_WARNING,
  PUBLIC_PAGE_TITLE,
  type PublicProgrammeSnapshot,
  type PublicSessionSnapshot,
  readSecretFromHash,
  TRANSIENT_BODY,
  TRANSIENT_HEADING,
  UNAVAILABLE_BODY,
  UNAVAILABLE_HEADING,
  validatePublicDrillSnapshot,
  validatePublicProgrammeSnapshot,
  validatePublicSessionSnapshot,
} from '../lib/publicShare'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SECRET_RE = /^[A-Za-z0-9_-]{20,200}$/

type ReadResult =
  | { status: 'ok'; snapshot: unknown }
  | { status: 'unavailable' }
  | { status: 'error' }

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="public-page">
      <main className="public-main" role="main">
        {children}
      </main>
      <footer className="public-foot">
        <p className="muted">Shared from Ossett Town Juniors</p>
      </footer>
    </div>
  )
}

// The interactive chrome under a rendered snapshot. Every control here is
// hidden in print (see the @media print block in styles.css): a printed page
// must not carry buttons, and the reload control is meaningless on paper.
// Remove the secret from the address bar, and put it back afterwards.
//
// Every desktop browser prints its own header and footer by default, and the
// footer is document.URL. Our secret lives in the URL FRAGMENT, so a naive
// print would stamp a working credential onto every sheet of the saved PDF, and
// that PDF is exactly the thing recipients forward on. The page already
// neutralises the other half of that chrome by overwriting document.title, so
// this closes the matching hole: the fragment is stripped for the duration of
// the print and restored immediately after, which keeps a plain page reload
// working (a permanent strip would break it).
function stripSecretFromUrl(): void {
  if (typeof window === 'undefined' || !window.history || !window.location.hash) return
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
}

function restoreSecretToUrl(secret: string): void {
  if (typeof window === 'undefined' || !window.history || !secret) return
  if (window.location.hash) return
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#${secret}`)
}

function PublicActions({ onReload, secret }: { onReload: () => void; secret: string }) {
  // Covers the browser's own print (Ctrl+P, the menu) as well as our button.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const before = () => stripSecretFromUrl()
    const after = () => restoreSecretToUrl(secret)
    window.addEventListener('beforeprint', before)
    window.addEventListener('afterprint', after)
    return () => {
      window.removeEventListener('beforeprint', before)
      window.removeEventListener('afterprint', after)
    }
  }, [secret])

  // The button strips and restores around the call too, so a browser that does
  // not fire beforeprint still never prints the secret.
  const print = () => {
    stripSecretFromUrl()
    try {
      window.print()
    } finally {
      restoreSecretToUrl(secret)
    }
  }

  return (
    <div className="public-reload">
      <button type="button" className="btn btn-quiet btn-sm" onClick={onReload}>
        Reload media
      </button>
      <button type="button" className="btn btn-quiet btn-sm" style={{ minHeight: 44 }} onClick={print}>
        Print or Save as PDF
      </button>
      <p className="public-print-note muted">{PRINT_WARNING}</p>
    </div>
  )
}

function Unavailable() {
  return (
    <Frame>
      <div className="public-empty" role="status">
        <h1 className="public-empty-head">{UNAVAILABLE_HEADING}</h1>
        <p className="public-empty-body">{UNAVAILABLE_BODY}</p>
      </div>
    </Frame>
  )
}

export default function PublicShare() {
  const { shareId } = useParams()
  // The secret lives in the URL fragment; it never reaches the server in the
  // request line, only in the POST body we send below.
  const secret = useMemo(
    () => readSecretFromHash(typeof window !== 'undefined' ? window.location.hash : ''),
    [],
  )

  const validInputs = !!shareId && UUID_RE.test(shareId) && SECRET_RE.test(secret)

  useEffect(() => {
    // Neutral, content-free document title so a free-text title never lands in
    // the tab or a link preview beyond what the snapshot already shows.
    const previous = document.title
    document.title = PUBLIC_PAGE_TITLE
    // Client-side noindex/nofollow (a Vercel edge X-Robots-Tag is the robust
    // server-level guarantee; this is the belt-and-braces client copy).
    const meta = document.createElement('meta')
    meta.name = 'robots'
    meta.content = 'noindex, nofollow'
    document.head.appendChild(meta)
    return () => {
      document.title = previous
      meta.remove()
    }
  }, [])

  const query = useQuery<ReadResult>({
    queryKey: ['public-share', shareId],
    enabled: validInputs,
    retry: 1,
    refetchOnWindowFocus: true,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<ReadResult> => {
      const { data, error } = await supabase.functions.invoke('read-content-share', {
        body: { shareId, secret },
      })
      if (error) {
        // A transport failure (5xx, network) is distinct from a lifecycle fact.
        throw error
      }
      const status = (data as { status?: string })?.status
      if (status === 'ok') return { status: 'ok', snapshot: (data as { snapshot?: unknown }).snapshot }
      return { status: 'unavailable' }
    },
  })

  if (!validInputs) return <Unavailable />
  if (query.isPending) {
    return (
      <Frame>
        <div className="public-empty" role="status">
          <p className="public-empty-body">Loading…</p>
        </div>
      </Frame>
    )
  }
  if (query.isError) {
    return (
      <Frame>
        <div className="public-empty" role="alert">
          <h1 className="public-empty-head">{TRANSIENT_HEADING}</h1>
          <p className="public-empty-body">{TRANSIENT_BODY}</p>
          <button type="button" className="btn btn-primary" style={{ minHeight: 44 }} onClick={() => query.refetch()}>
            Try again
          </button>
        </div>
      </Frame>
    )
  }

  const result = query.data
  if (!result || result.status !== 'ok') return <Unavailable />

  // Dispatch on the snapshot kind, defensively re-validating each shape before
  // rendering. An unknown kind, or a shape that fails its validator, renders the
  // neutral unavailable state rather than anything else. The "Reload media"
  // button re-requests fresh signed media URLs after the ten minute TTL.
  const kind = (result.snapshot as { kind?: unknown })?.kind
  if (kind === 'drill' && validatePublicDrillSnapshot(result.snapshot)) {
    const snapshot = result.snapshot as PublicDrillSnapshot
    return (
      <Frame>
        <PublicDrillView snapshot={snapshot} mode="public" />
        <PublicActions onReload={() => query.refetch()} secret={secret} />
      </Frame>
    )
  }
  if (kind === 'session' && validatePublicSessionSnapshot(result.snapshot)) {
    const snapshot = result.snapshot as PublicSessionSnapshot
    return (
      <Frame>
        <PublicSessionView snapshot={snapshot} mode="public" />
        <PublicActions onReload={() => query.refetch()} secret={secret} />
      </Frame>
    )
  }
  if (kind === 'programme' && validatePublicProgrammeSnapshot(result.snapshot)) {
    const snapshot = result.snapshot as PublicProgrammeSnapshot
    return (
      <Frame>
        <PublicProgrammeView snapshot={snapshot} mode="public" />
        <PublicActions onReload={() => query.refetch()} secret={secret} />
      </Frame>
    )
  }
  return <Unavailable />
}
