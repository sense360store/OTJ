// The layout editor's pure model (ADR-0008, PR 10): every operation takes
// a DrillLayout and returns a new one that still validates clean, so the
// component is only pointers and buttons over these functions. The shared
// identity rule is enforced here: a piece is added to and removed from
// every phase together; zones and arrows belong to one phase. Undo and
// redo are snapshot stacks, capped, held in React state only, never in
// browser storage.
import {
  AREA_MAX_METRES,
  AREA_MIN_METRES,
  LAYOUT_LABEL_MAX,
  LAYOUT_MAX_ARROWS_PER_FRAME,
  LAYOUT_MAX_ENTITIES_PER_FRAME,
  LAYOUT_MAX_FRAMES,
  LAYOUT_MAX_ZONES_PER_FRAME,
  LAYOUT_NOTE_MAX,
  LAYOUT_ZONE_LABEL_MAX,
  type DrillLayout,
  type LayoutArrowKind,
  type LayoutEntity,
  type LayoutEntityKind,
  type LayoutPoint,
  type LayoutTeam,
} from './drillLayout'

// A fresh layout for a new drill: a sensible training grid, one phase,
// nothing placed yet.
export function emptyLayout(width = 20, length = 15): DrillLayout {
  return { version: 1, area: { width, length }, frames: [{ entities: [], zones: [], arrows: [] }] }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

// Coordinates snap to a tenth of a metre: precise enough for a diagram,
// stable enough that markup and undo snapshots compare cleanly.
export const snapMetre = (v: number) => Math.round(v * 10) / 10

function clampPoint(p: LayoutPoint, layout: DrillLayout): LayoutPoint {
  return {
    x: snapMetre(clamp(p.x, 0, layout.area.width)),
    y: snapMetre(clamp(p.y, 0, layout.area.length)),
  }
}

// Ids are layout local: e1, z1, a1 counting past everything ever used in
// any phase, so a removed piece's id is not reused within the session.
function nextId(layout: DrillLayout, prefix: string): string {
  let highest = 0
  for (const f of layout.frames) {
    for (const list of [f.entities, f.zones, f.arrows] as { id: string }[][]) {
      for (const item of list) {
        const m = item.id.match(/^([a-z]+)(\d+)$/)
        if (m && m[1] === prefix) highest = Math.max(highest, Number(m[2]))
      }
    }
  }
  return `${prefix}${highest + 1}`
}

// ---- Pieces (every phase together) ------------------------------------------

export function addEntity(
  layout: DrillLayout,
  kind: LayoutEntityKind,
  at: LayoutPoint,
  team?: LayoutTeam,
): DrillLayout | null {
  if (layout.frames[0].entities.length >= LAYOUT_MAX_ENTITIES_PER_FRAME) return null
  const entity: LayoutEntity = { id: nextId(layout, 'e'), kind, ...clampPoint(at, layout) }
  if (kind === 'player') entity.team = team ?? 'attack'
  return { ...layout, frames: layout.frames.map((f) => ({ ...f, entities: [...f.entities, { ...entity }] })) }
}

export function removeEntity(layout: DrillLayout, id: string): DrillLayout {
  return { ...layout, frames: layout.frames.map((f) => ({ ...f, entities: f.entities.filter((e) => e.id !== id) })) }
}

export function moveEntity(layout: DrillLayout, frame: number, id: string, to: LayoutPoint): DrillLayout {
  const at = clampPoint(to, layout)
  return {
    ...layout,
    frames: layout.frames.map((f, i) =>
      i === frame ? { ...f, entities: f.entities.map((e) => (e.id === id ? { ...e, ...at } : e)) } : f,
    ),
  }
}

// The label is the piece's tag, the same in every phase; it is capped hard
// so it can never hold a name.
export function setEntityLabel(layout: DrillLayout, id: string, label: string): DrillLayout {
  const value = label.slice(0, LAYOUT_LABEL_MAX)
  return {
    ...layout,
    frames: layout.frames.map((f) => ({
      ...f,
      entities: f.entities.map((e) => (e.id === id ? { ...e, ...(value ? { label: value } : { label: undefined }) } : e)),
    })),
  }
}

export function setEntityTeam(layout: DrillLayout, id: string, team: LayoutTeam): DrillLayout {
  return {
    ...layout,
    frames: layout.frames.map((f) => ({
      ...f,
      entities: f.entities.map((e) => (e.id === id && e.kind === 'player' ? { ...e, team } : e)),
    })),
  }
}

// Rotation belongs to the current phase: a later phase may turn a piece.
export function rotateEntity(layout: DrillLayout, frame: number, id: string, by = 45): DrillLayout {
  return {
    ...layout,
    frames: layout.frames.map((f, i) =>
      i === frame
        ? { ...f, entities: f.entities.map((e) => (e.id === id ? { ...e, rotation: ((e.rotation ?? 0) + by) % 360 } : e)) }
        : f,
    ),
  }
}

// ---- Zones and arrows (one phase) -------------------------------------------

export function addZone(layout: DrillLayout, frame: number, at: LayoutPoint): DrillLayout | null {
  if (layout.frames[frame].zones.length >= LAYOUT_MAX_ZONES_PER_FRAME) return null
  const width = Math.min(5, layout.area.width)
  const height = Math.min(5, layout.area.length)
  const x = snapMetre(clamp(at.x, 0, layout.area.width - width))
  const y = snapMetre(clamp(at.y, 0, layout.area.length - height))
  const zone = { id: nextId(layout, 'z'), x, y, width, height }
  return { ...layout, frames: layout.frames.map((f, i) => (i === frame ? { ...f, zones: [...f.zones, zone] } : f)) }
}

export function resizeZone(layout: DrillLayout, frame: number, id: string, width: number, height: number): DrillLayout {
  return {
    ...layout,
    frames: layout.frames.map((f, i) =>
      i === frame
        ? {
            ...f,
            zones: f.zones.map((z) => {
              if (z.id !== id) return z
              const w = snapMetre(clamp(width, 0.5, layout.area.width - z.x))
              const h = snapMetre(clamp(height, 0.5, layout.area.length - z.y))
              return { ...z, width: w, height: h }
            }),
          }
        : f,
    ),
  }
}

export function moveZone(layout: DrillLayout, frame: number, id: string, to: LayoutPoint): DrillLayout {
  return {
    ...layout,
    frames: layout.frames.map((f, i) =>
      i === frame
        ? {
            ...f,
            zones: f.zones.map((z) => {
              if (z.id !== id) return z
              const x = snapMetre(clamp(to.x, 0, layout.area.width - z.width))
              const y = snapMetre(clamp(to.y, 0, layout.area.length - z.height))
              return { ...z, x, y }
            }),
          }
        : f,
    ),
  }
}

export function setZoneLabel(layout: DrillLayout, frame: number, id: string, label: string): DrillLayout {
  const value = label.slice(0, LAYOUT_ZONE_LABEL_MAX)
  return {
    ...layout,
    frames: layout.frames.map((f, i) =>
      i === frame
        ? { ...f, zones: f.zones.map((z) => (z.id === id ? { ...z, ...(value ? { label: value } : { label: undefined }) } : z)) }
        : f,
    ),
  }
}

export function removeZone(layout: DrillLayout, frame: number, id: string): DrillLayout {
  return {
    ...layout,
    frames: layout.frames.map((f, i) => (i === frame ? { ...f, zones: f.zones.filter((z) => z.id !== id) } : f)),
  }
}

export function addArrow(
  layout: DrillLayout,
  frame: number,
  kind: LayoutArrowKind,
  from: LayoutPoint,
  to: LayoutPoint,
): DrillLayout | null {
  if (layout.frames[frame].arrows.length >= LAYOUT_MAX_ARROWS_PER_FRAME) return null
  const a = clampPoint(from, layout)
  const b = clampPoint(to, layout)
  if (a.x === b.x && a.y === b.y) return null
  const arrow = { id: nextId(layout, 'a'), kind, from: a, to: b }
  return { ...layout, frames: layout.frames.map((f, i) => (i === frame ? { ...f, arrows: [...f.arrows, arrow] } : f)) }
}

export function removeArrow(layout: DrillLayout, frame: number, id: string): DrillLayout {
  return {
    ...layout,
    frames: layout.frames.map((f, i) => (i === frame ? { ...f, arrows: f.arrows.filter((a) => a.id !== id) } : f)),
  }
}

// ---- Phases -----------------------------------------------------------------

// A new phase is the current one duplicated: the same pieces standing
// where they stand, ready to be moved. Zones and arrows copy too, then
// diverge freely.
export function duplicatePhase(layout: DrillLayout, frame: number): DrillLayout | null {
  if (layout.frames.length >= LAYOUT_MAX_FRAMES) return null
  const copy = structuredClone(layout.frames[frame])
  const frames = [...layout.frames]
  frames.splice(frame + 1, 0, copy)
  return { ...layout, frames }
}

export function removePhase(layout: DrillLayout, frame: number): DrillLayout | null {
  if (layout.frames.length <= 1) return null
  return { ...layout, frames: layout.frames.filter((_, i) => i !== frame) }
}

export function setPhaseNote(layout: DrillLayout, frame: number, note: string): DrillLayout {
  const value = note.slice(0, LAYOUT_NOTE_MAX)
  return {
    ...layout,
    frames: layout.frames.map((f, i) => (i === frame ? { ...f, ...(value ? { note: value } : { note: undefined }) } : f)),
  }
}

// ---- Area -------------------------------------------------------------------

// Resizing the area keeps every piece, zone and arrow inside the new
// bounds, so the result always validates clean.
export function setArea(layout: DrillLayout, width: number, length: number): DrillLayout {
  const w = clamp(Math.round(width), AREA_MIN_METRES, AREA_MAX_METRES)
  const l = clamp(Math.round(length), AREA_MIN_METRES, AREA_MAX_METRES)
  const next: DrillLayout = { ...layout, area: { width: w, length: l }, frames: [] }
  next.frames = layout.frames.map((f) => ({
    ...f,
    entities: f.entities.map((e) => ({ ...e, ...clampPoint(e, next) })),
    zones: f.zones.map((z) => {
      const zw = Math.min(z.width, w)
      const zh = Math.min(z.height, l)
      return {
        ...z,
        width: zw,
        height: zh,
        x: snapMetre(clamp(z.x, 0, w - zw)),
        y: snapMetre(clamp(z.y, 0, l - zh)),
      }
    }),
    arrows: f.arrows.map((a) => ({ ...a, from: clampPoint(a.from, next), to: clampPoint(a.to, next) })),
  }))
  return next
}

// ---- History ----------------------------------------------------------------

export const HISTORY_CAP = 50

export interface EditorHistory {
  layout: DrillLayout
  past: DrillLayout[]
  future: DrillLayout[]
}

export function historyOf(layout: DrillLayout): EditorHistory {
  return { layout, past: [], future: [] }
}

// Every committed change lands through here: the old layout joins the
// past, the future is discarded, the cap drops the oldest snapshot.
export function commit(h: EditorHistory, next: DrillLayout): EditorHistory {
  if (next === h.layout) return h
  const past = [...h.past, h.layout]
  if (past.length > HISTORY_CAP) past.shift()
  return { layout: next, past, future: [] }
}

export function undo(h: EditorHistory): EditorHistory {
  if (h.past.length === 0) return h
  return {
    layout: h.past[h.past.length - 1],
    past: h.past.slice(0, -1),
    future: [h.layout, ...h.future],
  }
}

export function redo(h: EditorHistory): EditorHistory {
  if (h.future.length === 0) return h
  return {
    layout: h.future[0],
    past: [...h.past, h.layout],
    future: h.future.slice(1),
  }
}

// Whether the drill form offers the diagram affordance at all: never on
// an imported drill (a source URL marks FA and other third party
// content, which is never retrofitted), always on the club's own.
export function canEditLayout(sourceUrl: string): boolean {
  return sourceUrl.trim() === ''
}
