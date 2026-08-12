// The canonical training classifier and the Training-first default, pinned.
//
// These exist so the product rule "training is the primary event view" has one
// implementation rather than a title check copied into each screen. Every test
// here was written before the module it imports.
import { describe, expect, it } from 'vitest'
import {
  ALL_EVENTS_LABEL,
  DEFAULT_EVENT_KIND,
  EVENT_KIND_LABELS,
  isFixtureTitle,
  isTrainingEvent,
  matchesEventKind,
  NON_TRAINING_WORDS,
  spondEventLookup,
  TRAINING_LABEL,
} from './eventKind'

describe('the shared labels and default', () => {
  it('is Training first, with All events as the deliberate widening', () => {
    expect(DEFAULT_EVENT_KIND).toBe('training')
    expect(TRAINING_LABEL).toBe('Training')
    expect(ALL_EVENTS_LABEL).toBe('All events')
    expect(EVENT_KIND_LABELS).toEqual({ training: 'Training', all: 'All events' })
  })

  it('offers exactly two kinds, so no screen can invent a third', () => {
    expect(Object.keys(EVENT_KIND_LABELS).sort()).toEqual(['all', 'training'])
  })
})

describe("Spond's own classification is authoritative when present", () => {
  it('treats spondType MATCH as not training, whatever the title says', () => {
    // The strongest fact available. A match called "training" is still a match.
    expect(isTrainingEvent({ title: 'Titans training', spondType: 'MATCH' })).toBe(false)
    expect(isTrainingEvent({ title: 'Titans training', spondType: 'match' })).toBe(false)
  })

  it('does not treat spondType EVENT as proof of training on its own', () => {
    // EVENT is Spond's catch-all: galas and socials carry it too, so the title
    // vocabulary still decides.
    expect(isTrainingEvent({ title: 'End of season gala', spondType: 'EVENT' })).toBe(false)
    expect(isTrainingEvent({ title: 'Monday training', spondType: 'EVENT' })).toBe(true)
  })
})

describe('the documented fallback for rows carrying no Spond classification', () => {
  it('reads a Training Hub session as training by default', () => {
    // The product premise: a session a coach planned in Training Hub is
    // training unless something says otherwise. This is what keeps legacy and
    // non-Spond training visible under the Training filter.
    expect(isTrainingEvent({ title: 'U8 session' })).toBe(true)
    expect(isTrainingEvent({ title: 'Monday night' })).toBe(true)
    expect(isTrainingEvent({ title: 'Titans training' })).toBe(true)
    expect(isTrainingEvent({ title: 'TRAINING' })).toBe(true)
  })

  it('excludes the non-training vocabulary, case insensitively', () => {
    for (const word of NON_TRAINING_WORDS) {
      expect(isTrainingEvent({ title: `Something ${word} something` })).toBe(false)
      expect(isTrainingEvent({ title: word.toUpperCase() })).toBe(false)
    }
  })

  it('keeps a match, fixture and gala out of Training', () => {
    expect(isTrainingEvent({ title: 'Friendly vs Horbury' })).toBe(false)
    expect(isTrainingEvent({ title: 'League match vs Ossett Albion' })).toBe(false)
    expect(isTrainingEvent({ title: 'End of season tournament' })).toBe(false)
    expect(isTrainingEvent({ title: 'Summer gala' })).toBe(false)
  })

  it('treats a missing or empty title as training rather than hiding it', () => {
    // Fail visible, not silent: an untitled row a coach can see and fix beats a
    // row that vanishes from the default view.
    expect(isTrainingEvent({ title: '' })).toBe(true)
    expect(isTrainingEvent({ title: '   ' })).toBe(true)
  })

  it('matches whole words, so "matchday report" does not catch "match" by accident in a training title', () => {
    // Rematch and matching are not fixtures.
    expect(isTrainingEvent({ title: 'Rematching drills' })).toBe(true)
    expect(isTrainingEvent({ title: 'Match' })).toBe(false)
  })
})

