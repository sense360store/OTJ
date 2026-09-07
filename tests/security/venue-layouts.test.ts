// The venue layouts and the club age group list added by 0053 (COACH-5).
//
// Intended contract:
//   venue_layouts      club wide read, a parent included: a layout names no
//                      child. Insert, update and delete take club.manage,
//                      club wide. One layout per kind and slots per (venue,
//                      season, age group), refused by the scope key. The
//                      zones shape is a check constraint that holds for
//                      every caller, service_role included: version 1, the
//                      key allow list at every level, bounds, exactly slots
//                      zones numbered 1..slots. Three stations and three
//                      games are not storable. A venue's removal takes its
//                      layouts; a season holding layouts is not removable.
//                      anon holds no grant at all.
//   clubs.age_groups   readable by every member of the club, written under
//                      club.manage alone, bounded for every caller.
//   audit              venue_layout.created, .updated (field names only) and
//                      .deleted, through the private writer; the trigger
//                      function is not callable through /rpc by anyone.
//
// What this suite cannot prove: a second connection racing the first on
// the scope key, and the migration's own self-verification. Both are
// driven against a real PostgreSQL in
// .github/scripts/production-migration/test_0053_venue_layouts.sh.
//
// Every fixture is synthetic: invented names, disposable ids.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  CLUB_A,
  CLUB_B,
  expectCheckConstraintRefusal,
  expectRlsInsertRefusal,
  runId,
  runSqlInContainer,
  serviceClient,
  signIn,
} from './stack'

const RUN = runId()
const venuePrefix = `SEC TEST layout venue ${RUN}`
const seasonName = `SL${RUN.slice(-6)}`

const FOUR = {
  version: 1,
  size: { metres_wide: 60, metres_long: 40 },
  zones: [
    { n: 1, name: 'Top left', x: 0.02, y: 0.02, w: 0.45, h: 0.45 },
    { n: 2, x: 0.53, y: 0.02, w: 0.45, h: 0.45 },
    { n: 3, x: 0.02, y: 0.53, w: 0.45, h: 0.45 },
    { n: 4, x: 0.53, y: 0.53, w: 0.45, h: 0.45 },
  ],
}
const ONE = { version: 1, zones: [{ n: 1, name: 'Main pitch', x: 0.1, y: 0.1, w: 0.8, h: 0.8 }] }
const THREE = {
  version: 1,
  zones: [
    { n: 1, x: 0, y: 0, w: 0.3, h: 1 },
    { n: 2, x: 0.35, y: 0, w: 0.3, h: 1 },
    { n: 3, x: 0.7, y: 0, w: 0.3, h: 1 },
  ],
}

