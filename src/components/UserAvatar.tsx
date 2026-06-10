// The user avatar: the uploaded photo when the profile has one, initials
// otherwise. The media bucket is private, so the photo renders through the
// same signed URL hook as media previews. fallbackText carries the legacy
// initials column when set; otherwise the initials derive from the name.
import { useState } from 'react'
import type { CSSProperties } from 'react'
import { useSignedMediaUrl } from '../lib/queries'

function initials(name: string | null | undefined): string {
  if (!name) return 'OTJ'
  const parts = name.trim().split(/\s+/)
  const first = parts[0]?.[0] ?? ''
  const last = parts.length > 1 ? parts[parts.length - 1][0] : ''
  return (first + last).toUpperCase() || 'OTJ'
}

export function UserAvatar({
  name,
  fallbackText,
  path,
  size,
}: {
  name: string | null | undefined
  fallbackText?: string | null
  path?: string | null
  size?: number
}) {
  const { data: url } = useSignedMediaUrl(path)
  // A failed load falls back to initials. Keyed by URL so a replaced photo,
  // which arrives under a new signed URL, gets a fresh attempt.
  const [brokenUrl, setBrokenUrl] = useState<string | null>(null)
  const sizing: CSSProperties | undefined = size
    ? { width: size, height: size, flex: `0 0 ${size}px`, fontSize: Math.round(size * 0.37) }
    : undefined
  if (path && url && brokenUrl !== url) {
    return (
      <img
        className="avatar"
        src={url}
        alt=""
        style={{ ...sizing, objectFit: 'cover' }}
        onError={() => setBrokenUrl(url)}
      />
    )
  }
  return (
    <div className="avatar" style={sizing}>
      {fallbackText || initials(name)}
    </div>
  )
}
