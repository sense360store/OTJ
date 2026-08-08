// Venues: the pure types, guards and geometry the venue config screen and
// the setup composer build on. A boundary polygon is ordered [lat, lng]
// vertices with the closing vertex omitted, drawn by the club owner as a
// visual approximation of the usable green area; the numbers are treated as
// given, never resurveyed or corrected. The database enforces the same shape
// with venue_boundary_ok (migration 0043); these guards are the browser twin
// for jsonb that has already crossed the wire.

export type BoundaryVertex = [number, number]
export type Boundary = BoundaryVertex[]

export const BOUNDARY_MIN_VERTICES = 3
export const BOUNDARY_MAX_VERTICES = 64

export interface Venue {
  id: string
  name: string
  centreLat: number
  centreLng: number
}

export interface VenueArea {
  id: string
  venueId: string
  name: string
  // Null when a stored boundary does not parse; the UI says so rather than
  // rendering nonsense. The DB check makes this unreachable in practice.
  boundary: Boundary | null
  usable: boolean
}

export function isBoundaryVertex(value: unknown): value is BoundaryVertex {
  if (!Array.isArray(value) || value.length !== 2) return false
  const [lat, lng] = value as unknown[]
  return (
    typeof lat === 'number' &&
    Number.isFinite(lat) &&
    lat >= -90 &&
    lat <= 90 &&
    typeof lng === 'number' &&
    Number.isFinite(lng) &&
    lng >= -180 &&
    lng <= 180
  )
}

export function isBoundary(value: unknown): value is Boundary {
  return (
    Array.isArray(value) &&
    value.length >= BOUNDARY_MIN_VERTICES &&
    value.length <= BOUNDARY_MAX_VERTICES &&
    value.every(isBoundaryVertex)
  )
}

// The admin screen edits a boundary as text, one vertex per line as
// "lat, lng", the shape you get pasting from a maps app. Parsing is strict
// about numbers and bounds, tolerant about whitespace and blank lines.
// Number('') is 0 and Number('0x10') is 16, so a plain decimal pattern
// guards each part before conversion; a trailing comma must be an error,
// never a fabricated zero coordinate.
const DECIMAL = /^-?\d+(\.\d+)?$/

function parseCoordinate(part: string): number | null {
  return DECIMAL.test(part) ? Number(part) : null
}

export function parseBoundaryText(text: string): { boundary: Boundary | null; error: string | null } {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '')
  if (lines.length === 0) return { boundary: null, error: 'Enter one vertex per line as latitude, longitude.' }
  const vertices: BoundaryVertex[] = []
  for (const line of lines) {
    const parts = line.split(',').map((p) => p.trim())
    if (parts.length !== 2) {
      return { boundary: null, error: `Could not read "${line}". Each line is latitude, longitude.` }
    }
    const lat = parseCoordinate(parts[0])
    const lng = parseCoordinate(parts[1])
    if (lat === null || lng === null || !isBoundaryVertex([lat, lng])) {
      return { boundary: null, error: `Could not read "${line}". Each line is latitude, longitude.` }
    }
    vertices.push([lat, lng])
  }
  if (vertices.length < BOUNDARY_MIN_VERTICES) {
    return { boundary: null, error: `A boundary needs at least ${BOUNDARY_MIN_VERTICES} vertices.` }
  }
  if (vertices.length > BOUNDARY_MAX_VERTICES) {
    return { boundary: null, error: `A boundary holds at most ${BOUNDARY_MAX_VERTICES} vertices.` }
  }
  return { boundary: vertices, error: null }
}

export function formatBoundaryText(boundary: Boundary): string {
  return boundary.map(([lat, lng]) => `${lat}, ${lng}`).join('\n')
}

// Geometry. The areas involved are tens of metres across, so an
// equirectangular projection about the polygon's mean latitude is exact to
// well under a percent: metres east = R * dLng * cos(meanLat), metres north
// = R * dLat, then the shoelace formula. No map library, no tiles.
const EARTH_RADIUS_M = 6371008.8
const DEG = Math.PI / 180

export function boundaryToMetres(boundary: Boundary): Array<{ x: number; y: number }> {
  const meanLat = boundary.reduce((s, [lat]) => s + lat, 0) / boundary.length
  const meanLng = boundary.reduce((s, [, lng]) => s + lng, 0) / boundary.length
  const cos = Math.cos(meanLat * DEG)
  return boundary.map(([lat, lng]) => ({
    x: EARTH_RADIUS_M * (lng - meanLng) * DEG * cos,
    y: EARTH_RADIUS_M * (lat - meanLat) * DEG,
  }))
}

export function polygonAreaSquareMetres(boundary: Boundary): number {
  if (boundary.length < 3) return 0
  const pts = boundaryToMetres(boundary)
  let sum = 0
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    sum += a.x * b.y - b.x * a.y
  }
  return Math.abs(sum) / 2
}

export function areaLabel(boundary: Boundary | null): string {
  if (!boundary) return 'Boundary not readable'
  const m2 = polygonAreaSquareMetres(boundary)
  if (m2 <= 0) return 'No area'
  return `about ${Math.round(m2).toLocaleString('en-GB')} m²`
}

// The preview polygon: boundary vertices projected to metres, fitted into a
// width by height box with padding, north up, scale true (one scale for both
// axes, so shape is preserved). Returns the SVG points string, or null for
// a degenerate boundary.
export function boundarySvgPoints(
  boundary: Boundary,
  width: number,
  height: number,
  pad = 6,
): string | null {
  if (boundary.length < 3) return null
  const pts = boundaryToMetres(boundary)
  const xs = pts.map((p) => p.x)
  const ys = pts.map((p) => p.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const spanX = maxX - minX
  const spanY = maxY - minY
  if (spanX <= 0 || spanY <= 0) return null
  const scale = Math.min((width - pad * 2) / spanX, (height - pad * 2) / spanY)
  const offsetX = (width - spanX * scale) / 2
  const offsetY = (height - spanY * scale) / 2
  return pts
    .map((p) => {
      const x = offsetX + (p.x - minX) * scale
      // SVG y grows downward; metres north grow upward.
      const y = height - offsetY - (p.y - minY) * scale
      return `${Math.round(x * 10) / 10},${Math.round(y * 10) / 10}`
    })
    .join(' ')
}

export function parseCentreText(text: string): { lat: number; lng: number } | null {
  const parts = text.split(',').map((p) => p.trim())
  if (parts.length !== 2) return null
  const lat = parseCoordinate(parts[0])
  const lng = parseCoordinate(parts[1])
  if (lat === null || lng === null || !isBoundaryVertex([lat, lng])) return null
  return { lat, lng }
}
