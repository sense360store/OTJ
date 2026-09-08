// =====================================================================
// COACH-11's boundary, pinned mechanically.
//
// A TRIPWIRE, NOT A PROOF. Everything here reads source text, so it
// catches somebody typing the obvious thing: a host inserting a drill on
// its own, a second stash, a navigation to the Drill Maker built by hand,
// an adaptation column arriving a slice early. The behavioural half is
// ../lib/planDrillAuthoring.test.ts and ../lib/authoringReturn.test.ts
// over the pure rules, ./ActivityListEditor.test.tsx at the seam, and
// ../routes/planDrillAuthoring.screens.test.tsx over the real screens.
// =====================================================================
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(import.meta.dirname, '..')
const read = (f: string) => readFileSync(join(SRC, f), 'utf8')
// Comments out, code in. Block comments are matched only where one OPENS a
// line: the drill form's file accept list carries `image/*`, and a stripper
// that reads that as a comment opener swallows everything up to the next
// closer, which is how the first version of this file found no insert call.
const code = (src: string) =>
  src
    .replace(/^\s*\{?\/\*[\s\S]*?\*\/\}?/gm, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n')

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    return statSync(full).isDirectory() ? walk(full) : [full]
  })
}
const sourceFiles = walk(SRC).filter((f) => /\.(ts|tsx)$/.test(f) && !f.includes('.test.'))
const rel = (f: string) => f.slice(SRC.length + 1)

const PLANNER = 'routes/Planner.tsx'
const TEMPLATE = 'components/TemplateFormModal.tsx'
const HOOK = 'components/PlanDrillAuthoring.tsx'
const SEAM = 'components/ActivityListEditor.tsx'
const RULES = 'lib/planDrillAuthoring.ts'
const RETURN = 'lib/authoringReturn.ts'
const EDITOR = 'routes/DrillDiagramEditor.tsx'

