// Sessions seam. The { sessions, upsertSession } shape is kept stable so the
// planner and the sessions screens do not change their call sites, but the data
// now comes from the Supabase-backed query and the write goes through the real
// mutation. loading and error are exposed for the screens that read sessions.
import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'
import type { Session } from '../lib/data'
import { useSessions as useSessionsQuery, useUpsertSession } from '../lib/queries'

interface SessionsState {
  sessions: Session[]
  upsertSession: (s: Session) => void
  loading: boolean
  error: boolean
}

const SessionsContext = createContext<SessionsState | undefined>(undefined)

export function SessionsProvider({ children }: { children: ReactNode }) {
  const { data, isLoading, isError } = useSessionsQuery()
  const mutation = useUpsertSession()
  const upsertSession = (s: Session) => {
    mutation.mutate(s)
  }

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
