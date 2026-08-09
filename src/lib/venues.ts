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
