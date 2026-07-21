// OTJ Training Hub, public drill share control (Content Sharing PR 2).
//
// The Drill Detail control for creating and managing an anonymous PUBLIC drill
// link. It is deliberately distinct from the PR 0 internal "Share" button
// (which copies a protected club URL): this one publishes a login-free public
// snapshot, so it is clearly labelled "Public link", shows a preview of exactly
// what becomes public, carries the rights warning, and requires explicit
// confirmation. The raw secret is shown once and cleared from component state
// on close or unmount.
//
// Permissions mirror the server (which is the real boundary): canPublish lets a
// coach create/refresh/rotate their own eligible drill link; canRevokeAny lets
// a manager turn off any club link (but never rotate or refresh another coach's
// link).

import { useEffect, useRef, useState } from 'react'
import { ActionError, Modal } from './ui'
import { PublicDrillView } from './PublicDrillView'
import { copyLink, shareLink } from '../lib/share'
import {
  type DrillShareStatus,
  useCreateDrillShare,
  useDrillShareStatus,
  usePreviewDrillShare,
  useRefreshDrillShare,
  useRevokeDrillShare,
  useRotateDrillShare,
} from '../lib/queries'
import {
  blockedReasonCopy,
  buildPublicShareUrl,
  KILL_SWITCH_NOTE,
  type PublicDrillSnapshot,
  PUBLISH_CONFIRM,
  RIGHTS_WARNING,
  ROTATE_WARNING,
  SECRET_ONCE_NOTE,
  validatePublicDrillSnapshot,
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

// ---- Pure preview body ----
export function PublicSharePreviewBody({
  eligible,
  blocked,
  snapshot,
}: {
  eligible: boolean
  blocked: string[]
  snapshot: PublicDrillSnapshot | null
}) {
  return (
    <div className="public-preview">
      {!eligible && (
        <div role="alert" className="public-blocked">
          {blockedReasonCopy(blocked)} You can still use the internal club link above.
        </div>
      )}
      <div className="public-freetext-warning">
        <strong>You wrote this, it will be public.</strong>
        <p className="muted">{RIGHTS_WARNING}</p>
      </div>
      {snapshot && (
        <div className="public-preview-frame">
          <PublicDrillView snapshot={snapshot} mode="preview" />
        </div>
      )}
    </div>
  )
}

type Feedback = { role: 'status' | 'alert' | null; message: string }
const NO_FEEDBACK: Feedback = { role: null, message: '' }

export function PublicShareControl({
  drillId,
  drillTitle,
  canPublish,
  canRevokeAny,
}: {
  drillId: string
  drillTitle: string
  canPublish: boolean
  canRevokeAny: boolean
}) {
  const statusQ = useDrillShareStatus(drillId, canPublish || canRevokeAny)
  const preview = usePreviewDrillShare()
  const create = useCreateDrillShare()
  const refresh = useRefreshDrillShare()
  const rotate = useRotateDrillShare()
  const revoke = useRevokeDrillShare()

  const [modal, setModal] = useState<null | 'preview' | 'result' | 'manage' | 'confirmRevoke'>(null)
  const [result, setResult] = useState<{ url: string; expiresAt: string | null } | null>(null)
  const [copyState, setCopyState] = useState<Feedback>(NO_FEEDBACK)
  const [error, setError] = useState<string | null>(null)
  const idempotencyKey = useRef<string>('')

  // Clear the secret-bearing result on unmount (defence: the secret is only ever
  // in component state, never in storage, analytics or a query cache).
  useEffect(() => () => setResult(null), [])

  const canNativeShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'

  const share: DrillShareStatus | null = statusQ.data?.share ?? null
  const sharingEnabled = statusQ.data?.sharingEnabled ?? false
  const previewSnapshot: PublicDrillSnapshot | null =
    preview.data && validatePublicDrillSnapshot(preview.data.preview) ? preview.data.preview : null

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
      { drillId },
      { onSuccess: () => setModal('preview'), onError: (e) => setError(e.message) },
    )
  }

  const confirmCreate = () => {
    setError(null)
    create.mutate(
      { drillId, idempotencyKey: idempotencyKey.current },
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
      { drillId, shareId: share.shareId },
      { onSuccess: () => setModal(null), onError: (e) => setError(e.message) },
    )
  }

  const doRotate = () => {
    if (!share) return
    setError(null)
    rotate.mutate(
      { drillId, shareId: share.shareId },
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
      { drillId, shareId: share.shareId },
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
    void shareLink({ url: result.url, title: drillTitle, text: drillTitle }).then((r) =>
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
        <p className="muted">Only the coach who owns this drill, or a manager, can publish a public link.</p>
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
            <p className="muted" style={{ fontSize: 12.5 }}>Rebuilds the public copy from the current drill. The link stays the same.</p>

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
