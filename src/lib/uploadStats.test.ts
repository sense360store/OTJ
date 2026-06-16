import { describe, expect, it } from 'vitest'
import {
  formatElapsed,
  formatRate,
  formatRemaining,
  remainingSeconds,
  smoothedSpeed,
} from './uploadStats'

const KB = 1024
const MB = 1024 * 1024

describe('formatRate', () => {
  it('picks B/s, KB/s or MB/s by magnitude', () => {
    expect(formatRate(512)).toBe('512 B/s')
    expect(formatRate(KB)).toBe('1.0 KB/s')
    expect(formatRate(MB)).toBe('1.0 MB/s')
  })

  it('shows one decimal below ten and a whole number at ten and above, like formatBytes', () => {
    expect(formatRate(1.5 * KB)).toBe('1.5 KB/s')
    expect(formatRate(15 * KB)).toBe('15 KB/s')
    expect(formatRate(2.5 * MB)).toBe('2.5 MB/s')
    expect(formatRate(12 * MB)).toBe('12 MB/s')
  })

  it('reads a zero, negative or non-finite rate as zero rather than NaN or Infinity', () => {
    expect(formatRate(0)).toBe('0 B/s')
    expect(formatRate(-100)).toBe('0 B/s')
    expect(formatRate(NaN)).toBe('0 B/s')
    expect(formatRate(Infinity)).toBe('0 B/s')
  })
})

describe('formatElapsed', () => {
  it('reads as a stopwatch, padding seconds', () => {
    expect(formatElapsed(0)).toBe('0:00')
    expect(formatElapsed(5)).toBe('0:05')
    expect(formatElapsed(42)).toBe('0:42')
    expect(formatElapsed(80)).toBe('1:20')
    expect(formatElapsed(600)).toBe('10:00')
  })

  it('adds an hours field past an hour', () => {
    expect(formatElapsed(3725)).toBe('1:02:05')
  })

  it('floors fractional seconds and guards negatives and non-finite input', () => {
    expect(formatElapsed(42.9)).toBe('0:42')
    expect(formatElapsed(-3)).toBe('0:00')
    expect(formatElapsed(NaN)).toBe('0:00')
    expect(formatElapsed(Infinity)).toBe('0:00')
  })
})

describe('remainingSeconds', () => {
  it('divides the bytes left by the rate', () => {
    expect(remainingSeconds(50, 100, 10)).toBe(5)
  })

  it('reads a finished or overshot transfer as zero', () => {
    expect(remainingSeconds(100, 100, 10)).toBe(0)
    expect(remainingSeconds(120, 100, 10)).toBe(0)
  })

  it('returns null, never Infinity or NaN, when the rate is zero or unknown', () => {
    expect(remainingSeconds(50, 100, 0)).toBeNull()
    expect(remainingSeconds(50, 100, null)).toBeNull()
    expect(remainingSeconds(50, 100, NaN)).toBeNull()
    expect(remainingSeconds(50, 100, Infinity)).toBeNull()
    expect(remainingSeconds(50, 100, -1)).toBeNull()
  })
})

describe('formatRemaining', () => {
  it('rounds to a rough chunk so it does not twitch', () => {
    expect(formatRemaining(3)).toBe('about 5s left')
    expect(formatRemaining(12)).toBe('about 10s left')
    expect(formatRemaining(47)).toBe('about 45s left')
    expect(formatRemaining(120)).toBe('about 2m left')
    expect(formatRemaining(3600)).toBe('about 1h left')
  })

  it('reads unknown or non-finite input as "estimating", never Infinity or NaN', () => {
    const unknown = formatRemaining(null)
    expect(unknown).toBe('estimating')
    expect(formatRemaining(Infinity)).toBe('estimating')
    expect(formatRemaining(NaN)).toBe('estimating')
    expect(formatRemaining(-5)).toBe('estimating')
  })

  it('shows nothing nonsensical end to end when speed is zero', () => {
    const text = formatRemaining(remainingSeconds(50, 100, 0))
    expect(text).toBe('estimating')
    expect(text).not.toContain('Infinity')
    expect(text).not.toContain('NaN')
  })
})

describe('smoothedSpeed', () => {
  it('needs at least two samples', () => {
    expect(smoothedSpeed([])).toBeNull()
    expect(smoothedSpeed([{ loaded: 0, t: 0 }])).toBeNull()
  })

  it('averages bytes over the elapsed time between samples', () => {
    expect(smoothedSpeed([{ loaded: 0, t: 0 }, { loaded: 1000, t: 1000 }])).toBe(1000)
  })

  it('only counts samples inside the recent window, so an early slow patch does not drag it down', () => {
    const samples = [
      { loaded: 0, t: 0 },
      { loaded: 100, t: 10000 },
      { loaded: 1100, t: 11000 },
    ]
    // The window keeps the last second (1000 bytes in 1s), not the slow start.
    expect(smoothedSpeed(samples, 2000)).toBe(1000)
  })

  it('falls back to the previous sample when only the latest is inside the window', () => {
    const samples = [
      { loaded: 0, t: 0 },
      { loaded: 1000, t: 1000 },
      { loaded: 5000, t: 5000 },
    ]
    // 5000 - 1000 bytes over 5000 - 1000 ms = 1000 B/s.
    expect(smoothedSpeed(samples, 2000)).toBe(1000)
  })

  it('returns null when no time passed or the count went backwards', () => {
    expect(smoothedSpeed([{ loaded: 100, t: 1000 }, { loaded: 200, t: 1000 }])).toBeNull()
    expect(smoothedSpeed([{ loaded: 200, t: 0 }, { loaded: 100, t: 1000 }])).toBeNull()
  })
})
