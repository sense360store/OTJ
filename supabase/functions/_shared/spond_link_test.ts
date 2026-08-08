// Tests for the linking candidate reduction, the transient name flow of
// the amended boundary (ADR-0008, docs/security/spond-data-boundary.md).
// Hermetic, synthetic fixtures only: invented ids, invented names, never
// a real payload. They pin the one permitted name read: a member reduces
// to exactly an opaque id and a display name, guardians and contacts are
// provably absent, and the id must fit the shape migration 0045 stores.
// Run with:
//
//   deno test --allow-env --allow-read supabase/functions/_shared/spond_link_test.ts
//
// The underscore folder is not deployed; this file ships nowhere.
import { assert, assertEquals } from 'jsr:@std/assert@1'
import { MAX_ROSTER_MEMBERS, planLinkCandidates, reduceLinkCandidate } from './spond.ts'

// A synthetic member with every field the reduction must ignore, the
// spond_roster_test.ts fixture style.
const SYNTHETIC_MEMBER = {
  id: 'FAKE-MEMBER-1',
  firstName: 'Madeup',
  lastName: 'Childname',
  email: 'invented.child@example.invalid',
  phoneNumber: '+44 0000 000000',
  subGroups: ['SUBGRP-SYNTH-1'],
  guardians: [
    {
      id: 'FAKE-GUARDIAN-9',
      firstName: 'Madeup',
      lastName: 'Guardianname',
      email: 'invented.guardian@example.invalid',
      phoneNumber: '+44 1111 111111',
    },
  ],
}

Deno.test('a member reduces to exactly the opaque id and the display name', () => {
  const candidate = reduceLinkCandidate(SYNTHETIC_MEMBER)
  assert(candidate !== null)
  assertEquals(Object.keys(candidate).sort(), ['display_name', 'spond_member_id'])
  assertEquals(candidate.spond_member_id, 'FAKE-MEMBER-1')
  assertEquals(candidate.display_name, 'Madeup Childname')
})

Deno.test('guardian and contact data never reach a candidate', () => {
  const flat = JSON.stringify(reduceLinkCandidate(SYNTHETIC_MEMBER))
  assert(!flat.includes('Guardianname'))
  assert(!flat.includes('FAKE-GUARDIAN-9'))
  assert(!flat.includes('example.invalid'))
  assert(!flat.includes('+44'))
  assert(!flat.includes('guardians'))
  assert(!flat.includes('email'))
  assert(!flat.includes('phoneNumber'))
  assert(!flat.includes('subGroups'))
})

Deno.test('a member with no usable id or no usable name reduces to null', () => {
  assertEquals(reduceLinkCandidate({ firstName: 'Madeup', lastName: 'Childname' }), null)
  assertEquals(reduceLinkCandidate({ id: 'FAKE-MEMBER-1' }), null)
  assertEquals(reduceLinkCandidate({ id: '', firstName: 'Madeup' }), null)
  assertEquals(reduceLinkCandidate(null), null)
  assertEquals(reduceLinkCandidate('not a member'), null)
})

Deno.test('an id that does not fit the 0045 token shape is refused, so the table cannot refuse it later', () => {
  assertEquals(reduceLinkCandidate({ ...SYNTHETIC_MEMBER, id: 'not a member id' }), null)
  assertEquals(reduceLinkCandidate({ ...SYNTHETIC_MEMBER, id: 'a'.repeat(65) }), null)
  assertEquals(reduceLinkCandidate({ ...SYNTHETIC_MEMBER, id: 'has@sign' }), null)
})

Deno.test('a single name field is carried as is and clamped to the roster bound', () => {
  const single = reduceLinkCandidate({ id: 'FAKE-MEMBER-2', firstName: 'Madeup' })
  assertEquals(single?.display_name, 'Madeup')
  const long = reduceLinkCandidate({ id: 'FAKE-MEMBER-3', firstName: 'M'.repeat(60) })
  assertEquals(long?.display_name?.length, 40)
})

Deno.test('candidates de-dupe by member id across mappings', () => {
  const twice = planLinkCandidates([SYNTHETIC_MEMBER, { ...SYNTHETIC_MEMBER, firstName: 'Other' }])
  assertEquals(twice.length, 1)
  assertEquals(twice[0].display_name, 'Madeup Childname')
})

Deno.test('unreducible members are dropped and order is preserved', () => {
  const candidates = planLinkCandidates([
    { id: 'FAKE-MEMBER-2', firstName: 'Second', lastName: 'Synthetic' },
    { id: 'bad id with spaces', firstName: 'Dropped' },
    SYNTHETIC_MEMBER,
  ])
  assertEquals(
    candidates.map((c) => c.spond_member_id),
    ['FAKE-MEMBER-2', 'FAKE-MEMBER-1'],
  )
})

Deno.test('the candidate list is capped like the roster read', () => {
  const many = Array.from({ length: MAX_ROSTER_MEMBERS + 25 }, (_, i) => ({
    id: `FAKE-MEMBER-${i}`,
    firstName: 'Synthetic',
    lastName: String(i),
  }))
  assertEquals(planLinkCandidates(many).length, MAX_ROSTER_MEMBERS)
})
