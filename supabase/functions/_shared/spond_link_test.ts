// Tests for the Release B Spond logic: the linked member response
// derivation, the response row shape, and the linking candidate
// reduction. Hermetic (no network, no database) and every fixture is
// synthetic: invented ids and invented names, never a real Spond
// payload, even redacted. Run with:
//
//   deno test --allow-env --allow-read supabase/functions/_shared/spond_link_test.ts
//
// The underscore folder is not deployed; this file ships nowhere.
import { assert, assertEquals } from 'jsr:@std/assert@1'
import {
  buildEventRow,
  buildResponseRows,
  deriveMemberStatuses,
  excludeNonPlayers,
  MAX_RESPONSE_IDS_PER_ARRAY,
  memberRoleIds,
  parseIgnoredMemberIds,
  reduceLinkCandidate,
  SPOND_EVENT_COLUMNS,
  SPOND_MEMBER_ID_PATTERN,
  SPOND_RESPONSE_COLUMNS,
} from './spond.ts'

// ---- Synthetic fixtures ----------------------------------------------------

// Invented member ids, uppercase hex like Spond's own, 32 characters.
const LINKED_A = '0123456789ABCDEF0123456789ABCDEF'
const LINKED_B = 'FEDCBA9876543210FEDCBA9876543210'
const UNLINKED = 'AAAABBBBCCCCDDDDEEEEFFFF00001111'
const SYNCED_AT = '2026-08-09T18:00:00.000Z'

const LINKED = new Set([LINKED_A, LINKED_B])

// The response block of a Spond event, invented throughout. It carries an
// unlinked member and an unconfirmed array so the tests can prove neither
// reaches a row.
const SYNTHETIC_RESPONSES = {
  acceptedIds: [LINKED_A, UNLINKED],
  declinedIds: [LINKED_B],
  unansweredIds: [],
  waitinglistIds: [],
  unconfirmedIds: [UNLINKED],
}

// A Spond group member as the reference library's model describes one,
// with invented content throughout. The guardian block and the contact
// fields exist here precisely so the boundary tests can prove they never
// leave the reduction.
const SYNTHETIC_MEMBER = {
  id: LINKED_A,
  firstName: 'Madeup',
  lastName: 'Childname',
  email: 'never@example.invalid',
  phoneNumber: '+440000000000',
  subGroups: ['SUBGROUP-SYNTH-1'],
  guardians: [
    {
      id: 'GUARDIAN-SYNTH-1',
      firstName: 'Invented',
      lastName: 'Guardianname',
      email: 'guardian@example.invalid',
      phoneNumber: '+440000000001',
    },
  ],
  address: { line1: '1 Made Up Lane', city: 'Nowhere' },
}

// ---- The linked only rule --------------------------------------------------

Deno.test('only linked members get a status', () => {
  const statuses = deriveMemberStatuses(SYNTHETIC_RESPONSES, LINKED)
  assertEquals(statuses.map((s) => s.spond_member_id), [LINKED_A, LINKED_B])
  assertEquals(statuses.map((s) => s.status), ['accepted', 'declined'])
})

Deno.test('an empty link set yields nothing, and is not the same as unknown', () => {
  // Empty means "this club has linked nobody", which is a real fact with a
  // real consequence: no rows. UNKNOWN is represented by the caller never
  // calling this at all (see the three state rule in spond-sync), which is
  // why this function takes a Set and not a nullable one.
  assertEquals(deriveMemberStatuses(SYNTHETIC_RESPONSES, new Set()), [])
})

Deno.test('unconfirmedIds is never read', () => {
  const statuses = deriveMemberStatuses({ unconfirmedIds: [LINKED_A] }, LINKED)
  assertEquals(statuses, [])
})

Deno.test('a member in two arrays keeps its first claim, so no row is targeted twice', () => {
  const statuses = deriveMemberStatuses(
    { acceptedIds: [LINKED_A], declinedIds: [LINKED_A], unansweredIds: [LINKED_A] },
    LINKED,
  )
  assertEquals(statuses, [{ spond_member_id: LINKED_A, status: 'accepted' }])
})

Deno.test('the derivation is deterministic: same payload and link set, same order', () => {
  const once = deriveMemberStatuses(SYNTHETIC_RESPONSES, LINKED)
  const twice = deriveMemberStatuses(SYNTHETIC_RESPONSES, LINKED)
  assertEquals(JSON.stringify(once), JSON.stringify(twice))
})

Deno.test('a malformed or missing responses block yields nothing rather than throwing', () => {
  for (const bad of [null, undefined, 'not an object', 42, [], { acceptedIds: 'nope' }]) {
    assertEquals(deriveMemberStatuses(bad, LINKED), [])
  }
})

