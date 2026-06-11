// Browse England Football: the synced catalogue of the England Football
// Learning sessions listing, filtered by the FA's own taxonomy, with per
// entry import through the same smart importer a pasted URL uses. The
// catalogue holds facts and links only; thumbnails are hot-linked from the
// FA CDN with attribution, and assets are stored only when an entry is
// imported. Bulk import is an explicit, reviewed selection: a confirm
// states the scale, then the queue runs strictly one import at a time.
// See CLAUDE.md, Third-party content.
//
// Roles: every club member reads the catalogue (RLS scopes it to the club).
// Sync, import and the bulk select are for coaching roles; parents see the
// entries and the View on England Football links only.
import { useMemo, useRef, useState } from 'react'
import { useNav } from '../hooks/useNav'
import { useAuth } from '../hooks/useAuth'
import {
  useFaCatalogue,
  useImportFASmart,
  useMarkCatalogueImported,
  useSyncFaCatalogue,
} from '../lib/queries'
import type { FaCatalogueEntry } from '../lib/queries'
import { Icon } from '../components/icons'
import { Empty, ErrorNote, Loading, Modal } from '../components/ui'

type NavFn = ReturnType<typeof useNav>

function fmtSynced(iso: string | null): string {
  if (!iso) return 'Never synced'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'Never synced'
  return `Last synced ${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
}

// Filter options come from the synced rows themselves, split back out of
// the joined label strings so each FA label is one option.
function optionsOf(entries: FaCatalogueEntry[], pick: (e: FaCatalogueEntry) => string[]): string[] {
  const all = new Set<string>()
  for (const e of entries) for (const v of pick(e)) if (v) all.add(v)
  return [...all].sort((a, b) => a.localeCompare(b))
}

const splitLabels = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean)

type ImportState = { state: 'importing' | 'imported' | 'failed'; detail: string }

function EntryCard({
  e,
  coaching,
  selectMode,
  selected,
  onToggle,
  status,
  onImport,
  nav,
}: {
  e: FaCatalogueEntry
  coaching: boolean
  selectMode: boolean
  selected: boolean
  onToggle: () => void
  status: ImportState | null
  onImport: () => void
  nav: NavFn
}) {
  const imported = !!e.importedRef || status?.state === 'imported'
  const viewImported = () => {
    if (e.importedKind === 'programme' && e.importedRef) nav('programme', { programmeId: e.importedRef })
    else nav('templates')
  }
  return (
    <div className="card" style={{ padding: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
      {selectMode && (
        <label
          style={{
            position: 'absolute',
            top: 10,
            left: 10,
            zIndex: 2,
            background: 'var(--bg)',
            borderRadius: 8,
            padding: 8,
            display: 'grid',
            placeItems: 'center',
            cursor: imported ? 'not-allowed' : 'pointer',
            border: '1px solid var(--line)',
          }}
        >
          <input
            type="checkbox"
            checked={selected}
            disabled={imported}
            onChange={onToggle}
            style={{ width: 18, height: 18, accentColor: 'var(--royal)' }}
            aria-label={`Select ${e.title}`}
          />
        </label>
      )}
      {e.thumbnailUrl && (
        <img
          src={e.thumbnailUrl}
          alt=""
          loading="lazy"
          style={{ width: '100%', height: 120, objectFit: 'cover', background: 'var(--bg-2)' }}
        />
      )}
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10, flex: 1 }}>
        <div>
          <div className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
            <h3 style={{ fontSize: 16.5, flex: 1, minWidth: 0 }}>{e.title}</h3>
            <span className="role-badge" style={{ fontSize: 11.5, flex: '0 0 auto' }}>
              {e.kind === 'programme' ? 'Programme' : 'Session'}
            </span>
          </div>
          {e.summary && (
            <p
              className="muted"
              style={{
                fontSize: 13,
                lineHeight: 1.45,
                margin: '4px 0 0',
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {e.summary}
            </p>
          )}
          <a className="muted" href={e.url} target="_blank" rel="noreferrer" style={{ fontSize: 12, fontWeight: 600 }}>
            England Football Learning
          </a>
        </div>
        <div className="row wrap" style={{ gap: 6 }}>
          {splitLabels(e.theme).map((t) => (
            <span key={t} className="pill">
              {t}
            </span>
          ))}
          {e.ageBand && (
            <span className="pill">
              <Icon.users />
              {e.ageBand}
            </span>
          )}
          {e.format && <span className="pill">{e.format}</span>}
        </div>
        {status?.state === 'failed' && (
          <p className="muted" style={{ color: 'var(--m-pdf)', fontSize: 12.5, margin: 0 }}>
            {status.detail || 'Import failed.'}
          </p>
        )}
        <div className="row" style={{ gap: 8, marginTop: 'auto' }}>
          {imported ? (
            <button className="btn btn-ghost" style={{ flex: 1, color: 'var(--c-physical)' }} onClick={viewImported}>
              <Icon.checkCircle />
              Imported · View
            </button>
          ) : (
            coaching &&
            !selectMode && (
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={onImport} disabled={status?.state === 'importing'}>
                <Icon.download />
                {status?.state === 'importing' ? 'Importing…' : 'Import'}
              </button>
            )
          )}
          <a
            className="btn btn-ghost btn-sm icon-only"
            style={{ width: 40, padding: 0 }}
            href={e.url}
            target="_blank"
            rel="noreferrer"
            aria-label="View on England Football"
          >
            <Icon.external />
          </a>
        </div>
      </div>
    </div>
  )
}

// The bulk queue: a deliberate, reviewed run. The confirm states the scale
// first; the queue then imports strictly one entry at a time with a pause
// between calls, pausable between entries, failures listed but never
// blocking the rest.
function BulkImportModal({
  entries,
  importOne,
  onClose,
}: {
  entries: FaCatalogueEntry[]
  importOne: (e: FaCatalogueEntry) => Promise<void>
  onClose: () => void
}) {
  const [stage, setStage] = useState<'confirm' | 'running' | 'done'>('confirm')
  const [statuses, setStatuses] = useState<Record<string, ImportState>>({})
  const [paused, setPaused] = useState(false)
  const pausedRef = useRef(false)
  const cancelRef = useRef(false)

  const programmes = entries.filter((e) => e.kind === 'programme').length
  const sessions = entries.length - programmes
  const doneCount = Object.values(statuses).filter((s) => s.state === 'imported' || s.state === 'failed').length

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

  const run = async () => {
    setStage('running')
    for (let i = 0; i < entries.length; i++) {
      while (pausedRef.current && !cancelRef.current) await sleep(300)
      if (cancelRef.current) break
      const e = entries[i]
      setStatuses((s) => ({ ...s, [e.id]: { state: 'importing', detail: '' } }))
      try {
        await importOne(e)
        setStatuses((s) => ({ ...s, [e.id]: { state: 'imported', detail: '' } }))
      } catch (err) {
        setStatuses((s) => ({ ...s, [e.id]: { state: 'failed', detail: err instanceof Error ? err.message : 'Import failed.' } }))
      }
      // A few seconds between calls, one import in flight at a time.
      if (i < entries.length - 1) await sleep(3000)
    }
    setStage('done')
  }

  const togglePause = () => {
    pausedRef.current = !pausedRef.current
    setPaused(pausedRef.current)
  }
  const close = () => {
    cancelRef.current = true
    onClose()
  }

  const line = (e: FaCatalogueEntry) => {
    const s = statuses[e.id]
    if (!s) return 'Queued'
    if (s.state === 'importing') return 'Importing…'
    if (s.state === 'imported') return 'Imported'
    return s.detail || 'Failed'
  }

  return (
    <Modal
      title="Import selected resources"
      sub={`${entries.length} from England Football Learning`}
      onClose={stage === 'running' && !paused ? () => {} : close}
      footer={
        stage === 'confirm' ? (
          <>
            <button className="btn btn-ghost" onClick={close}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={() => void run()}>
              <Icon.download />
              Import {entries.length} resource{entries.length !== 1 ? 's' : ''}
            </button>
          </>
        ) : stage === 'running' ? (
          <button className="btn btn-ghost" onClick={togglePause}>
            {paused ? <Icon.play /> : <Icon.pause />}
            {paused ? 'Resume' : 'Pause'}
          </button>
        ) : (
          <button className="btn btn-primary" onClick={close}>
            <Icon.check />
            Done
          </button>
        )
      }
    >
      {stage === 'confirm' ? (
        <>
          <p style={{ fontSize: 14.5, lineHeight: 1.55, margin: 0 }}>
            This will import {entries.length} resource{entries.length !== 1 ? 's' : ''}
            {programmes > 0 && sessions > 0
              ? ` (${programmes} programme${programmes !== 1 ? 's' : ''} and ${sessions} session${sessions !== 1 ? 's' : ''})`
              : programmes > 0
                ? ` (${programmes} programme${programmes !== 1 ? 's' : ''})`
                : ''}{' '}
            from England Football Learning, one at a time with a few seconds between each.
          </p>
          <p className="muted" style={{ fontSize: 13, lineHeight: 1.55 }}>
            Each session stores its activity diagrams and session plan PDF unmodified with attribution, typically a few
            MB. A programme imports every week it links, usually six sessions, so it takes correspondingly longer and
            stores correspondingly more. The run is pausable, and a failed entry never stops the rest.
          </p>
        </>
      ) : (
        <>
          <p className="muted" style={{ fontSize: 13, fontWeight: 700, margin: '0 0 10px' }}>
            {doneCount} of {entries.length} processed{paused ? ' · paused' : ''}. Keep this open while the queue runs.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 320, overflowY: 'auto' }}>
            {entries.map((e) => {
              const s = statuses[e.id]
              return (
                <div
                  key={e.id}
                  className="row"
                  style={{ gap: 8, padding: '8px 10px', borderRadius: 10, border: '1px solid var(--line)', background: 'var(--bg-2)' }}
                >
                  <span style={{ flex: 1, fontWeight: 700, fontSize: 13, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {e.title}
                  </span>
                  <span
                    className="muted"
                    style={{
                      fontSize: 12.5,
                      fontWeight: 700,
                      flex: '0 0 auto',
                      color: s?.state === 'failed' ? 'var(--m-pdf)' : s?.state === 'imported' ? 'var(--c-physical)' : undefined,
                    }}
                  >
                    {line(e)}
                  </span>
                </div>
              )
            })}
          </div>
        </>
      )}
    </Modal>
  )
}

export function EnglandFootball() {
  const nav = useNav()
  const { role } = useAuth()
  const { data: entries = [], isLoading, isError } = useFaCatalogue()
  const sync = useSyncFaCatalogue()
  const importFA = useImportFASmart()
  const mark = useMarkCatalogueImported()

  const [q, setQ] = useState('')
  const [theme, setTheme] = useState('')
  const [skill, setSkill] = useState('')
  const [format, setFormat] = useState('')
  const [age, setAge] = useState('')
  const [kind, setKind] = useState('')
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkOpen, setBulkOpen] = useState(false)
  const [statuses, setStatuses] = useState<Record<string, ImportState>>({})
  const [syncError, setSyncError] = useState<string | null>(null)

  const coaching = role === 'coach' || role === 'admin'

  const themes = useMemo(() => optionsOf(entries, (e) => splitLabels(e.theme)), [entries])
  const skills = useMemo(() => optionsOf(entries, (e) => e.skills), [entries])
  const formats = useMemo(() => optionsOf(entries, (e) => splitLabels(e.format)), [entries])
  const ages = useMemo(() => optionsOf(entries, (e) => splitLabels(e.ageBand)), [entries])

  const list = useMemo(
    () =>
      entries.filter((e) => {
        if (theme && !splitLabels(e.theme).includes(theme)) return false
        if (skill && !e.skills.includes(skill)) return false
        if (format && !splitLabels(e.format).includes(format)) return false
        if (age && !splitLabels(e.ageBand).includes(age)) return false
        if (kind && e.kind !== kind) return false
        if (q) {
          const hay = `${e.title} ${e.summary} ${e.theme} ${e.skills.join(' ')}`.toLowerCase()
          if (!hay.includes(q.toLowerCase())) return false
        }
        return true
      }),
    [entries, theme, skill, format, age, kind, q],
  )

  const lastSynced = useMemo(() => entries.reduce<string | null>((a, e) => (e.syncedAt && (!a || e.syncedAt > a) ? e.syncedAt : a), null), [entries])

  // One import for both the single button and the bulk queue: the same
  // smart importer a pasted URL uses, then the entry is marked with what it
  // became so the badge shows without a re-sync.
  const importOne = async (e: FaCatalogueEntry) => {
    const result = await importFA.mutateAsync({ url: e.url })
    const ref = result.kind === 'programme' ? result.programme.programmeId : result.session.templateId
    if (ref) {
      try {
        await mark.mutateAsync({ id: e.id, ref, kind: result.kind })
      } catch {
        // the import itself succeeded; the next sync reconciles the badge
      }
    }
  }

  const importSingle = (e: FaCatalogueEntry) => {
    setStatuses((s) => ({ ...s, [e.id]: { state: 'importing', detail: '' } }))
    importOne(e)
      .then(() => setStatuses((s) => ({ ...s, [e.id]: { state: 'imported', detail: '' } })))
      .catch((err: unknown) =>
        setStatuses((s) => ({ ...s, [e.id]: { state: 'failed', detail: err instanceof Error ? err.message : 'Import failed.' } })),
      )
  }

  const toggleSelected = (id: string) =>
    setSelected((prev) => {
      const out = new Set(prev)
      if (out.has(id)) out.delete(id)
      else out.add(id)
      return out
    })

  const bulkEntries = list.filter((e) => selected.has(e.id) && !e.importedRef)

  if (isLoading) return <Loading />
  if (isError) return <ErrorNote />

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Browse England Football</h2>
          <div className="sub">The England Football Learning session catalogue, synced on demand. Import what you need.</div>
        </div>
        {coaching && (
          <div className="row wrap">
            {entries.length > 0 && (
              <button
                className="btn btn-ghost"
                onClick={() => {
                  setSelectMode((v) => !v)
                  setSelected(new Set())
                }}
              >
                <Icon.check />
                {selectMode ? 'Cancel select' : 'Select'}
              </button>
            )}
            <button
              className="btn btn-primary"
              onClick={() => {
                setSyncError(null)
                sync.mutate(undefined, { onError: (e) => setSyncError(e.message) })
              }}
              disabled={sync.isPending}
            >
              <Icon.rotate />
              {sync.isPending ? 'Syncing…' : 'Sync catalogue'}
            </button>
          </div>
        )}
      </div>

      <div className="row wrap" style={{ gap: 8, marginBottom: 14 }}>
        <span className="muted" style={{ fontSize: 12.5, fontWeight: 600 }}>
          {fmtSynced(lastSynced)}
        </span>
        {syncError && (
          <span className="muted" style={{ color: 'var(--m-pdf)', fontSize: 12.5 }}>
            {syncError}
          </span>
        )}
      </div>

      {entries.length === 0 ? (
        <Empty icon={Icon.download} title="Nothing synced yet">
          {coaching
            ? 'Sync the catalogue to browse the England Football Learning sessions listing: titles, summaries and filters only, nothing stored until you import.'
            : 'Nothing here yet. The catalogue appears once a coach syncs it.'}
        </Empty>
      ) : (
        <>
          <div className="filterbar">
            <div className="filter-row">
              <div className="search-lg">
                <Icon.search />
                <input placeholder="Search the catalogue…" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
              <select className="select" value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="">All kinds</option>
                <option value="programme">Programmes</option>
                <option value="session">Sessions</option>
              </select>
              <select className="select" value={theme} onChange={(e) => setTheme(e.target.value)}>
                <option value="">All themes</option>
                {themes.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <select className="select" value={skill} onChange={(e) => setSkill(e.target.value)}>
                <option value="">All skills</option>
                {skills.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <select className="select" value={age} onChange={(e) => setAge(e.target.value)}>
                <option value="">All ages</option>
                {ages.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <select className="select" value={format} onChange={(e) => setFormat(e.target.value)}>
                <option value="">All formats</option>
                {formats.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="muted" style={{ fontSize: 12.5, fontWeight: 600, margin: '12px 0' }}>
            {list.length} of {entries.length} resources
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(290px,1fr))', gap: 18 }}>
            {list.map((e) => (
              <EntryCard
                key={e.id}
                e={e}
                coaching={coaching}
                selectMode={selectMode}
                selected={selected.has(e.id)}
                onToggle={() => toggleSelected(e.id)}
                status={statuses[e.id] ?? null}
                onImport={() => importSingle(e)}
                nav={nav}
              />
            ))}
          </div>
        </>
      )}

      {selectMode && (
        <div
          className="card row"
          style={{
            position: 'sticky',
            bottom: 12,
            marginTop: 16,
            padding: '12px 16px',
            gap: 10,
            boxShadow: '0 8px 28px rgba(0,0,0,.16)',
          }}
        >
          <span style={{ flex: 1, fontWeight: 800, fontSize: 14 }}>
            {bulkEntries.length} selected{selected.size > bulkEntries.length ? ' (already imported entries are skipped)' : ''}
          </span>
          <button className="btn btn-primary" disabled={bulkEntries.length === 0} onClick={() => setBulkOpen(true)}>
            <Icon.download />
            Import selected
          </button>
        </div>
      )}

      {bulkOpen && (
        <BulkImportModal
          entries={bulkEntries}
          importOne={importOne}
          onClose={() => {
            setBulkOpen(false)
            setSelectMode(false)
            setSelected(new Set())
          }}
        />
      )}
    </div>
  )
}
