/// <reference types="node" />
// =====================================================================
// COACH-14A's tripwire: the guide stays a VIEW over the one session.
//
// WHAT THIS IS. A source text check, in the style of
// eventKind.invariant and sessionLifecycle.invariant, and it carries
// their caveat: it catches the realistic mistakes, the ones somebody
// types in a hurry, and it cannot see a value that reaches the same
// place through a variable or a helper. A pass means "nobody typed the
// obvious thing", never "the guide cannot become a second planner".
// The last describe names the shapes it knows it cannot catch.
//
// WHY THESE RULES AND NOT OTHERS. Each one is a defect that would be
// cheap to introduce, expensive to notice, and invisible in review:
//
//   a second draft          a useState<Session> in the guide, and the
//                           two surfaces stop being one plan.
//   a second persistence    a stash, a localStorage key or a save of
//                           its own, and "nothing persists until Save"
//                           stops being true of the guided path.
//   a second save           an upsert or a mutation reached from the
//                           guide, and the guarded submit that stops
//                           two writes crossing is bypassed.
//   a second composer       an ActivityListEditor mounted here, and the
//                           roadmap's one visible timeline becomes two.
//   a second station rule   a slot literal or a station count of its
//                           own, and the structure module stops being
//                           the one answer.
//   a gate                  the entry choice rendered INSTEAD of the
//                           planner rather than above it, and the
//                           manual planner needs a press to reach.
// =====================================================================
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { GUIDED_STEPS, SESSION_SHAPES } from './guidedSession'

const SRC = join(import.meta.dirname, '..')

const RULES = 'lib/guidedSession.ts'
const VIEW = 'components/GuidedPlanner.tsx'
const SHEET = 'components/GuidedPlanner.css'
const HOST = 'routes/Planner.tsx'

// Comments argue the rules on both sides of them, and prose is not code.
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
}

const read = (f: string) => stripComments(readFileSync(join(SRC, f), 'utf8'))
const raw = (f: string) => readFileSync(join(SRC, f), 'utf8')

function tsFiles(root: string, prefix = ''): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) return tsFiles(join(root, entry.name), rel)
    return /\.tsx?$/.test(entry.name) ? [rel] : []
  })
}

const SEAM = [RULES, 'lib/guidedSession.test.ts', 'lib/guidedSession.invariant.test.ts']

// ---- one draft ------------------------------------------------------

