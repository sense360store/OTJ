// OTJ Training Hub, public programme renderer (Content Sharing PR 4).
//
// A pure, presentational view of a PUBLIC programme snapshot, used in two
// places:
//   - the coach's pre-publish preview (mode="preview"), and
//   - the anonymous public page (mode="public").
//
// It imports only React, the pure publicShare types and the drill renderer
// (PublicDrillView and its header pieces), so the anonymous page renders a
// shared programme without the authenticated data layer. Every referenced drill
// renders through the SAME PublicDrillView as a shared drill, so a programme's
// drills read identically to a standalone shared drill and to a shared session's.
//
// Media lives in one flat top-level pool on the snapshot; each referenced drill
// points into it by ref (mediaRefs) and the optional attached PDF points into it
// by a single ref. This view resolves those refs, so signed URLs flow through
// exactly as they do for a drill or a session.
//
// This is a separate, explicit renderer, not a generic one. A programme, a
// session and a drill each have their own validator and their own view; there is
// no shared "render whatever kind arrives" path that could expose a future kind.

import { ListBlock, MetaPill, PublicDrillView, TextBlock } from './PublicDrillView'
import type {
  PublicDrillMedia,
  PublicDrillSnapshot,
  PublicProgrammeSnapshot,
  PublicProgrammeWeek,
  PublicReferencedDrill,
} from '../lib/publicShare'

// Turn a referenced drill (fields + mediaRefs) plus the programme media pool
// into a full public drill snapshot PublicDrillView can render, resolving each
// media ref to its pooled entry (which carries the signed url in public mode).
function toDrillSnapshot(
  drill: PublicReferencedDrill,
  mediaByRef: Map<string, PublicDrillMedia>,
  snapshotVersion: number,
  snapshotAt: string,
): PublicDrillSnapshot {
  // `fields` keeps the drill's snapshot-local `ref`, a harmless extra key the
  // drill renderer ignores; only `mediaRefs` is resolved against the pool.
  const { mediaRefs, ...fields } = drill
  const media = mediaRefs
    .map((r) => mediaByRef.get(r))
    .filter((m): m is PublicDrillMedia => !!m)
  return { snapshotVersion, kind: 'drill', ...fields, media, snapshotAt }
}

function ProgrammeWeek({
  week,
  snapshot,
  mediaByRef,
  drillByRef,
  mode,
}: {
  week: PublicProgrammeWeek
  snapshot: PublicProgrammeSnapshot
  mediaByRef: Map<string, PublicDrillMedia>
  drillByRef: Map<string, PublicReferencedDrill>
  mode: 'preview' | 'public'
}) {
  const empty = week.activities.length === 0
  return (
    <li className="public-week">
      <div className="public-week-head">
        <h3 className="public-week-title">
          <span className="public-week-number">Week {week.week}</span>
          {week.title && <span className="public-week-name">{week.title}</span>}
        </h3>
        <div className="public-week-meta">
          {week.focus && <span className="public-pill public-week-focus">{week.focus}</span>}
          {week.totalDuration > 0 && (
            <span className="public-pill public-activity-duration">{week.totalDuration} min</span>
          )}
        </div>
      </div>

      {empty
        ? <p className="muted public-week-empty">No plan for this week yet.</p>
        : (
          <ol className="public-activities">
            {week.activities.map((a, i) => {
              const drill = a.drillRef ? drillByRef.get(a.drillRef) : null
              return (
                <li key={i} className="public-activity">
                  <div className="public-activity-head">
                    {a.phase && <span className="public-pill public-activity-phase">{a.phase}</span>}
                    {typeof a.duration === 'number' && (
                      <span className="public-pill public-activity-duration">{a.duration} min</span>
                    )}
                    {!drill && a.customTitle && (
                      <span className="public-activity-title">{a.customTitle}</span>
                    )}
                  </div>
                  {drill && (
                    <PublicDrillView
                      snapshot={toDrillSnapshot(drill, mediaByRef, snapshot.snapshotVersion, snapshot.snapshotAt)}
                      mode={mode}
                    />
                  )}
                </li>
              )
            })}
          </ol>
        )}
    </li>
  )
}

export function PublicProgrammeView({
  snapshot,
  mode,
}: {
  snapshot: PublicProgrammeSnapshot
  mode: 'preview' | 'public'
}) {
  const Heading = mode === 'public' ? 'h1' : 'h2'
  const mediaByRef = new Map(snapshot.media.map((m) => [m.ref, m]))
  const drillByRef = new Map(snapshot.referencedDrills.map((d) => [d.ref, d]))

  const meta: Array<{ label: string; value: string }> = []
  if (snapshot.focus) meta.push({ label: 'Focus', value: snapshot.focus })
  if (snapshot.weekTemplates.length > 0) {
    meta.push({ label: 'Weeks', value: String(snapshot.weekTemplates.length) })
  }

  // The attached PDF resolves through the same pool as every other media item,
  // so it carries a signed url in public mode and nothing at all when it was not
  // eligible for signing.
  const pdf = snapshot.pdf ? mediaByRef.get(snapshot.pdf.ref) ?? null : null

  return (
    <article className="public-programme">
      <header className="public-drill-head">
        <Heading className="public-title">{snapshot.displayTitle}</Heading>
      </header>

      {meta.length > 0 && (
        <div className="public-meta" aria-label="Programme details">
          {meta.map((m) => <MetaPill key={m.label} label={m.label} value={m.value} />)}
        </div>
      )}

      <TextBlock heading="Summary" body={snapshot.summary ?? ''} />
      <ListBlock heading="Intentions" items={snapshot.intentions} />

      {pdf && (
        <section className="public-block public-programme-pdf">
          <h2 className="public-block-head">Programme document</h2>
          {pdf.url
            ? (
              <a className="btn" href={pdf.url} target="_blank" rel="noopener noreferrer">
                Open {pdf.caption ?? 'the programme PDF'}
              </a>
            )
            : <p className="muted">{pdf.caption ?? 'A programme document is attached.'}</p>}
          {pdf.sourceAttribution && (
            <p className="public-media-attribution">
              <span className="muted">Source: </span>
              <a href={pdf.sourceAttribution.url} target="_blank" rel="noopener noreferrer nofollow">
                {pdf.sourceAttribution.label ?? pdf.sourceAttribution.url}
              </a>
            </p>
          )}
        </section>
      )}

      <section className="public-block">
        <h2 className="public-block-head">Weekly plan</h2>
        <ol className="public-weeks">
          {snapshot.weekTemplates.map((w) => (
            <ProgrammeWeek
              key={w.week}
              week={w}
              snapshot={snapshot}
              mediaByRef={mediaByRef}
              drillByRef={drillByRef}
              mode={mode}
            />
          ))}
        </ol>
      </section>

      {snapshot.sourceAttribution && (
        <section className="public-block public-attribution">
          <span className="muted">Source: </span>
          <a href={snapshot.sourceAttribution.url} target="_blank" rel="noopener noreferrer nofollow">
            {snapshot.sourceAttribution.label ?? snapshot.sourceAttribution.url}
          </a>
        </section>
      )}
    </article>
  )
}
