// The Registered players page (PR 3), replacing the interim Roster at /players.
// Read is club wide under players.view (coaches and admins see the whole club
// register, all teams and Unassigned; parents never reach it, and the route
// guard plus the disabled query mean no child-data read fires for them). Writes
// are capability gated: add and edit require players.manage, permanent delete
// players.delete, per player History audit.view; every write surface is hidden
// on an archived season. Nothing here is optimistic: a write stays busy until
// the server answers, its modal cannot be dismissed in flight, and a failure
// keeps the values for Retry. The filter state lives in the URL so a view is
// shareable. Child data surface. REVIEW.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  useCurrentSeason,
  useMyCapabilities,
  useRegisteredPlayers,
  useSeasons,
  useSpondMappings,
  useSpondLinks,
  useTeams,
} from '../lib/queries'
import {
  DEFAULT_STATUS_FILTER,
  filterRows,
  filtersAreActive,
  filtersToParams,
  parseFilters,
  rowActionKeys,
  sortRows,
  statusCounts,
  STATUS_META,
  type PlayersFilters,
  type StatusFilter,
} from '../lib/playersView'
import {
  EMPTY_SELECTION,
  allShownSelected,
  canBulkDelete,
  clearSelection,
  confineToShown,
  selectAllShown,
  selectedRows,
  selectionAfterFilterChange,
  toggleSelected,
  type PlayerSelection,
} from '../lib/playersBulk'
import { fmtRegDate } from '../lib/playersFormat'
import { downloadTemplate } from '../lib/playersTemplate'
import { mappingForTeam } from '../lib/spond'
import type { RegisteredPlayer, RegistrationStatus, Team } from '../lib/data'
import { Icon } from '../components/icons'
import { Empty, ErrorNote, Loading } from '../components/ui'
import { PlayerFilters } from '../components/PlayerFilters'
import { PlayerFormModal } from '../components/PlayerFormModal'
import { PlayerHistoryModal } from '../components/PlayerHistoryModal'
import { ExportConfirmModal } from '../components/ExportConfirmModal'
import { ImportPlayersModal } from '../components/ImportPlayersModal'
import { RenewSeasonModal } from '../components/RenewSeasonModal'
import {
  DeletePlayerModal,
  ImportFromSpondModal,
  MoveTeamModal,
  RestoreModal,
  WithdrawModal,
} from '../components/PlayerActionModals'
import { BulkDeletePlayersModal, BulkSelectionBar } from '../components/BulkDeletePlayersModal'

type ModalState =
  | { kind: 'add' }
  | { kind: 'edit'; player: RegisteredPlayer }
  | { kind: 'move'; player: RegisteredPlayer }
  | { kind: 'withdraw'; player: RegisteredPlayer }
  | { kind: 'restore'; player: RegisteredPlayer }
  | { kind: 'delete'; player: RegisteredPlayer }
  | { kind: 'history'; player: RegisteredPlayer }
  | { kind: 'import' }
  | { kind: 'importFile' }
  | { kind: 'renew' }
  | { kind: 'export' }
  | { kind: 'bulkDelete' }
  | null

// The checkbox column, present only while bulk selection mode is on. Passed to
// the table and the cards as ONE object so both surfaces read the same
// selection through the same toggle: there is no way to give the desktop table
// a different selection from the phone cards, because there is only one.
export interface RowSelection {
  selected: PlayerSelection
  onToggle: (playerId: string) => void
}

// A coloured dot plus the word, so status is never conveyed by colour alone.
export function StatusBadge({ status }: { status: RegistrationStatus }) {
  const meta = STATUS_META[status]
  return (
    <span className="status-badge">
      <span className="dot" style={{ background: meta.dot }} />
      {meta.label}
    </span>
  )
}

