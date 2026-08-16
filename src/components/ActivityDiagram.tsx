// The saved Drill Maker diagram, wherever a SESSION shows the drill (DRILL-02).
//
// A coach draws a diagram once, on the drill. This is what puts that same
// drawing on the planner panel, on session day and on both live stages, so
// preparing and delivering a session never means navigating back to Drill
// Maker to remember what the exercise looked like.
//
// ONE STORED DIAGRAM, ONE PARSER, ONE RENDERER, AND NO SECOND COPY OF ANY OF
// THEM. The picture is drawn by DrillDiagramView, the canonical renderer, whose
// own header already anticipated this ("C2 reuses this same component wherever
// a session shows its drills"). The reading is parseDrillDiagram, reached only
// through useDrillDiagram. The rule about whether to show it is
// diagramForDisplay. This file adds no geometry, no SVG and no rule of its own;
// it is the seam that joins the three.
//
// IT IS A COMPONENT RATHER THAN A HOOK EACH SCREEN CALLS, for a structural
// reason rather than a stylistic one. The live watcher resolves its drill only
// after three conditional returns, so a top level useDrillDiagram there would
// break the rules of hooks. A self contained child is also this codebase's own
// pattern for exactly this (LiveMediaPeek in LiveSession.tsx), and it keeps the
// read lazy on the planner, where it fires only when a coach expands a panel.
//
// THE READ IS PER DRILL, ON PURPOSE. It shares the cache key ['drill_diagram',
// id] with the drill page, so a drill opened, planned and then delivered is
// fetched once and TanStack dedupes concurrent mounts of the same drill. A
// batched read over the session's drill ids would be a SECOND cache shape
// holding rows already cached under the first, which is the duplicated diagram
// state this work exists to avoid. DRILL_COLS is deliberately never widened to
// carry the column, so the library list, the planner's drill read and the share
// snapshot builders still cannot see a diagram.
//
// IT CARRIES NO PERSON. A diagram holds generic players; there is no name, no
// playerId and no register lookup here or in anything it renders. Tonight's
// actual children are not resolved onto a drill diagram, which is the tactics
// board's job and stays there.
//
// IT WRITES NOTHING. There is no mutation in this file and the query it uses is
// a read. Rendering a session, live or otherwise, stores nothing.
import type { ReactElement } from 'react'
import type { Drill } from '../lib/data'
import type { DrillDiagram } from '../lib/drillDiagram'
import { diagramForDisplay } from '../lib/drillDiagramRights'
import { useDrillDiagram } from '../lib/queries'
import { DrillDiagramView } from './DrillDiagramView'

// The presentational half: a diagram, or nothing at all. Pure, hook free and
// renderable without a query client, which is what lets the screen tests assert
// the markup without standing up a data layer.
//
// Nothing to show renders NOTHING, not an empty frame and not a placeholder.
// Most drills have no diagram, and a caption explaining its absence on every
// card would be worse than the silence.
export function ActivityDiagramView({
  diagram,
  className,
}: {
  diagram: DrillDiagram | null
  className?: string
}): ReactElement | null {
  if (!diagram) return null
  return <DrillDiagramView diagram={diagram} className={className} />
}

// The mounted half: reads this drill's diagram, applies the one display rule,
// and renders the presentational half. Read only in every sense.
export function ActivityDiagram({
  drill,
  className,
}: {
  drill: Drill
  className?: string
}): ReactElement | null {
  // A failed read resolves to undefined, which diagramForDisplay reads as
  // nothing to show. A drill whose diagram will not parse resolves to null for
  // the same reason (parseDrillDiagram returns null rather than throwing), so a
  // hand edited or future shaped row leaves the card exactly as it was instead
  // of taking the session screen down with it.
  const { data } = useDrillDiagram(drill.id)
  return <ActivityDiagramView diagram={diagramForDisplay(data, drill)} className={className} />
}
