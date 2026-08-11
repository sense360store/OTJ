// =====================================================================
// TONIGHT: the one screen a coach holds at the gate.
//
// THE JOB. Not "who arrived?". The coach is asking "who is coming, which
// of them am I including, and what bib does each need so I can split them
// into groups?". This replaces two overlapping surfaces on session day, a
// Register and a passive Spond attendance card, with one operational
// screen.
//
// TWO FACTS PER ROW, INDEPENDENT. The Spond reply is what the parent
// said; Included is what the coach decided. A Going child need not be
// included. A Not going child may be, because they turned up anyway. The
// tick means IN TONIGHT'S GROUPS, never "arrived": see the note on
// register_entries.present in ../lib/tonight and in CLAUDE.md.
//
// NOTHING SAVES UNTIL SAVE. Every tick, every Select all, every bib is a
// local draft, so the coach arranges the whole night, looks at it, and
// commits it once. The screen says Saved only when the readback from the
// database equals the draft, field for field.
//
// NEEDS NOTHING CONFIGURED. No Spond, no linking: Everyone is the working
// view, the coach selects who is there, and the team bib does the rest.
// =====================================================================
import { useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useNav } from '../hooks/useNav'
import { useAuth } from '../hooks/useAuth'
import {
  useCurrentSeason,
  useMyCapabilities,
  useRegisteredPlayers,
  useLinkSessionSpondEvent,
  useRegisterEntries,
  useSaveTonight,
  useSession,
  useSessionSpondRsvp,
  useSpondEvents,
  useSpondLinks,
  useSpondSync,
  useTeams,
} from '../lib/queries'
import { RSVP_LABELS, rsvpStaleNote } from '../lib/spondRsvp'
import { activeRoster, buildRegister, quickAddPool, type RegisterEntry } from '../lib/register'
import {
  buildTonightRows,
  clearSelection,
  countByResponse,
  DEFAULT_RESPONSE_FILTER,
  draftDelta,
  draftAfterSave,
  draftEntries,
  draftFromEntries,
  draftRemovals,
  draftIsDirty,
  RESPONSE_FILTER_LABELS,
  RESPONSE_FILTERS,
  quickAdd,
  selectAll,
  setDraftBib,
  toggleIncluded,
  tonightGroups,
  usableFilter,
  hasResponseContext,
  visibleRows,
  type ResponseFilter,
  tonightSummary,
  SAVE_LABELS,
  saveState,
  type SaveState,
  type TonightDraft,
  type TonightRow,
} from '../lib/tonight'
import { BIB_COLOURS, BIB_NONE, bibLabel, bibSwatch, effectiveBib } from '../lib/bibs'
import { coveredTeamIds, coverageOf, coversWholeClub, soleCoveredTeamId } from '../lib/sessionTeams'
import { SESSION_ID_PARAM } from '../lib/routes'
import type { Player, Session, Team } from '../lib/data'
import { LinkSpondEventModal } from '../components/SpondAttendance'
import { Icon } from '../components/icons'
import { Chip, Empty, ErrorNote, Loading, Modal, fmtDate } from '../components/ui'
import './SessionDay.css'
import './SessionRegister.css'

// The reply pill. Text, never a tick or a cross: a tick beside a name is
// exactly the mark inclusion uses, and one on an unticked row would be
// misread at a glance in the rain. Non interactive and outside the tick
// button, so it can never take the tap.
function ResponsePill({ response }: { response: TonightRow['response'] }) {
  if (!response) return null
  return (
    <span
      className={'reg-rsvp' + (response === 'declined' ? ' out' : '')}
      role="img"
      aria-label={`Spond reply: ${RSVP_LABELS[response].toLowerCase()}`}
    >
      {RSVP_LABELS[response]}
    </span>
  )
}

