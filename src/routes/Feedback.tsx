// /feedback: the club's feedback log. Feature requests, bug reports and
// general feedback, club visible by design so duplicates are avoided and
// status is transparent. Every member reads and files; a creator edits and
// deletes their own items; holders of club.manage move status through the
// select on each row. The feedback RLS plus the status guard trigger are the
// enforcement; the UI only decides what to surface.
//
// VISUAL-02 brought it onto the shared system: PageHeader, Card, Button and
// IconButton, the field primitives, Note, Badge and the shared state
// families. Nothing about the queries, the capability gates, the ownership
// rules, the status vocabulary, the GitHub promotion or what it posts moved;
// what changed is which vocabulary draws them.
import { useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useAuth } from '../hooks/useAuth'
import { useFocusRestore } from '../hooks/useFocusRestore'
import {
  useAddFeedbackComment,
  useDeleteFeedback,
  useDeleteFeedbackComment,
  useEditFeedbackComment,
  useFeedback,
  useFeedbackComments,
  useFeedbackCommentCounts,
  useInsertFeedback,
  useMemberMap,
  useMyCapabilities,
  usePromoteFeedbackToGithub,
  useRefreshFeedbackFromGithub,
  useSetFeedbackStatus,
  useUpdateFeedback,
} from '../lib/queries'
import type { FeedbackInput } from '../lib/queries'
import { FEEDBACK_KIND_LABELS, FEEDBACK_KINDS, FEEDBACK_STATUS_LABELS, FEEDBACK_STATUSES } from '../lib/data'
import type { FeedbackComment, FeedbackItem, FeedbackKind, FeedbackStatus } from '../lib/data'
import { Icon } from '../components/icons'
import { Empty, ErrorNote, LoadingRows, Modal } from '../components/ui'
import {
  Badge,
  Button,
  Card,
  IconButton,
  Note,
  PageHeader,
  SelectField,
  TextAreaField,
  TextField,
  buttonClass,
} from '../components/primitives'
import type { BadgeTone } from '../components/primitives'

/* STATUS IS A STATE, SO IT TAKES THE SEMANTIC TONES. Where an item stands is
   exactly what the Badge primitive is for, and this mapping is the colours
   the screen already carried, said in the shared vocabulary rather than in a
   local color-mix: slate, royal, warning, success and danger become neutral,
   info, warning, success and danger. Every one of them is a dot AND a word,
   so the state is never carried by colour alone.

   KIND IS A CLASSIFICATION AND DELIBERATELY TAKES NONE. It used to be painted
   --royal, --danger and --warning, which is a state palette standing in for a
   category: a General item is not a warning, and a Bug report is not an error
   the screen has just had. 2.2 keeps classification and state apart, and the
   product has no classification palette for feedback kinds (--c-* is the four
   corners and --m-* is media type, and neither may be borrowed). Inventing a
   third one is a token decision rather than an adoption, so the kind is a
   neutral Badge and the WORD is what tells the three apart. The cost is
   stated: a coach can no longer pick the bugs out of a list by hue, and what
   carries hue now is the status, which is the thing they scan for. */
const STATUS_TONE: Record<FeedbackStatus, BadgeTone> = {
  new: 'neutral',
  planned: 'info',
  in_progress: 'warning',
  done: 'success',
  declined: 'danger',
}

