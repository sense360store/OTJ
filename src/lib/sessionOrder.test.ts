// =====================================================================
// The order a list of sessions reads in, pinned against the reported
// screenshots.
//
// WHAT HAPPENED. The sessions read is
// `.order('date').order('start_time').order('id')`, all ascending, and
// nothing reordered it afterwards. That is the right raw order for a
// schedule and exactly the wrong one for a history: pressing Past put
// 16 June at the top of a list whose most useful row, 11 August, was at
// the bottom, and a coach reasonably reported the recent sessions as
// missing.
//
// The fix is not to reverse the query, because Home leads with the front
// of the same list. The order is a property of the VIEW, so it is decided
// beside the filter that composes the view (./eventFilter,
// orderEventsForScope) and is asserted here rather than inherited from
// database wire order.
//
// THE HOSTED ROWS, read only on 2026-08-12, which is what these tests use:
//
//   2026-08-29 12:00  Clifton moor gala
//   2026-08-22 10:00  Lindley Moor – TITANS
//   2026-08-11 18:00  Training                     <- the reported session
//   2026-08-09 11:30  Hepworth – TITANS
//   2026-08-08 09:00  Training
//   2026-08-04 18:00  Training
//   2026-08-01 09:00  Training session
//   2026-08-01 09:00  Attacking Week 1
//   2026-07-28 17:30  Marking and intercepting to defend · Week 6
// =====================================================================
import { describe, expect, it } from 'vitest'
import { applyEventFilter, orderEventsForScope, pickNextEvent } from './eventFilter'
import type { FilterableEvent } from './eventFilter'

const at = (y: number, m: number, d: number, hh: number, mm = 0) => new Date(y, m - 1, d, hh, mm, 0, 0)
const NOW = at(2026, 8, 12, 9, 0)
const COACH = '523cec32-d847-4a5b-a843-e3aa8ae20572'

interface Row extends FilterableEvent {
  id: string
  name: string
}

const row = (id: string, date: string, time: string, name = 'Training'): Row => ({
  id,
  name,
  date,
  time,
  status: 'upcoming',
  activities: [],
  liveActivityIndex: null,
  liveActivityStartedAt: null,
  coachId: COACH,
})

// In the order the query returns them: date, then start_time, then id, all
// ascending. Every test below therefore starts from the shape production
// actually hands the screen.
const AS_THE_QUERY_RETURNS_THEM: Row[] = [
  row('jul28', '2026-07-28', '17:30', 'Marking and intercepting to defend · Week 6'),
  row('aug01-attacking', '2026-08-01', '09:00', 'Attacking Week 1'),
  row('aug01-training', '2026-08-01', '09:00', 'Training session'),
  row('aug04', '2026-08-04', '18:00'),
  row('aug08', '2026-08-08', '09:00'),
  row('aug09', '2026-08-09', '11:30', 'Hepworth – TITANS'),
  row('aug11', '2026-08-11', '18:00'),
  row('aug22', '2026-08-22', '10:00', 'Lindley Moor – TITANS'),
  row('aug29', '2026-08-29', '12:00', 'Clifton moor gala'),
]

const ids = (rows: { id: string }[]) => rows.map((r) => r.id)
const view = (scope: 'upcoming' | 'past') =>
  ids(applyEventFilter(AS_THE_QUERY_RETURNS_THEM, { kind: 'all', scope, mine: false }, { userId: COACH, now: NOW }))

describe('Past reads most recent first', () => {
  // REQUIREMENT 7. The exact list from the report, in the exact order.
  it('leads with 11 August and works backwards', () => {
    expect(view('past')).toEqual([
      'aug11',
      'aug09',
      'aug08',
      'aug04',
      'aug01-attacking',
      'aug01-training',
      'jul28',
    ])
  })

  it('breaks a tie by the order the query gave, not by chance', () => {
    // Two sessions at 09:00 on 1 August share a start instant, so the
    // comparator returns 0 for the pair and Array.prototype.sort, which is
    // stable, leaves them in the (date, start_time, id) order the query
    // gave. That is the same order in BOTH views: rows that start at the
    // same moment have no "more recent" between them, and the useful
    // property is that two renders agree rather than that the pair flips.
    const pair = (scope: 'upcoming' | 'past') =>
      ids(orderEventsForScope(AS_THE_QUERY_RETURNS_THEM, scope)).filter((id) => id.startsWith('aug01'))
    expect(pair('past')).toEqual(['aug01-attacking', 'aug01-training'])
    expect(pair('upcoming')).toEqual(['aug01-attacking', 'aug01-training'])
  })
})

