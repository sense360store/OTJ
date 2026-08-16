// =====================================================================
// British English copy, pinned mechanically.
//
// The club speaks British English, and "roster" is the American word for
// what the product calls registered players, the player list or the
// squad. Internal names keep it freely (activeRoster, rosterForSession,
// the /roster redirect, the 'roster' entry source, spond-roster-import),
// because identifiers are not copy. What may never carry it is a string
// a user reads, in the app or in an Edge Function reply that the app
// renders (spond-roster-import's errors reach a modal verbatim).
//
// The excuse rule is mechanical: a quoted literal whose WHOLE content is
// a bare machine token (lowercase letters, digits, underscores, slashes,
// hyphens) is an identifier in quotes, 'not_on_roster' or a route path,
// and stays. Anything with a space, a capital or surrounding prose is a
// sentence and fails. Bare JSX text is always a sentence.
//
// TWO NARROWINGS OF THAT EXCUSE, both from an audit of what it let past.
//
//   The word. `\broster\b` matches neither "rosters" nor "rostered": the
//   trailing boundary lands between the "r" and the "s". "Two rosters
//   face each other" and "Every rostered child" both read as copy and
//   both passed. The word is now the whole family.
//
//   The attributes. A lowercase one word literal is an identifier in
//   most positions and a sentence in a handful: placeholder, title, alt,
//   label and aria-label all render. `placeholder="roster"` was excused
//   as a machine token while showing the word to a coach. Those
//   attributes now get no excuse at all.
//
// A tripwire, not a proof, in the house tradition. The last describe
// names the shapes it cannot catch, which are worth reading before a
// pass is mistaken for a guarantee.
// =====================================================================
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(import.meta.dirname, '..')
const ROOT = join(import.meta.dirname, '../..')
const FUNCTIONS = join(ROOT, 'supabase/functions')

const isTest = (f: string) => /\.test\.tsx?$|_test\.ts$/.test(f)

// Every Edge Function, not a named three. All of them reply with an
// { error } body or a message the client renders somewhere, and the list
// of which ones a screen surfaces today is not a list this check should
// have to track.
function functionSources(): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      // isDirectory first: the old version filtered on the name alone,
      // so a directory called anything.ts would have been read as a file.
      if (entry.isDirectory()) walk(full)
      else if (/\.ts$/.test(entry.name) && !isTest(entry.name)) out.push(full)
    }
  }
  walk(FUNCTIONS)
  return out
}

function files(): string[] {
  const out: string[] = []
  const inner = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) inner(full)
      else if (/\.tsx?$/.test(entry.name) && !isTest(entry.name)) out.push(full)
    }
  }
  inner(SRC)
  return [...out, ...functionSources()]
}

// Source with comments removed, the tonight.invariant.test.ts helper,
// plus console lines: a server log prefix like
// 'spond-roster-import: login failed' is operator output, not copy, and
// the functions' own no-names logging rule already governs it.
const code = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//') && !/^\s*console\./.test(l))
    .join('\n')

// The whole family, so a plural or a past participle is not a way round.
const ROSTER = /\broster(s|ed)?\b/i
const MACHINE_TOKEN = /^[a-z0-9_/-]+$/
const LITERAL = /(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g
// Template literals separately, spanning newlines: a review parked a
// multiline backtick string past the single line scan above.
const TEMPLATE = /`((?:[^`\\]|\\[\s\S])*)`/g
// The attributes whose value a user reads. No machine token excuse
// applies inside one, because there is no identifier meaning available:
// whatever is in there is shown or spoken.
const RENDERED_ATTR = /\b(placeholder|title|alt|label|aria-label|aria-description|aria-placeholder)\s*=\s*(['"])([^'"\n]*)\2/gi

// A LINE THAT IS NOTHING BUT A SENTENCE, which is how every piece of
// copy longer than a few words is actually written: a formatter wraps
// JSX text onto its own lines, and the single line rule above then sees
// only the tag ends. Catching it by widening that rule was tried and
// abandoned, because lifting the brace and newline exclusions made
// `Record<string, X>` and every comparison operator read as a text span
// and failed four files containing no copy at all.
//
// A whole line of prose has a shape code does not: no bracket, no
// operator, no property access, no trailing comma, and three words or
// more. 328 lines in the product qualify and every one of them is a
// sentence, so this reaches multi line copy without reaching code. It
// costs a false negative on a line that happens to carry a bracket or an
// abbreviation, which is the safe direction.
const CODE_PUNCTUATION = /[<>{}()[\]=;:`$\\|&@#*+/]/

