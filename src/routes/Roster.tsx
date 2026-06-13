// The team roster manager, behind sessions.create (coaches and admins, never
// parents), backed by the players RLS. A roster is the optional, opt in source
// the tactics board can seed from instead of a formation. It holds the first
// child data the app stores, so it stays minimal: a display name, an optional
// shirt number, and the team. There is no date of birth, contact, medical or
// any other field, and parents never reach this screen (see 0021_players.sql).
// REVIEW: child data surface.
import { useMemo, useState } from 'react'
import { useDeletePlayer, useInsertPlayer, useMyCapabilities, usePlayers, useTeams, useUpdatePlayer } from '../lib/queries'
import type { Player } from '../lib/data'
import { Icon } from '../components/icons'
import { ErrorNote, Loading, Modal } from '../components/ui'

// Parse the optional shirt number field: empty clears it, a 1 to 99 integer
// sets it, anything else is rejected so the input never sends a bad value past
// the column check. Returns undefined to mean "invalid, do not submit".
function parseShirt(raw: string): number | null | undefined {
  const trimmed = raw.trim()
  if (trimmed === '') return null
  const n = Number(trimmed)
  if (!Number.isInteger(n) || n < 1 || n > 99) return undefined
  return n
}

function DeletePlayerModal({ player, onClose }: { player: Player; onClose: () => void }) {
  const del = useDeletePlayer()
  const remove = () => del.mutate({ id: player.id }, { onSuccess: onClose })
  return (
    <Modal
      title="Remove player"
      sub={player.displayName}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={del.isPending}>
            Cancel
          </button>
          <button className="btn btn-primary" style={{ background: 'var(--m-pdf)' }} onClick={remove} disabled={del.isPending}>
            <Icon.trash />
            {del.isPending ? 'Removing…' : 'Remove'}
          </button>
        </>
      }
    >
      <p style={{ fontSize: 14.5, lineHeight: 1.55 }}>
        This removes the player from the roster. Any saved board is a snapshot and keeps the name it was saved with, so no
        board is affected.
      </p>
      {del.isError && (
        <p className="muted" style={{ color: 'var(--m-pdf)', fontSize: 13.5 }}>
          Could not remove the player. Try again.
        </p>
      )}
    </Modal>
  )
}

function PlayerRow({ player, onDelete }: { player: Player; onDelete: () => void }) {
  const update = useUpdatePlayer()
  const [name, setName] = useState(player.displayName)
  const [shirt, setShirt] = useState(player.shirtNumber == null ? '' : String(player.shirtNumber))

  const parsedShirt = parseShirt(shirt)
  const shirtInvalid = parsedShirt === undefined
  const nameChanged = name.trim() !== player.displayName && name.trim() !== ''
  const shirtChanged = !shirtInvalid && parsedShirt !== player.shirtNumber
  const changed = (nameChanged || shirtChanged) && !shirtInvalid

  const save = () => {
    if (!changed) return
    update.mutate({
      id: player.id,
      displayName: nameChanged ? name.trim() : undefined,
      shirtNumber: shirtChanged ? parsedShirt : undefined,
    })
  }

  return (
    <div className="row" style={{ gap: 10, padding: '10px 0', borderTop: '1px solid var(--line)' }}>
      <div className="field" style={{ flex: 1, marginBottom: 0 }}>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} aria-label="Player name" />
      </div>
      <div className="field" style={{ width: 76, marginBottom: 0 }}>
        <input
          value={shirt}
          onChange={(e) => setShirt(e.target.value)}
          inputMode="numeric"
          placeholder="No."
          aria-label="Shirt number"
          aria-invalid={shirtInvalid}
        />
      </div>
      <button className="btn btn-ghost btn-sm" disabled={!changed || update.isPending} onClick={save}>
        <Icon.check />
        Save
      </button>
      <button
        className="btn btn-ghost btn-sm icon-only"
        style={{ width: 38, padding: 0 }}
        aria-label={'Remove ' + player.displayName}
        onClick={onDelete}
      >
        <Icon.trash />
      </button>
    </div>
  )
}

