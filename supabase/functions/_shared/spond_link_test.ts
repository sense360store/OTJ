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
  collectLinkCandidates,
  collectLinkDiagnostics,
  collectRosterMembers,
  deriveMemberStatuses,
  diagnosticsProved,
  excludeNonPlayers,
  linkCollectionWarnings,
  MAX_RESPONSE_IDS_PER_ARRAY,
  MAX_ROSTER_MEMBERS,
  memberRoleIds,
  parseIgnoredMemberIds,
  reduceDiagnosticMember,
  reduceLinkCandidate,
  rosterCollectionWarnings,
  scanGroupMembers,
  SPOND_DIAGNOSTIC_MEMBER_FIELDS,
  SPOND_EVENT_COLUMNS,
  SPOND_MEMBER_ID_PATTERN,
  SPOND_RESPONSE_COLUMNS,
} from './spond.ts'
import type { SpondMapping } from './spond.ts'

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

Deno.test('no roles key and an empty roles list are both plain participants, kept in order', () => {
  const bare = { id: LINKED_A, firstName: 'Madeup', lastName: 'Childname' }
  const empty = { ...bare, id: LINKED_B, roles: [] }
  const out = excludeNonPlayers([bare, empty], new Set<string>())
  // Deep equality, order included: candidate order flows unsorted to the
  // screen and decides what a cap truncates.
  assertEquals(out.members, [bare, empty])
  assertEquals(out.staff, 0)
})

