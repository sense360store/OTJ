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

  it('the view composes all three parts from its own props', () => {
    expect(src).toMatch(/const sections = buildLinkSections\(candidates, links, pool, elsewhere\)/)
    expect(src).toMatch(/const setup = spondSetupRows\(\{/)
    expect(src).toMatch(/const reconcile = spondReconcile\(\{/)
  })

  it('the reconciliation gets the proved scan, never a literal', () => {
    // The same failure mode the two checks above exist for, one section
    // along, and with a worse consequence: this section OFFERS A WRITE.
    // Handing it `candidatesComplete: true` or `subgroupMappingComplete:
    // true` as a literal would let it act on a scan that proved nothing,
    // which is exactly the shape "never move anybody on unproven evidence"
    // forbids. Each must arrive from the shared rule that decided it.
    expect(src).toMatch(/candidatesComplete: complete/)
    expect(src).toMatch(/subgroupMappingComplete,/)
    expect(src).toMatch(/subgroupMappingComplete=\{subgroupMappingComplete\}/)
    expect(src).toMatch(
      /subgroupMappingComplete = useMemo\(\s*\(\) => !clubMapsWholeGroup\(mappings\.data \?\? \[\]\)/,
    )
    // And the destination the screen sends is the one the rule decided,
    // through the shared reader, never a team id read off the row by hand.
    expect(src).toMatch(/targetTeamId: destinationTeamId\(row\.to\)/)
    expect(src).toMatch(/expectedTeamId: destinationTeamId\(row\.from\)/)
  })

  it('a member seen one subgroup away is not also reported as gone', () => {
    // Before the reconciliation, a linked child whose Spond member had
    // simply moved subgroup rendered under "Links with no Spond member" as
    // "no longer offered from the team's Spond group", which is false and
    // invites an unlink that would drain that child's stored replies. The
    // orphan rule now takes the ids the scan DID see, so the same child
    // cannot appear in both sections saying opposite things.
    expect(src).toMatch(/const elsewhere = elsewhereMemberIds\(outsideMembers, outsideComplete\)/)
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
    expect(src).toMatch(/subgroups=\{subgroupTeams\}/)
    expect(src).toMatch(/clubRoster=\{roster\.data \?\? \[\]\}/)
    expect(src).toMatch(/subgroupTeams = useMemo\(\(\) => subgroupIndex\(mappings\.data \?\? \[\]\)/)
    // Stored whole from the load, so a reload cannot leave a stale
    // diagnosis beside fresh candidates.
    expect(src).toMatch(/diagnosticMembers: result\.diagnosticMembers/)
    expect(src).toMatch(/diagnosticComplete: result\.diagnosticComplete/)
  })

  it('the screen hands down the whole index, contested set included', () => {
    // subgroupIndex answers two questions at once: which subgroup maps to
    // exactly one team, and which subgroups more than one team claims. The
    // second half is the only evidence a contested membership leaves, so a
    // call site that rebuilt the index around byId alone would typecheck
    // and quietly hand the rule an empty conflict set, which reads as "no
    // conflict" rather than as "not known". The screen therefore passes
    // the value the builder returned, whole.
    expect(src).toMatch(/subgroups=\{subgroupTeams\}/)
    expect(src).not.toMatch(/contested:\s*new Set\(\)/)
    expect(src).not.toMatch(/subgroupTeams\.byId/)
  })
})

describe('one sentence per reason, and the false one reachable from one reason', () => {
  // "Not a registered player" was the DEFAULT arm of a conditional chain,
  // so every reason the chain did not name rendered as it. That is how a
  // second Spond member of an already linked name came to be reported as
  // a child missing from the player list, in the section whose stated
  // highest value outcome is exactly that finding.
  //
  // Two things keep it closed, and only the second is a real guarantee:
  // the vocabulary has one home, so the screen cannot drift from the
  // rule; and the mapping is a total Record keyed on that union, so the
  // compiler refuses a new reason with no sentence. This file only pins
  // that those two shapes are still the shapes in use.
  const lib = readFileSync(join(import.meta.dirname, './spondLinking.ts'), 'utf8')

  it('the reason vocabulary is declared once, in the rule, not in the screen', () => {
    expect(lib).toMatch(/export type NeedsDecisionReason =/)
    expect(lib).toMatch(/reason: NeedsDecisionReason/)
    expect(src).toMatch(/type NeedsDecisionReason,?\n/)
    expect(src).toMatch(/reason: NeedsDecisionReason/)
    // The screen must not retype the union, which is what let the two
    // copies disagree about how many cases there are.
    expect(src).not.toMatch(/'suggested'\s*\|\s*'ambiguous'/)
  })

  it('the sub line is a total map, never a chain with a default', () => {
    expect(src).toMatch(/const REASON_SUB: Record<NeedsDecisionReason, string> = \{/)
    expect(src).toMatch(/REASON_SUB\[reason\]/)
  })

  it('the false sentence is written once, against not_on_roster alone', () => {
    const sentence = 'Not a registered player'
    expect(src.split(sentence).length - 1).toBe(1)
    expect(src).toMatch(/not_on_roster: 'Not a registered player',/)
    // And the new case says the data fact without claiming identity.
    expect(src).toMatch(/name_taken: 'Same name as a registered player who is already linked',/)
  })

  it('the rule reads a taken name off the same pool the suggestions use', () => {
    // Scoping this club wide would let a Titans member read name_taken
    // off a Gladiators child, the hazard suggestionPool's own docstring
    // records as real here.
    expect(lib).toMatch(/const takenNames = new Set<string>\(\)/)
    expect(lib).toMatch(/for \(const p of roster\) \{/)
    expect(lib).toMatch(/takenNames\.has\(key\) \? 'name_taken' : 'not_on_roster'/)
  })

  it('names what it cannot catch', () => {
    // Source text, so: a rename defeats every check above, a sentence
    // assembled from parts rather than written whole is invisible to the
    // count, and nothing here proves which reason a given production row
    // takes. What proves the behaviour is ../routes/SpondLinks.test.tsx,
    // which renders the composed view over the production shape, and
    // ./spondLinking.test.ts, which runs the rule.
    expect(true).toBe(true)
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

  it('the diagnostic shape is exactly three fields, and the id is one of them', () => {
    // The rule that replaced "a diagnostic row carries no member id". It
    // carried none while the screen could only DESCRIBE a mismatch; the
    // reconciliation must resolve an already linked child BY IDENTITY,
    // which is the whole reason it is not a name match, so the id is on the
    // row deliberately. What has to stay closed is the shape: three fields,
    // no fourth, and in particular nothing a guardian or a contact could
    // ride in. The candidate shape beside it is unchanged and is still
    // asserted field for field by the deploy workflow.
    const shared = readFileSync(
      join(import.meta.dirname, '../../supabase/functions/_shared/spond.ts'),
      'utf8',
    )
    const iface = shared.match(/export interface LinkDiagnosticMember\s*\{([^}]*)\}/)
    expect(iface).not.toBeNull()
    const fields = [...(iface?.[1] ?? '').matchAll(/^\s*(\w+)[?]?\s*:/gm)].map((m) => m[1]).sort()
    expect(fields).toEqual(['display_name', 'spond_member_id', 'subgroup_ids'])
    expect(shared).toMatch(
      /export const SPOND_DIAGNOSTIC_MEMBER_FIELDS = \[\s*'display_name',\s*'spond_member_id',\s*'subgroup_ids',?\s*\]/,
    )
    // The candidate shape did NOT move. Widening it would have been the
    // cheap way to answer "is this member also in another team's subgroup",
    // and it was deliberately not taken: the answer there is "offer
    // nothing" either way, so the boundary buys more than the precision.
    const candidate = shared.match(/export interface LinkCandidate\s*\{([^}]*)\}/)
    const candidateFields = [...(candidate?.[1] ?? '').matchAll(/^\s*(\w+)[?]?\s*:/gm)].map((m) => m[1]).sort()
    expect(candidateFields).toEqual(['display_name', 'spond_member_id'])
  })

  it('an id a diagnostic row carries is one the links table would accept', () => {
    // An id the column refuses is no identity: offering an action on one
    // would be offering something the database will reject, which is how a
    // manager learns to distrust a screen. The reduction constrains it with
    // the same pattern reduceLinkCandidate uses, and the client drops
    // anything else on the way in.
    const shared = readFileSync(
      join(import.meta.dirname, '../../supabase/functions/_shared/spond.ts'),
      'utf8',
    )
    const body = shared.match(/export function reduceDiagnosticMember[\s\S]*?\n\}/)
    expect(body).not.toBeNull()
    expect(body?.[0]).toMatch(/SPOND_MEMBER_ID_PATTERN\.test\(memberId\)/)
    const queries = readFileSync(join(import.meta.dirname, './queries.ts'), 'utf8')
    expect(queries).toMatch(/spondMemberId: isSpondMemberId\(m\.spond_member_id\) \? m\.spond_member_id : ''/)
  })

  it('spond-roster-import collects through the shared rule', () => {
    expect(fn('spond-roster-import')).toMatch(/collectRosterMembers\(groups\.groups, mappings, IGNORED_MEMBER_IDS\)/)
  })
})
