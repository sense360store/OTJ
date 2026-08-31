/* eslint-disable react-refresh/only-export-components */
// The data layer, answered from fixtures. Everything the real module exports
// that is NOT overridden here re-exports unchanged, so a pure helper stays
// itself and only the reads and writes are replaced.
export * from '../../../src/lib/queries'

import { useEffect, useState, useSyncExternalStore } from 'react'

import {
  ADMIN_SHARE_COUNTS,
  adminStore,
  harnessScreen,
  ACCOUNT_CLUB_NAME,
  FEEDBACK_MEMBERS,
  PROMOTE_RESULT,
  PROMOTE_WARNING,
  feedbackStore,
  ACTIVITY_PROFILES_FOR,
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
import type { Capability, Member, RoleCapability, RoleInfo, Team } from '../../../src/lib/data'

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
/* The teams come from the admin store, which STARTS as exactly what this
   returned before (ACTIVITY_TEAMS_FOR, read once when the store is built), so
   Players, Sessions, Account and Activity read what they always read. Only a
   press on the Teams screen changes it, and then every subscriber re-renders
   the way the product's own invalidation makes it. */
const useAdminTeams = (): Team[] => useSyncExternalStore(adminStore.subscribe, adminStore.teams, adminStore.teams)
export const useTeams = () => {
  const teams = useAdminTeams()
  if (state === 'adminloading') return pendingQuery<Team[]>()
  if (state === 'adminerror') return failedQuery<Team[]>()
  return query(teams)
}
export const useTeamMap = () => byId(useAdminTeams())
export const useMyTeams = () => query({ teamIds: TEAMS.map((t) => t.id), allTeams: true })
export const useVenues = () => query([])
export const useVenueMap = () => ({})
/* The members a name is resolved through. Its ids are the FEEDBACK fixtures'
   own; `coach-them`, which the SESSIONS fixtures use, is deliberately absent,
   so Home and Sessions still fall back to "Another coach" and no shot either
   of those screens takes moves. */
export const useMemberMap = () => FEEDBACK_MEMBERS(fixtures.state)
/* ONE read, two screens, two answers. It is the Activity feed's list of
   acting adults AND the Users screen's list of club members, and the two need
   different rows: widening the Activity fixture to carry the Users matrix
   would put six names in Activity's Changed by filter and move every shot it
   takes. So it branches on the screen, once, and says so.

   On the admin screens it comes from the store, because an invite adds a row
   and a removal takes one away, and the removal's focus rule waits for the
   row to leave. */
export const useProfiles = () => {
  const members = useSyncExternalStore(adminStore.subscribe, adminStore.members, adminStore.members)
  if (!ON_ADMIN) return query(ACTIVITY_PROFILES_FOR(fixtures.state))
  if (state === 'adminloading') return pendingQuery<Member[]>()
  if (state === 'adminerror') return failedQuery<Member[]>()
  return query(members)
}
export const useClub = () =>
  query({ name: ACCOUNT_CLUB_NAME, motto: 'Where football and friendships flourish', crestUrl: null })
/* ---- Registered players -------------------------------------------
   The register is the one surface whose state matrix a screenshot has to
   cover in full, so its reads answer from `state` rather than always
   succeeding. Every branch is the screen's own: `loading` and `error` set
   the query flags, `empty` returns no rows, `noseason` returns no seasons,
   and `overlimit` returns a register past the server's cap of 200. */
const state = fixtures.state
// Which of two member lists the shared profiles read answers with; see the
// Admin section at the end of this file.
const ON_ADMIN = harnessScreen === 'adminusers' || harnessScreen === 'adminteams'

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
export const useContentShareStatus = () => query(null)

/* ---- Feedback (VISUAL-02) --------------------------------------------
   The club's request and bug log. Two reads and nine writes, and none of the
   writes is a plain object: every one of them is driven through
   `mutate(vars, { onSuccess })` and read back through `isPending`, `isError`
   and `error`, so a static mutation reaches none of the screen's outcomes.
   These are real hooks with a phase, for the same reason the Account screen's
   are.

   The phases are the SHARED write states. `inflight` hangs, `writefails`
   refuses, `writeslow` settles after a beat and `writeslowfails` refuses after
   one, which is what those four already mean everywhere else in the harness,
   so which write is driven is decided by the control the driver presses
   rather than by a state per control.

   A success APPLIES the change to the fixture store, so the screen moves the
   way it moves in the product once the query has been invalidated and re
   read: a deleted row leaves, a status sticks in its controlled select, a
   filed item appears at the top and a posted comment joins the thread. Without
   that, every proof of a success would hold whether or not the press did
   anything.

   WHAT IS COUNTED, AND WHY. Three claims this screen makes are about a call
   that must NOT happen: an ordinary member never triggers the admin GitHub
   refresh, a collapsed row never reads its comments, and neither of those is
   visible in what is drawn. A browser cannot see a call that was never made,
   so the calls are recorded on the window and a proof asserts the number. An
   ABSENT counter fails rather than passes: it means the page is not running
   this stub, which makes the claim unproved rather than true. And every zero
   is paired with a flow that DOES make the same call, because a zero on its
   own is also what a deleted record() line looks like. */
interface FeedbackCallLog {
  refreshFromGithub: number
  setStatus: number
  insert: number
  update: number
  remove: number
  promote: number
  addComment: number
  editComment: number
  removeComment: number
  // The feedback ids whose comment thread has been read, as a list rather
  // than a count: the claim is WHICH rows fetched, and a list is also robust
  // to a component mounting twice.
  threads: string[]
}

const feedbackCalls: FeedbackCallLog = {
  refreshFromGithub: 0,
  setStatus: 0,
  insert: 0,
  update: 0,
  remove: 0,
  promote: 0,
  addComment: 0,
  editComment: 0,
  removeComment: 0,
  threads: [],
}
;(globalThis as unknown as { __feedbackCalls?: FeedbackCallLog }).__feedbackCalls = feedbackCalls

const recordFeedbackCall = (name: keyof Omit<FeedbackCallLog, 'threads'>) => {
  feedbackCalls[name] += 1
}

const FEEDBACK_HANGS = state === 'inflight'
const FEEDBACK_FAILS = state === 'writefails' || state === 'writeslowfails'
const FEEDBACK_DELAY = state === 'writeslow' || state === 'writeslowfails' ? 1200 : 0

/* One write hook shape for all nine, because they differ only in what a
   success applies and what a refusal says. The pending render happens FIRST,
   on a timeout rather than a microtask, for the reason the Account stub gives:
   what has to have happened before a callback fires is React's commit, and a
   callback that runs before it would let a focus repair pass while doing
   nothing in production. */
function useFeedbackWrite<V, R = void>(
  name: keyof Omit<FeedbackCallLog, 'threads'>,
  message: string,
  apply?: (vars: V) => void,
  result?: (vars: V) => R,
) {
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)
  return {
    ...mutation(),
    isPending: pending,
    isError: failed,
    error: failed ? new Error(message) : null,
    mutate: (vars: V, opts: { onSuccess?: (r: R) => void } = {}) => {
      recordFeedbackCall(name)
      setFailed(false)
      setPending(true)
      // Hangs: no callback, and the control stays in flight, which is the
      // state itself rather than a drawn one.
      if (FEEDBACK_HANGS) return
      setTimeout(() => {
        if (FEEDBACK_FAILS) {
          setFailed(true)
        } else {
          apply?.(vars)
          opts.onSuccess?.(result ? result(vars) : (undefined as R))
        }
        setPending(false)
      }, FEEDBACK_DELAY)
    },
  }
}

