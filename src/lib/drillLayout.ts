// The drill layout model (ADR-0008): structured setup data on NEW drills
// only. Existing FA imported drills keep their image and video media
// unchanged forever and are never retrofitted; a null drills.layout is the
// discriminator. Coordinates are metres relative to the drill's own area,
// which declares its real width and length, so the composer can scale a
// drill's area onto a venue schematic truthfully.
//
// Movement is static phases: one to four frames sharing entity identity,
// each frame a snapshot of where everything stands; there is no animation
// timeline. Arrows use the standard coaching notation, rendered by the
// renderer: solid for a pass, dashed for a run, wavy for a dribble, solid
// with a double head for a shot.
//
// parseDrillLayout is the single gate stored jsonb passes on the way in;
// layoutProblems is the editor's detailed account of what is wrong. The
// database enforces the storable envelope with drill_layout_ok (0047):
// shape, value types, closed field lists, string caps and a total size
// cap, so no free text channel survives a direct write. The rules that
// need arithmetic (coordinate ranges, zone fit, rotation bounds, id
// uniqueness, shared identity across phases) live only here, the browser
// twin discipline every jsonb column in this repo follows.

export const LAYOUT_VERSION = 1

// The defensive caps: a frame is a coaching diagram, not a crowd scene.
export const LAYOUT_MAX_FRAMES = 4
export const LAYOUT_MAX_ENTITIES_PER_FRAME = 80
export const LAYOUT_MAX_ZONES_PER_FRAME = 10
export const LAYOUT_MAX_ARROWS_PER_FRAME = 40
export const LAYOUT_LABEL_MAX = 3
export const LAYOUT_ZONE_LABEL_MAX = 20
export const LAYOUT_NOTE_MAX = 200

// A training area between a couple of metres and a full pitch length.
export const AREA_MIN_METRES = 2
export const AREA_MAX_METRES = 150

export const LAYOUT_ENTITY_KINDS = ['cone', 'marker', 'goal', 'mini_goal', 'mannequin', 'player', 'ball'] as const
export type LayoutEntityKind = (typeof LAYOUT_ENTITY_KINDS)[number]

export const LAYOUT_ARROW_KINDS = ['pass', 'run', 'dribble', 'shot'] as const
export type LayoutArrowKind = (typeof LAYOUT_ARROW_KINDS)[number]

export const LAYOUT_TEAMS = ['attack', 'defence', 'neutral'] as const
export type LayoutTeam = (typeof LAYOUT_TEAMS)[number]

export interface LayoutPoint {
  x: number
  y: number
}

export interface LayoutEntity {
  // Stable across frames: frame two's player 'p1' is frame one's player
  // 'p1' somewhere else. Ids are layout local and carry no meaning
  // outside it.
  id: string
  kind: LayoutEntityKind
  x: number
  y: number
  // Degrees clockwise from facing up the area. Valid on any piece; the
  // renderer honours it on directional pieces such as goals and mannequins.
  rotation?: number
  // Players only: which side the disc renders as.
  team?: LayoutTeam
  // A short tag like 'A' or 'GK', capped hard at three characters so the
  // field cannot hold a name. Never a child's name; drill diagrams are
  // generic coaching content.
  label?: string
}

export interface LayoutZone {
  id: string
  x: number
  y: number
  width: number
  height: number
  label?: string
}

export interface LayoutArrow {
  id: string
  kind: LayoutArrowKind
  from: LayoutPoint
  to: LayoutPoint
}

export interface LayoutFrame {
  entities: LayoutEntity[]
  zones: LayoutZone[]
  arrows: LayoutArrow[]
  // An optional phase note ("after the pass, follow to the far cone").
  note?: string
}

export interface LayoutArea {
  // Metres across (x) and down (y). The renderer draws y increasing down
  // the screen, the way a coach draws on a whiteboard.
  width: number
  length: number
}

