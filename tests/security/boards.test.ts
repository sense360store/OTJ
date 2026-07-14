// Boards RLS matrix, including the confirmed safeguarding finding: boards
// are club-readable by design (0020_boards) and their tokens jsonb carries
// free-text labels. When a coach seeds a board from the roster, a child's
// display_name from the parents-cannot-read players table (0021) is copied
// into a token label that every club member, parents included, can read.
//
// This file records the current behaviour (club-wide board reads) and
// carries ONE known failing safeguarding test asserting the intended
// contract: a parent must not receive roster-derived token labels. It is
// declared with it.fails, so the suite reports it as an expected failure
// today; when the remediation migration lands, flip it to a plain it() so
// it becomes a permanent regression guard. This PR changes no policy.
//
// All names here are synthetic fixtures, never real children.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { CLUB_A, TEST_TEAM, expectRlsInsertRefusal, runId, serviceClient, signIn } from './stack'

const RUN = runId()
const rosterName = `SEC TEST Roster Child ${RUN}`
const boardName = `SEC TEST board ${RUN}`

describe('boards row level security and the roster label leak', () => {
  let coachOne: SupabaseClient
  let parent: SupabaseClient
  let coachOneId: string
  let parentId: string
  let boardId: string

  beforeAll(async () => {
    const c1 = await signIn('coachOne')
    const p = await signIn('parent')
    coachOne = c1.client
    parent = p.client
    coachOneId = c1.userId
    parentId = p.userId

    // The exact flow the app supports: a roster row exists, and a coach
    // saves a board whose token label was seeded from that roster row (the
    // board stores the name as a plain string snapshot, per 0020/0021).
    const service = serviceClient()
    const { error: playerErr } = await service.from('players').insert({
      club_id: CLUB_A,
      team_id: TEST_TEAM,
      display_name: rosterName,
      shirt_number: 7,
      created_by: coachOneId,
    })
    if (playerErr) throw new Error(`could not seed the fixture player: ${playerErr.message}`)

    const { data: board, error: boardErr } = await coachOne
      .from('boards')
      .insert({
        club_id: CLUB_A,
        created_by: coachOneId,
        name: boardName,
        tokens: [{ number: 7, label: rosterName, side: 'home', x: 0.5, y: 0.5 }],
      })
      .select('id')
      .single()
    if (boardErr) throw new Error(`could not create the fixture board: ${boardErr.message}`)
    boardId = board!.id
  })

  afterAll(async () => {
    const service = serviceClient()
    await service.from('boards').delete().like('name', `${boardName}%`)
    await service.from('players').delete().like('display_name', `${rosterName}%`)
  })

  it('club members, parents included, can read saved boards (current design: club-wide reads)', async () => {
    const { data, error } = await parent.from('boards').select('id, name').eq('id', boardId)
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
  })

  // KNOWN FAILING SAFEGUARDING TEST (finding 3). The intended contract is
  // that the parent role never receives roster-derived player names, yet a
  // board row hands its token labels to any club reader. it.fails inverts
  // the reporting: this passes today BECAUSE the leak exists. After the
  // remediation lands, remove .fails so the assertion runs straight.
  it.fails(
    'KNOWN FAILURE before remediation: parent must not receive roster-derived token labels from a board row',
    async () => {
      const { data, error } = await parent.from('boards').select('tokens').eq('id', boardId).single()
      expect(error).toBeNull()
      const labels = ((data?.tokens ?? []) as { label?: string }[]).map((t) => t.label ?? '')
      expect(labels).not.toContain(rosterName)
    },
  )

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
