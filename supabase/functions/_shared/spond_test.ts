// Tests for the shared Spond sync core. These are hermetic (no network,
// no database) and every fixture is synthetic: invented member ids and
// invented names, never a real Spond payload, even redacted. They pin
// the parts that can be wrong quietly: the counts derivation, the sync
// window, the subgroup matching in the events query, and the upsert row
// shape, including the children's data boundary expressed as a test.
// Run with:
//
//   deno test --allow-env --allow-read supabase/functions/_shared/spond_test.ts
//
// The underscore folder is not deployed; this file ships nowhere.
import { assert, assertEquals } from 'jsr:@std/assert@1'
import {
  buildEventRow,
  claimEvent,
  deriveCounts,
  deriveLocation,
  eventsQuery,
  extractAccessToken,
  MAX_EVENTS_PER_GROUP,
  SPOND_EVENT_COLUMNS,
  spondTimestamp,
  syncWindow,
  visibleGroupIds,
} from './spond.ts'

// ---- Synthetic fixtures, invented ids and names only -----------------------

const FAKE_MEMBER_IDS = ['FAKE-MEMBER-1', 'FAKE-MEMBER-2', 'FAKE-MEMBER-3', 'FAKE-GUARDIAN-9']

// The shape of a Spond event as the reference library's examples read it,
// with invented content throughout. The recipients object carries invented
// names so the boundary test below can prove they never reach the row.
const SYNTHETIC_EVENT = {
  id: 'EVT-SYNTH-1',
  heading: 'U8 training',
  description: 'Synthetic fixture, never a real payload.',
  startTimestamp: '2026-06-18T17:30:00Z',
  endTimestamp: '2026-06-18T18:30:00Z',
  location: {
    id: 'LOC-SYNTH-1',
    feature: 'Invented Sports Ground',
    address: '1 Made Up Lane, Nowhere',
    latitude: 53.0,
    longitude: -1.5,
  },
  cancelled: false,
  spondType: 'EVENT',
  responses: {
    acceptedIds: ['FAKE-MEMBER-1', 'FAKE-MEMBER-2'],
    declinedIds: ['FAKE-MEMBER-3'],
    unansweredIds: ['FAKE-GUARDIAN-9'],
    waitinglistIds: [],
    unconfirmedIds: ['FAKE-MEMBER-1'],
  },
  recipients: {
    group: {
      id: 'GRP-SYNTH-1',
      members: [{ id: 'FAKE-MEMBER-1', firstName: 'Madeup', lastName: 'Childname' }],
    },
  },
}

const SYNCED_AT = '2026-06-12T12:00:00.000Z'

// ---- Counts derivation ------------------------------------------------------

Deno.test('deriveCounts takes the four counts as array lengths', () => {
  assertEquals(deriveCounts(SYNTHETIC_EVENT.responses), {
    accepted_count: 2,
    declined_count: 1,
    unanswered_count: 1,
    waiting_count: 0,
  })
})

Deno.test('absent response arrays count as zero rather than failing', () => {
  const zero = { accepted_count: 0, declined_count: 0, unanswered_count: 0, waiting_count: 0 }
  assertEquals(deriveCounts({}), zero)
  assertEquals(deriveCounts(undefined), zero)
  assertEquals(deriveCounts(null), zero)
  assertEquals(deriveCounts('not an object'), zero)
  assertEquals(deriveCounts({ acceptedIds: ['FAKE-MEMBER-1'] }), { ...zero, accepted_count: 1 })
  assertEquals(deriveCounts({ acceptedIds: 'not an array' }), zero)
})

Deno.test('unconfirmedIds is ignored, it is not one of the four counts', () => {
  assertEquals(deriveCounts({ unconfirmedIds: ['FAKE-MEMBER-1', 'FAKE-MEMBER-2'] }), {
    accepted_count: 0,
    declined_count: 0,
    unanswered_count: 0,
    waiting_count: 0,
  })
})

// ---- The children's data boundary expressed as a test ----------------------
// The derived upsert object holds four integer counts and event facts. No
// property is or contains a member id, a name, or any response array.

