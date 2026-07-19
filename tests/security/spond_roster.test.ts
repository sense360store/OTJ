// The transactional Spond squad commit path (spond_import_roster,
// 0036_spond_and_renew.sql). The Edge Function reduces each Spond member to
// {name, shirt_number} and calls this RPC; here the RPC's server authority is
// proved directly over real JWTs: only a players.import holder can commit; the
// club and the current season are derived server side (the client cannot pick a
// season); a cross club or forged team is refused; new names land as Pending in
// the current season; a repeat run adds nothing (name dedupe within (club,
// season, team)); a namesake within one batch collapses; a name matching a
// player on another team creates a distinct identity (never a silent move or
// merge); the audit trail carries source spond_import with a batch id and one
// players.spond_imported summary, and no import_batches row is written. The Edge
// Function gate, season selection and reduction boundary are pinned by the Deno
// suite (docs/security/registered-players-threat-model.md, PR 6). Synthetic data.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { CLUB_A, CLUB_B, TEST_TEAM, runId, seedPlayer, serviceClient, signIn } from './stack'

const RUN = runId()
const nm = (s: string) => `SEC SPD ${RUN} ${s}`
const svc = serviceClient()

function batch(): string {
  return crypto.randomUUID()
}
function members(list: { name: string; shirt_number?: number | null }[]) {
  return list.map((m) => ({ name: m.name, shirt_number: m.shirt_number ?? null }))
}

async function currentSeason(club: string): Promise<string> {
  const { data } = await svc.from('seasons').select('id').eq('club_id', club).eq('is_current', true).single()
  return data!.id
}
// A registration for a display name on a team this season, out of band. Handles
// two identities sharing a name (the cross-team test creates exactly that).
async function regByName(display: string, seasonId: string, teamId: string | null) {
  const { data: ps } = await svc.from('players').select('id').eq('display_name', display)
  const ids = (ps ?? []).map((p) => (p as { id: string }).id)
  if (ids.length === 0) return null
  const q = svc
    .from('player_registrations')
    .select('status, team_id, shirt_number, registered_date')
    .in('player_id', ids)
    .eq('season_id', seasonId)
  const { data } = teamId === null ? await q.is('team_id', null) : await q.eq('team_id', teamId)
  return data?.[0] ?? null
}
async function countPlayers(display: string): Promise<number> {
  const { count } = await svc.from('players').select('id', { count: 'exact', head: true }).eq('display_name', display)
  return count ?? 0
}
async function eventsForBatch(id: string) {
  const { data } = await svc
    .from('audit_events')
    .select('action, source, entity_type, batch_id')
    .eq('batch_id', id)
  return data ?? []
}
async function importBatchRow(id: string) {
  const { data } = await svc.from('import_batches').select('id').eq('id', id).maybeSingle()
  return data
}

