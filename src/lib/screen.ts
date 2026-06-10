// Maps a URL pathname to the prototype's screen key, used to drive active
// states in the sidebar and bottom nav.
export type Screen =
  | 'home'
  | 'library'
  | 'drill'
  | 'sessions'
  | 'planner'
  | 'templates'
  | 'media'
  | 'live'
  | 'login'
  | 'account'
  | 'admin-users'
  | 'admin-teams'

export function screenFromPath(pathname: string): Screen {
  if (pathname === '/') return 'home'
  if (pathname.startsWith('/library')) return 'library'
  if (pathname.startsWith('/drill')) return 'drill'
  if (pathname.startsWith('/sessions')) return 'sessions'
  if (pathname.startsWith('/planner')) return 'planner'
  if (pathname.startsWith('/templates')) return 'templates'
  if (pathname.startsWith('/media')) return 'media'
  if (pathname.startsWith('/live')) return 'live'
  if (pathname.startsWith('/login')) return 'login'
  if (pathname.startsWith('/account')) return 'account'
  if (pathname.startsWith('/admin/users')) return 'admin-users'
  if (pathname.startsWith('/admin/teams')) return 'admin-teams'
  return 'home'
}