describe('the title branch may only ever hide a fixture, never a session', () => {
  // The stated principle is that the heuristic fails towards showing a
  // row: one extra row in a Training list is cheap, a hidden session is
  // not. The exclusion branch is the half that can hide, so every case
  // below is a real training title that a bare word match got wrong.

  it('reads a session the coach called training as training, whatever else the title says', () => {
    // The general rule that catches most of these at once: if the coach
    // said training, session, practice or warm up, that settles it.
    expect(isTrainingEvent({ title: 'Cup week training' })).toBe(true)
    expect(isTrainingEvent({ title: 'League restart training' })).toBe(true)
    expect(isTrainingEvent({ title: 'Presentation practice' })).toBe(true)
    expect(isTrainingEvent({ title: 'Tournament prep session' })).toBe(true)
    expect(isTrainingEvent({ title: 'Match day warm up' })).toBe(true)
  })

  it('keeps a pre match and post match session, which are training', () => {
    // supabase/seed.sql seeds "Saturday Pre-Match", a full session with
    // an activities array. A bare \bmatch\b hid it from the default view
    // of both Sessions and Home.
    expect(isTrainingEvent({ title: 'Saturday Pre-Match' })).toBe(true)
    expect(isTrainingEvent({ title: 'Pre match' })).toBe(true)
    expect(isTrainingEvent({ title: 'Post-match recovery' })).toBe(true)
    expect(isTrainingEvent({ title: 'Matchday routine' })).toBe(true)
  })

  it('recognises a warm up however it is punctuated', () => {
    // "warm-up" is the commonest spelling of the three and was the one the
    // positive check did not accept, so "Cup warm-up" lost to the "cup"
    // exclusion and a real training night vanished from every default view.
    for (const title of [
      'Warm-up',
      'Warm-Up',
      'WARM-UP',
      'warm up',
      'warmup',
      'Cup warm-up',
      'Cup warm up',
      'Cup warmup',
      'Pre-match warm-up',
      'League warm-ups',
      'Tournament warm-up',
    ]) {
      expect(isTrainingEvent({ title })).toBe(true)
    }
  })

  it('does not care whether the coach wrote one drill or several', () => {
    // "Cup drills" was training and "Cup final drill" was not, on a
    // difference of one letter, because the vocabulary listed the plural
    // and the pattern could only ADD an s, never remove one. The singular
    // is the natural way to name one session and it is the word this
    // product's own drill library uses throughout.
    for (const title of ['Cup drill', 'Cup drills', 'Cup final drill', 'Tournament drill night', 'Gala drill']) {
      expect(isTrainingEvent({ title })).toBe(true)
    }
  })

  it('accepts both spellings of practise', () => {
    expect(isTrainingEvent({ title: 'Cup penalty practice' })).toBe(true)
    expect(isTrainingEvent({ title: 'Cup penalty practise' })).toBe(true)
  })

  it('does not let the looser separator swallow unrelated words', () => {
    // The separator is one optional space or hyphen, not any run of
    // characters: "warm" and "up" still have to be adjacent.
    expect(isTrainingEvent({ title: 'Warm weather cup' })).toBe(false)
    expect(isTrainingEvent({ title: 'Warm up the league table gala' })).toBe(true)
    expect(isTrainingEvent({ title: 'Swarm upheaval gala' })).toBe(false)
  })

  it('still keeps a plain match out', () => {
    expect(isTrainingEvent({ title: 'U8 Match' })).toBe(false)
    expect(isTrainingEvent({ title: 'League match vs Ossett Albion' })).toBe(false)
  })

  it('catches the plurals, which used to walk straight through', () => {
    // "Summer gala" and "Summer galas" gave opposite answers, because the
    // trailing s defeated the word boundary.
    expect(isTrainingEvent({ title: 'Summer galas' })).toBe(false)
    expect(isTrainingEvent({ title: 'U8 Matches' })).toBe(false)
    expect(isTrainingEvent({ title: 'Friendlies at Horbury' })).toBe(false)
    expect(isTrainingEvent({ title: 'Player trials' })).toBe(false)
    expect(isTrainingEvent({ title: 'Two tournaments' })).toBe(false)
  })
})

