// The session setup composer's pure model (ADR-0008, PR 11): where the
// session's stations stand on a real venue area, and what kit the whole
// session needs.
//
// Coordinates are metres in the area's own local frame: the boundary
// polygon projected to metres (src/lib/venues.ts) and translated so the
// bounding box's south west corner is the origin, x east, y north. A
// station is an axis aligned rectangle given by that corner plus its
// width (east west) and length (north south), the way a coach paces a
// grid out. The frame is derived from the boundary every time it is
// needed, never stored, so nothing here depends on a projection the
// database would have to agree with.
//
// The boundary is the owner's drawn approximation of the usable green,
// treated as given. A station crossing it is a warning and never a
// block: the coach standing on the grass is the authority on whether the
// far corner is really out.
import {
  layoutKitItems,
  type DrillLayout,
  type LayoutArea,
} from './drillLayout'
import { areaFits, areaFitScale } from './drillLayout'
import { boundaryToMetres, type Boundary } from './venues'

export const SETUP_VERSION = 1
export const SETUP_MAX_STATIONS = 12
export const SETUP_LABEL_MAX = 30
export const STATION_MIN_METRES = 1
export const STATION_MAX_METRES = 150

export interface SetupStation {
  id: string
  // The south west corner in the area's local metre frame.
  x: number
  y: number
  width: number
  length: number
  label?: string
  // The drill this station is laid out for, or absent for a plain grid.
  drillId?: string
}

export interface SessionSetup {
  version: typeof SETUP_VERSION
  stations: SetupStation[]
}

export interface Metres {
  x: number
  y: number
}

// The area's local frame: the polygon in metres with the origin at its
// bounding box corner, plus the box's own size, which is what the
// composer scales its schematic by.
export interface AreaFrame {
  polygon: Metres[]
  width: number
  length: number
}

export function areaFrame(boundary: Boundary): AreaFrame {
  const pts = boundaryToMetres(boundary)
  const minX = Math.min(...pts.map((p) => p.x))
  const minY = Math.min(...pts.map((p) => p.y))
  const polygon = pts.map((p) => ({ x: p.x - minX, y: p.y - minY }))
  return {
    polygon,
    width: Math.max(...polygon.map((p) => p.x)),
    length: Math.max(...polygon.map((p) => p.y)),
  }
}

// Ray casting, counting crossings of the upward ray from the point. A
// point exactly on an edge may fall either way; the result only drives a
// warning, so a hair's breadth either side of the line does not matter.
export function pointInPolygon(pt: Metres, polygon: Metres[]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]
    const b = polygon[j]
    if (a.y > pt.y !== b.y > pt.y && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside
    }
  }
  return inside
}

export function stationCorners(s: SetupStation): Metres[] {
  return [
    { x: s.x, y: s.y },
    { x: s.x + s.width, y: s.y },
    { x: s.x + s.width, y: s.y + s.length },
    { x: s.x, y: s.y + s.length },
  ]
}

// Whether every corner sits inside the drawn boundary. False is a warning
// the composer shows and never a refusal.
export function stationInsideBoundary(s: SetupStation, frame: AreaFrame): boolean {
  return stationCorners(s).every((c) => pointInPolygon(c, frame.polygon))
}

export function stationArea(s: SetupStation): number {
  return s.width * s.length
}

// How a drill's declared area sits in a station: whether it fits at all
// (either way round) and the scale it would need. Under 1 means the
// station is too small for the drill as written, which the composer says
// plainly without blocking.
export interface StationFit {
  fits: boolean
  scale: number
  turned: boolean
}

export function stationFit(station: SetupStation, area: LayoutArea): StationFit {
  const box = { width: station.width, length: station.length }
  const straight = Math.min(box.width / area.width, box.length / area.length)
  const turned = Math.min(box.width / area.length, box.length / area.width)
  return { fits: areaFits(area, box), scale: areaFitScale(area, box), turned: turned > straight }
}

// ---- Validation -------------------------------------------------------------

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v)
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const wellFormed = (s: string) =>
  !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s)
const isId = (v: unknown): v is string =>
  typeof v === 'string' && v.length >= 1 && v.length <= 40 && wellFormed(v)

const TOP_KEYS = ['version', 'stations']
const STATION_KEYS = ['id', 'x', 'y', 'width', 'length', 'label', 'drillId']

