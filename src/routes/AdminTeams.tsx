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
import { useRef, useState } from 'react'
import { useSessions } from '../context/SessionsContext'
import { useFocusRestore } from '../hooks/useFocusRestore'
import {
  useDeleteTeam,
  useInsertTeam,
  useMyCapabilities,
  useProfiles,
  useRenameTeam,
  useSetTeamBibColour,
  useTeams,
} from '../lib/queries'
import type { Team } from '../lib/data'
import { BIB_COLOURS, bibSwatch } from '../lib/bibs'
import { sessionCoversAnyTeam } from '../lib/sessionTeams'
import { Icon } from '../components/icons'
import { Empty, ErrorNote, Loading, Modal } from '../components/ui'
import { Button, Card, IconButton, Note, PageHeader, SelectField, TextField } from '../components/primitives'

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
  onChange,
}: {
  value: string | null
  disabled: boolean
  label: string
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

function TeamRow({ team, onDelete }: { team: Team; onDelete: () => void }) {
  const rename = useRenameTeam()
  const setBib = useSetTeamBibColour()
  const [draft, setDraft] = useState(team.name)
  const changed = draft.trim() !== team.name && draft.trim() !== ''
  return (
    <li className="admin-row">
      <TextField
        label={`Team name for ${team.name}`}
        labelHidden
        className="field-flush admin-field-grow"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
      />
      <BibColourField
        value={team.bibColour}
        disabled={setBib.isPending}
        label={'Default bib colour for ' + team.name}
        onChange={(v) => setBib.mutate({ teamId: team.id, bibColour: v })}
      />
      <div className="admin-row-acts">
        <Button
          size="sm"
          icon={Icon.check}
          disabled={!changed || rename.isPending}
          onClick={() => rename.mutate({ id: team.id, name: draft.trim() })}
        >
          {rename.isPending ? 'Renaming…' : 'Rename'}
        </Button>
        <IconButton tone="danger" icon={Icon.trash} label={'Remove ' + team.name} onClick={onDelete} />
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

export function AdminTeams() {
  const { data: teams = [], isLoading, isError, refetch } = useTeams()
  const { data: members = [] } = useProfiles()
  const { sessions } = useSessions()
  const insert = useInsertTeam()
  const [name, setName] = useState('')
  const [removing, setRemoving] = useState<Team | null>(null)
  const [removed, setRemoved] = useState<{ id: string; message: string } | null>(null)
  const { caps } = useMyCapabilities()
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
  if (isLoading) return <Loading />
  if (isError) return <ErrorNote onRetry={() => void refetch()} />
  // The route guard already keeps members without teams.manage out; this is
  // belt and braces for the brief render before a redirect.
  if (!caps.has('teams.manage')) return null

  const add = () => {
    const trimmed = name.trim()
    if (!trimmed) return
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
            placeholder="Team name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
          />
          <Button variant="primary" icon={Icon.plus} disabled={!name.trim() || insert.isPending} onClick={add}>
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
          <Empty icon={Icon.users} title="No teams yet">
            Add the first one above. Sessions and coaches can then be filtered by it.
          </Empty>
        ) : (
          <ul className="admin-list">
            {teams.map((t) => (
              <TeamRow
                key={t.id}
                team={t}
                onDelete={() => {
                  setRemoved(null)
                  setRemoving(t)
                }}
              />
            ))}
          </ul>
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
