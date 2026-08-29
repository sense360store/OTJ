// The single-concern write modals for the Registered players page: Move team,
// Withdraw, Restore, Delete permanently, and the carried-over Import from Spond.
// Each follows the repo modal convention (footer Cancel then primary, pending
// gerund label, inline ActionError with Retry), makes no optimistic write, and
// passes dismissible={!pending} so a write in flight cannot be dismissed by the
// X, the overlay or Escape. The edited values stay put on failure so Retry
// resends exactly what the user chose. None of these logs or renders a child
// name beyond the display name the caller already holds.
//
// Presentation is the shared VISUAL-01 system: Button for every press, the
// Field primitives for every control, Note for a warning and the shared dialog
// prose classes for the sentences. Nothing here sets a font size.
import { useState } from 'react'
import {
  useDeletePlayer,
  useMovePlayerTeam,
  useSetRegistrationStatus,
  useSpondRosterImport,
} from '../lib/queries'
import { useGuardedSubmit } from '../hooks/useGuardedSubmit'
import { deleteConfirmed } from '../lib/playersView'
import type { RegisteredPlayer, SpondMapping, Team } from '../lib/data'
import { Icon } from './icons'
import { ActionError, Modal } from './ui'
import { Button, Note, SelectField, TextField } from './primitives'

// The team picker shared by Move team and the form modal: Unassigned plus
// every club team (club wide, since writes are club scoped with no team arm).
// The empty value means Unassigned (null team).
//
// It renders the whole field rather than a bare <select>, because both callers
// wrapped it in the same hand written .field and label and 2.6 asks for one
// real <label> bound to the control. The id is passed so the two dialogs keep
// the stable ids their markup has always had.
export function TeamField({
  value,
  teams,
  onChange,
  disabled,
  id,
  className,
}: {
  value: string
  teams: Team[]
  onChange: (v: string) => void
  disabled?: boolean
  id?: string
  className?: string
}) {
  return (
    <SelectField
      id={id}
      label="Team"
      className={className}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">Unassigned</option>
      {teams.map((t) => (
        <option key={t.id} value={t.id}>
          {t.name}
        </option>
      ))}
    </SelectField>
  )
}

export function MoveTeamModal({
  player,
  teams,
  onClose,
}: {
  player: RegisteredPlayer
  teams: Team[]
  onClose: () => void
}) {
  const move = useMovePlayerTeam()
  const [teamId, setTeamId] = useState(player.teamId ?? '')
  const { submit, pending, failed } = useGuardedSubmit<{ teamId: string | null }, void>({
    operation: 'move player team',
    perform: ({ teamId }) => move.mutateAsync({ registrationId: player.registrationId, teamId }),
    onSuccess: () => onClose(),
  })
  const moving = pending !== null
  const changed = (teamId || null) !== player.teamId
  const run = () => {
    if (!changed || moving) return
    void submit({ teamId: teamId || null })
  }
  return (
    <Modal
      title="Move team"
      sub={player.displayName}
      onClose={onClose}
      dismissible={!moving}
      footer={
        <>
          <Button onClick={onClose} disabled={moving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={run} disabled={!changed || moving}>
            {moving ? 'Moving…' : 'Move'}
          </Button>
        </>
      }
    >
      <TeamField
        id="move-team"
        className="field-flush"
        value={teamId}
        teams={teams}
        onChange={setTeamId}
        disabled={moving}
      />
      {failed && (
        <ActionError onRetry={changed ? run : undefined} style={{ marginTop: 'var(--space-12)' }}>
          Could not move the player. Try again.
        </ActionError>
      )}
    </Modal>
  )
}

export function WithdrawModal({
  player,
  seasonName,
  onClose,
}: {
  player: RegisteredPlayer
  seasonName: string
  onClose: () => void
}) {
  const setStatus = useSetRegistrationStatus()
  const { submit, pending, failed } = useGuardedSubmit<void, void>({
    operation: 'withdraw player',
    perform: () => setStatus.mutateAsync({ registrationId: player.registrationId, status: 'withdrawn' }),
    onSuccess: () => onClose(),
  })
  const busy = pending !== null
  const run = () => {
    if (busy) return
    void submit()
  }
  return (
    <Modal
      title="Withdraw player"
      sub={player.displayName}
      onClose={onClose}
      dismissible={!busy}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          {/* The danger variant, and the red is never the only cue: the label
              carries the word Withdraw. */}
          <Button variant="danger" onClick={run} disabled={busy}>
            {busy ? 'Withdrawing…' : 'Withdraw'}
          </Button>
        </>
      }
    >
      <p className="modal-copy">
        This marks <b>{player.displayName}</b> as withdrawn for {seasonName}. The record keeps its team, shirt number and
        history, and can be restored later. Nothing is deleted.
      </p>
      {failed && (
        <ActionError onRetry={run} style={{ marginTop: 'var(--space-12)' }}>
          Could not withdraw the player. Try again.
        </ActionError>
      )}
    </Modal>
  )
}

