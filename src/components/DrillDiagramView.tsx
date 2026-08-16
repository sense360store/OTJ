// The canonical drill diagram renderer.
//
// THIS IS THE ONE THAT DRAWS. The editor does not have a second implementation:
// it renders DiagramSurface and DiagramElementLayer from this file and adds an
// interaction layer on top. So a saved diagram looks the same on the drill page
// as it did while it was being drawn, and a change to how a cone looks changes
// both at once. C2 reuses this same component wherever a session shows its
// drills, which is why the seam exists in C1 rather than later.
//
// READ ONLY MEANS READ ONLY. This component renders no button, no handle, no
// selection ring and nothing focusable. The editor's chrome is in the editor.
//
// It carries no person. A diagram holds generic players; there is no name, no
// playerId and no roster lookup anywhere in this file, unlike the tactics board
// which deliberately resolves one (see tacticsBoard.ts).
import { useId, type CSSProperties } from 'react'
import {
  ARROW_LABEL,
  describeDiagram,
  diagramSwatch,
  type DiagramElement,
  type DiagramSurface,
  type DrillDiagram,
} from '../lib/drillDiagram'
import {
  arrowHeadPoints,
  arrowShaft,
  goalOutline,
  goalRect,
  pitchMarkings,
  surfaceAspect,
  surfaceSize,
  toView,
  viewBox,
  wavyPath,
  type Marking,
} from '../lib/drillDiagramGeometry'
import './DrillDiagram.css'

// White text sits on a dark bib, dark text on a light one. Contrast, not
// preference: a white "9" on a white bib is not a badge, it is a blank disc.
function inkOn(colour: string): string {
  return colour === 'white' || colour === 'yellow' ? '#18181b' : '#ffffff'
}

// ---- The surface --------------------------------------------------------

function Markings({ surface, clipId }: { surface: DiagramSurface; clipId: string }) {
  const marks = pitchMarkings(surface)
  if (marks.length === 0) return null
  const size = surfaceSize(surface)
  return (
    <>
      <defs>
        <clipPath id={clipId}>
          <rect x={0} y={0} width={size.width} height={size.height} />
        </clipPath>
      </defs>
      <g className="dd-lines">
        {marks.map((m, i) => (
          <Mark key={i} mark={m} clipId={clipId} />
        ))}
      </g>
    </>
  )
}

function Mark({ mark, clipId }: { mark: Marking; clipId: string }) {
  switch (mark.shape) {
    case 'rect':
      return <rect x={mark.x} y={mark.y} width={mark.w} height={mark.h} fill="none" />
    case 'line':
      return <line x1={mark.x1} y1={mark.y1} x2={mark.x2} y2={mark.y2} />
    case 'circle':
      // The half pitch centre circle is drawn whole and clipped to the pitch,
      // so it shows as the semicircle a half pitch actually has.
      return <circle cx={mark.cx} cy={mark.cy} r={mark.r} fill="none" clipPath={mark.clip ? `url(#${clipId})` : undefined} />
    case 'spot':
      return <circle cx={mark.cx} cy={mark.cy} r={mark.r} className="dd-spot" />
  }
}

// The grass and the lines, with no elements. Shared with the editor so the
// pitch under a drill is drawn once.
export function DiagramSurfaceBackdrop({ surface }: { surface: DiagramSurface }) {
  const clipId = useId()
  const size = surfaceSize(surface)
  return (
    <>
      {/* The grass is INSIDE the viewBox, so it paints the pitch and nothing
          beside it. That is what lets the editor's canvas box be transparent
          and fill the screen while the pitch keeps its own proportions. rx
          rounds it, since there is no longer a container clipping it there. */}
      <rect className="dd-grass" x={0} y={0} width={size.width} height={size.height} rx={16} />
      <Markings surface={surface} clipId={clipId} />
    </>
  )
}

// ---- The elements -------------------------------------------------------

