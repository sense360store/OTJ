// Venue config: the club's places and their measured areas, behind
// club.manage and backed by the venues RLS (migration 0043). Boundaries are
// owner drawn approximations of the usable green areas, entered as one
// lat, lng vertex per line; the screen shows each area's computed size and a
// small scale true outline so a mistyped vertex is obvious at a glance.
// REVIEW: capability gated admin surface.
import { useState } from 'react'
import {
  useDeleteVenue,
  useDeleteVenueArea,
  useInsertVenue,
  useInsertVenueArea,
  useMyCapabilities,
  useUpdateVenueArea,
  useUpdateVenue,
  useVenueAreas,
  useVenues,
} from '../lib/queries'
import {
  areaLabel,
  boundarySvgPoints,
  formatBoundaryText,
  parseBoundaryText,
  parseCentreText,
  type Boundary,
  type Venue,
  type VenueArea,
} from '../lib/venues'
import { Icon } from '../components/icons'
import { ErrorNote, Loading, Modal } from '../components/ui'

// The scale true outline of a boundary, presentational. North is up. A null
// boundary (a stored value that did not parse) renders the label instead of
// a shape, never a guess.
export function BoundaryPreview({ boundary, width = 180, height = 110 }: { boundary: Boundary | null; width?: number; height?: number }) {
  const points = boundary ? boundarySvgPoints(boundary, width, height) : null
  if (!points) {
    return (
      <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>
        No outline to show.
      </p>
    )
  }
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Area outline, north up"
      style={{ background: 'var(--bg)', borderRadius: 9, border: '1px solid var(--line)' }}
    >
      <polygon points={points} fill="color-mix(in srgb, var(--c-physical) 22%, transparent)" stroke="var(--c-physical)" strokeWidth={1.5} />
    </svg>
  )
}

function DeleteVenueModal({ venue, areaCount, onClose }: { venue: Venue; areaCount: number; onClose: () => void }) {
  const del = useDeleteVenue()
  return (
    <Modal
      title="Remove venue"
      sub={venue.name}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={del.isPending}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            style={{ background: 'var(--m-pdf)' }}
            onClick={() => del.mutate({ id: venue.id }, { onSuccess: onClose })}
            disabled={del.isPending}
          >
            <Icon.trash />
            {del.isPending ? 'Removing…' : 'Remove'}
          </button>
        </>
      }
    >
      <p style={{ fontSize: 14.5, lineHeight: 1.55 }}>
        This removes the venue and its {areaCount} area{areaCount !== 1 ? 's' : ''}. Sessions that point at it keep
        working; their venue link is cleared.
      </p>
      {del.isError && (
        <p className="muted" style={{ color: 'var(--m-pdf)', fontSize: 13.5 }}>
          Could not remove the venue. Try again.
        </p>
      )}
    </Modal>
  )
}

