// Drill Maker: draw a coaching exercise on a pitch, pitch-side, on a phone.
//
// A FULL SCREEN ROUTE, not a modal. The canvas wants the whole screen and the
// Save button has to be reachable with the thumb that is holding the phone, so
// this route sits OUTSIDE the app shell (like the live session view) rather
// than inside it under the bottom navigation. Nothing sticky here can end up
// underneath the nav bar, because there is no nav bar.
//
// THE GEOMETRY IS NOT HERE. Every coordinate change goes through the pure
// reducer (src/lib/drillDiagramEditor.ts) and every conversion from a fraction
// to the screen goes through the shared geometry (src/lib/drillDiagramGeometry.ts),
// which the read only renderer uses too. What is left in this file is pointer
// plumbing: which element a finger is on, whether it has travelled far enough
// to be a drag, and where it is now. That split is what makes "a resize can
// never invert a zone" a test in a project with no DOM.
//
// NOTHING PERSISTS UNTIL SAVE. A drag produces a stream of reducer actions and
// not one network call. The coach presses Save, the write goes out, and the
// screen only says Saved once the database has handed back the same diagram it
// was sent. An edit made while that was in flight is kept and leaves the editor
// unsaved, which is the honest answer: the newer drawing is not stored yet.
import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { useAuth } from '../hooks/useAuth'
import { useDrill, useDrillDiagram, useMyCapabilities, useUpdateDrillDiagram } from '../lib/queries'
import {
  ARROW_KINDS,
  ARROW_LABEL,
  DIAGRAM_COLOURS,
  ELEMENT_LABEL,
  ELEMENT_TYPES,
  MAX_DIAGRAM_ELEMENTS,
  MAX_PLAYER_LABEL,
  MAX_TEXT_LENGTH,
  SURFACE_KINDS,
  SURFACE_LABEL,
  colourLabel,
  describeDiagram,
  diagramSignature,
  diagramSwatch,
  type ArrowKind,
  type DiagramColour,
  type DiagramElement,
  type DiagramElementType,
  type DiagramSurface,
  type DiagramSurfaceKind,
  type DrillDiagram,
  type GoalFacing,
} from '../lib/drillDiagram'
import {
  canAddElement,
  editorReducer,
  initEditor,
  isDirty,
  selectedElement,
  type DiagramAction,
  type DiagramEditorState,
} from '../lib/drillDiagramEditor'
import { diagramEditDecision } from '../lib/drillDiagramRights'
import { goalHitRect, goalRect, HIT_MIN, pointerFraction, surfaceAspect, toView, viewBox, zoneHitBand } from '../lib/drillDiagramGeometry'
import { DiagramSurfaceBackdrop, DiagramElementShape } from '../components/DrillDiagramView'
import { isDrag } from '../lib/tacticsBoard'
import { Icon } from '../components/icons'
import { Empty, ErrorNote, Loading, Modal } from '../components/ui'
import './DrillDiagramEditor.css'

// Touch targets, in viewBox units. HIT_MIN and the arithmetic behind it live in
// the shared geometry, because the goal and the zone need the same number and
// the reasoning is worth stating once. The short version: the canvas is bounded
// by its HEIGHT on a phone, so the pitch draws at roughly 0.38 of its viewBox,
// and a 56 unit radius is about 42 CSS pixels across. The hit areas are
// invisible and sit over the drawn shape, so the drawing keeps its proportions
// while the thumb gets something it can land on.
const HIT_R = HIT_MIN
const HANDLE_R = 30

export type SaveState = 'clean' | 'dirty' | 'saving' | 'error'

// ---- The interactive canvas ---------------------------------------------

type Grip = 'move' | 'arrowStart' | 'arrowEnd' | 'zoneStart' | 'zoneEnd'

// One element's accessible name. Never colour alone: the colour is said in
// words, and the arrow's meaning too.
function elementName(el: DiagramElement): string {
  switch (el.type) {
    case 'player':
      return `Player, ${colourLabel(el.colour)}${el.label ? `, ${el.label}` : ''}`
    case 'cone':
      return `Cone, ${colourLabel(el.colour)}`
    case 'zone':
      return `Zone, ${colourLabel(el.colour)}`
    case 'arrow':
      return `${ARROW_LABEL[el.arrow]} arrow`
    case 'goal':
      return 'Goal'
    case 'ball':
      return 'Ball'
    case 'text':
      return `Label, ${el.text}`
  }
}

