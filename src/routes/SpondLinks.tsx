// Spond links: binding a Spond member to a child on the roster.
//
// This is where the names are. The Spond display names on this screen
// come from spond-link-members and are held in this component's state for
// the length of the visit: nothing stores one, and the row the browser
// writes carries the member id, the player id and matched_by only. Every
// name shown anywhere else in the product is players.display_name.
//
// A dedicated screen rather than a modal on the roster, because it needs
// the team chips, the coverage counts, a reload, an orphan section and a
// retry, and because a linking affordance that only appears when a
// specific filter is set is a feature nobody finds.
//
// Nothing is preselected. A suggestion is something a manager accepts,
// which is why matched_by can honestly say 'suggested' or 'chosen' and
// nothing else.
import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  useCurrentSeason,
  useDeleteSpondLink,
  useInsertSpondLinks,
  useLoadSpondLinkCandidates,
  useMyCapabilities,
  useRegisteredPlayers,
  useSpondLinks,
  useSpondMappings,
  useTeams,
} from '../lib/queries'
import {
  acceptableSuggestions,
  buildLinkSections,
  pickerOptions,
  suggestionPool,
  type LinkCandidate,
  type LinkSections,
  type SpondLink,
} from '../lib/spondLinking'
import { linkedCounts } from '../lib/spondRsvp'
import type { RegisteredPlayer, Team } from '../lib/data'

// One team's loaded members for this visit, with whether the list is
// provably the whole group.
interface LoadedTeam {
  members: LinkCandidate[]
  complete: boolean
}
import { Icon } from '../components/icons'
import { Empty, ErrorNote, Loading, Modal } from '../components/ui'
import './SpondLinks.css'

// ---- Presentational views, exported so the tests render them without a
// query client, the house style. -------------------------------------------

export function TeamChipsView({
  teams,
  selected,
  countFor,
  onSelect,
}: {
  teams: Team[]
  selected: string | null
  countFor: (teamId: string) => { linked: number; total: number }
  onSelect: (teamId: string) => void
}) {
  if (teams.length === 0) {
    return (
      <Empty icon={Icon.rotate} title="No team has a Spond group mapped">
        An admin maps a team to its Spond group on the Spond admin page. Linking members needs a mapping.
      </Empty>
    )
  }
  return (
    <div className="sl-chips">
      {teams.map((t) => {
        const c = countFor(t.id)
        return (
          <button
            key={t.id}
            className={'sl-chip' + (selected === t.id ? ' on' : '')}
            aria-pressed={selected === t.id}
            onClick={() => onSelect(t.id)}
          >
            <span className="sl-chip-name">{t.name}</span>
            <span className="sl-chip-count">
              {c.linked}/{c.total} linked
            </span>
          </button>
        )
      })}
    </div>
  )
}

// The one line each unlinked member gets. Every case says which case it
// is: the highest value outcome of this screen is finding a child who is
// in Spond and missing from the roster, so that one is named rather than
// left looking like every other unmatched row.
export function NeedsDecisionRowView({
  name,
  reason,
  suggestion,
  busy,
  onAccept,
  onChoose,
}: {
  name: string
  reason: 'suggested' | 'ambiguous' | 'not_on_roster'
  suggestion: string | null
  busy: boolean
  onAccept: () => void
  onChoose: () => void
}) {
  return (
    <div className="sl-row">
      <div className="sl-row-main">
        <span className="sl-name">{name}</span>
        <span className="sl-sub">
          {reason === 'suggested' && suggestion
            ? `Suggested: ${suggestion}`
            : reason === 'ambiguous'
              ? 'More than one possible match'
              : 'Not on the roster'}
        </span>
      </div>
      <div className="sl-row-actions">
        {reason === 'suggested' && (
          <button className="btn btn-primary btn-sm" disabled={busy} onClick={onAccept}>
            Accept
          </button>
        )}
        <button className="btn btn-ghost btn-sm" disabled={busy} onClick={onChoose}>
          Choose
        </button>
      </div>
    </div>
  )
}

export function LinkedRowView({
  name,
  playerName,
  matchedBy,
  orphan,
  busy,
  onChange,
  onUnlink,
}: {
  name: string
  playerName: string
  matchedBy: 'suggested' | 'chosen'
  orphan: boolean
  busy: boolean
  onChange?: () => void
  onUnlink: () => void
}) {
  return (
    <div className="sl-row">
      <div className="sl-row-main">
        <span className="sl-name">{name}</span>
        <span className="sl-sub">
          {orphan
            ? `${playerName} · this member is not in the team's Spond group any more`
            : `${playerName} · ${matchedBy === 'suggested' ? 'accepted a suggestion' : 'chosen'}`}
        </span>
      </div>
      <div className="sl-row-actions">
        {onChange && (
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={onChange}>
            Change
          </button>
        )}
        <button className="btn btn-ghost btn-sm" disabled={busy} onClick={onUnlink}>
          Unlink
        </button>
      </div>
    </div>
  )
}

