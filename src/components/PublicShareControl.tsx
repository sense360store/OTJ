// OTJ Training Hub, public share control (Content Sharing PR 2 drills, PR 3
// sessions).
//
// The Drill Detail and Session Day control for creating and managing an
// anonymous PUBLIC link. It is deliberately distinct from the PR 0 internal
// "Share" button (which copies a protected club URL): this one publishes a
// login-free public snapshot, so it is clearly labelled "Public link", shows a
// preview of exactly what becomes public, carries the rights warning, and
// requires explicit confirmation. The raw secret is shown once and cleared from
// component state on close or unmount.
//
// One kind-aware control drives both a drill share and a session share; the wire
// carries kind + sourceId and the server is the real authority. Permissions
// mirror the server: canPublish lets a coach create/refresh/rotate their own
// eligible link; canRevokeAny lets a manager turn off any club link (but never
// rotate or refresh another coach's link).

import { useEffect, useRef, useState } from 'react'
import { ActionError, Modal } from './ui'
import { PublicDrillView } from './PublicDrillView'
import { PublicSessionView } from './PublicSessionView'
import { copyLink, shareLink } from '../lib/share'
import {
  type ContentShareKind,
  type ContentShareStatus,
  useContentShareStatus,
  useCreateContentShare,
  usePreviewContentShare,
  useRefreshContentShare,
  useRevokeContentShare,
  useRotateContentShare,
} from '../lib/queries'
import {
  blockedReasonCopy,
  blockedSessionReasonCopy,
  buildPublicShareUrl,
  KILL_SWITCH_NOTE,
  type PublicDrillSnapshot,
  PUBLISH_CONFIRM,
  type PublicSessionSnapshot,
  RIGHTS_WARNING,
  ROTATE_WARNING,
  SECRET_ONCE_NOTE,
  validatePublicDrillSnapshot,
  validatePublicSessionSnapshot,
} from '../lib/publicShare'

function expiryLabel(expiresAt: string | null): string {
  if (!expiresAt) return 'Active, no expiry'
  const ms = Date.parse(expiresAt) - Date.now()
  if (Number.isNaN(ms)) return 'Active'
  if (ms <= 0) return 'Expired'
  const days = Math.ceil(ms / (24 * 60 * 60 * 1000))
  return `Active, expires in ${days} day${days === 1 ? '' : 's'}`
}

// ---- Pure result view (secret shown once) ----
export function PublicShareResultView({
  url,
  expiresAt,
  copyState,
  onCopy,
  onShare,
  canNativeShare,
}: {
  url: string
  expiresAt: string | null
  copyState: { role: 'status' | 'alert' | null; message: string }
  onCopy: () => void
  onShare: () => void
  canNativeShare: boolean
}) {
  return (
    <div className="public-result">
      <p className="muted">{SECRET_ONCE_NOTE}</p>
      <label className="public-result-label" htmlFor="public-share-url">Public link</label>
      <input
        id="public-share-url"
        className="public-result-url mono"
        readOnly
        value={url}
        onFocus={(e) => e.currentTarget.select()}
      />
      <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-primary" style={{ minHeight: 44 }} onClick={onCopy}>
          Copy link
        </button>
        {canNativeShare && (
          <button type="button" className="btn btn-ghost" style={{ minHeight: 44 }} onClick={onShare}>
            Share
          </button>
        )}
      </div>
      <p className="muted" style={{ marginTop: 6 }}>{expiryLabel(expiresAt)}</p>
      <span role="status" className="public-live" style={{ color: 'var(--c-physical)', fontWeight: 700 }}>
        {copyState.role === 'status' ? copyState.message : ''}
      </span>
      {copyState.role === 'alert' && <ActionError onRetry={onCopy}>{copyState.message}</ActionError>}
    </div>
  )
}

// ---- Pure preview body (drill or session) ----
export function PublicSharePreviewBody({
  kind = 'drill',
  eligible,
  blocked,
  snapshot,
}: {
  kind?: ContentShareKind
  eligible: boolean
  blocked: string[]
  snapshot: PublicDrillSnapshot | PublicSessionSnapshot | null
}) {
  const blockedCopy = kind === 'session' ? blockedSessionReasonCopy(blocked) : blockedReasonCopy(blocked)
  return (
    <div className="public-preview">
      {!eligible && (
        <div role="alert" className="public-blocked">
          {blockedCopy} You can still use the internal club link above.
        </div>
      )}
      <div className="public-freetext-warning">
        <strong>You wrote this, it will be public.</strong>
        <p className="muted">{RIGHTS_WARNING}</p>
      </div>
      {snapshot && (
        <div className="public-preview-frame">
          {kind === 'session'
            ? <PublicSessionView snapshot={snapshot as PublicSessionSnapshot} mode="preview" />
            : <PublicDrillView snapshot={snapshot as PublicDrillSnapshot} mode="preview" />}
        </div>
      )}
    </div>
  )
}

