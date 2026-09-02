# Implementation plan

Status: proposal, reconciled 18 August 2026 against `main` at `afe790d`;
delivery status re-verified 2 September 2026 against `main` at `3cb20f9`.
**Five slices are built** (COACH-2A, COACH-2B, COACH-3, COACH-4 and COACH-10,
each recorded under its own heading below with its pull request), **COACH-1 is
built** (COACH-1A, migration `0051_team_sort_order`, merged as #223 and applied
to production on 2 September 2026; COACH-1B, the Teams screen's ordering
affordance, in its own PR), and everything else remains design. A settled design is not
delivered work.

The order was re-derived from scratch after coach discovery, then corrected once
more when two of its own conclusions turned out to be wrong: structure was being
inferred from the `Phase` vocabulary, and the venue layout had been scoped to a
venue alone. Thirteen slices, each a small independently reviewable pull request
or a small pair of them, each leaving OTJ usable and deployable.

**Migration slices are sequenced by the hosted ledger, not by this list.** See
section 5.

---

## 1. What is already true on `main`

Established before anything is planned, because two of the previous plan's phases
turned out to be finished or unnecessary.

| | State |
|---|---|
| Saved drill diagrams on the planner, session day and both live stages | **Merged.** PR #189, in `main` at `afe790d`. `ActivityDiagram`, `ActivityDiagramView` and `diagramForDisplay` are the seam every later slice mounts. |
| Coach to coach protected link sharing | **Merged and shipped long ago.** `src/lib/share.ts` plus the internal arm of `ShareModal`, reachable from session day. |
| Migration gate hardening | **Merged.** PR #195. |
| Groups, bibs, inclusion, attendance, quick add, Save groups | Shipped. `src/lib/tonight.ts` and `SessionRegister.tsx`. |
| Session lifecycle, event classification, the calendar export | Shipped and correct. Untouched by this programme. |
| COACH-2, declared stations and games | **Merged.** #198 (COACH-2A) and #202 (COACH-2B). |
| COACH-3, the suggested setup | **Merged.** #203 (the generator) and #204 (the screen). |
| COACH-4, the setup preserved across attendance changes | **Merged.** #206. |
| COACH-10, the shared authoring seam | **Merged.** #207. |
| Migration numbering | `0050_bulk_delete_players.sql` is the highest on disk and was applied on 23 August 2026; the hosted head is `20260823065041` / `bulk_delete_players` (read 2 September 2026). The next free number is `0051`, and it stays unclaimed until a register entry pins it to that head. |

**The two pull requests that had to stay separate from this work have both
merged**, on 27 August 2026, with nothing from this programme in either:
**#191** (PLAYERS-01 bulk permanent deletion, carrying migration `0050`) and
**#196** (Drill Maker opening on a blank area).

## 2. What this reconciliation removed

Listed because a design that is merely absent tends to be rebuilt. Each of these
was a designed mechanism in the previous revision, and each is now out of scope.

| Removed | It existed to | Why it is gone |
|---|---|---|
| Station blocks (`sessions.blocks`, `templates.blocks`, `block_id`) | Say which activities are one carousel | Declared on the activity by `slot`, with no migration. **Not** derived from the `Phase` vocabulary, which is coaching classification only. |
| The frozen carousel start map (`blocks[].start`) | Stop a group's starting station moving while a carousel runs | OTJ tracks no running carousel. Nothing to protect. |
| The stateless-rule impossibility proof as a design driver | Justify freezing | The arithmetic is still true and is still recorded as a fact. The conclusion no longer applies. |
| Mid-carousel free-ordinal reassignment | Place a bib colour that appears mid-session | A colour appearing mid-session is a physical event the coach handles on the grass. |
| Live rotation delivery (one timer per rotation, a Rotate cue) | Drive the carousel from OTJ | Live administration. Previous and Next are browsing. |
| Per-activity station placement (`activities[].place`) plus derived area membership | Let a coach place stations weekly | Layouts are scoped, admin owned and load automatically. Weekly coaches place nothing. |
| Game sides as sets of bib colours on a block | Express a side wearing two colours | Reversed by discovery: each game gets two distinguishable colours, and the game bib is its own stored fact. |
| The generated WhatsApp message carrying children's first names | Tell a parent their child's group | Sharing is coach to coach through the protected link. Nothing leaves the app. |
| `sessions.template_id` | Uniform provenance and a sibling link | No consumer in the settled model. |
| `venues.layout` as one jsonb column | All four layouts on the venue row | It cannot express the venue plus season plus age group scope the product requires. Replaced by a small table, not by a weaker scope. |
| Deriving stations from the `Skill` phase, and games from the `Game` phase | Station and game identity with no new key | `phaseFor` sets an activity's phase from the drill's four-corners classification, so the phase records what kind of drill was added, not what part it plays on the night. Replaced by one declared key. |
| Two `slot: 'game'` activities for two pitches | How many games run at once | Activities are sequential and their durations are summed, so two would double the games phase in the session total, the derived lifecycle and the calendar export, and show two steps in Live. One activity, one `gameCount`. |
| `created_by` and `updated_by` on `venue_layouts` | Accountability | `venues` deliberately carries neither and says why; the audit trail already records who. |

**Net effect on the schema: six proposed structures became five columns and one
small table**, plus three keys inside an existing unconstrained jsonb array that
need no migration at all.

**Net effect on the product: nothing OTJ does depends on OTJ being correct about
a pitch that is currently moving.**

---

## 3. The slices

Each names its outcome, scope, non-goals, reuse, database change, tests,
dependencies and pull request boundary. Gated means a migration and therefore a
human review that is not auto-merged.

### COACH-1: the club's team order

