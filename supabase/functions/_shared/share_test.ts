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
  buildProgrammeSnapshot,
  buildSessionSnapshot,
  DRILL_BUILDER,
  type DrillRow,
  evaluateDrillEligibility,
  invalidMediaPaths,
  anyRestricted,
  isFaSourceUrl,
  rowProvenance,
  buildShareListFilter,
  deriveShareStatus,
  SHARE_LIST_DEFAULT_LIMIT,
  SHARE_LIST_MAX_LIMIT,
  toPublicProjectionByKind,
  validatePublicSnapshotByKind,
  evaluateProgrammeEligibility,
  evaluateSessionEligibility,
  generateSecret,
  MAX_PROGRAMME_MEDIA,
  MAX_PROGRAMME_WEEKS,
  type MediaRow,
  type ProgrammeBlockReason,
  ProgrammeBuildError,
  PROGRAMME_BUILDER,
  type ProgrammeRow,
  sanitizeHttpUrl,
  sanitizeText,
  secretHashLiteral,
  SESSION_BUILDER,
  sha256Hex,
  SNAPSHOT_VERSION,
  type SessionRow,
  type StoredDrillSnapshot,
  type StoredSessionSnapshot,
  type TemplateRow,
  toPublicProgrammeProjection,
  toPublicProjection,
  toPublicSessionProjection,
  validatePublicDrillSnapshot,
  validatePublicProgrammeSnapshot,
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

Deno.test('a non-string drill_id is an unsupported item, never a silent custom activity', () => {
  // Regression: a non-string drill_id must not be classified as a custom
  // activity (which would report eligible while the RPC ::uuid cast crashed).
  const bad = session({ activities: [{ phase: 'Warm-Up', drill_id: 123, duration: 10 }] as unknown as SessionRow['activities'] })
  const e = evaluateSessionEligibility(bad, [drillA(), drillB()], [], null)
  assert(!e.eligible)
  assert(e.blocked.includes('unsupported_item'))
  assertThrows(() => buildSessionSnapshot(bad, [drillA(), drillB()], [], null, AT))
})

Deno.test('a whitespace-padded drill_id is unsupported (kept in lockstep with the RPC uuid cast)', () => {
  // A padded but otherwise valid uuid would crash the RPC's ::uuid cast, so it
  // must be blocked as unsupported, not resolved to a drill nor reported missing.
  const padded = session({ activities: [{ phase: 'Skill', drill_id: `  ${DRILL_A}  `, duration: 10 }] })
  const e = evaluateSessionEligibility(padded, [drillA()], [], null)
  assert(!e.eligible)
  assert(e.blocked.includes('unsupported_item'))
})

