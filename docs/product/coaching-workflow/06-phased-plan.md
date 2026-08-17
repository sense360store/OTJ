# Phased implementation plan

Status: proposal, awaiting approval. Nothing in this plan has been implemented.

Twelve phases. Every one leaves OTJ usable and deployable, and every one is
useful on its own to a coach even if the next never ships. Phase boundaries were
chosen from the code rather than from the suggested numbering; the mapping to the
discovery's suggested phases is in section 14.

Each phase names its outcome, scope, non-goals, reuse, database change, RLS and
Edge Function implications, backwards compatibility, tests, manual smoke tests,
dependencies, rollout risk, rollback and PR boundaries.

---

## Phase 0: current-state audit and architecture

**Outcome.** A future session can pick up any later phase without re-deriving
what exists.

**Scope.** This document set. Documentation only.

**Non-goals.** No application or database behaviour.

**Deliverables.** `docs/product/coaching-workflow/00` through `08`, and a pointer
from `docs/roadmap/master-roadmap.md`.

**Tests.** None. **Rollback.** Delete the documents.

---

## Phase A: show the drill diagram everywhere a drill appears

*This is roadmap item DRILL-02, already **Next**.*

**Outcome.** A coach sees the drill's own diagram in the planner, on session day
and in the live view, not only on the drill page.

**Scope.**
- Planner expanded activity panel renders the saved diagram beside the media.
- Session Day Setup card renders it, and it opens full screen.
- Live view renders it for the current activity.
- The full-screen viewer handles a saved diagram as well as a media image.

**Non-goals.** No editing from those surfaces. No public sharing of a diagram
(that is Phase K). No schema change.

**Reuse.** `src/lib/drillDiagram.ts`, `src/components/DrillDiagramView.tsx`,
`useDrillDiagram` (`src/lib/queries.ts:1488`), `DiagramViewer`. Note the naming
collision recorded in `00-current-state-audit.md` section 7: `DiagramViewer`
shows media images, `DrillDiagramView` shows saved diagrams.

**Database.** None. **RLS.** None. **Edge Functions.** None.

**Backwards compatibility.** A drill with no diagram renders exactly as today.

**Reads to watch.** The diagram is a per-drill read today
(`useDrillDiagram(id)`). A session with six drills would issue six reads on
session day. Either batch it into a list read or accept the cost after measuring;
decide with the code in front of you, not here.

**Tests.** Screen-level tests that a session's saved diagram appears on planner,
session day and live. Existing `drillMaker.screens.test.tsx` is the pattern.

**Manual smoke.** Draw a diagram, add the drill to a session, open the planner
row, open session day, start the live view, confirm it renders in all three and
opens full screen on a phone-width viewport.

**Dependencies.** None. **Rollout risk.** Low.

**Rollback.** Revert. Nothing was written.

**PR boundary.** One PR, or two if the read shape needs changing first.

---

## Phase B: create a drill without leaving the planner

**Outcome.** A coach planning a session can create the drill they have in mind,
draw it, and carry on planning.

**Scope.**
- **New drill** in the planner's add bar.
- A minimal create form: title, phase, duration, objective.
- **Draw it** opens `/drill/:id/diagram` and returns to the planner afterwards.
- **Turn into a drill** on a custom (title-only) activity.

**Non-goals.** No adaptation semantics (Phase C). No Drill Maker tool changes
(Phase D). No new capability: creating a drill from here needs `drills.create`,
which is exactly what creating one from the library needs.

**Reuse.** `DrillFormModal.tsx`, `useInsertDrill`, `AddActivityBar`
(`src/routes/Planner.tsx:570`), `DrillDiagramEditor`.

**Database.** None. **RLS.** None. **Edge Functions.** None.

**The one hazard.** The planner holds an unsaved draft. Leaving it to draw must
not lose it. Decide explicitly: save the session first, or preserve and restore
the draft. `src/lib/sessionSubmit.ts` and `useGuardedSubmit` are where this is
settled.

**England Football.** An FA-derived drill gets no Draw it, unchanged
(`src/lib/drillDiagramRights.ts`).

**Tests.** The return path preserves the draft. A coach without `drills.create`
sees no New drill. A custom activity promotes to a drill and keeps its title,
phase and duration.

**Manual smoke.** Plan a session, create a drill mid-flow, draw it, return, save,
confirm the drill is in the library and in the session.

**Dependencies.** Better after Phase A, so the drawing is visible where it was
made. Not blocked by it.