describe('the guide holds no session of its own', () => {
  it('never declares state typed as a Session', () => {
    // The host's useState<Session> is the only one. A second would make
    // "switching to the full planner keeps everything" a copy step
    // rather than a property of there being one value.
    const src = read(VIEW)
    expect(src).not.toMatch(/useState<\s*Session/)
    expect(src).not.toMatch(/useReducer<[^>]*Session/)
  })

  it('takes the session as a prop and writes it only through the host', () => {
    const src = read(VIEW)
    expect(src).toContain('session: Session')
    // No setter of its own for any session field: every change leaves
    // through one of the named callbacks.
    expect(src).not.toMatch(/setSession\s*\(/)
  })

  it('names the host planner as the only place the draft lives', () => {
    // A reader who finds the guide first has to be told where the plan
    // is, or they will add a copy here.
    expect(raw(VIEW)).toMatch(/canonical|host's draft/i)
  })
})

// ---- one persistence ------------------------------------------------

describe('the guide persists nothing', () => {
  it('touches no browser storage', () => {
    for (const f of [RULES, VIEW]) {
      const src = read(f)
      expect(src, f).not.toContain('sessionStorage')
      expect(src, f).not.toContain('localStorage')
      expect(src, f).not.toContain('stashDraft')
      expect(src, f).not.toContain('AUTHORING_STASH_KEY')
    }
  })

  it('does not widen the COACH-11 draft envelope', () => {
    // Everything the guide holds is derived from the session, so the
    // stash that carries a plan to the Drill Maker did not have to
    // learn about the guide. If a guide field appears in that envelope,
    // the derivation has been abandoned and this says so.
    const src = read('lib/planDrillAuthoring.ts')
    expect(src).not.toContain('guide')
    expect(src).not.toContain('GuideState')
    expect(src).not.toMatch(/step/i)
  })

  it('writes nothing to the database, from either half', () => {
    for (const f of [RULES, VIEW]) {
      const src = read(f)
      expect(src, f).not.toMatch(/from '.*\/(supabase|queries)'/)
      expect(src, f).not.toMatch(/\.(insert|upsert|update|delete|mutate|mutateAsync)\s*\(/)
    }
  })

  it('reaches the one guarded submit rather than saving on its own', () => {
    // The host builds the actions card once and passes it in, so the
    // guided Save is the planner's Save: the same in flight guard, the
    // same failure sentence, the same retry.
    expect(read(VIEW)).toContain('actions: ReactNode')
    expect(read(VIEW)).not.toContain('createPlannerActions')
  })
})

// ---- one composer ---------------------------------------------------

describe('the guide mounts the shared composer rather than building one', () => {
  it('imports no activity editor of its own', () => {
    const src = read(VIEW)
    expect(src).not.toContain('ActivityListEditor')
    expect(src).not.toContain('AddActivityBar')
    expect(src).toContain('composer: ReactNode')
  })

  it('leaves the activity list to one visible timeline in the host', () => {
    // The roadmap is explicit that interdependent activity work is not
    // split across wizard pages, so exactly ONE step renders it.
    // Anchored on the composing step's own body rather than on a count
    // over the file, because the hand off (composer={composer}) and the
    // render ({composer}) are two different things that read alike.
    const src = read(VIEW)
    const at = src.indexOf('export function GuidedActivitiesStep')
    expect(at).toBeGreaterThan(-1)
    expect(src.slice(0, at)).toContain('composer={composer}')
    // The lookbehind is what separates the two: `composer={composer}`
    // contains `{composer}`, and counting both reports two renders where
    // there is one.
    expect(src.slice(0, at).match(/(?<!composer=)\{composer\}/g)).toBeNull()
    expect(src.slice(at).match(/(?<!composer=)\{composer\}/g)).toHaveLength(1)
  })
})

// ---- one structural vocabulary ---------------------------------------

describe('the shape reuses the canonical structure', () => {
  it('reads the structure module rather than counting stations itself', () => {
    const src = read(RULES)
    expect(src).toContain("from './activityStructure'")
    expect(src).toContain('deriveActivityStructure(')
  })

  it('sums minutes through the shared seam, adding no fifth duration answer', () => {
    // activityStructure.invariant.test.ts forbids a reduce over
    // durations outside the seam. This is the positive half: the
    // preview total is that seam, called.
    expect(read(RULES)).toContain('activeActivityMinutes(')
  })

  it('writes a placeholder identical to the one the add bar already writes', () => {
    // A new title vocabulary here would be a row shape nothing
    // downstream had ever met, and would stop Turn into a drill
    // presetting an empty drill name.
    const src = read(RULES)
    expect(src).toContain('CUSTOM_ACTIVITY_TITLE')
    expect(src).toContain("from './planDrillAuthoring'")
  })

  it('offers only carousel sizes the structure rules accept', () => {
    // Four and five. A three station option would write a plan the
    // structure summary immediately warns about.
    expect([...SESSION_SHAPES]).toEqual(['simple', 'stations-4', 'stations-5'])
  })

  it('starts no second focus vocabulary', () => {
    const src = read(RULES)
    expect(src).toContain('FA_PLAYER_SKILLS')
    expect(src).not.toMatch(/const GUIDED_FOCUS(ES)?\s*(:|=)\s*\[/)
  })
})

// ---- one implementation of the guide ---------------------------------

describe('the guide has one implementation', () => {
  it('is the only module that names the steps', () => {
    const offenders = tsFiles(SRC)
      .filter((f) => !SEAM.includes(f))
      .filter((f) => /(const|let|var)\s+GUIDED_STEPS\b/.test(read(f)))
    expect(offenders).toEqual([])
  })

  it('is the only module that names the shapes', () => {
    const offenders = tsFiles(SRC)
      .filter((f) => !SEAM.includes(f))
      .filter((f) => /(const|let|var)\s+SESSION_SHAPES\b/.test(read(f)))
    expect(offenders).toEqual([])
  })

  it('declares four steps, in the order the labels and headings cover', () => {
    expect([...GUIDED_STEPS]).toEqual(['basics', 'focus', 'shape', 'activities'])
    const src = read(RULES)
    for (const step of GUIDED_STEPS) expect(src, step).toContain(`${step}:`)
  })

  it('is reached by the planner through the mode rule, never by a literal', () => {
    const src = read(HOST)
    expect(src).toContain('plannerModeFor(')
    // The parameter's NAME and the value that means the guide both come
    // from the rules module, so no screen decides either for itself.
    // What is deliberately NOT forbidden is comparing the RESOLVED mode
    // against 'guide': that value is a typed union the compiler checks,
    // and the thing worth catching is a screen reading the address.
    expect(src).toContain('PLANNER_MODE_PARAM')
    expect(src).toContain('PLANNER_GUIDE_MODE')
    expect(src).not.toMatch(/['`]mode['`]/)
  })
})

// ---- the manual planner is not replaced ------------------------------

describe('the entry choice is a card, not a gate', () => {
  it('renders above the workspace rather than instead of it', () => {
    // Both are inside the same branch, so a coach who presses nothing
    // still has the whole planner. A gate would have the workspace in
    // the other arm of a conditional from the chooser.
    const src = read(HOST)
    const chooser = src.indexOf('<GuidedEntryChoice')
    const workspace = src.indexOf('<PlannerWorkspace')
    expect(chooser).toBeGreaterThan(-1)
    expect(workspace).toBeGreaterThan(chooser)
    // And the guard on the chooser is its own, so hiding it cannot hide
    // the planner with it.
    expect(src).toContain('{chooserOpen && guidedEntryOffered(')
  })

  it('asks one rule who may see it and who may enter', () => {
    const src = read(HOST)
    expect(src).toContain('guidedEntryOffered(')
    expect(src.match(/plannerModeFor\(/g)).toHaveLength(1)
  })

  it('decides the mode where the read only answer exists', () => {
    // The route shell has neither the capabilities nor the owner, so a
    // mode decided there could not refuse a read only viewer.
    const src = read(HOST)
    expect(src.indexOf('const readOnly =')).toBeLessThan(src.indexOf('plannerModeFor('))
  })
})

// ---- the phone floor --------------------------------------------------

describe('the guided chrome is thumb sized and on the shared system', () => {
  it('gives the two surfaces it invents the hit area as their floor', () => {
    const css = raw(SHEET)
    for (const sel of ['.guide-shape', '.guide-choice']) {
      const rule = css.slice(css.indexOf(`${sel} {`), css.indexOf('}', css.indexOf(`${sel} {`)))
      expect(rule, sel).toContain('min-height: var(--hit)')
    }
  })

  it('is single column before any media query has fired', () => {
    const css = raw(SHEET)
    const base = css.slice(0, css.indexOf('@media'))
    expect(base).toContain('.guide { display: flex; flex-direction: column')
    expect(base).toContain('.guide-shapes { display: flex; flex-direction: column')
    expect(base).toContain('.guide-entry-choices { display: flex; flex-direction: column')
  })

  it('widens rather than narrows, so a phone never depends on a query', () => {
    for (const block of raw(SHEET).split('@media').slice(1)) {
      expect(block.slice(0, 40)).toContain('(min-width:')
    }
  })

  it('draws no focus ring of its own', () => {
    // [tabindex]:focus-visible in the shared stylesheet already rings
    // the step heading. A second ring here would be a second
    // implementation of the one thing the design system has one of.
    expect(raw(SHEET)).not.toMatch(/outline:\s*[0-9]/)
  })
})

// ---- what a coach is told ---------------------------------------------

describe('the guide says where it is and how to finish', () => {
  it('exposes the current step rather than colouring it', () => {
    expect(read(VIEW)).toContain("aria-current={current ? 'step' : undefined}")
  })

  it('gives the heading focus to move to, and points the effect at it', () => {
    const src = read(VIEW)
    expect(src).toContain('GUIDED_STEP_HEADING_ID')
    expect(src).toContain('tabIndex={-1}')
    expect(src).toMatch(/heading\.current\?\.focus\(\)/)
    // On a step change and nothing else: a dependency list of anything
    // wider would move focus while a coach was typing.
    expect(src).toMatch(/heading\.current\?\.focus\(\)\s*\n?\s*\},\s*\[step\]\)/)
  })

  it('does not borrow the restore hook, which answers a different question', () => {
    // useFocusRestore only acts when an async settle dropped focus to
    // the body. A step change is a navigation and moves focus outright.
    expect(read(VIEW)).not.toContain('useFocusRestore')
  })

  it('suggests a name rather than demanding one, and stops once it is written', () => {
    const src = read(VIEW)
    expect(src).toContain('suggestedSessionName(')
    expect(src).toContain('state.nameTouched')
  })

  it('refuses without discarding, and only after the coach has pressed Continue', () => {
    const src = read(VIEW)
    expect(src).toContain('guideStepProblem(')
    expect(src).toContain('setRefused(true)')
    // The refusal is a sentence beside the control, announced.
    expect(src).toMatch(/role="alert"/)
  })
})

// ---- what this cannot catch -------------------------------------------

describe('the shapes this tripwire cannot see', () => {
  it('cannot see a session copied into state under another type', () => {
    // useState<Session> is caught. `useState(structuredClone(session))`
    // typed by inference is not, and neither is a copy held in a ref.
    // What answers that is the screens suite and review.
    expect(true).toBe(true)
  })

  it('cannot see a save reached through an indirection', () => {
    // A mutation hook imported under an alias, or a callback prop that
    // happens to write, reads as neither an upsert nor a queries
    // import. The positive rule (the host passes its actions card in)
    // is what makes the honest shape obvious, not what makes the
    // dishonest one impossible.
    expect(true).toBe(true)
  })

  it('cannot see a step added without a heading, only one named wrongly', () => {
    // The step vocabulary check reads the record keys by name. A fifth
    // step whose label and heading were both added would pass, which is
    // correct; one added to GUIDED_STEPS alone fails to compile, which
    // is the compiler doing the work rather than this file.
    expect(true).toBe(true)
  })
})
