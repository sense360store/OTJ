// The read only drill layout renderer (ADR-0008, PR 9): plain SVG, no
// canvas, no WebGL, print friendly. Coordinates are metres times
// diagramScale so the drawing is scale true to the declared area; glyphs
// keep a fixed unit size and read like map markers. Arrows use the
// standard coaching notation: solid for a pass, dashed for a run, wavy
// for a dribble, solid with a double head for a shot.
//
// Every frame renders into the DOM: on screen only the active phase is
// visible and the stepper switches which, while the print stylesheet
// shows them all in order and hides the stepper, so a printed drill page
// carries the whole movement. DrillDiagramFrame is presentational and
// exported for the static renderer tests.
import { useId, useState } from 'react'
import { arrowShaft, diagramScale, wavyPath } from '../lib/drillDiagram'
import type { DrillLayout, LayoutArrow, LayoutEntity, LayoutFrame, LayoutZone } from '../lib/drillLayout'
import { Chip } from './ui'
import './DrillDiagram.css'

// Glyph sizes in viewBox units.
const PLAYER_R = 13
const BALL_R = 6.5
const CONE_R = 9
const MARKER_RX = 9
const GOAL_W = 44
const GOAL_D = 14
const MINI_GOAL_W = 26
const MINI_GOAL_D = 10
const ARROW_HEAD = 10
const WAVE_AMPLITUDE = 5
const WAVE_LENGTH = 16

export function EntityGlyph({ e, k }: { e: LayoutEntity; k: number }) {
  const cx = e.x * k
  const cy = e.y * k
  // Rotation turns the glyph about its own centre; 0 faces up the area.
  const transform = e.rotation ? `rotate(${e.rotation} ${cx} ${cy})` : undefined
  switch (e.kind) {
    case 'cone':
      return (
        <path
          className="dg-cone"
          transform={transform}
          d={`M ${cx} ${cy - CONE_R} L ${cx - CONE_R * 0.9} ${cy + CONE_R * 0.75} L ${cx + CONE_R * 0.9} ${cy + CONE_R * 0.75} Z`}
        />
      )
    case 'marker':
      return <ellipse className="dg-marker" transform={transform} cx={cx} cy={cy} rx={MARKER_RX} ry={MARKER_RX * 0.45} />
    case 'goal':
    case 'mini_goal': {
      const w = e.kind === 'goal' ? GOAL_W : MINI_GOAL_W
      const d = e.kind === 'goal' ? GOAL_D : MINI_GOAL_D
      // Three closed sides, the mouth open toward the bottom (down the
      // area) at rotation 0: the back of the net faces the way the piece
      // faces.
      return (
        <path
          className={e.kind === 'goal' ? 'dg-goal' : 'dg-goal dg-mini-goal'}
          transform={transform}
          d={`M ${cx - w / 2} ${cy + d / 2} L ${cx - w / 2} ${cy - d / 2} L ${cx + w / 2} ${cy - d / 2} L ${cx + w / 2} ${cy + d / 2}`}
        />
      )
    }
    case 'mannequin':
      return (
        <g className="dg-mannequin" transform={transform}>
          <circle cx={cx} cy={cy - 8} r={4.5} />
          <path d={`M ${cx - 6} ${cy + 10} L ${cx} ${cy - 3} L ${cx + 6} ${cy + 10} Z`} />
        </g>
      )
    case 'player':
      return (
        <g className={`dg-player dg-team-${e.team ?? 'neutral'}`} transform={transform}>
          <circle cx={cx} cy={cy} r={PLAYER_R} />
          {e.label && (
            <text className="dg-player-label" x={cx} y={cy} textAnchor="middle" dominantBaseline="central">
              {e.label}
            </text>
          )}
        </g>
      )
    case 'ball':
      return (
        <g className="dg-ball" transform={transform}>
          <circle cx={cx} cy={cy} r={BALL_R} />
          <circle className="dg-ball-dot" cx={cx} cy={cy} r={BALL_R * 0.35} />
        </g>
      )
  }
}

