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
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const src = readFileSync(fileURLToPath(new URL('./checks.mjs', import.meta.url)), 'utf8')
const lines = src.split('\n')

// Comments, strings, template literals and regex literals blanked to spaces,
// so the delimiter walk below counts code rather than punctuation inside a
// selector. Offsets are preserved, so a position still maps to its own line.
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
    } else if (c === '/' && /[=(,:[!&|?{;\n]\s*$/.test(text.slice(Math.max(0, i - 12), i))) {
      // A regex literal, distinguished from division by what precedes it.
      let j = i + 1
      while (j < text.length && text[j] !== '/' && text[j] !== '\n') j += text[j] === '\\' ? 2 : 1
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
    const direct = /(document\.querySelector\([^)]*\)|\.closest\([^)]*\))\.(?!\?)[a-zA-Z]/
    lines.forEach((line, i) => {
      if (line.trim().startsWith('//')) return
      // The explicit ternary form guards itself: `q('x') ? q('x').y : null`.
      if (direct.test(line) && !/\)\s*\?\s*document\.querySelector/.test(line)) {
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
          // An `if (!x)` branch is only a guard when it PREVENTS what follows.
          // `if (!live) check('missing', false)` records a failure and then
          // falls through to the dereference, which still ends the run. Codex.
          // The condition may name others beside it, in either order.
          `\\bif \\([^)]*!${name}${end}[^)]*\\)\\s*(?:return|throw|continue|break)\\b`,
          `\\b${name}${end} \\?`,
          `!!${name}${end}`,
          `\\b${name}\\?\\.`,
          `\\breturn ${name}\\s*$`,
        ].join('|'),
      )
      const unsafe = new RegExp(`\\b${name}\\.[a-zA-Z]`)
      for (let j = i + 1; j < Math.min(i + 15, lines.length); j++) {
        const next = lines[j]
        // POSITION matters, not merely presence. `return el ? el.value : null`
        // guards itself because the check comes first on the line, while
        // `return !!live.getAttribute(…)` is the unsafe expression wearing a
        // guard's shape. Comparing indices is what separates them; testing for
        // a guard anywhere on the line accepted the second, and testing the
        // dereference first rejected the first.
        const at = next.search(unsafe)
        const guardAt = next.search(guards)
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
      if (/\.(selectOption|fill|check|uncheck)\(/.test(line) && !/acted\(/.test(line)) {
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
