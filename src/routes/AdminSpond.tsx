// The Spond integration's admin surface, behind club.manage: map Spond
// groups to teams, trigger a sync and see what the mirror holds. Attendance
// is counts only, the children's data boundary (CLAUDE.md, Spond
// integration): the screen renders the four counts and event facts the
// spond_events read returns and nothing member identifying exists to show.
// The browser never calls Spond; Sync now invokes the spond-sync Edge
// Function and freshness comes only from that. Writing the mapping is gated
// by the spond_groups_manage RLS (club.manage); the UI only decides what to
// surface. REVIEW: capability gated admin surface.
import { useState } from 'react'
import {
  useDeleteSpondMapping,
  useInsertSpondMapping,
  useMyCapabilities,
  useSpondEvents,
  useSpondMappings,
  useSpondSync,
  useTeams,
} from '../lib/queries'
import type { SpondSyncResult } from '../lib/queries'
import type { SpondMapping, Team } from '../lib/data'
import { parseSpondMappingInput, SPOND_COUNT_LABELS, spondEventWhen, syncedAgo } from '../lib/spond'
import { Icon } from '../components/icons'
import { CancelledBadge } from '../components/SpondAttendance'
import { ErrorNote, fmtDate, Loading, Modal } from '../components/ui'

// The add form. One source input takes a raw group id, a raw group-S-subgroup
// pair, or the full client URL; parseSpondMappingInput resolves it and the
// extracted ids are echoed back so the admin sees what will be mapped. A
// duplicate mapping surfaces as the insert hook's plain message, inline.
function AddMappingModal({ teams, onClose }: { teams: Team[]; onClose: () => void }) {
  const insert = useInsertSpondMapping()
  const [source, setSource] = useState('')
  const [name, setName] = useState('')
  const [teamId, setTeamId] = useState('')
  const parsed = parseSpondMappingInput(source)
  const ready = !!parsed && !!name.trim() && !!teamId

  const add = () => {
    if (!ready || !parsed) return
    insert.mutate(
      { groupId: parsed.groupId, subgroupId: parsed.subgroupId, name: name.trim(), teamId },
      { onSuccess: onClose },
    )
  }

  return (
    <Modal
      title="Add mapping"
      sub="The sync pulls attendance counts only for mapped groups."
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={insert.isPending}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={add} disabled={!ready || insert.isPending}>
            <Icon.plus />
            {insert.isPending ? 'Adding…' : 'Add mapping'}
          </button>
        </>
      }
    >
      <div className="field">
        <label>Spond group</label>
        <input
          value={source}
          onChange={(e) => setSource(e.target.value)}
          placeholder="Group id, group-S-subgroup pair, or a spond.com/client/groups link"
        />
      </div>
      {source.trim() && !parsed && (
        <p className="muted" style={{ fontSize: 12.5, color: 'var(--m-pdf)', marginTop: -6, marginBottom: 12 }}>
          Paste a Spond group id, an id pair, or the group's page link from spond.com.
        </p>
      )}
      {parsed && (
        <p className="muted mono" style={{ fontSize: 12, marginTop: -6, marginBottom: 12, wordBreak: 'break-all' }}>
          Group {parsed.groupId} · {parsed.subgroupId ? `subgroup ${parsed.subgroupId}` : 'whole group'}
        </p>
      )}
      <div className="field">
        <label>Display label</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. U8 Tigers" />
      </div>
      <p className="muted" style={{ fontSize: 12.5, marginTop: -6, marginBottom: 12 }}>
        Shown in sync reports. A team label, never a person's name.
      </p>
      <div className="field">
        <label>Team</label>
        <select value={teamId} onChange={(e) => setTeamId(e.target.value)}>
          <option value="">Choose a team</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>
      {insert.isError && (
        <p className="muted" style={{ fontSize: 13, color: 'var(--m-pdf)', marginBottom: 0 }}>
          {insert.error.message}
        </p>
      )}
    </Modal>
  )
}

