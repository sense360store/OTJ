import { describe, expect, it } from 'vitest'
import { matchVenueByLocation, venueNameFor, type Venue } from './venues'

// One answer for where a session is, shared by every surface that shows it.
// The bug this replaces: Home and the parent dashboard read only the frozen
// free text label, so the venue vanished for every session that had a real
// one, while the Sessions list and Session day resolved it correctly.

const venueById: Record<string, Venue | undefined> = {
  v1: { id: 'v1', name: 'Springmill 3G' },
}

describe('venueNameFor', () => {
  it('prefers the chosen venue over anything else', () => {
    expect(venueNameFor({ venueId: 'v1', venue: 'Ainley Top' }, venueById)).toBe('Springmill 3G')
  })

  it('falls back to the frozen label for a session saved before venues existed', () => {
    expect(venueNameFor({ venueId: null, venue: 'Ainley Top' }, venueById)).toBe('Ainley Top')
  })

  it('answers nothing rather than guessing when the chosen venue is not loaded', () => {
    // Choosing a venue retires the legacy label in the same write, so there is
    // no honest fallback here; an empty answer renders as no venue at all.
    expect(venueNameFor({ venueId: 'gone', venue: '' }, venueById)).toBe('')
    expect(venueNameFor({ venueId: 'gone', venue: '' }, {})).toBe('')
  })

  it('answers nothing for a session with neither', () => {
    expect(venueNameFor({ venueId: null, venue: '' }, venueById)).toBe('')
  })
})

// =====================================================================
// matchVenueByLocation
//
// The production data this rule was written against, read from the hosted
// database on 15 August 2026. The club had three venues and the mirror
// held fourteen events across nine distinct locations.
//
//   exact equality        matched 0 of the 9 locations
//   whole word run        matched 2 of the 9, covering 7 of the 14 events
//   ambiguity             no location named two venues
//   false positives       none
//
// Both halves matter. The positives are the whole reason the rule exists;
// the negatives are the reason it may never be loosened, because a wrong
// venue is worse than none. A coach who sees no venue picks one. A coach
// who sees the wrong one drives to it.
// =====================================================================

const FLUSHDYKE = { id: 'v-flush', name: 'Flushdyke' }
const HAGGS_HILL = { id: 'v-haggs', name: 'Haggs Hill' }
const WOODKIRK = { id: 'v-wood', name: 'Woodkirk' }
const CLUB_VENUES: Venue[] = [FLUSHDYKE, HAGGS_HILL, WOODKIRK]

// Verbatim from public.spond_events.location.
const PRODUCTION_LOCATIONS = {
  flushdykeSchool: 'Ossett Flushdyke Junior & Infant School, Wakefield Rd, Ossett',
  woodkirkAcademy: 'Woodkirk Academy, Rein Rd, Tingley, Wakefield',
  brighouse: 'Brighouse High School, Finkil St, Brighouse',
  hepworth: 'Far Lane, Hepworth, Holmfirth HD9 1RN',
  heckmondwike: 'Heckmondwike Grammar School, High St, Heckmondwike',
  huddersfield: 'Huddersfield New College, Huddersfield',
  manleyPark: 'Manley Park, Stanley Rodillians RUFC, Lee Moor Rd, Stanley, Wakefield',
  swillington: 'Swillington Sports & Social Club, 9 Wakefield Rd, Swillington, Leeds',
  thornes: "Thornes Juniors Football Club, Thornes juniors, Queen's Dr, Lupset, Wakefield, Ossett",
}

describe('matchVenueByLocation, against the production locations', () => {
  it('finds the venue named inside the address, which is the only shape that ever matches', () => {
    // Six of the fourteen events sat at this one location. No venue name is
    // ever equal to a location, so equality would have matched none of them.
    expect(matchVenueByLocation(PRODUCTION_LOCATIONS.flushdykeSchool, CLUB_VENUES)).toBe(FLUSHDYKE.id)
    expect(matchVenueByLocation(PRODUCTION_LOCATIONS.woodkirkAcademy, CLUB_VENUES)).toBe(WOODKIRK.id)
  })

  it('matches none of the away locations', () => {
    // Every remaining production location, each of them somewhere the club
    // does not hold a venue for. All must answer null; one false positive
    // here is a session pointed at the wrong ground.
    for (const location of [
      PRODUCTION_LOCATIONS.brighouse,
      PRODUCTION_LOCATIONS.hepworth,
      PRODUCTION_LOCATIONS.heckmondwike,
      PRODUCTION_LOCATIONS.huddersfield,
      PRODUCTION_LOCATIONS.manleyPark,
      PRODUCTION_LOCATIONS.swillington,
      PRODUCTION_LOCATIONS.thornes,
    ]) {
      expect(matchVenueByLocation(location, CLUB_VENUES), location).toBeNull()
    }
  })

  it('never matches a two word venue the address only half carries', () => {
    // "Haggs Hill" is the club's third venue and no production location
    // names it. "Wakefield" appears in five of them and "Hill" in none,
    // but a rule matching either word would have claimed it.
    for (const location of Object.values(PRODUCTION_LOCATIONS)) {
      expect(matchVenueByLocation(location, [HAGGS_HILL]), location).toBeNull()
    }
  })
})