**Status.** Built. The database half, COACH-1A, is migration
`0051_team_sort_order`, its own gated PR registered against the hosted head
`20260823065041` / `bulk_delete_players`, merged as #223 and applied to
production on 2 September 2026 through the reviewed workflow (hosted
`20260902150212` / `team_sort_order`). The frontend half, COACH-1B, followed in
its own PR: the Teams admin screen lists the teams in club order, moves them
with Move up and Move down (no drag gesture), names the order as not set,
incomplete or saved, and writes the positions 1..N through one Save team order
checkpoint; `src/lib/teamOrder.ts` holds the rules and
`src/lib/teamOrder.invariant.test.ts` pins that it is the one consumer. The
grouping suggestion is still handed no order, by decision. R1 in
`08-open-questions.md` is decided as its recommended default: `sort_order`
joins the `audit_teams()` allow list.

**Outcome.** An admin states the club's ordering of its own teams, so every later
suggestion has ability context without a per-player field.

**Scope.** `teams.sort_order` plus a partial unique index (M1). A reorder
affordance on `AdminTeams.tsx`. A helper that returns teams in club order, beside
the existing alphabetical read rather than replacing it.

**Non-goals.** No per-player ability score, level or classification, ever. No
change to `sessionTeamsLabel`, which stays alphabetical. No consumer yet.

**Database.** M1 (`04-data-model-proposal.md` section 5). One nullable column,
one partial unique index, plus the audit allow-list decision.

**Tests.** Two teams cannot claim one position. Null everywhere reads as
unordered and the screen says so. Label sorting is unchanged. A security test
that the write still takes `teams.manage`.

**Dependencies.** None.

**PR boundary.** One gated migration PR. One small frontend PR.

### COACH-2: declare the stations and the games

**Status.** Built. #198 (COACH-2A: the model, both mappers, the template
boundary and all four duration consumers) and #202 (COACH-2B: the marking
affordances and the declared line on both surfaces, and the Not running
tonight toggle on the dated session planner alone, since `skipped` is session
local). The Edge deploy for `_shared/share.ts` has run; see the README's
Implementation status.

**Outcome.** A plan says explicitly which activities are the carousel stations
and which are the evening's small-sided games, and which stations are not being
run tonight. Every screen then agrees, and nothing is inferred.

**Scope.**
- `slot: 'station' | 'game'` on an activity, added to `toActivity` and
  `toActivityRow` (`src/lib/queries.ts:289`, `:296`). **`'station'` marks one of
  several; `'game'` marks the ONE activity that is the whole games phase**, whose
  duration is that phase's duration.
- `skipped: true` on an activity, **on any activity carrying a `slot`**, written
  only as `true` and removed on restore. Session local through one named helper
  called by the template write paths (`:1579`, `:1826`) and by the template read
  (`:385`), because the shared mappers cannot do it.
- **The active-duration rule, in every implementation that sums a session.** An
  activity stops counting only when it carries a `slot` **and** `skipped: true`;
  a stray `skipped` on an activity with no `slot` changes nothing. This is the
  one existing rule this programme changes, and it is **inert** until something is
  stood down, since no stored row carries `skipped`.

  **The complete consumer inventory, re-derived from source
  (`00-current-state-audit.md` section 17). All four are in scope for this slice:**

  | # | Consumer | Work |
  |---|---|---|
  | 1 | `sessionMinutes`, `src/lib/data.ts` | Apply the rule. Six session surfaces inherit it |
  | 2 | `plannedMinutes`, `src/lib/sessionLifecycle.ts` | Apply the rule, **and fix the zero branch**, so an all-stood-down session is not answered as a synthetic 90 minutes. Key it on WHY the sum is zero, never on `activities.length`: see the correction in `04-data-model-proposal.md` section 2, which records why the mechanism first proposed there was rejected at implementation |
  | 3 | `src/routes/Planner.tsx` | An inline reduce that does **not** import `sessionMinutes`. It is the "min total" headline the coach reads while standing the station down |
  | 4 | `buildSessionSnapshot`, `supabase/functions/_shared/share.ts` | **Deno.** Same rule, its own runtime; it cannot import `src/lib/` |

  **Centralise the browser three behind one predicate where practical.** Do not
  assume all four can share one helper: the Edge module is a different runtime
  and that duplication is stated rather than papered over.

  **Explicitly not in scope**, because they sum template or programme activities
  and a template never carries `skipped`: `src/routes/Home.tsx:288`,
  `src/routes/Templates.tsx:30`, `src/components/TemplateFormModal.tsx:39`,
  `src/components/ProgrammeFormModal.tsx:160` and `:379`,
  `src/routes/ProgrammeDetail.tsx:76`, and `buildProgrammeSnapshot`
  (`share.ts`).
- One module deriving, from a plan: the ordered **active** station list, the
  station count, and the one active games activity. Station N is the Nth active
  station in plan order and is never stored. **Nothing counts activities to learn
  how many games run**; that is `gameCount`, and it belongs to COACH-8.
- Marking affordances in the shared authoring seam, and a Not running tonight
  toggle on a dated session's station.
- A line in the planner and the week plan editor stating what is declared, and
  the four or five rule where a count is shown.

**Non-goals.**
- **No schema.** `sessions.activities` and `templates.activities` are
  unconstrained jsonb (`00-current-state-audit.md` section 27).
- **Nothing is inferred from `Phase`, ever, at read time.** `Phase` is coaching
  classification and nothing else. A phase-shaped hint may seed the marking
  press, which a person confirms and which is then stored.
- **No second `slot: 'game'` activity to represent a second pitch.** v1 expects
  at most one active games activity; a plan carrying two is named on screen, not
  silently resolved.
- No `blocks`, no `block_id`, no block entity.
- No stored station number.
- No refusal: a coach who declares three stations is told, not blocked.
- **Nothing is deleted.** A stood-down station keeps its place, its duration and
  its position in the plan.

