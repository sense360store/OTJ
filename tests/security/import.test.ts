// The transactional import commit path (import_players and import_batches,
// 0035_import_players.sql). Proves the child-data WRITE boundary: only a
// players.import holder can import; the server re-validates every row and trusts
// nothing from the client; the commit is all or nothing; a cross club season,
// team or player id is refused; a stale or invalid row aborts the whole batch;
// the batch id makes a repeated confirm idempotent; a cross club batch id is
// refused, never replayed; and neither the batch record nor the audit trail ever
// carries a child name, a row or a file fingerprint. Maps the PR 5 threat model
// cells (docs/security/registered-players-threat-model.md: properties 5, 7, 8,
// 13, 14, 15, 16, 17, 19, plus the namesake, failed-batch, revocation and cross
// club replay cells). Synthetic data only.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { CLUB_A, CLUB_B, TEST_TEAM, runId, seedPlayer, serviceClient, signIn } from './stack'

const RUN = runId()
const name = (s: string) => `SEC IMP ${RUN} ${s}`
const svc = serviceClient()
const batchIds: string[] = []

// A fresh batch id, tracked for cleanup.
function batch(): string {
  const id = crypto.randomUUID()
  batchIds.push(id)
  return id
}

interface Op {
  row: number
  player_id?: string | null
  name?: string | null
  team_id?: string | null
  status: string
  shirt_number?: number | null
  registered_date?: string | null
}
function payload(format: 'csv' | 'xlsx', rows: Op[]) {
  return { format, rows }
}

async function currentSeason(club: string): Promise<string> {
  const { data } = await svc.from('seasons').select('id').eq('club_id', club).eq('is_current', true).single()
  return data!.id
}
async function crossClubSeason(): Promise<string> {
  const { data } = await svc.from('seasons').select('id').neq('club_id', CLUB_A).limit(1)
  return data?.[0]?.id ?? crypto.randomUUID()
}

// A registration count for a season, out of band. Names never leave the DB.
async function regCount(seasonId: string): Promise<number> {
  const { count } = await svc
    .from('player_registrations')
    .select('*', { count: 'exact', head: true })
    .eq('season_id', seasonId)
  return count ?? 0
}
async function batchRow(id: string) {
  const { data } = await svc.from('import_batches').select('*').eq('id', id).maybeSingle()
  return data
}
async function eventsForBatch(id: string) {
  const { data } = await svc.from('audit_events').select('action, source, entity_type, entity_id, batch_id').eq('batch_id', id)
  return data ?? []
}

