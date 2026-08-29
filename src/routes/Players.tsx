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
  directHeaderActions,
  headerAvailability,
  overflowHeaderActions,
  type PlayerHeaderAction,
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
import type { IconComponent } from '../components/icons'
import { Chip, Empty, ErrorNote, Loading, LoadingRows } from '../components/ui'
import {
  Badge,
  Button,
  IconButton,
  Note,
  PageHeader,
  SelectField,
  buttonClass,
  type BadgeTone,
  type ButtonVariant,
} from '../components/primitives'
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
  | { kind: 'bulkDelete'; players: RegisteredPlayer[] }
  | null

// The checkbox column, present only while bulk selection mode is on. Passed to
// the table and the cards as ONE object so both surfaces read the same
// selection through the same toggle: there is no way to give the desktop table
// a different selection from the phone cards, because there is only one.
export interface RowSelection {
  selected: PlayerSelection
  onToggle: (playerId: string) => void
}

// The tone each registration status reads as. It lives here rather than beside
// STATUS_META, because playersView is a pure lib module and BadgeTone is a
// component type: a lib that imports a component's vocabulary is the wrong way
// round. Withdrawn is neutral rather than danger; a child who has left the
// squad is a fact about the register, not a failure.
const STATUS_TONE: Record<RegistrationStatus, BadgeTone> = {
  pending: 'warning',
  registered: 'success',
  withdrawn: 'neutral',
}