**Reuse.** The existing `Activity` and `ActivityRow` types, and
`useStartFromTemplate`'s deep copy of the mapped activities, which carries `slot`
into every dated session for free. **`sessionMinutes` is not reused unchanged**;
it is one of the four consumers this slice changes.

**Database.** None.

**Edge Function deploy.** One, for `_shared/share.ts`, under the byte-for-byte
readback discipline in `CLAUDE.md`. `supabase/functions/_shared/share_test.ts`
and `src/lib/publicShare.test.ts` both change with it, because the payload
contract has two ends. `05-security-share-boundary.md` states the module, the
tests and the discipline in full. **Nothing is deployed by the documentation pull
request that proposes this.**

**Tests.** A key added to one mapper and not the other is lost, so both are
asserted. `slot` round trips through a session and a week plan. `skipped` round
trips through a session and is **absent** from a template written from it,
through the one named helper both template write paths and the template read
call, because the shared mappers cannot make a key session local by themselves.
**A session's total is unchanged by declaring a `slot`**, and **falls by exactly
one activity's duration when that activity is stood down**, which is the one
existing behaviour this programme changes. **Every session that carries no
`skipped` totals exactly what it totals today**, asserted directly **in all four
consumers**, because that is what makes touching code this widely read low risk.
**A stray `skipped` on an activity with no `slot` changes no total**, which is
the qualifier's own test. **A session whose every operational activity is stood
down totals zero and is not answered as 90 minutes.** The public snapshot's
`totalDuration` matches the browser's, asserted in the Deno suite.
Station numbering follows plan order and skips a stood-down station. Restoring
removes the key rather than writing `false`. A plan carrying no `slot` declares
no stations and says so rather than guessing. A physical drill marked as a
station is a station despite its Warm-Up phase, and a social drill in the `Game`
phase that nobody marked is not a game: both are direct tests of the defect this
slice exists to fix.

**Dependencies.** None. **Gates** COACH-3, COACH-6, COACH-7 and COACH-8.

**PR boundary.** One PR for the model, the mappers and the tests. One for the
authoring affordances.

### COACH-3: the suggested setup

**Status.** Built. #203 (the pure generator) and #204 (the Players and groups
screen). With `sort_order` absent it keeps teams whole and says the order is
unset, which is the degradation this section asks for.

**Outcome.** One or two days out, a coach opens the session and the night is
already drafted: the station count, the groups, and a colour for each.

**Scope.**
- **One attendance-context resolver, used by every recommendation in the
  product**, implementing the three-fact rule in `02-target-product-model.md`
  section 6.4. It answers one question, "how many children are expected", from
  one of two sources and says which it used:

  | Context | Expected count |
  |---|---|
  | RSVP context available | Covered players whose RSVP state is accepted. Declined and unanswered do not count |
  | **No RSVP context** | The coach's own included roster on this session |

  **A missing, unconfigured or failed Spond integration must never yield a
  zero-player recommendation.** Absence of RSVP context is not evidence that
  nobody is coming, and a player with no Spond link is not a fourth RSVP answer:
  there is simply no external fact about them.
- A recommendation from that count: 24 or more recommends 5 stations and 5
  groups, fewer recommends 4, three is never recommended. **The same rule runs on
  both branches**; a club that has never configured Spond gets the whole surface.
- Group generation: keep normal teams whole where practical, combine only
  **adjacent** bands, prefer 6/5/5/4 over splitting two squads, give each group a
  **unique** target bib colour taken in the fixed vocabulary order.
- **The generator introduces no second station-bib concept.** The canonical
  resolver is unchanged and remains the only one: **session override, else team
  default, else none** (`src/lib/bibs.ts`). A target colour a group would not
  otherwise resolve to is persisted through the existing
  `register_entries.bib_colour_override`, on Save like every other Players and
  groups edit. **Nothing writes to `teams`, `player_registrations` or any Spond
  fact**: moving a child into a different group tonight cannot touch their team,
  their default next week, or their Spond membership.
- The statement that group 1 starts at station 1, derived on every read.
- Readiness, derived: an included child with no effective bib, or two active
  groups sharing a colour, means not ready, with the fix named.

**Non-goals.**
- **Nothing persists without Save groups.** The suggestion is a draft.
- **Nothing is rewritten because attendance changed.** That is COACH-4.
- No per-player ability field. No Group entity. No `group_id`.
- No configuration for rotation direction or starting station.
- **Unanswered is not attending**, and receives no bib, group or game. `waiting`
  is treated the same way and stays visible under Everyone.
- Spond still reads as context only. A club with no Spond gets the whole surface,
  and a Spond failure renders as no context, never as "nobody is coming".

**Reuse.** `src/lib/tonight.ts` entirely, `src/lib/bibs.ts`, `tonightCounts` as
the only count builder, `SessionRegister.tsx`, `useSaveTonight`.

**Database.** None.

**Tests.** 23 confirmed recommends 4 and 24 recommends 5. Three is never
recommended at any count. Colours are unique and follow the vocabulary order. The
generator keeps teams whole where it can and combines only adjacent bands. With
`sort_order` null it keeps teams whole and says the order is unset. Moving a
child writes nothing to `players`, `player_registrations` or `teams`, asserted
directly because a well-meaning "also update their team" convenience is the most
plausible regression in the programme.

**Dependencies.** COACH-2, for the declared station list. COACH-1 for banding,
degrading honestly without it and saying the order is unset.

**PR boundary.** One PR for the pure generator and its tests. One for the screen.

### COACH-4: keeping the coach's work when attendance changes

**Status.** Built. #206.

**Outcome.** Replies arriving after the coach has arranged the night do not throw
the arrangement away.

**Scope.** Remove children who are no longer attending; place newly confirmed
children; **keep every assignment already saved**; rebalance only where
necessary; state what changed in one sentence.

