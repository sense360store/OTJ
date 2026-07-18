// Date formatting for the Registered players page and History, kept apart from
// the pure playersView reducers so those stay clock free and deterministic in
// tests. These use the browser locale (en-GB) the rest of the app uses.

// A registration date as the table shows it: "16 Jul 2026". A YYYY-MM-DD value
// is read as a local date (no timezone shift). Empty input yields an empty
// string so a blank cell renders nothing.
export function fmtRegDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const value = iso.length === 10 ? iso + 'T00:00:00' : iso
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

// A History timestamp as the panel shows it: "16 Jul, 14:32".
export function fmtHistoryTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const date = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  return `${date}, ${time}`
}