Deno.test('the upsert row carries counts only, never the ids or names behind them', () => {
  const row = buildEventRow('club-1', 'team-1', SYNTHETIC_EVENT, SYNCED_AT)
  assert(row !== null)
  assertEquals(row.accepted_count, 2)
  assertEquals(row.declined_count, 1)
  assertEquals(row.unanswered_count, 1)
  assertEquals(row.waiting_count, 0)
  for (const key of ['accepted_count', 'declined_count', 'unanswered_count', 'waiting_count'] as const) {
    assert(Number.isInteger(row[key]), `${key} must be an integer`)
  }
  // Every value is a primitive: nothing structured from the payload, no
  // arrays at all, survives into the row.
  for (const [key, value] of Object.entries(row)) {
    assert(
      value === null || ['string', 'number', 'boolean'].includes(typeof value),
      `${key} must be a primitive, got ${typeof value}`,
    )
  }
  // No property's value is or contains a member id or an invented name.
  const flat = JSON.stringify(row)
  for (const fakeId of FAKE_MEMBER_IDS) {
    assert(!flat.includes(fakeId), `row leaked member id ${fakeId}`)
  }
  assert(!flat.includes('Madeup'), 'row leaked a member first name')
  assert(!flat.includes('Childname'), 'row leaked a member last name')
  assert(!flat.includes('acceptedIds'), 'row leaked a response array')
})

// ---- The upsert payload shape -----------------------------------------------

Deno.test('the row contains exactly the allowed spond_events columns', () => {
  const row = buildEventRow('club-1', 'team-1', SYNTHETIC_EVENT, SYNCED_AT)
  assert(row !== null)
  assertEquals(SPOND_EVENT_COLUMNS.length, 14)
  assertEquals(Object.keys(row).sort(), [...SPOND_EVENT_COLUMNS].sort())
})

Deno.test('the row carries the event facts, normalised', () => {
  const row = buildEventRow('club-1', 'team-1', SYNTHETIC_EVENT, SYNCED_AT)
  assert(row !== null)
  assertEquals(row.club_id, 'club-1')
  assertEquals(row.team_id, 'team-1')
  assertEquals(row.spond_event_id, 'EVT-SYNTH-1')
  assertEquals(row.title, 'U8 training')
  assertEquals(row.starts_at, '2026-06-18T17:30:00.000Z')
  assertEquals(row.ends_at, '2026-06-18T18:30:00.000Z')
  assertEquals(row.location, 'Invented Sports Ground, 1 Made Up Lane, Nowhere')
  assertEquals(row.cancelled, false)
  assertEquals(row.synced_at, SYNCED_AT)
  assertEquals(row.spond_type, 'EVENT')
})

Deno.test('missing optional fields map to null and a missing cancelled flag to false', () => {
  const bare = {
    id: 'EVT-SYNTH-2',
    heading: 'Match day',
    startTimestamp: '2026-07-01T09:00:00Z',
    responses: {},
  }
  const row = buildEventRow('club-1', 'team-1', bare, SYNCED_AT)
  assert(row !== null)
  assertEquals(row.ends_at, null)
  assertEquals(row.location, null)
  assertEquals(row.cancelled, false)
  assertEquals(row.accepted_count, 0)
  assertEquals(row.spond_type, null)
})

Deno.test('spondType stores uppercased when a non empty string, else null', () => {
  const base = { id: 'EVT-SYNTH-4', heading: 'Fixture', startTimestamp: '2026-07-01T09:00:00Z' }
  assertEquals(buildEventRow('c', 't', { ...base, spondType: 'MATCH' }, SYNCED_AT)?.spond_type, 'MATCH')
  assertEquals(buildEventRow('c', 't', { ...base, spondType: 'match' }, SYNCED_AT)?.spond_type, 'MATCH')
  assertEquals(buildEventRow('c', 't', base, SYNCED_AT)?.spond_type, null)
  assertEquals(buildEventRow('c', 't', { ...base, spondType: '' }, SYNCED_AT)?.spond_type, null)
  assertEquals(buildEventRow('c', 't', { ...base, spondType: 7 }, SYNCED_AT)?.spond_type, null)
  assertEquals(buildEventRow('c', 't', { ...base, spondType: { kind: 'MATCH' } }, SYNCED_AT)?.spond_type, null)
})

Deno.test('cancelled must be boolean true, never a truthy accident', () => {
  const base = { id: 'EVT-SYNTH-3', heading: 'Training', startTimestamp: '2026-07-01T09:00:00Z' }
  assertEquals(buildEventRow('c', 't', { ...base, cancelled: true }, SYNCED_AT)?.cancelled, true)
  assertEquals(buildEventRow('c', 't', { ...base, cancelled: 'true' }, SYNCED_AT)?.cancelled, false)
  assertEquals(buildEventRow('c', 't', { ...base, cancelled: 1 }, SYNCED_AT)?.cancelled, false)
})

