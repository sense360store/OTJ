// The setup composer (ADR-0008, PR 11): lay the session's stations out on
// a real venue area before anyone arrives. Choose the area, tap to place a
// station (sized to the bound drill's own declared area, so a drill
// written for 12 by 12 paces out at 12 by 12 on the grass), drag to move,
// size and label it, bind it to one of the session's drills.
//
// A station crossing the drawn boundary is a warning and never a block:
// the boundary is the owner's visual approximation of the usable green,
// and the coach standing on the grass is the authority on whether the far
// corner is really out.
//
// All layout logic is pure in src/lib/sessionSetup.ts; this is pointers
// and buttons over it. The working copy lives in React state until Save.
import { useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import {
  addStation,
  areaFrame,
  emptySetup,
  moveStation,
  removeStation,
  resizeStation,
  setStationDrill,
  setStationLabel,
  SETUP_LABEL_MAX,
  SETUP_MAX_STATIONS,
  schematicStations,
  setupProblems,
  stationInsideBoundary,
  stationSummary,
  type AreaFrame,
  type Metres,
  type SessionSetup,
} from '../lib/sessionSetup'
import { isDrag } from '../lib/tacticsBoard'
import type { Drill } from '../lib/data'
import type { VenueArea } from '../lib/venues'
import { areaLabel } from '../lib/venues'
import { Modal } from './ui'
import { SetupSchematic } from './SetupSchematic'

// The composer's editing surface, presentational apart from its own
// gesture state. Exported for the static tests.
export function SetupComposerView({
  areas,
  areaId,
  frame,
  setup,
  drills,
  drillById,
  selectedId,
  onArea,
  onSelect,
  onTapCanvas,
  onDragStation,
  onResize,
  onLabel,
  onBindDrill,
  onRemove,
}: {
  areas: VenueArea[]
  areaId: string
  frame: AreaFrame | null
  setup: SessionSetup
  drills: Drill[]
  drillById: Record<string, Drill>
  selectedId: string | null
  onArea: (id: string) => void
  onSelect: (id: string | null) => void
  onTapCanvas: (at: Metres) => void
  onDragStation: (id: string, to: Metres) => void
  onResize: (id: string, width: number, length: number) => void
  onLabel: (id: string, label: string) => void
  onBindDrill: (id: string, drillId: string | null) => void
  onRemove: (id: string) => void
}) {
  const gesture = useRef<{ id: string; startX: number; startY: number; dragging: boolean; grab: Metres | null; origin: Metres } | null>(null)
  const selected = setup.stations.find((s) => s.id === selectedId) ?? null
  const outside = frame ? setup.stations.filter((s) => !stationInsideBoundary(s, frame)) : []

  const eventMetres = (e: ReactPointerEvent): Metres | null => {
    const svg = (e.currentTarget as Element).closest('svg')
    const rect = svg?.getBoundingClientRect()
    if (!rect || rect.width === 0 || !frame) return null
    const k = 600 / Math.max(frame.width, frame.length, 1)
    const pad = 14
    const w = frame.width * k
    const h = frame.length * k
    const x = ((e.clientX - rect.left) * ((w + pad * 2) / rect.width) - pad) / k
    const yDown = ((e.clientY - rect.top) * ((h + pad * 2) / rect.height) - pad) / k
    return { x, y: frame.length - yDown }
  }

  const down = (id: string) => (e: ReactPointerEvent) => {
    const s = setup.stations.find((x) => x.id === id)
    if (!s) return
    gesture.current = {
      id,
      startX: e.clientX,
      startY: e.clientY,
      dragging: false,
      grab: eventMetres(e),
      origin: { x: s.x, y: s.y },
    }
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* no pointer capture available */
    }
  }
  const move = (id: string) => (e: ReactPointerEvent) => {
    const g = gesture.current
    if (!g || g.id !== id) return
    if (!g.dragging) {
      if (!isDrag(e.clientX - g.startX, e.clientY - g.startY)) return
      g.dragging = true
    }
    const at = eventMetres(e)
    if (!at || !g.grab) return
    onDragStation(id, { x: g.origin.x + (at.x - g.grab.x), y: g.origin.y + (at.y - g.grab.y) })
  }
  const up = (id: string) => () => {
    const g = gesture.current
    if (!g || g.id !== id) return
    gesture.current = null
    if (!g.dragging) onSelect(id)
  }
  const cancel = (id: string) => () => {
    if (gesture.current?.id === id) gesture.current = null
  }

  return (
    <div className="setup-composer">
      <div className="field">
        <label>Area</label>
        <select value={areaId} onChange={(e) => onArea(e.target.value)}>
          <option value="">Choose an area</option>
          {areas.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} · {areaLabel(a.boundary)}
            </option>
          ))}
        </select>
      </div>

      {!frame ? (
        <p className="muted" style={{ fontSize: 13.5 }}>
          Choose the area this session is laid out on. Areas are configured under Venues.
        </p>
      ) : (
        <>
          <p className="muted" style={{ fontSize: 13.5, marginBottom: 8 }}>
            Tap the area to place a station. Drag one to move it. The green outline is the usable area as the club
            drew it, north up.
          </p>
          <SetupSchematic
            frame={frame}
            stations={schematicStations(setup, drillById)}
            selectedId={selectedId}
            onTapCanvas={onTapCanvas}
            onStationPointerDown={down}
            onStationPointerMove={move}
            onStationPointerUp={up}
            onStationPointerCancel={cancel}
          />
          {outside.length > 0 && (
            <p className="setup-warning" style={{ marginTop: 8 }}>
              {outside.length === 1
                ? 'One station crosses the drawn boundary. Check it on the grass before you set up.'
                : `${outside.length} stations cross the drawn boundary. Check them on the grass before you set up.`}
            </p>
          )}
          {setup.stations.length >= SETUP_MAX_STATIONS && (
            <p className="muted" style={{ fontSize: 13 }}>
              That is the most stations one setup holds.
            </p>
          )}

          {selected && (
            <div className="row wrap" style={{ gap: 10, marginTop: 12, alignItems: 'flex-end' }}>
              <div className="field" style={{ width: 100 }}>
                <label>Width, m</label>
                <input
                  key={`w-${selected.id}-${selected.width}`}
                  type="number"
                  defaultValue={selected.width}
                  onBlur={(e) => {
                    const n = Number(e.target.value)
                    if (Number.isFinite(n) && n > 0) onResize(selected.id, n, selected.length)
                  }}
                />
              </div>
              <div className="field" style={{ width: 100 }}>
                <label>Length, m</label>
                <input
                  key={`l-${selected.id}-${selected.length}`}
                  type="number"
                  defaultValue={selected.length}
                  onBlur={(e) => {
                    const n = Number(e.target.value)
                    if (Number.isFinite(n) && n > 0) onResize(selected.id, selected.width, n)
                  }}
                />
              </div>
              <div className="field" style={{ width: 170 }}>
                <label>Label</label>
                <input
                  key={`lab-${selected.id}-${selected.label ?? ''}`}
                  type="text"
                  maxLength={SETUP_LABEL_MAX}
                  defaultValue={selected.label ?? ''}
                  placeholder="e.g. Rondo grid"
                  onBlur={(e) => onLabel(selected.id, e.target.value)}
                />
              </div>
              <div className="field" style={{ flex: 1, minWidth: 180 }}>
                <label>Drill</label>
                <select
                  value={selected.drillId ?? ''}
                  onChange={(e) => onBindDrill(selected.id, e.target.value || null)}
                >
                  <option value="">No drill</option>
                  {drills.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.title}
                    </option>
                  ))}
                </select>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => onRemove(selected.id)}>
                Remove station
              </button>
            </div>
          )}

          {setup.stations.length > 0 && (
            <ol className="setup-station-list" style={{ marginTop: 12 }}>
              {setup.stations.map((s, i) => {
                const drill = s.drillId ? drillById[s.drillId] : undefined
                return (
                  <li key={s.id}>
                    <button className="linkish" onClick={() => onSelect(s.id)}>
                      {i + 1}. {s.label || drill?.title || 'Station'}
                    </button>{' '}
                    <span className="muted">{stationSummary(s, drill?.layout?.area ?? null)}</span>
                    {frame && !stationInsideBoundary(s, frame) && (
                      <span className="setup-warning"> · crosses the boundary</span>
                    )}
                  </li>
                )
              })}
            </ol>
          )}
        </>
      )}
    </div>
  )
}

