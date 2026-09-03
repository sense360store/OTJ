// Rename, add or remove the club's teams, behind teams.manage and backed by
// the teams RLS. Teams are a filter and a default, never access control, so
// removing one never hides or orphans content: the foreign keys null the
// references and the confirm spells that out. REVIEW: capability gated
// admin surface.
//
// VISUAL-02 brought it onto the shared system: PageHeader, Card, Button and
// IconButton, the field primitives, Note and the shared state families.
// Nothing about the queries, the capability gate, the removal consequences or
// the bib vocabulary moved; what changed is which vocabulary draws them, and
// that two refusals the screen could already produce are now shown rather
// than swallowed.
//
// COACH-1B added the club's TEAM ORDER: the list is shown in club order (the
// placed teams by position, then the unplaced ones alphabetically), each row
// carries Move up and Move down, and one explicit Save team order writes the
// positions 1..N. Moving is a local draft and writes nothing; opening the
// screen writes nothing; adding a team places nobody (a new team is
// unplaced until an admin places it, because adding a team must never make
// an ability judgement on its own); removing a team renumbers nobody, since
// gaps are valid by database design. The order is a TEAM order and never a
// player rating, and nothing on this screen or off it reads it for a
// coaching decision yet: src/lib/teamOrder.ts holds the rules and says so.
//
// No drag and drop, on purpose. A club has about five teams, a press on Move
// up is reliable on a phone, reachable from a keyboard and needs no hidden
// gesture, and the accessible name of every control carries the team's own
// name rather than relying on an arrow.
import { useEffect, useRef, useState } from 'react'
import { useSessions } from '../context/SessionsContext'
import { focusWasLost, useFocusRestore } from '../hooks/useFocusRestore'
import {
  useDeleteTeam,
  useInsertTeam,
  useMyCapabilities,
  useProfiles,
  useRenameTeam,
  useSaveTeamOrder,
  useSetTeamBibColour,
  useTeams,
} from '../lib/queries'
import type { Team } from '../lib/data'
import { BIB_COLOURS, bibSwatch } from '../lib/bibs'
import { sessionCoversAnyTeam } from '../lib/sessionTeams'
import {
  TEAM_ORDER_CHANGED,
  TeamOrderChanged,
  TeamOrderReadFailed,
  clubOrder,
  moveTeam,
  reconcileDraft,
  sameIdOrder,
  samePositions,
  saveFailureMessage,
  intendedPositions,
  positionsAgree,
  snapshotAfterRead,
  teamPositions,
  teamsInDraftOrder,
} from '../lib/teamOrder'
import type { ClubOrderState, MoveDirection, TeamPosition } from '../lib/teamOrder'
import { Icon } from '../components/icons'
import { Empty, ErrorNote, Loading, Modal } from '../components/ui'
import { Button, Card, IconButton, Note, PageHeader, SelectField, TextField } from '../components/primitives'

/* The one sentence that says what the order is FOR, exported so the screen
   test reads the same string the screen renders rather than a copy of it.
   Future tense on purpose: nothing consumes the order yet (the grouping
   suggestion is still handed null), and a sentence that said it was in use
   would send an admin to Players and groups expecting a change. */
export const TEAM_ORDER_COPY =
  'Put the strongest team first. A later release will use this order for coaching group suggestions; nothing uses it yet.'

/* Exported for the same reason BibColourField is: what it says is a PRODUCT
   RULE rather than copy (teams are a filter and a default, so removing one
   clears references and widens nothing), and a source text check on those
   sentences would be satisfied by writing them in a comment. Rendered
   directly, src/routes/adminTeams.screens.test.tsx reads what a coach reads. */
