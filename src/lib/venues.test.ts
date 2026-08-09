import { describe, expect, it } from 'vitest'
import { venueNameFor, type Venue } from './venues'

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
