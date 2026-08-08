// OTJ Training Hub, public share blocker copy (pure).
//
// The server returns a closed vocabulary of reason codes plus a bounded
// provenance summary; this turns that into one truthful sentence and, where the
// user has authority, the next thing to do about it.
//
// Two rules drive everything here.
//
// Truthfulness. A reason code says WHICH LAYER blocked the share. It does not
// say where that layer's content came from. The old copy mapped every
// *_internal_only code to "This uses England Football or other restricted
// content", so a coach's own six week programme, written from scratch with no
// source recorded, was told it was England Football content. England Football
// is now named only when the server's provenance summary proves it, and that
// summary is derived from recorded source URLs, never from the rights value.
//
// Usefulness. When more than one thing blocks a share, the one worth showing is
// the most structural: a programme with no weeks has nothing to share whatever
// its rights say, so no_weeks wins over every rights reason. The order runs
// structure, then caps, then the source's own level, then nested levels.
//
// Nothing here names a week, drill or file. A coach may see that one or more
// drills in a programme are club only; they never learn which, because the
// blocked screen must not tell them more about another coach's content than the
// rest of the app does.

import type { SourceProvenance } from './contentRights'

export type ShareKindNoun = 'drill' | 'session' | 'programme'

// The bounded provenance summary the preview carries. source is the source
// row's own provenance. restricted[layer] is true when at least one blocking
// row at that layer is England Football derived; it names no row.
export interface SharePreviewProvenance {
  source: SourceProvenance
  restricted: {
    template: boolean
    drill: boolean
    media: boolean
    pdf: boolean
  }
}

export const EMPTY_PROVENANCE: SharePreviewProvenance = {
  source: 'none',
  restricted: { template: false, drill: false, media: false, pdf: false },
}

// Normalise whatever the server sent. An older function version returns no
// provenance at all, and the honest fallback is "no proof of provenance", which
// keeps England Football out of the copy rather than guessing it in.
export function readProvenance(value: unknown): SharePreviewProvenance {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return EMPTY_PROVENANCE
  const v = value as Record<string, unknown>
  const source: SourceProvenance =
    v.source === 'fa' || v.source === 'third_party' ? v.source : 'none'
  const r = (v.restricted && typeof v.restricted === 'object' && !Array.isArray(v.restricted)
    ? v.restricted
    : {}) as Record<string, unknown>
  return {
    source,
    restricted: {
      template: r.template === true,
      drill: r.drill === true,
      media: r.media === true,
      pdf: r.pdf === true,
    },
  }
}

// What the user can do next about the blocker, given their authority. The view
// decides whether to offer it; this only says which one applies.
//   classify  change this item's own sharing level, here in the share flow
//   content   change something inside the item, on the item's own screen
//   none      nothing the user can act on from here
export type BlockerAction = 'classify' | 'content' | 'none'

export interface ShareBlockerView {
  // The winning reason code. Not shown to the user; asserted in tests and used
  // by the view to decide which action to offer.
  code: string
  headline: string
  action: BlockerAction
}

// The order reasons are considered, per kind. Structure first, then caps, then
// the source's own rights, then nested rights.
const ORDER: Record<ShareKindNoun, readonly string[]> = {
  drill: [
    'media_missing',
    'media_path_invalid',
    'source_internal_only',
    'media_internal_only',
  ],
  session: [
    'unsupported_item',
    'drill_missing',
    'media_missing',
    'board_missing',
    'media_path_invalid',
    'source_internal_only',
    'drill_internal_only',
    'media_internal_only',
  ],
  programme: [
    'no_weeks',
    'unsupported_item',
    'drill_missing',
    'media_missing',
    'pdf_missing',
    'media_path_invalid',
    'too_many_weeks',
    'too_many_media',
    'snapshot_too_large',
    'source_internal_only',
    'template_internal_only',
    'drill_internal_only',
    'media_internal_only',
    'pdf_internal_only',
  ],
}

const FALLBACK: Record<ShareKindNoun, string> = {
  drill: 'This drill cannot be shared publicly.',
  session: 'This session cannot be shared publicly.',
  programme: 'This programme cannot be shared publicly.',
}

// The one sentence used wherever proven England Football provenance blocks a
// share, whichever layer it sits in.
export const FA_RESTRICTED_NOTE =
  'This uses England Football or other restricted content, which we can only share inside the club.'

