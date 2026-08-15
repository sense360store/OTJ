// The bib colour vocabulary, in one place.
//
// A team carries a default bib colour; a register entry may override it
// for one player on one session, including the deliberate choice of no
// bib at all. Nothing about stock or inventory is modelled: this is a
// colour, so a coach can say "Titans in red, Spartans in blue" and the
// pitch side register can show who is wearing what.
//
// public.is_bib_colour in 0044_training_day_core.sql is the authority
// for which values may be stored; the list below mirrors it and adds the
// label and swatch the UI needs. A security test asserts the database
// refuses a colour outside this list.

export interface BibColour {
  value: string
  label: string
  swatch: string
}

export const BIB_COLOURS: BibColour[] = [
  { value: 'red', label: 'Red', swatch: '#e23b3b' },
  { value: 'blue', label: 'Blue', swatch: '#1f43d6' },
  { value: 'green', label: 'Green', swatch: '#16a34a' },
  { value: 'yellow', label: 'Yellow', swatch: '#f4c020' },
  { value: 'orange', label: 'Orange', swatch: '#ef8e1b' },
  { value: 'purple', label: 'Purple', swatch: '#7c4dff' },
  { value: 'pink', label: 'Pink', swatch: '#ec4899' },
  { value: 'white', label: 'White', swatch: '#f4f4f5' },
  { value: 'black', label: 'Black', swatch: '#18181b' },
]

// The stored sentinel meaning "no bib today", which is a real choice and
// not the same as "use the team default". An empty select value means
// the default; this value means none.
export const BIB_NONE = 'none'

export function bibSwatch(value: string | null | undefined): string | null {
  if (!value || value === BIB_NONE) return null
  return BIB_COLOURS.find((b) => b.value === value)?.swatch ?? null
}

export function bibLabel(value: string | null | undefined): string | null {
  if (!value) return null
  if (value === BIB_NONE) return 'No bib'
  return BIB_COLOURS.find((b) => b.value === value)?.label ?? null
}

// The label on the inherit option: the colour the row resolves to today,
// so a coach on the pitch never has to remember what the team default is.
// "Team bib" asked exactly that of them, in the rain.
//
// DISPLAY ONLY. The option this labels keeps the empty select value, so
// choosing or rendering it stores nothing and the row keeps following the
// team: the admin later moving the default from blue to red moves every
// untouched row with it. A team with no default gets an honest "No team
// colour" rather than a colour that does not exist.
export function bibInheritLabel(teamDefault: string | null | undefined): string {
  const label = bibLabel(teamDefault ?? null)
  return label ? `${label} (team)` : 'No team colour'
}

// What a player actually wears: their own override if they have one, the
// team default otherwise, and nothing when the override says none. The
// register renders from this, so the rule lives once.
export function effectiveBib(
  override: string | null | undefined,
  teamDefault: string | null | undefined,
): string | null {
  if (override === BIB_NONE) return null
  if (override) return override
  return teamDefault ?? null
}
