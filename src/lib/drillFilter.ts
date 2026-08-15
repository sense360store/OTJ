// The one drill filter, shared by the Library and the planner's Add from
// library modal. Both screens browse the same club library, so they filter
// it with the same rules; these lived inline in Library.tsx until the modal
// needed them too, and moved here unchanged rather than growing a second
// copy. drillFilter.invariant.test.ts fails the build if a screen starts
// answering for itself.
//
// The semantics, exactly as the Library has always applied them:
//
//  - skill, format and level are exact matches;
//  - theme matches the legacy single theme or any topic tag, so a drill
//    tagged Defending, Marking, Intercepting appears under any one of them
//    and older themed drills keep matching;
//  - age matches when the drill's ages list includes the pick;
//  - text search runs over title, summary, skill and tags, lowercased and
//    space-joined, so a query never matches across a field boundary;
//  - every active refinement must hold at once;
//  - the corner is applied last, after the other refinements, which yields
//    both the visible results and a corner distribution that stays
//    filter-aware while remaining a way to PICK a corner;
//  - every sort is explicit, Recent included: newest first by created_at
//    with an id tie-break, never the order the read happened to return.

import { AGES, LEVELS } from './data'
import type { CornerKey } from './data'
import { sortLibraryDrills } from './contentOrder'
import type { LibrarySort } from './contentOrder'
import { FA_FORMATS, FA_PLAYER_SKILLS, FA_THEMES, withExistingValues } from './fa'

// The filterable surface of a drill: what the rules below read. Drill
// satisfies it; the type is narrower so the pure tests need no full rows.
export interface FilterableDrill {
  id: string
  title: string
  corner: CornerKey | null
  skill: string
  theme: string
  format: string
  ages: string[]
  level: string
  duration: number
  summary: string
  tags: string[]
  createdAt?: string
}

// One value per control the screens offer. The empty string (and null for
// corner) means "not narrowing". q and sort ride along so a screen holds
// one state object, but neither is a refinement: see countRefinements.
export interface DrillFilter {
  q: string
  corner: CornerKey | null
  skill: string
  theme: string
  format: string
  age: string
  level: string
  sort: LibrarySort
}

export const DEFAULT_DRILL_FILTER: DrillFilter = {
  q: '',
  corner: null,
  skill: '',
  theme: '',
  format: '',
  age: '',
  level: '',
  sort: 'recent',
}

// Every refinement except the corner, which applyDrillFilter holds back so
// the corner distribution can stay filter-aware.
function matchesRefinements(d: FilterableDrill, f: DrillFilter): boolean {
  if (f.skill && d.skill !== f.skill) return false
  if (f.theme && d.theme !== f.theme && !d.tags.includes(f.theme)) return false
  if (f.format && d.format !== f.format) return false
  if (f.age && !d.ages.includes(f.age)) return false
  if (f.level && d.level !== f.level) return false
  if (f.q) {
    const hay = (d.title + ' ' + d.summary + ' ' + d.skill + ' ' + d.tags.join(' ')).toLowerCase()
    if (!hay.includes(f.q.toLowerCase())) return false
  }
  return true
}

export interface DrillFilterResult<T> {
  results: T[]
  // Only classified drills count towards the distribution; a drill with no
  // corner sits outside it rather than inflating Technical.
  cornerCounts: Record<CornerKey, number>
}

export function applyDrillFilter<T extends FilterableDrill>(
  drills: readonly T[],
  f: DrillFilter,
): DrillFilterResult<T> {
  const refined = drills.filter((d) => matchesRefinements(d, f))
  const cornerCounts: Record<CornerKey, number> = { technical: 0, physical: 0, social: 0, psychological: 0 }
  refined.forEach((d) => {
    if (d.corner) cornerCounts[d.corner]++
  })
  const results = sortLibraryDrills(f.corner ? refined.filter((d) => d.corner === f.corner) : refined, f.sort)
  return { results, cornerCounts }
}

// How many refinements are narrowing the list: the six pickable filters,
// never the search text (its box shows its own state) and never the sort
// (an order is not a narrowing). This is the count on the Clear affordance.
export function countRefinements(f: DrillFilter): number {
  return [f.corner, f.skill, f.theme, f.format, f.age, f.level].filter(Boolean).length
}

// What Clear does: reset the six refinements, keep the typed search and the
// chosen sort. Shaped as state -> state so it drops straight into a React
// state setter.
export function clearedRefinements(f: DrillFilter): DrillFilter {
  return { ...f, corner: null, skill: '', theme: '', format: '', age: '', level: '' }
}

export interface DrillFilterOptions {
  skills: string[]
  themes: string[]
  formats: string[]
  ages: string[]
  levels: string[]
}

// The select options: the FA taxonomy plus any values already stored on
// drills, so existing free-text values keep appearing. The theme options
// also carry every topic tag in use, so a topic captured by the FA import
// (Marking, Intercepting) becomes selectable as soon as a drill carries it.
export function drillFilterOptions(drills: readonly FilterableDrill[]): DrillFilterOptions {
  return {
    skills: withExistingValues(FA_PLAYER_SKILLS, drills.map((d) => d.skill)),
    themes: withExistingValues(FA_THEMES, [...drills.map((d) => d.theme), ...drills.flatMap((d) => d.tags)]),
    formats: withExistingValues(FA_FORMATS, drills.map((d) => d.format)),
    ages: AGES,
    levels: LEVELS,
  }
}