**Rollout risk.** Low, except the draft-preservation hazard, which is the whole
review.

**Rollback.** Revert.

**PR boundary.** One PR for the create path, one for the diagram round trip if
draft preservation turns out to be substantial.

---

## Phase C: adapt a drill without rewriting history

**Outcome.** A coach changes a drill for one session and nothing else changes.

**Scope.**
- **Copy and adapt** on a planner activity: duplicates the drill including the
  diagram, repoints the activity.
- `drills.variant_of` so the library lists originals and shows adaptations under
  their parent.
- A line on the drill edit form: "Used in N sessions, M already delivered", with
  Copy and adapt beside it.

**Non-goals.** No versioning. No snapshotting of delivered sessions. No merge or
"push my change back to the original".

**Database.** **M1** (`04-data-model-proposal.md` section 2). One nullable
column, one composite foreign key with an explicit `set null` column list, one
index.

**RLS.** No new policy. An ordinary column on `drills` is already covered by the
four live policies; this is the reasoning `0046` used for `diagram`.

**Edge Functions.** None. A variant is an ordinary drill to the share builder.

**Backwards compatibility.** `variant_of` null everywhere is the current
behaviour exactly.

**Tests.** Copy produces an independent row; editing it does not change the
original or another session. Deleting the original leaves adaptations alive as
ordinary drills. The library hides variants by default and finds them under the
parent. A security test that a variant obeys the same policies as any drill.

**Manual smoke.** Use a drill in two sessions, adapt it in one, edit the copy,
confirm the other session is untouched. Delete the original, confirm the
adaptation survives.

**Dependencies.** Phase B is the natural pairing but not required.

**Rollout risk.** Low. Migration first, frontend second.

**Rollback.** Drop the constraint and column; adaptations become ordinary drills.

**PR boundary.** One migration PR (gated), one frontend PR.

---

## Phase D: Drill Maker authoring improvements

**Outcome.** Drawing a four-cone grid with six players and two goals takes under
two minutes at a laptop.

**Scope.** Whatever the tool is actually missing, decided by using it: likely
click-to-place, duplicate an element, multi-select and move, undo and redo,
alignment or snapping, keyboard nudge, and one or two starting arrangements (a
cone grid, a small-sided box).

**Non-goals.** No motion. No new element types unless a migration is opened for
them, because the element allow-list is a check constraint. No change to the
stored shape or the version.

**Reuse.** `src/lib/drillDiagramEditor.ts` (the reducer),
`src/lib/drillDiagramGeometry.ts`, `src/routes/DrillDiagramEditor.tsx`.

**Database.** **None**, provided nothing new is stored. Adding a starting
arrangement is a client-side seed of existing element types.

**Tests.** Reducer tests, which is where this codebase already puts them. Undo
and redo prove the signature returns to its previous value.

**Manual smoke.** Draw a real drill from a real session at a laptop and time it.

**Dependencies.** None. Can run in parallel with A, B and C.

**Rollout risk.** Low. **Rollback.** Revert.

**PR boundary.** Two or three small PRs by tool, not one large one.

---

## Phase E: week plans and two deliveries of one plan

**Outcome.** A coach plans Tuesday, and Saturday is one action away.

**Scope.**
- Rename "template" to **week plan** in the interface.
- **Save this session as a week plan**.
- Apply a week plan to more than one date in one action.
- `sessions.template_id`, so provenance is uniform and sibling deliveries are
  visible.
- A session shows "also delivered Saturday 22 August" when a sibling exists.

**Non-goals.** No propagation of an edit from one delivery to the other; the
sibling link makes an explicit "apply to Saturday too" possible later, and this
phase does not build it. No new planning entity
(`02-target-product-model.md` section 2).

**Reuse.** `useStartFromTemplate`, `ApplyProgrammeModal.tsx`,
`useCopyTemplateToWeek`, `TemplateFormModal.tsx`.

**Database.** **M2**. One nullable column, one composite foreign key, one index.
No backfill.

**RLS.** No new policy. **Edge Functions.** None.

**Backwards compatibility.** Null `template_id` is every existing session and
reads as no provenance.

**Tests.** Promote a session and confirm the plan matches. Apply to two dates and
confirm two independent sessions with one `template_id`. A copy sweep test that
no user-visible string says "template".

**Manual smoke.** Plan Tuesday, promote, apply to Saturday, edit Saturday,
confirm Tuesday is unchanged.

**Dependencies.** None.

