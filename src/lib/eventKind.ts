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
  // The synced Spond event this row is arranged as, when it has one.
  //
  // WHY A CLASSIFIER CARES ABOUT AN ID. A synced event carries Spond's own
  // classification in spondType, and that is the strongest fact available.
  // A SESSION planned from one carries only this id: the sessions table has
  // no spond_type column and is not getting one for a filtering rule. So a
  // Spond MATCH planned from All events arrived here as nothing but its
  // title, and a fixture titled "U8 v Horbury" names no word the heuristic
  // knows, so it read as training on every session screen.
  //
  // Resolving the link puts the authoritative fact back in reach without
  // persisting anything, without a migration, and without teaching a second
  // screen a second title trick. The lookup is optional and the caller
  // supplies it; see isTrainingEvent for what happens when it cannot answer.
  spondEventId?: string | null
}

// Resolves a Spond event id to the classification Spond gave it. Optional
// everywhere it appears: a caller holding only synced events never needs
// one, because those rows carry their own spondType.
export type SpondEventLookup = (id: string) => { spondType?: string | null } | undefined

// Everything the classifier can be told about the world beyond the row.
//
// ONE PARAMETER, NOT TWO, and that is deliberate. Both members are facts a
// screen fetches and hands down, both are optional, and both degrade the
// same way when absent. Passing them separately would let a screen supply
// half the context and read as if it had supplied all of it; bundling them
// means the compiler names every call site the day a third fact arrives,
// and a screen wires one hook rather than remembering two.
export interface EventKindContext {
  spondEvents?: SpondEventLookup
  // The club's own team names, as the teams table spells them. Used by the
  // fixture rule below and by nothing else here. Absent means the rule
  // cannot fire, which leaves the classifier exactly as lopsided as it was
  // before: it degrades towards showing, never towards hiding.
  teamNames?: readonly string[]
}

// Builds the lookup from whatever list of synced events the caller holds.
// A plain index, exported so the screens do not each invent one and so the
// empty and unresolvable cases have somewhere to be tested.
export function spondEventLookup(
  events: readonly { id: string; spondType?: string | null }[],
): SpondEventLookup {
  const byId = new Map<string, { spondType?: string | null }>()
  for (const e of events) byId.set(e.id, e)
  return (id: string) => byId.get(id)
}

// The label the classifier reads. Title wins when a row carries both, since
// only the Spond side sets it and that is the side with the event facts.
function eventLabel(event: ClassifiableEvent): string {
  return event.title ?? event.name ?? ''
}

// Words that settle it the other way. A coach who called the row training,
// a session, practice or a warm up has answered the question, and no word
// further along the title gets to overrule them: "Cup week training" and
// "Match day warm up" are training nights.
//
// This is the general form of the asymmetry below. The heuristic is
// allowed to be wrong by SHOWING a row and must not be wrong by hiding
// one, so a positive statement beats the exclusion list every time.
// EVERY ENTRY IS A STEM, NOT A SPELLING. The pattern below appends an
// optional plural, so a stem written in the plural can never match its own
// singular: listing 'drills' made "Cup drills" training and "Cup final
// drill" a fixture, on one letter, with the singular being the form this
// product's own drill library uses throughout. Write the stem.
//
// The separators are the same trap one level down. "warm-up" is the
// commonest of its three spellings and was the one this list did not
// accept, so "Cup warm-up" lost the positive check and then lost to the
// "cup" exclusion. One optional space or hyphen, and nothing else: "warm"
// and "up" still have to be adjacent, so "Warm weather cup" is not
// rescued. "practis" covers the British verb beside the American noun.
//
// THE SECOND HALF OF THIS LIST IS THE PRODUCT'S OWN COACHING VOCABULARY,
// and it is here rather than inside the fixture rule below on purpose.
// A coach who titles a night "Titans – Shooting" has named what they are
// coaching, and "Shooting" is a topic, not an opponent. The fixture rule
// cannot tell those apart by shape: "Shooting" and "Rastrick" are both one
// capitalised word. Rather than teach that rule a list of things it must
// refuse to hide, which would be a hiding rule with an exception list, the
// vocabulary joins the rule that can only ever SHOW a row. Adding a word
// here can move a title from fixture to training and never the other way,
// which is the only direction this module is allowed to be incomplete in.
//
// The words are the FA's own session taxonomy (themes and player skills,
// the lists src/lib/fa.ts offers a coach when they fill a session in) plus
// the coaching words this club's game uses that the FA's lists do not
// carry. Deliberately not here: "game", "final" and other words a fixture
// is at least as likely to contain as a training night.
const TRAINING_WORDS = [
  'training',
  'session',
  'practice',
  'practise',
  'drill',
  'warm[ -]?up',
  // FA themes.
  'attacking',
  'defending',
  'goalkeeping',
  'futsal',
  // FA player skills.
  'finishing',
  'passing',
  'receiving',
  'pressing',
  'marking',
  'tackling',
  'turning',
  'intercepting',
  'covering',
  // The rest of a coaching vocabulary, which the FA lists do not cover.
  'shooting',
  'dribbling',
  'crossing',
  'heading',
  'possession',
  'transition',
  'rondo',
  'mastery',
  'sided',
  'conditioning',
  'fitness',
  'technique',
  'skill',
  'development',
  'coaching',
  'prep',
  // Where a night happens, which is the other thing a coach puts after a
  // team name. Each of these is far likelier to describe a training venue
  // than to be the whole name of a club playing.
  'indoor',
  'outdoor',
  'astro',
  'gym',
] as const

