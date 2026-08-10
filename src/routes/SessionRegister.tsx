// The session register: the screen a coach holds in one hand at the gate.
//
// It needs nothing configured to work. Open a session, see the children
// it covers grouped by team, tap a row to mark someone in, set a bib if
// it differs from the team's, and add anyone who turns up unexpectedly.
// No Spond and no linking required: this is the coach's own record.
//
// Where Spond IS configured and a child IS linked, their parent's reply
// appears as one small pill beside the name. It is context and never
// attendance: it does not tick anything, does not move any row, does not
// grey a declined child, and is not part of composing the list. Its query
// is a sibling of the register's, never gates the screen, and never
// touches the register's cache, so a failing RSVP read renders exactly
// as an unlinked child does, which is as nothing at all.
//
// One handed by construction: the whole row is the tick target, so a
// thumb never has to find a small checkbox, and the bib control sits in
// its own tap area at the end of the row so a mis-tap changes a colour
// rather than someone's attendance.
import { useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useNav } from '../hooks/useNav'
import {
  useCurrentSeason,
  useMyCapabilities,
  useRegisteredPlayers,
  useRegisterEntries,
  useRemoveRegisterEntry,
  useSession,
  useSessionSpondRsvp,
  useSetRegisterEntry,
  useTeams,
} from '../lib/queries'
import { RSVP_LABELS, rsvpStaleNote } from '../lib/spondRsvp'
import type { Rsvp } from '../lib/spondRsvp'
import {
  activeRoster,
  buildRegister,
  quickAddPool,
  registerSummary,
  type RegisterEntry,
  type RegisterRow,
} from '../lib/register'
import { BIB_COLOURS, BIB_NONE, bibLabel } from '../lib/bibs'
import { coveredTeamIds, coverageOf, coversWholeClub } from '../lib/sessionTeams'
import { SESSION_ID_PARAM } from '../lib/routes'
import type { Player, Session, Team } from '../lib/data'
import { Icon } from '../components/icons'
import { Empty, ErrorNote, Loading, Modal, fmtDate } from '../components/ui'
import './SessionDay.css'
import './SessionRegister.css'

// The RSVP pill. Text, never a tick or a cross: a tick beside a name is
// exactly the mark the register uses for present, and one on an unticked
// row would be misread at a glance in the rain. Monochrome apart from
// "Not going", because green already means present on this screen and a
// green "Going" pill would make an unticked row read as half ticked.
// Non interactive and outside the tick button, so it can never take the
// tap and a screen reader never announces it inside "Mark X present".
function RsvpPill({ rsvp }: { rsvp: Rsvp | null | undefined }) {
  if (!rsvp) return null
  return (
    <span
      className={'reg-rsvp' + (rsvp.status === 'declined' ? ' out' : '')}
      role="img"
      aria-label={`Spond reply: ${RSVP_LABELS[rsvp.status].toLowerCase()}`}
    >
      {RSVP_LABELS[rsvp.status]}
    </span>
  )
}

