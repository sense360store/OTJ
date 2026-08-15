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
    expect(src).toMatch(/const unmatched = unmatchedPlayers\(candidates, links, pool\)/)
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

  it('spond-roster-import collects through the shared rule', () => {
    expect(fn('spond-roster-import')).toMatch(/collectRosterMembers\(groups\.groups, mappings, IGNORED_MEMBER_IDS\)/)
  })
})