function EditorCanvas({
  state,
  dispatch,
  armed,
  onPlace,
}: {
  state: DiagramEditorState
  dispatch: (a: DiagramAction) => void
  armed: DiagramElementType | null
  onPlace: () => void
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  // The live gesture: which element, which grip, where the press began and
  // whether it has become a drag. Held in a ref so a move never rerenders this
  // component for its own sake.
  const gesture = useRef<{ id: string; grip: Grip; startX: number; startY: number; dragging: boolean } | null>(null)
  const { surface } = state.diagram

  // Where the finger is, as a fraction of the pitch. The letterbox arithmetic
  // lives in the shared geometry, so the mapping cannot be broken by a CSS
  // change to the canvas box. See pointerFraction.
  const toFraction = useCallback(
    (e: ReactPointerEvent): { x: number; y: number } | null => {
      const rect = svgRef.current?.getBoundingClientRect()
      if (!rect) return null
      return pointerFraction(surface, rect, e.clientX, e.clientY)
    },
    [surface],
  )

  // Pointer capture keeps the move and the release on the shape even when the
  // finger leaves it. Wrapped because the static renderer and some environments
  // have none, where the calls throw.
  function capture(e: ReactPointerEvent) {
    try {
      ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    } catch {
      /* no pointer capture here */
    }
  }
  function release(e: ReactPointerEvent) {
    try {
      const el = e.currentTarget as Element
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
    } catch {
      /* nothing captured */
    }
  }

  const down = (id: string, grip: Grip) => (e: ReactPointerEvent) => {
    // A press on a shape is not yet a tap or a drag; movement or release
    // decides. Stopping propagation keeps the canvas from reading it as a tap
    // on empty space.
    e.stopPropagation()
    gesture.current = { id, grip, startX: e.clientX, startY: e.clientY, dragging: false }
    capture(e)
  }

  const move = (id: string) => (e: ReactPointerEvent) => {
    const g = gesture.current
    if (!g || g.id !== id) return
    if (!g.dragging) {
      // Below the threshold the press is still a candidate tap, so a slightly
      // imprecise tap still selects rather than nudging the element.
      if (!isDrag(e.clientX - g.startX, e.clientY - g.startY)) return
      g.dragging = true
    }
    const f = toFraction(e)
    if (!f) return
    switch (g.grip) {
      case 'move':
        dispatch({ op: 'move', id, x: f.x, y: f.y })
        break
      case 'arrowStart':
        dispatch({ op: 'moveArrowEnd', id, end: 'start', x: f.x, y: f.y })
        break
      case 'arrowEnd':
        dispatch({ op: 'moveArrowEnd', id, end: 'end', x: f.x, y: f.y })
        break
      case 'zoneStart':
        dispatch({ op: 'resizeZone', id, corner: 'start', x: f.x, y: f.y })
        break
      case 'zoneEnd':
        dispatch({ op: 'resizeZone', id, corner: 'end', x: f.x, y: f.y })
        break
    }
  }

  const up = (id: string) => (e: ReactPointerEvent) => {
    const g = gesture.current
    if (!g || g.id !== id) return
    const wasDrag = g.dragging
    gesture.current = null
    release(e)
    // A press that never travelled is a tap, which selects.
    if (!wasDrag) dispatch({ op: 'select', id })
  }

  const cancel = (id: string) => (e: ReactPointerEvent) => {
    if (gesture.current?.id === id) gesture.current = null
    release(e)
  }

  const keys = (id: string) => (e: ReactKeyboardEvent) => {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      dispatch({ op: 'delete', id })
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      dispatch({ op: 'select', id })
    }
  }

  // A press on the grass: place the armed tool there, or clear the selection
  // when no tool is armed. The check walks up from the target so a press that
  // began on a shape never reaches this.
  const onCanvasDown = (e: ReactPointerEvent) => {
    if ((e.target as Element).closest?.('[data-hit]')) return
    if (armed) {
      const f = toFraction(e)
      if (f) {
        dispatch({ op: 'add', element: armed, at: f })
        onPlace()
      }
      return
    }
    dispatch({ op: 'select', id: null })
  }

  return (
    <div className="dde-canvas-wrap">
      <div
        className={'dd-surface dde-canvas' + (armed ? ' armed' : '')}
        style={{ aspectRatio: surfaceAspect(surface) }}
      >
        <svg
          ref={svgRef}
          className="dd-svg"
          viewBox={viewBox(surface)}
          onPointerDown={onCanvasDown}
          aria-label={describeDiagram(state.diagram)}
        >
          <DiagramSurfaceBackdrop surface={surface} />
          {state.diagram.elements.map((el) => {
            const selected = el.id === state.selectedId
            return (
              <g key={el.id} className={selected ? 'dde-el dd-selected' : 'dde-el'}>
                <DiagramElementShape surface={surface} el={el} />
                {selected ? <SelectionRing surface={surface} el={el} /> : null}
                {/* The hit area: invisible, generous, and the thing that takes
                    the pointer. Drawn after the shape so it is on top, and
                    focusable so a keyboard reaches every element. */}
                <g
                  data-hit=""
                  role="button"
                  tabIndex={0}
                  aria-label={elementName(el)}
                  aria-pressed={selected}
                  className="dde-hit"
                  onPointerDown={down(el.id, 'move')}
                  onPointerMove={move(el.id)}
                  onPointerUp={up(el.id)}
                  onPointerCancel={cancel(el.id)}
                  onKeyDown={keys(el.id)}
                >
                  <HitArea surface={surface} el={el} />
                </g>
                {selected ? (
                  <Handles surface={surface} el={el} down={down} move={move} up={up} cancel={cancel} />
                ) : null}
              </g>
            )
          })}
        </svg>
      </div>
    </div>
  )
}