function RemoveMappingModal({ mapping, onClose }: { mapping: SpondMapping; onClose: () => void }) {
  const del = useDeleteSpondMapping()
  const remove = () => del.mutate({ id: mapping.id }, { onSuccess: onClose })
  return (
    <Modal
      title="Remove mapping"
      sub={mapping.name}
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
        Future syncs stop pulling this group. Events already synced are not deleted, and sessions linked to them keep
        their counts.
      </p>
      {del.isError && (
        <p className="muted" style={{ color: 'var(--m-pdf)', fontSize: 13.5 }}>
          Could not remove the mapping. Try again.
        </p>
      )}
    </Modal>
  )
}

function MappingRow({ mapping, onRemove }: { mapping: SpondMapping; onRemove: () => void }) {
  return (
    <div className="row" style={{ gap: 10, padding: '10px 0', borderTop: '1px solid var(--line)', alignItems: 'center' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="row" style={{ gap: 8 }}>
          <b style={{ fontSize: 14 }}>{mapping.name}</b>
          <span className="pill">{mapping.teamName}</span>
        </div>
        <div className="mono muted" style={{ fontSize: 11.5, marginTop: 3, wordBreak: 'break-all' }}>
          {mapping.groupId} · {mapping.subgroupId ? `subgroup ${mapping.subgroupId}` : 'whole group'}
        </div>
      </div>
      <span className="muted" style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}>
        {fmtDate(mapping.createdAt)}
      </span>
      <button
        className="btn btn-ghost btn-sm icon-only"
        style={{ width: 38, padding: 0 }}
        aria-label={'Remove ' + mapping.name}
        onClick={onRemove}
      >
        <Icon.trash />
      </button>
    </div>
  )
}

function MappingsCard() {
  const { data: mappings = [], isLoading, isError } = useSpondMappings()
  const { data: teams = [] } = useTeams()
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState<SpondMapping | null>(null)

  return (
    <div className="card" style={{ padding: 18, marginBottom: 18 }}>
      <div className="row" style={{ gap: 10, marginBottom: 4 }}>
        <div style={{ flex: 1 }}>
          <h3 style={{ fontSize: 17, marginBottom: 4 }}>Mappings</h3>
          <p className="muted" style={{ fontSize: 13.5, marginTop: 0, marginBottom: 10 }}>
            Which Spond groups sync, and which team each shows as. The sync touches only groups listed here.
          </p>
        </div>
        <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }} onClick={() => setAdding(true)}>
          <Icon.plus />
          Add mapping
        </button>
      </div>
      {isLoading ? (
        <Loading />
      ) : isError ? (
        <ErrorNote />
      ) : mappings.length === 0 ? (
        <p className="muted" style={{ fontSize: 13.5 }}>
          No groups are mapped yet. Add the first one above; until then Sync now has nothing to pull.
        </p>
      ) : (
        mappings.map((m) => <MappingRow key={m.id} mapping={m} onRemove={() => setRemoving(m)} />)
      )}
      {adding && <AddMappingModal teams={teams} onClose={() => setAdding(false)} />}
      {removing && <RemoveMappingModal mapping={removing} onClose={() => setRemoving(null)} />}
    </div>
  )
}

// The sync window dates, plain: 29 May 2026.
function windowDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

// The per mapping outcomes of one sync run, presentational so the test can
// pin a failed mapping with warnings without a query client.
export function SyncReport({ result }: { result: SpondSyncResult }) {
  return (
    <div style={{ marginTop: 14 }}>
      {result.message && (
        <p className="muted" style={{ fontSize: 13.5, margin: 0 }}>
          {result.message}
        </p>
      )}
      {result.outcomes.map((o) => (
        <div key={o.id} style={{ padding: '10px 0', borderTop: '1px solid var(--line)' }}>
          <div className="row" style={{ gap: 8 }}>
            <b style={{ fontSize: 14, flex: 1, minWidth: 0 }}>{o.name}</b>
            <span
              style={{ fontSize: 12, fontWeight: 800, color: o.status === 'synced' ? 'var(--m-image)' : 'var(--m-pdf)' }}
            >
              {o.status === 'synced' ? 'Synced' : 'Failed'}
            </span>
            <span className="muted" style={{ fontSize: 12.5, fontWeight: 700 }}>
              {o.events} event{o.events === 1 ? '' : 's'}
            </span>
          </div>
          {o.error && (
            <p style={{ color: 'var(--m-pdf)', fontSize: 13, lineHeight: 1.5, margin: '5px 0 0' }}>{o.error}</p>
          )}
          {o.warnings.map((w, i) => (
            <p key={i} className="muted" style={{ fontSize: 12.5, lineHeight: 1.5, margin: '5px 0 0' }}>
              {w}
            </p>
          ))}
        </div>
      ))}
      {result.stopped && (
        <p style={{ color: 'var(--m-pdf)', fontSize: 13, lineHeight: 1.5, margin: '10px 0 0' }}>{result.stopped}</p>
      )}
      {result.window && (
        <p className="muted" style={{ fontSize: 12.5, fontWeight: 600, margin: '10px 0 0' }}>
          {result.eventsTotal} event{result.eventsTotal === 1 ? '' : 's'} synced · window {windowDate(result.window.from)} to{' '}
          {windowDate(result.window.to)}
        </p>
      )}
    </div>
  )
}