export function RegisterRowView({
  row,
  canMark,
  rsvp,
  onToggle,
  onBib,
  onRemove,
}: {
  row: RegisterRow
  canMark: boolean
  // Optional and defaulting to nothing, so every call site that knows no
  // Spond keeps producing byte identical markup.
  rsvp?: Rsvp | null
  onToggle: () => void
  onBib: (value: string) => void
  onRemove?: () => void
}) {
  const sub = [
    row.player.shirtNumber != null ? `#${row.player.shirtNumber}` : '',
    row.manual ? 'Added on the day' : '',
  ]
    .filter(Boolean)
    .join(' · ')
  const name = (
    <>
      <span className="reg-check">{row.present && <Icon.check />}</span>
      <span className="reg-name">
        <span className="reg-name-main">{row.player.displayName}</span>
        {sub && <span className="reg-name-sub">{sub}</span>}
      </span>
    </>
  )
  return (
    <div className={'reg-row' + (row.present ? ' on' : '')}>
      {canMark ? (
        <button
          className="reg-tick"
          onClick={onToggle}
          aria-pressed={row.present}
          aria-label={`Mark ${row.player.displayName} present`}
        >
          {name}
        </button>
      ) : (
        <div className="reg-tick">{name}</div>
      )}
      <RsvpPill rsvp={rsvp} />
      <div className="reg-bib">
        {row.bibSwatch && <span className="reg-swatch" style={{ background: row.bibSwatch }} aria-hidden="true" />}
        {canMark ? (
          <select
            value={row.bibValue}
            aria-label={`Bib colour for ${row.player.displayName}`}
            onChange={(e) => onBib(e.target.value)}
          >
            <option value="">Team bib</option>
            <option value={BIB_NONE}>No bib</option>
            {BIB_COLOURS.map((b) => (
              <option key={b.value} value={b.value}>
                {b.label}
              </option>
            ))}
          </select>
        ) : (
          <span className="reg-bib-static">{bibLabel(row.bibColour) ?? 'No bib'}</span>
        )}
      </div>
      {onRemove && (
        <button className="reg-remove" onClick={onRemove} aria-label={`Remove ${row.player.displayName} from the register`}>
          <Icon.x />
        </button>
      )}
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
  // True when the club has no registered players at all, which needs a
  // different answer from "they are all already listed".
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
              : 'Everyone in the club is already on this register.'}
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

export function RegisterScreenView({
  session,
  teams,
  players,
  entries,
  canMark,
  rsvpByPlayer,
  onToggle,
  onBib,
  onRemove,
  onQuickAdd,
}: {
  session: Session
  teams: Team[]
  players: Player[]
  entries: RegisterEntry[]
  canMark: boolean
  // Optional, and absent is the normal case: no Spond, no link, still
  // loading and failed all arrive here as no entry for that player.
  rsvpByPlayer?: Record<string, Rsvp>
  onToggle: (row: RegisterRow) => void
  onBib: (row: RegisterRow, value: string) => void
  onRemove: (row: RegisterRow) => void
  onQuickAdd: () => void
}) {
  const allTeamIds = teams.map((t) => t.id)
  const covered = coveredTeamIds(session)
  const wholeClub = coversWholeClub(session, allTeamIds)
  // A squad's worth of rows: cheap enough to compose on every render, and
  // memoising it would need the covered ids flattened into a dep key.
  const view = buildRegister(players, covered, teams, entries, wholeClub)
  const unset = coverageOf(session).kind === 'unset'
  // Composition never sees Spond: buildRegister still takes its five
  // arguments and the rows are already ordered before this line runs, so
  // a refresh cannot reorder the list under a thumb.
  const rsvp = rsvpByPlayer ?? {}
  // Only the replies actually on screen count towards the freshness line.
  // The lookup is built from a club wide link read, so it can carry a
  // child this session does not cover, and a note about a reply nobody can
  // see would be a claim the screen cannot back up.
  const shown: Record<string, Rsvp> = {}
  for (const g of view.groups) {
    for (const row of g.rows) {
      const r = rsvp[row.player.id]
      if (r) shown[row.player.id] = r
    }
  }
  const staleNote = rsvpStaleNote(shown)

  return (
    <div className="reg">
      <div className="reg-head">
        <div className="reg-count">{registerSummary(view)}</div>
        {canMark && (
          <button className="btn btn-ghost btn-sm" onClick={onQuickAdd}>
            <Icon.plus />
            Add player
          </button>
        )}
      </div>

      {/* Only when it matters: fresh context needs no label, stale
          context must not pass itself off as fresh. */}
      {staleNote && <p className="reg-stale">{staleNote}</p>}

      {unset && view.groups.length === 0 ? (
        <Empty icon={Icon.users} title="This session has no teams yet">
          Choose the teams it covers in the planner and the register fills itself in.
        </Empty>
      ) : view.groups.length === 0 ? (
        <Empty icon={Icon.users} title="Nobody to show">
          No registered players are on the teams this session covers.
        </Empty>
      ) : (
        <>
          {unset && (
            <p className="reg-empty">
              This session has no teams set, so only the players someone has already added appear. Choose its teams in
              the planner to list the rest.
            </p>
          )}
          {view.groups.map((g) => (
          <div className="reg-group" key={g.teamId ?? 'unassigned'}>
            <div className="reg-group-head">
              <h3>{g.teamName}</h3>
              <span className="reg-group-count">
                {g.presentCount}/{g.rows.length}
              </span>
            </div>
            {g.rows.length === 0 ? (
              <p className="reg-empty">Nobody registered on this team yet.</p>
            ) : (
              g.rows.map((row) => (
                <RegisterRowView
                  key={row.player.id}
                  row={row}
                  canMark={canMark}
                  rsvp={rsvp[row.player.id] ?? null}
                  onToggle={() => onToggle(row)}
                  onBib={(v) => onBib(row, v)}
                  onRemove={canMark && row.manual ? () => onRemove(row) : undefined}
                />
              ))
            )}
            </div>
          ))}
        </>
      )}
    </div>
  )
}

function RegisterScreen({ session }: { session: Session }) {
  const nav = useNav()
  const { caps } = useMyCapabilities()
  // Reading the register needs players.view, which the route guard already
  // required. Writing it needs sessions.create, the same capability the
  // register_entries insert, update and delete policies check. A holder of
  // the first without the second reads the register and changes nothing,
  // which is what the server would do to them anyway.
  const canMark = caps.has('sessions.create')
  const { data: teams = [] } = useTeams()
  const season = useCurrentSeason()
  const roster = useRegisteredPlayers(season.data?.id ?? null)
  const register = useRegisterEntries(session.id)
  // Context, on a sibling key. Deliberately absent from every gate
  // below: a slow or failing RSVP read must never blank or error a
  // working register, and its result never reaches the register's cache.
  const rsvp = useSessionSpondRsvp(session.id, session.spondEventId)
  const setEntry = useSetRegisterEntry()
  const removeEntry = useRemoveRegisterEntry()
  const [adding, setAdding] = useState(false)

  const entries = useMemo(() => register.data ?? [], [register.data])
  const players = useMemo(
    () => activeRoster(roster.data ?? [], entries),
    [roster.data, entries],
  )

  // A failed read must never render as "everybody is absent": the coach would
  // be writing on top of state they never saw. The season read counts, because
  // the roster query is disabled without a season id and would otherwise
  // degrade silently to an empty club.
  const rosterFailed = roster.isError || season.isError
  if (register.isError || rosterFailed) return <ErrorNote />
  if (register.isLoading || roster.isLoading || season.isLoading) return <Loading />
  // rsvp.isError and rsvp.isLoading are absent from both lines above on
  // purpose. Spond context is not the register.
  const allTeamIds = teams.map((t) => t.id)
  const pool = quickAddPool(players, coveredTeamIds(session), entries, coversWholeClub(session, allTeamIds))

  return (
    <div>
      <div className="sd-head">
        <button className="icon-btn" style={{ width: 44, height: 44 }} aria-label="Back" onClick={() => nav('sessionDay', { sessionId: session.id })}>
          <Icon.chevL />
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2>Register</h2>
          <div className="sd-sub">
            {[session.name, fmtDate(session.date), session.time].filter(Boolean).join(' · ')}
          </div>
        </div>
      </div>

      <RegisterScreenView
        session={session}
        teams={teams}
        players={players}
        entries={entries}
        canMark={canMark}
        rsvpByPlayer={rsvp.data}
        onToggle={(row) =>
          setEntry.mutate({
            sessionId: session.id,
            playerId: row.player.id,
            present: !row.present,
          })
        }
        onBib={(row, value) =>
          setEntry.mutate({
            sessionId: session.id,
            playerId: row.player.id,
            bibColourOverride: value === '' ? null : value,
          })
        }
        onRemove={(row) => removeEntry.mutate({ sessionId: session.id, playerId: row.player.id })}
        onQuickAdd={() => setAdding(true)}
      />

      {(setEntry.isError || removeEntry.isError) && (
        <ErrorNote>That change did not save. Tap again to retry.</ErrorNote>
      )}

      {adding && (
        <QuickAddView
          pool={pool}
          rosterEmpty={players.length === 0}
          onClose={() => setAdding(false)}
          onAdd={(playerId) => {
            setEntry.mutate({ sessionId: session.id, playerId, present: true, source: 'manual' })
            setAdding(false)
          }}
        />
      )}
    </div>
  )
}

// The session day entry point. Presentational so the count, the empty
// coverage case and the error case can be rendered without query hooks.
export function RegisterCardView({
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
        <span className="reg-card-title">Register</span>
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
export function SessionRegisterCard({ session }: { session: Session }) {
  const nav = useNav()
  const { caps } = useMyCapabilities()
  const canSee = caps.has('players.view')
  const { data: teams = [] } = useTeams()
  const season = useCurrentSeason(canSee)
  const roster = useRegisteredPlayers(season.data?.id ?? null, canSee)
  const register = useRegisterEntries(session.id, canSee)
  const entries = useMemo(() => register.data ?? [], [register.data])
  const players = useMemo(() => activeRoster(roster.data ?? [], entries), [roster.data, entries])

  if (!canSee) return null

  const coverage = coverageOf(session)
  if (coverage.kind === 'unset') {
    return (
      <RegisterCardView
        summary="No teams set, so nobody is listed yet"
        note=""
        onOpen={() => nav('register', { sessionId: session.id })}
      />
    )
  }
  // A failed read shows as unknown rather than as a confident zero. The
  // season read counts for the same reason it does on the screen.
  if (register.isError || roster.isError || season.isError) {
    return (
      <RegisterCardView
        summary="Could not load the register"
        note=""
        onOpen={() => nav('register', { sessionId: session.id })}
      />
    )
  }
  const view = buildRegister(
    players,
    coverage.teamIds,
    teams,
    entries,
    coversWholeClub(session, teams.map((t) => t.id)),
  )
  return (
    <RegisterCardView
      summary={registerSummary(view)}
      note={view.presentTotal === 0 ? 'Not started' : ''}
      onOpen={() => nav('register', { sessionId: session.id })}
    />
  )
}

export function SessionRegister() {
  // The parameter name comes from the same module that declares the route,
  // so the two cannot drift apart.
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
  return <RegisterScreen session={session} />
}
