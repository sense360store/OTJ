// The tactics board: place numbered discs on a pitch and drag them into shape.
// Phase one is standalone and frontend only. It follows sessions.create, the
// same coaching write capability as the planner, so coaches and admins reach
// it and parents do not. Nothing here is saved; the board lives in component
// state for the session only and clears on reload. Positions are held as
// fractions of the pitch, the clean shape a later phase will persist and embed
// elsewhere.
import { useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { useTeams } from '../lib/queries'
import {
  FORMATIONS,
  formationPositions,
  nextNumber,
  type Token,
  type TokenSide,
} from '../lib/tacticsBoard'
import { Icon } from '../components/icons'
import { TacticsPitch } from '../components/TacticsPitch'
import './Board.css'

export function Board() {
  const { profile } = useAuth()
  const { data: teams } = useTeams()
  const teamList = teams ?? []
  // The team selector is the roster source seam. There is no player roster
  // table yet, so it defaults to the coach's team and frames the board; tokens
  // come from the formation picker and the add control until a roster lands.
  const [teamId, setTeamId] = useState<string | null>(null)
  const selectedTeam = teamId ?? profile?.team_id ?? teamList[0]?.id ?? ''

  const [tokens, setTokens] = useState<Token[]>([])
  // The side new tokens and formations take, the "show shape against
  // opposition" control: place one side, switch, place the other.
  const [side, setSide] = useState<TokenSide>('home')

  // Placing a formation replaces that side's tokens and leaves the other side
  // alone, so home and away can sit on the board together.
  function placeFormation(key: string) {
    if (!key) return
    const placed = formationPositions(key, side)
    setTokens((prev) => [...prev.filter((t) => t.side !== side), ...placed])
  }

  function addToken() {
    const number = nextNumber(tokens, side)
    setTokens((prev) => [
      ...prev,
      { id: `${side}-${number}`, number, label: '', side, x: 0.5, y: side === 'home' ? 0.62 : 0.38 },
    ])
  }

  // Remove the most recently added token; the per disc affordance is left for a
  // later phase.
  function removeToken() {
    setTokens((prev) => prev.slice(0, -1))
  }

  function moveToken(id: string, x: number, y: number) {
    setTokens((prev) => prev.map((t) => (t.id === id ? { ...t, x, y } : t)))
  }

  function labelToken(id: string, label: string) {
    setTokens((prev) => prev.map((t) => (t.id === id ? { ...t, label } : t)))
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Tactics board</h2>
          <div className="sub">Place players and drag them into shape. Nothing is saved; the board clears on reload.</div>
        </div>
      </div>

      <div className="card board-controls">
        <label className="board-field">
          <span>Team</span>
          <select className="select" value={selectedTeam} onChange={(e) => setTeamId(e.target.value)}>
            {teamList.length === 0 && <option value="">No teams</option>}
            {teamList.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>

        <label className="board-field">
          <span>Formation</span>
          <select className="select" value="" onChange={(e) => placeFormation(e.target.value)}>
            <option value="">Place a formation…</option>
            {FORMATIONS.map((f) => (
              <option key={f.key} value={f.key}>
                {f.label}
              </option>
            ))}
          </select>
        </label>

        <div className="board-field">
          <span>Add as</span>
          <div className="board-side-toggle" role="group" aria-label="Token colour">
            <button
              type="button"
              className={'board-side home' + (side === 'home' ? ' active' : '')}
              aria-pressed={side === 'home'}
              onClick={() => setSide('home')}
            >
              Home
            </button>
            <button
              type="button"
              className={'board-side away' + (side === 'away' ? ' active' : '')}
              aria-pressed={side === 'away'}
              onClick={() => setSide('away')}
            >
              Away
            </button>
          </div>
        </div>

        <div className="board-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={addToken}>
            <Icon.plus />
            Add token
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={removeToken} disabled={tokens.length === 0}>
            <Icon.x />
            Remove token
          </button>
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => setTokens([])} disabled={tokens.length === 0}>
            <Icon.trash />
            Clear board
          </button>
        </div>
      </div>

      <TacticsPitch tokens={tokens} onMove={moveToken} onLabel={labelToken} />
    </div>
  )
}
