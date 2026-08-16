import { describe, expect, it } from 'vitest'
import {
  buildPublicShareUrl,
  PRINT_WARNING,
  type PublicDrillSnapshot,
  type PublicSessionSnapshot,
  PUBLIC_SNAPSHOT_VERSION,
  readSecretFromHash,
  validatePublicDrillSnapshot,
  validatePublicProgrammeSnapshot,
  validatePublicSessionSnapshot,
} from './publicShare'

function snapshot(over: Partial<PublicDrillSnapshot> = {}): PublicDrillSnapshot {
  return {
    snapshotVersion: PUBLIC_SNAPSHOT_VERSION,
    kind: 'drill',
    title: 'Rondo under pressure',
    summary: 'A possession square.',
    classification: { type: 'corner', value: 'technical' },
    skill: 'Passing',
    ages: ['U9'],
    level: 'Developing',
    duration: 15,
    playerGuidance: '6 to 8 players',
    area: '12 by 12 metres',
    equipment: ['cones'],
    setupNotes: 'Four on the square.',
    coachingPoints: ['Open the body.'],
    easier: [],
    harder: [],
    theme: null,
    format: null,
    sourceAttribution: null,
    media: [],
    snapshotAt: '2026-07-21T10:00:00.000Z',
    ...over,
  }
}

describe('public share URL model', () => {
  it('builds /share/:shareId#secret with the secret in the fragment', () => {
    const url = buildPublicShareUrl('11111111-1111-1111-1111-111111111111', 'SECRET123', 'https://otj.example')
    expect(url).toBe('https://otj.example/share/11111111-1111-1111-1111-111111111111#SECRET123')
    // The secret is after the fragment marker, so it is never in the path or query.
    const [beforeHash] = url.split('#')
    expect(beforeHash.includes('SECRET123')).toBe(false)
  })

  it('reads the secret from a URL hash, stripping the leading #', () => {
    expect(readSecretFromHash('#abc123')).toBe('abc123')
    expect(readSecretFromHash('abc123')).toBe('abc123')
    expect(readSecretFromHash('')).toBe('')
    expect(readSecretFromHash(null)).toBe('')
  })
})

describe('validatePublicDrillSnapshot', () => {
  it('accepts a clean public drill snapshot', () => {
    expect(validatePublicDrillSnapshot(snapshot())).toBe(true)
  })

  it('accepts a snapshot with allow-listed media fields only', () => {
    expect(validatePublicDrillSnapshot(snapshot({
      media: [{ ref: 'm1', type: 'image', caption: 'Setup', sourceAttribution: null, link: null, url: 'https://x.supabase.co/y' }],
    }))).toBe(true)
  })

  it('rejects the PR 1 placeholder', () => {
    expect(validatePublicDrillSnapshot({ snapshotVersion: 1, kind: 'drill', builder: 'pending', public: false })).toBe(false)
  })

  it('rejects an unknown version or a non-drill kind', () => {
    expect(validatePublicDrillSnapshot(snapshot({ snapshotVersion: 99 }))).toBe(false)
    expect(validatePublicDrillSnapshot({ ...snapshot(), kind: 'session' })).toBe(false)
  })

  it('rejects a forbidden key anywhere in the payload', () => {
    expect(validatePublicDrillSnapshot({ ...snapshot(), club_id: 'leak' })).toBe(false)
    expect(validatePublicDrillSnapshot(snapshot({
      media: [{ ref: 'm1', type: 'image', caption: null, sourceAttribution: null, link: null, storage_path: 'club/leak' } as never],
    }))).toBe(false)
    expect(validatePublicDrillSnapshot(snapshot({
      media: [{ ref: 'm1', type: 'image', caption: null, sourceAttribution: null, link: null, _mid: 'x' } as never],
    }))).toBe(false)
  })

  it('rejects a drill diagram, at the top level or nested', () => {
    // DRILL-02 put the Drill Maker diagram on Planner, Session Day and Live,
    // which are authenticated screens. It publishes nothing, and this is the
    // half of that statement a test can hold: a diagram key is refused by
    // VALIDATION rather than merely absent from the builders.
    //
    // WHICH mechanism refuses it is worth stating, because a mutation showed
    // it is not the one the FORBIDDEN list's own comment implies. TOP_KEYS
    // and MEDIA_KEYS are strict allow lists, so an unknown key is rejected
    // whatever it is called; deleting 'diagram' from FORBIDDEN leaves these
    // two assertions passing. That is the boundary being stronger than one
    // list, not weaker, and it is why this test is written against the
    // validator rather than against the list. The FORBIDDEN entry is the
    // second line and is kept aligned with the server's; the text of it is
    // pinned in activityDiagram.invariant.test.ts.
    expect(validatePublicDrillSnapshot({ ...snapshot(), diagram: { version: 1, elements: [] } })).toBe(false)
    expect(validatePublicDrillSnapshot(snapshot({
      media: [{ ref: 'm1', type: 'image', caption: null, sourceAttribution: null, link: null, diagram: {} } as never],
    }))).toBe(false)
  })

  it('rejects a non-object and a null', () => {
    expect(validatePublicDrillSnapshot(null)).toBe(false)
    expect(validatePublicDrillSnapshot('drill')).toBe(false)
    expect(validatePublicDrillSnapshot([snapshot()])).toBe(false)
  })
})