function Player({ surface, el }: { surface: DiagramSurface; el: Extract<DiagramElement, { type: 'player' }> }) {
  const p = toView(surface, el.x, el.y)
  const fill = diagramSwatch(el.colour)
  return (
    <g data-el="player">
      <circle cx={p.x} cy={p.y} r={25} fill={fill} stroke="#ffffff" strokeWidth={3.5} />
      {el.label ? (
        <text x={p.x} y={p.y} className="dd-badge" fill={inkOn(el.colour)}>
          {el.label}
        </text>
      ) : null}
    </g>
  )
}

function Cone({ surface, el }: { surface: DiagramSurface; el: Extract<DiagramElement, { type: 'cone' }> }) {
  const p = toView(surface, el.x, el.y)
  const fill = diagramSwatch(el.colour)
  // A training cone: a squat triangle sitting on a base, so it reads as a cone
  // and not as a generic marker.
  return (
    <g data-el="cone">
      <ellipse cx={p.x} cy={p.y + 15} rx={19} ry={5} fill={fill} opacity={0.55} />
      <path d={`M ${p.x} ${p.y - 19} L ${p.x + 15} ${p.y + 15} L ${p.x - 15} ${p.y + 15} Z`} fill={fill} stroke="rgba(0,0,0,.28)" strokeWidth={1.5} />
      <path d={`M ${p.x - 8} ${p.y - 1} L ${p.x + 8} ${p.y - 1}`} stroke="rgba(255,255,255,.6)" strokeWidth={3} />
    </g>
  )
}

function Ball({ surface, el }: { surface: DiagramSurface; el: Extract<DiagramElement, { type: 'ball' }> }) {
  const p = toView(surface, el.x, el.y)
  const r = 14
  // A white sphere with the classic dark centre panel and three edge panels.
  const panel = (i: number) => {
    const a = (i * 2 * Math.PI) / 3 - Math.PI / 2
    return `${p.x + Math.cos(a) * r * 0.72} ${p.y + Math.sin(a) * r * 0.72}`
  }
  return (
    <g data-el="ball">
      <circle cx={p.x} cy={p.y} r={r} fill="#ffffff" stroke="#18181b" strokeWidth={2.4} />
      <polygon points={`${panel(0)} ${panel(1)} ${panel(2)}`} fill="#18181b" opacity={0.85} />
    </g>
  )
}

function Goal({ surface, el }: { surface: DiagramSurface; el: Extract<DiagramElement, { type: 'goal' }> }) {
  const g = goalRect(surface, el)
  const sideways = el.facing === 'left' || el.facing === 'right'
  // Net hatching, so the box reads as a goal rather than as another zone.
  const netLines = Array.from({ length: 4 }, (_, i) => {
    const t = (i + 1) / 5
    return sideways
      ? { x1: g.x, y1: g.y + g.h * t, x2: g.x + g.w, y2: g.y + g.h * t }
      : { x1: g.x + g.w * t, y1: g.y, x2: g.x + g.w * t, y2: g.y + g.h }
  })
  return (
    <g data-el="goal">
      {/* The frame is drawn OPEN on the side it faces, so all four directions
          look different. A closed rectangle made Up and Down the same picture. */}
      <rect x={g.x} y={g.y} width={g.w} height={g.h} fill="rgba(255,255,255,.16)" stroke="none" />
      <g className="dd-net">
        {netLines.map((l, i) => (
          <line key={i} {...l} />
        ))}
      </g>
      <path className="dd-goal-frame" d={goalOutline(surface, el)} fill="none" />
    </g>
  )
}

function Arrow({ surface, el }: { surface: DiagramSurface; el: Extract<DiagramElement, { type: 'arrow' }> }) {
  const a = toView(surface, el.x1, el.y1)
  const b = toView(surface, el.x2, el.y2)
  const shaft = arrowShaft(a.x, a.y, b.x, b.y)
  const head = arrowHeadPoints(a.x, a.y, b.x, b.y)
  const points = head.map((p) => `${p.x} ${p.y}`).join(' ')
  // The MEANING is in the line: a run is solid, a pass is dashed, a dribble is
  // a wave. Never colour alone, so the three stay apart in black and white and
  // for anyone who does not see colour. The accessible name says it in words.
  const dash = el.arrow === 'pass' ? '20 14' : undefined
  return (
    <g data-el="arrow">
      <title>{ARROW_LABEL[el.arrow]}</title>
      {el.arrow === 'dribble' ? (
        <path className="dd-wave" d={wavyPath(a.x, a.y, b.x, b.y)} fill="none" />
      ) : (
        <line className="dd-shaft" x1={shaft.x1} y1={shaft.y1} x2={shaft.x2} y2={shaft.y2} strokeDasharray={dash} />
      )}
      <polygon className="dd-arrowhead" points={points} />
    </g>
  )
}

