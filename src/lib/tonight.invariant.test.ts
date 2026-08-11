// =====================================================================
// The Tonight product rules, pinned mechanically.
//
// These are the claims that would be quietly expensive to lose: one
// operational card on session day, no persistence outside Save, one
// implementation of the response filters, and no user-visible language
// calling this a register again. Each is checked against source text,
// which makes this a tripwire and not a proof: it catches somebody typing
// the obvious thing, and the behavioural half lives in
// ../routes/SessionRegister.test.tsx and ./tonight.test.ts.
// =====================================================================
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { RESPONSE_FILTER_LABELS, RESPONSE_FILTERS } from './tonight'

const SRC = join(import.meta.dirname, '..')

function sourceFiles(): string[] {
  const out: string[] = []
  const walk = (dir: string, prefix: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) walk(join(dir, entry.name), rel)
      else if (/\.tsx?$/.test(entry.name)) out.push(rel)
    }
  }
  walk(SRC, '')
  return out
}

const isTest = (f: string) => /\.test\.tsx?$/.test(f)
const read = (f: string) => readFileSync(join(SRC, f), 'utf8')

describe('session day has one operational surface, not two', () => {
  it('renders the Tonight card', () => {
    expect(read('routes/SessionDay.tsx')).toMatch(/<TonightCard\b/)
  })

  it('does not render the Spond attendance card beside it', () => {
    // The defect this prevents is the one being corrected: two cards
    // asking about one night, so the coach has to decide which is real.
    const src = read('routes/SessionDay.tsx')
    expect(src).not.toMatch(/SpondAttendanceCard/)
  })

  it('leaves the attendance card available to the planner, which still links events', () => {
    expect(read('routes/Planner.tsx')).toMatch(/SpondAttendanceCard/)
  })
})

