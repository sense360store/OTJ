import { describe, expect, it } from 'vitest'
import {
  mergeManifests,
  parseManifest,
  planAttach,
  vimeoIdFromEmbedUrl,
  vimeoIdFromFilename,
  isManifestFile,
  type AttachTarget,
} from './faAttach'

// The goalkeeping session from the import fixtures: three FA video drills in
// page order, each media row carrying the Vimeo player URL the import built
// and the session page as its source.
const GK_URL = 'https://learn.englandfootball.com/sessions/resources/2022/Goalkeeping-session-the-basics'

function target(over: Partial<AttachTarget> & { id: string }): AttachTarget {
  return {
    name: 'Goalkeeping session: the basics',
    type: 'video',
    storagePath: undefined,
    embedUrl: undefined,
    sourceUrl: GK_URL,
    ...over,
  }
}

const gkRows: AttachTarget[] = [
  target({
    id: 'm1',
    name: 'Goalkeeping session: the basics · Warm up',
    embedUrl: 'https://player.vimeo.com/video/129532422',
  }),
  target({
    id: 'm2',
    name: 'Goalkeeping session: the basics · Shot-stopping 1',
    embedUrl: 'https://player.vimeo.com/video/129532424',
  }),
  target({
    id: 'm3',
    name: 'Goalkeeping session: the basics · Shot-stopping 2',
    embedUrl: 'https://player.vimeo.com/video/129532425',
  }),
]

const MAX = 50 * 1024 * 1024

function file(name: string, size = 1024) {
  return { name, size }
}

function plan(files: { name: string; size: number }[], media: AttachTarget[] = gkRows, manifest?: ReturnType<typeof parseManifest>) {
  return planAttach(files, media, { maxBytes: MAX, manifest })
}

describe('vimeoIdFromEmbedUrl', () => {
  it('reads the id from the player URL the import stores', () => {
    expect(vimeoIdFromEmbedUrl('https://player.vimeo.com/video/129532422')).toBe('129532422')
    expect(vimeoIdFromEmbedUrl('https://player.vimeo.com/video/129532422/')).toBe('129532422')
  })

  it('trusts only the https player host and the numeric shape', () => {
    expect(vimeoIdFromEmbedUrl('https://vimeo.com/129532422')).toBeNull()
    expect(vimeoIdFromEmbedUrl('http://player.vimeo.com/video/129532422')).toBeNull()
    expect(vimeoIdFromEmbedUrl('https://player.vimeo.com/video/abc')).toBeNull()
    expect(vimeoIdFromEmbedUrl('not a url')).toBeNull()
    expect(vimeoIdFromEmbedUrl(null)).toBeNull()
    expect(vimeoIdFromEmbedUrl(undefined)).toBeNull()
  })
})

describe('vimeoIdFromFilename', () => {
  it('reads an id named file', () => {
    expect(vimeoIdFromFilename('129532422.mp4')).toBe('129532422')
    expect(vimeoIdFromFilename('129532422.MP4')).toBe('129532422')
  })

  it('returns null unless the stem is the id alone', () => {
    expect(vimeoIdFromFilename('goalkeeping-1.mp4')).toBeNull()
    expect(vimeoIdFromFilename('129532422 (1).mp4')).toBeNull()
    expect(vimeoIdFromFilename('warm-up.mp4')).toBeNull()
  })
})

describe('isManifestFile', () => {
  it('treats json, csv and txt as manifests and mp4 as video', () => {
    expect(isManifestFile('manifest.csv')).toBe(true)
    expect(isManifestFile('files.JSON')).toBe(true)
    expect(isManifestFile('notes.txt')).toBe(true)
    expect(isManifestFile('129532422.mp4')).toBe(false)
  })
})