function Zone({ surface, el }: { surface: DiagramSurface; el: Extract<DiagramElement, { type: 'zone' }> }) {
  const p = toView(surface, el.x, el.y)
  const size = surfaceSize(surface)
  const stroke = diagramSwatch(el.colour)
  return (
    <g data-el="zone">
      <rect
        x={p.x}
        y={p.y}
        width={Math.max(el.w, 0) * size.width}
        height={Math.max(el.h, 0) * size.height}
        fill={stroke}
        fillOpacity={0.2}
        stroke={stroke}
        strokeWidth={4}
        strokeDasharray="16 11"
        rx={8}
      />
    </g>
  )
}

function TextChip({ surface, el }: { surface: DiagramSurface; el: Extract<DiagramElement, { type: 'text' }> }) {
  const p = toView(surface, el.x, el.y)
  // Sized from the character count rather than measured: there is no DOM at
  // render time on the server and none at all under test, and a coaching label
  // is capped short enough that an approximation always fits.
  const w = Math.max(54, el.text.length * 15 + 26)
  const h = 40
  return (
    <g data-el="text">
      <rect x={p.x - w / 2} y={p.y - h / 2} width={w} height={h} rx={10} className="dd-chip" />
      <text x={p.x} y={p.y} className="dd-chip-text">
        {el.text}
      </text>
    </g>
  )
}

export function DiagramElementShape({ surface, el }: { surface: DiagramSurface; el: DiagramElement }) {
  switch (el.type) {
    case 'player':
      return <Player surface={surface} el={el} />
    case 'cone':
      return <Cone surface={surface} el={el} />
    case 'ball':
      return <Ball surface={surface} el={el} />
    case 'goal':
      return <Goal surface={surface} el={el} />
    case 'arrow':
      return <Arrow surface={surface} el={el} />
    case 'zone':
      return <Zone surface={surface} el={el} />
    case 'text':
      return <TextChip surface={surface} el={el} />
  }
}

// Every element in draw order. Shared with the editor, which wraps each shape
// in its own interaction group rather than drawing a second set.
export function DiagramElementLayer({ diagram }: { diagram: DrillDiagram }) {
  return (
    <>
      {diagram.elements.map((el) => (
        <DiagramElementShape key={el.id} surface={diagram.surface} el={el} />
      ))}
    </>
  )
}

// The read only diagram. The one renderer a drill page, and from C2 a session,
// uses.
export function DrillDiagramView({ diagram, className }: { diagram: DrillDiagram; className?: string }) {
  const size = surfaceSize(diagram.surface)
  return (
    <div
      className={'dd-surface' + (className ? ' ' + className : '')}
      style={
        {
          aspectRatio: surfaceAspect(diagram.surface),
          // The SAME ratio as a bare number, so a stylesheet can bound the box
          // in BOTH directions. A surface capped only in height keeps its full
          // column width while the pitch inside shrinks to the cap, which is the
          // "postage stamp with a toolbar" the editor canvas already fixed once
          // (see DrillDiagramEditor.css). A caller that caps height can now cap
          // width at the cap times this ratio, and the box then measures exactly
          // the drawing. Emitted here because the ratio has one source: the
          // surface geometry the aspect ratio itself comes from.
          '--dd-ratio': String(size.width / size.height),
        } as CSSProperties
      }
    >
      <svg className="dd-svg" viewBox={viewBox(diagram.surface)} role="img" aria-label={describeDiagram(diagram)}>
        <DiagramSurfaceBackdrop surface={diagram.surface} />
        <DiagramElementLayer diagram={diagram} />
      </svg>
    </div>
  )
}
