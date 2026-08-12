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

// Source with its comments removed. Several rules below are about what the
// code DOES, and this file's own habit is to explain the mistake it is
// preventing in a comment right next to the prevention, which a bare
// substring check then reads as the mistake itself.
const code = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n')

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
    // tonightUpsertBatches, not tonightUpsertRows: the delta is grouped by
    // key shape before it is sent, because postgrest-js unions the keys of
    // an array into one column list and would propose NULL for a column an
    // individual row deliberately omitted. See the function's header.
    expect(fn).toMatch(/tonightUpsertBatches/)
    // The readback is what the Saved claim rests on, so it has to be there.
    expect(fn.slice(0, 2500)).toMatch(/\.select\(/)
  })

  it('never asks postgrest to fill a missing key with the column default', () => {
    // `defaultToNull: false` would turn an omitted `present` into the
    // column DEFAULT, so a save that only changed a group would write
    // false over stored attendance. It is the opposite of the fix, which
    // is why both files explain it at length; this reads the CODE, with
    // the comments stripped, so saying so is not doing so.
    for (const f of ['lib/queries.ts', 'lib/tonight.ts']) {
      expect(code(read(f))).not.toMatch(/defaultToNull/)
    }
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

// =====================================================================
// One canonical count builder, because "19 vs 11" was two populations
// wearing one word.
//
// The behavioural half is ./tonightCounts.test.ts, which proves the
// arithmetic and the wording. What behaviour CANNOT prove is that there is
// only one implementation: a second one that happens to agree today passes
// every behavioural test and drifts on the first change. So the rules
// below are source text, and they are deliberately narrow, aimed at the
// realistic mistake of a screen counting an array in place.
//
// What this cannot catch, stated plainly: a count reaching a label through
// a variable, an aggregate read in a hook and passed down as a plain
// number, or a second builder in a new file that nothing here names. Treat
// a pass as "nobody typed the obvious thing", never as proof.
// =====================================================================
describe('Tonight counts people in exactly one place', () => {
  const SCREEN = 'routes/SessionRegister.tsx'

  it('builds every number through tonightCounts', () => {
    const src = read(SCREEN)
    expect(src).toMatch(/import \{[^}]*\btonightCounts\b/s)
    expect(src).toMatch(/tonightCounts\(/)
  })

  it('reads each chip through the shared lookup rather than indexing its own record', () => {
    // `counts[f]` was the old shape: a record the screen built itself. The
    // filter key and the count key are tied together in one table in
    // ./tonight so a renamed state cannot silently zero a chip.
    const src = read(SCREEN)
    expect(src).toMatch(/chipCount\(counts, f\)/)
    expect(src).not.toMatch(/\{counts\[f\]\}/)
  })

  it('never filters the rows itself to produce a number', () => {
    // The specific defect: `rows.filter(...).length` beside a label. Each
    // one is a second implementation of a population, and the linked count
    // was exactly this before it moved into the model.
    const src = read(SCREEN)
    expect(src).not.toMatch(/\brows\.filter\([^)]*\)\.length/)
    expect(src).not.toMatch(/\bshown\.filter\([^)]*\)\.length/)
  })

  it('does not reduce the groups to recover a total the model already has', () => {
    const src = read(SCREEN)
    expect(src).not.toMatch(/groups\.reduce\(/)
  })

  it('lets no Spond event aggregate reach a per player count', () => {
    // The four aggregate fields count everybody Spond invited. Tonight
    // counts covered Hub players. The screen may name the aggregate in a
    // labelled sentence (spondAudienceNote) and must never read a field
    // off an event to produce one of its own figures.
    const src = read(SCREEN)
    expect(src).not.toMatch(/event\.(accepted|declined|unanswered|waiting)\b/)
    expect(src).toMatch(/spondAudienceNote\(/)
  })

  it('hands the builder a link set that may be unknown, so zero is never guessed', () => {
    // null means the link set could not be read. Collapsing it to an empty
    // set would print "0 of 40 players linked to Spond" at a club that has
    // linked everybody and simply had a slow read.
    const src = read(SCREEN)
    expect(src).toMatch(/linksUsable \?[^\n]*new Set\(/)
    expect(src).toMatch(/:\s*null/)
  })
})

describe('the event aggregate is never printed bare', () => {
  // Whether a screen actually RENDERS the population is proved by
  // rendering it, in ../components/SpondAttendance.test.tsx and
  // ../components/PlanFromSpond.test.tsx. A source check here matched the
  // import line and survived deleting the caption from the markup, which
  // is precisely the false confidence this file warns about, so the only
  // rule left here is the one behaviour cannot show: that the audience has
  // a single derivation.
  it('derives the audience in one place', () => {
    const offenders = sourceFiles()
      .filter((f) => f !== 'lib/spond.ts' && !isTest(f))
      .filter((f) => /accepted\s*\+\s*\w+\.declined/.test(read(f)))
    expect(offenders).toEqual([])
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
  //
  // AMENDED BY THE 0047 SPLIT, and the amendment is the point rather than
  // an exception to it. This block used to forbid any mention of
  // attendance on these two screens, because the release it was written
  // for had decided the product no longer recorded attendance at all: the
  // tick meant "in tonight's groups" and `present` was only its storage.
  // That decision was wrong and is what 0047 reverses. Attendance is a
  // first-class fact again, with its own control and its own column, so a
  // rule that forbids the screen from mentioning it now forbids the fix.
  //
  // What the rule was actually protecting is untouched: this screen is
  // Tonight, it is not a register, and the big row target means INCLUSION.
  // Those three are still pinned below. What is gone is the blanket ban on
  // the word, which was a claim about the product, not about the wording.
  const USER_FACING = ['routes/SessionRegister.tsx', 'routes/SessionDay.tsx']

  it('shows Tonight as the title and the card', () => {
    const src = read('routes/SessionRegister.tsx')
    expect(src).toMatch(/<h2>Tonight<\/h2>/)
    expect(src).toMatch(/reg-card-title">Tonight/)
  })

  for (const f of USER_FACING) {
    it(`${f} renders no Register text`, () => {
      // Inside JSX text or a quoted string, not in an identifier or an
      // import path, which legitimately still say Register.
      const jsxText = read(f).replace(/import[^\n]*\n/g, '')
      expect(jsxText).not.toMatch(/>\s*Register\s*</)
    })
  }

  it('labels the row target as inclusion in tonight s groups, not as arrival', () => {
    const src = read('routes/SessionRegister.tsx')
    expect(src).toMatch(/Include \$\{row\.displayName\} in tonight/)
    // The row target must never be the thing that records attendance.
    const rowButton = src.slice(src.indexOf('className="reg-tick"'), src.indexOf('</button>'))
    expect(rowButton).toMatch(/onClick=\{onToggle\}/)
    expect(rowButton).not.toMatch(/onPresent/)
  })

  it('gives attendance its own control, separate from the row target', () => {
    // The whole point of 0047 on this screen. One gesture sets the group,
    // a different one records that a child was here, and a coach can do
    // either without doing the other.
    const src = read('routes/SessionRegister.tsx')
    expect(src).toMatch(/onClick=\{onPresent\}/)
    expect(src).toMatch(/aria-pressed=\{present\}/)
    expect(src).toMatch(/was present/)
  })
})

describe('attendance and group inclusion never share a field', () => {
  it('the draft keeps them in two separate maps', () => {
    // One map with a single entry per child is how they were conflated in
    // the first place. Two maps make "toggling one moved the other"
    // unrepresentable rather than merely tested against.
    const src = read('lib/tonight.ts')
    const iface = src.slice(src.indexOf('export interface TonightDraft'), src.indexOf('export function draftFromEntries'))
    expect(iface).toMatch(/included:\s*Record<string, boolean>/)
    expect(iface).toMatch(/attendance:\s*Record<string, boolean>/)
  })

  it('the draft builder reads each from its own column', () => {
    const src = read('lib/tonight.ts')
    const fn = src.slice(src.indexOf('export function draftFromEntries'), src.indexOf('export function quickAdd'))
    expect(fn).toMatch(/included\[e\.playerId\]\s*=\s*e\.includedInGroups/)
    expect(fn).toMatch(/attendance\[e\.playerId\]\s*=\s*e\.present/)
    // The bug, stated as the thing that must not reappear.
    expect(fn).not.toMatch(/included\[e\.playerId\]\s*=\s*e\.present/)
  })

  it('the write payload gates the two columns on two separate flags', () => {
    const src = read('lib/tonight.ts')
    const fn = src.slice(src.indexOf('export function tonightUpsertRows'))
    expect(fn).toMatch(/if \(c\.presentChanged\) row\.present = c\.present/)
    expect(fn).toMatch(/if \(c\.includedChanged\) row\.included_in_groups = c\.includedInGroups/)
  })

  it('a guest is removed only when nothing at all is recorded about them', () => {
    // All three facts, and read through `effective` rather than off the
    // raw draft. Attendance had to join the condition or taking a guest
    // out of the groups would delete the record that they were at the
    // session; reading it EFFECTIVELY had to follow, or the same delete
    // happened whenever another coach marked them present after this
    // coach's draft froze.
    const src = read('lib/tonight.ts')
    const fn = src.slice(src.indexOf('export function draftRemovals'), src.indexOf('// Whether the draft differs'))
    expect(fn).toMatch(/effective\(draft, e, e\.playerId\)/)
    expect(fn).toMatch(/!value\.includedInGroups/)
    expect(fn).toMatch(/!value\.present/)
    expect(fn).toMatch(/value\.bibColourOverride === null/)
    // The raw draft accessors must not decide a delete.
    expect(fn).not.toMatch(/draftPresent\(draft/)
    expect(fn).not.toMatch(/draftIncluded\(draft/)
  })

  it('is named in both share deny lists, so a future projection throws instead of shipping', () => {
    // SOURCE TEXT, and the same rule 0046's diagram follows. A share is a
    // FROZEN COPY: once a key reaches content_shares.snapshot the read path
    // serves it until the link is revoked, and no later fix takes it back.
    // included_in_groups says which named children a coach put in a group on
    // a given evening, which is the same child-operational weight as
    // `present` and `bib_colour_override` already in these lists.
    expect(read('lib/publicShare.ts')).toContain("'included_in_groups', 'includedInGroups',")
    const server = readFileSync(
      join(SRC, '..', 'supabase/functions/_shared/share.ts'),
      'utf8',
    )
    const forbidden = server.slice(
      server.indexOf('const FORBIDDEN_ANYWHERE'),
      server.indexOf('function assertKeysWithin'),
    )
    expect(forbidden).toContain("'included_in_groups'")
    expect(forbidden).toContain("'includedInGroups'")
  })

  it('nothing derives either fact from a Spond reply', () => {
    const src = code(read('lib/tonight.ts'))
    // No assignment into the two draft maps from anything reply shaped.
    expect(src).not.toMatch(/(included|attendance)\[[^\]]*\]\s*=\s*[^\n]*\bresponse\b/)
    expect(src).not.toMatch(/(included|attendance)\[[^\]]*\]\s*=\s*[^\n]*\brsvp\b/i)
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

// =====================================================================
// The event aggregate never appears as a reply split.
//
// WHY THIS IS A SOURCE RULE. spond_events holds four integers per event
// and they count every member Spond invited: coaches, unlinked members,
// anybody on the event. Rendered as four figures beside four words they
// read as a measurement of the club's players, and production proved it:
// an event whose audience was 50 people showed 20 and 24 on the planner
// while the same night's covered players were 10 going and 14 not going.
// Both pairs were correct and only one of them was about players.
//
// So the split survives on exactly one surface, the admin mirror
// inspection, whose whole job is showing what was synced. Everywhere a
// coach organises a night the aggregate is one labelled sentence.
//
// A tripwire, not a proof: it reads source text and catches somebody
// adding the pills back. What it cannot catch is a count reaching a label
// through a variable, or a new file nothing here names.
// =====================================================================
describe('the Spond event aggregate is never a player RSVP, on any screen', () => {
  // Only the module that composes the wording. The admin mirror
  // inspection used to be exempt, on the reasoning that its job is showing
  // what was synced. It is also the screen the defect was reported from:
  // "20 accepted / 24 declined / 6 unanswered" over an audience of 50
  // people, while the club's own children were 10 going and 14 not going.
  // A reply word beside a figure is read as a statement about players
  // wherever it appears, so there is no exempt surface.
  const ALLOWED = ['lib/spond.ts']

  it('leaves no list of the four API reply words anywhere in the product', () => {
    const offenders = sourceFiles()
      .filter((f) => !isTest(f))
      .filter((f) => /SPOND_COUNT_LABELS/.test(code(read(f))))
    expect(offenders).toEqual([])
  })

  it('lets no screen read a count field off an event row', () => {
    // `event.accepted`, `e.declined` and their relatives. Each one is a
    // figure about the event's audience being placed on a screen about
    // the club's players.
    const offenders: string[] = []
    for (const f of sourceFiles().filter((f) => !isTest(f) && !ALLOWED.includes(f))) {
      // Anchored on the names an event row is actually held under in this
      // codebase. A blanket "identifier dot reply word" would flag the
      // response model's own `chips.going`, which is the right figure.
      const hit = code(read(f)).match(/\b(?:e|ev|evt|event|spondEvent|linked)\.(?:accepted|declined|unanswered|waiting)\b/)
      if (hit) offenders.push(`${f}: ${hit[0]}`)
    }
    expect(offenders).toEqual([])
  })

  it('composes the audience sentence in one place, naming its population', () => {
    const src = read('lib/spond.ts')
    const fn = src.slice(src.indexOf('export function spondAudienceNote'))
    const body = fn.slice(fn.indexOf('return'), fn.indexOf('return') + 200)
    expect(body).toMatch(/Spond audience/)
    // A headcount, not a split. What the sentence must never carry is a
    // reply word beside a figure; the wording itself is pinned
    // behaviourally in ./tonightCounts.test.ts.
    expect(body).not.toMatch(/going|accepted|declined|unanswered/i)
  })

  it('keeps every surface that shows an event on that one sentence', () => {
    for (const f of [
      'components/SpondAttendance.tsx',
      'components/PlanFromSpond.tsx',
      'routes/AdminSpond.tsx',
    ]) {
      expect(code(read(f))).toMatch(/spondAudienceNote\(/)
    }
  })

  it('lets the reply words be rendered only against a population of players', () => {
    // RESPONSE_FILTER_LABELS is the product's own wording for the four
    // states, and it may only be rendered beside a figure that counts
    // children. The admin screen reads it for its Linked players split,
    // which comes from spond_event_responses (linked members only, by
    // foreign key) and never from an event's count fields. This pins that
    // it takes its numbers from the response read rather than the event.
    const src = code(read('routes/AdminSpond.tsx'))
    expect(src).toMatch(/useSpondEventResponseCounts\(/)
    expect(src).not.toMatch(/\bspondAudience\(/)
  })
})
