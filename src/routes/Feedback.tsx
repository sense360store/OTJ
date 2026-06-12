// /feedback: the club's feedback log. Feature requests, bug reports and
// general feedback, club visible by design so duplicates are avoided and
// status is transparent. Every member reads and files; a creator edits and
// deletes their own items; holders of club.manage move status through the
// select on each row. The feedback RLS plus the column guard trigger are the
// enforcement; the UI only decides what to surface.
import { useState } from 'react'
import type { ReactNode } from 'react'
import { useAuth } from '../hooks/useAuth'
import {
  useDeleteFeedback,
  useFeedback,
  useInsertFeedback,
  useMemberMap,
  useMyCapabilities,
  useSetFeedbackStatus,
  useUpdateFeedback,
} from '../lib/queries'
import type { FeedbackInput } from '../lib/queries'
import { FEEDBACK_KIND_LABELS, FEEDBACK_KINDS, FEEDBACK_STATUS_LABELS, FEEDBACK_STATUSES } from '../lib/data'
import type { FeedbackItem, FeedbackKind, FeedbackStatus } from '../lib/data'
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
  onEdit,
  onDelete,
  onStatus,
  statusBusy,
  statusError,
}: {
  item: FeedbackItem
  authorName: string
  isOwner: boolean
  canManage: boolean
  onEdit: () => void
  onDelete: () => void
  onStatus: (status: FeedbackStatus) => void
  statusBusy?: boolean
  statusError?: string
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
            cursor: item.body ? 'pointer' : 'default',
          }}
        >
          <span className="row wrap" style={{ gap: 8 }}>
            <TagBadge color={KIND_COLOR[item.kind]}>{FEEDBACK_KIND_LABELS[item.kind]}</TagBadge>
            <b style={{ fontSize: 14.5 }}>{item.title}</b>
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
      {expanded && item.body && (
        <p style={{ fontSize: 14, lineHeight: 1.55, margin: '8px 0 0', whiteSpace: 'pre-wrap' }}>{item.body}</p>
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

// Wires one row to its mutations: the status select for club.manage holders
// and the creator's edit and delete modals.
function FeedbackRow({
  item,
  authorName,
  isOwner,
  canManage,
}: {
  item: FeedbackItem
  authorName: string
  isOwner: boolean
  canManage: boolean
}) {
  const setStatus = useSetFeedbackStatus()
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  return (
    <>
      <FeedbackCard
        item={item}
        authorName={authorName}
        isOwner={isOwner}
        canManage={canManage}
        onEdit={() => setEditing(true)}
        onDelete={() => setDeleting(true)}
        onStatus={(status) => setStatus.mutate({ id: item.id, status })}
        statusBusy={setStatus.isPending}
        statusError={setStatus.isError ? setStatus.error.message : ''}
      />
      {editing && <EditFeedbackModal item={item} onClose={() => setEditing(false)} />}
      {deleting && <DeleteFeedbackModal item={item} onClose={() => setDeleting(false)} />}
    </>
  )
}

export function Feedback() {
  const { user } = useAuth()
  const { caps } = useMyCapabilities()
  const { data: items = [], isLoading, isError } = useFeedback()
  const memberById = useMemberMap()
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
            />
          ))
        )}
      </div>
      {creating && <NewFeedbackModal onClose={() => setCreating(false)} />}
    </div>
  )
}
