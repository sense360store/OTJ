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
import { clubOrder, moveTeam, reconcileDraft, sameIdOrder, teamsInDraftOrder } from '../lib/teamOrder'
import type { ClubOrderState, MoveDirection } from '../lib/teamOrder'
import { Icon } from '../components/icons'
import { Empty, ErrorNote, Loading, Modal } from '../components/ui'
import { Button, Card, IconButton, Note, PageHeader, SelectField, TextField } from '../components/primitives'

/* The one sentence that says what the order is FOR, exported so the screen
   test reads the same string the screen renders rather than a copy of it. */
export const TEAM_ORDER_COPY = 'Used for coaching group suggestions. Put the strongest team first.'

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
export function TeamOrderStatus({ state, unplaced }: { state: ClubOrderState; unplaced: readonly Team[] }) {
  if (state === 'unset') {
    return (
      <Note tone="warning" className="admin-note">
        Team order is not set. The teams are listed alphabetically, which is not a coaching order. Move them into
        order and press Save team order, or press it without moving anything to accept the order shown.
      </Note>
    )
  }
  if (state === 'incomplete') {
    const names = unplaced.map((t) => t.name)
    const list = names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
    const plural = names.length !== 1
    return (
      <Note tone="warning" className="admin-note">
        Team order is incomplete: {list} {plural ? 'have' : 'has'} no position yet and {plural ? 'are' : 'is'} listed
        after the ordered teams. Move {plural ? 'them' : 'it'} into place and press Save team order, which places every
        team.
      </Note>
    )
  }
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
  const { data, isLoading, isError, refetch } = useTeams()
  const teams = data ?? NO_TEAMS
  const { data: members = [] } = useProfiles()
  const { sessions } = useSessions()
  const insert = useInsertTeam()
  const save = useSaveTeamOrder()
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
  const [draft, setDraft] = useState<string[] | null>(null)
  const arranged = draft === null ? null : reconcileDraft(draft, teams)
  const dirty = arranged !== null && !sameIdOrder(arranged, storedIds)
  /* Dropped during the render a FRESH READ lands in, when the read agrees
     with it, which is the documented way to adjust state to a changed input
     (an effect would render the stale arrangement once and then re-render).
     The read is compared by identity, so a render with the same rows does
     nothing and a loading render sees the one shared empty list. */
  const [seenTeams, setSeenTeams] = useState(teams)
  if (teams !== seenTeams) {
    setSeenTeams(teams)
    if (draft !== null && !dirty) setDraft(null)
  }
  const draftIds = dirty ? (arranged as string[]) : storedIds
  const rows = teamsInDraftOrder(draftIds, teams)
  /* Save is offered whenever pressing it would state something: an unset or
     incomplete club has positions to write even for an order nobody moved
     (accepting the order shown IS the statement), and a configured club has
     nothing to say until the draft differs from what is stored. */
  const canSave = rows.length > 0 && !save.isPending && (stored.state !== 'configured' || dirty)
  const [orderSaved, setOrderSaved] = useState(false)

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
    setOrderSaved(false)
    setDraft(next.map((t) => t.id))
    setMoves((n) => n + 1)
  }

  /* The save's outcome, and the thing focus goes back to. A successful save
     leaves the draft equal to what is stored, so Save team order disables
     under the press once the refetch lands and the browser drops focus; it
     goes to the outcome, which is what AdminUsers does for the same shape. */
  const savedRef = useRef<HTMLDivElement>(null)
  const wantSavedFocus = useFocusRestore(orderSaved && !canSave, savedRef)
  const saveOrder = () => {
    if (!canSave) return
    setOrderSaved(false)
    wantSavedFocus()
    save.mutate({ orderedIds: draftIds }, { onSuccess: () => setOrderSaved(true) })
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
    if (!trimmed) return
    wantNewTeamFocus()
    insert.mutate({ name: trimmed }, { onSuccess: () => setName('') })
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
            <TeamOrderStatus state={stored.state} unplaced={stored.unplaced} />
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
              {dirty && !save.isPending && <span className="admin-hint">Not saved yet.</span>}
            </div>
            {/* A refused or half written save says so. The status above is
                read from what is STORED, which the settled write has refetched,
                so an order left incomplete by a dropped connection is named as
                incomplete there; the list keeps the arrangement so one more
                press can finish it. */}
            {save.isError && (
              <Note tone="danger" role="alert" className="admin-note">
                Could not save the team order. The status above says what is stored now; the list still shows the order
                you arranged, so check it and press Save team order again.
              </Note>
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
