import { describe, expect, it } from 'vitest'
import {
  collectLinkCandidates,
  collectLinkDiagnostics,
  diagnosticsProved,
  type SpondMapping,
} from '../../supabase/functions/_shared/spond'

// One club parent group, two subgroups, two DIFFERENT children who share
// a name. Exactly what Spond's groups/ endpoint returns, trimmed to the
// fields the function reads.
const GROUPS = [
  {
    id: 'G-CLUB',
    name: 'Ossett Town Juniors',
    subGroups: [
      { id: 'SG-ARGONAUTS', name: 'Argonauts' },
      { id: 'SG-TITANS', name: 'Titans' },
    ],
    members: [
      // The Titans child. A real, different person.
      { id: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', firstName: 'Alex', lastName: 'Smith', subGroups: ['SG-TITANS'], roles: [] },
      // Somebody genuinely in Argonauts, so the candidate list is not empty.
      { id: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB', firstName: 'Ruby', lastName: 'Hall', subGroups: ['SG-ARGONAUTS'], roles: [] },
    ],
  },
]

const ARGONAUTS_MAPPING: SpondMapping[] = [
  { id: 'M1', spond_group_id: 'G-CLUB', spond_subgroup_id: 'SG-ARGONAUTS', spond_name: 'Argonauts', team_id: 'T-ARG' },
]

describe('server half', () => {
  it('returns the Titans child as an Argonauts diagnostic member, marked complete', () => {
    const candidates = collectLinkCandidates(GROUPS, ARGONAUTS_MAPPING, new Set())
    const diagnostics = collectLinkDiagnostics(GROUPS, ARGONAUTS_MAPPING, new Set())
    const proved = diagnosticsProved(diagnostics, candidates)
    console.log('CANDIDATES', JSON.stringify(candidates.members))
    console.log('DIAGNOSTICS', JSON.stringify(diagnostics))
    console.log('PROVED', proved)
    expect(candidates.members.map((m) => m.display_name)).toEqual(['Ruby Hall'])
    expect(diagnostics.members).toEqual([{ display_name: 'Alex Smith', subgroup_ids: ['SG-TITANS'] }])
    expect(proved).toBe(true)
  })
})
