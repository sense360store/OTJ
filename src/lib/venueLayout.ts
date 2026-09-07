// Venue layouts (COACH-5): where four stations go, where five go, where one
// game goes and where two go, at one venue, for one season and one age
// group. The only place a stored layout is read, written or resolved.
//
// WHAT A LAYOUT IS. Reusable club configuration an admin draws once per
// scope, loaded automatically for every session in that scope. A station
// zone means "the area normally allocated to Station N", never this week's
// exact footprint; a game zone is where that game is played. A dated session
// stores no geometry: it resolves its layout from its venue, its age group,
// its active station count and the season its date falls in (see the scope
// rules at the bottom of this file).
//
// WHAT IT IS NOT. Not imagery: a clean schematic, no satellite tile, no
// traced photograph, no map reference, no address. Not weekly: coaches place
// nothing. Not a footprint. Not per team: a team is a filter and a default,
// never a unit of ground.
//
// THE SHAPE, AND THE DISCIPLINE IT INHERITS. This is the third fraction
// coordinate jsonb value in the product, after the board's tokens
// (src/lib/tacticsBoard.ts) and the drill diagram (src/lib/drillDiagram.ts),
// and it borrows their rules rather than inventing a third. Fractions 0 to 1
// for position, never metres or pixels, so one stored layout draws at any
// size. A version, where an unrecognised one yields no layout rather than a
// mis drawn one. A parser and a serialiser that REBUILD field by field from
// an allow list and never spread, so nothing this module does not name can
// survive a read or a write. Migration 0053_venue_layouts.sql states the
// same allow list as a check constraint, so the database refuses it too,
// from any client including service_role. The two share clampFraction and
// nothing else.
//
// DEFENSIVE ON READ, CANONICAL ON WRITE. A read treats the column as
// untrusted: unknown fields go, a corrupt zone drops on its own, an out of
// range number is clamped, and only an unknown VERSION discards the value
// whole. A layout can therefore come back with fewer zones than its slot
// count, which the editor completes with defaults and the renderer draws as
// it finds them; the database will not accept the short form back, and that
// is the right division: the client keeps the admin's work on screen and the
// constraint keeps the stored row whole.

import { clampFraction } from './tacticsBoard'
import type { Season } from './data'

export const VENUE_LAYOUT_VERSION = 1

// ---- Vocabulary ---------------------------------------------------------

export type LayoutKind = 'stations' | 'games'

export interface LayoutShape {
  kind: LayoutKind
  slots: number
}

// The closed v1 set: 4 or 5 stations, 1 or 2 games. Three stations is not
// offered and is not storable (venue_layouts_slots_valid), which is why a
// session with three active stations lands on its own no-layout state
// rather than on an admin link.
export const LAYOUT_SHAPES: readonly LayoutShape[] = [
  { kind: 'stations', slots: 4 },
  { kind: 'stations', slots: 5 },
  { kind: 'games', slots: 1 },
  { kind: 'games', slots: 2 },
]

export function isLayoutShape(kind: LayoutKind, slots: number): boolean {
  return LAYOUT_SHAPES.some((s) => s.kind === kind && s.slots === slots)
}

export function layoutShapeLabel(shape: LayoutShape): string {
  if (shape.kind === 'stations') return shape.slots === 4 ? 'Four stations' : 'Five stations'
  return shape.slots === 1 ? 'One game' : 'Two games'
}

// What one zone is called on screen: "Station 3" or "Game 2".
export function zoneLabel(kind: LayoutKind, n: number): string {
  return `${kind === 'stations' ? 'Station' : 'Game'} ${n}`
}

// ---- Bounds, mirroring venue_layout_zone_is_valid exactly ----------------

// A zone smaller than this is invisible on a phone and impossible to grab
// back in the editor, so it is grown rather than stored.
export const MIN_ZONE_SIZE = 0.05
export const MAX_ZONE_NAME = 30
// The declared real world size is labelling metadata, never the coordinate
// space. Bounded so a typo cannot label a ground as 3 km long.
export const MIN_SIZE_METRES = 5
export const MAX_SIZE_METRES = 300
// Fractions are stored to four decimal places: finer than any screen
// resolves, and coarse enough that the stored form is stable.
const COORD_DP = 4

// ---- The model ----------------------------------------------------------

