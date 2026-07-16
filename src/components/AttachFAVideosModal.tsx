// Bulk attach for the FA video source file pipeline. The FA supplies the
// licensed source MP4s behind imported video sessions; this modal matches
// each picked file to its imported FA video by Vimeo id (filename or
// manifest), or by session and part, shows exactly what will be stored and
// what it weighs before any bytes move, and reports a per file outcome
// afterwards in the same honest style as the FA import: stored, already had
// a file, no matching FA video, not accepted, or failed. Nothing is fetched
// from Vimeo; the only source of bytes is the files picked here. See
// CLAUDE.md, Third-party content.
import { useMemo, useRef, useState } from 'react'
import { isFaVideo } from '../lib/fa'
import {
  formatBytes,
  isManifestFile,
  mergeManifests,
  parseManifest,
  planAttach,
  type AttachPlan,
  type AttachPlanStatus,
  type ParsedManifest,
} from '../lib/faAttach'
import { oldestFirst } from '../lib/contentOrder'
import { MEDIA_MAX_BYTES, useAttachFAVideoFiles, useMedia } from '../lib/queries'
import type { AttachFAFilesOutcome } from '../lib/queries'
import { Icon } from './icons'
import { Modal, UploadProgress } from './ui'

const PLAN_META: Record<AttachPlanStatus, { label: string; color: string }> = {
  store: { label: 'Will store', color: 'var(--c-physical)' },
  skip: { label: 'Already has a file', color: 'var(--slate-2)' },
  unmatched: { label: 'No match', color: 'var(--c-social)' },
  rejected: { label: 'Not accepted', color: 'var(--m-pdf)' },
}

const OUTCOME_META: Record<AttachFAFilesOutcome['status'], { label: string; color: string }> = {
  stored: { label: 'Stored', color: 'var(--c-physical)' },
  skipped: { label: 'Already had a file', color: 'var(--slate-2)' },
  unmatched: { label: 'No match', color: 'var(--c-social)' },
  rejected: { label: 'Not accepted', color: 'var(--m-pdf)' },
  failed: { label: 'Failed', color: 'var(--m-pdf)' },
}

function FileRow({ name, label, color, detail }: { name: string; label: string; color: string; detail: string }) {
  return (
    <div style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
      <div className="row" style={{ gap: 10, justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontWeight: 700, fontSize: 13.5, overflowWrap: 'anywhere' }}>{name}</span>
        <span className="pill" style={{ color, flex: '0 0 auto' }}>
          {label}
        </span>
      </div>
      {detail && (
        <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>
          {detail}
        </div>
      )}
    </div>
  )
}