Deno.test('a lowercase payload id still matches the ignore config', () => {
  // The suite already accepts lowercase ids from Spond
  // (reduceLinkCandidate normalises them), so the backstop must fold the
  // payload side too, not only the config side.
  const lower = { ...SYNTHETIC_MEMBER, id: STAFF_ID.toLowerCase() }
  const out = excludeNonPlayers([lower], parseIgnoredMemberIds(STAFF_ID))
  assertEquals(out.members, [])
  assertEquals(out.ignored, 1)
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

// ---- The collection rule, executed rather than trusted ---------------------
//
// The loop these functions replace lived in the two index.ts files, where
// no test runs: a review moved the cap ahead of the exclusion and reworded
// a warning to carry names, both with every test green. The rule is pure
// in spond.ts now and these hold all of it: exclusion before the cap,
// dedupe across mappings for members and for excluded people, and
// warnings that carry counts and mapping labels only.

const SG1 = 'SUBGROUP-SYNTH-1'
const SG2 = 'SUBGROUP-SYNTH-2'
const GROUP_ID = 'GRP-SYNTH-1'

const mapping = (subgroup: string | null, name = 'SYNTH SG'): SpondMapping => ({
  id: `map-${subgroup ?? 'whole'}`,
  spond_group_id: GROUP_ID,
  spond_subgroup_id: subgroup,
  spond_name: name,
  team_id: 'team-1',
})

const participant = (id: string, first: string, subGroups: string[] = [SG1]) => ({
  id,
  firstName: first,
  lastName: 'Synthetic',
  subGroups,
})

const groupsPayload = (members: unknown[]) => [{ id: GROUP_ID, members }]

Deno.test('exclusion runs before the cap, so staff never consume a candidate slot', () => {
  const members = [
    { ...participant(STAFF_ID, 'Staffperson'), roles: ['ROLE-SYNTH-1'] },
    participant(LINKED_A, 'Alpha'),
    participant(LINKED_B, 'Beta'),
  ]
  const out = collectLinkCandidates(groupsPayload(members), [mapping(SG1)], new Set<string>(), 2)
  assertEquals(out.members.map((m) => m.spond_member_id), [LINKED_A, LINKED_B])
  assertEquals(out.truncated, false)
  assertEquals(out.staff, 1)
})

Deno.test('the cap still truncates a genuine overflow, in input order', () => {
  const members = [participant(LINKED_A, 'Alpha'), participant(LINKED_B, 'Beta'), participant(UNLINKED, 'Gamma')]
  const out = collectLinkCandidates(groupsPayload(members), [mapping(SG1)], new Set<string>(), 2)
  assertEquals(out.members.map((m) => m.spond_member_id), [LINKED_A, LINKED_B])
  assertEquals(out.truncated, true)
})

Deno.test('a staff member in two of the team s mappings is one person, counted once', () => {
  const members = [
    { ...participant(STAFF_ID, 'Staffperson', [SG1, SG2]), roles: ['ROLE-SYNTH-1'] },
    participant(LINKED_A, 'Alpha', [SG1]),
    participant(LINKED_B, 'Beta', [SG2]),
  ]
  const out = collectLinkCandidates(groupsPayload(members), [mapping(SG1), mapping(SG2, 'SYNTH SG2')], new Set<string>())
  assertEquals(out.staff, 1)
  assertEquals(out.members.length, 2)
})

Deno.test('an empty mapping is reported by its label, and the rest continue', () => {
  const out = collectLinkCandidates(
    groupsPayload([participant(LINKED_A, 'Alpha', [SG1])]),
    [mapping(SG1), mapping(SG2, 'EMPTY SG')],
    new Set<string>(),
  )
  assertEquals(out.emptyMappings, ['EMPTY SG'])
  assertEquals(out.members.length, 1)
})

Deno.test('warnings carry counts and mapping labels, never a member name or id', () => {
  const members = [
    { ...participant(STAFF_ID, 'Staffperson'), roles: ['ROLE-SYNTH-1'] },
    { ...participant(LINKED_A, 'Alpha'), id: 'not-a-real-id' },
    participant(LINKED_B, 'Beta'),
  ]
  const collected = collectLinkCandidates(groupsPayload(members), [mapping(SG1), mapping(SG2, 'EMPTY SG')], new Set<string>(), 1)
  const warnings = linkCollectionWarnings(collected, 1)
  const flat = warnings.join(' ')
  assert(flat.includes('1 Spond staff member (group role holder)'), flat)
  assert(flat.includes('EMPTY SG'), flat)
  for (const leak of ['Staffperson', 'Alpha', 'Beta', 'Synthetic', STAFF_ID, LINKED_A, LINKED_B]) {
    assert(!flat.includes(leak), `a warning leaked ${leak}`)
  }
})

Deno.test('the roster collection applies the same exclusions and reports the same shape', () => {
  const members = [
    { ...participant(STAFF_ID, 'Staffperson'), roles: ['ROLE-SYNTH-1'] },
    participant(LINKED_A, 'Alpha'),
  ]
  const out = collectRosterMembers(groupsPayload(members), [mapping(SG1)], parseIgnoredMemberIds(LINKED_A))
  assertEquals(out.members, [])
  assertEquals(out.staff, 1)
  assertEquals(out.ignored, 1)
  const flat = rosterCollectionWarnings(out).join(' ')
  assert(flat.includes('staff are never imported as players'), flat)
  for (const leak of ['Staffperson', 'Alpha', STAFF_ID, LINKED_A]) {
    assert(!flat.includes(leak), `a roster warning leaked ${leak}`)
  }
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

// ---- The setup diagnostics: the parent group the mapping misses ------------
//
// Production, 15 August: an Argonauts registered player showed under
// "not matched yet", and Spond showed that child present in the club's
// parent group with NO team assigned. The candidate list is scoped to the
// mapped subgroup, so that member was simply absent from it, which is
// indistinguishable from a member in another subgroup and from a family
// who is not in the group at all. collectLinkDiagnostics reads the SAME
// already fetched groups payload and returns the members the mapping does
// not reach, so the screen can tell the three apart.
//
// These pin the whole rule: staff first, the mapped subgroup excluded, the
// closed two field shape, the dedupe, and every way the scan can fail to
// prove absence.

const OUTSIDE_A = '1111222233334444555566667777AAAA'
const OUTSIDE_B = 'BBBB222233334444555566667777CCCC'
const SG3 = 'SUBGROUP-SYNTH-3'
const GROUP_TWO = 'GRP-SYNTH-2'

const diagnose = (
  members: unknown[],
  mappings: SpondMapping[] = [mapping(SG1)],
  ignored: ReadonlySet<string> = new Set<string>(),
  max?: number,
) => collectLinkDiagnostics(groupsPayload(members), mappings, ignored, max)

Deno.test('a member with no subgroups is returned, with an empty subgroup list', () => {
  const out = diagnose([participant(OUTSIDE_A, 'Outside', [])])
  assertEquals(out.complete, true)
  assertEquals(out.members, [
    { display_name: 'Outside Synthetic', spond_member_id: OUTSIDE_A, subgroup_ids: [] },
  ])
})

Deno.test('a member the team mapping already reaches is not in the diagnostics', () => {
  // They are a candidate; this list is who the mapping MISSES.
  const out = diagnose([participant(LINKED_A, 'Alpha', [SG1])])
  assertEquals(out.members, [])
  assertEquals(out.complete, true)
})

Deno.test('a member in another subgroup is returned with that subgroup id', () => {
  const out = diagnose([participant(OUTSIDE_A, 'Outside', [SG2])])
  assertEquals(out.members, [
    { display_name: 'Outside Synthetic', spond_member_id: OUTSIDE_A, subgroup_ids: [SG2] },
  ])
})

Deno.test('a member in one of the team s OTHER mappings is reached, not missed', () => {
  const out = diagnose([participant(OUTSIDE_A, 'Outside', [SG2])], [mapping(SG1), mapping(SG2, 'SYNTH SG2')])
  assertEquals(out.members, [])
})

Deno.test('two same named members are BOTH returned, so the screen reads ambiguity', () => {
  // The fail closed rule lives on the client, and it can only fire if the
  // server hands it both. Folding them here would manufacture a false
  // identity out of a name collision.
  const out = diagnose([participant(OUTSIDE_A, 'Outside', []), participant(OUTSIDE_B, 'Outside', [SG2])])
  assertEquals(out.members.length, 2)
  assertEquals(out.members.map((m) => m.display_name), ['Outside Synthetic', 'Outside Synthetic'])
})

Deno.test('a subgroup mapped through the team s OTHER group still counts as reached', () => {
  // The team maps two parent groups. A member listed under the first is
  // also in the second group's mapped subgroup, so they are already a
  // candidate; keeping the reached set per group would report them as
  // missing from the first and produce a false second row of that name.
  const groups = [
    { id: GROUP_ID, members: [participant(OUTSIDE_A, 'Outside', [SG3])] },
    { id: GROUP_TWO, members: [participant(OUTSIDE_A, 'Outside', [SG3])] },
  ]
  const twoGroups: SpondMapping[] = [
    mapping(SG1),
    { id: 'map-two', spond_group_id: GROUP_TWO, spond_subgroup_id: SG3, spond_name: 'SYNTH G2', team_id: 'team-1' },
  ]
  const out = collectLinkDiagnostics(groups, twoGroups, new Set<string>())
  assertEquals(out.members, [])
  assertEquals(out.complete, true)
})

Deno.test('one person in two of the team s mapped groups is returned once', () => {
  const shared = participant(OUTSIDE_A, 'Outside', [SG3])
  const groups = [
    { id: GROUP_ID, members: [shared] },
    { id: GROUP_TWO, members: [shared] },
  ]
  const twoGroups: SpondMapping[] = [
    mapping(SG1),
    { id: 'map-two', spond_group_id: GROUP_TWO, spond_subgroup_id: SG2, spond_name: 'SYNTH G2', team_id: 'team-1' },
  ]
  const out = collectLinkDiagnostics(groups, twoGroups, new Set<string>())
  assertEquals(out.members.length, 1)
  assertEquals(out.complete, true)
})

Deno.test('staff never appear in the diagnostics, whatever subgroup they are in', () => {
  const out = diagnose([
    { ...participant(STAFF_ID, 'Staffperson', [SG2]), roles: ['ROLE-SYNTH-1'] },
    participant(OUTSIDE_A, 'Outside', [SG2]),
  ])
  assertEquals(out.members.map((m) => m.display_name), ['Outside Synthetic'])
})

Deno.test('a staff member with NO subgroup is excluded too, the production shape inverted', () => {
  // The whole point of the diagnostics is to surface members with no
  // subgroup. A manager who happens to have none must not become one.
  const out = diagnose([{ ...participant(STAFF_ID, 'Staffperson', []), roles: ['ROLE-SYNTH-1'] }])
  assertEquals(out.members, [])
  assertEquals(out.complete, true)
})

Deno.test('an admin ignored member id never appears in the diagnostics', () => {
  const out = diagnose(
    [participant(OUTSIDE_A, 'Outside', []), participant(OUTSIDE_B, 'Other', [])],
    [mapping(SG1)],
    parseIgnoredMemberIds(OUTSIDE_A.toLowerCase()),
  )
  assertEquals(out.members.map((m) => m.display_name), ['Other Synthetic'])
})

Deno.test('a whole group mapping misses nobody, and the scan still counts as proved', () => {
  const out = diagnose([participant(OUTSIDE_A, 'Outside', [SG2])], [mapping(null, 'WHOLE GROUP')])
  assertEquals(out.members, [])
  assertEquals(out.complete, true)
})

// ---- Every way absence stops being provable --------------------------------

Deno.test('a group the organiser account cannot see proves nothing', () => {
  const out = collectLinkDiagnostics([{ id: 'GRP-SOMEWHERE-ELSE', members: [] }], [mapping(SG1)], new Set<string>())
  assertEquals(out.complete, false)
  assertEquals(out.members, [])
})

Deno.test('a malformed groups payload proves nothing', () => {
  for (const bad of [null, undefined, 'not an array', 42, {}, [{ id: GROUP_ID }], [{ id: GROUP_ID, members: 'no' }]]) {
    const out = collectLinkDiagnostics(bad, [mapping(SG1)], new Set<string>())
    assertEquals(out.complete, false, `payload ${JSON.stringify(bad)} was treated as proved`)
    assertEquals(out.members, [])
  }
})

Deno.test('no mapping at all proves nothing, rather than proving an empty group', () => {
  const out = collectLinkDiagnostics(groupsPayload([participant(OUTSIDE_A, 'Outside', [])]), [], new Set<string>())
  assertEquals(out.complete, false)
  assertEquals(out.members, [])
})

Deno.test('a parent group larger than the cap proves nothing, and returns nothing', () => {
  const many = Array.from({ length: 5 }, (_, i) => participant(`${i}`.repeat(32), `Person${i}`, []))
  const out = diagnose(many, [mapping(SG1)], new Set<string>(), 3)
  assertEquals(out.complete, false)
  assertEquals(out.members, [])
})

Deno.test('rows accumulated across two mapped groups still stop at the cap', () => {
  // Each group fits the scan cap on its own; together they overrun the
  // emitted cap. Both caps land on the same answer, and neither returns a
  // short list wearing "this is the whole group".
  // Nobody sits in either mapped subgroup, so every member is outside.
  const groups = [
    { id: GROUP_ID, members: [participant(OUTSIDE_A, 'One', [SG3]), participant(OUTSIDE_B, 'Two', [SG3])] },
    { id: GROUP_TWO, members: [participant('CCCC222233334444555566667777DDDD', 'Three', [SG3])] },
  ]
  const twoGroups: SpondMapping[] = [
    mapping(SG1),
    { id: 'map-two', spond_group_id: GROUP_TWO, spond_subgroup_id: SG2, spond_name: 'SYNTH G2', team_id: 'team-1' },
  ]
  const out = collectLinkDiagnostics(groups, twoGroups, new Set<string>(), 2)
  assertEquals(out.complete, false)
  assertEquals(out.members, [])
})

Deno.test('one unreadable group among several proves nothing for any of them', () => {
  // The scan is one answer about a team, not one per group. A group the
  // organiser account cannot see could hold the very member a "not found"
  // row would deny exists, so a partial scan returns nothing at all.
  const groups = [{ id: GROUP_ID, members: [participant(OUTSIDE_A, 'One', [SG2])] }]
  const twoGroups: SpondMapping[] = [
    mapping(SG1),
    { id: 'map-two', spond_group_id: GROUP_TWO, spond_subgroup_id: SG3, spond_name: 'SYNTH G2', team_id: 'team-1' },
  ]
  const out = collectLinkDiagnostics(groups, twoGroups, new Set<string>())
  assertEquals(out.complete, false)
  assertEquals(out.members, [])
})

// ---- The shape, and what it may never carry --------------------------------

Deno.test('a diagnostic row carries exactly the three allowed fields', () => {
  const row = reduceDiagnosticMember(SYNTHETIC_MEMBER)
  assert(row !== null)
  assertEquals(Object.keys(row).sort(), [...SPOND_DIAGNOSTIC_MEMBER_FIELDS].sort())
  assertEquals(SPOND_DIAGNOSTIC_MEMBER_FIELDS.length, 3)
  assertEquals(row.display_name, 'Madeup Childname')
  assertEquals(row.spond_member_id, LINKED_A)
  assertEquals(row.subgroup_ids, ['SUBGROUP-SYNTH-1'])
})

// THE AMENDMENT, and the rule that replaced the one it removes. A diagnostic
// row carried no member id while the screen could only DESCRIBE a mismatch.
// The team reconciliation must resolve an already linked child BY IDENTITY,
// which is the whole reason it is not a name match, and a child who is not
// linked cannot be bound to a member that has no id to bind. So the id is on
// the row deliberately, and what keeps it honest is the ACTION rule rather
// than the payload: nothing links and nothing moves without an explicit
// human press on a row the ambiguity rules have already proved unambiguous,
// and the database refuses to move an unlinked child at all.
Deno.test('a diagnostic row carries the member id, in the shape the links table accepts', () => {
  const rows = diagnose([participant(OUTSIDE_A, 'Outside', [SG2])]).members
  assertEquals(rows.length, 1)
  assertEquals(rows[0].spond_member_id, OUTSIDE_A)
  assert(/^[0-9A-F]{16,64}$/.test(rows[0].spond_member_id))
})

Deno.test('an id the links table would refuse becomes no identity, not a bad one', () => {
  // Empty string rather than a missing field, so the shape stays closed and
  // assertable; the client reads '' as no identity and offers no action. The
  // row itself survives, because the name based sentences this scan powers
  // are unaffected by an unusable id and dropping the row would silently
  // delete a finding.
  for (const id of ['not-a-member-id', 'jack.thompson', '', 'ABCDEF', 12345, null, undefined]) {
    const row = reduceDiagnosticMember({ ...SYNTHETIC_MEMBER, id })
    assert(row !== null, `dropped the row for id ${String(id)}`)
    assertEquals(row.spond_member_id, '', `kept an unusable id ${String(id)}`)
  }
  // And a lowercase id is normalised to the stored form rather than refused,
  // exactly as the candidate reduction does.
  const lower = reduceDiagnosticMember({ ...SYNTHETIC_MEMBER, id: LINKED_A.toLowerCase() })
  assertEquals(lower?.spond_member_id, LINKED_A)
})

Deno.test('the id a row carries is the id the scan folded duplicates on', () => {
  // One person listed under two of the team's mapped parent groups appears
  // once. Reading the fold off the reduced row rather than the payload a
  // second time is what stops the id that folds and the id that is returned
  // from ever being two different strings.
  const groups = [
    { id: GROUP_ID, members: [participant(OUTSIDE_A, 'Outside', [SG2])] },
    { id: 'GROUP-SYNTH-2', members: [participant(OUTSIDE_A.toLowerCase(), 'Outside', [SG2])] },
  ]
  const twoGroups = [mapping(SG1), { ...mapping(SG1), spond_group_id: 'GROUP-SYNTH-2' }]
  const out = collectLinkDiagnostics(groups, twoGroups, new Set<string>())
  assertEquals(out.members.length, 1)
  assertEquals(out.members[0].spond_member_id, OUTSIDE_A)
})

Deno.test('a diagnostic row carries no guardian, contact or address field', () => {
  const flat = JSON.stringify(collectLinkDiagnostics(
    [{ id: GROUP_ID, members: [{ ...SYNTHETIC_MEMBER, subGroups: [SG2] }] }],
    [mapping(SG1)],
    new Set<string>(),
  ))
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
    'address',
    'Made Up Lane',
    'Nowhere',
    'roles',
    // The roles list the staff exclusion reads in memory and never returns.
    'ROLE-SYNTH-1',
  ]) {
    assert(!flat.includes(forbidden), `the diagnostics leaked ${forbidden}`)
  }
})

Deno.test('a member with no readable name has no diagnostic row of its own', () => {
  // The reduction still refuses it: there is no name to put on a row. What
  // it does NOT do any more is let the scan call itself complete, which is
  // the corrected half pinned below under the reconciliation heading.
  assertEquals(reduceDiagnosticMember({ id: OUTSIDE_A }), null)
  const out = diagnose([{ id: OUTSIDE_A, subGroups: [SG2] }, participant(OUTSIDE_B, 'Outside', [SG2])])
  assertEquals(out.members, [])
  assertEquals(out.complete, false)
})

Deno.test('the diagnostics never widen the candidate shape', () => {
  // LinkCandidate is unchanged by the reconciliation, and that was a
  // decision rather than an oversight. Adding subgroup_ids to it would have
  // told the reconciliation whether a member of THIS team's subgroup is also
  // in another team's, and the answer to that question is "offer nothing"
  // either way, so the two field boundary the deploy workflow asserts buys
  // more than the precision would.
  const candidate = reduceLinkCandidate(SYNTHETIC_MEMBER)
  assert(candidate !== null)
  assertEquals(Object.keys(candidate).sort(), ['display_name', 'spond_member_id'])
})

// ---- The scan's two flags, which is what makes absence provable at all -----

Deno.test('a scoped read the cap cut short says so, rather than slicing in silence', () => {
  const members = [participant(LINKED_A, 'Alpha'), participant(LINKED_B, 'Beta'), participant(UNLINKED, 'Gamma')]
  const cut = scanGroupMembers(groupsPayload(members), GROUP_ID, null, 2)
  assertEquals(cut.truncated, true)
  assertEquals(cut.found, true)
  assertEquals(cut.members.length, 2)
  const whole = scanGroupMembers(groupsPayload(members), GROUP_ID, null, 3)
  assertEquals(whole.truncated, false)
  assertEquals(whole.members.length, 3)
})

Deno.test('a group that is absent is not found, which is not the same as empty', () => {
  assertEquals(scanGroupMembers(groupsPayload([]), 'GRP-NOT-THERE', null).found, false)
  assertEquals(scanGroupMembers(groupsPayload([]), GROUP_ID, null).found, true)
  assertEquals(scanGroupMembers([{ id: GROUP_ID }], GROUP_ID, null).found, false)
})

Deno.test('a candidate collection whose scoped read was cut short is truncated', () => {
  // Before this the per group slice was silent, so a group larger than the
  // slice returned a short list that the screen read as the whole group
  // and made absence claims from.
  const members = Array.from({ length: MAX_ROSTER_MEMBERS + 3 }, (_, i) =>
    participant(`${(i % 10)}`.repeat(32), `Person${i}`, [SG1]))
  const out = collectLinkCandidates(groupsPayload(members), [mapping(SG1)], new Set<string>())
  assertEquals(out.truncated, true)
})

Deno.test('a scoped read cut short still lets the remaining mappings contribute', () => {
  // Truncation is a fact to report, not a reason to stop: the second
  // mapping's members are still worth offering.
  const many = Array.from({ length: MAX_ROSTER_MEMBERS + 1 }, (_, i) =>
    participant(`${(i % 10)}`.repeat(32), `Person${i}`, [SG1]))
  const out = collectLinkCandidates(
    groupsPayload([...many, participant(OUTSIDE_A, 'Outside', [SG2])]),
    [mapping(SG1), mapping(SG2, 'SYNTH SG2')],
    new Set<string>(),
  )
  assertEquals(out.truncated, true)
  assert(
    out.members.some((m) => m.spond_member_id === OUTSIDE_A),
    'the second mapping was skipped because the first was truncated',
  )
})

// ---- Reconciling the two collections, the hole a review reproduced -------
//
// A member sitting in the team's OWN mapped subgroup whose id the links
// table would refuse is dropped by the candidate reduction and skipped by
// the diagnostics, because the subgroup they sit in IS reached. They exist
// in neither list, and the screen said "Not found in Spond group data"
// about a child who was right there. The diagnostic scan cannot see that
// on its own: it read a whole group and is honestly complete. Only the
// reconciliation against the candidate collection knows a name went
// missing, which is why the rule is a function and not a comment.

Deno.test('a dropped candidate makes the diagnostics unprovable, though the scan is complete', () => {
  const groups = groupsPayload([
    // In the mapped subgroup, but the links table would refuse this id.
    { id: 'a1b2c3d4-e5f6', firstName: 'Unreadable', lastName: 'Synthetic', subGroups: [SG1] },
    participant(OUTSIDE_A, 'Outside', [SG2]),
  ])
  const ignored = new Set<string>()
  const collected = collectLinkCandidates(groups, [mapping(SG1)], ignored)
  const diagnostics = collectLinkDiagnostics(groups, [mapping(SG1)], ignored)
  assertEquals(collected.dropped, 1)
  assertEquals(diagnostics.complete, true)
  assertEquals(diagnosticsProved(diagnostics, collected), false)
})

Deno.test('a truncated candidate pass makes the diagnostics unprovable too', () => {
  // Members of the mapped subgroup the cap never read are names we never
  // saw, which is the same argument one step along.
  const many = Array.from({ length: MAX_ROSTER_MEMBERS + 1 }, (_, i) =>
    participant(`${i % 10}`.repeat(32), `Person${i}`, [SG1]))
  const groups = groupsPayload([...many, participant(OUTSIDE_A, 'Outside', [SG2])])
  const ignored = new Set<string>()
  const collected = collectLinkCandidates(groups, [mapping(SG1)], ignored)
  const diagnostics = collectLinkDiagnostics(groups, [mapping(SG1)], ignored)
  assertEquals(collected.truncated, true)
  assertEquals(diagnosticsProved(diagnostics, collected), false)
})

Deno.test('a clean pair is proved, so the reconciliation is not simply always false', () => {
  const groups = groupsPayload([participant(LINKED_A, 'Alpha', [SG1]), participant(OUTSIDE_A, 'Outside', [SG2])])
  const ignored = new Set<string>()
  const collected = collectLinkCandidates(groups, [mapping(SG1)], ignored)
  const diagnostics = collectLinkDiagnostics(groups, [mapping(SG1)], ignored)
  assertEquals(collected.dropped, 0)
  assertEquals(collected.truncated, false)
  assertEquals(diagnosticsProved(diagnostics, collected), true)
})

Deno.test('a member outside the mapping with no readable name is a name we do not know', () => {
  // The scan's own half of the same rule. An earlier version kept the scan
  // complete here, reasoning the member "carries no name that could match"
  // either way; an unreadable name is not the same as no name.
  const out = diagnose([{ id: OUTSIDE_A, subGroups: [SG2] }, participant(OUTSIDE_B, 'Outside', [SG2])])
  assertEquals(out.complete, false)
  assertEquals(out.members, [])
})

Deno.test('a scoped cap names its own cause, not the whole group remedy', () => {
  // A team already mapped to its subgroup, whose subgroup is simply larger
  // than the per group read, was told "Map this team to its Spond subgroup
  // rather than the whole group" (advice it had already taken) beside a
  // figure naming a cap that never applied.
  const many = Array.from({ length: MAX_ROSTER_MEMBERS + 1 }, (_, i) =>
    participant(`${i % 10}`.repeat(32), `Person${i}`, [SG1]))
  const out = collectLinkCandidates(groupsPayload(many), [mapping(SG1)], new Set<string>())
  assertEquals(out.truncated, true)
  assertEquals(out.scopeTruncated, true)
  const flat = linkCollectionWarnings(out).join(' ')
  assert(flat.includes(`more than ${MAX_ROSTER_MEMBERS} members`), flat)
  assert(!flat.includes('rather than the whole group'), flat)
})

Deno.test('the whole group cap still gets the whole group remedy', () => {
  const members = [participant(LINKED_A, 'Alpha'), participant(LINKED_B, 'Beta'), participant(UNLINKED, 'Gamma')]
  const out = collectLinkCandidates(groupsPayload(members), [mapping(SG1)], new Set<string>(), 2)
  assertEquals(out.truncated, true)
  assertEquals(out.scopeTruncated, false)
  const flat = linkCollectionWarnings(out, 2).join(' ')
  assert(flat.includes('rather than the whole group'), flat)
})