**Non-goals.** No regeneration by default, ever. No provenance column: the rule
preserves all saved assignments rather than only the manual ones, so it never
needs to know which were which. A deliberate Reset that regenerates from scratch
is explicitly **later work**, not this slice.

**Database.** None.

**Tests.** A saved setup plus one new confirmation places one child and moves
nobody. A departure empties one place and moves nobody. A save, a refresh and a
second save are idempotent. Reset is absent.

**Dependencies.** COACH-3.

**PR boundary.** One PR.

### COACH-5: venue layouts, scoped to venue, season and age group

**Outcome.** An admin describes each venue once per season and age group: where
four stations go, where five go, where one game goes, where two go. Every coach
reuses it every week and the positions stay familiar.

**Scope.** M2, the `venue_layouts` table keyed on
`(club_id, venue_id, season_id, age_group, kind, slots)`. `src/lib/venueLayout.ts`
(parser, serialiser, signature, sharing `clampFraction` with the diagram and the
board), an admin editor with draggable and resizable numbered zones, a read-only
renderer, and the season and age group resolution for a session.

**The age group vocabulary is scope, and it IS a migration.** An earlier draft
of this slice called it client work on the belief that `clubs.age_groups` already
existed. **It does not**: `public.clubs` carries `id, name, crest_url, motto,
created_at` and nothing more, and the `age_groups text[]` column is on
`profiles`, where it is one coach's personal preference and cannot define a club
level scope key (`00-current-state-audit.md` section 26).

So this slice also adds `clubs.age_groups text[] not null default '{}'`,
admin managed under the existing `club.manage` capability, with no backfill and
no behaviour change on apply. The layout admin screen and the session's age group
control then read the **same** canonical list, replacing two hardcoded literals
that disagree with each other today (`Planner.tsx:763` offers `'U6s'…'U12s'`;
`AGES` in `data.ts:536` is `'U6'…'U12'`). **No historical `sessions.age_group`
value is rewritten**: a legacy label simply resolves no layout, which is one of
the five named no-layout states.

**Non-goals.** **No imagery, satellite or otherwise.** No coordinates, no
address, no navigation. **No weekly placement of any kind**, and no per session
composer. **No `sessions.season_id`**: the season derives from the session's
date. No layout versioning beyond the shape version. **No `created_by`,
`updated_by` or `updated_at`**: `venues` carries none of them and says why, and
the audit trail is the record of who changed a layout.

**Reuse.** The whole shape discipline of `0046` and `src/lib/drillDiagram.ts`,
and the "refuse to guess when zero or more than one matches" rule
`matchVenueByLocation` already applies.

**Database.** M2 (`04-data-model-proposal.md` section 3). One table, RLS
mirroring `venues` exactly, explicit grants, and a check constraint stating the
zone key allow-list.

**Audit.** A decision the migration makes: recommended, audit create, update and
delete at venue granularity. **Because the layout is a table rather than a column
on `venues`, `audit_venues()` and its "Venue renamed" label stay true**, and the
label correction an earlier revision had to schedule disappears.

**Tests.** Parser and serialiser round trip. An unknown version yields no layout.
Out-of-range coordinates are clamped. A corrupt zone is dropped rather than
taking the layout with it. The constraint refuses a key outside the allow-list,
including a location-shaped one, and holds against service_role. A zone count
that disagrees with `slots` is refused, as are 3 stations and 3 games. Two
layouts of the same kind and slots in one scope are refused. **A four zone value
is refused on a `slots = 5` row**, which is the case a predicate over `zones`
alone could not catch. **Season resolution fails closed**: exactly one containing
season wins; **zero renders no layout and says the date falls in no season; more
than one renders no layout and says it falls in more than one**. Neither failing
branch consults `seasons.is_current`, and a test asserts that a 2025 session does
not load the current season's allocation.

**Manual smoke.** Configure Haggs Hill for this season and one age group, four
and five station layouts plus one and two game visuals. Confirm both render
legibly at phone width. Confirm a second age group at the same venue gets its own
layouts and does not see the first's.

**Dependencies.** None. Can run in parallel with everything except its own
ledger sequencing (section 5).

**Rollback.** Drop the table, which **discards every saved layout**. Drop the
check constraint alone if only the shape is being withdrawn.

**PR boundary.** One gated migration PR. One PR for the model and its tests. One
for the admin editor and the shared age group list. One for the renderer.

### COACH-6: the setup map

**Outcome.** A coach opens the session on their phone and sees where everything
goes, without being told.

**Scope.** On session day, resolve the session's scope (venue, season, age
group) and its active station count, load the matching layout and draw the zones.
Each zone carries the **station number, the drill name and the group starting
there**. A subtle clockwise cue. The same stations available as an ordinary list.
A station stood down tonight is not drawn and is named as not running.

**Non-goals.** **No drill diagram inside a zone.** No pinch-dependent design. No
progress, no current station, no rotation state. No editing of anything from
here.

**Reuse.** COACH-5's renderer, COACH-2's station list, `tonightGroups`,
`SessionDay.tsx`.

**Database.** None.

**Tests.** The **five** no-layout states named in `02-target-product-model.md`
section 8 are distinguished, using those names rather than a count of this
slice's own: no venue, no age group, an unresolved season, an ambiguous season,
none drawn for this scope yet, and a **slot count outside the stored set, which
no admin can fix because the constraint refuses a three station layout**. An
unset `sessions.age_group` says so rather than matching nothing silently. Each says which, and none blocks anything. A session with four active stations loads the four
station layout, and standing one of five down moves it to the four station
layout. A session in a different age group at the same venue loads its own
layout. Zone labels carry number and name, never colour alone. Screen-level tests
at phone width.

**Dependencies.** COACH-2 and COACH-5. COACH-3 for the group labels, degrading to
number and name without it.

**PR boundary.** One PR.

### COACH-7: the station detail screen

**Outcome.** One tap from the map, a coach who has never seen the drill can run
it.

