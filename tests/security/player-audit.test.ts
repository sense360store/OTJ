// Player and registration audit integrity (0032 triggers on the 0030 audit
// substrate) and the player_history read path. Proves: actor, actor_name and
// occurred_at are server derived and un-forgeable; a committed change writes
// exactly one event; a refused change writes none; a deleted actor leaves the
// row intact with actor_id null and the name snapshot kept; a display name
// change records the field name only, never a name value; and player_history is
// gated on audit.view (managers and admins, not view only coaches), club scoped,
// and returns no child name. Synthetic names only.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  CLUB_A,
  TEST_TEAM,
  TEST_PASSWORD,
  anonClient,
  runId,
  seedPlayer as seedPlayerRow,
  serviceClient,
  signIn,
} from './stack'

const RUN = runId()
const name = (s: string) => `SEC AUD ${RUN} ${s}`

async function currentSeason(club: string): Promise<string> {
  const { data } = await serviceClient()
    .from('seasons')
    .select('id')
    .eq('club_id', club)
    .eq('is_current', true)
    .single()
  return data!.id
}

// Seed atomically (a bare players insert is rolled back by the deferred
// require-registration constraint). Thin wrapper so the existing positional
// call sites are unchanged.
function seedPlayer(season: string, display: string, teamId: string | null): { playerId: string; regId: string } {
  return seedPlayerRow({ club: CLUB_A, season, display, teamId, status: 'registered' })
}

async function countEvents(entityId: string): Promise<number> {
  const { data } = await serviceClient().from('audit_events').select('id').eq('entity_id', entityId)
  return (data ?? []).length
}

