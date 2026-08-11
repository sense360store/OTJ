// The tripwire that keeps one classifier from becoming five.
//
// WHY THIS EXISTS. The training rule is a word list plus one Spond fact.
// Both are easy to retype: a new screen needs "just a quick title check"
// and now two screens disagree about whether a gala is training, and the
// disagreement is invisible until a coach notices a session missing on one
// page and present on another. The rule lives in ./eventKind and nowhere
// else, and this test fails the build when a second copy appears.
//
// WHAT IT IS NOT. This is a tripwire, not a proof. It reads source text,
// so a determined workaround (building the word from fragments, reading it
// from a constant elsewhere) walks past it. It catches the realistic
// mistake, which is somebody typing the obvious thing in a hurry.
//
// The word set below is deliberately narrower than NON_TRAINING_WORDS.
// "social" is one of the FA four corners, "match" is a String method,
// "cup" and "trial" and "photo" turn up in ordinary copy: flagging those
// would make the test noise, and a noisy invariant gets deleted. The words
// kept are the ones that can only mean event classification.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { NON_TRAINING_WORDS } from './eventKind'

const SRC = join(import.meta.dirname, '..')

// The one file allowed to know the vocabulary, and its own tests.
const SEAM = ['lib/eventKind.ts', 'lib/eventKind.test.ts', 'lib/eventKind.invariant.test.ts']

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
  return out.filter((f) => !SEAM.includes(f))
}

// Comments carry prose about training on nearly every screen, and prose is
// not a predicate. Stripping them keeps the check on code.
//
// Written as a scanner rather than a regex because both cheaper versions
// are wrong in ways that bit. Stripping only whole-line comments left
// trailing ones in, so `const x = f() // was: label.includes('training')`
// failed the build with a message about second classifiers, and a trailing
// `// TODO: spondEvents` satisfied a check it should not have. Stripping
// any `//` breaks on `https://` inside a string. So: walk the source once,
// tracking string, template and regex state, and drop comments only when
// outside all three.
function stripComments(src: string): string {
  let out = ''
  let i = 0
  let quote: string | null = null
  while (i < src.length) {
    const c = src[i]
    const next = src[i + 1]
    if (quote) {
      out += c
      if (c === '\\') {
        out += next ?? ''
        i += 2
        continue
      }
      if (c === quote) quote = null
      i++
      continue
    }
    if (c === "'" || c === '"' || c === '`') {
      quote = c
      out += c
      i++
      continue
    }
    if (c === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') i++
      continue
    }
    if (c === '/' && next === '*') {
      i += 2
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++
      i += 2
      continue
    }
    out += c
    i++
  }
  return out
}

// Blank the inside of every quoted run, keeping the quotes. Needed before
// looking for regex literals, because a calendar PRODID like
// "-//OTJ Training Hub//EN" is a string that reads exactly like one.
function blankStrings(src: string): string {
  return src.replace(/'[^'\\\n]*'|"[^"\\\n]*"|`[^`\\]*`/g, (m) => m[0] + m[0])
}

// Fixtures name matches and galas because that is what they are fixtures
// of, and a describe block may quote a label it is about. Those are the
// two rules below that read product copy rather than product logic.
const isTest = (f: string) => /\.test\.tsx?$/.test(f)

// Every string and template literal in the file, as its raw inner text.
// Crude by design: it over-collects rather than under-collects, and a false
// positive here is a five second fix while a false negative is the bug this
// test exists to stop.
function literals(src: string): string[] {
  const out: string[] = []
  const re = /'([^'\\\n]*)'|"([^"\\\n]*)"|`([^`\\]*)`/g
  for (const m of src.matchAll(re)) out.push(m[1] ?? m[2] ?? m[3] ?? '')
  return out
}

// Words that can only be event classification. The EventKind value
// 'training' is spelled the same way and is legitimate everywhere, so the
// literal alone proves nothing: what proves it is the literal being fed to
// a string search, or written into a regex. Those are the shapes below.
const CLASSIFYING_WORDS = ['training', 'fixture', 'friendly', 'gala', 'tournament', 'festival']

