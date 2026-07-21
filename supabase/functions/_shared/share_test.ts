// Deno tests for the shared content sharing module (Content Sharing PR 2).
// Run:
//   deno test --allow-read supabase/functions/_shared/share_test.ts

import { assert, assertEquals, assertThrows } from 'jsr:@std/assert@1'
import {
  assertAllowlistedKeys,
  assertNoForbiddenKeys,
  base64urlEncode,
  buildDrillSnapshot,
  DRILL_BUILDER,
  type DrillRow,
  evaluateDrillEligibility,
  generateSecret,
  type MediaRow,
  sanitizeHttpUrl,
  sanitizeText,
  secretHashLiteral,
  sha256Hex,
  SNAPSHOT_VERSION,
  type StoredDrillSnapshot,
  toPublicProjection,
  validatePublicDrillSnapshot,
} from './share.ts'

const AT = '2026-07-21T10:00:00.000Z'

function drill(over: Partial<DrillRow> = {}): DrillRow {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    club_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    title: 'Rondo under pressure',
    summary: 'A possession square that rewards quick, calm passing when pressed.',
    corner: 'technical',
    skill: 'Passing under pressure',
    level: 'Developing',
    ages: ['U9', 'U10'],
    duration: 15,
    players: '6 to 8 players',
    area: '12 by 12 metres',
    equipment: ['cones', 'one ball', 'bibs in two colours'],
    points: ['Open the body before receiving.', 'First touch out of pressure.'],
    tags: ['possession'],
    setup_notes: 'Four players on the square, two defenders inside.',
    easier: ['Add a third defender out.'],
    harder: ['Two touch maximum.'],
    theme: 'Playing out under pressure',
    format: 'Small sided',
    source_url: null,
    source_label: null,
    media_id: null,
    rights: 'public_full',
    ...over,
  }
}

function media(over: Partial<MediaRow> = {}): MediaRow {
  return {
    id: '22222222-2222-2222-2222-222222222222',
    club_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    name: 'Square setup',
    type: 'image',
    storage_path: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/33333333-file.png',
    yt_url: null,
    embed_url: null,
    source_url: null,
    source_label: null,
    rights: 'public_full',
    ...over,
  }
}

// -------------------------------------------------------------------------
// Eligibility
// -------------------------------------------------------------------------

Deno.test('an eligible public_full drill with no media is eligible', () => {
  const e = evaluateDrillEligibility(drill(), null)
  assert(e.eligible)
  assertEquals(e.blocked, [])
})

Deno.test('an internal_only drill is blocked', () => {
  const e = evaluateDrillEligibility(drill({ rights: 'internal_only' }), null)
  assert(!e.eligible)
  assert(e.blocked.includes('source_internal_only'))
})

Deno.test('a drill with internal_only media is blocked (aggregate block rule)', () => {
  const d = drill({ media_id: media().id })
  const e = evaluateDrillEligibility(d, media({ rights: 'internal_only' }))
  assert(!e.eligible)
  assert(e.blocked.includes('media_internal_only'))
})

Deno.test('a drill whose referenced media is missing is blocked', () => {
  const d = drill({ media_id: media().id })
  const e = evaluateDrillEligibility(d, null)
  assert(!e.eligible)
  assert(e.blocked.includes('media_missing'))
})

// -------------------------------------------------------------------------
// Builder: allow-listed fields only, no internal identifiers
// -------------------------------------------------------------------------

Deno.test('builds an eligible drill snapshot with the pinned version and kind', () => {
  const s = buildDrillSnapshot(drill(), null, AT)
  assertEquals(s.snapshotVersion, SNAPSHOT_VERSION)
  assertEquals(s.kind, 'drill')
  assertEquals(s.public, true)
  assertEquals(s.builder, DRILL_BUILDER)
  assertEquals(s.title, 'Rondo under pressure')
  assertEquals(s.classification, { type: 'corner', value: 'technical' })
  assertEquals(s.media, [])
  assertEquals(s.snapshotAt, AT)
})

Deno.test('classification falls back to public tags when corner is null', () => {
  const s = buildDrillSnapshot(drill({ corner: null, tags: ['dribbling', '1v1'] }), null, AT)
  assertEquals(s.classification, { type: 'tags', value: ['dribbling', '1v1'] })
})

Deno.test('classification is null when neither corner nor tags are set', () => {
  const s = buildDrillSnapshot(drill({ corner: null, tags: [] }), null, AT)
  assertEquals(s.classification, null)
})

