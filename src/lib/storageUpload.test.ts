import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the Supabase client so no real client constructs and the upload carries a
// known token. The helper only reads the current session's access token.
vi.mock('./supabase', () => ({
  supabase: {
    auth: { getSession: vi.fn(async () => ({ data: { session: { access_token: 'user-jwt' } } })) },
  },
}))

import { uploadFileWithProgress } from './storageUpload'

type ProgressEventLike = { lengthComputable: boolean; loaded: number; total: number }

// A minimal XMLHttpRequest stand in: the helper uses XHR for upload progress,
// which Node has no implementation of, so a fake records the request and lets a
// test drive the progress, load, error and abort events by hand.
class FakeXHR {
  static instances: FakeXHR[] = []
  method = ''
  url = ''
  headers: Record<string, string> = {}
  body: unknown = null
  status = 0
  statusText = ''
  responseText = ''
  upload: { onprogress: ((e: ProgressEventLike) => void) | null } = { onprogress: null }
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  onabort: (() => void) | null = null

  constructor() {
    FakeXHR.instances.push(this)
  }
  open(method: string, url: string) {
    this.method = method
    this.url = url
  }
  setRequestHeader(key: string, value: string) {
    this.headers[key] = value
  }
  send(body: unknown) {
    this.body = body
  }
  emitProgress(loaded: number, total: number) {
    this.upload.onprogress?.({ lengthComputable: true, loaded, total })
  }
  finish(status: number, responseText = '', statusText = '') {
    this.status = status
    this.responseText = responseText
    this.statusText = statusText
    this.onload?.()
  }
}

const ORIGINAL_XHR = globalThis.XMLHttpRequest

beforeEach(() => {
  FakeXHR.instances = []
  globalThis.XMLHttpRequest = FakeXHR as unknown as typeof XMLHttpRequest
})

afterEach(() => {
  vi.clearAllMocks()
  globalThis.XMLHttpRequest = ORIGINAL_XHR
})

function fakeFile(name = 'clip.mp4', type = 'video/mp4'): File {
  return new File(['payload'], name, { type })
}

// The helper awaits getSession before opening the request, so the fake is not
// created synchronously; wait for it.
async function nextXHR(): Promise<FakeXHR> {
  return vi.waitFor(() => {
    const xhr = FakeXHR.instances[0]
    if (!xhr) throw new Error('no request yet')
    return xhr
  })
}

describe('uploadFileWithProgress', () => {
  it('posts a multipart body to the object endpoint with the user JWT and no overwrite', async () => {
    const promise = uploadFileWithProgress('media', 'club-1/abc-clip.mp4', fakeFile(), {})
    const xhr = await nextXHR()
    xhr.finish(200, '{"Key":"media/club-1/abc-clip.mp4"}')
    const result = await promise

    expect(result.error).toBeNull()
    expect(xhr.method).toBe('POST')
    expect(xhr.url).toBe('http://localhost/storage/v1/object/media/club-1/abc-clip.mp4')
    expect(xhr.headers.apikey).toBe('test-anon-key')
    expect(xhr.headers.Authorization).toBe('Bearer user-jwt')
    expect(xhr.headers['x-upsert']).toBe('false')
    // Content-Type is left to the browser so the multipart boundary is set.
    expect(xhr.headers['Content-Type']).toBeUndefined()
    expect(xhr.body).toBeInstanceOf(FormData)
    const form = xhr.body as FormData
    expect(form.get('cacheControl')).toBe('3600')
    expect(form.has('')).toBe(true)
    expect((form.get('') as File).name).toBe('clip.mp4')
  })

  it('reports real byte progress as the upload runs', async () => {
    const onProgress = vi.fn()
    const promise = uploadFileWithProgress('media', 'club-1/x.mp4', fakeFile(), { onProgress })
    const xhr = await nextXHR()
    xhr.emitProgress(40, 100)
    xhr.emitProgress(100, 100)
    xhr.finish(200, '{}')
    await promise

    expect(onProgress).toHaveBeenCalledWith(40, 100)
    expect(onProgress).toHaveBeenCalledWith(100, 100)
  })

  it('returns the storage error message on a rejected upload, never throwing', async () => {
    const promise = uploadFileWithProgress('media', 'club-1/x.mp4', fakeFile(), {})
    const xhr = await nextXHR()
    xhr.finish(413, '{"message":"The object exceeded the maximum allowed size"}', 'Payload Too Large')
    const result = await promise

    expect(result.error).not.toBeNull()
    expect(result.error?.message).toBe('The object exceeded the maximum allowed size')
  })

  it('reports a network interruption as an error result rather than rejecting', async () => {
    const promise = uploadFileWithProgress('media', 'club-1/x.mp4', fakeFile(), {})
    const xhr = await nextXHR()
    xhr.onerror?.()
    const result = await promise

    expect(result.error?.message).toContain('network')
  })
})
