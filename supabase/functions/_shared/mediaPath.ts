// =====================================================================
// The canonical media storage path grammar (Edge Function side)
// =====================================================================
//
// One grammar, three implementations that must agree exactly:
//
//   1. this module            (Deno, the snapshot builder and manage function)
//   2. src/lib/mediaPath.ts   (browser, the upload flows)
//   3. public.is_canonical_media_path(text, uuid)  (Postgres, the CHECK
//      constraint on media.storage_path and the read path's revalidation)
//
// tests/fixtures/media-path-cases.json is the shared case list all three are
// tested against, so a change to one that is not made to the others fails CI.
//
// Why the grammar is this strict. media.storage_path is a key into the private
// `media` Storage bucket, and the anonymous read path signs it with the service
// role, which bypasses every Storage RLS policy. A path that is not exactly the
// owning club's own object is therefore a direct disclosure: another club's
// object, a member's avatar (avatars/{user_id}/... lives in the same bucket) or
// an internal_only object whose bytes were never meant to leave the club. The
// grammar admits only `{club_id}/{segment}[/{segment}...]`, with a character set
// that has no separator lookalike in it at all, so traversal, percent encoding
// and control byte tricks are refused by construction rather than by
// normalisation. Normalising an attacker's string and then trusting the result
// is the class of bug this avoids: nothing here rewrites a path, it only
// accepts or rejects one.

/** The longest accepted path. Comfortably above the ~138 characters the real
 *  `{club_id}/{uuid}-{filename}` shape produces, well below any Storage limit. */
export const MEDIA_PATH_MAX_LENGTH = 512

// A segment must start alphanumeric and may then carry dot, dash and
// underscore. Starting alphanumeric is what makes `.` and `..` unrepresentable,
// so no separate traversal rule is needed. The set contains no `/`, `\`, `%`,
// `:`, space or control byte, so every encoding trick fails the character test
// before any structural test runs.
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

// The whole path, checked before splitting. Anything outside this set (a
// control byte, a percent sign, a backslash, a non ASCII letter) is refused
// here, so `split('/')` below can never see a character that might mean
// something else to Storage.
const PATH_CHARSET = /^[A-Za-z0-9._/-]+$/

// Reserved namespaces that a media object may never occupy at any depth.
// `avatars/{user_id}/...` shares the `media` bucket but deliberately has no
// media row; a media row pointing into it would publish a member's face.
const RESERVED_SEGMENTS = /(^|\/)avatars(\/|$)/i

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/**
 * True when `path` is the canonical storage path of an object owned by
 * `clubId`. Fails closed for any non string, any malformed club id and any path
 * that is not exactly `{clubId}/{segment}[/{segment}...]`.
 *
 * The club id comparison is against the lowercase canonical form, because that
 * is what Postgres renders `uuid::text` as and therefore what the SQL
 * implementation compares. An uppercase spelling is refused rather than
 * normalised so all three implementations agree byte for byte.
 */
export function isCanonicalMediaPath(path: unknown, clubId: unknown): boolean {
  if (typeof path !== 'string' || typeof clubId !== 'string') return false

  const club = clubId.toLowerCase()
  if (!UUID.test(club)) return false

  if (path.length === 0 || path.length > MEDIA_PATH_MAX_LENGTH) return false
  if (!PATH_CHARSET.test(path)) return false
  if (RESERVED_SEGMENTS.test(path)) return false

  const segments = path.split('/')
  // At least the club segment plus one object segment.
  if (segments.length < 2) return false
  // Exact match, not a prefix: `{club}9/x` and `{club}x/x` are both refused.
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