export interface DrillLayout {
  version: typeof LAYOUT_VERSION
  area: LayoutArea
  frames: LayoutFrame[]
}

// ---- Validation -------------------------------------------------------------

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v)

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

const isId = (v: unknown): v is string => typeof v === 'string' && v.length >= 1 && v.length <= 40

// The closed field lists, mirrored by drill_layout_ok in the database: an
// unknown field is refused on both sides, so the only free text a layout
// can carry is the capped labels and notes.
const TOP_KEYS = ['version', 'area', 'frames']
const AREA_KEYS = ['width', 'length']
const FRAME_KEYS = ['entities', 'zones', 'arrows', 'note']
const ENTITY_KEYS = ['id', 'kind', 'x', 'y', 'rotation', 'team', 'label']
const ZONE_KEYS = ['id', 'x', 'y', 'width', 'height', 'label']
const ARROW_KEYS = ['id', 'kind', 'from', 'to']
const POINT_KEYS = ['x', 'y']

const unknownKeyProblems = (v: Record<string, unknown>, allowed: string[], where: string): string[] =>
  Object.keys(v)
    .filter((k) => !allowed.includes(k))
    .map((k) => `${where} carries an unknown field ${k}.`)

function pointProblems(v: unknown, area: LayoutArea, where: string): string[] {
  if (!isRecord(v)) return [`${where} is not a point`]
  const out: string[] = []
  if (!isFiniteNumber(v.x) || v.x < 0 || v.x > area.width) out.push(`${where} x is outside the area`)
  if (!isFiniteNumber(v.y) || v.y < 0 || v.y > area.length) out.push(`${where} y is outside the area`)
  return out
}