export function TonightRowView({
  row,
  included,
  bib,
  canEdit,
  onToggle,
  onBib,
}: {
  row: TonightRow
  included: boolean
  // The stored override as a select value: '' means follow the team.
  bib: string
  canEdit: boolean
  onToggle: () => void
  onBib: (value: string) => void
}) {
  const sub = [row.shirtNumber != null ? `#${row.shirtNumber}` : '', row.manual ? 'Added on the day' : '']
    .filter(Boolean)
    .join(' · ')
  const name = (
    <>
      <span className="reg-check">{included && <Icon.check />}</span>
      <span className="reg-name">
        <span className="reg-name-main">{row.displayName}</span>
        {sub && <span className="reg-name-sub">{sub}</span>}
      </span>
    </>
  )
  return (
    <div className={'reg-row' + (included ? ' on' : '')}>
      {canEdit ? (
        <button
          className="reg-tick"
          onClick={onToggle}
          aria-pressed={included}
          aria-label={`Include ${row.displayName} in tonight's groups`}
        >
          {name}
        </button>
      ) : (
        <div className="reg-tick">{name}</div>
      )}
      <ResponsePill response={row.response} />
      {/* The bib control has its own tap area at the end of the row, so a
          mis-tap changes a colour rather than who is in tonight's groups. */}
      <div className="reg-bib">
        {canEdit ? (
          <select value={bib} aria-label={`Bib colour for ${row.displayName}`} onChange={(e) => onBib(e.target.value)}>
            <option value="">Team bib</option>
            <option value={BIB_NONE}>No bib</option>
            {BIB_COLOURS.map((b) => (
              <option key={b.value} value={b.value}>
                {b.label}
              </option>
            ))}
          </select>
        ) : (
          <span className="reg-bib-static">{bibLabel(effectiveBib(bib === '' ? null : bib, row.teamBib)) ?? 'No bib'}</span>
        )}
      </div>
    </div>
  )
}

