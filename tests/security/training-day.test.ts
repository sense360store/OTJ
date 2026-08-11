// The training day surfaces added by 0044: venues, session_teams and
// register_entries.
//
// Intended contract:
//   venues            club wide read, club.manage write. Deleting one
//                     nulls sessions.venue_id and leaves the session.
//   session_teams     club wide read; a row is added or removed only by
//                     someone who may edit the parent session (owner with
//                     sessions.create, or sessions.manage). No update.
//   register_entries  select requires players.view, exactly like the
//                     roster it resolves against, so a parent reads
//                     nothing. Insert, update and delete require
//                     sessions.create, club wide, because any coach on
//                     the day marks arrivals. Identity and club are
//                     immutable and marked_by cannot be forged.
//
// Every fixture is synthetic: invented names, disposable ids.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  CLUB_A,
  CLUB_B,
  TEST_TEAM,
  expectCheckConstraintRefusal,
  expectRlsInsertRefusal,
  expectTriggerRefusal,
  runId,
  runSqlInContainer,
  seedPlayer,
  serviceClient,
  signIn,
} from './stack'

const RUN = runId()
const venuePrefix = `SEC TEST venue ${RUN}`
const sessionPrefix = `SEC TEST td session ${RUN}`
const playerPrefix = `SEC TEST td player ${RUN}`

