import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { UploadProgress } from './ui'

// UploadProgress is presentational, so the static renderer covers its states
// without a DOM, matching the rest of the suite. The byte values come from the
// real XHR progress events in src/lib/storageUpload.ts; here we pin how each
// state renders.

const MB = 1024 * 1024

describe('UploadProgress', () => {
  it('shows a determinate bar, the name, the size and the percent while uploading', () => {
    const html = renderToStaticMarkup(<UploadProgress label="rondo.mp4" loaded={50 * MB} total={100 * MB} />)
    expect(html).toContain('rondo.mp4')
    expect(html).toContain('100 MB')
    expect(html).toContain('Uploading')
    expect(html).toContain('50%')
    expect(html).toContain('width:50%')
    expect(html).toContain('aria-valuenow="50"')
    // The honest note that a large upload takes time.
    expect(html).toContain('Large files can take a little while')
  })

  it('shows an honest starting state before the first byte event, not a fake bar', () => {
    const html = renderToStaticMarkup(<UploadProgress label="big-clip.mp4" loaded={null} total={273 * MB} />)
    expect(html).toContain('big-clip.mp4')
    expect(html).toContain('273 MB')
    expect(html).toContain('Starting')
    expect(html).toContain('width:0%')
    // No determinate value is claimed while progress is unknown.
    expect(html).not.toContain('aria-valuenow')
  })

  it('shows a full bar and a finishing state once all bytes are sent', () => {
    const html = renderToStaticMarkup(<UploadProgress label="clip.mp4" loaded={100 * MB} total={100 * MB} />)
    expect(html).toContain('Finishing')
    expect(html).toContain('width:100%')
    expect(html).toContain('aria-valuenow="100"')
  })

  it('clamps a byte count that overshoots the total to 100 percent', () => {
    // The multipart envelope means the event total can edge past the file size;
    // the bar must not run past full.
    const html = renderToStaticMarkup(<UploadProgress label="clip.mp4" loaded={120 * MB} total={100 * MB} />)
    expect(html).toContain('width:100%')
    expect(html).not.toContain('width:120%')
  })
})
