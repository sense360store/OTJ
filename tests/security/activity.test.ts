// The club wide Activity page read boundary and its exact paginated query
// (0030 audit_events, docs/security/app-audit-boundary.md,
// docs/product/registered-players-ux.md section 11). Proves, through the SAME
// keyset query the page issues (src/lib/queries.ts useAuditActivity, built from
// src/lib/activityView helpers so this suite pins the real shape):
//   * audit.view is required to read: managers and admins read; a coach without
//     audit.view and a parent read zero rows; an outsider holding audit.view in
//     another club reads zero rows of this club (club scope is the club_id arm,
//     enforced server side, never a client supplied club identity).
//   * page windows are disjoint and complete: the 50 row keyset pages, ordered
//     occurred_at desc then id desc, reassemble the full ordered set with no
//     duplicate and no skipped row, including across occurred_at ties (a bulk
//     write shares one occurred_at, so the id tiebreak decides).
//   * pagination is stable under a concurrent insert: a newer event inserted
//     between fetching page 1 and page 2 never duplicates or skips an existing
//     paginated row, and does not appear inside the already fetched window.
//   * filters compose (season with source, season with entity).
//   * profile deletion does not break actor display: actor_id nulls, the
//     actor_name snapshot is kept, and the row still reads through the page.
//
// Every fixture is synthetic (invented ids and a test only actor name); no real
// child name or payload appears. Events are seeded through the service role, the
// sanctioned fixture path, and isolated by a per run season_id marker so the
// assertions see only this run's rows within the shared club feed.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { CLUB_A, CLUB_B, TEST_PASSWORD, anonClient, runId, serviceClient, signIn } from './stack'
import {
  ACTIVITY_PAGE_SIZE,
  ACTIVITY_SELECT_COLUMNS,
  EMPTY_FILTERS,
  activityQueryConditions,
  keysetOrFilter,
  type ActivityFilters,
} from '../../src/lib/activityView'

const RUN = runId()
const MARK = `sec-activity-${RUN}`
const ACTOR_NAME = `Sec Activity Actor ${RUN}`

// Per run season markers isolate this run's events within the shared club feed,
// and (being fresh per run) survive a prior run whose cleanup failed. season_id
// has no FK (an immutable historical id, by design), so an arbitrary uuid is a
// legal, non colliding marker that the page's own season filter can select on.
const PAGE_SEASON = crypto.randomUUID()
const COMPOSE_SEASON = crypto.randomUUID()
const DEL_SEASON = crypto.randomUUID()
const CLUBB_SEASON = crypto.randomUUID()

interface Row {
  id: string
  occurred_at: string
  actor_id: string | null
  actor_name: string | null
  action: string
  entity_type: string
  entity_id: string | null
  season_id: string | null
  team_id: string | null
  source: string
  changed_fields: string[] | null
  safe_changes: unknown
  batch_id: string | null
}

