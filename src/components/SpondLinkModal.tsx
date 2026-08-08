// The Spond linking screen (ADR-0008): match a team's Spond members to the
// club's players and store the links. Candidates arrive transiently from
// the spond-link-members function as opaque id and name pairs; automatic
// matching by normalised name is expected to succeed for most (players were
// originally imported from Spond), and this screen confirms the matches and
// resolves the rest by hand. What gets WRITTEN is only what migration 0045
// allows, ids and the match origin; the payload builder carries no name
// field by shape (src/lib/spondLinking.ts) and RLS enforces players.manage.
// REVIEW: child adjacent surface, gated players.manage in the UI and in RLS.
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  useClubPlayerIdentities,
  useDeleteSpondLink,
  useInsertSpondLinks,
  usePlayerSpondLinks,
  useSpondLinkCandidates,
} from '../lib/queries'
import { linkRowsForConfirm, planSpondLinking } from '../lib/spondLinking'
import type { LinkSelection, PlayerIdentityLite, SpondLinkingPlan } from '../lib/spondLinking'
import type { Team } from '../lib/data'
import { Icon } from './icons'
import { ActionError, Modal } from './ui'

// The review list, presentational: the linked section with unlink controls,
// the unlinked section with a picker per candidate (the automatic match
// preselected and labelled), and the plain empty states. The container owns
// the data flow and the selection state.
export function SpondLinkReviewView({
  plan,
  players,
  selections,
  busy,
  onSelect,
  onUnlink,
}: {
  plan: SpondLinkingPlan
  // The unlinked players offered by the pickers, sorted by name.
  players: PlayerIdentityLite[]
  // Member id to the currently chosen player id ('' for none).
  selections: Record<string, string>
  busy: boolean
  onSelect: (spondMemberId: string, playerId: string) => void
  onUnlink: (linkId: string) => void
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {plan.unlinked.length === 0 && plan.linked.length === 0 && (
        <p className="muted" style={{ fontSize: 13.5, margin: 0 }}>
          No Spond members to show for this team.
        </p>
      )}

      {plan.unlinked.length > 0 && (
        <div>
          <div className="eyebrow" style={{ marginBottom: 8 }}>
            Not linked yet
          </div>
          {plan.unlinked.map((row) => {
            const chosen = selections[row.candidate.spondMemberId] ?? ''
            return (
              <div
                key={row.candidate.spondMemberId}
                className="row"
                style={{ gap: 10, padding: '8px 0', borderTop: '1px solid var(--line)', alignItems: 'center' }}
              >
                <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 700 }}>
                  {row.candidate.displayName}
                </span>
                {chosen && row.autoPlayerId === chosen ? (
                  <span className="pill" style={{ color: 'var(--c-physical)' }}>
                    <Icon.check />
                    Matched
                  </span>
                ) : row.ambiguous && !chosen ? (
                  <span className="pill">Choose</span>
                ) : null}
                <select
                  className="select"
                  style={{ height: 38, maxWidth: 220 }}
                  aria-label={'Player for ' + row.candidate.displayName}
                  value={chosen}
                  disabled={busy}
                  onChange={(e) => onSelect(row.candidate.spondMemberId, e.target.value)}
                >
                  <option value="">Not linked</option>
                  {players.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.displayName}
                    </option>
                  ))}
                </select>
              </div>
            )
          })}
        </div>
      )}

      {plan.linked.length > 0 && (
        <div>
          <div className="eyebrow" style={{ marginBottom: 8 }}>
            Linked
          </div>
          {plan.linked.map((row) => (
            <div
              key={row.candidate.spondMemberId}
              className="row"
              style={{ gap: 10, padding: '8px 0', borderTop: '1px solid var(--line)', alignItems: 'center' }}
            >
              <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 700 }}>{row.candidate.displayName}</span>
              <span className="muted" style={{ fontSize: 13 }}>
                {row.playerName ?? 'Player not visible'}
              </span>
              <button
                type="button"
                className="btn btn-quiet btn-sm"
                disabled={busy}
                onClick={() => onUnlink(row.link.id)}
              >
                Unlink
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function SpondLinkModal({ team, onClose }: { team: Team; onClose: () => void }) {
  const candidates = useSpondLinkCandidates()
  const { data: links = [], isLoading: linksLoading } = usePlayerSpondLinks()
  const { data: identityMap } = useClubPlayerIdentities()
  const insert = useInsertSpondLinks()
  const unlink = useDeleteSpondLink()

  // The transient read fires once when the modal opens; the result lives in
  // the mutation state for the life of the modal and nowhere else.
  const loadedFor = useRef<string | null>(null)
  useEffect(() => {
    if (loadedFor.current === team.id) return
    loadedFor.current = team.id
    candidates.mutate({ teamId: team.id })
  }, [team.id, candidates])

  const players: PlayerIdentityLite[] = useMemo(
    () =>
      [...(identityMap ?? new Map<string, string>()).entries()]
        .map(([id, displayName]) => ({ id, displayName }))
        .sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [identityMap],
  )

  const plan = useMemo(
    () => planSpondLinking(candidates.data?.candidates ?? [], players, links),
    [candidates.data, players, links],
  )

  // The pickers offer only unlinked players, so a confirmation cannot
  // collide with an existing link.
  const linkedPlayerIds = useMemo(() => new Set(links.map((l) => l.playerId)), [links])
  const pickablePlayers = useMemo(() => players.filter((p) => !linkedPlayerIds.has(p.id)), [players, linkedPlayerIds])

  // Selections seed from the automatic matches once the plan lands with
  // both reads settled (seeding against a half loaded plan could pin
  // selections at already linked players), then follow the user's picks.
  const [selections, setSelections] = useState<Record<string, string>>({})
  const seeded = useRef(false)
  useEffect(() => {
    if (seeded.current || !candidates.data || linksLoading || !identityMap) return
    seeded.current = true
    const initial: Record<string, string> = {}
    for (const row of plan.unlinked) {
      if (row.autoPlayerId) initial[row.candidate.spondMemberId] = row.autoPlayerId
    }
    setSelections(initial)
  }, [candidates.data, plan, linksLoading, identityMap])

  // The one effective selection map both the render and the payload read:
  // a selection whose player has been linked meanwhile (another admin, a
  // focus refetch) is pruned here, so the screen and the confirmed batch
  // can never disagree about a row.
  const pickableIds = useMemo(() => new Set(pickablePlayers.map((p) => p.id)), [pickablePlayers])
  const effectiveSelections = useMemo(() => {
    const out: Record<string, string> = {}
    for (const [memberId, playerId] of Object.entries(selections)) {
      if (pickableIds.has(playerId)) out[memberId] = playerId
    }
    return out
  }, [selections, pickableIds])

  const chosen: LinkSelection[] = plan.unlinked
    .map((row) => ({
      spondMemberId: row.candidate.spondMemberId,
      playerId: effectiveSelections[row.candidate.spondMemberId] ?? '',
      auto: (effectiveSelections[row.candidate.spondMemberId] ?? '') === row.autoPlayerId,
    }))
    .filter((s) => s.playerId !== '')
  const rows = linkRowsForConfirm(chosen)

  const busy = candidates.isPending || insert.isPending || unlink.isPending
  const errorText = candidates.isError
    ? candidates.error.message
    : insert.isError
      ? 'Could not save the links. Try again.'
      : unlink.isError
        ? unlink.error.message
        : ''

  const confirm = () => {
    if (busy || rows.length === 0) return
    insert.mutate({ rows }, { onSuccess: () => setSelections({}) })
  }

  return (
    <Modal
      title="Spond links"
      sub={team.name}
      onClose={onClose}
      dismissible={!busy}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Close
          </button>
          <button className="btn btn-primary" onClick={confirm} disabled={busy || rows.length === 0}>
            <Icon.link />
            {insert.isPending ? 'Linking…' : rows.length > 0 ? `Link ${rows.length}` : 'Link'}
          </button>
        </>
      }
    >
      <p className="muted" style={{ fontSize: 13.5, marginTop: 0 }}>
        Match this team's Spond members to players. Names shown here come from Spond for matching only; the app stores
        just the link.
      </p>
      {candidates.isPending || linksLoading ? (
        <p className="muted" style={{ fontSize: 13.5 }}>
          Loading Spond members…
        </p>
      ) : (
        <>
          {candidates.data?.message && (
            <p className="muted" style={{ fontSize: 13.5 }}>
              {candidates.data.message}
            </p>
          )}
          {(candidates.data?.warnings ?? []).map((w, i) => (
            <p key={i} className="muted" style={{ fontSize: 13 }}>
              {w}
            </p>
          ))}
          {candidates.data && (
            <SpondLinkReviewView
              plan={plan}
              players={pickablePlayers}
              selections={effectiveSelections}
              busy={busy}
              onSelect={(memberId, playerId) => setSelections((s) => ({ ...s, [memberId]: playerId }))}
              onUnlink={(linkId) => unlink.mutate({ id: linkId })}
            />
          )}
        </>
      )}
      {errorText && <ActionError style={{ marginTop: 10 }}>{errorText}</ActionError>}
    </Modal>
  )
}
