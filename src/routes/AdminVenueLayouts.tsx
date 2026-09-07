// One venue's layouts, behind club.manage (COACH-5). An admin picks the
// season and the age group, sees the four shapes the club uses (four
// stations, five stations, one game, two games), and draws, redraws or
// removes each. Every coach then reuses the drawing every week, loaded
// automatically for a session in that scope, and the positions stay
// familiar.
//
// THE SCOPE IS THE UNIQUE KEY. Venue, season and age group; never a team,
// never a session. The season defaults to the current one here because an
// admin is choosing a scope with the answer in front of them, which is the
// one place is_current is allowed to be a default (it never resolves a dated
// session, src/lib/venueLayout.ts). The age group comes from the club's own
// list, and a club that has not configured one is told so and pointed at the
// Club screen rather than offered defaults it never chose.
//
// SAVED MEANS STORED. A save returns the row as the database holds it and
// the screen compares that readback with the draft signature; only equality
// says Saved. A second admin drawing the same shape in the same scope is
// refused by the scope key and reported as their drawing rather than lost.
// While an editor is open the scope controls freeze, so a draft cannot be
// filed under a scope the admin changed underneath it.
//
// REVIEW: capability gated admin surface.
import { useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Icon } from '../components/icons'
import { Badge, Button, Card, Note, PageHeader, SelectField, TextField, buttonClass } from '../components/primitives'
import { Empty, ErrorNote, Loading, Modal } from '../components/ui'
import { VenueLayoutEditor, VenueLayoutView } from '../components/VenueLayoutPitch'
import { useFocusRestore } from '../hooks/useFocusRestore'
import { ageGroupsConfigured } from '../lib/ageGroups'
import type { Season } from '../lib/data'
import {
  isVenueLayoutScopeTaken,
  useClub,
  useDeleteVenueLayout,
  useMyCapabilities,
  useSaveVenueLayout,
  useSeasons,
  useVenueLayouts,
  useVenues,
} from '../lib/queries'
import {
  LAYOUT_SHAPES,
  MAX_SIZE_METRES,
  MAX_ZONE_NAME,
  MIN_SIZE_METRES,
  completeZones,
  emptyLayoutZones,
  layoutForShape,
  layoutShapeLabel,
  layoutSignature,
  layoutsForScope,
  renameZone,
  zoneLabel,
  type LayoutShape,
  type LayoutZone,
  type VenueLayout,
  type VenueLayoutZones,
} from '../lib/venueLayout'

export const LAYOUTS_INTRO =
  'Where the stations and the games go on this ground, for one season and one age group. Every coach reuses it every week, so the positions stay familiar. A station zone is the area normally allocated to that station, not this week’s exact footprint.'
export const NO_AGE_GROUPS_NOTE =
  'The club has no age groups yet. Layouts are filed under an age group, so add the club’s age groups under Club first, then come back to draw them.'
export const LAYOUT_CHANGED_ELSEWHERE =
  'This layout was changed by somebody else while you were drawing. The drawing below is theirs; open it again to redraw.'
export const LAYOUT_SCOPE_TAKEN =
  'Another admin drew this layout while you were drawing. Their drawing is shown; open it to redraw.'
export const LAYOUT_READBACK_MISMATCH =
  'The layout came back different from what was drawn, so it is not saved as shown. Try saving again.'

type Note = { tone: 'success' | 'danger' | 'warning'; text: string }

type Draft = {
  shape: LayoutShape
  // The row being redrawn, or null for a new layout.
  layoutId: string | null
  // The stored signature when the draft opened, so a change made elsewhere
  // is noticed rather than overwritten.
  base: string | null
  zones: VenueLayoutZones
}

function seasonLabel(s: Season): string {
  const flags = [s.isCurrent ? 'current' : '', s.archivedAt ? 'archived' : ''].filter(Boolean)
  return flags.length ? `${s.name} (${flags.join(', ')})` : s.name
}

function scopeTitle(venueName: string, shape: LayoutShape): string {
  return `${layoutShapeLabel(shape)} at ${venueName}`
}

