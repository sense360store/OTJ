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
  isTrainingEvent,
  matchesEventKind,
  NON_TRAINING_WORDS,
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
