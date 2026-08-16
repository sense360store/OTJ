// One activity's diagram, rendered the same way on every session surface.
//
// DrillDiagramView is the one that draws and this does not draw anything: it
// is the frame around it, so Planner, Session Day and Live agree on the label,
// the width and the spacing rather than each inventing them. What goes IN the
// frame is decided by activityDiagram in src/lib/activityDiagram.ts, which is
// the module that knows about empty diagrams and the England Football licence.
//
// Read only, like the view it wraps: no button, nothing focusable, nothing
// that writes. A coach who wants to change a diagram goes to the drill.
//
// Width is bounded rather than free. DrillDiagramView is width: 100% with an
// aspect ratio, so an unbounded parent gives a portrait pitch the full column
// height and pushes the plan off the screen. The cap is on the frame, and the
// frame never exceeds its column, which is what keeps a phone from scrolling
// sideways.
import { DrillDiagramView } from './DrillDiagramView'
import type { DrillDiagram } from '../lib/drillDiagram'
import './ActivityDiagram.css'

export function ActivityDiagram({
  diagram,
  // Session Day and Live already carry the drill title in their own heading,
  // so the label is the plain word there; the planner panel sits under a
  // media thumbnail and says which drill it belongs to.
  label = 'Diagram',
  size = 'panel',
}: {
  diagram: DrillDiagram
  label?: string
  // panel: the planner's expanded card and Session Day's row.
  // stage: Live, where it shares the screen with the timer and controls.
  size?: 'panel' | 'stage'
}) {
  return (
    <div className={'act-diagram act-diagram-' + size}>
      <div className="act-diagram-label">{label}</div>
      <DrillDiagramView diagram={diagram} />
    </div>
  )
}
