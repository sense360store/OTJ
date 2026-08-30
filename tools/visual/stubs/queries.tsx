/* eslint-disable react-refresh/only-export-components */
// The data layer, answered from fixtures. Everything the real module exports
// that is NOT overridden here re-exports unchanged, so a pure helper stays
// itself and only the reads and writes are replaced.
export * from '../../../src/lib/queries'

import { useState } from 'react'

import {
  ACCOUNT_CLUB_NAME,
  ACTIVITY_PROFILES_FOR,
  ACTIVITY_TEAMS_FOR,
  CURRENT_SEASON,
  DRILLS,
  MEDIA,
  OVER_LIMIT_PLAYERS,
  PAST_SEASON,
  PAST_SEASON_PLAYERS,
  PLAYER_HISTORY,
  PLAYER_HISTORY_LONG,
  REGISTERED_PLAYERS,
  SEASONS,
  SESSIONS,
  SPOND_IMPORT_RESULT,
  AVATAR_DATA_URL,
  AVATAR_PATH,
  TEAMS,
  TEMPLATES,
  profileEdits,
  activityHasNext,
  activityPages,
  activityRowsFor,
  fixtures,
} from '../fixtures'
import type { ActivityFilters } from '../../../src/lib/activityView'

const query = <T,>(data: T, over: Record<string, unknown> = {}) => ({
  data,
  isLoading: false,
  isPending: false,
  isError: false,
  isSuccess: true,
  isRefetching: false,
  isRefetchError: false,
  error: null,
  refetch: () => {},
  ...over,
})

// A read that has not answered and a read that failed. Both are real states a
// screen must render, and neither can be reached by inventing rows: they are
// the query's own flags, so the screen takes exactly the branch it takes in
// the product.
const pendingQuery = <T,>() => query(undefined as T, { isLoading: true, isPending: true, isSuccess: false })
const failedQuery = <T,>() =>
  query(undefined as T, { isLoading: false, isPending: false, isSuccess: false, isError: true, error: new Error('read failed') })

const mutation = (over: Record<string, unknown> = {}) => ({
  mutate: () => {},
  mutateAsync: () => Promise.resolve(undefined),
  isPending: false,
  isError: false,
  isSuccess: false,
  error: null,
  data: null,
  reset: () => {},
  ...over,
})

/* A write that never settles, and a write that refuses. Both are states a
   dialog must render and neither is drawn: what the harness changes is what
   the server does, and the guard only enters them when the coach presses the
   confirm. */
const HANGS = () => new Promise<never>(() => {})
const REFUSES = () => Promise.reject(new Error('the write was refused'))
const writeMutation = () =>
  fixtures.state === 'inflight'
    ? mutation({ mutateAsync: HANGS })
    : fixtures.state === 'writefails'
      ? mutation({ mutateAsync: REFUSES })
      : mutation()

const byId = <T extends { id: string }>(rows: T[]): Record<string, T> =>
  Object.fromEntries(rows.map((r) => [r.id, r]))

export const useMyCapabilities = () => ({ caps: fixtures.caps, isPending: false })
export const useSessions = () => query(SESSIONS)
export const useUpsertSession = mutation
export const useDeleteSession = mutation
export const useSetLiveActivity = mutation
export const useLiveSessionSync = () => {}
export const useDrills = () => query(DRILLS)
export const useDrillMap = () => byId(DRILLS)
export const useMedia = () => query(MEDIA)
export const useMediaMap = () => byId(MEDIA)
export const useTemplates = () => query(TEMPLATES)
export const useProgrammes = () => query([])
// `longnames` widens the club by two long named teams, which is the entity
// label the Activity feed can render at any length. It is a state rather than
// a shared fixture so no other screen's shot moves, and the map answers from
// the same list as the list, so the two cannot disagree about the club.
export const useTeams = () => query(ACTIVITY_TEAMS_FOR(fixtures.state))
export const useTeamMap = () => byId(ACTIVITY_TEAMS_FOR(fixtures.state))
export const useMyTeams = () => query({ teamIds: TEAMS.map((t) => t.id), allTeams: true })
export const useVenues = () => query([])
export const useVenueMap = () => ({})
export const useMemberMap = () => ({})
// The acting adults the Activity feed names and its Changed by filter offers.
// No other screen in the harness reads this, so filling it moves no shot.
export const useProfiles = () => query(ACTIVITY_PROFILES_FOR(fixtures.state))
export const useClub = () =>
  query({ name: ACCOUNT_CLUB_NAME, motto: 'Where football and friendships flourish', crestUrl: null })
