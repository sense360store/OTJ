import { describe, expect, it } from 'vitest'
import {
  currentSetupPath,
  SESSION_SETUP_SEGMENT,
  sessionSetupFolder,
  sessionSetupUploadPath,
  setupImageProblem,
} from './queries'

// The session setup photo is a storage object with no media row and no
// session column: found by listing {club_id}/session-setup/{session_id}/,
// the avatar precedent applied to a session. These pin the pure pieces the
// hooks are built from: the folder and upload path shapes (which the 0027
// storage policies key on), the newest-object selection, and the client
// side file checks.

const CLUB = 'c0000000-0000-0000-0000-000000000001'
const SESSION = 's0000000-0000-0000-0000-000000000002'

function fakeFile(name: string, type: string, size = 1024): File {
  return { name, type, size } as unknown as File
}

describe('sessionSetupFolder', () => {
  it('builds the club prefixed folder the storage policies key on', () => {
    expect(sessionSetupFolder(CLUB, SESSION)).toBe(`${CLUB}/${SESSION_SETUP_SEGMENT}/${SESSION}`)
  })

  it('keeps the club id as the first segment and session-setup as the second', () => {
    // The 0027 storage policies key on exactly these two facts: the first
    // folder names the owning club, and the second is not the reserved crest
    // segment, so the club media insert and select arms apply unchanged.
    const parts = sessionSetupFolder(CLUB, SESSION).split('/')
    expect(parts[0]).toBe(CLUB)
    expect(parts[1]).toBe('session-setup')
  })
})

describe('sessionSetupUploadPath', () => {
  it('mints a fresh random name inside the session folder with the sanitised filename', () => {
    const path = sessionSetupUploadPath(CLUB, SESSION, 'Pitch Plan.JPG')
    expect(path.startsWith(`${sessionSetupFolder(CLUB, SESSION)}/`)).toBe(true)
    const leaf = path.slice(sessionSetupFolder(CLUB, SESSION).length + 1)
    expect(leaf).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-pitch-plan\.jpg$/)
  })

  it('two uploads of the same file never collide', () => {
    const a = sessionSetupUploadPath(CLUB, SESSION, 'setup.png')
    const b = sessionSetupUploadPath(CLUB, SESSION, 'setup.png')
    expect(a).not.toBe(b)
  })
})

describe('currentSetupPath', () => {
  const folder = sessionSetupFolder(CLUB, SESSION)

  it('an empty folder has no photo', () => {
    expect(currentSetupPath(folder, [])).toBeNull()
  })

  it('placeholder dot files are not photos', () => {
    expect(currentSetupPath(folder, [{ name: '.emptyFolderPlaceholder' }])).toBeNull()
  })

  it('one object resolves to its full path', () => {
    expect(currentSetupPath(folder, [{ name: 'abc-setup.jpg', created_at: '2026-08-01T10:00:00Z' }])).toBe(
      `${folder}/abc-setup.jpg`,
    )
  })

  it('the newest object wins when a replace left more than one behind', () => {
    const entries = [
      { name: 'old-setup.jpg', created_at: '2026-08-01T10:00:00Z' },
      { name: 'new-setup.jpg', created_at: '2026-08-02T10:00:00Z' },
      { name: '.emptyFolderPlaceholder' },
    ]
    expect(currentSetupPath(folder, entries)).toBe(`${folder}/new-setup.jpg`)
    // Order of the listing does not matter.
    expect(currentSetupPath(folder, [...entries].reverse())).toBe(`${folder}/new-setup.jpg`)
  })

  it('an entry with a timestamp beats one without', () => {
    const entries = [{ name: 'undated.jpg' }, { name: 'dated.jpg', created_at: '2026-08-02T10:00:00Z' }]
    expect(currentSetupPath(folder, entries)).toBe(`${folder}/dated.jpg`)
  })

  it('a timestamp tie breaks deterministically by name', () => {
    const entries = [
      { name: 'a.jpg', created_at: '2026-08-02T10:00:00Z' },
      { name: 'b.jpg', created_at: '2026-08-02T10:00:00Z' },
    ]
    expect(currentSetupPath(folder, entries)).toBe(`${folder}/b.jpg`)
    expect(currentSetupPath(folder, [...entries].reverse())).toBe(`${folder}/b.jpg`)
  })
})

describe('setupImageProblem', () => {
  it('accepts an ordinary image', () => {
    expect(setupImageProblem(fakeFile('setup.jpg', 'image/jpeg'))).toBeNull()
  })

  it('accepts an image identified by extension when the picker gives no type', () => {
    expect(setupImageProblem(fakeFile('setup.jpg', ''))).toBeNull()
  })

  it('refuses a non image', () => {
    expect(setupImageProblem(fakeFile('plan.pdf', 'application/pdf'))).toBe('Choose an image file.')
    expect(setupImageProblem(fakeFile('clip.mp4', 'video/mp4'))).toBe('Choose an image file.')
  })

  it('refuses an oversized image with the standard size message', () => {
    const problem = setupImageProblem(fakeFile('huge.png', 'image/png', 600 * 1024 * 1024))
    expect(problem).toContain('upload limit')
  })
})