export function Roster() {
  const { caps } = useMyCapabilities()
  const { data: teams = [], isLoading: teamsLoading, isError: teamsError } = useTeams()
  const { data: players = [], isLoading: playersLoading, isError: playersError } = usePlayers()

  const [teamId, setTeamId] = useState('')
  const selectedTeam = teamId || teams[0]?.id || ''

  const [newName, setNewName] = useState('')
  const [newShirt, setNewShirt] = useState('')
  const insert = useInsertPlayer()
  const [removing, setRemoving] = useState<Player | null>(null)

  const teamPlayers = useMemo(() => players.filter((p) => p.teamId === selectedTeam), [players, selectedTeam])

  if (teamsLoading || playersLoading) return <Loading />
  if (teamsError || playersError) return <ErrorNote />
  // The route guard already keeps members without sessions.create out; this is
  // belt and braces for the brief render before a redirect, and it matches the
  // players RLS so a parent never sees a name even mid-render.
  if (!caps.has('sessions.create')) return null

  const parsedNewShirt = parseShirt(newShirt)
  const newShirtInvalid = parsedNewShirt === undefined
  const canAdd = !!newName.trim() && !newShirtInvalid && !!selectedTeam && !insert.isPending

  const add = () => {
    if (!canAdd) return
    insert.mutate(
      { teamId: selectedTeam, displayName: newName.trim(), shirtNumber: parsedNewShirt ?? null },
      {
        onSuccess: () => {
          setNewName('')
          setNewShirt('')
        },
      },
    )
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Roster</h2>
          <div className="sub">
            A team's players, the optional source the tactics board can seed from. Store a name and shirt number only.
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: 18, maxWidth: 620 }}>
        <div className="field" style={{ maxWidth: 280 }}>
          <label>Team</label>
          <select className="select" value={selectedTeam} onChange={(e) => setTeamId(e.target.value)}>
            {teams.length === 0 && <option value="">No teams</option>}
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>

        <div className="row" style={{ gap: 10, marginTop: 14, alignItems: 'flex-end' }}>
          <div className="field" style={{ flex: 1, marginBottom: 0 }}>
            <label>New player</label>
            <input
              placeholder="First name or first name and last initial"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              maxLength={40}
              onKeyDown={(e) => e.key === 'Enter' && add()}
            />
          </div>
          <div className="field" style={{ width: 90, marginBottom: 0 }}>
            <label>Number</label>
            <input
              placeholder="Optional"
              value={newShirt}
              onChange={(e) => setNewShirt(e.target.value)}
              inputMode="numeric"
              aria-invalid={newShirtInvalid}
              onKeyDown={(e) => e.key === 'Enter' && add()}
            />
          </div>
          <button className="btn btn-primary" disabled={!canAdd} onClick={add}>
            <Icon.plus />
            Add
          </button>
        </div>
        {newShirtInvalid && (
          <p className="muted" style={{ fontSize: 12.5, color: 'var(--m-pdf)', marginTop: 8, marginBottom: 0 }}>
            Shirt number must be a whole number from 1 to 99.
          </p>
        )}
        {insert.isError && (
          <p className="muted" style={{ fontSize: 12.5, color: 'var(--m-pdf)', marginTop: 8, marginBottom: 0 }}>
            Could not add the player. Try again.
          </p>
        )}

        <div style={{ marginTop: 14 }}>
          {teamPlayers.map((p) => (
            <PlayerRow key={p.id} player={p} onDelete={() => setRemoving(p)} />
          ))}
          {teamPlayers.length === 0 && (
            <p className="muted" style={{ fontSize: 13.5 }}>
              No players on this team's roster yet. Add the first one above, or seed the board from a formation instead.
            </p>
          )}
        </div>
      </div>

      {removing && <DeletePlayerModal player={removing} onClose={() => setRemoving(null)} />}
    </div>
  )
}