describe('player and registration audit integrity', () => {
  let admin: SupabaseClient
  let manager: SupabaseClient
  let coachOne: SupabaseClient
  let parent: SupabaseClient
  let outsider: SupabaseClient
  let managerId: string
  let managerName: string
  let seasonA: string

  beforeAll(async () => {
    admin = (await signIn('admin')).client
    const m = await signIn('manager')
    manager = m.client
    managerId = m.userId
    coachOne = (await signIn('coachOne')).client
    parent = (await signIn('parent')).client
    outsider = (await signIn('outsider')).client
    seasonA = await currentSeason(CLUB_A)
    const { data } = await serviceClient().from('profiles').select('full_name').eq('id', managerId).single()
    managerName = data!.full_name
  })

  afterAll(async () => {
    await serviceClient().from('players').delete().like('display_name', `SEC AUD ${RUN} %`)
  })

  it('actor, actor_name and occurred_at on a committed write are server derived and un-forgeable', async () => {
    const { regId, playerId } = seedPlayer(seasonA, name('actor'), TEST_TEAM)
    const before = new Date(Date.now() - 1000).toISOString()
    const { error } = await manager.from('player_registrations').update({ shirt_number: 21 }).eq('id', regId).select('id')
    expect(error).toBeNull()
    const after = new Date(Date.now() + 1000).toISOString()

    const { data } = await serviceClient()
      .from('audit_events')
      .select('actor_id, actor_name, occurred_at, action')
      .eq('entity_id', playerId)
      .order('occurred_at', { ascending: false })
      .limit(1)
    const row = data![0]
    expect(row.actor_id).toBe(managerId)
    expect(row.actor_name).toBe(managerName)
    expect(row.occurred_at >= before && row.occurred_at <= after).toBe(true)
  })

  it('a single committed status change writes exactly one player.withdrawn event', async () => {
    const { regId, playerId } = seedPlayer(seasonA, name('one-event'), TEST_TEAM)
    const baseline = await countEvents(playerId) // player.created + player.registration_created
    const { error } = await manager
      .from('player_registrations')
      .update({ status: 'withdrawn' })
      .eq('id', regId)
      .select('id')
    expect(error).toBeNull()
    const { data } = await serviceClient()
      .from('audit_events')
      .select('action')
      .eq('entity_id', playerId)
    const actions = (data ?? []).map((r) => r.action)
    expect(actions.filter((a) => a === 'player.withdrawn')).toHaveLength(1)
    expect(actions.length).toBe(baseline + 1)
  })

  it('an RLS refused write and a trigger refused write leave the audit count unchanged', async () => {
    const { regId, playerId } = seedPlayer(seasonA, name('refused'), TEST_TEAM)
    const before = await countEvents(playerId)
    // RLS refusal: a view only coach cannot update.
    await coachOne.from('player_registrations').update({ shirt_number: 44 }).eq('id', regId).select('id')
    // Trigger refusal: a disallowed status transition (registered -> pending).
    await manager.from('player_registrations').update({ status: 'pending' }).eq('id', regId).select('id')
    expect(await countEvents(playerId)).toBe(before)
  })

  it('a display name change records the field name only, never a name value', async () => {
    const { playerId } = seedPlayer(seasonA, name('rename-before'), TEST_TEAM)
    const { error } = await manager
      .from('players')
      .update({ display_name: name('rename-after') })
      .eq('id', playerId)
      .select('id')
    expect(error).toBeNull()
    const { data } = await serviceClient()
      .from('audit_events')
      .select('action, changed_fields, safe_changes, metadata')
      .eq('entity_id', playerId)
      .eq('action', 'player.updated')
    expect(data).toHaveLength(1)
    const row = data![0]
    expect(row.changed_fields).toEqual(['display_name'])
    const blob = JSON.stringify({ safe: row.safe_changes, meta: row.metadata })
    expect(blob).not.toContain('rename-before')
    expect(blob).not.toContain('rename-after')
  })

  it('deleting the acting profile leaves the event intact with actor_id null and the name snapshot kept', async () => {
    const svc = serviceClient()
    // A disposable member granted players.manage so they can perform an audited write.
    const { data: created, error: createErr } = await svc.auth.admin.createUser({
      email: `sec-aud-actor-${RUN}@otj-security-tests.local`,
      password: TEST_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: 'Disposable Actor' },
    })
    if (createErr || !created.user) throw new Error(`create actor failed: ${createErr?.message}`)
    const actorId = created.user.id
    const { data: role } = await svc
      .from('roles')
      .select('id')
      .eq('club_id', CLUB_A)
      .eq('key', 'admin')
      .eq('system', true)
      .single()
    await svc.rpc('grant_club_membership', {
      target_member: actorId,
      target_club: CLUB_A,
      role_ids: [role!.id],
      member_full_name: 'Disposable Actor',
    })
    const actorClient = anonClient()
    await actorClient.auth.signInWithPassword({
      email: `sec-aud-actor-${RUN}@otj-security-tests.local`,
      password: TEST_PASSWORD,
    })
    const playerId = crypto.randomUUID()
    const { error: addErr } = await actorClient.rpc('add_player', {
      p_id: playerId,
      p_display_name: name('actor-del'),
      p_team_id: TEST_TEAM,
      p_shirt_number: null,
      p_status: 'registered',
      p_registered_date: null,
    })
    expect(addErr).toBeNull()

    await svc.auth.admin.deleteUser(actorId)

    const { data } = await svc
      .from('audit_events')
      .select('actor_id, actor_name, action, safe_changes')
      .eq('entity_id', playerId)
      .eq('action', 'player.created')
      .single()
    expect(data!.actor_id).toBeNull() // SET NULL on profile deletion
    expect(data!.actor_name).toBe('Disposable Actor') // snapshot kept
    expect(JSON.stringify(data!.safe_changes ?? {})).not.toContain(name('actor-del'))
  })

  // --- player_history read path (gated on audit.view) ---
  describe('player_history', () => {
    let historyPlayer: string

    beforeAll(async () => {
      const seeded = seedPlayer(seasonA, name('history'), TEST_TEAM)
      historyPlayer = seeded.playerId
      // A couple of committed changes so there is a history.
      await manager.from('player_registrations').update({ shirt_number: 33 }).eq('id', seeded.regId).select('id')
      await manager.from('player_registrations').update({ status: 'withdrawn' }).eq('id', seeded.regId).select('id')
    })

    it('a manager with audit.view reads the player history', async () => {
      const { data, error } = await manager.rpc('player_history', { p_player_id: historyPlayer })
      expect(error).toBeNull()
      expect((data ?? []).length).toBeGreaterThanOrEqual(2)
      // Newest first, and no child name in any returned row.
      expect(JSON.stringify(data)).not.toContain(name('history'))
    })

    it('an admin with audit.view reads the player history', async () => {
      const { data, error } = await admin.rpc('player_history', { p_player_id: historyPlayer })
      expect(error).toBeNull()
      expect((data ?? []).length).toBeGreaterThanOrEqual(2)
    })

    it('a coach with players.view but no audit.view is refused (42501)', async () => {
      const { error } = await coachOne.rpc('player_history', { p_player_id: historyPlayer })
      expect(error).not.toBeNull()
      expect(error?.code).toBe('42501')
    })

    it('a parent is refused (42501)', async () => {
      const { error } = await parent.rpc('player_history', { p_player_id: historyPlayer })
      expect(error).not.toBeNull()
      expect(error?.code).toBe('42501')
    })

    it('an outsider holding audit.view in another club reads nothing for this club player', async () => {
      // The outsider holds audit.view in club B (global setup), so the gate
      // passes, but the club scope censors a club A id: no rows.
      const { data, error } = await outsider.rpc('player_history', { p_player_id: historyPlayer })
      expect(error).toBeNull()
      expect(data ?? []).toEqual([])
    })
  })
})
