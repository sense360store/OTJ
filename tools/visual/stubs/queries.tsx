/* eslint-disable react-refresh/only-export-components */
// The data layer, answered from fixtures. Everything the real module exports
// that is NOT overridden here re-exports unchanged, so a pure helper stays
// itself and only the reads and writes are replaced.
export * from '../../../src/lib/queries'

import { DRILLS, MEDIA, SESSIONS, TEAMS, TEMPLATES, fixtures } from '../fixtures'

const query = <T,>(data: T) => ({
  data,
  isLoading: false,
  isPending: false,
  isError: false,
  isSuccess: true,
  isRefetching: false,
  isRefetchError: false,
  error: null,
  refetch: () => {},
})

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
export const useCurrentSeason = () => query({ id: 'season', name: '2026/27', archived: false })
export const useSeasons = () => query([])
export const useRegisteredPlayers = () => query([])
export const usePlayers = () => query([])
export const useSpondEvents = () => query([])
export const useSpondMappings = () => query([])
export const useSpondLinks = () => query({ available: true, links: [] })
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