Deno.test('a non string or malformed id is dropped before it can reach a row', () => {
  const statuses = deriveMemberStatuses(
    { acceptedIds: [null, 42, {}, 'Jack Thompson', 'short', LINKED_A] },
    new Set([...LINKED, 'Jack Thompson', 'short']),
  )
  assertEquals(statuses, [{ spond_member_id: LINKED_A, status: 'accepted' }])
})

Deno.test('each array is capped', () => {
  const many = Array.from({ length: MAX_RESPONSE_IDS_PER_ARRAY + 50 }, () => LINKED_A)
  // All duplicates, so the cap is observed through the slice not throwing
  // and the dedupe leaving exactly one.
  assertEquals(deriveMemberStatuses({ acceptedIds: many }, LINKED).length, 1)
})

// ---- The row shape ---------------------------------------------------------

Deno.test('a response row contains exactly the allowed columns', () => {
  const rows = buildResponseRows('club-1', 'event-row-1', deriveMemberStatuses(SYNTHETIC_RESPONSES, LINKED), SYNCED_AT)
  assertEquals(SPOND_RESPONSE_COLUMNS.length, 5)
  for (const row of rows) {
    assertEquals(Object.keys(row).sort(), [...SPOND_RESPONSE_COLUMNS].sort())
    for (const value of Object.values(row)) {
      assert(typeof value === 'string', 'a response row must carry primitives only')
    }
  }
})

Deno.test('every row carries this run stamp, which is what makes the tail delete safe', () => {
  const rows = buildResponseRows('club-1', 'event-row-1', deriveMemberStatuses(SYNTHETIC_RESPONSES, LINKED), SYNCED_AT)
  assertEquals(rows.length, 2)
  for (const row of rows) {
    assertEquals(row.synced_at, SYNCED_AT)
    assertEquals(row.club_id, 'club-1')
    assertEquals(row.spond_event_id, 'event-row-1')
  }
})

Deno.test('no unlinked member and no payload fragment reaches a row', () => {
  const flat = JSON.stringify(
    buildResponseRows('club-1', 'event-row-1', deriveMemberStatuses(SYNTHETIC_RESPONSES, LINKED), SYNCED_AT),
  )
  assert(!flat.includes(UNLINKED), 'a row leaked an unlinked member id')
  assert(!flat.includes('unconfirmedIds'), 'a row leaked a response array name')
  assert(!flat.includes('acceptedIds'), 'a row leaked a response array name')
})

// ---- The linking candidate -------------------------------------------------

Deno.test('a candidate carries exactly the id and the display name', () => {
  const candidate = reduceLinkCandidate(SYNTHETIC_MEMBER)
  assert(candidate !== null)
  assertEquals(Object.keys(candidate).sort(), ['display_name', 'spond_member_id'])
  assertEquals(candidate.spond_member_id, LINKED_A)
  assertEquals(candidate.display_name, 'Madeup Childname')
})

Deno.test('the candidate carries no guardian, contact, subgroup or address field', () => {
  const flat = JSON.stringify(reduceLinkCandidate(SYNTHETIC_MEMBER))
  for (const forbidden of [
    'guardians',
    'Guardianname',
    'GUARDIAN-SYNTH-1',
    'email',
    'never@example.invalid',
    'guardian@example.invalid',
    'phoneNumber',
    '+440000000000',
    '+440000000001',
    'subGroups',
    'SUBGROUP-SYNTH-1',
    'address',
    'Made Up Lane',
    'Nowhere',
  ]) {
    assert(!flat.includes(forbidden), `the candidate leaked ${forbidden}`)
  }
})

Deno.test('a member whose id the links table would refuse is never offered', () => {
  for (const id of ['Jack Thompson', 'jack.thompson', 'parent@example.invalid', 'short', '', null, 42]) {
    assertEquals(reduceLinkCandidate({ ...SYNTHETIC_MEMBER, id }), null, `offered a candidate with id ${String(id)}`)
  }
})

Deno.test('a member with no usable name is dropped rather than offered nameless', () => {
  assertEquals(reduceLinkCandidate({ id: LINKED_A }), null)
  assertEquals(reduceLinkCandidate({ id: LINKED_A, firstName: '  ', lastName: '' }), null)
})

Deno.test('a lowercase id is normalised to the stored form rather than refused', () => {
  const candidate = reduceLinkCandidate({ ...SYNTHETIC_MEMBER, id: LINKED_A.toLowerCase() })
  assert(candidate !== null)
  assertEquals(candidate.spond_member_id, LINKED_A)
})

