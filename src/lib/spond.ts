// Pure helpers behind the Spond surfaces: the mapping editor's input
// parsing, the event picker's ordering and the freshness label. No fetching
// of any kind happens here or anywhere else client side; the browser never
// calls Spond, and the only Spond data the client touches is the counts and
// event facts the spond_events read returns (CLAUDE.md, Spond integration).

// The four counts in display order, the only attendance figures the app
// holds. They key straight into SpondEvent.
export const SPOND_COUNT_LABELS = ['accepted', 'declined', 'unanswered', 'waiting'] as const

// What an admin pastes into the add mapping form resolves to: the Spond
// group, and optionally one subgroup within it.
export interface SpondGroupRef {
  groupId: string
  subgroupId: string | null
}

// Spond ids are long uppercase hex strings (32 characters today). A long
// hex run is required rather than an exact length so a format tweak on
// Spond's side does not brick the editor, while short hex-looking words
// still fail as garbage.
const SPOND_ID = /^[0-9A-F]{16,}$/

// The id segment of a Spond client URL: everything after /client/groups/ up
// to the next path separator, query or fragment.
const CLIENT_URL = /^https?:\/\/(?:www\.)?spond\.com\/client\/groups\/([^/?#]+)/i

// Resolves the add mapping form's one source input. Accepts a raw group id,
// a raw GROUP-S-SUBGROUP pair, or a full Spond client URL of the form
// https://spond.com/client/groups/<GROUPID> or
// https://spond.com/client/groups/<GROUPID>-S-<SUBGROUPID>, where the -S-
// separator splits group from subgroup. Case is normalised to the uppercase
// Spond uses. Anything else, other URLs included, is null: only ids reach
// the insert, never a pasted page.
export function parseSpondMappingInput(raw: string): SpondGroupRef | null {
  let value = raw.trim()
  const url = value.match(CLIENT_URL)
  if (url) value = url[1]
  else if (value.includes('/') || value.includes(':')) return null
  const parts = value.toUpperCase().split('-S-')
  if (parts.length > 2) return null
  const [groupId, subgroupId] = parts
  if (!SPOND_ID.test(groupId)) return null
  if (subgroupId === undefined) return { groupId, subgroupId: null }
  if (!SPOND_ID.test(subgroupId)) return null
  return { groupId, subgroupId }
}

// Comparator for the event picker: nearest to the session's moment first,
// so the Tuesday session offers Tuesday's event before the gala in three
// weeks. The session date is a plain yyyy-mm-dd with the start time joined
// when set; a session with no date falls back to start order.
export function bySpondEventCloseness(date: string, time: string) {
  const at = date ? Date.parse(`${date}T${time || '00:00'}`) : NaN
  return (a: { startsAt: string }, b: { startsAt: string }): number => {
    if (Number.isFinite(at)) {
      const d = Math.abs(Date.parse(a.startsAt) - at) - Math.abs(Date.parse(b.startsAt) - at)
      if (d !== 0) return d
    }
    return a.startsAt.localeCompare(b.startsAt)
  }
}

// The freshness label next to the counts: "synced 20 minutes ago". Coarse
// on purpose, freshness not precision; the counts are a snapshot and change
// only when someone presses Sync now.
export function syncedAgo(syncedAt: string, now: Date = new Date()): string {
  const ms = now.getTime() - Date.parse(syncedAt)
  if (!Number.isFinite(ms)) return ''
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return 'synced just now'
  if (minutes < 60) return `synced ${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `synced ${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  return `synced ${days} day${days === 1 ? '' : 's'} ago`
}

// An event's date and time the way the session cards show theirs:
// Mon 16 Jun · 17:30.
export function spondEventWhen(startsAt: string): string {
  const d = new Date(startsAt)
  if (Number.isNaN(d.getTime())) return ''
  const date = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  return `${date} · ${time}`
}
