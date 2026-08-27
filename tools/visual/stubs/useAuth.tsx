/* eslint-disable react-refresh/only-export-components */
import type { ReactNode } from 'react'
import { fixtures } from '../fixtures'

export function AuthProvider({ children }: { children: ReactNode }) {
  return <>{children}</>
}

export function useAuth() {
  return {
    user: { id: fixtures.me, email: 'coach@example.invalid' },
    session: {},
    profile: {
      id: fixtures.me,
      club_id: 'club',
      full_name: 'Sam Whitfield',
      avatar: 'SW',
      avatar_url: null,
      role: fixtures.role,
      age_groups: [],
      team_id: 'titans',
      created_at: '2026-01-01T00:00:00Z',
    },
    role: fixtures.role,
    loading: false,
    profileLoading: false,
    needsPassword: false,
    clearNeedsPassword: () => {},
    refreshProfile: () => Promise.resolve(),
    signOut: () => Promise.resolve(),
  }
}
