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
  groupSubgroupIds,
  MAX_EVENTS_PER_GROUP,
  SPOND_EVENT_COLUMNS,
  spondTimestamp,
  syncWindow,
  visibleGroupIds,
  wholeGroupEventIds,
  wholeGroupGate,
} from './spond.ts'
import type { SpondEventRow } from './spond.ts'

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
  assertEquals(params.get('minStartTimestamp'), WINDOW.from)
  assertEquals(params.get('maxStartTimestamp'), WINDOW.to)
})

// The regression this file exists to prevent. scheduled is an INCLUSION
// flag in the reference library: sending False excluded every event whose
// invitations Spond has queued to send later, which is exactly how this
// club's recurring weekly training is arranged. Fixtures arrived, training
// never did.
Deno.test('the query asks Spond for scheduled events, in the library wire format', () => {
  for (const subgroup of [null, 'SUB-SYNTH-7']) {
    const params = eventsQuery({ spond_group_id: 'GRP-SYNTH-1', spond_subgroup_id: subgroup }, WINDOW)
    assertEquals(params.get('scheduled'), 'True', 'scheduled must be True or training never syncs')
  }
})

Deno.test('asking for scheduled events narrows nothing else', () => {
  const params = eventsQuery({ spond_group_id: 'GRP-SYNTH-1', spond_subgroup_id: 'SUB-SYNTH-7' }, WINDOW)
  // The window, the cap and the subgroup scope are exactly as before, and
  // no parameter has been added or dropped alongside the flag.
  assertEquals([...params.keys()].sort(), [
    'groupId',
    'max',
    'maxStartTimestamp',
    'minStartTimestamp',
    'scheduled',
    'subGroupId',
  ])
  assertEquals(params.get('max'), String(MAX_EVENTS_PER_GROUP))
  assertEquals(params.get('minStartTimestamp'), WINDOW.from)
  assertEquals(params.get('maxStartTimestamp'), WINDOW.to)
  assertEquals(params.get('subGroupId'), 'SUB-SYNTH-7')
})

Deno.test('the query is a read: it carries no write, no mutation and no member scope', () => {
  const query = eventsQuery({ spond_group_id: 'GRP-SYNTH-1', spond_subgroup_id: 'SUB-SYNTH-7' }, WINDOW).toString()
  for (const forbidden of ['memberId', 'recipients', 'accept', 'decline', 'respond', 'delete', 'cancel']) {
    assert(!query.includes(forbidden), `the events query must not carry ${forbidden}`)
  }
})

Deno.test('a subgroup mapping adds the subGroupId filter to the same query', () => {
  const params = eventsQuery({ spond_group_id: 'GRP-SYNTH-1', spond_subgroup_id: 'SUB-SYNTH-7' }, WINDOW)
  assertEquals(params.get('groupId'), 'GRP-SYNTH-1')
  assertEquals(params.get('subGroupId'), 'SUB-SYNTH-7')
  assertEquals(params.get('max'), String(MAX_EVENTS_PER_GROUP))
})

// ---- A scheduled training event through the normal row path ----------------
//
// A scheduled event is an ordinary event that Spond has not sent the
// invitations for yet. It therefore has no responses at all, which is the
// one shape the counts pipeline had never been given.

// Invented throughout. No responses key at all, which is what Spond returns
// before invitations go out.
const SYNTHETIC_SCHEDULED_TRAINING = {
  id: 'EVT-SYNTH-SCHEDULED-1',
  heading: 'Titans training',
  startTimestamp: '2026-06-25T17:30:00Z',
  endTimestamp: '2026-06-25T18:30:00Z',
  location: { feature: 'Invented Sports Ground', address: '1 Made Up Lane, Nowhere' },
}

Deno.test('a scheduled training event with no responses becomes an ordinary row', () => {
  const row = buildEventRow('club-1', 'team-1', SYNTHETIC_SCHEDULED_TRAINING, SYNCED_AT)
  assert(row !== null, 'a scheduled event must not be skipped as malformed')
  assertEquals(Object.keys(row).sort(), [...SPOND_EVENT_COLUMNS].sort())
  assertEquals(row.spond_event_id, 'EVT-SYNTH-SCHEDULED-1')
  assertEquals(row.title, 'Titans training')
  assertEquals(row.team_id, 'team-1')
  assertEquals(row.cancelled, false)
})

Deno.test('no replies yet stores four zeroes, never null and never a failure', () => {
  // Every shape a not yet invited event can arrive in.
  for (const responses of [undefined, null, {}, { acceptedIds: [], declinedIds: [], unansweredIds: [], waitinglistIds: [] }]) {
    const row = buildEventRow('club-1', 'team-1', { ...SYNTHETIC_SCHEDULED_TRAINING, responses }, SYNCED_AT)
    assert(row !== null)
    assertEquals(row.accepted_count, 0)
    assertEquals(row.declined_count, 0)
    assertEquals(row.unanswered_count, 0)
    assertEquals(row.waiting_count, 0)
  }
})

