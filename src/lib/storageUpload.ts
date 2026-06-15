import { supabase } from './supabase'

// The Supabase JS SDK uploads files through fetch, which cannot report upload
// progress in the browser, so a large file looks frozen with no feedback. This
// helper sends the same request over XMLHttpRequest, whose upload object does
// emit progress events, and reports real byte progress. It is a deliberate,
// narrow replacement for supabase.storage.from(bucket).upload(path, file): it
// posts to the same REST endpoint, with the same auth headers and the same
// multipart body the SDK builds, so storage Row-Level Security still decides
// access exactly as before. Nothing here loosens a policy or touches the data
// boundary. See src/lib/supabase.ts.

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string

export type UploadProgressFn = (loaded: number, total: number) => void

// Mirrors the { error } half of the SDK's upload result so callers keep their
// existing "if (error) throw" handling unchanged.
export interface UploadResult {
  error: { message: string } | null
}

function storageErrorMessage(xhr: XMLHttpRequest): string {
  try {
    const body = JSON.parse(xhr.responseText) as { message?: string; error?: string }
    if (body.message) return body.message
    if (body.error) return body.error
  } catch {
    // The body was not JSON; fall through to a status based message.
  }
  return xhr.statusText || `the server returned status ${xhr.status}`
}

// Uploads one file and resolves once it finishes. Never rejects: every failure
// comes back as { error } so the caller's flow stays the same as with the SDK.
export async function uploadFileWithProgress(
  bucket: string,
  path: string,
  file: File,
  opts: { onProgress?: UploadProgressFn } = {},
): Promise<UploadResult> {
  // The signed in user's JWT carries the upload through storage RLS, exactly as
  // the SDK's authenticated fetch would. Falling back to the anon key only lets
  // a signed out call fail closed at the server rather than here.
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token ?? SUPABASE_ANON_KEY

  return new Promise<UploadResult>((resolve) => {
    let xhr: XMLHttpRequest
    try {
      xhr = new XMLHttpRequest()
    } catch {
      resolve({ error: { message: 'Uploading is not supported in this environment.' } })
      return
    }

    const cleanPath = path.replace(/^\/+/, '')
    xhr.open('POST', `${SUPABASE_URL}/storage/v1/object/${bucket}/${cleanPath}`)
    xhr.setRequestHeader('apikey', SUPABASE_ANON_KEY)
    xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    // A create, never an overwrite, matching the SDK's upload(); the caller's
    // fresh random path means it never collides anyway.
    xhr.setRequestHeader('x-upsert', 'false')
    // Content-Type is left unset on purpose so the browser writes the multipart
    // boundary itself. The file's own type rides in the multipart part, exactly
    // as it does through the SDK, so the stored object keeps the same type.

    if (opts.onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) opts.onProgress!(e.loaded, e.total)
      }
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve({ error: null })
      } else {
        resolve({ error: { message: storageErrorMessage(xhr) } })
      }
    }
    xhr.onerror = () => resolve({ error: { message: 'a network error interrupted it' } })
    xhr.onabort = () => resolve({ error: { message: 'the upload was cancelled' } })

    // The SDK appends cacheControl then the file under an empty field name;
    // match both so the storage server reads the body the same way.
    const form = new FormData()
    form.append('cacheControl', '3600')
    form.append('', file, file.name)
    xhr.send(form)
  })
}
