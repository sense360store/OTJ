// The bib vocabulary and the inherit label.
//
// A coach standing on the pitch reads the bib control to know what a
// child wears. "Team bib" made them remember what the team's default
// was; the inherit option now says the colour itself, without changing
// what is stored. These tests pin that the label is display only: the
// inherit sentinel stays the empty select value, and effectiveBib is
// untouched, so showing "Blue (team)" can never persist blue.
import { describe, expect, it } from 'vitest'
import { BIB_COLOURS, BIB_NONE, bibInheritLabel, bibLabel, effectiveBib } from './bibs'

describe('bibInheritLabel, the inherit option a coach reads', () => {
  it('shows the actual team colour, not a phrase to decode', () => {
    expect(bibInheritLabel('blue')).toBe('Blue (team)')
    expect(bibInheritLabel('red')).toBe('Red (team)')
    expect(bibInheritLabel('yellow')).toBe('Yellow (team)')
  })

  it('names every colour in the closed vocabulary the same way', () => {
    for (const b of BIB_COLOURS) {
      expect(bibInheritLabel(b.value)).toBe(`${b.label} (team)`)
    }
  })

  it('is honest when the team has no default colour', () => {
    // Not "Team bib", which claims a colour exists, and not a colour,
    // which would be invented. teams.bib_colour is null when unset.
    expect(bibInheritLabel(null)).toBe('No team colour')
    expect(bibInheritLabel(undefined)).toBe('No team colour')
  })

  it('never produces the phrase Team bib', () => {
    for (const value of [...BIB_COLOURS.map((b) => b.value), null, undefined]) {
      expect(bibInheritLabel(value)).not.toContain('Team bib')
    }
  })

  it('follows a change of team default, because it reads the current value', () => {
    // The admin moves the team from blue to red; a row with no override
    // inherits the new colour and the label says so.
    expect(bibInheritLabel('blue')).toBe('Blue (team)')
    expect(bibInheritLabel('red')).toBe('Red (team)')
    expect(effectiveBib(null, 'blue')).toBe('blue')
    expect(effectiveBib(null, 'red')).toBe('red')
  })
})

describe('the storage semantics the label must not disturb', () => {
  it('keeps an explicit override winning over the team default', () => {
    // A child explicitly in blue stays in blue when the team turns red.
    expect(effectiveBib('blue', 'red')).toBe('blue')
    expect(bibLabel(effectiveBib('blue', 'red'))).toBe('Blue')
  })

  it('keeps the explicit none meaning no bib, never fall back', () => {
    expect(effectiveBib(BIB_NONE, 'red')).toBeNull()
    expect(bibLabel(BIB_NONE)).toBe('No bib')
  })

  it('keeps no override meaning inherit', () => {
    expect(effectiveBib(null, 'red')).toBe('red')
    expect(effectiveBib(undefined, 'red')).toBe('red')
    expect(effectiveBib(null, null)).toBeNull()
  })
})