// The log itself. `loading` and `error` are the query's own flags, `empty`
// returns no rows and `longnames` puts a long title, body, author and comment
// in front of the ordinary list.
export const useFeedback = () => {
  const items = useSyncExternalStore(feedbackStore.subscribe, feedbackStore.items, feedbackStore.items)
  if (state === 'loading') return pendingQuery<typeof items>()
  if (state === 'error') return failedQuery<typeof items>()
  return query(items)
}

export const useFeedbackCommentCounts = () => {
  const counts = useSyncExternalStore(feedbackStore.subscribe, feedbackStore.counts, feedbackStore.counts)
  return query(counts)
}

/* One item's thread. It is a SECOND read, and its two unsettled states are its
   own rather than the page's: `commentsloading` and `commentserror` leave the
   thread pending or failed while the log itself renders in full.

   The read is RECORDED, because "a collapsed row fetches nothing" is a claim
   about a call that did not happen. The product calls this hook from
   FeedbackThread and nowhere else, and FeedbackThread is mounted only while a
   row is expanded, so the ids this hook has been mounted for are exactly the
   ids that would have fetched. */
export const useFeedbackComments = (feedbackId: string) => {
  // Subscribed to the THREAD rather than to the list: posting a comment
  // changes no row, so a snapshot of the rows would compare equal and the
  // thread would not re render. The store hands back the same array reference
  // between writes, which is what useSyncExternalStore requires.
  const read = () => feedbackStore.comments(feedbackId)
  const comments = useSyncExternalStore(feedbackStore.subscribe, read, read)
  useEffect(() => {
    if (!feedbackCalls.threads.includes(feedbackId)) feedbackCalls.threads.push(feedbackId)
  }, [feedbackId])
  if (state === 'commentsloading') return pendingQuery<typeof comments>()
  if (state === 'commentserror') return failedQuery<typeof comments>()
  return query(comments)
}

