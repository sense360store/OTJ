// Venues: the club's real places, so every session at Springmill agrees
// on the name instead of five coaches typing five spellings.
//
// A venue here is a name and nothing more. Measured areas and drawn
// boundaries belong to the session setup work and arrive with the screens
// that use them, rather than sitting in the schema unwritten.

export interface Venue {
  id: string
  name: string
}

// Where a session is, as one answer for every surface that shows it.
//
// The chosen venue wins. The frozen free text label is the fallback, and only
// for a session saved before venues existed that nobody has given one since:
// choosing a venue retires that label in the same write, so the two can never
// both be set and disagree. An empty string means the venue is not known,
// which every caller renders as nothing rather than as a guess.
export function venueNameFor(
  session: { venueId: string | null; venue: string },
  venueById: Record<string, Venue | undefined>,
): string {
  if (session.venueId) return venueById[session.venueId]?.name ?? ''
  return session.venue
}

// ---- Matching a Spond location to one of the club's venues ----------------
//
// A Spond event carries a location as one free text line, written by whoever
// arranged the event and usually a postal address: "Ossett Flushdyke Junior
// & Infant School, Wakefield Rd, Ossett". The club's venues are short names
// coaches chose: Flushdyke, Haggs Hill, Woodkirk. The two are never equal.
// Production on 15 August 2026: exact equality matched NONE of the nine
// distinct stored locations, while the venue name appearing as a whole word
// run inside the location matched 7 of the 14 events, with no location
// matching two venues and no venue matching a location it did not name.
//
// So the rule is whole word containment and nothing cleverer. It can only
// ever DEFAULT a new draft, never decide anything:
//
//   one venue matches      that venue's id
//   no venue matches       null, and the coach picks one
//   more than one matches  null. Never a "best" one: two venues named in one
//                          address is a question only the coach can answer,
//                          and quietly choosing between them is how a session
//                          ends up at the wrong ground with nobody told.
//
// There is no edit distance, no prefix guess and no scoring, because every
// one of those turns "we do not know" into a confident wrong answer. And a
// coach's saved choice always outranks this: production holds a session at
// Flushdyke whose Spond event says Woodkirk Academy, which is a real
// arrangement the club made and not a mistake to correct.

// Every separator on both sides, so one rule reads both a venue name and a
// Spond address: spaces, commas, apostrophes, ampersands, hyphens and the
// rest all end a word.
//
// A FIXED pattern, never one assembled from a venue name or a Spond
// location. Compiling user text into a regex is how an unescaped "(" becomes
// a crash and a "." becomes a wildcard that matches a venue nobody chose.
const WORD_SEPARATORS = /[^\p{L}\p{N}]+/u

function words(value: string): string[] {
  return value.toLowerCase().split(WORD_SEPARATORS).filter(Boolean)
}

// Whether `needle` appears inside `haystack` as a whole, contiguous run of
// words. Words rather than characters, which is the whole point: "Wood" is
// not inside "Woodkirk Academy", and "Haggs Hill" is inside "Haggs Hill
// Lane" but not inside "Haggs Lane, Hill Top".
function containsWordRun(haystack: string[], needle: string[]): boolean {
  // An empty needle is contained in everything, so a venue whose name is
  // blank or all punctuation would match every location. It matches none.
  if (needle.length === 0 || needle.length > haystack.length) return false
  for (let i = 0; i + needle.length <= haystack.length; i++) {
    let hit = true
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) {
        hit = false
        break
      }
    }
    if (hit) return true
  }
  return false
}

// The one venue a Spond location identifies, or null. Pure, and the only
// implementation of this rule.
//
// Null covers every uncertainty there is: no location, a location that names
// nothing the club has, and a location that names more than one venue. Two
// venue rows sharing a name are two answers, so they are an ambiguity too,
// which is why the count is of distinct venue ids and not of matching rows.
export function matchVenueByLocation(location: string | null | undefined, venues: readonly Venue[]): string | null {
  const place = words(location ?? '')
  if (place.length === 0) return null
  const matched = new Set<string>()
  for (const venue of venues) {
    if (containsWordRun(place, words(venue.name))) matched.add(venue.id)
  }
  return matched.size === 1 ? [...matched][0] : null
}