Deno.test('an empty-string drill_id is a custom activity, not a drill or an unsupported item', () => {
  const custom = session({ activities: [{ phase: 'Skill', drill_id: '', title: 'Free play', duration: 10 }] })
  const s = buildSessionSnapshot(custom, [], [], null, AT)
  assertEquals(s.referencedDrills, [])
  assertEquals(s.activities[0].drillRef, null)
  assertEquals(s.activities[0].customTitle, 'Free play')
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

// ---------------------------------------------------------------------------
// The active duration rule, in the fourth independent implementation of the
// session sum. This is a DELIBERATE DUPLICATE of src/lib/activityStructure.ts:
// Edge Functions run in their own runtime and cannot import from src/lib/, so
// the rule is written twice and the same cases are pinned at both ends. The
// browser half lives in src/lib/activityStructure.test.ts.
// ---------------------------------------------------------------------------

Deno.test('declaring the structure changes no published total', () => {
  const declared = session({
    activities: [
      { phase: 'Warm-Up', drill_id: DRILL_A, duration: 15, slot: 'station' },
      { phase: 'Skill', title: 'Free play', duration: 10, slot: 'station' },
      { phase: 'Game', drill_id: DRILL_B, duration: 20, slot: 'game' },
    ],
  })
  const s = buildSessionSnapshot(declared, [drillA(), drillB()], [], null, AT)
  assertEquals(s.totalDuration, 45)
})

Deno.test('a stood-down station contributes nothing to the published total', () => {
  const standDown = session({
    activities: [
      { phase: 'Warm-Up', drill_id: DRILL_A, duration: 15, slot: 'station' },
      { phase: 'Skill', title: 'Free play', duration: 10, slot: 'station', skipped: true },
      { phase: 'Game', drill_id: DRILL_B, duration: 20, slot: 'game' },
    ],
  })
  const s = buildSessionSnapshot(standDown, [drillA(), drillB()], [], null, AT)
  assertEquals(s.totalDuration, 35)
})

Deno.test('a stood-down games phase contributes nothing to the published total', () => {
  const noGames = session({
    activities: [
      { phase: 'Warm-Up', drill_id: DRILL_A, duration: 15, slot: 'station' },
      { phase: 'Game', drill_id: DRILL_B, duration: 20, slot: 'game', skipped: true },
    ],
  })
  const s = buildSessionSnapshot(noGames, [drillA(), drillB()], [], null, AT)
  assertEquals(s.totalDuration, 15)
})

Deno.test('a stray skipped on an activity with no slot still counts', () => {
  // Both halves of the rule are load bearing. `skipped` means "this station
  // is not running tonight"; an activity that is not a station has nothing to
  // stand down, so it keeps its minutes.
  const stray = session({
    activities: [
      { phase: 'Warm-Up', drill_id: DRILL_A, duration: 15, skipped: true },
      { phase: 'Game', drill_id: DRILL_B, duration: 20 },
    ],
  })
  const s = buildSessionSnapshot(stray, [drillA(), drillB()], [], null, AT)
  assertEquals(s.totalDuration, 35)
})

Deno.test('only literal true stands an activity down', () => {
  // activities is unconstrained jsonb, so a row can carry anything. Every one
  // of these runs, which is the direction that fails towards the drill.
  for (const skipped of [false, 0, 1, 'true', 'yes', null]) {
    const dirty = session({
      activities: [
        { phase: 'Skill', drill_id: DRILL_A, duration: 15, slot: 'station', skipped },
      ],
    } as unknown as Partial<SessionRow>)
    assertEquals(buildSessionSnapshot(dirty, [drillA()], [], null, AT).totalDuration, 15)
  }
  // And an unrecognised slot declares nothing, so `skipped` is inert on it.
  const badSlot = session({
    activities: [{ phase: 'Skill', drill_id: DRILL_A, duration: 15, slot: 'Station', skipped: true }],
  } as unknown as Partial<SessionRow>)
  assertEquals(buildSessionSnapshot(badSlot, [drillA()], [], null, AT).totalDuration, 15)
})

Deno.test('a session with every operational activity stood down publishes a zero total', () => {
  const off = session({
    activities: [
      { phase: 'Skill', drill_id: DRILL_A, duration: 15, slot: 'station', skipped: true },
      { phase: 'Game', drill_id: DRILL_B, duration: 20, slot: 'game', skipped: true },
    ],
  })
  const s = buildSessionSnapshot(off, [drillA(), drillB()], [], null, AT)
  assertEquals(s.totalDuration, 0)
})

Deno.test('a stood-down activity stays in the projected list, keeps its own duration, and never publishes slot or skipped', () => {
  // The share boundary decision, stated as a test. Dropping the activity
  // would make the public plan disagree with the plan the coach shared;
  // zeroing its own duration would publish WHICH station was stood down; and
  // publishing the key would mean widening two allow lists in two runtimes.
  // PublicActivity is exactly phase, duration, drillRef and customTitle.
  const standDown = session({
    activities: [
      { phase: 'Warm-Up', drill_id: DRILL_A, duration: 15, slot: 'station' },
      { phase: 'Skill', title: 'Free play', duration: 10, slot: 'station', skipped: true },
    ],
  })
  const s = buildSessionSnapshot(standDown, [drillA()], [], null, AT)
  assertEquals(s.activities.length, 2)
  assertEquals(s.activities[1].duration, 10)
  assertEquals(s.activities[1].customTitle, 'Free play')
  assertEquals(s.totalDuration, 15)
  for (const a of s.activities) {
    assertEquals(Object.keys(a).sort(), ['customTitle', 'drillRef', 'duration', 'phase'])
  }
  // Serialised, so nothing rides along in a key the type does not name.
  const json = JSON.stringify(s)
  assert(!json.includes('skipped'))
  assert(!json.includes('slot'))
})

Deno.test('a declared session is still eligible to share', () => {
  // The structural keys must not make a session unshareable: activityShape
  // classifies on drill_id alone and knows nothing about them.
  const declared = session({
    activities: [
      { phase: 'Warm-Up', drill_id: DRILL_A, duration: 15, slot: 'station', skipped: true },
      { phase: 'Game', drill_id: DRILL_B, duration: 20, slot: 'game' },
    ],
  })
  const e = evaluateSessionEligibility(declared, [drillA(), drillB()], [], null)
  assert(e.eligible)
  assertEquals(e.blocked, [])
})

Deno.test('the programme snapshot is untouched by the session rule', () => {
  // buildProgrammeSnapshot sums WEEK activities, and a template never carries
  // `skipped`: the client strips it at every template boundary. A dirty week
  // row therefore totals exactly what its durations say, which is the same
  // answer it gave before this change.
  const dirtyWeek = template({
    activities: [
      { phase: 'Warm-Up', drill_id: DRILL_A, duration: 15, slot: 'station', skipped: true },
      { phase: 'Game', drill_id: DRILL_B, duration: 20, slot: 'game', skipped: true },
    ],
  } as unknown as Partial<TemplateRow>)
  const snapshot = buildProgrammeSnapshot(
    programme({ weeks: 1 }),
    [dirtyWeek],
    [drill({ id: DRILL_A, club_id: CLUB }), drill({ id: DRILL_B, club_id: CLUB })],
    [],
    AT,
  )
  // 15 + 20, exactly as it totalled before this change.
  assertEquals(snapshot.weekTemplates[0].totalDuration, 35)
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

// -------------------------------------------------------------------------
// Programme snapshot (Content Sharing PR 4)
// -------------------------------------------------------------------------

const PROGRAMME_ID = 'f1111111-1111-1111-1111-111111111111'
const TEMPLATE_A = 'a1111111-1111-1111-1111-111111111111'
const TEMPLATE_B = 'a2222222-2222-2222-2222-222222222222'
const MEDIA_PDF = 'e9999999-9999-9999-9999-999999999999'

function programme(over: Partial<ProgrammeRow> = {}): ProgrammeRow {
  return {
    id: PROGRAMME_ID,
    name: 'Playing out from the back',
    focus: 'Building from goal kicks',
    summary: 'A six week block on calm build up play.',
    intentions: ['Play forward when it is on'],
    weeks: 2,
    pdf_media_id: null,
    source_url: null,
    source_label: null,
    rights: 'public_full',
    ...over,
  }
}

function template(over: Partial<TemplateRow> = {}): TemplateRow {
  return {
    id: TEMPLATE_A,
    name: 'Week one, short goal kicks',
    focus: 'Receiving on the half turn',
    activities: [
      { phase: 'Warm-Up', drill_id: DRILL_A, duration: 15 },
      { phase: 'Game', title: 'Free play', duration: 20 },
    ],
    programme_week: 1,
    created_at: '2026-01-01T00:00:00.000Z',
    rights: 'public_full',
    ...over,
  }
}

// A two week programme: week 1 uses DRILL_A (with media), week 2 uses DRILL_B.
function twoWeeks() {
  const t1 = template()
  const t2 = template({
    id: TEMPLATE_B,
    name: 'Week two, playing through midfield',
    programme_week: 2,
    activities: [{ phase: 'Skill', drill_id: DRILL_B, duration: 25 }],
  })
  const d1 = drill({ id: DRILL_A, media_id: MEDIA_A })
  const d2 = drill({ id: DRILL_B, title: 'Third man run' })
  const m1 = media({ id: MEDIA_A })
  return { p: programme(), templates: [t1, t2], drills: [d1, d2], media: [m1] }
}

// ---- Eligibility ----

Deno.test('an eligible programme with public_full weeks, drills and media is eligible', () => {
  const { p, templates, drills, media: m } = twoWeeks()
  const e = evaluateProgrammeEligibility(p, templates, drills, m)
  assert(e.eligible)
  assertEquals(e.blocked, [])
})

Deno.test('an internal_only programme is blocked', () => {
  const { templates, drills, media: m } = twoWeeks()
  const e = evaluateProgrammeEligibility(programme({ rights: 'internal_only' }), templates, drills, m)
  assert(!e.eligible)
  assert(e.blocked.includes('source_internal_only'))
})

Deno.test('an internal_only week template blocks the whole programme', () => {
  const { p, templates, drills, media: m } = twoWeeks()
  templates[1].rights = 'internal_only'
  const e = evaluateProgrammeEligibility(p, templates, drills, m)
  assert(!e.eligible)
  assert(e.blocked.includes('template_internal_only'))
})

Deno.test('an internal_only nested drill blocks the whole programme', () => {
  const { p, templates, drills, media: m } = twoWeeks()
  drills[1].rights = 'internal_only'
  const e = evaluateProgrammeEligibility(p, templates, drills, m)
  assert(!e.eligible)
  assert(e.blocked.includes('drill_internal_only'))
})

Deno.test('internal_only nested media blocks the whole programme', () => {
  const { p, templates, drills } = twoWeeks()
  const e = evaluateProgrammeEligibility(p, templates, drills, [media({ id: MEDIA_A, rights: 'internal_only' })])
  assert(!e.eligible)
  assert(e.blocked.includes('media_internal_only'))
})

Deno.test('a missing nested drill blocks the programme (a cross club id arrives as missing)', () => {
  const { p, templates, media: m } = twoWeeks()
  const e = evaluateProgrammeEligibility(p, templates, [drill({ id: DRILL_A, media_id: MEDIA_A })], m)
  assert(!e.eligible)
  assert(e.blocked.includes('drill_missing'))
})

Deno.test('a missing nested media blocks the programme', () => {
  const { p, templates, drills } = twoWeeks()
  const e = evaluateProgrammeEligibility(p, templates, drills, [])
  assert(!e.eligible)
  assert(e.blocked.includes('media_missing'))
})

Deno.test('an internal_only attached PDF blocks the whole programme, it is never omitted', () => {
  const { templates, drills, media: m } = twoWeeks()
  const p = programme({ pdf_media_id: MEDIA_PDF })
  const e = evaluateProgrammeEligibility(p, templates, drills, [
    ...m,
    media({ id: MEDIA_PDF, type: 'pdf', rights: 'internal_only' }),
  ])
  assert(!e.eligible)
  assert(e.blocked.includes('pdf_internal_only'))
})

Deno.test('a missing or cross club attached PDF blocks the whole programme', () => {
  const { templates, drills, media: m } = twoWeeks()
  const e = evaluateProgrammeEligibility(programme({ pdf_media_id: MEDIA_PDF }), templates, drills, m)
  assert(!e.eligible)
  assert(e.blocked.includes('pdf_missing'))
})

Deno.test('a malformed activity blocks the programme as an unsupported item', () => {
  const { p, drills, media: m } = twoWeeks()
  const t = template({ activities: [{ phase: 'Warm-Up', drill_id: ' not-a-uuid ', duration: 10 }] })
  const e = evaluateProgrammeEligibility(p, [t], drills, m)
  assert(!e.eligible)
  assert(e.blocked.includes('unsupported_item'))
})

Deno.test('a programme with no weeks at all is refused rather than published as an overview', () => {
  const e = evaluateProgrammeEligibility(programme({ weeks: 0 }), [], [], [])
  assert(!e.eligible)
  assert(e.blocked.includes('no_weeks'))
})

// The production regression (programme f2de855c "Mybe"): weeks = 6 declared, no
// week template at all, no source, no PDF, club only. The declared count alone
// used to satisfy the week check, so the only reported blocker was the rights
// level, and reclassifying the programme would have published a title with six
// blank weeks.
Deno.test('a programme with declared weeks but no week template has nothing to share', () => {
  const e = evaluateProgrammeEligibility(programme({ weeks: 6, rights: 'internal_only' }), [], [], [])
  assert(!e.eligible)
  assert(e.blocked.includes('no_weeks'))
})

Deno.test('reclassifying such a programme does not make it shareable', () => {
  const e = evaluateProgrammeEligibility(programme({ weeks: 6, rights: 'public_full' }), [], [], [])
  assert(!e.eligible)
  assert(e.blocked.includes('no_weeks'))
  // The rights reason is gone; the structural one is not.
  assertEquals(e.blocked.includes('source_internal_only'), false)
})

Deno.test('the builder refuses it too, so no six blank weeks can be projected', () => {
  assertThrows(
    () => buildProgrammeSnapshot(programme({ weeks: 6, rights: 'public_full' }), [], [], [], AT),
    ProgrammeBuildError,
  )
})

Deno.test('a programme whose only template claims no week still has nothing to share', () => {
  const orphan = template({ programme_week: null, activities: [] })
  const e = evaluateProgrammeEligibility(programme({ weeks: 6, rights: 'public_full' }), [orphan], [], [])
  assert(!e.eligible)
  assert(e.blocked.includes('no_weeks'))
})

Deno.test('a programme over the week cap is refused, never truncated', () => {
  const templates = Array.from({ length: MAX_PROGRAMME_WEEKS + 1 }, (_, i) =>
    template({ id: `a${i}111111-1111-1111-1111-111111111111`, programme_week: i + 1, activities: [] }))
  const e = evaluateProgrammeEligibility(programme({ weeks: MAX_PROGRAMME_WEEKS + 1 }), templates, [], [])
  assert(!e.eligible)
  assert(e.blocked.includes('too_many_weeks'))
})

// ---- Builder ----

Deno.test('builds an eligible programme snapshot with the pinned version and kind', () => {
  const { p, templates, drills, media: m } = twoWeeks()
  const s = buildProgrammeSnapshot(p, templates, drills, m, AT)
  assertEquals(s.snapshotVersion, SNAPSHOT_VERSION)
  assertEquals(s.kind, 'programme')
  assertEquals(s.public, true)
  assertEquals(s.builder, PROGRAMME_BUILDER)
  assertEquals(s.displayTitle, 'Playing out from the back')
  assertEquals(s.orderedWeekNumbers, [1, 2])
  assertEquals(s.weekTemplates.length, 2)
  assertEquals(s.weekTemplates[0].week, 1)
  assertEquals(s.weekTemplates[0].totalDuration, 35)
  assertEquals(s.snapshotAt, AT)
})

Deno.test('weeks are ordered ascending regardless of the input row order', () => {
  const { p, templates, drills, media: m } = twoWeeks()
  const s = buildProgrammeSnapshot(p, [templates[1], templates[0]], drills, m, AT)
  assertEquals(s.weekTemplates.map((w) => w.week), [1, 2])
  assertEquals(s.weekTemplates[0].title, 'Week one, short goal kicks')
})

Deno.test('the earliest created template claims a contested week, matching the club page', () => {
  const { p, drills, media: m } = twoWeeks()
  const early = template({ id: TEMPLATE_A, name: 'First', created_at: '2026-01-01T00:00:00.000Z' })
  const late = template({ id: TEMPLATE_B, name: 'Second', created_at: '2026-02-01T00:00:00.000Z' })
  const s = buildProgrammeSnapshot(programme({ weeks: 1 }), [late, early], drills, m, AT)
  assertEquals(s.weekTemplates.length, 1)
  assertEquals(s.weekTemplates[0].title, 'First')
})

Deno.test('a week no template claims renders as an empty week, as the club page does', () => {
  const { drills, media: m } = twoWeeks()
  const s = buildProgrammeSnapshot(programme({ weeks: 3 }), [template()], drills, m, AT)
  assertEquals(s.orderedWeekNumbers, [1, 2, 3])
  assertEquals(s.weekTemplates[1].activities, [])
  assertEquals(s.weekTemplates[1].title, null)
  assertEquals(s.weekTemplates[1].totalDuration, 0)
})

Deno.test('a template claiming a week beyond the declared count extends the week list', () => {
  const { drills, media: m } = twoWeeks()
  const s = buildProgrammeSnapshot(
    programme({ weeks: 1 }),
    [template({ programme_week: 4, activities: [] })],
    drills,
    m,
    AT,
  )
  assertEquals(s.orderedWeekNumbers, [1, 2, 3, 4])
})

Deno.test('a template with no week assigned is not rendered but still gates the share', () => {
  const { p, drills, media: m } = twoWeeks()
  const unassigned = template({ id: TEMPLATE_B, programme_week: null, activities: [] })
  const s = buildProgrammeSnapshot(p, [template(), unassigned], drills, m, AT)
  assertEquals(s.weekTemplates.filter((w) => w.title !== null).length, 1)
  // It is still a dependency: an internal_only unassigned template blocks.
  unassigned.rights = 'internal_only'
  const e = evaluateProgrammeEligibility(p, [template(), unassigned], drills, m)
  assert(!e.eligible)
  assert(e.blocked.includes('template_internal_only'))
})

Deno.test('a drill used in two weeks dedupes to one referenced drill sharing the ref', () => {
  const { p, drills, media: m } = twoWeeks()
  const t1 = template({ id: TEMPLATE_A, programme_week: 1 })
  const t2 = template({
    id: TEMPLATE_B,
    programme_week: 2,
    activities: [{ phase: 'Skill', drill_id: DRILL_A, duration: 10 }],
  })
  const s = buildProgrammeSnapshot(p, [t1, t2], drills, m, AT)
  assertEquals(s.referencedDrills.length, 1)
  assertEquals(s.weekTemplates[0].activities[0].drillRef, s.weekTemplates[1].activities[0].drillRef)
})

Deno.test('programme media is pooled once at the top level and referenced by ref', () => {
  const { p, templates, drills, media: m } = twoWeeks()
  const s = buildProgrammeSnapshot(p, templates, drills, m, AT)
  assertEquals(s.media.length, 1)
  assertEquals(s.media[0].ref, 'm1')
  assertEquals(s.referencedDrills[0].mediaRefs, ['m1'])
  // The private markers live only in the stored pool, never in a week.
  assertEquals(s.media[0]._mid, MEDIA_A)
  assert(typeof s.media[0]._path === 'string')
})

Deno.test('an eligible attached PDF joins the same flat pool and is addressed by ref', () => {
  const { templates, drills, media: m } = twoWeeks()
  const s = buildProgrammeSnapshot(
    programme({ pdf_media_id: MEDIA_PDF }),
    templates,
    drills,
    [...m, media({ id: MEDIA_PDF, type: 'pdf', name: 'Programme booklet' })],
    AT,
  )
  assert(s.pdf !== null)
  const pooled = s.media.find((x) => x.ref === s.pdf!.ref)
  assert(pooled !== undefined)
  assertEquals(pooled!.type, 'pdf')
  // One pool, not two: the pdf ref points into snapshot.media.
  assertEquals(s.media.filter((x) => x.type === 'pdf').length, 1)
})

Deno.test('the programme snapshot excludes the template author and every operational field', () => {
  const { p, templates, drills, media: m } = twoWeeks()
  // Simulate a row that carried extra columns; the builder must not project them.
  const dirty = { ...templates[0], author: 'Jane Coach', created_by: 'someone', club_id: CLUB }
  const s = buildProgrammeSnapshot(p, [dirty as TemplateRow, templates[1]], drills, m, AT)
  const flat = JSON.stringify(s)
  for (
    const banned of [
      'author',
      'Jane Coach',
      'created_by',
      'club_id',
      'programme_id',
      'programme_week',
      'programmeWeek',
      'team_id',
      'venue',
      'spond_event_id',
      PROGRAMME_ID,
      TEMPLATE_A,
      DRILL_A,
    ]
  ) {
    assert(!flat.includes(banned), `programme snapshot leaked ${banned}`)
  }
  assertNoForbiddenKeys(toPublicProgrammeProjection(s))
})

// ---- Defensive builder throws ----

Deno.test('the programme builder refuses an internal_only programme defensively', () => {
  const { templates, drills, media: m } = twoWeeks()
  assertThrows(() => buildProgrammeSnapshot(programme({ rights: 'internal_only' }), templates, drills, m, AT))
})

Deno.test('the programme builder refuses an internal_only week template defensively', () => {
  const { p, templates, drills, media: m } = twoWeeks()
  templates[0].rights = 'internal_only'
  assertThrows(() => buildProgrammeSnapshot(p, templates, drills, m, AT))
})

Deno.test('the programme builder refuses an internal_only nested drill defensively', () => {
  const { p, templates, drills, media: m } = twoWeeks()
  drills[0].rights = 'internal_only'
  assertThrows(() => buildProgrammeSnapshot(p, templates, drills, m, AT))
})

Deno.test('the programme builder refuses internal_only nested media defensively', () => {
  const { p, templates, drills } = twoWeeks()
  assertThrows(() =>
    buildProgrammeSnapshot(p, templates, drills, [media({ id: MEDIA_A, rights: 'internal_only' })], AT)
  )
})

Deno.test('the programme builder refuses a missing nested drill defensively', () => {
  const { p, templates, media: m } = twoWeeks()
  assertThrows(() => buildProgrammeSnapshot(p, templates, [drill({ id: DRILL_A, media_id: MEDIA_A })], m, AT))
})

Deno.test('the programme builder refuses an internal_only attached PDF defensively', () => {
  const { templates, drills, media: m } = twoWeeks()
  assertThrows(() =>
    buildProgrammeSnapshot(
      programme({ pdf_media_id: MEDIA_PDF }),
      templates,
      drills,
      [...m, media({ id: MEDIA_PDF, type: 'pdf', rights: 'internal_only' })],
      AT,
    )
  )
})

Deno.test('the programme builder refuses a missing attached PDF defensively', () => {
  const { templates, drills, media: m } = twoWeeks()
  assertThrows(() => buildProgrammeSnapshot(programme({ pdf_media_id: MEDIA_PDF }), templates, drills, m, AT))
})

Deno.test('the programme builder refuses an unsupported activity item defensively', () => {
  const { p, drills, media: m } = twoWeeks()
  const t = template({ activities: [{ phase: 'Warm-Up', drill_id: 'nope', duration: 10 }] })
  assertThrows(() => buildProgrammeSnapshot(p, [t], drills, m, AT))
})

Deno.test('the programme builder refuses a programme with no weeks defensively', () => {
  assertThrows(() => buildProgrammeSnapshot(programme({ weeks: 0 }), [], [], [], AT))
})

Deno.test('the programme builder refuses more weeks than the cap defensively', () => {
  const templates = Array.from({ length: MAX_PROGRAMME_WEEKS + 1 }, (_, i) =>
    template({ id: `a${i}111111-1111-1111-1111-111111111111`, programme_week: i + 1, activities: [] }))
  assertThrows(() => buildProgrammeSnapshot(programme({ weeks: MAX_PROGRAMME_WEEKS + 1 }), templates, [], [], AT))
})

Deno.test('the programme builder refuses more media than the cap defensively', () => {
  const count = MAX_PROGRAMME_MEDIA + 1
  const drills: DrillRow[] = []
  const mediaRows: MediaRow[] = []
  const activities: Array<Record<string, unknown>> = []
  for (let i = 0; i < count; i++) {
    const did = `d${String(i).padStart(2, '0')}11111-1111-1111-1111-111111111111`
    const mid = `e${String(i).padStart(2, '0')}11111-1111-1111-1111-111111111111`
    drills.push(drill({ id: did, media_id: mid }))
    mediaRows.push(media({ id: mid }))
    activities.push({ phase: 'Skill', drill_id: did, duration: 1 })
  }
  const t = template({ activities })
  let caught: unknown = null
  try {
    buildProgrammeSnapshot(programme({ weeks: 1 }), [t], drills, mediaRows, AT)
  } catch (err) {
    caught = err
  }
  assert(caught instanceof ProgrammeBuildError)
  assertEquals((caught as ProgrammeBuildError).reason, 'too_many_media')
})

Deno.test('the programme builder refuses a snapshot over the size cap defensively', () => {
  const huge = 'x'.repeat(3800)
  const activities = Array.from({ length: 60 }, (_, i) => ({ phase: 'Skill', drill_id: DRILL_A, duration: i }))
  const drills = [drill({ id: DRILL_A, summary: huge, setup_notes: huge, media_id: null })]
  const templates = Array.from({ length: MAX_PROGRAMME_WEEKS }, (_, i) =>
    template({
      id: `a${i}111111-1111-1111-1111-111111111111`,
      programme_week: i + 1,
      name: huge.slice(0, 300),
      focus: huge.slice(0, 300),
      activities,
    }))
  const p = programme({ weeks: MAX_PROGRAMME_WEEKS, summary: huge, intentions: Array(64).fill(huge) })
  assertThrows(() => buildProgrammeSnapshot(p, templates, drills, [], AT))
})

// ---- Scanner ----

Deno.test('the scanner rejects a forbidden key injected at the programme top level', () => {
  const { p, templates, drills, media: m } = twoWeeks()
  const s = buildProgrammeSnapshot(p, templates, drills, m, AT) as unknown as Record<string, unknown>
  s.club_id = CLUB
  assertThrows(() => assertAllowlistedKeys(s))
})

Deno.test('the scanner rejects a forbidden key injected into a programme week', () => {
  const { p, templates, drills, media: m } = twoWeeks()
  const s = buildProgrammeSnapshot(p, templates, drills, m, AT)
  ;(s.weekTemplates[0] as unknown as Record<string, unknown>).author = 'Jane Coach'
  assertThrows(() => assertAllowlistedKeys(s))
})

Deno.test('the scanner rejects a programmeWeek key injected into a week', () => {
  const { p, templates, drills, media: m } = twoWeeks()
  const s = buildProgrammeSnapshot(p, templates, drills, m, AT)
  ;(s.weekTemplates[0] as unknown as Record<string, unknown>).programmeWeek = 1
  assertThrows(() => assertAllowlistedKeys(s))
})

Deno.test('the scanner rejects a forbidden key injected into a referenced drill', () => {
  const { p, templates, drills, media: m } = twoWeeks()
  const s = buildProgrammeSnapshot(p, templates, drills, m, AT)
  ;(s.referencedDrills[0] as unknown as Record<string, unknown>).media_id = MEDIA_A
  assertThrows(() => assertAllowlistedKeys(s))
})

Deno.test('assertAllowlistedKeys throws on an unknown kind rather than treating it as a drill', () => {
  assertThrows(() => assertAllowlistedKeys({ kind: 'club', snapshotVersion: 1, media: [] }))
})

// ---- Projection and public validator ----

Deno.test('toPublicProgrammeProjection strips the private media fields and internal markers', () => {
  const { p, templates, drills, media: m } = twoWeeks()
  const stored = buildProgrammeSnapshot(p, templates, drills, m, AT)
  const pub = toPublicProgrammeProjection(stored)
  assertEquals((pub as unknown as Record<string, unknown>).builder, undefined)
  assertEquals((pub as unknown as Record<string, unknown>).public, undefined)
  for (const entry of pub.media) {
    assertEquals((entry as unknown as Record<string, unknown>)._mid, undefined)
    assertEquals((entry as unknown as Record<string, unknown>)._path, undefined)
  }
  assert(validatePublicProgrammeSnapshot(pub))
})

Deno.test('validatePublicProgrammeSnapshot rejects a stored snapshot, private fields and a wrong kind', () => {
  const { p, templates, drills, media: m } = twoWeeks()
  const stored = buildProgrammeSnapshot(p, templates, drills, m, AT)
  // A stored snapshot (builder/public present) can never pass a public guard.
  assert(!validatePublicProgrammeSnapshot(stored))
  const pub = toPublicProgrammeProjection(stored) as unknown as Record<string, unknown>
  assert(!validatePublicProgrammeSnapshot({ ...pub, kind: 'session' }))
  assert(!validatePublicProgrammeSnapshot({ ...pub, snapshotVersion: 2 }))
  assert(!validatePublicProgrammeSnapshot({ ...pub, author: 'Jane Coach' }))
})

Deno.test('validatePublicProgrammeSnapshot rejects a dangling activity drill reference', () => {
  const { p, templates, drills, media: m } = twoWeeks()
  const pub = toPublicProgrammeProjection(buildProgrammeSnapshot(p, templates, drills, m, AT))
  pub.weekTemplates[0].activities[0].drillRef = 'd99'
  assert(!validatePublicProgrammeSnapshot(pub))
})

Deno.test('validatePublicProgrammeSnapshot rejects a pdf ref that is not in the media pool', () => {
  const { p, templates, drills, media: m } = twoWeeks()
  const pub = toPublicProgrammeProjection(buildProgrammeSnapshot(p, templates, drills, m, AT))
  ;(pub as unknown as Record<string, unknown>).pdf = { ref: 'm99' }
  assert(!validatePublicProgrammeSnapshot(pub))
})

Deno.test('the public guards refuse a snapshot of the wrong kind in every direction', () => {
  const { p, templates, drills, media: m } = twoWeeks()
  const prog = toPublicProgrammeProjection(buildProgrammeSnapshot(p, templates, drills, m, AT))
  assert(!validatePublicDrillSnapshot(prog))
  assert(!validatePublicSessionSnapshot(prog))
  const drl = toPublicProjection(buildDrillSnapshot(drill(), null, AT))
  assert(!validatePublicProgrammeSnapshot(drl))
})

Deno.test('the programme builder is deterministic for a fixed snapshotAt', () => {
  const a = twoWeeks()
  const b = twoWeeks()
  const one = buildProgrammeSnapshot(a.p, a.templates, a.drills, a.media, AT)
  // Reversed input row order must not change the output at all.
  const two = buildProgrammeSnapshot(b.p, [b.templates[1], b.templates[0]], [b.drills[1], b.drills[0]], b.media, AT)
  assertEquals(JSON.stringify(one), JSON.stringify(two))
})

Deno.test('an absurd programmes.weeks value is refused instantly, never expanded', () => {
  // programmes.weeks is a plain int column. Before the cap was checked against
  // the COUNT rather than an expanded list, this allocated a two billion entry
  // array and hung the function. It must refuse immediately.
  const started = Date.now()
  const e = evaluateProgrammeEligibility(
    { rights: 'public_full', weeks: 2_000_000_000, pdf_media_id: null },
    [],
    [],
    [],
  )
  assert(!e.eligible)
  assert(e.blocked.includes('too_many_weeks'))
  assert(Date.now() - started < 1000, 'week cap must be checked before the week list is expanded')
})

Deno.test('the builder also refuses an absurd week count without expanding it', () => {
  const started = Date.now()
  assertThrows(() => buildProgrammeSnapshot(programme({ weeks: 2_000_000_000 }), [template()], [], [], AT))
  assert(Date.now() - started < 1000)
})

Deno.test('a NaN, negative or fractional week count is treated as no declared weeks', () => {
  const { drills, media: m } = twoWeeks()
  // Only the claimed template week survives, so the list is exactly [1].
  for (const weeks of [Number.NaN, -5, 0.5, Number.POSITIVE_INFINITY]) {
    const s = buildProgrammeSnapshot(programme({ weeks }), [template()], drills, m, AT)
    assertEquals(s.orderedWeekNumbers, [1])
  }
})

Deno.test('a template claiming a zero, negative or fractional week is not rendered', () => {
  const { drills, media: m } = twoWeeks()
  for (const week of [0, -1, 1.5]) {
    const s = buildProgrammeSnapshot(
      programme({ weeks: 1 }),
      [template(), template({ id: TEMPLATE_B, programme_week: week, name: 'Ghost week' })],
      drills,
      m,
      AT,
    )
    assertEquals(s.orderedWeekNumbers, [1])
    assert(!JSON.stringify(s).includes('Ghost week'))
  }
})

Deno.test('a programme over the media cap is reported as too_many_media, not as a size failure', () => {
  // 65 distinct media across the weeks: comfortably under the size cap, so the
  // media cap is the only thing that should refuse it, and eligibility must say
  // so rather than letting the builder throw later.
  const count = MAX_PROGRAMME_MEDIA + 1
  const drills: DrillRow[] = []
  const mediaRows: MediaRow[] = []
  const activities: Array<Record<string, unknown>> = []
  for (let i = 0; i < count; i++) {
    const did = `d${String(i).padStart(2, '0')}11111-1111-1111-1111-111111111111`
    const mid = `e${String(i).padStart(2, '0')}11111-1111-1111-1111-111111111111`
    drills.push(drill({ id: did, media_id: mid, summary: null, setup_notes: null, points: [] }))
    mediaRows.push(media({ id: mid }))
    activities.push({ phase: 'Skill', drill_id: did, duration: 1 })
  }
  const e = evaluateProgrammeEligibility(
    programme({ weeks: 1 }),
    [template({ activities })],
    drills,
    mediaRows,
  )
  assert(!e.eligible)
  assert(e.blocked.includes('too_many_media'))
  assert(!e.blocked.includes('snapshot_too_large'))
})

Deno.test('the attached PDF counts towards the media cap', () => {
  const drills: DrillRow[] = []
  const mediaRows: MediaRow[] = []
  const activities: Array<Record<string, unknown>> = []
  for (let i = 0; i < MAX_PROGRAMME_MEDIA; i++) {
    const did = `d${String(i).padStart(2, '0')}11111-1111-1111-1111-111111111111`
    const mid = `e${String(i).padStart(2, '0')}11111-1111-1111-1111-111111111111`
    drills.push(drill({ id: did, media_id: mid }))
    mediaRows.push(media({ id: mid }))
    activities.push({ phase: 'Skill', drill_id: did, duration: 1 })
  }
  // Exactly at the cap without a PDF.
  const atCap = evaluateProgrammeEligibility(
    programme({ weeks: 1 }),
    [template({ activities })],
    drills,
    mediaRows,
  )
  assert(!atCap.blocked.includes('too_many_media'))
  // The PDF is the one that tips it over.
  const overCap = evaluateProgrammeEligibility(
    programme({ weeks: 1, pdf_media_id: MEDIA_PDF }),
    [template({ activities })],
    drills,
    [...mediaRows, media({ id: MEDIA_PDF, type: 'pdf' })],
  )
  assert(overCap.blocked.includes('too_many_media'))
})

Deno.test('every builder refusal carries its own reason, not a generic one', () => {
  const { p, templates, drills, media: m } = twoWeeks()
  const cases: Array<[() => unknown, ProgrammeBlockReason]> = [
    [() => buildProgrammeSnapshot(programme({ rights: 'internal_only' }), templates, drills, m, AT), 'source_internal_only'],
    [() => buildProgrammeSnapshot(p, [template({ rights: 'internal_only' })], drills, m, AT), 'template_internal_only'],
    [() => buildProgrammeSnapshot(p, templates, [drill({ id: DRILL_A, media_id: MEDIA_A })], m, AT), 'drill_missing'],
    [() => buildProgrammeSnapshot(programme({ weeks: 0 }), [], [], [], AT), 'no_weeks'],
    [() => buildProgrammeSnapshot(programme({ weeks: 2_000_000_000 }), [template()], drills, m, AT), 'too_many_weeks'],
    [() => buildProgrammeSnapshot(programme({ pdf_media_id: MEDIA_PDF }), templates, drills, m, AT), 'pdf_missing'],
  ]
  for (const [run, reason] of cases) {
    let caught: unknown = null
    try {
      run()
    } catch (err) {
      caught = err
    }
    assert(caught instanceof ProgrammeBuildError, `expected a ProgrammeBuildError for ${reason}`)
    assertEquals((caught as ProgrammeBuildError).reason, reason)
  }
})


// -------------------------------------------------------------------------
// The media path boundary (0042_public_media_path_boundary)
// -------------------------------------------------------------------------
//
// The read path signs with the service role, which bypasses every Storage
// policy, so a public_full row whose stored path is not its own club's object
// must never reach a snapshot. These assert the builder half; the database
// CHECK constraint is the boundary and is asserted in
// tests/security/media-path-boundary.test.ts.

const OTHER_CLUB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

Deno.test('invalidMediaPaths passes a canonical same club path', () => {
  assertEquals(invalidMediaPaths([media()]), [])
})

Deno.test('invalidMediaPaths flags a public_full row pointing outside its club', () => {
  const m = media({ storage_path: `${OTHER_CLUB}/33333333-file.png` })
  assertEquals(invalidMediaPaths([m]), [m.id])
})

Deno.test('invalidMediaPaths flags the avatars namespace', () => {
  const m = media({ storage_path: 'avatars/22222222-2222-2222-2222-222222222222/face.jpg' })
  assertEquals(invalidMediaPaths([m]), [m.id])
})

Deno.test('invalidMediaPaths flags a traversal and an encoded traversal', () => {
  for (const path of [
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/../bbbb/file.png',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/%2e%2e/file.png',
    '/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/file.png',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa\\file.png',
  ]) {
    const m = media({ storage_path: path })
    assertEquals(invalidMediaPaths([m]), [m.id], path)
  }
})

Deno.test('invalidMediaPaths ignores media that signs nothing', () => {
  // A YouTube item carries an external link, not a stored object; an
  // internal_only or link only row is never signed. None of them can leak a
  // path, so none of them blocks a share.
  assertEquals(invalidMediaPaths([media({ type: 'youtube', storage_path: null })]), [])
  assertEquals(invalidMediaPaths([media({ storage_path: null })]), [])
  assertEquals(
    invalidMediaPaths([media({ rights: 'internal_only', storage_path: `${OTHER_CLUB}/x.png` })]),
    [],
  )
  assertEquals(
    invalidMediaPaths([media({ rights: 'public_link_only', storage_path: `${OTHER_CLUB}/x.png` })]),
    [],
  )
})

Deno.test('the drill builder refuses to project a media path outside its club', () => {
  // Defensive backstop: the manage function returns a 422 before this, and the
  // database refuses to store such a path at all. Reaching the builder means
  // both were bypassed, so it must fail the share closed rather than sign.
  const bad = media({ storage_path: `${OTHER_CLUB}/33333333-file.png` })
  assertThrows(
    () => buildDrillSnapshot(drill(), bad, '2026-01-01T00:00:00.000Z'),
    Error,
    'outside its own club namespace',
  )
})

Deno.test('a canonical path still reaches _path unchanged', () => {
  const s = buildDrillSnapshot(drill(), media(), '2026-01-01T00:00:00.000Z')
  assertEquals(s.media[0]._path, media().storage_path)
  assertEquals(s.media[0]._mid, media().id)
})

Deno.test('the session builder refuses a nested drill media path outside its club', () => {
  // A session share pools every referenced drill's media into one top level
  // list, so a bad path on any nested drill's media must fail the whole
  // session, not just drop that one item.
  const bad = mediaA({ storage_path: `${OTHER_CLUB}/33333333-file.png` })
  assertThrows(
    () => buildSessionSnapshot(session(), [drillA({ media_id: bad.id }), drillB()], [bad], null, AT),
    Error,
    'outside its own club namespace',
  )
})

Deno.test('the programme builder refuses a nested week drill media path outside its club', () => {
  const { p, templates, drills } = twoWeeks()
  const bad = media({ id: MEDIA_A, storage_path: `${OTHER_CLUB}/33333333-file.png` })
  assertThrows(
    () => buildProgrammeSnapshot(p, templates, drills, [bad], AT),
    Error,
    'outside its own club namespace',
  )
})

Deno.test('invalidMediaPaths reports every offender, not just the first', () => {
  // The manage function turns a non empty result into one 422; reporting all of
  // them keeps the blocker honest if a future caller wants to name them.
  const a = media({ id: MEDIA_A, storage_path: `${OTHER_CLUB}/a.png` })
  const b = media({ id: DRILL_B, storage_path: 'avatars/1/b.png' })
  const good = media({ id: DRILL_A })
  assertEquals(invalidMediaPaths([a, good, b]).sort(), [a.id, b.id].sort())
})


// -------------------------------------------------------------------------
// Club-wide shared links management (Content Sharing PR 5)
// -------------------------------------------------------------------------

const NOW = '2026-07-27T12:00:00.000Z'

Deno.test('deriveShareStatus: a live share with no expiry is active', () => {
  assertEquals(deriveShareStatus({ revoked_at: null, expires_at: null }, NOW), 'active')
})

Deno.test('deriveShareStatus: an expiry in the future is still active', () => {
  assertEquals(deriveShareStatus({ revoked_at: null, expires_at: '2026-08-01T00:00:00Z' }, NOW), 'active')
})

Deno.test('deriveShareStatus: an expiry in the past is expired', () => {
  assertEquals(deriveShareStatus({ revoked_at: null, expires_at: '2026-07-01T00:00:00Z' }, NOW), 'expired')
})

Deno.test('deriveShareStatus: an expiry exactly now is expired', () => {
  // Matches read_public_share, which refuses on expires_at <= now().
  assertEquals(deriveShareStatus({ revoked_at: null, expires_at: NOW }, NOW), 'expired')
})

Deno.test('deriveShareStatus: revoked wins over expired', () => {
  // A revoked share had its snapshot cleared and its dependency rows deleted,
  // so it can never serve again whatever its expiry says.
  assertEquals(
    deriveShareStatus({ revoked_at: '2026-07-02T00:00:00Z', expires_at: '2026-07-01T00:00:00Z' }, NOW),
    'revoked',
  )
})

Deno.test('deriveShareStatus: an expiry-swept share still reads as expired', () => {
  // The cleanup sweep clears the snapshot without setting revoked_at, so the
  // row has a past expiry and no snapshot. It must not read as revoked.
  assertEquals(deriveShareStatus({ revoked_at: null, expires_at: '2026-01-01T00:00:00Z' }, NOW), 'expired')
})

Deno.test('the management projection matches the anonymous one for every kind', () => {
  const d = buildDrillSnapshot(drill(), media(), AT)
  const projD = toPublicProjectionByKind('drill', d)
  assert(validatePublicSnapshotByKind('drill', projD))
  assertEquals(projD, toPublicProjection(d))

  const sn = buildSessionSnapshot(session(), [drillA(), drillB()], [], null, AT)
  assert(validatePublicSnapshotByKind('session', toPublicProjectionByKind('session', sn)))

  const { p, templates, drills, media: m } = twoWeeks()
  const pr = buildProgrammeSnapshot(p, templates, drills, m, AT)
  assert(validatePublicSnapshotByKind('programme', toPublicProjectionByKind('programme', pr)))
})

Deno.test('the management projection carries no forbidden key and no internal marker', () => {
  const d = buildDrillSnapshot(drill(), media(), AT)
  const proj = toPublicProjectionByKind('drill', d) as Record<string, unknown>
  assertNoForbiddenKeys(proj)
  const first = (proj.media as Array<Record<string, unknown>>)[0]
  assertEquals('_mid' in first, false)
  assertEquals('_path' in first, false)
  assertEquals('storage_path' in first, false)
})

Deno.test('the management projection drops an unknown media key rather than passing it through', () => {
  // The private stripper this replaced rebuilt each entry with a spread, so any
  // key it had not been taught about survived, and nothing validated the result.
  const d = buildDrillSnapshot(drill(), media(), AT)
  ;(d.media[0] as unknown as Record<string, unknown>).surprise = 'leak'
  ;(d.media[0] as unknown as Record<string, unknown>).storage_path = 'club/secret.png'
  const proj = toPublicProjectionByKind('drill', d) as Record<string, unknown>
  const first = (proj.media as Array<Record<string, unknown>>)[0]
  assertEquals('surprise' in first, false)
  assertEquals('storage_path' in first, false)
  assert(validatePublicSnapshotByKind('drill', proj))
})

Deno.test('an unknown kind throws when projecting and fails closed when validating', () => {
  // No generic renderer: a kind added later must widen both deliberately.
  assertThrows(() => toPublicProjectionByKind('board', {}), Error, 'unsupported kind')
  assertEquals(validatePublicSnapshotByKind('board', {}), false)
})

Deno.test('buildShareListFilter: an empty body is the safe default', () => {
  const r = buildShareListFilter({})
  assert('filter' in r)
  assertEquals(r.filter.status, 'all')
  assertEquals(r.filter.kind, null)
  assertEquals(r.filter.limit, SHARE_LIST_DEFAULT_LIMIT)
  assertEquals(r.filter.unattributed, false)
})

Deno.test('buildShareListFilter: a club can never be supplied by the caller', () => {
  // The club is derived from the verified JWT server side. A club in the body is
  // simply not part of the filter, so it cannot widen or redirect the query.
  const r = buildShareListFilter({ clubId: '11111111-1111-4111-8111-111111111111', club_id: 'x' })
  assert('filter' in r)
  assertEquals(Object.keys(r.filter).includes('clubId'), false)
  assertEquals(Object.keys(r.filter).includes('club_id'), false)
})

Deno.test('buildShareListFilter: every closed field refuses an unknown value', () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ['Unknown status filter.', { status: 'anything' }],
    ['Unknown status filter.', { status: 7 }],
    ['Unknown share kind.', { kind: 'board' }],
    ['Invalid share id.', { shareId: 'not-a-uuid' }],
    ['Invalid member id.', { createdBy: 'not-a-uuid' }],
    ['Invalid limit.', { limit: 0 }],
    ['Invalid limit.', { limit: SHARE_LIST_MAX_LIMIT + 1 }],
    ['Invalid limit.', { limit: 2.5 }],
    ['Invalid limit.', { limit: '10' }],
    ['Invalid cursor.', { cursor: 'not-a-date' }],
  ]
  for (const [message, input] of cases) {
    const r = buildShareListFilter(input)
    assert('error' in r, JSON.stringify(input))
    assertEquals(r.error, message)
  }
})

Deno.test('buildShareListFilter: a member and unattributed together are refused', () => {
  const r = buildShareListFilter({
    createdBy: '11111111-1111-4111-8111-111111111111',
    unattributed: true,
  })
  assert('error' in r)
})

Deno.test('buildShareListFilter: unattributed is strict, not truthy', () => {
  const r = buildShareListFilter({ unattributed: 'yes' })
  assert('filter' in r)
  assertEquals(r.filter.unattributed, false)
})

Deno.test('buildShareListFilter: the accepted values round trip', () => {
  const r = buildShareListFilter({
    status: 'revoked',
    kind: 'programme',
    createdBy: '11111111-1111-4111-8111-111111111111',
    limit: 10,
    cursor: '2026-07-01T00:00:00.000Z',
  })
  assert('filter' in r)
  assertEquals(r.filter.status, 'revoked')
  assertEquals(r.filter.kind, 'programme')
  assertEquals(r.filter.limit, 10)
})

// =====================================================================
// Provenance (bounded, non identifying)
//
// The preview reports WHICH LAYER blocked a share. Provenance is what lets the
// client tell "set to club only" apart from "came from England Football", which
// the old copy could not do and so claimed England Football for everything.
// =====================================================================

Deno.test('isFaSourceUrl: both England Football hosts, and nothing else', () => {
  assert(isFaSourceUrl('https://learn.englandfootball.com/resources/session/abc'))
  assert(isFaSourceUrl('https://CDN.EnglandFootball.com/img/a.png'))
  assertEquals(isFaSourceUrl('https://example.com/x'), false)
  assertEquals(isFaSourceUrl('https://notenglandfootball.com/x'), false)
  assertEquals(isFaSourceUrl('https://learn.englandfootball.com.evil.test/x'), false)
  assertEquals(isFaSourceUrl(null), false)
  assertEquals(isFaSourceUrl('not a url'), false)
})

Deno.test('rowProvenance: England Football from a url, a drill source key or the label', () => {
  assertEquals(rowProvenance({ source_url: 'https://learn.englandfootball.com/a' }), 'fa')
  assertEquals(rowProvenance({ source_key: 'https://learn.englandfootball.com/a#act-2' }), 'fa')
  assertEquals(rowProvenance({ source_label: 'England Football Learning' }), 'fa')
})

Deno.test('rowProvenance: any other recorded source is third party, absent is club original', () => {
  assertEquals(rowProvenance({ source_url: 'https://example.com/x' }), 'third_party')
  assertEquals(rowProvenance({ source_label: 'A coaching book' }), 'third_party')
  assertEquals(rowProvenance({}), 'none')
  assertEquals(rowProvenance({ source_url: null, source_label: '   ' }), 'none')
})

Deno.test('rowProvenance: never reads the rights value, which proves nothing', () => {
  // Every row created since 0038 is internal_only by the column default,
  // including content the club wrote itself.
  assertEquals(rowProvenance({ source_url: null, source_label: null }), 'none')
})

Deno.test('anyRestricted: true only for a blocking row that is England Football derived', () => {
  const fa = { rights: 'internal_only' as const, source_url: 'https://learn.englandfootball.com/a', source_label: null }
  const clubOnly = { rights: 'internal_only' as const, source_url: null, source_label: null }
  const faButPublishable = { rights: 'public_full' as const, source_url: 'https://learn.englandfootball.com/a', source_label: null }
  assertEquals(anyRestricted([clubOnly]), false)
  assertEquals(anyRestricted([clubOnly, fa]), true)
  // A row that is not blocking cannot make the layer restricted.
  assertEquals(anyRestricted([faButPublishable]), false)
  assertEquals(anyRestricted([]), false)
})
