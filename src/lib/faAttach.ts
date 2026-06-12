// Matching for the FA video source file pipeline. The FA supplies the
// licensed source MP4s behind imported video sessions in bulk; each file is
// matched to the FA video media row the import created and stored against
// it, which flips playback from the link out fallback to the inline player.
// The stable join key is the Vimeo numeric id already on the media row
// (embed_url = https://player.vimeo.com/video/<id>): files are named by id,
// or a manifest lists file to id, with a session and part fallback for files
// named by session instead. Matching never guesses: anything ambiguous is
// reported unmatched, not stored. Nothing here fetches from Vimeo; the only
// source of bytes is the files the user supplies. See CLAUDE.md, Third-party
// content. The upload and row update live in useAttachFAVideoFiles in
// queries.ts; everything in this module is pure and synchronous.
import type { MediaItem } from './data'
import { isFaVideo } from './fa'

// ---- Vimeo ids -----------------------------------------------------------

const VIMEO_PLAYER_HOST = 'player.vimeo.com'

// The Vimeo numeric id on an FA video media row, read from the player URL
// the import stored. Null for any other host or shape: the id is trusted
// only from our own row, never read back out of Vimeo.
export function vimeoIdFromEmbedUrl(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:' || u.hostname.toLowerCase() !== VIMEO_PLAYER_HOST) return null
    const m = u.pathname.match(/^\/video\/(\d+)\/?$/)
    return m ? m[1] : null
  } catch {
    return null
  }
}

// The Vimeo id a filename carries: the stem must be the id alone
// (129532422.mp4). Anything else returns null and falls to the manifest or
// the session and part fallback.
export function vimeoIdFromFilename(name: string): string | null {
  const stem = name.replace(/\.[^.]+$/, '').trim()
  return /^\d+$/.test(stem) ? stem : null
}

// ---- Manifests -------------------------------------------------------------
// When the supplied files are not id named, a manifest picked alongside them
// maps filename to Vimeo id. Two shapes are read: JSON (an object of filename
// to id, or an array of { file, id }) and plain lines (filename and id
// separated by a comma, tab or semicolon, either way round; the all digits
// field is the id). Filenames compare case insensitively. A filename listed
// with two different ids is dropped with a warning rather than guessed at.

export interface ParsedManifest {
  // Lowercased filename to Vimeo id.
  entries: Map<string, string>
  warnings: string[]
}

export function isManifestFile(name: string): boolean {
  return /\.(json|csv|txt)$/i.test(name)
}

function addManifestEntry(out: ParsedManifest, conflicted: Set<string>, file: string, id: string, source: string) {
  const key = file.trim().toLowerCase()
  if (!key) return
  if (!/^\d+$/.test(id)) {
    out.warnings.push(`${source}: "${file}" maps to "${id}", which is not a Vimeo id.`)
    return
  }
  if (conflicted.has(key)) return
  const existing = out.entries.get(key)
  if (existing && existing !== id) {
    out.entries.delete(key)
    conflicted.add(key)
    out.warnings.push(`${source}: "${file}" is listed with more than one id, so it is ignored.`)
    return
  }
  out.entries.set(key, id)
}

export function parseManifest(text: string, source: string): ParsedManifest {
  const out: ParsedManifest = { entries: new Map(), warnings: [] }
  const conflicted = new Set<string>()
  const trimmed = text.trim()

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      out.warnings.push(`${source} is not valid JSON.`)
      return out
    }
    if (Array.isArray(parsed)) {
      for (const row of parsed) {
        const entry = row as { file?: unknown; id?: unknown } | null
        if (entry && typeof entry === 'object' && typeof entry.file === 'string' && (typeof entry.id === 'string' || typeof entry.id === 'number')) {
          addManifestEntry(out, conflicted, entry.file, String(entry.id), source)
        } else {
          out.warnings.push(`${source}: an entry is not of the { "file": …, "id": … } shape.`)
        }
      }
    } else if (parsed && typeof parsed === 'object') {
      for (const [file, id] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof id === 'string' || typeof id === 'number') addManifestEntry(out, conflicted, file, String(id), source)
        else out.warnings.push(`${source}: "${file}" has no usable id.`)
      }
    } else {
      out.warnings.push(`${source} is not a JSON object or array.`)
    }
    return out
  }

  // Plain lines. Blank lines and # comments are ignored; each remaining line
  // names a file and an id, either way round.
  for (const rawLine of trimmed.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const fields = line
      .split(/[\t;,]/)
      .map((f) => f.trim())
      .filter(Boolean)
    const ids = fields.filter((f) => /^\d+$/.test(f))
    const names = fields.filter((f) => !/^\d+$/.test(f))
    if (fields.length !== 2 || ids.length !== 1 || names.length !== 1) {
      out.warnings.push(`${source}: could not read the line "${line}".`)
      continue
    }
    addManifestEntry(out, conflicted, names[0], ids[0], source)
  }
  return out
}

