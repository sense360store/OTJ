/// <reference types="node" />
// =====================================================================
// The browser check runner's own safety property, pinned.
//
// WHY THIS EXISTS. One class of defect came back four times on the pull
// request that added the Activity checks, each time one level below where
// the last fix had looked: a Playwright action or a page read that rejects
// or throws on a control that is not there, which ends the run. That is
// worse than a failing check, because `checks.mjs` is a long sequence of
// independent blocks and an abort skips every one after it. Twice it
// reported NOTHING at all, which reads exactly like a clean run that
// happened to exit non zero.
//
// The structural fixes are in `checks.mjs` itself: results print as they
// are recorded, an abort is a named failure through handlers for both
// process events, and `open()` records a blank surface and marks the page.
// This file pins the remaining half, which is a habit rather than a
// mechanism: every query result is guarded before it is used.
//
// WHAT IT CANNOT CATCH, stated rather than implied. It reads source text,
// so it sees the shapes somebody types, not the ones a value reaches
// through a helper or a variable two scopes up. A pass means "nobody wrote
// the obvious thing", never "the runner cannot abort".
// =====================================================================
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const src = readFileSync(fileURLToPath(new URL('./checks.mjs', import.meta.url)), 'utf8')
const lines = src.split('\n')

// Comments, strings, template literals and regex literals blanked to spaces,
// so the delimiter walk below counts code rather than punctuation inside a
// selector. Offsets are preserved, so a position still maps to its own line.
// Is the `/` at this offset the start of a regex literal rather than a
// division? Decided by the token before it: an operator, an opening
// delimiter, a line start, `=>`, or a keyword that can only be followed by an
// expression. The first version listed punctuation alone, so a regex after
// `=>` or `return` was read as division and its brackets were counted as
// structure. Codex.
const EXPRESSION_KEYWORDS = /\b(return|typeof|instanceof|in|of|case|do|else|yield|await|new|delete|void|throw)$/
function regexPosition(text: string, at: number): boolean {
  let k = at - 1
  while (k >= 0 && (text[k] === ' ' || text[k] === '\t')) k--
  if (k < 0) return true
  const c = text[k]
  if ('=(,:[!&|?{};+-*%<>~^'.includes(c) || c === '\n') return true
  return EXPRESSION_KEYWORDS.test(text.slice(Math.max(0, k - 12), k + 1))
}

function blanked(text: string): string {
  const out = text.split('')
  let i = 0
  const blank = (from: number, to: number) => {
    for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = ' '
  }
  while (i < text.length) {
    const c = text[i]
    const two = text.slice(i, i + 2)
    if (two === '//') {
      const end = text.indexOf('\n', i)
      blank(i, end === -1 ? text.length : end)
      i = end === -1 ? text.length : end
    } else if (two === '/*') {
      const end = text.indexOf('*/', i + 2)
      blank(i, end === -1 ? text.length : end + 2)
      i = end === -1 ? text.length : end + 2
    } else if (c === '"' || c === "'" || c === '`') {
      let j = i + 1
      while (j < text.length && text[j] !== c) j += text[j] === '\\' ? 2 : 1
      blank(i, Math.min(j + 1, text.length))
      i = j + 1
    } else if (c === '/' && regexPosition(text, i)) {
      // A regex literal, scanned properly: a `/` inside a character class does
      // not close it, so `/[/]/` and `/[(]/` are one token rather than two
      // delimiters left on the stack. Codex.
      let j = i + 1
      let inClass = false
      while (j < text.length && text[j] !== '\n') {
        if (text[j] === '\\') { j += 2; continue }
        if (text[j] === '[') inClass = true
        else if (text[j] === ']') inClass = false
        else if (text[j] === '/' && !inClass) break
        j++
      }
      if (text[j] === '/') {
        blank(i, j + 1)
        i = j + 1
      } else i++
    } else i++
  }
  return out.join('')
}

// Which lines are LEXICALLY inside a `try { … }` block or an `acted( … )`
// call, by walking the delimiters rather than by looking a few lines up. A
// window accepted a click that followed a try block which had already closed.
// Codex.
const guardedLines = (() => {
  const code = blanked(src)
  const marked = new Set<number>()
  const stack: boolean[] = []
  let line = 0
  for (let i = 0; i < code.length; i++) {
    const c = code[i]
    if (c === '\n') {
      line++
      if (stack.some(Boolean)) marked.add(line)
      continue
    }
    if (c === '{' || c === '(' || c === '[') {
      const before = code.slice(Math.max(0, i - 8), i)
      stack.push((c === '{' && /\btry\s*$/.test(before)) || (c === '(' && /\bacted$/.test(before)))
      if (stack.some(Boolean)) marked.add(line)
    } else if (c === '}' || c === ')' || c === ']') {
      stack.pop()
    }
  }
  return marked
})()

