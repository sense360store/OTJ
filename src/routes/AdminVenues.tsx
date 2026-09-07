// The club's venues: add, rename, remove, and from each one its layouts.
// Behind club.manage and backed by the venues RLS. A venue is a name a
// coach picks in the planner, so that every session at Springmill agrees
// on the spelling; its layouts (COACH-5) are where the stations and the
// games go on that ground, drawn once per season and age group.
//
// Removing one never breaks a session: the reference nulls and the
// session keeps its date, plan and register, unplaced until someone picks
// a venue again. Its layouts go with it, because a deleted venue's ground
// is not a thing any more. REVIEW: capability gated admin surface.
//
// VISUAL-03: on the shared system, adopted with the layouts affordance,
// because a Layouts link beside Rename is the change that reached the row.
import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
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
import { Button, Card, IconButton, Note, PageHeader, TextField, buttonClass } from '../components/primitives'
import { Empty, ErrorNote, Loading, Modal } from '../components/ui'
import { useFocusRestore } from '../hooks/useFocusRestore'

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
          <Button onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" icon={Icon.trash} onClick={onConfirm} disabled={busy}>
            {busy ? 'Removing…' : 'Remove'}
          </Button>
        </>
      }
    >
      <p>
        {sessionCount === null
          ? 'Any session at this venue keeps its date, plan and register, and shows no venue until someone picks one. Nothing is removed but the venue itself and its layouts.'
          : `${sessionCount} session${sessionCount !== 1 ? 's are' : ' is'} at this venue. ${
              sessionCount === 1 ? 'It keeps its' : 'They keep their'
            } date, plan and register, and ${
              sessionCount === 1 ? 'shows' : 'show'
            } no venue until someone picks one. Nothing is removed but the venue itself and its layouts.`}
      </p>
      {sessionCount === null && (
        <p className="muted">The session list has not loaded, so the number affected is not known here.</p>
      )}
      {failed && (
        <Note tone="danger" role="alert">
          Could not remove the venue. Try again.
        </Note>
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
  // Renaming settles with the stored name equal to the draft, so `changed`
  // goes false and Rename disables under the press; focus is restored to
  // the field rather than left on the document body.
  const nameRef = useRef<HTMLInputElement>(null)
  const wantNameFocus = useFocusRestore(!rename.isPending, nameRef)
  return (
    <li className="admin-row">
      <TextField
        label={`Name for ${venue.name}`}
        labelHidden
        className="field-flush admin-field-grow"
        ref={nameRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
      />
      <div className="admin-row-acts">
        <Button
          size="sm"
          icon={Icon.check}
          aria-label={'Rename ' + venue.name}
          disabled={!changed || rename.isPending}
          onClick={() => {
            wantNameFocus()
            rename.mutate({ id: venue.id, name: draft.trim() })
          }}
        >
          {rename.isPending ? 'Renaming…' : 'Rename'}
        </Button>
        {/* A link, because the destination is a page of its own: the four
            layouts drawn for this ground, per season and age group. */}
        <Link
          to={`/admin/venues/${venue.id}/layouts`}
          className={buttonClass('ghost', 'sm')}
          aria-label={'Layouts for ' + venue.name}
        >
          <Icon.grid />
          Layouts
        </Link>
        <IconButton label={'Remove ' + venue.name} icon={Icon.trash} tone="danger" onClick={onDelete} />
      </div>
      {rename.isError && (
        <Note tone="danger" role="alert" className="admin-row-note">
          Could not rename the venue. The name may already exist.
        </Note>
      )}
    </li>
  )
}

export function AdminVenues() {
  const { data: venues = [], isLoading, isError, refetch } = useVenues()
  const { sessions, loading: sessionsLoading, error: sessionsError } = useSessions()
  const insert = useInsertVenue()
  const [name, setName] = useState('')
  const [removing, setRemoving] = useState<Venue | null>(null)
  const { caps } = useMyCapabilities()
  const newVenueRef = useRef<HTMLInputElement>(null)
  const wantNewFocus = useFocusRestore(!insert.isPending, newVenueRef)
  // A failed read must not render as an empty club: an admin would add a
  // venue that already exists and hit the unique constraint.
  if (isError) return <ErrorNote onRetry={() => void refetch()} />
  if (isLoading) return <Loading />
  // The route guard already keeps members without club.manage out; this is
  // belt and braces for the brief render before a redirect.
  if (!caps.has('club.manage')) return null

  const add = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    wantNewFocus()
    insert.mutate({ name: trimmed }, { onSuccess: () => setName('') })
  }

  return (
    <div>
      <PageHeader
        title="Venues"
        sub="The places the club trains. A coach picks one when planning a session, and each one carries the layouts drawn for it."
      />

      <Card className="admin-narrow">
        <div className="admin-add">
          <TextField
            label="New venue"
            className="field-flush admin-field-grow"
            ref={newVenueRef}
            placeholder="Venue name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
          />
          <Button variant="primary" icon={Icon.plus} disabled={!name.trim() || insert.isPending} onClick={add}>
            {insert.isPending ? 'Adding…' : 'Add venue'}
          </Button>
        </div>
        {insert.isError && (
          <Note tone="danger" role="alert" className="admin-note">
            Could not add the venue. The name may already exist.
          </Note>
        )}
        {venues.length === 0 ? (
          <Empty icon={Icon.ruler} title="No venues yet">
            Add the first one above. A coach can then pick it when planning a session.
          </Empty>
        ) : (
          <ul className="admin-list">
            {venues.map((v) => (
              <VenueRow key={v.id} venue={v} onDelete={() => setRemoving(v)} />
            ))}
          </ul>
        )}
      </Card>

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
