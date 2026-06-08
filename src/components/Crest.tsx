// The club crest, served from the local public asset, with an "OTJ" text
// fallback if the image fails to load.
import { useState } from 'react'

export function Crest({ className = 'crest' }: { className?: string }) {
  const [err, setErr] = useState(false)
  if (err) return <div className="crest-fallback">OTJ</div>
  return (
    <img
      src="/crest.png"
      alt="Ossett Town Juniors crest"
      className={className}
      onError={() => setErr(true)}
    />
  )
}