**Rollout risk.** Low. The copy rename is the widest-reaching part and is pure
text.

**Rollback.** Drop the column; the copy change stands alone.

**PR boundary.** One copy PR, one migration PR (gated), one journeys PR.

---

## Phase F: station blocks

**Outcome.** Four stations of ten minutes reads as forty minutes of rotation, not
forty minutes of sequence, and the session total is honest.

**Scope.**
- `sessions.blocks` and `templates.blocks`; `block_id` on an activity.
- Planner: select activities, **Make these a station block**, set the rotation
  length, adjust the rotation count.
- `sessionMinutes` becomes block-aware, and every consumer with it.
- Live view: one timer per rotation, with **Rotate** as the cue and all stations
  listed.

**Non-goals.** No group assignment (Phase G). No venue placement (Phase I). No
per-station coach assignment, ever: the discovery says coaches rotate with their
group and that exceptions should not be modelled.

**Reuse.** `src/lib/data.ts` (`sessionMinutes`), `src/lib/sessionLifecycle.ts`,
`src/lib/ics.ts`, `LiveSession.tsx`, the planner's activity list.

**Database.** **M3**. Two nullable jsonb columns and a light shape constraint.
Plus the mandatory client change to `toActivity` and `toActivityRow`, without
which `block_id` is dropped on read and lost on save.

**RLS.** No new policy on either table. **Edge Functions.** The session share
builder derives `totalDuration` from the activities; it must use the same rule or
a shared session will report a different length from the app. Check
`_shared/share.ts` and keep the two in step.

**Backwards compatibility.** Total. No blocks and no `block_id` is every existing
session, and the maths reduces exactly to the current sum.

**Tests.** Duration maths for a session with a block, without one, and with two.
`sessionLifecycle` derives the expected end from the same total, and the
invariant test still finds exactly one fallback duration. An ics export of a
blocked session has the right length. Live advances by rotation.

**Manual smoke.** Build a real one hour session with a warm-up, four stations and
a game. Confirm the total is sixty. Run it live and rotate.

**Dependencies.** None, but it must precede Phase I.

**Rollout risk.** **The highest in the programme**, because duration feeds the
lifecycle and the lifecycle decides whether a session appears on Home. A wrong
total puts a session in the wrong list. This is why the phase is on its own and
why its tests are about arithmetic before they are about UI.

**Rollback.** Drop the columns. Sessions with blocks lose their block structure
and read as sequential again; no activity is lost.

**PR boundary.** One migration PR (gated). One PR for the duration model and its
consumers, with no UI. One PR for the planner UI. One for the live view.

---

## Phase G: operational preparation

**Outcome.** One or two days out, a coach turns "22 replies" into "four groups,
four colours, ready".

**Scope.**
- **Suggest groups**: a pure function proposing a balanced split of the included
  children into the block's station count, keeping team mates together, assigning
  a bib colour per group. It produces a **draft** the coach edits.
- Group order determines starting station, derived.
- A **readiness readout** on the session, derived and stored nowhere.

**Non-goals.** **No stored workflow states**
(`02-target-product-model.md` section 5). No group entity. No change to how
Spond, presence or inclusion work. No automatic anything: nothing suggests
without a press and nothing saves without Save groups.

**Reuse.** `src/lib/tonight.ts` in its entirety, `src/lib/bibs.ts`,
`src/routes/SessionRegister.tsx`, `useSaveTonight`, `sessionLifecycle.ts`.

**Database.** None. **RLS.** None. **Edge Functions.** None.

**Rules that must survive.** The three independent facts per child. Spond as
context only. A club with no Spond configuration gets the whole surface. A Spond
failure renders as no context, never as "nobody is coming". One count builder.
Nothing persists outside Save groups.

**Tests.** The split is deterministic and balanced; it keeps team mates together
where the numbers allow and says so when they do not; it produces a draft and
writes nothing; it never touches `present`; readiness derives from the same seam
as the lifecycle and never writes.

**Manual smoke.** A real session with real replies. Suggest, adjust, save,
reload, confirm the readback matches.

**Dependencies.** Phase F for the station count. Degrades to a coach-entered
group count without it.

**Rollout risk.** Low. Everything is a draft until Save.

**Rollback.** Revert. Nothing new was stored.

**PR boundary.** One PR for the split, one for the readiness readout.

---

## Phase H: venue layout

**Outcome.** An admin describes the club's training area at each venue once, and
every coach reuses it.

