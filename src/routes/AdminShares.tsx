// Club wide Shared links (Content Sharing PR 5). Every public link the club has
// made, in one place, for a shares.manage holder: what it points at, whether it
// still works, who made it, and the one club wide control, turning it off.
//
// The route guard in App.tsx keeps a member without shares.manage out, the nav
// item is gated by the same capability, and the manage-content-share function
// re-checks it on every call and answers 403 without it. The checks here only
// decide what to surface.
//
// WHAT THIS SCREEN DELIBERATELY DOES NOT OFFER, and why:
//
//   - No "Copy link". The link is the share id plus a secret, and the secret is
//     stored only as a hash. It is shown once, at creation, and is not
//     recoverable by anyone, this screen included. A Copy control here could
//     only ever hand over an incomplete, useless URL, or imply the platform can
//     read back a secret it cannot.
//   - No "Replace link" (rotate). Rotating kills the link the owning coach has
//     already sent out and hands the new secret to whoever pressed the button,
//     which would be the manager, not the coach. A manager who judges a link
//     unsafe turns it off; the coach then makes a fresh one if they want.
//   - No "Update what people see" (refresh). Refresh republishes the owner's
//     content on their behalf, changing what the public sees without the owner
//     knowing.
//
// Rotate and refresh stay with the share's owner on the drill, session or
// programme page (the Share dialog). shares.manage is scoped to review and
// revoke, and the server enforces exactly that scope.
//
// Nothing secret bearing is rendered here. The list DTO carries no token hash,
// no snapshot and no storage path; the Review panel renders the same already
// redacted public projection an anonymous visitor would see, re-validated in
// the browser by the public validators before anything is drawn.
import { useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  type ManagedShare,
  useManagedShareDetail,
  useManagedShares,
  useMyCapabilities,
  useProfiles,
  useRevokeManagedShare,
} from '../lib/queries'
import {
  creatorFilterPatch,
  countByStatus,
  EMPTY_SHARE_FILTERS,
  FORMER_MEMBER_LABEL,
  KILL_SWITCH_NOTE,
  type ManagedShareKind,
  type ManagedShareStatus,
  NO_LINK_CONTROLS_NOTE,
  REVIEW_UNAVAILABLE_NOTE,
  REVOKE_CONFIRM_NOTE,
  SHARE_KINDS,
  SHARE_STATUS_FILTERS,
  type ShareFilters,
  shareFiltersAreActive,
  shareFiltersFromParams,
  shareIdFromInput,
  SOURCE_DELETED_LABEL,
  sourceKindLabel,
  STATUS_FILTER_LABELS,
  statusLabel,
} from '../lib/sharesView'
import {
  type PublicDrillSnapshot,
  type PublicProgrammeSnapshot,
  type PublicSessionSnapshot,
  validatePublicDrillSnapshot,
  validatePublicProgrammeSnapshot,
  validatePublicSessionSnapshot,
} from '../lib/publicShare'
import { PublicDrillView } from '../components/PublicDrillView'
import { PublicProgrammeView } from '../components/PublicProgrammeView'
import { PublicSessionView } from '../components/PublicSessionView'
import { Icon } from '../components/icons'
import { ActionError, Empty, ErrorNote, Loading, Modal } from '../components/ui'
import type { Member } from '../lib/data'
import './AdminShares.css'

