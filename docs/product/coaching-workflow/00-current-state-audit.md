# Current-state architecture audit

Status: reference. Captured 17 August 2026 against `main` at `2283350`, by reading
the code and the migration files rather than by trusting any earlier document.
**Re-verified 18 August 2026 against `main` at `afe790d`.** Only the facts that
genuinely changed have been edited: PR #189 has merged, so the drill diagram now
renders across session delivery (sections 7, 18); the internal club link share was
missed by the first pass and is recorded in a new section 24; the migration ledger
position has moved on (section 25); and section 22's conclusion has been withdrawn
now that nothing consumes it, while its arithmetic stands. **Re-read
2 September 2026 against `main` at `3cb20f9`:** the passages that COACH-2
(#198, #202), COACH-3 (#203, #204), COACH-4 (#206) and COACH-10 (#207) have
overtaken carry a superseded or built marker where they stand (sections 2, 4,
5, 9, 16, 17, 20 and 27, and the notable findings), and the rest is left as
captured.

This is the factual half of the coaching workflow discovery. It answers the
questions the overhaul depends on, with the repository path, table or function
that carries each answer. Nothing here is a proposal. The proposal is
`02-target-product-model.md` onward.

---

## 1. How programmes are represented today

`public.programmes` (`supabase/migrations/0011_programmes.sql`), mapped by
`toProgramme` in `src/lib/queries.ts:398`, typed as `Programme` in
`src/lib/data.ts:344`.

A programme is a container with a name, focus, summary, `intentions[]`, a planned
`weeks` count, an optional attached PDF (`pdf_media_id`), source attribution and
a rights class. It holds no drills and no activities of its own.

Its weeks are `public.templates` rows carrying `programme_id` and
`programme_week`. Screens: `src/routes/Programmes.tsx`,
`src/routes/ProgrammeDetail.tsx`, `src/components/ProgrammeFormModal.tsx`.
Week assignment and duplication already exist as `useAssignTemplateWeek`
(`src/lib/queries.ts:1766`) and `useCopyTemplateToWeek` (`:1785`).

Legacy: `templates.programme` and `templates.week` are free-text grouping labels
kept as the 0011 backfill source. New code does not write them.

## 2. How sessions are represented

`public.sessions` (`0001_init.sql`, extended by 0002, 0005, 0006, 0011, 0022,
0044, 0048), mapped by `toSession` in `src/lib/queries.ts:422`, typed as
`Session` in `src/lib/data.ts:363`.

The columns that matter here:

| Column | Meaning |
|---|---|
| `activities` jsonb | The plan. An array of `{ phase, drill_id?, title?, duration }` when this was captured; **since COACH-2 (#198, #202)** each entry may also carry `slot` (`'station'` or `'game'`, the declared structure) and `skipped` (`true` only, session local, stripped from every week plan). Section 27 carries the mapper detail. |
| `date`, `start_time` | Local wall clock, read as parts, never `Date.parse`. |
| `venue_id` | The chosen venue (0044). `venue` free text is FROZEN. |
| `team_id` | FROZEN legacy single team. Coverage is `session_teams`. |
| `programme_id`, `programme_week` | Back-link to the programme week it came from. |
| `spond_event_id` | The mirrored Spond event. Unique among non-null (0048). |
| `board_id` | An attached tactics board (0022). |
| `live_activity_index`, `live_activity_started_at` | Shared live state (0006). |
| `rights` | Sharing classification (0038). |

There is no `template_id`. A session built from a standalone template carries no
record of which template it came from; only a programme-applied session does, and
that link is indirect through `programme_id` plus `programme_week`.

## 3. The relationship between a planned session and a dated event

There are three distinct things and they are already separate rows:

1. **Programme** (`programmes`): the long-running theme.
2. **Week plan** (`templates`): the reusable plan, optionally a programme week.
3. **Dated session** (`sessions`): what happens on a day, at a venue, for a set
   of teams.

Plus a fourth that is a mirror rather than a plan: **`spond_events`**, the synced
copy of what the club arranged in Spond.

The transition from plan to dated session is a **copy**, in two places:

- `src/hooks/useStartFromTemplate.ts` deep-copies `template.activities` and
  `intentions` onto a new session and opens the planner.
- `src/components/ApplyProgrammeModal.tsx` walks a programme's weeks, computes a
  date per week from a start date and a weekday, and creates one session per week
  through the same session write path, copying each week template's activities.

So editing a template after a session has been created from it does **not** change
that session. Editing a **drill** does, because activities reference drills by id
(see section 5).

`sessions.spond_event_id` is the only link between a dated session and the
Spond event it was arranged as. `0048_spond_session_link_unique.sql` makes one
session per mirrored event a database fact.

Whether a session is still operational work is **derived on every read** by
`src/lib/sessionLifecycle.ts`: three states, `active`, `endedToday`, `past`.
Nothing is stored and nothing writes. `sessions.status` is only ever set to
`completed` by the live view's driver pressing End.

## 4. How drills are related to sessions

Through `activities[].drill_id`. That is the only relationship. There is no join
table, no ordering table and no per-session drill row.

`Activity` (`src/lib/data.ts:302`) was exactly four optional-ish fields when
this was captured:

```ts
interface Activity { phase: Phase; drillId?: string; title?: string; duration: number }
```

**Superseded in part by COACH-2A (#198):** `Activity` now extends
`StructuredActivity` (`src/lib/activityStructure.ts`) and carries `slot` and
`skipped` beside those four; both mappers name both keys, and the template
boundary strips `skipped` on the way into a week plan. The rule below is
unchanged and is exactly why those two keys had to be added to both mappers.

`toActivity` / `toActivityRow` (`src/lib/queries.ts:289`, `:296`) rebuild the
object field by field from that allow-list, so **any key added to the stored
jsonb that these two functions do not name is dropped on read and lost on the
next save**. `sessions.activities` itself carries **no check constraint**
(`0001_init.sql:99`), unlike `drills.diagram`.

## 5. Is a session activity a snapshot or a reference?

**A reference, with two per-session overrides** when this was captured, and
**four since COACH-2 (#198, #202)**: `slot` (which is also carried by a week
plan, because it belongs to the plan) and `skipped` (session local only) join
the two below. The reference itself is unchanged.

- `duration` and `phase` are stored on the activity, so they are session-local.
- Everything else (title, summary, coaching points, setup notes, equipment,
  area, players guidance, STEP adaptations, the attached media item, the
  diagram) is read live from the referenced `drills` row.
- A "custom" activity has `title` and no `drillId`. It is the only session-local
  content in the model. When captured it carried nothing but a title, a phase
  and a duration, created by the planner as
  `{ phase: 'Skill', title: 'Custom activity', duration: 10 }`. Since COACH-2
  (#198, #202) it carries the same two structural keys as any other row: the
  role controls in `src/components/ActivityListEditor.tsx` render on every row,
  drill or custom, so a custom row can be marked a station or the games phase
  (`slot`), and on a dated session a custom station can be stood down
  (`skipped`). It still carries no drill content.

## 6. What changes if a referenced drill is edited later

Every session that references it changes, including sessions that have already
been delivered, silently and with no warning on the edit form
(`src/components/DrillFormModal.tsx`).

The only frozen copy in the product is the **public share snapshot**
(`content_shares.snapshot`, section 13). A shared session keeps the drill text it
was shared with until someone refreshes the share.

There is one existing rule protecting session history from drill deletion:
`partitionDrillsByUsage` (`src/lib/queries.ts:310`) keeps, rather than deletes,
an imported drill that any session still references when its source template or
programme is deleted.

## 7. How Drill Maker data is stored

`public.drills.diagram`, a nullable jsonb column added by
`0046_drill_diagram.sql`. The client model is `src/lib/drillDiagram.ts`.

- Versioned: `DRILL_DIAGRAM_VERSION = 1`. An **unknown version discards the whole
  diagram on read**, deliberately, so a future shape is never flattened back into
  version 1. This is the single most important constraint on any motion work.
- Seven element types: `player`, `cone`, `ball`, `goal`, `arrow`, `zone`, `text`.
- Coordinates are fractions from 0 to 1, never pixels, so one stored diagram
  renders on a phone, a desktop and in print.
- Bounds: `MAX_DIAGRAM_ELEMENTS = 60`, `MAX_TEXT_LENGTH = 24`,
  `MAX_PLAYER_LABEL = 3`.
- Colours are a subset of the bib vocabulary (`src/lib/bibs.ts`), pinned by
  `drillDiagram.invariant.test.ts`.
- Both the parser and the serialiser rebuild every element from an allow-list and
  never spread an input object, so no person field can survive a read or a write.
  `0046` states the same allow-list as a **check constraint**, so the boundary
  holds against service_role and any hand-written PostgREST call.

Editor: `src/routes/DrillDiagramEditor.tsx` at `/drill/:id/diagram`, behind
`RequireCap cap="sessions.create"` (`src/App.tsx:106`). Who may draw is decided by
`diagramEditDecision` (`src/lib/drillDiagramRights.ts`): ownership as for editing
the drill, and **never** for an England Football derived drill, because the club's
licence forbids redrawing FA content.

Read-only rendering: `src/components/DrillDiagramView.tsx`, the canonical
renderer. **Changed by #189, which has merged.** Grepping for `DrillDiagramView`
and `ActivityDiagram` outside tests now returns `DrillDetail.tsx`,
`DrillDiagramEditor.tsx`, `ActivityDiagram.tsx`, `Planner.tsx`, `SessionDay.tsx`
and `LiveSession.tsx`.

**So the DRILL-02 gap this section previously recorded is closed for the
authenticated surfaces.** `src/components/ActivityDiagram.tsx` owns the read and
the display rule, `ActivityDiagramView` is its pure half, and every session
surface mounts one of them rather than drawing its own. Section 18 records what
merged and the constraints it leaves behind. What is still not published is the
print and public share half, held as DRILL-02b.

Note the naming collision to be careful of: `DiagramViewer`
(`src/components/DiagramViewer.tsx`) is the full-screen viewer for **media
images**. `DrillDiagramView` renders a **saved Drill Maker diagram**. They are
different things with similar names.

## 8. What is reusable versus session-specific today

| Thing | Reusable | Session-specific |
|---|---|---|
| Drill (all fields, media, diagram) | Yes, one shared row | No |
| Activity phase and duration | No | Yes |
| Custom activity title | No | Yes |
| Week plan (`templates`) | Yes | Copied on use |
| Programme | Yes | Copied on apply |
| Tactics board | Yes (`boards`) | Attached by `board_id` |
| Venue | Yes (`venues`) | Chosen by `venue_id` |
| Bib colour | Team default | Per player per session override |

There is no concept of a drill variant, a drill copy or a session-scoped drill.

## 9. How Add from Library works

`src/components/AddDrillModal.tsx`, a thin shell over `src/lib/drillPicker.ts`
and `src/lib/drillFilter.ts` (PLAN-01, PR #179).

The selection is a set of drill ids independent of the current filter; confirm
draws from the full library list through `selectedActivities`, which maps each
picked drill to `{ phase: phaseFor(corner), drillId, duration }`. `phaseFor`
places physical drills in Warm-Up, social drills in Game and everything else in
Skill.

The planner's only two add affordances are `Add from library` and `Add custom`
(`AddActivityBar`, `src/routes/Planner.tsx:570`). **There is no way to create a
drill from the planner.** `DrillFormModal` is reachable from `Home.tsx`,
`Library.tsx` and `DrillDetail.tsx` only.

### There are already two activity editors, not one

**Superseded by COACH-10 (#207).** This section is a snapshot captured before
that slice: the planner and `TemplateFormModal` now mount one shared
`ActivityListEditor` (`src/components/ActivityListEditor.tsx`), and the
duplication described below no longer exists.

`src/components/TemplateFormModal.tsx` carries its own activities editor, whose
own comment says it "mirrors the planner": it mounts the same `AddDrillModal`
(`:188`), adds the same custom activity literal
`{ phase: 'Skill', title: 'Custom activity', duration: 10 }` (`:146`), and has
its own `setAct`, remove and reorder handlers (`:42` to `:59`) and its own
`TemplateActivityRow` (`:206`) beside the planner's `ActivityCardView`.

**This matters for sequencing.** A week plan is authored in the template editor
and a dated session in the planner, so any authoring improvement built in one
place is immediately absent from the other. Adding a "New drill" affordance to
the planner alone would make the divergence three-way rather than two-way. Long
range planning happens in the template editor, weeks before a dated session
exists, so it is not the secondary surface.

## 10. How attendance and Spond replies join a session

- `spond-sync` (Edge Function, manual trigger through `useSpondSync`,
  `src/lib/queries.ts:2488`) writes `spond_events` (four integer counts plus event
  facts) and, for LINKED members only, one closed reply state per event into
  `spond_event_responses` (`0045_spond_links.sql`).
- `player_spond_links` binds one opaque Spond member id to one `players` row.
  The column accepts uppercase hex only, so a name or an email does not fit. No
  update policy and no update grant: links are immutable.
- A session joins them through `sessions.spond_event_id`.
  `useSessionSpondRsvp` (`src/lib/queries.ts:5407`) reads
  `spond_event_responses` and `player_spond_links` as two separate paged reads and
  joins them in a pure function, deliberately not as a PostgREST embed.
- Spond RSVP is **context only**. Nothing in the Spond pipeline reads, writes,
  defaults or constrains what the coach records. A club with no Spond
  configuration gets the complete operational surface.
- There is no scheduled sync. Refresh is a button, on the admin Spond screen and
  on Players & groups. SPOND-07 (scheduled refresh) is Later on the roadmap.

## 11. How groups and bibs are persisted

`public.register_entries` (`0044_training_day_core.sql`, extended by
`0047_register_group_inclusion.sql`):

```
session_id, player_id, club_id, present, included_in_groups,
bib_colour_override, source ('roster'|'manual'), marked_by, marked_at
```

Three independent facts per child, stated in `src/lib/tonight.ts`: the Spond
reply (read only, external), `present` (physically turned up), and
`included_in_groups` (the coach's arrangement). Nothing derives any of them from
another.

Bib resolution (`src/lib/bibs.ts`): the entry's override wins, else the team's
`teams.bib_colour` default, else none. A stored override of `'none'` means no bib
rather than fall back. The vocabulary is closed by `public.is_bib_colour`.

**There is no group entity.** `tonightGroups` (`src/lib/tonight.ts:1103`) derives
groups by keying the selected children on their **effective bib colour**. A group
is a colour. Nothing stores a group name, a group size target, a group's coach or
a group's starting station.

The whole editing model is a local draft: every tick, Select all, Clear, quick
add and bib change edits `TonightDraft` and nothing persists until **Save
groups**, which sends a delta as one `INSERT ... ON CONFLICT` and compares the
authoritative readback field by field (`useSaveTonight`, `src/lib/queries.ts:5985`).

Screen: `src/routes/SessionRegister.tsx` at `/session-day/:sessionId/register`,
titled **Players & groups** (`PLAYERS_GROUPS_TITLE`).

## 12. How venues are stored, and what location detail exists

`public.venues` (`0044_training_day_core.sql:96`):

```
id, club_id, name, created_at
```

**A name and nothing else.** No coordinates, no dimensions, no pitch count, no
geometry, no imagery, no address. The 0044 header says so explicitly: "Measured
areas and drawn boundaries belong to the session setup work and arrive with the
screens that use them, rather than sitting in the schema unwritten."
`src/lib/venues.ts` restates it.

Reads are club wide; writes take `club.manage`. Admin screen:
`src/routes/AdminVenues.tsx`.

The only location-shaped data anywhere is `spond_events.location`, one free text
line written by whoever arranged the event in Spond, usually a postal address.
`matchVenueByLocation` (`src/lib/venues.ts:96`) uses whole-word containment to
seed a new draft's venue and refuses to guess when zero or more than one venue
matches. It never overrides a coach's choice.

**Venue layout is entirely new structure.** Nothing in the schema can hold it.

## 13. What public sharing exists, and how snapshots are frozen

The substrate is `0038_content_sharing.sql`, `0039_public_share_read.sql`,
`0040_public_session_read.sql`, `0041_public_programme_read.sql`,
`0042_public_media_path_boundary.sql`, `0043_content_rights_fa_lock.sql`.

- **Rights**: every shareable row carries `rights` of `internal_only`,
  `public_link_only` or `public_full`. Client vocabulary in
  `src/lib/contentRights.ts`; the database is the authority and 0043 refuses to
  raise an England Football derived row above club only.
- **Kill switch**: per club, default off.
- **`content_shares`**: RLS enabled with **no client policy and no client grant**.
  Neither `anon` nor `authenticated` can read or write it. Reached only through
  the service-role-gated `manage_content_share` and `read_public_share` RPCs.
- **Secret model**: the URL is `/share/:shareId#secret`. Only a SHA-256 hash is
  stored. The secret lives in the fragment, so it never reaches a request line, a
  Referer header or a Vercel route log (`src/lib/publicShare.ts`).
- **Snapshots are frozen at create/refresh**, built server side in
  `supabase/functions/_shared/share.ts` and stored in `content_shares.snapshot`.
  A revoked share holds no snapshot, enforced by a check constraint.
- **Aggregate fail closed**: one restricted, missing or cross-club dependency
  blocks the whole share (`evaluateSessionEligibility`).
- **The public session projection carries no operational data at all.** The
  builder's own comment names the columns it never reads: `start_time`, `venue`,
  `team_id`, `coach_id`, `status`, `spond_event_id`, the live state. The client's
  `FORBIDDEN` set (`src/lib/publicShare.ts:247`) independently rejects `date`,
  `venue`, `venueId`, `teamIds`, `session_teams`, `bibColour`,
  `bib_colour_override`, `register_entries`, `present`, `includedInGroups`,
  `spondMemberId`, `spond_event_responses`, `rsvp` and `diagram`.
- A shared board carries shape and numbers only, never a `playerId` and never a
  name (`0028_board_player_boundary.sql`).
- Print: there is no separate print template. `@media print` in
  `src/styles.css:739` targets only `.public-*` classes, and `window.print()`
  appears in exactly one place in `src/`, `PublicShare.tsx:113`. **There is no
  authenticated print path in this product**, so print inherits the public share
  gate exactly. Traced independently by PR #189 (section 18) and confirmed here.

**A group and bib plan cannot be added to the current public share contract by
widening it.** The projection is deliberately built from a builder that never
reads the columns involved, plus two independent allow-lists, plus a forbidden-key
tripwire on both sides. Anything operational is a new, separately reviewed
projection. That is what roadmap item TRAIN-02 already says.

**This section covers PUBLIC sharing only.** Authenticated coach to coach link
sharing is a separate, already shipped mechanism, and the first pass of this audit
missed it entirely. Section 24.

## 14. Security boundaries protecting player and Spond data

Documented authoritatively in `docs/security/registered-players-boundary.md`,
`docs/security/spond-data-boundary.md`, `docs/security/board-data-boundary.md`
and `docs/security/content-sharing-boundary.md`. In summary:

- `players` and `player_registrations` selects are gated on `players.view`.
  Parents never hold it, so a parent cannot read a child's name from any table.
- `register_entries` select is gated `players.view`; writes take `sessions.create`
  club wide, because any coach on the day marks arrivals.
- `player_spond_links` and `spond_event_responses` selects are gated
  `players.view`, deliberately not the capability-free club-wide read that
  `spond_events` uses, because those rows resolve to a named child.
- The only Spond identifier persisted anywhere is the opaque member id, and only
  for a member a human bound to a child. No name, guardian, contact or raw
  payload fragment is ever persisted.
- `boards.tokens` may carry at most `id, number, side, x, y, playerId`, enforced
  by a check constraint. Names resolve at render time through the gated players
  read.
- `drills.diagram` can hold no person at all, enforced by a check constraint.
- Capability catalogue: `0012_rbac.sql` (content and club), `0030_audit_foundation.sql`
  (`players.view`, `players.manage`, `seasons.manage`, `audit.view`),
  `0038_content_sharing.sql` (`shares.create`, `shares.manage`).

## 15. Which tables, RPCs and Edge Functions the target design would touch

Existing objects a coaching-workflow overhaul is likely to reach:

| Object | Why |
|---|---|
| `drills` (+ `diagram`) | Drill creation in flow, adaptation copies, two new columns (`variant_of`, `library_listed`). |
| `sessions.activities` jsonb | **Written.** Three declared keys land in it: `slot`, `skipped` and `game_count`. No migration, because the column is unconstrained (section 27). |
| `sessions` | Nothing. `template_id` and `blocks` are both withdrawn. |
| `templates` | Week plan reuse and promotion, **and `templates.activities` carries `slot`**, which belongs to the plan. `skipped` and `game_count` are stripped from it. |
| `venues` | Referenced by the new `venue_layouts` table. **No column is added to `venues`**; the single `venues.layout` jsonb column is withdrawn. |
| `clubs` | The canonical age group vocabulary, one `text[]` column. `clubs` carries none today (section 26). |
| `teams` | The club's team order, one integer column. |
| `session_teams`, `register_entries`, `teams.bib_colour` | Groups and bibs, already correct. |
| `spond_events`, `spond_event_responses`, `player_spond_links` | Read only, unchanged. |
| `content_shares`, `manage_content_share`, `read_public_share` | Any new public projection. |
| `supabase/functions/_shared/share.ts` | Snapshot builders and forbidden keys. |
| `audit_sessions()`, `audit_venues()`, `audit_drills()` (0037, 0044) | New columns may need audit decisions. |

Edge Functions in the repository: `fa-import`, `fa-import-programme`,
`feedback-github-refresh`, `feedback-to-github`, `invite-user`,
`manage-content-share`, `read-content-share`, `remove-user`,
`spond-link-members`, `spond-roster-import`, `spond-sync`.

## 16. Which pieces can remain entirely client side

- Rendering a saved drill diagram anywhere (DRILL-02). **Merged in PR #189**,
  client only, no migration (section 18).
- Creating a drill while planning. `useInsertDrill` already exists; this is
  navigation, a modal and a shared authoring seam serving both the planner and
  the week plan editor (section 9). **The seam is built (COACH-10, #207,
  `src/components/ActivityListEditor.tsx`); creating a drill from it is
  COACH-11 and is not.**
- The suggested split of attending children into groups. Groups are already
  derived from bib colour; a suggestion is a pure function over the draft.
  **Built in COACH-3 (#203, #204)** as `src/lib/sessionSetup.ts` and the
  Players and groups screen, client only as predicted, and **COACH-4 (#206)**
  preserves it as attendance changes.
- The readiness readout for a session. Derivable from data already read.
  **Built in COACH-3 (#204).**
- The station list, its numbering and its count, derived from the activities
  that **declare** themselves stations. Section 20 proves the plan carried no
  such declaration when this was written and that `Phase` cannot supply one, so
  the declaration is what the target model adds; only the **derivation from
  it** is free. **Built in COACH-2 (#198, #202):** the declaration is `slot` on
  the activity and the derivation is `src/lib/activityStructure.ts`, client
  only and with no migration, as predicted.
- Rotation arithmetic and the "your group starts at station N" statement, since
  starting stations are derived rather than stored (section 22).
- Sharing a session with another coach, which already ships and is client only
  (section 24).

Five things need schema: the club's team order, the venue layout table, the
club's age group vocabulary, a second bib for the games, and the **two** drill
columns adaptation needs (provenance and listing are separate facts, so one link
column cannot carry both).

---

## 17. Station-based training: what the model can and cannot express

**Corrected twice. The first version claimed the session total is simply wrong
for station work. The second version said it becomes wrong when the group count
changes. Both were wrong, and the second was wrong because it assumed the
rotation count follows the group count. It does not.**

**The rule, from coach discovery:** every active bib group completes every
planned station once. So the number of rotations is the number of **stations**,
never the number of groups. Four planned stations run four rotations whether
three groups or four turn up; with three groups, one station stands empty each
rotation. Low attendance does not drop a drill, shorten the carousel or rewrite
the plan.

### The session duration sum has FOUR independent implementations

**Re-derived from source on 19 August. An earlier revision of this section said
the sum is implemented twice. That was wrong, and it was wrong in the direction
that matters: the two it named are the two a reader finds by grepping for a
function name, and the two it missed are an inline expression and a different
runtime.**

Searched with `grep -rn "duration" --include=*.ts --include=*.tsx src/
supabase/functions/ | grep -i "reduce\|+=\|sum\|total"`, then every
`sessionMinutes` and `plannedMinutes` call site enumerated. The complete set over
**session** activities:

| # | Where | Shape |
|---|---|---|
| 1 | `sessionMinutes`, `src/lib/data.ts:539` | `s.activities.reduce((a, x) => a + (x.duration \|\| 0), 0)` |
| 2 | `plannedMinutes`, `src/lib/sessionLifecycle.ts:150` | The same reduce, **plus a zero fallback** |
| 3 | `src/routes/Planner.tsx:733` | The same reduce, written inline. **Planner.tsx does not import `sessionMinutes`.** Rendered at `:735` as the big **"min total"** headline |
| 4 | `buildSessionSnapshot`, `supabase/functions/_shared/share.ts` | `totalDuration += duration` in a `for` loop, **in Deno**, emitted into the public snapshot |

**Consumers that inherit automatically**, because they call one of the first two:

- via `sessionMinutes`: `src/lib/ics.ts:60` (the calendar description),
  `src/routes/SessionDay.tsx:156`, `src/routes/Home.tsx:108`,
  `src/routes/LiveSession.tsx:278` and `:584`, `src/routes/Sessions.tsx:75`
- via `plannedMinutes`: `src/lib/ics.ts:51` (the calendar `DTEND`) and
  `src/lib/sessionLifecycle.ts:188` (`expectedEnd`, which the three lifecycle
  states are derived from)

**Not affected, and the distinction is load bearing.** These sum **template or
programme** activities, and a template never carries `skipped`
(`02-target-product-model.md` section 4c), so they are correct unchanged:
`src/routes/Home.tsx:288` (`TemplateMiniCard`), `src/routes/Templates.tsx:30`,
`src/components/TemplateFormModal.tsx:39`,
`src/components/ProgrammeFormModal.tsx:160` and `:379`,
`src/routes/ProgrammeDetail.tsx:76`, and `buildProgrammeSnapshot`
(`supabase/functions/_shared/share.ts`), which is a second accumulator
in the same Deno file and belongs to weeks rather than to a dated session.

**`plannedMinutes` is not the same expression as the other three.** Source:

```
const total = (event.activities ?? []).reduce((sum, a) => sum + (a?.duration || 0), 0)
return total > 0 ? total : FALLBACK_SESSION_MINUTES
```

with the comment at `:146-149`, *"Zero counts as no answer: an empty plan is a
session nobody has built yet, not a session that lasts no time."* That reading is
correct today, because today a zero total can only mean an empty plan. It stops
being correct the moment a filter can empty the sum, which is exactly what the
target rule introduces.

**Superseded by COACH-2A (#198).** This section is a snapshot captured before
that slice, and the quoted body above is no longer what the file contains. The
three BROWSER implementations now share one rule: `sessionMinutes`
(`src/lib/data.ts`) and `plannedMinutes` (`src/lib/sessionLifecycle.ts`) both
call `activeActivityMinutes` from `src/lib/activityStructure.ts`, and the
planner's own inline reduce is gone, `Planner.tsx` calling `sessionMinutes`
instead. `plannedMinutes` tells the two zeros apart rather than falling back on
either. The fourth implementation, `buildSessionSnapshot` in
`supabase/functions/_shared/share.ts`, is a DELIBERATE DUPLICATE in Deno, not a
fourth caller of the browser module: it cannot import from `src/lib/`, so it
carries its own `isStoodDownActivity` predicate, which `share_test.ts` pins to
the same cases `activityStructure.test.ts` pins. Any future change to the
active-duration rule therefore has to reach that file separately and go out
through the content-sharing Edge deploy, which is exactly the follow-up
COACH-2A left and the README records as run. `04-data-model-proposal.md`
section 2 carries the corrected rule and why the mechanism first proposed for
it was rejected.

**The Deno implementation is a different runtime, not a second call site.**
`share.ts` runs in Supabase Edge Functions and cannot import from `src/lib/`.
Its `PublicActivity` allow list is `phase`, `duration`, `drillRef`,
`customTitle` (`share.ts` and the browser validator
`src/lib/publicShare.ts:316`), so a new activity key is structurally excluded
from the public payload by both ends already.

For a carousel of *n* stations each lasting *m* minutes:

```
rotations        = n            (every group visits every station)
wall clock       = m × n
sum of durations = m × n
```

**They are the same expression. The existing total is correct, and it stays
correct at every attendance level.**

| Shape | Actual | Sum says |
|---|---|---|
| 4 stations, 4 groups | 40 | 40 |
| 4 stations, 3 groups (still 4 rotations, one station empty) | 40 | 40 |
| 6 stations, 4 groups | 60 | 60 |

**One residual divergence, and it is a planning error rather than a model gap.**
Stations in one carousel must share a rotation length, because the groups move
together. If a coach sets stations of 8, 10, 12 and 10 minutes, the carousel
actually runs at whatever length the coach calls, and the sum of 40 describes no
real session. The answer is a planning warning ("stations in a carousel run for
the same length"), not a new duration rule.

**Consequence for the plan: the arithmetic needs no change.** The expression
`sessionMinutes`, `plannedMinutes`, the derived lifecycle and `src/lib/ics.ts`
compute is the right one, and neither the station count nor the group count
disturbs it.

**What the plan does change is which activities that expression sums**, and it
arrives with standing a station down rather than with the carousel arithmetic.
`02-target-product-model.md` section 4a states it: an activity a coach has stood
down for one night must not count towards that night's length. Recorded here so
this section is not read as clearing the whole duration seam.

**The structural gaps are entirely separate from the arithmetic:**

1. **Nothing in the data explicitly says which activities are stations.** So
   "which station does my group start at", "which zone does station 3 go in" and
   "show me the five stations together" have nothing declared to read. Section 20
   proves the plan carries **no** vocabulary they can be derived from: `Phase` is
   set from the drill's four corners and records what kind of drill was added,
   not what part it plays on the night. The declaration has to be added.
2. **Live delivery is sequential.** `LiveSession.tsx` walks `activities` one at a
   time and shows the current one to everybody, which does not describe a
   carousel. **Recorded as a fact, not as work**: the settled product model
   removes live carousel administration rather than building it, and the live
   view is out of scope.
3. **There is nothing that says the ground is rearranged mid-session.** A session
   is one flat list, so the fact that the cones come in and two game pitches go
   out after the carousel has no representation. See section 20.

## 19. Teams: what exists, and what an ability order would need

**Superseded by COACH-1 (#223, applied 2 September 2026; #226, applied
4 September 2026; and the COACH-1B frontend PR).** `teams` now carries
`sort_order`, the Teams screen offers Move up and Move down with one Save team
order, that Save is one `set_team_order` call, and `src/lib/teamOrder.ts` holds
the pure rules; the grouping suggestion is still handed no order. What follows
is what was captured.

`public.teams` (`0002_teams_roles.sql:23`, extended by `0032` and `0044`) carried
exactly:

```
id, club_id, name, created_at, bib_colour
```

plus `teams_id_club_unique (id, club_id)` from 0032. Write is gated on
`has_perm('teams.manage')` (`teams_manage`, `0012_rbac.sql:376`). The admin
surface `src/routes/AdminTeams.tsx` offers add, rename, delete and set default
bib colour. **There was no reorder affordance and no ordering column.**

`useTeams` (`src/lib/queries.ts:628`) reads `.order('name', { ascending: true })`,
and `sessionTeamsLabel` (`src/lib/sessionTeams.ts:93`) sorts by name too. **Every
team order in the product today is alphabetical.** For this club that yields
Argonauts, Gladiators, Spartans, Titans, Trojans, which is the reverse-ish of the
stated ability order and matches it nowhere.

**Nothing in the schema can express or derive a club-defined team order.**
Checked: no `sort_order`, `display_order`, `position`, `rank` or `ability` column
exists on any table, and a grep for those concepts across `src` and
`supabase/migrations` returns nothing relevant. `created_at` exists but records
when a row was inserted, which is an accident of setup rather than a statement
about football, and relying on it is exactly the silently-wrong answer this
codebase refuses elsewhere.

**This is the one genuinely new fact the programme needs and cannot derive.** It
is a club-level fact about five rows, not a per-player one: a player's ability
context is `player → registration → team → that team's position in the club
order`, all of which except the last already exists.

## 20. The activity phase vocabulary is coaching classification, not structure

**Corrected. An earlier revision of this section concluded that the phase was
"enough to derive the station list, the station numbers and the station count
without storing anything". That is false, and the code below is what disproves
it.**

**Superseded in part by COACH-2A (#198) and COACH-2B (#202).** The analysis of
`Phase` below still holds, and it is why structure is DECLARED on the activity
rather than inferred from the phase. What is no longer true is the sentence
"what the plan does record structurally today: nothing": `sessions.activities`
now carries `slot` and `skipped` beside `phase`, `duration`, `drill_id` and
`title` (section 27); both authoring surfaces set `slot`, only the dated
session planner sets `skipped`, and `src/lib/activityStructure.ts` derives the
station list, its numbering and its count from the declaration. `gameCount` (COACH-8) is still not built.

`Phase` (`src/lib/data.ts:9`) is `'Warm-Up' | 'Skill' | 'Game' | 'Cool-Down'`,
and `PHASES` (`:533`) is the ordered list the planner and the week plan editor
both render.

**`phaseFor` (`src/lib/drillPicker.ts:17`) sets it from the drill's four-corners
classification** when a drill is added from the library:

```
physical  -> Warm-Up
social    -> Game
otherwise -> Skill
```

So the phase records **what kind of drill was added**, not what part it plays on
the night:

- A **physical** drill lands in `Warm-Up` and can perfectly well be one of the
  carousel stations.
- A **social** drill lands in `Game` and that says nothing about whether it is
  the evening's games phase.
- The coach may also change a phase for coaching reasons that have nothing to do
  with structure.

**What the plan recorded structurally when this was written: nothing.** There
was no field saying which activities are the carousel, which one is the games
phase, or how many pitches run inside it. `sessions.activities` carried
`phase`, `duration`, `drill_id` and `title`, and that was the whole of it
(section 4), until COACH-2 added `slot` and `skipped` (section 27); how many
pitches run inside the games phase is still not recorded.

**What it does record usefully is order**, which is what station numbering can be
built on **once the stations are declared**. The declaration is
`02-target-product-model.md` section 4; it costs two mapper entries and no
migration (section 27).

**One further fact the phase cannot carry, and it matters for the arithmetic:**
activities are sequential and `sessionMinutes` (`src/lib/data.ts:539`) sums their
durations, so two simultaneous game pitches cannot be two activities without
doubling the games phase in the session total, in `plannedMinutes`, in
`src/lib/ics.ts` and in Live. That is why the games phase is one activity with a
separate count field (`02-target-product-model.md` section 4b).

Where anything is physically set up is not recorded either, and the venue layout
answers it at the venue, season and age group level rather than per session.

## 18. Merged work: PR #189 (DRILL-02, authenticated half)

**Merged.** In `main` at `afe790d`, as the merge of
`claude/drill-02-diagram-delivery-ljc0mb`. The previous revision of this document
recorded it as open, CI green, `mergeable_state: dirty` and awaiting human review.
That is history now; what follows is what it left in the codebase.

Client only: no migration, no SQL, no Edge Function change.

What it established, which later work must build on rather than redo:

- **`diagramForDisplay(diagram, source)`** in `src/lib/drillDiagramRights.ts`, the
  single rule for whether a saved diagram is *shown*, beside `diagramEditDecision`
  which answers whether it may be *drawn*. It returns null for three cases a
  screen cannot tell apart: the read has not answered, there is no diagram or it
  is empty, and the drill is England Football derived.
- **`src/components/ActivityDiagram.tsx`**. `ActivityDiagram` owns the read and
  the rule; `ActivityDiagramView` is the pure half that renders without a query
  client. A component rather than a hook per screen for a structural reason:
  `LiveWatcher` resolves its drill after three conditional returns, so a top level
  hook there would break the rules of hooks.
- **`DrillDiagramView` is the canonical renderer.** The seam draws no SVG of its
  own, and an invariant test fails the build if a screen does.
- **The two diagram systems stay apart.** A structured `drills.diagram` is never
  rasterised, wrapped as a `MediaItem` or pushed through `DiagramViewer`, the
  uploaded-media viewer, which is untouched. A drill carrying both an uploaded
  image and a drawn diagram shows both, and neither suppresses the other.
- **The per-drill cached read is deliberate.** `useDrillDiagram(id)` under cache
  key `['drill_diagram', id]`, sharing the drill page's entry so a drill opened,
  planned and delivered is fetched once and TanStack dedupes concurrent mounts. A
  batched `.in('id', ids)` read was considered and **rejected**, because it would
  mint a second cache shape over rows already cached under the first. `DRILL_COLS`
  is still never widened to carry the column, and an invariant test enforces both.
- **Surfaces:** the planner's expanded panel (in `.act-panel`, never the draggable
  `.act-card`, passed as a lazily built `ReactNode` so the read fires only on
  expand), session day inline in the setup card beside the existing image button,
  and Live in both the driver and the watcher stage between the media and the
  coaching points.
- **No public share and no print.** Section 13's deny list is untouched and its
  containment test is still green. The remaining half is recorded as
  **DRILL-02b**, and the roadmap row stays In progress rather than Done.
- **Print, traced rather than assumed:** `window.print()` appears in exactly one
  place in `src/`, `PublicShare.tsx:113`, and the `@media print` block targets only
  `.public-*` classes. **There is no authenticated print path in this product.**

Its own honest gap, worth carrying: the repository's tests render to static markup
with no DOM, so no layout claim in it was measured. A real device check on a phone
is still worth doing, particularly Live in portrait.

## 21. The register holds one bib per player per session, and no history

Checked directly, because the game phase raises the question of whether a
mid-session re-bib loses the earlier carousel colour.

**One row, one scalar, overwritten in place.**
`register_entries` has primary key `(session_id, player_id)`
(`0044_training_day_core.sql:187`), and `bib_colour_override` is a single
nullable text column. `useSaveTonight` (`src/lib/queries.ts:5985`) writes through
`upsert(..., { onConflict: 'session_id,player_id' })`, so a second bib for the
same player in the same session replaces the first. `REGISTER_COLUMNS` is
`session_id, player_id, present, included_in_groups, bib_colour_override, source`
and carries no timestamp per field and no prior value.

**The touch trigger records who and when, never what it was.**
`register_entries_touch` (`0044:224`) sets `marked_by := auth.uid()` and
`marked_at := now()` on every insert and update, so both are overwritten too. It
also refuses to let a row change its session, player or club, which is why a
re-bib cannot become a different child's row.

**History is not merely absent, it is forbidden by the schema.**
0044's own self-verification raises an exception if a per-tick audit trigger is
ever attached:

```
raise exception 'training_day_core: register_entries must not be audited per tick';
```

(`0044:551`). The 0044 header states the reasoning: the row is the record, and a
tick is a high frequency operational touch. `0045` repeats it for
`spond_event_responses`. So the ordinary mechanism for reconstructing a previous
value is deliberately unavailable, and adding one would be a reversal of a stated
decision rather than an oversight.

**Consequence, stated plainly:** once a coach re-bibs a child, **the colour they
wore earlier in the same session is gone and cannot be recovered from any table.**

This is the fact behind the proposal for a second bib column
(`04-data-model-proposal.md` section 4). The settled model needs the station bib
and the game bib to exist at once, and one scalar cannot hold two values. What
remains unrecoverable after that change is a correction within one of the two,
which nothing reads.

**What is NOT lost.** `present` and `included_in_groups` are separate columns and
a bib change does not touch them, so who attended and who the coach included
survive a re-bib intact.

## 22. Starting stations: the arithmetic, and why it no longer drives a design

**The facts in this section are unchanged and still verified. The conclusion the
previous revision drew from them has been withdrawn**, because nothing consumes
it any more (`02-target-product-model.md` section 6.2).

### The vocabulary is nine colours and a carousel has four or five stations

`BIB_COLOURS` (`src/lib/bibs.ts`) and `public.is_bib_colour`, which is the
database authority (`0044_training_day_core.sql:81`), both hold exactly nine: red,
blue, green, yellow, orange, purple, pink, white, black.

**A fixed global map from colour to station cannot give unique stations.** Suppose
a rule maps colour to station without consulting the active set, and gives unique
stations for every active set no larger than the station count. Take any two
distinct colours: the set holding just those two is a legal active set, so the
rule must separate them. They were arbitrary, so the rule is injective from nine
colours into four or five stations, which is impossible.

**Ranking the active colours 1 to N is unique and moves when one leaves.**
`tonightGroups` (`src/lib/tonight.ts:1103`) sorts by the fixed vocabulary order
(`:1129`), which is stable, but the array it returns is **dense over the colours
actually in use**. Remove the last red child and the array shortens, so every
later group's position moves down one.

### What the previous revision concluded, and why that is withdrawn

It concluded that no stateless rule can be both unique and stable, therefore the
assignment must be derived once and **frozen** at carousel start, stored on the
session and never recomputed.

Both halves of the arithmetic still hold. **The requirement they served does
not.** Stability mattered only while a carousel was running under OTJ's
observation, and the settled product philosophy is that OTJ tracks no running
carousel: once training starts, changes are physical
(`01-coach-workflow-principles.md` section 2).

So the current design ranks the active colours in the fixed vocabulary order and
assigns them sequentially, derived on every read, stored nowhere. Before training,
a plan that restates itself after the coach changes the groups is correct
behaviour rather than churn. **If OTJ is ever asked to drive a carousel, this
section is where the reasoning and the mechanism are both still on the record.**

## 23. Shared, reload-safe session state already exists

Recorded as a plain fact about the codebase. The previous revision cited it to
justify storing a frozen station assignment on `sessions`; that mechanism is
withdrawn (section 22), and the fact stands on its own for any future work that
genuinely needs two devices to agree.

- `sessions.live_activity_index` and `sessions.live_activity_started_at`
  (`0006_live_state.sql:23`), both null when not live.
- **`sessions` is in the realtime publication** (`0006:27`).
- `useSetLiveActivity` (`src/lib/queries.ts:2197`) writes them on an explicit
  driver action, never on a render.
- `useLiveSessionSync` (`:2221`) subscribes per session id, patches the small
  live columns into the cache from the payload, and then calls
  `invalidateQueries({ queryKey: ['sessions'] })`. That prefix also matches
  `['sessions', sessionId]`, so **the full row is refetched through RLS**, and
  its own comment says so: "which also covers any column the payload may omit".

**Consequence: any new column on `sessions` propagates to other devices over the
existing channel with no change to the sync code.**

### localStorage is per device and cannot be used for this

Two things already persist locally and are explicitly not shared data:

- Kit check-offs (`src/routes/SessionDay.tsx:56`), described in its own header as
  "per device, a pre-session aid, not shared data".
- The live timer position, remaining time and coach notes
  (`src/routes/LiveSession.tsx:218`, `:270`).

The primary success scenario is that **every coach sees the same plan on their
own phone**, so anything two coaches must agree about cannot live here.

## 24. Authenticated coach to coach link sharing already exists

**Missed by the first pass of this audit**, which read the public sharing
substrate (section 13) and treated it as the whole of sharing. It is not, and the
settled sharing requirement is met by this mechanism rather than by that one.

`src/lib/share.ts` is the internal club link seam, shipped as PR 0 of the content
sharing programme. Its own header states the contract: an internal club link is a
normal protected app URL, the recipient signs in and must already have club
access, the existing Row Level Security stays the only boundary, and there is **no
token, no query-string secret, no temporary public URL and no anonymous route**.

- `canonicalPath` mirrors the app's own router: `/session-day/:id`, `/drill/:id`,
  `/programmes/:id`.
- `canonicalUrl(kind, id, origin)` is `origin + path` with nothing appended.
- `canNativeShare` feature-detects `navigator.share`; `shareLink` calls it and
  falls back to `copyLink` when the sheet is absent or fails; a user dismissing
  the sheet is `'cancelled'`, a neutral non-event.
- `createShareRunner` allows one attempt at a time and reports nothing after its
  surface unmounts.
- `SHARE_ACCOUNT_NOTE` already tells the coach that the recipient needs an OTJ
  account and club access.

The internal arm of `ShareModal` (`src/components/ShareModal.tsx:606`) invokes it
as `shareInternal({ url: canonicalUrl(kind, sourceId), title, text: title })`. On
session day, `title` is `session.name` (`src/routes/SessionDay.tsx:207`), and the
affordance is gated on `sessions.create`.

**So the payload is a URL and a session name.** No player name, bib, group,
attendance or Spond field is in it, and there is no path by which one could be.

**Consequence for this programme:** the coach to coach sharing requirement needs
no new mechanism, no new Edge Function, no new snapshot and no new permission.
What it needs is to stay reachable from the delivery surface and to have its
payload pinned by a test.

## 25. Migration ledger position

- The highest migration file on disk on `main` is `0050_bulk_delete_players.sql`
  (re-verified 2 September 2026 against `main` at `3cb20f9`), applied to
  production on 23 August 2026. The hosted head is its row, `20260823065041`
  (`bulk_delete_players`).
- **`0050_bulk_delete_players.sql` arrived in PR #191** (PLAYERS-01, merged
  27 August 2026), and was applied to production on 23 August 2026 from that
  branch's reviewed commit, ahead of the branch merging, which is the reverse
  rollout order its register entry documents. So, as observed on 2 September
  2026, the next free number is `0051` and the head is the row above. Both are
  observations of the live state that day and not reservations: the number and
  the `expected_previous_*` pin are taken from the ledger as it stands at that
  migration's own review, and are that number and that row only if nothing else
  has been registered or applied first, which is the rule the next paragraphs
  state.
- The live ledger is the authority, not the highest file on disk. Confirm the next
  free number against it before writing a migration (`CLAUDE.md`, Data model).

**A migration is reviewed against one specific hosted head, and the workflow
enforces that.** `.github/scripts/production-migration/reviewed_migrations.py`
holds a closed register, and every entry carries `expected_previous_version` and
`expected_previous_name`: the ledger row that must still be the unique newest one
before the migration runs. `0049`'s entry, for example, expects
`20260812102912 / spond_session_link_unique`.

Three consequences for any new programme, and they are stronger than "pick the
next number":

1. **A file number is not a reservation.** Naming a file `0051` claims nothing.
   What claims a position is a register entry pinned to a head.
2. **A register entry cannot be written before the head it will run against is
   known.** If `0050` is applied first, the next migration's
   `expected_previous_version` is `0050`'s stamp, and that stamp does not exist
   until `0050` has run.
3. **Two unapplied migrations cannot both be authored against the current head**
   without one of them becoming wrong the moment the other applies. The second
   one's entry is rewritten, reviewed again, and only then applied.

So a coaching workflow migration is authored, numbered and registered at the
moment it is ready to be reviewed for application, against the ledger as it
stands then. It is never authored as "the one after `0050`" while `0050` is
unapplied.

## 26. Season and age group, as they exist today

Read because the venue layout scope is stated in terms of both.

### Seasons are a real entity

`public.seasons` (`0031_seasons.sql:148`): `id, club_id, name, starts_on,
ends_on, is_current, archived_at, created_by, updated_by, created_at,
updated_at`.

- `name` is the label ("2026/27"), unique per club and bounded to 20 characters.
- `starts_on` and `ends_on` are ordered by a check constraint, and **overlap
  between seasons is deliberately unconstrained**.
- `is_current` marks the one current season, upper-bounded for every writer
  including the service role by the partial unique index
  `seasons_one_current_per_club`.
- `seasons_id_club_unique (id, club_id)` exists, so the club-scoped composite
  foreign key pattern is already available to reference it.
- Reads are club wide with no capability; writes take `seasons.manage`. There is
  deliberately **no client delete policy and no delete grant**, and
  `player_registrations` references seasons `on delete restrict`.

Client model: `Season` (`src/lib/data.ts:70`) with `isCurrent`, mapped from
`is_current` (`src/lib/queries.ts:4009`). `SEASON_COLS` is
`id, name, starts_on, ends_on, is_current, archived_at`.

**Nothing links a session to a season.** `sessions` carries no `season_id`, and
the columns it does carry are listed in section 2.

### Age group is free text on the session, and the club has NO canonical list

**Corrected 19 August, from the migrations rather than from the TypeScript. An
earlier revision of this section asserted `clubs.age_groups` exists. It does
not.**

- `public.clubs` carries **five columns and no age group**: `id`, `name`,
  `crest_url`, `motto`, `created_at` (`0001_init.sql:35-41`).
- The `age_groups text[] not null default '{}'` column at `0001_init.sql:50` is
  on **`profiles`**, not `clubs`. It is one coach's own age groups, read into
  the auth profile context (`src/hooks/useAuth.tsx:20`, `:57`). It is a personal
  preference and **cannot define a club level scope key**: it is per user, any
  member may write their own, and two coaches disagreeing would silently produce
  two different vocabularies for one club.
- `public.sessions.age_group text` nullable (`0001_init.sql:113`), mapped as
  `ageGroup` with `r.age_group ?? ''` (`src/lib/queries.ts:428`) and written back
  at `:2022`. Free text, no constraint, no reference.
- **Two hardcoded literal lists exist and they disagree with each other.** The
  planner's Age group control offers `['U6s', 'U7s', 'U8s', 'U9s', 'U10s',
  'U11s', 'U12s']` (`src/routes/Planner.tsx:763`), while `AGES` in
  `src/lib/data.ts:536` is `['U6', 'U7', 'U8', 'U9', 'U10', 'U11', 'U12']`,
  without the trailing `s`. `useStartFromTemplate` and `ApplyProgrammeModal`
  both default to the literal `'U8s'`.
- No other table carries an age group. `teams`, `players`,
  `player_registrations` and `venues` have none.

So the only age group fact a session has is a free text string, chosen from one
of two disagreeing lists the code holds rather than the club does. **Anything
keyed on age group needs a canonical club level vocabulary first**, and creating
one is a migration, not client work.

## 27. `sessions.activities` can carry a new key, and exactly five call sites decide it

Read because the station marker rides this column.

**Superseded by COACH-2A, which is the slice this section was written for.**
Everything below describes the shapes and the call sites as they stood before
it. `Activity` and `ActivityRow` now carry `slot` and `skipped` as well; the
template read is no longer a bare `toActivity` map but goes through
`toTemplateActivityRows`; and there is a sixth write this section did not
count, `_shared/fa.ts` inserting a template straight from Deno, which is safe
because it CONSTRUCTS its activities from drill ids rather than copying a
session's. The reasoning below still holds and is what the slice was built on.
Every line number in it has moved; read `src/lib/queries.ts` and
`src/lib/activityStructure.ts` for the current shape.

- `sessions.activities` and `templates.activities` are `jsonb` with **no check
  constraint** (section 4), so the database imposes no shape.
- `Activity` (`src/lib/data.ts:302`) is `{ phase, drillId?, title?, duration }`.
  `ActivityRow` (`src/lib/queries.ts:149`) is
  `{ phase, duration, drill_id?, title? }`.
- `toActivity` and `toActivityRow` (`:289`, `:296`) rebuild field by field and
  **omit a key entirely when the value is absent**, rather than writing null.
- The complete set of call sites is five: reads at `:385` (templates) and `:432`
  (sessions); writes at `:1579` (templates), `:1826` (copy a template to a week)
  and `:2026` (sessions).
- `useStartFromTemplate` copies `t.activities`, the **mapped** `Activity[]`,
  through `JSON.parse(JSON.stringify(...))` (`src/hooks/useStartFromTemplate.ts:45`),
  so any key the mapper knows about survives the plan-to-session copy for free,
  and any key it does not know about never reaches the copy at all.

**Consequence: a new activity key costs two functions and no migration.** But
the mappers are shared and context free, so they cannot make a key session
local: both template and session reads call `toActivity`, and all three writes
call `toActivityRow`. Keeping a key out of a week plan takes a separate named
helper at **both ends**, the template write paths and the template read
(`02-target-product-model.md` section 4c). Note also that any **new** template
write path, such as promoting a session to a week plan, is a further call site
that helper has to cover; enumerating today's two by line number does not cover
one that does not exist yet.

## Notable current-state findings the overhaul must design around

1. **Station-based training is not declared, and this is not a duration
   defect.** Section 17 corrects two earlier attempts to make it one. Rotations
   follow the station count, not the group count, so the existing total is
   correct at every attendance level and the arithmetic needs no change. What is
   absent is a **declaration** of which activities are stations, and section 20
   shows the plan carries nothing that can supply it: the phase records what kind
   of drill was added, not what part it plays on the night. The one duration
   change the overhaul does make is a consequence of standing a station down, not
   of the carousel maths (section 17). **Superseded by COACH-2 (#198, #202):**
   stations and the games phase are now declared on the activity by `slot`, and
   standing one down (`skipped`) is that one duration change, in all four
   implementations.

2. **A group is a bib colour, and the derivation has a collision.**
   `tonightGroups` (`src/lib/tonight.ts:1103`) keys on `bib ?? ''`, so **two
   teams sharing a default `teams.bib_colour` merge into one group**, and every
   child with no effective bib merges into a single "No bibs" group. With five
   club teams and nine colours this is avoidable but nothing prevents or
   surfaces it. Coach discovery has since settled that unique active bib colours
   are the rule and that "No bibs" is not a valid group, so both collisions are
   now readiness failures with a defined product answer rather than open
   questions (`02-target-product-model.md` section 6.1). **Built in COACH-3
   (#203, #204):** the suggestion assigns unique colours and the readiness
   readout names both collisions.

2b. **A session-only bib override already exists and already behaves
   correctly.** `register_entries.bib_colour_override` (0044) is per session and
   per player, writes nothing back to `players`, `player_registrations` or
   `teams`, and resolves through `effectiveBib` as override, else team default,
   else none. **The durable team and tonight's bib group are already separate
   facts in the schema**, which is most of what the "session only override"
   requirement asks for.

3. **Drill Maker is finished as a model, and its delivery half has merged.**
   The diagram schema, the identity boundary, the parser and the editor are all
   sound, and PR #189 put the diagram on the planner, session day and both live
   stages (section 18). What remains is authoring: a drill still cannot be created
   without leaving the plan being written, and there is still no way to adapt one
   for a single session.

4. **Authoring is already duplicated across two editors.** The planner and
   `TemplateFormModal` each maintain their own activity list, add bar, custom
   activity literal and row component (section 9). Any authoring work must go
   through one seam or it will diverge three ways. **Superseded by COACH-10
   (#207)**, which is that seam: both hosts now mount
   `src/components/ActivityListEditor.tsx`.

5. **Venue is a word.** Every layout concept is new. `venues` carries a name and
   nothing else, so there is no coordinate space, no geometry and no imagery to
   build on. Two fraction-coordinate jsonb columns already exist to copy the
   discipline from, `boards.tokens` and `drills.diagram`.

6. **Public sharing is deliberately incapable of carrying an operational plan,
   and it is not the sharing coaches asked for.** Any share of groups and bibs
   would be a new decision rather than a wider snapshot, and PR #189 reached the
   same conclusion independently for the diagram alone. Meanwhile the protected
   coach to coach link that the settled requirement actually describes has
   shipped, and section 24 records it.

7. **`sessions.activities` is an unconstrained jsonb array read through a strict
   client allow-list.** Adding a key is cheap in the database and requires
   touching exactly two functions in `src/lib/queries.ts`. Nothing validates the
   shape server side, so a key added there earns none of the guarantees that
   `drills.diagram` and `boards.tokens` have.
