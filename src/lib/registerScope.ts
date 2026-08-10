// =====================================================================
// The register's Going view: organising tonight around who said they are
// coming, without ever letting that become a claim about who is here.
//
// WHY THIS IS A SEPARATE MODULE. ./register composes the coach's own
// record and takes no Spond input of any kind, by design and by the
// standing policy in CLAUDE.md. Teaching it about RSVP would breach that
// on the first line. So the register is composed first, Spond-blind, and
// this narrows what is LISTED afterwards. Delete this file and the
// register still works completely.
//
// THE RULE. Going means the parent accepted in Spond. It does not mean
// the coach ticked the child in. Those are different facts:
//
//   - Accepted and not ticked  → in Going. Expected, not arrived.
//   - No reply and not ticked  → not in Going. Nobody said they were
//     coming, so they are not part of tonight's expected list.
//   - Anything and ticked      → in Going. Never hide what the coach has
//     already recorded; a row vanishing under a thumb is the one thing a
//     pitch side screen must not do.
//   - No Spond link at all     → not in Going, and NOT "no reply". They
//     have no reply to give. Everyone is where they live.
//
// THE SAFETY PROPERTY. Going is only ever offered when this session
// actually has replies to show (hasRsvpContext). A club with no Spond, a
// session with no linked event, a read still in flight and a read that
// failed all produce no context, which produces no toggle, which leaves
// the complete register on screen. Missing context can therefore never
// render as "nobody is coming".
// =====================================================================
import type { RegisterGroup, RegisterView } from './register'
import type { Rsvp } from './spondRsvp'

export type RegisterScope = 'going' | 'all'

// "Everyone" rather than "All", because the thing being widened to is a
// set of children and the coach is about to read their names.
export const REGISTER_SCOPE_LABELS: Record<RegisterScope, string> = {
  going: 'Going',
  all: 'Everyone',
}

export const DEFAULT_REGISTER_SCOPE: RegisterScope = 'going'

// Whether there is anything for the Going view to be built from. Empty
// covers every way context can be absent, which is deliberate: no Spond,
// no linked event, no links, still loading and failed are one case here.
export function hasRsvpContext(rsvpByPlayer: Record<string, Rsvp>): boolean {
  return Object.keys(rsvpByPlayer).length > 0
}

export interface ScopedRegister {
  view: RegisterView
  // How many rows the scope is holding back. Shown beside the toggle, so
  // a narrowed register always says out loud that it is narrowed.
  hidden: number
}

export function applyRegisterScope(
  view: RegisterView,
  scope: RegisterScope,
  rsvpByPlayer: Record<string, Rsvp>,
): ScopedRegister {
  // Everyone is the identity. Same object, so a club with no Spond runs
  // the code path it ran before this module existed.
  if (scope === 'all') return { view, hidden: 0 }

  let hidden = 0
  let playerTotal = 0
  let presentTotal = 0
  const groups: RegisterGroup[] = []
  for (const g of view.groups) {
    const rows = g.rows.filter((r) => {
      if (r.present) return true
      if (rsvpByPlayer[r.player.id]?.status === 'accepted') return true
      hidden++
      return false
    })
    // A group narrowed to nobody is not information, it is an empty
    // heading. An empty COVERED team under Everyone still is information,
    // which is why that case stays in ./register and not here.
    if (rows.length === 0) continue
    const presentCount = rows.filter((r) => r.present).length
    playerTotal += rows.length
    presentTotal += presentCount
    groups.push({ ...g, rows, presentCount })
  }
  return { view: { groups, playerTotal, presentTotal }, hidden }
}
