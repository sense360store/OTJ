// The setup schematic (ADR-0008, PR 11): the venue area's real boundary
// drawn scale true, with the session's stations on it. Plain SVG, no map
// tiles and no external library: the polygon is the owner's drawn
// approximation projected to metres, and one scale serves both axes so
// the shape and every distance on it read true.
//
// Presentational and exported for the static tests. The composer passes
// handlers; the session day and the live view pass none and get a
// picture. A station outside the boundary draws as a warning and is never
// refused.
import type { PointerEvent as ReactPointerEvent } from 'react'
import { useRef } from 'react'
import {
  stationInsideBoundary,
  stationSummary,
  type AreaFrame,
  type Metres,
  type SchematicStation,
} from '../lib/sessionSetup'
import type { LayoutArea } from '../lib/drillLayout'
import './SetupSchematic.css'

const LONG_SIDE = 600
const PAD = 14

export function SetupSchematic({
  frame,
  stations,
  selectedId,
  onTapCanvas,
  onStationPointerDown,
  onStationPointerMove,
  onStationPointerUp,
  onStationPointerCancel,
}: {
  frame: AreaFrame
  stations: SchematicStation[]
  selectedId?: string | null
  onTapCanvas?: (at: Metres) => void
  onStationPointerDown?: (id: string) => (e: ReactPointerEvent) => void
  onStationPointerMove?: (id: string) => (e: ReactPointerEvent) => void
  onStationPointerUp?: (id: string) => (e: ReactPointerEvent) => void
  onStationPointerCancel?: (id: string) => (e: ReactPointerEvent) => void
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const k = LONG_SIDE / Math.max(frame.width, frame.length, 1)
  const w = frame.width * k
  const h = frame.length * k
  const interactive = !!onTapCanvas
  // Metres north grow up the field; SVG y grows down the screen.
  const sy = (yMetres: number) => h - yMetres * k
  const points = frame.polygon.map((p) => `${round(p.x * k)},${round(sy(p.y))}`).join(' ')

  const toMetres = (e: ReactPointerEvent): Metres | null => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return null
    const x = ((e.clientX - rect.left) * ((w + PAD * 2) / rect.width) - PAD) / k
    const yDown = ((e.clientY - rect.top) * ((h + PAD * 2) / rect.height) - PAD) / k
    return { x, y: frame.length - yDown }
  }

  return (
    <svg
      ref={svgRef}
      className={'setup-schematic' + (interactive ? ' interactive' : '')}
      viewBox={`${-PAD} ${-PAD} ${w + PAD * 2} ${h + PAD * 2}`}
      role="img"
      aria-label="Setup plan on the venue area"
      onPointerDown={
        onTapCanvas
          ? (e) => {
              if ((e.target as Element).closest('.setup-station')) return
              const at = toMetres(e)
              if (at) onTapCanvas(at)
            }
          : undefined
      }
    >
      <polygon className="setup-boundary" points={points} />
      {stations.map(({ station: s, title, index }) => {
        const inside = stationInsideBoundary(s, frame)
        const selected = selectedId === s.id
        const x = s.x * k
        const y = sy(s.y + s.length)
        return (
          <g
            key={s.id}
            className={
              'setup-station' + (inside ? '' : ' outside') + (selected ? ' selected' : '')
            }
            onPointerDown={onStationPointerDown?.(s.id)}
            onPointerMove={onStationPointerMove?.(s.id)}
            onPointerUp={onStationPointerUp?.(s.id)}
            onPointerCancel={onStationPointerCancel?.(s.id)}
          >
            <rect x={round(x)} y={round(y)} width={round(s.width * k)} height={round(s.length * k)} rx={3} />
            <text className="setup-station-num" x={round(x + 9)} y={round(y + 20)}>
              {index + 1}
            </text>
            <text className="setup-station-label" x={round(x + 9)} y={round(y + 38)}>
              {s.label || title || `${s.width} × ${s.length} m`}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

function round(n: number): number {
  return Math.round(n * 10) / 10
}

// The composed setup as a coach reads it: the schematic, then the stations
// in order with their size and how the bound drill sits in each. Read
// only, no handlers, so the session day, the live view and the printed
// sheet all render the same picture. A station crossing the drawn
// boundary is called out and never hidden.
export function SetupPlanView({
  frame,
  stations,
  areaName,
  drillAreas,
}: {
  frame: AreaFrame
  stations: SchematicStation[]
  areaName: string
  // The bound drill's declared area, by drill id, for the fit line.
  drillAreas: Record<string, LayoutArea | null>
}) {
  const outside = stations.filter((s) => !stationInsideBoundary(s.station, frame))
  return (
    <div className="setup-plan">
      <SetupSchematic frame={frame} stations={stations} />
      <div className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>
        {areaName} · {Math.round(frame.width)} × {Math.round(frame.length)} m across, north up
      </div>
      {outside.length > 0 && (
        <p className="setup-warning" style={{ marginTop: 6 }}>
          {outside.length === 1
            ? 'One station crosses the drawn boundary. Check it on the grass.'
            : `${outside.length} stations cross the drawn boundary. Check them on the grass.`}
        </p>
      )}
      {stations.length > 0 && (
        <ol className="setup-station-list">
          {stations.map(({ station: s, title }, i) => (
            <li key={s.id}>
              <b>
                {i + 1}. {s.label || title || 'Station'}
              </b>{' '}
              <span className="muted">
                {stationSummary(s, (s.drillId ? drillAreas[s.drillId] : null) ?? null)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
