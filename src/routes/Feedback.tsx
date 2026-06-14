// /feedback: the club's feedback log. Feature requests, bug reports and
// general feedback, club visible by design so duplicates are avoided and
// status is transparent. Every member reads and files; a creator edits and
// deletes their own items; holders of club.manage move status through the
// select on each row. The feedback RLS plus the status guard trigger are the
// enforcement; the UI only decides what to surface.
import { useState } from 'react'
import type { ReactNode } from 'react'
import { useAuth } from '../hooks/useAuth'
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
  useSetFeedbackStatus,
  useUpdateFeedback,
} from '../lib/queries'
import type { FeedbackInput } from '../lib/queries'
import { FEEDBACK_KIND_LABELS, FEEDBACK_KINDS, FEEDBACK_STATUS_LABELS, FEEDBACK_STATUSES } from '../lib/data'
import type { FeedbackComment, FeedbackItem, FeedbackKind, FeedbackStatus } from '../lib/data'
import { Icon } from '../components/icons'
import { Empty, ErrorNote, Loading, Modal } from '../components/ui'

// Badge colours lean on existing tokens, the MatchBadge pattern: a tinted
// background with the full strength colour as text.
const KIND_COLOR: Record<FeedbackKind, string> = {
  feature: 'var(--royal)',
  bug: 'var(--m-pdf)',
  general: 'var(--c-social)',
}

const STATUS_COLOR: Record<FeedbackStatus, string> = {
  new: 'var(--slate)',
  planned: 'var(--royal)',
  in_progress: 'var(--c-social)',
  done: 'var(--m-image)',
  declined: 'var(--m-pdf)',
}