// Every reason a value is not a valid layout, in reading order. Empty means
// valid. The editor shows these; parseDrillLayout callers only need the
// verdict.
export function layoutProblems(value: unknown): string[] {
  if (!isRecord(value)) return ['The layout is not an object.']
  const out = unknownKeyProblems(value, TOP_KEYS, 'The layout')
  if (value.version !== LAYOUT_VERSION) out.push('The layout version is not 1.')

  const areaRaw = value.area
  let area: LayoutArea = { width: AREA_MIN_METRES, length: AREA_MIN_METRES }
  if (
    !isRecord(areaRaw) ||
    !isFiniteNumber(areaRaw.width) ||
    !isFiniteNumber(areaRaw.length) ||
    areaRaw.width < AREA_MIN_METRES ||
    areaRaw.width > AREA_MAX_METRES ||
    areaRaw.length < AREA_MIN_METRES ||
    areaRaw.length > AREA_MAX_METRES
  ) {
    out.push(`The area needs a width and length between ${AREA_MIN_METRES} and ${AREA_MAX_METRES} metres.`)
  } else {
    area = { width: areaRaw.width, length: areaRaw.length }
  }
  if (isRecord(areaRaw)) out.push(...unknownKeyProblems(areaRaw, AREA_KEYS, 'The area'))

  const frames = value.frames
  if (!Array.isArray(frames) || frames.length < 1 || frames.length > LAYOUT_MAX_FRAMES) {
    out.push(`A layout holds 1 to ${LAYOUT_MAX_FRAMES} phases.`)
    return out
  }

  let firstIds: string[] | null = null
  // Index loops throughout, never forEach: forEach skips sparse array
  // holes, and a hole must fail like any other malformed element or a
  // parse blessed value could still throw downstream.
  for (let fi = 0; fi < frames.length; fi++) {
    const frameRaw: unknown = frames[fi]
    const phase = `Phase ${fi + 1}`
    if (!isRecord(frameRaw)) {
      out.push(`${phase} is not an object.`)
      continue
    }
    out.push(...unknownKeyProblems(frameRaw, FRAME_KEYS, phase))
    const entities = frameRaw.entities
    const zones = frameRaw.zones
    const arrows = frameRaw.arrows
    if (!Array.isArray(entities) || entities.length > LAYOUT_MAX_ENTITIES_PER_FRAME) {
      out.push(`${phase} holds at most ${LAYOUT_MAX_ENTITIES_PER_FRAME} pieces.`)
      continue
    }
    if (!Array.isArray(zones) || zones.length > LAYOUT_MAX_ZONES_PER_FRAME) {
      out.push(`${phase} holds at most ${LAYOUT_MAX_ZONES_PER_FRAME} zones.`)
      continue
    }
    if (!Array.isArray(arrows) || arrows.length > LAYOUT_MAX_ARROWS_PER_FRAME) {
      out.push(`${phase} holds at most ${LAYOUT_MAX_ARROWS_PER_FRAME} arrows.`)
      continue
    }
    if (frameRaw.note !== undefined && (typeof frameRaw.note !== 'string' || frameRaw.note.length > LAYOUT_NOTE_MAX)) {
      out.push(`${phase}'s note is too long.`)
    }

    const ids = new Set<string>()
    for (let ei = 0; ei < entities.length; ei++) {
      const e: unknown = entities[ei]
      const whereName = `${phase} piece ${ei + 1}`
      if (!isRecord(e) || !isId(e.id)) {
        out.push(`${whereName} has no usable id.`)
        continue
      }
      out.push(...unknownKeyProblems(e, ENTITY_KEYS, whereName))
      if (ids.has(e.id)) out.push(`${whereName} repeats the id ${e.id}.`)
      ids.add(e.id)
      if (!LAYOUT_ENTITY_KINDS.includes(e.kind as LayoutEntityKind)) out.push(`${whereName} has an unknown kind.`)
      out.push(...pointProblems(e, area, whereName))
      if (e.rotation !== undefined && (!isFiniteNumber(e.rotation) || e.rotation < 0 || e.rotation >= 360)) {
        out.push(`${whereName} has an unusable rotation.`)
      }
      if (e.team !== undefined) {
        if (e.kind !== 'player') out.push(`${whereName} carries a team but is not a player.`)
        else if (!LAYOUT_TEAMS.includes(e.team as LayoutTeam)) out.push(`${whereName} has an unknown team.`)
      }
      if (e.label !== undefined && (typeof e.label !== 'string' || e.label.length > LAYOUT_LABEL_MAX)) {
        out.push(`${whereName}'s label is over ${LAYOUT_LABEL_MAX} characters.`)
      }
    }

    for (let zi = 0; zi < zones.length; zi++) {
      const z: unknown = zones[zi]
      const whereName = `${phase} zone ${zi + 1}`
      if (!isRecord(z) || !isId(z.id)) {
        out.push(`${whereName} has no usable id.`)
        continue
      }
      out.push(...unknownKeyProblems(z, ZONE_KEYS, whereName))
      if (ids.has(z.id)) out.push(`${whereName} repeats the id ${z.id}.`)
      ids.add(z.id)
      if (
        !isFiniteNumber(z.x) ||
        !isFiniteNumber(z.y) ||
        !isFiniteNumber(z.width) ||
        !isFiniteNumber(z.height) ||
        z.width <= 0 ||
        z.height <= 0 ||
        z.x < 0 ||
        z.y < 0 ||
        z.x + z.width > area.width ||
        z.y + z.height > area.length
      ) {
        out.push(`${whereName} does not fit inside the area.`)
      }
      if (z.label !== undefined && (typeof z.label !== 'string' || z.label.length > LAYOUT_ZONE_LABEL_MAX)) {
        out.push(`${whereName}'s label is over ${LAYOUT_ZONE_LABEL_MAX} characters.`)
      }
    }

    for (let ai = 0; ai < arrows.length; ai++) {
      const a: unknown = arrows[ai]
      const whereName = `${phase} arrow ${ai + 1}`
      if (!isRecord(a) || !isId(a.id)) {
        out.push(`${whereName} has no usable id.`)
        continue
      }
      out.push(...unknownKeyProblems(a, ARROW_KEYS, whereName))
      if (ids.has(a.id)) out.push(`${whereName} repeats the id ${a.id}.`)
      ids.add(a.id)
      if (!LAYOUT_ARROW_KINDS.includes(a.kind as LayoutArrowKind)) out.push(`${whereName} has an unknown kind.`)
      if (isRecord(a.from)) out.push(...unknownKeyProblems(a.from, POINT_KEYS, `${whereName} start`))
      if (isRecord(a.to)) out.push(...unknownKeyProblems(a.to, POINT_KEYS, `${whereName} end`))
      out.push(...pointProblems(a.from, area, `${whereName} start`))
      out.push(...pointProblems(a.to, area, `${whereName} end`))
    }

    // Shared identity: later phases move the first phase's pieces, they do
    // not introduce or drop any. Zones and arrows may differ per phase.
    const entityIds = entities
      .filter((e): e is Record<string, unknown> => isRecord(e) && isId(e.id))
      .map((e) => String(e.id))
      .sort()
    if (firstIds === null) {
      firstIds = entityIds
    } else if (firstIds.length !== entityIds.length || firstIds.some((id, i) => id !== entityIds[i])) {
      out.push(`${phase} does not carry the same pieces as phase 1; phases move pieces, never add or remove them.`)
    }
  }

  return out
}

