// OTJ Training Hub, the Share action for a drill, session or programme.
//
// One Share button, in the page's own action row, opening one dialog that holds
// both ways of sharing. Before this, a coach found the internal club link under
// the page actions and the public link in a large permanent section further
// down, which meant public sharing was mostly discovered by accident while
// editing. Now the two sit side by side, each labelled for what it actually
// does, and the login-free one says so.
//
// One dialog with steps, not a dialog that opens further dialogs: nesting
// breaks focus return and the Escape contract that ui.tsx Modal implements.
//
// Every decision the dialog makes lives in src/lib/shareFlow.ts and
// src/lib/shareBlockers.ts, so the transitions and the wording are unit tested
// in a repository with no DOM test facility. This file wires those decisions to
// the mutations and renders them.
//
// Boundaries kept: the server is the only authority on eligibility, the secret
// is shown once and never leaves component state, a create is only ever reached
// through a preview the coach has seen, and pressing Share never changes a
// sharing level.

import { useEffect, useRef, useState } from 'react'
import { ActionError, Modal, ShareControlView } from './ui'
import { Icon } from './icons'
import { PublicDrillView } from './PublicDrillView'
import { PublicProgrammeView } from './PublicProgrammeView'
import { PublicSessionView } from './PublicSessionView'
import { RightsControl } from './RightsControl'
import { useShare } from '../hooks/useShare'
import { canonicalUrl, copyLink, SHARE_ACCOUNT_NOTE, shareLink } from '../lib/share'
import type { ContentRights } from '../lib/data'
import { type SourceFields } from '../lib/contentRights'
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
  buildPublicShareUrl,
  KILL_SWITCH_NOTE,
  type PublicDrillSnapshot,
  type PublicProgrammeSnapshot,
  PUBLISH_CONFIRM,
  type PublicSessionSnapshot,
  RIGHTS_WARNING,
  ROTATE_WARNING,
  SECRET_ONCE_NOTE,
  validatePublicDrillSnapshot,
  validatePublicProgrammeSnapshot,
  validatePublicSessionSnapshot,
} from '../lib/publicShare'
import {
  blockerContentHint,
  EMPTY_PROVENANCE,
  shareBlockerView,
  type SharePreviewProvenance,
} from '../lib/shareBlockers'
import {
  canAttemptCreate,
  canOfferClassify,
  previewGate,
  publicSectionState,
  type PublicSectionKind,
  shareHasExpired,
  type ShareStep,
  stepAfterClassify,
} from '../lib/shareFlow'

// Reads the wall clock, exactly as expiryLabel below does. The decision itself
// is pure and tested in shareFlow.ts; this is the one place that supplies the
// clock, so the render never depends on a value a test cannot pin.
function hasExpired(expiresAt: string | null): boolean {
  return shareHasExpired(expiresAt, Date.now())
}

function expiryLabel(expiresAt: string | null): string {
  if (!expiresAt) return 'Active, no expiry'
  const ms = Date.parse(expiresAt) - Date.now()
  if (Number.isNaN(ms)) return 'Active'
  if (ms <= 0) return 'Expired'
  const days = Math.ceil(ms / (24 * 60 * 60 * 1000))
  return `Active, expires in ${days} day${days === 1 ? '' : 's'}`
}

// ---- Pure views --------------------------------------------------------

// The one-time link reveal. The secret is in the URL fragment, held only in
// component state, and cleared on close and unmount.
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
            Send
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

