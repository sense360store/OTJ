// =====================================================================
// The team reconciliation's boundaries, pinned mechanically.
//
// A tripwire, not a proof, in the house tradition. These read source text,
// so a rename or an extra indirection defeats them and they say nothing
// about a fifth call site appearing. What they catch is the realistic edit:
// a rule quietly stopping being called, a name based shortcut appearing
// beside the identity rule, or the write leaving the one transactional path
// it is supposed to ride. The last describe names what they cannot catch.
//
// The behavioural halves are ./spondReconcile.test.ts (the rule over the
// production shapes), ../routes/SpondLinks.test.tsx (the composed screen),
// ../../tests/security/spond_reconcile.test.ts (the RPC's gates against a
// real stack) and
// ../../.github/scripts/production-migration/test_0049_spond_team_reconcile.sh
// (atomicity and concurrency against a real PostgreSQL).
// =====================================================================
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (rel: string) => readFileSync(join(import.meta.dirname, rel), 'utf8')
// Comments stripped, so a rule quoted in prose never satisfies a check that
// is about executable source. The tonight.invariant.test.ts helper.
const code = (raw: string) =>
  raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n')

const RULE = read('./spondReconcile.ts')
const RULE_CODE = code(RULE)
const SCREEN = code(read('../routes/SpondLinks.tsx'))
const QUERIES = code(read('./queries.ts'))
const MIGRATION = read('../../supabase/migrations/0049_spond_team_reconcile.sql')
// The SQL with its own comments removed. The checks below that forbid a
// WORD have to run against what executes: the file's header explains at
// length why no guardian field is reached and why there is no 'auto' in the
// matched_by vocabulary, and a substring test over the prose would fail on
// the sentence that promises the thing it is checking.
const MIGRATION_CODE = MIGRATION.replace(/--[^\n]*/g, '')
// The function's own body, so a count of something inside it is not inflated
// by the self-verification below, which necessarily names the same things in
// order to assert about them.
const FUNCTION_BODY = (() => {
  const m = MIGRATION_CODE.match(/create or replace function public\.spond_reconcile_player_team[\s\S]*?\nas \$\$([\s\S]*?)\n\$\$;/)
  if (!m) throw new Error('could not find the function body in 0049')
  return m[1]
})()

