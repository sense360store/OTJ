// Pure helpers that turn the byte-progress stream of an upload into the human
// readouts the progress block shows: elapsed time, a smoothed transfer rate,
// and a rough estimate of the time left. They take plain numbers and samples,
// so they unit test without a real upload or a DOM. The display maths lives
// here; UploadProgress only wires React state and the wall clock to it.

export interface ProgressSample {
  // Bytes sent at this point in the upload.
  loaded: number
  // Wall-clock time of the sample in milliseconds (performance.now or Date.now).
  t: number
}

const KB = 1024
const MB = 1024 * 1024

// A transfer rate in bytes per second, shown in the unit that fits its
// magnitude. Rounding mirrors formatBytes: one decimal below ten, a whole
// number at ten and above. A non-finite or negative input has no honest
// reading, so it reads as zero rather than NaN.
export function formatRate(bytesPerSecond: number): string {
  const v = Number.isFinite(bytesPerSecond) && bytesPerSecond > 0 ? bytesPerSecond : 0
  if (v >= MB) {
    const n = v / MB
    return `${n >= 10 ? Math.round(n) : n.toFixed(1)} MB/s`
  }
  if (v >= KB) {
    const n = v / KB
    return `${n >= 10 ? Math.round(n) : n.toFixed(1)} KB/s`
  }
  return `${Math.round(v)} B/s`
}

// A running elapsed time as a stopwatch reading: 0:42, 1:20, and 1:02:05 once
// it passes an hour. A non-finite or negative input floors to 0:00 so the clock
// never shows nonsense.
export function formatElapsed(seconds: number): string {
  const whole = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0
  const hrs = Math.floor(whole / 3600)
  const mins = Math.floor((whole % 3600) / 60)
  const secs = whole % 60
  const ss = String(secs).padStart(2, '0')
  if (hrs > 0) return `${hrs}:${String(mins).padStart(2, '0')}:${ss}`
  return `${mins}:${ss}`
}

// Seconds of upload left, from the bytes still to send over the current rate.
// Returns null, never Infinity or NaN, when the rate is unknown, zero or
// non-finite, so the caller can show a placeholder instead of a bogus number.
// A finished or overshot transfer reads as 0.
export function remainingSeconds(
  loaded: number,
  total: number,
  bytesPerSecond: number | null,
): number | null {
  if (bytesPerSecond == null || !Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return null
  const remainingBytes = total - loaded
  if (!Number.isFinite(remainingBytes) || remainingBytes <= 0) return 0
  const secs = remainingBytes / bytesPerSecond
  return Number.isFinite(secs) ? secs : null
}

// A rough, deliberately approximate "time left" phrase. Unknown (null or
// non-finite) reads as "estimating" rather than a precise but fake number.
// Seconds round to a sensible chunk so the estimate does not twitch digit by
// digit as the rate wobbles.
export function formatRemaining(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return 'estimating'
  if (seconds < 55) {
    const rounded = Math.max(5, Math.round(seconds / 5) * 5)
    return `about ${rounded}s left`
  }
  if (seconds < 90) return 'about 1m left'
  if (seconds < 3600) return `about ${Math.round(seconds / 60)}m left`
  return `about ${Math.round(seconds / 3600)}h left`
}

// A transfer rate in bytes per second, averaged over a recent time window so it
// reads steadily instead of jumping with each byte event. It uses the earliest
// sample inside the window against the latest; if only the latest falls inside
// it, it falls back to the one before so a sparse, slow upload still reads. Too
// few samples, no elapsed time, or a count that went backwards return null,
// which the caller shows as "calculating".
export function smoothedSpeed(samples: ProgressSample[], windowMs = 3000): number | null {
  if (samples.length < 2) return null
  const latest = samples[samples.length - 1]
  let startIdx = samples.length - 2
  for (let i = samples.length - 2; i >= 0; i--) {
    if (latest.t - samples[i].t <= windowMs) startIdx = i
    else break
  }
  const first = samples[startIdx]
  const dt = (latest.t - first.t) / 1000
  const db = latest.loaded - first.loaded
  if (dt <= 0 || db < 0) return null
  return db / dt
}
