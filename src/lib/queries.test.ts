import { describe, expect, it, vi } from 'vitest'
import {
  alreadyImportedFrom,
  applySessionUpsert,
  createAttemptTracker,
  deletedExactlyOne,
  faImportBody,
  invalidatePlayerReads,
  isUniqueViolation,
  MEDIA_MAX_BYTES,
  oversizeMessage,
  partitionDrillsByUsage,
  revertSessionUpsert,
  sessionExistsInCache,
  toActivity,
  toActivityRow,
  toDrill,
  toProgramme,
  toProgrammeList,
  toSession,
  upsertSessionWrite,
  type DrillRow,
  type ProgrammeRow,
  type SessionRow,
} from './queries'

// A complete session row, the shape Supabase returns. Each test overrides only
// the fields it asserts on.
function sessionRow(overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    id: 's1',
    club_id: 'c1',
    coach_id: 'coach1',
    team_id: null,
    name: 'Monday training',
    focus: 'Passing',
    date: '2026-06-10',
    start_time: '17:30',
    venue: 'Ainley Top',
    age_group: 'U10',
    status: 'upcoming',
    activities: null,
    created_at: '2026-01-01T00:00:00Z',
    intentions: [],
    space: '',
    source_url: null,
    source_label: null,
    programme_id: null,
    programme_week: null,
    live_activity_index: null,
    live_activity_started_at: null,
    spond_event_id: null,
    board_id: null,
    ...overrides,
  }
}

function drillRow(overrides: Partial<DrillRow> = {}): DrillRow {
  return {
    id: 'd1',
    club_id: 'c1',
    title: 'Rondo',
    summary: null,
    corner: 'technical',
    skill: null,
    level: null,
    ages: null,
    duration: null,
    players: null,
    area: null,
    equipment: null,
    points: null,
    tags: null,
    media_id: null,
    created_by: null,
    created_at: '2026-01-01T00:00:00Z',
    setup_notes: null,
    easier: null,
    harder: null,
    theme: null,
    format: null,
    source_url: null,
    source_label: null,
    ...overrides,
  }
}

describe('session row to app mapping', () => {
  it('maps start_time, age_group and venue to the app contract', () => {
    const s = toSession(sessionRow())
    expect(s.time).toBe('17:30')
    expect(s.ageGroup).toBe('U10')
    expect(s.venue).toBe('Ainley Top')
  })

  it('coerces a null start_time and age_group to empty strings', () => {
    const s = toSession(sessionRow({ start_time: null, age_group: null }))
    expect(s.time).toBe('')
    expect(s.ageGroup).toBe('')
  })

  it('maps an activity drill_id to drillId', () => {
    const s = toSession(sessionRow({ activities: [{ phase: 'Skill', duration: 12, drill_id: 'd1' }] }))
    expect(s.activities).toEqual([{ phase: 'Skill', duration: 12, drillId: 'd1' }])
  })

  it('passes an unknown drillId through without throwing', () => {
    const row = sessionRow({ activities: [{ phase: 'Skill', duration: 10, drill_id: 'ghost-drill' }] })
    expect(() => toSession(row)).not.toThrow()
    expect(toSession(row).activities[0]).toEqual({ phase: 'Skill', duration: 10, drillId: 'ghost-drill' })
  })
})

describe('activity mapping round-trips', () => {
  it('app to row to app preserves a drill activity', () => {
    const activity = { phase: 'Game' as const, duration: 20, drillId: 'd7' }
    expect(toActivity(toActivityRow(activity))).toEqual(activity)
  })

  it('row to app to row preserves drill_id', () => {
    const row = { phase: 'Warm-Up' as const, duration: 8, drill_id: 'd2' }
    expect(toActivityRow(toActivity(row))).toEqual(row)
  })

  it('maps a custom activity title with no drill', () => {
    const activity = { phase: 'Cool-Down' as const, duration: 5, title: 'Stretch' }
    expect(toActivityRow(activity)).toEqual({ phase: 'Cool-Down', duration: 5, title: 'Stretch' })
    expect(toActivity(toActivityRow(activity))).toEqual(activity)
  })
})

