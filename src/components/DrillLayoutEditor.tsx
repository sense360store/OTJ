// The drill layout editor (ADR-0008, PR 10): a palette, tap to place,
// drag to move, tap to select, phases, undo and redo. All layout logic
// lives in src/lib/layoutEditor.ts as pure functions; this component is
// pointers and buttons over them, with the working copy and its history
// in React state only, never in browser storage. Works by touch and by
// mouse: the drag gesture follows the TacticsPitch pattern, where a
// press is a tap until it crosses the drag threshold.
import { useId, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { diagramScale } from '../lib/drillDiagram'
import {
  LAYOUT_ARROW_KINDS,
  LAYOUT_LABEL_MAX,
  LAYOUT_MAX_FRAMES,
  LAYOUT_NOTE_MAX,
  LAYOUT_TEAMS,
  LAYOUT_ZONE_LABEL_MAX,
  type DrillLayout,
  type LayoutArrowKind,
  type LayoutEntityKind,
  type LayoutPoint,
  type LayoutTeam,
} from '../lib/drillLayout'
import {
  addArrow,
  addEntity,
  addZone,
  commit,
  duplicatePhase,
  emptyLayout,
  historyOf,
  moveEntity,
  moveZone,
  redo,
  removeArrow,
  removeEntity,
  removePhase,
  removeZone,
  resizeZone,
  rotateEntity,
  setArea,
  setEntityLabel,
  setEntityTeam,
  setPhaseNote,
  setZoneLabel,
  undo,
  type EditorHistory,
} from '../lib/layoutEditor'
import { isDrag } from '../lib/tacticsBoard'
import { ArrowLine, EntityGlyph, ZoneRect } from './DrillDiagram'
import { Chip, Modal } from './ui'
import './DrillDiagram.css'

export type EditorTool = 'select' | LayoutEntityKind | 'zone' | LayoutArrowKind

export interface EditorSelection {
  type: 'entity' | 'zone' | 'arrow'
  id: string
}

const PIECE_TOOLS: { tool: LayoutEntityKind; label: string }[] = [
  { tool: 'cone', label: 'Cone' },
  { tool: 'marker', label: 'Flat marker' },
  { tool: 'goal', label: 'Goal' },
  { tool: 'mini_goal', label: 'Mini goal' },
  { tool: 'mannequin', label: 'Mannequin' },
  { tool: 'player', label: 'Player' },
  { tool: 'ball', label: 'Ball' },
]

const ARROW_TOOLS: { tool: LayoutArrowKind; label: string }[] = [
  { tool: 'pass', label: 'Pass' },
  { tool: 'run', label: 'Run' },
  { tool: 'dribble', label: 'Dribble' },
  { tool: 'shot', label: 'Shot' },
]

const TEAM_LABEL: Record<LayoutTeam, string> = { attack: 'Attack', defence: 'Defence', neutral: 'Neutral' }

// The interactive canvas: the same glyphs as the read only renderer, each
// wrapped in a group that takes the pointer. Exported for the static
// tests alongside the whole editor view.
export function EditorCanvas({
  layout,
  frame,
  selection,
  pendingFrom,
  onTapCanvas,
  onPiecePointerDown,
  onPiecePointerMove,
  onPiecePointerUp,
}: {
  layout: DrillLayout
  frame: number
  selection: EditorSelection | null
  pendingFrom: LayoutPoint | null
  onTapCanvas: (at: LayoutPoint) => void
  onPiecePointerDown: (sel: EditorSelection) => (e: ReactPointerEvent) => void
  onPiecePointerMove: (sel: EditorSelection) => (e: ReactPointerEvent) => void
  onPiecePointerUp: (sel: EditorSelection) => (e: ReactPointerEvent) => void
}) {
  const uid = useId()
  const headId = `dge-head-${uid}`
  const doubleHeadId = `dge-head2-${uid}`
  const svgRef = useRef<SVGSVGElement>(null)
  const k = diagramScale(layout.area)
  const w = layout.area.width * k
  const h = layout.area.length * k
  const pad = 24
  const f = layout.frames[frame]

  // Map a pointer event to metres on the area. Null before layout.
  const toMetres = (e: ReactPointerEvent): LayoutPoint | null => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return null
    const units = (e.clientX - rect.left) * ((w + pad * 2) / rect.width) - pad
    const unitsY = (e.clientY - rect.top) * ((h + pad * 2) / rect.height) - pad
    return { x: units / k, y: unitsY / k }
  }

  const isSelected = (type: EditorSelection['type'], id: string) =>
    selection !== null && selection.type === type && selection.id === id

  return (
    <svg
      ref={svgRef}
      className="drill-diagram-svg drill-editor-canvas"
      viewBox={`${-pad} ${-pad} ${w + pad * 2} ${h + pad * 2}`}
      role="application"
      aria-label="Layout editor canvas"
      onPointerDown={(e) => {
        // Only a press on the background itself places or clears; a press
        // that began on a piece is handled by the piece's own group.
        if ((e.target as Element).closest('.drill-editor-piece')) return
        const at = toMetres(e)
        if (at) onTapCanvas(at)
      }}
    >
      <defs>
        <marker id={headId} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path className="dg-arrow-head" d="M 0 0 L 10 5 L 0 10 Z" />
        </marker>
        <marker id={doubleHeadId} viewBox="0 0 16 10" refX="14" refY="5" markerWidth="11" markerHeight="7" orient="auto-start-reverse">
          <path className="dg-arrow-head" d="M 0 0 L 8 5 L 0 10 Z" />
          <path className="dg-arrow-head" d="M 6 0 L 16 5 L 6 10 Z" />
        </marker>
      </defs>
      <rect className="dg-area" x={0} y={0} width={w} height={h} />
      {f.zones.map((z) => (
        <g
          key={z.id}
          className={'drill-editor-piece' + (isSelected('zone', z.id) ? ' selected' : '')}
          onPointerDown={onPiecePointerDown({ type: 'zone', id: z.id })}
          onPointerMove={onPiecePointerMove({ type: 'zone', id: z.id })}
          onPointerUp={onPiecePointerUp({ type: 'zone', id: z.id })}
        >
          <ZoneRect z={z} k={k} />
        </g>
      ))}
      {f.arrows.map((a) => (
        <g
          key={a.id}
          className={'drill-editor-piece' + (isSelected('arrow', a.id) ? ' selected' : '')}
          onPointerDown={onPiecePointerDown({ type: 'arrow', id: a.id })}
          onPointerMove={onPiecePointerMove({ type: 'arrow', id: a.id })}
          onPointerUp={onPiecePointerUp({ type: 'arrow', id: a.id })}
        >
          <ArrowLine a={a} k={k} headId={headId} doubleHeadId={doubleHeadId} />
        </g>
      ))}
      {f.entities.map((e) => (
        <g
          key={e.id}
          className={'drill-editor-piece' + (isSelected('entity', e.id) ? ' selected' : '')}
          onPointerDown={onPiecePointerDown({ type: 'entity', id: e.id })}
          onPointerMove={onPiecePointerMove({ type: 'entity', id: e.id })}
          onPointerUp={onPiecePointerUp({ type: 'entity', id: e.id })}
        >
          <EntityGlyph e={e} k={k} />
        </g>
      ))}
      {pendingFrom && <circle className="drill-editor-pending" cx={pendingFrom.x * k} cy={pendingFrom.y * k} r={5} />}
    </svg>
  )
}