// Several manifest files picked together act as one. A filename listed in
// two of them with different ids is dropped with a warning, like a conflict
// inside one file.
export function mergeManifests(manifests: ParsedManifest[]): ParsedManifest {
  const out: ParsedManifest = { entries: new Map(), warnings: [] }
  const conflicted = new Set<string>()
  for (const m of manifests) {
    out.warnings.push(...m.warnings)
    for (const [file, id] of m.entries) addManifestEntry(out, conflicted, file, id, 'The manifests')
  }
  return out
}

// ---- The plan --------------------------------------------------------------
// planAttach resolves every picked file to an outcome before any bytes move:
// store (matched to an FA video row with no stored file), skip (the matched
// row already has one), unmatched (no row resolved without guessing) or
// rejected (not an MP4, or over the size cap). useAttachFAVideoFiles then
// executes only the store entries, so the user sees exactly what a bulk
// attach will do, and what it will cost, before confirming.

// The shape a browser File satisfies; tests use plain objects.
export interface AttachFile {
  name: string
  size: number
}

export type AttachPlanStatus = 'store' | 'skip' | 'unmatched' | 'rejected'

export interface AttachPlanEntry<F extends AttachFile = AttachFile> {
  file: F
  status: AttachPlanStatus
  // The resolved media row, present on store and skip entries.
  mediaId?: string
  mediaName?: string
  // Why the entry has its status, one plain sentence for the report.
  reason: string
}

export interface AttachPlan<F extends AttachFile = AttachFile> {
  entries: AttachPlanEntry<F>[]
  // Manifest problems, surfaced ahead of the per file lines.
  warnings: string[]
  // The files that will upload, and their total size, for the cost summary.
  storeCount: number
  storeBytes: number
}

// The columns the matcher needs from a media row.
export type AttachTarget = Pick<MediaItem, 'id' | 'name' | 'type' | 'storagePath' | 'embedUrl' | 'sourceUrl'>

// MP4 only (m4v is the same container). H.264 video with AAC audio plays in
// every browser; another container or codec is a transcoding decision taken
// elsewhere, not smuggled in here.
const MP4_EXTENSIONS = /\.(mp4|m4v)$/i