export function SetupComposerModal({
  areas,
  initialAreaId,
  initialSetup,
  drills,
  saving,
  errorText,
  onSave,
  onClose,
}: {
  areas: VenueArea[]
  initialAreaId: string | null
  initialSetup: SessionSetup | null
  drills: Drill[]
  saving: boolean
  errorText: string
  onSave: (areaId: string | null, setup: SessionSetup | null) => void
  onClose: () => void
}) {
  const [areaId, setAreaId] = useState(initialAreaId ?? '')
  const [setup, setSetup] = useState<SessionSetup>(initialSetup ?? emptySetup())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const drillById = useMemo(() => Object.fromEntries(drills.map((d) => [d.id, d])), [drills])
  const area = areas.find((a) => a.id === areaId)
  const frame = useMemo(() => (area?.boundary ? areaFrame(area.boundary) : null), [area])
  const valid = setupProblems(setup).length === 0

  return (
    <Modal
      title="Compose setup"
      sub="Where the stations stand on the grass"
      onClose={onClose}
      dismissible={!saving}
      wide
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={saving || !valid}
            onClick={() => onSave(areaId || null, setup.stations.length ? setup : null)}
          >
            {saving ? 'Saving…' : 'Save setup'}
          </button>
        </>
      }
    >
      <SetupComposerView
        areas={areas}
        areaId={areaId}
        frame={frame}
        setup={setup}
        drills={drills}
        drillById={drillById}
        selectedId={selectedId}
        onArea={(id) => {
          setAreaId(id)
          setSelectedId(null)
        }}
        onSelect={setSelectedId}
        onTapCanvas={(at) => {
          if (!frame) return
          // A tapped station starts as a plain grid; binding a drill from
          // the inspector below is what sizes it to the drill's area.
          const next = addStation(setup, frame, at)
          if (next) {
            setSetup(next)
            setSelectedId(next.stations[next.stations.length - 1].id)
          }
        }}
        onDragStation={(id, to) => setSetup((s) => moveStation(s, id, to))}
        onResize={(id, w, l) => setSetup((s) => resizeStation(s, id, w, l))}
        onLabel={(id, label) => setSetup((s) => setStationLabel(s, id, label))}
        onBindDrill={(id, drillId) => {
          setSetup((s) => {
            const bound = setStationDrill(s, id, drillId)
            // Binding a drill sizes the station to the drill's own declared
            // area, the whole point of the fit: a 12 by 12 drill paces out
            // at 12 by 12. An unbound station keeps whatever it had.
            const area = drillId ? drillById[drillId]?.layout?.area : undefined
            return area ? resizeStation(bound, id, area.width, area.length) : bound
          })
        }}
        onRemove={(id) => {
          setSetup((s) => removeStation(s, id))
          setSelectedId(null)
        }}
      />
      {errorText && (
        <p className="muted" style={{ color: 'var(--m-pdf)', fontSize: 13.5, marginTop: 10 }}>
          {errorText}
        </p>
      )}
    </Modal>
  )
}
