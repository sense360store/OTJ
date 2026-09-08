// The venue layout drawn: a clean schematic of one venue's allocation, as
// numbered zones on a plain surface. Two components over one drawing:
// VenueLayoutView, read only, which is what a session will mount (COACH-6),
// and VenueLayoutEditor, which the admin screen mounts to draw one.
//
// NOT IMAGERY. No satellite tile, no traced photograph, no pitch markings
// even: a layout is where the club's stations and games go on the ground it
// has been allocated, and that ground is a rectangle with a declared size
// at most. The board and the drill diagram draw a pitch because they draw
// football; this draws an allocation.
//
// FRACTIONS IN, FRACTIONS OUT. The SVG viewBox is a fixed width with a height
// from the declared size's ratio (a 3:2 landscape when none is declared), and
// every zone is placed by multiplying its fractions by that box, so the same
// stored layout reads on a phone and a desktop. The editor reports moves and
// resizes back as fractions and holds no position of its own; the draft lives
// in the screen, which is also what the keyboard and the name fields edit.
//
// ONE PRESS DOES ONE THING. A press on a zone's body and a drag moves it; a
// press on its corner handle and a drag resizes it. Pointer capture keeps the
// gesture on the element the finger left, as the board does. The keyboard
// twin is on the zone itself: arrows move, Shift and arrows resize, in the
// same steps, and every change is announced in words.

import { useId, useRef } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { isDrag } from '../lib/tacticsBoard'
import {
  PITCH_VIEW_WIDTH,
  describeLayout,
  describeZone,
  moveZone,
  pitchHeight,
  resizeZone,
  type LayoutKind,
  type LayoutSize,
  type LayoutZone,
} from '../lib/venueLayout'

// The handle a resize begins on, in viewBox units, and the keyboard steps in
// fractions: a nudge, and a bigger one with the modifier the browser leaves
// free on both platforms.
const HANDLE = 22
const NUDGE = 0.01
const BIG_NUDGE = 0.05

function ZoneShape({
  kind,
  zone,
  width,
  height,
  editing,
}: {
  kind: LayoutKind
  zone: LayoutZone
  width: number
  height: number
  editing?: boolean
}) {
  const x = zone.x * width
  const y = zone.y * height
  const w = zone.w * width
  const h = zone.h * height
  const badge = 26
  return (
    <>
      <rect className="venue-zone-body" x={x} y={y} width={w} height={h} rx={10} />
      <circle className="venue-zone-badge" cx={x + badge} cy={y + badge} r={16} />
      <text className="venue-zone-number" x={x + badge} y={y + badge} textAnchor="middle" dominantBaseline="central">
        {zone.n}
      </text>
      {zone.name.trim() !== '' && (
        <text className="venue-zone-name" x={x + badge + 22} y={y + badge} dominantBaseline="central">
          {zone.name.trim()}
        </text>
      )}
      {editing && (
        <rect
          className="venue-zone-handle"
          x={x + w - HANDLE}
          y={y + h - HANDLE}
          width={HANDLE}
          height={HANDLE}
          rx={6}
        />
      )}
      <title>{describeZone(kind, zone)}</title>
    </>
  )
}

// Read only. The SVG is an image with a title and a full description, so a
// screen reader gets the same facts a sighted coach does: which station is
// where and how big.
export function VenueLayoutView({
  kind,
  zones,
  size,
  label,
}: {
  kind: LayoutKind
  zones: readonly LayoutZone[]
  size: LayoutSize
  // What the drawing is of, for its accessible name: "Five stations at Haggs Hill".
  label: string
}) {
  const height = pitchHeight(size)
  const descId = useId()
  return (
    <div className="venue-pitch">
      <svg
        viewBox={`0 0 ${PITCH_VIEW_WIDTH} ${height}`}
        role="img"
        aria-label={label}
        aria-describedby={descId}
        className="venue-pitch-svg"
      >
        <rect className="venue-pitch-ground" x={0} y={0} width={PITCH_VIEW_WIDTH} height={height} rx={14} />
        {zones.map((z) => (
          <g key={z.n}>
            <ZoneShape kind={kind} zone={z} width={PITCH_VIEW_WIDTH} height={height} />
          </g>
        ))}
      </svg>
      <p id={descId} className="sr-only">
        {describeLayout(kind, zones, size)}
      </p>
    </div>
  )
}

type Gesture = {
  n: number
  mode: 'move' | 'resize'
  startX: number
  startY: number
  origin: LayoutZone
  dragging: boolean
}

