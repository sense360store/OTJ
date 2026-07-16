// Ordering for the club content lists (drills, media, templates, programmes).
// The default is newest first: the Library's Recent sort and the Media,
// Templates and Programmes screens all show the latest additions at the top.
// The comparators never trust the order rows arrived in from the backend;
// they compare created_at themselves and break ties deterministically, so the
// result is the same whatever order the read returned.

interface Created {
  id: string
  createdAt?: string
}

// An unparseable or missing created_at sinks to the old end of the list
// rather than throwing; the later tie-breaks keep such rows in a stable
// order.
function createdMs(item: Created): number {
  const ms = Date.parse(item.createdAt ?? '')
  return Number.isNaN(ms) ? -Infinity : ms
}

// Date.parse truncates the database's microsecond timestamps to milliseconds,
// so rows written in one burst (an FA import's parts) can tie on the parsed
// value. Equal parses fall to the raw strings, which for the uniform ISO
// timestamps a table returns sort chronologically at full precision. id is
// the last resort, so the order is total even for unparseable values.
function byCreatedAt(a: Created, b: Created): number {
  const as = a.createdAt ?? ''
  const bs = b.createdAt ?? ''
  return as < bs ? -1 : as > bs ? 1 : 0
}

function byId(a: Created, b: Created): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

export function compareNewestFirst(a: Created, b: Created): number {
  return createdMs(b) - createdMs(a) || byCreatedAt(b, a) || byId(a, b)
}

function compareOldestFirst(a: Created, b: Created): number {
  return createdMs(a) - createdMs(b) || byCreatedAt(a, b) || byId(a, b)
}

export function newestFirst<T extends Created>(items: readonly T[]): T[] {
  return [...items].sort(compareNewestFirst)
}

// Creation order, for the callers that depend on it: the FA video attach
// fallback matches files to a session's parts by position, and a programme
// week keeps its earliest template when duplicates exist.
export function oldestFirst<T extends Created>(items: readonly T[]): T[] {
  return [...items].sort(compareOldestFirst)
}

// The Library's three sorts. Recent orders by creation, newest first. A to Z
// and Shortest keep their primary keys and break ties in creation order,
// oldest first: the stable sort over a creation ordered copy reproduces the
// tie order the screen had when the reads returned ascending, and keeps it
// steady as new drills arrive.
export type LibrarySort = 'recent' | 'az' | 'duration'

export function sortLibraryDrills<T extends Created & { title: string; duration: number }>(
  drills: readonly T[],
  sort: LibrarySort,
): T[] {
  if (sort === 'duration') return oldestFirst(drills).sort((a, b) => a.duration - b.duration)
  if (sort === 'az') return oldestFirst(drills).sort((a, b) => a.title.localeCompare(b.title))
  return newestFirst(drills)
}

// The related drills for a drill page. Relatedness needs a real shared value:
// a missing corner or skill is not a match key (two unclassified drills have
// nothing in common), and FA drills relate through overlapping topic tags
// instead. Matches surface in creation order, the behaviour the page has
// always had, so the list reads flipping to newest first does not change
// which three appear.
export function relatedDrills<T extends Created & { corner: string | null; skill: string; tags: string[] }>(
  drill: T,
  all: readonly T[],
): T[] {
  return oldestFirst(
    all.filter(
      (d) =>
        d.id !== drill.id &&
        ((!!drill.corner && d.corner === drill.corner) ||
          (!!drill.skill && d.skill === drill.skill) ||
          d.tags.some((t) => drill.tags.includes(t))),
    ),
  ).slice(0, 3)
}