// The stored jsonb's single gate: the parsed layout, or null when anything
// is wrong. Never throws.
export function parseDrillLayout(value: unknown): DrillLayout | null {
  return layoutProblems(value).length === 0 ? (value as DrillLayout) : null
}

// ---- Geometry and derivation ------------------------------------------------

// What the drill needs, counted from phase 1 (identity is shared, so every
// phase has the same pieces). The kit list reads this.
export function layoutEntityCounts(layout: DrillLayout): Record<LayoutEntityKind, number> {
  const counts = Object.fromEntries(LAYOUT_ENTITY_KINDS.map((k) => [k, 0])) as Record<LayoutEntityKind, number>
  for (const e of layout.frames[0].entities) counts[e.kind]++
  return counts
}

// The kit list line for a layout, kinds with a count and a plural label,
// omitting zero counts and players and balls' incidental cousins nobody
// packs (players are children, not kit).
const KIT_LABELS: Partial<Record<LayoutEntityKind, [string, string]>> = {
  cone: ['cone', 'cones'],
  marker: ['flat marker', 'flat markers'],
  goal: ['goal', 'goals'],
  mini_goal: ['mini goal', 'mini goals'],
  mannequin: ['mannequin', 'mannequins'],
  ball: ['ball', 'balls'],
}

export function layoutKitLines(layout: DrillLayout): string[] {
  const counts = layoutEntityCounts(layout)
  const lines: string[] = []
  for (const kind of LAYOUT_ENTITY_KINDS) {
    const label = KIT_LABELS[kind]
    if (!label || counts[kind] === 0) continue
    lines.push(`${counts[kind]} ${counts[kind] === 1 ? label[0] : label[1]}`)
  }
  return lines
}

// Whether a declared area fits inside a box of real metres, allowing the
// ninety degree turn: a 12 by 8 drill fits an 8 by 12 station.
export function areaFits(area: LayoutArea, box: { width: number; length: number }): boolean {
  return (
    (area.width <= box.width && area.length <= box.length) ||
    (area.length <= box.width && area.width <= box.length)
  )
}

// The uniform scale that fits the area into a box while keeping it scale
// true; over 1 means the box has room to spare, under 1 means the drill
// would have to shrink. The composer warns from this without blocking.
export function areaFitScale(area: LayoutArea, box: { width: number; length: number }): number {
  const straight = Math.min(box.width / area.width, box.length / area.length)
  const turned = Math.min(box.width / area.length, box.length / area.width)
  return Math.max(straight, turned)
}