// One area's editor row: name, usable flag, the vertex list and the live
// outline beside it. Save validates the vertices before any write.
function AreaRow({ area }: { area: VenueArea }) {
  const update = useUpdateVenueArea()
  const del = useDeleteVenueArea()
  const [name, setName] = useState(area.name)
  const [usable, setUsable] = useState(area.usable)
  const [text, setText] = useState(area.boundary ? formatBoundaryText(area.boundary) : '')
  const [parseError, setParseError] = useState<string | null>(null)
  const parsed = parseBoundaryText(text)
  const preview = parsed.boundary ?? area.boundary
  const save = () => {
    const { boundary, error } = parseBoundaryText(text)
    if (!boundary) {
      setParseError(error)
      return
    }
    setParseError(null)
    update.mutate({ id: area.id, name: name.trim() || area.name, boundary, usable })
  }
  return (
    <div style={{ borderTop: '1px solid var(--line)', padding: '12px 0', display: 'flex', gap: 14, flexWrap: 'wrap' }}>
      <div style={{ flex: '1 1 260px', minWidth: 0 }}>
        <div className="row" style={{ gap: 10 }}>
          <div className="field" style={{ flex: 1, marginBottom: 8 }}>
            <label>Area name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <label className="row" style={{ gap: 6, fontSize: 13.5, fontWeight: 700, alignSelf: 'flex-end', marginBottom: 14 }}>
            <input type="checkbox" checked={usable} onChange={(e) => setUsable(e.target.checked)} />
            Usable
          </label>
        </div>
        <div className="field" style={{ marginBottom: 8 }}>
          <label>Boundary, one vertex per line as latitude, longitude</label>
          <textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
        </div>
        {(parseError || update.isError || del.isError) && (
          <p className="muted" style={{ color: 'var(--m-pdf)', fontSize: 13, marginBottom: 8 }}>
            {parseError ?? 'Could not save the area. Try again.'}
          </p>
        )}
        <div className="row" style={{ gap: 8 }}>
          <button className="btn btn-ghost btn-sm" onClick={save} disabled={update.isPending}>
            <Icon.check />
            Save area
          </button>
          <button
            className="btn btn-ghost btn-sm icon-only"
            style={{ width: 38, padding: 0 }}
            aria-label={'Remove ' + area.name}
            onClick={() => del.mutate({ id: area.id })}
            disabled={del.isPending}
          >
            <Icon.trash />
          </button>
        </div>
      </div>
      <div style={{ flex: '0 0 auto' }}>
        <BoundaryPreview boundary={preview} />
        <div className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>
          {areaLabel(preview)}
          {!area.usable && !usable ? ' · not usable' : ''}
        </div>
      </div>
    </div>
  )
}

function AddAreaForm({ venueId }: { venueId: string }) {
  const insert = useInsertVenueArea()
  const [name, setName] = useState('')
  const [text, setText] = useState('')
  const [parseError, setParseError] = useState<string | null>(null)
  const add = () => {
    const { boundary, error } = parseBoundaryText(text)
    if (!boundary) {
      setParseError(error)
      return
    }
    setParseError(null)
    insert.mutate(
      { venueId, name: name.trim() || 'Area', boundary, usable: true },
      {
        onSuccess: () => {
          setName('')
          setText('')
        },
      },
    )
  }
  return (
    <div style={{ borderTop: '1px solid var(--line)', padding: '12px 0' }}>
      <div className="row" style={{ gap: 10 }}>
        <div className="field" style={{ flex: 1, marginBottom: 8 }}>
          <label>New area name</label>
          <input placeholder="Main field" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
      </div>
      <div className="field" style={{ marginBottom: 8 }}>
        <label>Boundary, one vertex per line as latitude, longitude</label>
        <textarea
          rows={4}
          placeholder={'53.68568, -1.56218\n53.68529, -1.56243\n53.68517, -1.56162'}
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
        />
      </div>
      {(parseError || insert.isError) && (
        <p className="muted" style={{ color: 'var(--m-pdf)', fontSize: 13, marginBottom: 8 }}>
          {parseError ?? 'Could not add the area. The name may already exist for this venue.'}
        </p>
      )}
      <button className="btn btn-ghost btn-sm" onClick={add} disabled={insert.isPending || !text.trim()}>
        <Icon.plus />
        Add area
      </button>
    </div>
  )
}