function sourceRightsHeadline(noun: ShareKindNoun, provenance: SourceProvenance): string {
  if (provenance === 'fa') return FA_RESTRICTED_NOTE
  if (provenance === 'third_party') {
    return `This ${noun} records another source, so it is set to club only. Change its sharing level only if the club may publish it.`
  }
  return `This ${noun} is currently set to club only. Change its sharing level before creating a public link.`
}

function nestedHeadline(layer: 'template' | 'drill' | 'media' | 'pdf', noun: ShareKindNoun, restricted: boolean): string {
  if (restricted) return FA_RESTRICTED_NOTE
  if (layer === 'template') return 'One or more weeks in this programme are set to club only.'
  if (layer === 'drill') return `One or more drills in this ${noun} are set to club only.`
  if (layer === 'pdf') return 'The PDF attached to this programme is set to club only.'
  return `One or more files this ${noun} uses are set to club only.`
}

// Turn the server's reasons into the single most useful sentence, plus the
// action that follows from it.
export function shareBlockerView(
  noun: ShareKindNoun,
  reasons: readonly string[],
  provenance: SharePreviewProvenance = EMPTY_PROVENANCE,
): ShareBlockerView {
  const present = new Set(reasons)
  const code = ORDER[noun].find((r) => present.has(r))
  if (!code) return { code: reasons[0] ?? 'unknown', headline: FALLBACK[noun], action: 'none' }

  switch (code) {
    case 'no_weeks':
      return {
        code,
        headline: 'This programme has no weeks yet, so there is nothing to share.',
        action: 'content',
      }
    case 'unsupported_item':
      return {
        code,
        headline: `This ${noun} has an activity we cannot share publicly yet.`,
        action: 'content',
      }
    case 'drill_missing':
      return {
        code,
        headline: `A drill this ${noun} uses is missing, so it cannot be shared publicly.`,
        action: 'content',
      }
    case 'media_missing':
      return {
        code,
        headline: `A file this ${noun} uses is missing, so it cannot be shared publicly.`,
        action: 'content',
      }
    case 'pdf_missing':
      return {
        code,
        headline: 'The PDF attached to this programme is missing, so it cannot be shared publicly.',
        action: 'content',
      }
    case 'board_missing':
      return {
        code,
        headline: 'The tactics board attached to this session is missing, so it cannot be shared publicly.',
        action: 'content',
      }
    case 'media_path_invalid':
      return {
        code,
        headline: `A file this ${noun} uses is stored in a way we cannot share. Upload it again, then try once more.`,
        action: 'content',
      }
    case 'too_many_weeks':
      return { code, headline: 'This programme has more weeks than we can share in one link.', action: 'none' }
    case 'too_many_media':
      return { code, headline: 'This programme uses more files than we can share in one link.', action: 'none' }
    case 'snapshot_too_large':
      return { code, headline: 'This programme is too large to share in one link.', action: 'none' }
    case 'source_internal_only':
      return {
        code,
        headline: sourceRightsHeadline(noun, provenance.source),
        action: provenance.source === 'fa' ? 'none' : 'classify',
      }
    case 'template_internal_only':
      return {
        code,
        headline: nestedHeadline('template', noun, provenance.restricted.template),
        action: provenance.restricted.template ? 'none' : 'content',
      }
    case 'drill_internal_only':
      return {
        code,
        headline: nestedHeadline('drill', noun, provenance.restricted.drill),
        action: provenance.restricted.drill ? 'none' : 'content',
      }
    case 'media_internal_only':
      return {
        code,
        headline: nestedHeadline('media', noun, provenance.restricted.media),
        action: provenance.restricted.media ? 'none' : 'content',
      }
    case 'pdf_internal_only':
      return {
        code,
        headline: nestedHeadline('pdf', noun, provenance.restricted.pdf),
        action: provenance.restricted.pdf ? 'none' : 'content',
      }
    default:
      return { code, headline: FALLBACK[noun], action: 'none' }
  }
}

// Where the "change something inside it" action should send the user. Only used
// when shareBlockerView returns 'content'.
export function blockerContentHint(noun: ShareKindNoun, code: string): string {
  if (code === 'no_weeks') return 'Add a week template to this programme, then come back.'
  if (code === 'template_internal_only') return 'Open each week and change its sharing level.'
  if (code === 'drill_internal_only') return 'Open each drill and change its sharing level.'
  if (code === 'media_internal_only') return 'Open the media library and change the file’s sharing level.'
  if (code === 'pdf_internal_only') return 'Open the media library and change the PDF’s sharing level.'
  if (code === 'unsupported_item') return `Replace the activity we cannot share, then come back.`
  return `Fix what is missing from this ${noun}, then come back.`
}