**Scope.**
- `venues.layout` with a versioned, allow-listed, fraction-coordinate shape.
- `src/lib/venueLayout.ts`: parser, serialiser, signature, description, sharing
  `clampFraction` with the diagram and the board.
- An admin editor on `/admin/venues`.
- A read-only renderer.

**Non-goals.** No imagery, no satellite tiles, no coordinates, no address, no
navigation. No station placement (Phase I).

**Reuse.** The whole shape discipline of `0046` and `src/lib/drillDiagram.ts`,
deliberately, so this is the third instance of a known pattern rather than a new
one.

**Database.** **M4**. One nullable jsonb column plus a check constraint stating
the key allow-list.

**RLS.** No new policy: an ordinary column on `venues`, whose write already takes
`club.manage`.

**Audit, and do not miss this.** `audit_venues()` treats an update as a rename,
and `describeActivityEvent` renders `venue.updated` as **"Venue renamed"**
(`src/lib/activityView.ts:438`). That sentence becomes false. Either add `layout`
to the audited allow list and change the label to "Venue updated", or correct the
label and its comment.

**Backwards compatibility.** Null layout is every existing venue and reads as no
layout, which every surface renders as nothing.

**Tests.** Parser and serialiser round trip; an unknown version yields no layout;
out-of-range coordinates are clamped; a corrupt area is dropped rather than
taking the layout with it; the check constraint refuses a key outside the
allow-list, including a location-shaped one; a security test that the constraint
holds against service_role.

**Manual smoke.** Configure Flushdyke as two pitches side by side. Configure a
venue as one third of a pitch. Confirm both render sensibly at phone width.

**Dependencies.** None.

**Rollout risk.** Medium: a new shape boundary. The mitigation is that it copies
one that has already been reviewed twice.

**Rollback.** Drop the constraint, then the column. Dropping the column discards
every saved layout, so drop the constraint alone unless the feature is being
withdrawn. This is the wording `0046` uses and the same reasoning applies.

**PR boundary.** One migration PR (gated). One PR for the model and its tests.
One for the admin editor.

---

## Phase I: session venue composer

*This is roadmap item DRILL-03, reframed by this programme.*

**Outcome.** "Station 1 goes here, station 2 goes here", set once a week, seen by
every coach.

**Scope.**
- `area_id` on a station activity, in `sessions.activities`.
- A composer on the session: drag or tap each station into an area.
- Unplaced stations are shown as unplaced.
- An orphaned `area_id` after a layout or venue change is stated, never silently
  dropped and never drawn at a guess.

**Non-goals.** No editing the venue layout from here; that is admin work. No
per-station geometry. No automatic placement.

**Database.** None, provided the key rides `sessions.activities`. `toActivity`
and `toActivityRow` gain `area_id` alongside `block_id`.

**RLS.** None. Editing a session's plan is already the sessions update policy.

**Edge Functions.** None. `area_id` must be added to both forbidden-key lists
when it lands, not when it is first shared
(`05-security-share-boundary.md` section 8, rule 7).

**Backwards compatibility.** No `area_id` is every existing session.

**Tests.** Placement round trips. An `area_id` that no longer resolves renders as
unplaced with the stated sentence. Changing the venue does not silently clear
placements.

**Manual smoke.** Place four stations at Flushdyke, change one pitch in the venue
layout, confirm the stations move with it. Change the session's venue, confirm the
warning.

**Dependencies.** Phase F (which activities are stations) and Phase H (the
areas). Both hard.

**Rollout risk.** Low.

**Rollback.** Revert. Stored `area_id` values become inert and are dropped on the
next save, which is acceptable and should be stated in the PR.

**PR boundary.** One PR.

---

## Phase J: training-day mobile delivery

**Outcome.** The primary success scenario. A coach arrives, opens their phone,
and needs no briefing.

**Scope.**
- Session day on a phone: groups and bibs, then the venue overview with numbered
  station markers, then a station, then back.
- The station screen is the drill visual large, the objective, the coaching
  points, the setup notes and the equipment, and little else.
- "Your group starts here" on the relevant station.
- Swipe between stations; tap to focus; back to overview.

**Non-goals.** No offline support or PWA work (noted as out of scope in
`SessionDay.tsx` today and still out of scope). No pinch-zoom-dependent design.
No new data.

**Reuse.** `SessionDay.tsx`, `DrillDiagramView`, `tonightGroups`, the Phase H
renderer, the Phase I placement.

**Database.** None. **RLS.** None. **Edge Functions.** None.