// Bytes as a short human figure, for the size cap message and the cost
// summary the modal shows before a bulk attach.
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i++
  }
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[i]}`
}

// Lowercased words: "Shot-stopping 1" and "Shot_stopping-1" both reduce to
// "shot stopping 1", so naming variants meet in the middle.
function normalise(s: string): string {
  return s
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

// Whole word containment, so the heading "Shot-stopping 1" never matches a
// file named shot stopping 12.
function containsWords(haystack: string, needle: string): boolean {
  return needle !== '' && ` ${haystack} `.includes(` ${needle} `)
}

function fileStem(name: string): string {
  return normalise(name.replace(/\.[^.]+$/, ''))
}

// The per video heading the import recorded in the row name, after the page
// title separator; '' for a single unnamed video, which keeps the bare title.
function headingOf(name: string): string {
  const at = name.indexOf(' · ')
  return at === -1 ? '' : normalise(name.slice(at + 3))
}

// The last path segment of the session page URL: the slug a session named
// file is expected to carry.
function sessionSlug(sourceUrl: string | undefined): string {
  if (!sourceUrl) return ''
  try {
    const segments = new URL(sourceUrl).pathname.split('/').filter(Boolean)
    return normalise(segments[segments.length - 1] ?? '')
  } catch {
    return ''
  }
}

// The part number a filename names: the token after "part", or the final
// token. Only one or two digit values count, so a year in a filename can
// never read as a part.
function partNumber(stem: string): number | null {
  const tokens = stem.split(' ')
  const at = tokens.indexOf('part')
  const candidate = at !== -1 && at + 1 < tokens.length ? tokens[at + 1] : tokens[tokens.length - 1]
  return /^\d{1,2}$/.test(candidate) ? parseInt(candidate, 10) : null
}

interface SessionGroup {
  slug: string
  rows: AttachTarget[]
}

export function planAttach<F extends AttachFile>(
  files: F[],
  media: AttachTarget[],
  options: { maxBytes: number; manifest?: ParsedManifest },
): AttachPlan<F> {
  // Only FA video rows are targets; uploaded clips, YouTube links and non FA
  // embeds never take a file from this pipeline.
  const targets = media.filter((m) => isFaVideo(m))

  const byVimeoId = new Map<string, AttachTarget>()
  for (const t of targets) {
    const id = vimeoIdFromEmbedUrl(t.embedUrl)
    if (id && !byVimeoId.has(id)) byVimeoId.set(id, t)
  }

  // Session groups for the fallback, keyed by source page. Rows keep the
  // given order: the import wrote the parts in page order and the media read
  // returns creation order, so position is part order.
  const sessions = new Map<string, SessionGroup>()
  for (const t of targets) {
    if (!t.sourceUrl) continue
    const group = sessions.get(t.sourceUrl) ?? { slug: sessionSlug(t.sourceUrl), rows: [] }
    group.rows.push(t)
    sessions.set(t.sourceUrl, group)
  }

  const manifest = options.manifest
  const claimed = new Set<string>()

  // Idempotence and no duplication: a target that already has a stored file
  // is skipped, and a target another file in this set has claimed is not
  // claimed twice.
  const claim = (file: F, target: AttachTarget, how: string): AttachPlanEntry<F> => {
    if (target.storagePath) {
      return { file, status: 'skip', mediaId: target.id, mediaName: target.name, reason: 'Already has a stored file.' }
    }
    if (claimed.has(target.id)) {
      return { file, status: 'unmatched', reason: `Another file in this set already matched "${target.name}".` }
    }
    claimed.add(target.id)
    return { file, status: 'store', mediaId: target.id, mediaName: target.name, reason: how }
  }

  // The session and part fallback, used only when no Vimeo id is available
  // for the file. Every branch either resolves one row deterministically or
  // reports the file unmatched; nothing is guessed.
  const sessionPartMatch = (file: F): AttachPlanEntry<F> => {
    const stem = fileStem(file.name)

    const inName = [...sessions.values()].filter((s) => containsWords(stem, s.slug))
    if (inName.length > 1) {
      return { file, status: 'unmatched', reason: 'The filename names more than one imported session.' }
    }

    if (inName.length === 0) {
      // No session in the name. A heading match is still deterministic when
      // exactly one imported FA video carries that heading.
      const byHeading = targets.filter((t) => containsWords(stem, headingOf(t.name)))
      if (byHeading.length === 1) return claim(file, byHeading[0], 'Matched by its heading.')
      return {
        file,
        status: 'unmatched',
        reason:
          byHeading.length === 0
            ? 'No imported FA video matches this filename. Name files by Vimeo id, or supply a manifest.'
            : 'The filename matches more than one imported FA video.',
      }
    }

    const session = inName[0]
    const byHeading = session.rows.filter((t) => containsWords(stem, headingOf(t.name)))
    if (byHeading.length === 1) return claim(file, byHeading[0], 'Matched by session and heading.')
    if (byHeading.length > 1) {
      return { file, status: 'unmatched', reason: 'The filename matches more than one part of this session.' }
    }

    const part = partNumber(stem)
    if (part != null && part >= 1 && part <= session.rows.length) {
      return claim(file, session.rows[part - 1], `Matched by session and part order (part ${part}).`)
    }
    if (part == null && session.rows.length === 1) {
      return claim(file, session.rows[0], 'Matched by session name (its only video).')
    }
    return {
      file,
      status: 'unmatched',
      reason:
        part == null
          ? 'The filename names the session but not which part.'
          : `The session has ${session.rows.length} video${session.rows.length === 1 ? '' : 's'}, so part ${part} does not match.`,
    }
  }

  const resolve = (file: F): AttachPlanEntry<F> => {
    if (!MP4_EXTENSIONS.test(file.name)) {
      return { file, status: 'rejected', reason: 'Only MP4 files are accepted.' }
    }
    if (file.size > options.maxBytes) {
      return {
        file,
        status: 'rejected',
        reason: `This file is ${formatBytes(file.size)} and the limit is ${formatBytes(options.maxBytes)}.`,
      }
    }

    // The manifest is explicit, so it wins over the filename.
    const manifestId = manifest?.entries.get(file.name.trim().toLowerCase()) ?? null
    const id = manifestId ?? vimeoIdFromFilename(file.name)
    if (id) {
      const target = byVimeoId.get(id)
      if (!target) return { file, status: 'unmatched', reason: `No imported FA video has Vimeo id ${id}.` }
      return claim(file, target, `Vimeo id ${id}${manifestId ? ', from the manifest' : ''}.`)
    }

    return sessionPartMatch(file)
  }

  const entries = files.map(resolve)
  const stores = entries.filter((e) => e.status === 'store')
  return {
    entries,
    warnings: [...(manifest?.warnings ?? [])],
    storeCount: stores.length,
    storeBytes: stores.reduce((sum, e) => sum + e.file.size, 0),
  }
}
