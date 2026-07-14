// The pitch and its player discs, pulled out as a presentational component so
// the static renderer can cover the markings and the token layout without a DOM
// or pointer events. The SVG is drawn in a portrait 680 by 1050 viewBox at
// sensible proportions; the container holds that aspect ratio and fills the
// available width, so the same board reads on a phone and a desktop.
//
// One pointer press on a disc does double duty: a tap selects the token, a press
// and drag moves it. pointerdown opens a gesture and captures the pointer to the
// disc, pointermove starts dragging once the pointer crosses a small threshold
// (so a slightly imprecise tap still selects), pointerup selects when no drag
// happened. A press on the pitch background clears the selection. Positions live
// in the parent as fractions, which is why this component only reports moves and
// holds no position of its own; selection lives in the parent too, so the Remove
// selected button beside the pitch acts on the same choice.
import { useRef } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import {
  clampFraction,
  isDrag,
  tokenDisplayName,
  tokenFirstName,
  type PlayerNameMap,
  type Token,
} from '../lib/tacticsBoard'
import { PitchMarkings } from './TacticsBoardView'

// Keep a disc fully inside the touchlines while it is dragged.
const EDGE_MARGIN = 0.045

export function TacticsPitch({
  tokens,
  names,
  selectedId,
  onMove,
  onSelect,
  onDelete,
}: {
  tokens: Token[]
  // Resolves a token's playerId to a display name (see tacticsBoard.ts). The
  // editable pitch only renders for sessions.create holders, whose players
  // query supplies the map; a token whose player is gone shows its number.
  names?: PlayerNameMap
  selectedId: string | null
  onMove: (id: string, x: number, y: number) => void
  onSelect: (id: string | null) => void
  onDelete: (id: string) => void
}) {
  const pitchRef = useRef<HTMLDivElement>(null)
  // The active pointer gesture on a token: which token, where the press began,
  // and whether it has crossed the drag threshold yet. Held in a ref so a move
  // never rerenders; null between gestures.
  const gesture = useRef<{ id: string; startX: number; startY: number; dragging: boolean } | null>(null)

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

  // Pointer capture so the move and up land on the disc even if the finger
  // leaves it. Wrapped because some environments (and the test renderer) have
  // no pointer capture, where the calls would throw.
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

  const onPointerDown = (id: string) => (e: ReactPointerEvent) => {
    // Open a gesture. It is not yet a drag or a tap; movement or release decides.
    gesture.current = { id, startX: e.clientX, startY: e.clientY, dragging: false }
    capture(e)
  }

  const onPointerMove = (id: string) => (e: ReactPointerEvent) => {
    const g = gesture.current
    if (!g || g.id !== id) return
    // Below the threshold the press is still a candidate tap; once it crosses,
    // the gesture becomes a drag for the rest of its life.
    if (!g.dragging) {
      if (!isDrag(e.clientX - g.startX, e.clientY - g.startY)) return
      g.dragging = true
    }
    const f = toFraction(e)
    if (f) onMove(id, f.x, f.y)
  }

  const onPointerUp = (id: string) => (e: ReactPointerEvent) => {
    const g = gesture.current
    if (!g || g.id !== id) return
    const wasDrag = g.dragging
    gesture.current = null
    release(e)
    // A press that never became a drag is a tap: select this token.
    if (!wasDrag) onSelect(id)
  }

  const onPointerCancel = (id: string) => (e: ReactPointerEvent) => {
    if (gesture.current?.id === id) gesture.current = null
    release(e)
  }

  // Delete or Backspace on a focused disc removes that token, the keyboard twin
  // of the Remove selected button.
  const onKeyDown = (id: string) => (e: ReactKeyboardEvent) => {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      onDelete(id)
    }
  }

  // A press on the pitch background, anywhere outside a token, clears the
  // selection. The check walks up from the event target, so a press that began
  // on a disc or its label never deselects.
  const onPitchPointerDown = (e: ReactPointerEvent) => {
    if (!(e.target as Element).closest('.board-token')) onSelect(null)
  }

  return (
    <div className="board-pitch" ref={pitchRef} onPointerDown={onPitchPointerDown}>
      <PitchMarkings />
      {tokens.map((t) => {
        const selected = t.id === selectedId
        const name = tokenDisplayName(t, names)
        return (
          <div key={t.id} className={`board-token side-${t.side}`} style={{ left: `${t.x * 100}%`, top: `${t.y * 100}%` }}>
            <button
              type="button"
              className={'board-disc' + (selected ? ' selected' : '')}
              aria-pressed={selected}
              aria-label={`Player ${t.number}${name ? ` ${name}` : ''}`}
              title={selected ? 'Selected. Press Delete to remove, or drag to move.' : 'Tap to select, drag to move.'}
              onPointerDown={onPointerDown(t.id)}
              onPointerMove={onPointerMove(t.id)}
              onPointerUp={onPointerUp(t.id)}
              onPointerCancel={onPointerCancel(t.id)}
              onKeyDown={onKeyDown(t.id)}
            >
              {t.number}
            </button>
            {name ? (
              <span className="board-token-label board-token-label-static" title={name}>
                {tokenFirstName(name)}
              </span>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