describe('fa-import duplicate handling', () => {
  it('recognises the 409 already_imported conflict and carries the existing template', () => {
    expect(
      alreadyImportedFrom(409, {
        error: 'already_imported',
        template_id: 'template-1',
        template_name: 'Goalkeeping session: the basics',
      }),
    ).toEqual({ alreadyImported: true, templateId: 'template-1', templateName: 'Goalkeeping session: the basics' })
  })

  it('keeps every other error on the plain error path', () => {
    expect(alreadyImportedFrom(409, { error: 'Something else went wrong.' })).toBeNull()
    expect(alreadyImportedFrom(422, { error: 'already_imported' })).toBeNull()
    expect(alreadyImportedFrom(409, null)).toBeNull()
    expect(alreadyImportedFrom(409, {})).toBeNull()
  })

  it('tolerates a conflict body that names no template', () => {
    expect(alreadyImportedFrom(409, { error: 'already_imported' })).toEqual({
      alreadyImported: true,
      templateId: null,
      templateName: '',
    })
  })

  it('never carries a reimport flag', () => {
    const url = 'https://learn.englandfootball.com/sessions/a-page'
    expect(faImportBody(url)).toEqual({ url })
    expect('reimport' in faImportBody(url)).toBe(false)
  })
})

describe('imported drill delete decision (issue #91)', () => {
  it('removes an unused imported drill and keeps one a session still uses', () => {
    const candidates = ['drill-unused', 'drill-in-use']
    const used = new Set(['drill-in-use'])
    expect(partitionDrillsByUsage(candidates, used)).toEqual({
      toDelete: ['drill-unused'],
      toKeep: ['drill-in-use'],
    })
  })

  it('keeps every candidate when all are in use', () => {
    const candidates = ['a', 'b']
    expect(partitionDrillsByUsage(candidates, new Set(['a', 'b']))).toEqual({ toDelete: [], toKeep: ['a', 'b'] })
  })

  it('removes every candidate when none is in use', () => {
    expect(partitionDrillsByUsage(['a', 'b'], new Set())).toEqual({ toDelete: ['a', 'b'], toKeep: [] })
  })

  it('returns empty partitions for no candidates', () => {
    expect(partitionDrillsByUsage([], new Set(['a']))).toEqual({ toDelete: [], toKeep: [] })
  })
})

describe('drill row to app mapping', () => {
  it('maps media_id to mediaId', () => {
    expect(toDrill(drillRow({ media_id: 'm3' })).mediaId).toBe('m3')
  })

  it('keeps a null media_id as null', () => {
    expect(toDrill(drillRow({ media_id: null })).mediaId).toBeNull()
  })

  it('keeps a null corner null instead of defaulting a classification', () => {
    // An FA import has no corner; presenting one as Technical misled coaches.
    expect(toDrill(drillRow({ corner: null })).corner).toBeNull()
    expect(toDrill(drillRow({ corner: 'physical' })).corner).toBe('physical')
  })

  it('maps tags through and defaults a null column to an empty list', () => {
    expect(toDrill(drillRow({ tags: ['Defending', 'Marking'] })).tags).toEqual(['Defending', 'Marking'])
    expect(toDrill(drillRow({ tags: null })).tags).toEqual([])
  })
})

// A file just at the size of N bytes; only file.size is read by the guard.
function sized(size: number): File {
  return { size } as unknown as File
}

describe('media upload size cap', () => {
  it('the cap is 500 MB, the Pro plan ceiling', () => {
    expect(MEDIA_MAX_BYTES).toBe(500 * 1024 * 1024)
    expect(MEDIA_MAX_BYTES).toBe(524288000)
  })

  it('accepts a file exactly at the 500 MB limit', () => {
    expect(oversizeMessage(sized(MEDIA_MAX_BYTES))).toBeNull()
    expect(oversizeMessage(sized(MEDIA_MAX_BYTES - 1))).toBeNull()
  })

  it('rejects a file over the limit and names the 500 MB cap', () => {
    const msg = oversizeMessage(sized(MEDIA_MAX_BYTES + 1))
    expect(msg).not.toBeNull()
    expect(msg).toContain('500 MB')
  })

  it('still accepts a file at the old 300 MB level, which is now well under', () => {
    expect(oversizeMessage(sized(300 * 1024 * 1024))).toBeNull()
    expect(oversizeMessage(sized(273 * 1024 * 1024))).toBeNull()
  })
})

