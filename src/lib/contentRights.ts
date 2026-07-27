// OTJ Training Hub, content rights classification (client side, pure).
//
// The rights column on media, drills, sessions, programmes and templates says
// whether a row may leave the club in a public link. Until now nothing in the
// app could read or set it, so every row created after migration 0038 sat at
// the fail closed default (club only) with no way out. This module is the
// vocabulary the edit forms and the share flow share: the three levels in the
// club's own words, and the provenance rules that decide whether a level may be
// chosen at all.
//
// Provenance is derived from the source columns the row already carries, never
// from the rights value. A row being club only proves nothing about where it
// came from; only a recorded source does. That distinction is the whole point
// of this file: the old copy told a coach their own club written programme was
// England Football content because it happened to be club only.
//
// The server is the authority. The database refuses to raise the rights of an
// England Football derived row above club only (migration 0043), and the share
// lifecycle re-checks every level again. These helpers only decide what to
// offer, and they are deliberately no wider than the server will accept.

import type { ContentRights } from './data'
import { FA_SOURCE_LABEL, isFaUrl } from './fa'

export type { ContentRights }

// Where a row came from, as far as its own recorded source fields can prove.
//   fa           an England Football Learning URL, or the FA's own source
//                label. Restricted: it never becomes public.
//   third_party  some other source was recorded. Not proof of a restriction,
//                but not club original either, so it needs an explicit
//                confirmation before it is published.
//   none         no source recorded at all. Treated as club original, which is
//                the same rule migration 0038's backfill used.
export type SourceProvenance = 'none' | 'fa' | 'third_party'

export interface SourceFields {
  sourceUrl?: string | null
  sourceLabel?: string | null
  // Drills only: the FA importer's stable identity for the activity, which
  // begins with the FA source URL.
  sourceKey?: string | null
}

function filled(v: string | null | undefined): boolean {
  return typeof v === 'string' && v.trim().length > 0
}

// Mirrors public.content_rights_is_fa_url and supabase/functions/_shared/share.ts
// rowProvenance. Three implementations of one rule, kept aligned deliberately;
// the database one is the boundary.
export function deriveProvenance(f: SourceFields): SourceProvenance {
  if (isFaUrl(f.sourceUrl) || isFaUrl(f.sourceKey)) return 'fa'
  if (filled(f.sourceLabel) && f.sourceLabel!.trim() === FA_SOURCE_LABEL) return 'fa'
  if (filled(f.sourceUrl) || filled(f.sourceLabel) || filled(f.sourceKey)) return 'third_party'
  return 'none'
}

// The strongest provenance across several readings of the same row. An edit
// form holds two: the saved row, and the draft the user is typing into. Taking
// the strongest means pasting an England Football link into the Source field
// locks the level immediately, before the save that would make the database
// refuse it, and clearing that field in the draft does not unlock a row whose
// saved source is still England Football.
export function deriveProvenanceAll(fields: readonly SourceFields[]): SourceProvenance {
  let out: SourceProvenance = 'none'
  for (const f of fields) {
    const p = deriveProvenance(f)
    if (p === 'fa') return 'fa'
    if (p === 'third_party') out = 'third_party'
  }
  return out
}

// The three levels in the club's words. The enum names never reach a screen.
export interface RightsOption {
  value: ContentRights
  label: string
  description: string
}

export const RIGHTS_OPTIONS: readonly RightsOption[] = [
  {
    value: 'internal_only',
    label: 'Club only',
    description:
      'Only signed in club members can see it. It can never be part of a public link.',
  },
  {
    value: 'public_link_only',
    label: 'Public text only',
    description:
      'The words can go in a public link. Photos, diagrams, clips and PDFs stay inside the club.',
  },
  {
    value: 'public_full',
    label: 'Public, including files',
    description:
      'The words and the files can go in a public link. Only choose this for the club’s own work, or work the club is cleared to publish.',
  },
]

export function rightsLabel(rights: ContentRights): string {
  return RIGHTS_OPTIONS.find((o) => o.value === rights)?.label ?? 'Club only'
}

