// The club's identity, behind club.manage. Name and motto write the club row
// through the clubs_update_manage policy; the crest uploads to the media
// bucket under {club_id}/crest/ and stores its path on clubs.crest_url. The sidebar,
// the login screen and every other crest usage read the row live and fall
// back to the bundled asset. REVIEW: capability gated admin surface.
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CREST_TYPES,
  useClearCrest,
  useClub,
  useClubAgeGroups,
  useMyCapabilities,
  useUpdateClub,
  useUpdateClubAgeGroups,
  useUploadCrest,
  useVenueLayouts,
} from '../lib/queries'
import { useClubBranding } from '../hooks/useClubBranding'
import type { Club } from '../lib/data'
import { AGE_GROUP_MAX_LENGTH, ageGroupProblem, normaliseAgeGroups, trimAgeGroup } from '../lib/ageGroups'
import { layoutsUnderRemovedLabels } from '../lib/venueLayout'
import { Icon } from '../components/icons'
import { Button, Card, IconButton, Note, TextField } from '../components/primitives'
import { ErrorNote, Loading, LoadingRows } from '../components/ui'

type Note = { kind: 'ok' | 'error'; text: string } | null

function NoteLine({ note }: { note: Note }) {
  if (!note) return null
  return (
    <p
      className="muted"
      style={{ fontSize: 13.5, marginTop: 10, marginBottom: 0, color: note.kind === 'error' ? 'var(--danger)' : 'var(--success)' }}
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

export const AGE_GROUPS_INTRO =
  'The age groups the club runs, as the labels a coach picks for a session and an admin files a venue layout under. Until the list is set, sessions offer the standard U6s to U12s labels; a venue layout needs the list.'

export const AGE_GROUPS_CHANGED_ELSEWHERE =
  'The age groups were changed by somebody else. The list below is theirs; make your change again.'

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((v, i) => v === b[i])

// The club's age group vocabulary (0053): the one list the session age group
// control and the venue layout admin read. A local draft, saved whole; the
// readback decides whether it is saved, field for field. The list rides its
// own read (useClubAgeGroups), so this card carries its own read states.
export function AgeGroupsCard({ clubId }: { clubId: string }) {
  const read = useClubAgeGroups()
  return (
    <Card padded className="admin-stack-card">
      <h3>Age groups</h3>
      <p className="admin-intro">{AGE_GROUPS_INTRO}</p>
      {read.isError ? (
        <ErrorNote onRetry={() => void read.refetch()}>
          The age groups could not be read. Refresh to try again.
        </ErrorNote>
      ) : read.data === undefined ? (
        <LoadingRows rows={1} label="Loading age groups" />
      ) : (
        <AgeGroupsEditor clubId={clubId} stored={read.data} />
      )}
    </Card>
  )
}

// What removing a label from the draft would leave behind: layouts stay
// stored under it and stop resolving until it is added back. Said before
// the save rather than after, in the label's own words.
function removedLabelsNote(draft: readonly string[], stored: readonly string[], layouts: readonly { ageGroup: string }[]): string | null {
  const removed = stored.filter((l) => !draft.includes(l))
  const affected = removed.filter((l) => layouts.some((x) => x.ageGroup === l))
  if (affected.length === 0) return null
  const counts = affected.map((l) => `${l} (${layouts.filter((x) => x.ageGroup === l).length})`)
  return `Venue layouts are drawn under ${counts.join(', ')}. They stay stored and stop being found until the label is on the list again.`
}

function AgeGroupsEditor({ clubId, stored }: { clubId: string; stored: string[] }) {
  const update = useUpdateClubAgeGroups()
  const layouts = useVenueLayouts()
  const [draft, setDraft] = useState<string[]>(stored)
  // The stored list the draft was taken from. A fresh read that differs from
  // it is somebody else's save: an untouched draft follows it silently, an
  // edited one is dropped and the reason said, because saving the edited
  // draft would have replaced their list wholesale. Reconciled during
  // render, as the Teams screen does, so the draft never survives a paint
  // it should not.
  const [base, setBase] = useState<string[]>(stored)
  const [entry, setEntry] = useState('')
  const [entryError, setEntryError] = useState<string | null>(null)
  const [note, setNote] = useState<Note>(null)
  if (!sameList(base, stored)) {
    setBase(stored)
    if (sameList(draft, base)) setDraft(stored)
    else {
      setDraft(stored)
      setNote({ kind: 'error', text: AGE_GROUPS_CHANGED_ELSEWHERE })
    }
  }
  const changed = !sameList(draft, stored)

  const add = () => {
    const problem = ageGroupProblem(entry, draft)
    if (problem) {
      setEntryError(problem)
      return
    }
    setEntryError(null)
    setNote(null)
    setDraft([...draft, trimAgeGroup(entry)])
    setEntry('')
  }

  const save = () => {
    setNote(null)
    const sending = normaliseAgeGroups(draft)
    update.mutate(
      { id: clubId, ageGroups: sending },
      {
        onSuccess: (held) => {
          if (sameList(held, sending)) {
            setBase(held)
            setDraft(held)
            setNote({ kind: 'ok', text: 'Saved. Sessions and venue layouts read this list now.' })
          } else {
            setNote({ kind: 'error', text: 'The list came back different from what was sent, so it is not saved as shown.' })
          }
        },
        onError: (e) => setNote({ kind: 'error', text: e.message }),
      },
    )
  }

  return (
    <>
      {draft.length === 0 ? (
        <p className="admin-hint">No age groups yet. Add the first one below.</p>
      ) : (
        <ul className="age-group-list" aria-label="Age groups">
          {draft.map((label) => (
            <li key={label} className="age-group-item">
              {label}
              <IconButton
                label={`Remove ${label}`}
                icon={Icon.x}
                disabled={update.isPending}
                onClick={() => {
                  setNote(null)
                  setDraft(draft.filter((g) => g !== label))
                }}
              />
            </li>
          ))}
        </ul>
      )}
      <div className="admin-add">
        <TextField
          label="New age group"
          className="field-flush admin-field-grow"
          placeholder="e.g. U8s"
          value={entry}
          maxLength={AGE_GROUP_MAX_LENGTH}
          error={entryError}
          onChange={(e) => {
            setEntry(e.target.value)
            if (entryError) setEntryError(null)
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())}
        />
        <Button icon={Icon.plus} disabled={update.isPending} onClick={add}>
          Add
        </Button>
      </div>
      {(() => {
        const warning = removedLabelsNote(draft, stored, layoutsUnderRemovedLabels(layouts.data ?? [], draft))
        return warning ? (
          <Note tone="warning" role="status" className="admin-note">
            {warning}
          </Note>
        ) : null
      })()}
      <div className="venue-layout-acts">
        <Button variant="primary" icon={Icon.check} disabled={!changed || update.isPending} onClick={save}>
          {update.isPending ? 'Saving…' : 'Save age groups'}
        </Button>
        {changed && !update.isPending && <span className="admin-hint">Not saved yet.</span>}
      </div>
      {note && (
        <Note tone={note.kind === 'ok' ? 'success' : 'danger'} role={note.kind === 'ok' ? 'status' : 'alert'} className="admin-note">
          {note.text}
        </Note>
      )}
    </>
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
          <h1>Club</h1>
          <div className="sub">The club's name, motto, crest and age groups, shown across the app and on the sign in screen.</div>
        </div>
      </div>
      <IdentityCard club={club} />
      <CrestCard club={club} />
      <AgeGroupsCard clubId={club.id} />
    </div>
  )
}