describe('nothing persists outside Save groups', () => {
  it('the Tonight screen writes only through save, sync and the event link', () => {
    // A tick, a Select all and a bib are draft edits. The old screen wrote
    // on every row change; this is what stops that coming back.
    const src = read('routes/SessionRegister.tsx')
    const mutators = [...new Set([...src.matchAll(/(\w+)\.mutate\(/g)].map((m) => m[1]))].sort()
    expect(mutators).toEqual(['linkSpond', 'save', 'sync'])
  })

  it('the Tonight screen no longer reaches for the per row writers', () => {
    const src = read('routes/SessionRegister.tsx')
    expect(src).not.toMatch(/useSetRegisterEntry|useRemoveRegisterEntry/)
  })

  it('the save path sends a delta and reads back, rather than trusting itself', () => {
    const src = read('lib/queries.ts')
    const fn = src.slice(src.indexOf('export function useSaveTonight'))
    expect(fn).toMatch(/tonightUpsertRows/)
    // The readback is what the Saved claim rests on, so it has to be there.
    expect(fn.slice(0, 2000)).toMatch(/\.select\(/)
  })
})

describe('the response filters have one implementation', () => {
  it('nothing outside the model declares its own filter list or labels', () => {
    const offenders = sourceFiles()
      .filter((f) => f !== 'lib/tonight.ts' && f !== 'lib/tonight.test.ts' && !isTest(f))
      .filter((f) => /RESPONSE_FILTERS\s*[=:]|RESPONSE_FILTER_LABELS\s*[=:]/.test(read(f)))
    expect(offenders).toEqual([])
  })

  it('offers exactly five, so no screen can invent a sixth', () => {
    expect(RESPONSE_FILTERS).toHaveLength(5)
    expect(Object.keys(RESPONSE_FILTER_LABELS).sort()).toEqual(
      ['all', 'declined', 'going', 'unanswered', 'waiting'].sort(),
    )
  })

  it('never labels a reply state in the API s words', () => {
    // The screen speaks the parent's language: Going, not accepted.
    expect(Object.values(RESPONSE_FILTER_LABELS)).toEqual(['Going', 'No reply', 'Not going', 'Waiting', 'Everyone'])
  })
})

describe('unlinked is not a reply state', () => {
  it('the classifier requires a non null response before matching a filter', () => {
    // Pinned in source as well as in behaviour, because the behavioural
    // test would still pass if someone made null default to unanswered
    // somewhere upstream.
    const src = read('lib/tonight.ts')
    const fn = src.slice(src.indexOf('export function matchesResponse'))
    expect(fn.slice(0, 400)).toMatch(/row\.response !== null/)
  })
})

describe('the bib rule stays centralised', () => {
  it('tonight resolves a bib through effectiveBib rather than reimplementing it', () => {
    const src = read('lib/tonight.ts')
    expect(src).toMatch(/import \{[^}]*effectiveBib/)
    expect(src).toMatch(/effectiveBib\(/)
  })

  it('no screen builds its own override then team then none chain', () => {
    const offenders = sourceFiles()
      .filter((f) => f !== 'lib/bibs.ts' && !isTest(f))
      .filter((f) => /export function effectiveBib/.test(read(f)))
    expect(offenders).toEqual([])
  })
})

describe('the product no longer calls this a register', () => {
  // The route segment and the file name keep the old word deliberately, to
  // avoid churn. What must not survive is the WORD ON SCREEN.
  const USER_FACING = ['routes/SessionRegister.tsx', 'routes/SessionDay.tsx']

  it('shows Tonight as the title and the card', () => {
    const src = read('routes/SessionRegister.tsx')
    expect(src).toMatch(/<h2>Tonight<\/h2>/)
    expect(src).toMatch(/reg-card-title">Tonight/)
  })

  for (const f of USER_FACING) {
    it(`${f} renders no Register text and no attendance claim`, () => {
      const src = read(f)
      // Inside JSX text or a quoted string, not in an identifier or an
      // import path, which legitimately still say Register.
      const jsxText = src.replace(/import[^\n]*\n/g, '')
      expect(jsxText).not.toMatch(/>\s*Register\s*</)
      expect(jsxText).not.toMatch(/Mark \$\{[^}]*\} present/)
      expect(jsxText).not.toMatch(/aria-label="[^"]*\bpresent\b/)
      expect(jsxText).not.toMatch(/'Attendance'|"Attendance"/)
    })
  }

  it('labels the tick as inclusion in tonight s groups', () => {
    expect(read('routes/SessionRegister.tsx')).toMatch(/Include \$\{row\.displayName\} in tonight/)
  })
})

describe('the save affordance survives the mobile bottom nav', () => {
  it('lifts the sticky save bar clear of the fixed nav below the breakpoint', () => {
    // The nav is position:fixed bottom:0 z-index:50 (styles.css). A save
    // bar stuck at bottom:0 was painted underneath it, so the one control
    // the whole screen depends on was untappable exactly while it stuck.
    const css = readFileSync(join(SRC, 'routes/SessionRegister.css'), 'utf8')
    const mobile = css.slice(css.indexOf('@media (max-width: 900px)'))
    expect(mobile).toMatch(/\.tn-save\s*\{[^}]*bottom:\s*calc\(/)
  })

  it('gives Select all and Save groups real touch targets', () => {
    const css = readFileSync(join(SRC, 'routes/SessionRegister.css'), 'utf8')
    expect(css).toMatch(/\.tn-act\s*\{[^}]*min-height:\s*44px/)
    expect(css).toMatch(/\.tn-save-btn\s*\{[^}]*min-height:\s*48px/)
  })
})

describe('Refresh Spond follows the capability that runs it', () => {
  it('is handed to the screen only for a member who may write', () => {
    // spond-sync is gated on sessions.create, so offering it to a reader
    // could only ever produce a failure note.
    expect(read('routes/SessionRegister.tsx')).toMatch(/onRefresh=\{canEdit \?/)
  })
})

describe('the sync refreshes what the screen reads', () => {
  it('invalidates the replies as well as the events', () => {
    // The whole point of the button. Invalidating only spond_events left
    // every chip, count and pill exactly as they were.
    const src = read('lib/queries.ts')
    const fn = src.slice(src.indexOf('export function useSpondSync'))
    const settled = fn.slice(fn.indexOf('onSettled'), fn.indexOf('onSettled') + 500)
    expect(settled).toMatch(/'spond_events'/)
    expect(settled).toMatch(/'spond_rsvp'/)
  })
})

describe('Saved is a comparison, not an assumption', () => {
  it('the screen hands the readback to draftAfterSave rather than clearing the draft', () => {
    // Clearing unconditionally made the dirty check compare the readback
    // with a draft rebuilt from it, so Saved was structurally true for any
    // mutation that did not throw.
    const src = read('routes/SessionRegister.tsx')
    expect(src).toMatch(/onSuccess:\s*\(persisted\)\s*=>\s*setDraft\(\(current\)\s*=>\s*draftAfterSave\(/)
    expect(src).not.toMatch(/onSuccess:\s*\(\)\s*=>\s*setDraft\(null\)/)
  })
})