export interface LayoutZone {
  // The station or game number, 1..slots, and the zone's identity.
  n: number
  // An optional short label ("Top corner"). '' means none.
  name: string
  x: number
  y: number
  w: number
  h: number
}

export interface LayoutSize {
  metresWide: number | null
  metresLong: number | null
}

// The parsed value of venue_layouts.zones.
export interface VenueLayoutZones {
  version: typeof VENUE_LAYOUT_VERSION
  size: LayoutSize
  zones: LayoutZone[]
}

// One row of venue_layouts, as the screens consume it. `zones` is null when
// the stored value could not be read (an unknown version), which is a row
// that exists and needs redrawing rather than a row that is absent.
export interface VenueLayout {
  id: string
  venueId: string
  seasonId: string
  ageGroup: string
  kind: LayoutKind
  slots: number
  zones: VenueLayoutZones | null
}

export function layoutShapeOf(layout: Pick<VenueLayout, 'kind' | 'slots'>): LayoutShape {
  return { kind: layout.kind, slots: layout.slots }
}

// ---- Defaults -----------------------------------------------------------

// Where the zones start before an admin moves them: a legible arrangement
// for each shape, drawn on the surface as fractions with a small margin.
// Four stations are a two by two grid, five are three across the top and
// two along the bottom, one game fills the middle, two sit side by side.
export function defaultZones(shape: LayoutShape): LayoutZone[] {
  const m = 0.02
  const zone = (n: number, x: number, y: number, w: number, h: number): LayoutZone => ({ n, name: '', x, y, w, h })
  if (shape.kind === 'games') {
    if (shape.slots === 1) return [zone(1, 0.1, 0.1, 0.8, 0.8)]
    return [zone(1, m, 0.1, 0.45, 0.8), zone(2, 0.53, 0.1, 0.45, 0.8)]
  }
  if (shape.slots === 4) {
    return [zone(1, m, m, 0.45, 0.45), zone(2, 0.53, m, 0.45, 0.45), zone(3, m, 0.53, 0.45, 0.45), zone(4, 0.53, 0.53, 0.45, 0.45)]
  }
  return [
    zone(1, m, m, 0.3, 0.45),
    zone(2, 0.35, m, 0.3, 0.45),
    zone(3, 0.68, m, 0.3, 0.45),
    zone(4, m, 0.53, 0.45, 0.45),
    zone(5, 0.53, 0.53, 0.45, 0.45),
  ]
}

export function emptyLayoutZones(shape: LayoutShape): VenueLayoutZones {
  return { version: VENUE_LAYOUT_VERSION, size: { metresWide: null, metresLong: null }, zones: defaultZones(shape) }
}

// The zones an editor opens on: every number 1..slots present exactly once,
// the stored ones where they were and any missing one at its default, in
// number order. A read that dropped a corrupt zone is completed here rather
// than refused, so the admin fixes one zone instead of redrawing four.
export function completeZones(zones: readonly LayoutZone[], shape: LayoutShape): LayoutZone[] {
  const byNumber = new Map<number, LayoutZone>()
  for (const z of zones) if (z.n >= 1 && z.n <= shape.slots && !byNumber.has(z.n)) byNumber.set(z.n, z)
  return defaultZones(shape).map((d) => byNumber.get(d.n) ?? d)
}

// ---- Reading ------------------------------------------------------------

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

