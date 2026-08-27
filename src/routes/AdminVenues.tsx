// The club's venues: add, rename, remove. Behind club.manage and backed
// by the venues RLS. A venue is a name a coach picks in the planner, so
// that every session at Springmill agrees on the spelling.
//
// Removing one never breaks a session: the reference nulls and the
// session keeps its date, plan and register, unplaced until someone picks
// a venue again. REVIEW: capability gated admin surface.
import { useState } from 'react'
import { useSessions } from '../context/SessionsContext'
import {
  useDeleteVenue,
  useInsertVenue,
  useMyCapabilities,
  useRenameVenue,
  useVenues,
} from '../lib/queries'
import type { Venue } from '../lib/venues'
import { Icon } from '../components/icons'
import { ErrorNote, Loading, Modal } from '../components/ui'

export function DeleteVenueModalView({
  venue,
  sessionCount,
  busy,
  failed,
  onCancel,
  onConfirm,
}: {
  venue: Venue
  sessionCount: number | null
  busy: boolean
  failed: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <Modal
      title="Remove venue"
      sub={venue.name}
      onClose={onCancel}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            className="btn btn-danger"
            onClick={onConfirm}
            disabled={busy}
          >
            <Icon.trash />
            {busy ? 'Removing…' : 'Remove'}
          </button>
        </>
      }
    >
      <p style={{ fontSize: 14.5, lineHeight: 1.55 }}>
        {sessionCount === null
          ? 'Any session at this venue keeps its date, plan and register, and shows no venue until someone picks one. Nothing is removed but the venue itself.'
          : `${sessionCount} session${sessionCount !== 1 ? 's are' : ' is'} at this venue. ${
              sessionCount === 1 ? 'It keeps its' : 'They keep their'
            } date, plan and register, and ${
              sessionCount === 1 ? 'shows' : 'show'
            } no venue until someone picks one. Nothing is removed but the venue itself.`}
      </p>
      {sessionCount === null && (
        <p className="muted" style={{ fontSize: 13 }}>
          The session list has not loaded, so the number affected is not known here.
        </p>
      )}
      {failed && (
        <p className="muted" style={{ color: 'var(--danger)', fontSize: 13.5 }}>
          Could not remove the venue. Try again.
        </p>
      )}
    </Modal>
  )
}

function DeleteVenueModal({
  venue,
  sessionCount,
  onClose,
}: {
  venue: Venue
  // Null when the sessions read has not landed or failed: "we do not know how
  // many" must not render as the confident "0 sessions" that would make this
  // look like a harmless delete.
  sessionCount: number | null
  onClose: () => void
}) {
  const del = useDeleteVenue()
  return (
    <DeleteVenueModalView
      venue={venue}
      sessionCount={sessionCount}
      busy={del.isPending}
      failed={del.isError}
      onCancel={onClose}
      onConfirm={() => del.mutate(venue.id, { onSuccess: onClose })}
    />
  )
}

function VenueRow({ venue, onDelete }: { venue: Venue; onDelete: () => void }) {
  const rename = useRenameVenue()
  const [draft, setDraft] = useState(venue.name)
  const changed = draft.trim() !== venue.name && draft.trim() !== ''
  return (
    <div className="row wrap" style={{ gap: 10, padding: '10px 0', borderTop: '1px solid var(--line)' }}>
      <div className="field" style={{ flex: 1, minWidth: 160, marginBottom: 0 }}>
        <input
          value={draft}
          aria-label={'Name for ' + venue.name}
          onChange={(e) => setDraft(e.target.value)}
        />
      </div>
      <button
        className="btn btn-ghost btn-sm"
        disabled={!changed || rename.isPending}
        onClick={() => rename.mutate({ id: venue.id, name: draft.trim() })}
      >
        <Icon.check />
        Rename
      </button>
      <button
        className="btn btn-ghost btn-sm icon-only"
        style={{ width: 38, minHeight: 44, padding: 0 }}
        aria-label={'Remove ' + venue.name}
        onClick={onDelete}
      >
        <Icon.trash />
      </button>
    </div>
  )
}

export function AdminVenues() {
  const { data: venues = [], isLoading, isError } = useVenues()
  const { sessions, loading: sessionsLoading, error: sessionsError } = useSessions()
  const insert = useInsertVenue()
  const [name, setName] = useState('')
  const [removing, setRemoving] = useState<Venue | null>(null)
  const { caps } = useMyCapabilities()
  // A failed read must not render as an empty club: an admin would add a
  // venue that already exists and hit the unique constraint.
  if (isError) return <ErrorNote />
  if (isLoading) return <Loading />
  // The route guard already keeps members without club.manage out; this is
  // belt and braces for the brief render before a redirect.
  if (!caps.has('club.manage')) return null

  const add = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    insert.mutate({ name: trimmed }, { onSuccess: () => setName('') })
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Venues</h2>
          <div className="sub">The places the club trains. A coach picks one when planning a session.</div>
        </div>
      </div>

      <div className="card" style={{ padding: 18, maxWidth: 560 }}>
        <div className="row" style={{ gap: 10, marginBottom: 4 }}>
          <div className="field" style={{ flex: 1, marginBottom: 0 }}>
            <label>New venue</label>
            <input
              placeholder="Venue name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && add()}
            />
          </div>
          <button
            className="btn btn-primary"
            style={{ alignSelf: 'flex-end', minHeight: 44 }}
            disabled={!name.trim() || insert.isPending}
            onClick={add}
          >
            <Icon.plus />
            Add venue
          </button>
        </div>
        {insert.isError && (
          <p className="muted" style={{ fontSize: 12.5, color: 'var(--danger)', marginBottom: 8 }}>
            Could not add the venue. The name may already exist.
          </p>
        )}
        <div style={{ marginTop: 12 }}>
          {venues.map((v) => (
            <VenueRow key={v.id} venue={v} onDelete={() => setRemoving(v)} />
          ))}
          {venues.length === 0 && (
            <p className="muted" style={{ fontSize: 13.5 }}>
              No venues yet. Add the first one above.
            </p>
          )}
        </div>
      </div>

      {removing && (
        <DeleteVenueModal
          venue={removing}
          sessionCount={
            sessionsLoading || sessionsError ? null : sessions.filter((s) => s.venueId === removing.id).length
          }
          onClose={() => setRemoving(null)}
        />
      )}
    </div>
  )
}