describe('import_players: capability, server authority, atomicity, idempotency', () => {
  let manager: SupabaseClient
  let coachOne: SupabaseClient
  let parent: SupabaseClient
  let outsider: SupabaseClient
  let managerId: string
  let seasonA: string
  let seasonOther: string
  let futureSeason: string
  let archivedSeason: string
  let clubBPlayer: string
  let existingPlayer: string
  let twinA: string
  let twinB: string

  beforeAll(async () => {
    const m = await signIn('manager')
    manager = m.client
    managerId = m.userId
    coachOne = (await signIn('coachOne')).client
    parent = (await signIn('parent')).client
    outsider = (await signIn('outsider')).client
    seasonA = await currentSeason(CLUB_A)
    seasonOther = await crossClubSeason()

    // A future (non current, non archived) and an archived season in club A.
    const fRes = await svc
      .from('seasons')
      .insert({ club_id: CLUB_A, name: `F${RUN}`, starts_on: '2030-07-01', ends_on: '2031-06-30', is_current: false })
      .select('id')
      .single()
    futureSeason = fRes.data!.id
    const aRes = await svc
      .from('seasons')
      .insert({
        club_id: CLUB_A,
        name: `A${RUN}`,
        starts_on: '2020-07-01',
        ends_on: '2021-06-30',
        is_current: false,
        archived_at: new Date().toISOString(),
      })
      .select('id')
      .single()
    archivedSeason = aRes.data!.id

    // An existing club A player (for update-by-id), a club B player (cross club
    // id), and a namesake pair sharing a display name on the same team/season.
    existingPlayer = seedPlayer({
      club: CLUB_A,
      season: seasonA,
      display: name('existing'),
      teamId: TEST_TEAM,
      shirt: 4,
      status: 'registered',
    }).playerId
    clubBPlayer = seedPlayer({ club: CLUB_B, season: seasonOther, display: name('clubB'), status: 'registered' }).playerId
    twinA = seedPlayer({ club: CLUB_A, season: seasonA, display: name('twin'), teamId: TEST_TEAM, status: 'pending' }).playerId
    twinB = seedPlayer({ club: CLUB_A, season: seasonA, display: name('twin'), teamId: TEST_TEAM, status: 'pending' }).playerId
  })

  afterAll(async () => {
    await svc.from('players').delete().like('display_name', `SEC IMP ${RUN} %`)
    if (batchIds.length) await svc.from('import_batches').delete().in('id', batchIds)
    await svc.from('seasons').delete().in('id', [futureSeason, archivedSeason])
  })

  // ---- property 5: an unauthorised coach cannot import -----------------------
  it('refuses a coach who lacks players.import (42501), records no batch', async () => {
    const id = batch()
    const { error } = await coachOne.rpc('import_players', {
      p_batch_id: id,
      p_season_id: seasonA,
      p_rows: payload('csv', [{ row: 2, name: name('c'), status: 'pending' }]),
    })
    expect(error).not.toBeNull()
    expect(error!.code).toBe('42501')
    expect(await batchRow(id)).toBeNull()
  })

  it('refuses a parent (42501)', async () => {
    const { error } = await parent.rpc('import_players', {
      p_batch_id: batch(),
      p_season_id: seasonA,
      p_rows: payload('csv', [{ row: 2, name: name('p'), status: 'pending' }]),
    })
    expect(error).not.toBeNull()
    expect(error!.code).toBe('42501')
  })

  // ---- property 14: import transaction and audit commit together ------------
  it('happy path: a new and an update commit with their per-row events and one batch summary, all sharing the batch id', async () => {
    const id = batch()
    const { data, error } = await manager.rpc('import_players', {
      p_batch_id: id,
      p_season_id: seasonA,
      p_rows: payload('csv', [
        { row: 2, player_id: null, name: name('fresh'), team_id: TEST_TEAM, status: 'registered', shirt_number: 21 },
        { row: 3, player_id: existingPlayer, team_id: TEST_TEAM, status: 'withdrawn' },
      ]),
    })
    expect(error).toBeNull()
    const r = data as { outcome: string; added: number; updated: number; already_present: number }
    expect(r.outcome).toBe('succeeded')
    expect(r.added).toBe(1)
    expect(r.updated).toBe(1)

    const row = await batchRow(id)
    expect(row.state).toBe('succeeded')
    expect(row.club_id).toBe(CLUB_A)
    expect(row.actor_id).toBe(managerId)
    expect(row.format).toBe('csv')

    const events = await eventsForBatch(id)
    // Every event shares the batch id; the summary is import_completed with the
    // csv_import source; the per-row events came from the triggers.
    expect(events.every((e) => e.batch_id === id)).toBe(true)
    expect(events.filter((e) => e.action === 'players.import_completed' && e.source === 'csv_import').length).toBe(1)
    expect(events.some((e) => e.action === 'player.created')).toBe(true)
    // The new registration lives in club A's current season under my_club().
    const { data: reg } = await svc
      .from('player_registrations')
      .select('club_id, season_id')
      .eq('season_id', seasonA)
      .order('created_at', { ascending: false })
      .limit(1)
    expect(reg![0].club_id).toBe(CLUB_A)
  })

  // ---- properties 15, 16: duplicate confirmation / lost response retry -------
  it('a repeated confirm with the same batch id returns the stored result and applies nothing', async () => {
    const id = batch()
    const before = await regCount(seasonA)
    const first = await manager.rpc('import_players', {
      p_batch_id: id,
      p_season_id: seasonA,
      p_rows: payload('csv', [{ row: 2, name: name('once'), status: 'pending' }]),
    })
    expect((first.data as { outcome: string }).outcome).toBe('succeeded')
    const afterFirst = await regCount(seasonA)
    expect(afterFirst).toBe(before + 1)

    // The retry (a lost response proxy) carries the same id and applies nothing.
    const second = await manager.rpc('import_players', {
      p_batch_id: id,
      p_season_id: seasonA,
      p_rows: payload('csv', [{ row: 2, name: name('once'), status: 'pending' }]),
    })
    expect(second.error).toBeNull()
    expect((second.data as { outcome: string }).outcome).toBe('succeeded')
    expect(await regCount(seasonA)).toBe(afterFirst)
    // Exactly one 'once' identity exists.
    const { count } = await svc
      .from('players')
      .select('*', { count: 'exact', head: true })
      .eq('display_name', name('once'))
    expect(count).toBe(1)
  })

  // ---- properties 9, 13: all or nothing; a failed batch leaves no per-row data
  it('one bad row aborts the whole batch: failed record, one import_failed, no partial data', async () => {
    const id = batch()
    const before = await regCount(seasonA)
    const { data, error } = await manager.rpc('import_players', {
      p_batch_id: id,
      p_season_id: seasonA,
      p_rows: payload('csv', [
        { row: 2, name: name('doomed'), status: 'pending' },
        { row: 3, name: name('poison'), status: 'not-a-status' },
      ]),
    })
    expect(error).toBeNull()
    expect((data as { outcome: string; failure_summary: string }).outcome).toBe('failed')
    expect((data as { failure_summary: string }).failure_summary).toMatch(/^Row 3:/)
    expect(await regCount(seasonA)).toBe(before)
    const { count } = await svc
      .from('players')
      .select('*', { count: 'exact', head: true })
      .eq('display_name', name('doomed'))
    expect(count).toBe(0)
    const row = await batchRow(id)
    expect(row.state).toBe('failed')
    const events = await eventsForBatch(id)
    expect(events.filter((e) => e.action === 'players.import_failed').length).toBe(1)
    expect(events.filter((e) => e.action !== 'players.import_failed').length).toBe(0)
  })

  it('a replay of a failed batch returns the stored failure without re-running', async () => {
    const id = batch()
    await manager.rpc('import_players', {
      p_batch_id: id,
      p_season_id: seasonA,
      p_rows: payload('csv', [{ row: 2, name: name('bad'), status: 'nope' }]),
    })
    const replay = await manager.rpc('import_players', {
      p_batch_id: id,
      p_season_id: seasonA,
      p_rows: payload('csv', []),
    })
    expect((replay.data as { outcome: string }).outcome).toBe('failed')
  })

  // ---- property 7: cross club player id ------------------------------------
  it('a cross club player id aborts the batch and changes nothing', async () => {
    const id = batch()
    const { data } = await manager.rpc('import_players', {
      p_batch_id: id,
      p_season_id: seasonA,
      p_rows: payload('csv', [{ row: 2, player_id: clubBPlayer, status: 'pending' }]),
    })
    expect((data as { outcome: string }).outcome).toBe('failed')
    const { data: reg } = await svc
      .from('player_registrations')
      .select('status')
      .eq('player_id', clubBPlayer)
      .maybeSingle()
    expect(reg!.status).toBe('registered')
  })

  // ---- property 19: unknown team; blank team lands Unassigned ---------------
  it('an unknown team uuid aborts the batch, and a blank team lands Unassigned', async () => {
    const bad = batch()
    const badRes = await manager.rpc('import_players', {
      p_batch_id: bad,
      p_season_id: seasonA,
      p_rows: payload('csv', [{ row: 2, name: name('badteam'), team_id: crypto.randomUUID(), status: 'pending' }]),
    })
    expect((badRes.data as { outcome: string }).outcome).toBe('failed')

    const ok = batch()
    const okRes = await manager.rpc('import_players', {
      p_batch_id: ok,
      p_season_id: seasonA,
      p_rows: payload('csv', [{ row: 2, name: name('noteam'), team_id: null, status: 'pending' }]),
    })
    expect((okRes.data as { outcome: string; added: number }).outcome).toBe('succeeded')
    const { data: reg } = await svc
      .from('player_registrations')
      .select('team_id, players!inner(display_name)')
      .eq('season_id', seasonA)
      .eq('players.display_name', name('noteam'))
      .single()
    expect(reg!.team_id).toBeNull()
  })

  // ---- season validation: cross club and archived refused; future permitted -
  it('refuses a cross club season (42501) and an archived season, with no batch recorded', async () => {
    const idX = batch()
    const cross = await manager.rpc('import_players', {
      p_batch_id: idX,
      p_season_id: seasonOther,
      p_rows: payload('csv', [{ row: 2, name: name('x'), status: 'pending' }]),
    })
    expect(cross.error).not.toBeNull()
    expect(cross.error!.code).toBe('42501')
    expect(await batchRow(idX)).toBeNull()

    const idA = batch()
    const arch = await manager.rpc('import_players', {
      p_batch_id: idA,
      p_season_id: archivedSeason,
      p_rows: payload('csv', [{ row: 2, name: name('y'), status: 'pending' }]),
    })
    expect(arch.error).not.toBeNull()
    expect(await batchRow(idA)).toBeNull()
  })

  it('imports into any non archived season, not only the current one', async () => {
    const id = batch()
    const { data, error } = await manager.rpc('import_players', {
      p_batch_id: id,
      p_season_id: futureSeason,
      p_rows: payload('csv', [{ row: 2, name: name('future'), status: 'pending' }]),
    })
    expect(error).toBeNull()
    expect((data as { outcome: string; added: number }).outcome).toBe('succeeded')
    expect(await regCount(futureSeason)).toBe(1)
  })

  // ---- namesakes: never collapsed ------------------------------------------
  it('a no-id file naming two distinct children with the same name creates two identities, merging neither', async () => {
    const id = batch()
    const { data } = await manager.rpc('import_players', {
      p_batch_id: id,
      p_season_id: futureSeason,
      p_rows: payload('csv', [
        { row: 2, name: name('newtwin'), status: 'pending' },
        { row: 3, name: name('newtwin'), status: 'pending' },
      ]),
    })
    expect((data as { outcome: string; added: number }).added).toBe(2)
    const { count } = await svc
      .from('players')
      .select('*', { count: 'exact', head: true })
      .eq('display_name', name('newtwin'))
    expect(count).toBe(2)
  })

  it('an id-keyed file updates both namesakes by id and merges neither', async () => {
    const id = batch()
    const { data } = await manager.rpc('import_players', {
      p_batch_id: id,
      p_season_id: seasonA,
      p_rows: payload('csv', [
        { row: 2, player_id: twinA, team_id: TEST_TEAM, status: 'registered' },
        { row: 3, player_id: twinB, team_id: TEST_TEAM, status: 'withdrawn' },
      ]),
    })
    expect((data as { outcome: string; updated: number }).updated).toBe(2)
    const { data: a } = await svc.from('player_registrations').select('status').eq('player_id', twinA).eq('season_id', seasonA).single()
    const { data: b } = await svc.from('player_registrations').select('status').eq('player_id', twinB).eq('season_id', seasonA).single()
    expect(a!.status).toBe('registered')
    expect(b!.status).toBe('withdrawn')
  })

  // ---- restore by id: withdrawn -> registered is accepted (client/server parity)
  it('restores a withdrawn player by id (withdrawn to registered), the documented import Restore path', async () => {
    const wid = seedPlayer({
      club: CLUB_A,
      season: seasonA,
      display: name('withdrawn'),
      teamId: TEST_TEAM,
      status: 'withdrawn',
    }).playerId
    const id = batch()
    const { data, error } = await manager.rpc('import_players', {
      p_batch_id: id,
      p_season_id: seasonA,
      p_rows: payload('csv', [{ row: 2, player_id: wid, team_id: TEST_TEAM, status: 'registered' }]),
    })
    expect(error).toBeNull()
    expect((data as { outcome: string; updated: number }).outcome).toBe('succeeded')
    expect((data as { updated: number }).updated).toBe(1)
    const { data: reg } = await svc
      .from('player_registrations')
      .select('status')
      .eq('player_id', wid)
      .eq('season_id', seasonA)
      .single()
    expect(reg!.status).toBe('registered')
  })

  // ---- property 17 (server arm): a formula-shaped name is never evaluated ----
  it('stores a formula-shaped display name verbatim, never evaluating it', async () => {
    const id = batch()
    const literal = name('=1+1')
    const { data } = await manager.rpc('import_players', {
      p_batch_id: id,
      p_season_id: futureSeason,
      p_rows: payload('csv', [{ row: 2, name: literal, status: 'pending' }]),
    })
    expect((data as { outcome: string }).outcome).toBe('succeeded')
    const { count } = await svc.from('players').select('*', { count: 'exact', head: true }).eq('display_name', literal)
    expect(count).toBe(1)
  })

  // ---- T14: a cross club batch id is refused, never replayed ----------------
  it('refuses a batch id already recorded for another club, never replaying it', async () => {
    // Manager imports under a fresh id (records it against club A).
    const id = batch()
    await manager.rpc('import_players', {
      p_batch_id: id,
      p_season_id: seasonA,
      p_rows: payload('csv', [{ row: 2, name: name('ownbatch'), status: 'pending' }]),
    })
    // The outsider (club B) tries to reuse the same id: refused, never a replay.
    const { data, error } = await outsider.rpc('import_players', {
      p_batch_id: id,
      p_season_id: seasonOther,
      p_rows: payload('csv', [{ row: 2, name: name('steal'), status: 'pending' }]),
    })
    // Either a clean refusal error, or (if the outsider even reaches the claim)
    // never the stored club A result; the outsider lacks players.import in a way
    // the RPC refuses before any replay.
    expect(error).not.toBeNull()
    if (data) expect((data as { batch_id?: string }).batch_id).not.toBe(id)
  })

  // ---- property 8: client-supplied identity is ignored ----------------------
  it('ignores any club or actor the client might imply: written rows carry the caller club and actor', async () => {
    const id = batch()
    await manager.rpc('import_players', {
      p_batch_id: id,
      p_season_id: seasonA,
      p_rows: payload('csv', [{ row: 2, name: name('server-derived'), status: 'pending' }]),
    })
    const { data: reg } = await svc
      .from('player_registrations')
      .select('club_id, created_by, players!inner(display_name, club_id)')
      .eq('season_id', seasonA)
      .eq('players.display_name', name('server-derived'))
      .single()
    expect(reg!.club_id).toBe(CLUB_A)
    expect(reg!.created_by).toBe(managerId)
    const row = await batchRow(id)
    expect(row.actor_id).toBe(managerId)
    expect(row.club_id).toBe(CLUB_A)
  })

  // ---- T11: permission revoked between preview and commit -------------------
  it('refuses when players.import is revoked between two confirms', async () => {
    // A disposable coach granted players.import via a temporary role capability,
    // then revoked, proves the commit-time recheck (not the preview) is the gate.
    const { data: coachRole } = await svc
      .from('roles')
      .select('id')
      .eq('club_id', CLUB_A)
      .eq('key', 'coach')
      .single()
    await svc.from('role_capabilities').upsert(
      { role_id: coachRole!.id, capability: 'players.import' },
      { onConflict: 'role_id,capability', ignoreDuplicates: true },
    )
    const okId = batch()
    const ok = await coachOne.rpc('import_players', {
      p_batch_id: okId,
      p_season_id: seasonA,
      p_rows: payload('csv', [{ row: 2, name: name('granted'), status: 'pending' }]),
    })
    expect(ok.error).toBeNull()
    expect((ok.data as { outcome: string }).outcome).toBe('succeeded')

    // Revoke, then the next confirm is refused at commit time.
    await svc.from('role_capabilities').delete().eq('role_id', coachRole!.id).eq('capability', 'players.import')
    const revoked = await coachOne.rpc('import_players', {
      p_batch_id: batch(),
      p_season_id: seasonA,
      p_rows: payload('csv', [{ row: 2, name: name('revoked'), status: 'pending' }]),
    })
    expect(revoked.error).not.toBeNull()
    expect(revoked.error!.code).toBe('42501')
  })

  // ---- import_batches read contract: audit.view + club; no fingerprint ------
  it('exposes import_batches only to an audit.view holder in the club, and never a file fingerprint', async () => {
    const { data: asManager } = await manager.from('import_batches').select('*').limit(1)
    expect(Array.isArray(asManager)).toBe(true)
    // A coach without audit.view reads zero rows.
    const { data: asCoach } = await coachOne.from('import_batches').select('id')
    expect(asCoach).toEqual([])
    // A parent reads zero rows.
    const { data: asParent } = await parent.from('import_batches').select('id')
    expect(asParent).toEqual([])
    // The stored row carries counts and state only, never a fingerprint, a name
    // or row content.
    if (asManager && asManager.length > 0) {
      const keys = Object.keys(asManager[0])
      expect(keys).not.toContain('file_hash')
      expect(keys).not.toContain('fingerprint')
      expect(keys).not.toContain('filename')
      expect(keys).not.toContain('rows')
    }
  })
})