describe('Upcoming reads soonest first', () => {
  // REQUIREMENT 8.
  it('leads with the next session', () => {
    expect(view('upcoming')).toEqual(['aug22', 'aug29'])
  })

  it('is the order the query already returns, so nothing a coach sees moves', () => {
    const asRead = AS_THE_QUERY_RETURNS_THEM
    expect(ids(orderEventsForScope(asRead, 'upcoming'))).toEqual(ids(asRead))
  })
})

describe('the ordering seam itself', () => {
  it('does not mutate the list it is given', () => {
    // applyEventFilter is called during render. A comparator that sorted in
    // place would reorder the query cache under React.
    const original = ids(AS_THE_QUERY_RETURNS_THEM)
    orderEventsForScope(AS_THE_QUERY_RETURNS_THEM, 'past')
    applyEventFilter(AS_THE_QUERY_RETURNS_THEM, { kind: 'all', scope: 'past', mine: false }, { userId: COACH, now: NOW })
    expect(ids(AS_THE_QUERY_RETURNS_THEM)).toEqual(original)
  })

  it('sorts a row nothing places in time to the end, both ways round', () => {
    // Unplaced is not "oldest" and not "soonest". It goes last in either
    // view, so a row with an unreadable date cannot take the top of the
    // schedule or the top of the history.
    const undated: Row = { ...row('undated', '', ''), date: null, time: null }
    const rows = [undated, ...AS_THE_QUERY_RETURNS_THEM]
    expect(ids(orderEventsForScope(rows, 'upcoming')).at(-1)).toBe('undated')
    expect(ids(orderEventsForScope(rows, 'past')).at(-1)).toBe('undated')
  })

  it('reads a synced Spond event by its own instant, like everything else here', () => {
    // Two shapes, one rule. A Spond event carries startsAt rather than a
    // local date and time, and sorts against sessions without the caller
    // normalising first.
    const evening = { id: 'event', startsAt: '2026-08-11T17:00:00Z', title: 'Training' }
    const morning = { id: 'session', date: '2026-08-11', time: '09:00', name: 'Training' }
    expect(ids(orderEventsForScope([evening, morning], 'upcoming'))).toEqual(['session', 'event'])
    expect(ids(orderEventsForScope([evening, morning], 'past'))).toEqual(['event', 'session'])
  })
})

describe('what the order does NOT change', () => {
  // REQUIREMENT 9. pickNextEvent takes a list already ordered soonest first
  // and picks the first row that qualifies. The ordering seam produces
  // exactly that order for Upcoming, so Home's hero is unchanged: same row,
  // same preference for training over a sooner fixture.
  // Named so the shared classifier reads it as a fixture on the title
  // alone: "U8 v Horbury" carries no word the heuristic knows and is read
  // as training without a Spond lookup, which ./trainingFirst.acceptance
  // pins for its own reasons.
  const fixtureSoonest = row('fixture', '2026-08-13', '10:00', 'Summer gala')
  const trainingLater = row('training', '2026-08-14', '18:00', 'Titans training')
  const pool = [fixtureSoonest, trainingLater]

  it('picks the same event before and after ordering', () => {
    const before = pickNextEvent(pool, COACH, undefined, NOW)?.id
    const after = pickNextEvent(orderEventsForScope(pool, 'upcoming'), COACH, undefined, NOW)?.id
    expect(before).toBe('training')
    expect(after).toBe('training')
  })

  it('still prefers training over a sooner fixture once the list is ordered', () => {
    // Ordering is not a preference: it decides where rows sit, and
    // pickNextEvent decides which one leads. Reversing the input would not
    // change the answer here, which is what makes them independent.
    expect(pickNextEvent(orderEventsForScope([...pool].reverse(), 'upcoming'), COACH, undefined, NOW)?.id).toBe(
      'training',
    )
  })
})