describe("a session keeps the linked Spond event's classification", () => {
  // THE DEFECT THIS PINS. A coach plans a Spond MATCH from All events.
  // sessionFromSpondEvent carries the title and the event id, but a
  // session row has nowhere to put spond_type, so the fixture arrived at
  // the classifier with nothing but "U8 v Horbury" to go on and read as
  // training. The fix is to resolve the link, not to guess from the title:
  // there is still exactly one place that decides, and it is here.
  const events = [
    { id: 'e-match', title: 'U8 v Horbury', spondType: 'MATCH' },
    { id: 'e-training', title: 'Titans Tuesday', spondType: 'EVENT' },
  ]
  const lookup = spondEventLookup(events)

  it('reads a linked MATCH as a fixture, whatever the session is called', () => {
    expect(isTrainingEvent({ name: 'U8 v Horbury', spondEventId: 'e-match' }, { spondEvents: lookup })).toBe(false)
  })

  it('lets the linked MATCH beat a session title that reads like training', () => {
    // Spond's own classification of its own event outranks the title, and
    // it outranks it through the link exactly as it does directly.
    expect(isTrainingEvent({ name: 'Tuesday training', spondEventId: 'e-match' }, { spondEvents: lookup })).toBe(false)
  })

  it('leaves a linked non MATCH event to the ordinary rules', () => {
    // EVENT is Spond's catch-all and proves nothing, so the title decides,
    // which is the same thing it does for an unlinked row.
    expect(isTrainingEvent({ name: 'Titans Tuesday', spondEventId: 'e-training' }, { spondEvents: lookup })).toBe(true)
    expect(isTrainingEvent({ name: 'Summer gala', spondEventId: 'e-training' }, { spondEvents: lookup })).toBe(false)
  })

  it('falls back to the title rules when the link cannot be resolved', () => {
    // Documented and deterministic. The event may have left the mirror, or
    // the caller may classify without a lookup at all. Both land on the
    // title rules, which is the fail towards showing direction this whole
    // heuristic is built around: a fixture in the Training list costs a
    // glance, a hidden session costs the night.
    expect(isTrainingEvent({ name: 'U8 v Horbury', spondEventId: 'gone' }, { spondEvents: lookup })).toBe(true)
    expect(isTrainingEvent({ name: 'U8 v Horbury', spondEventId: 'e-match' })).toBe(true)
    expect(isTrainingEvent({ name: 'Summer gala', spondEventId: 'gone' }, { spondEvents: lookup })).toBe(false)
  })

  it('needs no link to classify an unlinked session, exactly as before', () => {
    expect(isTrainingEvent({ name: 'Tuesday training' }, { spondEvents: lookup })).toBe(true)
    expect(isTrainingEvent({ name: 'Summer gala' }, { spondEvents: lookup })).toBe(false)
  })

  it("prefers the row's own classification when it carries one", () => {
    // A synced event passes its own spondType and never needs the lookup.
    // If both are present they agree, because they are the same fact; the
    // row's own copy is the fresher one, so it answers first.
    expect(isTrainingEvent({ title: 'Titans Tuesday', spondType: 'MATCH', spondEventId: 'e-training' }, { spondEvents: lookup })).toBe(
      false,
    )
  })

  it('carries through matchesEventKind, which is what the screens call', () => {
    const fixture = { name: 'U8 v Horbury', spondEventId: 'e-match' }
    expect(matchesEventKind(fixture, 'training', { spondEvents: lookup })).toBe(false)
    expect(matchesEventKind(fixture, 'all', { spondEvents: lookup })).toBe(true)
  })
})

describe('spondEventLookup', () => {
  it('indexes by id and answers undefined for anything else', () => {
    const lookup = spondEventLookup([{ id: 'a', spondType: 'MATCH' }])
    expect(lookup('a')?.spondType).toBe('MATCH')
    expect(lookup('b')).toBeUndefined()
  })

  it('keeps the last row when an id repeats, rather than throwing', () => {
    // The mirror has a primary key so this cannot happen from the database,
    // but a caller can concatenate lists. Deterministic beats defensive.
    const lookup = spondEventLookup([
      { id: 'a', spondType: 'EVENT' },
      { id: 'a', spondType: 'MATCH' },
    ])
    expect(lookup('a')?.spondType).toBe('MATCH')
  })

  it('is safe to build from nothing', () => {
    expect(spondEventLookup([])('a')).toBeUndefined()
  })
})