/* ---- Registered players -------------------------------------------
   The register is the one surface whose state matrix a screenshot has to
   cover in full, so its reads answer from `state` rather than always
   succeeding. Every branch is the screen's own: `loading` and `error` set
   the query flags, `empty` returns no rows, `noseason` returns no seasons,
   and `overlimit` returns a register past the server's cap of 200. */
const state = fixtures.state

export const useCurrentSeason = () => {
  if (state === 'loading') return pendingQuery<typeof CURRENT_SEASON>()
  if (state === 'noseason') return query(undefined as typeof CURRENT_SEASON | undefined)
  return query(CURRENT_SEASON)
}

export const useSeasons = () => {
  if (state === 'loading') return pendingQuery<typeof SEASONS>()
  if (state === 'noseason') return query([] as typeof SEASONS)
  return query(SEASONS)
}

export const useRegisteredPlayers = (seasonId?: string | null) => {
  // `error` fails the register read, which is the state INSIDE the page body:
  // the header and the season select still render, the count strip is
  // withheld because a read that has not answered has no count, and the list
  // region is an error with a retry. The page level gate (the seasons read)
  // is a different screen and is not what this state shows.
  if (state === 'loading' || state === 'rowsloading') return pendingQuery<typeof REGISTERED_PLAYERS>()
  if (state === 'error') return failedQuery<typeof REGISTERED_PLAYERS>()
  if (state === 'empty') return query([] as typeof REGISTERED_PLAYERS)
  if (state === 'overlimit') return query(OVER_LIMIT_PLAYERS)
  // The register is per season, and the argument is honoured because Renew
  // reads two of them at once: one set of rows answering for both would make
  // every child already in the target and leave the dialog nothing to renew.
  if (seasonId === PAST_SEASON.id) {
    // Renew's two reachable dead ends: a source season with nobody in it, and
    // a source whose every child is already in the target. The second is the
    // four carry over rows on their own, which is what makes the confirm read
    // 0 and stay inert.
    if (state === 'renewempty') return query([] as typeof PAST_SEASON_PLAYERS)
    if (state === 'renewalldone') return query(PAST_SEASON_PLAYERS.slice(0, 4))
    return query(PAST_SEASON_PLAYERS)
  }
  return query(REGISTERED_PLAYERS)
}

// The preview the bulk delete dialog opens on. `stale` is the server having
// found fewer live players than were asked about, which is what disarms the
// typed confirmation.
export const useDeletePlayersPreview = (playerIds: string[], enabled: boolean) => {
  const requested = playerIds.length
  if (!enabled) return query(undefined as never, { isSuccess: false })
  return query({
    requested,
    players: state === 'stale' ? Math.max(0, requested - 2) : requested,
    registrations: requested + 4,
    registrationSeasons: 2,
    registrationsCurrent: requested,
    registrationsArchived: 4,
    registerEntries: requested * 3,
    registerSessions: 6,
    spondLinks: Math.max(0, requested - 1),
    spondReplies: requested * 2,
    boardTokens: 2,
    boards: 1,
  })
}

export const useBulkDeletePlayers = mutation
export const isStaleBulkSelection = () => false
export const isIndeterminateBulkOutcome = () => false
export const usePlayers = () => query([])

/* ---- the six dialog files -------------------------------------------
   Every write the Registered players dialogs perform, and the two reads only
   a dialog makes. The writes share one stub, so `inflight` and `writefails`
   apply to all of them at once and a driver reaches a dialog's in-flight or
   refused branch by pressing that dialog's own confirm. */
export const useInsertPlayer = writeMutation
export const useUpdatePlayer = writeMutation
export const useSetRegistrationStatus = writeMutation
export const useMovePlayerTeam = writeMutation
export const useDeletePlayer = writeMutation
export const useExportPlayers = writeMutation
export const useRenewRegistrations = writeMutation

/* The Spond roster import is the one write that is not a guarded submit: it
   reads isPending, isError and data off the mutation itself. So the stub is a
   real hook with a phase, and the phase moves when mutate() is CALLED.

   The first version answered with the result already set, which meant the
   outcome rendered before the dialog opened and every proof of it held whether
   or not pressing Import did anything. Codex. A screenshot of an outcome a
   coach cannot reach is the same false evidence as a screenshot of a preview
   that never parsed. */