describe('parseManifest', () => {
  it('reads a JSON object of filename to id, numbers included', () => {
    const m = parseManifest('{"warm-up.mp4": "129532422", "Part2.mp4": 129532424}', 'manifest.json')
    expect(m.entries.get('warm-up.mp4')).toBe('129532422')
    expect(m.entries.get('part2.mp4')).toBe('129532424')
    expect(m.warnings).toEqual([])
  })

  it('reads a JSON array of { file, id } entries', () => {
    const m = parseManifest('[{"file": "warm-up.mp4", "id": "129532422"}]', 'manifest.json')
    expect(m.entries.get('warm-up.mp4')).toBe('129532422')
  })

  it('reads plain lines either way round, skipping blanks and comments', () => {
    const m = parseManifest(
      ['# the goalkeeping session', '', 'warm-up.mp4,129532422', '129532424\tshots-1.mp4'].join('\n'),
      'manifest.csv',
    )
    expect(m.entries.get('warm-up.mp4')).toBe('129532422')
    expect(m.entries.get('shots-1.mp4')).toBe('129532424')
    expect(m.warnings).toEqual([])
  })

  it('warns on a line it cannot read instead of guessing', () => {
    const m = parseManifest('filename,id\nwarm-up.mp4,129532422', 'manifest.csv')
    expect(m.entries.size).toBe(1)
    expect(m.warnings).toHaveLength(1)
  })

  it('warns on a non numeric id', () => {
    const m = parseManifest('{"warm-up.mp4": "not-an-id"}', 'manifest.json')
    expect(m.entries.size).toBe(0)
    expect(m.warnings).toHaveLength(1)
  })

  it('drops a filename listed with two different ids', () => {
    const m = parseManifest('warm-up.mp4,129532422\nWarm-Up.mp4,129532424', 'manifest.csv')
    expect(m.entries.size).toBe(0)
    expect(m.warnings).toHaveLength(1)
  })

  it('warns on invalid JSON', () => {
    const m = parseManifest('{not json', 'manifest.json')
    expect(m.entries.size).toBe(0)
    expect(m.warnings).toHaveLength(1)
  })
})

describe('mergeManifests', () => {
  it('merges entries and drops a cross file conflict', () => {
    const a = parseManifest('warm-up.mp4,129532422\nshots.mp4,129532424', 'a.csv')
    const b = parseManifest('warm-up.mp4,999', 'b.csv')
    const merged = mergeManifests([a, b])
    expect(merged.entries.get('shots.mp4')).toBe('129532424')
    expect(merged.entries.has('warm-up.mp4')).toBe(false)
    expect(merged.warnings).toHaveLength(1)
  })
})

describe('planAttach, id matching', () => {
  it('stores id named files against the matching FA video rows', () => {
    const p = plan([file('129532422.mp4', 100), file('129532424.mp4', 200), file('129532425.mp4', 300)])
    expect(p.entries.map((e) => e.status)).toEqual(['store', 'store', 'store'])
    expect(p.entries.map((e) => e.mediaId)).toEqual(['m1', 'm2', 'm3'])
    expect(p.storeCount).toBe(3)
    expect(p.storeBytes).toBe(600)
  })

  it('matches through a manifest when files are not id named, the manifest winning over the filename', () => {
    const manifest = parseManifest('{"gk-warm-up.mp4": "129532422", "999.mp4": "129532425"}', 'manifest.json')
    const p = plan([file('gk-warm-up.mp4'), file('999.mp4')], gkRows, manifest)
    expect(p.entries[0]).toMatchObject({ status: 'store', mediaId: 'm1' })
    expect(p.entries[1]).toMatchObject({ status: 'store', mediaId: 'm3' })
  })

  it('reports a file with an unknown id as unmatched, stored nowhere', () => {
    const p = plan([file('111111.mp4')])
    expect(p.entries[0].status).toBe('unmatched')
    expect(p.entries[0].mediaId).toBeUndefined()
    expect(p.storeCount).toBe(0)
  })

  it('skips a row that already has a stored file, so re running changes nothing', () => {
    const stored = gkRows.map((r) => ({ ...r, storagePath: `club/${r.id}.mp4` }))
    const p = plan([file('129532422.mp4'), file('129532424.mp4'), file('129532425.mp4')], stored)
    expect(p.entries.map((e) => e.status)).toEqual(['skip', 'skip', 'skip'])
    expect(p.storeCount).toBe(0)
    expect(p.storeBytes).toBe(0)
  })

  it('does not let two files in one set claim the same row', () => {
    const p = plan([file('129532422.mp4'), file('129532422.mp4')])
    expect(p.entries[0].status).toBe('store')
    expect(p.entries[1].status).toBe('unmatched')
  })

  it('never matches a Vimeo embed that is not FA sourced', () => {
    const nonFa = target({
      id: 'x1',
      embedUrl: 'https://player.vimeo.com/video/777777',
      sourceUrl: 'https://vimeo.com/777777',
    })
    const p = plan([file('777777.mp4')], [...gkRows, nonFa])
    expect(p.entries[0].status).toBe('unmatched')
  })

  it('rejects files that are not MP4, and oversize files, before any matching', () => {
    const p = planAttach([file('129532422.mov'), file('129532424.mp4', 200)], gkRows, { maxBytes: 100 })
    expect(p.entries[0].status).toBe('rejected')
    expect(p.entries[1].status).toBe('rejected')
    expect(p.storeCount).toBe(0)
  })
})