export function QuickAddView({
  pool,
  rosterEmpty,
  onAdd,
  onClose,
}: {
  pool: Player[]
  rosterEmpty: boolean
  onAdd: (playerId: string) => void
  onClose: () => void
}) {
  const [q, setQ] = useState('')
  const needle = q.trim().toLowerCase()
  const shown = needle ? pool.filter((p) => p.displayName.toLowerCase().includes(needle)) : pool
  return (
    <Modal title="Add a player" sub="Anyone who turned up who is not on the list" onClose={onClose}>
      <div className="field">
        <label>Search</label>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Start typing a name" autoFocus />
      </div>
      {shown.length === 0 ? (
        <p className="muted" style={{ fontSize: 13.5 }}>
          {pool.length > 0
            ? 'No player matches that.'
            : rosterEmpty
              ? 'Nobody is registered for this season yet. Add players under Players first.'
              : 'Everyone in the club is already in tonight s list.'}
        </p>
      ) : (
        <div className="reg-quickadd">
          {shown.map((p) => (
            <button key={p.id} className="reg-quickadd-row" onClick={() => onAdd(p.id)}>
              <span>{p.displayName}</span>
              {p.shirtNumber != null && <span className="muted">#{p.shirtNumber}</span>}
            </button>
          ))}
        </div>
      )}
    </Modal>
  )
}

export function TonightScreenView({
  rows,
  draft,
  filter,
  canEdit,
  saveStatus,
  hasSpondEvent,
  hasResponses,
  eventNote,
  staleNote,
  linkedNote,
  refreshing,
  refreshFailed,
  onFilter,
  onToggle,
  onBib,
  onSelectAll,
  onClearSelection,
  onSave,
  onRefresh,
  onQuickAdd,
  onLinkPlayers,
  onLinkEvent,
  onUnlinkEvent,
  unset,
}: {
  rows: TonightRow[]
  draft: TonightDraft
  filter: ResponseFilter
  canEdit: boolean
  saveStatus: SaveState
  // Two different facts. The event is linked, and it has replies. The
  // chips need replies to mean anything; Refresh needs only the event,
  // because the case that most needs refreshing is a linked event whose
  // replies have not arrived yet.
  hasSpondEvent: boolean
  hasResponses: boolean
  // The linked event's name and freshness, folded in from the card this
  // screen replaces. Empty when nothing is linked.
  eventNote: string
  staleNote: string | null
  // "37 of 40 players linked to Spond", or empty when there is nothing
  // useful to say about linking.
  linkedNote: string
  refreshing: boolean
  refreshFailed: boolean
  onFilter: (f: ResponseFilter) => void
  onToggle: (playerId: string) => void
  onBib: (playerId: string, value: string) => void
  onSelectAll: () => void
  onClearSelection: () => void
  onSave: () => void
  onRefresh?: () => void
  onQuickAdd: () => void
  onLinkPlayers?: () => void
  // Link, change or unlink the Spond event, folded in from the card this
  // screen replaces so nothing is lost with it. Absent for a member who
  // may not change the session.
  onLinkEvent?: () => void
  onUnlinkEvent?: () => void
  unset: boolean
}) {
  const counts = countByResponse(rows)
  // The filter the screen can actually use. A club with no Spond has no
  // accepted child, so the Going default would hide the whole squad.
  const effective = usableFilter(rows, filter)
  const shown = visibleRows(rows, effective)
  const groups = tonightGroups(rows, draft)
  const selectedTotal = groups.reduce((a, g) => a + g.count, 0)
  const selectedHere = shown.filter((r) => draft.included[r.playerId]).length

  return (
    <div className="reg">
      {/* Spond responses, as filters that do something. The counts are
          Hub players on THIS session, never the raw event aggregate: the
          chip filters this list, so its number is the number of rows. */}
      {hasResponses && (
        <div className="tn-filters">
          {RESPONSE_FILTERS.map((f) => (
            <Chip key={f} on={filter === f} onClick={() => onFilter(f)}>
              {RESPONSE_FILTER_LABELS[f]} {counts[f]}
            </Chip>
          ))}
        </div>
      )}

      <div className="tn-bar">
        <div className="tn-count">
          {RESPONSE_FILTER_LABELS[filter]} {shown.length}
          <span className="tn-sub">{selectedHere} selected</span>
        </div>
        {canEdit && (
          <>
            <button className="btn btn-ghost tn-act" onClick={onSelectAll} disabled={shown.length === 0}>
              <Icon.check />
              Select all
            </button>
            <button className="btn btn-quiet tn-act" onClick={onClearSelection} disabled={selectedHere === 0}>
              Clear
            </button>
          </>
        )}
      </div>

      {/* Everything Spond has to say about tonight, in one line each,
          where the coach already is. No trip to the admin screen. */}
      {(eventNote || linkedNote || hasSpondEvent || onLinkEvent) && (
        <div className="tn-spond">
          {eventNote && <span className="tn-event">{eventNote}</span>}
          {hasSpondEvent && onRefresh && (
            <button className="btn btn-quiet btn-sm tn-refresh" disabled={refreshing} onClick={onRefresh}>
              <Icon.rotate />
              {refreshing ? 'Refreshing…' : 'Refresh Spond'}
            </button>
          )}
          {linkedNote && (
            <span className="tn-linked">
              {linkedNote}
              {onLinkPlayers && (
                <button className="btn btn-quiet btn-sm" onClick={onLinkPlayers}>
                  Link players
                </button>
              )}
            </span>
          )}
          {onLinkEvent && (
            <button className="btn btn-quiet btn-sm" onClick={onLinkEvent}>
              <Icon.link />
              {hasSpondEvent ? 'Change Spond event' : 'Link Spond event'}
            </button>
          )}
          {onUnlinkEvent && (
            <button className="btn btn-quiet btn-sm" onClick={onUnlinkEvent}>
              <Icon.x />
              Unlink
            </button>
          )}
        </div>
      )}
      {staleNote && <p className="reg-stale">{staleNote}</p>}
      {refreshFailed && <p className="reg-stale">Could not refresh from Spond. Showing the last synced replies.</p>}

      {/* The list a coach works down: the current response view. */}
      {rows.length === 0 ? (
        <Empty icon={Icon.users} title={unset ? 'This session has no teams yet' : 'Nobody to show'}>
          {unset
            ? 'Choose the teams it covers in the planner and tonight fills itself in.'
            : 'No registered players are on the teams this session covers.'}
        </Empty>
      ) : shown.length === 0 ? (
        <Empty icon={Icon.users} title={`Nobody under ${RESPONSE_FILTER_LABELS[filter]}`}>
          {`Tap ${RESPONSE_FILTER_LABELS.all} for the full list.`}
        </Empty>
      ) : (
        <div className="tn-list">
          {shown.map((r) => (
            <TonightRowView
              key={r.playerId}
              row={r}
              included={draft.included[r.playerId] === true}
              bib={draft.bibs[r.playerId] ?? ''}
              canEdit={canEdit}
              onToggle={() => onToggle(r.playerId)}
              onBib={(v) => onBib(r.playerId, v)}
            />
          ))}
        </div>
      )}

      {canEdit && (
        <button className="btn btn-ghost btn-sm" onClick={onQuickAdd}>
          <Icon.plus />
          Add player
        </button>
      )}

      {/* The groups, which is what the whole screen is for. Bib first,
          because that is the thing a coach points at on the grass, with
          the teams named beside it. */}
      {groups.length > 0 && (
        <div className="tn-groups">
          <div className="tn-groups-head">
            <h3>Groups</h3>
            <span className="pill">{selectedTotal} selected</span>
          </div>
          {groups.map((g) => (
            <div className="tn-group" key={g.bib ?? 'none'}>
              <div className="tn-group-head">
                {g.bib && <span className="reg-swatch" style={{ background: bibSwatch(g.bib) ?? undefined }} aria-hidden="true" />}
                <b>{g.label}</b>
                <span className="muted">{g.teamNames.join(' · ')}</span>
                <span className="tn-group-count">{g.count}</span>
              </div>
              <div className="tn-group-names">{g.rows.map((r) => r.displayName).join(', ')}</div>
            </div>
          ))}
        </div>
      )}

      {/* The commit. Sticky, so a long list never hides it. */}
      {canEdit && (
        <div className="tn-save">
          <span className={'tn-status tn-status-' + saveStatus}>{SAVE_LABELS[saveStatus]}</span>
          <button
            className="btn btn-primary tn-save-btn"
            disabled={saveStatus === 'saved' || saveStatus === 'saving'}
            onClick={onSave}
          >
            {saveStatus === 'saving' ? 'Saving…' : 'Save groups'}
          </button>
        </div>
      )}
    </div>
  )
}

function TonightScreen({ session }: { session: Session }) {
  const nav = useNav()
  const { caps } = useMyCapabilities()
  const { user } = useAuth()
  const canEdit = caps.has('sessions.create')
  // Changing which Spond event a session is arranged as edits the SESSION,
  // so it follows the sessions update policy (owner, or sessions.manage)
  // rather than the club wide write that governs the arrangement itself.
  const canManageSession = caps.has('sessions.manage') || (canEdit && session.coachId === user?.id)
  const { data: teams = [] } = useTeams()
  const season = useCurrentSeason()
  const roster = useRegisteredPlayers(season.data?.id ?? null)
  const register = useRegisterEntries(session.id)
  // Context, on a sibling key. Deliberately absent from every gate below:
  // a slow or failing Spond read must never blank a working screen.
  const rsvp = useSessionSpondRsvp(session.id, session.spondEventId)
  const links = useSpondLinks()
  const { data: spondEvents = [] } = useSpondEvents(!!session.spondEventId)
  const sync = useSpondSync()
  const save = useSaveTonight()
  const [filter, setFilter] = useState<ResponseFilter>(DEFAULT_RESPONSE_FILTER)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState<TonightDraft | null>(null)
  const [linking, setLinking] = useState(false)
  const linkSpond = useLinkSessionSpondEvent()

  const entries = useMemo(() => register.data ?? [], [register.data])


  const players = useMemo(() => activeRoster(roster.data ?? [], entries), [roster.data, entries])

  const rosterFailed = roster.isError || season.isError
  if (register.isError || rosterFailed) return <ErrorNote />
  if (register.isLoading || roster.isLoading || season.isLoading) return <Loading />
  // No effect, no seeding. null means "follow what is saved", so a
  // refetch landing while the coach has touched nothing simply shows the
  // newer data, and a draft they HAVE touched is theirs until they save
  // or leave. Saving clears it back to null so the readback takes over.
  const live = draft ?? draftFromEntries(entries)

  const allTeamIds = teams.map((t) => t.id)
  const covered = coveredTeamIds(session)
  const wholeClub = coversWholeClub(session, allTeamIds)
  // Compose from the DRAFT merged over what is stored, not from the
  // stored rows alone: a quick added child exists only in the draft until
  // Save, and buildRegister lists a guest by their entry, so without this
  // the child a coach just added would vanish as the modal closed.
  const viewEntries = draftEntries(live, entries, session.id)
  const view = buildRegister(players, covered, teams, viewEntries, wholeClub)
  const rows = buildTonightRows(view, teams, rsvp.data ?? {})
  // The filter the screen can actually use. A club with no Spond has no
  // accepted child, so the Going default would hide the whole squad.
  const effective = usableFilter(rows, filter)
  const shown = visibleRows(rows, effective)
  // Against the MERGED entries, so a child the coach already added in this
  // draft is not offered a second time.
  const pool = quickAddPool(players, covered, viewEntries, wholeClub)

  const dirty = draftIsDirty(live, entries)
  const status = saveState(dirty, save.isPending, save.isError)

  // Linking coverage, over the children THIS session covers. A club wide
  // figure would answer a question the coach is not asking.
  const linkedIds = new Set((links.data?.links ?? []).map((l) => l.playerId))
  const linkedHere = rows.filter((r) => linkedIds.has(r.playerId)).length
  // Only a claim the read can actually back up. A club with no Spond, a
  // read still in flight, a failed read and a database where linking is
  // not available yet all say nothing rather than "0 of 18 linked", which
  // would be a confident falsehood of exactly the kind this screen
  // refuses to print elsewhere.
  const linksUsable =
    !!session.spondEventId && links.data?.available !== false && !links.isLoading && !links.isError
  const linkedNote =
    linksUsable && rows.length > 0 && linkedHere < rows.length
      ? `${linkedHere} of ${rows.length} players linked to Spond`
      : ''

  const event = spondEvents.find((e) => e.id === session.spondEventId)
  // A cancelled event was only ever surfaced by the card this screen
  // replaces, so it says so here or it says so nowhere.
  const eventNote = event ? (event.cancelled ? `${event.title} · Cancelled` : event.title) : ''
  const staleNote = rsvpStaleNote(rsvp.data ?? {})

  return (
    <div>
      <div className="sd-head">
        <button
          className="icon-btn"
          style={{ width: 44, height: 44 }}
          aria-label="Back"
          onClick={() => nav('sessionDay', { sessionId: session.id })}
        >
          <Icon.chevL />
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2>Tonight</h2>
          <div className="sd-sub">{[session.name, fmtDate(session.date), session.time].filter(Boolean).join(' · ')}</div>
        </div>
      </div>

      <TonightScreenView
        rows={rows}
        draft={live}
        filter={effective}
        canEdit={canEdit}
        saveStatus={status}
        hasSpondEvent={!!session.spondEventId}
        hasResponses={hasResponseContext(rows)}
        eventNote={eventNote}
        staleNote={staleNote}
        linkedNote={linkedNote}
        refreshing={sync.isPending}
        refreshFailed={sync.isError || sync.data?.ok === false}
        unset={coverageOf(session).kind === 'unset'}
        onFilter={setFilter}
        onToggle={(playerId) => setDraft(toggleIncluded(live, playerId))}
        onBib={(playerId, value) => setDraft(setDraftBib(live, playerId, value === '' ? null : value))}
        onSelectAll={() => setDraft(selectAll(live, shown))}
        onClearSelection={() => setDraft(clearSelection(live, shown))}
        onQuickAdd={() => setAdding(true)}
        onLinkPlayers={caps.has('players.manage') ? () => nav('spondLinks') : undefined}
        onRefresh={canEdit ? () => sync.mutate() : undefined}
        onSave={() =>
          save.mutate(
            { sessionId: session.id, changes: draftDelta(live, entries, session.id), removals: draftRemovals(live, entries) },
            // Compare, do not assume. The draft is cleared only when the
            // authoritative readback AGREES with it; if the database
            // returned something else, or the coach ticked another child
            // while the write was in flight, the draft stays and the
            // screen stays dirty. Clearing unconditionally would have made
            // Saved structurally true for any mutation that did not throw.
            { onSuccess: (persisted) => setDraft((current) => draftAfterSave(current, persisted)) },
          )
        }
        onLinkEvent={canManageSession ? () => setLinking(true) : undefined}
        onUnlinkEvent={
          session.spondEventId && canManageSession
            ? () => linkSpond.mutate({ sessionId: session.id, spondEventId: null })
            : undefined
        }
      />

      {linking && (
        <LinkSpondEventModal
          teamId={soleCoveredTeamId(session)}
          date={session.date}
          time={session.time}
          onPick={(id) => {
            setLinking(false)
            linkSpond.mutate({ sessionId: session.id, spondEventId: id })
          }}
          onClose={() => setLinking(false)}
        />
      )}

      {adding && (
        <QuickAddView
          pool={pool}
          rosterEmpty={players.length === 0}
          onClose={() => setAdding(false)}
          onAdd={(playerId) => {
            // A quick add is a draft edit like any other: it selects the
            // child into tonight's groups and waits for Save.
            setDraft(quickAdd(live, playerId))
            setAdding(false)
          }}
        />
      )}
    </div>
  )
}

// The session day entry point. Presentational so the summary, the empty
// coverage case and the error case render without query hooks.
export function TonightCardView({
  summary,
  note,
  onOpen,
}: {
  summary: string
  note: string
  onOpen: () => void
}) {
  return (
    <button className="card reg-card" onClick={onOpen}>
      <Icon.users size={20} style={{ color: 'var(--slate-2)', flex: '0 0 auto' }} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span className="reg-card-title">Tonight</span>
        <span className="reg-card-sub">{summary}</span>
      </span>
      {note && <span className="pill">{note}</span>}
      <Icon.chevR style={{ width: 18, height: 18, color: 'var(--slate-2)', flex: '0 0 18px' }} />
    </button>
  )
}

// Shown on session day to anyone holding players.view. A parent never
// holds it, so neither the card nor the child-name reads behind it happen
// for them.
export function TonightCard({ session }: { session: Session }) {
  const nav = useNav()
  const { caps } = useMyCapabilities()
  const canSee = caps.has('players.view')
  const { data: teams = [] } = useTeams()
  const season = useCurrentSeason(canSee)
  const roster = useRegisteredPlayers(season.data?.id ?? null, canSee)
  const register = useRegisterEntries(session.id, canSee)
  const rsvp = useSessionSpondRsvp(session.id, session.spondEventId, canSee)
  const entries = useMemo(() => register.data ?? [], [register.data])
  const players = useMemo(() => activeRoster(roster.data ?? [], entries), [roster.data, entries])

  if (!canSee) return null

  const coverage = coverageOf(session)
  if (coverage.kind === 'unset') {
    return (
      <TonightCardView
        summary="No teams set, so nobody is listed yet"
        note=""
        onOpen={() => nav('register', { sessionId: session.id })}
      />
    )
  }
  // A failed read shows as unknown rather than as a confident zero.
  if (register.isError || roster.isError || season.isError) {
    return (
      <TonightCardView summary="Could not load tonight" note="" onOpen={() => nav('register', { sessionId: session.id })} />
    )
  }
  const view = buildRegister(
    players,
    coverage.teamIds,
    teams,
    entries,
    coversWholeClub(
      session,
      teams.map((t) => t.id),
    ),
  )
  const rows = buildTonightRows(view, teams, rsvp.data ?? {})
  const draft = draftFromEntries(entries)
  return (
    <TonightCardView
      summary={tonightSummary(rows, draft)}
      note={rows.every((r) => !draft.included[r.playerId]) ? 'Not started' : ''}
      onOpen={() => nav('register', { sessionId: session.id })}
    />
  )
}

export function SessionRegister() {
  // The parameter name comes from the same module that declares the route,
  // so the two cannot drift apart. The URL keeps its old segment to avoid
  // route churn; the product concept it opens is Tonight.
  const sessionId = useParams()[SESSION_ID_PARAM]
  const { data: session, isLoading, isError } = useSession(sessionId)
  if (isLoading) return <Loading />
  if (isError) return <ErrorNote />
  if (!session)
    return (
      <Empty icon={Icon.list} title="Session not found">
        It may have been removed.
      </Empty>
    )
  return <TonightScreen session={session} />
}

// Kept for the callers that still name the old concept while the route
// segment does. Nothing user visible says Register any more.
export const SessionRegisterCard = TonightCard

// Referenced by the planner, which still links a Spond event to a draft
// session before it exists on session day.
export type { RegisterEntry, Team }