// -------------------------------------------------------------------------
// Session snapshot validation (Content Sharing PR 3)
// -------------------------------------------------------------------------

function sessionSnapshot(over: Partial<PublicSessionSnapshot> = {}): PublicSessionSnapshot {
  return {
    snapshotVersion: PUBLIC_SNAPSHOT_VERSION,
    kind: 'session',
    displayTitle: 'Tuesday session',
    focus: 'Playing out from the back',
    ageGroup: 'U10s',
    totalDuration: 45,
    intentions: ['Keep the ball under pressure'],
    space: 'Half pitch',
    activities: [
      { phase: 'Warm-Up', duration: 15, drillRef: 'd1', customTitle: null },
      { phase: 'Skill', duration: 10, drillRef: null, customTitle: 'Free play' },
    ],
    referencedDrills: [
      {
        ref: 'd1',
        title: 'Passing rondo',
        summary: null,
        classification: { type: 'corner', value: 'technical' },
        skill: null,
        ages: ['U10'],
        level: null,
        duration: 15,
        playerGuidance: null,
        area: null,
        equipment: [],
        setupNotes: null,
        coachingPoints: [],
        easier: [],
        harder: [],
        theme: null,
        format: null,
        sourceAttribution: null,
        mediaRefs: ['m1'],
      },
    ],
    board: {
      formation: '2-3-1',
      tokens: [
        { number: 1, side: 'home', x: 0.5, y: 0.95 },
        { number: 9, side: 'away', x: 0.7, y: 0.4 },
      ],
    },
    media: [{ ref: 'm1', type: 'image', caption: 'Diagram', sourceAttribution: null, link: null, url: 'https://x.supabase.co/y' }],
    sourceAttribution: null,
    snapshotAt: '2026-07-21T10:00:00.000Z',
    ...over,
  }
}