**Scope.** Full screen: station number, drill name, the diagram large, the
objective, two or three concise coaching points. **Previous station**, **Next
station**, **Back to setup map**.

**Non-goals.** **No equipment on this screen**; it belongs to setup and was dealt
with before the children arrived. No administrative metadata. **Previous and Next
are browsing** and must not imply session progress: no wording, no highlight and
no persisted position may suggest otherwise.

**Reuse.** `ActivityDiagram` and `DrillDiagramView` exactly as they are mounted
on session day today, so this is a layout around an existing seam.

**Accessibility, which is scope rather than a footnote.** Tap targets at or above
the 44 pixel minimum the app already uses. Keyboard and screen reader paths
through map, station and back. This is where the phone half of QUALITY-02 should
be pulled in rather than deferred again.

**Tests.** The screen renders number, name, diagram, objective and points and
**not** equipment. Next from the last station does not wrap into a claim about
progress. An England Football drill still shows its own image and no hand drawn
diagram, through the existing rule.

**Dependencies.** COACH-6.

**PR boundary.** One PR, possibly two if the navigation is substantial.

### COACH-8: the game plan

**Outcome.** The games are planned as their own arrangement, with their own bibs,
without destroying the station groups.

**Scope.**
- M3, `register_entries.game_bib_colour_override`.
- Game resolution in `src/lib/bibs.ts`: game override, else the effective station
  bib.
- **A3, `gameCount: 1 | 2`** on the one activity declared `slot: 'game'`
  (COACH-2), added to both mappers, session local and stripped from templates.
  **No migration**: it rides `sessions.activities`.
- A recommendation: `1` at 12 or fewer confirmed, `2` at 13 or more, aiming at
  5v5 or 6v6 and avoiding 7v7. The coach accepts or overrides it, and **an
  accepted count is never silently rewritten because attendance changed**.
- **Game and side are decided FIRST, from players; colour is chosen SECOND, from
  that decision.** Never the reverse. The full contract is in
  `02-target-product-model.md` section 7, and the settled priority is **sensible
  game size, then ability banding, then minimising bib changes**. Station-group
  preservation does not outrank banding.
  1. Assign each included player to a game. With two games, the club's ordered
     teams give the stronger and development populations, and the middle band is
     split between them wherever that produces sensible numbers.
  2. Split each game into two sides, balanced on count and ability within that
     game's own population, without turning the bands into two opposing blocs.
     With one game this is where the ability balance happens.
  3. Map game and side to the deterministic colour: the first `2 x gameCount`
     colours of the fixed vocabulary, index 0 game 1 side A, index 1 game 1 side
     B, and so on. The UI offers only those colours.
- **Then write the override wherever the target side colour differs from the
  player's effective station bib**, and only then. A null override means "this
  player's station bib already happens to be their side's colour", and never
  "their station colour appears somewhere in the palette".
- **`game_bib_colour_override` takes no `'none'`.** Null inherits the effective
  station bib; any stored value is a real `BIB_COLOURS` member. An included
  player taking part in the games resolves to a real colour, so the station
  column's sentinel is not given a second meaning here.
- **The deny lists.** `game_bib_colour_override` and its camelCase form join
  `FORBIDDEN_ANYWHERE` in `supabase/functions/_shared/share.ts` and `FORBIDDEN`
  in `src/lib/publicShare.ts` **in this slice**, not when a session is first
  shared. It names a child's bib.
- **The venue's games layout is loaded by `gameCount`**: 1 loads the one game
  layout, 2 loads the two game layout.
- Suggested sides from the club team order: with two games the upper teams form
  the stronger game and the lower the development game, with the middle band
  split where the numbers need it; with one game the sides are balanced by
  ability with the stronger players distributed across both.
- The game plan shows player names, side and game bib colour.
- The games view on session day, using the scope's game layout.

**Non-goals.**
- **The station bib plan is never written by this slice**, and a test asserts it.
- **No second game activity**, ever, to represent a second pitch. Activities are
  sequential and summed; one games phase is one activity with one duration.
- **No per-player game number and no per-player side column**, and no stored
  colour map.
- **The thresholds are not policy.** One named adjustable place, with the
  reasoning beside them, producing a sentence and never a change.
- **The recommendation never rewrites the plan.** Two planned games stay two.
- No per-player side column and no per-player game number.
- **No session-level colour map.** Only implementation evidence that the
  deterministic ordering cannot work would justify one.
- No averaging two games into identical mixtures.
- **Physical changes on the pitch are not persisted.**

**Database.** M3. One nullable column with the closed colour vocabulary, copying
nothing from the existing column in either direction, proven in the migration's
self-verification in the manner of 0047.

**Tests.** A game re-bib leaves `bib_colour_override` byte for byte unchanged,
and leaves `present` and `included_in_groups` untouched. 12 recommends
`gameCount = 1` and 13 recommends `2`. **An accepted count survives an attendance
change that would now recommend the other**, and the screen says so rather than
rewriting it. **A session's total, expected end and calendar length are identical
with `gameCount` 1 and 2**, which is the whole point of it being a field rather
than a second activity. `gameCount` round trips through a session and is
**absent** from a template written from it. With no accepted count there are no
game colours to offer. A child nobody re-bibbed plays in their station colour.
Sides follow the club order and the middle band is the one that splits. **Five
groups and two games leaves nobody without a game**, which is the case the
station-colour fallback alone gets wrong. A colour outside the planned ordering
resolves to no game and shows as unassigned rather than being guessed into the
nearest one, and readiness names it. A social drill in the `Game` phase that
nobody declared is not one of the games. A save sends only the columns that
changed.

**Dependencies.** COACH-3 for the groups, COACH-1 for the banding, COACH-5 for
the games view.

**PR boundary.** One gated migration PR. One PR for the resolution and the
suggestion. One for the screens.