export function DeleteTeamModal({
  team,
  memberCount,
  sessionCount,
  onClose,
  onRemoved,
}: {
  team: Team
  memberCount: number
  sessionCount: number
  onClose: () => void
  onRemoved: () => void
}) {
  const del = useDeleteTeam()
  const remove = () =>
    del.mutate(
      { id: team.id },
      {
        onSuccess: () => {
          onRemoved()
          onClose()
        },
      },
    )
  return (
    <Modal
      title="Remove team"
      sub={team.name}
      onClose={onClose}
      footer={
        <>
          <Button variant="quiet" onClick={onClose} disabled={del.isPending}>
            Cancel
          </Button>
          <Button variant="danger" icon={Icon.trash} onClick={remove} disabled={del.isPending}>
            {del.isPending ? 'Removing…' : 'Remove'}
          </Button>
        </>
      }
    >
      {/* The consequences, unchanged. Teams are a filter and a default, so
          removing one clears references rather than deleting anything, and a
          session that covered only this team is left with no teams rather
          than widened to the whole club. */}
      <p className="modal-copy">
        {memberCount} member{memberCount !== 1 ? 's' : ''} and {sessionCount} session
        {sessionCount !== 1 ? 's' : ''} reference this team. They keep working; their team is cleared. Any registered
        players on this team become Unassigned, keeping their registration, shirt number and history. No sessions, people
        or players are removed.
      </p>
      <p className="modal-copy">
        A session that covered only this team is left with no teams set, and its register lists nobody until a coach
        picks the teams again. It never widens to the whole club.
      </p>
      {del.isError && (
        <Note tone="danger" role="alert">
          Could not remove the team. Try again.
        </Note>
      )}
    </Modal>
  )
}

// The team's default bib colour, the one a whole squad wears unless a
// coach overrides someone on the night. Presentational so the swatch and
// the option list render without a query client.
//
// 2.16 makes bib colour the deliberate exception that stays colour, and it
// stays paired with its word: the select carries the colour's NAME, which is
// the information, and the swatch beside it is aria-hidden and supplementary.
// The label is read rather than shown, because in a list of five teams the
// row's own name is what a sighted reader is reading and the label repeats it.
export function BibColourField({
  value,
  disabled,
  label,
  selectRef,
  onChange,
}: {
  value: string | null
  disabled: boolean
  label: string
  /* So the row can put focus back on the control a coach was standing on.
     Choosing a colour starts the write that disables this select, and a
     browser blurs a disabled control. */
  selectRef?: React.Ref<HTMLSelectElement>
  onChange: (v: string | null) => void
}) {
  return (
    <div className="bib-field">
      {value && (
        <span aria-hidden="true" className="bib-swatch" style={{ background: bibSwatch(value) ?? 'transparent' }} />
      )}
      <SelectField
        label={label}
        labelHidden
        className="field-flush bib-select"
        ref={selectRef}
        value={value ?? ''}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value || null)}
      >
        <option value="">No bib</option>
        {BIB_COLOURS.map((b) => (
          <option key={b.value} value={b.value}>
            {b.label}
          </option>
        ))}
      </SelectField>
    </div>
  )
}

/* What the club has stated about its order, said in words. Exported and
   rendered directly by the screen test, because the three states are a
   product rule (null means unset and is SAID to be unset rather than quietly
   read as an order) and a source text check would be satisfied by a comment.

   The alphabetical fallback is named as alphabetical: the one thing this
   sentence must never do is let a list that happens to be in name order read
   as a judgement about the teams. */
export function TeamOrderStatus({
  state,
  unplaced,
  dirty,
}: {
  state: ClubOrderState
  unplaced: readonly Team[]
  // The list shows the admin's own arrangement rather than what is stored,
  // so the sentence must not describe the list as alphabetical or as saved.
  dirty: boolean
}) {
  if (state === 'unset') {
    return (
      <Note tone="warning" className="admin-note">
        {dirty
          ? 'Team order is not set. The list shows the order you are arranging; press Save team order to store it.'
          : 'Team order is not set. The teams are listed alphabetically, which is not a coaching order. Move them into order and press Save team order, or press it without moving anything to accept the order shown.'}
      </Note>
    )
  }
  if (state === 'incomplete') {
    const names = unplaced.map((t) => t.name)
    const list = names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
    const plural = names.length !== 1
    return (
      <Note tone="warning" className="admin-note">
        Team order is incomplete: {list} {plural ? 'have' : 'has'} no position yet
        {dirty
          ? '. The list shows the order you are arranging; Save team order places every team.'
          : ` and ${plural ? 'are' : 'is'} listed after the ordered teams. Move ${plural ? 'them' : 'it'} into place and press Save team order, which places every team.`}
      </Note>
    )
  }
  if (dirty) return <p className="admin-hint">Saved club order, with changes not yet stored. Press Save team order to store the order shown.</p>
  return <p className="admin-hint">Saved club order. Move a team and press Save team order to change it.</p>
}

