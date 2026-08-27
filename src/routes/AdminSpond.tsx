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
import { Link } from 'react-router-dom'
import {
  useCurrentSeason,
  useDeleteSpondMapping,
  useInsertSpondMapping,
  useMyCapabilities,
  useRegisteredPlayers,
  useSpondEvents,
  useSpondLinks,
  useSpondMappings,
  useSpondSync,
  useEventKindContext,
  useSpondEventResponseCounts,
  useTeams,
} from '../lib/queries'
import { linkedCounts } from '../lib/spondRsvp'
import type { SpondSyncResult } from '../lib/queries'
import type { SpondMapping, Team } from '../lib/data'
import {
  parseSpondMappingInput,
  spondAudienceNote,
  spondEventWhen,
  spondTeamLabel,
  syncedAgo,
} from '../lib/spond'
import {
  ALL_EVENTS_LABEL,
  DEFAULT_EVENT_KIND,
  type EventKind,
  isSpondMatch,
  matchesEventKind,
  TRAINING_LABEL,
} from '../lib/eventKind'
import { RESPONSE_FILTER_LABELS, type ResponseFilter } from '../lib/tonight'
import { Icon } from '../components/icons'

// The four reply states, in the product's own words, on the club's own
// children. Everyone is deliberately absent: it is rendered as the total
// beside the label, so the split under it sums to that total and reads as
// a split rather than as five figures one of which is the sum.
const LINKED_PLAYER_STATES: ResponseFilter[] = ['going', 'unanswered', 'declined', 'waiting']
import { CancelledBadge, MatchBadge } from '../components/SpondAttendance'
import { Chip, ErrorNote, fmtDate, Loading, Modal } from '../components/ui'

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
        <p className="muted" style={{ fontSize: 12.5, color: 'var(--danger)', marginTop: -6, marginBottom: 12 }}>
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
        <p className="muted" style={{ fontSize: 13, color: 'var(--danger)', marginBottom: 0 }}>
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
          <button className="btn btn-danger" onClick={remove} disabled={del.isPending}>
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
        <p className="muted" style={{ color: 'var(--danger)', fontSize: 13.5 }}>
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
              style={{ fontSize: 12, fontWeight: 800, color: o.status === 'synced' ? 'var(--success)' : 'var(--danger)' }}
            >
              {o.status === 'synced' ? 'Synced' : 'Failed'}
            </span>
            <span className="muted" style={{ fontSize: 12.5, fontWeight: 700 }}>
              {o.events} event{o.events === 1 ? '' : 's'}
            </span>
          </div>
          {o.error && (
            <p style={{ color: 'var(--danger)', fontSize: 13, lineHeight: 1.5, margin: '5px 0 0' }}>{o.error}</p>
          )}
          {o.warnings.map((w, i) => (
            <p key={i} className="muted" style={{ fontSize: 12.5, lineHeight: 1.5, margin: '5px 0 0' }}>
              {w}
            </p>
          ))}
        </div>
      ))}
      {result.stopped && (
        <p style={{ color: 'var(--danger)', fontSize: 13, lineHeight: 1.5, margin: '10px 0 0' }}>{result.stopped}</p>
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
        <p className="muted" style={{ fontSize: 13.5, color: 'var(--danger)', marginTop: 12, marginBottom: 0 }}>
          {sync.error.message}
        </p>
      )}
      {sync.data && <SyncReport result={sync.data} />}
    </div>
  )
}

// Who is linked to whom, and the way into the screen that changes it. An
// admin thinking about Spond comes here, so this is the second permanent
// entry point beside the one on the roster. Numbers only: no name and no
// member id renders on this page.
function LinksCard() {
  const season = useCurrentSeason()
  const roster = useRegisteredPlayers(season.data?.id ?? null)
  const links = useSpondLinks()
  const available = links.data?.available !== false
  const active = (roster.data ?? []).filter((p) => p.status !== 'withdrawn')
  const linkedIds = new Set((links.data?.links ?? []).map((l) => l.playerId))
  const counts = linkedCounts(active, linkedIds)
  return (
    <div className="card" style={{ padding: 18, marginBottom: 18 }}>
      <h3 style={{ fontSize: 17, marginBottom: 4 }}>Member links</h3>
      <p className="muted" style={{ fontSize: 13.5, marginTop: 0, marginBottom: 12 }}>
        Which Spond member is which child. Linking lets a register show what each parent replied; it never marks
        anybody present, and a club with no links keeps the full register.
      </p>
      {!available ? (
        <p className="muted" style={{ fontSize: 13.5, marginBottom: 0 }}>
          Member linking is not available yet.
        </p>
      ) : (
        <>
          <p style={{ fontSize: 14, fontWeight: 700, marginTop: 0, marginBottom: 12 }}>
            {counts.linked} of {counts.total} registered players linked
          </p>
          <Link to="/players/spond-links" className="btn btn-ghost">
            <Icon.link />
            Manage links
          </Link>
        </>
      )}
    </div>
  )
}