export function DrillLayoutEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial: DrillLayout | null
  onSave: (layout: DrillLayout) => void
  onCancel: () => void
}) {
  const [history, setHistory] = useState<EditorHistory>(() => historyOf(initial ?? emptyLayout()))
  const [frame, setFrame] = useState(0)
  const [tool, setTool] = useState<EditorTool>('select')
  const [team, setTeam] = useState<LayoutTeam>('attack')
  const [selection, setSelection] = useState<EditorSelection | null>(null)
  const [pendingFrom, setPendingFrom] = useState<LayoutPoint | null>(null)
  // The live gesture: the pre drag layout (so a whole drag commits as one
  // undo step), the piece's origin and the grab point in metres (so a
  // piece grabbed off centre keeps its grip instead of snapping to the
  // pointer).
  const gesture = useRef<{
    sel: EditorSelection
    startX: number
    startY: number
    dragging: boolean
    base: DrillLayout
    origin: LayoutPoint
    grab: LayoutPoint | null
    moved: DrillLayout | null
  } | null>(null)

  const layout = history.layout
  const activeFrame = Math.min(frame, layout.frames.length - 1)
  const apply = (next: DrillLayout | null) => {
    if (next) setHistory((h) => commit(h, next))
  }

  const tapCanvas = (at: LayoutPoint) => {
    if (tool === 'select') {
      setSelection(null)
      return
    }
    if (tool === 'zone') {
      apply(addZone(layout, activeFrame, at))
      return
    }
    if ((LAYOUT_ARROW_KINDS as readonly string[]).includes(tool)) {
      if (!pendingFrom) {
        setPendingFrom(at)
      } else {
        apply(addArrow(layout, activeFrame, tool as LayoutArrowKind, pendingFrom, at))
        setPendingFrom(null)
      }
      return
    }
    apply(addEntity(layout, tool as LayoutEntityKind, at, team))
  }

  // Map a pointer event to metres via the canvas svg it happened over.
  const eventMetres = (e: ReactPointerEvent): LayoutPoint | null => {
    const rect = (e.currentTarget as Element).closest('svg')?.getBoundingClientRect()
    if (!rect || rect.width === 0) return null
    const k = diagramScale(layout.area)
    const pad = 24
    const w = layout.area.width * k
    const h = layout.area.length * k
    return {
      x: ((e.clientX - rect.left) * ((w + pad * 2) / rect.width) - pad) / k,
      y: ((e.clientY - rect.top) * ((h + pad * 2) / rect.height) - pad) / k,
    }
  }

  // A press on a piece is a tap until it crosses the drag threshold; a
  // drag moves through the pure model against the pre drag layout, and
  // only the pointer lifting commits it, so one drag is one undo step.
  const piecePointerDown = (sel: EditorSelection) => (e: ReactPointerEvent) => {
    const f = layout.frames[activeFrame]
    const origin =
      sel.type === 'entity'
        ? f.entities.find((x) => x.id === sel.id)
        : sel.type === 'zone'
          ? f.zones.find((x) => x.id === sel.id)
          : null
    gesture.current = {
      sel,
      startX: e.clientX,
      startY: e.clientY,
      dragging: false,
      base: layout,
      origin: origin ? { x: origin.x, y: origin.y } : { x: 0, y: 0 },
      grab: eventMetres(e),
      moved: null,
    }
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* no pointer capture available */
    }
  }
  const piecePointerMove = (sel: EditorSelection) => (e: ReactPointerEvent) => {
    const g = gesture.current
    if (!g || g.sel.id !== sel.id || sel.type === 'arrow') return
    if (!g.dragging) {
      if (!isDrag(e.clientX - g.startX, e.clientY - g.startY)) return
      g.dragging = true
    }
    const at = eventMetres(e)
    if (!at || !g.grab) return
    // Keep the grip: the piece's origin follows the pointer's travel.
    const to = { x: g.origin.x + (at.x - g.grab.x), y: g.origin.y + (at.y - g.grab.y) }
    g.moved =
      sel.type === 'entity' ? moveEntity(g.base, activeFrame, sel.id, to) : moveZone(g.base, activeFrame, sel.id, to)
    setHistory((hist) => ({ ...hist, layout: g.moved! }))
  }
  const piecePointerUp = (sel: EditorSelection) => () => {
    const g = gesture.current
    if (!g || g.sel.id !== sel.id) return
    gesture.current = null
    if (g.dragging && g.moved) {
      // Commit the whole drag as one step against the pre drag layout.
      const { base, moved } = g
      setHistory((hist) => commit({ ...hist, layout: base }, moved))
      return
    }
    setSelection(g.sel)
    setTool('select')
  }

  const deleteSelected = () => {
    if (!selection) return
    if (selection.type === 'entity') apply(removeEntity(layout, selection.id))
    else if (selection.type === 'zone') apply(removeZone(layout, activeFrame, selection.id))
    else apply(removeArrow(layout, activeFrame, selection.id))
    setSelection(null)
  }

  const selectedEntity =
    selection?.type === 'entity' ? layout.frames[activeFrame].entities.find((e) => e.id === selection.id) : undefined
  const selectedZone =
    selection?.type === 'zone' ? layout.frames[activeFrame].zones.find((z) => z.id === selection.id) : undefined

  return (
    <div className="drill-editor">
      <div className="drill-editor-toolbar row wrap" style={{ gap: 6 }}>
        <Chip on={tool === 'select'} onClick={() => setTool('select')}>
          Select
        </Chip>
        {PIECE_TOOLS.map((t) => (
          <Chip key={t.tool} on={tool === t.tool} onClick={() => { setTool(t.tool); setPendingFrom(null) }}>
            {t.label}
          </Chip>
        ))}
        {ARROW_TOOLS.map((t) => (
          <Chip key={t.tool} on={tool === t.tool} onClick={() => { setTool(t.tool); setPendingFrom(null) }}>
            {t.label}
          </Chip>
        ))}
        <Chip on={tool === 'zone'} onClick={() => { setTool('zone'); setPendingFrom(null) }}>
          Zone
        </Chip>
      </div>
      {tool === 'player' && (
        <div className="row wrap" style={{ gap: 6, marginTop: 8 }}>
          {LAYOUT_TEAMS.map((t) => (
            <Chip key={t} on={team === t} onClick={() => setTeam(t)}>
              {TEAM_LABEL[t]}
            </Chip>
          ))}
        </div>
      )}
      {(LAYOUT_ARROW_KINDS as readonly string[]).includes(tool) && (
        <div className="muted" style={{ fontSize: 13, marginTop: 8 }}>
          {pendingFrom ? 'Tap where the arrow ends.' : 'Tap where the arrow starts.'}
        </div>
      )}

      <div style={{ marginTop: 10 }}>
        <EditorCanvas
          layout={layout}
          frame={activeFrame}
          selection={selection}
          pendingFrom={pendingFrom}
          onTapCanvas={tapCanvas}
          onPiecePointerDown={piecePointerDown}
          onPiecePointerMove={piecePointerMove}
          onPiecePointerUp={piecePointerUp}
        />
      </div>

      <div className="row wrap" style={{ gap: 6, marginTop: 10, alignItems: 'center' }}>
        {layout.frames.map((_, i) => (
          <Chip key={i} on={i === activeFrame} onClick={() => { setFrame(i); setSelection(null); setPendingFrom(null) }}>
            Phase {i + 1}
          </Chip>
        ))}
        <button
          className="btn btn-ghost btn-sm"
          disabled={layout.frames.length >= LAYOUT_MAX_FRAMES}
          onClick={() => {
            const next = duplicatePhase(layout, activeFrame)
            if (next) {
              apply(next)
              setFrame(activeFrame + 1)
            }
          }}
        >
          Duplicate phase
        </button>
        <button
          className="btn btn-ghost btn-sm"
          disabled={layout.frames.length <= 1}
          onClick={() => {
            const next = removePhase(layout, activeFrame)
            if (next) {
              apply(next)
              setFrame(Math.max(0, activeFrame - 1))
              setSelection(null)
            }
          }}
        >
          Remove phase
        </button>
        <span style={{ flex: 1 }} />
        <button className="btn btn-ghost btn-sm" disabled={history.past.length === 0} onClick={() => setHistory(undo)}>
          Undo
        </button>
        <button className="btn btn-ghost btn-sm" disabled={history.future.length === 0} onClick={() => setHistory(redo)}>
          Redo
        </button>
      </div>

      <div className="row wrap" style={{ gap: 10, marginTop: 10 }}>
        <div className="field" style={{ width: 120 }}>
          <label>Area width, m</label>
          <input
            type="number"
            value={layout.area.width}
            min={2}
            max={150}
            onChange={(e) => apply(setArea(layout, Number(e.target.value) || layout.area.width, layout.area.length))}
          />
        </div>
        <div className="field" style={{ width: 120 }}>
          <label>Area length, m</label>
          <input
            type="number"
            value={layout.area.length}
            min={2}
            max={150}
            onChange={(e) => apply(setArea(layout, layout.area.width, Number(e.target.value) || layout.area.length))}
          />
        </div>
        <div className="field" style={{ flex: 1, minWidth: 200 }}>
          <label>Phase note</label>
          <input
            type="text"
            maxLength={LAYOUT_NOTE_MAX}
            value={layout.frames[activeFrame].note ?? ''}
            placeholder="What happens in this phase"
            onChange={(e) => apply(setPhaseNote(layout, activeFrame, e.target.value))}
          />
        </div>
      </div>

      {selection && (
        <div className="drill-editor-inspector row wrap" style={{ gap: 10, marginTop: 10, alignItems: 'flex-end' }}>
          {selectedEntity && selectedEntity.kind === 'player' && (
            <>
              <div className="field" style={{ width: 90 }}>
                <label>Label</label>
                <input
                  type="text"
                  maxLength={LAYOUT_LABEL_MAX}
                  value={selectedEntity.label ?? ''}
                  onChange={(e) => apply(setEntityLabel(layout, selection.id, e.target.value))}
                />
              </div>
              <div className="field" style={{ width: 140 }}>
                <label>Team</label>
                <select
                  value={selectedEntity.team ?? 'attack'}
                  onChange={(e) => apply(setEntityTeam(layout, selection.id, e.target.value as LayoutTeam))}
                >
                  {LAYOUT_TEAMS.map((t) => (
                    <option key={t} value={t}>
                      {TEAM_LABEL[t]}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}
          {selectedEntity && (
            <button className="btn btn-ghost btn-sm" onClick={() => apply(rotateEntity(layout, activeFrame, selection.id))}>
              Rotate
            </button>
          )}
          {selectedZone && (
            <>
              <div className="field" style={{ width: 100 }}>
                <label>Zone width, m</label>
                <input
                  type="number"
                  value={selectedZone.width}
                  onChange={(e) =>
                    apply(resizeZone(layout, activeFrame, selection.id, Number(e.target.value) || selectedZone.width, selectedZone.height))
                  }
                />
              </div>
              <div className="field" style={{ width: 100 }}>
                <label>Zone height, m</label>
                <input
                  type="number"
                  value={selectedZone.height}
                  onChange={(e) =>
                    apply(resizeZone(layout, activeFrame, selection.id, selectedZone.width, Number(e.target.value) || selectedZone.height))
                  }
                />
              </div>
              <div className="field" style={{ width: 160 }}>
                <label>Zone label</label>
                <input
                  type="text"
                  maxLength={LAYOUT_ZONE_LABEL_MAX}
                  value={selectedZone.label ?? ''}
                  onChange={(e) => apply(setZoneLabel(layout, activeFrame, selection.id, e.target.value))}
                />
              </div>
            </>
          )}
          <button className="btn btn-ghost btn-sm" onClick={deleteSelected}>
            Delete selected
          </button>
        </div>
      )}

      <div className="row" style={{ gap: 10, marginTop: 14, justifyContent: 'flex-end' }}>
        <button className="btn btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn btn-primary" onClick={() => onSave(layout)}>
          Save diagram
        </button>
      </div>
    </div>
  )
}

// The modal the drill form opens. Saving hands the layout back to the
// form; the drill row write stays on the existing create and update
// path, so an authored drill's rights are owned exactly like any drill
// a coach creates.
export function DrillLayoutEditorModal({
  initial,
  onSave,
  onClose,
}: {
  initial: DrillLayout | null
  onSave: (layout: DrillLayout) => void
  onClose: () => void
}) {
  return (
    <Modal title={initial ? 'Edit diagram' : 'Add diagram'} sub="Tap a tool, then tap the area to place. Drag to move." onClose={onClose} wide>
      <DrillLayoutEditor
        initial={initial}
        onSave={(l) => {
          onSave(l)
          onClose()
        }}
        onCancel={onClose}
      />
    </Modal>
  )
}