// The editor. Reports every change as a whole zone list through onChange, so
// the screen's draft is the one source and the name fields beside the
// drawing edit the same list.
export function VenueLayoutEditor({
  kind,
  zones,
  size,
  label,
  onChange,
  onAnnounce,
}: {
  kind: LayoutKind
  zones: readonly LayoutZone[]
  size: LayoutSize
  label: string
  onChange: (zones: LayoutZone[]) => void
  // The last change in words, for the screen's live region.
  onAnnounce: (text: string) => void
}) {
  const height = pitchHeight(size)
  const svgRef = useRef<SVGSVGElement>(null)
  const gesture = useRef<Gesture | null>(null)

  // A pointer delta in fractions of the drawing, from the drawing's rendered
  // size. Null before the SVG has measured, so a stray move is ignored.
  function deltaFractions(e: ReactPointerEvent, g: Gesture): { dx: number; dy: number } | null {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0 || rect.height === 0) return null
    return { dx: (e.clientX - g.startX) / rect.width, dy: (e.clientY - g.startY) / rect.height }
  }

  function capture(e: ReactPointerEvent) {
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* no pointer capture available */
    }
  }
  function release(e: ReactPointerEvent) {
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* nothing captured to release */
    }
  }

  // A gesture applies its WHOLE delta to the zone as it was when the press
  // began, through the same pure moves the keyboard and the tests use, so
  // the edge rules live in one place (src/lib/venueLayout.ts).
  const apply = (g: Gesture, dx: number, dy: number): LayoutZone[] => {
    const fromOrigin = zones.map((z) => (z.n === g.n ? g.origin : z))
    return g.mode === 'move' ? moveZone(fromOrigin, g.n, dx, dy) : resizeZone(fromOrigin, g.n, dx, dy)
  }

  const onPointerDown = (zone: LayoutZone, mode: Gesture['mode']) => (e: ReactPointerEvent) => {
    // The handle sits inside the body, so a press on it must not also open
    // a move on the body underneath.
    e.stopPropagation()
    gesture.current = { n: zone.n, mode, startX: e.clientX, startY: e.clientY, origin: zone, dragging: false }
    capture(e)
  }

  const onPointerMove = (zone: LayoutZone) => (e: ReactPointerEvent) => {
    const g = gesture.current
    if (!g || g.n !== zone.n) return
    if (!g.dragging) {
      if (!isDrag(e.clientX - g.startX, e.clientY - g.startY)) return
      g.dragging = true
    }
    const d = deltaFractions(e, g)
    if (d) onChange(apply(g, d.dx, d.dy))
  }

  const onPointerUp = (zone: LayoutZone) => (e: ReactPointerEvent) => {
    const g = gesture.current
    if (!g || g.n !== zone.n) return
    gesture.current = null
    release(e)
    if (g.dragging) onAnnounce(describeZone(kind, zones.find((z) => z.n === zone.n) ?? zone))
  }

  const onPointerCancel = (zone: LayoutZone) => (e: ReactPointerEvent) => {
    if (gesture.current?.n === zone.n) gesture.current = null
    release(e)
  }

  // Arrows move; Shift and arrows resize. A bigger step with Alt, which
  // neither platform binds on an arrow.
  const onKeyDown = (zone: LayoutZone) => (e: ReactKeyboardEvent) => {
    const step = e.altKey ? BIG_NUDGE : NUDGE
    let dx = 0
    let dy = 0
    if (e.key === 'ArrowLeft') dx = -step
    else if (e.key === 'ArrowRight') dx = step
    else if (e.key === 'ArrowUp') dy = -step
    else if (e.key === 'ArrowDown') dy = step
    else return
    e.preventDefault()
    const next = e.shiftKey ? resizeZone(zones, zone.n, dx, dy) : moveZone(zones, zone.n, dx, dy)
    onChange(next)
    onAnnounce(describeZone(kind, next.find((z) => z.n === zone.n) ?? zone))
  }

  // The handle is inside the zone, so its events would reach the zone's own
  // handlers as well and apply the gesture twice. Every handle event stops
  // here before the shared handler runs.
  const onHandlePointerMove = (zone: LayoutZone) => (e: ReactPointerEvent) => {
    e.stopPropagation()
    onPointerMove(zone)(e)
  }
  const onHandlePointerUp = (zone: LayoutZone) => (e: ReactPointerEvent) => {
    e.stopPropagation()
    onPointerUp(zone)(e)
  }
  const onHandlePointerCancel = (zone: LayoutZone) => (e: ReactPointerEvent) => {
    e.stopPropagation()
    onPointerCancel(zone)(e)
  }

  return (
    <div className="venue-pitch venue-pitch-editing">
      <svg ref={svgRef} viewBox={`0 0 ${PITCH_VIEW_WIDTH} ${height}`} role="group" aria-label={label} className="venue-pitch-svg">
        <rect className="venue-pitch-ground" x={0} y={0} width={PITCH_VIEW_WIDTH} height={height} rx={14} />
        {zones.map((z) => (
          <g
            key={z.n}
            className="venue-zone venue-zone-editable"
            tabIndex={0}
            role="button"
            aria-label={`${describeZone(kind, z)}. Arrow keys move it, Shift and arrow keys resize it.`}
            onKeyDown={onKeyDown(z)}
            onPointerDown={onPointerDown(z, 'move')}
            onPointerMove={onPointerMove(z)}
            onPointerUp={onPointerUp(z)}
            onPointerCancel={onPointerCancel(z)}
          >
            <ZoneShape kind={kind} zone={z} width={PITCH_VIEW_WIDTH} height={height} editing />
            {/* The corner handle is a second press target inside the zone.
                It is not separately focusable: the keyboard resizes through
                the zone itself, so a second tab stop would be a second way to
                say one thing. */}
            <rect
              className="venue-zone-handle-hit"
              x={z.x * PITCH_VIEW_WIDTH + z.w * PITCH_VIEW_WIDTH - HANDLE}
              y={z.y * height + z.h * height - HANDLE}
              width={HANDLE}
              height={HANDLE}
              aria-hidden="true"
              onPointerDown={onPointerDown(z, 'resize')}
              onPointerMove={onHandlePointerMove(z)}
              onPointerUp={onHandlePointerUp(z)}
              onPointerCancel={onHandlePointerCancel(z)}
            />
          </g>
        ))}
      </svg>
    </div>
  )
}
