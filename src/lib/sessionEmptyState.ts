// =====================================================================
// What an empty event list is allowed to say.
//
// WHY THIS IS A MODULE AND NOT A TERNARY IN THE SCREEN. An empty list has
// two completely different causes that look identical on screen, and
// telling a coach the wrong one is a false statement about their club:
//
//   NOTHING TO FIND   the club has no session of this sort at all.
//   NOTHING SHOWN     it has plenty; the filters in effect hid them.
//
// The Past view is where the two collide hardest. "No sessions have
// finished yet" is a claim about the club, and it was being printed over a
// Past view that a kind or team filter had just emptied, telling a coach
// with a season of history behind them that the club had never trained.
// The claim is now allowed only when the club genuinely holds no finished
// session, measured before any narrowing.
//
// Kept pure and out here for the reason ./spond keeps pickerEvents out of
// its modal: this project has no DOM, so a string assembled inside a
// component from a chosen team or a pressed Mine chip is unreachable by
// any test. Out here every combination is ordinary code with ordinary
// tests, and the screen holds one call.
// =====================================================================
import { ALL_EVENTS_LABEL, type EventKind } from './eventKind'
import { LIFECYCLE_SCOPE_LABELS, type LifecycleScope } from './sessionLifecycle'

// The one sentence that makes a claim about the club rather than about a
// filter. Exported because the parent's shorter branch says it too, and
// two copies of a sentence this load bearing is one too many.
export const NO_PAST_SESSIONS_NOTE = `No sessions have finished yet. Tap ${LIFECYCLE_SCOPE_LABELS.upcoming} for what is still to come.`

export interface EmptyEventListState {
  // Does the club hold any session at all, before any narrowing? A brand
  // new club is told to plan one, never to widen a filter it has not set.
  anySessions: boolean
  // Does it hold any FINISHED session, before any narrowing? This is the
  // only question NO_PAST_SESSIONS_NOTE is allowed to answer.
  anyPast: boolean
  scope: LifecycleScope
  kind: EventKind
  // A specific team is chosen in the team select.
  team: boolean
  // The ownership narrowing is on.
  mine: boolean
}

// The widenings worth naming: each one that is actually in effect, and no
// others. Suggesting All events to a coach already on All events, or a
// team change to a coach who has chosen no team, is advice that cannot
// change what they are looking at.
//
// Past is offered only from Upcoming and only when there is history to
// reach, so tapping it can never land on the empty view the coach just
// left.
function widenings(state: EmptyEventListState): string[] {
  return [
    state.kind === 'training' ? ALL_EVENTS_LABEL : '',
    state.scope === 'upcoming' && state.anyPast ? LIFECYCLE_SCOPE_LABELS.past : '',
    state.team ? 'another team' : '',
    state.mine ? 'turn Mine off' : '',
  ].filter(Boolean)
}

// "A", "A, or B", "A, B, or C".
function listed(items: string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')}, or ${items[items.length - 1]}`
}

export function emptyEventListNote(state: EmptyEventListState): string {
  if (!state.anySessions) return 'Plan your first session and it will appear here.'
  // The claim about the club, and the only place it may be made.
  if (state.scope === 'past' && !state.anyPast) return NO_PAST_SESSIONS_NOTE
  const opening =
    state.scope === 'past' ? 'Nothing in the past matches this filter.' : 'Nothing matches this filter.'
  const advice = listed(widenings(state))
  // With nothing narrowed there is nothing to suggest, and inventing a
  // widening would be worse than saying less. Unreachable for a coach on
  // either scope, because a fully widened view can only be empty when
  // there is nothing of that sort to show, which the branches above catch.
  return advice ? `${opening} Try ${advice}.` : opening
}