export function AttachFAVideosModal({ onClose }: { onClose: () => void }) {
  const { data: mediaItems = [] } = useMedia()
  const attach = useAttachFAVideoFiles()
  const [videoFiles, setVideoFiles] = useState<File[]>([])
  const [manifest, setManifest] = useState<ParsedManifest | null>(null)
  const [manifestNames, setManifestNames] = useState<string[]>([])
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  // Real byte progress for the file currently being stored; the count of files
  // lives in progress above and the footer button.
  const [fileBytes, setFileBytes] = useState<{ name: string; loaded: number; total: number } | null>(null)
  const [drag, setDrag] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Each pick replaces the selection, so the plan always reflects exactly the
  // files on screen. Manifest files are read here and never uploaded.
  const pick = async (list: FileList | null) => {
    setError(null)
    const picked = [...(list ?? [])]
    if (picked.length === 0) return
    const manifestFiles = picked.filter((f) => isManifestFile(f.name))
    const parsed = await Promise.all(manifestFiles.map(async (f) => parseManifest(await f.text(), f.name)))
    setVideoFiles(picked.filter((f) => !isManifestFile(f.name)))
    setManifestNames(manifestFiles.map((f) => f.name))
    setManifest(parsed.length > 0 ? mergeManifests(parsed) : null)
  }

  // planAttach matches a session's files to its parts by row position, so it
  // needs the rows in creation order. The media read returns newest first, so
  // the creation order is restored here before planning.
  const plan: AttachPlan<File> | null = useMemo(
    () =>
      videoFiles.length > 0
        ? planAttach(videoFiles, oldestFirst(mediaItems), { maxBytes: MEDIA_MAX_BYTES, manifest: manifest ?? undefined })
        : null,
    [videoFiles, mediaItems, manifest],
  )

  const pending = useMemo(() => mediaItems.filter((m) => isFaVideo(m) && !m.storagePath).length, [mediaItems])

  const outcomes = attach.data
  const run = () => {
    if (!plan || plan.storeCount === 0) return
    setError(null)
    setProgress({ done: 0, total: plan.storeCount })
    setFileBytes(null)
    attach.mutate(
      {
        plan,
        onProgress: (done, total) => setProgress({ done, total }),
        onBytes: (p) => setFileBytes(p),
      },
      { onError: (e) => setError(e.message) },
    )
  }

  const storedCount = outcomes?.filter((o) => o.status === 'stored').length ?? 0

  return (
    <Modal
      title="Attach FA video files"
      sub="Store the FA supplied source MP4s so imported FA videos play in app."
      onClose={onClose}
      footer={
        outcomes ? (
          <button className="btn btn-primary" onClick={onClose}>
            Close
          </button>
        ) : (
          <>
            <button className="btn btn-ghost" onClick={onClose} disabled={attach.isPending}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              onClick={run}
              disabled={!plan || plan.storeCount === 0 || attach.isPending}
            >
              <Icon.upload />
              {attach.isPending
                ? `Storing ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…`
                : plan && plan.storeCount > 0
                  ? `Store ${plan.storeCount} file${plan.storeCount !== 1 ? 's' : ''}`
                  : 'Store files'}
            </button>
          </>
        )
      }
    >
      {outcomes ? (
        <>
          <p style={{ fontSize: 14.5, lineHeight: 1.55 }}>
            {storedCount > 0
              ? `Stored ${storedCount} file${storedCount !== 1 ? 's' : ''}. Those videos now play in app, with the England Football Learning attribution kept.`
              : 'No files were stored.'}
          </p>
          <div>
            {outcomes.map((o, i) => (
              <FileRow
                key={i}
                name={o.fileName}
                label={OUTCOME_META[o.status].label}
                color={OUTCOME_META[o.status].color}
                detail={o.mediaName ? `${o.mediaName} · ${o.detail}` : o.detail}
              />
            ))}
          </div>
        </>
      ) : (
        <>
          <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.55 }}>
            The files come from the FA under the club's licence, for non-commercial coaching use. Name each MP4 by its
            Vimeo id (129532422.mp4), or include a manifest listing file to id; files named by session and part also
            match. Anything ambiguous is reported unmatched and stored nowhere. Nothing is fetched from Vimeo.
          </p>
          <p className="muted" style={{ fontSize: 13.5, fontWeight: 700 }}>
            {pending > 0
              ? `${pending} imported FA video${pending !== 1 ? 's are' : ' is'} waiting for a source file.`
              : 'Every imported FA video already has a stored file.'}
          </p>
          {attach.isPending ? (
            <UploadProgress
              label={fileBytes?.name ?? 'Storing files…'}
              loaded={fileBytes?.loaded ?? null}
              total={fileBytes?.total ?? 0}
            />
          ) : (
          <div
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault()
              setDrag(true)
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDrag(false)
              void pick(e.dataTransfer.files)
            }}
            style={{
              border: '1.5px dashed ' + (drag ? 'var(--royal)' : 'var(--line)'),
              borderRadius: 12,
              padding: '22px 16px',
              textAlign: 'center',
              cursor: 'pointer',
              background: drag ? 'var(--bg-2)' : 'transparent',
            }}
          >
            <input
              ref={inputRef}
              type="file"
              multiple
              accept=".mp4,.m4v,.json,.csv,.txt,video/mp4"
              style={{ display: 'none' }}
              onChange={(e) => void pick(e.target.files)}
            />
            <Icon.film style={{ width: 26, height: 26, color: 'var(--slate-2)' }} />
            <div style={{ fontWeight: 700, fontSize: 14.5, marginTop: 8 }}>
              {videoFiles.length > 0
                ? `${videoFiles.length} file${videoFiles.length !== 1 ? 's' : ''} selected`
                : 'Drop the MP4s here, or click to choose'}
            </div>
            <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>
              MP4 (H.264 video, AAC audio), with an optional manifest (.json, .csv or .txt)
            </div>
          </div>
          )}
          {manifestNames.length > 0 && manifest && (
            <p className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>
              Manifest: {manifestNames.join(', ')} ({manifest.entries.size}{' '}
              {manifest.entries.size === 1 ? 'entry' : 'entries'})
            </p>
          )}
          {plan && (
            <div style={{ marginTop: 12 }}>
              {plan.warnings.map((w, i) => (
                <p key={i} className="muted" style={{ color: 'var(--m-pdf)', fontSize: 12.5, margin: '0 0 6px' }}>
                  {w}
                </p>
              ))}
              <div>
                {plan.entries.map((e, i) => (
                  <FileRow
                    key={i}
                    name={e.file.name}
                    label={PLAN_META[e.status].label}
                    color={PLAN_META[e.status].color}
                    detail={e.mediaName ? `${e.mediaName} · ${e.reason}` : e.reason}
                  />
                ))}
              </div>
              <p style={{ fontSize: 13.5, fontWeight: 700, marginTop: 10 }}>
                {plan.storeCount > 0
                  ? `${plan.storeCount} file${plan.storeCount !== 1 ? 's' : ''} to store, ${formatBytes(plan.storeBytes)} in total.`
                  : 'Nothing to store from this selection.'}
              </p>
            </div>
          )}
          {error && (
            <p className="muted" style={{ color: 'var(--m-pdf)', fontSize: 13.5, marginTop: 8 }}>
              {error}
            </p>
          )}
        </>
      )}
    </Modal>
  )
}
