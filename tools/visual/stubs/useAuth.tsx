/* eslint-disable react-refresh/only-export-components */
import { useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { ACCOUNT_SIGNIN_EMAIL, fixtures, profileEdits } from '../fixtures'

export function AuthProvider({ children }: { children: ReactNode }) {
  return <>{children}</>
}

export function useAuth() {
  // The three profile fields the Account screen writes come from the harness's
  // own store rather than from a constant, so a successful save moves the
  // screen exactly as refreshProfile moves it in the product: the name in the
  // sidebar updates, Save goes back to disabled, and an uploaded photo
  // replaces the initials. A constant would leave every success screenshot
  // showing a screen that had not changed.
  const edits = useSyncExternalStore(profileEdits.subscribe, profileEdits.read, profileEdits.read)
  return {
    user: { id: fixtures.me, email: ACCOUNT_SIGNIN_EMAIL },
    session: {},
    profile: {
      id: fixtures.me,
      club_id: 'club',
      full_name: edits.fullName,
      // The legacy initials column, left unset so the initials derive from the
      // name above. For the default fixture both spell SW, so no shot moves;
      // for the long name they would otherwise disagree.
      avatar: null,
      avatar_url: edits.avatarPath,
      role: fixtures.role,
      age_groups: [],
      team_id: edits.teamId,
      created_at: '2026-01-01T00:00:00Z',
    },
    role: fixtures.role,
    loading: false,
    // The page level gate on Account: the profile read has not answered.
    profileLoading: fixtures.state === 'profileloading',
    needsPassword: false,
    clearNeedsPassword: () => {},
    refreshProfile: () => Promise.resolve(),
    signOut: () => Promise.resolve(),
  }
}