**Accessibility, which is scope and not a footnote.** Tap targets at or above the
44 pixel minimum the app already uses. Station identity carried by number and
name, never colour alone. Every station reachable as an ordinary list as well as
on the layout. Keyboard and screen reader paths through overview, station and
back. This is where QUALITY-02 should be pulled in rather than deferred again.

**Tests.** Screen-level tests at phone width for the overview, focus and back
path. A parent reaches none of it.

**Manual smoke.** On a real phone, outdoors, at a real venue, with a real session.

**Dependencies.** A, F, G, H, I.

**Rollout risk.** Low technically. The product risk is that it is judged on
whether the *plan* is good, which is Phases A to I.

**Rollback.** Revert.

**PR boundary.** Two or three PRs: overview, station focus, group and bib
integration.

---

## Phase K: shareable operational outputs

**Outcome.** A parent knows their child's group and colour before they arrive,
without anything being published about a child.

**Scope.**
- A **generated message** composed in the browser from the same draft the groups
  screen holds, offered in a with-names and a names-free variant, copied by the
  coach into their existing group.
- Optionally, a **public session projection** carrying date, time, venue, plan,
  group colours and counts, and **no names**, through the existing share
  substrate. This is roadmap item TRAIN-02.

**Non-goals.** **No child's name on any public URL.** No parent-to-child identity
binding (out of scope, `08-open-questions.md` Q2). No new auth surface. No
scheduled or automatic sending.

**Reuse.** `src/lib/tonight.ts` for the source data. For the public half:
`content_shares`, `manage_content_share`, `read_public_share`,
`_shared/share.ts`, `ShareModal.tsx`, `publicShare.ts`.

**Database.** None for the message. For the public projection: no schema, but a
new snapshot builder and a widened set of publishable session fields, which is
the security decision in `05-security-share-boundary.md` sections 4 and 6.

**Edge Functions.** `manage-content-share` and `read-content-share` if the public
half proceeds. **Deploy from files and read the deployed source back byte for
byte**, never paste inline (`CLAUDE.md`, Edge Function deploys).

**Tests.** The message is generated by one pure function from the same draft, is
deterministic, contains no shirt number, team, attendance or Spond figure, and
uses a surname initial only when two children share a first name. For the public
half: a serialised-response test asserting the payload against an explicit field
list, the pattern the existing snapshot tests already use.

**Manual smoke.** Generate both variants, read them as a parent would, confirm the
names-free one is still useful.

**Dependencies.** Phase G. The public half depends on a club decision, not on
code.

**Rollout risk.** **The highest privacy risk in the programme.** Separate
security review, separate PR, and not combined with any other change (roadmap
rule 5).

**Rollback.** Revert the composer. For a public share, revoke: the existing
lifecycle already clears the snapshot on revoke, and the existing warnings
already say a printed or saved copy cannot be recalled.

**PR boundary.** One PR for the message. The public projection is its own
programme with its own review.

---

## Phase L: optional drill motion

**Outcome.** A complex exercise can be played rather than explained.

**Scope, if approved.** A small number of keyframes per element; play, pause,
restart; nothing more.

**Non-goals.** No timeline editor, no easing, no per-element scripting, no video
export.

**Database.** **M5**: widening the `drills.diagram` element allow-list, which is
a check constraint and therefore a gated migration.

**The rollout hazard, restated because it is easy to get wrong.** The parser
**discards a diagram whose version it does not recognise**. A reader that
understands the new shape must be deployed and reach every client **before**
anything writes it. Two releases, reader first. A coach on a stale tab must never
see their diagrams disappear.

**Dependencies.** Everything. This phase is gated on evidence that the static
workflow is in daily use and that motion is the next thing missing, not on
anyone's enthusiasm for animation.

**Rollback.** Version-aware readers make rollback a matter of ceasing to write
the new shape. Removing the constraint widening after diagrams exist would make
those diagrams unwritable, so the rollback story is "stop writing", not "drop the
column".

---

## 13. Dependency graph

```
0 ─┬─ A ─┬─────────────────────────────── J
   ├─ B  │
   ├─ C  │
   ├─ D ─┘                    (D also gates L)
   ├─ E
   ├─ F ─┬─ G ─┬────────────── K
   │     └─ I ─┘
   └─ H ─── I
                              L (gated on evidence, after A–J)
```

A, B, C, D, E and H have no dependencies and can be scheduled freely. F gates G
and I. H gates I. I gates J. G gates K.

---

## 14. Mapping to the discovery's suggested phases