export const useSpondRosterImport = () => {
  const [phase, setPhase] = useState<'idle' | 'busy' | 'failed' | 'done'>('idle')
  return {
    ...mutation(),
    isPending: phase === 'busy',
    isError: phase === 'failed',
    isSuccess: phase === 'done',
    error: phase === 'failed' ? new Error('Could not import from Spond. Try again.') : null,
    data: phase === 'done' ? SPOND_IMPORT_RESULT : null,
    mutate: () => setPhase(state === 'inflight' ? 'busy' : state === 'writefails' ? 'failed' : 'done'),
  }
}

// The spreadsheet import commits through the guard and returns a structured
// result rather than throwing, so the success outcome screen is reached by
// resolving one.
export const useImportPlayers = () =>
  state === 'inflight'
    ? mutation({ mutateAsync: HANGS, isPending: true })
    : state === 'writefails'
      ? mutation({ mutateAsync: REFUSES })
      : mutation({
          mutateAsync: () =>
            Promise.resolve({
              outcome: 'succeeded',
              batch_id: '3f2a91c8-abcd-4000-8000-000000000001',
              settled_at: '2026-08-28T14:32:00Z',
              added: 4,
              updated: 1,
              already_present: 1,
              skipped: 0,
              rejected: 1,
            }),
        })

// The identity map the import preview checks Player ID ownership against, and
// the map the Activity feed resolves a player reference through. The real read
// pages every identity in the club; the fixtures' register is the club, so the
// map is built from it.
//
// The `enabled` flag is honoured rather than ignored, because it IS the
// players.view boundary at this seam: Activity passes `canView && canSeeNames`,
// and a viewer holding audit.view alone must get an unanswered read, which is
// what makes every player reference fall closed to a neutral label.
export const useClubPlayerIdentities = (enabled = true) =>
  enabled
    ? query(new Map(REGISTERED_PLAYERS.map((p) => [p.playerId.toLowerCase(), p.displayName])))
    : query(undefined as Map<string, string> | undefined, { isSuccess: false })

export const usePlayerHistory = () => {
  if (state === 'historyerror') return failedQuery<typeof PLAYER_HISTORY>()
  if (state === 'historylong') return query(PLAYER_HISTORY_LONG)
  if (state === 'history') return query(PLAYER_HISTORY)
  // Empty by default, which is a real state: a child added and never edited.
  return query([] as typeof PLAYER_HISTORY)
}
export const useSpondEvents = () => query([])
export const useSpondMappings = () =>
  query([
    {
      id: 'map-1',
      groupId: 'group-1',
      subgroupId: 'subgroup-1',
      name: 'Titans',
      teamId: 'titans',
      teamName: 'Titans',
      createdAt: '2026-08-01T00:00:00Z',
    },
  ])
export const useSpondLinks = () => query({ available: true, links: [] })
export const useSpondEventResponseCounts = () => query({ byEvent: {}, available: false })
export const useSpondSync = mutation
export const useRefreshSpondPlanning = mutation
export const useLinkSessionSpondEvent = mutation
export const useEventKindContext = () => ({ spondEvents: {}, teamNames: TEAMS.map((t) => t.name) })
// The one object the harness signs: an uploaded profile photo, answered with
// the inline SVG in fixtures.ts so the avatar renders as a photo rather than
// falling back to initials under a name claiming one. Every other path still
// answers null, so no existing screenshot moves.
export const useSignedMediaUrl = (path?: string | null) =>
  query(path === AVATAR_PATH ? AVATAR_DATA_URL : null)
export const useMediaSrc = () => ({ src: null, isLoading: false, isError: false })
export const useBoards = () => query([])
export const useFeedback = () => query([])
export const useFeedbackCommentCounts = () => query({})
export const useContentShareStatus = () => query(null)
/* ---- the club wide Activity feed ------------------------------------
   A real hook with real state, for the same reason the Spond roster import
   stub is one: Load more is PRESSED, and the second page arrives because
   the stub paginates the fixture rows the way the keyset does. A stub that
   answered with both pages already in hand would make every screenshot of
   the control hold whether or not pressing it did anything.

   The FILTERS are applied through activityQueryConditions, the product's
   own predicate builder, so a batch deep link or a selected Entity really
   narrows the feed and an empty-under-a-filter shot is the screen's own
   branch rather than a drawn one. */
