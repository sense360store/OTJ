import { describe, expect, it } from 'vitest'
import {
  blockedReasonCopy,
  buildPublicShareUrl,
  BLOCKED_FA_NOTE,
  type PublicDrillSnapshot,
  PUBLIC_SNAPSHOT_VERSION,
  readSecretFromHash,
  validatePublicDrillSnapshot,
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
