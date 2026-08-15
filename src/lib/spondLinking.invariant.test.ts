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

  it('feeds buildLinkSections from rosterFor and nothing wider', () => {
    expect(src).toMatch(/teamRoster = useMemo\(\(\) => rosterFor\(teamId\)/)
    expect(src).toMatch(/buildLinkSections\(candidates \?\? \[\], allLinks, teamRoster\)/)
  })

  it('composes the no-match section from the same three inputs the sections read', () => {
    // Eleven children were invisible on this screen because no section
    // was player led. The list of registered players with no Spond match
    // must come from the shared rule over exactly the inputs the
    // sections read, or the two could disagree about who is reachable.
    expect(src).toMatch(/unmatchedPlayers\(candidates \?\? \[\], allLinks, teamRoster\)/)
  })
})

describe('staff never enter the player pipelines', () => {
  // The rule lives in _shared/spond.ts (excludeNonPlayers) and its Deno
  // tests prove it. These pin that both functions actually CALL it on the
  // scoped members, since a call site that quietly stops calling a
  // correct rule is exactly how the linking screen offered a manager as
  // a candidate child. Source text, the usual tripwire honesty.
  const fn = (name: string) =>
    readFileSync(join(import.meta.dirname, `../../supabase/functions/${name}/index.ts`), 'utf8')

  it('spond-link-members excludes before the cap and the reduction', () => {
    expect(fn('spond-link-members')).toMatch(/excludeNonPlayers\(scoped, IGNORED_MEMBER_IDS\)/)
  })

  it('spond-roster-import excludes before the plan is built', () => {
    expect(fn('spond-roster-import')).toMatch(/excludeNonPlayers\(scoped, IGNORED_MEMBER_IDS\)/)
  })
})
