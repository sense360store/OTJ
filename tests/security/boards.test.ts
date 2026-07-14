// Boards RLS matrix and the board data boundary (the remediation of the
// confirmed safeguarding finding: roster seeding used to copy children's
// names from the parents-cannot-read players table (0021) into token labels
// inside club-readable board rows).
//
// Since 0028_board_player_boundary the contract is structural: a board token
// persists at most { id, number, side, x, y, playerId }. The name never
// enters the row; a coach resolves it through the players select (RLS:
// sessions.create holders only) and a parent has nothing to resolve against.
// The boards_tokens_minimal_shape check constraint enforces the shape below
// RLS, for every caller including the service role, and the
// board_tokens_without_names function preserved from the migration lets this
// suite prove the exact backfill semantics the migration ran with.
//
// All names here are synthetic fixtures, never real children.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  CLUB_A,
  TEST_TEAM,
  expectCheckConstraintRefusal,
  expectRlsInsertRefusal,
  runId,
  serviceClient,
  signIn,
} from './stack'

const RUN = runId()
const rosterName = `SEC TEST Roster Child ${RUN}`
const renamedName = `SEC TEST Renamed Child ${RUN}`
const twinName = `SEC TEST Twin Child ${RUN}`
const doomedName = `SEC TEST Doomed Child ${RUN}`
const boardName = `SEC TEST board ${RUN}`

// Every synthetic name this run mints; no board payload may ever contain any
// of them, whatever else the fixtures do.
const ALL_NAMES = [rosterName, renamedName, twinName, doomedName]

interface StoredToken {
  id?: string
  number?: number
  side?: string
  x?: number
  y?: number
  playerId?: string
}