// A tone, a dot and the word, through the shared Badge, so status is never
// conveyed by colour alone. This is one of the two primitives VISUAL-01
// defined and could not accept, because Registered players is the only
// surface in the product that shows a status badge on a list row.
export function StatusBadge({ status }: { status: RegistrationStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{STATUS_META[status].label}</Badge>
}

// An item in the overflow. Either it runs something (onClick) or it goes
// somewhere (to), never both: a destination stays an anchor inside the popup,
// so Spond links keeps middle click, open in a new tab and the status bar it
// has as a header button. `icon` is optional because the row items have never
// carried one and the header items are the same actions the slot renders, so
// they keep the icon they had there.
interface MenuItem {
  key: string
  label: string
  icon?: IconComponent
  onClick?: () => void
  to?: string
  danger?: boolean
}

// An accessible overflow disclosure, used by the row actions in the table and
// the cards and by the header's More actions. The trigger toggles a popup of
// plain actions: they are Tab reachable, Escape closes the popup and returns
// focus to the trigger, and a click outside closes it. It is a disclosure, not
// an ARIA menu widget (no roving arrow-key navigation), so it does not claim
// the menu role it would not fulfil. Selecting an action first returns focus to
// the trigger, so the modal that opens captures a still-mounted opener and can
// restore focus to it.
//
// The trigger is an icon alone on a row, where the child's name beside it is
// the context and a visible "More actions" on every row would be noise, and a
// labelled button in the page header, where it is the only one on the page and
// has to say what it opens. One component either way, so the focus contract has
// one implementation rather than one per surface.
function OverflowMenu({
  label,
  items,
  trigger = 'icon',
  className,
}: {
  label: string
  items: MenuItem[]
  trigger?: 'icon' | 'labelled'
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
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
      ref={rootRef}
      className={['menu', className].filter(Boolean).join(' ')}
      // Escape is a React handler on this wrapper, so it fires only while
      // focus is inside. Tab past the last item and the popup was left open
      // with aria-expanded true, over the page, with no keyboard way to shut
      // it: a mouse user could click outside, a keyboard user could not. So
      // focus leaving the wrapper closes it, WITHOUT returning focus, because
      // focus has deliberately moved on and pulling it back would fight the
      // Tab.
      //
      // relatedTarget is what decides it, the same guard Sheet uses in
      // primitives.tsx. Reading document.activeElement instead does not work
      // and fails in the direction that looks like nothing: at focusout the
      // focus change has not landed, activeElement is still the body, and a
      // microtask sees that and closes the popup on the way INTO it. Clicking
      // an item then unmounted the button before its own click handler ran,
      // so every action opened nothing.
      //
      // The deferred read is only for relatedTarget being null, which is
      // focus going nowhere in particular: a press on a non focusable area,
      // or the window itself losing focus. A timeout rather than a microtask,
      // because it has to run after the focus change, and the window blur
      // case then correctly finds focus still inside and leaves the popup up.
      onBlur={(e) => {
        if (!open) return
        const next = e.relatedTarget as Node | null
        if (next && rootRef.current?.contains(next)) return
        setTimeout(() => {
          const root = rootRef.current
          if (root && root.isConnected && !root.contains(document.activeElement)) setOpen(false)
        }, 0)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation()
          close()
        }
      }}
    >
      {trigger === 'labelled' ? (
        <Button ref={btnRef} icon={Icon.more} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {label}
        </Button>
      ) : (
        <IconButton
          ref={btnRef}
          label={label}
          icon={Icon.more}
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        />
      )}
      {open && (
        <div ref={menuRef} className="menu-list">
          {items.map((it) =>
            it.to !== undefined ? (
              <Link key={it.key} to={it.to} onClick={() => close()}>
                {it.icon && <it.icon aria-hidden="true" />}
                {it.label}
              </Link>
            ) : (
              <button
                key={it.key}
                className={it.danger ? 'danger' : undefined}
                onClick={() => {
                  // Return focus to the trigger (which stays mounted) before the
                  // action opens its modal, so the modal restores focus here on
                  // close rather than dropping to the document body.
                  close()
                  it.onClick?.()
                }}
              >
                {it.icon && <it.icon aria-hidden="true" />}
                {it.label}
              </button>
            ),
          )}
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
): MenuItem[] {
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

  const {
    data: rows = [],
    isLoading: rowsLoading,
    isError: rowsError,
    refetch: rowsRefetch,
  } = useRegisteredPlayers(effectiveSeasonId, canView)

  const teamMap = useMemo(() => new Map(teams.map((t) => [t.id, t.name])), [teams])
  const teamDisplay = (id: string | null): string =>
    id == null ? 'Unassigned' : (teamMap.get(id) ?? 'Deleted team')
  const teamSortName = (id: string | null | undefined): string => (id ? (teamMap.get(id) ?? '') : '')

  // Whether the register read has actually answered. Every number on this page
  // is derived from `rows`, which defaults to an empty array, so a read that
  // is still in flight or has failed would otherwise count as a club with no
  // children in it.
  const registerKnown = !rowsLoading && !rowsError
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
  // Losing eligibility (a capability revoked, the season no longer writable)
  // EXITS bulk mode and discards the stored selection, during render like
  // every other reconciliation here, because a background capability or
  // season refresh has no handler. Substituting an empty set for the render
  // alone left both stored, so eligibility restored later silently revived
  // bulk mode with the old players already ticked.
  if (bulkMode && !bulkAllowed) {
    setBulkMode(false)
    setSelected(clearSelection())
  }
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
  // Losing the capability or moving to a read only season is handled above:
  // it exits bulk mode and discards the stored selection outright, so a
  // restored eligibility starts from nothing rather than reviving old ticks.
  const confined = bulkActive ? confineToShown(selected, shownIds) : null
  if (confined !== null && confined.dropped > 0) setSelected(confined.next)
  const selectedNow = confined !== null ? confined.next : EMPTY_SELECTION
  const selectedPlayers = selectedRows(sorted, selectedNow)
  // The open dialog renders the selection CAPTURED when Delete was pressed
  // (modal.players), never this live derivation. Deriving it live made the
  // dialog's mount a function of background refetches, which produced two
  // real defects in turn: an emptied derivation unmounted the dialog leaving
  // modal.kind primed to remount on the next tick, and, once that state was
  // cleared reactively, the same emptying could unmount a dialog whose RPC
  // was still IN FLIGHT, suppressing the completion report of a permanent
  // deletion (useGuardedSubmit goes inactive on unmount). Capturing at press
  // time removes the whole class: the dialog stays mounted until it closes
  // itself, and a selection the world moved under is the server's designed
  // refusal (identity revalidation) and the preview's staleness message,
  // not a vanishing dialog.
  const rowSelection: RowSelection | undefined = bulkActive
    ? { selected: selectedNow, onToggle: (id) => setSelected((prev) => toggleSelected(prev, id)) }
    : undefined

  // The team the page filter resolves to, for the Add default and the Spond
  // affordance. A specific team id, or null (All teams or Unassigned).
  const resolvedTeamId = filters.team !== 'all' && filters.team !== 'unassigned' ? filters.team : null
  const spondTeam: Team | null = resolvedTeamId ? (teams.find((t) => t.id === resolvedTeamId) ?? null) : null
  const spondMapping = resolvedTeamId ? mappingForTeam(mappings, resolvedTeamId) : null
  // Which header actions this page offers. The seven conditions live in
  // playersView.ts, each with the reason it carries, so they are provable in
  // the fast suite over every combination: the six lower frequency actions ride
  // in the More actions overflow now, none of their labels is in a closed
  // page's markup, and a rendered test asserting one is absent would pass
  // whatever its gate did. Selection is the exception and is passed in, because
  // canBulkDelete is already the one pure implementation of that rule.
  const availability = headerAvailability({
    canManage,
    canExport,
    canImport,
    bulkAllowed,
    hasSeason: !!selectedSeason,
    isCurrent,
    writable,
    archived,
    seasonCount: seasons.length,
    hasSpondMapping: mappings.length > 0,
    spondLinksAvailable: spondLinks.data?.available !== false,
    spondTeamMapped: !!spondTeam && !!spondMapping,
    registerSettled: registerKnown,
  })

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
      <SelectField
        id="season-select"
        label="Season"
        className="reg-season-field"
        value={effectiveSeasonId ?? ''}
        onChange={(e) => changeSeason(e.target.value)}
      >
        {seasons.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
            {s.isCurrent ? ' (current)' : s.archivedAt ? ' (archived)' : ''}
          </option>
        ))}
      </SelectField>
    ) : null

  // One description per header action: when it is offered, what it is called,
  // its icon, and what it does. Written ONCE, so the slot and the overflow
  // render the same action rather than two that can be renamed apart, and so
  // "preserve every capability gate" is a property of this table rather than
  // of two call sites agreeing. `available` is exactly the gate each button
  // carried before; nothing here widens or narrows one.
  //
  // Spond links is deliberately NOT gated on the team filter: a linking
  // affordance that appears only once a specific team is selected is one
  // nobody finds. Any players.manage holder sees it whenever the club has at
  // least one mapping, and the screen itself picks the team. It is a
  // destination rather than a command, so it carries `to` and stays an anchor
  // in both renderings.
  const ACTIONS: Record<
    PlayerHeaderAction,
    {
      label: string
      icon: IconComponent
      variant?: ButtonVariant
      onClick?: () => void
      to?: string
      /* Selection mode is a toggle, so its direct rendering says which way it
         is set. It never overflows, so this has no rendering in the popup. */
      pressed?: boolean
    }
  > = {
    add: {
      label: 'Add player',
      icon: Icon.plus,
      variant: 'primary',
      onClick: () => open({ kind: 'add' }),
    },
    // Enters and leaves bulk selection mode. Never selects anything by itself:
    // the mode opens with nothing selected, every time.
    select: {
      label: bulkActive ? 'Done selecting' : 'Select players',
      icon: Icon.check,
      variant: bulkActive ? 'quiet' : 'ghost',
      pressed: bulkActive,
      onClick: () => {
        setSelected(clearSelection())
        setBulkMode((on) => !on)
      },
    },
    spond: {
      label: 'Import from Spond',
      icon: Icon.rotate,
      onClick: () => open({ kind: 'import' }),
    },
    links: { label: 'Spond links', icon: Icon.link, to: '/players/spond-links' },
    renew: {
      label: 'Renew',
      icon: Icon.calendar,
      onClick: () => open({ kind: 'renew' }),
    },
    import: {
      label: 'Import players',
      icon: Icon.upload,
      onClick: () => open({ kind: 'importFile' }),
    },
    export: {
      label: 'Export',
      icon: Icon.download,
      onClick: () => open({ kind: 'export' }),
    },
    template: {
      label: 'Download template',
      icon: Icon.fileText,
      variant: 'quiet',
      onClick: () => downloadTemplate('csv'),
    },
  }

  // A direct action. A destination is an anchor taking the button classes
  // through buttonClass rather than being turned into a button.
  //
  // No action the slot holds today carries `to`, so that branch does not run:
  // HEADER_DIRECT is add and select, and Spond links is the only destination
  // and always overflows. It is here because ACTIONS is one description per
  // action and either rendering has to honour the whole shape. Deleting the
  // branch would make moving a destination into the slot render a button with
  // no handler, which is a silent failure rather than a compile error.
  const directAction = (key: PlayerHeaderAction) => {
    const a = ACTIONS[key]
    return a.to !== undefined ? (
      <Link key={key} to={a.to} className={buttonClass(a.variant ?? 'ghost')}>
        <a.icon />
        {a.label}
      </Link>
    ) : (
      <Button key={key} variant={a.variant ?? 'ghost'} icon={a.icon} aria-pressed={a.pressed} onClick={a.onClick}>
        {a.label}
      </Button>
    )
  }

  const overflowItems: MenuItem[] = overflowHeaderActions(availability).map((key) => {
    const a = ACTIONS[key]
    return { key, label: a.label, icon: a.icon, onClick: a.onClick, to: a.to }
  })

  const header = (
    <PageHeader
      className="players-head"
      title="Registered players"
      sub="The club's register for a season. Read is club wide; team is a filter."
      actions={
        <>
          {seasonSelect}
          {directHeaderActions(availability).map(directAction)}
          <OverflowMenu label="More actions" items={overflowItems} trigger="labelled" className="players-more" />
        </>
      }
    />
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
            <Link to="/admin/seasons" className={buttonClass('primary', 'md', { className: 'empty-action' })}>
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
    // The register's shape IS known: a list of rows. So the load is skeleton
    // rows rather than a spinner, which is 2.14's rule, and the label is what
    // announces it, since the bars themselves are decoration.
    if (rowsLoading) return <LoadingRows rows={6} label={`Loading the ${seasonName} register…`} />
    // Retrying is meaningful here: the register is one read and the row query
    // owns it, so the button re-runs exactly what failed.
    if (rowsError) {
      return (
        <ErrorNote onRetry={() => void rowsRefetch()}>
          The register for {seasonName} could not be loaded, so no players are shown. Nothing has been changed.
        </ErrorNote>
      )
    }
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
          <Button
            className="empty-action"
            onClick={() => patch({ team: 'all', status: DEFAULT_STATUS_FILTER, q: '' })}
          >
            Clear filters
          </Button>
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

      {/* A standing condition carrying no state of its own: the neutral Note is
          --line-2 on --line, which is exactly what this banner already was. */}
      {!isCurrent && (
        <Note tone="neutral" icon={Icon.eye} className="reg-banner">
          {archived
            ? `${seasonName} is archived and read only.`
            : `${seasonName} is not the current season and is read only here.`}{' '}
          Switch to the current season to make changes.
        </Note>
      )}

      {teams.length === 0 && (
        <Note tone="info" className="reg-banner">
          No teams exist yet, so every player is Unassigned. An admin can add teams under Admin, Teams.
        </Note>
      )}

      {/* Summary counts over the whole season (Withdrawn counted even while
          hidden by the default filter). Each pill sets the status filter.
          No number is claimed until the register has answered: a read that
          has not landed or has failed has no count, and "0 players" is a
          claim about the club rather than about the read. Unreadable is never
          rendered as empty, which is the rule the rest of this product
          already follows for a link set and a reply state.

          While the read is IN FLIGHT the strip keeps its shape, as skeleton
          bars sized like the total and the three chips they stand in for.
          Withholding the block outright was the first version of this and it
          moved the search field, both filter selects and the whole list down
          at the moment the read landed, which on a phone puts a status filter
          chip under a thumb already reaching for the search box. A FAILED read
          gets no skeleton, because a skeleton means "still arriving": it is a
          settled render, and nothing moves under the coach again until they
          press Retry themselves. */}
      {!registerKnown && !rowsError && (
        <div className="reg-count" aria-hidden="true">
          <span className="skeleton skeleton-total"></span>
          <span className="skeleton skeleton-chip"></span>
          <span className="skeleton skeleton-chip"></span>
          <span className="skeleton skeleton-chip"></span>
        </div>
      )}
      {registerKnown && (
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
      )}

      <PlayerFilters filters={filters} onChange={patch} teams={teams} />

      {bulkActive && (
        <>
          <BulkSelectionBar
            selectedCount={selectedNow.size}
            shownCount={shownIds.length}
            allSelected={allShownSelected(selectedNow, shownIds)}
            onSelectAllShown={() => setSelected((prev) => selectAllShown(prev, shownIds))}
            onClear={() => setSelected(clearSelection())}
            onDelete={() => open({ kind: 'bulkDelete', players: selectedPlayers })}
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
          reached another way. The dialog renders the CAPTURED selection, so a
          background refetch can neither unmount it mid flight nor change what
          it lists; the server's identity revalidation is what answers a
          selection the world moved under. */}
      {modal?.kind === 'bulkDelete' && modal.players.length > 0 && (
        <BulkDeletePlayersModal
          players={modal.players}
          eligible={bulkAllowed}
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

// The status summary control. It is the shared filter Chip: a pill that
// carries aria-pressed, its 44px hit area and the status dot the primitive
// already knows how to paint, rather than a second hand written chip.
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
    <Chip on={active} dot={dot} onClick={onClick}>
      {label} {count}
    </Chip>
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
    // sort-th is what lets the cell hand its padding to the button, so the
    // button's own box is the 44px target rather than a smaller box inside a
    // padded cell. A header cell with no button keeps the cell padding.
    <th scope="col" className={['sort-th', className].filter(Boolean).join(' ')} aria-sort={sort === k ? ariaSortFor(k) : 'none'}>
      <button type="button" onClick={() => onSort(k)}>
        {label}
        {sort === k && <Icon.chevDown aria-hidden="true" />}
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
                  {/* The label is the 44px target. A 20px box in a padded cell
                      is a 36px target, and the rule is not a phone rule: the
                      card list already wraps its box for the same reason. */}
                  <label className="cell-select">
                    <input
                      type="checkbox"
                      checked={selection.selected.has(p.playerId)}
                      onChange={() => selection.onToggle(p.playerId)}
                      aria-label={`Select ${p.displayName}`}
                    />
                  </label>
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
                  <OverflowMenu
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
        {/* The two columns the table drops below 1080px. 2.9 asks the card to
            carry the same information as the table, not a subset, and these
            are the only two the card was missing. They are labelled rather
            than bare dates, because two dates side by side say nothing. */}
        <div className="pc-dates">
          <span>Registered {fmtRegDate(player.registeredDate) || '—'}</span>
          <span>Updated {fmtRegDate(player.updatedAt)}</span>
        </div>
      </div>
      <OverflowMenu label={`Actions for ${player.displayName}`} items={items} />
    </div>
  )
}
