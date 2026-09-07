// The club's age group vocabulary: one list, two consumers.
//
// clubs.age_groups (0053) is the canonical list an admin arranges on the
// Club screen. The session's age group control and the venue layout admin
// both read it, replacing the two hardcoded literals that used to disagree
// with each other ('U6s'…'U12s' on the planner, 'U6'…'U12' in AGES for
// drills). A venue layout is filed under one of these labels, so a scope key
// is only as good as this list.
//
// UNTIL A CLUB CONFIGURES ONE, the list is empty and the session control
// offers DEFAULT_AGE_GROUPS, which is exactly what it offered before the
// column existed. That is what "no behaviour change on apply" means for the
// two clubs in production, both of which start with '{}'. The layout admin
// does NOT fall back: a layout filed under a default label the club never
// chose would be a scope key nobody configured, so that screen says the list
// is empty and points at the Club screen instead.
//
// A session keeps whatever label it carries. sessions.age_group is free text
// and nothing here rewrites it; a legacy label is still offered as the
// session's own current value so a save cannot silently move it, and it
// simply resolves no layout until an admin adds the label to the club list.
//
// The bounds mirror age_group_list_is_valid in 0053 exactly: trimmed, non
// blank, at most 20 characters each, no duplicates, at most 30 entries. The
// database is the authority; these exist so the screen can say which rule a
// label breaks before the row refuses it.

export const AGE_GROUP_MAX_LENGTH = 20
export const MAX_AGE_GROUPS = 30

// The planner's previous literal, kept as the fallback while a club has
// configured nothing. It is offered on the session control only.
export const DEFAULT_AGE_GROUPS: readonly string[] = ['U6s', 'U7s', 'U8s', 'U9s', 'U10s', 'U11s', 'U12s']

// The whitespace the database names explicitly, because btrim with no second
// argument strips the space alone.
const WHITESPACE = /^[ \t\r\n]+|[ \t\r\n]+$/g

export function trimAgeGroup(label: string): string {
  return label.replace(WHITESPACE, '')
}

// Why a label cannot join the list, as a sentence, or null when it can.
// `existing` is the list it would join.
export function ageGroupProblem(label: string, existing: readonly string[]): string | null {
  const trimmed = trimAgeGroup(label)
  if (trimmed === '') return 'Type an age group first.'
  if (trimmed.length > AGE_GROUP_MAX_LENGTH) return `An age group is at most ${AGE_GROUP_MAX_LENGTH} characters.`
  if (existing.includes(trimmed)) return `${trimmed} is already on the list.`
  if (existing.length >= MAX_AGE_GROUPS) return `The list holds at most ${MAX_AGE_GROUPS} age groups.`
  return null
}

// The list as the database will store it: trimmed, blanks dropped, first
// occurrence of a duplicate kept, order kept, and nothing over the bounds.
// Pure and idempotent, so the stored value round trips through it unchanged.
export function normaliseAgeGroups(labels: readonly string[]): string[] {
  const out: string[] = []
  for (const raw of labels) {
    const label = trimAgeGroup(raw)
    if (label === '' || label.length > AGE_GROUP_MAX_LENGTH || out.includes(label)) continue
    if (out.length >= MAX_AGE_GROUPS) break
    out.push(label)
  }
  return out
}

// What the session's age group control offers: the club's list when it has
// one, the previous defaults when it has not, and always the session's own
// current label, so that opening an old session and pressing Save cannot
// move it onto a label nobody chose. The current label goes last when it is
// not on the list, which is where a reader looks for the odd one out.
export function ageGroupOptions(clubList: readonly string[] | null | undefined, current: string): string[] {
  const base = clubList && clubList.length > 0 ? [...clubList] : [...DEFAULT_AGE_GROUPS]
  const own = trimAgeGroup(current)
  if (own !== '' && !base.includes(own)) base.push(own)
  return base
}

// Whether the club has configured its list at all. Presentation reads this
// to say so rather than showing the defaults as though the club chose them.
export function ageGroupsConfigured(clubList: readonly string[] | null | undefined): boolean {
  return !!clubList && clubList.length > 0
}