describe('spond_import_roster: capability, club scope, dedupe, pending, audit', () => {
  let manager: SupabaseClient
  let coachOne: SupabaseClient
  let parent: SupabaseClient
  let outsider: SupabaseClient
  let seasonA: string
  let teamTwo: string // a second club A team, for the cross-team name test
  let clubBTeam: string

  beforeAll(async () => {
    manager = (await signIn('manager')).client
    coachOne = (await signIn('coachOne')).client
    parent = (await signIn('parent')).client
    outsider = (await signIn('outsider')).client
    seasonA = await currentSeason(CLUB_A)

    const t2 = await svc.from('teams').insert({ club_id: CLUB_A, name: `T2 ${RUN}` }).select('id').single()
    teamTwo = t2.data!.id
    const tb = await svc.from('teams').insert({ club_id: CLUB_B, name: `TB ${RUN}` }).select('id').single()
    clubBTeam = tb.data!.id
  })

  afterAll(async () => {
    await svc.from('players').delete().like('display_name', `SEC SPD ${RUN} %`)
    await svc.from('teams').delete().in('id', [teamTwo, clubBTeam])
  })

  // ---- capability -----------------------------------------------------------
  it('refuses a coach without players.import (42501)', async () => {
    const { error } = await coachOne.rpc('spond_import_roster', {
      p_batch_id: batch(),
      p_team_id: TEST_TEAM,
      p_members: members([{ name: nm('nope') }]),
    })
    expect(error?.code).toBe('42501')
  })

  it('refuses a parent (42501)', async () => {
    const { error } = await parent.rpc('spond_import_roster', {
      p_batch_id: batch(),
      p_team_id: TEST_TEAM,
      p_members: members([{ name: nm('nope') }]),
    })
    expect(error?.code).toBe('42501')
  })

  // ---- club scope of the team -----------------------------------------------
  it('refuses a team from another club (42501), writing nothing', async () => {
    const { error } = await manager.rpc('spond_import_roster', {
      p_batch_id: batch(),
      p_team_id: clubBTeam,
      p_members: members([{ name: nm('crossclub') }]),
    })
    expect(error?.code).toBe('42501')
    expect(await countPlayers(nm('crossclub'))).toBe(0)
  })

  it('refuses an outsider (another club) even for their own team (42501)', async () => {
    const { error } = await outsider.rpc('spond_import_roster', {
      p_batch_id: batch(),
      p_team_id: clubBTeam,
      p_members: members([{ name: nm('outsider') }]),
    })
    expect(error?.code).toBe('42501')
  })

  it('refuses a forged (non existent) team id (42501)', async () => {
    const { error } = await manager.rpc('spond_import_roster', {
      p_batch_id: batch(),
      p_team_id: crypto.randomUUID(),
      p_members: members([{ name: nm('forged') }]),
    })
    expect(error?.code).toBe('42501')
  })

  // ---- happy path: pending, current season, audit, no import_batches --------
  it('imports new names as Pending in the current season, audited as spond_import', async () => {
    const id = batch()
    const { data, error } = await manager.rpc('spond_import_roster', {
      p_batch_id: id,
      p_team_id: TEST_TEAM,
      p_members: members([
        { name: nm('one'), shirt_number: 11 },
        { name: nm('two') },
        { name: nm('three'), shirt_number: 150 }, // out of range -> null
      ]),
    })
    expect(error).toBeNull()
    const r = data as { outcome: string; added: number; already_present: number; skipped: number }
    expect(r.outcome).toBe('succeeded')
    expect(r.added).toBe(3)
    expect(r.already_present).toBe(0)

    const one = await regByName(nm('one'), seasonA, TEST_TEAM)
    expect(one!.status).toBe('pending')
    expect(one!.shirt_number).toBe(11)
    expect(one!.registered_date).toBeNull()
    // out of range shirt dropped to null, not a row failure
    expect((await regByName(nm('three'), seasonA, TEST_TEAM))!.shirt_number).toBeNull()

    // audit: 3 player.created + 3 player.registration_created (spond_import) + 1 summary
    const events = await eventsForBatch(id)
    expect(events.filter((e) => e.action === 'player.created').length).toBe(3)
    expect(events.filter((e) => e.action === 'player.registration_created' && e.source === 'spond_import').length).toBe(3)
    const summary = events.filter((e) => e.action === 'players.spond_imported' && e.entity_type === 'import_batch')
    expect(summary.length).toBe(1)
    expect(events.every((e) => e.source === 'spond_import')).toBe(true)
    // No import_batches row for a Spond run.
    expect(await importBatchRow(id)).toBeNull()
  })

  it('is idempotent: a repeat run adds nothing (name dedupe within club, season, team)', async () => {
    const { data, error } = await manager.rpc('spond_import_roster', {
      p_batch_id: batch(),
      p_team_id: TEST_TEAM,
      p_members: members([{ name: nm('one'), shirt_number: 11 }, { name: nm('two') }]),
    })
    expect(error).toBeNull()
    const r = data as { added: number; already_present: number }
    expect(r.added).toBe(0)
    expect(r.already_present).toBe(2)
  })

  it('collapses a namesake within one batch (the second is not inserted)', async () => {
    const { data, error } = await manager.rpc('spond_import_roster', {
      p_batch_id: batch(),
      p_team_id: teamTwo,
      p_members: members([{ name: nm('twin') }, { name: nm('twin') }]),
    })
    expect(error).toBeNull()
    const r = data as { added: number; already_present: number }
    expect(r.added).toBe(1)
    expect(r.already_present).toBe(1)
    expect(await countPlayers(nm('twin'))).toBe(1)
  })

  // ---- name only never merges or moves across teams -------------------------
  it('a name matching a player on another team creates a distinct identity, never a move or merge', async () => {
    // Seed a player named "shared" on TEST_TEAM this season.
    seedPlayer({ club: CLUB_A, season: seasonA, display: nm('shared'), teamId: TEST_TEAM, status: 'registered' })
    const before = await countPlayers(nm('shared'))
    expect(before).toBe(1)

    // Import the same name into teamTwo: dedupe is per (club, season, team), so
    // this is a NEW identity on teamTwo, not a move of the TEST_TEAM player.
    const { data, error } = await manager.rpc('spond_import_roster', {
      p_batch_id: batch(),
      p_team_id: teamTwo,
      p_members: members([{ name: nm('shared') }]),
    })
    expect(error).toBeNull()
    expect((data as { added: number }).added).toBe(1)
    expect(await countPlayers(nm('shared'))).toBe(2) // a second, distinct identity
    // The TEST_TEAM registration is untouched (never moved).
    expect(await regByName(nm('shared'), seasonA, TEST_TEAM)).not.toBeNull()
  })
})
