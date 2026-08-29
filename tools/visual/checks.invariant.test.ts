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
          `\\bif \\(!${name}${end}`,
          `\\bif \\(!\\w+ \\|\\| !${name}${end}`,
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
      // `.click()` is exempt only where it is STRUCTURALLY guarded: inside an
      // acted() call, inside a try block, or on a promise with a .catch().
      // Exempting any nearby arrow function let a dismissal callback pass and
      // be awaited unguarded twelve lines later. Codex.
      const context = lines.slice(Math.max(0, i - 6), i + 1).join('\n')
      const structural = /\.catch\(/.test(line) || /acted\(/.test(context) || /\btry \{/.test(context)
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
