/* eslint-disable react-refresh/only-export-components */
// The data layer, answered from fixtures. Everything the real module exports
// that is NOT overridden here re-exports unchanged, so a pure helper stays
// itself and only the reads and writes are replaced.
export * from '../../../src/lib/queries'

import {
  CURRENT_SEASON,
  DRILLS,
  MEDIA,
  OVER_LIMIT_PLAYERS,
  REGISTERED_PLAYERS,
  SEASONS,
  SESSIONS,
  TEAMS,
  TEMPLATES,
  fixtures,
} from '../fixtures'

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

const mutation = () => ({
  mutate: () => {},
  mutateAsync: () => Promise.resolve(undefined),
  isPending: false,
  isError: false,
  isSuccess: false,
  error: null,
  data: null,
  reset: () => {},
})

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
export const useTeams = () => query(TEAMS)
export const useTeamMap = () => byId(TEAMS)
export const useMyTeams = () => query({ teamIds: TEAMS.map((t) => t.id), allTeams: true })
export const useVenues = () => query([])
export const useVenueMap = () => ({})
export const useMemberMap = () => ({})
export const useProfiles = () => query([])
export const useClub = () => query({ name: 'Ossett Town Juniors', motto: 'Where football and friendships flourish', crestUrl: null })
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

export const useRegisteredPlayers = () => {
  // `error` fails the register read, which is the state INSIDE the page body:
  // the header, the season select and the counts still render, and the list
  // region is an error with a retry. The page level gate (the seasons read)
  // is a different screen and is not what this state shows.
  if (state === 'loading' || state === 'rowsloading') return pendingQuery<typeof REGISTERED_PLAYERS>()
  if (state === 'error') return failedQuery<typeof REGISTERED_PLAYERS>()
  if (state === 'empty') return query([] as typeof REGISTERED_PLAYERS)
  if (state === 'overlimit') return query(OVER_LIMIT_PLAYERS)
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
export const usePlayerHistory = () => query([])
export const useSpondEventResponseCounts = () => query({ byEvent: {}, available: false })
export const useSpondSync = mutation
export const useRefreshSpondPlanning = mutation
export const useLinkSessionSpondEvent = mutation
export const useEventKindContext = () => ({ spondEvents: {}, teamNames: TEAMS.map((t) => t.name) })
export const useSignedMediaUrl = () => query(null)
export const useMediaSrc = () => ({ src: null, isLoading: false, isError: false })
export const useBoards = () => query([])
export const useFeedback = () => query([])
export const useFeedbackCommentCounts = () => query({})
export const useContentShareStatus = () => query(null)
export const useAuditActivity = () => query({ pages: [], rows: [] })
export const useImportFA = mutation
export const useUploadMedia = mutation
export const useInsertDrill = mutation
export const useUpdateDrill = mutation