// The invisible pointer target for one element. An arrow takes a thick line so
// it can be grabbed anywhere along its length; everything else takes a circle
// or its own rectangle.
function HitArea({ surface, el }: { surface: DiagramSurface; el: DiagramElement }) {
  if (el.type === 'arrow') {
    const a = toView(surface, el.x1, el.y1)
    const b = toView(surface, el.x2, el.y2)
    return <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth={HIT_R} strokeLinecap="round" />
  }
  if (el.type === 'zone') {
    // The BORDER, not the fill. A filled target covered everything under it, so
    // with a tool armed a tap inside a zone placed nothing at all: a coach
    // could not put one cone inside the area they had just drawn. See
    // zoneHitBand.
    const b = zoneHitBand(surface, el)
    return (
      <rect x={b.x} y={b.y} width={b.w} height={b.h} fill="none" stroke="transparent" strokeWidth={b.strokeWidth} />
    )
  }
  if (el.type === 'goal') {
    // Grown to a thumb: the drawn goal is a strip about thirteen pixels deep.
    const g = goalHitRect(surface, el)
    return <rect x={g.x} y={g.y} width={g.w} height={g.h} fill="transparent" />
  }
  const p = toView(surface, el.x, el.y)
  return <circle cx={p.x} cy={p.y} r={HIT_R} fill="transparent" />
}

// The selection marker: a dashed ring around the element. A SHAPE change, not a
// colour change, so it reads on every element colour and for anyone who does
// not see colour. The selection is also announced through aria-pressed on the
// hit area and named in words on the controls below the canvas.
function SelectionRing({ surface, el }: { surface: DiagramSurface; el: DiagramElement }) {
  if (el.type === 'arrow') {
    const a = toView(surface, el.x1, el.y1)
    const b = toView(surface, el.x2, el.y2)
    return <line className="dde-ring" x1={a.x} y1={a.y} x2={b.x} y2={b.y} strokeWidth={22} strokeLinecap="round" />
  }
  if (el.type === 'zone') {
    const p = toView(surface, el.x, el.y)
    const q = toView(surface, el.x + el.w, el.y + el.h)
    return <rect className="dde-ring" x={p.x - 6} y={p.y - 6} width={q.x - p.x + 12} height={q.y - p.y + 12} rx={12} />
  }
  if (el.type === 'goal') {
    const g = goalRect(surface, el)
    return <rect className="dde-ring" x={g.x - 8} y={g.y - 8} width={g.w + 16} height={g.h + 16} rx={10} />
  }
  const p = toView(surface, el.x, el.y)
  return <circle className="dde-ring" cx={p.x} cy={p.y} r={el.type === 'text' ? 34 : 32} />
}

