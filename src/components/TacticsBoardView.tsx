// The read only tactics board renderer: the same pitch and discs the editable
// board draws, with no dragging, no inputs and no tools, just the snapshot.
// The editable board (TacticsPitch) and the embedded session day view share
// the pitch markings through PitchMarkings, so one source draws the grass and
// the lines for both, and the discs reuse the same token classes. Positions
// are pitch fractions, so an embedded board reads at any size.
//
// NAMES ARE RESOLVED, NEVER STORED. A token carries a playerId, not a name
// (see tacticsBoard.ts); the optional names map resolves it at render time.
// The map is built from the players query, whose row level security answers
// holders of sessions.create only, so a coach sees names and a parent, who
// has no map to pass and whose players query returns nothing anyway, sees
// shape and numbers alone. There is no name in the board payload to hide.
// The styles live in Board.css, which the consuming screen imports.
import { tokenDisplayName, tokenFirstName, type PlayerNameMap, type Token } from '../lib/tacticsBoard'

// The pitch grass, stripes and markings, drawn once and shared by the editable
// board and the read only view. A portrait 680 by 1050 viewBox the container
// holds the aspect ratio of, so the same board reads on a phone and a desktop.
export function PitchMarkings() {
  return (
    <svg className="board-pitch-svg" viewBox="0 0 680 1050" role="presentation" aria-hidden="true">
      {/* Mown stripes, six bands the length of the field. */}
      {Array.from({ length: 6 }, (_, i) => (
        <rect
          key={i}
          className={i % 2 === 0 ? 'pitch-stripe even' : 'pitch-stripe odd'}
          x={30}
          y={30 + i * 165}
          width={620}
          height={165}
        />
      ))}
      <g className="pitch-lines">
        {/* Touchlines and goal lines. */}
        <rect x={30} y={30} width={620} height={990} fill="none" />
        {/* Halfway line and centre circle. */}
        <line x1={30} y1={525} x2={650} y2={525} />
        <circle cx={340} cy={525} r={95} fill="none" />
        <circle cx={340} cy={525} r={5} className="pitch-spot" />
        {/* Top penalty area, goal area, penalty spot. */}
        <rect x={160} y={30} width={360} height={165} fill="none" />
        <rect x={250} y={30} width={180} height={65} fill="none" />
        <circle cx={340} cy={150} r={5} className="pitch-spot" />
        {/* Bottom penalty area, goal area, penalty spot. */}
        <rect x={160} y={855} width={360} height={165} fill="none" />
        <rect x={250} y={955} width={180} height={65} fill="none" />
        <circle cx={340} cy={900} r={5} className="pitch-spot" />
        {/* Goals, drawn just outside each goal line. */}
        <rect x={290} y={12} width={100} height={18} fill="none" />
        <rect x={290} y={1020} width={100} height={18} fill="none" />
      </g>
    </svg>
  )
}

// The read only board: the pitch plus static discs. No pointer handlers, no
// buttons and no inputs, so the snapshot cannot be dragged or edited. Each
// disc shows its number; when the names map resolves the token's playerId to
// a name, the first name renders beneath the disc with the full name on the
// title (hover or tap) and the disc's accessible name. Without a map, or for
// a token whose player is gone from the roster, the disc stands alone.
export function TacticsBoardView({ tokens, names }: { tokens: Token[]; names?: PlayerNameMap }) {
  return (
    <div className="board-pitch board-pitch-readonly">
      <PitchMarkings />
      {tokens.map((t) => {
        const name = tokenDisplayName(t, names)
        return (
          <div
            key={t.id}
            className={`board-token side-${t.side}`}
            style={{ left: `${t.x * 100}%`, top: `${t.y * 100}%` }}
          >
            <span
              className="board-disc board-disc-static"
              aria-label={`Player ${t.number}${name ? ` ${name}` : ''}`}
            >
              {t.number}
            </span>
            {name ? (
              <span className="board-token-label board-token-label-static" title={name}>
                {tokenFirstName(name)}
              </span>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