describe('one classifier serves both shapes in this codebase', () => {
  // A Hub session calls its label `name`; a synced Spond event calls it
  // `title`. Two shapes must not mean two classifiers, so the seam reads
  // either and the rest of the app never has to care which it holds.
  it('reads a Session name', () => {
    expect(isTrainingEvent({ name: 'Titans training' })).toBe(true)
    expect(isTrainingEvent({ name: 'Friendly vs Horbury' })).toBe(false)
  })

  it('reads a Spond event title', () => {
    expect(isTrainingEvent({ title: 'Titans training' })).toBe(true)
    expect(isTrainingEvent({ title: 'Friendly vs Horbury' })).toBe(false)
  })

  it('prefers title when a row somehow carries both', () => {
    expect(isTrainingEvent({ title: 'Friendly vs Horbury', name: 'Titans training' })).toBe(false)
  })

  it('treats a row with neither as training rather than hiding it', () => {
    expect(isTrainingEvent({})).toBe(true)
  })
})

describe('matchesEventKind is the one filter every surface uses', () => {
  const training = { title: 'Titans training', spondType: null }
  const fixture = { title: 'Friendly vs Horbury', spondType: 'MATCH' }
  const gala = { title: 'Summer gala', spondType: 'EVENT' }

  it('Training shows only training', () => {
    expect(matchesEventKind(training, 'training')).toBe(true)
    expect(matchesEventKind(fixture, 'training')).toBe(false)
    expect(matchesEventKind(gala, 'training')).toBe(false)
  })

  it('All events deliberately shows everything', () => {
    for (const e of [training, fixture, gala]) {
      expect(matchesEventKind(e, 'all')).toBe(true)
    }
  })

  it('filters a mixed collection to training by default', () => {
    const all = [training, fixture, gala]
    expect(all.filter((e) => matchesEventKind(e, DEFAULT_EVENT_KIND))).toEqual([training])
    expect(all.filter((e) => matchesEventKind(e, 'all'))).toHaveLength(3)
  })

  it('does not consider ownership at all', () => {
    // The default must not depend on who owns the row: the classifier has no
    // access to a coach id, which is what makes that structurally true.
    expect(matchesEventKind({ title: 'Titans training' }, 'training')).toBe(true)
  })
})

