// =====================================================================
// The seam: a Spond group payload in, one sentence per player out.
//
// The setup diagnostics are two halves that have never met in a test.
// The Deno suite executes the server half (collectLinkDiagnostics over a
// groups/ payload) and spondLinking.test.ts executes the client half
// (spondSetupRows over an already shaped list). Between them sits the
// field mapping in queries.ts, snake_case to camelCase, which is exactly
// where two correct halves drift apart: a server that stopped emitting
// subgroup_ids, or a client that read subGroups, would leave both suites
// green and turn every player into "In Spond, no team assigned".
//
// So this runs the real chain over one synthetic payload: the shared
// module the Edge Function calls, the same reduction queries.ts performs,
// then the real classifier. _shared/spond.ts touches no Deno API, which
// is what makes importing it here honest rather than a copy.
//
// The payload is the production SHAPE, invented throughout: no real Spond
// member id, no real child, no real group. The club's fifth team is
// mapped to one subgroup; the parent group also holds a child with no
// subgroup at all (the 15 August report), a child in another team's
// subgroup, a child in a subgroup the Hub maps to nothing, a staff role
// holder, and nobody at all for one registered player.
// =====================================================================
import { describe, expect, it } from 'vitest'
import {
  collectLinkCandidates,
  collectLinkDiagnostics,
  parseIgnoredMemberIds,
  type SpondMapping,
} from '../../supabase/functions/_shared/spond'
import { spondSetupRows, teamNameBySubgroup, type SpondGroupMember, type SpondSetupState } from './spondLinking'
import type { RegisteredPlayer } from './data'

const GROUP = 'GRP-SYNTH-1'
const SG_ARGONAUTS = 'SUBGROUP-SYNTH-ARGONAUTS'
const SG_TITANS = 'SUBGROUP-SYNTH-TITANS'
const SG_UNMAPPED = 'SUBGROUP-SYNTH-SIXTH'

const id = (seed: string) => seed.repeat(32).slice(0, 32).toUpperCase()

const member = (
  seed: string,
  firstName: string,
  subGroups: string[],
  extra: Record<string, unknown> = {},
) => ({
  id: id(seed),
  firstName,
  lastName: 'Synthetic',
  // The fields the boundary forbids, present in the payload precisely so
  // the chain can be proved never to carry them through.
  email: 'never@example.invalid',
  phoneNumber: '+440000000000',
  guardians: [{ id: 'GUARDIAN-SYNTH-1', firstName: 'Invented', lastName: 'Guardianname' }],
  address: { line1: '1 Made Up Lane' },
  subGroups,
  ...extra,
})

// The organiser account's groups/ response, reduced to the parts these
// functions read.
const GROUPS = [
  {
    id: GROUP,
    members: [
      // In the team's own subgroup: a linking candidate, not a diagnostic.
      member('a', 'Reachable', [SG_ARGONAUTS]),
      // The production case: in the group, no team assigned.
      member('b', 'Noteam', []),
      // In another mapped team's subgroup.
      member('c', 'Elsewhere', [SG_TITANS]),
      // In the sixth, unmapped subgroup.
      member('d', 'Unmapped', [SG_UNMAPPED]),
      // A role holder, in the team's group with no subgroup: the shape the
      // diagnostics exist to surface, inverted. Must never be reported.
      member('e', 'Staffperson', [], { roles: ['ROLE-SYNTH-1'] }),
    ],
  },
]

const MAPPINGS: SpondMapping[] = [
  {
    id: 'map-argonauts',
    spond_group_id: GROUP,
    spond_subgroup_id: SG_ARGONAUTS,
    spond_name: 'ARGONAUTS',
    team_id: 'team-argonauts',
  },
]

// The club's mappings as the browser holds them (useSpondMappings), which
// is what resolves another team's subgroup to a name.
const CLUB_MAPPINGS = [
  { subgroupId: SG_ARGONAUTS, teamName: 'Argonauts' },
  { subgroupId: SG_TITANS, teamName: 'Titans' },
]

const player = (playerId: string, displayName: string): RegisteredPlayer => ({
  registrationId: `r-${playerId}`,
  playerId,
  seasonId: 'season',
  teamId: 'team-argonauts',
  displayName,
  shirtNumber: null,
  status: 'registered',
  registeredDate: null,
  createdBy: null,
  updatedAt: '2026-08-15T00:00:00Z',
})

const ROSTER = [
  player('p1', 'Reachable Synthetic'),
  player('p2', 'Noteam Synthetic'),
  player('p3', 'Elsewhere Synthetic'),
  player('p4', 'Unmapped Synthetic'),
  player('p5', 'Missing Synthetic'),
]

// Exactly the reduction src/lib/queries.ts performs on the response body,
// so the snake_case to camelCase seam is inside the chain under test.
function asClientDiagnostics(
  rows: ReadonlyArray<{ display_name: string; subgroup_ids: string[] }>,
): SpondGroupMember[] {
  return rows.map((m) => ({ displayName: m.display_name, subgroupIds: m.subgroup_ids }))
}

