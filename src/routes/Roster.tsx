// The team roster manager, the temporary Registered Players surface until PR 3.
// Read is behind players.view (coaches and admins read the whole club register,
// never parents); adding and editing require players.manage (managers and
// admins); the permanent Remove requires players.delete (admin only). It is
// backed by the players and player_registrations RLS. A roster is also the
// optional source the tactics board can seed from instead of a formation. It
// holds child data, so it stays minimal: a display name, an optional shirt
// number, and the team, and parents never reach this screen (see
// 0021_players.sql, 0032_registered_players.sql). REVIEW: child data surface.
import { useMemo, useRef, useState } from 'react'
import {
  useCurrentSeason,
  useDeletePlayer,
  useInsertPlayer,
  useMyCapabilities,
  usePlayers,
  useSpondMappings,
  useSpondRosterImport,
  useTeams,
  useUpdatePlayer,
} from '../lib/queries'
import { useGuardedSubmit } from '../hooks/useGuardedSubmit'
import { mappingForTeam } from '../lib/spond'
import { deleteConfirmed } from './rosterHelpers'
import type { Player, SpondMapping, Team } from '../lib/data'
import { Icon } from '../components/icons'
import { ActionError, ErrorNote, Loading, Modal } from '../components/ui'

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

// Permanent deletion is destructive and admin only (players.delete). It removes
// the stable identity and every one of the child's registrations, in every
// season, so the modal names that plainly, requires the admin to type the
// player's current display name to confirm, and cannot be dismissed while the
// delete is in flight (Escape, overlay and X are all suppressed). Withdraw
// remains the normal, reversible departure path in the Registered Players page
// (PR 3); this is the mistake-correction escape hatch only.
export function DeletePlayerModal({ player, onClose }: { player: Player; onClose: () => void }) {
  const del = useDeletePlayer()
  const [typed, setTyped] = useState('')
  const { submit, pending, failed } = useGuardedSubmit<{ id: string }, void>({
    operation: 'delete player',
    perform: ({ id }) => del.mutateAsync({ id }),
    onSuccess: () => onClose(),
  })
  const deleting = pending !== null
  const confirmed = deleteConfirmed(typed, player.displayName)
  const remove = () => {
    if (!confirmed || deleting) return
    void submit({ id: player.id })
  }
  return (
    <Modal
      title="Permanently delete player"
      sub={player.displayName}
      onClose={onClose}
      dismissible={!deleting}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={deleting}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            style={{ background: 'var(--m-pdf)' }}
            onClick={remove}
            disabled={!confirmed || deleting}
          >
            <Icon.trash />
            {deleting ? 'Deleting…' : 'Permanently delete'}
          </button>
        </>
      }
    >
      <p style={{ fontSize: 14.5, lineHeight: 1.55, marginTop: 0 }}>
        This permanently deletes <b>{player.displayName}</b> and every one of their registrations, in this season and
        every other. This cannot be undone. A saved board that includes this player keeps its shape; the disc simply
        shows its number without a name.
      </p>
      <p style={{ fontSize: 13.5, lineHeight: 1.5 }}>To confirm, type the player's name below.</p>
      <div className="field" style={{ marginBottom: 0 }}>
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder={player.displayName}
          aria-label="Type the player's name to confirm"
          disabled={deleting}
          autoFocus
        />
      </div>
      {failed && (
        <ActionError onRetry={confirmed ? remove : undefined} style={{ marginTop: 10 }}>
          Could not delete the player. Reload and try again.
        </ActionError>
      )}
    </Modal>
  )
}

