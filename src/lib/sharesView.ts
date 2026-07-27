// OTJ Training Hub, club wide Shared Links view helpers (Content Sharing PR 5).
//
// Pure, DOM free helpers for the manager's Shared links screen: the filter
// model and the wire shape it becomes, the share id a manager may paste in,
// and the copy for a share's status and kind. No React, no DOM, no network, so
// every reducer is provable without a browser, matching src/lib/activityView.ts
// and src/lib/publicShare.ts.
//
// THE PASTED LINK IS THE ONE INPUT THAT CARRIES A SECRET. A public share URL is
// /share/<uuid>#<secret>: the fragment is the authorisation secret, so a
// manager pasting a link someone reported to them is holding a live secret.
// shareIdFromInput returns the uuid ONLY. The fragment is never returned, never
// stored, never placed in component state and never put on the wire; it is read
// past and dropped. The share id on its own is a lookup id, not an
// authorisation secret, and the list and detail reads are gated on
// shares.manage server side regardless.

export type ManagedShareKind = 'drill' | 'session' | 'programme'
export type ManagedShareStatus = 'active' | 'expired' | 'revoked'
export type ShareStatusFilter = ManagedShareStatus | 'all'

// The page size the screen asks for, and the server's ceiling. Both mirror
// SHARE_LIST_DEFAULT_LIMIT and SHARE_LIST_MAX_LIMIT in the Edge Function; the
// server is the authority and clamps again.
export const SHARES_PAGE_SIZE = 50
export const SHARES_MAX_PAGE_SIZE = 100

// The screen's filter state. Empty string means "any" for the two id fields and
// the kind; status carries its own explicit 'all'. unattributed narrows to the
// links whose creator has left the club, which the server expresses as a null
// created_by, so it is a separate flag rather than a creator id.
export interface ShareFilters {
  status: ShareStatusFilter
  kind: ManagedShareKind | ''
  createdBy: string
  unattributed: boolean
  shareId: string
}

export const EMPTY_SHARE_FILTERS: ShareFilters = {
  status: 'all',
  kind: '',
  createdBy: '',
  unattributed: false,
  shareId: '',
}

export const SHARE_STATUS_FILTERS: ShareStatusFilter[] = ['all', 'active', 'expired', 'revoked']
export const SHARE_KINDS: ManagedShareKind[] = ['drill', 'session', 'programme']

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Parse an absolute URL, or a path only paste such as "/share/<uuid>#<secret>",
// and hand back the pathname alone. Everything else the input carried (the
// fragment, the query string, the host) is discarded here and never reaches the
// caller. A non http scheme is refused so a pasted "javascript:" string cannot
// be coaxed into looking like a share path.
function pathnameOf(raw: string): string | null {
  try {
    const url = new URL(raw, 'https://otj.invalid')
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    return url.pathname
  } catch {
    return null
  }
}

// Accepts a bare share id, or a pasted public share link, and returns the share
// id. Returns null for anything else, so a typo narrows nothing rather than
// silently listing the whole club.
//
// The secret is discarded, not merely ignored: only the pathname is read, and
// only the uuid inside it is returned.
export function shareIdFromInput(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const raw = value.trim()
  if (!raw) return null
  if (UUID_RE.test(raw)) return raw.toLowerCase()

  const path = pathnameOf(raw)
  if (!path) return null
  const match = /^\/share\/([^/]+)\/?$/.exec(path)
  if (!match) return null
  const id = match[1]
  return UUID_RE.test(id) ? id.toLowerCase() : null
}

function clampLimit(limit: number): number {
  if (!Number.isFinite(limit)) return SHARES_PAGE_SIZE
  const whole = Math.trunc(limit)
  if (whole < 1) return 1
  if (whole > SHARES_MAX_PAGE_SIZE) return SHARES_MAX_PAGE_SIZE
  return whole
}

// The list request body for a filter set. Empty fields are omitted entirely
// rather than sent as null, so the server applies its own defaults, and
// createdBy and unattributed are never both present: the server answers 400
// when they are, so unattributed wins here and the creator id is dropped.
export function filtersToRequest(
  filters: ShareFilters,
  opts: { cursor?: string | null; limit?: number } = {},
): Record<string, unknown> {
  const body: Record<string, unknown> = { action: 'list' }
  if (filters.status && filters.status !== 'all') body.status = filters.status
  if (filters.kind) body.kind = filters.kind

  // Only ever the id. A pasted link's fragment never gets this far.
  const shareId = shareIdFromInput(filters.shareId)
  if (shareId) body.shareId = shareId

  if (filters.unattributed) body.unattributed = true
  else if (filters.createdBy.trim()) body.createdBy = filters.createdBy.trim()

  body.limit = clampLimit(opts.limit ?? SHARES_PAGE_SIZE)
  if (opts.cursor) body.cursor = opts.cursor
  return body
}