export function RestoreModal({
  player,
  seasonName,
  onClose,
}: {
  player: RegisteredPlayer
  seasonName: string
  onClose: () => void
}) {
  const setStatus = useSetRegistrationStatus()
  const [status, setStatusChoice] = useState<'pending' | 'registered'>('pending')
  const { submit, pending, failed } = useGuardedSubmit<{ status: 'pending' | 'registered' }, void>({
    operation: 'restore player',
    perform: ({ status }) => setStatus.mutateAsync({ registrationId: player.registrationId, status }),
    onSuccess: () => onClose(),
  })
  const busy = pending !== null
  const run = () => {
    if (busy) return
    void submit({ status })
  }
  return (
    <Modal
      title="Restore player"
      sub={player.displayName}
      onClose={onClose}
      dismissible={!busy}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={run} disabled={busy}>
            {busy ? 'Restoring…' : 'Restore'}
          </Button>
        </>
      }
    >
      <p className="modal-copy">
        Bring <b>{player.displayName}</b> back into {seasonName}.
      </p>
      {/* A real fieldset and legend around the pair, and each row is the
          shared .check-row, so the label is the 44px target rather than the
          16px control inside it. */}
      <fieldset className="choice-group">
        <legend className="sr-only">Restore as</legend>
        <label className="check-row">
          <input
            type="radio"
            name="restore-status"
            checked={status === 'pending'}
            disabled={busy}
            onChange={() => setStatusChoice('pending')}
          />
          As pending
        </label>
        <label className="check-row">
          <input
            type="radio"
            name="restore-status"
            checked={status === 'registered'}
            disabled={busy}
            onChange={() => setStatusChoice('registered')}
          />
          As registered
        </label>
      </fieldset>
      {failed && (
        <ActionError onRetry={run} style={{ marginTop: 'var(--space-12)' }}>
          Could not restore the player. Try again.
        </ActionError>
      )}
    </Modal>
  )
}

// Permanent deletion is destructive and admin only (players.delete). It removes
// the stable identity and every one of the child's registrations, in every
// season, so the modal names that plainly, requires the admin to type the
// player's current display name to confirm (the approved typed-name gate), and
// cannot be dismissed while the delete is in flight. Withdraw is the normal,
// reversible removal; this is the mistake-correction escape hatch only.
export function DeletePlayerModal({ player, onClose }: { player: RegisteredPlayer; onClose: () => void }) {
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
    void submit({ id: player.playerId })
  }
  return (
    <Modal
      title="Delete player permanently"
      sub={player.displayName}
      onClose={onClose}
      dismissible={!deleting}
      footer={
        <>
          <Button onClick={onClose} disabled={deleting}>
            Cancel
          </Button>
          <Button variant="danger" icon={Icon.trash} onClick={remove} disabled={!confirmed || deleting}>
            {deleting ? 'Deleting…' : 'Delete permanently'}
          </Button>
        </>
      }
    >
      <p className="modal-copy">
        This permanently removes <b>{player.displayName}</b> and every season registration from the club's records. The
        activity history keeps a neutral Deleted player entry with no name. Any saved board disc that referenced them
        shows a number with no name. This cannot be undone. Withdraw is the normal way to remove a player from a season.
      </p>
      {/* The typed gate, unchanged: deleteConfirmed still decides, and the
          button is inert until it says so. What changed is the label. The
          instruction used to be a paragraph with no relationship to the
          control, whose only accessible name was an aria-label; 2.6 asks for
          a real <label> bound to the control, which is what the sibling bulk
          delete dialog already does. */}
      <TextField
        id="delete-player-name"
        className="field-flush"
        label={
          <>
            To confirm, type <b>{player.displayName}</b>
          </>
        }
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        placeholder={player.displayName}
        autoComplete="off"
        spellCheck={false}
        disabled={deleting}
        autoFocus
      />
      {failed && (
        <ActionError onRetry={confirmed ? remove : undefined} style={{ marginTop: 'var(--space-12)' }}>
          Could not delete the player. Reload and try again.
        </ActionError>
      )}
    </Modal>
  )
}