// ---- Staff are never offered for linking -----------------------------------
//
// Production, 15 August: a team's "Needs a decision" list held exactly one
// row, the group's manager, because she is a member of the mapped subgroup
// like the children are. Spond's own admin roles are the structural
// signal: a role uid is assigned only to group staff (admins, coaches,
// managers), and a plain participant carries no roles key at all. The
// reduction reads the role uids and nothing else: no role name, no
// guardian, no profile. The backstop for staff the club never assigned a
// role is SPOND_IGNORED_MEMBER_IDS, opaque ids in a function secret,
// where a name cannot even be expressed.

const STAFF_ID = '2222333344445555666677778888AAAA'
const SYNTHETIC_STAFF = {
  id: STAFF_ID,
  firstName: 'Invented',
  lastName: 'Staffname',
  subGroups: ['SUBGROUP-SYNTH-1'],
  roles: ['ROLE-SYNTH-1'],
}

Deno.test('a member carrying a Spond role is staff and never offered', () => {
  const out = excludeNonPlayers([SYNTHETIC_STAFF, SYNTHETIC_MEMBER], new Set<string>())
  assertEquals(out.members, [SYNTHETIC_MEMBER])
  assertEquals(out.staff, 1)
  assertEquals(out.ignored, 0)
})

Deno.test('no roles key and an empty roles list are both plain participants', () => {
  const bare = { id: LINKED_A, firstName: 'Madeup', lastName: 'Childname' }
  const empty = { ...bare, id: LINKED_B, roles: [] }
  const out = excludeNonPlayers([bare, empty], new Set<string>())
  assertEquals(out.members.length, 2)
  assertEquals(out.staff, 0)
})

Deno.test('a malformed roles value is not read as staff', () => {
  // The participant default, the same fail towards offering direction
  // memberSubgroupIds takes: linking stays human approved either way, so
  // a odd shape must not silently hide a child from the list.
  for (const roles of ['admin', 42, { r: 1 }, null]) {
    const out = excludeNonPlayers([{ ...SYNTHETIC_MEMBER, roles }], new Set<string>())
    assertEquals(out.members.length, 1, `roles ${JSON.stringify(roles)} excluded a member`)
    assertEquals(out.staff, 0)
  }
  assertEquals(memberRoleIds({ roles: 'admin' }), [])
  assertEquals(memberRoleIds({}), [])
  assertEquals(memberRoleIds({ roles: ['R1', 42, ''] }), ['R1'])
})

Deno.test('the ignored id config drops a member by opaque id, case folded', () => {
  const ignored = parseIgnoredMemberIds(` ${STAFF_ID.toLowerCase()} , ${LINKED_B}`)
  const out = excludeNonPlayers([{ ...SYNTHETIC_MEMBER, id: STAFF_ID }, SYNTHETIC_MEMBER], ignored)
  assertEquals(out.members, [SYNTHETIC_MEMBER])
  assertEquals(out.ignored, 1)
  assertEquals(out.staff, 0)
})

Deno.test('a config entry that could be a person is dropped rather than matched', () => {
  // The secret takes ids only. A name pasted there must not silently
  // become a match rule, so anything the links table would refuse is
  // discarded on parse.
  const ignored = parseIgnoredMemberIds(`Bekki Staffname, staff@example.invalid, short, ${STAFF_ID}`)
  assertEquals(ignored, new Set([STAFF_ID]))
  assertEquals(parseIgnoredMemberIds(undefined), new Set())
  assertEquals(parseIgnoredMemberIds(''), new Set())
})

Deno.test('exclusion reads roles and the id, never a guardian or contact field', () => {
  // A staff member stays staff with every other field stripped, and a
  // participant stays offered with the sensitive fields present, so the
  // classification provably depends on nothing the boundary forbids.
  const stripped = { id: STAFF_ID, firstName: 'Invented', lastName: 'Staffname', roles: ['ROLE-SYNTH-1'] }
  assertEquals(excludeNonPlayers([stripped], new Set<string>()).staff, 1)
  assertEquals(excludeNonPlayers([SYNTHETIC_MEMBER], new Set<string>()).members.length, 1)
})

// ---- The member id pattern, the column boundary in code --------------------

Deno.test('the member id pattern refuses anything that could be a person', () => {
  for (const value of [
    'Jack Thompson',
    'Jack_Thompson',
    'Jack-Thompson',
    'jackthompson',
    'parent@example.invalid',
    '+447700900000',
    '1 Made Up Lane',
    '',
  ]) {
    assert(!SPOND_MEMBER_ID_PATTERN.test(value), `the pattern accepted ${value}`)
  }
  assert(SPOND_MEMBER_ID_PATTERN.test(LINKED_A), 'the pattern refused a real shaped id')
  assert(SPOND_MEMBER_ID_PATTERN.test('0123456789ABCDEF'), 'the pattern refused the minimum length')
})