describe('training day row level security', () => {
  let admin: SupabaseClient
  let manager: SupabaseClient
  let coachOne: SupabaseClient
  let coachTwo: SupabaseClient
  let parent: SupabaseClient
  let outsider: SupabaseClient
  let coachOneId: string
  let coachTwoId: string
  let venueId: string
  let ownSession: string
  let playerId: string
  let seasonA: string

  beforeAll(async () => {
    const service = serviceClient()
    admin = (await signIn('admin')).client
    manager = (await signIn('manager')).client
    const c1 = await signIn('coachOne')
    coachOne = c1.client
    coachOneId = c1.userId
    const c2 = await signIn('coachTwo')
    coachTwo = c2.client
    coachTwoId = c2.userId
    parent = (await signIn('parent')).client
    outsider = (await signIn('outsider')).client

    const { data: venue, error: venueErr } = await service
      .from('venues')
      .insert({ club_id: CLUB_A, name: `${venuePrefix} main` })
      .select('id')
      .single()
    if (venueErr) throw new Error(`could not seed the test venue: ${venueErr.message}`)
    venueId = venue!.id

    const { data: session, error: sessionErr } = await service
      .from('sessions')
      .insert({ club_id: CLUB_A, coach_id: coachOneId, name: `${sessionPrefix} own` })
      .select('id')
      .single()
    if (sessionErr) throw new Error(`could not seed the test session: ${sessionErr.message}`)
    ownSession = session!.id

    const { data: season } = await service
      .from('seasons')
      .select('id')
      .eq('club_id', CLUB_A)
      .eq('is_current', true)
      .single()
    seasonA = season!.id
    playerId = seedPlayer({
      club: CLUB_A,
      season: seasonA,
      display: `${playerPrefix} one`,
      teamId: TEST_TEAM,
      createdBy: coachOneId,
    }).playerId
  })

  afterAll(async () => {
    const service = serviceClient()
    await service.from('sessions').delete().like('name', `${sessionPrefix}%`)
    await service.from('players').delete().like('display_name', `${playerPrefix}%`)
    await service.from('venues').delete().like('name', `${venuePrefix}%`)
  })

  // --- Venues -------------------------------------------------------

  it('every club member reads the club venues, a parent included', async () => {
    for (const client of [admin, coachOne, parent]) {
      const { data, error } = await client.from('venues').select('id').eq('id', venueId)
      expect(error).toBeNull()
      expect(data).toHaveLength(1)
    }
  })

  it('a coach without club.manage cannot create, rename or remove a venue', async () => {
    const { error: insertErr } = await coachOne
      .from('venues')
      .insert({ club_id: CLUB_A, name: `${venuePrefix} by coach` })
    expectRlsInsertRefusal(insertErr)

    const { data: renamed, error: renameErr } = await coachOne
      .from('venues')
      .update({ name: `${venuePrefix} renamed by coach` })
      .eq('id', venueId)
      .select('id')
    expect(renameErr).toBeNull()
    expect(renamed).toEqual([])

    const { data: removed, error: removeErr } = await coachOne
      .from('venues')
      .delete()
      .eq('id', venueId)
      .select('id')
    expect(removeErr).toBeNull()
    expect(removed).toEqual([])
  })

  it('refuses a venue name made only of whitespace, for every caller', async () => {
    // btrim with no second argument strips the space character only, so a
    // tab or newline name would otherwise pass the not-blank check and the
    // club would carry a venue nobody can see the name of.
    for (const name of ['   ', '\t', '\n', ' \t\r\n ']) {
      const { error } = await serviceClient().from('venues').insert({ club_id: CLUB_A, name })
      expectCheckConstraintRefusal(error, 'venues_name_not_blank')
    }
  })

  it('grants anon nothing on any of the three new tables', async () => {
    const rows = runSqlInContainer(
      `select coalesce(string_agg(distinct table_name || ':' || privilege_type, ','), 'none')
         from information_schema.role_table_grants
        where table_schema = 'public'
          and table_name in ('venues','session_teams','register_entries')
          and grantee = 'anon';`,
    ).trim()
    expect(rows).toBe('none')
  })

  it('grants no UPDATE on coverage: a row is added or removed, never edited', async () => {
    const rows = runSqlInContainer(
      `select coalesce(string_agg(privilege_type, ','), 'none')
         from information_schema.role_table_grants
        where table_schema = 'public' and table_name = 'session_teams'
          and grantee = 'authenticated';`,
    ).trim()
    expect(rows.split(',').sort().join(',')).toBe('DELETE,INSERT,SELECT')
  })

  it('a parent cannot create a venue', async () => {
    const { error } = await parent.from('venues').insert({ club_id: CLUB_A, name: `${venuePrefix} by parent` })
    expectRlsInsertRefusal(error)
  })

  it('another club cannot read or touch this club venue', async () => {
    const { data, error } = await outsider.from('venues').select('id').eq('id', venueId)
    expect(error).toBeNull()
    expect(data).toEqual([])

    const { data: renamed } = await outsider
      .from('venues')
      .update({ name: `${venuePrefix} hijacked` })
      .eq('id', venueId)
      .select('id')
    expect(renamed).toEqual([])
  })

  it('an admin cannot plant a venue in another club', async () => {
    const { error } = await admin.from('venues').insert({ club_id: CLUB_B, name: `${venuePrefix} cross club` })
    expectRlsInsertRefusal(error)
  })

  it('an admin manages venues in their own club', async () => {
    const { data, error } = await admin
      .from('venues')
      .insert({ club_id: CLUB_A, name: `${venuePrefix} by admin` })
      .select('id')
      .single()
    expect(error).toBeNull()
    const { data: removed, error: removeErr } = await admin
      .from('venues')
      .delete()
      .eq('id', data!.id)
      .select('id')
    expect(removeErr).toBeNull()
    expect(removed).toHaveLength(1)
  })

  it('removing a venue leaves its sessions, unplaced', async () => {
    // The composite reference sets null on venue_id ALONE. A bare set null
    // would null club_id too and the delete would fail on its not null
    // constraint, making a used venue undeletable.
    const service = serviceClient()
    const { data: doomed } = await service
      .from('venues')
      .insert({ club_id: CLUB_A, name: `${venuePrefix} doomed` })
      .select('id')
      .single()
    const { data: placed } = await service
      .from('sessions')
      .insert({ club_id: CLUB_A, coach_id: coachOneId, name: `${sessionPrefix} placed`, venue_id: doomed!.id })
      .select('id')
      .single()

    const { error } = await admin.from('venues').delete().eq('id', doomed!.id)
    expect(error).toBeNull()

    const { data: after } = await service
      .from('sessions')
      .select('id, club_id, venue_id')
      .eq('id', placed!.id)
      .single()
    expect(after!.venue_id).toBeNull()
    expect(after!.club_id).toBe(CLUB_A)
  })

  it('a session cannot reference another club venue', async () => {
    const service = serviceClient()
    const { data: theirs } = await service
      .from('venues')
      .insert({ club_id: CLUB_B, name: `${venuePrefix} club B` })
      .select('id')
      .single()
    const { error } = await coachOne
      .from('sessions')
      .update({ venue_id: theirs!.id })
      .eq('id', ownSession)
    // The composite foreign key refuses it below RLS: 23503.
    expect(error?.code).toBe('23503')
  })

  // --- Coverage -----------------------------------------------------

  it('a coach covers their own session and every member reads the coverage', async () => {
    const { error } = await coachOne
      .from('session_teams')
      .insert({ session_id: ownSession, team_id: TEST_TEAM, club_id: CLUB_A })
    expect(error).toBeNull()

    for (const client of [admin, coachTwo, parent]) {
      const { data, error: readErr } = await client
        .from('session_teams')
        .select('team_id')
        .eq('session_id', ownSession)
      expect(readErr).toBeNull()
      expect(data).toHaveLength(1)
    }
  })

  it('another coach cannot add or remove coverage on a session they do not own', async () => {
    const { error: insertErr } = await coachTwo
      .from('session_teams')
      .insert({ session_id: ownSession, team_id: TEST_TEAM, club_id: CLUB_A })
    expectRlsInsertRefusal(insertErr)

    const { data: removed, error: removeErr } = await coachTwo
      .from('session_teams')
      .delete()
      .eq('session_id', ownSession)
      .select('team_id')
    expect(removeErr).toBeNull()
    expect(removed).toEqual([])
  })

  it('a parent cannot set coverage', async () => {
    const { error } = await parent
      .from('session_teams')
      .insert({ session_id: ownSession, team_id: TEST_TEAM, club_id: CLUB_A })
    expectRlsInsertRefusal(error)
  })

  it('a forged club_id on a coverage row is refused', async () => {
    const { error } = await coachOne
      .from('session_teams')
      .insert({ session_id: ownSession, team_id: TEST_TEAM, club_id: CLUB_B })
    expectRlsInsertRefusal(error)
  })

  it('another club cannot read or write this club coverage', async () => {
    const { data, error } = await outsider.from('session_teams').select('team_id').eq('session_id', ownSession)
    expect(error).toBeNull()
    expect(data).toEqual([])

    const { error: insertErr } = await outsider
      .from('session_teams')
      .insert({ session_id: ownSession, team_id: TEST_TEAM, club_id: CLUB_A })
    expectRlsInsertRefusal(insertErr)
  })

  it('a manager sets coverage on any club session', async () => {
    const service = serviceClient()
    const { data: theirs } = await service
      .from('sessions')
      .insert({ club_id: CLUB_A, coach_id: coachTwoId, name: `${sessionPrefix} managed` })
      .select('id')
      .single()
    const { error } = await manager
      .from('session_teams')
      .insert({ session_id: theirs!.id, team_id: TEST_TEAM, club_id: CLUB_A })
    expect(error).toBeNull()
  })

  it('deleting a team removes its coverage rows and leaves the session', async () => {
    // The widening bug this guards against lives on the client: coverage
    // read as empty must never be read as the whole club. Here the point
    // is only that the cascade fires and the session survives.
    const service = serviceClient()
    const { data: doomedTeam } = await service
      .from('teams')
      .insert({ club_id: CLUB_A, name: `SEC TEST td team ${RUN}` })
      .select('id')
      .single()
    const { data: covered } = await service
      .from('sessions')
      .insert({ club_id: CLUB_A, coach_id: coachOneId, name: `${sessionPrefix} covered` })
      .select('id')
      .single()
    await service
      .from('session_teams')
      .insert({ session_id: covered!.id, team_id: doomedTeam!.id, club_id: CLUB_A })

    const { error } = await admin.from('teams').delete().eq('id', doomedTeam!.id)
    expect(error).toBeNull()

    const { data: rows } = await service.from('session_teams').select('team_id').eq('session_id', covered!.id)
    expect(rows).toEqual([])
    const { data: still } = await service.from('sessions').select('id').eq('id', covered!.id)
    expect(still).toHaveLength(1)
  })

  // --- The register -------------------------------------------------

  it('a coach marks a player present on any club session', async () => {
    const { error } = await coachTwo
      .from('register_entries')
      .insert({ session_id: ownSession, player_id: playerId, club_id: CLUB_A, present: true })
    expect(error).toBeNull()
    const { data } = await coachTwo
      .from('register_entries')
      .select('present, source, marked_by')
      .eq('session_id', ownSession)
      .eq('player_id', playerId)
      .single()
    expect(data!.present).toBe(true)
    expect(data!.source).toBe('roster')
  })

  it('marked_by is stamped from the caller and cannot be forged', async () => {
    const { data } = await serviceClient()
      .from('register_entries')
      .select('marked_by')
      .eq('session_id', ownSession)
      .eq('player_id', playerId)
      .single()
    expect(data!.marked_by).toBe(coachTwoId)

    await coachOne
      .from('register_entries')
      .update({ present: false, marked_by: coachTwoId })
      .eq('session_id', ownSession)
      .eq('player_id', playerId)
    const { data: after } = await serviceClient()
      .from('register_entries')
      .select('marked_by')
      .eq('session_id', ownSession)
      .eq('player_id', playerId)
      .single()
    expect(after!.marked_by).toBe(coachOneId)
  })

  it('a partial upsert changes only the field it names, so two coaches cannot revert each other', async () => {
    // The pitch side race this pins: one coach includes a child in
    // tonight's groups while another sets that child's bib. Both writes go
    // through the same upsert the client uses, each carrying ONLY the
    // fields its edit changed. A whole row write would carry a stale value
    // for the other field and silently undo it, which is why the client
    // still sends partials even now that a save commits a whole
    // arrangement at once: tonightUpsertRows omits every key the change
    // did not move.
    // This test exists because that guarantee depends on how PostgREST
    // translates a partial payload into ON CONFLICT DO UPDATE SET, which
    // is worth proving rather than assuming.
    const racePlayer = seedPlayer({
      club: CLUB_A,
      season: seasonA,
      display: `${playerPrefix} race`,
      teamId: TEST_TEAM,
    }).playerId

    const { error: tickErr } = await coachOne
      .from('register_entries')
      .upsert(
        { session_id: ownSession, player_id: racePlayer, club_id: CLUB_A, present: true },
        { onConflict: 'session_id,player_id' },
      )
    expect(tickErr).toBeNull()

    // A second coach sets the bib only. present is absent from this payload.
    const { error: bibErr } = await coachTwo
      .from('register_entries')
      .upsert(
        { session_id: ownSession, player_id: racePlayer, club_id: CLUB_A, bib_colour_override: 'red' },
        { onConflict: 'session_id,player_id' },
      )
    expect(bibErr).toBeNull()

    const { data: after } = await serviceClient()
      .from('register_entries')
      .select('present, bib_colour_override, source')
      .eq('session_id', ownSession)
      .eq('player_id', racePlayer)
      .single()
    expect(after!.present).toBe(true)
    expect(after!.bib_colour_override).toBe('red')

    // And the reverse order: ticking after a bib was set keeps the bib.
    const { error: tickAgainErr } = await coachOne
      .from('register_entries')
      .upsert(
        { session_id: ownSession, player_id: racePlayer, club_id: CLUB_A, present: false },
        { onConflict: 'session_id,player_id' },
      )
    expect(tickAgainErr).toBeNull()
    const { data: after2 } = await serviceClient()
      .from('register_entries')
      .select('present, bib_colour_override')
      .eq('session_id', ownSession)
      .eq('player_id', racePlayer)
      .single()
    expect(after2!.present).toBe(false)
    expect(after2!.bib_colour_override).toBe('red')
  })

  it('a quick add records its source, and a later partial write does not reset it', async () => {
    const guest = seedPlayer({
      club: CLUB_A,
      season: seasonA,
      display: `${playerPrefix} guest`,
    }).playerId
    await coachOne
      .from('register_entries')
      .upsert(
        { session_id: ownSession, player_id: guest, club_id: CLUB_A, present: true, source: 'manual' },
        { onConflict: 'session_id,player_id' },
      )
    await coachOne
      .from('register_entries')
      .upsert(
        { session_id: ownSession, player_id: guest, club_id: CLUB_A, bib_colour_override: 'blue' },
        { onConflict: 'session_id,player_id' },
      )
    const { data } = await serviceClient()
      .from('register_entries')
      .select('source, present, bib_colour_override')
      .eq('session_id', ownSession)
      .eq('player_id', guest)
      .single()
    // source is what makes the row removable as a quick add; losing it
    // would strip the coach's undo.
    expect(data!.source).toBe('manual')
    expect(data!.present).toBe(true)
    expect(data!.bib_colour_override).toBe('blue')
  })

  it('a parent cannot read the register: it says which children were where', async () => {
    const { data, error } = await parent.from('register_entries').select('session_id, player_id')
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('a parent cannot mark anyone present', async () => {
    const { error } = await parent
      .from('register_entries')
      .insert({ session_id: ownSession, player_id: playerId, club_id: CLUB_A, present: true })
    expectRlsInsertRefusal(error)
  })

  it('another club cannot read or write this club register', async () => {
    const { data, error } = await outsider.from('register_entries').select('player_id')
    expect(error).toBeNull()
    expect(data).toEqual([])

    const { error: insertErr } = await outsider
      .from('register_entries')
      .insert({ session_id: ownSession, player_id: playerId, club_id: CLUB_A, present: true })
    expectRlsInsertRefusal(insertErr)
  })

  it('a register row cannot be moved to another session, player or club', async () => {
    const service = serviceClient()
    const { data: other } = await service
      .from('sessions')
      .insert({ club_id: CLUB_A, coach_id: coachOneId, name: `${sessionPrefix} other` })
      .select('id')
      .single()
    const { error } = await coachOne
      .from('register_entries')
      .update({ session_id: other!.id })
      .eq('session_id', ownSession)
      .eq('player_id', playerId)
    expectTriggerRefusal(error, 'cannot change its session, player or club')
  })

  it('a bib colour outside the vocabulary is refused for every caller', async () => {
    const { error } = await coachOne
      .from('register_entries')
      .update({ bib_colour_override: 'chartreuse' })
      .eq('session_id', ownSession)
      .eq('player_id', playerId)
    expectCheckConstraintRefusal(error, 'bib_colour_override')

    const { error: teamErr } = await admin
      .from('teams')
      .update({ bib_colour: 'chartreuse' })
      .eq('id', TEST_TEAM)
    expectCheckConstraintRefusal(teamErr, 'teams_bib_colour_vocabulary')
  })

  it('no bib is storable and distinct from an unset override', async () => {
    const { error } = await coachOne
      .from('register_entries')
      .update({ bib_colour_override: 'none' })
      .eq('session_id', ownSession)
      .eq('player_id', playerId)
    expect(error).toBeNull()
  })

  it('a register row cannot name a player from another club', async () => {
    const service = serviceClient()
    const { data: seasonB } = await service
      .from('seasons')
      .select('id')
      .eq('club_id', CLUB_B)
      .eq('is_current', true)
      .maybeSingle()
    if (!seasonB) return
    const theirPlayer = seedPlayer({
      club: CLUB_B,
      season: seasonB.id,
      display: `${playerPrefix} club B`,
    }).playerId
    const { error } = await coachOne
      .from('register_entries')
      .insert({ session_id: ownSession, player_id: theirPlayer, club_id: CLUB_A, present: true })
    // The composite reference refuses it below RLS.
    expect(error?.code).toBe('23503')
  })

  it('deleting a session removes its register', async () => {
    const service = serviceClient()
    const { data: doomed } = await service
      .from('sessions')
      .insert({ club_id: CLUB_A, coach_id: coachOneId, name: `${sessionPrefix} doomed` })
      .select('id')
      .single()
    await service
      .from('register_entries')
      .insert({ session_id: doomed!.id, player_id: playerId, club_id: CLUB_A, present: true })

    const { error } = await coachOne.from('sessions').delete().eq('id', doomed!.id)
    expect(error).toBeNull()
    const { data: rows } = await service.from('register_entries').select('player_id').eq('session_id', doomed!.id)
    expect(rows).toEqual([])
  })

  it('erasing a child removes every register row naming them', async () => {
    // The erasure contract: a child leaves the club and the attendance
    // record goes with them, with no orphan id left behind.
    const service = serviceClient()
    const gone = seedPlayer({
      club: CLUB_A,
      season: seasonA,
      display: `${playerPrefix} erased`,
      teamId: TEST_TEAM,
    }).playerId
    await service
      .from('register_entries')
      .insert({ session_id: ownSession, player_id: gone, club_id: CLUB_A, present: true })

    await service.from('players').delete().eq('id', gone)
    const { data: rows } = await service.from('register_entries').select('session_id').eq('player_id', gone)
    expect(rows).toEqual([])
  })

  it('anon reads none of the three tables', async () => {
    const { anonClient } = await import('./stack')
    const anon = anonClient()
    for (const table of ['venues', 'session_teams', 'register_entries']) {
      const { data } = await anon.from(table).select('*').limit(1)
      expect(data ?? []).toEqual([])
    }
  })
})
