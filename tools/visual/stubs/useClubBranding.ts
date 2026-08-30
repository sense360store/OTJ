// The club identity, without the club read or the signed crest URL.
//
// The name and the motto come from the fixtures rather than from constants
// here, because both are strings the CLUB chooses and both have a length the
// signed out card has to survive. `longclub` and `longmotto` are the two
// states that make them long, one each, so neither claim rests on the other.
import { LOGIN_CLUB_NAME, LOGIN_MOTTO } from '../fixtures'

export interface ClubBranding {
  name: string | null
  motto: string | null
  crestSrc: string | null
}

export function useClubBranding(): ClubBranding {
  return { name: LOGIN_CLUB_NAME, motto: LOGIN_MOTTO, crestSrc: null }
}
