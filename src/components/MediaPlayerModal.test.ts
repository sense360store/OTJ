import { describe, expect, it } from 'vitest'
import { videoDisplayMode } from './MediaPlayerModal'

// Shared fixtures for the tests below.
const faVideo = {
  type: 'video' as const,
  storagePath: undefined,
  embedUrl: 'https://player.vimeo.com/video/123456',
  sourceUrl: 'https://learn.englandfootball.com/sessions/abc',
  yt: undefined,
}

const storedVideo = {
  type: 'video' as const,
  storagePath: 'club/drill-abc.mp4',
  embedUrl: undefined,
  sourceUrl: undefined,
  yt: undefined,
}

describe('videoDisplayMode', () => {
  it('a stored file beats an FA source', () => {
    expect(videoDisplayMode({ ...faVideo, storagePath: 'club/drill-abc.mp4' })).toBe('file')
  })

  it('a stored file beats an embed URL', () => {
    expect(videoDisplayMode({ ...storedVideo, embedUrl: 'https://player.vimeo.com/video/123456' })).toBe('file')
  })

  it('FA link out is the fallback when there is no stored file', () => {
    expect(videoDisplayMode(faVideo)).toBe('fa-link')
  })

  it('embed plays when there is no stored file and no FA source', () => {
    expect(
      videoDisplayMode({
        type: 'video',
        storagePath: undefined,
        embedUrl: 'https://player.vimeo.com/video/123456',
        sourceUrl: 'https://vimeo.com/123456',
        yt: undefined,
      }),
    ).toBe('embed')
  })

  it('YouTube items use the youtube mode', () => {
    expect(
      videoDisplayMode({
        type: 'youtube',
        storagePath: undefined,
        embedUrl: undefined,
        sourceUrl: undefined,
        yt: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      }),
    ).toBe('youtube')
  })

  it('a video with nothing playable falls to thumb', () => {
    expect(
      videoDisplayMode({
        type: 'video',
        storagePath: undefined,
        embedUrl: undefined,
        sourceUrl: undefined,
        yt: undefined,
      }),
    ).toBe('thumb')
  })

  it('images and PDFs always fall to thumb', () => {
    expect(videoDisplayMode({ type: 'image', storagePath: 'club/img.jpg', embedUrl: undefined, sourceUrl: undefined, yt: undefined })).toBe('thumb')
    expect(videoDisplayMode({ type: 'pdf', storagePath: 'club/doc.pdf', embedUrl: undefined, sourceUrl: undefined, yt: undefined })).toBe('thumb')
  })
})