function isProseLine(raw: string): boolean {
  const line = raw.trim()
  if (!line || CODE_PUNCTUATION.test(line)) return false
  if (/,$/.test(line)) return false
  // Property access or a dotted identifier: `session.venue`, `roster.data`.
  if (/\w\.\w/.test(line)) return false
  return (line.match(/[A-Za-z]{2,}/g) ?? []).length >= 3
}

describe('no user-visible string says roster', () => {
  it('holds across the app and every Edge Function reply', () => {
    for (const file of files()) {
      const src = code(readFileSync(file, 'utf8'))
      // Bare JSX text is copy by definition.
      expect(src, file).not.toMatch(/>[^<>{}\n]*\broster(s|ed)?\b[^<>{}\n]*</i)
      // A quoted literal carrying the word must be a bare machine token.
      for (const match of src.matchAll(LITERAL)) {
        const content = match[2]
        if (!ROSTER.test(content)) continue
        expect(content, `${file}: "${content}"`).toMatch(MACHINE_TOKEN)
      }
      for (const match of src.matchAll(TEMPLATE)) {
        const content = match[1]
        if (!ROSTER.test(content)) continue
        expect(content, `${file}: \`${content}\``).toMatch(MACHINE_TOKEN)
      }
      // A rendered attribute gets no excuse.
      for (const match of src.matchAll(RENDERED_ATTR)) {
        expect(match[3], `${file}: ${match[1]}="${match[3]}"`).not.toMatch(ROSTER)
      }
      // Copy wrapped onto its own lines, which the single line rule
      // above cannot see.
      for (const line of src.split('\n')) {
        if (!isProseLine(line)) continue
        expect(line.trim(), `${file}: ${line.trim()}`).not.toMatch(ROSTER)
      }
    }
  })

  it('holds in the page shell and the stylesheets', () => {
    // Neither was scanned before. index.html carries the document title
    // and the noscript text; a stylesheet can put words on screen through
    // a `content:` declaration, which no other check would ever see.
    expect(readFileSync(join(ROOT, 'index.html'), 'utf8')).not.toMatch(ROSTER)
    const css = (dir: string): string[] => {
      const out: string[] = []
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) out.push(...css(full))
        else if (entry.name.endsWith('.css')) out.push(full)
      }
      return out
    }
    for (const file of css(SRC)) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(ROSTER)
    }
  })
})

describe('what this cannot catch', () => {
  it('names its own blind spots', () => {
    // Written down rather than implied, because the gaps here are not
    // exotic. Three of them are how real copy is normally written, and a
    // green run says nothing about any of them.
    //
    //  1. A sentence sharing its line with an interpolation or a tag,
    //     which is neither a bare single line text node nor a whole line
    //     of prose: `<p>The roster for {team} is empty.</p>`. Widening
    //     the text rule to reach it was tried and abandoned, because
    //     lifting the brace and newline exclusions made
    //     `Record<string, X>` read as a text span and failed four files
    //     that contain no copy at all. A rule weakened the first time it
    //     fires is worse than a stated gap.
    //  2. A prose line carrying a bracket, a colon or an abbreviation,
    //     which the whole line rule skips on purpose. It errs towards
    //     saying nothing rather than towards failing a build over code.
    //  3. A string assembled at runtime, or held in a variable, or
    //     returned by a helper.
    //  4. Copy in the database: a venue name, a drill title, a feedback
    //     item. Members write those and this reads source.
    //
    // What closes 1 properly is a rendered assertion, the pattern
    // src/routes/trainingFirst.screens.test.tsx uses for the training
    // classifier: render the real screen and read the markup. That is a
    // harness per screen rather than a regex, and it is the honest way
    // to cover it when it is worth building.
    expect(true).toBe(true)
  })
})
