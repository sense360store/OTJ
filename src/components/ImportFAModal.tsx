// Import from England Football. Paste a session link from
// learn.englandfootball.com and the fa-import Edge Function fetches that one
// page as the signed in coach: each activity diagram is stored unmodified
// with attribution, one draft drill is created per activity, and a template
// ties them together. See CLAUDE.md, Third-party content, for the policy the
// fixed note below states.
import { useState } from 'react'
import { useNav } from '../hooks/useNav'
import { useImportFA } from '../lib/queries'
import type { ImportFADuplicate, ImportFAResult } from '../lib/queries'
import { Icon } from './icons'
import { Modal } from './ui'

const PAGE_HOST = 'learn.englandfootball.com'

function looksLikeFAUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' && url.hostname.toLowerCase() === PAGE_HOST
  } catch {
    return false
  }
}

function ResultCard({ result, onClose }: { result: ImportFAResult; onClose: () => void }) {
  const nav = useNav()
  const viewTemplate = () => {
    onClose()
    nav('templates')
  }
  return (
    <div>
      <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
        <span
          style={{
            width: 38,
            height: 38,
            borderRadius: '50%',
            flex: '0 0 38px',
            background: 'color-mix(in srgb, var(--c-physical) 18%, transparent)',
            color: 'var(--c-physical)',
            display: 'grid',
            placeItems: 'center',
          }}
        >
          <Icon.checkCircle style={{ width: 20, height: 20 }} />
        </span>
        <div>
          <div style={{ fontWeight: 800, fontSize: 16 }}>{result.templateName || 'Session imported'}</div>
          <div className="muted" style={{ fontSize: 13.5, marginTop: 2 }}>
            Created {result.drills} drill{result.drills !== 1 ? 's' : ''} and stored {result.media} file
            {result.media !== 1 ? 's' : ''} with England Football Learning attribution.
          </div>
        </div>
      </div>
      {result.warnings.length > 0 && (
        <div
          style={{
            marginTop: 12,
            padding: '10px 12px',
            borderRadius: 10,
            border: '1px solid var(--line)',
            background: 'var(--bg-2)',
          }}
        >
          {result.warnings.map((w, i) => (
            <div key={i} className="muted" style={{ fontSize: 12.5, lineHeight: 1.5 }}>
              {w}
            </div>
          ))}
        </div>
      )}
      <p className="muted" style={{ fontSize: 13.5, lineHeight: 1.5, marginTop: 12 }}>
        The import is a starting point: open the template and its drills to set corner, theme, format and timings for
        your group.
      </p>
      <button className="btn btn-primary btn-block" style={{ marginTop: 12 }} onClick={viewTemplate}>
        <Icon.book />
        View template
      </button>
    </div>
  )
}

// The already imported outcome: fa-import found this page in the club's
// library and created nothing. Keeping the existing template is the safe
// default; importing again is the explicit choice to create a second copy.
export function DuplicateCard({
  result,
  onKeep,
  onView,
  onReimport,
}: {
  result: ImportFADuplicate
  onKeep: () => void
  onView: () => void
  onReimport: () => void
}) {
  return (
    <div>
      <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
        <span
          style={{
            width: 38,
            height: 38,
            borderRadius: '50%',
            flex: '0 0 38px',
            background: 'color-mix(in srgb, var(--c-social) 18%, transparent)',
            color: 'var(--c-social)',
            display: 'grid',
            placeItems: 'center',
          }}
        >
          <Icon.copy style={{ width: 20, height: 20 }} />
        </span>
        <div>
          <div style={{ fontWeight: 800, fontSize: 16 }}>Already in the library</div>
          <div className="muted" style={{ fontSize: 13.5, marginTop: 2 }}>
            {result.templateName
              ? `This page was imported before as "${result.templateName}".`
              : 'This session has already been imported.'}
          </div>
        </div>
      </div>
      <p className="muted" style={{ fontSize: 13.5, lineHeight: 1.5, marginTop: 12 }}>
        Keep the existing template, or import the page again. Importing again creates a second copy: another template
        and another set of drills and media.
      </p>
      <button className="btn btn-primary btn-block" style={{ marginTop: 12 }} onClick={onKeep}>
        <Icon.check />
        Keep the existing one
      </button>
      <div className="row" style={{ gap: 8, marginTop: 8 }}>
        <button className="btn btn-ghost" style={{ flex: 1 }} onClick={onView}>
          <Icon.book />
          View template
        </button>
        <button className="btn btn-ghost" style={{ flex: 1 }} onClick={onReimport}>
          <Icon.download />
          Import again anyway
        </button>
      </div>
    </div>
  )
}

export function ImportFAModal({ onClose }: { onClose: () => void }) {
  const importFA = useImportFA()
  const nav = useNav()
  const [url, setUrl] = useState('')
  const [error, setError] = useState<string | null>(null)
  const outcome = importFA.data
  const duplicate = outcome && 'alreadyImported' in outcome ? outcome : null
  const result = outcome && !('alreadyImported' in outcome) ? outcome : null

  const submit = () => {
    setError(null)
    const trimmed = url.trim()
    if (!looksLikeFAUrl(trimmed)) {
      setError(`Paste a session link from ${PAGE_HOST}.`)
      return
    }
    importFA.mutate({ url: trimmed }, { onError: (e) => setError(e.message) })
  }

  // The explicit second copy: the same page re-called with the reimport
  // flag set. Calling mutate again clears the duplicate outcome, so the
  // form and its progress note show while the import runs.
  const reimportAnyway = () => {
    setError(null)
    importFA.mutate({ url: url.trim(), reimport: true }, { onError: (e) => setError(e.message) })
  }

  const viewExisting = () => {
    onClose()
    nav('templates')
  }

  return (
    <Modal
      title="Import from England Football"
      sub="Paste a session page link and get a ready made template."
      onClose={onClose}
      footer={
        outcome ? null : (
          <>
            <button className="btn btn-ghost" onClick={onClose} disabled={importFA.isPending}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={submit} disabled={!url.trim() || importFA.isPending}>
              <Icon.download />
              {importFA.isPending ? 'Importing…' : 'Import session'}
            </button>
          </>
        )
      }
    >
      {result ? (
        <ResultCard result={result} onClose={onClose} />
      ) : duplicate ? (
        <DuplicateCard result={duplicate} onKeep={onClose} onView={viewExisting} onReimport={reimportAnyway} />
      ) : (
        <>
          <div className="field">
            <label>Session page link</label>
            <input
              type="url"
              placeholder={`https://${PAGE_HOST}/sessions/…`}
              value={url}
              autoFocus
              onChange={(e) => {
                setUrl(e.target.value)
                setError(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit()
              }}
              disabled={importFA.isPending}
            />
          </div>
          <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.55 }}>
            This import runs under the club's FA affiliation, for non-commercial coaching use only. FA images are
            stored unmodified and shown with England Football Learning attribution. One page per import; nothing else
            is fetched.
          </p>
          {importFA.isPending && (
            <p className="muted" style={{ fontSize: 13.5, fontWeight: 700 }}>
              Fetching the page and storing the diagrams…
            </p>
          )}
          {error && (
            <p className="muted" style={{ color: 'var(--m-pdf)', fontSize: 13.5 }}>
              {error}
            </p>
          )}
        </>
      )}
    </Modal>
  )
}