function run(ignoredConfig = '') {
  const ignored = parseIgnoredMemberIds(ignoredConfig)
  const collected = collectLinkCandidates(GROUPS, MAPPINGS, ignored)
  const diagnostics = collectLinkDiagnostics(GROUPS, MAPPINGS, ignored)
  const rows = spondSetupRows({
    candidates: collected.members.map((m) => ({
      spondMemberId: m.spond_member_id,
      displayName: m.display_name,
    })),
    links: [],
    pool: ROSTER,
    outsideMembers: asClientDiagnostics(diagnostics.members),
    outsideComplete: diagnostics.complete,
    teamBySubgroup: teamNameBySubgroup(CLUB_MAPPINGS),
  })
  return { collected, diagnostics, rows }
}

const stateFor = (rows: ReturnType<typeof run>['rows'], name: string): SpondSetupState | undefined =>
  rows.find((r) => r.player.displayName === name)?.state

describe('a Spond group payload through the whole chain', () => {
  it('reaches the four registered players the mapping cannot, and no one else', () => {
    const { collected, rows } = run()
    // The mapped subgroup's member is a candidate, so that child is
    // reachable and gets no diagnostic row.
    expect(collected.members.map((m) => m.display_name)).toEqual(['Reachable Synthetic'])
    expect(rows.map((r) => r.player.displayName)).toEqual([
      'Elsewhere Synthetic',
      'Missing Synthetic',
      'Noteam Synthetic',
      'Unmapped Synthetic',
    ])
  })

  it('distinguishes the three states the old list could not', () => {
    const { rows } = run()
    expect(stateFor(rows, 'Noteam Synthetic')).toBe('no_subgroup')
    expect(stateFor(rows, 'Elsewhere Synthetic')).toBe('other_subgroup')
    expect(stateFor(rows, 'Missing Synthetic')).toBe('not_found')
  })

  it('names the other team only where exactly one is mapped', () => {
    const { rows } = run()
    expect(rows.find((r) => r.player.displayName === 'Elsewhere Synthetic')?.otherTeam).toBe('Titans')
    // The sixth subgroup maps to nothing, so the row says "another Spond
    // subgroup" rather than naming a team it cannot prove.
    expect(stateFor(rows, 'Unmapped Synthetic')).toBe('other_subgroup')
    expect(rows.find((r) => r.player.displayName === 'Unmapped Synthetic')?.otherTeam).toBeNull()
  })

  it('never reports a staff role holder, including one with no subgroup', () => {
    const { diagnostics, rows } = run()
    const flat = JSON.stringify(diagnostics.members) + JSON.stringify(rows)
    expect(flat).not.toContain('Staffperson')
  })

  it('never reports an admin ignored member id', () => {
    const { diagnostics } = run(id('d'))
    expect(JSON.stringify(diagnostics.members)).not.toContain('Unmapped Synthetic')
  })

  it('carries no member id, guardian, contact or address across the seam', () => {
    const { diagnostics, rows } = run()
    const flat = JSON.stringify(diagnostics.members) + JSON.stringify(rows)
    for (const forbidden of [
      id('a'),
      id('b'),
      id('c'),
      id('d'),
      'guardians',
      'Guardianname',
      'GUARDIAN-SYNTH-1',
      'never@example.invalid',
      '+440000000000',
      'Made Up Lane',
      'roles',
      'ROLE-SYNTH-1',
    ]) {
      expect(flat, `the chain leaked ${forbidden}`).not.toContain(forbidden)
    }
  })

  it('states nothing at all when the group is not the one the mappings name', () => {
    // The organiser account cannot see this team's group. Every row must
    // read as unknown, and in particular none may read as "not found",
    // which is the claim a manager would act on by re-adding children who
    // are already in Spond.
    const diagnostics = collectLinkDiagnostics(
      [{ id: 'GRP-SOMEWHERE-ELSE', members: [] }],
      MAPPINGS,
      parseIgnoredMemberIds(''),
    )
    expect(diagnostics.complete).toBe(false)
    expect(diagnostics.members).toEqual([])
    const rows = spondSetupRows({
      candidates: [],
      links: [],
      pool: ROSTER,
      outsideMembers: asClientDiagnostics(diagnostics.members),
      outsideComplete: diagnostics.complete,
      teamBySubgroup: teamNameBySubgroup(CLUB_MAPPINGS),
    })
    expect(new Set(rows.map((r) => r.state))).toEqual(new Set(['unknown']))
  })

  it('a client reading the wrong field name cannot pass as working', () => {
    // The seam this file exists for. Dropping subgroup_ids on the way
    // across turns every member into "no team assigned", which reads as a
    // plausible screen and is wrong for three of the four rows.
    const { diagnostics } = run()
    const dropped: SpondGroupMember[] = diagnostics.members.map((m) => ({
      displayName: m.display_name,
      subgroupIds: [],
    }))
    const rows = spondSetupRows({
      candidates: [],
      links: [],
      pool: ROSTER,
      outsideMembers: dropped,
      outsideComplete: true,
      teamBySubgroup: teamNameBySubgroup(CLUB_MAPPINGS),
    })
    expect(stateFor(rows, 'Elsewhere Synthetic')).toBe('no_subgroup')
    // Which is exactly what the real mapping must not produce.
    expect(stateFor(run().rows, 'Elsewhere Synthetic')).toBe('other_subgroup')
  })
})