export function LinkSectionsView({
  sections,
  busy,
  complete,
  onAccept,
  onChoose,
  onUnlink,
}: {
  sections: LinkSections
  busy: boolean
  // Whether the loaded member list is provably the whole group. When it is
  // not, a stored link whose member is simply missing from a short list
  // looks exactly like one whose member has left, and unlinking it would
  // drain that child's stored replies for a reason that was never true.
  // So the orphan section is suppressed and says why.
  complete: boolean
  onAccept: (memberId: string, playerId: string) => void
  onChoose: (memberId: string) => void
  onUnlink: (memberId: string) => void
}) {
  return (
    <>
      <section className="sl-section">
        <h3>Needs a decision</h3>
        {sections.needsDecision.length === 0 ? (
          <p className="sl-empty">
            {complete
              ? 'Every Spond member in this group is linked.'
              : 'Nothing to decide from the members that came back.'}
          </p>
        ) : (
          sections.needsDecision.map((row) => (
            <NeedsDecisionRowView
              key={row.candidate.spondMemberId}
              name={row.candidate.displayName}
              reason={row.reason}
              suggestion={row.suggestion?.displayName ?? null}
              busy={busy}
              onAccept={() => row.suggestion && onAccept(row.candidate.spondMemberId, row.suggestion.playerId)}
              onChoose={() => onChoose(row.candidate.spondMemberId)}
            />
          ))
        )}
      </section>

      <section className="sl-section">
        <h3>Linked</h3>
        {sections.linked.length === 0 ? (
          <p className="sl-empty">Nobody in this group is linked yet.</p>
        ) : (
          sections.linked.map((row) => (
            <LinkedRowView
              key={row.link.spondMemberId}
              name={row.candidate?.displayName ?? 'This Spond member'}
              playerName={row.player?.displayName ?? 'A child on another team'}
              matchedBy={row.link.matchedBy}
              orphan={false}
              busy={busy}
              onChange={() => onChoose(row.link.spondMemberId)}
              onUnlink={() => onUnlink(row.link.spondMemberId)}
            />
          ))
        )}
      </section>

      {!complete && (
        <p className="sl-note">
          The member list came back incomplete, so existing links are not being judged against it. Nothing here says a
          link is stale.
        </p>
      )}

      {complete && sections.orphans.length > 0 && (
        <section className="sl-section">
          <h3>Links with no Spond member</h3>
          <p className="sl-empty">
            These children are linked to a Spond member the group no longer contains. Each one still holds that child,
            so nobody else can be linked to them until the link is removed.
          </p>
          {sections.orphans.map((row) => (
            <LinkedRowView
              key={row.link.spondMemberId}
              name="No longer in this Spond group"
              playerName={row.player?.displayName ?? 'A child on another team'}
              matchedBy={row.link.matchedBy}
              orphan
              busy={busy}
              onUnlink={() => onUnlink(row.link.spondMemberId)}
            />
          ))}
        </section>
      )}
    </>
  )
}

export function PickerView({
  memberName,
  roster,
  links,
  onPick,
  onClose,
}: {
  memberName: string
  roster: RegisteredPlayer[]
  links: SpondLink[]
  onPick: (playerId: string) => void
  onClose: () => void
}) {
  const [q, setQ] = useState('')
  const options = pickerOptions(roster, links, q)
  return (
    <Modal title="Which child is this?" sub={memberName} onClose={onClose}>
      <div className="field">
        <label>Search the roster</label>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Start typing a name" autoFocus />
      </div>
      {options.length === 0 ? (
        <p className="muted" style={{ fontSize: 13.5 }}>
          {roster.length === 0 ? 'Nobody is registered on this team yet.' : 'No child matches that.'}
        </p>
      ) : (
        <div className="sl-picker">
          {options.map((o) => (
            <button
              key={o.player.playerId}
              className={'sl-picker-row' + (o.linkedAlready ? ' off' : '')}
              disabled={o.linkedAlready}
              onClick={() => onPick(o.player.playerId)}
            >
              <span>{o.player.displayName}</span>
              <span className="muted">
                {o.linkedAlready
                  ? 'linked to another Spond member'
                  : o.player.shirtNumber != null
                    ? `#${o.player.shirtNumber}`
                    : ''}
              </span>
            </button>
          ))}
        </div>
      )}
    </Modal>
  )
}

// ---- The screen ------------------------------------------------------------

