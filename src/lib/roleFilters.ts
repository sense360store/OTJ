// Role filter tags in effect: a role can carry kind plus value tags, and a
// tagged member's Drill Library, Templates, Media and Sessions views lock to
// matching content, shown as fixed chips they cannot remove.
//
// This is enforced curation at the application layer; the club boundary in
// RLS remains the only hard security boundary. Direct URLs (a drill detail,
// a live session) stay reachable by design.
//
// Matching model, kept deliberately small:
//   * Drills are the anchor. A drill matches a tag through its own fields:
//     theme tags against drill.theme, player_skill against drill.skill,
//     format against drill.format, age_band against drill.ages. Tags of the
//     same kind widen (any may match); different kinds all have to match.
//     coach_skill has no drill field and never narrows drills.
//   * Media has no taxonomy fields; an item is in scope when an in scope
//     drill uses it.
//   * Templates are in scope when they reference at least one in scope drill.
//   * Sessions match age_band tags against their own age group; any other
//     tagged kind asks the session to reference an in scope drill.
//   * Age values are written many ways (U8, U8s, 5-11, 21+), so age matching
//     parses both sides to a year range and checks overlap, falling back to
//     case insensitive equality for anything unparsable.
import { useMemo } from 'react'
import type { Drill, FilterKind, MediaItem, RoleFilterTag, Session, Template } from './data'
import { useDrills, useMyAccess } from './queries'

// "U8" or "U8s" is the single year 8, "5-11" a range, "21+" open ended,
// "4-6 (Play phase)" takes its leading range. Null means unparsable.
function ageRange(value: string): [number, number] | null {
  const v = value.trim().toLowerCase()
  let m = v.match(/^u\s?(\d{1,2})s?$/)
  if (m) return [Number(m[1]), Number(m[1])]
  m = v.match(/^(\d{1,2})\s*[-–]\s*(\d{1,2})/)
  if (m) return [Number(m[1]), Number(m[2])]
  m = v.match(/^(\d{1,2})\s*\+$/)
  if (m) return [Number(m[1]), 99]
  return null
}

export function agesOverlap(a: string, b: string): boolean {
  const ra = ageRange(a)
  const rb = ageRange(b)
  if (ra && rb) return ra[0] <= rb[1] && rb[0] <= ra[1]
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

// The drill field each kind matches, null when the kind has none.
function drillKindMatches(d: Drill, kind: FilterKind, values: string[]): boolean {
  switch (kind) {
    case 'theme':
      return values.some((v) => same(v, d.theme))
    case 'player_skill':
      return values.some((v) => same(v, d.skill))
    case 'format':
      return values.some((v) => same(v, d.format))
    case 'age_band':
      return values.some((v) => d.ages.some((a) => agesOverlap(v, a)))
    case 'coach_skill':
      return true
  }
}

function groupTags(tags: RoleFilterTag[]): Map<FilterKind, string[]> {
  const out = new Map<FilterKind, string[]>()
  for (const t of tags) out.set(t.kind, [...(out.get(t.kind) ?? []), t.value])
  return out
}

export function drillMatchesTags(d: Drill, tags: RoleFilterTag[]): boolean {
  for (const [kind, values] of groupTags(tags)) {
    if (!drillKindMatches(d, kind, values)) return false
  }
  return true
}

export interface RoleScope {
  // True when the member's role carries tags and the views must lock.
  locked: boolean
  // False while the drill read the scope leans on is still loading; the
  // four views treat that as part of their own loading state.
  ready: boolean
  tags: RoleFilterTag[]
  drills: (list: Drill[]) => Drill[]
  media: (list: MediaItem[]) => MediaItem[]
  templates: (list: Template[]) => Template[]
  sessions: (list: Session[]) => Session[]
}

const PASS_THROUGH: Pick<RoleScope, 'drills' | 'media' | 'templates' | 'sessions'> = {
  drills: (list) => list,
  media: (list) => list,
  templates: (list) => list,
  sessions: (list) => list,
}

export function useRoleScope(): RoleScope {
  const { data: access } = useMyAccess()
  const tags = useMemo(() => access?.tags ?? [], [access])
  // The anchor read shares the cached drills list every screen already
  // loads; untagged members never compute a scope from it.
  const { data: allDrills, isPending } = useDrills()

  return useMemo(() => {
    if (tags.length === 0) {
      return { locked: false, ready: true, tags, ...PASS_THROUGH }
    }
    const drills = allDrills ?? []
    const inScope = drills.filter((d) => drillMatchesTags(d, tags))
    const drillIds = new Set(inScope.map((d) => d.id))
    const mediaIds = new Set(inScope.map((d) => d.mediaId).filter((id): id is string => !!id))
    const grouped = groupTags(tags)
    const ageBands = grouped.get('age_band') ?? []
    const nonAgeKinds = [...grouped.keys()].filter((k) => k !== 'age_band')
    return {
      locked: true,
      ready: !isPending,
      tags,
      drills: (list) => list.filter((d) => drillIds.has(d.id)),
      media: (list) => list.filter((m) => mediaIds.has(m.id)),
      templates: (list) => list.filter((t) => t.activities.some((a) => a.drillId && drillIds.has(a.drillId))),
      sessions: (list) =>
        list.filter(
          (s) =>
            (ageBands.length === 0 || ageBands.some((b) => agesOverlap(b, s.ageGroup))) &&
            (nonAgeKinds.length === 0 || s.activities.some((a) => a.drillId && drillIds.has(a.drillId))),
        ),
    }
  }, [tags, allDrills, isPending])
}
