// Renew season modal (PR 6). Copies chosen registrations from a source season
// into a target season as Pending, carrying team and shirt forward and leaving
// the registered date empty (ADR-0005 decision 10; delivery plan PR 6). The UX
// doc leaves this modal's layout to the implementer beyond the shared dialog and
// batch conventions (docs/product/registered-players-ux.md, unresolved item 10),
// so it follows the section 7 dialog and focus baseline and the section 8 batch
// conventions: no optimistic write, a non dismissible pending state, a live
// region announcing the outcome, a role="alert" failure, and a client minted
// batch id with a server idempotent retry.
//
// The server (renew_registrations, 0036) is the authority: it re-reads team and
// shirt from each source registration, refuses a cross club or archived season,
// creates only Pending target registrations, never mutates the source, and is
// idempotent per (player, season). The classification here is advisory preview
// only. No child name enters a URL, a log or telemetry: the modal holds names in
// component state only and Cancel or unmount discards every previewed row.
import { useMemo, useState } from 'react'
import { useGuardedSubmit } from '../hooks/useGuardedSubmit'
import { useRegisteredPlayers, useRenewRegistrations } from '../lib/queries'
import {
  isRenewSelectable,
  planRenew,
  renewCounts,
  renewPayloadIds,
  type RenewOutcome,
  type RenewRow,
} from '../lib/renewPlan'
import type { Season, Team } from '../lib/data'
import { ActionError, ErrorNote, Loading, Modal } from './ui'
import { Badge, Button, Note, SelectField } from './primitives'
import type { BadgeTone } from './primitives'

// The class word and the tone that carries it. The tone is a SEMANTIC role
// now: these three were hardcoded #16a34a, #ef8e1b and #94a3b8, which are the
// four corners physical and social hues standing in for success and warning.
// 2.2 forbids exactly that, and a literal hex is invisible to the invariant
// test's var(--c-*) scan, so it survived. Badge renders the dot and the word
// together, so the class is never colour alone either.
const CLASS_LABEL: Record<RenewRow['klass'], { word: string; tone: BadgeTone }> = {
  eligible: { word: 'Eligible', tone: 'success' },
  needs_decision: { word: 'Withdrawn', tone: 'warning' },
  already_in_target: { word: 'Already in target', tone: 'neutral' },
}