const WORD_ALT = CLASSIFYING_WORDS.join('|')

// x.includes('training'), x.startsWith("Gala"), x.indexOf('fixture') and
// their relatives. Nothing in this product legitimately searches a string
// for one of these words outside the seam.
const SEARCH_CALL = new RegExp(
  String.raw`\.(includes|startsWith|endsWith|indexOf|lastIndexOf|search)\(\s*['"\`](${WORD_ALT})['"\`]`,
  'i',
)

// A regex literal mentioning one of the words. The seam's own expressions
// are built from the word lists at runtime, so no literal anywhere in the
// codebase should carry one.
//
// Anchored on the assignment or call that precedes it, because JSX text
// between two self-closing tags (`<Icon.cone />Training night<Icon.chevR />`)
// reads exactly like a regex literal and is not one. Without the anchor,
// ordinary future copy would fail the build with a message about
// classifiers, and an invariant that cries wolf gets deleted.
const CLASSIFYING_REGEX = new RegExp(String.raw`[=(,]\s*/[^/\n]*\b(${WORD_ALT})\b[^/\n]*/[gimsuy]*`, 'i')

// The same regex written the long way round. `new RegExp('gala|friendly')`
// takes its pattern as a STRING, so the literal blanking that protects the
// check above would hide it: this is the most likely shape of a copy,
// because it is the shape the seam itself uses.
const CLASSIFYING_REGEXP_CALL = new RegExp(
  String.raw`new RegExp\(\s*['"\`][^'"\`]*\b(${WORD_ALT})\b`,
  'i',
)

// A comparison whose other side is an event's label. `filter.kind ===
// 'training'` reads the view state and is fine; `s.name === 'Training'`
// classifies, and classifying belongs in the seam.
const LABEL_COMPARISON = new RegExp(
  String.raw`\b\w*(title|name)\w*\s*(===|!==|==|!=)\s*['"\`](${WORD_ALT})['"\`]`,
  'i',
)

// Spond's own event classification. The string that means "this is a
// match" belongs beside the rule that reads it.
const SPOND_MATCH = 'MATCH'

