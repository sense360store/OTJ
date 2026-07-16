// Ordering for the club content lists (drills, media, templates, programmes).
// The default is newest first: the Library's Recent sort and the Media,
// Templates and Programmes screens all show the latest additions at the top.
// The comparators never trust the order rows arrived in from the backend;
// they compare created_at themselves and break ties (or unparseable
// timestamps) on id, so the result is deterministic whatever order the read
// returned.

interface Created {
  id: string
  createdAt?: string
}

// An unparseable or missing created_at sinks to the old end of the list
// rather than throwing; the id tie-break keeps such rows in a stable order.
function createdMs(item: Created): number {
  const ms = Date.parse(item.createdAt ?? '')
  return Number.isNaN(ms) ? -Infinity : ms
}

function byId(a: Created, b: Created): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

export function compareNewestFirst(a: Created, b: Created): number {
  return createdMs(b) - createdMs(a) || byId(a, b)
}

export function newestFirst<T extends Created>(items: readonly T[]): T[] {
  return [...items].sort(compareNewestFirst)
}

// Creation order, for the callers that depend on it: the FA video attach
// fallback matches files to a session's parts by row position, and a
// programme week keeps its earliest template when duplicates exist.
export function oldestFirst<T extends Created>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => createdMs(a) - createdMs(b) || byId(a, b))
}

// The Library's three sorts. Recent orders by creation, newest first;
// A to Z and Shortest are unchanged from the original inline sorts.
export type LibrarySort = 'recent' | 'az' | 'duration'

export function sortLibraryDrills<T extends Created & { title: string; duration: number }>(
  drills: readonly T[],
  sort: LibrarySort,
): T[] {
  if (sort === 'duration') return [...drills].sort((a, b) => a.duration - b.duration)
  if (sort === 'az') return [...drills].sort((a, b) => a.title.localeCompare(b.title))
  return newestFirst(drills)
}
