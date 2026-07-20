// Season create form helpers: the safe boundary between the season modal's raw
// input strings and the seasons table write. Two concerns live here, both pure
// and unit tested so the create mutation stays a thin wrapper:
//
//   1. Date normalization. An <input type="date"> yields "" when the user
//      leaves it blank or clears it. Postgres date columns reject "" outright
//      with SQLSTATE 22007 (invalid input syntax for type date: ""), which is
//      the production bug this module fixes: an empty string must never reach a
//      date column. blankDateToNull turns a blank (or whitespace only) value
//      into null and leaves a real value untouched, so the payload carries null
//      instead of "". starts_on/ends_on are NOT NULL in the schema
//      (0031_seasons.sql), so a genuinely blank date still cannot create a
//      season; the difference is it now fails honestly rather than as a
//      misleading "invalid date" or a false duplicate name claim.
//
//   2. Error message mapping. A create can fail for two very different reasons
//      the user should be told apart: a duplicate name (the unique index
//      seasons_name_unique_per_club, SQLSTATE 23505) and everything else. The
//      old UI showed "the name may already exist" for every failure, so a date
//      or connection error read as a name clash. seasonCreateErrorMessage maps
//      only 23505 to the duplicate message and gives a truthful generic message
//      otherwise, exposing no raw database detail to the user. The raw error is
//      still logged to the console by the guarded submit seam for developers.

// The user facing copy, exported so the modal and its tests share one source.
export const SEASON_DUPLICATE_NAME_MESSAGE = 'A season with that name already exists. Choose a different name.'
export const SEASON_CREATE_GENERIC_MESSAGE = 'Could not create the season. Check the details and try again.'

// Postgres unique_violation. Raised here by the seasons_name_unique_per_club
// index when a club already has a season with the same name.
const UNIQUE_VIOLATION = '23505'

// A blank date input ("" or whitespace only) becomes null; a real value is
// returned unchanged so a valid ISO date (e.g. "2027-07-01") is preserved
// exactly. This is the single guard that stops "" reaching a date column.
export function blankDateToNull(value: string): string | null {
  return value.trim() === '' ? null : value
}

// The starts_on/ends_on half of a seasons insert, built from the form's raw
// strings with each blank normalized to null. Any create or edit path that
// writes season dates routes through here, so the "" to null safety cannot
// drift between them.
export function seasonDatePayload(input: { startsOn: string; endsOn: string }): {
  starts_on: string | null
  ends_on: string | null
} {
  return {
    starts_on: blankDateToNull(input.startsOn),
    ends_on: blankDateToNull(input.endsOn),
  }
}

// The SQLSTATE from a Supabase/Postgres error, or null when the shape is not
// recognised. Read defensively: the value is untrusted and may be any shape.
function pgErrorCode(error: unknown): string | null {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code
    if (typeof code === 'string') return code
  }
  return null
}

// Maps a failed season create to safe user copy: the duplicate name message
// only for a genuine unique violation (23505), a truthful generic message for
// anything else (a date error such as 22007, a not null violation, a network
// failure). Never returns raw database text.
export function seasonCreateErrorMessage(error: unknown): string {
  return pgErrorCode(error) === UNIQUE_VIOLATION ? SEASON_DUPLICATE_NAME_MESSAGE : SEASON_CREATE_GENERIC_MESSAGE
}