function flip(set: Set<string>, id: string): Set<string> {
  const next = new Set(set)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

// One presentational row of the preview: a checkbox (disabled and unchecked for
// an already-in-target player), the class word as a Badge (never colour alone,
// a dot plus the word), the name, and a muted detail line stating the team and
// shirt that will carry forward. The row is a label wrapping its checkbox, so
// the whole 44px row is the target. Exported and pure for the static render
// test.
export function RenewRowView({
  row,
  teamName,
  checked,
  onToggle,
  disabled,
}: {
  row: RenewRow
  teamName: string
  checked: boolean
  onToggle: () => void
  disabled?: boolean
}) {
  const selectable = isRenewSelectable(row)
  const meta = CLASS_LABEL[row.klass]
  const detail =
    row.klass === 'already_in_target'
      ? 'Already registered in the target season.'
      : `Carries forward: ${teamName}${row.shirtNumber != null ? `, shirt ${row.shirtNumber}` : ''}. Renews as Pending.`
  return (
    <label className={'renew-row' + (selectable ? '' : ' is-muted')}>
      <input
        type="checkbox"
        checked={selectable && checked}
        disabled={!selectable || disabled}
        onChange={onToggle}
        aria-label={`Renew ${row.displayName}`}
      />
      <span className="renew-row-main">
        <span className="renew-row-head">
          <Badge tone={meta.tone}>{meta.word}</Badge>
          <b className="renew-row-name">{row.displayName}</b>
        </span>
        <span className="renew-row-detail">{detail}</span>
      </span>
    </label>
  )
}

// The outcome screen body: safe server derived counts only, never a name.
export function RenewOutcomeBody({ outcome, targetName }: { outcome: RenewOutcome; targetName: string }) {
  return (
    <>
      <p className="modal-copy">
        Renewed into {targetName}: {outcome.renewed} renewed, {outcome.alreadyInTarget} already in target,{' '}
        {outcome.skipped} skipped.
      </p>
      <p className="modal-copy-sm muted">
        New registrations are Pending, with the team and shirt number carried forward and no registered date.
      </p>
    </>
  )
}

export function RenewSeasonModal({
  seasons,
  currentSeasonId,
  teams,
  onClose,
}: {
  seasons: Season[]
  currentSeasonId: string | null
  teams: Team[]
  onClose: () => void
}) {
  const teamName = useMemo(() => {
    const m = new Map(teams.map((t) => [t.id, t.name]))
    return (id: string | null): string => (id == null ? 'Unassigned' : (m.get(id) ?? 'Deleted team'))
  }, [teams])

  // Target: a non archived season, defaulting to the current one (always non
  // archived by invariant). Source: any other season.
  const targetOptions = useMemo(() => seasons.filter((s) => s.archivedAt == null), [seasons])
  const [targetSeasonId, setTargetSeasonId] = useState<string>(currentSeasonId ?? targetOptions[0]?.id ?? '')
  const [chosenSource, setChosenSource] = useState<string>('')

  const sourceOptions = useMemo(() => seasons.filter((s) => s.id !== targetSeasonId), [seasons, targetSeasonId])
  // Derive the effective source, so a target change that collides with the
  // chosen source falls back without a state sync effect.
  const sourceSeasonId =
    chosenSource && chosenSource !== targetSeasonId && sourceOptions.some((s) => s.id === chosenSource)
      ? chosenSource
      : (sourceOptions[0]?.id ?? '')

  // The default selection is every eligible row. The user's deviations are held
  // as two override sets, reset whenever the season pair changes (in the change
  // handlers, never an effect): deselected holds eligible rows the user unticked,
  // included holds withdrawn rows the user ticked in.
  const [deselected, setDeselected] = useState<Set<string>>(new Set())
  const [included, setIncluded] = useState<Set<string>>(new Set())
  const resetSelection = () => {
    setDeselected(new Set())
    setIncluded(new Set())
  }
  const onChooseSource = (v: string) => {
    setChosenSource(v)
    resetSelection()
  }
  const onChooseTarget = (v: string) => {
    setTargetSeasonId(v)
    resetSelection()
  }

  const source = useRegisteredPlayers(sourceSeasonId || null, !!sourceSeasonId)
  const target = useRegisteredPlayers(targetSeasonId || null, !!targetSeasonId)
  const targetIds = useMemo(() => (target.data ?? []).map((r) => r.playerId), [target.data])
  const rows = useMemo(() => planRenew(source.data ?? [], targetIds), [source.data, targetIds])

  // The effective selection, derived from the rows and the two override sets.
  const selectedSet = useMemo(() => {
    const s = new Set<string>()
    for (const r of rows) {
      const on =
        r.klass === 'eligible'
          ? !deselected.has(r.playerId)
          : r.klass === 'needs_decision'
            ? included.has(r.playerId)
            : false
      if (on) s.add(r.playerId)
    }
    return s
  }, [rows, deselected, included])

  const toggle = (row: RenewRow) => {
    if (row.klass === 'eligible') setDeselected((p) => flip(p, row.playerId))
    else if (row.klass === 'needs_decision') setIncluded((p) => flip(p, row.playerId))
  }

  const counts = renewCounts(rows, selectedSet)
  const targetName = seasons.find((s) => s.id === targetSeasonId)?.name ?? ''
  const sourceName = seasons.find((s) => s.id === sourceSeasonId)?.name ?? ''

  const renew = useRenewRegistrations()
  const [outcome, setOutcome] = useState<RenewOutcome | null>(null)
  const { submit, pending, failed } = useGuardedSubmit<
    { sourceSeasonId: string; targetSeasonId: string; playerIds: string[] },
    RenewOutcome
  >({
    operation: 'renew registrations',
    // A client minted batch id per attempt; the RPC is idempotent per (player,
    // season), so a retry after a lost response never double renews.
    perform: async (args) => {
      const res = await renew.mutateAsync({ batchId: crypto.randomUUID(), ...args })
      return { renewed: res.renewed, alreadyInTarget: res.alreadyInTarget, skipped: res.skipped }
    },
    onSuccess: (res) => setOutcome(res),
  })
  const busy = pending !== null

  const canConfirm =
    !busy && !!sourceSeasonId && !!targetSeasonId && sourceSeasonId !== targetSeasonId && counts.selected > 0
  const run = () => {
    if (!canConfirm) return
    void submit({ sourceSeasonId, targetSeasonId, playerIds: renewPayloadIds(rows, selectedSet) })
  }

  const loadingRows = (!!sourceSeasonId && source.isLoading) || (!!targetSeasonId && target.isLoading)
  const rowsError = source.isError || target.isError

  return (
    <Modal
      title="Renew players"
      sub={outcome ? targetName : `${sourceName || '…'} to ${targetName || '…'}`}
      onClose={onClose}
      dismissible={!busy}
      footer={
        outcome ? (
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        ) : (
          <>
            <Button onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" onClick={run} disabled={!canConfirm}>
              {busy ? 'Renewing…' : `Renew ${counts.selected} player${counts.selected === 1 ? '' : 's'}`}
            </Button>
          </>
        )
      }
    >
      {outcome ? (
        <RenewOutcomeBody outcome={outcome} targetName={targetName} />
      ) : (
        <>
          <div className="renew-seasons">
            <SelectField
              id="renew-source"
              label="Renew from"
              value={sourceSeasonId}
              disabled={busy}
              onChange={(e) => onChooseSource(e.target.value)}
            >
              {sourceOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.isCurrent ? ' (current)' : s.archivedAt ? ' (archived)' : ''}
                </option>
              ))}
            </SelectField>
            <SelectField
              id="renew-target"
              label="Into"
              value={targetSeasonId}
              disabled={busy}
              onChange={(e) => onChooseTarget(e.target.value)}
            >
              {targetOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.isCurrent ? ' (current)' : ''}
                </option>
              ))}
            </SelectField>
          </div>

          {sourceSeasonId === targetSeasonId ? (
            // A refusal that blocks the action, so it takes the danger tone
            // and announces itself, rather than being a red tinted muted
            // paragraph indistinguishable from the empty case below it.
            <Note tone="danger" role="alert">
              Choose two different seasons to renew between.
            </Note>
          ) : loadingRows ? (
            <Loading />
          ) : rowsError ? (
            <ErrorNote />
          ) : rows.length === 0 ? (
            <p className="modal-copy muted">{sourceName} has no registrations to renew.</p>
          ) : (
            <>
              <p className="renew-lede">
                {counts.eligible} eligible, {counts.needsDecision} withdrawn (tick to include), {counts.alreadyInTarget}{' '}
                already in {targetName}. {counts.selected} selected.
              </p>
              <div
                className="renew-list"
                role="group"
                aria-label={`Players to renew from ${sourceName} into ${targetName}`}
              >
                {rows.map((r) => (
                  <RenewRowView
                    key={r.playerId}
                    row={r}
                    teamName={teamName(r.teamId)}
                    checked={selectedSet.has(r.playerId)}
                    onToggle={() => toggle(r)}
                    disabled={busy}
                  />
                ))}
              </div>
            </>
          )}

          {failed && (
            <ActionError onRetry={canConfirm ? run : undefined} style={{ marginTop: 'var(--space-12)' }}>
              Nothing was renewed. {renew.error?.message ?? 'Try again.'}
            </ActionError>
          )}
        </>
      )}

      <p aria-live="polite" className="sr-only">
        {busy ? 'Renewing. Do not close this window.' : outcome ? 'Renewal complete.' : ''}
      </p>
    </Modal>
  )
}
