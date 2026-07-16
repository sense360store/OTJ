import { describe, expect, it } from 'vitest'
import {
  alreadyImportedFrom,
  faImportBody,
  MEDIA_MAX_BYTES,
  oversizeMessage,
  partitionDrillsByUsage,
  toActivity,
  toActivityRow,
  toDrill,
  toProgramme,
  toProgrammeList,
  toSession,
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