### COACH-9: the share, checked rather than built

**Outcome.** A coach sends the session to another coach from the delivery
surface, and nothing operational leaves the app.

**Scope.** Keep the existing internal share reachable from the redesigned
delivery surface. Add a test pinning the payload: a URL and a title, with no
player name, bib, group, game or Spond field.

**Non-goals.** No WhatsApp specific integration. No new share seam. No
per-recipient variant. No public projection.

**Database.** None. **Edge Functions.** None.

**Dependencies.** COACH-6 for placement; the test half depends on nothing.

**PR boundary.** One small PR.

### COACH-10: one authoring seam

**Status.** Built. #207.

**Outcome.** The planner and the week plan editor stop maintaining two activity
editors.

**Scope.** One shared activity-list editor used by `Planner.tsx` and
`TemplateFormModal.tsx`, owning the list, the add bar, the row, reorder, phase
and duration. Hosts supply what genuinely differs.

**Non-goals.** **No new affordance at all.** If a user notices this slice, it went
wrong.

**Tests.** The existing `Planner.test.tsx` and `TemplateFormModal.test.tsx`
suites pass unchanged, which is the right guard for a refactor that could quietly
change behaviour in one host. A source-text test that both hosts mount the same
seam.

**Dependencies.** None. **Gates** COACH-11 and COACH-12.

**PR boundary.** One PR.

### COACH-11: create and draw a drill from either surface

**Outcome.** A coach writing a plan, whether a programme week or Tuesday's
session, can create the drill they have in mind, draw it, and carry on.

**Scope.** **New drill** in the shared add bar. A minimal create form. **Draw
it**, opening `/drill/:id/diagram` and returning to where it was opened from with
the draft intact. **Turn into a drill** on a custom activity.

**Non-goals.** No adaptation semantics (COACH-12). No Drill Maker tool changes.
No new capability: this needs `drills.create`, exactly as creating one from the
library does.

**The hazard, and it has two cases.** Both hosts hold an unsaved draft and
leaving to draw must not lose either. The planner's lives in `sessionSubmit.ts`
and `useGuardedSubmit`; the week plan editor's lives in `TemplateFormModal`'s own
form state inside a modal, which unmounts. Decide it once in the seam.

**Dependencies.** COACH-10.

**PR boundary.** One PR, possibly two if the modal round trip is substantial.

### COACH-12: adapt a drill for one session

**Outcome.** A coach changes a drill for Saturday and nothing else changes, and
the library does not fill up with copies.

**Scope.** M4: `drills.variant_of` for provenance and `drills.library_listed` for
whether a drill belongs in the library, because the parent link is nulled when
the original is deleted and a listing must not change by itself. **Adapt for this
session** duplicates the drill including the diagram, repoints the activity and
creates it unlisted. It is reachable from its session and from its parent.
**Save as reusable drill** creates a new listed drill. A usage line on the drill
edit form: "Used in 6 sessions, 4 already delivered", with Adapt for one session
beside it.

**Every normal library selector excludes unlisted adaptations, and that is a data
change, not a display filter.** `useDrills()` (`src/lib/queries.ts:503`) selects
every row with no filter and is the single list read behind **both** the Library
screen and the **Add from library** picker (`src/components/AddDrillModal.tsx`,
over `src/lib/drillPicker.ts` and `src/lib/drillFilter.ts`). Left alone, every
session adaptation appears in the picker every coach opens while planning, which
is the two-hundred-near-duplicate outcome M4 exists to prevent. So this slice
introduces an explicit reusable-library read and points **every** normal browsing
surface at it. An unlisted adaptation stays reachable from the session that owns
it and from its parent's detail page, and from nowhere else.

**Non-goals.** No versioning and no version numbers shown anywhere. No
snapshotting of delivered sessions. No merge or push-back to the original. **A
session adaptation never overwrites the original.**

**Database.** M4, plus `drills_id_club_unique`, which does not exist yet.

**Tests.** The copy is independent: editing it changes neither the original nor
another session using the original. **Deleting the original leaves its
adaptations alive, still runnable from their sessions, and still absent from the
library**, which is the case a listing derived from `variant_of` gets wrong.
**An unlisted adaptation is absent from BOTH library surfaces**, the Library
screen and the Add from library picker, asserted separately, because they are two
screens over one read and fixing one does not fix the other. The
library lists no adaptation. Save as reusable produces a new listed row and
leaves the parent untouched. An adaptation of an England Football derived drill
inherits the source attribution and the redraw prohibition.

**Dependencies.** COACH-10.

**PR boundary.** One gated migration PR. One frontend PR.

### COACH-13: week plans, promotion and two deliveries

**Outcome.** A coach plans Tuesday, and Saturday is one action away, and the
interface stops saying "template".

**Scope.** Rename template to **week plan** in everything a user reads. **Save
this session as a week plan.** Apply a week plan to more than one date in one
action.

**A session adaptation is never shared across dated sessions.** A session-only
adaptation belongs to the session that made it, and promotion must not quietly
turn it into shared content. Promoting a session whose plan holds an adaptation
would otherwise write that hidden drill's id into `templates.activities`, and
applying that plan to two dates would give two sessions **one** drill row: editing
it from either would change the other, which is exactly what this programme's
copy-on-adapt decision exists to prevent, on a drill invisible in the library so
nobody would notice.

**So promotion requires an explicit choice, and offers the two safe ones:** use
the adaptation's **original** reusable drill in the promoted plan, or **Save as
reusable drill** first and use the new listed drill. Nothing is decided silently
and nothing hidden is promoted. No template-owned hidden drill variant is
introduced; there is no proven need for one.

**Promotion is also a template WRITE path**, and therefore a third call site for
the session-local helper: it must strip `skipped` and `gameCount` on the way into
the week plan, while carrying `slot`. Enumerating today's two write paths by line
number does not cover a path that does not exist yet.