// A plain, unambiguous date: 16 Jun 2026. Shares outlive a season, so the year
// is always present, unlike the pitch-side fmtDate.
function fmtShareDate(iso: string | null): string {
  if (!iso) return 'Unknown'
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return 'Unknown'
  return new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function ShareStatusBadge({ status }: { status: ManagedShareStatus }) {
  return <span className={`share-badge share-badge-${status}`}>{statusLabel(status)}</span>
}

// The counts strip. total is the server's exact count for the current filter;
// the three status counts describe the rows actually loaded, and say so, rather
// than implying a club wide breakdown the screen has not asked for.
export function SharesSummary({
  loaded,
  total,
  counts,
}: {
  loaded: number
  total: number | null
  counts: Record<ManagedShareStatus, number>
}) {
  return (
    <div className="shares-summary">
      <span className="pill">
        <b>{total ?? loaded}</b> {(total ?? loaded) === 1 ? 'link' : 'links'} match
      </span>
      <span className="pill">
        <b>{counts.active}</b> active
      </span>
      <span className="pill">
        <b>{counts.expired}</b> expired
      </span>
      <span className="pill">
        <b>{counts.revoked}</b> turned off
      </span>
      <span className="muted" style={{ fontSize: 12.5, fontWeight: 600 }}>
        Counts by status cover the {loaded} shown.
      </span>
    </div>
  )
}

// Status, kind and creator. Every control is a labelled native input, so the
// whole strip is keyboard operable and announced.
export function ShareFilterControls({
  filters,
  members,
  onChange,
}: {
  filters: ShareFilters
  members: Member[]
  onChange: (patch: Partial<ShareFilters>) => void
}) {
  // A creator deep link can name someone who is no longer in the club list, so
  // the control keeps an honest placeholder rather than silently showing
  // "Anyone" while the list stays filtered.
  const selected = members.findIndex((m) => m.id === filters.createdBy)
  const creatorValue = filters.unattributed
    ? 'unattributed'
    : filters.createdBy
    ? selected >= 0
      ? String(selected)
      : 'unresolved'
    : ''
  return (
    <div className="shares-filters">
      <label className="field">
        <span className="filter-label">Status</span>
        <select
          className="select"
          value={filters.status}
          onChange={(e) => onChange({ status: e.target.value as ShareFilters['status'] })}
          aria-label="Filter by status"
        >
          {SHARE_STATUS_FILTERS.map((s) => (
            <option key={s} value={s}>
              {STATUS_FILTER_LABELS[s]}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="filter-label">Kind</span>
        <select
          className="select"
          value={filters.kind}
          onChange={(e) => onChange({ kind: e.target.value as ShareFilters['kind'] })}
          aria-label="Filter by kind"
        >
          <option value="">Any kind</option>
          {SHARE_KINDS.map((k) => (
            <option key={k} value={k}>
              {sourceKindLabel(k)}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="filter-label">Made by</span>
        {/* The option values are positions in the list, not member ids: a
            member id is an identifier this screen has no reason to put in the
            page, and the filter only needs to resolve one back on change. */}
        <select
          className="select"
          value={creatorValue}
          onChange={(e) => {
            // The server refuses a request carrying both, so the control is one
            // list with the former member option inside it, never two inputs a
            // manager could set at once. The mapping is pure and tested in
            // sharesView: this suite has no DOM and cannot fire a change event.
            onChange(creatorFilterPatch(e.target.value, members))
          }}
          aria-label="Filter by who made the link"
        >
          <option value="">Anyone</option>
          <option value="unattributed">{FORMER_MEMBER_LABEL}</option>
          {creatorValue === 'unresolved' && <option value="unresolved">One member</option>}
          {members.map((m, i) => (
            <option key={m.id} value={i}>
              {m.fullName || 'Unnamed'}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}

// The exact link lookup. A manager who has been sent a link pastes it whole,
// and shareIdFromInput keeps only the id: the fragment, which IS the secret, is
// discarded before anything enters React state, the query key or the wire. The
// field is uncontrolled for exactly that reason, and is rewritten to the bare
// id on submit so the manager can see the rest was dropped.
export function ShareLookupField({
  value,
  error,
  onLookup,
  onClear,
}: {
  value: string
  error: string | null
  onLookup: (raw: string) => void
  onClear: () => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        const raw = ref.current?.value ?? ''
        // The field itself is responsible for never holding a fragment: on
        // submit it is rewritten to the resolved id, or to the input with
        // everything from the '#' onwards cut off when nothing resolved. So the
        // secret does not survive in the DOM either, not only in state.
        if (ref.current) ref.current.value = shareIdFromInput(raw) ?? raw.split('#')[0]
        onLookup(raw)
      }}
    >
      <div className="shares-lookup">
        <label className="field">
          <span className="filter-label">Find one link</span>
          <input
            ref={ref}
            type="text"
            defaultValue={value}
            placeholder="Paste a reported link, or a link id"
            aria-label="Find one link by id"
            aria-describedby="shares-lookup-note"
          />
        </label>
        <button type="submit" className="btn btn-ghost" style={{ minHeight: 44 }}>
          <Icon.search />
          Find
        </button>
        {value && (
          <button
            type="button"
            className="btn btn-ghost"
            style={{ minHeight: 44 }}
            onClick={() => {
              if (ref.current) ref.current.value = ''
              onClear()
            }}
          >
            Clear
          </button>
        )}
      </div>
      <p className="muted shares-lookup-note" id="shares-lookup-note">
        Only the id part of a link is used. The rest, including the secret that makes the link work, is discarded and
        never sent or stored.
      </p>
      {error && (
        <p role="alert" className="shares-lookup-note" style={{ color: 'var(--danger)' }}>
          {error}
        </p>
      )}
    </form>
  )
}

// One link. Reflows from stacked to two columns at the content breakpoint; it
// is a list item, not a table row, so there is a single DOM at every width.
export function ShareRow({
  share,
  formatDate,
  onReview,
  onTurnOff,
}: {
  share: ManagedShare
  formatDate: (iso: string | null) => string
  onReview: () => void
  onTurnOff: () => void
}) {
  const title = share.sourceTitle
  const creator = share.unattributed ? FORMER_MEMBER_LABEL : share.createdByName ?? FORMER_MEMBER_LABEL
  const label = title ?? SOURCE_DELETED_LABEL
  return (
    <li className="share-row">
      <div className="share-main">
        <div className="row wrap" style={{ gap: 8 }}>
          <span className={title ? 'share-title' : 'share-title share-title-missing'}>{label}</span>
          <span className="pill">{sourceKindLabel(share.kind)}</span>
          <ShareStatusBadge status={share.status} />
        </div>
        <div className="share-meta">
          <span>Created {formatDate(share.createdAt)}</span>
          <span>{share.expiresAt ? `Expires ${formatDate(share.expiresAt)}` : 'No expiry'}</span>
          <span>Made by {creator}</span>
        </div>
      </div>
      <div className="share-actions">
        <button
          type="button"
          className="btn btn-ghost"
          style={{ minHeight: 44 }}
          aria-label={`Review what ${label} makes public`}
          onClick={onReview}
        >
          <Icon.eye />
          Review
        </button>
        {share.status !== 'revoked' && (
          <button
            type="button"
            className="btn btn-ghost"
            style={{ minHeight: 44, color: 'var(--danger)' }}
            aria-label={`Turn off the link for ${label}`}
            onClick={onTurnOff}
          >
            Turn off
          </button>
        )}
      </div>
    </li>
  )
}

export function SharesEmpty({ active, onClear }: { active: boolean; onClear: () => void }) {
  return active ? (
    <Empty icon={Icon.search} title="No links match.">
      Nothing matches the current filters.{' '}
      <button className="btn btn-ghost" style={{ marginTop: 12, minHeight: 44 }} onClick={onClear}>
        Clear filters
      </button>
    </Empty>
  ) : (
    <Empty icon={Icon.share} title="No public links yet.">
      Links a coach publishes from a drill, session or programme appear here.
    </Empty>
  )
}

// Each kind is checked by its OWN public validator before it is drawn, exactly
// as the owner's preview does. The server already redacted the projection; this
// is the browser's independent re-check, so a snapshot of an unknown shape or a
// tampered one shows the neutral note rather than anything else.
function validateSnapshot(
  kind: ManagedShareKind,
  value: unknown,
): PublicDrillSnapshot | PublicSessionSnapshot | PublicProgrammeSnapshot | null {
  if (kind === 'session') return validatePublicSessionSnapshot(value) ? value : null
  if (kind === 'programme') return validatePublicProgrammeSnapshot(value) ? value : null
  return validatePublicDrillSnapshot(value) ? value : null
}

// The Review body. Takes the raw snapshot so the validation happens here, on
// the way to the renderer, and never around it.
export function ShareReviewBody({ kind, snapshot }: { kind: ManagedShareKind; snapshot: unknown }) {
  const valid = snapshot === null || snapshot === undefined ? null : validateSnapshot(kind, snapshot)
  if (!valid) {
    return (
      <p className="muted" style={{ fontSize: 14, lineHeight: 1.55 }}>
        {REVIEW_UNAVAILABLE_NOTE}
      </p>
    )
  }
  return (
    <div className="share-review-frame">
      {kind === 'session' ? (
        <PublicSessionView snapshot={valid as PublicSessionSnapshot} mode="preview" />
      ) : kind === 'programme' ? (
        <PublicProgrammeView snapshot={valid as PublicProgrammeSnapshot} mode="preview" />
      ) : (
        <PublicDrillView snapshot={valid as PublicDrillSnapshot} mode="preview" />
      )}
    </div>
  )
}

// The confirmation body for turning a link off.
export function ShareTurnOffBody({ share }: { share: ManagedShare }) {
  return (
    <div>
      <p style={{ fontSize: 14.5, lineHeight: 1.55 }}>{REVOKE_CONFIRM_NOTE}</p>
      <p className="muted" style={{ fontSize: 13.5, lineHeight: 1.5, marginBottom: 0 }}>
        {sourceKindLabel(share.kind)}: {share.sourceTitle ?? SOURCE_DELETED_LABEL}
      </p>
    </div>
  )
}

// Focus management is the shared Modal's: it moves focus into the dialog on
// open, traps Tab inside it, keeps Escape live, and restores focus to the
// control that opened it on close.
export function ShareReviewModal({ share, onClose }: { share: ManagedShare; onClose: () => void }) {
  const detail = useManagedShareDetail(share.shareId)
  return (
    <Modal
      title="What this link makes public"
      sub={share.sourceTitle ?? SOURCE_DELETED_LABEL}
      onClose={onClose}
      wide
      dismissible
      footer={
        <button type="button" className="btn btn-primary" style={{ minHeight: 44 }} onClick={onClose}>
          Close
        </button>
      }
    >
      {detail.isPending ? (
        <Loading />
      ) : detail.isError ? (
        <ActionError onRetry={() => void detail.refetch()}>{detail.error.message}</ActionError>
      ) : (
        <>
          <p className="muted" style={{ fontSize: 13, lineHeight: 1.5 }}>
            This is the stored copy, frozen when the link was made or last updated. The drill, session or programme
            itself may have changed since.
          </p>
          <ShareReviewBody kind={share.kind} snapshot={detail.data?.snapshot ?? null} />
        </>
      )}
    </Modal>
  )
}

export function ShareTurnOffModal({
  share,
  onClose,
  onDone,
}: {
  share: ManagedShare
  onClose: () => void
  onDone: (message: string) => void
}) {
  const revoke = useRevokeManagedShare()
  const confirm = () =>
    revoke.mutate(
      { shareId: share.shareId, kind: share.kind, sourceId: share.sourceId },
      // Revoke is idempotent server side, so a link another manager turned off a
      // moment ago still settles as turned off rather than as an error.
      { onSuccess: () => onDone('Link turned off.') },
    )
  return (
    <Modal
      title="Turn this link off?"
      sub={share.sourceTitle ?? SOURCE_DELETED_LABEL}
      onClose={onClose}
      dismissible={!revoke.isPending}
      footer={
        <>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ minHeight: 44 }}
            onClick={onClose}
            disabled={revoke.isPending}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            style={{ minHeight: 44 }}
            onClick={confirm}
            disabled={revoke.isPending}
          >
            {revoke.isPending ? 'Turning off…' : 'Turn off this link'}
          </button>
        </>
      }
    >
      <ShareTurnOffBody share={share} />
      {revoke.isError && <ActionError onRetry={confirm}>{revoke.error.message}</ActionError>}
    </Modal>
  )
}

type ModalState = { kind: 'review'; share: ManagedShare } | { kind: 'turnOff'; share: ManagedShare } | null

export function AdminShares() {
  const { caps } = useMyCapabilities()
  const canManage = caps.has('shares.manage')

  // A creator deep link (from the Admin users removal warning) seeds the filter
  // once; from then on the picker owns it, exactly as the Activity page keeps
  // its filters in page state.
  const [searchParams] = useSearchParams()
  const [filters, setFilters] = useState<ShareFilters>(() => ({
    ...EMPTY_SHARE_FILTERS,
    ...shareFiltersFromParams(searchParams),
  }))
  const [lookupError, setLookupError] = useState<string | null>(null)
  const [modal, setModal] = useState<ModalState>(null)
  const [announcement, setAnnouncement] = useState('')

  const { data, isPending, isError, error, refetch, hasNextPage, fetchNextPage, isFetchingNextPage } =
    useManagedShares(filters)
  const { data: profiles = [] } = useProfiles()

  const members = useMemo<Member[]>(
    () => [...profiles].sort((a, b) => a.fullName.localeCompare(b.fullName)),
    [profiles],
  )
  const shares = useMemo<ManagedShare[]>(() => (data?.pages ?? []).flatMap((p) => p.shares), [data])
  const counts = useMemo(() => countByStatus(shares), [shares])
  const first = data?.pages[0]
  const sharingEnabled = first?.sharingEnabled ?? true
  const active = shareFiltersAreActive(filters)

  const patch = (p: Partial<ShareFilters>) => setFilters((f) => ({ ...f, ...p }))
  const clearFilters = () => {
    setFilters(EMPTY_SHARE_FILTERS)
    setLookupError(null)
  }

  // The pasted value never reaches state: only the resolved id does.
  const lookup = (raw: string) => {
    const trimmed = raw.trim()
    if (!trimmed) {
      setLookupError(null)
      patch({ shareId: '' })
      return
    }
    const id = shareIdFromInput(trimmed)
    if (!id) {
      setLookupError('That is not a link or a link id we recognise. Paste the whole link, or just its id.')
      return
    }
    setLookupError(null)
    patch({ shareId: id })
  }

  // The route guard already redirects a member without shares.manage; this is
  // belt and braces for the moment before the capability read settles.
  if (!canManage) return null

  const results = () => {
    if (isPending) return <Loading />
    if (isError) {
      return (
        <ErrorNote>
          {error?.message ?? 'Something went wrong loading this.'}{' '}
          <button className="btn btn-ghost" style={{ marginTop: 12, minHeight: 44 }} onClick={() => void refetch()}>
            Try again
          </button>
        </ErrorNote>
      )
    }
    if (shares.length === 0) return <SharesEmpty active={active} onClear={clearFilters} />
    return (
      <>
        <SharesSummary loaded={shares.length} total={first?.total ?? null} counts={counts} />
        <ul className="shares-list">
          {shares.map((s) => (
            <ShareRow
              key={s.shareId}
              share={s}
              formatDate={fmtShareDate}
              onReview={() => setModal({ kind: 'review', share: s })}
              onTurnOff={() => setModal({ kind: 'turnOff', share: s })}
            />
          ))}
        </ul>
        {hasNextPage && (
          <div className="shares-more">
            <button
              className="btn btn-ghost"
              style={{ minHeight: 44 }}
              onClick={() => void fetchNextPage()}
              disabled={isFetchingNextPage}
            >
              {isFetchingNextPage ? 'Loading…' : 'Load more'}
            </button>
          </div>
        )}
      </>
    )
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Shared links</h2>
          <div className="sub">Every public link the club has made, and whether it still works.</div>
        </div>
      </div>

      {!sharingEnabled && (
        <p className="muted shares-note" style={{ fontWeight: 700 }}>
          {KILL_SWITCH_NOTE}
        </p>
      )}

      <p className="muted shares-note">{NO_LINK_CONTROLS_NOTE}</p>

      <ShareFilterControls filters={filters} members={members} onChange={patch} />
      {/* Keyed on the resolved id so Clear filters, and a new lookup, remount
          the uncontrolled field with the current value rather than leaving the
          previous text (and any fragment it carried) sitting in the DOM. */}
      <ShareLookupField
        key={filters.shareId}
        value={filters.shareId}
        error={lookupError}
        onLookup={lookup}
        onClear={() => {
          setLookupError(null)
          patch({ shareId: '' })
        }}
      />
      {active && (
        <p style={{ marginBottom: 14 }}>
          <button className="btn btn-ghost" style={{ minHeight: 44 }} onClick={clearFilters}>
            Clear filters
          </button>
        </p>
      )}

      {/* Announces a completed turn off to assistive technology, away from the
          list that is about to re-render underneath it. */}
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {/* Loading, error and empty transitions announced politely; aria-busy
          signals a pending fetch. */}
      <div aria-live="polite" aria-busy={isPending || isFetchingNextPage}>
        {results()}
      </div>

      {modal?.kind === 'review' && <ShareReviewModal share={modal.share} onClose={() => setModal(null)} />}
      {modal?.kind === 'turnOff' && (
        <ShareTurnOffModal
          share={modal.share}
          onClose={() => setModal(null)}
          onDone={(message) => {
            setModal(null)
            setAnnouncement(message)
          }}
        />
      )}
    </div>
  )
}
