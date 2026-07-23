// Deno tests for the shared content sharing module (Content Sharing PR 2).
// Run:
//   deno test --allow-read supabase/functions/_shared/share_test.ts

import { assert, assertEquals, assertThrows } from 'jsr:@std/assert@1'
import {
  assertAllowlistedKeys,
  assertNoForbiddenKeys,
  base64urlEncode,
  type BoardRow,
  buildDrillSnapshot,
  buildSessionSnapshot,
  DRILL_BUILDER,
  type DrillRow,
  evaluateDrillEligibility,
  evaluateSessionEligibility,
  generateSecret,
  type MediaRow,
  sanitizeHttpUrl,
  sanitizeText,
  secretHashLiteral,
  SESSION_BUILDER,
  sha256Hex,
  SNAPSHOT_VERSION,
  type SessionRow,
  type StoredDrillSnapshot,
  type StoredSessionSnapshot,
  toPublicProjection,
  toPublicSessionProjection,
  validatePublicDrillSnapshot,
  validatePublicSessionSnapshot,
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

// =========================================================================
// Session snapshot builder (Content Sharing PR 3)
// =========================================================================

const CLUB = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const DRILL_A = 'd1111111-1111-1111-1111-111111111111'
const DRILL_B = 'd2222222-2222-2222-2222-222222222222'
const MEDIA_A = 'e1111111-1111-1111-1111-111111111111'
const BOARD_ID = 'b1111111-1111-1111-1111-111111111111'
const SESSION_ID = 'c1111111-1111-1111-1111-111111111111'

function drillA(over: Partial<DrillRow> = {}): DrillRow {
  return drill({ id: DRILL_A, club_id: CLUB, title: 'Passing rondo', ...over })
}
function drillB(over: Partial<DrillRow> = {}): DrillRow {
  return drill({ id: DRILL_B, club_id: CLUB, title: 'Finishing waves', corner: 'physical', ...over })
}
function mediaA(over: Partial<MediaRow> = {}): MediaRow {
  return media({ id: MEDIA_A, club_id: CLUB, name: 'Rondo diagram', ...over })
}

function session(over: Partial<SessionRow> = {}): SessionRow {
  return {
    id: SESSION_ID,
    club_id: CLUB,
    name: 'Tuesday session',
    focus: 'Playing out from the back',
    age_group: 'U10s',
    intentions: ['Keep the ball under pressure'],
    space: 'Half pitch',
    activities: [
      { phase: 'Warm-Up', drill_id: DRILL_A, duration: 15 },
      { phase: 'Skill', title: 'Free play', duration: 10 },
      { phase: 'Game', drill_id: DRILL_B, duration: 20 },
    ],
    board_id: null,
    source_url: null,
    source_label: null,
    rights: 'public_full',
    ...over,
  }
}

function board(over: Partial<BoardRow> = {}): BoardRow {
  return {
    id: BOARD_ID,
    formation: '2-3-1',
    // Tokens carry id and playerId in the row; both must be stripped.
    tokens: [
      { id: 't1', number: 1, side: 'home', x: 0.5, y: 0.95, playerId: 'p-secret-1' },
      { id: 't2', number: 7, side: 'home', x: 0.3, y: 0.6, playerId: 'p-secret-2' },
      { id: 't3', number: 9, side: 'away', x: 0.7, y: 0.4, playerId: null },
    ],
    created_by: 'coach-1',
    ...over,
  }
}

// -------------------------------------------------------------------------
// Session eligibility (fail closed aggregate block rule)
// -------------------------------------------------------------------------

Deno.test('an eligible public_full session with two drills is eligible', () => {
  const e = evaluateSessionEligibility(session(), [drillA(), drillB()], [], null)
  assert(e.eligible)
  assertEquals(e.blocked, [])
})

Deno.test('an internal_only session is blocked', () => {
  const e = evaluateSessionEligibility(session({ rights: 'internal_only' }), [drillA(), drillB()], [], null)
  assert(!e.eligible)
  assert(e.blocked.includes('source_internal_only'))
})

Deno.test('a session with an internal_only drill dependency is blocked', () => {
  const e = evaluateSessionEligibility(session(), [drillA({ rights: 'internal_only' }), drillB()], [], null)
  assert(!e.eligible)
  assert(e.blocked.includes('drill_internal_only'))
})

Deno.test('a session with an internal_only media dependency is blocked', () => {
  const e = evaluateSessionEligibility(
    session(),
    [drillA({ media_id: MEDIA_A }), drillB()],
    [{ id: MEDIA_A, rights: 'internal_only' }],
    null,
  )
  assert(!e.eligible)
  assert(e.blocked.includes('media_internal_only'))
})

Deno.test('a session referencing a drill not in the club (missing/cross club) is blocked', () => {
  // drillB omitted from the provided rows: a cross club id club scopes to absent.
  const e = evaluateSessionEligibility(session(), [drillA()], [], null)
  assert(!e.eligible)
  assert(e.blocked.includes('drill_missing'))
})

Deno.test('a session whose drill media is missing is blocked', () => {
  const e = evaluateSessionEligibility(session(), [drillA({ media_id: MEDIA_A }), drillB()], [], null)
  assert(!e.eligible)
  assert(e.blocked.includes('media_missing'))
})

Deno.test('a session with an attached board that is missing/cross club is blocked', () => {
  const e = evaluateSessionEligibility(session({ board_id: BOARD_ID }), [drillA(), drillB()], [], null)
  assert(!e.eligible)
  assert(e.blocked.includes('board_missing'))
})

Deno.test('a session with an unsupported activity item is blocked', () => {
  const bad = session({ activities: [{ phase: 'Warm-Up', drill_id: 'not-a-uuid', duration: 10 }] })
  const e = evaluateSessionEligibility(bad, [drillA(), drillB()], [], null)
  assert(!e.eligible)
  assert(e.blocked.includes('unsupported_item'))
})

Deno.test('a session with a non-object activity entry is blocked', () => {
  const bad = session({ activities: ['just a string', 42] as unknown as SessionRow['activities'] })
  const e = evaluateSessionEligibility(bad, [drillA(), drillB()], [], null)
  assert(!e.eligible)
  assert(e.blocked.includes('unsupported_item'))
})

// -------------------------------------------------------------------------
// Session builder: shape, ordering, dedup, exclusions
// -------------------------------------------------------------------------

Deno.test('builds an eligible session snapshot with the pinned version, kind and builder', () => {
  const s = buildSessionSnapshot(session(), [drillA(), drillB()], [], null, AT)
  assertEquals(s.snapshotVersion, SNAPSHOT_VERSION)
  assertEquals(s.kind, 'session')
  assertEquals(s.public, true)
  assertEquals(s.builder, SESSION_BUILDER)
  assertEquals(s.displayTitle, 'Tuesday session')
  assertEquals(s.ageGroup, 'U10s')
  assertEquals(s.focus, 'Playing out from the back')
  assertEquals(s.intentions, ['Keep the ball under pressure'])
  assertEquals(s.space, 'Half pitch')
  assertEquals(s.snapshotAt, AT)
})

Deno.test('activities keep their order and reference drills by snapshot-local ref', () => {
  const s = buildSessionSnapshot(session(), [drillA(), drillB()], [], null, AT)
  assertEquals(s.activities.length, 3)
  assertEquals(s.activities[0].phase, 'Warm-Up')
  assertEquals(s.activities[0].drillRef, 'd1')
  assertEquals(s.activities[0].customTitle, null)
  // The custom activity carries a title and no drill ref.
  assertEquals(s.activities[1].drillRef, null)
  assertEquals(s.activities[1].customTitle, 'Free play')
  assertEquals(s.activities[2].drillRef, 'd2')
  // referencedDrills holds the full safe drill projection, keyed by ref.
  assertEquals(s.referencedDrills.length, 2)
  assertEquals(s.referencedDrills[0].ref, 'd1')
  assertEquals(s.referencedDrills[0].title, 'Passing rondo')
  assertEquals(s.referencedDrills[1].ref, 'd2')
})

Deno.test('total duration sums the activity durations', () => {
  const s = buildSessionSnapshot(session(), [drillA(), drillB()], [], null, AT)
  assertEquals(s.totalDuration, 45)
})

Deno.test('a repeated drill dedupes to one referenced drill and both activities share the ref', () => {
  const repeat = session({
    activities: [
      { phase: 'Warm-Up', drill_id: DRILL_A, duration: 10 },
      { phase: 'Skill', drill_id: DRILL_A, duration: 10 },
    ],
  })
  const s = buildSessionSnapshot(repeat, [drillA()], [], null, AT)
  assertEquals(s.referencedDrills.length, 1)
  assertEquals(s.activities[0].drillRef, 'd1')
  assertEquals(s.activities[1].drillRef, 'd1')
})

Deno.test('a session with only custom activities builds with no referenced drills', () => {
  const custom = session({
    activities: [
      { phase: 'Warm-Up', title: 'Arrival game', duration: 10 },
      { phase: 'Game', title: 'Small sided', duration: 20 },
    ],
  })
  const s = buildSessionSnapshot(custom, [], [], null, AT)
  assertEquals(s.referencedDrills, [])
  assertEquals(s.media, [])
  assertEquals(s.activities[0].customTitle, 'Arrival game')
})

Deno.test('drill media is pooled once at the top level and referenced by ref', () => {
  const withMedia = session({
    activities: [
      { phase: 'Warm-Up', drill_id: DRILL_A, duration: 10 },
      { phase: 'Skill', drill_id: DRILL_B, duration: 10 },
    ],
  })
  const s = buildSessionSnapshot(
    withMedia,
    [drillA({ media_id: MEDIA_A }), drillB({ media_id: MEDIA_A })],
    [mediaA()],
    null,
    AT,
  )
  // One shared media item is pooled once; both drills point at the same ref.
  assertEquals(s.media.length, 1)
  assertEquals(s.media[0].ref, 'm1')
  assertEquals(s.referencedDrills[0].mediaRefs, ['m1'])
  assertEquals(s.referencedDrills[1].mediaRefs, ['m1'])
  // The pooled entry carries the private path for read-time signing.
  assertEquals(s.media[0]._path, mediaA().storage_path)
})

Deno.test('the session snapshot excludes every operational field', () => {
  const stored = buildSessionSnapshot(
    session({ board_id: BOARD_ID }),
    [drillA({ media_id: MEDIA_A }), drillB()],
    [mediaA()],
    board(),
    AT,
  )
  // Structural allow list on the stored snapshot (which legitimately carries the
  // private _mid/_path for signing).
  assertAllowlistedKeys(stored)
  // The PUBLIC projection is what reaches the browser: no private media fields,
  // no operational field name, and no real uuid at all.
  const pub = toPublicSessionProjection(stored)
  assertNoForbiddenKeys(pub)
  const flat = JSON.stringify(pub)
  for (
    const forbidden of [
      'club_id', 'coach_id', 'coachId', 'team_id', 'teamId', 'venue',
      'start_time', 'spond_event_id', 'live_activity', 'created_by', 'created_at',
      'session_id', 'board_id', 'media_id', 'programme_id', 'playerId', 'player_id',
      'storage_path', '_path', '_mid',
    ]
  ) {
    assert(!flat.includes(forbidden), `public session projection leaked ${forbidden}`)
  }
  // The real session, drill, media, board and club uuids never reach the public
  // projection (the stored _path still embeds the club/object path by design).
  for (const id of [SESSION_ID, DRILL_A, DRILL_B, MEDIA_A, BOARD_ID, CLUB]) {
    assert(!flat.includes(id), `public session projection leaked a real uuid ${id}`)
  }
})

// -------------------------------------------------------------------------
// Board projection: shape and numbers only
// -------------------------------------------------------------------------

Deno.test('the board projection keeps numbers and positions only, stripping id, playerId and name', () => {
  const s = buildSessionSnapshot(session({ board_id: BOARD_ID }), [drillA(), drillB()], [], board(), AT)
  assert(s.board !== null)
  assertEquals(s.board?.formation, '2-3-1')
  assertEquals(s.board?.tokens.length, 3)
  assertEquals(s.board?.tokens[0], { number: 1, side: 'home', x: 0.5, y: 0.95 })
  const flat = JSON.stringify(s.board)
  assert(!flat.includes('p-secret-1'), 'board leaked a playerId')
  assert(!flat.includes('"id"'), 'board leaked a token id')
  assert(!flat.includes('t1'), 'board leaked a token id value')
})

Deno.test('an out of range or malformed board token coordinate is clamped safely', () => {
  const b = board({
    tokens: [
      { id: 't1', number: 5, side: 'home', x: 2, y: -1, playerId: null },
      { id: 't2', number: 6, side: 'nonsense', x: 'oops', y: 0.5, playerId: null },
    ] as unknown as BoardRow['tokens'],
  })
  const s = buildSessionSnapshot(session({ board_id: BOARD_ID }), [drillA(), drillB()], [], b, AT)
  assertEquals(s.board?.tokens[0], { number: 5, side: 'home', x: 1, y: 0 })
  // A non-home/away side becomes null; a non-number x becomes the safe centre.
  assertEquals(s.board?.tokens[1], { number: 6, side: null, x: 0.5, y: 0.5 })
})

// -------------------------------------------------------------------------
// Session builder defensive guards
// -------------------------------------------------------------------------

Deno.test('the session builder refuses an internal_only session defensively', () => {
  assertThrows(() => buildSessionSnapshot(session({ rights: 'internal_only' }), [drillA(), drillB()], [], null, AT))
})

Deno.test('the session builder refuses an internal_only nested drill defensively', () => {
  assertThrows(() => buildSessionSnapshot(session(), [drillA({ rights: 'internal_only' }), drillB()], [], null, AT))
})

Deno.test('the session builder refuses internal_only nested media defensively', () => {
  assertThrows(() =>
    buildSessionSnapshot(
      session(),
      [drillA({ media_id: MEDIA_A }), drillB()],
      [mediaA({ rights: 'internal_only' })],
      null,
      AT,
    )
  )
})

Deno.test('the session builder refuses a missing nested drill defensively', () => {
  assertThrows(() => buildSessionSnapshot(session(), [drillA()], [], null, AT))
})

Deno.test('the session builder refuses a missing attached board defensively', () => {
  assertThrows(() => buildSessionSnapshot(session({ board_id: BOARD_ID }), [drillA(), drillB()], [], null, AT))
})

Deno.test('the session builder refuses an unsupported activity item defensively', () => {
  const bad = session({ activities: [{ phase: 'Warm-Up', drill_id: 'not-a-uuid', duration: 10 }] })
  assertThrows(() => buildSessionSnapshot(bad, [drillA(), drillB()], [], null, AT))
})

// -------------------------------------------------------------------------
// Session allow-list scanner, projection and public validation
// -------------------------------------------------------------------------

Deno.test('the scanner rejects a forbidden key injected into a board token', () => {
  const s = buildSessionSnapshot(session({ board_id: BOARD_ID }), [drillA(), drillB()], [], board(), AT)
  ;(s.board!.tokens[0] as unknown as Record<string, unknown>).playerId = 'leak'
  assertThrows(() => assertAllowlistedKeys(s))
})

Deno.test('the scanner rejects a forbidden key injected at the session top level', () => {
  const s = buildSessionSnapshot(session(), [drillA(), drillB()], [], null, AT) as unknown as Record<string, unknown>
  s.team_id = 'leak'
  assertThrows(() => assertAllowlistedKeys(s))
})

Deno.test('toPublicSessionProjection strips the private media fields and internal markers', () => {
  const stored = buildSessionSnapshot(
    session(),
    [drillA({ media_id: MEDIA_A }), drillB()],
    [mediaA()],
    null,
    AT,
  )
  const pub = toPublicSessionProjection(stored)
  assert(!('builder' in pub), 'public projection leaked builder marker')
  assert(!('public' in pub), 'public projection leaked public marker')
  assertEquals(pub.media.length, 1)
  assert(!('_path' in pub.media[0]), 'public media leaked _path')
  assert(!('_mid' in pub.media[0]), 'public media leaked _mid')
  assertNoForbiddenKeys(pub)
})

Deno.test('validatePublicSessionSnapshot accepts a clean projection', () => {
  const pub = toPublicSessionProjection(
    buildSessionSnapshot(session({ board_id: BOARD_ID }), [drillA({ media_id: MEDIA_A }), drillB()], [mediaA()], board(), AT),
  )
  assert(validatePublicSessionSnapshot(pub))
  // A drill projection must not validate as a session projection and vice versa.
  assert(!validatePublicDrillSnapshot(pub))
})

Deno.test('validatePublicSessionSnapshot rejects a placeholder, private fields and wrong kind', () => {
  assert(!validatePublicSessionSnapshot({ snapshotVersion: 1, kind: 'session', builder: 'pending', public: false }))
  const stored = buildSessionSnapshot(session(), [drillA(), drillB()], [], null, AT)
  // The stored snapshot still carries builder/public, so it must NOT validate.
  assert(!validatePublicSessionSnapshot(stored))
  const pub = toPublicSessionProjection(stored)
  assert(!validatePublicSessionSnapshot({ ...pub, kind: 'drill' }))
  assert(!validatePublicSessionSnapshot({ ...pub, snapshotVersion: 99 }))
})

Deno.test('validatePublicSessionSnapshot rejects a board token carrying a leaked playerId', () => {
  const pub = toPublicSessionProjection(
    buildSessionSnapshot(session({ board_id: BOARD_ID }), [drillA(), drillB()], [], board(), AT),
  )
  const tampered = {
    ...pub,
    board: { formation: '2-3-1', tokens: [{ number: 1, side: 'home', x: 0.5, y: 0.9, playerId: 'leak' }] },
  }
  assert(!validatePublicSessionSnapshot(tampered))
})

Deno.test('the session builder is deterministic for a fixed snapshotAt', () => {
  const a = buildSessionSnapshot(session({ board_id: BOARD_ID }), [drillA({ media_id: MEDIA_A }), drillB()], [mediaA()], board(), AT)
  const b = buildSessionSnapshot(session({ board_id: BOARD_ID }), [drillA({ media_id: MEDIA_A }), drillB()], [mediaA()], board(), AT)
  assertEquals(JSON.stringify(a), JSON.stringify(b))
})