// A finite number, or null. A string that happens to look like a number is
// NOT accepted: the column is written by this module alone, so a string
// there is corruption rather than a shape to be lenient about.
function finite(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function fraction(v: unknown): number | null {
  const n = finite(v)
  return n === null ? null : clampFraction(n)
}

function clampTo(n: number, lo: number, hi: number): number {
  if (n < lo) return lo
  if (n > hi) return hi
  return n
}

function shortName(v: unknown): string {
  return typeof v === 'string' ? v.trim().slice(0, MAX_ZONE_NAME) : ''
}

function metres(v: unknown): number | null {
  const n = finite(v)
  if (n === null) return null
  return Math.round(clampTo(n, MIN_SIZE_METRES, MAX_SIZE_METRES))
}

// One zone, rebuilt field by field from the allow list. Returns null to drop
// it. This function is the boundary: it never spreads its input, so no key
// it does not name can leave it.
function parseZone(raw: unknown, slots: number): LayoutZone | null {
  if (!isObject(raw)) return null
  const n = finite(raw.n)
  if (n === null || !Number.isInteger(n) || n < 1 || n > slots) return null
  const x = fraction(raw.x)
  const y = fraction(raw.y)
  const w = fraction(raw.w)
  const h = fraction(raw.h)
  if (x === null || y === null || w === null || h === null) return null
  return fitZone({ n, name: shortName(raw.name), x, y, w, h })
}

// A zone pulled onto the surface: at least the minimum size, and inside 0..1
// on both axes. The same rule the serialiser applies, so the editor's live
// value and the stored value agree.
export function fitZone(z: LayoutZone): LayoutZone {
  const w = clampTo(z.w, MIN_ZONE_SIZE, 1)
  const h = clampTo(z.h, MIN_ZONE_SIZE, 1)
  return { n: z.n, name: z.name, x: clampTo(z.x, 0, 1 - w), y: clampTo(z.y, 0, 1 - h), w, h }
}

function parseSize(raw: unknown): LayoutSize {
  if (!isObject(raw)) return { metresWide: null, metresLong: null }
  return { metresWide: metres(raw.metres_wide), metresLong: metres(raw.metres_long) }
}

// Read a stored value. Returns null for "there is no readable layout here",
// which is what a null, a non object and an unknown version all mean to a
// screen. Zones outside 1..slots and duplicates of a number are dropped, the
// first occurrence of a number winning, and the result is in number order.
export function parseVenueLayoutZones(value: unknown, slots: number): VenueLayoutZones | null {
  if (!isObject(value)) return null
  // The one whole value refusal. See the header.
  if (value.version !== VENUE_LAYOUT_VERSION) return null
  if (!Array.isArray(value.zones)) return null
  const seen = new Set<number>()
  const zones: LayoutZone[] = []
  for (const raw of value.zones) {
    const z = parseZone(raw, slots)
    if (!z || seen.has(z.n)) continue
    seen.add(z.n)
    zones.push(z)
  }
  zones.sort((a, b) => a.n - b.n)
  return { version: VENUE_LAYOUT_VERSION, size: parseSize(value.size), zones }
}

// ---- Writing ------------------------------------------------------------

function round(n: number): number {
  const f = 10 ** COORD_DP
  return Math.round(clampFraction(n) * f) / f
}

// The exact object the jsonb column stores, rebuilt key by key in a fixed
// order and holding only what the check constraint allows. A zone name is
// written only when there is one, and size only when either side is set,
// so an untouched layout stores the smallest form and the readback compares
// equal to what was sent.
export function serialiseVenueLayoutZones(v: VenueLayoutZones, shape: LayoutShape): unknown {
  const zones = completeZones(v.zones, shape).map((raw) => {
    const z = fitZone(raw)
    const out: Record<string, unknown> = { n: z.n }
    const name = z.name.trim().slice(0, MAX_ZONE_NAME)
    if (name !== '') out.name = name
    out.x = round(z.x)
    out.y = round(z.y)
    out.w = round(z.w)
    out.h = round(z.h)
    // Rounding can push x + w a hair over 1 (0.5333 + 0.4667); pull the
    // position back so the stored rectangle is inside the surface exactly,
    // which is what the constraint checks in exact decimal arithmetic.
    if ((out.x as number) + (out.w as number) > 1) out.x = round(1 - (out.w as number))
    if ((out.y as number) + (out.h as number) > 1) out.y = round(1 - (out.h as number))
    return out
  })
  const result: Record<string, unknown> = { version: VENUE_LAYOUT_VERSION }
  const wide = v.size.metresWide === null ? null : metres(v.size.metresWide)
  const long = v.size.metresLong === null ? null : metres(v.size.metresLong)
  if (wide !== null || long !== null) {
    const size: Record<string, unknown> = {}
    if (wide !== null) size.metres_wide = wide
    if (long !== null) size.metres_long = long
    result.size = size
  }
  result.zones = zones
  return result
}

// The whole value flattened to a string, so a move, a resize, a rename or a
// size change all register as a difference. Drives the unsaved indicator and
// the save readback comparison.
export function layoutSignature(v: VenueLayoutZones, shape: LayoutShape): string {
  return JSON.stringify(serialiseVenueLayoutZones(v, shape))
}

// ---- Editing, as pure moves the editor and the keyboard both use ---------

export function moveZone(zones: readonly LayoutZone[], n: number, dx: number, dy: number): LayoutZone[] {
  return zones.map((z) => (z.n === n ? fitZone({ ...z, x: z.x + dx, y: z.y + dy }) : z))
}

export function resizeZone(zones: readonly LayoutZone[], n: number, dw: number, dh: number): LayoutZone[] {
  return zones.map((z) => (z.n === n ? fitZone({ ...z, w: z.w + dw, h: z.h + dh }) : z))
}

export function renameZone(zones: readonly LayoutZone[], n: number, name: string): LayoutZone[] {
  return zones.map((z) => (z.n === n ? { ...z, name: name.slice(0, MAX_ZONE_NAME) } : z))
}

// ---- Drawing, as the numbers every renderer shares -----------------------

// The drawing's fixed width in viewBox units; the height follows the declared
// size's ratio. A layout with no size, or with only one side declared, is
// drawn landscape at 3:2; a declared ratio is honoured within the bounds that
// keep a phone screen legible.
export const PITCH_VIEW_WIDTH = 600

export function pitchHeight(size: LayoutSize): number {
  if (size.metresWide && size.metresLong) {
    const ratio = Math.min(2, Math.max(0.5, size.metresLong / size.metresWide))
    return Math.round(PITCH_VIEW_WIDTH * ratio)
  }
  return Math.round(PITCH_VIEW_WIDTH * (2 / 3))
}

function pct(f: number): string {
  return `${Math.round(f * 100)}%`
}

// One zone in words, for the accessible description and the live region:
// "Station 2, 53% across, 2% down, 45% by 45%".
export function describeZone(kind: LayoutKind, z: LayoutZone): string {
  const name = z.name.trim() ? `, ${z.name.trim()}` : ''
  return `${zoneLabel(kind, z.n)}${name}, ${pct(z.x)} across, ${pct(z.y)} down, ${pct(z.w)} by ${pct(z.h)}`
}

export function describeLayout(kind: LayoutKind, zones: readonly LayoutZone[], size: LayoutSize): string {
  const sized = size.metresWide && size.metresLong ? ` on ${size.metresWide} by ${size.metresLong} metres` : ''
  return `${zones.length} ${kind === 'stations' ? 'stations' : 'games'}${sized}: ${zones.map((z) => describeZone(kind, z)).join('; ')}.`
}

// ---- How a session finds its layout -------------------------------------
//
// The session supplies the venue, the age group and the slot count; the
// season is DERIVED from the date, and that derivation fails closed. Exactly
// one containing season wins. Zero, or more than one, resolves nothing and
// says which, and NEITHER branch consults seasons.is_current: a season that
// does not contain the date is a different season, and choosing one to fill
// a gap would load the 2026/27 allocation onto a 2025 session and show a
// coach ground that was never theirs. is_current is a fine default when an
// admin starts drawing (a person choosing with the answer in front of them);
// it never resolves a dated session. Season overlap is unconstrained by
// design (0031), so more than one match is a configuration problem with a
// human answer, and naming it is more useful than picking one.
//
// Dates compare as the YYYY-MM-DD strings both sides already are, which is
// exact and needs no time zone; the same comparison src/lib/seasonForm.ts
// makes. A season's archived state is irrelevant here: a 2025 session
// resolves its archived 2025/26 season, which is the one whose allocation
// it ran under.

export type SeasonResolution =
  | { kind: 'one'; season: Season }
  | { kind: 'none' }
  | { kind: 'ambiguous'; seasons: Season[] }

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export function resolveSeason(date: string | null | undefined, seasons: readonly Season[]): SeasonResolution {
  if (!date || !ISO_DATE.test(date)) return { kind: 'none' }
  const containing = seasons.filter((s) => s.startsOn <= date && date <= s.endsOn)
  if (containing.length === 1) return { kind: 'one', season: containing[0] }
  if (containing.length === 0) return { kind: 'none' }
  return { kind: 'ambiguous', seasons: containing }
}

export interface LayoutScope {
  venueId: string
  seasonId: string
  ageGroup: string
}

// The five ways a layout can honestly not be found, named once
// (docs/product/coaching-workflow/02-target-product-model.md section 8).
// Every screen that reports one uses these names, so nobody counts them
// again and arrives at a different number.
export type NoLayoutState =
  | 'no-venue'          // the session names no venue, so there is no ground to lay out
  | 'no-age-group'      // sessions.age_group is empty, so the scope key cannot be assembled
  | 'season-unresolved' // the date falls in no season (or the session has no date)
  | 'season-ambiguous'  // the date falls in more than one season
  | 'not-drawn'         // the scope resolved and nobody has drawn this shape for it
  | 'slot-count'        // fewer than four stations or more than five, which no layout can hold

export type ScopeResolution =
  | { state: 'resolved'; scope: LayoutScope; season: Season }
  | { state: 'no-venue' }
  | { state: 'no-age-group' }
  | { state: 'season-unresolved' }
  | { state: 'season-ambiguous'; seasons: Season[] }

export function resolveLayoutScope(
  session: { venueId: string | null; ageGroup: string; date: string },
  seasons: readonly Season[],
): ScopeResolution {
  if (!session.venueId) return { state: 'no-venue' }
  const ageGroup = session.ageGroup.trim()
  if (ageGroup === '') return { state: 'no-age-group' }
  const season = resolveSeason(session.date, seasons)
  if (season.kind === 'none') return { state: 'season-unresolved' }
  if (season.kind === 'ambiguous') return { state: 'season-ambiguous', seasons: season.seasons }
  return { state: 'resolved', scope: { venueId: session.venueId, seasonId: season.season.id, ageGroup }, season: season.season }
}

export type LayoutLookup =
  | { state: 'found'; layout: VenueLayout; scope: LayoutScope; season: Season }
  | { state: 'not-drawn'; scope: LayoutScope; season: Season }
  | { state: 'slot-count'; scope: LayoutScope; season: Season }
  | Exclude<ScopeResolution, { state: 'resolved' }>

// The layout a session should draw for one shape, or exactly which of the
// five states applies. A stored row whose value could not be read counts as
// not drawn: the admin link is the right answer for it too.
export function findVenueLayout(
  session: { venueId: string | null; ageGroup: string; date: string },
  seasons: readonly Season[],
  layouts: readonly VenueLayout[],
  kind: LayoutKind,
  slots: number,
): LayoutLookup {
  const scope = resolveLayoutScope(session, seasons)
  if (scope.state !== 'resolved') return scope
  if (!isLayoutShape(kind, slots)) return { state: 'slot-count', scope: scope.scope, season: scope.season }
  const layout = layouts.find(
    (l) =>
      l.venueId === scope.scope.venueId &&
      l.seasonId === scope.scope.seasonId &&
      l.ageGroup === scope.scope.ageGroup &&
      l.kind === kind &&
      l.slots === slots &&
      l.zones !== null,
  )
  if (!layout) return { state: 'not-drawn', scope: scope.scope, season: scope.season }
  return { state: 'found', layout, scope: scope.scope, season: scope.season }
}

// The layouts drawn for one scope, keyed by shape, for the admin screen.
export function layoutsForScope(layouts: readonly VenueLayout[], scope: LayoutScope): VenueLayout[] {
  return layouts.filter(
    (l) => l.venueId === scope.venueId && l.seasonId === scope.seasonId && l.ageGroup === scope.ageGroup,
  )
}

export function layoutForShape(layouts: readonly VenueLayout[], shape: LayoutShape): VenueLayout | null {
  return layouts.find((l) => l.kind === shape.kind && l.slots === shape.slots) ?? null
}

// One sentence per no-layout state, saying who can fix it. Every one is a
// sentence and never a blank panel, and none blocks anything.
export function describeNoLayout(state: NoLayoutState): string {
  switch (state) {
    case 'no-venue':
      return 'This session has no venue yet, so there is no ground to lay out. Choose a venue in the planner.'
    case 'no-age-group':
      return 'This session has no age group yet, so its layout cannot be found. Set the age group in the planner.'
    case 'season-unresolved':
      return 'The session date falls in no season, so its layout cannot be found. An admin can check the seasons.'
    case 'season-ambiguous':
      return 'The session date falls in more than one season, so its layout cannot be found. An admin can check the seasons.'
    case 'not-drawn':
      return 'No layout has been drawn for this venue, season and age group yet. An admin can draw one under Venues.'
    case 'slot-count':
      return 'Layouts hold four or five stations and one or two games, so there is none for this many.'
  }
}
