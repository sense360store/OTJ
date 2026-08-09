// The printable setup sheet (ADR-0008, PR 11): one page a coach prints
// and puts in a pocket, or hands to whoever is setting the grass out. It
// renders hidden on screen and appears only in print, so it carries the
// whole session whatever tab is open: the plan on the area, the stations
// in order, the kit to bring, and the running order.
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
import { SetupSchematic } from './SetupSchematic'
import './SetupSheet.css'

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
  return (
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
}