// The one line status shown beside content, and inside the share flow.
export function rightsStatusLine(rights: ContentRights, noun: string): string {
  if (rights === 'internal_only') return `This ${noun} is set to club only.`
  if (rights === 'public_link_only') return `This ${noun} can be shared publicly as text.`
  return `This ${noun} can be shared publicly, including its files.`
}

// England Football derived content is locked at club only. The database refuses
// to raise it, so the control is rendered locked with the reason rather than
// offered and then refused.
export const FA_LOCK_NOTE =
  'This came from England Football Learning. The club may use it for coaching, so it stays inside the club and cannot be part of a public link.'

// A source was recorded that is not England Football. The club may still hold
// the right to publish it, so the choice stays available behind an explicit
// confirmation rather than being taken away.
export const THIRD_PARTY_CONFIRM =
  'This came from another source. Confirm the club may publish it before you change this.'

// Media is where third-party rights concentrate, so promoting a file always
// asks for the same confirmation, whatever its recorded source says.
export const MEDIA_CONFIRM =
  'Confirm this file is the club’s own work, or that the club is cleared to publish it.'

export interface RightsControlState {
  // The level currently stored.
  current: ContentRights
  // Whether any choice may be made at all.
  editable: boolean
  // Locked at club only by proven England Football provenance.
  locked: boolean
  // The explanation shown under the control, or null when there is nothing to
  // explain.
  note: string | null
  // A confirmation the user must tick before a public level is saved, or null
  // when none is required.
  confirm: string | null
  // The levels that may be selected.
  options: readonly RightsOption[]
}

// What the rights control should render for one row. canEdit is the caller's
// existing ownership decision (the same rule that shows Edit), never a new one.
export function rightsControlState({
  current,
  provenance,
  canEdit,
  isMedia = false,
}: {
  current: ContentRights
  provenance: SourceProvenance
  canEdit: boolean
  isMedia?: boolean
}): RightsControlState {
  const locked = provenance === 'fa'
  if (locked) {
    return {
      // The row's REAL stored level, not an assumed club only. The database
      // holds England Football content at club only, but the two readings can
      // still disagree for a moment (a source pasted into a draft, a row
      // classified before the lock existed), and telling someone their
      // publishable row is club only would be a false statement about their
      // own content with no control offered to correct it.
      current,
      editable: false,
      locked: true,
      note: FA_LOCK_NOTE,
      confirm: null,
      options: RIGHTS_OPTIONS.filter((o) => o.value === 'internal_only'),
    }
  }
  const confirm = isMedia ? MEDIA_CONFIRM : provenance === 'third_party' ? THIRD_PARTY_CONFIRM : null
  return {
    current,
    editable: canEdit,
    locked: false,
    note: canEdit ? null : 'Only the person who created this, or a manager, can change its sharing level.',
    confirm,
    options: RIGHTS_OPTIONS,
  }
}

// Whether a pending selection may be saved. A confirmation is only required
// when the selection actually publishes something; going back to club only
// never needs one.
export function canSaveRights({
  selected,
  current,
  state,
  confirmed,
}: {
  selected: ContentRights
  current: ContentRights
  state: RightsControlState
  confirmed: boolean
}): boolean {
  if (!state.editable || state.locked) return false
  if (selected === current) return false
  if (selected !== 'internal_only' && state.confirm && !confirmed) return false
  return true
}

// The tables that carry a rights column, as an explicit closed map. There is no
// dynamic table name anywhere in the write path.
export type RightsKind = 'drill' | 'session' | 'programme' | 'template' | 'media'

export const RIGHTS_NOUN: Record<RightsKind, string> = {
  drill: 'drill',
  session: 'session',
  programme: 'programme',
  template: 'week',
  media: 'file',
}

// The database raises this class when the England Football lock refuses a
// promotion. Turned into the same sentence the locked control shows, so the two
// routes agree.
export const RIGHTS_REFUSED_MESSAGE = FA_LOCK_NOTE