describe('validatePublicSessionSnapshot', () => {
  it('accepts a clean public session snapshot', () => {
    expect(validatePublicSessionSnapshot(sessionSnapshot())).toBe(true)
  })

  it('rejects an unknown version or a non-session kind', () => {
    expect(validatePublicSessionSnapshot(sessionSnapshot({ snapshotVersion: 99 }))).toBe(false)
    expect(validatePublicSessionSnapshot({ ...sessionSnapshot(), kind: 'drill' })).toBe(false)
  })

  it('a session snapshot does not validate as a drill snapshot, and vice versa', () => {
    expect(validatePublicDrillSnapshot(sessionSnapshot())).toBe(false)
    expect(validatePublicSessionSnapshot(snapshot())).toBe(false)
  })

  it('rejects an unknown top-level, activity, referenced drill or board key', () => {
    expect(validatePublicSessionSnapshot({ ...sessionSnapshot(), venue: 'Ground' } as never)).toBe(false)
    expect(validatePublicSessionSnapshot(sessionSnapshot({
      activities: [{ phase: 'Warm-Up', duration: 10, drillRef: null, customTitle: null, extra: 1 } as never],
    }))).toBe(false)
    expect(validatePublicSessionSnapshot(sessionSnapshot({
      board: { formation: '2-3-1', tokens: [], extra: 1 } as never,
    }))).toBe(false)
  })

  it('rejects a board token with a 5th key (playerId), a bad side or a non-finite coordinate', () => {
    expect(validatePublicSessionSnapshot(sessionSnapshot({
      board: { formation: '2-3-1', tokens: [{ number: 1, side: 'home', x: 0.5, y: 0.9, playerId: 'leak' } as never] },
    }))).toBe(false)
    expect(validatePublicSessionSnapshot(sessionSnapshot({
      board: { formation: '2-3-1', tokens: [{ number: 1, side: 'sideways', x: 0.5, y: 0.9 } as never] },
    }))).toBe(false)
    expect(validatePublicSessionSnapshot(sessionSnapshot({
      board: { formation: '2-3-1', tokens: [{ number: 1, side: 'home', x: Number.NaN, y: 0.9 } as never] },
    }))).toBe(false)
  })

  it('rejects a forbidden key anywhere: top level, nested drill media ref path, board token', () => {
    expect(validatePublicSessionSnapshot({ ...sessionSnapshot(), club_id: 'leak' } as never)).toBe(false)
    expect(validatePublicSessionSnapshot(sessionSnapshot({
      media: [{ ref: 'm1', type: 'image', caption: null, sourceAttribution: null, link: null, storage_path: 'club/leak' } as never],
    }))).toBe(false)
  })

  it('rejects an activity drill reference that resolves to no referenced drill', () => {
    expect(validatePublicSessionSnapshot(sessionSnapshot({
      activities: [{ phase: 'Game', duration: 20, drillRef: 'ghost', customTitle: null }],
    }))).toBe(false)
  })

  it('accepts a board of null and an empty activity list', () => {
    expect(validatePublicSessionSnapshot(sessionSnapshot({ board: null, activities: [], referencedDrills: [] }))).toBe(true)
  })

  it('rejects a non-object, a null and an array', () => {
    expect(validatePublicSessionSnapshot(null)).toBe(false)
    expect(validatePublicSessionSnapshot('session')).toBe(false)
    expect(validatePublicSessionSnapshot([sessionSnapshot()])).toBe(false)
  })
})

// -------------------------------------------------------------------------
// Programme snapshot validation (Content Sharing PR 4)
// -------------------------------------------------------------------------

