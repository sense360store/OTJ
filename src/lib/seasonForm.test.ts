import { describe, expect, it } from 'vitest'
import {
  blankDateToNull,
  seasonCreateErrorMessage,
  seasonDatePayload,
  SEASON_CREATE_GENERIC_MESSAGE,
  SEASON_DUPLICATE_NAME_MESSAGE,
} from './seasonForm'

// Regression coverage for the Create Season date and error handling hotfix.
// The production bug was an empty date input ("") reaching a NOT NULL date
// column, rejected by Postgres with SQLSTATE 22007 and then mislabelled in the
// UI as a duplicate name. These pin the two safeguards: blanks become null in
// the payload, and only a real unique violation (23505) gets the duplicate copy.

describe('blankDateToNull', () => {
  it('turns an empty string into null', () => {
    expect(blankDateToNull('')).toBeNull()
  })

  it('turns a whitespace only value into null', () => {
    expect(blankDateToNull('   ')).toBeNull()
  })

  it('preserves a valid ISO date unchanged', () => {
    expect(blankDateToNull('2027-07-01')).toBe('2027-07-01')
  })
})

describe('seasonDatePayload', () => {
  it('create with blank optional dates sends null for both', () => {
    expect(seasonDatePayload({ startsOn: '', endsOn: '' })).toEqual({
      starts_on: null,
      ends_on: null,
    })
  })

  it('create with valid dates sends the ISO dates unchanged', () => {
    expect(seasonDatePayload({ startsOn: '2027-07-01', endsOn: '2028-06-30' })).toEqual({
      starts_on: '2027-07-01',
      ends_on: '2028-06-30',
    })
  })

  it('edit with a cleared date sends null for the cleared field and keeps the other', () => {
    // A season edit that clears one date routes through the same helper, so the
    // cleared field is normalized to null rather than sent as "".
    expect(seasonDatePayload({ startsOn: '', endsOn: '2028-06-30' })).toEqual({
      starts_on: null,
      ends_on: '2028-06-30',
    })
    expect(seasonDatePayload({ startsOn: '', endsOn: '' })).toEqual({
      starts_on: null,
      ends_on: null,
    })
  })
})

describe('seasonCreateErrorMessage', () => {
  it('shows the duplicate name message for a unique violation (23505)', () => {
    expect(seasonCreateErrorMessage({ code: '23505' })).toBe(SEASON_DUPLICATE_NAME_MESSAGE)
  })

  it('does not show the duplicate name message for a date error (22007)', () => {
    const message = seasonCreateErrorMessage({ code: '22007', message: 'invalid input syntax for type date: ""' })
    expect(message).not.toBe(SEASON_DUPLICATE_NAME_MESSAGE)
    expect(message).toBe(SEASON_CREATE_GENERIC_MESSAGE)
  })

  it('gives the generic message for an unknown or shapeless error', () => {
    expect(seasonCreateErrorMessage(new Error('network down'))).toBe(SEASON_CREATE_GENERIC_MESSAGE)
    expect(seasonCreateErrorMessage(null)).toBe(SEASON_CREATE_GENERIC_MESSAGE)
    expect(seasonCreateErrorMessage(undefined)).toBe(SEASON_CREATE_GENERIC_MESSAGE)
  })

  it('never returns raw database detail to the user', () => {
    const message = seasonCreateErrorMessage({ code: '22007', message: 'invalid input syntax for type date: ""' })
    expect(message).not.toContain('syntax')
    expect(message).not.toContain('22007')
  })
})
