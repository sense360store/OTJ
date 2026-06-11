// The club's identity, behind club.manage. Name and motto write the club row
// through the clubs_update_manage policy; the crest uploads to the media
// bucket under club/ and stores its path on clubs.crest_url. The sidebar,
// the login screen and every other crest usage read the row live and fall
// back to the bundled asset. REVIEW: capability gated admin surface.
import { useEffect, useMemo, useRef, useState } from 'react'
import { CREST_TYPES, useClearCrest, useClub, useMyCapabilities, useUpdateClub, useUploadCrest } from '../lib/queries'
import { useClubBranding } from '../hooks/useClubBranding'
import type { Club } from '../lib/data'
import { Icon } from '../components/icons'
import { ErrorNote, Loading } from '../components/ui'

type Note = { kind: 'ok' | 'error'; text: string } | null

function NoteLine({ note }: { note: Note }) {
  if (!note) return null
  return (
    <p
      className="muted"
      style={{ fontSize: 13.5, marginTop: 10, marginBottom: 0, color: note.kind === 'error' ? 'var(--m-pdf)' : 'var(--m-image)' }}
    >
      {note.text}
    </p>
  )
}

// The crest at the sizes the shell uses, object-fit contain so nothing
// distorts whatever the source ratio.
function CrestPreview({ src, size, label }: { src: string; size: number; label: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
      <img
        src={src}
        alt=""
        style={{
          width: size,
          height: size,
          objectFit: 'contain',
          background: '#fff',
          borderRadius: Math.max(8, Math.round(size / 4.2)),
          border: '1px solid var(--line)',
        }}
      />
      <span className="muted" style={{ fontSize: 11, fontWeight: 700 }}>
        {label}
      </span>
    </div>
  )
}

function IdentityCard({ club }: { club: Club }) {
  const update = useUpdateClub()
  const [name, setName] = useState(club.name)
  const [motto, setMotto] = useState(club.motto)
  const [note, setNote] = useState<Note>(null)
  const changed = (name.trim() !== club.name || motto.trim() !== club.motto) && name.trim() !== ''

  const save = () => {
    setNote(null)
    update.mutate(
      { id: club.id, name: name.trim(), motto: motto.trim() },
      {
        onSuccess: () => setNote({ kind: 'ok', text: 'Saved. The sidebar and the sign in screen show it now.' }),
        onError: (e) => setNote({ kind: 'error', text: e.message }),
      },
    )
  }

  return (
    <div className="card" style={{ padding: 18, marginBottom: 18 }}>
      <h3 style={{ fontSize: 17, marginBottom: 4 }}>Name and motto</h3>
      <p className="muted" style={{ fontSize: 13.5, marginTop: 0, marginBottom: 14 }}>
        The name heads the sidebar and the sign in screen; the motto sits underneath in both.
      </p>
      <div className="field">
        <label htmlFor="club-name">Club name</label>
        <input id="club-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Club name" />
      </div>
      <div className="field">
        <label htmlFor="club-motto">Motto</label>
        <input
          id="club-motto"
          value={motto}
          onChange={(e) => setMotto(e.target.value)}
          placeholder="A line that sums the club up"
        />
      </div>
      <button className="btn btn-primary" disabled={!changed || update.isPending} onClick={save}>
        <Icon.check />
        {update.isPending ? 'Saving…' : 'Save'}
      </button>
      <NoteLine note={note} />
    </div>
  )
}

function CrestCard({ club }: { club: Club }) {
  const { crestSrc } = useClubBranding()
  const upload = useUploadCrest()
  const clear = useClearCrest()
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [note, setNote] = useState<Note>(null)
  const busy = upload.isPending || clear.isPending

  // One object URL per chosen file, revoked when replaced or on unmount.
  const previewUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file])
  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    },
    [previewUrl],
  )

  const pick = (f: File | null) => {
    setNote(null)
    if (!f) return
    if (!CREST_TYPES.includes(f.type)) {
      setNote({ kind: 'error', text: 'Use a PNG, JPG or SVG file.' })
      return
    }
    setFile(f)
  }

  const save = () => {
    if (!file) return
    setNote(null)
    upload.mutate(
      { club, file },
      {
        onSuccess: () => {
          setFile(null)
          setNote({ kind: 'ok', text: 'Crest updated. It shows in the sidebar and on the sign in screen.' })
        },
        onError: (e) => setNote({ kind: 'error', text: e.message }),
      },
    )
  }

  const shown = previewUrl ?? crestSrc ?? '/crest.png'

  return (
    <div className="card" style={{ padding: 18 }}>
      <h3 style={{ fontSize: 17, marginBottom: 4 }}>Crest</h3>
      <p className="muted" style={{ fontSize: 13.5, marginTop: 0, marginBottom: 14 }}>
        PNG, JPG or SVG. Shown at the sizes the app uses; nothing is stretched or cropped.
      </p>
      <div className="row" style={{ gap: 18, alignItems: 'flex-end', marginBottom: 14 }}>
        <CrestPreview src={shown} size={96} label={previewUrl ? 'Preview' : 'Current'} />
        <CrestPreview src={shown} size={42} label="Sidebar" />
        <CrestPreview src={shown} size={34} label="Mobile" />
      </div>
      <div className="row wrap" style={{ gap: 9 }}>
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/svg+xml,.png,.jpg,.jpeg,.svg"
          style={{ display: 'none' }}
          onChange={(e) => {
            pick(e.target.files?.[0] ?? null)
            e.target.value = ''
          }}
        />
        <button className="btn btn-ghost" disabled={busy} onClick={() => inputRef.current?.click()}>
          <Icon.upload />
          Choose image
        </button>
        {file && (
          <>
            <button className="btn btn-primary" disabled={busy} onClick={save}>
              <Icon.check />
              {upload.isPending ? 'Saving…' : 'Save crest'}
            </button>
            <button className="btn btn-quiet" disabled={busy} onClick={() => setFile(null)}>
              <Icon.x />
              Cancel
            </button>
          </>
        )}
        {!file && club.crestUrl && (
          <button
            className="btn btn-quiet"
            disabled={busy}
            onClick={() => {
              setNote(null)
              clear.mutate(
                { club },
                {
                  onSuccess: () => setNote({ kind: 'ok', text: 'Back to the bundled crest.' }),
                  onError: (e) => setNote({ kind: 'error', text: e.message }),
                },
              )
            }}
          >
            <Icon.rotate />
            {clear.isPending ? 'Resetting…' : 'Use bundled crest'}
          </button>
        )}
      </div>
      <NoteLine note={note} />
    </div>
  )
}

export function AdminClub() {
  const { caps } = useMyCapabilities()
  const { data: club, isLoading, isError } = useClub()
  if (isLoading) return <Loading />
  if (isError || !club) return <ErrorNote />
  // The route guard already keeps members without club.manage out; this is
  // belt and braces for the brief render before a redirect.
  if (!caps.has('club.manage')) return null

  return (
    <div style={{ maxWidth: 680 }}>
      <div className="page-head">
        <div>
          <h2>Club</h2>
          <div className="sub">The club's name, motto and crest, shown across the app and on the sign in screen.</div>
        </div>
      </div>
      <IdentityCard club={club} />
      <CrestCard club={club} />
    </div>
  )
}
