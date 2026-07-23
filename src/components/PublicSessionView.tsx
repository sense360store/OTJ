// OTJ Training Hub, public session renderer (Content Sharing PR 3).
//
// A pure, presentational view of a PUBLIC session snapshot, used in two places:
//   - the coach's pre-publish preview (mode="preview"), and
//   - the anonymous public page (mode="public").
//
// It imports only React, the pure publicShare types, the drill renderer
// (PublicDrillView and its header pieces) and the pure pitch markings, so the
// anonymous page renders a shared session without the authenticated data layer.
// Every referenced drill renders through the SAME PublicDrillView as a shared
// drill, so a session's drills read identically to a standalone shared drill.
//
// Media lives in one flat top-level pool on the snapshot; each referenced drill
// points into it by ref (mediaRefs). This view resolves those refs and hands a
// synthesised drill snapshot (with its media populated) to PublicDrillView, so
// signed URLs flow through exactly as they do for a drill.
//
// The board is shape and numbers only. There is no name resolution path here at
// all: PublicBoard renders a disc per token from {number, side, x, y}, never a
// playerId and never a name, honouring the registered players board boundary.

import { ListBlock, MetaPill, PublicDrillView, TextBlock } from './PublicDrillView'
import { PitchMarkings } from './TacticsBoardView'
import type {
  PublicDrillMedia,
  PublicDrillSnapshot,
  PublicReferencedDrill,
  PublicSessionBoard,
  PublicSessionSnapshot,
} from '../lib/publicShare'
import '../routes/Board.css'

// Clamp a pitch fraction into [0, 100] percent; a public snapshot is already
// clamped server side, this is a second guard so a bad value never renders off
// pitch.
function clampPct(value: number): number {
  if (!Number.isFinite(value)) return 50
  return Math.max(0, Math.min(1, value)) * 100
}

// The read only public board: the shared pitch markings plus a static disc per
// token. No names, no playerId, no pointer handlers. Mirrors TacticsBoardView's
// disc geometry but has no names map code path by construction.
function PublicBoard({ board }: { board: PublicSessionBoard }) {
  return (
    <div className="board-pitch board-pitch-readonly">
      <PitchMarkings />
      {board.tokens.map((t, i) => (
        <div
          key={i}
          className={`board-token side-${t.side === 'away' ? 'away' : 'home'}`}
          style={{ left: `${clampPct(t.x)}%`, top: `${clampPct(t.y)}%` }}
        >
          <span className="board-disc board-disc-static" aria-label={`Player ${t.number ?? ''}`}>
            {t.number ?? ''}
          </span>
        </div>
      ))}
    </div>
  )
}

// Turn a referenced drill (fields + mediaRefs) plus the session media pool into
// a full public drill snapshot PublicDrillView can render, resolving each media
// ref to its pooled entry (which carries the signed url in public mode).
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

export function PublicSessionView({
  snapshot,
  mode,
}: {
  snapshot: PublicSessionSnapshot
  mode: 'preview' | 'public'
}) {
  const Heading = mode === 'public' ? 'h1' : 'h2'
  const mediaByRef = new Map(snapshot.media.map((m) => [m.ref, m]))
  const drillByRef = new Map(snapshot.referencedDrills.map((d) => [d.ref, d]))

  const meta: Array<{ label: string; value: string }> = []
  if (snapshot.ageGroup) meta.push({ label: 'Age group', value: snapshot.ageGroup })
  if (typeof snapshot.totalDuration === 'number' && snapshot.totalDuration > 0) {
    meta.push({ label: 'Duration', value: `${snapshot.totalDuration} min` })
  }
  if (snapshot.focus) meta.push({ label: 'Focus', value: snapshot.focus })

  return (
    <article className="public-session">
      <header className="public-drill-head">
        <Heading className="public-title">{snapshot.displayTitle}</Heading>
      </header>

      {meta.length > 0 && (
        <div className="public-meta" aria-label="Session details">
          {meta.map((m) => <MetaPill key={m.label} label={m.label} value={m.value} />)}
        </div>
      )}

      <ListBlock heading="Intentions" items={snapshot.intentions} />
      <TextBlock heading="Space" body={snapshot.space ?? ''} />

      {snapshot.board && (
        <section className="public-block">
          <h2 className="public-block-head">Tactics board</h2>
          <PublicBoard board={snapshot.board} />
        </section>
      )}

      <section className="public-block">
        <h2 className="public-block-head">Session plan</h2>
        <ol className="public-activities">
          {snapshot.activities.map((a, i) => {
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
