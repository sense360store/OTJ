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
  // Storage path of the uploaded profile photo in the media bucket, under
  // avatars/{user_id}/. Null falls back to initials.
  avatar_url: string | null
  role: Role
  // The roles row driving every permission since 0010. The legacy role
  // enum above stays readable for one phase but decides nothing.
  role_id: string | null
  age_groups: string[]
  team_id: string | null
  created_at: string
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
  // Re-reads the profile row after a self-service write (name, team, photo)
  // so the shell reflects the change at once.
  refreshProfile: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | undefined>(undefined)

// Invite and recovery links land with type=invite or type=recovery in the URL
// hash. Read synchronously at module load, before the Supabase client
// consumes and strips the hash.
const arrivedToSetPassword =
  typeof window !== 'undefined' && /[#&]type=(invite|recovery)/.test(window.location.hash)

// One select shared by the initial load and refreshProfile.
async function fetchProfile(uid: string): Promise<Profile | null> {
  const { data } = await supabase
    .from('profiles')
    .select('id, club_id, full_name, avatar, avatar_url, role, role_id, age_groups, team_id, created_at')
    .eq('id', uid)
    .single()
  return (data as Profile | null) ?? null
}

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
    fetchProfile(uid).then((next) => {
      if (!active) return
      setProfile(next)
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
    refreshProfile: async () => {
      const uid = session?.user?.id
      if (!uid) return
      setProfile(await fetchProfile(uid))
    },
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
