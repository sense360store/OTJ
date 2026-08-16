// Which diagram a session activity shows, decided once for every surface.
//
// DRILL-02. Drill Maker C1 put the diagram on the drill page and nowhere
// else, and built DrillDiagramView as the one renderer for exactly this
// moment ("C2 reuses this same component wherever a session shows its
// drills"). What C1 did NOT settle is the resolution: given an activity,
// which diagram, if any, belongs on screen. Planner, Session Day and Live
// each ask that question, and three answers is three chances to drift.
// This module is the one answer.
//
// A diagram is not a media item. The two live side by side on a drill and
// answer different questions: media is the resource (the FA's image, a
// clip, a PDF), the diagram is the plan somebody drew. Both are shown
// where both exist, so nothing here reads, replaces or ranks media; the
// media path on every surface is exactly what it was.
//
// THE TWO RULES THAT MUST NOT BE RESTATED ELSEWHERE.
//
//   1. An EMPTY diagram is no diagram. A drill row can hold a diagram with
//      no elements (a coach opened Drill Maker, saved, drew nothing) and a
//      stored value that will not parse reads as null one layer down, in
//      parseDrillDiagram. Rendering an empty pitch under every activity
//      would be worse than rendering nothing.
//
//   2. AN ENGLAND FOOTBALL DERIVED DRILL SHOWS NO HAND DRAWN DIAGRAM, even
//      when it is holding one. This is the club's licence rather than a
//      permission the club grants, so it binds every viewer including an
//      admin, and it binds every SURFACE, not just the drill page. The
//      state is reachable in production exactly as DrillDetail's own
//      comment records: a coach draws a diagram on their own drill, then
//      records an England Football source on it afterwards. The drill page
//      already refuses to render that diagram and offers to remove it.
//      Before this module, a session surface had no such rule, so the same
//      row that is suppressed on the drill page would have been drawn on
//      three others. CLAUDE.md, Third-party content: FA images are "used
//      unmodified, never recreated or redrawn".
//
// Provenance comes from deriveProvenance, the same function
// drillDiagramRights and the sharing control use, so "England Football
// derived" means one thing across the product. The rule is duplicated
// nowhere: drillDiagramRights answers who may DRAW, this answers what may
// be SHOWN, and both read the same provenance off the same source fields.
//
// Nothing here is a security boundary and this file does not pretend to be
// one. The public share projection refuses the `diagram` key outright, on
// both sides of the wire (src/lib/publicShare.ts and the read-content-share
// function), which is what actually keeps a diagram off a public page. This
// module governs the authenticated surfaces only.
import { deriveProvenance, type SourceFields } from './contentRights'
import { diagramIsEmpty, type DrillDiagram } from './drillDiagram'
import type { Activity, Drill } from './data'

// The source fields provenance is derived from, read off a drill in one
// place so a caller cannot assemble a different three.
export function drillSource(drill: Drill): SourceFields {
  return { sourceUrl: drill.sourceUrl, sourceLabel: drill.sourceLabel, sourceKey: drill.sourceKey }
}

// Whether this drill may show a hand drawn diagram at all. False for an
// England Football derived drill, whoever is looking. Deliberately not
// called "canEdit": drawing is drillDiagramRights' question and has an
// ownership half that has nothing to do with this one.
export function drillMayShowDiagram(drill: Drill): boolean {
  return deriveProvenance(drillSource(drill)) !== 'fa'
}

// The diagram one activity displays, or null. Null covers every reason at
// once, which is what the surfaces want: an activity with no drill id, a
// drill that has been deleted since the session was planned, a drill with
// no diagram, an empty diagram, an unparseable one, a read that has not
// answered yet, and a drill the licence forbids drawing. None of those is
// an error and none of them renders differently: the activity simply has
// no diagram, exactly as most activities do.
export function activityDiagram(
  activity: Activity,
  drillById: Readonly<Record<string, Drill>>,
  diagramByDrill: Readonly<Record<string, DrillDiagram | null>>,
): DrillDiagram | null {
  const drillId = activity.drillId
  if (!drillId) return null
  const drill = drillById[drillId]
  // A missing drill is a real state: a session keeps planning a drill that
  // was deleted afterwards. Without the drill there is no provenance to
  // check, and a diagram that cannot be checked is not shown.
  if (!drill) return null
  if (!drillMayShowDiagram(drill)) return null
  const diagram = diagramByDrill[drillId]
  if (!diagram || diagramIsEmpty(diagram)) return null
  return diagram
}

// The drill ids a list of activities references, deduped and in the order
// they first appear, which is what the batch diagram read is keyed on.
//
// It includes drills whose diagram will not be shown, because it cannot
// know: provenance is a fact about the drill, and the drill map may still
// be loading when the ids are needed. Reading a diagram for a drill that
// turns out to be England Football derived shows nobody anything; the
// suppression is at activityDiagram, which is the only place anything is
// rendered from. Filtering here instead would make the read depend on a
// second query having resolved first, which is how a surface ends up with
// no diagrams on a cold load and no way to explain why.
export function activityDrillIds(activities: readonly Activity[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const a of activities) {
    const id = a.drillId
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

// Whether any activity in this list has a diagram to show. Lets a surface
// decide whether a diagram affordance belongs on screen at all without
// each one writing its own loop over the same rule.
export function anyActivityDiagram(
  activities: readonly Activity[],
  drillById: Readonly<Record<string, Drill>>,
  diagramByDrill: Readonly<Record<string, DrillDiagram | null>>,
): boolean {
  return activities.some((a) => activityDiagram(a, drillById, diagramByDrill) !== null)
}
