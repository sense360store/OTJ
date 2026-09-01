// Gives each signed in identity its own QueryClient. See
// src/lib/queryIdentity.ts for the rule and why it is a new client rather
// than a cleared one.
//
// This sits INSIDE AuthProvider and OUTSIDE everything that reads the query
// layer, which is the order main.tsx mounts. The auth flow itself touches
// none of this: it reads Supabase directly, so it needs no client and is not
// part of the boundary.
import { Fragment, useState } from 'react'
import type { ReactNode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { useAuth } from '../hooks/useAuth'
import { initialQueryScope, nextQueryScope } from '../lib/queryIdentity'

export function QueryIdentityScope({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  const [scope, setScope] = useState(initialQueryScope)
  // Adjusting state during render, which converges because nextQueryScope
  // returns the same object once it has nothing left to change. An effect
  // would be a commit too late: useQuery reads the cache while rendering, so
  // the incoming member's first render would be the one that reads the
  // outgoing member's club.
  const next = nextQueryScope(scope, user?.id ?? null, loading)
  if (next !== scope) setScope(next)
  return (
    <QueryClientProvider client={next.client}>
      {/* The remount. useQuery builds its observer once, against whichever
          client was current then, and never moves it to another, so a new
          client alone would leave every mounted screen reading the old cache.
          Keying on the generation rebuilds them all. Nothing but a change of
          identity moves that number, and an identity change already replaces
          what is on screen. */}
      <Fragment key={next.generation}>{children}</Fragment>
    </QueryClientProvider>
  )
}
