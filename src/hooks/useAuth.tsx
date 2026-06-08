// Current user plus role context, backed by Supabase Auth. The auth guard in
// App.tsx and the shell read from this. REVIEW: part of the auth flow.
import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { Session as AuthSession, User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

export type Role = 'coach' | 'admin' | 'parent'

export interface Profile {
  id: string
  club_id: string | null
  full_name: string | null
  avatar: string | null
  role: Role
  age_groups: string[]
}

interface AuthState {
  user: User | null
  session: AuthSession | null
  profile: Profile | null
  role: Role | null
  loading: boolean
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  // Resolve the initial session, then track auth state changes.
  useEffect(() => {
    let active = true
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setSession(data.session)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
    })
    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [])

  // Load the profile row whenever the signed-in user changes.
  useEffect(() => {
    const uid = session?.user?.id
    if (!uid) {
      // Syncing React state to the external auth system on sign-out.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setProfile(null)
      return
    }
    let active = true
    supabase
      .from('profiles')
      .select('id, club_id, full_name, avatar, role, age_groups')
      .eq('id', uid)
      .single()
      .then(({ data }) => {
        if (active) setProfile((data as Profile | null) ?? null)
      })
    return () => {
      active = false
    }
  }, [session?.user?.id])

  const value: AuthState = {
    user: session?.user ?? null,
    session,
    profile,
    role: profile?.role ?? null,
    loading,
    signOut: async () => {
      await supabase.auth.signOut()
    },
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
