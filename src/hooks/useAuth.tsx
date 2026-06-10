// Current user plus role context, backed by Supabase Auth. The auth guard in
// App.tsx and the shell read from this. REVIEW: part of the auth flow.
import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { Session as AuthSession, User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { Role } from '../lib/data'

export type { Role }

export interface Profile {
  id: string
  club_id: string | null
  full_name: string | null
  avatar: string | null
  role: Role
  age_groups: string[]
  team_id: string | null
}

interface AuthState {
  user: User | null
  session: AuthSession | null
  profile: Profile | null
  role: Role | null
  loading: boolean
  // True until the profile row for the signed-in user has been fetched. The
  // admin route guard waits on this so a direct URL hit does not bounce an
  // admin away before their role is known.
  profileLoading: boolean
  // True when the user arrived through an invite or password recovery link
  // and needs to set a password before using the app.
  needsPassword: boolean
  clearNeedsPassword: () => void
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | undefined>(undefined)

// Invite and recovery links land with type=invite or type=recovery in the URL
// hash. Read synchronously at module load, before the Supabase client
// consumes and strips the hash.
const arrivedToSetPassword =
  typeof window !== 'undefined' && /[#&]type=(invite|recovery)/.test(window.location.hash)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [profileLoading, setProfileLoading] = useState(true)
  const [needsPassword, setNeedsPassword] = useState(arrivedToSetPassword)

  // Resolve the initial session, then track auth state changes.
  useEffect(() => {
    let active = true
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setSession(data.session)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next)
      if (event === 'PASSWORD_RECOVERY') setNeedsPassword(true)
      if (event === 'SIGNED_OUT') setNeedsPassword(false)
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
      setProfileLoading(false)
      return
    }
    let active = true
    setProfileLoading(true)
    supabase
      .from('profiles')
      .select('id, club_id, full_name, avatar, role, age_groups, team_id')
      .eq('id', uid)
      .single()
      .then(({ data }) => {
        if (!active) return
        setProfile((data as Profile | null) ?? null)
        setProfileLoading(false)
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
    profileLoading,
    needsPassword,
    clearNeedsPassword: () => setNeedsPassword(false),
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