// =====================================================================
// The football fixture shape, from production.
//
// THE ROWS THIS WAS WRITTEN AGAINST. Three titles the club's coaches
// actually used, all three sitting under Training on every screen after
// the linked-MATCH fix shipped, and all three present in production twice
// over: once as a synced spond_events row and once as the Hub SESSION a
// coach planned from it. None of them names a word the exclusion list
// knows, and Spond states no classification for any of them: every
// spond_events row in that database carries spond_type null.
//
// So this rule reads a title, and the tests below are as much about what
// it must NOT catch as what it must.
// =====================================================================
describe('an opponent-versus-team title is a fixture, not training', () => {
  const TEAMS = ['Titans', 'Trojans', 'Gladiators', 'Spartans', 'Argonauts']
  const ctx = { teamNames: TEAMS }
  const training = (title: string) => isTrainingEvent({ title }, ctx)

  it('classifies the three production fixtures as fixtures', () => {
    // The en dash is the character the club's own titles use.
    expect(training('Lindley Moor – TITANS')).toBe(false)
    expect(training('Hepworth – TITANS')).toBe(false)
    expect(training('TROJANS – Rastrick')).toBe(false)
  })

  it('classifies them the same way as SESSION names, not just event titles', () => {
    // Production holds each of these three as a session a coach planned,
    // and a session carries no spondType at all. One classifier, two
    // shapes: `name` has to reach the same answer `title` does.
    for (const name of ['Lindley Moor – TITANS', 'Hepworth – TITANS', 'TROJANS – Rastrick']) {
      expect(isTrainingEvent({ name }, ctx)).toBe(false)
    }
  })

  it('reads the other separators football writes fixtures with', () => {
    expect(training('Titans v Rastrick')).toBe(false)
    expect(training('Titans vs Rastrick')).toBe(false)
    expect(training('Titans versus Rastrick')).toBe(false)
    expect(training('Titans - Rastrick')).toBe(false)
    expect(training('Titans — Rastrick')).toBe(false)
  })

  it('reads a fixture between two of the club s own teams', () => {
    expect(training('Titans – Trojans')).toBe(false)
  })

  it('ignores the case the coach typed the team in', () => {
    expect(training('TITANS – Rastrick')).toBe(false)
    expect(training('Titans – Rastrick')).toBe(false)
  })

  // ---- and everything it must leave alone --------------------------

  it('leaves a training title with a dash alone', () => {
    // The requirement this rule was nearly broad enough to violate: a dash
    // is not a fixture, and hiding a coach's training note costs them the
    // session.
    expect(training('Training – passing and receiving')).toBe(true)
    expect(training('Training')).toBe(true)
    expect(training('Training session')).toBe(true)
  })

  it('leaves a club team beside a coaching theme alone', () => {
    // One side IS a team, so only the name-like test on the other side
    // keeps this in the Training view. It is the clause that earns the
    // rule its right to hide anything.
    expect(training('Titans – passing and receiving')).toBe(true)
    expect(training('Trojans – shooting')).toBe(true)
  })

  it('leaves two themes alone, team names or not', () => {
    expect(training('Skills – dribbling')).toBe(true)
    expect(training('Attack v Defence')).toBe(true)
  })

  it('needs a whole side to be a team, not a word inside one', () => {
    expect(training('Titans Tuesday – Wednesday Trojans')).toBe(true)
  })

  it('is not fooled by the hyphen inside an ordinary word', () => {
    // The separator needs whitespace on both sides, which is what keeps
    // "warm-up" and "5-a-side" from reading as two teams.
    expect(training('Titans warm-up')).toBe(true)
    expect(training('5-a-side')).toBe(true)
  })

  it('refuses to guess when a title holds more than two sides', () => {
    expect(training('Titans – Trojans – Spartans')).toBe(true)
  })

  it('cannot fire at all without the club s teams', () => {
    // The documented degrade, and the one that matters: a caller with no
    // team names lands exactly where the product was before this rule,
    // which is showing the row rather than hiding it.
    expect(isTrainingEvent({ title: 'Lindley Moor – TITANS' })).toBe(true)
    expect(isTrainingEvent({ title: 'Lindley Moor – TITANS' }, { teamNames: [] })).toBe(true)
  })

  // ---- the review that rewrote this rule ---------------------------
  //
  // An adversarial pass over the first version found three ways it hid a
  // training night, which is the direction this module is not allowed to
  // fail in. All three are pinned here.

  it('leaves a team beside a coaching topic alone, however it is capitalised', () => {
    // THE DEFECT. The first version justified itself by saying the other
    // side reads as prose, and tested only "Titans – passing and
    // receiving". Title Case is the normal way a title is typed, and
    // "Shooting" and "Rastrick" are both one capitalised word, so every
    // one of these was hidden. The rescue is the coaching vocabulary in
    // TRAINING_WORDS, which can only ever show a row.
    for (const title of [
      'Titans – Shooting',
      'TITANS – Fitness',
      'TITANS – Development',
      'Titans – Goalkeeping',
      'Titans – Finishing',
      'TITANS – Skills And Shooting',
      'Titans – Passing And Receiving',
      'Titans - Rondo',
      'Titans - Small Sided Games',
      'Gladiators – Defending As A Unit',
      'Spartans – Ball Mastery',
      'Titans – Conditioning',
      'Titans – Possession',
      'Titans – Indoor',
    ]) {
      expect(training(title)).toBe(true)
    }
  })

  it('leaves a team beside a day or a month alone', () => {
    // A closed set, unlike the topic vocabulary: there are seven days and
    // twelve months and there will not be more. "Titans – Tuesday" is how
    // half the country titles a training night.
    expect(training('Titans - Tuesday')).toBe(true)
    expect(training('TITANS – Thursday')).toBe(true)
    expect(training('Titans – August')).toBe(true)
  })

  it('leaves a numeric side alone, because a club does not start with a digit', () => {
    // bareWord strips only the edges, so "5-a-side" survived whole and a
    // leading digit used to read as a name.
    expect(training('Titans – 5-a-side')).toBe(true)
    expect(training('Titans - 7 A Side')).toBe(true)
    expect(training('Titans – 4v4')).toBe(true)
    expect(training('TITANS – Week 3')).toBe(true)
  })

  it('lets the pre match and match day rescue reach this rule too', () => {
    // THE DEFECT. The fixture rule ran on the raw label and the phrases
    // that exist to say "this is training" were stripped one line later,
    // so the phrase became one side of a two-sided title and lost. The
    // repo's own seed data carries "Saturday Pre-Match".
    for (const title of [
      'Titans – Pre-Match',
      'Pre-Match – TITANS',
      'Titans – Pre Match',
      'TITANS – Post Match',
      'Titans – Match Day',
      'TITANS – Matchday',
      'Titans – Pre-Match Prep',
    ]) {
      expect(training(title)).toBe(true)
    }
  })

  it('still hides the three production fixtures after all of that narrowing', () => {
    // The point of the exercise: every rescue above had to leave the
    // reported defect fixed. None of these names a day, a month, a digit
    // or a coaching topic.
    expect(training('Lindley Moor – TITANS')).toBe(false)
    expect(training('Hepworth – TITANS')).toBe(false)
    expect(training('TROJANS – Rastrick')).toBe(false)
  })

  it('states the shapes it deliberately misses', () => {
    // Each of these is a real fixture this rule leaves in the Training
    // view, listed so nobody mistakes the rule for complete. Every miss
    // costs a coach one glance; the alternative errors hide a session.
    expect(training('U8 v Horbury')).toBe(true)
    expect(training('Titans U9 – Hepworth')).toBe(true)
    expect(training('titans – rastrick')).toBe(true)
  })

  it('names the residual it cannot close, in the direction that hides', () => {
    // THE ONE PLACE THIS MODULE IS INCOMPLETE TOWARDS HIDING. A single
    // capitalised word that is not a day, a month, a digit or a coaching
    // topic is indistinguishable from an opponent, so a training night
    // titled this way is under All events rather than Training. There is
    // no fact in the row that separates the two; adding the word to
    // TRAINING_WORDS is the one line fix, and doing so can only ever show
    // more. Pinned so the limit is a decision and not a surprise.
    expect(training('Titans – Bounce')).toBe(false)
  })

  it('still lets a positive training word outrank the whole shape', () => {
    expect(training('Titans – Rastrick training')).toBe(true)
    expect(training('Titans – Trojans practice')).toBe(true)
  })

  it("still lets Spond's own MATCH outrank a title that is not this shape", () => {
    expect(isTrainingEvent({ title: 'Titans Tuesday', spondType: 'MATCH' }, ctx)).toBe(false)
  })

  it('carries a linked fixture through to the session that plans it', () => {
    // Requirement 8: a session linked to a Spond MATCH inherits the
    // fixture classification through the lookup, with the fixture rule
    // present and not interfering.
    const lookup = spondEventLookup([{ id: 'e-match', spondType: 'MATCH' }])
    expect(isTrainingEvent({ name: 'Tuesday training', spondEventId: 'e-match' }, { ...ctx, spondEvents: lookup })).toBe(
      false,
    )
  })

  it('reaches the screens through matchesEventKind, and only narrows Training', () => {
    const fixture = { title: 'TROJANS – Rastrick' }
    expect(matchesEventKind(fixture, 'training', ctx)).toBe(false)
    expect(matchesEventKind(fixture, 'all', ctx)).toBe(true)
  })
})

