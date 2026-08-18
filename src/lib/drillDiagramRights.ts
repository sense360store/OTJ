// Who may draw a drill's diagram, and the one case where nobody may.
//
// TWO RULES, FROM TWO DIFFERENT PLACES.
//
// 1. OWNERSHIP is the existing drill rule, unchanged and restated nowhere new:
//    drills.manage on any drill, or drills.create on your own. That is the same
//    condition that already shows Edit drill on the drill page, and the drills
//    UPDATE policy is the enforcement. The diagram is an ordinary column on
//    drills, so it needs no new capability and gets none.
//
// 2. ENGLAND FOOTBALL DERIVED DRILLS GET NO HAND DRAWN DIAGRAM AT ALL. This is
//    the rule worth explaining, because it is stricter than migration 0043 and
//    deliberately so.
//
//    0043 locks an England Football derived row at club only and says in its own
//    header that such a row "may be edited, used, planned from and shared inside
//    the club exactly as before". So the FA lock is a RIGHTS lock, not an edit
//    lock, and reading it alone would allow a diagram here.
//
//    The club's permission to use England Football content is narrower than
//    that. CLAUDE.md, Third-party content: FA images are "used unmodified, never
//    recreated or redrawn", and "Where an FA-derived drill needs a diagram, the
//    FA's own image is used, not a recreation." Drawing this drill on a pitch
//    board is exactly the recreation those terms exclude, and it is the one
//    thing Drill Maker does. So the affordance is absent on an England Football
//    derived drill, and the reason is shown in its place.
//
//    This is a CLIENT rule, and it is honest about being one: the database
//    cannot see the difference between a diagram a coach drew and one that came
//    with the drill, so there is nothing here for a check constraint or a policy
//    to enforce. It costs the club nothing (the FA's own diagram is already
//    attached as media) and it keeps the licence terms intact. If the club ever
//    obtains wider permission, this is the one function to change.
//
// Provenance is derived from the row's own recorded source columns, through the
// same deriveProvenance the sharing control uses (src/lib/contentRights.ts), so
// the two agree about what "England Football derived" means.

import { deriveProvenance, type SourceFields } from './contentRights'
import { diagramIsEmpty, type DrillDiagram } from './drillDiagram'

export const FA_DIAGRAM_NOTE =
  'This drill came from England Football Learning. The club may use their diagrams as they are, and may not redraw them, so this drill keeps its England Football diagram rather than a hand drawn one.'

export const NOT_YOURS_NOTE =
  'Only the person who created this drill, or a manager, can change its diagram.'

export interface DiagramEditDecision {
  // Whether the Build or Edit diagram affordance is offered, and whether the
  // editor route will open.
  canEdit: boolean
  // Why not, in the club's words, or null when there is nothing to explain.
  reason: string | null
}

export function diagramEditDecision({
  canManage,
  source,
}: {
  // The caller's EXISTING ownership decision, the same one that shows Edit
  // drill. Never recomputed here.
  canManage: boolean
  source: SourceFields
}): DiagramEditDecision {
  // Provenance is checked first: an England Football derived drill gets no hand
  // drawn diagram whoever is asking, an admin included, because the limit is
  // the club's licence rather than a permission the club grants.
  if (deriveProvenance(source) === 'fa') return { canEdit: false, reason: FA_DIAGRAM_NOTE }
  if (!canManage) return { canEdit: false, reason: NOT_YOURS_NOTE }
  return { canEdit: true, reason: null }
}

// The read only twin of diagramEditDecision, and the ONE rule for whether a
// saved diagram is SHOWN. diagramEditDecision answers "may this be drawn"; this
// answers "may this be shown", which is a different question with the same
// England Football answer.
//
// Every surface that shows a drill inside a session goes through this: the
// planner panel, session day and both live stages. There is deliberately no
// plannerDiagramFor…, sessionDayDiagramFor… or liveDiagramFor…, because four
// implementations of one rule is four chances to disagree about an FA drill.
//
// Three things read as nothing to show, and a screen cannot tell them apart:
//   - undefined, meaning the read has not answered yet. Rendering an empty
//     frame first and a pitch a moment later is worse than rendering nothing.
//   - null or empty, meaning the drill has no diagram. Most drills have none,
//     and an empty pitch on every card would be noise.
//   - an England Football derived drill, whatever it carries. A coach can draw
//     a diagram and later record an FA source on the same drill, which strands
//     one on the row (the drill page states that and offers to remove it). The
//     licence excludes showing a redrawn FA diagram wherever it renders, not
//     only on the page that made it, so a stranded one stays unshown here too.
//     The FA's own image is unaffected and keeps rendering through media.
export function diagramForDisplay(
  diagram: DrillDiagram | null | undefined,
  source: SourceFields,
): DrillDiagram | null {
  if (diagramIsEmpty(diagram)) return null
  if (deriveProvenance(source) === 'fa') return null
  return diagram ?? null
}