// The blocked answer. One truthful sentence, and the next thing to do about it
// where the user has the authority to do it. No empty preview frame, and no
// privacy warning about content that is not going anywhere.
export function PublicShareBlockedView({
  noun,
  blocked,
  provenance,
  canClassify,
  onClassify,
}: {
  noun: 'drill' | 'session' | 'programme'
  blocked: readonly string[]
  provenance: SharePreviewProvenance
  canClassify: boolean
  onClassify: () => void
}) {
  const view = shareBlockerView(noun, blocked, provenance)
  const offerClassify = canOfferClassify({ blockerAction: view.action, canClassify })
  return (
    <div className="public-blocked-view">
      <div role="alert" className="public-blocked">
        {view.headline}
      </div>
      {offerClassify && (
        <button type="button" className="btn btn-primary" style={{ minHeight: 44, marginTop: 10 }} onClick={onClassify}>
          Change the sharing level
        </button>
      )}
      {!offerClassify && view.action === 'content' && (
        <p className="muted" style={{ fontSize: 13, lineHeight: 1.5, marginTop: 8 }}>
          {blockerContentHint(noun, view.code)}
        </p>
      )}
      {!offerClassify && view.action === 'classify' && (
        <p className="muted" style={{ fontSize: 13, lineHeight: 1.5, marginTop: 8 }}>
          Only the person who created this {noun}, or a manager, can change its sharing level.
        </p>
      )}
      <p className="muted" style={{ fontSize: 13, lineHeight: 1.5, marginTop: 8 }}>
        You can still send the club link, which anyone in the club can open once they sign in.
      </p>
    </div>
  )
}

// The eligible answer: exactly what becomes public, under the warning that
// prompts the coach to check it. Both only ever appear together.
export function PublicSharePreviewBody({
  kind,
  snapshot,
  showRightsWarning = true,
}: {
  kind: ContentShareKind
  snapshot: PublicDrillSnapshot | PublicSessionSnapshot | PublicProgrammeSnapshot
  // Comes from previewGate, which is the one place that decides the warning and
  // the projection appear together and never apart.
  showRightsWarning?: boolean
}) {
  return (
    <div className="public-preview">
      {showRightsWarning && (
        <div className="public-freetext-warning">
          <strong>You wrote this, it will be public.</strong>
          <p className="muted">{RIGHTS_WARNING}</p>
        </div>
      )}
      <div className="public-preview-frame">
        {kind === 'session'
          ? <PublicSessionView snapshot={snapshot as PublicSessionSnapshot} mode="preview" />
          : kind === 'programme'
          ? <PublicProgrammeView snapshot={snapshot as PublicProgrammeSnapshot} mode="preview" />
          : <PublicDrillView snapshot={snapshot as PublicDrillSnapshot} mode="preview" />}
      </div>
    </div>
  )
}

// The public half of the home step. Its wording never says plain "Share": the
// point of this control is that the link needs no login, so it says so.
export function PublicLinkSectionView({
  section,
  noun,
  expiry,
  expired,
  busy,
  onCreate,
  onManage,
  onRevoke,
}: {
  section: PublicSectionKind
  noun: string
  expiry: string
  // A share row survives its own expiry in the status answer, because an
  // expired share is still refreshable. Saying "a public link is live" over one
  // that stopped working is the wrong way round to be wrong.
  expired: boolean
  busy: boolean
  onCreate: () => void
  onManage: () => void
  onRevoke: () => void
}) {
  if (section === 'hidden') return null
  return (
    <section className="share-section" aria-labelledby="share-public-heading">
      <h3 id="share-public-heading" className="share-section-title">
        <Icon.globe />
        Public link
      </h3>
      {section === 'loading' && <p className="muted">Checking…</p>}
      {section === 'failed' && (
        <p className="muted">We could not check this {noun}’s public link. Try again in a moment.</p>
      )}
      {section === 'disabled' && <p className="muted">{KILL_SWITCH_NOTE}</p>}
      {section === 'create' && (
        <>
          <p className="muted" style={{ fontSize: 13, lineHeight: 1.5 }}>
            Creates a link anyone can open with no login and no account. You will see exactly what becomes public
            before anything is created.
          </p>
          <button
            type="button"
            className="btn btn-primary"
            style={{ minHeight: 44 }}
            disabled={busy}
            onClick={onCreate}
          >
            {busy ? 'Preparing…' : 'Create a public link'}
          </button>
        </>
      )}
      {section === 'locked' && (
        <p className="muted">Only the person who created this {noun}, or a manager, can create a public link.</p>
      )}
      {(section === 'owned' || section === 'others' || section === 'readonly') && (
        <>
          <p className="public-status-line" style={{ fontWeight: 700 }}>
            {expired ? 'This public link has expired.' : `A public link is live. ${expiry}`}
          </p>
          <p className="muted" style={{ fontSize: 13, lineHeight: 1.5 }}>
            {expired
              ? `Anyone opening it now sees an unavailable message. Update what people see to start it again, or turn it off for good.`
              : `Anyone with it can open this ${noun} without signing in.`}
          </p>
          {section === 'owned' && (
            <button type="button" className="btn btn-ghost" style={{ minHeight: 44 }} onClick={onManage}>
              Manage this link
            </button>
          )}
          {section === 'others' && (
            <>
              <button type="button" className="btn btn-ghost" style={{ minHeight: 44 }} onClick={onRevoke}>
                Turn off this link
              </button>
              <p className="muted" style={{ fontSize: 12.5 }}>
                Another coach created this link. You can turn it off, but not replace it.
              </p>
            </>
          )}
        </>
      )}
    </section>
  )
}