// The two drag handles a selected arrow or zone gets. Two large ones, not eight
// small ones: this is used with a thumb.
function Handles({
  surface,
  el,
  down,
  move,
  up,
  cancel,
}: {
  surface: DiagramSurface
  el: DiagramElement
  down: (id: string, grip: Grip) => (e: ReactPointerEvent) => void
  move: (id: string) => (e: ReactPointerEvent) => void
  up: (id: string) => (e: ReactPointerEvent) => void
  cancel: (id: string) => (e: ReactPointerEvent) => void
}) {
  const grips: { grip: Grip; x: number; y: number; label: string }[] = []
  if (el.type === 'arrow') {
    const a = toView(surface, el.x1, el.y1)
    const b = toView(surface, el.x2, el.y2)
    grips.push({ grip: 'arrowStart', x: a.x, y: a.y, label: 'Move the arrow start' })
    grips.push({ grip: 'arrowEnd', x: b.x, y: b.y, label: 'Move the arrow end' })
  } else if (el.type === 'zone') {
    const p = toView(surface, el.x, el.y)
    const q = toView(surface, el.x + el.w, el.y + el.h)
    grips.push({ grip: 'zoneStart', x: p.x, y: p.y, label: 'Resize the zone from the top left' })
    grips.push({ grip: 'zoneEnd', x: q.x, y: q.y, label: 'Resize the zone from the bottom right' })
  }
  return (
    <>
      {grips.map((g) => (
        <g
          key={g.grip}
          data-hit=""
          className="dde-handle"
          role="button"
          tabIndex={0}
          aria-label={g.label}
          onPointerDown={down(el.id, g.grip)}
          onPointerMove={move(el.id)}
          onPointerUp={up(el.id)}
          onPointerCancel={cancel(el.id)}
        >
          <circle cx={g.x} cy={g.y} r={HIT_R} fill="transparent" />
          <circle className="dde-handle-dot" cx={g.x} cy={g.y} r={HANDLE_R} />
        </g>
      ))}
    </>
  )
}

// ---- The screen ---------------------------------------------------------

const SAVE_TEXT: Record<SaveState, string> = {
  clean: 'Saved',
  dirty: 'Unsaved',
  saving: 'Saving…',
  error: 'Not saved',
}

const TOOL_ICON: Record<DiagramElementType, keyof typeof Icon> = {
  player: 'user',
  cone: 'cone',
  ball: 'target',
  goal: 'flag',
  arrow: 'arrowRight',
  zone: 'grid',
  text: 'note',
}