const TRAINING_RE = new RegExp(`\\b(?:${TRAINING_WORDS.join('|')})s?\\b`, 'i')

// Phrases that contain an excluded word and are not the thing it excludes.
// A pre match session, a post match recovery and a matchday routine are
// all training; the repo's own seed data carries "Saturday Pre-Match",
// which a bare word match hid from the default view of two screens.
// Removed from the label before the exclusion list runs.
const NOT_A_FIXTURE = /\b(pre|post)[\s-]?match(day)?\b|\bmatch[\s-]?day\b/gi

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
//
// Several of these words are overloaded ("social" is one of the FA four
// corners, "cup" and "league" turn up in training titles), which is
// exactly why TRAINING_RE above outranks them.
export const NON_TRAINING_WORDS = [
  'match',
  'fixture',
  'friendly',
  'friendlies',
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

// The trailing (?:e?s)? is what makes "Summer gala" and "Summer galas"
// agree. Without it the plural walked straight through the word boundary
// and every fixture named in the plural read as training.
const NON_TRAINING_RE = new RegExp(`\\b(?:${NON_TRAINING_WORDS.join('|')})(?:e?s)?\\b`, 'i')

// ---- The football fixture shape -------------------------------------
//
// WHY A SECOND HIDING RULE EXISTS AT ALL. The word list above only catches
// a fixture that NAMES itself one. This club names its fixtures after the
// two sides playing, so production carried "Lindley Moor – TITANS",
// "Hepworth – TITANS" and "TROJANS – Rastrick", none of which contains a
// single word the list knows, and all three sat under Training on every
// screen. The same three titles are also SESSION names, because a coach
// planned them, so the defect was not confined to the Spond surfaces.
//
// SPOND'S OWN ANSWER WAS ASKED FOR FIRST, and it is not available. Every
// spond_events row in production carries spond_type null, fixtures
// included, and the rows above were written by the deployed sync that does
// read the payload's spondType. This club creates plain Spond events, so
// Spond states no classification to mirror, and no other stored event fact
// separates the three: team_id records which mapping matched the event
// (training addressed to the whole group carries none, which is a fact
// about recipients and not about football), and location is a venue. So
// the title is the only evidence there is, which is why this rule reads
// one, and why it is built to be wrong in the tolerable direction.
//
// THE SHAPE, AND WHY EACH CLAUSE NARROWS IT. A dash in a title proves
// nothing on its own: "Training – passing and receiving" is a coach's
// note, not a fixture, and hiding it would cost them the session. So all
// of the following must hold at once:
//
//   1. The label splits on ONE versus separator into exactly two sides.
//      The separators need whitespace on both sides, so the hyphen inside
//      "warm-up" is not one, and a title with two of them is not this
//      shape at all.
//   2. One whole side IS one of the club's own team names. Not a substring
//      and not a word within a longer side: "TITANS" on its own, the way a
//      fixture names the team playing. Without the club's teams in hand
//      the rule cannot fire, which is the degrade this whole module
//      prefers.
//   3. BOTH sides read as names rather than prose. An opponent is a proper
//      noun ("Lindley Moor", "Rastrick"); a coaching theme is not
//      ("passing and receiving"). This clause is the one that keeps
//      "Titans – passing and receiving" in the Training view, and it is
//      the reason the rule can be trusted to hide anything at all.
//
// The positive training words still outrank all of it, so "Titans – warm
// up" and "Cup week training" are unaffected.
//
// WHAT IT DELIBERATELY MISSES, because every miss shows a fixture and
// every false catch hides a training night: "U8 v Horbury" (an age group
// is not a team name), "Titans U9 – Hepworth" (an affix is not the name)
// and "titans – rastrick" (lower case reads as prose). Each is one line to
// widen here, and nowhere else, if the club ever titles fixtures that way.

// Whitespace on both sides is what stops "warm-up" and "5-a-side" from
// looking like two teams. The word forms are the ones football uses.
const VERSUS_SEPARATOR = /\s+(?:[–—-]|vs?|versus)\s+/i

// Words a name may contain in lower case without ceasing to be a name.
const NAME_JOINERS = new Set(['of', 'the', 'and', 'at', 'on', 'in', 'de', 'la', 'le'])

// Sides that are a moment rather than an opponent. "Titans – Tuesday" is
// how half the country titles a training night, and Tuesday passes every
// shape test a place name passes.
//
// A CLOSED SET, which is what makes it different from the coaching
// vocabulary above. There are seven days and twelve months and there will
// not be more, so this cannot be incomplete the way a topic list can.
const NOT_AN_OPPONENT = new Set([
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
])

// Strips the punctuation a title wraps a word in, so "(Titans)" and
// "Rastrick," are read as the words they are.
function bareWord(word: string): string {
  return word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
}

// Whether one side of a title reads as the name of somebody playing: a
// short run of words, each either capitalised or one of the small joining
// words above, and none of them a day or a month. "Lindley Moor" and
// "TITANS" pass; "passing and receiving" does not, because "passing" is
// neither capitalised nor a joiner.
//
// AN UPPERCASE LETTER, NOT A DIGIT. Accepting a leading digit made
// "5-a-side" and "4v4" read as opponents, because bareWord strips only the
// edges and leaves the run whole, so "Titans – 5-a-side" was a fixture. It
// also made "Week 3" a name. A team or a place starts with a letter; the
// cost is that an opponent written "1874 Northwich" is not recognised,
// which shows a fixture and is the direction this module fails in.
function isNameLike(side: string): boolean {
  const words = side.split(/\s+/).filter(Boolean)
  // Four is a generous ceiling for a club or place name and a tight one
  // for a sentence.
  if (words.length === 0 || words.length > 4) return false
  let named = false
  for (const word of words) {
    const bare = bareWord(word)
    if (!bare) return false
    const lower = bare.toLowerCase()
    if (NOT_AN_OPPONENT.has(lower)) return false
    if (NAME_JOINERS.has(lower)) continue
    if (!/^\p{Lu}/u.test(bare)) return false
    named = true
  }
  // A side made of nothing but joining words is not a name.
  return named
}

// One spelling of a name, for comparing a side against a team. Runs of
// whitespace collapse and the punctuation a title wraps the whole side in
// comes off, so "(Titans)" and "TITANS:" are still the team. Only the
// EDGES, so a team whose name carries a dot or an apostrophe keeps it.
function normaliseName(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
    .toLowerCase()
}

// Whether this side is, in full, one of the club's teams.
function isClubTeam(side: string, teamNames: readonly string[]): boolean {
  const wanted = normaliseName(side)
  if (!wanted) return false
  return teamNames.some((name) => normaliseName(name) === wanted)
}

// Whether a label is a fixture between a club team and somebody else.
// Exported so the tests can state the rule directly; every screen reaches
// it through isTrainingEvent, like everything else here.
export function isFixtureTitle(label: string, teamNames?: readonly string[]): boolean {
  if (!teamNames || teamNames.length === 0) return false
  const sides = label.split(VERSUS_SEPARATOR).map((s) => s.trim())
  // Exactly two: a title carrying two separators is some other shape, and
  // guessing which pair of sides was meant is exactly the kind of guess
  // this module refuses to make.
  if (sides.length !== 2) return false
  if (!sides.every((s) => s.length > 0 && isNameLike(s))) return false
  return sides.some((s) => isClubTeam(s, teamNames))
}

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
//   1. Spond said MATCH about this very row. That is Spond's own
//      classification of its own event and it beats anything the title
//      claims. Only a synced event carries it directly.
//   2. Spond said MATCH about the event this row is arranged as. Same
//      fact, reached through spondEventId because a session has nowhere to
//      keep it, and given the same authority for the same reason: a
//      fixture does not become training by being planned in Training Hub.
//   3. The title says training. A coach who named the row training, a
//      session, practice or a warm up has answered the question, and the
//      exclusion list below does not get to overrule them.
//   4. The title is a fixture between one of the club's teams and
//      somebody else. Both sides have to read as names and one of them has
//      to BE a club team, which is what separates "TROJANS – Rastrick"
//      from "Titans – passing and receiving". See the block above it for
//      why this rule exists and what it deliberately misses.
//   5. The title names a non-training event. Whole words and their
//      plurals, so "Rematching drills" is training and "Matches" is not,
//      and after the pre match and match day phrases have been taken out,
//      because those are training.
//   6. Otherwise it is training. A session a coach planned in Training Hub
//      is training unless something says otherwise, which is what keeps
//      legacy and non-Spond training in the default view instead of
//      requiring every row to have been named just so.
//
// WHEN THE LINK CANNOT BE RESOLVED, which is a caller with no lookup or an
// event that has left the mirror: fall through to the title rules, exactly
// as an unlinked row does. Deterministic, and it fails in the same
// direction everything else here fails in, which is towards showing.
// A screen that classifies sessions is expected to supply a lookup;
// routes/trainingFirst.screens.test.tsx renders those screens and fails if
// a linked fixture reaches one of their Training views.
//
// A CALLER WITH NO TEAM NAMES loses step 4 the same way, and lands back on
// exactly the behaviour that shipped before it existed. Both degrades keep
// a row visible rather than hiding it, which is the only direction this
// module is allowed to fail in.
//
// Steps 3 to 5 are deliberately lopsided. A heuristic can be wrong in two
// directions and only one of them is tolerable: showing a gala under
// Training costs a coach one glance, hiding a training night costs them
// the session. So every rule that can hide is narrow and every rule that
// can show is broad. Steps 1 and 2 are not a heuristic at all, which is
// why they are allowed to hide.
//
// spondType 'EVENT' is deliberately NOT treated as proof of training:
// Spond uses it for galas and socials too, so the title still decides.
export function isTrainingEvent(event: ClassifiableEvent, ctx?: EventKindContext): boolean {
  if (isSpondMatch(event)) return false
  if (ctx?.spondEvents && event.spondEventId) {
    const linked = ctx.spondEvents(event.spondEventId)
    if (linked && isSpondMatch(linked)) return false
  }
  const label = eventLabel(event)
  if (TRAINING_RE.test(label)) return true
  // Both hiding rules read the label with the pre match and match day
  // phrases already taken out, and they have to. Running the fixture rule
  // on the raw label made "TITANS – Pre Match" a fixture: the phrase that
  // exists precisely to say "this is training" became one side of a
  // two-sided title, and the strip a line below it never got the chance to
  // rescue it. Removed first, that side is empty and the shape does not
  // hold, which is the answer both rules were always meant to give.
  const withoutTrainingPhrases = label.replace(NOT_A_FIXTURE, ' ')
  if (isFixtureTitle(withoutTrainingPhrases, ctx?.teamNames)) return false
  return !NON_TRAINING_RE.test(withoutTrainingPhrases)
}

// The one filter every surface calls. Kept separate from isTrainingEvent so
// a screen expresses "does this row belong in the current view?" rather than
// re-deriving the boolean logic each time. The lookup rides through
// unchanged, so a screen filtering sessions passes it once.
export function matchesEventKind(
  event: ClassifiableEvent,
  kind: EventKind,
  ctx?: EventKindContext,
): boolean {
  return kind === 'all' ? true : isTrainingEvent(event, ctx)
}