describe('the training vocabulary lives in exactly one file', () => {
  it('is the word list nothing else declares', () => {
    const offenders = sourceFiles().filter((f) => {
      const src = readFileSync(join(SRC, f), 'utf8')
      return /NON_TRAINING_WORDS\s*[=:]|NON_TRAINING_RE\s*=/.test(src)
    })
    expect(offenders).toEqual([])
  })

  it('no other file searches a string for a classifying word', () => {
    // Non test files only. A render test asserting on the word "Training"
    // in its output is checking copy, not classifying anything, and
    // flagging those would make the check noise.
    const offenders: string[] = []
    for (const f of sourceFiles().filter((f) => !isTest(f))) {
      const src = stripComments(readFileSync(join(SRC, f), 'utf8'))
      const hit =
        src.match(SEARCH_CALL) ??
        src.match(CLASSIFYING_REGEXP_CALL) ??
        blankStrings(src).match(CLASSIFYING_REGEX) ??
        src.match(LABEL_COMPARISON)
      if (hit) offenders.push(`${f}: ${hit[0]}`)
    }
    expect(offenders).toEqual([])
  })

  it('no other file carries a copy of the word list', () => {
    // A copied vocabulary is a copied classifier with the predicate still
    // to be written. One classifying word standing alone is ordinary (a
    // fixture title, an option value); two or more in one file is a list.
    const offenders: string[] = []
    for (const f of sourceFiles().filter((f) => !isTest(f))) {
      const src = stripComments(readFileSync(join(SRC, f), 'utf8'))
      const words = new Set(
        literals(src)
          .map((l) => l.trim().toLowerCase())
          .filter((l) => CLASSIFYING_WORDS.includes(l)),
      )
      if (words.size > 1) offenders.push(`${f}: ${[...words].join(', ')}`)
    }
    expect(offenders).toEqual([])
  })

  it('catches the shapes it claims to catch', () => {
    // The tripwire is worth exactly what it detects, so the detector is
    // itself pinned. Written as source text rather than real code because
    // real code here would trip the checks above.
    expect(SEARCH_CALL.test("e.title.toLowerCase().includes('training')")).toBe(true)
    expect(SEARCH_CALL.test('s.name.startsWith("Gala")')).toBe(true)
    expect(CLASSIFYING_REGEX.test('const RE = /friendly|fixture/i')).toBe(true)
    expect(CLASSIFYING_REGEXP_CALL.test("const RE = new RegExp('friendly|gala', 'i')")).toBe(true)
    expect(LABEL_COMPARISON.test("if (e.title === 'Training')")).toBe(true)
    // And the shapes it must not catch, which is what keeps it from being
    // deleted as noise.
    expect(SEARCH_CALL.test("filter.kind === 'training'")).toBe(false)
    expect(LABEL_COMPARISON.test("filter.kind === 'training'")).toBe(false)
    expect(CLASSIFYING_REGEX.test("const DEFAULT: EventKind = 'training'")).toBe(false)
    // JSX text is not a regex literal, however much it looks like one.
    expect(CLASSIFYING_REGEX.test('<span><Icon.cone />Training night<Icon.chevR /></span>')).toBe(false)
  })

  it('strips a trailing comment without breaking on a URL', () => {
    // Both halves bit. Leaving trailing comments in made ordinary prose
    // ("// was: label.includes('training'), now in lib/eventKind") fail
    // the build; stripping any // would eat the rest of a line holding an
    // https:// URL, and the string blanking downstream would then see an
    // unterminated quote.
    expect(stripComments("const x = 1 // label.includes('training')").trim()).toBe('const x = 1')
    expect(stripComments("const u = 'https://x.test/a' // note").trim()).toBe("const u = 'https://x.test/a'")
    expect(stripComments('const u = "https://x.test" + b').trim()).toBe('const u = "https://x.test" + b')
    expect(stripComments('a /* mid */ b').replace(/\s+/g, ' ').trim()).toBe('a b')
  })

  it('states what it does not catch, so nobody mistakes it for a proof', () => {
    // Named limits, because an invariant that is trusted beyond its reach
    // is worse than one nobody trusts. Each of these is a real second
    // classifier this test would let through.
    const WALKS_PAST = [
      // The word arrives through a variable rather than a literal.
      "const W = words; W.some((w) => e.title.toLowerCase().includes(w))",
      // The comparison is separated from the label by a call.
      "if (s.name.toLowerCase() === 'training') return true",
      // The word is assembled rather than written.
      "const w = 'gal' + 'a'",
    ]
    for (const src of WALKS_PAST) {
      const missed =
        !SEARCH_CALL.test(src) &&
        !CLASSIFYING_REGEXP_CALL.test(src) &&
        !CLASSIFYING_REGEX.test(blankStrings(src)) &&
        !LABEL_COMPARISON.test(src)
      expect(missed).toBe(true)
    }
  })

  it("no other file tests for Spond's MATCH classification itself", () => {
    // A Match badge is still a classification, and a badge that disagreed
    // with the filter beside it would be worse than no badge at all.
    const offenders: string[] = []
    for (const f of sourceFiles().filter((f) => !isTest(f))) {
      const src = stripComments(readFileSync(join(SRC, f), 'utf8'))
      if (literals(src).some((lit) => lit.trim() === SPOND_MATCH)) offenders.push(f)
    }
    expect(offenders).toEqual([])
  })
})

describe('the shared labels are used, not retyped', () => {
  it('no other file writes the All events label as a literal', () => {
    // Two screens with slightly different words for the same widening is
    // the visible half of two screens with different rules behind it.
    const offenders: string[] = []
    for (const f of sourceFiles().filter((f) => !isTest(f))) {
      const src = stripComments(readFileSync(join(SRC, f), 'utf8'))
      if (literals(src).some((lit) => lit.trim() === 'All events')) offenders.push(f)
    }
    expect(offenders).toEqual([])
  })
})