// The EXACT page query the app issues, built from the shared activityView
// helpers so this suite fails if the page's query shape drifts. Returns raw
// rows; the cursor is the (occurred_at, id) of the last row of a full page.
async function fetchPage(
  client: SupabaseClient,
  filters: ActivityFilters,
  cursor: { occurredAt: string; id: string } | null,
): Promise<Row[]> {
  let q = client
    .from('audit_events')
    .select(ACTIVITY_SELECT_COLUMNS)
    .order('occurred_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(ACTIVITY_PAGE_SIZE)
  for (const c of activityQueryConditions(filters)) {
    if (c.op === 'eq') q = q.eq(c.column, c.value)
    else if (c.op === 'gte') q = q.gte(c.column, c.value)
    else if (c.op === 'lt') q = q.lt(c.column, c.value)
  }
  const keyset = keysetOrFilter(cursor)
  if (keyset) q = q.or(keyset)
  const { data, error } = await q
  if (error) throw new Error(`page query failed: ${error.message}`)
  return (data ?? []) as Row[]
}

function cursorOf(rows: Row[]): { occurredAt: string; id: string } | null {
  if (rows.length < ACTIVITY_PAGE_SIZE) return null
  const last = rows[rows.length - 1]
  return { occurredAt: last.occurred_at, id: last.id }
}

const seasonFilter = (seasonId: string, extra: Partial<ActivityFilters> = {}): ActivityFilters => ({
  ...EMPTY_FILTERS,
  seasonId,
  ...extra,
})

describe('club wide Activity page read boundary and pagination', () => {
  let admin: SupabaseClient
  let manager: SupabaseClient
  let coachOne: SupabaseClient
  let parent: SupabaseClient
  let outsider: SupabaseClient
  let orderedPageIds: string[] // the full PAGE_SEASON set, in feed order

  beforeAll(async () => {
    admin = (await signIn('admin')).client
    manager = (await signIn('manager')).client
    coachOne = (await signIn('coachOne')).client
    parent = (await signIn('parent')).client
    outsider = (await signIn('outsider')).client

    const svc = serviceClient()

    // 120 PAGE_SEASON events across three occurred_at values, so each timestamp
    // carries 40 tied rows and the id tiebreak is exercised inside the index.
    const times = ['2026-06-01T10:00:00.000Z', '2026-06-01T09:00:00.000Z', '2026-06-01T08:00:00.000Z']
    const pageRows = Array.from({ length: 120 }, (_, i) => ({
      club_id: CLUB_A,
      occurred_at: times[i % 3],
      action: 'player.updated',
      entity_type: 'player',
      entity_id: crypto.randomUUID(),
      season_id: PAGE_SEASON,
      source: 'manual',
      actor_name: ACTOR_NAME,
      request_id: `${MARK}-page-${i}`,
    }))
    const { error: pErr } = await svc.from('audit_events').insert(pageRows)
    if (pErr) throw new Error(`could not seed the pagination events: ${pErr.message}`)

    // The authoritative ordered set (occurred_at desc, id desc), for the window
    // completeness assertions.
    const { data: expected, error: eErr } = await svc
      .from('audit_events')
      .select('id')
      .eq('season_id', PAGE_SEASON)
      .order('occurred_at', { ascending: false })
      .order('id', { ascending: false })
    if (eErr) throw new Error(`could not read the expected order: ${eErr.message}`)
    orderedPageIds = (expected ?? []).map((r: { id: string }) => r.id)

    // A handful of COMPOSE_SEASON events for the filter composition tests.
    const composeRows = [
      { entity_type: 'import_batch', source: 'csv_import' },
      { entity_type: 'import_batch', source: 'csv_import' },
      { entity_type: 'player', source: 'manual' },
      { entity_type: 'player', source: 'manual' },
      { entity_type: 'player', source: 'manual' },
    ].map((r, i) => ({
      club_id: CLUB_A,
      action: r.entity_type === 'player' ? 'player.updated' : 'players.import_completed',
      entity_type: r.entity_type,
      entity_id: crypto.randomUUID(),
      season_id: COMPOSE_SEASON,
      source: r.source,
      actor_name: ACTOR_NAME,
      request_id: `${MARK}-compose-${i}`,
    }))
    const { error: cErr } = await svc.from('audit_events').insert(composeRows)
    if (cErr) throw new Error(`could not seed the compose events: ${cErr.message}`)

    // One CLUB_B event, for cross club isolation both ways.
    const { error: bErr } = await svc.from('audit_events').insert({
      club_id: CLUB_B,
      action: 'player.updated',
      entity_type: 'player',
      entity_id: crypto.randomUUID(),
      season_id: CLUBB_SEASON,
      source: 'manual',
      actor_name: ACTOR_NAME,
      request_id: `${MARK}-clubb`,
    })
    if (bErr) throw new Error(`could not seed the club B event: ${bErr.message}`)
  })

  afterAll(async () => {
    await serviceClient().from('audit_events').delete().like('request_id', `${MARK}%`)
  })

  // ---- Read gating -----------------------------------------------------

  it('a manager with audit.view reads the club feed', async () => {
    const page = await fetchPage(manager, seasonFilter(PAGE_SEASON), null)
    expect(page.length).toBe(ACTIVITY_PAGE_SIZE)
  })

  it('an admin with audit.view reads the club feed', async () => {
    const page = await fetchPage(admin, seasonFilter(PAGE_SEASON), null)
    expect(page.length).toBe(ACTIVITY_PAGE_SIZE)
  })

  it('a coach without audit.view reads zero audit rows through the exact page query', async () => {
    const page = await fetchPage(coachOne, seasonFilter(PAGE_SEASON), null)
    expect(page).toEqual([])
  })

  it('a parent reads zero audit rows', async () => {
    const page = await fetchPage(parent, seasonFilter(PAGE_SEASON), null)
    expect(page).toEqual([])
  })

  it('an outsider holding audit.view in another club reads zero rows of this club', async () => {
    // Club scope is the club_id arm of the select policy, not the absence of
    // the capability: the outsider holds audit.view in club B yet sees nothing
    // of club A's feed.
    const page = await fetchPage(outsider, seasonFilter(PAGE_SEASON), null)
    expect(page).toEqual([])
  })

  it('cross club events are inaccessible both ways', async () => {
    // The club A manager never sees the club B event; the outsider (club B)
    // does. Neither can be widened by a client supplied filter.
    const aSeesB = await fetchPage(manager, seasonFilter(CLUBB_SEASON), null)
    expect(aSeesB).toEqual([])
    const bSeesB = await fetchPage(outsider, seasonFilter(CLUBB_SEASON), null)
    expect(bSeesB.length).toBe(1)
    const bSeesA = await fetchPage(outsider, seasonFilter(PAGE_SEASON), null)
    expect(bSeesA).toEqual([])
  })

  // ---- Pagination windows ---------------------------------------------

  it('page windows are disjoint and complete across occurred_at ties', async () => {
    const p1 = await fetchPage(manager, seasonFilter(PAGE_SEASON), null)
    const p2 = await fetchPage(manager, seasonFilter(PAGE_SEASON), cursorOf(p1))
    const p3 = await fetchPage(manager, seasonFilter(PAGE_SEASON), cursorOf(p2))
    const c3 = cursorOf(p3)

    expect(p1.length).toBe(50)
    expect(p2.length).toBe(50)
    expect(p3.length).toBe(20)
    expect(c3).toBeNull() // a short page ends the feed; no further fetch

    const ids = [...p1, ...p2, ...p3].map((r) => r.id)
    // Complete and in the exact feed order.
    expect(ids).toEqual(orderedPageIds)
    // Disjoint: no id appears twice.
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.length).toBe(120)
  })

  it('a newer event inserted between page 1 and page 2 does not duplicate or skip existing rows', async () => {
    const svc = serviceClient()
    // Page 1 first, over the original set.
    const p1 = await fetchPage(manager, seasonFilter(PAGE_SEASON), null)
    const cur = cursorOf(p1)
    expect(cur).not.toBeNull()

    // A newer event arrives (largest occurred_at), in the same season.
    const { data: inserted, error } = await svc
      .from('audit_events')
      .insert({
        club_id: CLUB_A,
        occurred_at: '2026-06-01T11:00:00.000Z',
        action: 'player.updated',
        entity_type: 'player',
        entity_id: crypto.randomUUID(),
        season_id: PAGE_SEASON,
        source: 'manual',
        actor_name: ACTOR_NAME,
        request_id: `${MARK}-concurrent`,
      })
      .select('id')
      .single()
    if (error) throw new Error(`could not insert the concurrent event: ${error.message}`)
    const newId = inserted!.id

    // Page 2 continues from the cursor, over the now larger set.
    const p2 = await fetchPage(manager, seasonFilter(PAGE_SEASON), cur)

    const p1ids = p1.map((r) => r.id)
    const p2ids = p2.map((r) => r.id)
    // The new event is above the cursor, so it is not in page 2.
    expect(p2ids).not.toContain(newId)
    // No duplicate across the two fetched windows.
    expect(p1ids.some((id) => p2ids.includes(id))).toBe(false)
    // No existing row skipped: the two windows still cover the original feed
    // positions 0..99 exactly, unaffected by the insert.
    expect([...p1ids, ...p2ids]).toEqual(orderedPageIds.slice(0, 100))
  })

  // ---- Filter composition ---------------------------------------------

  it('filters compose (season with source, season with entity)', async () => {
    const bySource = await fetchPage(manager, seasonFilter(COMPOSE_SEASON, { source: 'csv_import' }), null)
    expect(bySource.length).toBe(2)
    expect(bySource.every((r) => r.source === 'csv_import')).toBe(true)

    const byEntity = await fetchPage(manager, seasonFilter(COMPOSE_SEASON, { entity: 'player' }), null)
    expect(byEntity.length).toBe(3)
    expect(byEntity.every((r) => r.entity_type === 'player')).toBe(true)

    // An impossible composition (a csv_import that is also a player row) yields
    // nothing: the predicates are ANDed.
    const both = await fetchPage(manager, seasonFilter(COMPOSE_SEASON, { source: 'csv_import', entity: 'player' }), null)
    expect(both).toEqual([])
  })

  // ---- Deleted actor ---------------------------------------------------

  it('profile deletion does not break actor display through the page', async () => {
    const svc = serviceClient()
    // A disposable member, so no shared fixture is disturbed. Creating the user
    // builds a quarantined profile (0029), giving a valid actor_id to reference.
    const email = `sec-activity-actor-${RUN}@otj-security-tests.local`
    const { data: created, error: createErr } = await svc.auth.admin.createUser({
      email,
      password: TEST_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: 'Disposable Activity Actor' },
    })
    if (createErr || !created.user) throw new Error(`create actor failed: ${createErr?.message}`)
    const actorId = created.user.id

    const { error: insErr } = await svc.from('audit_events').insert({
      club_id: CLUB_A,
      action: 'player.updated',
      entity_type: 'player',
      entity_id: crypto.randomUUID(),
      season_id: DEL_SEASON,
      source: 'manual',
      actor_id: actorId,
      actor_name: 'Disposable Activity Actor',
      request_id: `${MARK}-del-actor`,
    })
    if (insErr) throw new Error(`seed actor event failed: ${insErr.message}`)

    // Delete the acting profile (cascades from the auth user).
    await svc.auth.admin.deleteUser(actorId)

    // The row still reads through the page query, with the actor id nulled and
    // the name snapshot kept, so the feed never breaks or loses accountability.
    const page = await fetchPage(manager, seasonFilter(DEL_SEASON), null)
    expect(page.length).toBe(1)
    expect(page[0].actor_id).toBeNull()
    expect(page[0].actor_name).toBe('Disposable Activity Actor')
  })

  // ---- Anon ------------------------------------------------------------

  it('anon reads nothing through the page query', async () => {
    const anon = anonClient()
    const { data, error } = await anon
      .from('audit_events')
      .select(ACTIVITY_SELECT_COLUMNS)
      .eq('season_id', PAGE_SEASON)
      .limit(ACTIVITY_PAGE_SIZE)
    expect(error !== null || (data ?? []).length === 0).toBe(true)
  })
})