Deno.test('the snapshot contains only allow-listed keys and no internal ids', () => {
  const s = buildDrillSnapshot(drill({ media_id: media().id }), media(), AT)
  // The scanner throws if any unexpected key is present.
  assertAllowlistedKeys(s)
  const flat = JSON.stringify(s)
  for (
    const forbidden of [
      'club_id', 'created_by', 'created_at', 'media_id', 'source_key',
      'source_programme_id', 'coach_id', 'drill_id', '"id"',
    ]
  ) {
    assert(!flat.includes(forbidden), `snapshot leaked ${forbidden}`)
  }
  // The real drill and media uuids never appear (only the snapshot-local ref).
  assert(!flat.includes('11111111-1111-1111-1111-111111111111'), 'leaked drill id')
})

Deno.test('a club original drill has null source attribution', () => {
  const s = buildDrillSnapshot(drill(), null, AT)
  assertEquals(s.sourceAttribution, null)
})

Deno.test('the builder refuses an internal_only drill defensively', () => {
  assertThrows(() => buildDrillSnapshot(drill({ rights: 'internal_only' }), null, AT))
})

Deno.test('the builder refuses internal_only media defensively', () => {
  assertThrows(() =>
    buildDrillSnapshot(drill({ media_id: media().id }), media({ rights: 'internal_only' }), AT)
  )
})

Deno.test('the builder refuses a missing required media dependency', () => {
  assertThrows(() => buildDrillSnapshot(drill({ media_id: media().id }), null, AT))
})

// -------------------------------------------------------------------------
// Media rights matrix and private path handling
// -------------------------------------------------------------------------

