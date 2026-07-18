// 0033 legacy column and trigger drop (Registered Players PR 3).
//
// The provisional 0033 migration ships in this branch UNAPPLIED on hosted, but
// the local `supabase db reset` applies every migration in order, so the local
// stack this suite runs against is the post-0033 schema: the compatibility seam
// is gone. This file proves that post-state directly, and that the invariant the
// whole feature rests on survives the drop. It reads the catalog through the
// owner container (fixture/verification only, never an app-role assertion).

import { describe, expect, it } from 'vitest'
import { runSqlInContainer } from './stack'

const q = (sql: string) => runSqlInContainer(sql).trim()

describe('0033 drops the PR 2 compatibility seam on the local schema', () => {
  it('drops the frozen players.team_id and players.shirt_number columns', () => {
    const n = q(
      `select count(*) from pg_attribute where attrelid = 'public.players'::regclass ` +
        `and attname in ('team_id','shirt_number') and not attisdropped;`,
    )
    expect(n).toBe('0')
  })

  it('drops both legacy compatibility triggers and their functions', () => {
    const triggers = q(
      `select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid ` +
        `where c.relname = 'players' and t.tgname in ('players_legacy_insert','players_legacy_update') and not t.tgisinternal;`,
    )
    expect(triggers).toBe('0')
    const fns = q(
      `select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace ` +
        `where n.nspname = 'public' and p.proname in ('players_legacy_insert','players_legacy_update');`,
    )
    expect(fns).toBe('0')
  })

  it('keeps the deferred require-registration constraint trigger', () => {
    const n = q(
      `select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid ` +
        `where c.relname = 'players' and t.tgname = 'players_require_registration' ` +
        `and t.tgconstraint <> 0 and t.tgdeferrable and t.tginitdeferred;`,
    )
    expect(n).toBe('1')
  })

  it('leaves the canonical seasonal columns on player_registrations untouched', () => {
    const n = q(
      `select count(*) from pg_attribute where attrelid = 'public.player_registrations'::regclass ` +
        `and attname in ('team_id','shirt_number') and not attisdropped;`,
    )
    expect(n).toBe('2')
  })

  it('holds the invariant the 0033 preflight guards: every player has a registration', () => {
    const orphans = q(
      `select count(*) from public.players p ` +
        `where not exists (select 1 from public.player_registrations r where r.player_id = p.id);`,
    )
    expect(orphans).toBe('0')
  })
})
