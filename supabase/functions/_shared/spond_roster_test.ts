// Tests for the roster import reduction, the one place the Spond pipeline
// reads member names. These are hermetic (no network, no database) and
// every fixture is synthetic: invented member names and ids, never a real
// Spond payload, even redacted. They pin the parts that can be wrong
// quietly: the name form (full name to first name plus last initial, the
// single name fallback, the 40 char bound), the shirt number read, the
// subgroup scoping of members, and the de-dupe, including the name
// boundary expressed as a test (guardian and contact fields ignored).
// Run with:
//
//   deno test --allow-env --allow-read supabase/functions/_shared/spond_roster_test.ts
//
// The underscore folder is not deployed; this file ships nowhere.
import { assert, assertEquals } from 'jsr:@std/assert@1'
import {
  MAX_ROSTER_MEMBERS,
  memberSubgroupIds,
  planRosterImport,
  reduceMember,
  rosterDisplayName,
  rosterShirtNumber,
  ROSTER_NAME_MAX,
  selectGroupMembers,
} from './spond.ts'

// ---- Synthetic fixtures, invented names and ids only -----------------------

// A child as a Spond group member, with an adult in the guardians sub array
// and contact fields on both, all invented. The boundary tests below prove
// none of the guardian or contact data reaches a roster row.
const SYNTHETIC_MEMBER = {
  id: 'FAKE-MEMBER-1',
  firstName: 'Jack',
  lastName: 'Thompson',
  email: 'made-up-child@example.invalid',
  phoneNumber: '+44 0000 000000',
  subGroups: ['SUB-SYNTH-7'],
  guardians: [
    {
      id: 'FAKE-GUARDIAN-9',
      firstName: 'Madeup',
      lastName: 'Guardianname',
      email: 'made-up-parent@example.invalid',
      phoneNumber: '+44 1111 111111',
    },
  ],
}

// ---- The name form ----------------------------------------------------------

Deno.test('a full name becomes the first name plus the last initial', () => {
  assertEquals(rosterDisplayName(SYNTHETIC_MEMBER), 'Jack T')
  assertEquals(rosterDisplayName({ firstName: 'Amara', lastName: 'okafor' }), 'Amara O')
})

Deno.test('a single name field is stored as is', () => {
  assertEquals(rosterDisplayName({ firstName: 'Sam' }), 'Sam')
  assertEquals(rosterDisplayName({ lastName: 'Rivers' }), 'Rivers')
  assertEquals(rosterDisplayName({ firstName: '  Lee  ' }), 'Lee')
})

Deno.test('a member with no usable name yields null', () => {
  assertEquals(rosterDisplayName({}), null)
  assertEquals(rosterDisplayName({ firstName: '  ', lastName: '' }), null)
  assertEquals(rosterDisplayName(null), null)
  assertEquals(rosterDisplayName('junk'), null)
  assertEquals(rosterDisplayName({ firstName: 7, lastName: 8 }), null)
})

Deno.test('the name is clamped to the roster 40 char bound', () => {
  const longFirst = 'A'.repeat(60)
  const out = rosterDisplayName({ firstName: longFirst, lastName: 'Smith' })
  assert(out !== null)
  assertEquals(out.length, ROSTER_NAME_MAX)
  assertEquals(ROSTER_NAME_MAX, 40)
})

// ---- The shirt number -------------------------------------------------------

Deno.test('a shirt or jersey number is read when present and a valid football number', () => {
  assertEquals(rosterShirtNumber({ shirtNumber: 9 }), 9)
  assertEquals(rosterShirtNumber({ shirtNumber: '10' }), 10)
  assertEquals(rosterShirtNumber({ jerseyNumber: 7 }), 7)
  assertEquals(rosterShirtNumber({ shirtNumber: 1 }), 1)
  assertEquals(rosterShirtNumber({ shirtNumber: 99 }), 99)
})

Deno.test('an absent, out of range or unreadable number is null', () => {
  assertEquals(rosterShirtNumber(SYNTHETIC_MEMBER), null)
  assertEquals(rosterShirtNumber({}), null)
  assertEquals(rosterShirtNumber({ shirtNumber: 0 }), null)
  assertEquals(rosterShirtNumber({ shirtNumber: 100 }), null)
  assertEquals(rosterShirtNumber({ shirtNumber: 9.5 }), null)
  assertEquals(rosterShirtNumber({ shirtNumber: 'not a number' }), null)
  assertEquals(rosterShirtNumber(null), null)
})

// ---- The name boundary expressed as a test ----------------------------------
// A reduced member holds a display name and an optional number, and nothing
// else. No guardian name, no email, no phone number, no member id reaches it.

Deno.test('a member reduces to name plus optional number, never guardian or contact data', () => {
  const reduced = reduceMember(SYNTHETIC_MEMBER)
  assert(reduced !== null)
  assertEquals(reduced, { display_name: 'Jack T', shirt_number: null })
  // Exactly the two roster keys, nothing carried through from the payload.
  assertEquals(Object.keys(reduced).sort(), ['display_name', 'shirt_number'])
  const flat = JSON.stringify(reduced)
  // The child's full surname never survives, only the initial.
  assert(!flat.includes('Thompson'), 'reduced row leaked the full surname')
  // No guardian name, no contact field, no member id.
  for (const leak of [
    'Madeup',
    'Guardianname',
    'FAKE-GUARDIAN-9',
    'FAKE-MEMBER-1',
    'made-up-child@example.invalid',
    'made-up-parent@example.invalid',
    '+44',
    'guardians',
    'email',
    'phoneNumber',
  ]) {
    assert(!flat.includes(leak), `reduced row leaked ${leak}`)
  }
})

