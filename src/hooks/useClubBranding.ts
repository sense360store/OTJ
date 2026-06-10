// The club identity (name, motto, crest) as the shell and the logged-out
// screens render it. Signed in, it reads the club row live through the query
// layer and resolves the crest to a usable URL: a storage path is signed, a
// full URL passes through. It then caches the result in localStorage, because
// the login screen has no session, so it can neither read the club row under
// RLS nor sign storage URLs; it shows the last known identity instead. The
// cached crest link is a signed URL with a short validity mark; past it the
// consumers fall back to the bundled crest.
import { useEffect, useState } from 'react'
import { useAuth } from './useAuth'
import { useClub, useSignedMediaUrl } from '../lib/queries'

const CACHE_KEY = 'otj_club_brand'
// A cached signed URL lives an hour from minting; the minting time is not
// knowable here, so the cache claims a conservative ten minutes from writing.
const CREST_CACHE_MS = 10 * 60 * 1000

interface BrandCache {
  name?: string
  motto?: string
  crestSrc?: string | null
  // Epoch milliseconds the cached crest link stops being trusted, null for a
  // plain URL that does not expire.
  crestExpiry?: number | null
}

function readCache(): BrandCache {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}') as BrandCache
  } catch {
    return {}
  }
}

export interface ClubBranding {
  name: string | null
  motto: string | null
  crestSrc: string | null
}

export function useClubBranding(): ClubBranding {
  const { user } = useAuth()
  const { data: club } = useClub()
  const crestIsPath = !!club?.crestUrl && !/^https?:\/\//i.test(club.crestUrl)
  const { data: signedCrest } = useSignedMediaUrl(crestIsPath ? club?.crestUrl : undefined)
  const crestSrc = club?.crestUrl ? (crestIsPath ? (signedCrest ?? null) : club.crestUrl) : null

  // Persist the latest identity for the signed-out screens.
  useEffect(() => {
    if (!user || !club) return
    const cache: BrandCache = {
      name: club.name,
      motto: club.motto || undefined,
      crestSrc,
      crestExpiry: crestSrc ? (crestIsPath ? Date.now() + CREST_CACHE_MS : null) : null,
    }
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache))
  }, [user, club, crestSrc, crestIsPath])

  // Read once on mount; the logged-out screens mount fresh after sign-out,
  // so the snapshot is current for them. Freshness of the crest link is
  // judged at the same moment.
  const [cached] = useState<ClubBranding>(() => {
    const c = readCache()
    const crestFresh = !!c.crestSrc && (c.crestExpiry == null || c.crestExpiry > Date.now())
    return {
      name: c.name ?? null,
      motto: c.motto ?? null,
      crestSrc: crestFresh ? (c.crestSrc ?? null) : null,
    }
  })

  if (user) {
    return { name: club?.name ?? null, motto: club?.motto || null, crestSrc }
  }
  return cached
}