describe('venue layouts row level security', () => {
  let admin: SupabaseClient
  let adminId: string
  let coachOne: SupabaseClient
  let parent: SupabaseClient
  let outsider: SupabaseClient
  let venueId: string
  let venueBId: string
  let seasonA: string
  let seasonB: string
  let layoutId: string

  const scope = (over: Record<string, unknown> = {}) => ({
    club_id: CLUB_A,
    venue_id: venueId,
    season_id: seasonA,
    age_group: 'U8s',
    kind: 'stations',
    slots: 4,
    zones: FOUR,
    ...over,
  })

  beforeAll(async () => {
    const service = serviceClient()
    const a = await signIn('admin')
    admin = a.client
    adminId = a.userId
    coachOne = (await signIn('coachOne')).client
    parent = (await signIn('parent')).client
    outsider = (await signIn('outsider')).client

    const { data: venue, error: venueErr } = await service
      .from('venues')
      .insert({ club_id: CLUB_A, name: `${venuePrefix} main` })
      .select('id')
      .single()
    if (venueErr) throw new Error(`could not seed the test venue: ${venueErr.message}`)
    venueId = venue!.id
    const { data: venueB, error: venueBErr } = await service
      .from('venues')
      .insert({ club_id: CLUB_B, name: `${venuePrefix} other club` })
      .select('id')
      .single()
    if (venueBErr) throw new Error(`could not seed the club B venue: ${venueBErr.message}`)
    venueBId = venueB!.id

    // A non current season in each club, so its removal below is refused by
    // the layouts reference and not by the seasons guard.
    for (const [club, key] of [
      [CLUB_A, 'A'],
      [CLUB_B, 'B'],
    ] as const) {
      const { data: season, error } = await service
        .from('seasons')
        .insert({ club_id: club, name: `${seasonName}${key}`, starts_on: '2031-07-01', ends_on: '2032-06-30', is_current: false })
        .select('id')
        .single()
      if (error) throw new Error(`could not seed the test season: ${error.message}`)
      if (key === 'A') seasonA = season!.id
      else seasonB = season!.id
    }
  })

  afterAll(async () => {
    const service = serviceClient()
    await service.from('venue_layouts').delete().in('season_id', [seasonA, seasonB])
    await service.from('venues').delete().like('name', `${venuePrefix}%`)
    await service.from('seasons').delete().in('id', [seasonA, seasonB])
    await service.from('clubs').update({ age_groups: [] }).eq('id', CLUB_A)
  })

  // ---- the club's age group list ----------------------------------------

  it('a coach without club.manage cannot set the club age groups', async () => {
    const { data, error } = await coachOne.from('clubs').update({ age_groups: ['U8s'] }).eq('id', CLUB_A).select('id')
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('a parent cannot set them either', async () => {
    const { data, error } = await parent.from('clubs').update({ age_groups: ['U8s'] }).eq('id', CLUB_A).select('id')
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('an admin sets them and every member reads them, a parent included', async () => {
    const { error } = await admin.from('clubs').update({ age_groups: ['U7s', 'U8s', 'U9s'] }).eq('id', CLUB_A)
    expect(error).toBeNull()
    for (const client of [admin, coachOne, parent]) {
      const { data, error: readErr } = await client.from('clubs').select('age_groups').eq('id', CLUB_A).single()
      expect(readErr).toBeNull()
      expect(data?.age_groups).toEqual(['U7s', 'U8s', 'U9s'])
    }
  })

  it('another club cannot read or set this club list', async () => {
    const { data: read } = await outsider.from('clubs').select('age_groups').eq('id', CLUB_A)
    expect(read).toEqual([])
    const { data, error } = await outsider.from('clubs').update({ age_groups: ['X'] }).eq('id', CLUB_A).select('id')
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('the list is bounded for every caller: a duplicate, a blank, an untrimmed and an over long label are refused', async () => {
    for (const list of [['U8s', 'U8s'], ['U8s', ''], ['U8s '], ['x'.repeat(21)]]) {
      const { error } = await serviceClient().from('clubs').update({ age_groups: list }).eq('id', CLUB_A)
      expectCheckConstraintRefusal(error, 'clubs_age_groups_valid')
    }
    const { data } = await admin.from('clubs').select('age_groups').eq('id', CLUB_A).single()
    expect(data?.age_groups).toEqual(['U7s', 'U8s', 'U9s'])
  })

  // ---- who may draw ------------------------------------------------------

  it('a coach without club.manage cannot draw a layout', async () => {
    const { error } = await coachOne.from('venue_layouts').insert(scope())
    expectRlsInsertRefusal(error)
  })

  it('a parent cannot draw a layout', async () => {
    const { error } = await parent.from('venue_layouts').insert(scope())
    expectRlsInsertRefusal(error)
  })

  it('an admin draws one, and every club member reads it, a parent included', async () => {
    const { data, error } = await admin.from('venue_layouts').insert(scope()).select('id, zones').single()
    expect(error).toBeNull()
    layoutId = data!.id
    expect(data!.zones).toEqual(FOUR)
    for (const client of [admin, coachOne, parent]) {
      const { data: rows, error: readErr } = await client.from('venue_layouts').select('id').eq('id', layoutId)
      expect(readErr).toBeNull()
      expect(rows).toHaveLength(1)
    }
  })

  it('a second age group at the same venue gets its own layout, and the same shape in one scope is refused', async () => {
    const { error: otherAge } = await admin.from('venue_layouts').insert(scope({ age_group: 'U7s' }))
    expect(otherAge).toBeNull()
    const { error } = await admin.from('venue_layouts').insert(scope())
    expect(error).not.toBeNull()
    expect(error!.code).toBe('23505')
    expect(error!.message).toContain('venue_layouts_scope_unique')
  })

  it('a coach without club.manage cannot redraw or remove a layout', async () => {
    const { data: updated, error: updateErr } = await coachOne
      .from('venue_layouts')
      .update({ zones: ONE, slots: 1, kind: 'games' })
      .eq('id', layoutId)
      .select('id')
    expect(updateErr).toBeNull()
    expect(updated).toEqual([])
    const { data: deleted, error: deleteErr } = await coachOne.from('venue_layouts').delete().eq('id', layoutId).select('id')
    expect(deleteErr).toBeNull()
    expect(deleted).toEqual([])
  })

  it('another club cannot read, redraw or remove this club layouts', async () => {
    const { data: read } = await outsider.from('venue_layouts').select('id').eq('id', layoutId)
    expect(read).toEqual([])
    const { data: updated } = await outsider.from('venue_layouts').update({ age_group: 'U12s' }).eq('id', layoutId).select('id')
    expect(updated).toEqual([])
    const { data: deleted } = await outsider.from('venue_layouts').delete().eq('id', layoutId).select('id')
    expect(deleted).toEqual([])
  })

  it('an admin cannot plant a layout in another club', async () => {
    const { error } = await admin.from('venue_layouts').insert(scope({ club_id: CLUB_B, venue_id: venueBId, season_id: seasonB }))
    expectRlsInsertRefusal(error)
  })

  it('a layout cannot reference another club venue or season: the composite keys carry the club', async () => {
    const { error: venueErr } = await serviceClient()
      .from('venue_layouts')
      .insert(scope({ club_id: CLUB_B, season_id: seasonB }))
    expect(venueErr?.code).toBe('23503')
    expect(venueErr?.message).toContain('venue_layouts_venue_fk')
    const { error: seasonErr } = await serviceClient()
      .from('venue_layouts')
      .insert(scope({ club_id: CLUB_B, venue_id: venueBId }))
    expect(seasonErr?.code).toBe('23503')
    expect(seasonErr?.message).toContain('venue_layouts_season_fk')
  })

  // ---- the shape, for every caller ----------------------------------------

  it('three stations and three games are not storable, for the service role too', async () => {
    for (const kind of ['stations', 'games']) {
      const { error } = await serviceClient().from('venue_layouts').insert(scope({ kind, slots: 3, zones: THREE, age_group: 'U9s' }))
      expectCheckConstraintRefusal(error, 'venue_layouts_slots_valid')
    }
  })

  it('four zones on a five slot row are refused', async () => {
    const { error } = await serviceClient().from('venue_layouts').insert(scope({ slots: 5, age_group: 'U9s' }))
    expectCheckConstraintRefusal(error, 'venue_layouts_zones_shape')
  })

  it('a place, a person and an image cannot enter a layout, from any caller', async () => {
    const refused = [
      { ...FOUR, address: '12 Church Lane' },
      { ...FOUR, postcode: 'WF5 0AA' },
      { ...FOUR, lat: 53.68, lng: -1.58 },
      { ...FOUR, image_url: 'https://tiles.example/x.png' },
      { ...ONE, zones: [{ ...ONE.zones[0], player_id: 'abc' }] },
      { ...ONE, zones: [{ ...ONE.zones[0], spond_member_id: 'ABC123' }] },
    ]
    for (const zones of refused) {
      const slots = zones.zones.length
      const kind = slots === 1 ? 'games' : 'stations'
      const { error } = await serviceClient().from('venue_layouts').insert(scope({ zones, slots, kind, age_group: 'U9s' }))
      expectCheckConstraintRefusal(error, 'venue_layouts_zones_shape')
    }
  })

  it('an unknown version, a coordinate off the surface and a string coordinate are refused cleanly', async () => {
    for (const zones of [
      { ...FOUR, version: 2 },
      { ...ONE, zones: [{ ...ONE.zones[0], x: 0.5 }] },
      { ...ONE, zones: [{ ...ONE.zones[0], x: '0.1' }] },
    ]) {
      const slots = zones.zones.length
      const kind = slots === 1 ? 'games' : 'stations'
      const { error } = await admin.from('venue_layouts').insert(scope({ zones, slots, kind, age_group: 'U9s' }))
      expectCheckConstraintRefusal(error, 'venue_layouts_zones_shape')
    }
  })

  it('an untrimmed or blank age group is refused', async () => {
    for (const age_group of [' U8s', '', '\t']) {
      const { error } = await admin.from('venue_layouts').insert(scope({ age_group, kind: 'games', slots: 1, zones: ONE }))
      expectCheckConstraintRefusal(error, 'venue_layouts_age_group_bounded')
    }
  })

  // ---- the trail ----------------------------------------------------------

  it('drawing, redrawing and removing leave the three events with field names and no value', async () => {
    const redrawn = { ...FOUR, zones: FOUR.zones.map((z, i) => (i === 0 ? { ...z, x: 0.05 } : z)) }
    const { error: redrawErr } = await admin.from('venue_layouts').update({ zones: redrawn }).eq('id', layoutId)
    expect(redrawErr).toBeNull()
    // The same value again writes no event.
    const { error: sameErr } = await admin.from('venue_layouts').update({ zones: redrawn }).eq('id', layoutId)
    expect(sameErr).toBeNull()
    const { data: deleted, error: deleteErr } = await admin.from('venue_layouts').delete().eq('id', layoutId).select('id')
    expect(deleteErr).toBeNull()
    expect(deleted).toHaveLength(1)

    // Compared as a set: the three requests are seconds apart in one order
    // and the assertion is about WHICH events exist, not about clock order.
    const rows = runSqlInContainer(
      `select action || '|' || coalesce(array_to_string(changed_fields, ','), '') || '|' || (safe_changes is null)::text || '|' || (metadata is null)::text || '|' || source || '|' || coalesce(actor_id::text, '')
         from public.audit_events
        where entity_type = 'venue_layout' and entity_id = '${layoutId}'
        order by action;`,
    )
      .trim()
      .split('\n')
      .sort()
    expect(rows).toEqual(
      [
        `venue_layout.created||true|true|manual|${adminId}`,
        `venue_layout.deleted||true|true|manual|${adminId}`,
        `venue_layout.updated|zones|true|true|manual|${adminId}`,
      ].sort(),
    )
  })

  it('a redraw is conditional on the value it opened on, so two admins cannot silently overwrite each other', async () => {
    const { data: fresh, error } = await admin
      .from('venue_layouts')
      .insert(scope({ kind: 'games', slots: 2, zones: { version: 1, zones: [{ n: 1, x: 0.02, y: 0.1, w: 0.45, h: 0.8 }, { n: 2, x: 0.53, y: 0.1, w: 0.45, h: 0.8 }] }, age_group: 'U9s' }))
      .select('id, zones')
      .single()
    expect(error).toBeNull()
    const opened = fresh!.zones
    const theirs = { version: 1, zones: [{ n: 1, x: 0.05, y: 0.1, w: 0.4, h: 0.8 }, { n: 2, x: 0.55, y: 0.1, w: 0.4, h: 0.8 }] }
    const mine = { version: 1, zones: [{ n: 1, x: 0.02, y: 0.15, w: 0.45, h: 0.7 }, { n: 2, x: 0.53, y: 0.15, w: 0.45, h: 0.7 }] }
    // The condition travels as JSON text: postgrest-js interpolates an eq
    // value, so an object would arrive as "[object Object]" and be refused.
    // The first redraw lands: the row still holds what was opened.
    const { data: first } = await admin.from('venue_layouts').update({ zones: theirs }).eq('id', fresh!.id).eq('zones', JSON.stringify(opened)).select('id')
    expect(first).toHaveLength(1)
    // The second, opened on the same value, finds no row and lands nothing.
    const { data: second, error: secondErr } = await admin.from('venue_layouts').update({ zones: mine }).eq('id', fresh!.id).eq('zones', JSON.stringify(opened)).select('id')
    expect(secondErr).toBeNull()
    expect(second).toEqual([])
    const { data: held } = await admin.from('venue_layouts').select('zones').eq('id', fresh!.id).single()
    expect(held?.zones).toEqual(theirs)
    await admin.from('venue_layouts').delete().eq('id', fresh!.id)
  })

  it('the trigger function is not callable through the API by anyone', async () => {
    // PostgREST does not expose a function returning trigger at all, so the
    // call fails to resolve (PGRST202) before any privilege is consulted;
    // the privilege itself is asserted directly, because that is the fact
    // the migration revokes and the one a future PostgREST could expose.
    for (const client of [admin, coachOne, parent]) {
      const { error } = await client.rpc('audit_venue_layouts')
      expect(error).not.toBeNull()
      expect(['PGRST202', '42501']).toContain(error!.code)
    }
    const privileges = runSqlInContainer(
      `select has_function_privilege('anon', 'public.audit_venue_layouts()', 'EXECUTE')::text
           || ',' || has_function_privilege('authenticated', 'public.audit_venue_layouts()', 'EXECUTE')::text;`,
    ).trim()
    expect(privileges).toBe('false,false')
  })

  // ---- the references -----------------------------------------------------

  it('a season holding layouts is not removable, and removing the venue takes its layouts with it', async () => {
    const { data: fresh, error } = await admin
      .from('venue_layouts')
      .insert(scope({ kind: 'games', slots: 1, zones: ONE, age_group: 'U9s' }))
      .select('id')
      .single()
    expect(error).toBeNull()
    const seasonDelete = runSqlInContainer(
      `do $$ begin
         delete from public.seasons where id = '${seasonA}';
         raise exception 'deleted';
       exception
         when foreign_key_violation then raise notice 'restricted';
       end $$; select 'ran';`,
    )
    expect(seasonDelete).toContain('ran')
    const { data: still } = await admin.from('venue_layouts').select('id').eq('id', fresh!.id)
    expect(still).toHaveLength(1)

    const { data: removed, error: venueErr } = await admin.from('venues').delete().eq('id', venueId).select('id')
    expect(venueErr).toBeNull()
    expect(removed).toHaveLength(1)
    const { data: gone } = await admin.from('venue_layouts').select('id').eq('venue_id', venueId)
    expect(gone).toEqual([])
  })

  // ---- grants ---------------------------------------------------------------

  it('grants anon nothing and authenticated exactly the four verbs', async () => {
    const rows = runSqlInContainer(
      `select grantee || ':' || string_agg(privilege_type, ',' order by privilege_type)
         from information_schema.role_table_grants
        where table_schema = 'public' and table_name = 'venue_layouts' and grantee in ('anon', 'authenticated')
        group by grantee order by grantee;`,
    ).trim()
    expect(rows).toBe('authenticated:DELETE,INSERT,SELECT,UPDATE')
  })
})