// Every reason a value is not a valid setup, in reading order. Mirrors the
// database's session_setup_ok (0048) on shape, and adds the arithmetic the
// browser is the right place for. Nothing here consults a boundary: a
// station outside the drawn green is a warning, not an invalid value.
export function setupProblems(value: unknown): string[] {
  if (!isRecord(value)) return ['The setup is not an object.']
  const out = Object.keys(value)
    .filter((k) => !TOP_KEYS.includes(k))
    .map((k) => `The setup carries an unknown field ${k}.`)
  if (value.version !== SETUP_VERSION) out.push('The setup version is not 1.')

  const stations = value.stations
  if (!Array.isArray(stations) || stations.length > SETUP_MAX_STATIONS) {
    out.push(`A setup holds at most ${SETUP_MAX_STATIONS} stations.`)
    return out
  }

  const ids = new Set<string>()
  for (let i = 0; i < stations.length; i++) {
    const s: unknown = stations[i]
    const where = `Station ${i + 1}`
    if (!isRecord(s) || !isId(s.id)) {
      out.push(`${where} has no usable id.`)
      continue
    }
    out.push(
      ...Object.keys(s)
        .filter((k) => !STATION_KEYS.includes(k))
        .map((k) => `${where} carries an unknown field ${k}.`),
    )
    if (ids.has(s.id)) out.push(`${where} repeats the id ${s.id}.`)
    ids.add(s.id)
    if (!isFiniteNumber(s.x) || !isFiniteNumber(s.y) || s.x < 0 || s.y < 0) {
      out.push(`${where} sits outside the area's own frame.`)
    }
    if (
      !isFiniteNumber(s.width) ||
      !isFiniteNumber(s.length) ||
      s.width < STATION_MIN_METRES ||
      s.length < STATION_MIN_METRES ||
      s.width > STATION_MAX_METRES ||
      s.length > STATION_MAX_METRES
    ) {
      out.push(`${where} needs a size between ${STATION_MIN_METRES} and ${STATION_MAX_METRES} metres.`)
    }
    if (
      s.label !== undefined &&
      (typeof s.label !== 'string' || s.label.length > SETUP_LABEL_MAX || !wellFormed(s.label))
    ) {
      out.push(`${where}'s label is over ${SETUP_LABEL_MAX} characters.`)
    }
    if (s.drillId !== undefined && !isId(s.drillId)) out.push(`${where} has an unusable drill reference.`)
  }
  return out
}

export function parseSessionSetup(value: unknown): SessionSetup | null {
  return setupProblems(value).length === 0 ? (value as SessionSetup) : null
}

export const emptySetup = (): SessionSetup => ({ version: SETUP_VERSION, stations: [] })

// ---- Editing ----------------------------------------------------------------

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const snap = (v: number) => Math.round(v * 10) / 10

function nextStationId(setup: SessionSetup): string {
  let highest = 0
  for (const s of setup.stations) {
    const m = s.id.match(/^s(\d{1,6})$/)
    if (m) highest = Math.max(highest, Number(m[1]))
  }
  return `s${highest + 1}`
}

// A new station lands where it was tapped, sized to the bound drill's own
// area when there is one, so a drill written for 12 by 12 paces out at 12
// by 12 on the grass.
export function addStation(
  setup: SessionSetup,
  frame: AreaFrame,
  at: Metres,
  drill?: { id: string; area: LayoutArea | null },
): SessionSetup | null {
  if (setup.stations.length >= SETUP_MAX_STATIONS) return null
  const width = clamp(drill?.area?.width ?? 10, STATION_MIN_METRES, STATION_MAX_METRES)
  const length = clamp(drill?.area?.length ?? 10, STATION_MIN_METRES, STATION_MAX_METRES)
  const station: SetupStation = {
    id: nextStationId(setup),
    x: snap(clamp(at.x - width / 2, 0, Math.max(0, frame.width - width))),
    y: snap(clamp(at.y - length / 2, 0, Math.max(0, frame.length - length))),
    width: snap(width),
    length: snap(length),
  }
  if (drill) station.drillId = drill.id
  return { ...setup, stations: [...setup.stations, station] }
}

export function moveStation(setup: SessionSetup, id: string, to: Metres): SessionSetup {
  return {
    ...setup,
    stations: setup.stations.map((s) =>
      s.id === id ? { ...s, x: snap(Math.max(0, to.x)), y: snap(Math.max(0, to.y)) } : s,
    ),
  }
}