// Import from Spond (PR 6). The affordance is gated on players.import (the page
// decides what to surface; the Edge Function and its spond_import_roster commit
// RPC are the real gate) and the copy states the imported players land as
// Pending in the current season. The browser never calls Spond; the Edge
// Function reads the names server side and returns counts only. A single confirm
// then outcome dialog: Spond runs unattended against the live subgroup, so there
// is no per row preview or choice (docs/product/registered-players-ux.md
// section 8), unlike the spreadsheet import.
export function ImportFromSpondModal({
  team,
  mapping,
  seasonName,
  onClose,
}: {
  team: Team
  mapping: SpondMapping
  seasonName: string
  onClose: () => void
}) {
  const importer = useSpondRosterImport()
  const busy = importer.isPending
  // Confirmed write only, no optimistic mutation. A double click is prevented by
  // the disabled button, and a retry is safe: the Spond commit dedupes by name
  // within the team and season, so re running adds nobody twice.
  const run = () => {
    if (busy) return
    importer.mutate({ teamId: team.id })
  }
  const result = importer.data
  return (
    <Modal
      title="Import from Spond"
      sub={team.name}
      onClose={onClose}
      dismissible={!busy}
      footer={
        result ? (
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        ) : (
          <>
            <Button onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" icon={Icon.rotate} onClick={run} disabled={busy}>
              {busy ? 'Importing…' : 'Import'}
            </Button>
          </>
        )
      }
    >
      {result ? (
        <>
          <p className="modal-copy">
            Imported into {seasonName}: {result.added} added, {result.alreadyPresent} already present, {result.skipped}{' '}
            skipped
            {result.registeredElsewhere > 0 ? `, ${result.registeredElsewhere} already registered elsewhere` : ''}.
          </p>
          {result.message && <p className="modal-copy-sm muted">{result.message}</p>}
          {/* The run's own warnings. One warning Note carrying every line,
              rather than a stack of danger coloured muted paragraphs: a
              warning is not a failure, and 2.14 gives it its own tone. */}
          {result.warnings.length > 0 && (
            <Note tone="warning">
              {result.warnings.map((w, i) => (
                <p key={i} className="modal-copy-sm">
                  {w}
                </p>
              ))}
            </Note>
          )}
        </>
      ) : (
        <>
          <p className="modal-copy">
            This brings over player names from the mapped Spond group <b>{mapping.name}</b> into {seasonName} for{' '}
            <b>{team.name}</b>. Each child's full name is stored. No guardian, contact or other Spond data is imported.
            New players land as Pending.
          </p>
          <p className="modal-copy-sm muted">
            Players already registered in {seasonName} are left as they are, wherever they sit, so importing again adds
            no duplicates. A child Spond has moved to this team is reported rather than imported, so no second record is
            created for them: change who they play for on the Registered players page.
          </p>
          {importer.isError && <ActionError>Nothing was imported. {importer.error.message}</ActionError>}
        </>
      )}
      {/* A polite live region announces the busy state and the outcome, so a
          screen reader is told what happened without watching the button. */}
      <p aria-live="polite" className="sr-only">
        {busy ? 'Importing from Spond. Do not close this window.' : result ? 'Import complete.' : ''}
      </p>
    </Modal>
  )
}