function PlayerRow({
  player,
  canManage,
  canDelete,
  currentSeason,
  onDelete,
}: {
  player: Player
  canManage: boolean
  canDelete: boolean
  currentSeason: string | null
  onDelete: () => void
}) {
  const update = useUpdatePlayer()
  const [name, setName] = useState(player.displayName)
  const [shirt, setShirt] = useState(player.shirtNumber == null ? '' : String(player.shirtNumber))

  const parsedShirt = parseShirt(shirt)
  const shirtInvalid = parsedShirt === undefined
  const nameChanged = name.trim() !== player.displayName && name.trim() !== ''
  const shirtChanged = !shirtInvalid && parsedShirt !== player.shirtNumber
  const changed = (nameChanged || shirtChanged) && !shirtInvalid

  // The rename and the shirt change commit together through the update_player
  // RPC (one transaction), guarded so a double click or an ambiguous retry
  // never sends two edits. The edited values stay in the fields on failure so
  // Retry resends exactly what the coach typed.
  const { submit, pending, failed } = useGuardedSubmit<
    { displayName?: string; shirtNumber?: number | null },
    Player
  >({
    operation: 'update player',
    perform: (input) =>
      update.mutateAsync({ id: player.id, expectedSeason: currentSeason as string, ...input }),
    // The query invalidation refreshes the row; the edited values already sit in
    // the fields, so there is nothing to reset on success.
    onSuccess: () => {},
  })
  const saving = pending !== null
  const locked = !canManage || saving

  const save = () => {
    if (!changed || !canManage || !currentSeason || saving) return
    void submit({
      displayName: nameChanged ? name.trim() : undefined,
      shirtNumber: shirtChanged ? parsedShirt : undefined,
    })
  }

  return (
    <div style={{ padding: '10px 0', borderTop: '1px solid var(--line)' }}>
      <div className="row" style={{ gap: 10 }}>
        <div className="field" style={{ flex: 1, marginBottom: 0 }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={40}
            aria-label="Player name"
            readOnly={locked}
            disabled={locked}
          />
        </div>
        <div className="field" style={{ width: 76, marginBottom: 0 }}>
          <input
            value={shirt}
            onChange={(e) => setShirt(e.target.value)}
            inputMode="numeric"
            placeholder="No."
            aria-label="Shirt number"
            aria-invalid={shirtInvalid}
            readOnly={locked}
            disabled={locked}
          />
        </div>
        {canManage && (
          <button
            className="btn btn-ghost btn-sm"
            disabled={!changed || saving || !currentSeason}
            onClick={save}
          >
            <Icon.check />
            {saving ? 'Saving…' : 'Save'}
          </button>
        )}
        {canDelete && (
          <button
            className="btn btn-ghost btn-sm icon-only"
            style={{ width: 38, padding: 0 }}
            aria-label={'Delete ' + player.displayName}
            onClick={onDelete}
            disabled={saving}
          >
            <Icon.trash />
          </button>
        )}
      </div>
      {failed && (
        <ActionError onRetry={changed ? save : undefined} style={{ marginTop: 8 }}>
          Could not save the change. Try again.
        </ActionError>
      )}
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
      dismissible={!importer.isPending}
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
  // The season the screen is editing against. update_player pins the edit to it,
  // so a concurrent activation cannot silently redirect a shirt change.
  const { data: currentSeason } = useCurrentSeason()
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

  // A client minted stable id per add, so an ambiguous lost response retry
  // reuses the same identity (add_player is idempotent on it) rather than
  // duplicating the child. Cleared on success; kept on failure for the retry.
  const addId = useRef<string | null>(null)
  const { submit: submitAdd, pending: addPending, failed: addFailed } = useGuardedSubmit<
    { id: string; teamId: string; displayName: string; shirtNumber: number | null },
    Player
  >({
    operation: 'add player',
    perform: (input) => insert.mutateAsync(input),
    onSuccess: () => {
      addId.current = null
      setNewName('')
      setNewShirt('')
    },
  })

  // The interim Roster shows the selected team's current-season players. A
  // player whose team was deleted becomes Unassigned (teamId null) and does not
  // appear under any team filter; managing Unassigned players is a job for the
  // Registered Players page in PR 3, not this temporary surface. At PR 2 every
  // backfilled and newly added player has a team, so this is not a live gap.
  const teamPlayers = useMemo(() => players.filter((p) => p.teamId === selectedTeam), [players, selectedTeam])
  const spondMapping = mappingForTeam(mappings, selectedTeam)
  const selectedTeamObj = teams.find((t) => t.id === selectedTeam) ?? null

  if (teamsLoading || playersLoading) return <Loading />
  if (teamsError || playersError) return <ErrorNote />
  // The route guard already keeps members without players.view out; this is
  // belt and braces for the brief render before a redirect, and it matches the
  // players RLS so a parent never sees a name even mid-render.
  if (!caps.has('players.view')) return null

  // Read is club wide (players.view); writing is capability gated. A coach with
  // players.view sees a read only roster: no add, edit, remove or Spond import.
  const canManage = caps.has('players.manage')
  const canDelete = caps.has('players.delete')

  const parsedNewShirt = parseShirt(newShirt)
  const newShirtInvalid = parsedNewShirt === undefined
  const adding = addPending !== null
  const canAdd = canManage && !!newName.trim() && !newShirtInvalid && !!selectedTeam && !adding

  const add = () => {
    if (!canAdd) return
    if (!addId.current) addId.current = crypto.randomUUID()
    void submitAdd({
      id: addId.current,
      teamId: selectedTeam,
      displayName: newName.trim(),
      shirtNumber: parsedNewShirt ?? null,
    })
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
          {canManage && spondMapping && (
            <button className="btn btn-ghost" onClick={() => setImporting(true)}>
              <Icon.rotate />
              Import from Spond
            </button>
          )}
        </div>

        {canManage && (
          <>
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
            {addFailed && (
              <p className="muted" style={{ fontSize: 12.5, color: 'var(--m-pdf)', marginTop: 8, marginBottom: 0 }}>
                Could not add the player. Try again.
              </p>
            )}
          </>
        )}

        <div style={{ marginTop: 14 }}>
          {teamPlayers.map((p) => (
            <PlayerRow
              key={p.id}
              player={p}
              canManage={canManage}
              canDelete={canDelete}
              currentSeason={currentSeason?.id ?? null}
              onDelete={() => setRemoving(p)}
            />
          ))}
          {teamPlayers.length === 0 && (
            <p className="muted" style={{ fontSize: 13.5 }}>
              {canManage
                ? "No players on this team's roster yet. Add the first one above, or seed the board from a formation instead."
                : "No players on this team's roster yet."}
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