// An accessible overflow disclosure (row actions on desktop, an action sheet on
// mobile). The trigger toggles a popup of plain action buttons: they are Tab
// reachable, Escape closes the popup and returns focus to the trigger, and a
// click outside closes it. It is a disclosure, not an ARIA menu widget (no
// roving arrow-key navigation), so it does not claim the menu role it would not
// fulfil. Selecting an action first returns focus to the trigger, so the modal
// that opens captures a still-mounted opener and can restore focus to it.
function RowMenu({
  label,
  items,
}: {
  label: string
  items: { key: string; label: string; onClick: () => void; danger?: boolean }[]
}) {
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node
      if (!menuRef.current?.contains(t) && !btnRef.current?.contains(t)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])
  const close = () => {
    setOpen(false)
    btnRef.current?.focus()
  }
  if (items.length === 0) return null
  return (
    <div
      className="menu"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation()
          close()
        }
      }}
    >
      <button
        ref={btnRef}
        className="btn btn-ghost btn-sm icon-only"
        style={{ width: 38, padding: 0 }}
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon.more />
      </button>
      {open && (
        <div ref={menuRef} className="menu-list">
          {items.map((it) => (
            <button
              key={it.key}
              className={it.danger ? 'danger' : undefined}
              onClick={() => {
                // Return focus to the trigger (which stays mounted) before the
                // action opens its modal, so the modal restores focus here on
                // close rather than dropping to the document body.
                close()
                it.onClick()
              }}
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// The row actions available for a registration, given the capabilities and
// whether the season is writable. Pure enough to reason about: Edit and History
// are buttons; Move team, the status transitions and Delete live in the menu.
const ROW_ACTION_LABELS: Record<
  string,
  { label: string; kind: 'move' | 'withdraw' | 'restore' | 'delete'; danger?: boolean }
> = {
  move: { label: 'Move team', kind: 'move' },
  withdraw: { label: 'Withdraw', kind: 'withdraw' },
  restore: { label: 'Restore', kind: 'restore' },
  delete: { label: 'Delete permanently', kind: 'delete', danger: true },
}

function rowMenuItems(
  player: RegisteredPlayer,
  opts: { canManage: boolean; canDelete: boolean; writable: boolean; open: (m: ModalState) => void },
): { key: string; label: string; onClick: () => void; danger?: boolean }[] {
  // pending -> registered is offered through the Edit modal's "Mark as
  // registered" control; the menu keeps to the keys rowActionKeys returns.
  return rowActionKeys(player.status, opts).map((key) => {
    const meta = ROW_ACTION_LABELS[key]
    return {
      key,
      label: meta.label,
      danger: meta.danger,
      onClick: () => opts.open({ kind: meta.kind, player } as ModalState),
    }
  })
}

export function Players() {
  const [searchParams, setSearchParams] = useSearchParams()
  // The free-text search lives in page state, never the URL: a search term can
  // be a child's name, and no child name may enter the address bar. The
  // structural filters (season, team, status, sort) are the URL-persisted,
  // shareable ones.
  const [q, setQ] = useState('')
  const urlFilters = useMemo<PlayersFilters>(() => parseFilters(searchParams), [searchParams])
  const filters = useMemo<PlayersFilters>(() => ({ ...urlFilters, q }), [urlFilters, q])
  // Bulk selection state (roadmap PLAYERS-01). Declared here because patch()
  // below is the handler that has to drop a hidden selection at the moment the
  // filters change; see the note there.
  const [bulkMode, setBulkMode] = useState(false)
  const [selected, setSelected] = useState<PlayerSelection>(EMPTY_SELECTION)
  const patch = (p: Partial<PlayersFilters>) => {
    const { q: nextQ, ...rest } = p
    // A change to what is SHOWN drops anybody the new view would hide, computed
    // from the new filters in this handler rather than reacted to afterwards.
    // That is what makes "changing a filter cannot silently broaden the
    // selection" true in both directions: a hidden player is deselected as the
    // filter changes, so widening the filter again brings their row back
    // unticked. Sort is deliberately not in the list: reordering the same rows
    // shows nobody new. A season change is a different register, so nothing
    // carries over at all. Which keys count as a view change, and what each
    // case does, is selectionAfterFilterChange's decision, not this handler's.
    const changedKeys = Object.keys(p)
    setSelected((prev) => selectionAfterFilterChange(prev, changedKeys, filterRows(rows, { ...filters, ...p })))
    if (nextQ !== undefined) setQ(nextQ)
    if (Object.keys(rest).length > 0) {
      setSearchParams(filtersToParams({ ...urlFilters, ...rest }), { replace: true })
    }
  }

  const { caps, isPending: capsPending } = useMyCapabilities()
  const canView = caps.has('players.view')
  const canManage = caps.has('players.manage')
  const canDelete = caps.has('players.delete')
  const canHistory = caps.has('audit.view')
  const canManageSeasons = caps.has('seasons.manage')
  const canExport = caps.has('players.export')
  const canImport = caps.has('players.import')

  const { data: seasons = [], isLoading: seasonsLoading, isError: seasonsError } = useSeasons(canView)
  const { data: currentSeason, isLoading: currentLoading } = useCurrentSeason(canView)
  const { data: teams = [] } = useTeams()
  const { data: mappings = [] } = useSpondMappings()
  const spondLinks = useSpondLinks(canManage)

  const requestedSeasonId = filters.seasonId ?? currentSeason?.id ?? null
  const selectedSeason = seasons.find((s) => s.id === requestedSeasonId) ?? currentSeason ?? null
  // Drive the query and the season select from the validated season, never the
  // raw URL id, so a hand-edited /players?season=<bogus id> cannot make the
  // table query one season while the header, writable state and select show
  // another. An unknown id falls back to the current season here.
  const effectiveSeasonId = selectedSeason?.id ?? null
  const archived = selectedSeason?.archivedAt != null
  const isCurrent = !!selectedSeason?.isCurrent
  // Only the current season is writable from this page: add_player and
  // update_player derive the season server side, and the Spond import and board
  // seeding are current-season only. A non-current season (archived or simply
  // superseded) is read only here; its registration-level state is still
  // reachable, but editing happens against the current season to avoid a write
  // ever landing on the wrong season.
  const writable = isCurrent
  const seasonName = selectedSeason?.name ?? ''

  const { data: rows = [], isLoading: rowsLoading, isError: rowsError } = useRegisteredPlayers(
    effectiveSeasonId,
    canView,
  )

  const teamMap = useMemo(() => new Map(teams.map((t) => [t.id, t.name])), [teams])
  const teamDisplay = (id: string | null): string =>
    id == null ? 'Unassigned' : (teamMap.get(id) ?? 'Deleted team')
  const teamSortName = (id: string | null | undefined): string => (id ? (teamMap.get(id) ?? '') : '')

  const counts = statusCounts(rows)
  const filtered = filterRows(rows, filters)
  const sorted = sortRows(filtered, filters.sort, teamSortName)
  const active = filtersAreActive(filters)

  const [modal, setModal] = useState<ModalState>(null)
  const open = (m: ModalState) => setModal(m)
  const close = () => setModal(null)

  // ---- bulk selection (roadmap PLAYERS-01) ---------------------------
  // A mode rather than always-on checkboxes: the register is read far more
  // often than it is pruned, and a permanent checkbox column on a phone card is
  // noise in front of the common case. The two state hooks are declared with
  // the filters above, because patch() owns the drop-on-filter-change rule.
  //
  // Gated exactly as the single row Delete permanently is: players.manage plus
  // players.delete on a writable (current) season. Bulk mode spends an existing
  // permission faster; it does not create one, and it does not make an archived
  // or superseded season writable.
  const bulkAllowed = canBulkDelete({ canManage, canDelete, writable })
  const bulkActive = bulkMode && bulkAllowed
  const shownIds = sorted.map((r) => r.playerId)
  // The selection is confined to what is shown TWICE, and neither is a
  // reaction after the fact:
  //   * patch() drops anybody the new filters would hide, in the same handler
  //     as the filter change, so there is no moment where a hidden player is
  //     still selected and no way for widening the filter again to bring a
  //     tick back;
  //   * this derivation is the belt to that brace, so whatever the stored set
  //     holds, the count, the list and the delete only ever see rows the coach
  //     can currently see. A background refetch that removes a row therefore
  //     shrinks the selection immediately rather than sending an id the server
  //     would refuse.
  // The confinement is also PERSISTED, during render, because a background
  // refetch has no event handler to persist it in: deriving alone kept the
  // hidden id in the stored set, so a row a refetch hid and a later refetch
  // showed again came back TICKED with nobody having selected it, which is
  // the re-widened-filter rule broken by another door. Dropping it from
  // storage the moment it leaves the view makes a returning row arrive
  // unticked whichever door hid it. Adjusting state during render is React's
  // own pattern for reconciling state with props; it is conditional on a real
  // drop and confineToShown returns the same instance otherwise, so it cannot
  // loop, and it is deliberately not an effect, which would leave a rendered
  // moment where the hidden row was still selected.
  // Losing the capability or moving to a read only season empties it the same
  // way, because bulkActive gates the whole derivation.
  const confined = bulkActive ? confineToShown(selected, shownIds) : null
  if (confined !== null && confined.dropped > 0) setSelected(confined.next)
  const selectedNow = confined !== null ? confined.next : EMPTY_SELECTION
  const selectedPlayers = selectedRows(sorted, selectedNow)
  // A refetch can empty the selection while the deletion dialog is open (the
  // last selected child left the view or the register). Hiding the dialog on
  // an empty selection alone left modal.kind primed, so the page came back to
  // life with a deletion dialog that remounted on the NEXT tick without
  // Delete being pressed. The stale state is cleared the same way the
  // confinement is persisted: during render, conditionally, because no
  // handler runs for a background refetch. The legitimate paths never see
  // this: opening requires a non empty selection, and a completed run clears
  // the selection and the modal in one batched handler.
  if (modal?.kind === 'bulkDelete' && selectedPlayers.length === 0) setModal(null)
  const rowSelection: RowSelection | undefined = bulkActive
    ? { selected: selectedNow, onToggle: (id) => setSelected((prev) => toggleSelected(prev, id)) }
    : undefined

  // The team the page filter resolves to, for the Add default and the Spond
  // affordance. A specific team id, or null (All teams or Unassigned).
  const resolvedTeamId = filters.team !== 'all' && filters.team !== 'unassigned' ? filters.team : null
  const spondTeam: Team | null = resolvedTeamId ? (teams.find((t) => t.id === resolvedTeamId) ?? null) : null
  const spondMapping = resolvedTeamId ? mappingForTeam(mappings, resolvedTeamId) : null
  // Import from Spond is gated on players.import (managers and admins by
  // default), and renders only on the current season with a specific mapped
  // team selected (Spond stays current-season only, server chosen).
  const showSpond = canImport && isCurrent && writable && !!spondTeam && !!spondMapping
  const showSpondLinks = canManage && mappings.length > 0 && spondLinks.data?.available !== false
  const showAdd = canManage && isCurrent && writable
  // Renew is a season level bulk action (players.manage), independent of the
  // page's selected season, available whenever there is more than one season to
  // renew between. The modal picks the source and target seasons itself.
  const showRenew = canManage && seasons.length >= 2
  // Export is allowed on ANY selected season (a past register is a legitimate
  // export), so it is not gated on writable/current like the write affordances.
  // It IS gated on a settled, non-errored register load, because the header
  // (where the button lives) renders before body() resolves the row query, and
  // the confirm dialog's previewed count must never read 0 while the real set
  // is still loading or errored.
  const showExport = canExport && !!selectedSeason && !rowsLoading && !rowsError
  // Spreadsheet import targets any non archived season (defaulting to current),
  // so it is gated on a non archived selected season, not on writable/current.
  // The preview reads the current register, so it waits for a settled load.
  const showImport = canImport && !!selectedSeason && !archived && !rowsLoading && !rowsError
  // The blank template is season neutral and available to any players.import
  // holder, including on an archived season (it writes nothing and carries no
  // child data).
  const showTemplate = canImport && !!selectedSeason

  // Loading and error gates. The capability read gates first so a parent (route
  // guarded anyway) never falls through to a child-data read.
  if (capsPending || seasonsLoading || currentLoading) return <Loading />
  if (seasonsError) return <ErrorNote />
  if (!canView) return null

  const changeSeason = (value: string) => {
    // Store null (a clean URL) when the choice is the current season.
    patch({ seasonId: value === currentSeason?.id ? null : value })
  }

  const seasonSelect =
    selectedSeason || seasons.length > 0 ? (
      <div className="field" style={{ marginBottom: 0, maxWidth: 260 }}>
        <label htmlFor="season-select">Season</label>
        <select
          id="season-select"
          className="select"
          value={effectiveSeasonId ?? ''}
          onChange={(e) => changeSeason(e.target.value)}
        >
          {seasons.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
              {s.isCurrent ? ' (current)' : s.archivedAt ? ' (archived)' : ''}
            </option>
          ))}
        </select>
      </div>
    ) : null

  const addButton = showAdd ? (
    <button className="btn btn-primary" onClick={() => open({ kind: 'add' })}>
      <Icon.plus />
      Add player
    </button>
  ) : null

  const spondButton = showSpond ? (
    <button className="btn btn-ghost" onClick={() => open({ kind: 'import' })}>
      <Icon.rotate />
      Import from Spond
    </button>
  ) : null

  // Spond links is deliberately NOT gated on the team filter: a linking
  // affordance that appears only once a specific team is selected is one
  // nobody finds. Any players.manage holder sees it whenever the club has
  // at least one mapping, and the screen itself picks the team.
  const linksButton = showSpondLinks ? (
    <Link to="/players/spond-links" className="btn btn-ghost">
      <Icon.link />
      Spond links
    </Link>
  ) : null

  const renewButton = showRenew ? (
    <button className="btn btn-ghost" onClick={() => open({ kind: 'renew' })}>
      <Icon.calendar />
      Renew
    </button>
  ) : null

  const exportButton = showExport ? (
    <button className="btn btn-ghost" onClick={() => open({ kind: 'export' })}>
      <Icon.download />
      Export
    </button>
  ) : null

  const importButton = showImport ? (
    <button className="btn btn-ghost" onClick={() => open({ kind: 'importFile' })}>
      <Icon.upload />
      Import players
    </button>
  ) : null

  // Enters and leaves bulk selection mode. Never selects anything by itself:
  // the mode opens with nothing selected, every time.
  const selectButton = bulkAllowed ? (
    <button
      className={'btn ' + (bulkActive ? 'btn-quiet' : 'btn-ghost')}
      aria-pressed={bulkActive}
      onClick={() => {
        setSelected(clearSelection())
        setBulkMode((on) => !on)
      }}
    >
      <Icon.check />
      {bulkActive ? 'Done selecting' : 'Select players'}
    </button>
  ) : null

  const templateButton = showTemplate ? (
    <button className="btn btn-quiet" onClick={() => downloadTemplate('csv')}>
      <Icon.fileText />
      Download template
    </button>
  ) : null

  const header = (
    <div className="page-head">
      <div>
        <h2>Registered players</h2>
        <div className="sub">The club's register for a season. Read is club wide; team is a filter.</div>
      </div>
      <div className="row" style={{ gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        {seasonSelect}
        {addButton}
        {selectButton}
        {spondButton}
        {linksButton}
        {renewButton}
        {importButton}
        {exportButton}
        {templateButton}
      </div>
    </div>
  )

  // No season at all (pre setup only; the migration creates the initial season,
  // so this is a hypothetical new club). Admins get a setup call to action.
  if (!selectedSeason) {
    return (
      <div>
        {header}
        {canManageSeasons ? (
          <Empty icon={Icon.calendar} title="Set up the first season">
            Players are registered against a season. Create and activate a season to open the register.{' '}
            <Link to="/admin/seasons" className="btn btn-primary" style={{ marginTop: 12 }}>
              Set up season
            </Link>
          </Empty>
        ) : (
          <Empty icon={Icon.calendar} title="No season yet">
            The club has no current season. An admin needs to set one up before players can be registered.
          </Empty>
        )}
      </div>
    )
  }

  const body = () => {
    if (rowsLoading) return <Loading />
    if (rowsError) return <ErrorNote />
    if (rows.length === 0) {
      return (
        <Empty icon={Icon.users} title={`No players in ${seasonName} yet`}>
          {canManage
            ? 'Add the first player to open the register.'
            : 'The register for this season is empty.'}
        </Empty>
      )
    }
    if (sorted.length === 0) {
      return (
        <Empty icon={Icon.search} title="Nothing matches">
          Try clearing a filter or searching a shorter name.{' '}
          <button
            className="btn btn-ghost"
            style={{ marginTop: 12 }}
            onClick={() => patch({ team: 'all', status: DEFAULT_STATUS_FILTER, q: '' })}
          >
            Clear filters
          </button>
        </Empty>
      )
    }
    return (
      <>
        <DesktopTable
          rows={sorted}
          teamDisplay={teamDisplay}
          sort={filters.sort}
          onSort={(k) => patch({ sort: k })}
          canManage={canManage}
          canDelete={canDelete}
          canHistory={canHistory}
          writable={writable}
          open={open}
          selection={rowSelection}
        />
        <div className="reg-cards">
          {sorted.map((p) => (
            <PlayerCard
              key={p.registrationId}
              player={p}
              teamDisplay={teamDisplay}
              canManage={canManage}
              canDelete={canDelete}
              canHistory={canHistory}
              writable={writable}
              open={open}
              selection={rowSelection}
            />
          ))}
        </div>
      </>
    )
  }

  return (
    <div>
      {header}

      {!isCurrent && (
        <div className="archived-banner">
          <Icon.eye />
          {archived
            ? `${seasonName} is archived and read only.`
            : `${seasonName} is not the current season and is read only here.`}{' '}
          Switch to the current season to make changes.
        </div>
      )}

      {teams.length === 0 && (
        <p className="muted" style={{ fontSize: 13.5, marginBottom: 12 }}>
          No teams exist yet, so every player is Unassigned. An admin can add teams under Admin, Teams.
        </p>
      )}

      {/* Summary counts over the whole season (Withdrawn counted even while
          hidden by the default filter). Each pill sets the status filter. */}
      <div className="reg-count">
        <span className="total">
          {counts.total} player{counts.total !== 1 ? 's' : ''}
        </span>
        <CountPill
          label="Pending"
          count={counts.pending}
          dot={STATUS_META.pending.dot}
          active={filters.status === 'pending'}
          onClick={() => patch({ status: (filters.status === 'pending' ? DEFAULT_STATUS_FILTER : 'pending') as StatusFilter })}
        />
        <CountPill
          label="Registered"
          count={counts.registered}
          dot={STATUS_META.registered.dot}
          active={filters.status === 'registered'}
          onClick={() => patch({ status: (filters.status === 'registered' ? DEFAULT_STATUS_FILTER : 'registered') as StatusFilter })}
        />
        <CountPill
          label="Withdrawn"
          count={counts.withdrawn}
          dot={STATUS_META.withdrawn.dot}
          active={filters.status === 'withdrawn'}
          onClick={() => patch({ status: (filters.status === 'withdrawn' ? DEFAULT_STATUS_FILTER : 'withdrawn') as StatusFilter })}
        />
        {active && (
          <span className="showing">
            Showing {filtered.length} of {counts.total}
          </span>
        )}
      </div>

      <PlayerFilters filters={filters} onChange={patch} teams={teams} />

      {bulkActive && (
        <>
          <BulkSelectionBar
            selectedCount={selectedNow.size}
            shownCount={shownIds.length}
            allSelected={allShownSelected(selectedNow, shownIds)}
            onSelectAllShown={() => setSelected((prev) => selectAllShown(prev, shownIds))}
            onClear={() => setSelected(clearSelection())}
            onDelete={() => open({ kind: 'bulkDelete' })}
            onExit={() => {
              setSelected(clearSelection())
              setBulkMode(false)
            }}
          />
          <p className="bulk-bar-note">
            Selecting applies to the players shown here. Changing a filter or the search deselects anybody it hides.
          </p>
        </>
      )}

      {body()}

      {modal?.kind === 'add' && (
        <PlayerFormModal
          mode="add"
          teams={teams}
          defaultTeamId={resolvedTeamId}
          currentSeasonId={currentSeason?.id ?? ''}
          seasonName={currentSeason?.name ?? seasonName}
          onClose={close}
        />
      )}
      {modal?.kind === 'edit' && (
        <PlayerFormModal
          mode="edit"
          player={modal.player}
          teams={teams}
          defaultTeamId={modal.player.teamId}
          currentSeasonId={currentSeason?.id ?? ''}
          seasonName={seasonName}
          onClose={close}
        />
      )}
      {modal?.kind === 'move' && <MoveTeamModal player={modal.player} teams={teams} onClose={close} />}
      {modal?.kind === 'withdraw' && <WithdrawModal player={modal.player} seasonName={seasonName} onClose={close} />}
      {modal?.kind === 'restore' && <RestoreModal player={modal.player} seasonName={seasonName} onClose={close} />}
      {modal?.kind === 'delete' && <DeletePlayerModal player={modal.player} onClose={close} />}
      {/* Zero selected is not a destructive state: the bar's button is disabled
          at zero, and this refuses to mount a dialog for nobody even if it were
          reached another way. */}
      {modal?.kind === 'bulkDelete' && selectedPlayers.length > 0 && (
        <BulkDeletePlayersModal
          players={selectedPlayers}
          onClose={close}
          onDeleted={() => {
            // The run committed, so the selection it described is gone.
            setSelected(clearSelection())
            setBulkMode(false)
          }}
        />
      )}
      {modal?.kind === 'history' && (
        <PlayerHistoryModal
          playerId={modal.player.playerId}
          displayName={modal.player.displayName}
          teams={teams}
          onClose={close}
        />
      )}
      {modal?.kind === 'import' && spondTeam && spondMapping && (
        <ImportFromSpondModal team={spondTeam} mapping={spondMapping} seasonName={seasonName} onClose={close} />
      )}
      {modal?.kind === 'renew' && (
        <RenewSeasonModal
          seasons={seasons}
          currentSeasonId={currentSeason?.id ?? null}
          teams={teams}
          onClose={close}
        />
      )}
      {modal?.kind === 'importFile' && selectedSeason && (
        <ImportPlayersModal
          season={{ id: selectedSeason.id, name: seasonName }}
          seasonRows={rows}
          teams={teams}
          onClose={close}
        />
      )}
      {modal?.kind === 'export' && selectedSeason && (
        <ExportConfirmModal
          season={{ id: selectedSeason.id, name: seasonName }}
          filters={filters}
          filteredCount={filtered.length}
          totalCount={counts.total}
          teamLabel={
            filters.team === 'all'
              ? 'All teams'
              : filters.team === 'unassigned'
                ? 'Unassigned'
                : teamDisplay(filters.team)
          }
          onClose={close}
        />
      )}
    </div>
  )
}

function CountPill({
  label,
  count,
  dot,
  active,
  onClick,
}: {
  label: string
  count: number
  dot: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button className={'chip' + (active ? ' on' : '')} aria-pressed={active} onClick={onClick}>
      <span className="chip-dot" style={{ background: dot }} />
      {label} {count}
    </button>
  )
}

// The sort direction is fixed per key; this reports it for aria-sort on the
// active column only.
function ariaSortFor(key: 'name' | 'team' | 'status' | 'shirt' | 'registered' | 'updated'): 'ascending' | 'descending' {
  return key === 'registered' || key === 'updated' ? 'descending' : 'ascending'
}

// A sortable table header. aria-sort reports the fixed direction on the active
// column and "none" otherwise; the button is the keyboard operable sort control.
function SortTh({
  label,
  k,
  sort,
  onSort,
  className,
}: {
  label: string
  k: PlayersFilters['sort']
  sort: PlayersFilters['sort']
  onSort: (k: PlayersFilters['sort']) => void
  className?: string
}) {
  return (
    <th scope="col" className={className} aria-sort={sort === k ? ariaSortFor(k) : 'none'}>
      <button type="button" onClick={() => onSort(k)}>
        {label}
        {sort === k && <Icon.chevDown style={{ width: 12, height: 12 }} />}
      </button>
    </th>
  )
}

export function DesktopTable({
  rows,
  teamDisplay,
  sort,
  onSort,
  canManage,
  canDelete,
  canHistory,
  writable,
  open,
  selection,
}: {
  rows: RegisteredPlayer[]
  teamDisplay: (id: string | null) => string
  sort: PlayersFilters['sort']
  onSort: (k: PlayersFilters['sort']) => void
  canManage: boolean
  canDelete: boolean
  canHistory: boolean
  writable: boolean
  open: (m: ModalState) => void
  // Present only in bulk selection mode. The same object the phone cards get,
  // so the two surfaces cannot show different selections.
  selection?: RowSelection
}) {
  return (
    <div className="reg-table-wrap">
      <table className="reg-table">
        <caption className="sr-only">Registered players</caption>
        <thead>
          <tr>
            {selection && <th scope="col" className="col-select" aria-label="Select" />}
            <SortTh label="Shirt" k="shirt" sort={sort} onSort={onSort} />
            <SortTh label="Name" k="name" sort={sort} onSort={onSort} />
            <SortTh label="Team" k="team" sort={sort} onSort={onSort} />
            <SortTh label="Status" k="status" sort={sort} onSort={onSort} />
            <SortTh label="Registered date" k="registered" sort={sort} onSort={onSort} className="col-date" />
            <SortTh label="Last updated" k="updated" sort={sort} onSort={onSort} className="col-updated" />
            <th scope="col" aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.registrationId} className={p.status === 'withdrawn' ? 'withdrawn' : undefined}>
              {selection && (
                <td className="col-select">
                  <input
                    type="checkbox"
                    checked={selection.selected.has(p.playerId)}
                    onChange={() => selection.onToggle(p.playerId)}
                    aria-label={`Select ${p.displayName}`}
                  />
                </td>
              )}
              <td className={p.shirtNumber == null ? 'muted-cell' : undefined}>{p.shirtNumber ?? '—'}</td>
              <td>{p.displayName}</td>
              <td className={p.teamId == null ? 'muted-cell' : undefined}>{teamDisplay(p.teamId)}</td>
              <td>
                <StatusBadge status={p.status} />
              </td>
              <td className="col-date">{fmtRegDate(p.registeredDate) || '—'}</td>
              <td className="col-updated">{fmtRegDate(p.updatedAt)}</td>
              <td>
                <div className="reg-row-actions">
                  {canManage && writable && (
                    <button className="btn btn-ghost btn-sm" onClick={() => open({ kind: 'edit', player: p })}>
                      Edit
                    </button>
                  )}
                  {canHistory && (
                    <button className="btn btn-ghost btn-sm" onClick={() => open({ kind: 'history', player: p })}>
                      History
                    </button>
                  )}
                  <RowMenu
                    label={`More actions for ${p.displayName}`}
                    items={rowMenuItems(p, { canManage, canDelete, writable, open })}
                  />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function PlayerCard({
  player,
  teamDisplay,
  canManage,
  canDelete,
  canHistory,
  writable,
  open,
  selection,
}: {
  player: RegisteredPlayer
  teamDisplay: (id: string | null) => string
  canManage: boolean
  canDelete: boolean
  canHistory: boolean
  writable: boolean
  open: (m: ModalState) => void
  // The same object the desktop table gets (see DesktopTable).
  selection?: RowSelection
}) {
  const items = rowMenuItems(player, { canManage, canDelete, writable, open })
  if (canManage && writable) items.unshift({ key: 'edit', label: 'Edit', onClick: () => open({ kind: 'edit', player }) })
  if (canHistory) items.push({ key: 'history', label: 'History', onClick: () => open({ kind: 'history', player }) })
  return (
    <div
      className={
        'player-card' +
        (player.status === 'withdrawn' ? ' withdrawn' : '') +
        (selection?.selected.has(player.playerId) ? ' selected' : '')
      }
    >
      {selection && (
        <label className="pc-select">
          <input
            type="checkbox"
            checked={selection.selected.has(player.playerId)}
            onChange={() => selection.onToggle(player.playerId)}
            aria-label={`Select ${player.displayName}`}
          />
        </label>
      )}
      <span className="pc-shirt">{player.shirtNumber ?? '—'}</span>
      <div className="pc-main">
        <div className="pc-name">{player.displayName}</div>
        <div className="pc-meta">
          <span className={player.teamId == null ? 'muted-cell' : undefined}>{teamDisplay(player.teamId)}</span>
          <StatusBadge status={player.status} />
        </div>
      </div>
      <RowMenu label={`Actions for ${player.displayName}`} items={items} />
    </div>
  )
}