**Non-goals.** No propagation of an edit from one delivery to the other. No new
planning entity. **No `template_id`**: the journeys are copies and work without
it (`04-data-model-proposal.md` section 9). **No silent reuse of a hidden
adaptation, and no silent promotion of one to reusable.**

**Database.** None.

**Tests.** Promote produces a plan matching the session **except for the
session-local keys**, which are stripped. Apply to two dates produces two
independent sessions, and editing one leaves the other untouched. **Promoting a
session that holds an adaptation does not put the adaptation's id in the week
plan**, and offers the original or Save as reusable instead. A copy sweep test
that no user-visible string says "template".

**Dependencies.** COACH-10 loosely, for the editor. **COACH-12**, because the
adaptation rule above is only meaningful once adaptations exist.

**PR boundary.** One copy PR, one journeys PR.

### Parked

| | Why |
|---|---|
| **Drill Maker authoring improvements** (click to place, duplicate, undo, snapping) | Real but not on the settled critical path. No schema. Can be picked up whenever there is capacity. |
| **Drill motion** | Gated on evidence that the static workflow is in daily use, not on enthusiasm. M5 widens a check constraint and carries the reader-first rollout hazard. |
| **A public operational projection, and DRILL-02b** | Separate club and security decisions, owned by TRAIN-02 and by #189's own follow-up. Prerequisites for nothing here. |
| **A deliberate Reset that regenerates the setup** | Explicitly later. COACH-4 preserves; nothing discards. |
| **Parent-facing group information** | Out of the settled model entirely. |

---

## 4. Dependency graph

```
COACH-2 (declare stations and games, no schema)
   ├─ COACH-3 (suggested setup, no schema) ─┬─ COACH-4 (attendance change, no schema)
   │        ↑ wants COACH-1                 └─ COACH-8 (game plan, M3)
   ├─ COACH-6 (setup map) ── COACH-7 (station detail) ── COACH-9 (share check)
   │        ↑ needs COACH-5
   └─ COACH-8

COACH-1 (team order, M1)     independent, wanted by COACH-3 and COACH-8
COACH-5 (venue layouts, M2)  independent, needed by COACH-6 and COACH-8's games view

COACH-10 (authoring seam) ─┬─ COACH-11 (new drill, draw it)
                           ├─ COACH-12 (adapt, M4)
                           └─ COACH-13 (week plans)
```

**COACH-2 is the root of the operational track**, because nothing can name a
station or a game until a plan declares one.

Two independent tracks. The upper track delivers the primary success scenario;
the lower is authoring and can run in parallel by a second pair of hands. COACH-2
and COACH-10 both touch the authoring seam, so if both are in flight they are
sequenced rather than merged blind.

**Nothing in this graph depends on a sharing decision, a public projection, an
Edge Function deploy or a Spond change.**

## 5. Recommended sequence, and how the migrations are timed

**The four migration slices are not sequenced by this list.** A file number
reserves nothing: the reviewed register pins every migration to the hosted
ledger head it was written against, so an entry cannot even be written until that
head is known (`04-data-model-proposal.md` section 8). When this plan was
written, open draft PR #191 owned reviewed migration `0050`; it merged on
27 August 2026 and `0050` was applied on 23 August, so the hosted head observed
on 2 September 2026 is `20260823065041` / `bulk_delete_players`. The first
coaching migration pins whatever the head is at its own review, which is that
row only if nothing else has applied first.

**So the non-migration slices led, and each migration is authored, numbered and
registered when it is ready for its own application review, against the live
ledger as it stands then.**

### The migration-free run, now complete

1. ~~**COACH-2**, declare the stations and the games.~~ Built: #198 and #202.
   No schema, two mapper entries, and it is the root of everything operational.
   It also removed the last reason anyone would reach for a blocks column, and
   it fixed a defect rather than adding a feature: before it nothing in the
   data said what a station is.
2. ~~**COACH-3**, the suggested setup.~~ Built: #203 and #204. The slice a coach
   feels: "26 confirmed, 5 stations, 5 groups, everyone has a colour", 24 to 48
   hours out. It wants COACH-1 for banding and degrades honestly without it,
   saying the order is unset.
3. ~~**COACH-4**, preserving the coach's setup when attendance changes.~~ Built:
   #206.
4. ~~**COACH-10**, the authoring seam.~~ Built: #207. A pure refactor proved
   against two existing suites.

### The migration slices, in dependency order

5. **COACH-1**, `teams.sort_order`. **Built**: COACH-1A, migration
   `0051_team_sort_order`, merged as #223 and applied on 2 September 2026, and
   COACH-1B, the ordering affordance, in its own PR. One nullable column on a five-row
   table, and the smallest possible first migration for this programme. It
   upgrades COACH-3 from "keeps teams whole" to "combines adjacent bands".
6. **COACH-5**, the `venue_layouts` table. The largest single review in the
   programme: a new table, a new shape boundary, RLS mirroring `venues`, and the
   season and age group resolution.
7. **COACH-8**, `register_entries.game_bib_colour_override`, after COACH-3 and
   ideally after COACH-5 so the games view has a layout to draw.
8. **COACH-12**, `drills.variant_of`, on the authoring track after COACH-10.

### The rest, by capacity

**COACH-6** and **COACH-7** as soon as COACH-5 lands, since they are the primary
success scenario. **COACH-9** any time. **COACH-11** and **COACH-13** after
COACH-10.

**Gated migration reviews:** COACH-1 (M1), COACH-5 (M2), COACH-8 (M3), COACH-12
(M4). Each is registered separately, against the head it will actually run
against.

**Full RLS or auth reviews: none.** No role is added, no existing policy is
altered, and the authentication boundary does not move.