describe('programme list ordering (useProgrammes transformation)', () => {
  // The exact rows-to-list transformation the useProgrammes queryFn applies.
  // The id order deliberately conflicts with the date order, so a sort that
  // fell back to id (a created_at that never got mapped) would fail here.
  function programmeRow(overrides: Partial<ProgrammeRow> = {}): ProgrammeRow {
    return {
      id: 'p1',
      club_id: 'c1',
      name: 'Ball mastery',
      focus: null,
      summary: null,
      intentions: null,
      weeks: 6,
      pdf_media_id: null,
      source_url: null,
      source_label: null,
      created_by: null,
      created_at: '2026-01-01T00:00:00Z',
      ...overrides,
    }
  }

  it('maps created_at onto the programme', () => {
    expect(toProgramme(programmeRow()).createdAt).toBe('2026-01-01T00:00:00Z')
  })

  it('returns newest first by created_at even when the id order disagrees', () => {
    const rows = [
      programmeRow({ id: 'p-aaa', name: 'Oldest, first id', created_at: '2025-09-01T00:00:00Z' }),
      programmeRow({ id: 'p-zzz', name: 'Newest, last id', created_at: '2026-06-01T00:00:00Z' }),
      programmeRow({ id: 'p-mmm', name: 'Middle', created_at: '2026-02-01T00:00:00Z' }),
    ]
    expect(toProgrammeList(rows).map((p) => p.id)).toEqual(['p-zzz', 'p-mmm', 'p-aaa'])
    // The same rows arriving in any other order give the same list.
    expect(toProgrammeList([rows[1], rows[2], rows[0]]).map((p) => p.id)).toEqual(['p-zzz', 'p-mmm', 'p-aaa'])
  })
})

// The optimistic session upsert, exercised through its pure pieces: the list
// apply and revert, and the per-id attempt tracker that stops an older failed
// attempt rolling the cache back over a newer one. The useUpsertSession
// callbacks are thin wiring over exactly these calls.
describe('optimistic session upsert cache behaviour', () => {
  const s = (id: string, name: string) => {
    const base = toSession(sessionRow({ id, name }))
    return base
  }

  it('inserts a new session and updates an existing one in the list', () => {
    const a = s('a', 'First')
    expect(applySessionUpsert(undefined, a)).toEqual([a])
    const list = applySessionUpsert([a], s('b', 'Second'))
    expect(list.map((x) => x.id)).toEqual(['a', 'b'])
    const edited = applySessionUpsert(list, s('a', 'First edited'))
    expect(edited.map((x) => x.name)).toEqual(['First edited', 'Second'])
    // Position is preserved on update, so the list does not jump around.
    expect(edited[0].id).toBe('a')
  })

  it('reverts an insert by removing the entry and an update by restoring it', () => {
    const a = s('a', 'Original')
    const list = applySessionUpsert([a], s('b', 'Inserted'))
    // Insert rollback: no previous entry, so the row goes away.
    expect(revertSessionUpsert(list, undefined, 'b')).toEqual([a])
    // Update rollback: the previous entry comes back in place.
    const edited = applySessionUpsert([a], s('a', 'Edited'))
    expect(revertSessionUpsert(edited, a, 'a')).toEqual([a])
  })

  it('rolls back only the failed entry, leaving other sessions untouched', () => {
    const a = s('a', 'Mine')
    const b = s('b', 'Someone else, newer optimistic write')
    const list = applySessionUpsert(applySessionUpsert([a], b), s('c', 'Failed insert'))
    expect(revertSessionUpsert(list, undefined, 'c')).toEqual([a, b])
  })

  it('an older failed attempt cannot replace a newer attempt state', () => {
    const tracker = createAttemptTracker()
    const first = tracker.begin('s1')
    const second = tracker.begin('s1')
    // The scenario: attempt one fails after attempt two has already run. The
    // onError guard asks isLatest and must decline the rollback.
    expect(tracker.isLatest('s1', first)).toBe(false)
    expect(tracker.isLatest('s1', second)).toBe(true)
    // The older attempt settling does not disturb the newer one's claim.
    tracker.end('s1', first)
    expect(tracker.isLatest('s1', second)).toBe(true)
    tracker.end('s1', second)
    expect(tracker.isLatest('s1', second)).toBe(false)
  })

  it('tracks attempts per session id, not globally', () => {
    const tracker = createAttemptTracker()
    const a = tracker.begin('a')
    const b = tracker.begin('b')
    expect(tracker.isLatest('a', a)).toBe(true)
    expect(tracker.isLatest('b', b)).toBe(true)
  })
})

describe('isUniqueViolation', () => {
  it('recognises the Postgres unique_violation code and nothing else', () => {
    expect(isUniqueViolation({ code: '23505', message: 'duplicate key value violates unique constraint' })).toBe(true)
    expect(isUniqueViolation({ code: '23503' })).toBe(false)
    expect(isUniqueViolation({ message: 'network error' })).toBe(false)
    expect(isUniqueViolation(new Error('boom'))).toBe(false)
    expect(isUniqueViolation(null)).toBe(false)
    expect(isUniqueViolation('23505')).toBe(false)
  })
})