export const useInsertFeedback = () =>
  useFeedbackWrite<{ kind: 'feature' | 'bug' | 'general'; title: string; body: string }>(
    'insert',
    'Could not send the feedback. Try again.',
    (vars) => feedbackStore.insert(vars),
  )

export const useUpdateFeedback = () =>
  useFeedbackWrite<{ id: string; input: { kind: 'feature' | 'bug' | 'general'; title: string; body: string } }>(
    'update',
    'You can only edit feedback you filed.',
    (vars) => feedbackStore.update(vars.id, vars.input),
  )

export const useDeleteFeedback = () =>
  useFeedbackWrite<{ id: string }>('remove', 'You can only delete feedback you filed.', (vars) =>
    feedbackStore.remove(vars.id),
  )

export const useSetFeedbackStatus = () =>
  useFeedbackWrite<{ id: string; status: 'new' | 'planned' | 'in_progress' | 'done' | 'declined' }>(
    'setStatus',
    'Only a holder of club.manage can change feedback status.',
    (vars) => feedbackStore.setStatus(vars.id, vars.status),
  )

// The promotion. `promotewarning` is the partial outcome: the public issue
// exists and writing its number back to the club's own row did not settle.
export const usePromoteFeedbackToGithub = () =>
  useFeedbackWrite<{ id: string; title: string; body: string }, typeof PROMOTE_RESULT>(
    'promote',
    'Could not create the GitHub issue. Try again.',
    (vars) => {
      if (state !== 'promotewarning') {
        feedbackStore.promote(vars.id, PROMOTE_RESULT.issueNumber, PROMOTE_RESULT.issueUrl)
      }
    },
    () => (state === 'promotewarning' ? { ...PROMOTE_RESULT, warning: PROMOTE_WARNING } : PROMOTE_RESULT),
  )

/* The admin GitHub refresh, which the screen fires on open for a club.manage
   holder and for nobody else. It is quiet by design: nothing is drawn either
   way, so the only honest proof of it is the count. */
export const useRefreshFeedbackFromGithub = () =>
  useFeedbackWrite<void>('refreshFromGithub', 'Could not refresh issue state from GitHub.')

export const useAddFeedbackComment = () =>
  useFeedbackWrite<{ feedbackId: string; body: string }>(
    'addComment',
    'Could not post the comment. Try again.',
    (vars) => feedbackStore.addComment(vars.feedbackId, vars.body),
  )

export const useEditFeedbackComment = () =>
  useFeedbackWrite<{ id: string; body: string }>('editComment', 'You can only edit comments you wrote.', (vars) =>
    feedbackStore.editComment(vars.id, vars.body),
  )

export const useDeleteFeedbackComment = () =>
  useFeedbackWrite<{ id: string }>('removeComment', 'You can only delete comments you wrote.', (vars) =>
    feedbackStore.removeComment(vars.id),
  )
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
/* Long enough for a driver to move focus during the write and short enough
   not to slow the matrix. Every other state settles on the next task. */
const WRITE_DELAY = state === 'writeslow' || state === 'photoslow' ? 1200 : 0

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
      }, WRITE_DELAY)
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

/* ---- Admin Users and Admin Teams (VISUAL-02) --------------------------
   Every read and write those two screens make. The reads answer from the
   store above, so a press moves the list the way an invalidation moves it in
   the product; the writes are counted, because three of this pair's claims
   are about a call that must NOT happen and a browser cannot see one of
   those.

   ON_ADMIN is read once at module scope for the same reason `state` is: it
   decides which of two lists a shared read answers with, and a hook that
   recomputed it per render would be answering a question about the page
   rather than about the mount. */