Deno.test('a member with no usable name reduces to null', () => {
  assertEquals(reduceMember({ guardians: [{ firstName: 'Madeup', lastName: 'Guardianname' }] }), null)
})

// ---- Subgroup scoping of members --------------------------------------------
// A whole group mapping reads every member; a subgroup mapping reads only
// members whose subGroups list contains the subgroup id. The group is found
// by id in the groups/ response.

const GROUPS_RESPONSE = [
  {
    id: 'GRP-SYNTH-1',
    name: 'Synthetic FC',
    members: [
      { id: 'FAKE-A', firstName: 'Jack', lastName: 'Thompson', subGroups: ['SUB-SYNTH-7'] },
      { id: 'FAKE-B', firstName: 'Amara', lastName: 'Okafor', subGroups: ['SUB-SYNTH-7', 'SUB-SYNTH-8'] },
      { id: 'FAKE-C', firstName: 'Liang', lastName: 'Wei', subGroups: ['SUB-SYNTH-8'] },
    ],
  },
  { id: 'GRP-SYNTH-2', name: 'Other', members: [{ id: 'FAKE-D', firstName: 'Other', lastName: 'Child' }] },
]

Deno.test('memberSubgroupIds reads the subGroups id list and nothing else', () => {
  assertEquals(memberSubgroupIds({ subGroups: ['SUB-SYNTH-7', 'SUB-SYNTH-8'] }), ['SUB-SYNTH-7', 'SUB-SYNTH-8'])
  assertEquals(memberSubgroupIds({ subGroups: ['SUB-SYNTH-7', 7, null, ''] }), ['SUB-SYNTH-7'])
  assertEquals(memberSubgroupIds({}), [])
  assertEquals(memberSubgroupIds({ subGroups: 'not an array' }), [])
  assertEquals(memberSubgroupIds(null), [])
})

Deno.test('a whole group mapping reads every member of the group', () => {
  const members = selectGroupMembers(GROUPS_RESPONSE, 'GRP-SYNTH-1', null)
  assertEquals(members.map((m) => (m as { id: string }).id), ['FAKE-A', 'FAKE-B', 'FAKE-C'])
})

Deno.test('a subgroup mapping reads only members in that subgroup', () => {
  const members = selectGroupMembers(GROUPS_RESPONSE, 'GRP-SYNTH-1', 'SUB-SYNTH-8')
  assertEquals(members.map((m) => (m as { id: string }).id), ['FAKE-B', 'FAKE-C'])
})

Deno.test('an absent group or unexpected response yields no members', () => {
  assertEquals(selectGroupMembers(GROUPS_RESPONSE, 'GRP-MISSING', null), [])
  assertEquals(selectGroupMembers(null, 'GRP-SYNTH-1', null), [])
  assertEquals(selectGroupMembers([{ id: 'GRP-SYNTH-1' }], 'GRP-SYNTH-1', null), [])
  assertEquals(selectGroupMembers([{ id: 'GRP-SYNTH-1', members: 'not an array' }], 'GRP-SYNTH-1', null), [])
})

Deno.test('the member read is capped at MAX_ROSTER_MEMBERS', () => {
  const many = Array.from({ length: MAX_ROSTER_MEMBERS + 50 }, (_, i) => ({
    id: `FAKE-${i}`,
    firstName: `Child${i}`,
    lastName: 'Lastname',
  }))
  const members = selectGroupMembers([{ id: 'GRP-BIG', members: many }], 'GRP-BIG', null)
  assertEquals(members.length, MAX_ROSTER_MEMBERS)
})

// ---- The de-dupe ------------------------------------------------------------
// Match on the display name within the team: a name already on the roster, or
// added earlier in the same run, is already present, never inserted twice.

Deno.test('new members are added and existing names are already present', () => {
  const members = [
    { firstName: 'Jack', lastName: 'Thompson' }, // Jack T, already on the roster
    { firstName: 'Amara', lastName: 'Okafor' }, // Amara O, new
    {}, // no usable name, skipped
  ]
  const plan = planRosterImport(members, ['Jack T'])
  assertEquals(plan.added, 1)
  assertEquals(plan.alreadyPresent, 1)
  assertEquals(plan.skipped, 1)
  assertEquals(plan.inserts, [{ display_name: 'Amara O', shirt_number: null }])
})

Deno.test('re running the import adds nobody twice', () => {
  const members = [
    { firstName: 'Jack', lastName: 'Thompson' },
    { firstName: 'Amara', lastName: 'Okafor' },
  ]
  const first = planRosterImport(members, [])
  assertEquals(first.added, 2)
  // The second run sees both names already on the roster.
  const second = planRosterImport(members, first.inserts.map((p) => p.display_name))
  assertEquals(second.added, 0)
  assertEquals(second.alreadyPresent, 2)
  assertEquals(second.inserts, [])
})

Deno.test('two members reducing to the same name collapse to one row', () => {
  // Two different children both reduce to "Jack T"; the second is already
  // present within the run, so the roster never gains a duplicate row.
  const members = [
    { firstName: 'Jack', lastName: 'Thompson' },
    { firstName: 'Jack', lastName: 'Turner' },
  ]
  const plan = planRosterImport(members, [])
  assertEquals(plan.added, 1)
  assertEquals(plan.alreadyPresent, 1)
})

Deno.test('the de-dupe is case insensitive', () => {
  const plan = planRosterImport([{ firstName: 'Jack', lastName: 'Thompson' }], ['jack t'])
  assertEquals(plan.added, 0)
  assertEquals(plan.alreadyPresent, 1)
})

Deno.test('the shirt number rides the reduced row into the insert', () => {
  const plan = planRosterImport([{ firstName: 'Nine', lastName: 'Striker', shirtNumber: 9 }], [])
  assertEquals(plan.inserts, [{ display_name: 'Nine S', shirt_number: 9 }])
})