describe('matchVenueByLocation', () => {
  it('answers null for no location at all', () => {
    expect(matchVenueByLocation(null, CLUB_VENUES)).toBeNull()
    expect(matchVenueByLocation(undefined, CLUB_VENUES)).toBeNull()
  })

  it('answers null for an empty or punctuation only location', () => {
    expect(matchVenueByLocation('', CLUB_VENUES)).toBeNull()
    expect(matchVenueByLocation('   ', CLUB_VENUES)).toBeNull()
    expect(matchVenueByLocation(', , -', CLUB_VENUES)).toBeNull()
  })

  it('answers null when the club has no venues', () => {
    expect(matchVenueByLocation(PRODUCTION_LOCATIONS.flushdykeSchool, [])).toBeNull()
  })

  it('ignores case on both sides', () => {
    expect(matchVenueByLocation('OSSETT FLUSHDYKE JUNIOR SCHOOL', CLUB_VENUES)).toBe(FLUSHDYKE.id)
    expect(matchVenueByLocation('ossett flushdyke junior school', CLUB_VENUES)).toBe(FLUSHDYKE.id)
    expect(matchVenueByLocation('Flushdyke', [{ id: 'v1', name: 'FLUSHDYKE' }])).toBe('v1')
  })

  it('reads a venue the address wraps in punctuation', () => {
    expect(matchVenueByLocation('Ossett (Flushdyke), Wakefield Rd', CLUB_VENUES)).toBe(FLUSHDYKE.id)
    expect(matchVenueByLocation('Wakefield Rd, Flushdyke.', CLUB_VENUES)).toBe(FLUSHDYKE.id)
    expect(matchVenueByLocation('"Flushdyke"', CLUB_VENUES)).toBe(FLUSHDYKE.id)
    expect(matchVenueByLocation('Flushdyke', CLUB_VENUES)).toBe(FLUSHDYKE.id)
  })

  it('reads a multi word venue as one phrase, in order and adjacent', () => {
    expect(matchVenueByLocation('Haggs Hill Lane, Ossett', CLUB_VENUES)).toBe(HAGGS_HILL.id)
    expect(matchVenueByLocation('Ossett, Haggs Hill', CLUB_VENUES)).toBe(HAGGS_HILL.id)
    // Both words present, not as the venue's phrase. Not a match, because
    // "Hill Farm, Haggs Lane" is a different place from "Haggs Hill".
    expect(matchVenueByLocation('Hill Farm, Haggs Lane', CLUB_VENUES)).toBeNull()
    expect(matchVenueByLocation('Hill Haggs', CLUB_VENUES)).toBeNull()
    // One word of it is not it.
    expect(matchVenueByLocation('Haggs Lane, Ossett', CLUB_VENUES)).toBeNull()
    expect(matchVenueByLocation('Hill Top Road', CLUB_VENUES)).toBeNull()
  })

  it('never matches a fragment of a longer word', () => {
    // THE CASE THIS RULE EXISTS FOR. A venue called Wood must not claim
    // Woodkirk Academy, and Woodkirk must not claim a Woodkirkfield.
    expect(matchVenueByLocation(PRODUCTION_LOCATIONS.woodkirkAcademy, [{ id: 'v1', name: 'Wood' }])).toBeNull()
    expect(matchVenueByLocation('Woodkirk Academy', [{ id: 'v1', name: 'kirk' }])).toBeNull()
    expect(matchVenueByLocation('Woodkirkfield Lane', [WOODKIRK])).toBeNull()
    expect(matchVenueByLocation('Flushdykes Lane', [FLUSHDYKE])).toBeNull()
    // The same word standing alone still matches, so this narrows nothing
    // it should not.
    expect(matchVenueByLocation('Wood Lane, Ossett', [{ id: 'v1', name: 'Wood' }])).toBe('v1')
  })

  it('refuses when the location names two different venues', () => {
    // Never a "best" one and never the first. An address carrying two of
    // the club's grounds is a question only the coach can answer.
    const both = 'Flushdyke Road, near Woodkirk Academy'
    expect(matchVenueByLocation(both, CLUB_VENUES)).toBeNull()
    // ... and it is exactly the ambiguity that refuses, not the venues:
    // either one alone still resolves.
    expect(matchVenueByLocation(both, [FLUSHDYKE])).toBe(FLUSHDYKE.id)
    expect(matchVenueByLocation(both, [WOODKIRK])).toBe(WOODKIRK.id)
  })

  it('refuses when one venue name contains another', () => {
    // "Woodkirk" and "Woodkirk Academy" both read the same address. Two
    // answers is no answer.
    const nested: Venue[] = [WOODKIRK, { id: 'v-wood-academy', name: 'Woodkirk Academy' }]
    expect(matchVenueByLocation(PRODUCTION_LOCATIONS.woodkirkAcademy, nested)).toBeNull()
  })

  it('refuses two venue rows that carry the same name', () => {
    // A club that added Flushdyke twice has two ids for one place, and
    // seeding either of them is picking one at random.
    const duplicated: Venue[] = [FLUSHDYKE, { id: 'v-flush-2', name: 'Flushdyke' }]
    expect(matchVenueByLocation(PRODUCTION_LOCATIONS.flushdykeSchool, duplicated)).toBeNull()
    // Spelt differently but normalising the same, which is the same problem.
    const equivalent: Venue[] = [FLUSHDYKE, { id: 'v-flush-3', name: '  flushdyke  ' }]
    expect(matchVenueByLocation(PRODUCTION_LOCATIONS.flushdykeSchool, equivalent)).toBeNull()
  })

  it('reads a venue name carrying punctuation', () => {
    // Apostrophes, ampersands and hyphens end a word on both sides, so a
    // venue and a location spelt the same way agree.
    const punctuated: Venue[] = [{ id: 'v-queens', name: "Queen's Park" }]
    expect(matchVenueByLocation("Queen's Park, Ossett", punctuated)).toBe('v-queens')
    expect(matchVenueByLocation('Queen’s Park, Ossett', punctuated)).toBe('v-queens')
    expect(matchVenueByLocation('The Bull & Bell Ground', [{ id: 'v-bb', name: 'Bull & Bell' }])).toBe('v-bb')
    expect(matchVenueByLocation('Kirk-Lane Playing Fields', [{ id: 'v-kl', name: 'Kirk Lane' }])).toBe('v-kl')
    // Normalising is not fuzzy matching: a differently spelt name is a
    // different name and answers null rather than a near miss.
    expect(matchVenueByLocation('Queens Park, Ossett', punctuated)).toBeNull()
  })

  it('never matches on a venue whose name is blank or all punctuation', () => {
    // An empty name reduces to no words, and no words are inside every
    // address. It must match nothing rather than everything.
    expect(matchVenueByLocation(PRODUCTION_LOCATIONS.flushdykeSchool, [{ id: 'v-blank', name: '' }])).toBeNull()
    expect(matchVenueByLocation(PRODUCTION_LOCATIONS.flushdykeSchool, [{ id: 'v-punct', name: ' - , ' }])).toBeNull()
    // And it does not poison the club's real answer either.
    expect(
      matchVenueByLocation(PRODUCTION_LOCATIONS.flushdykeSchool, [...CLUB_VENUES, { id: 'v-blank', name: '' }]),
    ).toBe(FLUSHDYKE.id)
  })

  it('takes no regex meaning from a venue name', () => {
    // The name reaches no regex, so metacharacters are letters. A venue
    // called "." would otherwise have matched every address in the club.
    expect(matchVenueByLocation(PRODUCTION_LOCATIONS.flushdykeSchool, [{ id: 'v-dot', name: '.' }])).toBeNull()
    expect(matchVenueByLocation(PRODUCTION_LOCATIONS.flushdykeSchool, [{ id: 'v-any', name: '.*' }])).toBeNull()
    expect(matchVenueByLocation('Ossett (Flushdyke)', [{ id: 'v-paren', name: '(Flushdyke' }])).toBe('v-paren')
    expect(matchVenueByLocation('a+b Ground', [{ id: 'v-plus', name: 'a+b' }])).toBe('v-plus')
  })
})