type Feedback = { role: 'status' | 'alert' | null; message: string }
const NO_FEEDBACK: Feedback = { role: null, message: '' }

function validatePreview(
  kind: ContentShareKind,
  value: unknown,
): PublicDrillSnapshot | PublicSessionSnapshot | null {
  if (kind === 'session') return validatePublicSessionSnapshot(value) ? value : null
  return validatePublicDrillSnapshot(value) ? value : null
}

export function PublicShareControl({
  kind,
  sourceId,
  title,
  canPublish,
  canRevokeAny,
}: {
  kind: ContentShareKind
  sourceId: string
  title: string
  canPublish: boolean
  canRevokeAny: boolean
}) {
  const noun = kind === 'session' ? 'session' : 'drill'
  const statusQ = useContentShareStatus(kind, sourceId, canPublish || canRevokeAny)
  const preview = usePreviewContentShare()
  const create = useCreateContentShare()
  const refresh = useRefreshContentShare()
  const rotate = useRotateContentShare()
  const revoke = useRevokeContentShare()

  const [modal, setModal] = useState<null | 'preview' | 'result' | 'manage' | 'confirmRevoke'>(null)
  const [result, setResult] = useState<{ url: string; expiresAt: string | null } | null>(null)
  const [copyState, setCopyState] = useState<Feedback>(NO_FEEDBACK)
  const [error, setError] = useState<string | null>(null)
  const idempotencyKey = useRef<string>('')

  // Clear the secret-bearing result on unmount (defence: the secret is only ever
  // in component state, never in storage, analytics or a query cache).
  useEffect(() => () => setResult(null), [])

  const canNativeShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'

  const share: ContentShareStatus | null = statusQ.data?.share ?? null
  const sharingEnabled = statusQ.data?.sharingEnabled ?? false
  const previewSnapshot = preview.data ? validatePreview(kind, preview.data.preview) : null

  const closeModal = () => {
    setModal(null)
    setResult(null) // clears the secret from state
    setCopyState(NO_FEEDBACK)
    setError(null)
  }

  const startPublish = () => {
    setError(null)
    idempotencyKey.current = crypto.randomUUID()
    preview.mutate(
      { kind, sourceId },
      { onSuccess: () => setModal('preview'), onError: (e) => setError(e.message) },
    )
  }

  const confirmCreate = () => {
    setError(null)
    create.mutate(
      { kind, sourceId, idempotencyKey: idempotencyKey.current },
      {
        onSuccess: (res) => {
          if (res.secret) {
            setResult({ url: buildPublicShareUrl(res.shareId, res.secret), expiresAt: res.expiresAt ?? null })
            setModal('result')
          } else {
            // A link already exists; the raw secret is unrecoverable, so rotation
            // is required to obtain a new URL.
            setError(res.message ?? 'A public link already exists. Replace it to get a new URL.')
            setModal('manage')
          }
        },
        onError: (e) => setError(e.message),
      },
    )
  }

  const doRefresh = () => {
    if (!share) return
    setError(null)
    refresh.mutate(
      { kind, sourceId, shareId: share.shareId },
      { onSuccess: () => setModal(null), onError: (e) => setError(e.message) },
    )
  }

  const doRotate = () => {
    if (!share) return
    setError(null)
    rotate.mutate(
      { kind, sourceId, shareId: share.shareId },
      {
        onSuccess: (res) => {
          setResult({ url: buildPublicShareUrl(res.shareId, res.secret), expiresAt: share.expiresAt })
          setModal('result')
        },
        onError: (e) => setError(e.message),
      },
    )
  }

  const doRevoke = () => {
    if (!share) return
    setError(null)
    revoke.mutate(
      { kind, sourceId, shareId: share.shareId },
      { onSuccess: () => closeModal(), onError: (e) => setError(e.message) },
    )
  }

  const onCopy = () => {
    if (!result) return
    void copyLink(result.url).then((r) =>
      setCopyState(r === 'copied' ? { role: 'status', message: 'Link copied' } : r === 'error' ? { role: 'alert', message: "We couldn't copy the link. Try again." } : NO_FEEDBACK)
    )
  }
  const onShare = () => {
    if (!result) return
    void shareLink({ url: result.url, title, text: title }).then((r) =>
      setCopyState(r === 'shared' ? { role: 'status', message: 'Shared' } : r === 'copied' ? { role: 'status', message: 'Link copied' } : r === 'error' ? { role: 'alert', message: 'Sharing failed. Try again.' } : NO_FEEDBACK)
    )
  }

  const writing = create.isPending || refresh.isPending || rotate.isPending || revoke.isPending
  const owner = share?.isOwner === true

  return (
    <div className="public-share-control" style={{ marginTop: 12 }}>
      <h3 className="public-share-heading" style={{ margin: '0 0 6px' }}>Public link</h3>

      {!sharingEnabled ? (
        <p className="muted">{KILL_SWITCH_NOTE}</p>
      ) : statusQ.isPending ? (
        <p className="muted">Checking…</p>
      ) : share ? (
        <div>
          <p className="public-status-line" style={{ fontWeight: 700 }}>{expiryLabel(share.expiresAt)}</p>
          <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
            {owner && canPublish && (
              <button type="button" className="btn btn-ghost" style={{ minHeight: 44 }} onClick={() => setModal('manage')}>
                Manage this link
              </button>
            )}
            {!owner && canRevokeAny && (
              <button type="button" className="btn btn-ghost" style={{ minHeight: 44 }} onClick={() => setModal('confirmRevoke')}>
                Turn off this link
              </button>
            )}
          </div>
          {!owner && canRevokeAny && (
            <p className="muted" style={{ fontSize: 12.5 }}>This link was created by another coach. You can turn it off.</p>
          )}
        </div>
      ) : canPublish ? (
        <div>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ minHeight: 44 }}
            onClick={startPublish}
            disabled={preview.isPending}
          >
            {preview.isPending ? 'Preparing…' : 'Publish public link'}
          </button>
          <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.45 }}>
            Creates a login-free link anyone can open. You will see exactly what becomes public first.
          </p>
        </div>
      ) : (
        <p className="muted">Only the coach who owns this {noun}, or a manager, can publish a public link.</p>
      )}

      {error && !modal && <ActionError>{error}</ActionError>}

      {/* Preview and confirm before first create */}
      {modal === 'preview' && (
        <Modal
          title="Preview: what becomes public"
          sub="This is exactly what anyone with the link will see."
          onClose={closeModal}
          wide
          dismissible={!create.isPending}
          footer={
            <>
              <button type="button" className="btn btn-ghost" onClick={closeModal} disabled={create.isPending}>Cancel</button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={confirmCreate}
                disabled={create.isPending || !(preview.data?.eligible)}
              >
                {create.isPending ? 'Creating…' : 'Create public link'}
              </button>
            </>
          }
        >
          <PublicSharePreviewBody
            kind={kind}
            eligible={preview.data?.eligible ?? false}
            blocked={preview.data?.blocked ?? []}
            snapshot={previewSnapshot}
          />
          {preview.data?.eligible && <p className="public-confirm-note">{PUBLISH_CONFIRM}</p>}
          {error && <ActionError onRetry={confirmCreate}>{error}</ActionError>}
        </Modal>
      )}

      {/* One-time link reveal */}
      {modal === 'result' && result && (
        <Modal title="Your public link" onClose={closeModal} dismissible>
          <PublicShareResultView
            url={result.url}
            expiresAt={result.expiresAt}
            copyState={copyState}
            onCopy={onCopy}
            onShare={onShare}
            canNativeShare={canNativeShare}
          />
        </Modal>
      )}

      {/* Owner management */}
      {modal === 'manage' && share && (
        <Modal
          title="Manage this link"
          sub={expiryLabel(share.expiresAt)}
          onClose={closeModal}
          dismissible={!writing}
        >
          <div className="public-manage">
            <button type="button" className="btn btn-ghost btn-block" style={{ minHeight: 44 }} onClick={doRefresh} disabled={writing}>
              {refresh.isPending ? 'Updating…' : 'Update what people see'}
            </button>
            <p className="muted" style={{ fontSize: 12.5 }}>Rebuilds the public copy from the current {noun}. The link stays the same.</p>

            <button type="button" className="btn btn-ghost btn-block" style={{ minHeight: 44 }} onClick={doRotate} disabled={writing}>
              {rotate.isPending ? 'Replacing…' : 'Replace this link'}
            </button>
            <p className="muted" style={{ fontSize: 12.5 }}>{ROTATE_WARNING}</p>

            <button type="button" className="btn btn-block" style={{ minHeight: 44, color: 'var(--m-pdf)' }} onClick={() => setModal('confirmRevoke')} disabled={writing}>
              Turn off this link
            </button>
            {error && <ActionError onRetry={doRefresh}>{error}</ActionError>}
          </div>
        </Modal>
      )}

      {/* Revoke confirmation */}
      {modal === 'confirmRevoke' && share && (
        <Modal
          title="Turn off this link?"
          onClose={closeModal}
          dismissible={!revoke.isPending}
          footer={
            <>
              <button type="button" className="btn btn-ghost" onClick={closeModal} disabled={revoke.isPending}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={doRevoke} disabled={revoke.isPending}>
                {revoke.isPending ? 'Turning off…' : 'Turn off this link'}
              </button>
            </>
          }
        >
          <p>The link will stop working straight away. Anyone you already sent it to will see an unavailable message.</p>
          {error && <ActionError onRetry={doRevoke}>{error}</ActionError>}
        </Modal>
      )}
    </div>
  )
}