interface AdminCallLog {
  invite: number
  removeUser: number
  setMemberRoles: number
  setMemberTeams: number
  setMemberAllTeams: number
  createRole: number
  renameRole: number
  deleteRole: number
  saveRoleCaps: number
  insertTeam: number
  renameTeam: number
  deleteTeam: number
  setTeamBib: number
  /* The ORDER the writes went out in, which a scalar counter cannot show. The
     member save is specified to write roles, then the all teams flag, then
     the specific teams, and two counters both reading 1 hold whichever way
     round they went. */
  order: string[]
}

const adminCalls: AdminCallLog = {
  invite: 0,
  removeUser: 0,
  setMemberRoles: 0,
  setMemberTeams: 0,
  setMemberAllTeams: 0,
  createRole: 0,
  renameRole: 0,
  deleteRole: 0,
  saveRoleCaps: 0,
  insertTeam: 0,
  renameTeam: 0,
  deleteTeam: 0,
  setTeamBib: 0,
  order: [],
}
;(globalThis as unknown as { __adminCalls?: AdminCallLog }).__adminCalls = adminCalls

const ADMIN_HANGS = state === 'inflight'
const ADMIN_FAILS = state === 'writefails' || state === 'writeslowfails'
const ADMIN_DELAY = state === 'writeslow' || state === 'writeslowfails' ? 1200 : 0

/* One write hook shape for all thirteen, because they differ only in what a
   success applies and what a refusal says. The pending render happens FIRST,
   on a timeout rather than a microtask, for the reason the Account and
   Feedback stubs give: what has to have happened before a callback fires is
   React's commit, and a callback that ran before it would let a focus repair
   pass while doing nothing in production. */
function useAdminWrite<V, R = void>(
  name: keyof AdminCallLog,
  message: string,
  apply?: (vars: V) => void,
  result?: (vars: V) => R,
) {
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)
  const settle = (
    vars: V,
    opts: { onSuccess?: (r: R) => void; onError?: (e: Error) => void },
    reject?: (e: Error) => void,
  ) => {
    adminCalls[name] += 1
    adminCalls.order.push(name)
    setFailed(false)
    setPending(true)
    // Hangs: no callback at all, and the control stays in flight, which is
    // the state itself rather than a drawn one.
    if (ADMIN_HANGS) return
    setTimeout(() => {
      if (ADMIN_FAILS) {
        setFailed(true)
        // BOTH, because callers read the refusal two different ways. Most
        // render `isError` off the hook; the invite passes an onError and
        // renders nothing without it, which is what a stub answering only the
        // success side hid: the write was counted, the message never came.
        const err = new Error(message)
        opts.onError?.(err)
        reject?.(err)
      } else {
        /* THE CALLBACK FIRST, AND THE LIST A TICK LATER, because that is the
           ORDER PRODUCTION HAS and the whole reason three screens wait for a
           row to leave rather than for a write to settle. In the product the
           per-call onSuccess runs when the mutation resolves and the list
           only changes when the invalidated read comes back, a network round
           trip afterwards. Applying the store update in the same callback
           collapsed the two into one commit, which made "the row has gone"
           true on the settling render and left the harness unable to tell a
           hook keyed on the write from one keyed on the row: reducing
           `rowGone` to `removed !== null` passed every entry. */
        opts.onSuccess?.(result ? result(vars) : (undefined as R))
        setTimeout(() => apply?.(vars), 0)
      }
      setPending(false)
    }, ADMIN_DELAY)
  }
  return {
    ...mutation(),
    isPending: pending,
    isError: failed,
    error: failed ? new Error(message) : null,
    mutate: (vars: V, opts: { onSuccess?: (r: R) => void; onError?: (e: Error) => void } = {}) => settle(vars, opts),
    /* The member save is the one caller that awaits, in sequence, and stops
       at the first refusal. So the promise has to reject rather than resolve,
       or the dialog would close on a write the server turned down. A hanging
       state never settles, which is what `inflight` means everywhere. */
    mutateAsync: (vars: V) =>
      new Promise<R>((resolve, reject) => {
        settle(vars, { onSuccess: (r) => resolve(r) }, reject)
      }),
  }
}

export const useMemberStates = () => {
  const states = useSyncExternalStore(adminStore.subscribe, adminStore.states, adminStore.states)
  // An unsettled read is not "everybody is active": the screen's honest
  // answer is no badge at all, which is what `data` being undefined gives it.
  if (state === 'statesunknown') return pendingQuery<Record<string, 'invited' | 'active'>>()
  return query(states)
}

export const useRoles = () => {
  const roles = useSyncExternalStore(adminStore.subscribe, adminStore.roles, adminStore.roles)
  if (state === 'adminloading') return pendingQuery<RoleInfo[]>()
  if (state === 'adminerror') return failedQuery<RoleInfo[]>()
  return query(roles)
}

