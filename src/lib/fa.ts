// The FA's England Football Learning session taxonomy, confirmed from the
// live site (learn.englandfootball.com/sessions). These are suggestions for
// the UI, not enums: theme, format and skill are stored as plain text so free
// text stays possible and existing values keep working.

import type { MediaItem } from './data'

export const FA_THEMES: string[] = ['Attacking', 'Coaching', 'Defending', 'Goalkeeping', 'Futsal']

export const FA_PLAYER_SKILLS: string[] = [
  'Communication',
  'Covering',
  'Finishing',
  'Intercepting',
  'Marking',
  'Moving with the ball',
  'Organisation',
  'Passing',
  'Pressing',
  'Receiving',
  'Tackling',
  'Turning',
]

export const FA_COACH_SKILLS: string[] = [
  'Creating the environment',
  'Session design',
  'Game principles',
  'Skills and tactics',
]

export const FA_FORMATS: string[] = ['1-4 per side', '5-8 per side', '9-11 per side']

export const FA_AGE_BANDS: string[] = ['4-6 (Play phase)', '5-11', '12-16', '17-21', '21+']

// The attribution label for England Football Learning content. Imported FA
// images are stored unmodified and carry this label wherever they render
// large (see CLAUDE.md, Third-party content).
export const FA_SOURCE_LABEL = 'England Football Learning'

const FA_HOSTS = ['learn.englandfootball.com', 'cdn.englandfootball.com']

// True when a URL points at England Football Learning or its CDN.
export function isFaUrl(url: string | null | undefined): boolean {
  if (!url) return false
  try {
    return FA_HOSTS.includes(new URL(url).hostname.toLowerCase())
  } catch {
    return false
  }
}

// An FA video: kind video, streamed from an embed URL, with its source page
// on England Football Learning. The FA domain locks its Vimeo player, so the
// embed refuses to play on our domain ("Because of its privacy settings,
// this video cannot be played here"). That lock is the FA's access control
// and is not ours to bypass: wherever one of these would play inline, the UI
// presents a link out to the source page instead, where the video plays on
// the FA's own site.
export function isFaVideo(m: Pick<MediaItem, 'type' | 'embedUrl' | 'sourceUrl'>): boolean {
  return m.type === 'video' && !!m.embedUrl && isFaUrl(m.sourceUrl)
}

// The display label for a source link: "England Football Learning" for FA
// pages, the bare domain for anything else, empty for an unparsable URL.
export function sourceLabelForUrl(url: string | null | undefined): string {
  if (!url) return ''
  if (isFaUrl(url)) return FA_SOURCE_LABEL
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}

// Merge a fixed option list with values already in use, so a select can offer
// the FA taxonomy while every existing stored value still appears.
export function withExistingValues(options: string[], existing: (string | null | undefined)[]): string[] {
  const extras = [...new Set(existing.filter((v): v is string => !!v && !options.includes(v)))].sort()
  return [...options, ...extras]
}
