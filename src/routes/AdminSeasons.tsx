// The admin seasons surface at /admin/seasons, behind seasons.manage (admin
// only) and backed by the seasons RLS and the activate_season RPC. It lists the
// club's seasons newest first with Current and Archived markers, creates a
// season, activates a non-current season (behind a confirmation that names both
// seasons and the consequence, with an optional archive of the outgoing
// season), archives a non-current season, and unarchives an archived one. The
// current season cannot be archived directly (the guard refuses it and no
// Archive control is offered on it). Every write is confirmed, never optimistic,
// and its modal cannot be dismissed while the write is in flight. This surface
// is where the players page's "Set up season" call to action lands.
import { useState } from 'react'
import {
  useActivateSeason,
  useArchiveSeason,
  useCreateSeason,
  useMyCapabilities,
  useSeasons,
  useUnarchiveSeason,
} from '../lib/queries'
import { useGuardedSubmit } from '../hooks/useGuardedSubmit'
import { seasonCreateErrorMessage } from '../lib/seasonForm'
import { fmtRegDate } from '../lib/playersFormat'
import type { Season } from '../lib/data'
import { Icon } from '../components/icons'
import { ActionError, Empty, ErrorNote, Loading, Modal } from '../components/ui'

function CreateSeasonModal({ onClose }: { onClose: () => void }) {
  const create = useCreateSeason()
  const [name, setName] = useState('')
  const [startsOn, setStartsOn] = useState('')
  const [endsOn, setEndsOn] = useState('')
  const { submit, pending, failed } = useGuardedSubmit<void, void>({
    operation: 'create season',
    perform: () => create.mutateAsync({ name: name.trim(), startsOn, endsOn }),
    onSuccess: () => onClose(),
  })
  const busy = pending !== null
  const nameOk = name.trim().length >= 1 && name.trim().length <= 20
  const datesOk = startsOn !== '' && endsOn !== '' && endsOn > startsOn
  const canSubmit = nameOk && datesOk && !busy
  const run = () => {
    if (!canSubmit) return
    void submit()
  }
  return (
    <Modal
      title="New season"
      onClose={onClose}
      dismissible={!busy}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={run} disabled={!canSubmit}>
            <Icon.plus />
            {busy ? 'Creating…' : 'Create season'}
          </button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="season-name">Name</label>
        <input
          id="season-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={20}
          placeholder="2027/28"
          disabled={busy}
          autoFocus
        />
      </div>
      <div className="row" style={{ gap: 12 }}>
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="season-start">Starts</label>
          <input id="season-start" type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} disabled={busy} />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="season-end">Ends</label>
          <input id="season-end" type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} disabled={busy} />
        </div>
      </div>
      {startsOn !== '' && endsOn !== '' && endsOn <= startsOn && (
        <p role="alert" className="muted" style={{ fontSize: 12.5, color: 'var(--m-pdf)', marginTop: 0 }}>
          The end date must be after the start date.
        </p>
      )}
      <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>
        Creating a season does not change the current season. Activate it when you are ready to open its register.
      </p>
      {failed && (
        <ActionError onRetry={canSubmit ? run : undefined} style={{ marginTop: 10 }}>
          {seasonCreateErrorMessage(create.error)}
        </ActionError>
      )}
    </Modal>
  )
}

function ActivateSeasonModal({
  target,
  current,
  onClose,
}: {
  target: Season
  current: Season | null
  onClose: () => void
}) {
  const activate = useActivateSeason()
  const [archiveOutgoing, setArchiveOutgoing] = useState(false)
  const { submit, pending, failed } = useGuardedSubmit<{ archiveOutgoing: boolean }, void>({
    operation: 'activate season',
    perform: ({ archiveOutgoing }) => activate.mutateAsync({ seasonId: target.id, archiveOutgoing }),
    onSuccess: () => onClose(),
  })
  const busy = pending !== null
  const run = () => {
    if (busy) return
    void submit({ archiveOutgoing })
  }
  return (
    <Modal
      title="Activate season"
      sub={target.name}
      onClose={onClose}
      dismissible={!busy}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={run} disabled={busy}>
            {busy ? 'Activating…' : 'Make current'}
          </button>
        </>
      }
    >
      <p style={{ fontSize: 14.5, lineHeight: 1.55, marginTop: 0 }}>
        Make <b>{target.name}</b> the current season? The players page, board seeding, imports and exports switch to it.
        {current ? (
          archiveOutgoing ? (
            <>
              {' '}
              <b>{current.name}</b> is archived and becomes read only.
            </>
          ) : (
            <>
              {' '}
              <b>{current.name}</b> stays open until you archive it.
            </>
          )
        ) : null}
      </p>
      {current && (
        <label className="row" style={{ gap: 8, fontSize: 14, alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={archiveOutgoing}
            disabled={busy}
            onChange={(e) => setArchiveOutgoing(e.target.checked)}
          />
          Also archive {current.name}
        </label>
      )}
      {failed && (
        <ActionError onRetry={run} style={{ marginTop: 10 }}>
          Could not activate the season. Reload and try again.
        </ActionError>
      )}
    </Modal>
  )
}

function ArchiveSeasonModal({ season, onClose }: { season: Season; onClose: () => void }) {
  const archive = useArchiveSeason()
  const { submit, pending, failed } = useGuardedSubmit<void, void>({
    operation: 'archive season',
    perform: () => archive.mutateAsync({ seasonId: season.id }),
    onSuccess: () => onClose(),
  })
  const busy = pending !== null
  const run = () => {
    if (busy) return
    void submit()
  }
  return (
    <Modal
      title="Archive season"
      sub={season.name}
      onClose={onClose}
      dismissible={!busy}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary" style={{ background: 'var(--m-pdf)' }} onClick={run} disabled={busy}>
            {busy ? 'Archiving…' : 'Archive'}
          </button>
        </>
      }
    >
      <p style={{ fontSize: 14.5, lineHeight: 1.55, marginTop: 0 }}>
        Archive <b>{season.name}</b>. Its register becomes read only: no new registrations, and no changes to the
        players in it. You can unarchive it later.
      </p>
      {failed && (
        <ActionError onRetry={run} style={{ marginTop: 10 }}>
          Could not archive the season. Reload and try again.
        </ActionError>
      )}
    </Modal>
  )
}

