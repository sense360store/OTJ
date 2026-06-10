// The club crest. Renders the club's own crest when one is set (live from
// the club row when signed in, the last cached identity on the logged-out
// screens), falling back to the bundled asset, and to the "OTJ" text mark if
// even that fails to load.
import { useState } from 'react'
import { useClubBranding } from '../hooks/useClubBranding'

export function Crest({ className = 'crest' }: { className?: string }) {
  const { name, crestSrc } = useClubBranding()
  const [brokenCustom, setBrokenCustom] = useState<string | null>(null)
  const [brokenBundled, setBrokenBundled] = useState(false)
  const custom = crestSrc && brokenCustom !== crestSrc ? crestSrc : null
  if (!custom && brokenBundled) return <div className="crest-fallback">OTJ</div>
  return (
    <img
      src={custom ?? '/crest.png'}
      alt={(name ?? 'Ossett Town Juniors') + ' crest'}
      className={className}
      onError={() => (custom ? setBrokenCustom(custom) : setBrokenBundled(true))}
    />
  )
}
