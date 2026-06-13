// The capability gated route guard, pulled into its own module so the static
// renderer can cover the redirect decision without mounting the whole app.
// REVIEW: part of the capability route guards.
import { Navigate, Outlet } from 'react-router-dom'
import { useMyCapabilities } from '../lib/queries'

function Splash() {
  return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', color: 'var(--slate)' }}>Loading…</div>
}

// Presentational gate over a capability set, exported for the routing tests the
// same way HomeSwitch is. A set lacking the capability renders a redirect; a
// set holding it renders the nested routes. The browse and authoring surfaces
// pass cap='sessions.create' and redirect to Home, so a parent (no
// sessions.create) lands on Home, not an empty shell.
export function CapGate({
  caps,
  cap,
  redirect = '/',
}: {
  caps: ReadonlySet<string>
  cap: string
  redirect?: string
}) {
  if (!caps.has(cap)) return <Navigate to={redirect} replace />
  return <Outlet />
}

// Capability gated routes. Every guard follows a capability, never a role name,
// so a member holding any role that grants it gets in and the tick grid stays
// the single place access is defined. The RLS, the triggers and the Edge
// Functions enforce the same boundary server side; a member without the
// capability navigating directly is redirected. Waits for the capability read
// so a direct URL hit is not bounced before the set is known.
export function RequireCap({ cap, redirect = '/' }: { cap: string; redirect?: string }) {
  const { caps, isPending } = useMyCapabilities()
  if (isPending) return <Splash />
  return <CapGate caps={caps} cap={cap} redirect={redirect} />
}