describe('boards row level security and the board data boundary', () => {
  let coachOne: SupabaseClient
  let parent: SupabaseClient
  let coachOneId: string
  let parentId: string
  let boardId: string
  let playerId: string
  let doomedPlayerId: string

  beforeAll(async () => {
    const c1 = await signIn('coachOne')
    const p = await signIn('parent')
    coachOne = c1.client
    parent = p.client
    coachOneId = c1.userId
    parentId = p.userId

    // The exact flow the app supports since the boundary: roster rows exist,
    // and a coach saves a board whose tokens reference the players by id.
    // No name is in the tokens; the render resolves it (see tacticsBoard.ts
    // rosterTokens and serializeTokens).
    const service = serviceClient()
    const { data: players, error: playerErr } = await service
      .from('players')
      .insert([
        { club_id: CLUB_A, team_id: TEST_TEAM, display_name: rosterName, shirt_number: 7, created_by: coachOneId },
        { club_id: CLUB_A, team_id: TEST_TEAM, display_name: doomedName, shirt_number: 9, created_by: coachOneId },
      ])
      .select('id, display_name')
    if (playerErr || !players) throw new Error(`could not seed the fixture players: ${playerErr?.message}`)
    playerId = players.find((r) => r.display_name === rosterName)!.id
    doomedPlayerId = players.find((r) => r.display_name === doomedName)!.id

    const { data: board, error: boardErr } = await coachOne
      .from('boards')
      .insert({
        club_id: CLUB_A,
        created_by: coachOneId,
        name: boardName,
        tokens: [
          { id: 'home-7', number: 7, side: 'home', x: 0.5, y: 0.5, playerId },
          { id: 'home-9', number: 9, side: 'home', x: 0.4, y: 0.6, playerId: doomedPlayerId },
          // A hand placed tactical token: no player behind it.
          { id: 'away-1', number: 1, side: 'away', x: 0.5, y: 0.2 },
        ],
      })
      .select('id')
      .single()
    if (boardErr) throw new Error(`could not create the fixture board: ${boardErr.message}`)
    boardId = board!.id
  })

  afterAll(async () => {
    const service = serviceClient()
    await service.from('boards').delete().like('name', `${boardName}%`)
    await service.from('players').delete().like('display_name', `SEC TEST%${RUN}%`)
  })

  it('club members, parents included, can read saved boards (club-wide reads by design)', async () => {
    const { data, error } = await parent.from('boards').select('id, name').eq('id', boardId)
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
  })

  // The remediated finding, now a permanent regression guard (formerly the
  // suite's one expected failure, declared it.fails): the board payload a
  // parent receives contains no child name, because no name is in the row.
  it('parent board payload contains no child name anywhere', async () => {
    const { data, error } = await parent.from('boards').select('*').eq('id', boardId).single()
    expect(error).toBeNull()
    const payload = JSON.stringify(data)
    for (const name of ALL_NAMES) expect(payload).not.toContain(name)
    // And structurally: every token carries only the six allowed fields.
    const tokens = (data?.tokens ?? []) as StoredToken[]
    expect(tokens.length).toBe(3)
    for (const t of tokens) {
      for (const key of Object.keys(t)) {
        expect(['id', 'number', 'side', 'x', 'y', 'playerId']).toContain(key)
      }
    }
  })

  it('parent cannot resolve a token playerId into a name: the players select stays blocked', async () => {
    // The token hands a parent an opaque uuid. Resolving it needs the players
    // select, which RLS answers only for sessions.create holders.
    const { data, error } = await parent.from('players').select('display_name').eq('id', playerId)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('coach resolves token names correctly through the players select', async () => {
    const { data: board } = await coachOne.from('boards').select('tokens').eq('id', boardId).single()
    const tokens = (board?.tokens ?? []) as StoredToken[]
    const ref = tokens.find((t) => t.playerId === playerId)
    expect(ref).toBeDefined()
    const { data: player, error } = await coachOne
      .from('players')
      .select('display_name, shirt_number')
      .eq('id', ref!.playerId!)
      .single()
    expect(error).toBeNull()
    expect(player?.display_name).toBe(rosterName)
    expect(player?.shirt_number).toBe(7)
  })

  it('renaming a player updates what a coach resolves; the board row never changes', async () => {
    const service = serviceClient()
    const { data: before } = await coachOne.from('boards').select('tokens').eq('id', boardId).single()

    const { error: renameErr } = await service
      .from('players')
      .update({ display_name: renamedName })
      .eq('id', playerId)
    expect(renameErr).toBeNull()

    // The coach's resolution now yields the new name from the same reference.
    const { data: player } = await coachOne.from('players').select('display_name').eq('id', playerId).single()
    expect(player?.display_name).toBe(renamedName)

    // The board row is untouched: names live in one place only.
    const { data: after } = await coachOne.from('boards').select('tokens').eq('id', boardId).single()
    expect(after?.tokens).toEqual(before?.tokens)
  })

  it('a shirt number change never rewrites a saved board: the token number is a point-in-time fact', async () => {
    const service = serviceClient()
    const { error } = await service.from('players').update({ shirt_number: 23 }).eq('id', playerId)
    expect(error).toBeNull()
    const { data: board } = await coachOne.from('boards').select('tokens').eq('id', boardId).single()
    const tokens = (board?.tokens ?? []) as StoredToken[]
    expect(tokens.find((t) => t.playerId === playerId)?.number).toBe(7)
    // A fresh seed would pick up 23; rosterTokens is covered at the unit level.
  })

  it('deleting a player leaves the board intact with a safe numbered fallback', async () => {
    const service = serviceClient()
    const { error: delErr } = await service.from('players').delete().eq('id', doomedPlayerId)
    expect(delErr).toBeNull()

    // The board still returns all three tokens; the orphaned reference keeps
    // its number and position, and resolving it now finds nothing, so every
    // client renders a plain numbered disc.
    const { data: board, error } = await coachOne.from('boards').select('tokens').eq('id', boardId).single()
    expect(error).toBeNull()
    const tokens = (board?.tokens ?? []) as StoredToken[]
    expect(tokens.length).toBe(3)
    const orphan = tokens.find((t) => t.playerId === doomedPlayerId)
    expect(orphan?.number).toBe(9)
    const { data: resolved } = await coachOne.from('players').select('id').eq('id', doomedPlayerId)
    expect(resolved).toEqual([])
    // And the deleted child's name appears nowhere in the board payload.
    expect(JSON.stringify(board)).not.toContain(doomedName)
  })

  it('manual tactical tokens survive untouched alongside player references', async () => {
    const { data: board } = await parent.from('boards').select('tokens').eq('id', boardId).single()
    const tokens = (board?.tokens ?? []) as StoredToken[]
    const manual = tokens.find((t) => t.id === 'away-1')
    expect(manual).toEqual({ id: 'away-1', number: 1, side: 'away', x: 0.5, y: 0.2 })
  })

  it('the check constraint refuses a token label for a coach: a name cannot be persisted', async () => {
    const { error } = await coachOne.from('boards').insert({
      club_id: CLUB_A,
      created_by: coachOneId,
      name: `${boardName} with label`,
      tokens: [{ id: 'home-7', number: 7, label: rosterName, side: 'home', x: 0.5, y: 0.5 }],
    })
    expectCheckConstraintRefusal(error, 'boards_tokens_minimal_shape')
  })

  it('the check constraint holds below RLS: even the service role cannot persist a label', async () => {
    const service = serviceClient()
    const { error } = await service.from('boards').insert({
      club_id: CLUB_A,
      created_by: coachOneId,
      name: `${boardName} service label`,
      tokens: [{ id: 'home-7', number: 7, label: rosterName, side: 'home', x: 0.5, y: 0.5 }],
    })
    expectCheckConstraintRefusal(error, 'boards_tokens_minimal_shape')
  })

  it('the check constraint refuses any stray token field, not just label', async () => {
    // The shape is a whitelist, so a name cannot come back under another key.
    const { error } = await coachOne.from('boards').insert({
      club_id: CLUB_A,
      created_by: coachOneId,
      name: `${boardName} stray key`,
      tokens: [{ id: 'home-7', number: 7, displayName: rosterName, side: 'home', x: 0.5, y: 0.5 }],
    })
    expectCheckConstraintRefusal(error, 'boards_tokens_minimal_shape')
  })

  it('the migration backfill strips duplicated names: exact-unique labels become playerId, the rest are dropped', async () => {
    // board_tokens_without_names is the transform 0028 ran, preserved so its
    // semantics stay executable. Twins prove the ambiguity rule: a label
    // matching TWO club players links nothing and is simply removed.
    const service = serviceClient()
    const { data: twins, error: twinErr } = await service
      .from('players')
      .insert([
        { club_id: CLUB_A, team_id: TEST_TEAM, display_name: twinName, shirt_number: 11, created_by: coachOneId },
        { club_id: CLUB_A, team_id: TEST_TEAM, display_name: twinName, shirt_number: 12, created_by: coachOneId },
      ])
      .select('id')
    expect(twinErr).toBeNull()
    expect(twins).toHaveLength(2)

    const legacyTokens = [
      // A roster-derived label matching exactly one player (renamed earlier).
      { id: 'home-7', number: 7, label: renamedName, side: 'home', x: 0.5, y: 0.5 },
      // A label matching two players: ambiguous, so stripped without a link.
      { id: 'home-11', number: 11, label: twinName, side: 'home', x: 0.4, y: 0.4 },
      // A label matching no current player (a deleted child, or old free
      // text): cannot be proven not to be a name, so stripped.
      { id: 'home-9', number: 9, label: doomedName, side: 'home', x: 0.3, y: 0.3 },
      // A manual tactical token: untouched.
      { id: 'away-1', number: 1, side: 'away', x: 0.2, y: 0.2 },
    ]
    const { data, error } = await service.rpc('board_tokens_without_names', {
      p_tokens: legacyTokens,
      p_club: CLUB_A,
    })
    expect(error).toBeNull()
    const cleaned = data as StoredToken[]
    expect(cleaned).toHaveLength(4)

    // No name text survives anywhere in the output.
    const payload = JSON.stringify(cleaned)
    for (const name of ALL_NAMES) expect(payload).not.toContain(name)

    // The unique match became a reference; positions, numbers and ids held.
    expect(cleaned[0]).toEqual({ id: 'home-7', number: 7, side: 'home', x: 0.5, y: 0.5, playerId })
    // The ambiguous match linked nothing.
    expect(cleaned[1]).toEqual({ id: 'home-11', number: 11, side: 'home', x: 0.4, y: 0.4 })
    // The unmatched label was dropped, the token preserved.
    expect(cleaned[2]).toEqual({ id: 'home-9', number: 9, side: 'home', x: 0.3, y: 0.3 })
    // The manual token is byte-for-byte what went in.
    expect(cleaned[3]).toEqual({ id: 'away-1', number: 1, side: 'away', x: 0.2, y: 0.2 })

    // And the cleaned output satisfies the constraint's shape test.
    const { data: minimal } = await service.rpc('board_tokens_are_minimal', { p_tokens: cleaned })
    expect(minimal).toBe(true)
  })

  it('parent cannot create a board', async () => {
    const { error } = await parent.from('boards').insert({
      club_id: CLUB_A,
      created_by: parentId,
      name: `${boardName} by parent`,
      tokens: [],
    })
    expectRlsInsertRefusal(error)
  })

  it('parent cannot update or delete another member board', async () => {
    const { data: updated, error: updateErr } = await parent
      .from('boards')
      .update({ name: `${boardName} renamed` })
      .eq('id', boardId)
      .select('id')
    expect(updateErr).toBeNull()
    expect(updated).toEqual([])

    const { data: deleted, error: deleteErr } = await parent
      .from('boards')
      .delete()
      .eq('id', boardId)
      .select('id')
    expect(deleteErr).toBeNull()
    expect(deleted).toEqual([])
  })
})
