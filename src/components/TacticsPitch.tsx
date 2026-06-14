// The pitch and its draggable player discs, pulled out as a presentational
// component so the static renderer can cover the markings and the token layout
// without a DOM or pointer events. The SVG is drawn in a portrait 680 by 1050
// viewBox at sensible proportions; the container holds that aspect ratio and
// fills the available width, so the same board reads on a phone and a desktop.
//
// Dragging uses native pointer events, so one path serves mouse and touch.
// pointerdown captures the pointer to the disc, pointermove maps the pointer
// into a pitch fraction and reports it, pointerup releases. Positions live in
// the parent as fractions, which is why this component only reports moves and
// never holds a position of its own.
import { useRef } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { clampFraction, type Token } from '../lib/tacticsBoard'
import { PitchMarkings } from './TacticsBoardView'

// Keep a disc fully inside the touchlines while it is dragged.
const EDGE_MARGIN = 0.045

export function TacticsPitch({
  tokens,
  onMove,
  onLabel,
}: {
  tokens: Token[]
  onMove: (id: string, x: number, y: number) => void
  onLabel: (id: string, label: string) => void
}) {
  const pitchRef = useRef<HTMLDivElement>(null)
  const draggingId = useRef<string | null>(null)

  // Map a pointer position to a clamped pitch fraction. Returns null before the
  // pitch has measured, so a stray move is ignored rather than throwing.
  function toFraction(e: ReactPointerEvent): { x: number; y: number } | null {
    const rect = pitchRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0 || rect.height === 0) return null
    return {
      x: clampFraction((e.clientX - rect.left) / rect.width, EDGE_MARGIN),
      y: clampFraction((e.clientY - rect.top) / rect.height, EDGE_MARGIN),
    }
  }

  const onPointerDown = (id: string) => (e: ReactPointerEvent) => {
    draggingId.current = id
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (id: string) => (e: ReactPointerEvent) => {
    if (draggingId.current !== id) return
    const f = toFraction(e)
    if (f) onMove(id, f.x, f.y)
  }
  const endDrag = (id: string) => (e: ReactPointerEvent) => {
    if (draggingId.current !== id) return
    draggingId.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
  }

  return (
    <div className="board-pitch" ref={pitchRef}>
      <PitchMarkings />
      {tokens.map((t) => (
        <div key={t.id} className={`board-token side-${t.side}`} style={{ left: `${t.x * 100}%`, top: `${t.y * 100}%` }}>
          <button
            type="button"
            className="board-disc"
            onPointerDown={onPointerDown(t.id)}
            onPointerMove={onPointerMove(t.id)}
            onPointerUp={endDrag(t.id)}
            onPointerCancel={endDrag(t.id)}
            aria-label={`Drag player ${t.number}${t.label ? ` ${t.label}` : ''}`}
          >
            {t.number}
          </button>
          <input
            className="board-token-label"
            value={t.label}
            placeholder="label"
            title={t.label || undefined}
            onChange={(e) => onLabel(t.id, e.target.value)}
            aria-label={`Label for player ${t.number}`}
          />
        </div>
      ))}
    </div>
  )
}
