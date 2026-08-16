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

  it('a member with no usable id is never offered as an identity', () => {
    expect(RULE_CODE).toMatch(/if \(!member\.spondMemberId\) continue/)
    expect(RULE_CODE).toMatch(/if \(m\.spondMemberId\) outsideById\.set/)
  })

  it('and the database refuses an unlinked child regardless of any of that', () => {
    // The only assertion here that is a guarantee rather than a tripwire:
    // every rule above lives in a browser, and this one does not.
    expect(MIGRATION_CODE).toContain("'outcome', 'not_linked'")
    expect(MIGRATION_CODE).toMatch(/if v_player_member is null then/)
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
    expect(MIGRATION_CODE).toContain('pg_advisory_xact_lock')
    // Two: the registration row, and every link row this decision could touch.
    expect(MIGRATION_CODE.match(/for update/g)?.length ?? 0).toBeGreaterThanOrEqual(2)
    // The link lock's canonical ORDER BY. Two crossed confirmations touch the
    // same two rows, so taking them in caller order can deadlock; both calls
    // are refusals, so it would be safe rather than corrupting, and one
    // ordered statement removes it.
    expect(MIGRATION_CODE).toMatch(/order by l\.spond_member_id\s+for update/)
  })

  it('contacts nothing and reads no name', () => {
    for (const forbidden of ['http', 'spond.com', 'display_name', 'guardian', 'email', 'phone']) {
      expect(MIGRATION_CODE.toLowerCase(), `0049 reaches ${forbidden}`).not.toContain(forbidden)
    }
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