export default function SpondLinks() {
  const { caps, isPending: capsPending } = useMyCapabilities()
  const canManage = caps.has('players.manage')
  const teams = useTeams()
  const mappings = useSpondMappings()
  const season = useCurrentSeason()
  const roster = useRegisteredPlayers(season.data?.id ?? null)
  const links = useSpondLinks()
  const load = useLoadSpondLinkCandidates()
  const insert = useInsertSpondLinks()
  const remove = useDeleteSpondLink()

  const [teamId, setTeamId] = useState<string | null>(null)
  // Candidates per team for this visit only, so moving between two teams
  // does not pay two Spond logins. Never persisted: the names live here.
  // The whole result is kept, not just the members, because whether the
  // list was COMPLETE decides whether an existing link may be judged
  // against it at all.
  const [loaded, setLoaded] = useState<Record<string, LoadedTeam>>({})
  const [picking, setPicking] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  // Set while a Change is mid flight, so the generic "nothing else was
  // affected" note is suppressed: in that compound path it is false.
  const [changing, setChanging] = useState(false)

  const mappedTeams = useMemo(() => {
    const mapped = new Set((mappings.data ?? []).map((m) => m.teamId))
    return (teams.data ?? []).filter((t) => mapped.has(t.id))
  }, [teams.data, mappings.data])

  const allLinks = useMemo(() => links.data?.links ?? [], [links.data])
  const loadedTeam = teamId ? (loaded[teamId] ?? null) : null
  // False only while the migration is not applied yet.
  const linksAvailable = links.data?.available !== false
  const linkedPlayerIds = useMemo(() => new Set(allLinks.map((l) => l.playerId)), [allLinks])
  // The pool a suggestion may match: this team's registrations in the
  // CURRENT season, withdrawn children excluded. Deliberately not club
  // wide and not season blind, which is how a Titans member could
  // otherwise be matched to a same named child on Gladiators, or to one
  // who left two seasons ago. The rule is pure in ../lib/spondLinking so
  // the test suite pins it; this only binds the loaded roster.
  const rosterFor = useCallback(
    (id: string | null) => suggestionPool(roster.data ?? [], id),
    [roster.data],
  )

  const teamRoster = useMemo(() => rosterFor(teamId), [rosterFor, teamId])
  const candidates = loadedTeam ? loadedTeam.members : null
  const sections = useMemo(
    () => buildLinkSections(candidates ?? [], allLinks, teamRoster),
    [candidates, allLinks, teamRoster],
  )

  // The roster and the season count. Without them every Spond member
  // would be judged against an unknown pool and labelled "Not on the
  // roster", which is the one wrong answer a manager would act on by
  // adding children who are already there.
  if (capsPending || teams.isLoading || mappings.isLoading || season.isLoading || roster.isLoading) return <Loading />
  if (!canManage) return null
  if (teams.isError || mappings.isError) return <ErrorNote />
  if (season.isError || roster.isError) {
    return <ErrorNote>Could not read the club roster, so no Spond member can be matched against it.</ErrorNote>
  }
  if (!season.data) {
    return (
      <Empty icon={Icon.users} title="The club has no current season">
        Spond members are matched against the current season's roster. An admin sets one up under Seasons first.
      </Empty>
    )
  }

  const busy = insert.isPending || remove.isPending || load.isPending

  const doLoad = (id: string) => {
    setNote(null)
    load.mutate(
      { teamId: id },
      {
        onSuccess: (result) => {
          // A truncated list, or a mapping whose group came back with no
          // members at all, is not proof of anything about existing links.
          const emptyGroup = result.members.length === 0
          setLoaded((prev) => ({
            ...prev,
            [id]: { members: result.members, complete: !result.truncated && !emptyGroup },
          }))
          if (result.warnings.length > 0) setNote(result.warnings.join(' '))
        },
      },
    )
  }

  const write = (rows: { spondMemberId: string; playerId: string }[], matchedBy: 'suggested' | 'chosen') => {
    if (rows.length === 0) return
    setNote(null)
    insert.mutate(
      rows.map((r) => ({ ...r, matchedBy })),
      {
        onSuccess: (result) => {
          if (result.conflicted.length === 0 && result.failed.length === 0) return
          // Name what did not land, from the list already on screen, so the
          // manager knows exactly what to look at again. Both buckets are
          // reported: a partial batch that says only "nothing saved" would
          // be false about the rows that did land.
          const nameOf = (id: string) =>
            (candidates ?? []).find((c) => c.spondMemberId === id)?.displayName ?? 'a Spond member'
          const parts = [`${result.written} linked.`]
          if (result.conflicted.length > 0) {
            parts.push(
              `${result.conflicted.length} skipped because somebody else linked them first: ${result.conflicted
                .map(nameOf)
                .join(', ')}.`,
            )
          }
          if (result.failed.length > 0) {
            parts.push(`${result.failed.length} did not save: ${result.failed.map(nameOf).join(', ')}. Try again.`)
          }
          setNote(parts.join(' '))
        },
      },
    )
  }

  const suggestions = acceptableSuggestions(sections)
  const pickingName =
    (candidates ?? []).find((c) => c.spondMemberId === picking)?.displayName ?? 'This Spond member'
  // Changing a link is a delete then an insert, because a link has no
  // update path at all: the schema has no update policy and no update
  // grant, and that is what makes "a link's player never silently
  // changes" structural.
  const existingLink = allLinks.find((l) => l.spondMemberId === picking) ?? null

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Spond links</h2>
          <div className="sub">
            Which Spond member is which child. Linking lets the register show what each parent replied; it never marks
            anybody present.
          </div>
        </div>
        <Link to="/players" className="btn btn-ghost">
          Registered players
        </Link>
      </div>

      {links.isError ? (
        <ErrorNote>Could not read the existing links. Nothing has been changed.</ErrorNote>
      ) : !linksAvailable ? (
        <Empty icon={Icon.rotate} title="Spond member linking is not available yet">
          The database change this screen needs has not been applied. Nothing is wrong with your club's data, and the
          register works exactly as before.
        </Empty>
      ) : (
        <>
          <TeamChipsView
            teams={mappedTeams}
            selected={teamId}
            countFor={(id) => linkedCounts(rosterFor(id), linkedPlayerIds)}
            onSelect={(id) => {
              setTeamId(id)
              setNote(null)
              if (!loaded[id]) doLoad(id)
            }}
          />

          {teamId && (
            <div className="sl-bar">
              <button className="btn btn-ghost btn-sm" disabled={load.isPending} onClick={() => doLoad(teamId)}>
                <Icon.rotate />
                {load.isPending ? 'Loading…' : candidates ? 'Reload from Spond' : 'Load members'}
              </button>
              {suggestions.length > 0 && (
                <button
                  className="btn btn-primary btn-sm"
                  disabled={busy}
                  onClick={() => write(suggestions, 'suggested')}
                >
                  Accept all suggestions ({suggestions.length})
                </button>
              )}
            </div>
          )}

          {load.isError && (
            <ErrorNote>
              {load.error.message} <button className="btn btn-quiet btn-sm" onClick={() => teamId && doLoad(teamId)}>Retry</button>
            </ErrorNote>
          )}
          {(insert.isError || remove.isError) && !changing && (
            <ErrorNote>That change did not save. Nothing else was affected. Try again.</ErrorNote>
          )}
          {note && <p className="sl-note">{note}</p>}

          {!teamId ? (
            mappedTeams.length > 0 && <p className="sl-empty">Choose a team to link.</p>
          ) : load.isPending && !candidates ? (
            <Loading />
          ) : candidates ? (
            <LinkSectionsView
              sections={sections}
              busy={busy}
              complete={loadedTeam?.complete ?? false}
              onAccept={(memberId, playerId) => write([{ spondMemberId: memberId, playerId }], 'suggested')}
              onChoose={(memberId) => setPicking(memberId)}
              onUnlink={(memberId) => remove.mutate({ spondMemberId: memberId })}
            />
          ) : null}
        </>
      )}

      {picking && (
        <PickerView
          memberName={pickingName}
          roster={teamRoster}
          links={allLinks}
          onClose={() => setPicking(null)}
          onPick={(playerId) => {
            const memberId = picking
            setPicking(null)
            if (existingLink) {
              // A link has no update path, so changing one is a delete
              // then an insert. Every way the insert half can fail says
              // the same true thing: the old link is gone and this member
              // is unlinked. "Nothing else was affected" would be false
              // here, so the generic note is suppressed while it runs.
              const stranded =
                'The old link was removed but the new one did not save. This Spond member is now unlinked; choose the child again.'
              setChanging(true)
              setNote(null)
              remove.mutate(
                { spondMemberId: memberId },
                {
                  onSuccess: () =>
                    insert.mutate([{ spondMemberId: memberId, playerId, matchedBy: 'chosen' }], {
                      // A conflict is not an error to the mutation, so it
                      // has to be read off the result as well.
                      onSuccess: (result) => {
                        setChanging(false)
                        if (result.written === 0) setNote(stranded)
                      },
                      onError: () => {
                        setChanging(false)
                        setNote(stranded)
                      },
                    }),
                  onError: () => setChanging(false),
                },
              )
            } else {
              write([{ spondMemberId: memberId, playerId }], 'chosen')
            }
          }}
        />
      )}
    </div>
  )
}