function TeamRow({
  team,
  position,
  total,
  ordering,
  onMove,
  moveRef,
  onDelete,
}: {
  team: Team
  // 1-based position in the DRAFT, which is what the row is showing.
  position: number
  total: number
  // The order is being written: the order controls and Remove freeze, so the
  // draft being saved cannot be invalidated under the write.
  ordering: boolean
  onMove: (direction: MoveDirection) => void
  moveRef: (direction: MoveDirection, el: HTMLButtonElement | null) => void
  onDelete: () => void
}) {
  const rename = useRenameTeam()
  const setBib = useSetTeamBibColour()
  const [draft, setDraft] = useState(team.name)
  const changed = draft.trim() !== team.name && draft.trim() !== ''
  /* Both of this row's writes disable the control that started them, and a
     browser blurs a disabled control. Choosing a bib colour freezes the
     select; renaming settles with the stored name equal to the draft, so
     `changed` goes false and Rename disables under the press. Both leave
     focus on the document body, so both are restored to where the coach was.
     Reproduced in a browser before either was repaired. */
  const nameRef = useRef<HTMLInputElement>(null)
  const bibRef = useRef<HTMLSelectElement>(null)
  const wantNameFocus = useFocusRestore(!rename.isPending, nameRef)
  const wantBibFocus = useFocusRestore(!setBib.isPending, bibRef)
  return (
    <li className="admin-row">
      <TextField
        label={`Team name for ${team.name}`}
        labelHidden
        className="field-flush admin-field-grow"
        ref={nameRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
      />
      <BibColourField
        value={team.bibColour}
        disabled={setBib.isPending}
        label={'Default bib colour for ' + team.name}
        selectRef={bibRef}
        onChange={(v) => {
          wantBibFocus()
          setBib.mutate({ teamId: team.id, bibColour: v })
        }}
      />
      <div className="admin-row-acts">
        {/* Named for its own team: a screen reader listing the page's buttons
            gets five identical "Rename" otherwise, which is exactly the
            context that listing strips away. The visible word is still the
            start of the name, so the label matches what a voice user says. */}
        <Button
          size="sm"
          icon={Icon.check}
          aria-label={'Rename ' + team.name}
          disabled={!changed || rename.isPending}
          onClick={() => {
            wantNameFocus()
            rename.mutate({ id: team.id, name: draft.trim() })
          }}
        >
          {rename.isPending ? 'Renaming…' : 'Rename'}
        </Button>
        <IconButton
          tone="danger"
          icon={Icon.trash}
          label={'Remove ' + team.name}
          disabled={ordering}
          onClick={onDelete}
        />
      </div>
      {/* The ordering cluster: a second, smaller line under the row's main
          controls rather than a fourth control squeezed into the first, so
          nothing on a phone becomes one cramped strip. The number is the
          row's DRAFT position; the group's name carries it for a screen
          reader, and each button carries the team's name, so "Move Titans
          up" is what is read and what a voice user says. */}
      <div className="admin-order-acts" role="group" aria-label={`Team order for ${team.name}: position ${position} of ${total}`}>
        <span className="admin-position" aria-hidden="true">
          {position}
        </span>
        <IconButton
          icon={Icon.chevUp}
          label={`Move ${team.name} up`}
          disabled={ordering || position === 1}
          ref={(el) => moveRef('up', el)}
          onClick={() => onMove('up')}
        />
        <IconButton
          icon={Icon.chevDown}
          label={`Move ${team.name} down`}
          disabled={ordering || position === total}
          ref={(el) => moveRef('down', el)}
          onClick={() => onMove('down')}
        />
      </div>
      {/* Both refusals used to be swallowed: the mutation failed and the row
          said nothing at all, so a rename or a bib change that the RLS
          refused looked like one that had saved. */}
      {rename.isError && (
        <Note tone="danger" role="alert" className="admin-row-note">
          Could not rename {team.name}. Try again.
        </Note>
      )}
      {setBib.isError && (
        <Note tone="danger" role="alert" className="admin-row-note">
          Could not change the bib colour for {team.name}. Try again.
        </Note>
      )}
    </li>
  )
}

/* One empty list for every render the read has not answered, so the fresh
   read comparison below cannot see a new array on each render and loop. */
const NO_TEAMS: Team[] = []

export function AdminTeams() {
  const { data, isLoading, isError, refetch, dataUpdatedAt } = useTeams()
  const teams = data ?? NO_TEAMS
  const { data: members = [] } = useProfiles()
  const { sessions } = useSessions()
  const insert = useInsertTeam()
  /* The save's outcomes are handled in the HOOK's callbacks, which run before
     its invalidation refetch is awaited; a callback passed to mutate() would
     run after that read had landed, which is too late to set what the read
     is compared against (see useSaveTeamOrder). */
  const save = useSaveTeamOrder({
    // The refetch will carry exactly what was written, and the snapshot
    // becomes that, so the save's own readback is not taken for another
    // admin's change; a read that differs from it IS one, and is said so.
    // A draft is kept (or made, for an unset or incomplete club that
    // accepted the order shown without a move) for exactly that
    // comparison, and is dropped again the moment the read agrees.
    onSuccess: (vars) => {
      const intended = intendedPositions(vars.orderedIds)
      setSavedAs(intended)
      setDraft({ ids: vars.orderedIds, expected: intended })
    },
    // The club's teams or their positions changed under the draft: the
    // draft is dropped so the refetched truth is what the list shows,
    // and the refusal says so. A failure on the fresh read itself wrote
    // nothing, so the snapshot the save carried is still true of what was
    // read before and is KEPT: a later read that differs from it is
    // somebody else's change and drops the draft, rather than being
    // adopted as if this save had changed what is stored, which would let
    // the retry pass the check and overwrite it. Any other failure may
    // have written some rows: the arrangement that was SENT is kept as
    // the draft, made into one if the club accepted the order shown
    // without a move, so the list keeps showing what the admin accepted
    // rather than adopting a half written order, one more press can
    // finish it, and the next read is adopted as what it was drawn over
    // rather than compared with a snapshot the save itself has outdated.
    onError: (error, vars) => {
      if (error instanceof TeamOrderChanged) setDraft(null)
      else if (error instanceof TeamOrderReadFailed) setDraft({ ids: vars.orderedIds, expected: vars.expected })
      else setDraft({ ids: vars.orderedIds, expected: null })
    },
  })
  const [name, setName] = useState('')
  const [removing, setRemoving] = useState<Team | null>(null)
  const [removed, setRemoved] = useState<{ id: string; message: string } | null>(null)
  const { caps } = useMyCapabilities()

  /* ---- the order draft ----
     Null while the admin has moved nothing, in which case the list follows
     what is stored and a fresh read (a team added, removed or placed by
     anybody) shows through at once. A draft is the admin's own arrangement,
     kept across refetches (a team the read still holds keeps its place, one
     it no longer holds leaves, a newcomer joins at the end), and dropped
     again the moment the stored order agrees with it, which is what a
     successful save's refetch brings. So the list never flicks back to the
     old order between the write settling and the read landing, and never
     keeps showing a stale arrangement over one another admin has since
     stored. */
  const stored = clubOrder(teams)
  const storedIds = stored.teams.map((t) => t.id)
  /* A draft carries the arrangement AND the positions it was drawn from,
     taken when the draft is created and never rebuilt from a later read:
     the save refuses against that snapshot, and a snapshot rebuilt at Save
     time from a read already carrying another admin's order would agree
     with the fresh read and let the older draft overwrite it. After a save
     the snapshot is what the save LEFT: on success the order it wrote, so
     its own refetch is not mistaken for another admin's change; after any
     other failure null, meaning the next read is adopted as it comes,
     because some rows may have been written and the arrangement is kept. */
  const [draft, setDraft] = useState<{ ids: string[]; expected: TeamPosition[] | null } | null>(null)
  /* The order the last successful save wrote, and the success note is
     DERIVED from it: "Team order saved." shows only while the read holds
     exactly that order. A read carrying somebody else's order, a team added
     or removed since, or an order left incomplete takes the note with it,
     so it is never said of an order this admin did not save. */
  const [savedAs, setSavedAs] = useState<TeamPosition[] | null>(null)
  const orderSaved = savedAs !== null && positionsAgree(savedAs, teamPositions(teams))
  /* Set when a fresh read dropped the draft because the stored order moved
     under it, so the screen says why the arrangement went. */
  const [refreshed, setRefreshed] = useState(false)
  /* Set between a team insert settling and the fresh read that carries the
     new team: Save is withheld in that window, or it would send an order
     that does not know the team just added. */
  const [awaitingRead, setAwaitingRead] = useState(false)
  const arranged = draft === null ? null : reconcileDraft(draft.ids, teams)
  const dirty = arranged !== null && !sameIdOrder(arranged, storedIds)
  /* Adjusted during the render a FRESH READ lands in, which is the documented
     way to adjust state to a changed input (an effect would render the stale
     arrangement once and then re-render). A landed read is known by the
     query's own timestamp rather than by the rows changing, because a
     refetch after a save that wrote nothing brings the same rows and is a
     read all the same. The draft is checked against its snapshot
     (snapshotAfterRead): a position that moved under it drops it and says
     so, a read that agrees with what is stored drops it silently, a team
     just added joins the snapshot unplaced, and a draft left with no
     snapshot by a failed save adopts the read as it comes. The saved note
     needs no adjusting here: it is derived from the read agreeing with what
     was saved, so a team added or removed after the save, or another
     admin's order, takes it away in the same render. */
  const [seenRead, setSeenRead] = useState(dataUpdatedAt)
  if (dataUpdatedAt !== seenRead) {
    setSeenRead(dataUpdatedAt)
    setAwaitingRead(false)
    if (draft !== null) {
      const read = teamPositions(teams)
      const next = draft.expected === null ? read : snapshotAfterRead(draft.expected, read)
      if (next === null) {
        setDraft(null)
        setRefreshed(true)
      } else if (!dirty) {
        setDraft(null)
      } else if (draft.expected === null || !samePositions(next, draft.expected)) {
        setDraft({ ids: draft.ids, expected: next })
      }
    }
  }
  const draftIds = dirty ? (arranged as string[]) : storedIds
  const rows = teamsInDraftOrder(draftIds, teams)
  /* Between a save settling and its refetch the draft is what was just
     written and is not "unsaved": the status and the hint describe the
     stored order plainly for that one round trip rather than calling the
     order just saved not yet stored. */
  const unsaved = dirty && !awaitingRead
  /* Save is offered whenever pressing it would state something: an unset or
     incomplete club has positions to write even for an order nobody moved
     (accepting the order shown IS the statement), and a configured club has
     nothing to say until the draft differs from what is stored. It is
     withheld while a team is being added and until the read that carries
     the new team lands, because an order sent in that window would not know
     the team and would either be refused as a change or leave it unplaced,
     and likewise between a save settling and its refetch. */
  const canSave =
    rows.length > 0 && !save.isPending && !insert.isPending && !awaitingRead && (stored.state !== 'configured' || dirty)
  /* What a screen reader hears after a move. The position pill is visual and
     the group's name does not re-announce when it changes, so the moved team
     and its new position are said once, politely, and the sentence carries
     the draft's unsaved state with it. */
  const [announcement, setAnnouncement] = useState('')

  /* ---- focus after a move ----
     Moving a row moves its DOM node, and moving it to the top or the bottom
     disables the control that was pressed; a browser drops focus to the body
     for the first and, depending on the browser, keeps it on a control that
     can no longer be reached from the keyboard for the second. Both count as
     lost here, and focus goes back to the moved row: the same control when it
     is still usable, otherwise its partner, so a press at the boundary lands
     on Move down rather than on nothing. The predicate is the shared one; the
     effect is this screen's own because what it waits for is the draft
     changing, not a write settling, which is the case useFocusRestore keys
     on. */
  const moveButtons = useRef(new Map<string, Partial<Record<MoveDirection, HTMLButtonElement | null>>>())
  const pendingMoveFocus = useRef<{ id: string; direction: MoveDirection } | null>(null)
  const [moves, setMoves] = useState(0)
  useEffect(() => {
    const pending = pendingMoveFocus.current
    if (!pending) return
    pendingMoveFocus.current = null
    const active = document.activeElement
    const stuck = active instanceof HTMLButtonElement && active.disabled
    if (!focusWasLost(active, document.body) && !stuck) return
    const buttons = moveButtons.current.get(pending.id)
    const same = buttons?.[pending.direction]
    const other = buttons?.[pending.direction === 'up' ? 'down' : 'up']
    const target = same && !same.disabled ? same : other && !other.disabled ? other : null
    target?.focus()
  }, [moves])
  const moveRefFor = (id: string) => (direction: MoveDirection, el: HTMLButtonElement | null) => {
    const entry = moveButtons.current.get(id) ?? {}
    entry[direction] = el
    moveButtons.current.set(id, entry)
  }
  const move = (id: string, direction: MoveDirection) => {
    const next = moveTeam(rows, id, direction)
    if (next === rows) return
    pendingMoveFocus.current = { id, direction }
    setSavedAs(null)
    setRefreshed(false)
    // The snapshot is the read the FIRST move was made over; later moves
    // keep it (a null left by a failed save included, until the next read
    // is adopted), and a fresh read is checked against it rather than
    // replacing it.
    setDraft({ ids: next.map((t) => t.id), expected: draft ? draft.expected : teamPositions(teams) })
    setMoves((n) => n + 1)
    const to = next.findIndex((t) => t.id === id)
    setAnnouncement(`${next[to].name} moved to position ${to + 1} of ${next.length}. Not saved yet.`)
  }

  /* The save's outcome, and the thing focus goes back to. Pressing Save
     disables the button while the write is out, so the browser drops focus.
     On success the draft ends equal to what is stored, Save stays disabled
     once the refetch lands, and focus goes to the success note; on failure
     it goes to the refusal, which is the error summary pattern Login uses,
     so the sentence being announced is the thing that receives focus and a
     keyboard user retries from there rather than from the top of the page.
     Two restores because the two outcomes settle on different conditions:
     the success one waits for the refetch to disable Save, the failure one
     settles with the write. Each finds its own target absent on the other
     outcome and moves nothing. */
  const savedRef = useRef<HTMLDivElement>(null)
  const failedRef = useRef<HTMLDivElement>(null)
  const wantSavedFocus = useFocusRestore(orderSaved && !canSave, savedRef)
  const wantFailedFocus = useFocusRestore(!save.isPending, failedRef)
  const saveOrder = () => {
    if (!canSave) return
    setSavedAs(null)
    setRefreshed(false)
    setAnnouncement('')
    wantSavedFocus()
    wantFailedFocus()
    // Armed BEFORE the write goes out, never in a callback: the read that
    // clears it is the invalidation the hook awaits before any per-call
    // callback runs, so a flag set there would be set after the read had
    // landed and nothing would clear it.
    setAwaitingRead(true)
    // The positions the draft was drawn from go with it, so a position
    // another admin stored in between is refused rather than overwritten.
    // With no draft (an unset or incomplete club accepting the order
    // shown) the positions are the ones on screen now.
    save.mutate({ orderedIds: draftIds, expected: draft?.expected ?? teamPositions(teams) })
  }

  /* The removal's outcome, and the thing focus goes back to. Pressing the
     row's Remove opens the dialog; the dialog closes on success and Modal
     restores focus to the trigger; the refetch then takes the row and the
     trigger with it, and the browser drops focus onto the document body.
     Reproduced in a browser before it was repaired, which is the rule #215,
     #216 and #217 left.

     WHAT IS WAITED FOR IS THE ROW LEAVING THE LIST, not the write settling,
     and the two are a network round trip apart: on the settling render the
     trigger is still there and still focused, so a hook keyed on the write
     would find focus exactly where it should be, do nothing, and forget it
     had been asked. This is the case the Feedback slice met on a deleted
     item and it behaves the same way here. */
  const removedRef = useRef<HTMLDivElement>(null)
  const rowGone = removed !== null && !teams.some((t) => t.id === removed.id)
  const wantRemovedFocus = useFocusRestore(rowGone, removedRef)
  /* Add team disables while the write is out and the success empties the
     field, so it stays disabled and the browser drops focus. Focus goes back
     to the field, which is where the next team is typed. */
  const newTeamRef = useRef<HTMLInputElement>(null)
  const wantNewTeamFocus = useFocusRestore(!insert.isPending, newTeamRef)
  if (isLoading) return <Loading />
  if (isError) return <ErrorNote onRetry={() => void refetch()} />
  // The route guard already keeps members without teams.manage out; this is
  // belt and braces for the brief render before a redirect.
  if (!caps.has('teams.manage')) return null

  const add = () => {
    const trimmed = name.trim()
    // One rule for the button and for Enter in the field: nothing is added
    // while a write is out, and nothing while the ORDER is being written,
    // because a team arriving under that write would invalidate the draft
    // being saved.
    if (!trimmed || insert.isPending || save.isPending) return
    wantNewTeamFocus()
    // Save stays withheld until the read that carries the new team. Armed
    // before the write for the reason saveOrder gives: the insert's hook
    // awaits its invalidation before a per-call callback runs. A refused
    // insert brings no read, so the refusal disarms it.
    setAwaitingRead(true)
    insert.mutate(
      { name: trimmed },
      {
        onSuccess: () => setName(''),
        onError: () => setAwaitingRead(false),
      },
    )
  }

  return (
    <div>
      <PageHeader
        title="Teams"
        sub="The club's teams. A filter and a default for sessions and coaches, never a wall."
      />

      <Card className="admin-narrow">
        <div className="admin-add">
          <TextField
            label="New team"
            className="field-flush admin-field-grow"
            ref={newTeamRef}
            placeholder="Team name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
          />
          <Button
            variant="primary"
            icon={Icon.plus}
            disabled={!name.trim() || insert.isPending || save.isPending}
            onClick={add}
          >
            {insert.isPending ? 'Adding…' : 'Add team'}
          </Button>
        </div>
        {insert.isError && (
          <Note tone="danger" role="alert" className="admin-note">
            Could not add the team. The name may already exist.
          </Note>
        )}
        {removed && (
          <div ref={removedRef} tabIndex={-1} className="admin-note">
            <Note tone="success" role="status">
              {removed.message}
            </Note>
          </div>
        )}
        {teams.length === 0 ? (
          <Empty icon={Icon.flag} title="No teams yet">
            Add the first one above. Sessions and coaches can then be filtered by it.
          </Empty>
        ) : (
          <>
            <div className="section-title section-title-tight admin-order-title">
              <h2>Team order</h2>
            </div>
            <p className="admin-intro">{TEAM_ORDER_COPY}</p>
            <TeamOrderStatus state={stored.state} unplaced={stored.unplaced} dirty={unsaved} />
            {/* The arrangement was dropped because a fresh read carried an
                order somebody else stored under it. Said here, as a status,
                because the list below has already changed. */}
            {refreshed && !save.isError && (
              <Note tone="warning" role="status" className="admin-note">
                {TEAM_ORDER_CHANGED}
              </Note>
            )}
            <div className="sr-only" aria-live="polite">
              {announcement}
            </div>
            <ul className="admin-list">
              {rows.map((t, i) => (
                <TeamRow
                  key={t.id}
                  team={t}
                  position={i + 1}
                  total={rows.length}
                  ordering={save.isPending}
                  onMove={(direction) => move(t.id, direction)}
                  moveRef={moveRefFor(t.id)}
                  onDelete={() => {
                    setRemoved(null)
                    setRemoving(t)
                  }}
                />
              ))}
            </ul>
            <div className="admin-order-save">
              <Button variant="primary" icon={Icon.check} disabled={!canSave} onClick={saveOrder}>
                {save.isPending ? 'Saving order…' : 'Save team order'}
              </Button>
              {unsaved && !save.isPending && <span className="admin-hint">Not saved yet.</span>}
            </div>
            {/* A refused or half written save says so, in the save's own words
                where it has them. The status above is read from what is
                STORED, which the settled write has refetched, so an order left
                incomplete by a dropped connection is named as incomplete
                there; the list keeps the arrangement so one more press can
                finish it, except after TeamOrderChanged, where the draft was
                dropped for the refetched truth. Focus lands here. */}
            {save.isError && (
              <div ref={failedRef} tabIndex={-1} className="admin-note">
                <Note tone="danger" role="alert">
                  {saveFailureMessage(save.error)}
                </Note>
              </div>
            )}
            {orderSaved && !save.isPending && (
              <div ref={savedRef} tabIndex={-1} className="admin-note">
                <Note tone="success" role="status">
                  Team order saved.
                </Note>
              </div>
            )}
          </>
        )}
      </Card>

      {removing && (
        <DeleteTeamModal
          team={removing}
          // Membership is a set now: count specific members plus everyone on
          // the all teams flag.
          memberCount={members.filter((m) => m.allTeams || m.teamIds.includes(removing.id)).length}
          sessionCount={sessions.filter((s) => sessionCoversAnyTeam(s, [removing.id])).length}
          onClose={() => setRemoving(null)}
          onRemoved={() => {
            wantRemovedFocus()
            setRemoved({
              id: removing.id,
              message: `${removing.name} removed. No sessions, people or players were removed with it.`,
            })
          }}
        />
      )}
    </div>
  )
}