describe('isFixtureTitle, stated directly', () => {
  const TEAMS = ['Titans', 'Trojans']

  it('is false without teams, whatever the shape', () => {
    expect(isFixtureTitle('Lindley Moor – TITANS')).toBe(false)
    expect(isFixtureTitle('Lindley Moor – TITANS', [])).toBe(false)
  })

  it('needs exactly two sides, both name-like, one of them ours', () => {
    expect(isFixtureTitle('Lindley Moor – TITANS', TEAMS)).toBe(true)
    expect(isFixtureTitle('Lindley Moor', TEAMS)).toBe(false)
    expect(isFixtureTitle('Titans – passing and receiving', TEAMS)).toBe(false)
    expect(isFixtureTitle('Lindley Moor – Hepworth', TEAMS)).toBe(false)
  })

  it('tolerates the punctuation a title wraps a name in', () => {
    expect(isFixtureTitle('(Titans) – Rastrick', TEAMS)).toBe(true)
  })

  it('reads a name-like side of up to four words and no more', () => {
    expect(isFixtureTitle('Titans – Ossett Town Juniors Reserves', TEAMS)).toBe(true)
    expect(isFixtureTitle('Titans – Ossett Town Juniors Reserves Second', TEAMS)).toBe(false)
  })

  it('lets a lower case joining word sit inside a name', () => {
    expect(isFixtureTitle('Titans – Sons of Ossett', TEAMS)).toBe(true)
  })

  it('does not accept a side made only of joining words', () => {
    expect(isFixtureTitle('Titans – of the', TEAMS)).toBe(false)
  })
})
