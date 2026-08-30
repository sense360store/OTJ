/* eslint-disable react-refresh/only-export-components */
import { useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { ACCOUNT_SIGNIN_EMAIL, authFlags, fixtures, harnessAuth, profileEdits } from '../fixtures'

export function AuthProvider({ children }: { children: ReactNode }) {
  return <>{children}</>
}

// Signed out and still resolving are the same absence of a user; what
// separates them is `loading`, which is the flag the guard reads first. Both
// are reachable only through the `auth` query key, and the default for every
// screen but Login is `signedin`, so nothing that existed before this moves.
const ANONYMOUS = harnessAuth === 'signedout' || harnessAuth === 'authloading'

export function useAuth() {
  // The three profile fields the Account screen writes come from the harness's
  // own store rather than from a constant, so a successful save moves the
  // screen exactly as refreshProfile moves it in the product: the name in the
  // sidebar updates, Save goes back to disabled, and an uploaded photo
  // replaces the initials. A constant would leave every success screenshot
  // showing a screen that had not changed.
  const edits = useSyncExternalStore(profileEdits.subscribe, profileEdits.read, profileEdits.read)
  // And the one auth flag a press can change, for the same reason: Set
  // Password's success IS the guard letting the application through, so
  // clearNeedsPassword has to actually clear it.
  const needsPassword = useSyncExternalStore(authFlags.subscribe, authFlags.read, authFlags.read)
  return {
    user: ANONYMOUS ? null : { id: fixtures.me, email: ACCOUNT_SIGNIN_EMAIL },
    session: ANONYMOUS ? null : {},
    profile: ANONYMOUS
      ? null
      : {
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
    role: ANONYMOUS ? null : fixtures.role,
    // The auth guard's own gate: the session has not been resolved yet.
    loading: harnessAuth === 'authloading',
    // The page level gate on Account: the profile read has not answered.
    profileLoading: fixtures.state === 'profileloading',
    needsPassword,
    clearNeedsPassword: () => authFlags.clearNeedsPassword(),
    refreshProfile: () => Promise.resolve(),
    signOut: () => Promise.resolve(),
  }
}