// One shape's card: the drawing when there is one, the editor when it is
// being drawn, and the sentence when there is neither.
function LayoutCard({
  shape,
  venueName,
  layout,
  draft,
  busy,
  onDraw,
  onRemove,
  onDraftChange,
  onSave,
  onCancel,
  onAnnounce,
  editorNote,
}: {
  shape: LayoutShape
  venueName: string
  layout: VenueLayout | null
  draft: Draft | null
  busy: boolean
  onDraw: () => void
  onRemove: () => void
  onDraftChange: (zones: VenueLayoutZones) => void
  onSave: () => void
  onCancel: () => void
  onAnnounce: (text: string) => void
  editorNote: Note | null
}) {
  const title = layoutShapeLabel(shape)
  const editing = draft?.shape.kind === shape.kind && draft.shape.slots === shape.slots ? draft : null
  const unreadable = layout !== null && layout.zones === null

  if (editing) {
    const zones = editing.zones
    const setZones = (next: LayoutZone[]) => onDraftChange({ ...zones, zones: next })
    return (
      <Card padded className="venue-layout-card">
        <h2>{title}</h2>
        <VenueLayoutEditor
          kind={shape.kind}
          zones={zones.zones}
          size={zones.size}
          label={`${scopeTitle(venueName, shape)}, being drawn`}
          onChange={setZones}
          onAnnounce={onAnnounce}
        />
        <p className="admin-hint">
          Drag a zone to move it and drag its corner to resize it. With the keyboard, arrows move a zone and Shift with
          arrows resizes it.
        </p>
        <div className="venue-layout-fields">
          {zones.zones.map((z) => (
            <TextField
              key={z.n}
              label={`Name for ${zoneLabel(shape.kind, z.n)}`}
              className="field-flush"
              value={z.name}
              maxLength={MAX_ZONE_NAME}
              placeholder="Optional, e.g. Top corner"
              onChange={(e) => setZones(renameZone(zones.zones, z.n, e.target.value))}
            />
          ))}
        </div>
        <div className="venue-layout-fields">
          <TextField
            label="Width in metres"
            className="field-flush"
            type="number"
            inputMode="numeric"
            min={MIN_SIZE_METRES}
            max={MAX_SIZE_METRES}
            value={zones.size.metresWide ?? ''}
            placeholder="Optional"
            onChange={(e) =>
              onDraftChange({ ...zones, size: { ...zones.size, metresWide: e.target.value === '' ? null : Number(e.target.value) } })
            }
          />
          <TextField
            label="Length in metres"
            className="field-flush"
            type="number"
            inputMode="numeric"
            min={MIN_SIZE_METRES}
            max={MAX_SIZE_METRES}
            value={zones.size.metresLong ?? ''}
            placeholder="Optional"
            onChange={(e) =>
              onDraftChange({ ...zones, size: { ...zones.size, metresLong: e.target.value === '' ? null : Number(e.target.value) } })
            }
          />
        </div>
        {editorNote && (
          <Note tone={editorNote.tone} role={editorNote.tone === 'danger' ? 'alert' : 'status'} className="admin-note">
            {editorNote.text}
          </Note>
        )}
        <div className="venue-layout-acts">
          <Button variant="primary" icon={Icon.check} disabled={busy} onClick={onSave} aria-label={`Save ${title}`}>
            {busy ? 'Saving…' : 'Save layout'}
          </Button>
          <Button variant="quiet" icon={Icon.x} disabled={busy} onClick={onCancel} aria-label={`Cancel drawing ${title}`}>
            Cancel
          </Button>
        </div>
      </Card>
    )
  }

  return (
    <Card padded className="venue-layout-card">
      <h2>{title}</h2>
      {layout && layout.zones && (
        <VenueLayoutView kind={shape.kind} zones={layout.zones.zones} size={layout.zones.size} label={scopeTitle(venueName, shape)} />
      )}
      {unreadable && (
        <Note tone="warning" role="status" className="admin-note">
          This layout is stored in a shape this version cannot read. Draw it again to replace it.
        </Note>
      )}
      {!layout && <p className="venue-layout-empty">Not drawn yet for this season and age group.</p>}
      <div className="venue-layout-acts">
        <Button
          variant={layout && !unreadable ? 'ghost' : 'primary'}
          size="sm"
          icon={Icon.edit}
          disabled={busy || draft !== null}
          onClick={onDraw}
          aria-label={`${layout && !unreadable ? 'Edit' : 'Draw'} ${title}`}
        >
          {layout && !unreadable ? 'Edit' : 'Draw'}
        </Button>
        {layout && (
          <Button size="sm" icon={Icon.trash} disabled={busy || draft !== null} onClick={onRemove} aria-label={`Remove ${title}`}>
            Remove
          </Button>
        )}
      </div>
    </Card>
  )
}

