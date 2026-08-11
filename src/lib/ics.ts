// Add to calendar: build a standard iCalendar event for a session entirely
// client side and hand it to the browser as a .ics download. No email
// infrastructure and no scheduling; email reminders are possible future work.
import type { Session } from './data'
import { sessionMinutes } from './data'
import { hasStartTime, plannedMinutes, sessionStart } from './sessionLifecycle'

// Times are written as floating local times (no timezone suffix) on purpose:
// a 17:30 training session means 17:30 on the clock wherever the phone is,
// which for a single club is exactly right and stays correct across daylight
// saving changes.
function fmtLocal(d: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}T${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

// Text values escape backslash, semicolon, comma and newline per RFC 5545.
function esc(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
}

// Content lines longer than 75 octets are folded with CRLF plus a space.
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line)
  if (bytes.length <= 75) return line
  const out: string[] = []
  let start = 0
  while (start < bytes.length) {
    // Take up to 75 octets (74 for continuations, which begin with a space)
    // without splitting a UTF-8 sequence.
    let end = Math.min(start + (start === 0 ? 75 : 74), bytes.length)
    while (end > start && end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--
    out.push(new TextDecoder().decode(bytes.slice(start, end)))
    start = end
  }
  return out.join('\r\n ')
}

// A calendar entry needs both ends, so a session with no time is not
// exportable; a session with no plan yet still books the length the rest of
// the product believes it runs for.
//
// Start and duration both come from ../lib/sessionLifecycle rather than
// being derived here. This file used to parse the date and time itself and
// fall back to 60 minutes where the plan was empty, which made a second
// answer to "how long is this session": the app treated it as running for
// 90 and the calendar booked an hour. One seam, one answer.
export function sessionCalendarDates(s: Session): { start: Date; end: Date } | null {
  const start = hasStartTime(s) ? sessionStart(s) : null
  if (!start) return null
  return { start, end: new Date(start.getTime() + plannedMinutes(s) * 60_000) }
}

// venueName is the resolved venue for a session, which the caller looks up
// from the club's venues. A session saved before venues existed falls back to
// its frozen free text label, so an old calendar entry keeps its location.
export function buildSessionIcs(s: Session, venueName?: string | null): string | null {
  const dates = sessionCalendarDates(s)
  if (!dates) return null
  const description = [s.focus, `${s.activities.length} activities, ${sessionMinutes(s)} min`]
    .filter(Boolean)
    .join('\n')
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//OTJ Training Hub//EN',
    'BEGIN:VEVENT',
    // A stable UID per session, so importing again replaces rather than
    // duplicates in calendar apps that honour it.
    `UID:${s.id}@otj-training-hub`,
    `DTSTAMP:${fmtLocal(new Date())}`,
    `DTSTART:${fmtLocal(dates.start)}`,
    `DTEND:${fmtLocal(dates.end)}`,
    `SUMMARY:${esc(s.name)}`,
    ...((venueName || s.venue) ? [`LOCATION:${esc(venueName || s.venue)}`] : []),
    ...(description ? [`DESCRIPTION:${esc(description)}`] : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ]
  return lines.map(fold).join('\r\n') + '\r\n'
}

export function downloadSessionIcs(s: Session, venueName?: string | null): void {
  const ics = buildSessionIcs(s, venueName)
  if (!ics) return
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${s.name.replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'session'}.ics`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