export function resizeStation(setup: SessionSetup, id: string, width: number, length: number): SessionSetup {
  return {
    ...setup,
    stations: setup.stations.map((s) =>
      s.id === id
        ? {
            ...s,
            width: snap(clamp(width, STATION_MIN_METRES, STATION_MAX_METRES)),
            length: snap(clamp(length, STATION_MIN_METRES, STATION_MAX_METRES)),
          }
        : s,
    ),
  }
}

export function setStationLabel(setup: SessionSetup, id: string, label: string): SessionSetup {
  let value = label.slice(0, SETUP_LABEL_MAX)
  while (value && /[\uD800-\uDBFF]$/.test(value)) value = value.slice(0, -1)
  return {
    ...setup,
    stations: setup.stations.map((s) =>
      s.id === id ? { ...s, ...(value ? { label: value } : { label: undefined }) } : s,
    ),
  }
}

export function setStationDrill(setup: SessionSetup, id: string, drillId: string | null): SessionSetup {
  return {
    ...setup,
    stations: setup.stations.map((s) =>
      s.id === id ? { ...s, ...(drillId ? { drillId } : { drillId: undefined }) } : s,
    ),
  }
}

export function removeStation(setup: SessionSetup, id: string): SessionSetup {
  return { ...setup, stations: setup.stations.filter((s) => s.id !== id) }
}

// ---- Rendering shapes -------------------------------------------------------

// One station as the schematic draws it: the station itself, the bound
// drill's title when it is still in the library, and its place in the
// running order. Shaped here rather than in a component so both the
// composer and the read only views share one derivation.
export interface SchematicStation {
  station: SetupStation
  title: string
  index: number
}

export function schematicStations(
  setup: SessionSetup,
  titles: Record<string, { title: string } | undefined>,
): SchematicStation[] {
  return setup.stations.map((station, index) => ({
    station,
    title: station.drillId ? (titles[station.drillId]?.title ?? '') : '',
    index,
  }))
}

// ---- The kit list -----------------------------------------------------------

export interface KitLine {
  name: string
  // Null when the requirement is free text equipment with no count behind
  // it ("bibs"); a number when it comes from counted layout pieces.
  count: number | null
  // Which drills need it, in session order.
  drills: string[]
}

export interface KitDrill {
  title: string
  equipment: string[]
  layout: DrillLayout | null
}

const norm = (s: string) => s.trim().toLowerCase()

// The session's kit: free text equipment across its drills, plus the
// counted pieces every drill diagram declares. Counts are the largest a
// single drill needs, not the sum: the drills run one after another and
// the same cones are picked up and put down again. Where a drill's
// equipment text names something its diagram already counts, the two fold
// into one line rather than reading twice.
export function sessionKit(drills: KitDrill[]): KitLine[] {
  const lines: KitLine[] = []
  const byName = new Map<string, KitLine>()
  // Counted layout pieces first, so equipment text can fold into them.
  const aliases = new Map<string, KitLine>()
  for (const drill of drills) {
    if (!drill.layout) continue
    for (const item of layoutKitItems(drill.layout)) {
      let line = byName.get(item.kind)
      if (!line) {
        line = { name: item.plural, count: 0, drills: [] }
        byName.set(item.kind, line)
        aliases.set(norm(item.singular), line)
        aliases.set(norm(item.plural), line)
        lines.push(line)
      }
      line.count = Math.max(line.count ?? 0, item.count)
      if (!line.drills.includes(drill.title)) line.drills.push(drill.title)
    }
  }
  for (const drill of drills) {
    for (const raw of drill.equipment) {
      const name = raw.trim()
      if (!name) continue
      const existing = aliases.get(norm(name))
      if (existing) {
        if (!existing.drills.includes(drill.title)) existing.drills.push(drill.title)
        continue
      }
      let line = byName.get(norm(name))
      if (!line) {
        line = { name, count: null, drills: [] }
        byName.set(norm(name), line)
        aliases.set(norm(name), line)
        lines.push(line)
      }
      if (!line.drills.includes(drill.title)) line.drills.push(drill.title)
    }
  }
  return lines
}

// The one line summary a station shows: its size, and how the bound
// drill's own area sits in it.
export function stationSummary(station: SetupStation, area: LayoutArea | null): string {
  const size = `${station.width} × ${station.length} m`
  if (!area) return size
  const fit = stationFit(station, area)
  if (fit.fits) return `${size}, fits the drill's ${area.width} × ${area.length} m${fit.turned ? ' turned' : ''}`
  return `${size}, tighter than the drill's ${area.width} × ${area.length} m`
}
