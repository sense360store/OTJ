// The Add and Edit player modal. Add writes a new identity plus its current
// season registration atomically through the add_player RPC (name, team,
// status, shirt and an optional backdated registered date). Edit renames the
// identity and updates the current season shirt atomically through the
// update_player RPC (the atomic pair); team is changed through the dedicated
// Move team action and status through Withdraw, Restore and Mark registered, so
// no edit is a multi-field partial write. Both are gated to the current season
// (the RPCs derive the season server side). No optimistic write; the button
// stays busy until the server answers, edited values survive a failure, and the
// modal cannot be dismissed while the write is in flight.
import { useRef, useState } from 'react'
import { useInsertPlayer, useSetRegistrationStatus, useUpdatePlayer } from '../lib/queries'
import { useGuardedSubmit } from '../hooks/useGuardedSubmit'
import { parseShirt } from '../lib/playersView'
import type { RegisteredPlayer, Team } from '../lib/data'
import { Icon } from './icons'
import { ActionError, Modal } from './ui'
import { TeamSelect } from './PlayerActionModals'

export function PlayerFormModal({
  mode,
  player,
  teams,
  defaultTeamId,
  currentSeasonId,
  seasonName,
  onClose,
}: {
  mode: 'add' | 'edit'
  // Present in edit mode; the row being edited.
  player?: RegisteredPlayer
  teams: Team[]
  // The Add form defaults the team to the page's current team filter when it
  // selects a specific team, otherwise Unassigned.
  defaultTeamId: string | null
  currentSeasonId: string
  seasonName: string
  onClose: () => void
}) {
  const isEdit = mode === 'edit'
  const insert = useInsertPlayer()
  const update = useUpdatePlayer()
  const setStatus = useSetRegistrationStatus()

  const [name, setName] = useState(player?.displayName ?? '')
  const [teamId, setTeamId] = useState(isEdit ? (player?.teamId ?? '') : (defaultTeamId ?? ''))
  const [status, setStatusChoice] = useState<'pending' | 'registered'>('pending')
  const [shirt, setShirt] = useState(player?.shirtNumber == null ? '' : String(player.shirtNumber))
  const [registeredDate, setRegisteredDate] = useState('')
  // Edit only: a pending player can be marked registered as part of the save.
  const [markRegistered, setMarkRegistered] = useState(false)

  const parsedShirt = parseShirt(shirt)
  const shirtInvalid = parsedShirt === undefined
  const trimmedName = name.trim()

  const nameChanged = isEdit ? trimmedName !== '' && trimmedName !== player?.displayName : trimmedName !== ''
  const shirtChanged = isEdit && !shirtInvalid && (parsedShirt ?? null) !== player?.shirtNumber

  // A client minted stable id per add, so an ambiguous lost response retry
  // reuses the same identity (add_player is idempotent on it) rather than
  // duplicating the child. Kept across a failure for the retry.
  const addId = useRef<string | null>(null)

  const { submit, pending, failed } = useGuardedSubmit<void, void>({
    operation: isEdit ? 'edit player' : 'add player',
    // Edit runs at most two writes, each idempotent so a retry after a partial
    // failure converges: update_player (the atomic name + shirt pair; a no-op
    // when neither changed) and, only when the pending player is being marked
    // registered, the status write. Add is one atomic add_player call.
    perform: async () => {
      if (isEdit && player) {
        if (nameChanged || shirtChanged) {
          await update.mutateAsync({
            id: player.playerId,
            expectedSeason: currentSeasonId,
            displayName: nameChanged ? trimmedName : undefined,
            shirtNumber: shirtChanged ? (parsedShirt ?? null) : undefined,
          })
        }
        if (markRegistered && player.status === 'pending') {
          await setStatus.mutateAsync({ registrationId: player.registrationId, status: 'registered' })
        }
        return
      }
      if (!addId.current) addId.current = crypto.randomUUID()
      await insert.mutateAsync({
        id: addId.current,
        teamId: teamId || null,
        displayName: trimmedName,
        shirtNumber: parsedShirt ?? null,
        status,
        registeredDate: registeredDate || null,
      })
    },
    onSuccess: () => {
      addId.current = null
      onClose()
    },
  })
  const busy = pending !== null

  const canSubmit =
    !shirtInvalid &&
    !busy &&
    (isEdit ? trimmedName !== '' && (nameChanged || shirtChanged || markRegistered) : trimmedName !== '')

  const run = () => {
    if (!canSubmit) return
    void submit()
  }

  return (
    <Modal
      title={isEdit ? 'Edit player' : 'Add player'}
      sub={isEdit ? player?.displayName : seasonName}
      onClose={onClose}
      dismissible={!busy}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={run} disabled={!canSubmit}>
            <Icon.check />
            {busy ? 'Saving…' : isEdit ? 'Save' : 'Add player'}
          </button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="pf-name">Name</label>
        <input
          id="pf-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={40}
          placeholder="Full name"
          disabled={busy}
          autoFocus
        />
      </div>

      {!isEdit && (
        <>
          <div className="field">
            <label htmlFor="pf-team">Team</label>
            <TeamSelect id="pf-team" value={teamId} teams={teams} onChange={setTeamId} disabled={busy} />
          </div>
          <div className="field">
            <label htmlFor="pf-status">Status</label>
            <select
              id="pf-status"
              className="select"
              value={status}
              disabled={busy}
              onChange={(e) => setStatusChoice(e.target.value as 'pending' | 'registered')}
            >
              <option value="pending">Pending</option>
              <option value="registered">Registered</option>
            </select>
          </div>
        </>
      )}

      <div className="field">
        <label htmlFor="pf-shirt">Shirt number</label>
        <input
          id="pf-shirt"
          value={shirt}
          onChange={(e) => setShirt(e.target.value)}
          inputMode="numeric"
          placeholder="Optional"
          aria-invalid={shirtInvalid}
          aria-describedby={shirtInvalid ? 'pf-shirt-error' : undefined}
          disabled={busy}
          style={{ maxWidth: 140 }}
        />
        {shirtInvalid && (
          <p
            id="pf-shirt-error"
            role="alert"
            className="muted"
            style={{ fontSize: 12.5, color: 'var(--m-pdf)', marginTop: 6, marginBottom: 0 }}
          >
            Shirt number must be a whole number from 1 to 99.
          </p>
        )}
      </div>

      {isEdit && player?.status === 'pending' && (
        <div className="field" style={{ marginBottom: 0 }}>
          <label className="row" style={{ gap: 8, fontSize: 14, alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={markRegistered}
              disabled={busy}
              onChange={(e) => setMarkRegistered(e.target.checked)}
            />
            Mark as registered
          </label>
        </div>
      )}

      {!isEdit && (
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="pf-date">Registered date</label>
          <input
            id="pf-date"
            type="date"
            value={registeredDate}
            onChange={(e) => setRegisteredDate(e.target.value)}
            disabled={busy}
            style={{ maxWidth: 200 }}
          />
          <p className="muted" style={{ fontSize: 12.5, marginTop: 6, marginBottom: 0 }}>
            Filled in automatically when the player is marked registered. Set it here for a backdated paper registration.
          </p>
        </div>
      )}

      {failed && (
        <ActionError onRetry={canSubmit ? run : undefined} style={{ marginTop: 12 }}>
          Could not save the change. Try again.
        </ActionError>
      )}
    </Modal>
  )
}