function EventsCard() {
  const { data: events = [], isLoading, isError } = useSpondEvents()
  // The same classifier context the coaches' screens supply. Without the
  // club's team names an opponent-versus-team fixture reads as training
  // here and as a fixture there, which is the exact disagreement the one
  // seam exists to prevent.
  const kindContext = useEventKindContext()
  // Training first here too. An admin checking the mirror is nearly always
  // asking whether the training nights came through; All events is the tap
  // that answers everything else, and both use the same classifier the
  // coaches' screens use, so the two never disagree about a given row.
  // The club's own children's replies, per event. Privacy safe by
  // construction: the read fetches an event id and a status and no member
  // id, and every stored reply belongs to a linked member because the
  // foreign key makes an unlinked one unrepresentable (0045).
  const replies = useSpondEventResponseCounts()
  const [kind, setKind] = useState<EventKind>(DEFAULT_EVENT_KIND)
  const shown = events.filter((e) => matchesEventKind(e, kind, kindContext))
  // Settled and applied, or nothing. A read in flight, a failed read and a
  // database without 0045 all mean the player figures are unknown, and an
  // unknown population is said as silence rather than as zero.
  const playerCounts = replies.data?.available && !replies.isLoading && !replies.isError ? replies.data.byEvent : null
  return (
    <div className="card" style={{ padding: 18 }}>
      <h3 style={{ fontSize: 17, marginBottom: 4 }}>Synced events</h3>
      <p className="muted" style={{ fontSize: 13.5, marginTop: 0, marginBottom: 10 }}>
        What the mirror holds: event facts, how many people Spond invited, and the club's own children's replies.
        Session day is where a coach organises a night player by player.
      </p>
      <div className="row" style={{ gap: 7, marginBottom: 10 }}>
        <Chip on={kind === 'training'} onClick={() => setKind('training')}>
          {TRAINING_LABEL}
        </Chip>
        <Chip on={kind === 'all'} onClick={() => setKind('all')}>
          {ALL_EVENTS_LABEL}
        </Chip>
      </div>
      {isLoading ? (
        <Loading />
      ) : isError ? (
        <ErrorNote />
      ) : events.length === 0 ? (
        <p className="muted" style={{ fontSize: 13.5 }}>
          Nothing synced yet.
        </p>
      ) : shown.length === 0 ? (
        <p className="muted" style={{ fontSize: 13.5 }}>
          {`Nothing here. ${events.length} synced event${events.length === 1 ? '' : 's'} under ${ALL_EVENTS_LABEL}.`}
        </p>
      ) : (
        shown.map((e) => (
          <div key={e.id} style={{ padding: '10px 0', borderTop: '1px solid var(--line)' }}>
            <div className="row" style={{ gap: 8 }}>
              <b style={{ fontSize: 14, flex: 1, minWidth: 0 }}>{e.title}</b>
              {isSpondMatch(e) && <MatchBadge />}
              {e.cancelled && <CancelledBadge />}
              <span className="pill">{spondTeamLabel(e.teamName)}</span>
            </div>
            <div className="row wrap" style={{ gap: 6, marginTop: 6 }}>
              <span className="muted" style={{ fontSize: 12.5, fontWeight: 600 }}>
                {spondEventWhen(e.startsAt)}
              </span>
              {/* THE AUDIENCE, AS A HEADCOUNT, AND NEVER AS A REPLY SPLIT.
                  This row used to print the event's four counts beside the
                  four API words, and on the 11 August event that read
                  "20 accepted, 24 declined" over an audience of 50 people
                  while the club's own children were 10 going and 14 not.
                  A reply word beside a figure is read as a statement about
                  players wherever it appears, this screen included, so the
                  aggregate keeps one job: how many people Spond reached. */}
              <span className="muted" style={{ fontSize: 12.5, fontWeight: 600 }}>
                {spondAudienceNote(e)}
              </span>
              <span className="muted" style={{ fontSize: 12, fontWeight: 600, marginLeft: 'auto' }}>
                {syncedAgo(e.syncedAt)}
              </span>
            </div>
            {/* The reply words, on the only population entitled to wear
                them: the club's own children. Absent, rather than zero,
                whenever the read cannot establish them. */}
            {playerCounts && (
              <div className="row wrap" style={{ gap: 6, marginTop: 4 }}>
                {playerCounts[e.id] ? (
                  <>
                    <span className="muted" style={{ fontSize: 12.5, fontWeight: 600 }}>
                      Linked players ({playerCounts[e.id].all})
                    </span>
                    {LINKED_PLAYER_STATES.map((f) => (
                      <span key={f} className="pill">
                        <b>{playerCounts[e.id][f]}</b> {RESPONSE_FILTER_LABELS[f].toLowerCase()}
                      </span>
                    ))}
                  </>
                ) : (
                  <span className="muted" style={{ fontSize: 12.5 }}>
                    No linked player has replied to this event.
                  </span>
                )}
              </div>
            )}
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
          <h1>Spond</h1>
          <div className="sub">
            Attendance mirrored from Spond, counts only. Sessions stay arranged and answered in Spond.
          </div>
        </div>
      </div>
      <MappingsCard />
      <SyncCard />
      <LinksCard />
      <EventsCard />
    </div>
  )
}