// ---- Release B beside the whole group event path ---------------------------
//
// Brought forward onto current main. Main added a second event source, the
// whole group pass, which is where this club's weekly TRAINING is discovered:
// an event addressed to the parent group rather than to any subgroup, stored
// with team_id null. Release B's reconcile originally ran only inside the per
// mapping loop, so training, the one session a coach actually runs a register
// for, would have been the only thing in the club with no replies beside the
// names. These pin that the two fit together and that neither weakened the
// other.

// A whole group training event, invented throughout, in the shape the group
// wide query returns: no subgroup, and a responses block like any other.
const SYNTHETIC_WHOLE_GROUP_TRAINING = {
  id: 'EVT-SYNTH-WHOLE-GROUP-TRAINING',
  heading: 'Training',
  startTimestamp: '2026-08-11T17:45:00Z',
  endTimestamp: '2026-08-11T18:45:00Z',
  responses: SYNTHETIC_RESPONSES,
  recipients: {
    group: { id: 'GRP-SYNTH-1', members: [{ id: LINKED_A, firstName: 'Invented', lastName: 'Childname' }] },
  },
}

Deno.test('a whole group training event is a club event: team_id null, same column set', () => {
  const row = buildEventRow('club-1', null, SYNTHETIC_WHOLE_GROUP_TRAINING, SYNCED_AT)
  assert(row !== null)
  assertEquals(row.team_id, null)
  assertEquals(row.title, 'Training')
  // Release B did not widen the aggregate event row by a single column.
  assertEquals(Object.keys(row).sort(), [...SPOND_EVENT_COLUMNS].sort())
})

Deno.test('linked members get RSVP context on a whole group event, exactly as on a subgroup one', () => {
  // The reconcile is one implementation with two callers; this proves the
  // derivation it runs is source agnostic, so training gets context too.
  const statuses = deriveMemberStatuses(SYNTHETIC_WHOLE_GROUP_TRAINING.responses, LINKED)
  const rows = buildResponseRows('club-1', 'EVENT-ROW-UUID-WHOLE-GROUP', statuses, SYNCED_AT)
  assertEquals(rows.length, 2)
  assertEquals(new Set(rows.map((r) => r.spond_member_id)), new Set([LINKED_A, LINKED_B]))
  for (const r of rows) {
    assertEquals(Object.keys(r).sort(), [...SPOND_RESPONSE_COLUMNS].sort())
    assertEquals(r.synced_at, SYNCED_AT)
  }
})

Deno.test('the unlinked member is absent from a whole group event too', () => {
  // The sixth, unmapped subgroup's children are exactly the people who will
  // not be linked. A whole group event must not become a way to store them.
  const statuses = deriveMemberStatuses(SYNTHETIC_WHOLE_GROUP_TRAINING.responses, LINKED)
  const rows = buildResponseRows('club-1', 'EVENT-ROW-UUID-WHOLE-GROUP', statuses, SYNCED_AT)
  const flat = JSON.stringify(rows)
  assert(!flat.includes(UNLINKED), 'an unlinked member reached a whole group response row')
})

Deno.test('no name or payload fragment reaches a whole group event row or its responses', () => {
  const row = buildEventRow('club-1', null, SYNTHETIC_WHOLE_GROUP_TRAINING, SYNCED_AT)
  const statuses = deriveMemberStatuses(SYNTHETIC_WHOLE_GROUP_TRAINING.responses, LINKED)
  const rows = buildResponseRows('club-1', 'EVENT-ROW-UUID-WHOLE-GROUP', statuses, SYNCED_AT)
  const flat = JSON.stringify(row) + JSON.stringify(rows)
  for (const leak of ['Invented', 'Childname', 'recipients', 'acceptedIds', 'unconfirmedIds', 'GRP-SYNTH-1']) {
    assert(!flat.includes(leak), `the whole group path leaked ${leak}`)
  }
})

Deno.test('a KNOWN EMPTY link set writes no rows for a whole group event', () => {
  // Known empty, not unknown: the two are different states and only this one
  // reaches the derivation at all. "The club linked nobody" yields no rows.
  // UNKNOWN never gets here, because reconcileResponses returns before the
  // loop when linked === null, which is what stops a failed or capped link
  // read from deleting live context.
  const statuses = deriveMemberStatuses(SYNTHETIC_WHOLE_GROUP_TRAINING.responses, new Set<string>())
  assertEquals(buildResponseRows('club-1', 'EVENT-ROW-UUID-WHOLE-GROUP', statuses, SYNCED_AT), [])
})
