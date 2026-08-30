// The direct-to-Storage uploader, stubbed. It reaches Supabase (it posts to
// the storage REST endpoint with the project's own URL and anon key), so it
// belongs in the stub list by the rule vite.visual.config.ts already states;
// it was missed because it reaches Supabase through an XMLHttpRequest rather
// than through the SDK client.
//
// WHY IT MATTERS BEYOND TIDINESS. It is the last module in the harness bundle
// that read `import.meta.env`, so the built page embedded VITE_SUPABASE_URL
// and VITE_SUPABASE_ANON_KEY and its content hash moved with them. Codex
// found that as a freshness gap: the guard tracked files and the environment
// is not one. Stubbing the reader removes the dependency rather than tracking
// it, and checks.invariant.test.ts derives the rule from source rather than
// restating it, so a future env reader has to be stubbed or named.
//
// Nothing in the harness calls this: every upload the screens perform goes
// through a stubbed query hook. It resolves the way a successful upload does
// so a caller that appeared would not see a failure it could not explain.
export type UploadProgressFn = (loaded: number, total: number) => void

export interface UploadResult {
  error: { message: string } | null
}

export async function uploadFileWithProgress(
  _bucket: string,
  _path: string,
  file: File,
  opts: { onProgress?: UploadProgressFn } = {},
): Promise<UploadResult> {
  opts.onProgress?.(file.size, file.size)
  return { error: null }
}