// The filed date as a coarse age: "just now", "3 days ago". Past a month the
// calendar date says it better.
function filedAgo(createdAt: string, now: Date = new Date()): string {
  const ms = now.getTime() - Date.parse(createdAt)
  if (!Number.isFinite(ms)) return ''
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  if (days < 31) return `${days} day${days === 1 ? '' : 's'} ago`
  return new Date(createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

const commentLabel = (n: number) => `${n} ${n === 1 ? 'comment' : 'comments'}`

/* WHAT THIS SCREEN'S DIALOGS DO ABOUT FOCUS, AND WHY IT IS NOT HERE.

   Every dialog on this screen freezes its submit while its write is in
   flight, and this is where the six local repairs for that used to sit. They
   are gone, and the reason is worth keeping: measured in a browser, Chrome
   fires NO blur when the focused element is DISABLED, so `Modal`'s own
   focusout recovery never ran for the one case it was written for, and both a
   refused write and a write in flight left `document.activeElement` on the
   document body. That leaves the dialog's Escape handling and its Tab trap
   dead, because both are bound to the dialog element and only fire while
   focus is inside it.

   That is `Modal`'s gap rather than this screen's, and it was true of every
   dialog in the product, so it is fixed in `Modal` (src/components/ui.tsx)
   rather than six times here. A local repair would also have been dead code
   the day the primitive was fixed: child effects run before parent ones, so
   `Modal` reaches the lost focus first and a caller's own restore then finds
   focus already inside the dialog and correctly does nothing.

   What IS repaired here is the three outcomes that are not inside a dialog at
   all: the status select, the reply box and a deleted row. Each is measured
   and driven in tools/visual/checks.mjs. */

/* One row's CONTENT, presentational so the test can pin who sees the status
   select and the owner affordances without a query client. Tapping the title
   expands the details. Members without club.manage read the status as a Badge
   on the meta line, which is where the row's facts are; a holder edits it as
   a select in the action cluster, which is where its controls are.

   The <li> belongs to FeedbackRow rather than here, because the row's DIALOGS
   have to sit inside it: a Modal renders its own overlay, and a row that
   returned its <li> and its overlays side by side put a <div> among the <ul>'s
   children. Measured: invalid list markup for assistive technology, and the
   `.fb-item + .fb-item` separator on the row AFTER the open dialog went from
   1px to 0. Codex. */
export function FeedbackCard({
  item,
  authorName,
  isOwner,
  canManage,
  commentCount = 0,
  onEdit,
  onDelete,
  onStatus,
  onPromote,
  statusBusy,
  statusError,
  thread,
}: {
  item: FeedbackItem
  authorName: string
  isOwner: boolean
  canManage: boolean
  commentCount?: number
  onEdit: () => void
  onDelete: () => void
  onStatus: (status: FeedbackStatus) => void
  onPromote?: () => void
  statusBusy?: boolean
  statusError?: string
  thread?: ReactNode
}) {
  const [expanded, setExpanded] = useState(false)
  const panelId = useId()
  /* A select the settling render disables is blurred by the browser, so a
     manager who changed the status with the keyboard was left on the document
     body with the list behind them. useFocusRestore only acts when focus was
     actually lost, so a manager who moved on while the write was running
     keeps their place. */
  const statusRef = useRef<HTMLSelectElement>(null)
  const restoreStatusFocus = useFocusRestore(!statusBusy, statusRef)

  return (
    <>
      <div className="fb-head">
        <div className="fb-main">
          <button
            type="button"
            className="fb-toggle"
            aria-expanded={expanded}
            aria-controls={panelId}
            onClick={() => setExpanded((v) => !v)}
          >
            <Icon.chevDown className="fb-caret" aria-hidden="true" />
            <span className="fb-title">{item.title}</span>
          </button>
          <div className="fb-meta">
            <Badge>{FEEDBACK_KIND_LABELS[item.kind]}</Badge>
            {/* The status where it is read only. It is here rather than in
                the action cluster, and in exactly one of the two: the meta
                line holds the row's FACTS and the cluster holds its CONTROLS,
                which is why a club.manage holder finds the same status as a
                select over there instead. */}
            {!canManage && <Badge tone={STATUS_TONE[item.status]}>{FEEDBACK_STATUS_LABELS[item.status]}</Badge>}
            <span className="fb-by">
              {authorName} · {filedAgo(item.createdAt)}
            </span>
            {commentCount > 0 && (
              <span className="fb-comments mono" aria-label={commentLabel(commentCount)}>
                <Icon.comment aria-hidden="true" />
                {commentCount}
              </span>
            )}
          </div>
        </div>
        <div className="fb-acts">
          {canManage && (
            <>
              <select
                className="select fb-status"
                ref={statusRef}
                aria-label={'Status of ' + item.title}
                value={item.status}
                disabled={statusBusy}
                onChange={(e) => {
                  restoreStatusFocus()
                  onStatus(e.target.value as FeedbackStatus)
                }}
              >
                {FEEDBACK_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {FEEDBACK_STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
              {/* The write in flight, said in words rather than left to the
                  disabled control's opacity. role="status" so it is announced
                  as well as shown. */}
              {statusBusy && (
                <span className="fb-status-busy" role="status">
                  Saving…
                </span>
              )}
            </>
          )}
          {item.githubIssueNumber != null && item.githubIssueUrl ? (
            // Shown club wide once the item is promoted: the public issue's own
            // link. Replaces the promote action; an item is promoted once.
            <a
              className={buttonClass('ghost', 'sm')}
              href={item.githubIssueUrl}
              target="_blank"
              rel="noreferrer"
              aria-label={'GitHub issue #' + item.githubIssueNumber}
            >
              <Icon.external aria-hidden="true" />
              Issue #{item.githubIssueNumber}
            </a>
          ) : (
            canManage &&
            onPromote && (
              // Admin only: a coach never holds club.manage and never sees this.
              // Opens the panel that makes the public nature explicit.
              <Button
                size="sm"
                icon={Icon.external}
                aria-label={'Promote ' + item.title + ' to a GitHub issue'}
                onClick={onPromote}
              >
                Promote to GitHub
              </Button>
            )
          )}
          {isOwner && (
            <>
              <IconButton label={'Edit ' + item.title} icon={Icon.edit} onClick={onEdit} />
              <IconButton label={'Delete ' + item.title} icon={Icon.trash} onClick={onDelete} />
            </>
          )}
        </div>
      </div>
      {statusError && (
        <Note tone="danger" role="alert" className="fb-note">
          {statusError}
        </Note>
      )}
      {/* Rendered whether or not it is open, so aria-controls names an element
          that exists. Its CONTENT is mounted only while it is open, which is
          what keeps the comment read lazy: FeedbackThread is the only caller
          of useFeedbackComments, so a closed row fetches nothing. */}
      <div id={panelId} className="fb-panel" hidden={!expanded}>
        {expanded && (
          <>
            {item.body && <p className="fb-body">{item.body}</p>}
            {thread}
          </>
        )}
      </div>
    </>
  )
}

// The shared create and edit form, presentational over the mutation wiring
// so the test can pin its validation. Send stays disabled until the title
// passes the 3 character minimum the check constraint enforces, so a refusal
// the server would give never leaves the form.
export function FeedbackFormModal({
  title,
  sub,
  submitLabel,
  busyLabel,
  initial,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  title: string
  sub: string
  submitLabel: string
  busyLabel: string
  initial?: FeedbackInput
  busy: boolean
  error: string
  onClose: () => void
  onSubmit: (input: FeedbackInput) => void
}) {
  const [kind, setKind] = useState<FeedbackKind>(initial?.kind ?? 'feature')
  const [titleDraft, setTitleDraft] = useState(initial?.title ?? '')
  const [body, setBody] = useState(initial?.body ?? '')
  const ready = titleDraft.trim().length >= 3

  return (
    <Modal
      title={title}
      sub={sub}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            icon={Icon.check}
            onClick={() => onSubmit({ kind, title: titleDraft, body })}
            disabled={!ready || busy}
          >
            {busy ? busyLabel : submitLabel}
          </Button>
        </>
      }
    >
      <SelectField label="Kind" value={kind} onChange={(e) => setKind(e.target.value as FeedbackKind)}>
        {FEEDBACK_KINDS.map((k) => (
          <option key={k} value={k}>
            {FEEDBACK_KIND_LABELS[k]}
          </option>
        ))}
      </SelectField>
      <TextField
        label="Title"
        value={titleDraft}
        maxLength={120}
        placeholder="A short summary, at least 3 characters"
        onChange={(e) => setTitleDraft(e.target.value)}
      />
      <TextAreaField
        label="Details"
        rows={5}
        maxLength={2000}
        value={body}
        placeholder="What happened, or what would help. Optional."
        onChange={(e) => setBody(e.target.value)}
      />
      {error && (
        <Note tone="danger" role="alert">
          {error}
        </Note>
      )}
    </Modal>
  )
}

function NewFeedbackModal({ onClose }: { onClose: () => void }) {
  const insert = useInsertFeedback()
  return (
    <FeedbackFormModal
      title="New feedback"
      sub="Visible to the whole club, so check the log for duplicates first."
      submitLabel="Send feedback"
      busyLabel="Sending…"
      busy={insert.isPending}
      error={insert.isError ? insert.error.message : ''}
      onClose={onClose}
      onSubmit={(input) => insert.mutate(input, { onSuccess: onClose })}
    />
  )
}

function EditFeedbackModal({ item, onClose }: { item: FeedbackItem; onClose: () => void }) {
  const update = useUpdateFeedback()
  return (
    <FeedbackFormModal
      title="Edit feedback"
      sub="Title, details and kind. Status moves with the club admins."
      submitLabel="Save changes"
      busyLabel="Saving…"
      initial={{ kind: item.kind, title: item.title, body: item.body }}
      busy={update.isPending}
      error={update.isError ? update.error.message : ''}
      onClose={onClose}
      onSubmit={(input) => update.mutate({ id: item.id, input }, { onSuccess: onClose })}
    />
  )
}

function DeleteFeedbackModal({
  item,
  onClose,
  onDeleted,
}: {
  item: FeedbackItem
  onClose: () => void
  onDeleted: () => void
}) {
  const del = useDeleteFeedback()
  return (
    <Modal
      title="Delete feedback"
      sub={item.title}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={del.isPending}>
            Cancel
          </Button>
          {/* The destructive control. Red is never the only cue: the label
              carries the word Delete and the dialog names the item. */}
          <Button
            variant="danger"
            icon={Icon.trash}
            onClick={() => del.mutate({ id: item.id }, { onSuccess: onDeleted })}
            disabled={del.isPending}
          >
            {del.isPending ? 'Deleting…' : 'Delete'}
          </Button>
        </>
      }
    >
      <p className="modal-copy">
        This removes the item and its status history from the club's log. If it was declined or done, leaving it
        visible keeps the record straight.
      </p>
      {del.isError && (
        <Note tone="danger" role="alert">
          {del.error.message}
        </Note>
      )}
    </Modal>
  )
}

// Promotes an item to a public GitHub issue. club.manage only (the function
// gates on it; FeedbackCard only surfaces the action to holders). The panel
// makes the public nature explicit, pre fills the title and body from the
// item for the admin to edit, and on success shows the created issue link.
// The admin's edited text is what is posted; no AI drafts it in this phase.
function PromoteToGithubModal({ item, onClose }: { item: FeedbackItem; onClose: () => void }) {
  const promote = usePromoteFeedbackToGithub()
  const [title, setTitle] = useState(item.title)
  const [body, setBody] = useState(item.body)
  const [done, setDone] = useState<{ number: number | null; url: string; warning: string } | null>(null)
  const ready = title.trim().length >= 3

  const submit = () => {
    if (!ready) return
    promote.mutate(
      { id: item.id, title, body },
      { onSuccess: (r) => setDone({ number: r.issueNumber, url: r.issueUrl, warning: r.warning }) },
    )
  }

  return (
    <Modal
      title="Promote to GitHub issue"
      sub="Opens a public issue on the project repository."
      onClose={onClose}
      // The dialog replaces its own body in place when the issue is created,
      // so focus is pulled back to the container and the new title announced.
      focusKey={done ? 'done' : 'form'}
      footer={
        done ? (
          <Button variant="primary" icon={Icon.check} onClick={onClose}>
            Done
          </Button>
        ) : (
          <>
            <Button onClick={onClose} disabled={promote.isPending}>
              Cancel
            </Button>
            <Button variant="primary" icon={Icon.external} onClick={submit} disabled={!ready || promote.isPending}>
              {promote.isPending ? 'Creating…' : 'Create issue'}
            </Button>
          </>
        )
      }
    >
      {done ? (
        <>
          <Note tone="success" role="status">
            The issue was created.
          </Note>
          <p className="fb-issue-link">
            <a className={buttonClass('ghost', 'sm')} href={done.url} target="_blank" rel="noreferrer">
              <Icon.external aria-hidden="true" />
              {done.number != null ? `Issue #${done.number}` : 'View issue'}
            </a>
          </p>
          {/* The issue exists either way; what this says is that writing the
              link back to the club's own row did not settle. A warning rather
              than an error, because the public half succeeded. */}
          {done.warning && (
            <Note tone="warning" role="alert">
              {done.warning}
            </Note>
          )}
        </>
      ) : (
        <>
          {/* DELIBERATELY THE DANGER TONE, not the warning one. This is the
              notice that stands between a child's name and a public
              repository, and a visual slice does not soften it. The words are
              unchanged; what it gains is the glyph, the full contrast ink and
              a border, in place of 13.5px --danger text on a color-mix tint. */}
          <Note tone="danger" className="fb-promote-warning">
            The repository is public, so this issue is world readable. Do not include any name, child's name, email,
            contact or private detail. Only the title and details below are posted.
          </Note>
          <TextField
            label="Issue title"
            value={title}
            maxLength={256}
            placeholder="A short summary, at least 3 characters"
            onChange={(e) => setTitle(e.target.value)}
          />
          <TextAreaField
            label="Issue details"
            rows={6}
            value={body}
            placeholder="What the issue is. This text is posted publicly."
            onChange={(e) => setBody(e.target.value)}
          />
          {promote.isError && (
            <Note tone="danger" role="alert">
              {promote.error.message}
            </Note>
          )}
        </>
      )}
    </Modal>
  )
}

// One comment in a thread, presentational so the test can pin who sees the
// edit and delete affordances. An author sees edit and delete on their own
// comment; a club.manage holder sees delete on any comment for moderation.
export function CommentRow({
  comment,
  authorName,
  isOwner,
  canManage,
  onEdit,
  onDelete,
}: {
  comment: FeedbackComment
  authorName: string
  isOwner: boolean
  canManage: boolean
  onEdit: () => void
  onDelete: () => void
}) {
  const edited = comment.updatedAt && comment.updatedAt !== comment.createdAt
  return (
    <li className="fb-comment">
      <div className="fb-comment-main">
        <span className="fb-by">
          {authorName} · {filedAgo(comment.createdAt)}
          {edited ? ' · edited' : ''}
        </span>
        <p className="fb-comment-body">{comment.body}</p>
      </div>
      <div className="fb-comment-acts">
        {isOwner && <IconButton label={'Edit comment by ' + authorName} icon={Icon.edit} onClick={onEdit} />}
        {(isOwner || canManage) && (
          <IconButton label={'Delete comment by ' + authorName} icon={Icon.trash} onClick={onDelete} />
        )}
      </div>
    </li>
  )
}

// The thread under an expanded item, presentational over the resolved names
// and the ownership and capability flags. Comments arrive oldest first so the
// conversation reads top to bottom.
export function CommentThread({
  comments,
  authorNameFor,
  currentUserId,
  canManage,
  onEdit,
  onDelete,
}: {
  comments: FeedbackComment[]
  authorNameFor: (createdBy: string) => string
  currentUserId?: string
  canManage: boolean
  onEdit: (comment: FeedbackComment) => void
  onDelete: (comment: FeedbackComment) => void
}) {
  if (comments.length === 0) {
    return <p className="fb-thread-empty">No comments yet. Start the conversation below.</p>
  }
  return (
    <ul className="fb-comment-list">
      {comments.map((comment) => (
        <CommentRow
          key={comment.id}
          comment={comment}
          authorName={authorNameFor(comment.createdBy)}
          isOwner={comment.createdBy === currentUserId}
          canManage={canManage}
          onEdit={() => onEdit(comment)}
          onDelete={() => onDelete(comment)}
        />
      ))}
    </ul>
  )
}

// Edits a comment's body in a small modal. Body only, matching the update
// policy.
function EditCommentModal({ comment, onClose }: { comment: FeedbackComment; onClose: () => void }) {
  const edit = useEditFeedbackComment()
  const [body, setBody] = useState(comment.body)
  const ready = body.trim().length >= 1
  return (
    <Modal
      title="Edit comment"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={edit.isPending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            icon={Icon.check}
            onClick={() => edit.mutate({ id: comment.id, body }, { onSuccess: onClose })}
            disabled={!ready || edit.isPending}
          >
            {edit.isPending ? 'Saving…' : 'Save changes'}
          </Button>
        </>
      }
    >
      <TextAreaField
        label="Comment"
        rows={4}
        maxLength={2000}
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      {edit.isError && (
        <Note tone="danger" role="alert">
          {edit.error.message}
        </Note>
      )}
    </Modal>
  )
}

// Confirms a comment delete. Reachable by the author or a club.manage holder
// moderating; the RLS decides which.
function DeleteCommentModal({ comment, onClose }: { comment: FeedbackComment; onClose: () => void }) {
  const del = useDeleteFeedbackComment()
  return (
    <Modal
      title="Delete comment"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={del.isPending}>
            Cancel
          </Button>
          <Button
            variant="danger"
            icon={Icon.trash}
            onClick={() => del.mutate({ id: comment.id }, { onSuccess: onClose })}
            disabled={del.isPending}
          >
            {del.isPending ? 'Deleting…' : 'Delete'}
          </Button>
        </>
      }
    >
      <p className="modal-copy">This removes the comment from the thread for the whole club.</p>
      {del.isError && (
        <Note tone="danger" role="alert">
          {del.error.message}
        </Note>
      )}
    </Modal>
  )
}

// Wires an item's thread to its hooks: the comment list, the reply box, and
// the edit and delete modals. Mounted only when the item is expanded, so a
// closed row fetches nothing.
function FeedbackThread({ feedbackId, canManage }: { feedbackId: string; canManage: boolean }) {
  const { user } = useAuth()
  const { data: comments = [], isLoading, isError, refetch } = useFeedbackComments(feedbackId)
  const memberById = useMemberMap()
  const add = useAddFeedbackComment()
  const [reply, setReply] = useState('')
  const [editing, setEditing] = useState<FeedbackComment | null>(null)
  const [deleting, setDeleting] = useState<FeedbackComment | null>(null)
  const ready = reply.trim().length >= 1
  /* Posting disables the button that had focus, and a successful post empties
     the box so it stays disabled. Either way the browser leaves focus on the
     document body. The reply box is the right place to land in both outcomes:
     it is where the next thing a member does happens, and on a refusal their
     text is still in it. */
  const replyRef = useRef<HTMLTextAreaElement>(null)
  const restoreReplyFocus = useFocusRestore(!add.isPending, replyRef)

  const post = () => {
    if (!ready) return
    restoreReplyFocus()
    add.mutate({ feedbackId, body: reply }, { onSuccess: () => setReply('') })
  }

  return (
    <div className="fb-thread">
      {isLoading ? (
        <LoadingRows rows={2} label="Loading comments…" />
      ) : isError ? (
        <ErrorNote onRetry={() => refetch()} />
      ) : (
        <CommentThread
          comments={comments}
          authorNameFor={(id) => memberById[id]?.fullName || '—'}
          currentUserId={user?.id}
          canManage={canManage}
          onEdit={setEditing}
          onDelete={setDeleting}
        />
      )}
      <TextAreaField
        className="fb-reply"
        label="Reply"
        ref={replyRef}
        rows={2}
        maxLength={2000}
        value={reply}
        placeholder="Add a comment, visible to the whole club."
        onChange={(e) => setReply(e.target.value)}
      />
      <div className="fb-thread-acts">
        <Button variant="primary" size="sm" icon={Icon.check} onClick={post} disabled={!ready || add.isPending}>
          {add.isPending ? 'Posting…' : 'Post comment'}
        </Button>
      </div>
      {add.isError && (
        <Note tone="danger" role="alert" className="fb-note">
          {add.error.message}
        </Note>
      )}
      {editing && <EditCommentModal comment={editing} onClose={() => setEditing(null)} />}
      {deleting && <DeleteCommentModal comment={deleting} onClose={() => setDeleting(null)} />}
    </div>
  )
}

// Wires one row to its mutations: the status select for club.manage holders
// and the creator's edit and delete modals.
function FeedbackRow({
  item,
  authorName,
  isOwner,
  canManage,
  commentCount,
  onDeleted,
}: {
  item: FeedbackItem
  authorName: string
  isOwner: boolean
  canManage: boolean
  commentCount: number
  onDeleted: () => void
}) {
  const setStatus = useSetFeedbackStatus()
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [promoting, setPromoting] = useState(false)
  return (
    // The dialogs are inside the row's own <li>, not beside it: an overlay
    // rendered as a sibling would be a <div> among the list's <li> children.
    <li className="fb-item">
      <FeedbackCard
        item={item}
        authorName={authorName}
        isOwner={isOwner}
        canManage={canManage}
        commentCount={commentCount}
        onEdit={() => setEditing(true)}
        onDelete={() => setDeleting(true)}
        onStatus={(status) => setStatus.mutate({ id: item.id, status })}
        onPromote={() => setPromoting(true)}
        statusBusy={setStatus.isPending}
        statusError={setStatus.isError ? setStatus.error.message : ''}
        thread={<FeedbackThread feedbackId={item.id} canManage={canManage} />}
      />
      {editing && <EditFeedbackModal item={item} onClose={() => setEditing(false)} />}
      {deleting && (
        <DeleteFeedbackModal
          item={item}
          onClose={() => setDeleting(false)}
          onDeleted={() => {
            setDeleting(false)
            onDeleted()
          }}
        />
      )}
      {promoting && <PromoteToGithubModal item={item} onClose={() => setPromoting(false)} />}
    </li>
  )
}

export function Feedback() {
  const { user } = useAuth()
  const { caps } = useMyCapabilities()
  const { data: items = [], isLoading, isError, refetch } = useFeedback()
  const memberById = useMemberMap()
  const { data: commentCounts = {} } = useFeedbackCommentCounts()
  const [creating, setCreating] = useState(false)
  const canManage = caps.has('club.manage')
  /* A successful delete takes the row, and with it the icon button the dialog
     would restore focus to, so the browser drops focus onto the document
     body. The page's one primary action is the stable place to land: it is
     the first control in the reading order after the heading, and Tab from it
     reaches the list.

     WHAT IS WAITED FOR IS THE ROW LEAVING THE LIST, not the write settling,
     and the two are a network round trip apart. Modal restores focus to its
     opener while the row is still listed, because the refetch has not
     answered yet; the row then unmounts under the focused button and the
     browser drops focus again. A settled-write flag would have moved focus
     before that second loss and left the member on the body anyway. */
  const newRef = useRef<HTMLButtonElement>(null)
  const [deletedId, setDeletedId] = useState<string | null>(null)
  const rowGone = deletedId !== null && !items.some((i) => i.id === deletedId)
  const restoreAfterDelete = useFocusRestore(rowGone, newRef)

  // Issue #83, the issue-state-flows-back half: when an admin opens this
  // screen, refresh promoted items from their GitHub issues so any item whose
  // issue is now closed moves to done. Polling on open, not a webhook. It runs
  // once per open (the ref guards re renders) and only for a club.manage
  // holder; a coach or parent never fires it, and the function gates on
  // club.manage regardless. It is quiet: no spinner and nothing blocks, the
  // list renders now and the refresh invalidates the feedback query when it
  // returns so a moved status simply appears. Any failure is swallowed.
  const { mutate: refreshFromGithub } = useRefreshFeedbackFromGithub()
  const refreshedRef = useRef(false)
  useEffect(() => {
    if (!canManage || refreshedRef.current) return
    refreshedRef.current = true
    refreshFromGithub()
  }, [canManage, refreshFromGithub])

  return (
    <div className="feedback">
      <PageHeader
        title="Feedback"
        sub="Feature requests, bugs and general feedback, club wide so nothing is filed twice."
        actions={
          <Button variant="primary" icon={Icon.plus} ref={newRef} onClick={() => setCreating(true)}>
            New feedback
          </Button>
        }
      />
      <Card>
        {isLoading ? (
          <LoadingRows rows={4} label="Loading feedback…" />
        ) : isError ? (
          <ErrorNote onRetry={() => refetch()} />
        ) : items.length === 0 ? (
          <Empty icon={Icon.note} title="No feedback yet">
            File the first item above. The whole club sees the log and where each item stands.
          </Empty>
        ) : (
          <ul className="fb-list">
            {items.map((item) => (
              <FeedbackRow
                key={item.id}
                item={item}
                authorName={memberById[item.createdBy]?.fullName || '—'}
                isOwner={item.createdBy === user?.id}
                canManage={canManage}
                commentCount={commentCounts[item.id] ?? 0}
                onDeleted={() => {
                  restoreAfterDelete()
                  setDeletedId(item.id)
                }}
              />
            ))}
          </ul>
        )}
      </Card>
      {creating && <NewFeedbackModal onClose={() => setCreating(false)} />}
    </div>
  )
}