export const useAuditActivity = (filters: ActivityFilters) => {
  const [pageCount, setPageCount] = useState(1)
  const [fetchingNext, setFetchingNext] = useState(false)
  const idle = {
    data: undefined,
    isLoading: false,
    isError: false,
    refetch: () => {},
    hasNextPage: false,
    fetchNextPage: () => {},
    isFetchingNextPage: false,
  }
  if (state === 'loading') return { ...idle, isLoading: true }
  if (state === 'error') return { ...idle, isError: true }
  const pages = activityPages(activityRowsFor(filters, state), pageCount)
  return {
    ...idle,
    data: { pages },
    hasNextPage: activityHasNext(pages),
    // `loadingmore` never settles, so the control stays in its real
    // in-flight state; otherwise the next page arrives.
    fetchNextPage: () => (state === 'loadingmore' ? setFetchingNext(true) : setPageCount((n) => n + 1)),
    isFetchingNextPage: fetchingNext,
  }
}
export const useImportFA = mutation
export const useUploadMedia = mutation

/* ---- Account (VISUAL-02) --------------------------------------------
   The self service screen drives its writes through mutate(vars, { onSuccess,
   onError }) rather than through an awaited guard, so a static mutation
   object can reach none of its outcomes: the callbacks are never called and
   isPending never moves. These are real hooks with a phase, for the same
   reason the Spond roster import stub is one.

   The phase is the SHARED write state, so `inflight` hangs and `writefails`
   refuses here exactly as they do on the register's dialogs, and which write
   is being driven is decided by which control the driver presses rather than
   by a state per control. `photoinflight` and `photofails` are the same two
   phases with a photo already uploaded, which is the only way the removal
   controls exist to be pressed at all.

   A success APPLIES the edit to the harness's profile store, so the screen
   moves the way it moves in the product once refreshProfile has run: the name
   in the sidebar updates, Save goes back to disabled, and an uploaded photo
   replaces the initials. Without that a shot named for a success would show a
   screen that had not changed, and every proof of it would hold whether or
   not the press did anything. */
type WriteCallbacks = { onSuccess?: () => void; onError?: (e: Error) => void }

const WRITE_HANGS = state === 'inflight' || state === 'photoinflight'
const WRITE_FAILS = state === 'writefails' || state === 'photofails'

/* THE TIMING IS PART OF THE STUB, and the first version got it wrong in a way
   that made a check pass on a repair that did not work in production. Codex.

   TanStack invokes a per-call callback inside MutationObserver's notify batch
   BEFORE it notifies its listeners, so when `onSuccess` runs React has not
   re-rendered and the DOM still shows the in-flight paint: a control the
   pending render disabled is still disabled, and focusing it is a no-op. The
   first version called `onSuccess` with `isPending` never set at all, so
   every control was enabled and the focus check could not see it.

   So the success and refusal paths go through the pending render first. The
   callback fires while the control is still disabled, exactly as it does in
   the product, and the phase clears afterwards. A timeout rather than a
   microtask, because what has to have happened first is React's COMMIT, not
   merely the end of the current task's microtask queue. */
function useCallbackWrite<V>(message: string, apply?: (vars: V) => void) {
  const [pending, setPending] = useState(false)
  return {
    ...mutation(),
    isPending: pending,
    mutate: (vars: V, opts: WriteCallbacks = {}) => {
      // Hangs: neither callback is called and the control stays in flight,
      // which is the state itself rather than a drawn one.
      if (WRITE_HANGS) {
        setPending(true)
        return
      }
      setPending(true)
      setTimeout(() => {
        if (WRITE_FAILS) {
          opts.onError?.(new Error(message))
        } else {
          apply?.(vars)
          opts.onSuccess?.()
        }
        setPending(false)
      }, 0)
    },
  }
}

export const useUploadAvatar = () =>
  useCallbackWrite<{ file: File }>('Could not upload the photo. Try again.', () =>
    profileEdits.write({ avatarPath: AVATAR_PATH }),
  )

export const useRemoveAvatar = () =>
  useCallbackWrite<void>('Could not remove the photo. Try again.', () => profileEdits.write({ avatarPath: null }))

// One hook, two callers: the name row writes fullName and the team row writes
// teamId. Each mounts its own instance, so a press on one leaves the other
// alone, exactly as it does in the product.
export const useUpdateMyProfile = () =>
  useCallbackWrite<{ fullName?: string; teamId?: string | null }>('Could not save your profile. Try again.', (vars) => {
    if (vars.fullName !== undefined) profileEdits.write({ fullName: vars.fullName })
    if (vars.teamId !== undefined) profileEdits.write({ teamId: vars.teamId })
  })

export const useInsertDrill = mutation
export const useUpdateDrill = mutation
