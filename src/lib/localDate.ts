// =====================================================================
// What day is it, as the product stores a date.
//
// WHY THIS EXISTS. `blankSession` and the Use template path each carried
// the literal '2026-06-16', so every session a coach created by hand was
// born on a fixed day in the past. It reached production: a smoke test
// in September created a session dated 16 June. Two literals is one
// defect written twice, and a third copy is what this module prevents.
//
// LOCAL FIELDS, NEVER A STRING SLICE. `toISOString().slice(0, 10)` asks
// which UTC day an instant falls in, and for a Yorkshire club that is
// the wrong day for one hour of every British Summer Time evening: at
// 00:30 on 16 June the club is on the 16th and UTC is still on the 15th,
// so a session created after midnight in summer would be dated
// yesterday. Reading getFullYear, getMonth and getDate asks the runtime
// the question the coach is asking, and it is DST safe for free, because
// a 23 hour day and a 25 hour day both still have exactly one date.
// `isSameLocalDay` in ./sessionLifecycle answers the neighbouring
// question, whether two INSTANTS share a local day, and reads the same
// three fields for the same reason.
//
// WHOSE LOCAL DAY. The browser's, which for this club is Europe/London.
// That is the convention the whole product already runs on: `date` and
// `time` are read as the coach typed them, and the lifecycle judges a
// session against the coach's own clock. Pinning this one derivation to
// Europe/London while every comparison stayed local would be two
// conventions rather than one, and would date a session abroad a day
// away from the day the lifecycle then measured it in. The test runner
// pins TZ=Europe/London (vite.config.ts), so the hours where BST and UTC
// disagree are actually exercised.
//
// `now` is a parameter rather than a read, so every case is a test and
// the boundary hours can be driven without a clock.
// =====================================================================

// One instant as the `YYYY-MM-DD` a session stores, in the local calendar.
export function isoDate(at: Date): string {
  const month = String(at.getMonth() + 1).padStart(2, '0')
  const day = String(at.getDate()).padStart(2, '0')
  return `${at.getFullYear()}-${month}-${day}`
}

// Today, as that same string. The default a session created by hand
// starts on: a coach planning tonight's training should not have to
// correct the date before they can do anything else.
export function todayIso(now: Date = new Date()): string {
  return isoDate(now)
}
