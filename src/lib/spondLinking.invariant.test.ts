// =====================================================================
// The linking screen's pool boundary, pinned at the call site.
//
// suggestionPool holds the rule: one team, current season, withdrawn
// excluded, so a same named child on another team can never be
// suggested. Its own tests in ./spondLinking.test.ts prove the rule. A
// review mutation then handed buildLinkSections a club wide roster AT
// THE CALL SITE, with the whole suite green: the rule was intact and
// unused. These pin the chain in routes/SpondLinks.tsx link by link.
//
// Source text, so the usual honesty about what that buys: a rename or an
// extra indirection defeats them, and they say nothing about a fifth
// call site appearing. What they catch is the realistic edit, dropping
// or widening one link of the exact chain that exists.
// =====================================================================
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const raw = readFileSync(join(import.meta.dirname, '../routes/SpondLinks.tsx'), 'utf8')
const src = raw
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter((l) => !l.trim().startsWith('//'))
  .join('\n')

describe('SpondLinks hands the section builder the scoped pool, never the roster', () => {
  it('binds rosterFor to suggestionPool', () => {
    expect(src).toMatch(/rosterFor = useCallback\(\s*\(id[^)]*\)\s*=>\s*suggestionPool\(/)
  })

  it('feeds the toolbar suggestions from rosterFor and nothing wider', () => {
    expect(src).toMatch(/teamRoster = useMemo\(\(\) => rosterFor\(teamId\)/)
    expect(src).toMatch(/buildLinkSections\(candidates \?\? \[\], allLinks, teamRoster\)/)
  })

  it('hands the view the same raw inputs, and completeness through the shared rule', () => {
    // Eleven children were invisible on this screen because no section
    // was player led, and the FIRST fix left the composition in the
    // container, where a review hardcoded the list to [] with the whole
    // suite green. The view composes internally now (its render tests
    // are the wiring tests); what the container owns is handing it the
    // scoped pool and a completeness the shared rule decided, never a
    // literal.
    expect(src).toMatch(/pool=\{teamRoster\}/)
    expect(src).toMatch(/candidates=\{candidates \?\? \[\]\}/)
    expect(src).toMatch(/complete=\{loadedTeam \? linkLoadComplete\(loadedTeam\) : false\}/)
  })

  it('the view composes both halves from its own props', () => {
    expect(src).toMatch(/const sections = buildLinkSections\(candidates, links, pool\)/)
    expect(src).toMatch(/const setup = spondSetupRows\(\{/)
  })

  it('hands the diagnostics down as the server sent them, never as a literal', () => {
    // The same failure the composition rule above exists for, one field
    // along: hardcoding outsideMembers to [] at the call site would turn
    // every player into "Not found in Spond group data", which is the one
    // wrong answer a manager would act on, by re-adding children who are
    // already in Spond. Null, an absent field and an incomplete scan must
    // all reach the view as themselves.
    expect(src).toMatch(/outsideMembers=\{loadedTeam\?\.diagnosticMembers \?\? null\}/)
    expect(src).toMatch(/outsideComplete=\{loadedTeam\?\.diagnosticComplete === true\}/)
    expect(src).toMatch(/teamBySubgroup=\{subgroupTeams\}/)
    expect(src).toMatch(/subgroupTeams = useMemo\(\(\) => teamNameBySubgroup\(mappings\.data \?\? \[\]\)/)
    // Stored whole from the load, so a reload cannot leave a stale
    // diagnosis beside fresh candidates.
    expect(src).toMatch(/diagnosticMembers: result\.diagnosticMembers/)
    expect(src).toMatch(/diagnosticComplete: result\.diagnosticComplete/)
  })
})

describe('staff never enter the player pipelines', () => {
  // The whole collection rule (exclusion before cap before reduction,
  // warnings from counts) lives in _shared/spond.ts where the Deno tests
  // execute it. These pin that both functions actually CALL it, since a
  // call site that quietly stops calling a correct rule is exactly how
  // the linking screen offered a manager as a candidate child. Source
  // text, the usual tripwire honesty.
  const fn = (name: string) =>
    readFileSync(join(import.meta.dirname, `../../supabase/functions/${name}/index.ts`), 'utf8')

  it('spond-link-members collects through the shared rule and returns its counts as data', () => {
    const src = fn('spond-link-members')
    expect(src).toMatch(/collectLinkCandidates\(groups\.groups, mappings, IGNORED_MEMBER_IDS\)/)
    expect(src).toMatch(/staff_excluded: collected\.staff/)
    expect(src).toMatch(/ignored_excluded: collected\.ignored/)
  })

  it('the setup diagnostics run the same exclusion, over the same already fetched payload', () => {
    // A second scan of the parent group is a second chance to offer a
    // manager or a coach as somebody's child. The exclusion lives inside
    // collectLinkDiagnostics where the Deno tests execute it; this pins
    // that the entrypoint goes through it, with the SAME ignore config,
    // and reads the groups payload it already has rather than fetching
    // again. The deploy workflow's endpoint assertion is the other half:
    // it fails the deploy if any Spond path but auth2/login and groups/
    // appears.
    const src = fn('spond-link-members')
    expect(src).toMatch(/collectLinkDiagnostics\(groups\.groups, mappings, IGNORED_MEMBER_IDS\)/)
    expect(src).toMatch(/diagnostic_members: diagnostics\.members/)
  })

  it('completeness is reconciled against the candidate pass, never taken from the scan alone', () => {
    // The scan reads a whole group and honestly reports complete; it
    // cannot know that the candidate pass discarded a member of the mapped
    // subgroup for an unusable id. Sending diagnostics.complete straight
    // out is what let the screen say "Not found in Spond group data" about
    // a child who was in that subgroup, so the entrypoint must go through
    // the reconciliation and not around it.
    const src = fn('spond-link-members')
    expect(src).toMatch(/diagnostic_complete: diagnosticsProved\(diagnostics, collected\)/)
    expect(src).not.toMatch(/diagnostic_complete: diagnostics\.complete/)
  })

  it('a diagnostic row cannot carry a member id, so nothing links from one', () => {
    // The closed LinkCandidate shape is what linking is built on and it
    // is asserted field for field by the deploy workflow. The diagnostic
    // shape is its own closed shape beside it, deliberately WITHOUT the
    // member id: a row nobody can link from cannot become a second,
    // untested linking path.
    const shared = readFileSync(
      join(import.meta.dirname, '../../supabase/functions/_shared/spond.ts'),
      'utf8',
    )
    const iface = shared.match(/export interface LinkDiagnosticMember\s*\{([^}]*)\}/)
    expect(iface).not.toBeNull()
    const fields = [...(iface?.[1] ?? '').matchAll(/(\w+)\s*:/g)].map((m) => m[1]).sort()
    expect(fields).toEqual(['display_name', 'subgroup_ids'])
    expect(shared).toMatch(/export const SPOND_DIAGNOSTIC_MEMBER_FIELDS = \['display_name', 'subgroup_ids'\]/)
  })

  it('spond-roster-import collects through the shared rule', () => {
    expect(fn('spond-roster-import')).toMatch(/collectRosterMembers\(groups\.groups, mappings, IGNORED_MEMBER_IDS\)/)
  })
})
