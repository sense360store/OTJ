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
})