function TagBadge({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span
      className="tag"
      style={{ background: `color-mix(in srgb, ${color} 14%, transparent)`, color, whiteSpace: 'nowrap' }}
    >
      {children}
    </span>
  )
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

// One row of the log, presentational so the test can pin who sees the status
// select and the owner affordances without a query client. Tapping the text
// expands the details; members without club.manage see the status as a
// badge, holders see the select in its place.
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
  return (
    <div style={{ padding: '12px 0', borderTop: '1px solid var(--line)' }}>
      <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
        <button
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
          style={{
            flex: 1,
            minWidth: 0,
            textAlign: 'left',
            background: 'none',
            border: 0,
            padding: 0,
            color: 'inherit',
            font: 'inherit',
            cursor: 'pointer',
          }}
        >
          <span className="row wrap" style={{ gap: 8 }}>
            <TagBadge color={KIND_COLOR[item.kind]}>{FEEDBACK_KIND_LABELS[item.kind]}</TagBadge>
            <b style={{ fontSize: 14.5 }}>{item.title}</b>
            {commentCount > 0 && (
              <span
                className="row mono"
                aria-label={commentCount + (commentCount === 1 ? ' comment' : ' comments')}
                title={commentCount + (commentCount === 1 ? ' comment' : ' comments')}
                style={{ gap: 3, alignItems: 'center', color: 'var(--slate)', fontSize: 12 }}
              >
                <Icon.comment width={14} height={14} />
                {commentCount}
              </span>
            )}
          </span>
          <span className="muted" style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginTop: 3 }}>
            {authorName} · {filedAgo(item.createdAt)}
          </span>
        </button>
        {canManage ? (
          <select
            className="select"
            aria-label={'Status of ' + item.title}
            value={item.status}
            disabled={statusBusy}
            onChange={(e) => onStatus(e.target.value as FeedbackStatus)}
            style={{ height: 34, borderRadius: 9, padding: '0 10px', fontSize: 12.5 }}
          >
            {FEEDBACK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {FEEDBACK_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        ) : (
          <TagBadge color={STATUS_COLOR[item.status]}>{FEEDBACK_STATUS_LABELS[item.status]}</TagBadge>
        )}
        {item.githubIssueNumber != null && item.githubIssueUrl ? (
          // Shown club wide once the item is promoted: the public issue's own
          // link. Replaces the promote action; an item is promoted once.
          <a
            className="tag"
            href={item.githubIssueUrl}
            target="_blank"
            rel="noreferrer"
            aria-label={'GitHub issue #' + item.githubIssueNumber}
            style={{ gap: 4, alignItems: 'center', whiteSpace: 'nowrap', textDecoration: 'none' }}
          >
            <Icon.external width={13} height={13} />
            Issue #{item.githubIssueNumber}
          </a>
        ) : (
          canManage &&
          onPromote && (
            // Admin only: a coach never holds club.manage and never sees this.
            // Opens the panel that makes the public nature explicit.
            <button
              className="btn btn-ghost btn-sm"
              aria-label={'Promote ' + item.title + ' to a GitHub issue'}
              onClick={onPromote}
              style={{ whiteSpace: 'nowrap' }}
            >
              <Icon.external />
              Promote to GitHub
            </button>
          )
        )}
        {isOwner && (
          <>
            <button
              className="btn btn-ghost btn-sm icon-only"
              style={{ width: 36, padding: 0 }}
              aria-label={'Edit ' + item.title}
              onClick={onEdit}
            >
              <Icon.edit />
            </button>
            <button
              className="btn btn-ghost btn-sm icon-only"
              style={{ width: 36, padding: 0 }}
              aria-label={'Delete ' + item.title}
              onClick={onDelete}
            >
              <Icon.trash />
            </button>
          </>
        )}
      </div>
      {expanded && (
        <>
          {item.body && (
            <p style={{ fontSize: 14, lineHeight: 1.55, margin: '8px 0 0', whiteSpace: 'pre-wrap' }}>{item.body}</p>
          )}
          {thread}
        </>
      )}
      {statusError && (
        <p className="muted" style={{ fontSize: 12.5, color: 'var(--m-pdf)', margin: '6px 0 0' }}>
          {statusError}
        </p>
      )}
    </div>
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
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={() => onSubmit({ kind, title: titleDraft, body })}
            disabled={!ready || busy}
          >
            <Icon.check />
            {busy ? busyLabel : submitLabel}
          </button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="feedback-kind">Kind</label>
        <select id="feedback-kind" value={kind} onChange={(e) => setKind(e.target.value as FeedbackKind)}>
          {FEEDBACK_KINDS.map((k) => (
            <option key={k} value={k}>
              {FEEDBACK_KIND_LABELS[k]}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="feedback-title">Title</label>
        <input
          id="feedback-title"
          value={titleDraft}
          maxLength={120}
          placeholder="A short summary, at least 3 characters"
          onChange={(e) => setTitleDraft(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="feedback-body">Details</label>
        <textarea
          id="feedback-body"
          rows={5}
          maxLength={2000}
          value={body}
          placeholder="What happened, or what would help. Optional."
          onChange={(e) => setBody(e.target.value)}
        />
      </div>
      {error && (
        <p className="muted" style={{ fontSize: 13, color: 'var(--m-pdf)', marginBottom: 0 }}>
          {error}
        </p>
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

function DeleteFeedbackModal({ item, onClose }: { item: FeedbackItem; onClose: () => void }) {
  const del = useDeleteFeedback()
  return (
    <Modal
      title="Delete feedback"
      sub={item.title}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={del.isPending}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            style={{ background: 'var(--m-pdf)' }}
            onClick={() => del.mutate({ id: item.id }, { onSuccess: onClose })}
            disabled={del.isPending}
          >
            <Icon.trash />
            {del.isPending ? 'Deleting…' : 'Delete'}
          </button>
        </>
      }
    >
      <p style={{ fontSize: 14.5, lineHeight: 1.55 }}>
        This removes the item and its status history from the club's log. If it was declined or done, leaving it
        visible keeps the record straight.
      </p>
      {del.isError && (
        <p className="muted" style={{ color: 'var(--m-pdf)', fontSize: 13.5 }}>
          {del.error.message}
        </p>
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
      footer={
        done ? (
          <button className="btn btn-primary" onClick={onClose}>
            <Icon.check />
            Done
          </button>
        ) : (
          <>
            <button className="btn btn-ghost" onClick={onClose} disabled={promote.isPending}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={submit} disabled={!ready || promote.isPending}>
              <Icon.external />
              {promote.isPending ? 'Creating…' : 'Create issue'}
            </button>
          </>
        )
      }
    >
      {done ? (
        <>
          <p style={{ fontSize: 14.5, lineHeight: 1.55 }}>The issue was created.</p>
          <p>
            <a className="btn btn-ghost btn-sm" href={done.url} target="_blank" rel="noreferrer">
              <Icon.external />
              {done.number != null ? `Issue #${done.number}` : 'View issue'}
            </a>
          </p>
          {done.warning && (
            <p className="muted" style={{ fontSize: 13, color: 'var(--m-pdf)' }}>
              {done.warning}
            </p>
          )}
        </>
      ) : (
        <>
          <p
            style={{
              fontSize: 13.5,
              lineHeight: 1.55,
              background: 'color-mix(in srgb, var(--m-pdf) 12%, transparent)',
              color: 'var(--m-pdf)',
              padding: '10px 12px',
              borderRadius: 11,
              margin: '0 0 12px',
            }}
          >
            The repository is public, so this issue is world readable. Do not include any name, child's name, email,
            contact or private detail. Only the title and details below are posted.
          </p>
          <div className="field">
            <label htmlFor="promote-title">Issue title</label>
            <input
              id="promote-title"
              value={title}
              maxLength={256}
              placeholder="A short summary, at least 3 characters"
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="promote-body">Issue details</label>
            <textarea
              id="promote-body"
              rows={6}
              value={body}
              placeholder="What the issue is. This text is posted publicly."
              onChange={(e) => setBody(e.target.value)}
            />
          </div>
          {promote.isError && (
            <p className="muted" style={{ fontSize: 13, color: 'var(--m-pdf)', marginBottom: 0 }}>
              {promote.error.message}
            </p>
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
    <div className="row" style={{ gap: 10, alignItems: 'flex-start', padding: '8px 0' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <span className="muted" style={{ display: 'block', fontSize: 12.5, fontWeight: 600 }}>
          {authorName} · {filedAgo(comment.createdAt)}
          {edited ? ' · edited' : ''}
        </span>
        <p style={{ fontSize: 14, lineHeight: 1.55, margin: '3px 0 0', whiteSpace: 'pre-wrap' }}>{comment.body}</p>
      </div>
      {isOwner && (
        <button
          className="btn btn-ghost btn-sm icon-only"
          style={{ width: 32, padding: 0 }}
          aria-label={'Edit comment by ' + authorName}
          onClick={onEdit}
        >
          <Icon.edit />
        </button>
      )}
      {(isOwner || canManage) && (
        <button
          className="btn btn-ghost btn-sm icon-only"
          style={{ width: 32, padding: 0 }}
          aria-label={'Delete comment by ' + authorName}
          onClick={onDelete}
        >
          <Icon.trash />
        </button>
      )}
    </div>
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
    return (
      <p className="muted" style={{ fontSize: 13, margin: '8px 0 0' }}>
        No comments yet. Start the conversation below.
      </p>
    )
  }
  return (
    <div style={{ marginTop: 8 }}>
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
    </div>
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
          <button className="btn btn-ghost" onClick={onClose} disabled={edit.isPending}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={() => edit.mutate({ id: comment.id, body }, { onSuccess: onClose })}
            disabled={!ready || edit.isPending}
          >
            <Icon.check />
            {edit.isPending ? 'Saving…' : 'Save changes'}
          </button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="comment-edit-body">Comment</label>
        <textarea
          id="comment-edit-body"
          rows={4}
          maxLength={2000}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
      </div>
      {edit.isError && (
        <p className="muted" style={{ fontSize: 13, color: 'var(--m-pdf)', marginBottom: 0 }}>
          {edit.error.message}
        </p>
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
          <button className="btn btn-ghost" onClick={onClose} disabled={del.isPending}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            style={{ background: 'var(--m-pdf)' }}
            onClick={() => del.mutate({ id: comment.id }, { onSuccess: onClose })}
            disabled={del.isPending}
          >
            <Icon.trash />
            {del.isPending ? 'Deleting…' : 'Delete'}
          </button>
        </>
      }
    >
      <p style={{ fontSize: 14.5, lineHeight: 1.55 }}>This removes the comment from the thread for the whole club.</p>
      {del.isError && (
        <p className="muted" style={{ color: 'var(--m-pdf)', fontSize: 13.5 }}>
          {del.error.message}
        </p>
      )}
    </Modal>
  )
}

// Wires an item's thread to its hooks: the comment list, the reply box, and
// the edit and delete modals. Mounted only when the item is expanded, so a
// closed row fetches nothing.
function FeedbackThread({ feedbackId, canManage }: { feedbackId: string; canManage: boolean }) {
  const { user } = useAuth()
  const { data: comments = [], isLoading, isError } = useFeedbackComments(feedbackId)
  const memberById = useMemberMap()
  const add = useAddFeedbackComment()
  const [reply, setReply] = useState('')
  const [editing, setEditing] = useState<FeedbackComment | null>(null)
  const [deleting, setDeleting] = useState<FeedbackComment | null>(null)
  const ready = reply.trim().length >= 1

  const post = () => {
    if (!ready) return
    add.mutate({ feedbackId, body: reply }, { onSuccess: () => setReply('') })
  }

  return (
    <div style={{ marginTop: 10, paddingTop: 4 }}>
      {isLoading ? (
        <Loading />
      ) : isError ? (
        <ErrorNote />
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
      <div className="field" style={{ marginTop: 10, marginBottom: 0 }}>
        <label htmlFor={'reply-' + feedbackId}>Reply</label>
        <textarea
          id={'reply-' + feedbackId}
          rows={2}
          maxLength={2000}
          value={reply}
          placeholder="Add a comment, visible to the whole club."
          onChange={(e) => setReply(e.target.value)}
        />
      </div>
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
        <button className="btn btn-primary btn-sm" onClick={post} disabled={!ready || add.isPending}>
          <Icon.check />
          {add.isPending ? 'Posting…' : 'Post comment'}
        </button>
      </div>
      {add.isError && (
        <p className="muted" style={{ fontSize: 12.5, color: 'var(--m-pdf)', margin: '6px 0 0' }}>
          {add.error.message}
        </p>
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
}: {
  item: FeedbackItem
  authorName: string
  isOwner: boolean
  canManage: boolean
  commentCount: number
}) {
  const setStatus = useSetFeedbackStatus()
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [promoting, setPromoting] = useState(false)
  return (
    <>
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
      {deleting && <DeleteFeedbackModal item={item} onClose={() => setDeleting(false)} />}
      {promoting && <PromoteToGithubModal item={item} onClose={() => setPromoting(false)} />}
    </>
  )
}

export function Feedback() {
  const { user } = useAuth()
  const { caps } = useMyCapabilities()
  const { data: items = [], isLoading, isError } = useFeedback()
  const memberById = useMemberMap()
  const { data: commentCounts = {} } = useFeedbackCommentCounts()
  const [creating, setCreating] = useState(false)
  const canManage = caps.has('club.manage')

  return (
    <div style={{ maxWidth: 760 }}>
      <div className="page-head">
        <div>
          <h2>Feedback</h2>
          <div className="sub">Feature requests, bugs and general feedback, club wide so nothing is filed twice.</div>
        </div>
        <button className="btn btn-primary" onClick={() => setCreating(true)}>
          <Icon.plus />
          New feedback
        </button>
      </div>
      <div className="card" style={{ padding: 18 }}>
        {isLoading ? (
          <Loading />
        ) : isError ? (
          <ErrorNote />
        ) : items.length === 0 ? (
          <Empty icon={Icon.note} title="No feedback yet">
            File the first item above. The whole club sees the log and where each item stands.
          </Empty>
        ) : (
          items.map((item) => (
            <FeedbackRow
              key={item.id}
              item={item}
              authorName={memberById[item.createdBy]?.fullName || '—'}
              isOwner={item.createdBy === user?.id}
              canManage={canManage}
              commentCount={commentCounts[item.id] ?? 0}
            />
          ))
        )}
      </div>
      {creating && <NewFeedbackModal onClose={() => setCreating(false)} />}
    </div>
  )
}
