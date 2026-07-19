// The export read path (export_players, 0034_export_players.sql). Proves the
// child-data egress boundary: only a players.export holder can export; a
// view-only coach, a parent and an outsider cannot; a cross club or unknown
// season is refused; export returns the club's rows for the season under the
// club wide read scope (no team arm); and every export writes exactly one
// players.exported audit event whose actor is server derived and whose metadata
// carries counts and a safe filter summary only, NEVER a name or the search
// string. The formula-injection escaping is proven in the pure unit suite
// (src/lib/playersExport.test.ts), referenced from the policy test matrix.
// Synthetic data only.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { CLUB_A, TEST_TEAM, runId, seedPlayer, serviceClient, signIn } from './stack'

const RUN = runId()
const name = (s: string) => `SEC EXP ${RUN} ${s}`

async function currentSeason(club: string): Promise<string> {
  const { data } = await serviceClient().from('seasons').select('id').eq('club_id', club).eq('is_current', true).single()
  return data!.id
}

// A season that is NOT in club A, so the cross club refusal is executable. The
// suite seeds club B (with a bootstrap season); fall back to a random uuid,
// which the same "season not found in your club" check refuses.
async function crossClubSeason(): Promise<string> {
  const { data } = await serviceClient().from('seasons').select('id').neq('club_id', CLUB_A).limit(1)
  return data?.[0]?.id ?? crypto.randomUUID()
}

async function exportedEventCount(actorId: string): Promise<number> {
  const { count } = await serviceClient()
    .from('audit_events')
    .select('*', { count: 'exact', head: true })
    .eq('action', 'players.exported')
    .eq('actor_id', actorId)
  return count ?? 0
}

describe('export_players: capability gate, club scope and safe audit', () => {
  let manager: SupabaseClient
  let coachOne: SupabaseClient
  let parent: SupabaseClient
  let outsider: SupabaseClient
  let managerId: string
  let seasonA: string
  let seasonOther: string

  beforeAll(async () => {
    const m = await signIn('manager')
    manager = m.client
    managerId = m.userId
    coachOne = (await signIn('coachOne')).client
    parent = (await signIn('parent')).client
    outsider = (await signIn('outsider')).client
    seasonA = await currentSeason(CLUB_A)
    seasonOther = await crossClubSeason()
    // Two disposable rows in club A's current season: a registered player on a
    // team with a shirt, and a pending Unassigned player.
    seedPlayer({ club: CLUB_A, season: seasonA, display: name('alpha'), teamId: TEST_TEAM, shirt: 7, status: 'registered' })
    seedPlayer({ club: CLUB_A, season: seasonA, display: name('beta'), status: 'pending' })
  })

  afterAll(async () => {
    await serviceClient().from('players').delete().like('display_name', `SEC EXP ${RUN} %`)
  })

  it('a manager exports and receives the club rows for the season', async () => {
    const { data, error } = await manager.rpc('export_players', {
      p_season_id: seasonA,
      p_filters: { format: 'csv' },
    })
    expect(error).toBeNull()
    const rows = (data ?? []) as {
      player_id: string
      player_name: string
      team_name: string
      status: string
      shirt_number: number | null
      season_name: string
    }[]
    const ours = rows.filter((r) => r.player_name.startsWith(`SEC EXP ${RUN}`))
    expect(ours.length).toBe(2)
    const alpha = ours.find((r) => r.player_name === name('alpha'))!
    expect(alpha.status).toBe('registered')
    expect(alpha.shirt_number).toBe(7)
    expect(alpha.season_name).toBeTruthy()
    const beta = ours.find((r) => r.player_name === name('beta'))!
    // An Unassigned registration exports an empty team string and a null shirt.
    expect(beta.team_name).toBe('')
    expect(beta.shirt_number).toBeNull()
  })

  it('writes exactly one players.exported event per export, with a server-derived actor', async () => {
    const before = await exportedEventCount(managerId)
    const { error } = await manager.rpc('export_players', { p_season_id: seasonA, p_filters: { format: 'csv' } })
    expect(error).toBeNull()
    const after = await exportedEventCount(managerId)
    expect(after).toBe(before + 1)

    const { data } = await serviceClient()
      .from('audit_events')
      .select('actor_id, actor_name, action, entity_type, entity_id, source, season_id, metadata')
      .eq('action', 'players.exported')
      .eq('actor_id', managerId)
      .order('occurred_at', { ascending: false })
      .limit(1)
    const ev = data![0]
    expect(ev.action).toBe('players.exported')
    expect(ev.entity_type).toBe('export')
    expect(ev.entity_id).toBeNull()
    expect(ev.source).toBe('manual')
    // Actor and actor name are derived server side, never from the client.
    expect(ev.actor_id).toBe(managerId)
    expect(ev.actor_name).toBeTruthy()
    expect(ev.season_id).toBe(seasonA)
  })

  it('records a safe filter summary and NEVER the search string or a name', async () => {
    const secret = name('SUPERSECRETNAME')
    const { error } = await manager.rpc('export_players', {
      p_season_id: seasonA,
      p_filters: { format: 'xlsx', statuses: ['pending'], team: TEST_TEAM, search: secret },
    })
    expect(error).toBeNull()

    const { data } = await serviceClient()
      .from('audit_events')
      .select('metadata, team_id')
      .eq('action', 'players.exported')
      .eq('actor_id', managerId)
      .order('occurred_at', { ascending: false })
      .limit(1)
    const ev = data![0]
    const md = ev.metadata as Record<string, unknown>
    expect(md.format).toBe('xlsx')
    expect(md.name_search_applied).toBe(true)
    expect(md.status_filter).toEqual(['pending'])
    expect(md.team_id_filter).toBe(TEST_TEAM)
    expect(typeof md.record_count).toBe('number')
    // The search string appears nowhere in the event, and no name key exists.
    expect(JSON.stringify(ev)).not.toContain('SUPERSECRETNAME')
    expect(Object.keys(md)).not.toContain('search')
    expect(Object.keys(md)).not.toContain('display_name')
    expect(Object.keys(md)).not.toContain('name')
  })

  it('refuses a coach who lacks players.export', async () => {
    const { error } = await coachOne.rpc('export_players', { p_season_id: seasonA, p_filters: {} })
    expect(error).not.toBeNull()
    expect(error!.code).toBe('42501')
  })

  it('refuses a parent', async () => {
    const { error } = await parent.rpc('export_players', { p_season_id: seasonA, p_filters: {} })
    expect(error).not.toBeNull()
    expect(error!.code).toBe('42501')
  })

  it('refuses an outsider (a coach in another club)', async () => {
    const { error } = await outsider.rpc('export_players', { p_season_id: seasonA, p_filters: {} })
    expect(error).not.toBeNull()
    expect(error!.code).toBe('42501')
  })

  it('refuses a cross club or unknown season for a holder', async () => {
    const { error } = await manager.rpc('export_players', { p_season_id: seasonOther, p_filters: {} })
    expect(error).not.toBeNull()
    expect(error!.code).toBe('42501')
  })
})