function VenueCard({ venue, areas }: { venue: Venue; areas: VenueArea[] }) {
  const update = useUpdateVenue()
  const [name, setName] = useState(venue.name)
  const [centre, setCentre] = useState(`${venue.centreLat}, ${venue.centreLng}`)
  const [removing, setRemoving] = useState(false)
  const parsedCentre = parseCentreText(centre)
  const changed = (name.trim() !== venue.name && name.trim() !== '') || (parsedCentre !== null && (parsedCentre.lat !== venue.centreLat || parsedCentre.lng !== venue.centreLng))
  return (
    <div className="card" style={{ padding: 18 }}>
      <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
        <div className="field" style={{ flex: '1 1 180px', marginBottom: 0 }}>
          <label>Venue name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field" style={{ flex: '1 1 220px', marginBottom: 0 }}>
          <label>Centre, latitude, longitude</label>
          <input value={centre} onChange={(e) => setCentre(e.target.value)} spellCheck={false} />
        </div>
        <button
          className="btn btn-ghost btn-sm"
          style={{ alignSelf: 'flex-end' }}
          disabled={!changed || parsedCentre === null || update.isPending}
          onClick={() =>
            parsedCentre &&
            update.mutate({ id: venue.id, name: name.trim(), centreLat: parsedCentre.lat, centreLng: parsedCentre.lng })
          }
        >
          <Icon.check />
          Save
        </button>
        <button
          className="btn btn-ghost btn-sm icon-only"
          style={{ width: 38, padding: 0, alignSelf: 'flex-end' }}
          aria-label={'Remove ' + venue.name}
          onClick={() => setRemoving(true)}
        >
          <Icon.trash />
        </button>
      </div>
      {parsedCentre === null && (
        <p className="muted" style={{ color: 'var(--m-pdf)', fontSize: 13, marginTop: 8, marginBottom: 0 }}>
          The centre is latitude, longitude, for example 53.68541, -1.56192.
        </p>
      )}
      {update.isError && (
        <p className="muted" style={{ color: 'var(--m-pdf)', fontSize: 13, marginTop: 8, marginBottom: 0 }}>
          Could not save the venue. Try again.
        </p>
      )}
      <div style={{ marginTop: 12 }}>
        {areas.map((a) => (
          <AreaRow key={a.id} area={a} />
        ))}
        {areas.length === 0 && (
          <p className="muted" style={{ fontSize: 13.5 }}>
            No areas yet. Add the usable field below.
          </p>
        )}
        <AddAreaForm venueId={venue.id} />
      </div>
      {removing && <DeleteVenueModal venue={venue} areaCount={areas.length} onClose={() => setRemoving(false)} />}
    </div>
  )
}

export function AdminVenues() {
  const { data: venues = [], isLoading, isError } = useVenues()
  const { data: areas = [] } = useVenueAreas()
  const insert = useInsertVenue()
  const [name, setName] = useState('')
  const [centre, setCentre] = useState('')
  const { caps } = useMyCapabilities()
  if (isLoading) return <Loading />
  if (isError) return <ErrorNote />
  // The route guard already keeps members without club.manage out; this is
  // belt and braces for the brief render before a redirect.
  if (!caps.has('club.manage')) return null

  const parsedCentre = parseCentreText(centre)
  const add = () => {
    if (!name.trim() || !parsedCentre) return
    insert.mutate(
      { name: name.trim(), centreLat: parsedCentre.lat, centreLng: parsedCentre.lng },
      {
        onSuccess: () => {
          setName('')
          setCentre('')
        },
      },
    )
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Venues</h2>
          <div className="sub">
            The club's places and their measured areas. Boundaries are drawn by eye over the usable green space, which
            is precise enough for session setup.
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: 18, maxWidth: 720, marginBottom: 14 }}>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <div className="field" style={{ flex: '1 1 160px', marginBottom: 0 }}>
            <label>New venue</label>
            <input placeholder="Venue name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field" style={{ flex: '1 1 220px', marginBottom: 0 }}>
            <label>Centre, latitude, longitude</label>
            <input placeholder="53.68541, -1.56192" value={centre} onChange={(e) => setCentre(e.target.value)} spellCheck={false} />
          </div>
          <button
            className="btn btn-primary"
            style={{ alignSelf: 'flex-end' }}
            disabled={!name.trim() || !parsedCentre || insert.isPending}
            onClick={add}
          >
            <Icon.plus />
            Add venue
          </button>
        </div>
        {insert.isError && (
          <p className="muted" style={{ fontSize: 12.5, color: 'var(--m-pdf)', marginTop: 8, marginBottom: 0 }}>
            Could not add the venue. The name may already exist.
          </p>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 720 }}>
        {venues.map((v) => (
          <VenueCard key={v.id} venue={v} areas={areas.filter((a) => a.venueId === v.id)} />
        ))}
        {venues.length === 0 && (
          <p className="muted" style={{ fontSize: 13.5 }}>
            No venues yet. Add the first one above.
          </p>
        )}
      </div>
    </div>
  )
}