export function RemoveLayoutModalView({
  title,
  busy,
  failed,
  onCancel,
  onConfirm,
}: {
  title: string
  busy: boolean
  failed: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <Modal
      title="Remove layout"
      sub={title}
      onClose={onCancel}
      dismissible={!busy}
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
        Sessions in this scope will show no layout for this shape until somebody draws one again. Nothing else changes:
        no session, plan or register is touched.
      </p>
      {failed && (
        <Note tone="danger" role="alert">
          Could not remove the layout. Try again.
        </Note>
      )}
    </Modal>
  )
}

export function AdminVenueLayouts() {
  const { venueId } = useParams()
  const { caps } = useMyCapabilities()
  const venues = useVenues()
  const seasons = useSeasons()
  const club = useClub()
  const layouts = useVenueLayouts()
  const save = useSaveVenueLayout()
  const remove = useDeleteVenueLayout()

  const [seasonChoice, setSeasonChoice] = useState<string | null>(null)
  const [ageChoice, setAgeChoice] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [note, setNote] = useState<Note | null>(null)
  const [editorNote, setEditorNote] = useState<Note | null>(null)
  const [removing, setRemoving] = useState<VenueLayout | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const noteRef = useRef<HTMLDivElement>(null)
  // A saved layout closes its editor, and the Save button that had focus
  // goes with it; focus lands on the outcome message rather than the body.
  const wantNoteFocus = useFocusRestore(!save.isPending && !remove.isPending, noteRef)

  const venue = venues.data?.find((v) => v.id === venueId) ?? null
  const seasonRows = seasons.data ?? []
  const currentSeason = seasonRows.find((s) => s.isCurrent) ?? seasonRows[0] ?? null
  const seasonId = seasonChoice && seasonRows.some((s) => s.id === seasonChoice) ? seasonChoice : (currentSeason?.id ?? null)
  const ageGroups = club.data?.ageGroups ?? []
  const ageGroup = ageChoice && ageGroups.includes(ageChoice) ? ageChoice : (ageGroups[0] ?? null)
  const scope = venue && seasonId && ageGroup ? { venueId: venue.id, seasonId, ageGroup } : null
  const inScope = scope ? layoutsForScope(layouts.data ?? [], scope) : []

  // A draft opened on a stored layout notices that layout changing
  // underneath it: another admin redrew or removed it. The draft is dropped
  // and the reason said, because a save on top of it would have overwritten
  // work nobody here had seen. Reconciled during render, keyed on the read
  // landing rather than on the rows changing, the way the Teams screen does,
  // so the draft never survives a paint it should not.
  const [seenRead, setSeenRead] = useState(layouts.dataUpdatedAt)
  if (layouts.dataUpdatedAt !== seenRead) {
    setSeenRead(layouts.dataUpdatedAt)
    if (draft && draft.layoutId !== null) {
      const stored = (layouts.data ?? []).find((l) => l.id === draft.layoutId) ?? null
      const signature = stored?.zones ? layoutSignature(stored.zones, draft.shape) : null
      if (signature !== draft.base) {
        setDraft(null)
        setNote({ tone: 'warning', text: LAYOUT_CHANGED_ELSEWHERE })
      }
    }
  }

  if (venues.isError || seasons.isError || club.isError || layouts.isError) return <ErrorNote />
  if (venues.isLoading || seasons.isLoading || club.isLoading || layouts.isLoading) return <Loading />
  // The route guard already keeps members without club.manage out; this is
  // belt and braces for the brief render before a redirect.
  if (!caps.has('club.manage')) return null

  if (!venue) {
    return (
      <div>
        <PageHeader title="Venue layouts" />
        <Card className="admin-narrow">
          <Empty icon={Icon.ruler} title="Venue not found">
            It may have been removed.{' '}
            <Link to="/admin/venues" className={buttonClass('ghost', 'sm', { className: 'empty-action' })}>
              Back to venues
            </Link>
          </Empty>
        </Card>
      </div>
    )
  }

  const busy = save.isPending || remove.isPending
  const seasonName = seasonRows.find((s) => s.id === seasonId)?.name ?? ''

  const startDraft = (shape: LayoutShape) => {
    const stored = layoutForShape(inScope, shape)
    const zones = stored?.zones
      ? { ...stored.zones, zones: completeZones(stored.zones.zones, shape) }
      : emptyLayoutZones(shape)
    setNote(null)
    setEditorNote(null)
    setDraft({
      shape,
      layoutId: stored?.id ?? null,
      base: stored?.zones ? layoutSignature(stored.zones, shape) : null,
      zones,
    })
  }

  const saveDraft = () => {
    if (!draft || !scope) return
    const { shape, zones } = draft
    setEditorNote(null)
    wantNoteFocus()
    save.mutate(
      { id: draft.layoutId ?? undefined, ...scope, shape, zones },
      {
        onSuccess: (stored) => {
          const agreed = stored.zones !== null && layoutSignature(stored.zones, shape) === layoutSignature(zones, shape)
          if (!agreed) {
            setEditorNote({ tone: 'danger', text: LAYOUT_READBACK_MISMATCH })
            return
          }
          setDraft(null)
          setNote({ tone: 'success', text: `${layoutShapeLabel(shape)} saved for ${seasonName}, ${scope.ageGroup}.` })
        },
        onError: (e) => {
          if (isVenueLayoutScopeTaken(e)) {
            setDraft(null)
            setNote({ tone: 'warning', text: LAYOUT_SCOPE_TAKEN })
            return
          }
          setEditorNote({ tone: 'danger', text: e.message })
        },
      },
    )
  }

  return (
    <div>
      <div className="venue-back">
        <Link to="/admin/venues" className={buttonClass('quiet', 'sm')}>
          <Icon.chevL />
          Venues
        </Link>
      </div>
      <PageHeader title={`Layouts at ${venue.name}`} sub={LAYOUTS_INTRO} />

      {!ageGroupsConfigured(ageGroups) ? (
        <Card className="admin-narrow">
          <Note tone="warning" role="status">
            {NO_AGE_GROUPS_NOTE}{' '}
            <Link to="/admin/club">Open Club</Link>
          </Note>
        </Card>
      ) : seasonRows.length === 0 ? (
        <Card className="admin-narrow">
          <Note tone="warning" role="status">
            The club has no seasons yet, so there is nothing to file a layout under.
          </Note>
        </Card>
      ) : (
        <>
          <div className="venue-scope">
            <SelectField
              label="Season"
              value={seasonId ?? ''}
              disabled={draft !== null || busy}
              hint={draft ? 'Finish or cancel the layout you are drawing first.' : undefined}
              onChange={(e) => setSeasonChoice(e.target.value)}
            >
              {seasonRows.map((s) => (
                <option key={s.id} value={s.id}>
                  {seasonLabel(s)}
                </option>
              ))}
            </SelectField>
            <SelectField
              label="Age group"
              value={ageGroup ?? ''}
              disabled={draft !== null || busy}
              onChange={(e) => setAgeChoice(e.target.value)}
            >
              {ageGroups.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </SelectField>
            <div>
              <Badge tone="info">
                {inScope.filter((l) => l.zones !== null).length} of {LAYOUT_SHAPES.length} drawn
              </Badge>
            </div>
          </div>
          {note && (
            <div ref={noteRef} tabIndex={-1} className="admin-note">
              <Note tone={note.tone} role={note.tone === 'danger' ? 'alert' : 'status'}>
                {note.text}
              </Note>
            </div>
          )}
          <div className="sr-only" aria-live="polite">
            {announcement}
          </div>
          <div className="venue-layout-grid">
            {LAYOUT_SHAPES.map((shape) => (
              <LayoutCard
                key={`${shape.kind}-${shape.slots}`}
                shape={shape}
                venueName={venue.name}
                layout={layoutForShape(inScope, shape)}
                draft={draft}
                busy={busy}
                onDraw={() => startDraft(shape)}
                onRemove={() => {
                  setNote(null)
                  setRemoving(layoutForShape(inScope, shape))
                }}
                onDraftChange={(zones) => setDraft((d) => (d ? { ...d, zones } : d))}
                onSave={saveDraft}
                onCancel={() => {
                  setDraft(null)
                  setEditorNote(null)
                }}
                onAnnounce={setAnnouncement}
                editorNote={editorNote}
              />
            ))}
          </div>
        </>
      )}

      {removing && (
        <RemoveLayoutModalView
          title={scopeTitle(venue.name, { kind: removing.kind, slots: removing.slots })}
          busy={remove.isPending}
          failed={remove.isError}
          onCancel={() => setRemoving(null)}
          onConfirm={() => {
            wantNoteFocus()
            remove.mutate(removing.id, {
              onSuccess: () => {
                setRemoving(null)
                setNote({
                  tone: 'success',
                  text: `${layoutShapeLabel({ kind: removing.kind, slots: removing.slots })} removed for ${seasonName}, ${removing.ageGroup}.`,
                })
              },
            })
          }}
        />
      )}
    </div>
  )
}
