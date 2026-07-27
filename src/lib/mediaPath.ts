// =====================================================================
// The canonical media storage path grammar (browser side)
// =====================================================================
//
// The browser twin of supabase/functions/_shared/mediaPath.ts. The two module
// graphs are separate (Vite bundles src/, the Supabase CLI bundles
// supabase/functions/), so the grammar is stated twice and pinned together by
// tests/fixtures/media-path-cases.json, which both suites and the Postgres
// implementation are tested against. Keep the two files identical below the
// header; a change to one without the other fails CI.
//
// Used on the upload flows so a path that the database CHECK constraint would
// refuse is caught before the object is written to Storage, rather than leaving
// an orphaned object behind a failed row insert. The database constraint, not
// this function, is the boundary.

/** The longest accepted path. Comfortably above the ~138 characters the real
 *  `{club_id}/{uuid}-{filename}` shape produces, well below any Storage limit. */
export const MEDIA_PATH_MAX_LENGTH = 512

const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const PATH_CHARSET = /^[A-Za-z0-9._/-]+$/
const RESERVED_SEGMENTS = /(^|\/)avatars(\/|$)/i
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/**
 * True when `path` is the canonical storage path of an object owned by
 * `clubId`. See supabase/functions/_shared/mediaPath.ts for why the grammar
 * refuses rather than normalises.
 */
export function isCanonicalMediaPath(path: unknown, clubId: unknown): boolean {
  if (typeof path !== 'string' || typeof clubId !== 'string') return false

  const club = clubId.toLowerCase()
  if (!UUID.test(club)) return false

  if (path.length === 0 || path.length > MEDIA_PATH_MAX_LENGTH) return false
  if (!PATH_CHARSET.test(path)) return false
  if (RESERVED_SEGMENTS.test(path)) return false

  const segments = path.split('/')
  if (segments.length < 2) return false
  if (segments[0] !== club) return false
  for (const segment of segments) {
    if (!SEGMENT.test(segment)) return false
  }
  return true
}

// The club agnostic half of the grammar, for the one caller that does not know
// which club a path belongs to: the anonymous read function receives only
// `{ref, path}` pairs from the definer function and cannot re-derive the club.
// Everything except WHICH club owns the path is still enforced, so a path that
// somehow reached the sign list malformed is dropped before it is handed to
// Storage. The definer function's own club scoped check is the real control;
// this is the last gate before the service role signs.
export function isCanonicalMediaPathShape(path: unknown): boolean {
  if (typeof path !== 'string') return false
  if (path.length === 0 || path.length > MEDIA_PATH_MAX_LENGTH) return false
  if (!PATH_CHARSET.test(path)) return false
  if (RESERVED_SEGMENTS.test(path)) return false

  const segments = path.split('/')
  if (segments.length < 2) return false
  if (!UUID.test(segments[0])) return false
  for (const segment of segments) {
    if (!SEGMENT.test(segment)) return false
  }
  return true
}