| Suggested | This plan | Note |
|---|---|---|
| 0 current-state audit | Phase 0 | Same. |
| 1 drill/session authoring | Phases **B** and **C**, plus **A** first | Split because creating and adapting are different risks, and because A is already Next, is free, and makes B and C worth having. |
| 2 visual Drill Maker | Phase **D** | Deliberately later: the tool is already capable; the workflow was the gap. |
| 3 programme → weekly session | Phase **E**, plus **F** | F is new and was not in the suggested list. It is the single most important structural finding of the audit. |
| 4 Spond operational preparation | Phase **G** | Smaller than expected: most of it already ships. |
| 5 venue model | Phase **H** | Same. |
| 6 session venue composer | Phase **I** | Same, but dependent on F as well as H. |
| 7 training-day mobile | Phase **J** | Same. |
| 8 shareable outputs | Phase **K** | Reshaped: a generated message first, a public projection only by club decision. |
| 9 optional motion | Phase **L** | Same, with the version rollout hazard named. |

---

## 15. Adversarial pass

Performed against this plan before publishing it. Where the critique held, the
plan above already carries the revision.

**Is the workflow unnecessarily complex?** The plan adds exactly one new concept
to what a coach must understand: the station block. Everything else is either an
existing concept made reachable (creating a drill from the planner), an existing
concept renamed (week plan), or invisible (variants under a parent, derived
readiness). One new concept for a workflow that is genuinely parallel is
proportionate.

**Are programme, session and event duplicated?** Four things exist:
`programmes`, `templates`, `sessions` and `spond_events`. The first three are the
theme, the plan and the delivery, which the discovery itself distinguishes. The
fourth is a mirror, not a plan, and `0048` already makes one session per event a
database fact. **Revision made:** the plan explicitly refuses a new "weekly plan"
entity and instead adds `template_id`, because the fourth row type was the
obvious wrong answer.

**Can drill copying create confusing histories?** A session points at the exact
row it ran, so "what did we do?" is unambiguous. The residual is that editing a
library drill still changes past sessions. **Revision made:** rather than pretend
otherwise, Phase C adds a usage line to the edit form so the change is a choice,
and `08-open-questions.md` Q3 puts freezing to the club as a decision with a
recommended default of no.

**Is Spond timing modelled correctly?** Yes, and mostly by not touching it. No
phase before G reads Spond at all, so planning cannot be blocked by it, and G's
additions are drafts. The existing rules that a club with no Spond gets the whole
surface, and that a failure renders as no context, are restated as constraints on
G rather than left to be rediscovered.

**Do venue layouts work at phone width?** Only if the overview draws areas and
numbers rather than four shrunken drill diagrams. **Revision made:**
`03-ux-journeys.md` states that as the decision and gives the reasoning, and
Phase J's non-goals refuse a pinch-dependent design outright.

**Does the plan over-engineer animation?** It is last, it is gated on evidence
rather than enthusiasm, its scope is keyframes and three buttons, and its two
hazards are named. **Revision made:** the rollback story is stated honestly as
"stop writing", because dropping the constraint widening after diagrams exist
would strand them.

**Does sharing expose children?** Not in the recommended path, because the
recommended path publishes nothing. **Revision made:** the generated message is
the primary output and the public projection is explicitly conditional on a club
decision, rather than both being scoped as work.

**Does any new model duplicate existing state?** The three candidates were
checked. A group entity would duplicate the bib colour, so there is none. A
workflow state column would duplicate what `sessionLifecycle` and the rows
already say, so there is none. A session-local drill overlay would duplicate
`drills` in an unconstrained column, so adaptation is a copy instead. The one
accepted near-duplication is a third fraction-coordinate jsonb column, and it is
accepted only on condition that it inherits the existing discipline rather than
inventing a second one.

**Is each phase independently shippable?** Checked one at a time. A, B, D, E, G,
J and K ship alone. C ships alone because `variant_of` unused is current
behaviour. F ships alone because a session with no block is unchanged. H ships
alone because a venue with no layout is unchanged. I is the only phase that
genuinely cannot ship before its dependencies, and it is the only one where the
plan says so.

**What the adversarial pass could not resolve, and left as questions.** Whether
date, time and venue may be public; whether the club wants a parent-to-child
identity binding; whether delivered sessions should be frozen; whether a coach
override of starting stations is wanted; whether a traced venue background is
worth its rights question. All five are in `08-open-questions.md` because they
are product and club decisions, not engineering ones.