describe('upsertSessionWrite server-safe insert versus update', () => {
  const row = () => toSession(sessionRow())

  it('updates directly when the row is known to exist, never inserting', async () => {
    const insert = vi.fn()
    const update = vi.fn(async () => row())
    const out = await upsertSessionWrite({ exists: true, insert, update, isUniqueViolation })
    expect(update).toHaveBeenCalledTimes(1)
    expect(insert).not.toHaveBeenCalled()
    expect(out.id).toBe('s1')
  })

  it('inserts a genuinely new row and returns it, without touching update', async () => {
    const insert = vi.fn(async () => row())
    const update = vi.fn()
    const out = await upsertSessionWrite({ exists: false, insert, update, isUniqueViolation })
    expect(insert).toHaveBeenCalledTimes(1)
    expect(update).not.toHaveBeenCalled()
    expect(out.id).toBe('s1')
  })

  it('recovers a lost-response insert into an update on retry, resolving to the existing row', async () => {
    // The scenario the requirement names: the first insert committed
    // server-side but the client saw a failure, so the cache holds no row and
    // the retry still chooses insert. That insert now collides on the primary
    // key (23505); recovery updates the same id and resolves rather than
    // duplicating or sticking on the duplicate key.
    const insert = vi.fn(async () => {
      throw { code: '23505', message: 'duplicate key value violates unique constraint "sessions_pkey"' }
    })
    const update = vi.fn(async () => row())
    const out = await upsertSessionWrite({ exists: false, insert, update, isUniqueViolation })
    expect(insert).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenCalledTimes(1)
    expect(out.id).toBe('s1')
  })

  it('does not recover a non-unique-violation insert error, so a real failure surfaces', async () => {
    const boom = { code: '08006', message: 'connection failure' }
    const insert = vi.fn(async () => {
      throw boom
    })
    const update = vi.fn()
    await expect(upsertSessionWrite({ exists: false, insert, update, isUniqueViolation })).rejects.toBe(boom)
    expect(update).not.toHaveBeenCalled()
  })

  it('fails closed when the recovery update is not authorised', async () => {
    // A duplicate key whose recovery update touches no row (RLS blocked, the
    // row is another coach's) surfaces the update error rather than resolving.
    const insert = vi.fn(async () => {
      throw { code: '23505' }
    })
    const rlsError = new Error('no rows updated')
    const update = vi.fn(async () => {
      throw rlsError
    })
    await expect(upsertSessionWrite({ exists: false, insert, update, isUniqueViolation })).rejects.toBe(rlsError)
    expect(update).toHaveBeenCalledTimes(1)
  })
})

describe('sessionExistsInCache exists hint', () => {
  const s = () => toSession(sessionRow())
  it('is true when the list holds the row, so an existing-session save updates', () => {
    expect(sessionExistsInCache(s(), undefined)).toBe(true)
  })
  it('is true when only the per-id cache holds the row (the planner edit before the list loads)', () => {
    // useSession keys ['sessions', id], so an edit finds the row here even with
    // the list unloaded; this is the case that previously misfired as an insert.
    expect(sessionExistsInCache(undefined, s())).toBe(true)
  })
  it('is false only when both caches are absent, where the write self-corrects via recovery', () => {
    expect(sessionExistsInCache(undefined, undefined)).toBe(false)
  })
})

// The permanent-delete row-count guard (item 4): a destructive delete must
// affect exactly one row, so zero rows (RLS-filtered or already gone) is a
// surfaced failure, not a silent no-op.
describe('deletedExactlyOne', () => {
  it('is true only when exactly one row came back', () => {
    expect(deletedExactlyOne(null)).toBe(false)
    expect(deletedExactlyOne([])).toBe(false)
    expect(deletedExactlyOne([{ id: 'a' }])).toBe(true)
    expect(deletedExactlyOne([{ id: 'a' }, { id: 'b' }])).toBe(false)
  })
})

// Every player write (add, edit shirt or name, move, withdraw, delete, import)
// settles through invalidatePlayerReads. The Registered players table reads
// ['registrations', seasonId], so a prefix invalidation of ['registrations'] is
// what makes the table refresh immediately after a shirt edit rather than
// keeping a stale dash.
describe('invalidatePlayerReads', () => {
  it('invalidates the register, the current-season roster and the boards', () => {
    const invalidateQueries = vi.fn()
    invalidatePlayerReads({ invalidateQueries } as unknown as Parameters<typeof invalidatePlayerReads>[0])
    const keys = invalidateQueries.mock.calls.map((c) => (c[0] as { queryKey: unknown }).queryKey)
    expect(keys).toContainEqual(['registrations'])
    expect(keys).toContainEqual(['players'])
    expect(keys).toContainEqual(['boards'])
    expect(invalidateQueries).toHaveBeenCalledTimes(3)
  })
})
