// Spond RSVP as context beside the register.
//
// THE RULE THIS FILE SERVES. RSVP is context. Attendance is the coach's
// own record. Nothing here reads, writes or derives attendance: the
// register is composed by buildRegister, which takes no Spond input at
// all, and this module only supplies a lookup from a player id to what
// their parent replied in Spond. Going and not present, declined and
// present, and no reply and present are all valid, and none of them is
// treated as a contradiction.
//
// ABSENCE HAS EXACTLY ONE APPEARANCE: nothing. No session Spond event,
// no link for this child, a query still loading, or a query that failed
// all produce the same output, so there is no third state to design and
// a Spond failure can never render as "nobody is coming".
//
// Names never come from here. A row carries a player id; the name beside
// it is players.display_name, resolved by the register.
import type { RegisteredPlayer } from './data'

export type RsvpStatus = 'accepted' | 'declined' | 'unanswered' | 'waiting'

// The words on the pill. Deliberately not "Yes" and "No", which read as
// present and absent, which is the one thing RSVP must never look like.
export const RSVP_LABELS: Record<RsvpStatus, string> = {
  accepted: 'Going',
  declined: 'Not going',
  unanswered: 'No reply',
  waiting: 'Waiting',
}

const RSVP_STATUSES = new Set<string>(['accepted', 'declined', 'unanswered', 'waiting'])

export function isRsvpStatus(value: unknown): value is RsvpStatus {
  return typeof value === 'string' && RSVP_STATUSES.has(value)
}

// What a row shows: the reply, and when the mirror last confirmed it.
export interface Rsvp {
  status: RsvpStatus
  syncedAt: string
}

// One event's stored replies, and the club's member to player bindings,
// as the two reads return them.
export interface RsvpResponseRow {
  spond_member_id: string
  status: string
  synced_at: string
}
export interface RsvpLinkRow {
  spond_member_id: string
  player_id: string
}

// Resolve replies onto players. A response whose member is not (or is no
// longer) linked resolves to nobody and is dropped, which is the same
// outcome the database enforces; a link with no reply this event yields
// no entry, which renders as no pill.
export function buildRsvpByPlayer(
  responses: readonly RsvpResponseRow[],
  links: readonly RsvpLinkRow[],
): Record<string, Rsvp> {
  const playerByMember = new Map<string, string>()
  for (const l of links) playerByMember.set(l.spond_member_id, l.player_id)
  const out: Record<string, Rsvp> = {}
  for (const r of responses) {
    const playerId = playerByMember.get(r.spond_member_id)
    if (!playerId) continue
    if (!isRsvpStatus(r.status)) continue
    out[playerId] = { status: r.status, syncedAt: r.synced_at }
  }
  return out
}

// One muted line under the register count, and only when it earns its
// place: the shown rows carry replies and the freshest of them is over a
// day old. Fresh context needs no label; stale context must not pass
// itself off as fresh. Null means render nothing.
//
// A day is the threshold because a coach reads the register on the night
// and replies given that morning are current; replies from before
// yesterday may predate a change of plan.
export const RSVP_STALE_AFTER_MS = 24 * 60 * 60 * 1000

export function rsvpStaleNote(byPlayer: Record<string, Rsvp>, now: Date = new Date()): string | null {
  let newest = Number.NEGATIVE_INFINITY
  for (const r of Object.values(byPlayer)) {
    const ms = Date.parse(r.syncedAt)
    if (Number.isFinite(ms) && ms > newest) newest = ms
  }
  if (!Number.isFinite(newest)) return null
  const age = now.getTime() - newest
  if (age < RSVP_STALE_AFTER_MS) return null
  const days = Math.floor(age / RSVP_STALE_AFTER_MS)
  return days <= 1 ? 'Spond replies from yesterday' : `Spond replies from ${days} days ago`
}

// How many of the club's roster carry a Spond link, for the management
// screen's progress chips. Pure so the counts are unit tested without a
// database, and player ids only: no name and no member id.
export function linkedCounts(
  roster: readonly RegisteredPlayer[],
  linkedPlayerIds: ReadonlySet<string>,
): { linked: number; total: number } {
  let linked = 0
  for (const p of roster) if (linkedPlayerIds.has(p.playerId)) linked++
  return { linked, total: roster.length }
}
