// Phase 1 sessions state. Seeded from the ported data module and mutated in
// memory by the planner, exactly as the prototype's App did with useState plus
// upsertSession. Phase 2 replaces this with a TanStack Query cache and a
// Supabase upsert mutation scoped to the coach.
import { createContext, useContext, useState } from 'react'
import type { ReactNode } from 'react'
import { sessions as seedSessions } from '../lib/data'
import type { Session } from '../lib/data'

interface SessionsState {
  sessions: Session[]
  upsertSession: (s: Session) => void
}

const SessionsContext = createContext<SessionsState | undefined>(undefined)

export function SessionsProvider({ children }: { children: ReactNode }) {
  const [sessions, setSessions] = useState<Session[]>(seedSessions)

  const upsertSession = (s: Session) => {
    setSessions((prev) => {
      const i = prev.findIndex((x) => x.id === s.id)
      if (i === -1) return [...prev, s]
      const copy = [...prev]
      copy[i] = s
      return copy
    })
  }

  return <SessionsContext.Provider value={{ sessions, upsertSession }}>{children}</SessionsContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useSessions(): SessionsState {
  const ctx = useContext(SessionsContext)
  if (!ctx) throw new Error('useSessions must be used within SessionsProvider')
  return ctx
}
