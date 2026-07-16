// Sessions seam. The { sessions, upsertSession } shape is kept stable so the
// planner and the sessions screens do not change their call sites, but the data
// comes from the Supabase-backed query and the write goes through the real
// mutation. loading and error are exposed for the screens that read sessions.
//
// upsertSession is awaitable: it resolves with the saved session once the
// database write lands and rejects when it fails, so a flow that navigates,
// closes or reports success can wait for the write instead of assuming it.
// Every caller goes through the guarded submit seam (src/lib/sessionSubmit.ts),
// which catches the rejection and owns the visible pending and error state, so
// no floating promise escapes. No global error string lives here on purpose:
// the initiating component knows which action failed and what retry means.
import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'
import type { Session } from '../lib/data'
import { useSessions as useSessionsQuery, useUpsertSession } from '../lib/queries'

interface SessionsState {
  sessions: Session[]
  upsertSession: (s: Session) => Promise<Session>
  loading: boolean
  error: boolean
}

const SessionsContext = createContext<SessionsState | undefined>(undefined)

export function SessionsProvider({ children }: { children: ReactNode }) {
  const { data, isLoading, isError } = useSessionsQuery()
  const mutation = useUpsertSession()
  const upsertSession = (s: Session) => mutation.mutateAsync(s)

  return (
    <SessionsContext.Provider value={{ sessions: data ?? [], upsertSession, loading: isLoading, error: isError }}>
      {children}
    </SessionsContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useSessions(): SessionsState {
  const ctx = useContext(SessionsContext)
  if (!ctx) throw new Error('useSessions must be used within SessionsProvider')
  return ctx
}
