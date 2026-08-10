// =====================================================================
// The canonical training classifier, and the Training-first default.
//
// THE PRODUCT RULE THIS ENCODES. Training is the primary purpose of
// Training Hub, so wherever a list can hold training alongside fixtures,
// galas and other events, the default view is Training and the explicit
// widening is All events. Ownership ("mine") is not the organising concept:
// a coach asks "what training is happening?", not "which rows do I own?".
// Ownership still decides who may edit or delete, which is a separate
// question this module deliberately knows nothing about.
//
// ONE SEAM, ON PURPOSE. Every surface that filters events imports from
// here. Before this existed the only classifier was a title check inside
// the Spond planner, so any new screen would have grown its own copy and
// the screens would have disagreed. eventKind.invariant.test.ts fails the
// build if a component grows a local training predicate again.
// =====================================================================

export const TRAINING_LABEL = 'Training'
export const ALL_EVENTS_LABEL = 'All events'

export type EventKind = 'training' | 'all'

export const EVENT_KIND_LABELS: Record<EventKind, string> = {
  training: TRAINING_LABEL,
  all: ALL_EVENTS_LABEL,
}

// Training first, everywhere, always. Exported as a constant rather than
// written as a literal in each screen so a single edit moves them together
// and a test can pin it.
export const DEFAULT_EVENT_KIND: EventKind = 'training'

// The smallest thing anything needs to be classified.
//
// TWO SHAPES, ONE CLASSIFIER. A Training Hub session calls its label `name`
// and a synced Spond event calls it `title`. Both are read here, `title`
// first, so no caller has to normalise before asking and no screen gets an
// excuse to write its own predicate for the shape it happens to hold. Both
// are optional: a row with neither still classifies (as training), because
// hiding a row is worse than showing an odd one.
export interface ClassifiableEvent {
  title?: string | null
  name?: string | null
  spondType?: string | null
}

// The label the classifier reads. Title wins when a row carries both, since
// only the Spond side sets it and that is the side with the event facts.
function eventLabel(event: ClassifiableEvent): string {
  return event.title ?? event.name ?? ''
}

// The vocabulary that marks a row as NOT training.
//
// THE LIMITATION, STATED WHERE IT LIVES. This club creates plain Spond
// events, so spond_type is null on almost every row and Spond's own
// classification usually cannot answer. The remaining fact is the title,
// so the fallback is a word list, and a word list is never complete: an
// event titled "Parents evening" that nobody added here would read as
// training. That is deliberate and it fails in the safe direction, because
// the cost is one extra row in a coach's Training list, not a hidden
// session. Widening the list is a one line change here and nowhere else.
export const NON_TRAINING_WORDS = [
  'match',
  'fixture',
  'friendly',
  'gala',
  'tournament',
  'cup',
  'festival',
  'league',
  'presentation',
  'social',
  'meeting',
  'trial',
  'photo',
] as const

const NON_TRAINING_RE = new RegExp(`\\b(${NON_TRAINING_WORDS.join('|')})\\b`, 'i')

// Spond's own classification of its own event, as the mirror stores it in
// spond_type. Only two values are ever written ("EVENT" or "MATCH"), and
// only this one carries information: EVENT is the catch-all.
//
// Exported because the Match badge on the Spond surfaces asks the same
// question the filter asks, and a badge that disagreed with the filter
// beside it would be worse than no badge at all.
export function isSpondMatch(event: ClassifiableEvent): boolean {
  return typeof event.spondType === 'string' && event.spondType.toUpperCase() === 'MATCH'
}

// Whether a row reads as training.
//
// The order is what matters:
//
//   1. Spond said MATCH. That is Spond's own classification of its own
//      event and it beats anything the title claims.
//   2. The title names a non-training event. Whole words only, so
//      "Rematching drills" is training and "Match" is not.
//   3. Otherwise it is training. A session a coach planned in Training Hub
//      is training unless something says otherwise, which is what keeps
//      legacy and non-Spond training in the default view instead of
//      requiring every row to have been named just so.
//
// spondType 'EVENT' is deliberately NOT treated as proof of training:
// Spond uses it for galas and socials too, so the title still decides.
export function isTrainingEvent(event: ClassifiableEvent): boolean {
  if (isSpondMatch(event)) return false
  return !NON_TRAINING_RE.test(eventLabel(event))
}

// The one filter every surface calls. Kept separate from isTrainingEvent so
// a screen expresses "does this row belong in the current view?" rather than
// re-deriving the boolean logic each time.
export function matchesEventKind(event: ClassifiableEvent, kind: EventKind): boolean {
  return kind === 'all' ? true : isTrainingEvent(event)
}