// The one URL persisted dimension: a creator deep link, so the member removal
// warning in Admin users can point straight at that member's links. Anything
// that is not a member id is ignored rather than passed through, so a hand
// edited URL narrows nothing instead of reaching the server as junk.
export function shareFiltersFromParams(params: URLSearchParams): Partial<ShareFilters> {
  const createdBy = params.get('createdBy')
  if (!createdBy || !UUID_RE.test(createdBy.trim())) return {}
  return { createdBy: createdBy.trim().toLowerCase() }
}

// Whether anything is narrowing the list, which decides the empty state copy
// and whether a Clear filters affordance is offered.
export function shareFiltersAreActive(filters: ShareFilters): boolean {
  return (
    filters.status !== 'all' ||
    filters.kind !== '' ||
    filters.unattributed ||
    filters.createdBy.trim() !== '' ||
    filters.shareId.trim() !== ''
  )
}

// The status breakdown of the rows currently loaded. Deliberately derived from
// what the browser holds rather than asked of the server: the server's own
// total is the exact count for the filter, and these three are an honest
// summary of the page in front of the manager.
export function countByStatus(
  shares: ReadonlyArray<{ status: ManagedShareStatus }>,
): Record<ManagedShareStatus, number> {
  const counts: Record<ManagedShareStatus, number> = { active: 0, expired: 0, revoked: 0 }
  for (const s of shares) {
    if (s.status === 'active' || s.status === 'expired' || s.status === 'revoked') counts[s.status] += 1
  }
  return counts
}

// ---- Copy -------------------------------------------------------------------

const STATUS_LABELS: Record<ManagedShareStatus, string> = {
  active: 'Active',
  // "Turned off" rather than "Revoked": the coach facing control is called
  // "Turn off this link", so the log reads back in the same words.
  revoked: 'Turned off',
  expired: 'Expired',
}

export function statusLabel(status: ManagedShareStatus): string {
  return STATUS_LABELS[status]
}

const KIND_LABELS: Record<ManagedShareKind, string> = {
  drill: 'Drill',
  session: 'Session',
  programme: 'Programme',
}

export function sourceKindLabel(kind: ManagedShareKind): string {
  return KIND_LABELS[kind]
}

export const STATUS_FILTER_LABELS: Record<ShareStatusFilter, string> = {
  all: 'Any status',
  active: 'Active',
  expired: 'Expired',
  revoked: 'Turned off',
}

// Shown in place of a title when the drill, session or programme behind a link
// has since been deleted. Neutral: it names no source and claims nothing about
// who removed it.
export const SOURCE_DELETED_LABEL = 'Source deleted'

// Shown in place of a creator name when created_by is null, which happens when
// the member who made the link has left the club. The link keeps working.
export const FORMER_MEMBER_LABEL = 'Former member'

// Why this screen offers no Copy link, no Replace link and no Update control.
export const NO_LINK_CONTROLS_NOTE =
  'The link itself is not shown here. It is only ever displayed once, when it is created, and cannot be read back. Replacing or updating a link stays with the coach who made it; turning it off is the club wide control.'

export const REVIEW_UNAVAILABLE_NOTE =
  'The stored copy of this link cannot be shown. You can still turn the link off.'

export const REVOKE_CONFIRM_NOTE =
  'The link stops working straight away. Anyone who already has it will see an unavailable message. The coach who made it is not told automatically.'

export const KILL_SWITCH_NOTE =
  'Public sharing is turned off for the club. Existing links do not work while it is off.'


// The Made by picker's option values are list positions, never member ids, so
// no user id is rendered into the markup. Turning a chosen value back into a
// filter has one trap worth naming: Number('') is 0, so the "Anyone" option
// must be handled BEFORE any index lookup. Coercing it would select the first
// member and silently narrow a club-wide review to one person, on a screen
// whose whole purpose is to show every link the club has made.
//
// Pure and exported so it can be tested without a DOM: the suite renders
// through renderToStaticMarkup and cannot fire a change event.
export function creatorFilterPatch(
  value: string,
  members: ReadonlyArray<{ id: string }>,
): { unattributed: boolean; createdBy: string } {
  if (value === 'unattributed') return { unattributed: true, createdBy: '' }
  if (value === '') return { unattributed: false, createdBy: '' }
  const index = Number(value)
  if (!Number.isInteger(index) || index < 0 || index >= members.length) {
    // An unresolvable position (the deep-link placeholder, or a stale index)
    // clears the filter rather than guessing at a member.
    return { unattributed: false, createdBy: '' }
  }
  return { unattributed: false, createdBy: members[index].id }
}