function programmeSnapshot(over: Record<string, unknown> = {}): unknown {
  return {
    snapshotVersion: PUBLIC_SNAPSHOT_VERSION,
    kind: 'programme',
    displayTitle: 'Playing out from the back',
    focus: null,
    summary: null,
    intentions: [],
    weeks: 1,
    orderedWeekNumbers: [1],
    weekTemplates: [{
      week: 1,
      title: 'Week one',
      focus: null,
      activities: [{ phase: 'Skill', duration: 10, drillRef: 'd1', customTitle: null }],
      totalDuration: 10,
    }],
    referencedDrills: [{
      ref: 'd1', title: 'Rondo', summary: null, classification: null, skill: null, ages: [],
      level: null, duration: 10, playerGuidance: null, area: null, equipment: [], setupNotes: null,
      coachingPoints: [], easier: [], harder: [], theme: null, format: null,
      sourceAttribution: null, mediaRefs: ['m1'],
    }],
    pdf: null,
    media: [{ ref: 'm1', type: 'image', caption: null, sourceAttribution: null, link: null }],
    sourceAttribution: null,
    snapshotAt: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

describe('validatePublicProgrammeSnapshot', () => {
  it('accepts a clean projection', () => {
    expect(validatePublicProgrammeSnapshot(programmeSnapshot())).toBe(true)
  })

  it('rejects a wrong kind and an unknown snapshot version', () => {
    expect(validatePublicProgrammeSnapshot(programmeSnapshot({ kind: 'session' }))).toBe(false)
    expect(validatePublicProgrammeSnapshot(programmeSnapshot({ snapshotVersion: 2 }))).toBe(false)
  })

  it('rejects the stored markers and the private media fields', () => {
    expect(validatePublicProgrammeSnapshot(programmeSnapshot({ builder: 'programme@1' }))).toBe(false)
    expect(validatePublicProgrammeSnapshot(programmeSnapshot({ public: true }))).toBe(false)
    expect(validatePublicProgrammeSnapshot(programmeSnapshot({
      media: [{ ref: 'm1', type: 'image', caption: null, sourceAttribution: null, link: null, _path: 'club/x.png' }],
    }))).toBe(false)
  })

  it('rejects a leaked template author anywhere in the payload', () => {
    expect(validatePublicProgrammeSnapshot(programmeSnapshot({ author: 'Jane Coach' }))).toBe(false)
    const withWeekAuthor = programmeSnapshot() as Record<string, unknown>
    ;(withWeekAuthor.weekTemplates as Array<Record<string, unknown>>)[0].author = 'Jane Coach'
    expect(validatePublicProgrammeSnapshot(withWeekAuthor)).toBe(false)
  })

  it('rejects a programmeWeek or programme_week key in place of week', () => {
    const s = programmeSnapshot() as Record<string, unknown>
    ;(s.weekTemplates as Array<Record<string, unknown>>)[0].programmeWeek = 1
    expect(validatePublicProgrammeSnapshot(s)).toBe(false)
  })

  it('rejects a non integer week number', () => {
    const s = programmeSnapshot() as Record<string, unknown>
    ;(s.weekTemplates as Array<Record<string, unknown>>)[0].week = 1.5
    expect(validatePublicProgrammeSnapshot(s)).toBe(false)
  })

  it('rejects an activity drill reference that resolves to no referenced drill', () => {
    const s = programmeSnapshot() as Record<string, unknown>
    ;(s.weekTemplates as Array<Record<string, unknown>>)[0].activities = [
      { phase: 'Skill', duration: 10, drillRef: 'ghost', customTitle: null },
    ]
    expect(validatePublicProgrammeSnapshot(s)).toBe(false)
  })

  it('rejects a drill media ref that is not in the flat pool', () => {
    expect(validatePublicProgrammeSnapshot(programmeSnapshot({ media: [] }))).toBe(false)
  })

  it('rejects a pdf pointer that does not resolve into the flat pool', () => {
    expect(validatePublicProgrammeSnapshot(programmeSnapshot({ pdf: { ref: 'm99' } }))).toBe(false)
  })

  it('accepts a pdf pointer that resolves into the pool', () => {
    expect(validatePublicProgrammeSnapshot(programmeSnapshot({ pdf: { ref: 'm1' } }))).toBe(true)
  })

  it('rejects a pdf object carrying anything beyond a ref', () => {
    expect(validatePublicProgrammeSnapshot(programmeSnapshot({ pdf: { ref: 'm1', _path: 'club/x.pdf' } }))).toBe(false)
  })

  it('accepts an empty week with no activities', () => {
    expect(validatePublicProgrammeSnapshot(programmeSnapshot({
      weekTemplates: [{ week: 1, title: null, focus: null, activities: [], totalDuration: 0 }],
      referencedDrills: [],
      media: [],
    }))).toBe(true)
  })

  it('rejects a non-object, a null and an array', () => {
    expect(validatePublicProgrammeSnapshot(null)).toBe(false)
    expect(validatePublicProgrammeSnapshot('programme')).toBe(false)
    expect(validatePublicProgrammeSnapshot([programmeSnapshot()])).toBe(false)
  })

  it('refuses a programme payload from the drill and session guards', () => {
    expect(validatePublicDrillSnapshot(programmeSnapshot())).toBe(false)
    expect(validatePublicSessionSnapshot(programmeSnapshot())).toBe(false)
  })
})

// The blocked reason copy now lives in src/lib/shareBlockers.test.ts, where it
// is tested with the reason ORDER and the provenance summary that decide it.

describe('PRINT_WARNING', () => {
  it('states plainly that a printed or downloaded copy cannot be recalled', () => {
    expect(PRINT_WARNING).toBe('A downloaded or printed copy cannot be turned off or recalled.')
  })
})