Deno.test('an event without a usable id, title or start time yields no row', () => {
  const base = { id: 'EVT-X', heading: 'Training', startTimestamp: '2026-07-01T09:00:00Z' }
  assert(buildEventRow('c', 't', base, SYNCED_AT) !== null)
  assertEquals(buildEventRow('c', 't', { ...base, id: undefined }, SYNCED_AT), null)
  assertEquals(buildEventRow('c', 't', { ...base, heading: '  ' }, SYNCED_AT), null)
  assertEquals(buildEventRow('c', 't', { ...base, startTimestamp: undefined }, SYNCED_AT), null)
  assertEquals(buildEventRow('c', 't', { ...base, startTimestamp: 'not a date' }, SYNCED_AT), null)
  assertEquals(buildEventRow('c', 't', null, SYNCED_AT), null)
  assertEquals(buildEventRow('c', 't', 'junk', SYNCED_AT), null)
})

Deno.test('an unreadable end time degrades to null rather than failing the event', () => {
  const row = buildEventRow(
    'c',
    't',
    { id: 'EVT-X', heading: 'Training', startTimestamp: '2026-07-01T09:00:00Z', endTimestamp: 'soon' },
    SYNCED_AT,
  )
  assert(row !== null)
  assertEquals(row.ends_at, null)
})

Deno.test('deriveLocation reads feature and address and nothing else', () => {
  assertEquals(deriveLocation({ feature: 'Ground', address: 'Lane' }), 'Ground, Lane')
  assertEquals(deriveLocation({ feature: 'Ground' }), 'Ground')
  assertEquals(deriveLocation({ address: 'Lane', latitude: 53.0 }), 'Lane')
  assertEquals(deriveLocation({ latitude: 53.0, longitude: -1.5 }), null)
  assertEquals(deriveLocation(undefined), null)
  assertEquals(deriveLocation('a string'), null)
})

// ---- The time window --------------------------------------------------------
// The window runs WINDOW_BACK_DAYS before now to WINDOW_FORWARD_DAYS after,
// in the timestamp format the reference library sends: the UTC date with
// the time zeroed.

Deno.test('syncWindow spans 14 days back to 90 days forward, dates at midnight UTC', () => {
  const window = syncWindow(new Date('2026-06-12T13:45:30.123Z'))
  assertEquals(window.from, '2026-05-29T00:00:00.000Z')
  assertEquals(window.to, '2026-09-10T00:00:00.000Z')
})

Deno.test('spondTimestamp zeroes the time component like the library format', () => {
  assertEquals(spondTimestamp(new Date('2026-06-12T23:59:59.999Z')), '2026-06-12T00:00:00.000Z')
  assertEquals(spondTimestamp(new Date('2026-01-01T00:00:00.000Z')), '2026-01-01T00:00:00.000Z')
})

// ---- Subgroup matching in the events query ----------------------------------
// A whole group mapping queries by groupId alone; a subgroup mapping adds
// Spond's own subGroupId filter. The recipients payload is never parsed.

const WINDOW = { from: '2026-05-29T00:00:00.000Z', to: '2026-09-10T00:00:00.000Z' }

Deno.test('a whole group mapping queries by groupId with the window and caps', () => {
  const params = eventsQuery({ spond_group_id: 'GRP-SYNTH-1', spond_subgroup_id: null }, WINDOW)
  assertEquals(params.get('groupId'), 'GRP-SYNTH-1')
  assertEquals(params.get('subGroupId'), null)
  assertEquals(params.get('max'), String(MAX_EVENTS_PER_GROUP))
  assertEquals(params.get('scheduled'), 'False')
  assertEquals(params.get('minStartTimestamp'), WINDOW.from)
  assertEquals(params.get('maxStartTimestamp'), WINDOW.to)
})

Deno.test('a subgroup mapping adds the subGroupId filter to the same query', () => {
  const params = eventsQuery({ spond_group_id: 'GRP-SYNTH-1', spond_subgroup_id: 'SUB-SYNTH-7' }, WINDOW)
  assertEquals(params.get('groupId'), 'GRP-SYNTH-1')
  assertEquals(params.get('subGroupId'), 'SUB-SYNTH-7')
  assertEquals(params.get('max'), String(MAX_EVENTS_PER_GROUP))
})

