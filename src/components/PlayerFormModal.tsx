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
//
// Every attempt carries its values through the guarded submit input, never a
// closure: useGuardedSubmit captures perform once, at first render, so reading
// the live fields from a closure would submit the modal's initial values. The
// sibling action modals pass their payload the same way (see PlayerActionModals).
import { useRef, useState } from 'react'
import { useInsertPlayer, useSetRegistrationStatus, useUpdatePlayer } from '../lib/queries'
import { useGuardedSubmit } from '../hooks/useGuardedSubmit'
import {
  parseShirt,
  planPlayerEdit,
  playerEditHasChange,
  registeredDateForAdd,
  type PlayerEdit,
} from '../lib/playersView'
import type { RegisteredPlayer, RegistrationStatus, Team } from '../lib/data'
import { Icon } from './icons'
import { ActionError, Modal } from './ui'
import { TeamSelect } from './PlayerActionModals'

// The per-attempt payload, computed from the live fields at click time and
// passed through the guard so perform never reads a stale closure.
type SubmitInput =
  | {
      kind: 'add'
      id: string
      teamId: string | null
      displayName: string
      shirtNumber: number | null
      status: 'pending' | 'registered'
      registeredDate: string | null
    }
  | {
      kind: 'edit'
      playerId: string
      registrationId: string
      playerStatus: RegistrationStatus
      expectedSeason: string
      edit: PlayerEdit
      markRegistered: boolean
    }

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

  // The atomic edit for this render's fields (empty in add mode). Recomputed
  // every render so the Save button and the submit both see the live values.
  const edit: PlayerEdit =
    isEdit && player
      ? planPlayerEdit(
          { displayName: player.displayName, shirtNumber: player.shirtNumber },
          { trimmedName, parsedShirt },
        )
      : {}
  const hasEdit = playerEditHasChange(edit)

  // A client minted stable id per add, so an ambiguous lost response retry
  // reuses the same identity (add_player is idempotent on it) rather than
  // duplicating the child. Kept across a failure for the retry.
  const addId = useRef<string | null>(null)

  const { submit, pending, failed } = useGuardedSubmit<SubmitInput, void>({
    operation: isEdit ? 'edit player' : 'add player',
    // Edit runs at most two writes, each idempotent so a retry after a partial
    // failure converges: update_player (the atomic name + shirt pair; a no-op
    // when neither changed) and, only when the pending player is being marked
    // registered, the status write. Add is one atomic add_player call. Every
    // value arrives through input, so nothing is read from a stale closure.
    perform: async (input) => {
      if (input.kind === 'edit') {
        if (playerEditHasChange(input.edit)) {
          await update.mutateAsync({
            id: input.playerId,
            expectedSeason: input.expectedSeason,
            displayName: input.edit.displayName,
            shirtNumber: input.edit.shirtNumber,
          })
        }
        if (input.markRegistered && input.playerStatus === 'pending') {
          await setStatus.mutateAsync({ registrationId: input.registrationId, status: 'registered' })
        }
        return
      }
      await insert.mutateAsync({
        id: input.id,
        teamId: input.teamId,
        displayName: input.displayName,
        shirtNumber: input.shirtNumber,
        status: input.status,
        registeredDate: input.registeredDate,
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
    (isEdit ? trimmedName !== '' && (hasEdit || markRegistered) : trimmedName !== '')

  const run = () => {
    if (!canSubmit) return
    if (isEdit && player) {
      void submit({
        kind: 'edit',
        playerId: player.playerId,
        registrationId: player.registrationId,
        playerStatus: player.status,
        expectedSeason: currentSeasonId,
        edit,
        markRegistered,
      })
      return
    }
    if (!addId.current) addId.current = crypto.randomUUID()
    void submit({
      kind: 'add',
      id: addId.current,
      teamId: teamId || null,
      displayName: trimmedName,
      shirtNumber: parsedShirt ?? null,
      status,
      registeredDate: registeredDateForAdd(status, registeredDate),
    })
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
              onChange={(e) => {
                const next = e.target.value as 'pending' | 'registered'
                setStatusChoice(next)
                // A registration date is a registered-only fact, so leaving
                // Pending clears any date already entered. Belt and braces with
                // the field being disabled and the null the submit sends for
                // Pending.
                if (next === 'pending') setRegisteredDate('')
              }}
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
        <MarkRegisteredField checked={markRegistered} disabled={busy} onChange={setMarkRegistered} />
      )}

      {!isEdit && (
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="pf-date">Registered date</label>
          <input
            id="pf-date"
            type="date"
            value={registeredDate}
            onChange={(e) => setRegisteredDate(e.target.value)}
            // A Pending player carries no registration date; the field is only
            // live once the status is Registered.
            disabled={busy || status === 'pending'}
            style={{ maxWidth: 200 }}
          />
          <p className="muted" style={{ fontSize: 12.5, marginTop: 6, marginBottom: 0 }}>
            {status === 'pending'
              ? 'Added automatically when the player is marked registered.'
              : 'Optional. Leave blank to use today, or set a backdated paper registration date.'}
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

// The "Mark as registered" control: one compact checkbox row inside a .field.
// The label wraps the native checkbox so the whole row is clickable and the
// accessible name comes from the adjacent text, and the check-row class keeps
// the checkbox at its standard size (the shared .field input text-input sizing
// is scoped to exclude checkbox and radio, so it never stretches this control).
// Exported so the static-render regression test can pin the markup.
export function MarkRegisteredField({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean
  disabled?: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <div className="field" style={{ marginBottom: 0 }}>
      <label className="check-row">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        Mark as registered
      </label>
    </div>
  )
}