// ---- Container ---------------------------------------------------------

type Feedback = { role: 'status' | 'alert' | null; message: string }
const NO_FEEDBACK: Feedback = { role: null, message: '' }

// Each kind is validated by its OWN guard before it renders, even in the owner
// preview: the preview reuses the public renderers, so it reuses the public
// validators too. There is no generic path.
function validatePreview(
  kind: ContentShareKind,
  value: unknown,
): PublicDrillSnapshot | PublicSessionSnapshot | PublicProgrammeSnapshot | null {
  if (kind === 'session') return validatePublicSessionSnapshot(value) ? value : null
  if (kind === 'programme') return validatePublicProgrammeSnapshot(value) ? value : null
  return validatePublicDrillSnapshot(value) ? value : null
}

const STEP_TITLE: Record<ShareStep, string> = {
  home: 'Share',
  preview: 'What becomes public',
  result: 'Your public link',
  manage: 'Manage this link',
  confirmRevoke: 'Turn off this link?',
  classify: 'Sharing level',
}

export interface ShareDialogProps {
  kind: ContentShareKind
  sourceId: string
  title: string
  // The row's own stored level and source columns, for the classify step.
  rights: ContentRights
  source: SourceFields
  // Ownership of the content itself, the same rule that shows Edit. It gates
  // classification; the database enforces it again.
  canClassify: boolean
  canShareInternal: boolean
  canPublish: boolean
  canRevokeAny: boolean
  onClose: () => void
}