describe('every surface that filters events reaches the seam', () => {
  // The negative checks above stop a second implementation appearing. This
  // stops the first one quietly disappearing: a refactor that drops the
  // filter from a screen leaves the screen compiling and the product wrong.
  const FILTERING_SURFACES = [
    'routes/Sessions.tsx',
    'routes/Home.tsx',
    'routes/AdminSpond.tsx',
    'components/PlanFromSpond.tsx',
    'components/SpondAttendance.tsx',
  ]

  for (const f of FILTERING_SURFACES) {
    it(`${f} imports the classifier or the filter built on it`, () => {
      const src = readFileSync(join(SRC, f), 'utf8')
      expect(src).toMatch(/from '\.\.\/lib\/(eventKind|eventFilter)'/)
    })
  }
})

describe('every surface opens in the shared default', () => {
  // The seam can hold the right default and a screen can still open on the
  // wrong one, by writing its own literal into useState. These pin the
  // initialiser to the shared constant, which is the mechanical half of
  // "Training first, everywhere". The behavioural half is the acceptance
  // suite in ./trainingFirst.acceptance.test.ts.
  const OPENS_ON: [string, RegExp][] = [
    ['routes/Sessions.tsx', /useState<EventFilterState>\(DEFAULT_EVENT_FILTER\)/],
    ['routes/Home.tsx', /useState<EventFilterState>\(DEFAULT_EVENT_FILTER\)/],
    ['routes/AdminSpond.tsx', /useState<EventKind>\(DEFAULT_EVENT_KIND\)/],
    ['components/PlanFromSpond.tsx', /useState<EventKind>\(DEFAULT_EVENT_KIND\)/],
    ['components/SpondAttendance.tsx', /useState<EventKind>\(DEFAULT_EVENT_KIND\)/],
    ['routes/SessionRegister.tsx', /useState<ResponseFilter>\(DEFAULT_RESPONSE_FILTER\)/],
  ]

  for (const [f, pattern] of OPENS_ON) {
    it(`${f} initialises from the constant, not from a literal of its own`, () => {
      expect(readFileSync(join(SRC, f), 'utf8')).toMatch(pattern)
    })
  }

  // THE CHECK THAT USED TO LIVE HERE, AND WHY IT DOES NOT.
  //
  // A session row cannot carry spond_type, so a session linked to a Spond
  // MATCH is only classified correctly if the screen hands the classifier
  // a lookup. This file tried to enforce that by searching each screen's
  // source for `spondEvents`. An adversarial review broke it both ways in
  // one sitting: an unused destructured prop or a trailing comment
  // satisfied it, while a correctly written `pickNextEvent(sessions, null,
  // lookup)` failed it. Worse, presence anywhere in a file says nothing
  // about WHICH call site uses it, and Home has three: two could be
  // stripped with the whole suite green.
  //
  // A source-text check cannot answer this question, so it no longer
  // pretends to. ../routes/trainingFirst.screens.test.tsx renders the real
  // screens and asserts a linked MATCH is absent from what they show, per
  // call site, which is the actual claim.

  it('Tonight never persists an organisation change outside Save', () => {
    // The product rule this PR turns on: a tick, a Select all and a bib
    // are draft edits, and the only normal path to the database is the
    // Save groups button. The old screen mutated on every row change, so
    // this pins that it does not come back.
    const src = stripComments(readFileSync(join(SRC, 'routes/SessionRegister.tsx'), 'utf8'))
    const setters = [...src.matchAll(/(\w+)\.mutate\(/g)].map((m) => m[1])
    // Only the explicit save, the Spond refresh and the event link may
    // write. Nothing keyed off a row.
    expect([...new Set(setters)].sort()).toEqual(['linkSpond', 'save', 'sync'])
    expect(src).not.toMatch(/useSetRegisterEntry|useRemoveRegisterEntry/)
  })
})

describe('the word list itself', () => {
  it('is lower case and single words, which is what the whole word regex assumes', () => {
    for (const w of NON_TRAINING_WORDS) {
      expect(w).toBe(w.toLowerCase())
      expect(w).not.toMatch(/\s/)
    }
  })
})