function UnarchiveSeasonModal({ season, onClose }: { season: Season; onClose: () => void }) {
  const unarchive = useUnarchiveSeason()
  const { submit, pending, failed } = useGuardedSubmit<void, void>({
    operation: 'unarchive season',
    perform: () => unarchive.mutateAsync({ seasonId: season.id }),
    onSuccess: () => onClose(),
  })
  const busy = pending !== null
  const run = () => {
    if (busy) return
    void submit()
  }
  return (
    <Modal
      title="Unarchive season"
      sub={season.name}
      onClose={onClose}
      dismissible={!busy}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={run} disabled={busy}>
            {busy ? 'Unarchiving…' : 'Unarchive'}
          </button>
        </>
      }
    >
      <p style={{ fontSize: 14.5, lineHeight: 1.55, marginTop: 0 }}>
        Unarchive <b>{season.name}</b>. Its register becomes writable again. This does not change the current season.
      </p>
      {failed && (
        <ActionError onRetry={run} style={{ marginTop: 10 }}>
          Could not unarchive the season. Reload and try again.
        </ActionError>
      )}
    </Modal>
  )
}

function SeasonRow({
  season,
  onActivate,
  onArchive,
  onUnarchive,
}: {
  season: Season
  onActivate: () => void
  onArchive: () => void
  onUnarchive: () => void
}) {
  const isArchived = season.archivedAt != null
  return (
    <div
      className="row"
      style={{ gap: 12, padding: '12px 0', borderTop: '1px solid var(--line)', alignItems: 'center', flexWrap: 'wrap' }}
    >
      <div style={{ flex: 1, minWidth: 160 }}>
        <div style={{ fontWeight: 700 }}>
          {season.name}
          {season.isCurrent && (
            <span className="pill" style={{ marginLeft: 8, color: 'var(--c-physical)' }}>
              Current
            </span>
          )}
          {isArchived && (
            <span className="pill" style={{ marginLeft: 8 }}>
              Archived
            </span>
          )}
        </div>
        <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
          {fmtRegDate(season.startsOn)} to {fmtRegDate(season.endsOn)}
        </div>
      </div>
      <div className="row" style={{ gap: 8 }}>
        {/* The current season is never activated or archived from here. */}
        {!season.isCurrent && !isArchived && (
          <>
            <button className="btn btn-ghost btn-sm" onClick={onActivate}>
              Make current
            </button>
            <button className="btn btn-ghost btn-sm" onClick={onArchive}>
              Archive
            </button>
          </>
        )}
        {isArchived && (
          <button className="btn btn-ghost btn-sm" onClick={onUnarchive}>
            Unarchive
          </button>
        )}
      </div>
    </div>
  )
}

export function AdminSeasons() {
  const { caps } = useMyCapabilities()
  const { data: seasons = [], isLoading, isError } = useSeasons()
  const [creating, setCreating] = useState(false)
  const [activating, setActivating] = useState<Season | null>(null)
  const [archiving, setArchiving] = useState<Season | null>(null)
  const [unarchiving, setUnarchiving] = useState<Season | null>(null)

  if (isLoading) return <Loading />
  if (isError) return <ErrorNote />
  // The route guard keeps non seasons.manage members out; belt and braces for
  // the brief render before a redirect.
  if (!caps.has('seasons.manage')) return null

  const current = seasons.find((s) => s.isCurrent) ?? null

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Seasons</h2>
          <div className="sub">The club's registration seasons. Exactly one is current; archived seasons are read only.</div>
        </div>
        <button className="btn btn-primary" onClick={() => setCreating(true)}>
          <Icon.plus />
          New season
        </button>
      </div>

      <div className="card" style={{ padding: 18, maxWidth: 680 }}>
        {seasons.length === 0 ? (
          <Empty icon={Icon.calendar} title="No seasons yet">
            Create a season, then make it current to open the register.
          </Empty>
        ) : (
          seasons.map((s) => (
            <SeasonRow
              key={s.id}
              season={s}
              onActivate={() => setActivating(s)}
              onArchive={() => setArchiving(s)}
              onUnarchive={() => setUnarchiving(s)}
            />
          ))
        )}
      </div>

      {creating && <CreateSeasonModal onClose={() => setCreating(false)} />}
      {activating && <ActivateSeasonModal target={activating} current={current} onClose={() => setActivating(null)} />}
      {archiving && <ArchiveSeasonModal season={archiving} onClose={() => setArchiving(null)} />}
      {unarchiving && <UnarchiveSeasonModal season={unarchiving} onClose={() => setUnarchiving(null)} />}
    </div>
  )
}