export function ShareDialog({
  kind,
  sourceId,
  title,
  rights,
  source,
  canClassify,
  canShareInternal,
  canPublish,
  canRevokeAny,
  onClose,
}: ShareDialogProps) {
  const noun = kind === 'session' ? 'session' : kind === 'programme' ? 'programme' : 'drill'
  const statusQ = useContentShareStatus(kind, sourceId, canPublish || canRevokeAny)
  const preview = usePreviewContentShare()
  const create = useCreateContentShare()
  const refresh = useRefreshContentShare()
  const rotate = useRotateContentShare()
  const revoke = useRevokeContentShare()
  const { share: shareInternal, feedback: internalFeedback } = useShare()

  const [step, setStep] = useState<ShareStep>('home')
  const [result, setResult] = useState<{ url: string; expiresAt: string | null } | null>(null)
  const [copyState, setCopyState] = useState<Feedback>(NO_FEEDBACK)
  const [error, setError] = useState<string | null>(null)
  // Set when a classification is saved while a preview answer is on screen: the
  // answer is now stale, so a create may not ride it.
  const [previewStale, setPreviewStale] = useState(false)
  // A rights save runs inside RightsControl, so the dialog has to be told about
  // it to freeze its own dismissal routes: closing mid-write would drop the
  // callback that marks the preview stale while the write still lands.
  const [classifying, setClassifying] = useState(false)
  // Announced for the outcomes that change nothing visible on screen.
  const [notice, setNotice] = useState('')
  const idempotencyKey = useRef<string>('')

  // Clear the secret bearing result on unmount. The secret only ever lives in
  // this state: never in storage, a query cache, a query key or analytics.
  useEffect(() => () => setResult(null), [])

  const canNativeShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'
  const share: ContentShareStatus | null = statusQ.data?.share ?? null
  const expired = hasExpired(share?.expiresAt ?? null)
  const section = publicSectionState({
    sharingEnabled: statusQ.data?.sharingEnabled ?? false,
    statusPending: statusQ.isPending,
    statusFailed: statusQ.isError,
    hasShare: !!share,
    isOwner: share?.isOwner === true,
    canPublish,
    canRevokeAny,
  })

  const provenance = preview.data?.provenance ?? EMPTY_PROVENANCE
  const snapshot = preview.data ? validatePreview(kind, preview.data.preview) : null
  const gate = previewGate({
    eligible: preview.data?.eligible ?? false,
    hasValidSnapshot: snapshot !== null,
  })
  const writing = create.isPending || refresh.isPending || rotate.isPending || revoke.isPending

  const close = () => {
    setResult(null) // clears the secret from state
    setCopyState(NO_FEEDBACK)
    setError(null)
    setNotice('')
    onClose()
  }

  const startPreview = () => {
    setError(null)
    setNotice('')
    setPreviewStale(false)
    idempotencyKey.current = crypto.randomUUID()
    preview.mutate(
      { kind, sourceId },
      { onSuccess: () => setStep('preview'), onError: (e) => setError(e.message) },
    )
  }

  const confirmCreate = () => {
    if (!canAttemptCreate({ gate, previewStale, writing })) return
    setError(null)
    create.mutate(
      { kind, sourceId, idempotencyKey: idempotencyKey.current },
      {
        onSuccess: (res) => {
          if (res.secret) {
            setResult({ url: buildPublicShareUrl(res.shareId, res.secret), expiresAt: res.expiresAt ?? null })
            setStep('result')
          } else {
            // A link already exists. The raw secret is unrecoverable, so a new
            // URL needs a replacement rather than another create.
            setError(res.message ?? 'A public link already exists. Replace it to get a new URL.')
            setStep('manage')
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
      {
        onSuccess: () => {
          setNotice('The public copy was updated. The link is unchanged.')
          setStep('home')
        },
        onError: (e) => setError(e.message),
      },
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
          setStep('result')
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
      {
        onSuccess: () => {
          setNotice('The public link was turned off.')
          setStep('home')
        },
        onError: (e) => setError(e.message),
      },
    )
  }

  const onCopy = () => {
    if (!result) return
    void copyLink(result.url).then((r) =>
      setCopyState(
        r === 'copied'
          ? { role: 'status', message: 'Link copied' }
          : r === 'error'
          ? { role: 'alert', message: "We couldn't copy the link. Try again." }
          : NO_FEEDBACK,
      ),
    )
  }
  const onSend = () => {
    if (!result) return
    void shareLink({ url: result.url, title, text: title }).then((r) =>
      setCopyState(
        r === 'shared'
          ? { role: 'status', message: 'Shared' }
          : r === 'copied'
          ? { role: 'status', message: 'Link copied' }
          : r === 'error'
          ? { role: 'alert', message: 'Sharing failed. Try again.' }
          : NO_FEEDBACK,
      ),
    )
  }

  const busyStep = step === 'classify'
    ? classifying
    : step === 'preview'
    ? create.isPending
    : step === 'confirmRevoke'
    ? revoke.isPending
    : writing

  const footer =
    step === 'home' ? (
      <button type="button" className="btn btn-ghost" onClick={close}>
        Done
      </button>
    ) : step === 'preview' ? (
      <>
        <button type="button" className="btn btn-ghost" onClick={() => setStep('home')} disabled={create.isPending}>
          Back
        </button>
        {gate.canCreate && (
          <button
            type="button"
            className="btn btn-primary"
            onClick={confirmCreate}
            disabled={!canAttemptCreate({ gate, previewStale, writing })}
          >
            {create.isPending ? 'Creating…' : 'Create public link'}
          </button>
        )}
      </>
    ) : step === 'confirmRevoke' ? (
      <>
        <button type="button" className="btn btn-ghost" onClick={() => setStep('home')} disabled={revoke.isPending}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" onClick={doRevoke} disabled={revoke.isPending}>
          {revoke.isPending ? 'Turning off…' : 'Turn off this link'}
        </button>
      </>
    ) : step === 'result' ? (
      <button type="button" className="btn btn-ghost" onClick={close}>
        Done
      </button>
    ) : step === 'classify' ? (
      <button
        type="button"
        className="btn btn-ghost"
        onClick={() => setStep(stepAfterClassify())}
        disabled={classifying}
      >
        Back to the preview
      </button>
    ) : (
      <button type="button" className="btn btn-ghost" onClick={() => setStep('home')} disabled={writing}>
        Back
      </button>
    )

  return (
    <Modal
      title={STEP_TITLE[step]}
      sub={step === 'home' ? title : undefined}
      onClose={close}
      wide={step === 'preview'}
      dismissible={!busyStep}
      focusKey={step}
      footer={footer}
    >
      {/* One live region for the whole dialog, always mounted so a later
          message is announced rather than inserted with its text already
          present. Carries the outcomes that change nothing else on screen. */}
      <span role="status" className="public-live">{notice}</span>
      {step === 'home' && (
        <div className="share-home" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {canShareInternal && (
            <section className="share-section" aria-labelledby="share-club-heading">
              <h3 id="share-club-heading" className="share-section-title">
                <Icon.users />
                Share inside the club
              </h3>
              <p className="muted" style={{ fontSize: 13, lineHeight: 1.5 }}>
                Sends the ordinary club page. Whoever opens it signs in to their OTJ account first.
              </p>
              <ShareControlView
                label="Copy the club link"
                note={SHARE_ACCOUNT_NOTE}
                feedback={internalFeedback}
                onShare={() => shareInternal({ url: canonicalUrl(kind, sourceId), title, text: title })}
              />
            </section>
          )}
          <PublicLinkSectionView
            section={section}
            noun={noun}
            expiry={share ? expiryLabel(share.expiresAt) : ''}
            expired={expired}
            busy={preview.isPending}
            onCreate={startPreview}
            onManage={() => setStep('manage')}
            onRevoke={() => setStep('confirmRevoke')}
          />
          {error && <ActionError>{error}</ActionError>}
        </div>
      )}

      {step === 'preview' && (
        <>
          {gate.showSnapshot && snapshot ? (
            <PublicSharePreviewBody kind={kind} snapshot={snapshot} showRightsWarning={gate.showRightsWarning} />
          ) : gate.showBlocked ? (
            <PublicShareBlockedView
              noun={noun}
              blocked={preview.data?.blocked ?? []}
              provenance={provenance}
              canClassify={canClassify}
              onClassify={() => setStep('classify')}
            />
          ) : (
            // The server said this is shareable but the projection it sent did
            // not pass the browser's own validator. The coach was promised they
            // would see exactly what becomes public, so this is a refusal, not
            // a formality to wave through, and it says so rather than showing
            // an empty frame or inventing a blocker.
            <div role="alert" className="public-blocked">
              We could not show what this {noun} would look like publicly, so there is nothing to
              confirm. Try again, and tell an admin if it keeps happening.
            </div>
          )}
          {gate.showConfirmNote && <p className="public-confirm-note">{PUBLISH_CONFIRM}</p>}
          {previewStale && (
            <p role="status" className="muted" style={{ fontSize: 13, marginTop: 8 }}>
              The sharing level changed. Check the preview again before creating a link.
            </p>
          )}
          {previewStale && (
            <button type="button" className="btn btn-ghost" style={{ minHeight: 44, marginTop: 6 }} onClick={startPreview}>
              Check again
            </button>
          )}
          {error && <ActionError onRetry={confirmCreate}>{error}</ActionError>}
        </>
      )}

      {step === 'classify' && (
        <div className="share-classify">
          <p style={{ fontSize: 14, lineHeight: 1.55, marginTop: 0 }}>
            Choose how far this {noun} may travel. Nothing is published by choosing a level; you still see the preview
            and confirm before a link exists.
          </p>
          <RightsControl
            kind={kind}
            id={sourceId}
            current={rights}
            source={source}
            canEdit={canClassify}
            idPrefix={`share-rights-${sourceId}`}
            onSaved={() => setPreviewStale(true)}
            onSavingChange={setClassifying}
          />
          {previewStale && (
            <button
              type="button"
              className="btn btn-primary"
              style={{ minHeight: 44, marginTop: 12 }}
              onClick={startPreview}
            >
              Check the preview again
            </button>
          )}
          {error && <ActionError onRetry={startPreview}>{error}</ActionError>}
        </div>
      )}

      {step === 'result' && result && (
        <PublicShareResultView
          url={result.url}
          expiresAt={result.expiresAt}
          copyState={copyState}
          onCopy={onCopy}
          onShare={onSend}
          canNativeShare={canNativeShare}
        />
      )}

      {step === 'manage' && !share && (
        <div className="public-manage">
          {/* Reached when a create answered "one already exists" while this
              caller cannot see the row (a custom role with shares.create and no
              shares.manage, or a status read that has not caught up). The
              message that sent us here is rendered below; without this arm the
              step was a blank page with a Back button. */}
          <p style={{ marginTop: 0 }}>
            There is already a public link for this {noun}. Its details are not visible to you.
          </p>
        </div>
      )}

      {step === 'manage' && share && (
        <div className="public-manage">
          <p className="muted" style={{ marginTop: 0 }}>
            {expired ? 'This link has expired. Updating what people see starts it again.' : expiryLabel(share.expiresAt)}
          </p>
          <button type="button" className="btn btn-ghost btn-block" style={{ minHeight: 44 }} onClick={doRefresh} disabled={writing}>
            {refresh.isPending ? 'Updating…' : 'Update what people see'}
          </button>
          <p className="muted" style={{ fontSize: 12.5 }}>
            Rebuilds the public copy from the current {noun}. The link stays the same.
          </p>

          <button type="button" className="btn btn-ghost btn-block" style={{ minHeight: 44 }} onClick={doRotate} disabled={writing}>
            {rotate.isPending ? 'Replacing…' : 'Replace this link'}
          </button>
          <p className="muted" style={{ fontSize: 12.5 }}>{ROTATE_WARNING}</p>

          <button
            type="button"
            className="btn btn-block"
            style={{ minHeight: 44, color: 'var(--m-pdf)' }}
            onClick={() => setStep('confirmRevoke')}
            disabled={writing}
          >
            Turn off this link
          </button>
        </div>
      )}

      {step === 'manage' && error && <ActionError onRetry={share ? doRefresh : undefined}>{error}</ActionError>}

      {step === 'confirmRevoke' && (
        <>
          <p>
            The link will stop working straight away. Anyone you already sent it to will see an unavailable message.
          </p>
          {error && <ActionError onRetry={doRevoke}>{error}</ActionError>}
        </>
      )}
    </Modal>
  )
}

// The page level action: one button, in the page's own action row.
export function ShareAction({
  buttonClassName = 'btn btn-ghost',
  ...props
}: Omit<ShareDialogProps, 'onClose'> & { buttonClassName?: string }) {
  const [open, setOpen] = useState(false)
  // A member with none of the three affordances gets no button at all.
  if (!props.canShareInternal && !props.canPublish && !props.canRevokeAny) return null
  return (
    <>
      <button
        type="button"
        className={buttonClassName}
        style={{ minHeight: 44 }}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <Icon.share />
        Share
      </button>
      {open && <ShareDialog {...props} onClose={() => setOpen(false)} />}
    </>
  )
}