describe('planAttach, session and part fallback', () => {
  it('matches by session slug and heading', () => {
    const p = plan([
      file('Goalkeeping-session-the-basics-Warm-up.mp4'),
      file('goalkeeping_session_the_basics_shot_stopping_2.mp4'),
    ])
    expect(p.entries[0]).toMatchObject({ status: 'store', mediaId: 'm1' })
    expect(p.entries[1]).toMatchObject({ status: 'store', mediaId: 'm3' })
  })

  it('falls back to part order within the session', () => {
    const p = plan([file('Goalkeeping-session-the-basics-part-2.mp4'), file('Goalkeeping-session-the-basics 3.mp4')])
    expect(p.entries[0]).toMatchObject({ status: 'store', mediaId: 'm2' })
    expect(p.entries[1]).toMatchObject({ status: 'store', mediaId: 'm3' })
  })

  it('restores creation order itself when the media list arrives newest first', () => {
    // The media read returns newest first, and part order is creation order.
    // planAttach owns that invariant: given the same rows reversed and dated,
    // part 1 still lands on the earliest row. The ids deliberately disagree
    // with the timestamps so an id fallback would fail this.
    const dated = [
      target({
        id: 'm9',
        name: 'Goalkeeping session: the basics · Warm up',
        embedUrl: 'https://player.vimeo.com/video/900000001',
        createdAt: '2026-05-01T10:00:00.000123+00:00',
      }),
      target({
        id: 'm5',
        name: 'Goalkeeping session: the basics · Shot-stopping 1',
        embedUrl: 'https://player.vimeo.com/video/900000002',
        createdAt: '2026-05-01T10:00:00.000456+00:00',
      }),
      target({
        id: 'm1',
        name: 'Goalkeeping session: the basics · Shot-stopping 2',
        embedUrl: 'https://player.vimeo.com/video/900000003',
        createdAt: '2026-05-01T10:00:00.000789+00:00',
      }),
    ]
    const p = plan(
      [file('Goalkeeping-session-the-basics-part-1.mp4'), file('Goalkeeping-session-the-basics-part-3.mp4')],
      [...dated].reverse(),
    )
    expect(p.entries[0]).toMatchObject({ status: 'store', mediaId: 'm9' })
    expect(p.entries[1]).toMatchObject({ status: 'store', mediaId: 'm1' })
  })

  it('matches a unique heading even without the session slug', () => {
    const p = plan([file('warm-up.mp4')])
    expect(p.entries[0]).toMatchObject({ status: 'store', mediaId: 'm1' })
  })

  it('reports a session named file with no part indication as unmatched', () => {
    const p = plan([file('Goalkeeping-session-the-basics.mp4')])
    expect(p.entries[0].status).toBe('unmatched')
  })

  it('reports an out of range part as unmatched', () => {
    const p = plan([file('Goalkeeping-session-the-basics-part-7.mp4')])
    expect(p.entries[0].status).toBe('unmatched')
  })

  it('matches a single video session by its session name alone', () => {
    const one = [
      target({
        id: 's1',
        name: 'Passing session: into space',
        sourceUrl: 'https://learn.englandfootball.com/sessions/resources/2023/Passing-session-into-space',
        embedUrl: 'https://player.vimeo.com/video/555555',
      }),
    ]
    const p = plan([file('Passing-session-into-space.mp4')], one)
    expect(p.entries[0]).toMatchObject({ status: 'store', mediaId: 's1' })
  })

  it('reports an ambiguous heading as unmatched rather than guessing', () => {
    const other = target({
      id: 'o1',
      name: 'Another session · Warm up',
      sourceUrl: 'https://learn.englandfootball.com/sessions/resources/2024/Another-session',
      embedUrl: 'https://player.vimeo.com/video/888888',
    })
    const p = plan([file('warm-up.mp4')], [...gkRows, other])
    expect(p.entries[0].status).toBe('unmatched')
  })

  it('does not let a heading match on a word boundary overrun', () => {
    // "shot stopping 1" must not match a file about part 12.
    const p = plan([file('goalkeeping-session-the-basics-shot-stopping-12.mp4')])
    expect(p.entries[0].status).toBe('unmatched')
  })

  it('never reads a year as a part number', () => {
    const p = plan([file('Goalkeeping-session-the-basics-2022.mp4')])
    expect(p.entries[0].status).toBe('unmatched')
  })
})
