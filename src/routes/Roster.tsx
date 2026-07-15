// The team roster manager, behind sessions.create (coaches and admins, never
// parents), backed by the players RLS. A roster is the optional, opt in source
// the tactics board can seed from instead of a formation. It holds the first
// child data the app stores, so it stays minimal: a display name, an optional
// shirt number, and the team. There is no date of birth, contact, medical or
// any other field, and parents never reach this screen (see 0021_players.sql).
// REVIEW: child data surface.
import { useMemo, useState } from 'react'
import {
  useDeletePlayer,
  useInsertPlayer,
  useMyCapabilities,
  usePlayers,
  useSpondMappings,
  useSpondRosterImport,
  useTeams,
  useUpdatePlayer,
} from '../lib/queries'
import { mappingForTeam } from '../lib/spond'
import type { Player, SpondMapping, Team } from '../lib/data'
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
        This removes the player from the roster. A saved board that includes this player keeps its shape; the disc simply
        shows its number without a name.
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

// Import from Spond: a deliberate, confirmed action that brings the children
// in the team's mapped Spond group into this roster. The confirm step notes
// that it imports player names, so it is never an accident. The browser never
// calls Spond; the Edge Function reads the names server side and returns
// counts (added, already present), the first time the Spond pipeline reads a
// name (CLAUDE.md, Spond integration; 0021_players.sql for the name boundary).
function ImportFromSpondModal({ team, mapping, onClose }: { team: Team; mapping: SpondMapping; onClose: () => void }) {
  const importer = useSpondRosterImport()
  const run = () => importer.mutate({ teamId: team.id })
  const result = importer.data

  return (
    <Modal
      title="Import from Spond"
      sub={team.name}
      onClose={onClose}
      footer={
        result ? (
          <button className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        ) : (
          <>
            <button className="btn btn-ghost" onClick={onClose} disabled={importer.isPending}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={run} disabled={importer.isPending}>
              <Icon.rotate />
              {importer.isPending ? 'Importing…' : 'Import'}
            </button>
          </>
        )
      }
    >
      {result ? (
        <div style={{ fontSize: 14.5, lineHeight: 1.55 }}>
          <p style={{ marginTop: 0 }}>
            {result.added} added, {result.alreadyPresent} already on the roster
            {result.skipped > 0 ? `, ${result.skipped} skipped` : ''}.
          </p>
          {result.message && (
            <p className="muted" style={{ fontSize: 13.5 }}>
              {result.message}
            </p>
          )}
          {result.warnings.map((w, i) => (
            <p key={i} className="muted" style={{ fontSize: 13, color: 'var(--m-pdf)' }}>
              {w}
            </p>
          ))}
        </div>
      ) : (
        <>
          <p style={{ fontSize: 14.5, lineHeight: 1.55, marginTop: 0 }}>
            This brings over player names from the mapped Spond group <b>{mapping.name}</b> into this team's roster. Each
            child's full name is stored. No guardian, contact or other Spond data is imported.
          </p>
          <p className="muted" style={{ fontSize: 13.5 }}>
            Players already on the roster are left as they are, so importing again adds no duplicates.
          </p>
          {importer.isError && (
            <p className="muted" style={{ fontSize: 13, color: 'var(--m-pdf)', marginBottom: 0 }}>
              {importer.error.message}
            </p>
          )}
        </>
      )}
    </Modal>
  )
}

export function Roster() {
  const { caps } = useMyCapabilities()
  const { data: teams = [], isLoading: teamsLoading, isError: teamsError } = useTeams()
  const { data: players = [], isLoading: playersLoading, isError: playersError } = usePlayers()
  // Club members read spond_groups club wide (no capability), so a coach can
  // see whether the selected team has a mapping. The import affordance shows
  // only when it does; the Edge Function is the real gate.
  const { data: mappings = [] } = useSpondMappings()

  const [teamId, setTeamId] = useState('')
  const selectedTeam = teamId || teams[0]?.id || ''

  const [newName, setNewName] = useState('')
  const [newShirt, setNewShirt] = useState('')
  const insert = useInsertPlayer()
  const [removing, setRemoving] = useState<Player | null>(null)
  const [importing, setImporting] = useState(false)

  const teamPlayers = useMemo(() => players.filter((p) => p.teamId === selectedTeam), [players, selectedTeam])
  const spondMapping = mappingForTeam(mappings, selectedTeam)
  const selectedTeamObj = teams.find((t) => t.id === selectedTeam) ?? null

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
        <div className="row" style={{ gap: 10, alignItems: 'flex-end' }}>
          <div className="field" style={{ maxWidth: 280, flex: 1, marginBottom: 0 }}>
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
          {spondMapping && (
            <button className="btn btn-ghost" onClick={() => setImporting(true)}>
              <Icon.rotate />
              Import from Spond
            </button>
          )}
        </div>

        <div className="row" style={{ gap: 10, marginTop: 14, alignItems: 'flex-end' }}>
          <div className="field" style={{ flex: 1, marginBottom: 0 }}>
            <label>New player</label>
            <input
              placeholder="Full name"
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
      {importing && spondMapping && selectedTeamObj && (
        <ImportFromSpondModal team={selectedTeamObj} mapping={spondMapping} onClose={() => setImporting(false)} />
      )}
    </div>
  )
}
