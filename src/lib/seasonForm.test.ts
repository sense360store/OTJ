import { describe, expect, it, vi } from 'vitest'
import {
  blankDateToNull,
  seasonCreateErrorMessage,
  seasonCreateInput,
  seasonDatePayload,
  submitSeasonCreate,
  validateSeasonForm,
  SEASON_CREATE_GENERIC_MESSAGE,
  SEASON_DATES_REQUIRED_MESSAGE,
  SEASON_DUPLICATE_NAME_MESSAGE,
  type SeasonFormValues,
} from './seasonForm'
import { createGuardedSubmit } from './sessionSubmit'

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

// Regression coverage for the null starts_on crash after PR #114. The root
// cause was a stale first-render closure in CreateSeasonModal: useGuardedSubmit
// freezes perform on the first render (every field empty), so the submit always
// carried empty strings even when valid dates were visible. #114 then turned
// that empty start into null, producing the not-null violation (23502). The fix
// routes the current values through the guarded submit input, and gates submit
// on client validation so no request is made for an invalid form.

const VALID: SeasonFormValues = { name: '2027/28', startsOn: '2027-07-01', endsOn: '2028-06-30' }

describe('validateSeasonForm', () => {
  it('accepts a valid name and ordered dates', () => {
    expect(validateSeasonForm(VALID)).toEqual({ canSubmit: true, message: null })
  })

  it('blocks submit when the start date is blank', () => {
    const result = validateSeasonForm({ ...VALID, startsOn: '' })
    expect(result.canSubmit).toBe(false)
    expect(result.message).toBe(SEASON_DATES_REQUIRED_MESSAGE)
  })

  it('blocks submit when the end date is blank', () => {
    const result = validateSeasonForm({ ...VALID, endsOn: '' })
    expect(result.canSubmit).toBe(false)
    expect(result.message).toBe(SEASON_DATES_REQUIRED_MESSAGE)
  })

  it('blocks submit when the name is empty or too long', () => {
    expect(validateSeasonForm({ ...VALID, name: '   ' }).canSubmit).toBe(false)
    expect(validateSeasonForm({ ...VALID, name: 'x'.repeat(21) }).canSubmit).toBe(false)
  })

  it('blocks submit when the end date is not after the start date', () => {
    expect(validateSeasonForm({ ...VALID, endsOn: VALID.startsOn }).canSubmit).toBe(false)
  })
})

describe('seasonCreateInput', () => {
  it('carries both visible ISO dates through unchanged and trims the name', () => {
    expect(seasonCreateInput({ name: '  2027/28 ', startsOn: '2027-07-01', endsOn: '2028-06-30' })).toEqual({
      name: '2027/28',
      startsOn: '2027-07-01',
      endsOn: '2028-06-30',
    })
  })
})

describe('submitSeasonCreate', () => {
  it('sends both ISO dates to the mutation for a valid form', () => {
    const submit = vi.fn()
    const submitted = submitSeasonCreate(VALID, submit)
    expect(submitted).toBe(true)
    expect(submit).toHaveBeenCalledTimes(1)
    expect(submit).toHaveBeenCalledWith({ name: '2027/28', startsOn: '2027-07-01', endsOn: '2028-06-30' })
  })

  it('makes no request when the start date is blank', () => {
    const submit = vi.fn()
    expect(submitSeasonCreate({ ...VALID, startsOn: '' }, submit)).toBe(false)
    expect(submit).not.toHaveBeenCalled()
  })

  it('makes no request when the end date is blank', () => {
    const submit = vi.fn()
    expect(submitSeasonCreate({ ...VALID, endsOn: '' }, submit)).toBe(false)
    expect(submit).not.toHaveBeenCalled()
  })
})

describe('guarded submit forwards the current values (no stale closure)', () => {
  it('delivers the values passed to run into perform, not a captured first render', async () => {
    // Reproduces the wiring the modal now uses: the payload flows through the
    // submit input. A perform that read outer state instead (the old bug) would
    // never see these values. Here we assert the fresh input reaches perform and
    // becomes the mutation payload with both ISO dates intact.
    const receivedPayloads: SeasonFormValues[] = []
    const guard = createGuardedSubmit<SeasonFormValues, void>({
      perform: async (input) => {
        receivedPayloads.push(seasonCreateInput(input))
      },
      onPending: () => {},
      onSuccess: () => {},
      onFailure: () => {},
    })

    await guard.run(VALID)

    expect(receivedPayloads).toEqual([{ name: '2027/28', startsOn: '2027-07-01', endsOn: '2028-06-30' }])
    expect(receivedPayloads[0].startsOn).toBe('2027-07-01')
    expect(receivedPayloads[0].endsOn).toBe('2028-06-30')
  })
})