describe('the rule decides and never writes', () => {
  it('the rule module touches no client, no network and no storage', () => {
    // It is pure by construction. If it ever were not, "the reconciliation
    // is offered, never applied, until a person presses" would stop being
    // checkable anywhere.
    for (const forbidden of ['supabase', 'fetch(', 'useMutation', 'useQuery', 'localStorage']) {
      expect(RULE_CODE, `the rule module reaches ${forbidden}`).not.toContain(forbidden)
    }
  })

  it('there is exactly one write path, and the screen uses it', () => {
    expect(QUERIES).toContain("supabase.rpc('spond_reconcile_player_team'")
    expect(SCREEN).toContain('useReconcileSpondTeam')
    // The direct registration update the players page uses is a different
    // operation with no identity rule attached. Reaching for it here would
    // move a child on the strength of a name with nothing to stop it.
    expect(SCREEN).not.toContain('useMovePlayerTeam')
    expect(RULE_CODE).not.toContain('useMovePlayerTeam')
  })

  it('the screen sends the destination the rule decided, through the shared reader', () => {
    expect(SCREEN).toMatch(/targetTeamId: destinationTeamId\(row\.to\)/)
    expect(SCREEN).toMatch(/expectedTeamId: destinationTeamId\(row\.from\)/)
    // A literal team id, or a team read straight off the player row, would
    // be a second answer to a question the rule already answered.
    expect(SCREEN).not.toMatch(/targetTeamId: row\.player\./)
  })

  it('the screen names the member the destination came from, on BOTH paths', () => {
    // The stale link race a review found. A proved press that named no member
    // would let the RPC accept "this child has some link" as proof, and apply
    // a destination derived from a member they were unlinked from since the
    // scan. The id comes off the row the rule built, never off the link list
    // the screen happens to be holding.
    expect(SCREEN).toMatch(/const memberId = row\.memberId \?\? ''/)
    expect(SCREEN).toMatch(/if \(!memberId\) continue/)
    expect(SCREEN).toMatch(/expectedMemberId: confirmIdentity \? null : memberId/)
    expect(SCREEN).toMatch(/confirmMemberId: confirmIdentity \? memberId : null/)
  })

  it('the hook refuses a call that names neither member or both', () => {
    // A null must never mean "any existing link is acceptable". The RPC
    // raises on it too; this is the half that catches a caller mistake before
    // it looks like a database error about the manager's data.
    expect(QUERIES).toMatch(/if \(\(expectedMemberId == null\) === \(confirmMemberId == null\)\)/)
    expect(QUERIES).toContain('p_expected_member_id: expectedMemberId ?? null')
    expect(QUERIES).toContain('p_confirm_member_id: confirmMemberId ?? null')
    // And the outcome the RPC returns for a repointed link has a sentence.
    expect(QUERIES).toMatch(/stale_link:\s*\n?\s*'/)
  })
})

describe('the identity rule has one implementation and one gate', () => {
  it('the confirm path is produced only from a setup row that carries a member', () => {
    // spondSetupRows owns every ambiguity rule on this screen: one Spond
    // member of the name AND one registered child of it, across the whole
    // scan, with a member filed under a team that already holds the name
    // failing closed. Re-deriving any of that here would be a second name
    // matcher, and the two would drift.
    expect(RULE_CODE).toMatch(/const setup = spondSetupRows\(\{/)
    expect(RULE_CODE).toMatch(/const member = row\.member/)
    // Written once, in that loop, so a confirm row cannot be minted anywhere
    // else in the file.
    expect(RULE_CODE.split("state: 'confirm'").length - 1).toBe(1)
  })

  it('the proved path is keyed on the link, never on a name', () => {
    expect(RULE_CODE).toMatch(/const linkByPlayer = new Map\(ctx\.links\.map/)
    expect(RULE_CODE).toMatch(/const link = linkByPlayer\.get\(player\.playerId\)/)
    expect(RULE_CODE).toMatch(/if \(!link\) continue/)
    // The one place a move is minted, and it is inside that loop.
    expect(RULE_CODE.split("state: 'move'").length - 1).toBe(1)
  })

  it('a contested subgroup is carried, not discarded, and outranks a unique one', () => {
    // A REVIEW FINDING. Deleting a contested subgroup from the map made it
    // indistinguishable from one nobody maps, so a member in one properly
    // mapped subgroup AND one contested subgroup resolved to the single
    // nameable team and was offered as an actionable move. The contested ids
    // are kept beside the map, in ONE value so a caller cannot pass the half
    // that names a team without the half that refuses to, and the check runs
    // FIRST so no later branch can shadow it.
    const linking = code(read('./spondLinking.ts'))
    expect(linking).toMatch(/export interface SubgroupIndex \{/)
    expect(linking).toMatch(/contested: ReadonlySet<string>/)
    expect(linking).toMatch(/for \(const id of contested\) byId\.delete\(id\)/)
    expect(linking).toMatch(/return \{ byId, contested \}/)
    expect(linking).toMatch(/export function touchesContestedSubgroup\(/)

    // memberVerdict checks it before anything else can answer.
    const verdict = RULE_CODE.match(/export function memberVerdict\([\s\S]*?\n\}/)?.[0] ?? ''
    expect(verdict).not.toBe('')
    const contestedAt = verdict.indexOf('touchesContestedSubgroup')
    expect(contestedAt).toBeGreaterThan(-1)
    for (const later of ['subgroupIds.length === 0', 'resolveTeams(']) {
      expect(verdict.indexOf(later), `${later} must not precede the contested check`).toBeGreaterThan(contestedAt)
    }
    // And the read only diagnostic refuses too, with its own state rather
    // than borrowing the sentence about two people of one name.
    expect(linking).toMatch(/touchesContestedSubgroup\(member\.subgroupIds, ctx\.subgroups\)/)
    expect(linking).toMatch(/return nobody\(player, 'contested_subgroup'\)/)
    expect(SCREEN).toMatch(/const SETUP_FINDING: Record<SpondSetupState, string> = \{/)
  })

  it('the whole club subgroup answer travels as ONE value', () => {
    // The EventKindContext lesson: a caller that CAN pass half the context
    // will pass half the context. Here the half that would be dropped is the
    // half that refuses, so the two are one parameter.
    expect(RULE_CODE).toMatch(/subgroups: SubgroupIndex/)
    expect(RULE_CODE).not.toMatch(/teamBySubgroup/)
    expect(SCREEN).toMatch(/subgroupIndex\(mappings\.data \?\? \[\]\)/)
    expect(SCREEN).toMatch(/subgroups=\{subgroupTeams\}/)
  })

  it('a member with no usable id is never offered as an identity', () => {
    expect(RULE_CODE).toMatch(/if \(!member\.spondMemberId\) continue/)
    expect(RULE_CODE).toMatch(/if \(m\.spondMemberId\) outsideById\.set/)
  })

  it('and the database refuses an unlinked child regardless of any of that', () => {
    // The only assertions here that are a guarantee rather than a tripwire:
    // every rule above lives in a browser, and these do not.
    expect(MIGRATION_CODE).toContain("'outcome', 'not_linked'")
    expect(MIGRATION_CODE).toMatch(/if v_player_member is null then/)
  })

  it('and refuses a link that has been repointed since the caller read Spond', () => {
    expect(MIGRATION_CODE).toContain("'outcome', 'stale_link'")
    expect(MIGRATION_CODE).toMatch(/if v_player_member <> v_member then/)
    // Exactly one of the two member arguments, so a null can never be read as
    // "any link will do".
    expect(MIGRATION_CODE).toMatch(
      /\(p_expected_member_id is null\) = \(p_confirm_member_id is null\)/,
    )
    expect(MIGRATION_CODE).toMatch(/v_confirming\s*:=\s*p_confirm_member_id is not null/)
  })
})

describe('the migration keeps the negatives it claims', () => {
  it('creates no table, column, policy, capability or trigger', () => {
    for (const forbidden of [
      'create policy',
      'drop policy',
      'create trigger',
      'drop trigger',
      'create index',
      'alter table',
    ]) {
      expect(MIGRATION_CODE.toLowerCase(), `0049 contains ${forbidden}`).not.toContain(forbidden)
    }
    // Table privileges, matched at a statement boundary rather than as a
    // substring: the self verification's own refusal messages say "must
    // still not grant UPDATE", and a bare substring test fails on the
    // sentence that promises the thing it is checking.
    expect(MIGRATION_CODE).not.toMatch(/(^|;|\n)\s*(grant|revoke)\s+(select|insert|update|delete|all)\b/i)
    // One create table only: the transaction local BEFORE fingerprint, which
    // is dropped at commit and is what makes the "changed nothing" half of
    // the self verification a real comparison rather than a tautology.
    const creates = MIGRATION_CODE.toLowerCase().match(/create\s+(temporary\s+)?table/g) ?? []
    expect(creates).toEqual(['create temporary table'])
    expect(MIGRATION_CODE).toContain('on commit drop')
    // And the only privilege it moves is EXECUTE on its own function.
    expect(MIGRATION_CODE).toMatch(
      /revoke execute on function public\.spond_reconcile_player_team\([^)]*\) from public, anon;/,
    )
    expect(MIGRATION_CODE).toMatch(
      /grant execute on function public\.spond_reconcile_player_team\([^)]*\) to authenticated;/,
    )
  })

  it('never creates a player identity and never removes or repoints a link', () => {
    expect(MIGRATION_CODE.toLowerCase()).not.toMatch(/insert\s+into\s+public\.players\b/)
    expect(MIGRATION_CODE.toLowerCase()).not.toMatch(/delete\s+from\s+public\.player_spond_links/)
    expect(MIGRATION_CODE.toLowerCase()).not.toMatch(/update\s+public\.player_spond_links/)
  })

  it('lets the caller name no season, so no historic registration is addressable', () => {
    expect(MIGRATION_CODE).not.toMatch(/p_season\w*\s+uuid/)
    expect(MIGRATION_CODE).toMatch(/where s\.club_id = v_club and s\.is_current/)
    // And the one update it performs is scoped to the row it read from that
    // season, by primary key.
    expect(MIGRATION_CODE).toMatch(
      /update public\.player_registrations r\s*set team_id = p_target_team_id\s*where r\.id = v_reg\.id;/,
    )
  })

  it('gates on the capability both halves already require, and adds no new key', () => {
    expect(MIGRATION_CODE).toContain("public.has_perm('players.manage')")
    expect(MIGRATION_CODE).not.toContain('players.import')
    expect(MIGRATION_CODE).not.toContain('club.manage')
  })

  it('widens no vocabulary: no audit source, no matched_by value', () => {
    expect(MIGRATION_CODE).not.toContain('otj.audit_source')
    expect(MIGRATION_CODE).not.toContain("'auto'")
    expect(MIGRATION_CODE).toContain("'suggested'")
  })

  it('serialises two managers on one child, and locks every row it decides from', () => {
    // TWO advisory locks. The member key covers the case the row locks
    // structurally cannot: a member with no link row yet has nothing to hold,
    // so two confirmations of the same free member would both reach the
    // insert and the loser would surface a raw unique violation instead of
    // the documented refusal. Player key first, which is what keeps the pair
    // deadlock free.
    expect(FUNCTION_BODY.match(/pg_advisory_xact_lock/g)?.length ?? 0).toBe(2)
    expect(FUNCTION_BODY).toContain("'otj.spond_reconcile:'")
    expect(FUNCTION_BODY).toContain("'otj.spond_member:'")
    expect(FUNCTION_BODY.indexOf("'otj.spond_reconcile:'")).toBeLessThan(
      FUNCTION_BODY.indexOf("'otj.spond_member:'"),
    )
    // Two: the registration row, and every link row this decision could touch.
    expect(MIGRATION_CODE.match(/for update/g)?.length ?? 0).toBeGreaterThanOrEqual(2)
    // The link lock's canonical ORDER BY. Two crossed confirmations touch the
    // same two rows, so taking them in caller order can deadlock; both calls
    // are refusals, so it would be safe rather than corrupting, and one
    // ordered statement removes it.
    expect(MIGRATION_CODE).toMatch(/order by l\.spond_member_id\s+for update/)
  })

  it('handles losing the link race to a DIRECT insert, rather than assuming it cannot', () => {
    // A REVIEW FINDING. The advisory locks serialise callers of this function
    // and nothing else; the ordinary linking screen inserts into
    // player_spond_links directly from Accept and from Choose and takes no
    // lock. The confirmation insert can therefore lose either unique key, and
    // the promise this function makes is NAMED outcomes, not a raw 23505.
    expect(FUNCTION_BODY).toMatch(/exception when unique_violation then/)
    // It must RE-READ rather than assume which side lost, so both refusals are
    // RETURNED twice: once from the ordinary read, once from the handler.
    // Counted on the returned literal rather than the bare name, because the
    // prose inside the body names them too, and a count a comment can satisfy
    // would survive deleting the handler it exists to pin. The migration's own
    // self-verification counts the same shape, for the same reason.
    const returned = (outcome: string) =>
      FUNCTION_BODY.split(`'outcome', '${outcome}'`).length - 1
    expect(returned('member_linked_elsewhere')).toBeGreaterThanOrEqual(2)
    expect(returned('player_linked_elsewhere')).toBeGreaterThanOrEqual(2)
    // A violation neither read explains is re-raised, not swallowed into a
    // move on evidence the function cannot describe.
    expect(FUNCTION_BODY).toMatch(/raise;/)
    // And the audit batch stamp is set OUTSIDE the block, so the
    // subtransaction rollback cannot take it with it.
    const blockAt = FUNCTION_BODY.indexOf('exception when unique_violation')
    const stampAt = FUNCTION_BODY.indexOf("set_config('otj.audit_batch'")
    expect(stampAt).toBeGreaterThan(-1)
    expect(stampAt).toBeLessThan(blockAt)
  })

  it('and the direct linking path is still allowed to be direct', () => {
    // The fix is at the RPC boundary deliberately: requiring every present
    // and future direct insert to join a lock protocol is the assumption that
    // would rot. So the ordinary path is unchanged, and this pins that it
    // still exists as a plain insert rather than having been quietly rerouted.
    expect(QUERIES).toMatch(/supabase\.from\('player_spond_links'\)\.insert\(/)
  })

  it('contacts nothing and reads no name', () => {
    for (const forbidden of ['http', 'spond.com', 'display_name', 'guardian', 'email', 'phone']) {
      expect(MIGRATION_CODE.toLowerCase(), `0049 reaches ${forbidden}`).not.toContain(forbidden)
    }
  })
})

describe('the self-verification uses PostgreSQL word boundaries, not C escapes', () => {
  // A review found every one of these vacuous. In PostgreSQL's ARE syntax
  // \b is the BACKSPACE CHARACTER, not a word boundary assertion, so
  // `...public\.players\b` read as "followed by the literal byte 0x08" and
  // matched nothing at all: the checks passed for the wrong reason and would
  // have passed over a function that did the forbidden thing. The correct
  // assertions are \y, \m and \M.
  //
  // This is the source-text half. The half that proves the checks BITE is the
  // mutation section of
  // .github/scripts/production-migration/test_0049_spond_team_reconcile.sh,
  // which injects each forbidden object into the function body and asserts
  // the apply aborts.
  const storedSourceChecks = MIGRATION_CODE.split('\n').filter((l) => /v_src\s*[!]?~/.test(l))

  it('there are stored source checks to check', () => {
    expect(storedSourceChecks.length).toBeGreaterThanOrEqual(6)
  })

  it('not one of them uses \\b, which would silently match nothing', () => {
    for (const line of storedSourceChecks) {
      expect(line, `a stored source check uses \\b: ${line.trim()}`).not.toMatch(/\\b/)
    }
  })

  it('the two that need a boundary use the PostgreSQL ones', () => {
    expect(MIGRATION_CODE).toMatch(/insert\\s\+into\\s\+public\\\.players\\M/)
    expect(MIGRATION_CODE).toMatch(
      /\\y\(register_entries\|session_teams\|spond_events\|spond_event_responses\)\\y/,
    )
  })
})

describe('names what it cannot catch', () => {
  it('says so out loud', () => {
    // Source text, so: a rename defeats every check above; a rule reached
    // through a variable is invisible to the substring tests; counting the
    // occurrences of a literal says nothing about which branch produces it
    // at run time; and nothing here proves the migration DOES what its
    // source says, only that its source still says it. In particular
    // "creates no table" is a check on this file and not on the database.
    //
    // What proves behaviour: ./spondReconcile.test.ts runs the rule,
    // ../routes/SpondLinks.test.tsx renders the composed screen, and the two
    // database harnesses named in this file's header execute the SQL.
    expect(true).toBe(true)
  })
})