// The whole editor as a presentational component, so the static renderer can
// cover the top bar, the state wording, the tool palette and the selection
// controls without a DOM. The route below wires it to the data layer.
export function DiagramEditorView({
  title,
  state,
  dispatch,
  saveState,
  errorMessage,
  armed,
  onArm,
  onSave,
  onBack,
}: {
  title: string
  state: DiagramEditorState
  dispatch: (a: DiagramAction) => void
  saveState: SaveState
  errorMessage: string | null
  armed: DiagramElementType | null
  onArm: (t: DiagramElementType | null) => void
  onSave: () => void
  onBack: () => void
}) {
  const selected = selectedElement(state)
  const full = !canAddElement(state)
  const saving = saveState === 'saving'
  return (
    <div className="dde">
      <div className="dde-top">
        <button className="btn btn-quiet btn-sm" onClick={onBack} aria-label="Back to the drill">
          <Icon.chevL />
          Back
        </button>
        <div className="dde-title">
          <span className="dde-title-main">{title}</span>
          {/* The saved state in words, with a live region so a change is
              announced rather than only shown. Never a colour on its own. */}
          <span className={'dde-state ' + saveState} role="status">
            {SAVE_TEXT[saveState]}
          </span>
        </div>
        <button className="btn btn-primary btn-sm" onClick={onSave} disabled={saving || saveState === 'clean'}>
          <Icon.check />
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      {errorMessage && (
        <div className="dde-error" role="alert">
          {errorMessage}
        </div>
      )}

      <EditorCanvas state={state} dispatch={dispatch} armed={armed} onPlace={() => onArm(null)} />

      {/* ONE bar, always present. It used to be a hint line plus a selection
          bar that appeared only when something was selected, and the selection
          bar took its height straight out of the canvas: every tap resized and
          re-centred the pitch under the coach's finger. Now the bar is always
          there and holds either the instruction or the controls. */}
      <div className="dde-selbar">
        {selected ? (
          <SelectionControls el={selected} dispatch={dispatch} />
        ) : (
          <span className="dde-hint" role="status">
            {armed ? `Tap the pitch to place a ${ELEMENT_LABEL[armed].toLowerCase()}.` : 'Pick a tool, then tap the pitch.'}
          </span>
        )}
      </div>

      <div className="dde-tools">
        <div className="dde-tool-row" role="group" aria-label="Add to the diagram">
          {ELEMENT_TYPES.map((t) => {
            const Ico = Icon[TOOL_ICON[t]]
            return (
              <button
                key={t}
                type="button"
                className={'dde-tool' + (armed === t ? ' armed' : '')}
                aria-pressed={armed === t}
                disabled={full}
                onClick={() => onArm(armed === t ? null : t)}
              >
                <Ico />
                <span>{ELEMENT_LABEL[t]}</span>
              </button>
            )
          })}
        </div>
        <div className="dde-surface-row">
          <label className="dde-surface-label" htmlFor="dde-surface">
            Pitch
          </label>
          <select
            id="dde-surface"
            className="select"
            value={state.diagram.surface.kind}
            onChange={(e) => dispatch({ op: 'setSurface', surface: e.target.value as DiagramSurfaceKind })}
          >
            {SURFACE_KINDS.map((k) => (
              <option key={k} value={k}>
                {SURFACE_LABEL[k]}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            aria-label={
              state.diagram.surface.orientation === 'portrait'
                ? 'Turn the pitch so the play runs across the screen'
                : 'Turn the pitch so the play runs up the screen'
            }
            onClick={() =>
              dispatch({
                op: 'setOrientation',
                orientation: state.diagram.surface.orientation === 'portrait' ? 'landscape' : 'portrait',
              })
            }
          >
            <Icon.rotate />
            Turn the pitch
          </button>
          <span className="dde-count">
            {state.diagram.elements.length} of {MAX_DIAGRAM_ELEMENTS}
          </span>
        </div>
        {full && (
          <div className="dde-full" role="status">
            This diagram is full. Remove something to add more.
          </div>
        )}
      </div>
    </div>
  )
}

// The controls for whatever is selected: only the ones that element actually
// has, plus Delete. Kept out of the canvas so nothing floats over the drawing
// under a thumb.
function SelectionControls({ el, dispatch }: { el: DiagramElement; dispatch: (a: DiagramAction) => void }) {
  const hasColour = el.type === 'player' || el.type === 'cone' || el.type === 'zone'
  return (
    <>
      <span className="dde-sel-name" role="status">
        {elementName(el)} selected
      </span>

      {hasColour && (
        <div className="dde-swatches" role="group" aria-label="Colour">
          {DIAGRAM_COLOURS.map((c) => (
            <button
              key={c}
              type="button"
              className={'dde-swatch' + (el.colour === c ? ' on' : '')}
              style={{ background: diagramSwatch(c) }}
              aria-label={colourLabel(c)}
              aria-pressed={el.colour === c}
              onClick={() => dispatch({ op: 'setColour', id: el.id, colour: c as DiagramColour })}
            />
          ))}
        </div>
      )}

      {el.type === 'arrow' && (
        <div className="dde-chips" role="group" aria-label="Arrow">
          {ARROW_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              className={'dde-chip' + (el.arrow === k ? ' on' : '')}
              aria-pressed={el.arrow === k}
              onClick={() => dispatch({ op: 'setArrowKind', id: el.id, arrow: k as ArrowKind })}
            >
              {ARROW_LABEL[k]}
            </button>
          ))}
        </div>
      )}

      {el.type === 'goal' && (
        <div className="dde-chips" role="group" aria-label="Goal faces">
          {(['up', 'down', 'left', 'right'] as const).map((f) => (
            <button
              key={f}
              type="button"
              className={'dde-chip' + (el.facing === f ? ' on' : '')}
              aria-pressed={el.facing === f}
              onClick={() => dispatch({ op: 'setGoalFacing', id: el.id, facing: f as GoalFacing })}
            >
              {f[0].toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      )}

      {(el.type === 'text' || el.type === 'player') && (
        <label className="dde-label-field">
          <span>{el.type === 'text' ? 'Label' : 'Number'}</span>
          <input
            className="input"
            value={el.type === 'text' ? el.text : el.label}
            maxLength={el.type === 'text' ? MAX_TEXT_LENGTH : MAX_PLAYER_LABEL}
            onChange={(e) => dispatch({ op: 'setLabel', id: el.id, text: e.target.value })}
          />
        </label>
      )}

      <button
        type="button"
        className="btn btn-ghost btn-sm dde-delete"
        onClick={() => dispatch({ op: 'delete', id: el.id })}
      >
        <Icon.trash />
        Delete
      </button>
    </>
  )
}

// ---- The route ----------------------------------------------------------

// Mounted once the stored diagram has arrived, so the reducer's initial state
// is the real diagram and the editor opens clean rather than briefly claiming
// unsaved changes it does not have.
function EditorBody({ drillId, title, initial }: { drillId: string; title: string; initial: DrillDiagram | null }) {
  const navigate = useNavigate()
  const [state, dispatch] = useReducer(editorReducer, initial, initEditor)
  const [armed, setArmed] = useState<DiagramElementType | null>(null)
  const [errorMessage, setError] = useState<string | null>(null)
  const [leaving, setLeaving] = useState(false)
  const save = useUpdateDrillDiagram()
  const dirty = isDirty(state)

  // A stale error never outlives the change it was about: if the coach undoes
  // their way back to what is stored, the editor is clean and says so.
  const saveState: SaveState = save.isPending ? 'saving' : !dirty ? 'clean' : errorMessage ? 'error' : 'dirty'

  // The browser's own warning for a tab close or a reload, which react-router
  // never sees. The in-app Back route asks in the app's own words below.
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  function onSave() {
    // The diagram AS IT IS NOW is what goes out and what the readback is
    // compared against. A later edit is not part of this save and correctly
    // leaves the editor unsaved.
    const submitted = state.diagram
    const signature = diagramSignature(submitted)
    setError(null)
    save.mutate(
      { id: drillId, diagram: submitted },
      {
        onSuccess: (result) => {
          if (!result.matched) {
            // The request returned, but not with the diagram that was sent. The
            // work stays on screen and unsaved rather than being claimed.
            setError('The diagram that came back was not the one that was sent. Nothing has been lost; try Save again.')
            return
          }
          dispatch({ op: 'saved', signature })
        },
        onError: (e) => setError(e.message || 'Could not save the diagram. Your drawing is still here; try again.'),
      },
    )
  }

  const back = () => navigate(`/drill/${drillId}`)

  return (
    <>
      <DiagramEditorView
        title={title}
        state={state}
        dispatch={dispatch}
        saveState={saveState}
        errorMessage={dirty ? errorMessage : null}
        armed={armed}
        onArm={setArmed}
        onSave={onSave}
        onBack={() => (dirty ? setLeaving(true) : back())}
      />
      {leaving && (
        <Modal
          title="Leave without saving?"
          sub={title}
          onClose={() => setLeaving(false)}
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => setLeaving(false)}>
                Keep editing
              </button>
              <button className="btn btn-primary" onClick={back}>
                Leave
              </button>
            </>
          }
        >
          <p style={{ fontSize: 14.5, lineHeight: 1.55 }}>
            This diagram has changes that are not saved. Leaving now loses them.
          </p>
        </Modal>
      )}
    </>
  )
}

// The full screen frame the editor's own states share: a top bar with a way
// back, and whatever the state has to say. Without it a loading or refused
// state would render bare, because this route deliberately has no app shell
// behind it.
function Frame({ title, onBack, children }: { title: string; onBack: () => void; children: ReactNode }) {
  return (
    <div className="dde">
      <div className="dde-top">
        <button className="btn btn-quiet btn-sm" onClick={onBack}>
          <Icon.chevL />
          Back
        </button>
        <div className="dde-title">
          <span className="dde-title-main">{title}</span>
        </div>
      </div>
      <div className="dde-refused">{children}</div>
    </div>
  )
}

export function DrillDiagramEditor() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { caps } = useMyCapabilities()
  const { data: drill, isLoading, isError } = useDrill(id)
  // `diagram` stays undefined only while the read has never succeeded; a null
  // means the drill genuinely has no diagram. The two are told apart below.
  const { data: diagram, isLoading: diagramLoading, isError: diagramError } = useDrillDiagram(id)

  // This route owns the whole screen, so its loading, error and not found
  // states need the same frame: rendered bare they would sit on an unstyled
  // page with no way back, because there is no app shell behind them.
  // THESE GUARDS TEST FOR MISSING DATA, NEVER FOR A QUERY ERROR ON ITS OWN, and
  // that distinction is a data loss bug rather than a nicety. Both reads keep
  // refetching in the background (the query client sets no staleTime, so a
  // window focus refetches), and both hold their last good data through a
  // failed refetch. Returning an error screen on `isError` would therefore
  // unmount EditorBody, whose reducer holds the entire unsaved drawing, the
  // moment a coach pitch-side lost signal and came back to the app. The
  // diagram would be gone and the fresh editor would open clean, saying Saved.
  // So an error only shows while there is nothing to show instead.
  // Back goes to a KNOWN place, never history.go(-1): this route is deep
  // linkable, and on a cold tab there is nothing behind it, so -1 leaves a full
  // screen page whose only control does nothing.
  const backToDrill = () => navigate(id ? `/drill/${id}` : '/library')
  if (isLoading || diagramLoading) return <Frame title="Drill Maker" onBack={backToDrill}><Loading /></Frame>
  if (!drill)
    return (
      <Frame title="Drill Maker" onBack={() => navigate('/library')}>
        {isError ? <ErrorNote /> : <Empty icon={Icon.grid} title="Drill not found">It may have been removed.</Empty>}
      </Frame>
    )
  // A diagram read that has never succeeded is different: opening an editor on
  // "no diagram" when the drill may in fact have one would let a save wipe it.
  if (diagramError && diagram === undefined)
    return (
      <Frame title={drill.title} onBack={backToDrill}>
        <ErrorNote />
      </Frame>
    )

  // The same ownership rule that shows Edit drill on the drill page, and the
  // same England Football limit the drill page states. Restated nowhere: both
  // come from diagramEditDecision.
  const canManage =
    caps.has('drills.manage') || (caps.has('drills.create') && !!drill.createdBy && drill.createdBy === user?.id)
  const decision = diagramEditDecision({
    canManage,
    source: { sourceUrl: drill.sourceUrl, sourceLabel: drill.sourceLabel, sourceKey: drill.sourceKey },
  })
  if (!decision.canEdit) {
    // Refused, with the REASON rather than a bare denial. Somebody who followed
    // this URL from a bookmark, or typed it, deserves to know whether the
    // answer is "not yours" or "the club may not redraw England Football
    // content", because only one of those has anything they can do about it.
    return (
      <Frame title={drill.title} onBack={() => navigate(`/drill/${drill.id}`)}>
        <Empty icon={Icon.lock} title="This drill's diagram cannot be changed">
          {decision.reason ?? ''}
        </Empty>
      </Frame>
    )
  }

  return <EditorBody drillId={drill.id} title={drill.title} initial={diagram ?? null} />
}