export function ZoneRect({ z, k }: { z: LayoutZone; k: number }) {
  return (
    <g className="dg-zone">
      <rect x={z.x * k} y={z.y * k} width={z.width * k} height={z.height * k} />
      {z.label && (
        <text className="dg-zone-label" x={z.x * k + 7} y={z.y * k + 16}>
          {z.label}
        </text>
      )}
    </g>
  )
}

export function ArrowLine({ a, k, headId, doubleHeadId }: { a: LayoutArrow; k: number; headId: string; doubleHeadId: string }) {
  // A zero length arrow is legal in the model but has no direction to
  // draw: a lone head with arbitrary orientation would only mislead.
  if (a.from.x === a.to.x && a.from.y === a.to.y) return null
  const from = { x: a.from.x * k, y: a.from.y * k }
  const to = { x: a.to.x * k, y: a.to.y * k }
  const shaft = arrowShaft(from, to, ARROW_HEAD * 0.8)
  const marker = `url(#${a.kind === 'shot' ? doubleHeadId : headId})`
  if (a.kind === 'dribble') {
    return (
      <path
        className="dg-arrow dg-arrow-dribble"
        d={wavyPath(shaft.from, shaft.to, WAVE_AMPLITUDE, WAVE_LENGTH)}
        markerEnd={marker}
      />
    )
  }
  return (
    <line
      className={`dg-arrow dg-arrow-${a.kind}`}
      x1={shaft.from.x}
      y1={shaft.from.y}
      x2={shaft.to.x}
      y2={shaft.to.y}
      markerEnd={marker}
    />
  )
}

// One phase drawn in full. Zones sit lowest, arrows over them, pieces on
// top, the way a coach layers a whiteboard.
export function DrillDiagramFrame({
  layout,
  frame,
  index,
  active,
}: {
  layout: DrillLayout
  frame: LayoutFrame
  index: number
  active: boolean
}) {
  const uid = useId()
  const headId = `dg-head-${uid}`
  const doubleHeadId = `dg-head2-${uid}`
  const k = diagramScale(layout.area)
  const w = layout.area.width * k
  const h = layout.area.length * k
  // Padding covers the widest glyph half extent (a rotated full goal
  // reaches 22 units past its centre), so a piece on the touchline never
  // clips.
  const pad = 24
  return (
    <figure className={'drill-diagram-frame' + (active ? ' active' : '')}>
      <svg
        className="drill-diagram-svg"
        viewBox={`${-pad} ${-pad} ${w + pad * 2} ${h + pad * 2}`}
        role="img"
        aria-label={`Phase ${index + 1} diagram`}
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
        {frame.zones.map((z) => (
          <ZoneRect key={z.id} z={z} k={k} />
        ))}
        {frame.arrows.map((a) => (
          <ArrowLine key={a.id} a={a} k={k} headId={headId} doubleHeadId={doubleHeadId} />
        ))}
        {frame.entities.map((e) => (
          <EntityGlyph key={e.id} e={e} k={k} />
        ))}
      </svg>
      {frame.note && <figcaption className="drill-diagram-note">{frame.note}</figcaption>}
    </figure>
  )
}

export function DrillDiagram({ layout }: { layout: DrillLayout }) {
  const [phase, setPhase] = useState(0)
  // Clamped, not trusted: the detail screen swaps drills without a
  // remount, and a stale index past a shorter layout's last frame would
  // otherwise leave every frame inactive and the card blank.
  const active = Math.min(phase, layout.frames.length - 1)
  return (
    <div className="drill-diagram">
      {layout.frames.map((f, i) => (
        <DrillDiagramFrame key={i} layout={layout} frame={f} index={i} active={i === active} />
      ))}
      <div className="drill-diagram-foot">
        {layout.frames.length > 1 && (
          <div className="drill-diagram-stepper row wrap" style={{ gap: 8 }}>
            {layout.frames.map((_, i) => (
              <Chip key={i} on={i === active} onClick={() => setPhase(i)}>
                Phase {i + 1}
              </Chip>
            ))}
          </div>
        )}
        <span className="mono drill-diagram-area">
          {layout.area.width} × {layout.area.length} m
        </span>
      </div>
    </div>
  )
}