Deno.test('a scheduled event and an ordinary one live side by side without colliding', () => {
  const queued = new Map<string, SpondEventRow>()
  const scheduled = buildEventRow('club-1', 'team-1', SYNTHETIC_SCHEDULED_TRAINING, SYNCED_AT)!
  const ordinary = buildEventRow('club-1', 'team-1', SYNTHETIC_EVENT, SYNCED_AT)!
  assertEquals(claimEvent(queued, scheduled).outcome, 'queued')
  assertEquals(claimEvent(queued, ordinary).outcome, 'queued')
  assertEquals(queued.size, 2)
  // And re-reading the same scheduled event in one run is still one row,
  // so widening the query cannot duplicate anything.
  assertEquals(claimEvent(queued, { ...scheduled }).outcome, 'already_synced')
  assertEquals(queued.size, 2)
})

Deno.test('a scheduled event leaks no more than an ordinary one', () => {
  const withNames = {
    ...SYNTHETIC_SCHEDULED_TRAINING,
    responses: { acceptedIds: [], declinedIds: [], unansweredIds: [], waitinglistIds: [] },
    recipients: { group: { members: [{ id: 'FAKE-MEMBER-1', firstName: 'Madeup', lastName: 'Childname' }] } },
  }
  const flat = JSON.stringify(buildEventRow('club-1', 'team-1', withNames, SYNCED_AT))
  for (const fakeId of FAKE_MEMBER_IDS) assert(!flat.includes(fakeId), `row leaked ${fakeId}`)
  assert(!flat.includes('Madeup'), 'row leaked a member first name')
  assert(!flat.includes('recipients'), 'row leaked the recipients object')
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

// ---- The whole group pass: six subgroups, five mapped ----------------------
//
// The production topology this exists for, with invented ids throughout. The
// club's Spond group has SIX subgroups and only FIVE are mapped to a team.
// Training is addressed to the parent group itself, so no subgroup query
// returns it; a fixture is addressed to one subgroup; and the sixth,
// unmapped subgroup has an event of its own that must never reach the Hub,
// because a club event is visible to every team and every parent.

const GROUP_ID = 'GRP-SYNTH-U8'
const SG_MAPPED = ['SG-SYNTH-1', 'SG-SYNTH-2', 'SG-SYNTH-3', 'SG-SYNTH-4', 'SG-SYNTH-5']
const SG_UNMAPPED = 'SG-SYNTH-6-UNMAPPED'

// A groups/ entry as the reference library's Group model reads it: subGroups
// entries are {id, name}, beside a members array carrying invented names. The
// discriminator must take the subgroup ids and touch nothing else.
const SYNTHETIC_GROUP = {
  id: GROUP_ID,
  name: 'Invented Town u8 25 - 26',
  subGroups: [...SG_MAPPED, SG_UNMAPPED].map((id) => ({ id, name: `Invented squad ${id}` })),
  members: [
    { id: 'FAKE-MEMBER-1', firstName: 'Invented', lastName: 'Child', subGroups: [SG_MAPPED[0]] },
    { id: 'FAKE-MEMBER-2', firstName: 'Made', lastName: 'Up', subGroups: [SG_UNMAPPED] },
  ],
}

// What each query returns. Training appears ONLY in the group wide result,
// which is the scoping fact this whole change exists for.
const TRAINING_ID = 'EVT-SYNTH-TRAINING-WHOLE-GROUP'
const FIXTURE_ID = 'EVT-SYNTH-FIXTURE-MAPPED'
const UNMAPPED_ID = 'EVT-SYNTH-UNMAPPED-SUBGROUP-ONLY'
const GROUP_WIDE_RETURNED = [TRAINING_ID, FIXTURE_ID, UNMAPPED_ID]

Deno.test('the subgroup list is read from the group, ids only, never a name or a member', () => {
  const ids = groupSubgroupIds([SYNTHETIC_GROUP], GROUP_ID)
  assertEquals(ids, [...SG_MAPPED, SG_UNMAPPED])
  // Nothing that could identify a person, and no subgroup label, comes back.
  const asText = JSON.stringify(ids)
  for (const leak of ['Invented', 'Made', 'Up', 'Child', 'FAKE-MEMBER', 'squad', 'name']) {
    assert(!asText.includes(leak), `subgroup ids must not carry ${leak}`)
  }
})

Deno.test('an unreadable subgroup list fails closed as null, which is not an empty list', () => {
  // Absent group, absent subGroups, and a non array subGroups: all unknown.
  assertEquals(groupSubgroupIds([SYNTHETIC_GROUP], 'GRP-SYNTH-OTHER'), null)
  assertEquals(groupSubgroupIds([{ id: GROUP_ID }], GROUP_ID), null)
  assertEquals(groupSubgroupIds([{ id: GROUP_ID, subGroups: 'nonsense' }], GROUP_ID), null)
  assertEquals(groupSubgroupIds(null, GROUP_ID), null)
  // A group genuinely without subgroups is a real answer, not unknown.
  assertEquals(groupSubgroupIds([{ id: GROUP_ID, subGroups: [] }], GROUP_ID), [])
})

Deno.test('whole group training appears: no subgroup query returned it', () => {
  // Every subgroup asked, mapped and unmapped, exactly as the pass does.
  const seen = new Set([FIXTURE_ID, UNMAPPED_ID])
  assertEquals(wholeGroupEventIds(GROUP_WIDE_RETURNED, seen), [TRAINING_ID])
})

Deno.test('a mapped subgroup fixture stays on its team and is never re-claimed', () => {
  // The fixture was returned by its subgroup query, so the pass skips it and
  // the team the mapping gave it stands.
  const seen = new Set([FIXTURE_ID, UNMAPPED_ID])
  assert(!wholeGroupEventIds(GROUP_WIDE_RETURNED, seen).includes(FIXTURE_ID))
  const queued = new Map<string, SpondEventRow>()
  claimEvent(queued, rowFor('team-titans', FIXTURE_ID))
  assertEquals(queued.get(FIXTURE_ID)?.team_id, 'team-titans')
})

Deno.test('an unmapped subgroup event never becomes an All teams club event', () => {
  // The sixth subgroup is asked even though no team maps to it, precisely so
  // its events are excluded here rather than surfacing club wide.
  const seen = new Set([FIXTURE_ID, UNMAPPED_ID])
  const whole = wholeGroupEventIds(GROUP_WIDE_RETURNED, seen)
  assert(!whole.includes(UNMAPPED_ID), 'an unmapped subgroup event must not be stored as a club event')
  assertEquals(whole, [TRAINING_ID])
})

Deno.test('asking only the five MAPPED subgroups would leak the sixth: the bug this design refuses', () => {
  // This is the shortcut the design rejects, pinned so it cannot be
  // reintroduced. With only the mapped subgroups asked, the unmapped
  // subgroup's own event looks exactly like a whole group event.
  const mappedOnly = new Set([FIXTURE_ID])
  assert(wholeGroupEventIds(GROUP_WIDE_RETURNED, mappedOnly).includes(UNMAPPED_ID))
})

Deno.test('a whole group event is stored as a club event, team_id null', () => {
  const row = buildEventRow('club-1', null, { ...SYNTHETIC_SCHEDULED_TRAINING, id: TRAINING_ID }, SYNCED_AT)
  assert(row !== null)
  assertEquals(row.team_id, null)
  assertEquals(row.spond_event_id, TRAINING_ID)
  // The boundary is unchanged by the null team: exactly the same columns.
  assertEquals(Object.keys(row).sort(), [...SPOND_EVENT_COLUMNS].sort())
})

Deno.test('the whole group pass produces no duplicate event ids', () => {
  // A group wide response repeating an id, and an id already queued by a
  // mapping, both collapse to one row.
  const seen = new Set([FIXTURE_ID, UNMAPPED_ID])
  assertEquals(wholeGroupEventIds([TRAINING_ID, TRAINING_ID, TRAINING_ID], seen), [TRAINING_ID])
  const queued = new Map<string, SpondEventRow>()
  const training = buildEventRow('club-1', null, { ...SYNTHETIC_SCHEDULED_TRAINING, id: TRAINING_ID }, SYNCED_AT)!
  assertEquals(claimEvent(queued, training).outcome, 'queued')
  assertEquals(claimEvent(queued, { ...training }).outcome, 'already_synced')
  assertEquals(queued.size, 1)
})

Deno.test('a shared multi-team event still becomes club level through the mapping path', () => {
  // The whole group pass does not disturb the existing shared rule: an event
  // two mapped subgroups both return is still rewritten to team_id null.
  const queued = new Map<string, SpondEventRow>()
  claimEvent(queued, rowFor('team-1', FIXTURE_ID))
  const claim = claimEvent(queued, rowFor('team-2', FIXTURE_ID))
  assert(claim.outcome === 'shared')
  assertEquals(claim.rewrite.team_id, null)
  // And because a subgroup returned it, the pass leaves it alone entirely.
  assert(!wholeGroupEventIds(GROUP_WIDE_RETURNED, new Set([FIXTURE_ID, UNMAPPED_ID])).includes(FIXTURE_ID))
})

Deno.test('the whole group query is the same read, with the subgroup filter dropped and nothing else', () => {
  const whole = eventsQuery({ spond_group_id: GROUP_ID, spond_subgroup_id: null }, WINDOW)
  const scoped = eventsQuery({ spond_group_id: GROUP_ID, spond_subgroup_id: SG_MAPPED[0] }, WINDOW)
  // Only subGroupId differs: the window, the caps and scheduled are untouched.
  assertEquals(whole.get('subGroupId'), null)
  assertEquals(scoped.get('subGroupId'), SG_MAPPED[0])
  for (const key of ['max', 'scheduled', 'maxStartTimestamp', 'minStartTimestamp', 'groupId']) {
    assertEquals(whole.get(key), scoped.get(key), `${key} must not change`)
  }
  assertEquals(whole.get('scheduled'), 'True')
  assertEquals(whole.get('groupId'), GROUP_ID)
})

Deno.test('the whole group pass reads no member data from the group payload', () => {
  // The only thing taken from a groups/ entry is the subgroup id list. The
  // members array beside it, guardians included, is never consulted.
  const withGuardians = {
    ...SYNTHETIC_GROUP,
    members: [
      {
        id: 'FAKE-MEMBER-3',
        firstName: 'Invented',
        lastName: 'Child',
        email: 'never@example.invalid',
        phoneNumber: '+44 0000 000000',
        guardians: [{ id: 'FAKE-GUARDIAN-9', firstName: 'Invented', lastName: 'Guardian' }],
        subGroups: [SG_UNMAPPED],
      },
    ],
  }
  assertEquals(groupSubgroupIds([withGuardians], GROUP_ID), [...SG_MAPPED, SG_UNMAPPED])
})

// ---- The fail closed gate --------------------------------------------------
//
// The pass may only run when every subgroup was asked AND asked completely.
// Each rule below exists because breaking it would store a subgroup's own
// event as a club event, visible to every team and every parent.

const OPEN_GATE = {
  subgroupIds: [...SG_MAPPED, SG_UNMAPPED],
  mappedSubgroupIds: SG_MAPPED,
  hasWholeGroupMapping: false,
  truncated: false,
}

Deno.test('the gate opens for the real topology and names the unmapped subgroup to ask', () => {
  const gate = wholeGroupGate(OPEN_GATE)
  assert(gate.ok)
  // The sixth subgroup is asked precisely because nothing maps to it.
  assertEquals(gate.unmapped, [SG_UNMAPPED])
})

Deno.test('the gate shuts when the subgroup list is unknown', () => {
  const gate = wholeGroupGate({ ...OPEN_GATE, subgroupIds: null })
  assert(!gate.ok)
  assert(gate.reason.includes('readable subgroup list'))
})

Deno.test('the gate shuts when a subgroup answer was truncated at the cap', () => {
  // An incomplete subgroup list means an event it did not return may still
  // belong to it, so no whole group event may be inferred this run.
  const gate = wholeGroupGate({ ...OPEN_GATE, truncated: true })
  assert(!gate.ok)
  assert(gate.reason.includes(String(MAX_EVENTS_PER_GROUP)))
})

Deno.test('the gate shuts when there are more subgroups than the query cap', () => {
  const many = Array.from({ length: 50 }, (_, i) => `SG-SYNTH-MANY-${i}`)
  const gate = wholeGroupGate({ ...OPEN_GATE, subgroupIds: many })
  assert(!gate.ok)
  assert(gate.reason.includes('subgroups'))
})

Deno.test('the gate stands aside when a whole group mapping already exists', () => {
  const gate = wholeGroupGate({ ...OPEN_GATE, hasWholeGroupMapping: true })
  assert(!gate.ok)
  assert(gate.reason.includes('whole group mapping'))
})

Deno.test('a group with no subgroups at all is a real answer: everything is whole group', () => {
  const gate = wholeGroupGate({ ...OPEN_GATE, subgroupIds: [], mappedSubgroupIds: [] })
  assert(gate.ok)
  assertEquals(gate.unmapped, [])
})

Deno.test('a mapped subgroup Spond no longer lists does not reopen the gate', () => {
  // The mapping names a subgroup the group no longer has. The unmapped set
  // is still derived from what Spond lists, so nothing is left unasked.
  const gate = wholeGroupGate({ ...OPEN_GATE, mappedSubgroupIds: [...SG_MAPPED, 'SG-SYNTH-GONE'] })
  assert(gate.ok)
  assertEquals(gate.unmapped, [SG_UNMAPPED])
})
