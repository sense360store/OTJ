// Import a whole programme from England Football. Paste a programme overview
// link from learn.englandfootball.com and the fa-import-programme Edge
// Function fetches that overview as the signed in coach, follows only its
// week links (the single sanctioned one-level follow: same host, capped),
// imports each week exactly as the single-session import does, stores the
// programme PDF unmodified and ties everything to one programme. See
// CLAUDE.md, Third-party content.
import { useState } from 'react'
import { useNav } from '../hooks/useNav'
import { useImportFAProgramme } from '../lib/queries'
import type { ImportProgrammeResult, ImportProgrammeWeek } from '../lib/queries'
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

function weekLine(w: ImportProgrammeWeek): string {
  if (w.status === 'imported')
    return `Imported ${w.drills} drill${w.drills !== 1 ? 's' : ''} and ${w.media} file${w.media !== 1 ? 's' : ''}`
  if (w.status === 'skipped') return 'Skipped, already imported'
  return w.error || 'Failed'
}

function ResultCard({ result, onClose }: { result: ImportProgrammeResult; onClose: () => void }) {
  const nav = useNav()
  const imported = result.weeks.filter((w) => w.status === 'imported').length
  const viewProgramme = () => {
    onClose()
    if (result.programmeId) nav('programme', { programmeId: result.programmeId })
    else nav('programmes')
  }
  // Per-week parse warnings roll up under each week so a long import stays
  // readable; overview-level warnings sit at the bottom.
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
          <div style={{ fontWeight: 800, fontSize: 16 }}>{result.programmeName || 'Programme imported'}</div>
          <div className="muted" style={{ fontSize: 13.5, marginTop: 2 }}>
            {imported} of {result.weeks.length} week{result.weeks.length !== 1 ? 's' : ''} imported with England
            Football Learning attribution.
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
        {result.weeks.map((w, i) => (
          <div
            key={i}
            style={{ padding: '8px 10px', borderRadius: 10, border: '1px solid var(--line)', background: 'var(--bg-2)' }}
          >
            <div className="row" style={{ gap: 8 }}>
              <span className="role-badge" style={{ fontSize: 12 }}>
                Week {w.week}
              </span>
              <span style={{ flex: 1, fontWeight: 700, fontSize: 13, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {w.templateName || (w.status === 'skipped' ? 'Already in the programme' : '')}
              </span>
              <span
                className="muted"
                style={{ fontSize: 12.5, fontWeight: 700, color: w.status === 'failed' ? 'var(--m-pdf)' : undefined }}
              >
                {weekLine(w)}
              </span>
            </div>
            {w.tags.length > 0 && (
              <div className="muted" style={{ fontSize: 12, lineHeight: 1.5, marginTop: 4 }}>
                Tagged {w.tags.join(', ')}
              </div>
            )}
            {w.warnings.length > 0 && (
              <div style={{ marginTop: 4 }}>
                {w.warnings.map((x, j) => (
                  <div key={j} className="muted" style={{ fontSize: 12, lineHeight: 1.5 }}>
                    {x}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      {result.warnings.length > 0 && (
        <div
          style={{
            marginTop: 10,
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
        The import is a starting point: open each week's template and drills to set corner, theme, format and timings
        for your group.
      </p>
      <button className="btn btn-primary btn-block" style={{ marginTop: 12 }} onClick={viewProgramme}>
        <Icon.book />
        View programme
      </button>
    </div>
  )
}

export function ImportProgrammeModal({ onClose }: { onClose: () => void }) {
  const importProgramme = useImportFAProgramme()
  const [url, setUrl] = useState('')
  const [error, setError] = useState<string | null>(null)
  const result = importProgramme.data

  const submit = () => {
    setError(null)
    const trimmed = url.trim()
    if (!looksLikeFAUrl(trimmed)) {
      setError(`Paste a programme overview link from ${PAGE_HOST}.`)
      return
    }
    importProgramme.mutate({ url: trimmed }, { onError: (e) => setError(e.message) })
  }

  return (
    <Modal
      title="Import a programme"
      sub="Paste an England Football programme overview link and get every week as a template."
      onClose={onClose}
      footer={
        result ? null : (
          <>
            <button className="btn btn-ghost" onClick={onClose} disabled={importProgramme.isPending}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={submit} disabled={!url.trim() || importProgramme.isPending}>
              <Icon.download />
              {importProgramme.isPending ? 'Importing…' : 'Import programme'}
            </button>
          </>
        )
      }
    >
      {result ? (
        <ResultCard result={result} onClose={onClose} />
      ) : (
        <>
          <div className="field">
            <label>Programme overview link</label>
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
              disabled={importProgramme.isPending}
            />
          </div>
          <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.55 }}>
            This import runs under the club's FA affiliation, for non-commercial coaching use only. FA images and PDFs
            are stored unmodified and shown with England Football Learning attribution. Only the overview and the week
            pages it links are fetched, same host, capped at ten. Re-importing the same overview updates the programme
            and skips weeks that already exist.
          </p>
          {importProgramme.isPending && (
            <p className="muted" style={{ fontSize: 13.5, fontWeight: 700 }}>
              Fetching the overview and importing each week. This can take a minute…
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
