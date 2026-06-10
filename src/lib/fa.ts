// The FA's England Football Learning session taxonomy, confirmed from the
// live site (learn.englandfootball.com/sessions). These are suggestions for
// the UI, not enums: theme, format and skill are stored as plain text so free
// text stays possible and existing values keep working.

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

// The display label for a source link: "England Football Learning" for FA
// pages, the bare domain for anything else, empty for an unparsable URL.
export function sourceLabelForUrl(url: string | null | undefined): string {
  if (!url) return ''
  try {
    const host = new URL(url).hostname.toLowerCase()
    if (FA_HOSTS.includes(host)) return FA_SOURCE_LABEL
    return host.replace(/^www\./, '')
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
