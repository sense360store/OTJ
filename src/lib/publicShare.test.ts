import { describe, expect, it } from 'vitest'
import {
  blockedReasonCopy,
  blockedSessionReasonCopy,
  buildPublicShareUrl,
  BLOCKED_FA_NOTE,
  type PublicDrillSnapshot,
  type PublicSessionSnapshot,
  PUBLIC_SNAPSHOT_VERSION,
  readSecretFromHash,
  validatePublicDrillSnapshot,
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

  it('rejects a non-object and a null', () => {
    expect(validatePublicDrillSnapshot(null)).toBe(false)
    expect(validatePublicDrillSnapshot('drill')).toBe(false)
    expect(validatePublicDrillSnapshot([snapshot()])).toBe(false)
  })
})

describe('blockedReasonCopy', () => {
  it('maps a restricted dependency to the England Football note', () => {
    expect(blockedReasonCopy(['media_internal_only'])).toBe(BLOCKED_FA_NOTE)
    expect(blockedReasonCopy(['source_internal_only'])).toBe(BLOCKED_FA_NOTE)
  })
  it('explains a missing media dependency', () => {
    expect(blockedReasonCopy(['media_missing'])).toContain('missing')
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

describe('blockedSessionReasonCopy', () => {
  it('maps a restricted session, drill or media dependency to the England Football note', () => {
    expect(blockedSessionReasonCopy(['source_internal_only'])).toBe(BLOCKED_FA_NOTE)
    expect(blockedSessionReasonCopy(['drill_internal_only'])).toBe(BLOCKED_FA_NOTE)
    expect(blockedSessionReasonCopy(['media_internal_only'])).toBe(BLOCKED_FA_NOTE)
  })
  it('explains a missing dependency and an unsupported item without leaking a code', () => {
    expect(blockedSessionReasonCopy(['drill_missing'])).toContain('missing')
    expect(blockedSessionReasonCopy(['board_missing'])).toContain('missing')
    expect(blockedSessionReasonCopy(['unsupported_item'])).toContain('activity')
  })
})