Deno.test('a public_full stored image carries the private path, never in the public projection', () => {
  const s = buildDrillSnapshot(drill({ media_id: media().id }), media(), AT)
  assertEquals(s.media.length, 1)
  assertEquals(s.media[0].ref, 'm1')
  assertEquals(s.media[0].type, 'image')
  assertEquals(s.media[0]._path, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/33333333-file.png')
  assertEquals(s.media[0]._mid, media().id)
  const pub = toPublicProjection(s)
  assertEquals(pub.media.length, 1)
  assert(!('_path' in pub.media[0]), 'public media leaked _path')
  assert(!('_mid' in pub.media[0]), 'public media leaked _mid')
  assert(!('builder' in pub), 'public projection leaked builder marker')
  assert(!('public' in pub), 'public projection leaked public marker')
  const flat = JSON.stringify(pub)
  assert(!flat.includes('33333333-file.png'), 'public projection leaked storage path')
})

Deno.test('a public_full youtube media is an external link only, no stored path', () => {
  const m = media({ type: 'youtube', storage_path: null, yt_url: 'https://www.youtube.com/watch?v=abc123' })
  const s = buildDrillSnapshot(drill({ media_id: m.id }), m, AT)
  assertEquals(s.media[0].type, 'youtube')
  assertEquals(s.media[0]._path, null)
  assertEquals(s.media[0].link, 'https://www.youtube.com/watch?v=abc123')
})

Deno.test('a public_link_only stored object exposes neither binary nor link', () => {
  const m = media({ rights: 'public_link_only' })
  const s = buildDrillSnapshot(drill({ media_id: m.id }), m, AT)
  assertEquals(s.media[0]._path, null)
  assertEquals(s.media[0].link, null)
})

Deno.test('a non-youtube link in yt_url is rejected as an external link', () => {
  const m = media({ type: 'youtube', storage_path: null, yt_url: 'https://evil.example.com/x' })
  const s = buildDrillSnapshot(drill({ media_id: m.id }), m, AT)
  assertEquals(s.media[0].link, null)
})

// -------------------------------------------------------------------------
// Sanitisation
// -------------------------------------------------------------------------

Deno.test('sanitizeText strips tags and script content', () => {
  assertEquals(sanitizeText('<b>Bold</b> point'), 'Bold point')
  assertEquals(sanitizeText('<script>alert(1)</script>Keep'), 'Keep')
  assertEquals(sanitizeText('<img src=x onerror=alert(1)>caption'), 'caption')
})

Deno.test('sanitizeText neutralises dangerous URI schemes in free text', () => {
  const out = sanitizeText('click javascript:alert(1) now') ?? ''
  assert(!out.toLowerCase().includes('javascript:'), 'javascript: survived')
})

Deno.test('unsafe HTML in a drill field is stripped in the built snapshot', () => {
  const s = buildDrillSnapshot(
    drill({ summary: 'Great <script>steal()</script> drill', title: '<b>Rondo</b>' }),
    null,
    AT,
  )
  assertEquals(s.title, 'Rondo')
  assert(!JSON.stringify(s).toLowerCase().includes('<script'), 'script survived into snapshot')
})

Deno.test('sanitizeHttpUrl accepts http(s) and rejects other schemes', () => {
  assertEquals(sanitizeHttpUrl('https://learn.englandfootball.com/x'), 'https://learn.englandfootball.com/x')
  assertEquals(sanitizeHttpUrl('javascript:alert(1)'), null)
  assertEquals(sanitizeHttpUrl('data:text/html,x'), null)
  assertEquals(sanitizeHttpUrl('not a url'), null)
  assertEquals(sanitizeHttpUrl(null), null)
})

Deno.test('sanitizeHttpUrl enforces an allow list of hosts when given', () => {
  assertEquals(sanitizeHttpUrl('https://youtu.be/abc', ['youtube.com', 'youtu.be']), 'https://youtu.be/abc')
  assertEquals(sanitizeHttpUrl('https://evil.com/abc', ['youtube.com', 'youtu.be']), null)
})

// -------------------------------------------------------------------------
// Allow-list scanner and public projection validation
// -------------------------------------------------------------------------

Deno.test('the scanner rejects an injected forbidden key at the top level', () => {
  const s = buildDrillSnapshot(drill(), null, AT) as unknown as Record<string, unknown>
  s.club_id = 'leak'
  assertThrows(() => assertAllowlistedKeys(s))
})

Deno.test('the scanner rejects an injected forbidden key inside a media entry', () => {
  const s = buildDrillSnapshot(drill({ media_id: media().id }), media(), AT) as unknown as StoredDrillSnapshot
  ;(s.media[0] as unknown as Record<string, unknown>).storage_path = 'club/leak'
  assertThrows(() => assertAllowlistedKeys(s))
})

Deno.test('assertNoForbiddenKeys catches a nested forbidden key at any depth', () => {
  const pub = toPublicProjection(buildDrillSnapshot(drill(), null, AT))
  assertNoForbiddenKeys(pub) // clean
  const tampered = { ...pub, media: [{ ref: 'm1', type: 'image', caption: null, sourceAttribution: null, link: null, mediaId: 'leak' }] }
  assertThrows(() => assertNoForbiddenKeys(tampered))
})

Deno.test('validatePublicDrillSnapshot accepts a clean projection', () => {
  const pub = toPublicProjection(buildDrillSnapshot(drill({ media_id: media().id }), media(), AT))
  assert(validatePublicDrillSnapshot(pub))
})

Deno.test('validatePublicDrillSnapshot rejects a placeholder and private fields', () => {
  assert(!validatePublicDrillSnapshot({ snapshotVersion: 1, kind: 'drill', builder: 'pending', public: false }))
  const stored = buildDrillSnapshot(drill({ media_id: media().id }), media(), AT)
  // The stored snapshot still carries builder/public and _mid/_path, so it must
  // NOT validate as a public projection.
  assert(!validatePublicDrillSnapshot(stored))
})

Deno.test('validatePublicDrillSnapshot rejects an unknown version or wrong kind', () => {
  const pub = toPublicProjection(buildDrillSnapshot(drill(), null, AT))
  assert(!validatePublicDrillSnapshot({ ...pub, snapshotVersion: 99 }))
  assert(!validatePublicDrillSnapshot({ ...pub, kind: 'session' }))
})

// -------------------------------------------------------------------------
// Determinism
// -------------------------------------------------------------------------

Deno.test('the builder is deterministic for a fixed snapshotAt', () => {
  const a = buildDrillSnapshot(drill({ media_id: media().id }), media(), AT)
  const b = buildDrillSnapshot(drill({ media_id: media().id }), media(), AT)
  assertEquals(JSON.stringify(a), JSON.stringify(b))
})

// -------------------------------------------------------------------------
// Secret and hash
// -------------------------------------------------------------------------

Deno.test('generateSecret produces a 32-byte base64url string with high entropy', () => {
  const a = generateSecret()
  const b = generateSecret()
  assert(a !== b, 'two secrets collided')
  // base64url of 32 bytes with no padding is 43 chars.
  assertEquals(a.length, 43)
  assert(/^[A-Za-z0-9_-]+$/.test(a), 'not url-safe base64')
})

Deno.test('base64urlEncode is url-safe and unpadded', () => {
  const enc = base64urlEncode(new Uint8Array([255, 255, 255]))
  assert(!enc.includes('+') && !enc.includes('/') && !enc.includes('='))
})

Deno.test('sha256Hex matches a known SHA-256 vector', async () => {
  // SHA-256("abc")
  assertEquals(
    await sha256Hex('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  )
})

Deno.test('secretHashLiteral is a 32-byte bytea literal and never the raw secret', async () => {
  const secret = generateSecret()
  const lit = await secretHashLiteral(secret)
  assert(lit.startsWith('\\x'))
  assertEquals(lit.length, 2 + 64) // \x + 64 hex chars = 32 bytes
  assert(!lit.includes(secret), 'the raw secret leaked into the hash literal')
})

Deno.test('the same secret hashes stably; a different secret hashes differently', async () => {
  const s = generateSecret()
  assertEquals(await sha256Hex(s), await sha256Hex(s))
  assert((await sha256Hex(s)) !== (await sha256Hex(generateSecret())))
})