// ---- Login response handling -------------------------------------------------
// Only the token is ever read from a login response. The failure shapes
// (wrong password, 2FA challenge) yield null, never a thrown payload.

Deno.test('extractAccessToken reads the accessToken.token shape and nothing else', () => {
  assertEquals(extractAccessToken({ accessToken: { token: 'jwt-synth', expiration: 'x' } }), 'jwt-synth')
  assertEquals(extractAccessToken({ accessToken: { token: '' } }), null)
  assertEquals(extractAccessToken({ accessToken: 'jwt-synth' }), null)
  assertEquals(extractAccessToken({ error: 'invalid_credentials', phoneNumber: '***' }), null)
  assertEquals(extractAccessToken(null), null)
  assertEquals(extractAccessToken('jwt-synth'), null)
})

// ---- Group visibility reconciliation -----------------------------------------
// Only group ids are read from the groups response; the member lists with
// their names are discarded untouched. An unexpected shape yields the
// empty set so mappings report as not visible rather than guessing.

Deno.test('visibleGroupIds collects ids and ignores everything else', () => {
  const groups = [
    { id: 'GRP-SYNTH-1', name: 'OTJ', members: [{ id: 'FAKE-MEMBER-1', firstName: 'Invented' }] },
    { id: 'GRP-SYNTH-2', name: 'Other' },
    { name: 'No id' },
    'junk',
    null,
  ]
  const ids = visibleGroupIds(groups)
  assertEquals(ids, new Set(['GRP-SYNTH-1', 'GRP-SYNTH-2']))
})

Deno.test('a missing or unexpected groups response yields the empty set', () => {
  assertEquals(visibleGroupIds(null), new Set())
  assertEquals(visibleGroupIds(undefined), new Set())
  assertEquals(visibleGroupIds({ groups: [] }), new Set())
})

// ---- Shared event attribution -------------------------------------------------
// An event matched by more than one mapping with different teams is a club
// event: the queued row is rewritten with team_id null. The same event seen
// again with the same team stays on that team.

function rowFor(team: string | null, eventId = 'EVT-SYNTH-1') {
  const row = buildEventRow('club-1', 'team-ignored', { ...SYNTHETIC_EVENT, id: eventId }, SYNCED_AT)
  assert(row !== null)
  return { ...row, team_id: team }
}

Deno.test('the first mapping to produce an event queues it on its team', () => {
  const queued = new Map()
  const claim = claimEvent(queued, rowFor('team-1'))
  assertEquals(claim, { outcome: 'queued' })
  assertEquals(queued.get('EVT-SYNTH-1')?.team_id, 'team-1')
})

Deno.test('the same event seen again with the same team stays on that team', () => {
  const queued = new Map()
  claimEvent(queued, rowFor('team-1'))
  assertEquals(claimEvent(queued, rowFor('team-1')), { outcome: 'already_synced' })
  assertEquals(queued.get('EVT-SYNTH-1')?.team_id, 'team-1')
})

Deno.test('the same event seen with a different team becomes a club event', () => {
  const queued = new Map()
  const first = rowFor('team-1')
  claimEvent(queued, first)
  const claim = claimEvent(queued, rowFor('team-2'))
  assert(claim.outcome === 'shared')
  // The rewrite is the first queued row, team cleared and nothing else
  // changed, ready for an additional upsert on the same conflict target.
  assertEquals(claim.rewrite, { ...first, team_id: null })
  assertEquals(queued.get('EVT-SYNTH-1')?.team_id, null)
})

Deno.test('a third mapping after the rewrite still reads the event as shared and null', () => {
  const queued = new Map()
  claimEvent(queued, rowFor('team-1'))
  claimEvent(queued, rowFor('team-2'))
  const claim = claimEvent(queued, rowFor('team-3'))
  assert(claim.outcome === 'shared')
  assertEquals(claim.rewrite.team_id, null)
  assertEquals(queued.get('EVT-SYNTH-1')?.team_id, null)
})

Deno.test('claims track each event id independently', () => {
  const queued = new Map()
  claimEvent(queued, rowFor('team-1', 'EVT-SYNTH-A'))
  assertEquals(claimEvent(queued, rowFor('team-2', 'EVT-SYNTH-B')), { outcome: 'queued' })
  assertEquals(queued.get('EVT-SYNTH-A')?.team_id, 'team-1')
  assertEquals(queued.get('EVT-SYNTH-B')?.team_id, 'team-2')
})