function SyncCard() {
  const sync = useSpondSync()
  return (
    <div className="card" style={{ padding: 18, marginBottom: 18 }}>
      <h3 style={{ fontSize: 17, marginBottom: 4 }}>Sync now</h3>
      <p className="muted" style={{ fontSize: 13.5, marginTop: 0, marginBottom: 12 }}>
        Pulls fresh attendance counts for every mapped group. Sessions are arranged and answered in Spond; this only
        refreshes the mirror.
      </p>
      <button className="btn btn-primary" disabled={sync.isPending} onClick={() => sync.mutate()}>
        <Icon.rotate />
        {sync.isPending ? 'Syncing…' : 'Sync now'}
      </button>
      {sync.isError && (
        <p className="muted" style={{ fontSize: 13.5, color: 'var(--m-pdf)', marginTop: 12, marginBottom: 0 }}>
          {sync.error.message}
        </p>
      )}
      {sync.data && <SyncReport result={sync.data} />}
    </div>
  )
}

function EventsCard() {
  const { data: events = [], isLoading, isError } = useSpondEvents()
  return (
    <div className="card" style={{ padding: 18 }}>
      <h3 style={{ fontSize: 17, marginBottom: 4 }}>Synced events</h3>
      <p className="muted" style={{ fontSize: 13.5, marginTop: 0, marginBottom: 10 }}>
        What the mirror holds: counts and event facts only. Sessions link to these from the planner and the session day
        view.
      </p>
      {isLoading ? (
        <Loading />
      ) : isError ? (
        <ErrorNote />
      ) : events.length === 0 ? (
        <p className="muted" style={{ fontSize: 13.5 }}>
          Nothing synced yet.
        </p>
      ) : (
        events.map((e) => (
          <div key={e.id} style={{ padding: '10px 0', borderTop: '1px solid var(--line)' }}>
            <div className="row" style={{ gap: 8 }}>
              <b style={{ fontSize: 14, flex: 1, minWidth: 0 }}>{e.title}</b>
              {e.cancelled && <CancelledBadge />}
              <span className="pill">{e.teamName ?? 'No team'}</span>
            </div>
            <div className="row wrap" style={{ gap: 6, marginTop: 6 }}>
              <span className="muted" style={{ fontSize: 12.5, fontWeight: 600 }}>
                {spondEventWhen(e.startsAt)}
              </span>
              {SPOND_COUNT_LABELS.map((label) => (
                <span key={label} className="pill">
                  <b>{e[label]}</b> {label}
                </span>
              ))}
              <span className="muted" style={{ fontSize: 12, fontWeight: 600, marginLeft: 'auto' }}>
                {syncedAgo(e.syncedAt)}
              </span>
            </div>
          </div>
        ))
      )}
    </div>
  )
}

export function AdminSpond() {
  const { caps } = useMyCapabilities()
  // The route guard already keeps members without club.manage out; this is
  // belt and braces for the brief render before a redirect.
  if (!caps.has('club.manage')) return null

  return (
    <div style={{ maxWidth: 760 }}>
      <div className="page-head">
        <div>
          <h2>Spond</h2>
          <div className="sub">
            Attendance mirrored from Spond, counts only. Sessions stay arranged and answered in Spond.
          </div>
        </div>
      </div>
      <MappingsCard />
      <SyncCard />
      <EventsCard />
    </div>
  )
}
