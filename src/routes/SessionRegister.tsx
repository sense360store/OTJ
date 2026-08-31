// =====================================================================
// PLAYERS & GROUPS: the one screen a coach holds at the gate.
//
// The internal concept keeps its old name, Tonight (../lib/tonight and
// the identifiers below), but no string a user reads says it: training
// runs on Saturday mornings as often as Tuesday evenings, so the surface
// is named for its job.
//
// THE JOB. Not "who arrived?". The coach is asking "who is coming, which
// of them am I including, and what bib does each need so I can split them
// into groups?". This replaces two overlapping surfaces on session day, a
// Register and a passive Spond attendance card, with one operational
// screen.
//
// THREE FACTS PER ROW, INDEPENDENT. The Spond reply is what the parent
// said; Included is what the coach decided; Here is whether the child
// actually turned up. A Going child need not be included. A Not going
// child may be, because they turned up anyway. A child who is Here need
// not be in tonight's split, and a coach may arrange a split before
// anybody arrives.
//
// THE ROW TARGET SETS INCLUSION, THE "HERE" BUTTON SETS ATTENDANCE, and
// they are different gestures on purpose. They were one tick until 0047,
// stored in one column, which meant a coach who split fourteen of the
// eighteen children who came had just recorded four of them absent. See
// ../lib/tonight and supabase/migrations/0047_register_group_inclusion.sql.
//
// NOTHING SAVES UNTIL SAVE. Every tick, every Select all, every bib is a
// local draft, so the coach arranges the whole night, looks at it, and
// commits it once. The screen says Saved only when the readback from the
// database equals the draft, field for field.
//
// NEEDS NOTHING CONFIGURED. No Spond, no linking: Everyone is the working
// view, the coach selects who is there, and the team bib does the rest.
// =====================================================================
import { useMemo, useState, type ReactNode } from 'react'
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
  chipCount,
  clearSelection,
  linkSetFromRead,
  responsesKnownFromRead,
  tonightCounts,
  tonightPlayersNote,
  tonightLinkNote,
  tonightUnlinkedNote,
  PLAYERS_GROUPS_TITLE,
  type TonightCounts,
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
  toggleAttendance,
  toggleIncluded,
  tonightGroups,
  tonightGlanceNote,
  usableFilter,
  hasResponseContext,
  visibleRows,
  type ResponseFilter,
  tonightSummary,
  SAVE_LABELS,
  saveState,
  type SaveState,
  type TonightDraft,
  type TonightGroup,
  type TonightRow,
} from '../lib/tonight'
import { BIB_COLOURS, BIB_NONE, bibInheritLabel, bibLabel, bibSwatch, effectiveBib } from '../lib/bibs'
import { coveredTeamIds, coverageOf, coversWholeClub, soleCoveredTeamId } from '../lib/sessionTeams'
import { spondAudienceReplyNote } from '../lib/spond'
import {
  type SetupPlan,
  type SetupReadiness,
  type StationFit,
  applySetup,
  planSetup,
  setupReadiness,
  stationAdvice,
} from '../lib/sessionSetup'
import { type SetupReconciliation, reconcileSetup } from '../lib/setupReconcile'
import { SESSION_ID_PARAM } from '../lib/routes'
import type { Player, Session, Team } from '../lib/data'
import { LinkSpondEventModal } from '../components/SpondAttendance'
import { SetupSuggestionView } from '../components/SetupSuggestion'
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
  present,
  bib,
  canEdit,
  onToggle,
  onPresent,
  onBib,
}: {
  row: TonightRow
  // In tonight's working groups. The coach's arrangement, and what the
  // big row target sets.
  included: boolean
  // Physically here. A SEPARATE fact with a SEPARATE control, because a
  // child can attend without being in this split and can be in a split
  // before they arrive. These shared one tick until 0047, which meant a
  // coach who left four of the eighteen who came out of the groups had
  // just recorded that four children were absent.
  present: boolean
  // The stored override as a select value: '' means follow the team.
  bib: string
  canEdit: boolean
  onToggle: () => void
  onPresent: () => void
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
          aria-label={`Include ${row.displayName} in the groups`}
        >
          {name}
        </button>
      ) : (
        <div className="reg-tick">{name}</div>
      )}
      <ResponsePill response={row.response} />
      {/* Attendance. Its own small target, deliberately not the row: a
          mis-tap here changes who was here, and a mis-tap on the row
          changes who is in a group, and those must not be the same
          gesture. Read only for a member who cannot write, like the bib. */}
      {canEdit ? (
        <button
          className={'reg-here' + (present ? ' on' : '')}
          onClick={onPresent}
          aria-pressed={present}
          aria-label={`${row.displayName} was present`}
        >
          Here
        </button>
      ) : (
        <span className={'reg-here static' + (present ? ' on' : '')}>{present ? 'Here' : ''}</span>
      )}
      {/* The bib control has its own tap area at the end of the row, so a
          mis-tap changes a colour rather than who is in tonight's groups. */}
      <div className="reg-bib">
        {canEdit ? (
          <select value={bib} aria-label={`Bib colour for ${row.displayName}`} onChange={(e) => onBib(e.target.value)}>
            {/* The inherit option: the empty VALUE is the storage sentinel
                meaning follow the team, and only the LABEL says which
                colour that is right now. Rendering "Blue (team)" therefore
                stores nothing, and a later change of team default moves
                every untouched row with it. */}
            <option value="">{bibInheritLabel(row.teamBib)}</option>
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
              : 'Everyone in the club is already on the list.'}
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

// THE GROUPS, RENDERED ONCE. The full screen shows them under the list a
// coach edits; session day shows the identical thing read only, so a coach
// can answer "who is in, and what bib does each need" without opening
// anything. Two renderings of one arrangement is how a colour on the card
// and a colour on the screen start disagreeing, so there is one.
//
// EVERY GROUP NAMES ITS COLOUR IN WORDS. `label` is "Red bibs" or "No
// bibs", never a swatch alone: the swatch is decoration and is marked
// aria-hidden, so nothing here asks a coach to tell red from green in low
// light or at all.
//
// It reads a composed model and renders it. No bib is resolved here, no
// player is grouped here and nobody is counted here: tonightGroups did all
// three, from the one effective bib rule in ../lib/bibs.
//
// `children` is the optional head. The editing screen has one, carrying the
// selected count; session day's head is the card above it.
export function TonightGroupsView({ groups, children }: { groups: TonightGroup[]; children?: ReactNode }) {
  if (groups.length === 0) return null
  return (
    <div className="tn-groups">
      {children}
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
  )
}

export function TonightScreenView({
  rows,
  counts,
  draft,
  filter,
  canEdit,
  saveStatus,
  hasSpondEvent,
  hasResponses,
  eventNote,
  staleNote,
  linkNote,
  unlinkedNote,
  audienceNote,
  playersNote,
  refreshing,
  refreshFailed,
  onFilter,
  onToggle,
  onPresent,
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
  setup,
  onApplySetup,
  onReconcileSetup,
}: {
  rows: TonightRow[]
  // Every number on this screen, built once in ../lib/tonight. The screen
  // never counts an array itself: a chip whose figure disagreed with the
  // list under it is exactly the defect that made "19 vs 11" unanswerable.
  counts: TonightCounts
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
  // "27 of 40 players linked to Spond · 13 not linked", which is the
  // sentence naming the population every chip above counts and the size
  // of the gap in it. Empty when the link set is unknown, because "0 of
  // 40" would be a confident falsehood.
  linkNote: string
  // "Not linked: Argonauts 8 · Trojans 5": where the gap lives, so an all
  // team session does not send a coach hunting through five teams for the
  // thirteen. Empty when there is no gap or the link set is unknown.
  unlinkedNote: string
  // The PAIR that answers "why does Spond say 30 and this screen say 11?".
  //
  // audienceNote is the Spond event's own figures, over everybody it
  // invited: "Spond audience: 50 people invited · 30 of them going".
  // playersNote is this session's covered children in the same shape:
  // "Players this session covers: 40 · 11 of them going". They render one
  // under the other, and each states its population before its reply
  // figure, so neither can be read as a measurement of the other's people.
  //
  // Both are labelled sentences rather than chips, precisely so neither
  // can be mistaken for one of the per player counts above. Either is
  // empty when there is nothing honest to say, and an empty one renders
  // as nothing rather than as a zero.
  audienceNote: string
  playersNote: string
  refreshing: boolean
  refreshFailed: boolean
  onFilter: (f: ResponseFilter) => void
  onToggle: (playerId: string) => void
  // Attendance, a separate act from putting a child in a group.
  onPresent: (playerId: string) => void
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
  // COACH-3's suggestion and COACH-4's reconciliation, already decided by
  // ../lib/sessionSetup and ../lib/setupReconcile. Handed in whole rather
  // than computed here: this screen renders the answer and never works one
  // out, so the card and the modules cannot describe the same night
  // differently.
  setup: {
    plan: SetupPlan
    fit: StationFit
    readiness: SetupReadiness
    reconcile: SetupReconciliation
  } | null
  // Applying is a DRAFT EDIT, like every other gesture on this screen.
  // Nothing persists until Save groups.
  onApplySetup?: () => void
  // Updating the groups from fresh replies is a draft edit too, and the
  // same rule holds: Save groups is still the only thing that writes.
  onReconcileSetup?: () => void
}) {
  // The filter the screen can actually use. A club with no Spond has no
  // accepted child, so the Going default would hide the whole squad.
  const effective = usableFilter(rows, filter)
  const shown = visibleRows(rows, effective)
  const groups = tonightGroups(rows, draft)
  const selectedTotal = counts.selected
  // Selected among the rows CURRENTLY VISIBLE, which is a different
  // population from counts.selected and drives Clear rather than Save.
  // Built by the same function so it cannot drift from the total.
  const selectedHere = tonightCounts(shown, draft, null).selected

  return (
    <div className="reg">
      {/* The suggested setup, first, because a coach opening this a day or
          two out is here to see the night already drafted. Absent only
          when there is no coverage to work from at all. */}
      {setup && (
        <SetupSuggestionView
          plan={setup.plan}
          fit={setup.fit}
          readiness={setup.readiness}
          reconcile={setup.reconcile}
          canEdit={canEdit}
          onApply={onApplySetup}
          onReconcile={onReconcileSetup}
        />
      )}

      {/* Spond responses, as filters that do something. The counts are
          Hub players on THIS session, never the raw event aggregate: the
          chip filters this list, so its number is the number of rows. */}
      {hasResponses && (
        <div className="tn-filters">
          {RESPONSE_FILTERS.map((f) => (
            <Chip key={f} on={filter === f} onClick={() => onFilter(f)}>
              {RESPONSE_FILTER_LABELS[f]} {chipCount(counts, f)}
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
      {(eventNote || linkNote || audienceNote || playersNote || hasSpondEvent || onLinkEvent) && (
        <div className="tn-spond">
          {eventNote && <span className="tn-event">{eventNote}</span>}
          {hasSpondEvent && onRefresh && (
            <button className="btn btn-quiet btn-sm tn-refresh" disabled={refreshing} onClick={onRefresh}>
              <Icon.rotate />
              {refreshing ? 'Refreshing…' : 'Refresh Spond'}
            </button>
          )}
          {/* THE TWO POPULATIONS, first, because they are the question the
              coach arrived with. One sentence each, the same shape, one
              under the other: the event's figures over everybody Spond
              invited, then this session's own children. Each names who it
              counted before it names a reply, so neither reads as a
              measurement of the other's people.
              Printing either one alone is what made an honest pair look
              like a bug. The headcount by itself reconciled nothing, and
              a going figure by itself was read as a squad. */}
          {audienceNote && <span className="tn-audience">{audienceNote}</span>}
          {playersNote && <span className="tn-players">{playersNote}</span>}
          {/* Then why they differ. The link coverage is the bridge between
              the two sentences above, so it reads after them rather than
              before: how many of this session's children are bound to a
              Spond member at all. */}
          {linkNote && (
            <span className="tn-linked">
              {linkNote}
              {onLinkPlayers && (
                <button className="btn btn-quiet btn-sm" onClick={onLinkPlayers}>
                  Link players
                </button>
              )}
            </span>
          )}
          {/* And where the gap lives, so the coverage line above is
              actionable rather than a puzzle. Composed by the model from
              the same rows and link set, never counted here. */}
          {unlinkedNote && <span className="tn-unlinked">{unlinkedNote}</span>}
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
            ? 'Choose the teams it covers in the planner and the list fills itself in.'
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
              present={draft.attendance[r.playerId] === true}
              bib={draft.bibs[r.playerId] ?? ''}
              canEdit={canEdit}
              onToggle={() => onToggle(r.playerId)}
              onPresent={() => onPresent(r.playerId)}
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
          the teams named beside it. Session day renders the SAME component
          read only, so the arrangement a coach glances at in the car park
          and the one they edit here cannot be two renderings. */}
      <TonightGroupsView groups={groups}>
        <div className="tn-groups-head">
          <h3>Groups</h3>
          <span className="pill">{selectedTotal} selected</span>
        </div>
      </TonightGroupsView>

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

export function TonightScreen({ session }: { session: Session }) {
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

  const unset = coverageOf(session).kind === 'unset'
  const dirty = draftIsDirty(live, entries)
  const status = saveState(dirty, save.isPending, save.isError)

  // COACH-3's suggestion, derived from the rows and the live draft on every
  // read. Nothing about it is stored and nothing about it writes.
  //
  // The club's team order is null because COACH-1 has not shipped: `teams`
  // carries id, name and bib_colour and nothing else. The plan reports that
  // honestly rather than treating alphabetical as ability, and this call
  // site is the one line that changes when the order arrives.
  //
  // A session with no covered teams gets no suggestion at all. Coverage was
  // never set, so there is no roster to work from, and the screen already
  // says so in its own words above; inventing a recommendation over a squad
  // it cannot establish would be the guess this whole slice refuses.
  const plan = planSetup(rows, live, null)
  // COACH-4: what fresh replies mean for an arranged night. Derived on
  // every read from the same rows and the same live draft the plan reads,
  // and it changes nothing by existing: the margin it names reaches the
  // draft only through the Update groups press below, and the database
  // only through Save groups. An unarranged night reconciles to nothing,
  // which is the module's own boundary with the suggestion.
  const reconcile = reconcileSetup(rows, live)
  const setup = unset
    ? null
    : {
        plan,
        // Advice about the coach's own plan, never an edit to it.
        fit: stationAdvice(plan.recommendation, session.activities),
        readiness: setupReadiness(rows, live, plan.recommendation.groups),
        reconcile,
      }

  // Only a claim the read can actually back up. A club with no Spond, a
  // read still in flight, a failed read, one that never dispatched and a
  // database where linking is not available yet all resolve to unknown,
  // which the model renders as silence rather than "0 of 18 linked". The
  // rule lives in ../lib/tonight because the one time it was inline here
  // it read a paused query as a known empty link set. The link set is
  // club wide; tonightCounts intersects it with the rows, so a child on
  // a team this session does not cover cannot be counted.
  const linkedIds = linkSetFromRead(links, !!session.spondEventId)
  // EVERY number the screen shows, built once.
  const counts = tonightCounts(rows, live, linkedIds)
  // Whether the reply read has actually answered. In flight, failed and
  // never dispatched all leave every row without a response, which counts
  // the same as an event nobody replied to, so the note must not claim a
  // reply figure until this is true.
  const responsesKnown = responsesKnownFromRead(rsvp, !!session.spondEventId)
  const linkNote = tonightLinkNote(counts, responsesKnown)
  // Where the gap lives, by team, from the same rows and link set the
  // coverage line reads. Empty whenever it has nothing honest to say.
  const unlinkedNote = tonightUnlinkedNote(rows, linkedIds)

  const event = spondEvents.find((e) => e.id === session.spondEventId)
  // A cancelled event was only ever surfaced by the card this screen
  // replaces, so it says so here or it says so nowhere.
  const eventNote = event ? (event.cancelled ? `${event.title} · Cancelled` : event.title) : ''
  // The event's own figures, labelled as its own. This is the pair a coach
  // arrives holding: they read a going figure in Spond, read the Going
  // chip here, and until both sentences were on one screen there was
  // nowhere to find out that the two count different people. Empty when
  // nothing is linked, so a club with no Spond sees no Spond sentence.
  const audienceNote = event ? spondAudienceReplyNote(event) : ''
  // This session's own children in the same shape, directly beneath it.
  // Composed by the model from the counts it already built, so the screen
  // counts nothing here and the sentence cannot disagree with a chip.
  // Silent when coverage was never set, and it withholds the going clause
  // until the reply read has answered.
  const playersNote = event ? tonightPlayersNote(counts, responsesKnown) : ''
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
          <h1>{PLAYERS_GROUPS_TITLE}</h1>
          <div className="sd-sub">{[session.name, fmtDate(session.date), session.time].filter(Boolean).join(' · ')}</div>
        </div>
      </div>

      <TonightScreenView
        rows={rows}
        counts={counts}
        draft={live}
        filter={effective}
        canEdit={canEdit}
        saveStatus={status}
        hasSpondEvent={!!session.spondEventId}
        hasResponses={hasResponseContext(rows)}
        eventNote={eventNote}
        staleNote={staleNote}
        linkNote={linkNote}
        unlinkedNote={unlinkedNote}
        audienceNote={audienceNote}
        playersNote={playersNote}
        refreshing={sync.isPending}
        refreshFailed={sync.isError || sync.data?.ok === false}
        unset={unset}
        setup={setup}
        // A draft edit and nothing else: applySetup returns a new draft and
        // Save groups is still the only thing that writes.
        onApplySetup={canEdit ? () => setDraft(applySetup(live, plan)) : undefined}
        // The same rule for COACH-4: the reconciled draft was built by the
        // gesture helpers and lands in local state, and when nothing
        // changed it is the same object, so pressing cannot even re-render.
        onReconcileSetup={canEdit ? () => setDraft(reconcile.draft) : undefined}
        onFilter={setFilter}
        onToggle={(playerId) => setDraft(toggleIncluded(live, playerId))}
        onPresent={(playerId) => setDraft(toggleAttendance(live, playerId))}
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
        <span className="reg-card-title">{PLAYERS_GROUPS_TITLE}</span>
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
      <TonightCardView summary="Could not load the player list" note="" onOpen={() => nav('register', { sessionId: session.id })} />
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
  // THE SAVED ARRANGEMENT, not a draft. draftFromEntries is a pure read of
  // the stored rows, so this is a projection of what the database holds and
  // there is no draft state on this screen to edit, dirty or save. The
  // groups below are therefore read only by construction rather than by a
  // disabled control.
  const draft = draftFromEntries(entries)
  // The one grouping the product has. Same function, same effective bib
  // rule, same order and same labels as the editing screen, over the same
  // rows: only `included_in_groups` puts a child in one, and attendance is
  // deliberately not read here or shown below.
  const groups = tonightGroups(rows, draft)
  // What to say when there are no groups, decided by the model so the two
  // empty nights ("nobody registered" and "nobody picked") keep their two
  // different sentences.
  const glance = tonightGlanceNote(rows, groups)
  return (
    <div className="tn-glance">
      <TonightCardView
        summary={tonightSummary(rows, draft)}
        // "Not started" over a squad nobody has picked from yet. Not over an
        // EMPTY squad, where there is nothing to start and the note below
        // says what is actually wrong: `every` on no rows is true, so this
        // used to call an unstaffed team's card not started.
        note={rows.length > 0 && rows.every((r) => !draft.included[r.playerId]) ? 'Not started' : ''}
        onOpen={() => nav('register', { sessionId: session.id })}
      />
      {/* Who is in, and what each of them wears. The whole point of the
          card growing a preview: a coach in the car park reads the bib
          colours off their phone without opening the editing screen, which
          is still one tap away through the button above. */}
      <TonightGroupsView groups={groups} />
      {glance && <p className="tn-glance-note">{glance}</p>}
    </div>
  )
}

export function SessionRegister() {
  // The parameter name comes from the same module that declares the route,
  // so the two cannot drift apart. The URL keeps its old segment to avoid
  // route churn; the surface it opens is Players & groups.
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