**A policy and grant review: one.** COACH-5, because M2 creates a table and a
table carries policies. It is not a full RLS review because those policies mirror
`venues` exactly, so the reviewer checks an instantiation of an existing pattern
rather than a new access rule.

**Focused content-sharing boundary reviews: two.** COACH-2, because it changes
`_shared/share.ts` and needs an Edge deploy; and COACH-8, because it adds a
child-linked column that must reach both public-share deny lists.
`05-security-share-boundary.md` section 9 carries the scope of each.

## 6. Adversarial pass, after the correction

Run against the corrected model, including against the two conclusions this pass
overturned.

**Why did the previous pass reach for `Phase` at all?** Because it was optimising
for "no migration", found a field that correlated with the answer on the sessions
it imagined, and stopped. The correlation is real and it is not identity:
`phaseFor` (`src/lib/drillPicker.ts:17`) sets the phase from the drill's
four-corners classification, so a physical drill lands in Warm-Up and a social
drill lands in Game, whatever part either plays on the night. **The lesson
generalises: a field that means one thing may not be read as though it meant
another, however convenient the overlap.** The corrected answer still needs no
migration, because the column it rides is unconstrained jsonb, so the saving was
never the reason to guess.

**Does declaring `slot` add a concept a coach has to learn?** One, and it is the
one they already have: this drill is a station, that one is a game. It replaces
nothing they understood before, because today the product cannot express it at
all. The count and the numbering stay derived, so nothing new is remembered.

**Is `skipped` the reversible thing it claims to be?** Yes, and the shape is what
makes it so: the key is removed rather than set to `false`, the activity keeps
its place and duration, the week plan never receives it, and the library drill is
untouched. The failure mode to guard is a template that somehow carries one, and
both ends handle it: the template write paths strip it and the reader ignores it
on a template, failing towards running the drill.

**Was scoping the layout to a venue alone a reasonable simplification?** No, and
it is worth saying why the argument was wrong rather than just reversing it. It
rested on "a rectangle on the ground is a physical fact that does not change with
the season", which is true of the grass and false of **the club's allocation of
it**, which is what a layout actually records. Two age groups at one venue are
allocated different areas, and a club's allocation is renegotiated between
seasons. The settled decision said venue, season and age group, and a design
document does not get to narrow a settled requirement because a column is easier
than a table.

**Does the table cost more review than it saves?** It costs the most of any
single migration here: a new table, new policies, new grants, a new shape
boundary and an audit decision. Against that it buys an enforceable season
reference, a unique key that makes one layout per scope a database fact, a
natural unit of editing, and no unbounded blob. It also **removes** a scheduled
correction: with the layout off `venues`, `audit_venues()` and its "Venue
renamed" label stay true.

**Is deriving the season from the date safe, given seasons may overlap?** It is,
now that it **fails closed in both directions**: exactly one containing season
wins, and zero or more than one loads no layout and says which. An earlier draft
of this very paragraph still described falling back to the current season and
called the residual "quietly uses the current one", which was the wrong answer
written down twice; review caught it surviving here after the model had been
corrected. There is no fallback. The alternative, `sessions.season_id`, is a
second fact that can disagree with the date, and it stays rejected.

**Is the deterministic game colour rule actually deterministic?** It is a pure
function of the fixed `BIB_COLOURS` order and the game count, both of which every
reader already has, and the UI offers only the colours it produces. The residual
is a stored colour outside that list, reachable only by a hand-written write, and
it resolves to no game rather than to the nearest one. A session-level map would
remove the residual and add a second fact that can disagree with the bib a child
is wearing, so it stays unbuilt until implementation evidence demands it.

**Is removing the frozen carousel assignment still right?** Yes, and the
arithmetic behind it still stands: nine colours cannot map injectively into four
or five stations, and ranking the active colours shifts when one leaves. What
changed is that nothing consumes stability, because OTJ no longer claims to know
that a carousel is running. **If the club ever asks OTJ to drive one, the proof
and the mechanism are both still on the record** (`00-current-state-audit.md`
section 22).

**Is the second bib column the thing an earlier revision correctly refused?** No.
It refused `carousel_bib` and `game_bib` as phases of a general block mechanism
whose count was a planning decision. There is no general mechanism now: there are
exactly two arrangements per night and the settled decision requires both at
once. Refusing the column would mean overwriting the station plan, which
discovery forbids, or inventing a per-player side row, which duplicates
membership that already lives once.

**Does anything else in the model store what could be derived?** Checked one at a
time. Station number: derived. Rotations: derived. Starting station: derived.
Group identity: derived from the bib. Game and side: derived from the game bib.
The session's season: derived from its date. Readiness: derived. Lifecycle:
already derived. **The stored things are the club's team order, the venue's
geometry per scope, a child's two bibs, a drill's parent, and two words on an
activity.** Each is a fact nothing else can produce.

**Does anything require OTJ to be right about a moving pitch?** Checked per
slice. COACH-1 through COACH-5 are pre-session. COACH-6 and COACH-7 are read-only
browsing. COACH-8 writes a plan saved before training. COACH-9 shares a link.
COACH-10 through COACH-13 are authoring. **No slice writes during delivery**, and
the one thing that does today, the live driver's activity index, is untouched.

**What is genuinely weaker after this correction?** Two things, both recorded.
The grouping suggestion's quality is unprovable in advance and needs coach
feedback after one real use. And the age group vocabulary is **two** hardcoded
literals that disagree with each other, with **no club level list to read at
all**: `clubs.age_groups` does not exist, and the column that does is on
`profiles` and is per coach. So the layout scope's third key rests on a
vocabulary COACH-5 has to create as a migration, not merely wire up.

**What could still go wrong that this plan does not cover?** A plan authored
before COACH-2 declares no stations, so every existing session shows an empty
setup map until someone marks it. That is correct and it will still read as a
regression to a coach who does not know why, which is why the empty state has to
say what to do rather than merely say nothing is there.