describe('one hook, both hosts', () => {
  it('both planning hosts create drills through usePlanDrillAuthoring and hand the seam its callbacks', () => {
    for (const f of [PLANNER, TEMPLATE]) {
      const src = code(read(f))
      expect(src, f).toMatch(/usePlanDrillAuthoring</)
      expect(src, f).toMatch(/onNewDrill=\{/)
      expect(src, f).toMatch(/onTurnIntoDrill=\{/)
      expect(src, f).toContain('{authoring.modal}')
      expect(src, f).toContain('{authoring.note}')
    }
  })

  it('neither host inserts a drill, opens the drill form, or builds the Drill Maker address itself', () => {
    for (const f of [PLANNER, TEMPLATE]) {
      const src = code(read(f))
      expect(src, f).not.toMatch(/useInsertDrill/)
      expect(src, f).not.toMatch(/<DrillFormModal/)
      expect(src, f).not.toMatch(/\/diagram/)
      expect(src, f).not.toMatch(/sessionStorage/)
    }
  })

  it('the seam renders the affordances and knows nothing about what they do', () => {
    const src = code(read(SEAM))
    expect(src).toContain('New drill')
    expect(src).toContain('Turn into a drill')
    expect(src).not.toMatch(/useInsertDrill|DrillFormModal|leaveToDraw|stashDraft|navigate/)
    // Still hook free: the COACH-10 invariant, restated for this slice.
    expect(src).not.toMatch(/\buse[A-Z]\w*\(/)
  })

  it('the return trip is read by the planner and by the one restorer of the week plan editor', () => {
    // The planner's draft is the session AND which of its two seeded fields
    // were settled when the coach left (PlannerDraft), which is why the type
    // argument is not Session. See the seed pins in
    // ../lib/newSessionCoverage.invariant.test.ts.
    expect(code(read(PLANNER))).toMatch(/useAuthoringReturn<PlannerDraft>\('planner'\)/)
    expect(code(read(PLANNER))).toMatch(/readPlannerDraft\(returned\.draft\)/)
    expect(code(read('components/RestoredTemplateEditor.tsx'))).toMatch(/useAuthoringReturn<TemplateInput>\('template'\)/)
    for (const f of ['routes/Templates.tsx', 'routes/ProgrammeDetail.tsx']) {
      expect(code(read(f)), f).toMatch(/<RestoredTemplateEditor templates=\{templates\} \/>/)
    }
  })
})

describe('the stash and the way back have one implementation', () => {
  it('session storage is touched in authoringReturn.ts and nowhere else', () => {
    const offenders = sourceFiles.filter((f) => rel(f) !== RETURN && /sessionStorage/.test(code(read(rel(f)))))
    expect(offenders.map(rel)).toEqual([])
  })

  it('the Drill Maker address is built by drawPath and nowhere else', () => {
    const offenders = sourceFiles.filter((f) => rel(f) !== RETURN && /\/diagram\?/.test(code(read(rel(f)))))
    expect(offenders.map(rel)).toEqual([])
    expect(code(read(RULES))).toMatch(/navigate\(drawPath\(/)
  })

  it('the stash lands before the navigation, and a failed stash never navigates', () => {
    const src = code(read(RULES))
    const stash = src.indexOf('stashDraft(')
    const nav = src.indexOf('navigate(drawPath(')
    expect(stash).toBeGreaterThan(-1)
    expect(nav).toBeGreaterThan(stash)
    expect(src.slice(stash, nav)).toMatch(/if \(!stashed\) return 'stash_failed'/)
  })

  it('the Drill Maker reads its way back through safeReturnPath, once, and every Back uses it', () => {
    const src = code(read(EDITOR))
    expect(src.match(/safeReturnPath\(/g)).toHaveLength(1)
    expect(src).not.toMatch(/search\.get\((?!RETURN_PARAM)/)
    // No Back left on the old fixed destination: each one goes through the
    // one resolved address, or falls back only when there is none.
    expect(src).not.toMatch(/navigate\(`\/drill\/\$\{drill\.id\}`\)/)
    expect(src).not.toMatch(/navigate\(`\/drill\/\$\{drillId\}`\)/)
    expect(src).not.toMatch(/navigate\('\/library'\)/)
    expect(src).toMatch(/const backLabel = returnTo \? BACK_TO_PLAN : BACK_TO_DRILL/)
  })

  it('the allowlist is by prefix and names the three surfaces this flow comes from', () => {
    const src = code(read(RETURN))
    expect(src).toMatch(/RETURN_PREFIXES = \['\/planner', '\/templates', '\/programmes\/'\]/)
  })
})

describe('no COACH-12 or COACH-13 semantics have leaked in', () => {
  it('names no adaptation, listing or promotion concept anywhere under src', () => {
    // variant_of and library_listed are COACH-12's columns; an unlisted or
    // adapted drill is its concept; promotion is COACH-13's. None of them
    // exists yet, and creating a drill from a plan produces an ordinary
    // library drill, so none of these words may appear in shipped code.
    const offenders: string[] = []
    for (const f of sourceFiles) {
      const src = code(read(rel(f)))
      for (const word of ['variant_of', 'variantOf', 'library_listed', 'libraryListed', 'unlisted', 'adaptation_of', 'promoteToTemplate']) {
        if (src.includes(word)) offenders.push(`${rel(f)}: ${word}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('the created drill is the same insert the Library uses, with no extra column', () => {
    // The form's plan mode calls insert.mutate with the form input and
    // nothing else; the plan learns the phase through the callback, never
    // the row.
    const src = code(read('components/DrillFormModal.tsx'))
    expect(src).toMatch(/insert\.mutate\(input, \{\s*onSuccess: \(created\) => plan\.onCreated\(created, \{ phase, duration: form\.duration \}, what\)/)
    expect(src).not.toMatch(/phase:\s*phase[,\s}]/)
    expect(src).not.toMatch(/\.\.\.form,\s*phase/)
  })

  it('the hook reads exactly two capabilities, both of them already existing', () => {
    // It read one until Codex's second round. The affordances still need
    // drills.create and nothing else; Save and draw it additionally needs
    // whatever the Drill Maker ROUTE is gated on, because it navigates
    // there. Neither is new and neither is granted here: the second is
    // read only to WITHHOLD an action, never to widen one.
    const src = code(read(HOOK))
    expect(src).toMatch(/DRILL_CREATE_CAP = 'drills\.create'/)
    expect(src).toMatch(/DRILL_MAKER_ROUTE_CAP = 'sessions\.create'/)
    expect(src).toMatch(/caps\.has\(DRILL_CREATE_CAP\)/)
    expect(src).toMatch(/caps\.has\(DRILL_MAKER_ROUTE_CAP\)/)
    // Read through the named constants, never as a bare literal, so the
    // check below can compare one spelling against the route.
    expect(src).not.toMatch(/caps\.has\('/)
  })

  it('the route capability it withholds on is the one App.tsx actually gates the Drill Maker with', () => {
    // The whole point of withholding rather than widening is that the two
    // agree. If the route guard moves and this constant does not, the hook
    // either offers a trip that bounces (the defect Codex found) or hides
    // one that would have worked. Read from App.tsx rather than restated.
    const app = code(read('App.tsx'))
    const m = app.match(/<Route element=\{<RequireCap cap="([^"]+)" \/>\}>\s*<Route path="\/drill\/:id\/diagram"/)
    expect(m, 'the Drill Maker route guard was not found in App.tsx').toBeTruthy()
    expect(code(read(HOOK))).toMatch(new RegExp(`DRILL_MAKER_ROUTE_CAP = '${m![1].replace('.', '\\.')}'`))
  })

  it('the render half only looks, and the removal sits in an effect', () => {
    // Codex, fourth finding. takeDraft READS AND REMOVES, and it used to be
    // called from a lazy useState initializer, which React runs during
    // render and may run twice (StrictMode) or abandon before committing.
    // The only copy could be destroyed on a render nobody adopted. The
    // initializer now calls the pure peekDraft and dropDraft happens in an
    // effect; a destructive call reaching the render again is what this
    // refuses. It cannot see a removal hidden behind a local helper, which
    // the pure suite's abandoned-render test covers instead.
    const src = code(read(HOOK))
    expect(src).toMatch(/useState\(\(\) =>\s*\n?\s*mountUserId && arrivedWith\s*\n?\s*\? peekDraft</)
    expect(src).toMatch(/useEffect\(\(\) => \{[\s\S]{0,200}?dropDraft\(browserSessionStorage\(\)\)/)
    // takeDraft is the combined one shot and has no business in a render.
    expect(src).not.toMatch(/takeDraft/)
  })

  it('the token leaves the address once, and by a push when a draft was adopted', () => {
    // Codex, sixth finding. The pop leaves the Drill Maker as the FORWARD
    // entry, and a replace left it reachable: Forward reopened it and its own
    // Back landed on a plan whose token had gone and whose stash had been
    // taken, so the restored draft was rebuilt away from saved data. A push
    // truncates the forward entries. The ref is the other half: the effect
    // wakes on every params change, so without it the Back onto the tokenised
    // entry pushes again and the coach cannot leave the planner.
    const src = code(read(HOOK))
    expect(src).toMatch(/const stripped = useRef\(false\)/)
    expect(src).toMatch(/if \(stripped\.current \|\| !arrivedWith/)
    expect(src).toMatch(/setParams\(next, \{ replace: !taken \}\)/)
  })

  it('the Drill Maker pops back to the plan, and only on its own push', () => {
    // Codex, fifth finding. Popping is what stops the stranded tokenised
    // entry; the marker is what stops a cold or pasted link popping into
    // whatever preceded the app. Both halves must be present: a pop with no
    // marker check strands a deep link, and a marker check that still
    // pushes fixes nothing.
    const src = code(read('routes/DrillDiagramEditor.tsx'))
    expect(src).toMatch(/const cameFromPlan = !!returnTo && isFromPlanEntry\(location\.state\)/)
    expect(src).toMatch(/if \(cameFromPlan\) navigate\(-1\)/)
    // And the push that put it there carries the marker.
    expect(code(read('lib/planDrillAuthoring.ts'))).toMatch(/drawPath\(drillId, returnTo\), \{ state: FROM_PLAN_STATE \}/)
  })
})

describe('what this file cannot catch', () => {
  it('cannot see a navigation built through a variable, or a stash written under another key', () => {
    // A host that assembles '/drill/' + id + '/diagram' walks past the
    // address check, and a second storage key walks past the word
    // sessionStorage only if it also avoids the word. What holds the line
    // is the pure suites and the screens test, plus review.
    expect(true).toBe(true)
  })
})
