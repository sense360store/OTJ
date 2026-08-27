// The club identity, without the club read or the signed crest URL.
export interface ClubBranding {
  name: string | null
  motto: string | null
  crestSrc: string | null
}

export function useClubBranding(): ClubBranding {
  return { name: 'Ossett Town Juniors', motto: 'Where football and friendships flourish', crestSrc: null }
}