/* The grid's own two reads. They are separate from the page's, because the
   grid renders its heading and its own state whichever way they go, and
   `gridunavailable` is the club that has not applied the RBAC migrations. */
export const useCapabilities = () => {
  if (state === 'gridloading') return pendingQuery<Capability[]>()
  if (state === 'gridunavailable') return failedQuery<Capability[]>()
  return query(adminStore.capabilities())
}

export const useRoleCapabilities = () => {
  const mapping = useSyncExternalStore(adminStore.subscribe, adminStore.roleCaps, adminStore.roleCaps)
  if (state === 'gridloading') return pendingQuery<RoleCapability[]>()
  if (state === 'gridunavailable') return failedQuery<RoleCapability[]>()
  return query(mapping)
}

// The advisory count inside the removal dialog. One member has links still
// working and the rest have none, so the same dialog is reachable both with
// the warning and without it. A null memberId is the caller saying it holds
// no shares.manage, and answers nothing rather than zero.
export const useMemberActiveShareCount = (memberId: string | null) =>
  query(memberId ? (ADMIN_SHARE_COUNTS[memberId] ?? 0) : undefined)

export const useInviteUser = () =>
  useAdminWrite<
    { email: string; fullName: string; roleIds: string[]; teamIds: string[]; allTeams: boolean },
    { warning?: string }
  >(
    'invite',
    'That email address is already a member of another club.',
    (vars) => adminStore.invite(vars),
    () => ({}),
  )

export const useRemoveUser = () =>
  useAdminWrite<{ userId: string }, { message?: string }>(
    'removeUser',
    "The club's only admin cannot be removed.",
    (vars) => adminStore.removeMember(vars.userId),
    () => ({}),
  )

export const useSetMemberRoles = () =>
  useAdminWrite<{ memberId: string; roleIds: string[] }>(
    'setMemberRoles',
    'The club must keep at least one admin.',
    (vars) => adminStore.setMemberRoles(vars.memberId, vars.roleIds),
  )

export const useSetMemberTeams = () =>
  useAdminWrite<{ memberId: string; teamIds: string[] }>(
    'setMemberTeams',
    'Only a holder of users.manage can change a member.',
    (vars) => adminStore.setMemberTeams(vars.memberId, vars.teamIds),
  )

export const useSetMemberAllTeams = () =>
  useAdminWrite<{ memberId: string; allTeams: boolean }>(
    'setMemberAllTeams',
    'Only a holder of users.manage can change a member.',
    (vars) => adminStore.setMemberAllTeams(vars.memberId, vars.allTeams),
  )

export const useCreateRole = () =>
  useAdminWrite<{ key: string; label: string }>(
    'createRole',
    'A role with that name already exists.',
    (vars) => adminStore.createRole(vars.key, vars.label),
  )

export const useRenameRole = () =>
  useAdminWrite<{ id: string; label: string }>('renameRole', 'System roles cannot be renamed.', (vars) =>
    adminStore.renameRole(vars.id, vars.label),
  )

export const useDeleteRole = () =>
  useAdminWrite<{ id: string }>('deleteRole', 'System roles cannot be deleted.', (vars) =>
    adminStore.deleteRole(vars.id),
  )

export const useSaveRoleCapabilities = () =>
  useAdminWrite<{ adds: RoleCapability[]; removes: RoleCapability[] }>(
    'saveRoleCaps',
    'Could not save every change.',
    (vars) => adminStore.saveRoleCaps(vars),
  )

export const useInsertTeam = () =>
  useAdminWrite<{ name: string }>('insertTeam', 'A team with that name already exists.', (vars) =>
    adminStore.insertTeam(vars.name),
  )

export const useRenameTeam = () =>
  useAdminWrite<{ id: string; name: string }>('renameTeam', 'Could not rename the team.', (vars) =>
    adminStore.renameTeam(vars.id, vars.name),
  )

export const useDeleteTeam = () =>
  useAdminWrite<{ id: string }>('deleteTeam', 'Could not remove the team.', (vars) =>
    adminStore.deleteTeam(vars.id),
  )

export const useSetTeamBibColour = () =>
  useAdminWrite<{ teamId: string; bibColour: string | null }>('setTeamBib', 'Could not change the bib colour.', (vars) =>
    adminStore.setTeamBib(vars.teamId, vars.bibColour),
  )