describe('a missing control fails its own check rather than ending the run', () => {
  it('dereferences no query result without guarding it first', () => {
    // The two shapes that actually shipped: a query dereferenced on the spot,
    // and a query bound to a name that is then used without a check. A guard
    // is `if (!x)`, `x ?`, `!!x` or `x?.`, which is every form the file uses.
    const offenders: string[] = []
    // ANY receiver, not only `document`: a query is just as likely to be
    // scoped to an element already in hand, and `m.querySelector(…).textContent`
    // throws exactly the same way. Codex.
    const direct = /(\w+\.querySelector\([^)]*\)|\.closest\([^)]*\))\.(?!\?)[a-zA-Z]/
    lines.forEach((line, i) => {
      if (line.trim().startsWith('//')) return
      // The explicit ternary form guards itself: `q('x') ? q('x').y : null`.
      if (direct.test(line) && !/\)\s*\?\s*\w+\.querySelector/.test(line)) {
        offenders.push(`${i + 1}: ${line.trim().slice(0, 90)}`)
      }
    })

    const bind = /const (\w+) = (?:document\.querySelector\(|\[\.\.\.[^\]]*\]\.find\()/
    lines.forEach((line, i) => {
      const m = bind.exec(line)
      if (!m) return
      const name = m[1]
      let guarded = false
      // A guard has to END at the name. `!!x` is a guard; `!!x.getAttribute(…)`
      // is the unsafe expression itself, and \b matches immediately before the
      // dot, so the loose form accepted the very thing it exists to reject.
      // Codex. The lookahead is what makes the difference.
      const end = '(?![\\w.[])'
      const guards = new RegExp(
        [
          // The `if (…) return` form is decided by `exits()` below rather
          // than here: whether it guards depends on how the condition is
          // JOINED, and a regex cannot say that.
          `\\b${name}${end} \\?`,
          `!!${name}${end}`,
          `\\b${name}\\?\\.`,
          `\\breturn ${name}\\s*$`,
        ].join('|'),
      )
      const unsafe = new RegExp(`\\b${name}\\.[a-zA-Z]`)

      // An `if (…) return` branch guards the name only when the condition is a
      // DISJUNCTION of bare negations that includes it. `if (!a || !b) return`
      // leaves both present afterwards; `if (!a && !b) return` leaves b
      // possibly null whenever a is present, and a pattern that merely finds
      // `!b` inside the condition accepts it. Codex. So the condition is split
      // and every term has to be a bare `!ident`.
      const exits = (text: string): boolean => {
        const m = /\bif \((.*)\)\s*(?:return|throw|continue|break)\b/.exec(text)
        if (!m) return false
        const terms = m[1].split('||')
        return terms.every((t) => /^\s*!\w+\s*$/.test(t)) && terms.some((t) => t.trim() === `!${name}`)
      }
      for (let j = i + 1; j < Math.min(i + 15, lines.length); j++) {
        const next = lines[j]
        // POSITION matters, not merely presence. `return el ? el.value : null`
        // guards itself because the check comes first on the line, while
        // `return !!live.getAttribute(…)` is the unsafe expression wearing a
        // guard's shape. Comparing indices is what separates them; testing for
        // a guard anywhere on the line accepted the second, and testing the
        // dereference first rejected the first.
        const at = next.search(unsafe)
        const guardAt = exits(next) ? next.indexOf('if (') : next.search(guards)
        if (guardAt !== -1 && (at === -1 || guardAt < at)) guarded = true
        if (!guarded && at !== -1) {
          offenders.push(`${j + 1}: ${next.trim().slice(0, 90)}`)
          break
        }
        if (next.trim() === '})' || next.trim() === '}') break
      }
    })

    expect(offenders).toEqual([])
  })

  it('takes every action through the guarded helpers', () => {
    // A press, a focus and a selection all reject on a control that is not
    // there. Each has a helper that records the failure and returns false;
    // calling Playwright's method directly is how the selection in the filter
    // dialog ended a run after its opener had already failed.
    const offenders: string[] = []
    lines.forEach((line, i) => {
      if (line.trim().startsWith('//') || line.trim().startsWith('*')) return
      // The helpers themselves, and the two drivers this file imports, are
      // where the raw calls legitimately live.
      if (/const (pressed|focused|chose|acted) =/.test(line)) return
      // setInputFiles is the fourth: it is how a file reaches a picker and it
      // rejects on a missing input exactly like the rest. It has no caller in
      // this file today; it is listed for the same reason check and uncheck
      // are, so the first one written has to go through a helper.
      if (/\.(selectOption|fill|check|uncheck|setInputFiles)\(/.test(line) && !/acted\(/.test(line)) {
        offenders.push(`${i + 1}: ${line.trim().slice(0, 90)}`)
      }
      // `.click()` is exempt only where it is LEXICALLY inside an acted()
      // call or an open try block, or where it carries its own .catch(). A
      // six line window exempted a click that merely followed a closed try
      // block or an unrelated acted() call. Codex.
      const structural = /\.catch\(/.test(line) || guardedLines.has(i)
      if (/\.click\(\)/.test(line) && !structural) {
        offenders.push(`${i + 1}: ${line.trim().slice(0, 90)}`)
      }
    })
    expect(offenders).toEqual([])
  })

  it('reports an abort as a named failure on both process events', () => {
    // A rejected top level await reaches Node as an uncaught exception, not
    // as an unhandled rejection, so a handler for the second alone never
    // fires. That is not a hypothetical: it is what the first attempt did.
    expect(src).toContain("process.on('unhandledRejection', aborted)")
    expect(src).toContain("process.on('uncaughtException', aborted)")
  })

  it('prints each result as it is recorded rather than only at the end', () => {
    // The single change that turns "the run reported nothing" into "the run
    // reported everything up to the abort".
    const body = src.slice(src.indexOf('const check = '), src.indexOf('process.on('))
    expect(body).toContain('console.log(line)')
  })

  it('records a surface that never painted, and marks the page so later reads skip it', () => {
    expect(src).toContain('page.blank = !painted')
    expect(src).toContain('if (page.blank) return null')
  })
})

// =====================================================================
// The three tools measure the build on disk, and the build is of the
// source on disk.
//
// A measurement about the wrong build is the same class of defect as a
// screenshot filed under a state it never reached: present, plausible and
// evidence for nothing. `fresh.mjs` refuses both cases, and a tool that
// stopped calling it would report a clean run against whatever the preview
// happened to be serving.
// =====================================================================
describe('every tool refuses to measure a stale build', () => {
  const tools = ['checks.mjs', 'shoot.mjs', 'contrast.mjs'] as const

  for (const tool of tools) {
    it(`${tool} asserts the served build before it measures anything`, () => {
      const text = readFileSync(fileURLToPath(new URL(`./${tool}`, import.meta.url)), 'utf8')
      expect(text).toContain("from './fresh.mjs'")
      const call = text.indexOf('assertServingCurrentBuild(BASE)')
      expect(call, 'the guard is called').toBeGreaterThan(-1)
      // Before the browser launches, so a stale run costs nothing and cannot
      // half-finish.
      expect(call).toBeLessThan(text.indexOf('chromium.launch('))
    })
  }

  it('checks the build against its source, not only against the server', () => {
    // Two different staleness failures, and only the second was here first.
    // A preview started before a build serves unlinked files; a build older
    // than the source measures the previous rule, which needs no mistake at
    // all to cause. Both halves are asserted so neither can be dropped as
    // redundant.
    const fresh = readFileSync(fileURLToPath(new URL('./fresh.mjs', import.meta.url)), 'utf8')
    expect(fresh).toContain('STALE SERVER')
    expect(fresh).toContain('STALE BUILD')
    // The bundle's inputs, listed rather than globbed: a sweep of
    // tools/visual would make every check runner its own input and the guard
    // would cry stale on every edit until somebody deleted it.
    for (const input of ['src', 'tools/visual/main.tsx', 'tools/visual/fixtures.ts', 'tools/visual/stubs']) {
      expect(fresh, `${input} is a bundle input`).toContain(`'${input}'`)
    }
    expect(fresh, 'the drive modules are not').not.toContain("'tools/visual/account.mjs'")
    expect(fresh, 'nor the runners').not.toContain("'tools/visual/checks.mjs'")
  })

  it('counts the files the OUTPUT depends on without any source moving', () => {
    // Vite reads target, jsx, jsxImportSource and verbatimModuleSyntax out of
    // the TypeScript configs while it transforms, so changing one of those
    // emits different JavaScript from unchanged source; and the dependency
    // versions decide what is bundled with it. Codex found the configs, which
    // is the case my own hand written list had already gone out of date on.
    const fresh = readFileSync(fileURLToPath(new URL('./fresh.mjs', import.meta.url)), 'utf8')
    // EVERY tsconfig at the repo root, read from disk rather than named here,
    // because a new one appearing is how this list goes quietly out of date.
    const root = fileURLToPath(new URL('../..', import.meta.url))
    const configs = readdirSync(root).filter((f) => /^tsconfig.*\.json$/.test(f))
    expect(configs.length, 'there is at least one tsconfig to check').toBeGreaterThan(0)
    for (const config of configs) {
      expect(fresh, `${config} is a bundle input`).toContain(`'${config}'`)
    }
    for (const manifest of ['package.json', 'package-lock.json']) {
      expect(fresh, `${manifest} is a bundle input`).toContain(`'${manifest}'`)
    }
  })
})
