// The printable setup sheet (ADR-0008, PR 11): one page a coach prints
// and puts in a pocket, or hands to whoever is setting the grass out. It
// renders hidden on screen and appears only in print, so it carries the
// whole session whatever tab is open: the plan on the area, the stations
// in order, the kit to bring, and the running order.
//
// The sheet mounts outside the app's root through a portal, and the page
// that renders it marks the body while it is mounted. Print then hides
// the root and shows the sheet, both scoped to that mark, so no print
// rule reaches a route that never mounted a sheet: the public share
// page, the drill diagrams and every other print path are untouched.
// Without a document (the static test renderer) it renders in place.
//
// Presentational and exported for the static tests.
import type { LayoutArea } from '../lib/drillLayout'
import {
  stationInsideBoundary,
  stationSummary,
  type AreaFrame,
  type KitLine,
  type SchematicStation,
} from '../lib/sessionSetup'
import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { SetupSchematic } from './SetupSchematic'
import './SetupSheet.css'

export const PRINT_BODY_CLASS = 'otj-printing-setup'

export interface SheetActivity {
  title: string
  phase: string
  duration: number
}

export function SetupSheet({
  sessionName,
  subtitle,
  areaName,
  frame,
  stations,
  drillAreas,
  kit,
  activities,
}: {
  sessionName: string
  subtitle: string
  areaName: string
  frame: AreaFrame | null
  stations: SchematicStation[]
  drillAreas: Record<string, LayoutArea | null>
  kit: KitLine[]
  activities: SheetActivity[]
}) {
  const hasDocument = typeof document !== 'undefined'
  useEffect(() => {
    if (!hasDocument) return
    document.body.classList.add(PRINT_BODY_CLASS)
    return () => document.body.classList.remove(PRINT_BODY_CLASS)
  }, [hasDocument])
  const sheet = (
    <div className="setup-sheet" aria-hidden="true">
      <h1>{sessionName}</h1>
      <p className="setup-sheet-sub">{subtitle}</p>

      {frame && (
        <section>
          <h2>
            Setup on {areaName}, {Math.round(frame.width)} × {Math.round(frame.length)} m, north up
          </h2>
          <SetupSchematic frame={frame} stations={stations} />
          <ol className="setup-sheet-stations">
            {stations.map(({ station: s, title }, i) => (
              <li key={s.id}>
                <b>
                  {i + 1}. {s.label || title || 'Station'}
                </b>{' '}
                {stationSummary(s, (s.drillId ? drillAreas[s.drillId] : null) ?? null)}
                {!stationInsideBoundary(s, frame) && <em> · crosses the drawn boundary, check on the grass</em>}
              </li>
            ))}
          </ol>
        </section>
      )}

      <div className="setup-sheet-cols">
        <section>
          <h2>Kit</h2>
          {kit.length === 0 ? (
            <p>Nothing listed.</p>
          ) : (
            <ul className="setup-sheet-kit">
              {kit.map((k) => (
                <li key={k.name}>
                  {k.count === null ? k.name : `${k.count} ${k.name}`}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2>Running order</h2>
          <ol className="setup-sheet-plan">
            {activities.map((a, i) => (
              <li key={i}>
                {a.title} <span className="setup-sheet-meta">{a.phase} · {a.duration} min</span>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  )
  return hasDocument ? createPortal(sheet, document.body) : sheet
}
