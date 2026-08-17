# Current-state architecture audit

Status: reference. Captured 17 August 2026 against `main` at `2283350`, by reading
the code and the migration files rather than by trusting any earlier document.
Revised 17 August 2026 after review: the station duration finding was overstated
and has been corrected (section 17), and open PR #189 is now recorded as the
in-flight implementation of DRILL-02 (section 18).

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
| `activities` jsonb | The plan. An array of `{ phase, drill_id?, title?, duration }`. |
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

`Activity` (`src/lib/data.ts:302`) is exactly four optional-ish fields:

```ts
interface Activity { phase: Phase; drillId?: string; title?: string; duration: number }
```

`toActivity` / `toActivityRow` (`src/lib/queries.ts:289`, `:296`) rebuild the
object field by field from that allow-list, so **any key added to the stored
jsonb that these two functions do not name is dropped on read and lost on the
next save**. `sessions.activities` itself carries **no check constraint**
(`0001_init.sql:99`), unlike `drills.diagram`.

## 5. Is a session activity a snapshot or a reference?

**A reference, with two per-session overrides.**

- `duration` and `phase` are stored on the activity, so they are session-local.
- Everything else (title, summary, coaching points, setup notes, equipment,
  area, players guidance, STEP adaptations, the attached media item, the
  diagram) is read live from the referenced `drills` row.
- A "custom" activity has `title` and no `drillId`. It is the only session-local
  content in the model, and it carries nothing but a title, a phase and a
  duration. `src/routes/Planner.tsx:1194` creates one as
  `{ phase: 'Skill', title: 'Custom activity', duration: 10 }`.

## 6. What changes if a referenced drill is edited later

Every session that references it changes, including sessions that have already
been delivered, silently and with no warning on the edit form
(`src/components/DrillFormModal.tsx`).

The only frozen copy in the product is the **public share snapshot**
(`content_shares.snapshot`, section 12). A shared session keeps the drill text it
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

Read-only rendering: `src/components/DrillDiagramView.tsx`, used by
`src/routes/DrillDetail.tsx` **and nowhere else**. Grepping for
`useDrillDiagram`, `DrillDiagramView` and `parseDrillDiagram` outside tests
returns only `DrillDetail.tsx` and `DrillDiagramEditor.tsx`.

**This is exactly the gap the roadmap calls DRILL-02, and it is confirmed open.**
`src/routes/Planner.tsx`, `src/routes/SessionDay.tsx` and
`src/routes/LiveSession.tsx` all render `drill.mediaId` images through
`MediaThumb` and `DiagramViewer` and never touch `drills.diagram`.

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
| `drills` (+ `diagram`) | Drill creation in flow, variants, motion. |
| `sessions.activities` jsonb | Station blocks, area assignment. |
| `sessions` | An explicit `template_id`. |
| `templates` | Week plan reuse and promotion. |
| `venues` | Venue layout. |
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

- Rendering a saved drill diagram anywhere (DRILL-02). Done in PR #189, client
  only, no migration (section 18).
- Creating a drill while planning. `useInsertDrill` already exists; this is
  navigation, a modal and a shared authoring seam serving both the planner and
  the week plan editor (section 9).
- The suggested split of attending children into groups. Groups are already
  derived from bib colour; a suggestion is a pure function over the draft.
- The readiness readout for a session. Derivable from data already read.
- The generated WhatsApp text. Composed in the browser from data the coach is
  already authorised to see; nothing is stored and nothing is published.
- Rotation arithmetic and the "your group starts at station N" statement, if
  starting stations are derived rather than stored.

Everything else on the list needs schema: venue layout, drill variants, an
explicit template link, station block metadata, and any public projection.

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

`sessionMinutes` (`src/lib/data.ts:539`) is the sum of every activity's duration.
`plannedMinutes` (`src/lib/sessionLifecycle.ts:150`) reimplements the same sum
with the 90 minute fallback, and the expected end is derived from it.

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

**Consequence for the plan: the duration model needs no change at all.**
`sessionMinutes`, `plannedMinutes`, the derived lifecycle and `src/lib/ics.ts`
are all correct as they stand and are not touched by station blocks. This
removes the largest rollout risk previously attributed to that work.

**The structural gaps are entirely separate from the arithmetic and are the only
reason for the work:**

1. **There is no station identity.** Nothing in the data says which activities
   are stations of one carousel. So "which station does my group start at", "put
   station 3 on pitch 2" and "show me the four stations together" have no answer
   to compute from. The venue composer cannot be built without this.
2. **Live delivery is sequential.** `LiveSession.tsx` walks `activities` one at a
   time and shows the current one to everybody. During a carousel every group is
   at a different station simultaneously, and the event that matters is
   **rotate**, which the live view has no concept of. This is wrong today
   independently of any total.
3. **There is nothing that says the ground is rearranged mid-session.** A session
   is one flat list, so the fact that the cones come in and two game pitches go
   out after the carousel has no representation. See section 20.

## 19. Teams: what exists, and what an ability order would need

`public.teams` (`0002_teams_roles.sql:23`, extended by `0032` and `0044`) carries
exactly:

```
id, club_id, name, created_at, bib_colour
```

plus `teams_id_club_unique (id, club_id)` from 0032. Write is gated on
`has_perm('teams.manage')` (`teams_manage`, `0012_rbac.sql:376`). The admin
surface `src/routes/AdminTeams.tsx` offers add, rename, delete and set default
bib colour. **There is no reorder affordance and no ordering column.**

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

## 20. The activity phase vocabulary already distinguishes games

`Phase` (`src/lib/data.ts:9`) is `'Warm-Up' | 'Skill' | 'Game' | 'Cool-Down'`,
and `PHASES` (`:533`) is the ordered list the planner and the week plan editor
both render. `phaseFor` (`src/lib/drillPicker.ts:17`) already routes a social
drill to `Game` and everything else to `Skill` when a drill is added from the
library.

So a session already records which activities are small-sided games and which
are station work, in a field every screen reads. What it does **not** record is
that the ground is physically rearranged between them, or where anything is set
up. That is the gap section 20's phase-specific setup work addresses, and it can
lean on this vocabulary rather than inventing a second one.

## 18. In-flight work: PR #189 (DRILL-02)

Read directly at head `262ab0e` on 17 August 2026, not inferred.

**Open, CI green on all 10 checks, `mergeable_state: dirty`** (it branched from
`e07a4cf` and `main` has since moved to `2283350`; the conflict is
`docs/roadmap/master-roadmap.md`, which both changed). The only PR comment is the
Vercel deployment bot, so it has had no human review yet.

Client only: 14 files, +1374/-9. No migration, no SQL, no Edge Function change.

What it establishes, which later phases must build on rather than redo:

- **`diagramForDisplay(diagram, source)`** in `src/lib/drillDiagramRights.ts`, the
  single rule for whether a saved diagram is *shown*, beside `diagramEditDecision`
  which answers whether it may be *drawn*. It returns null for three cases a
  screen cannot tell apart: the read has not answered, there is no diagram or it
  is empty, and the drill is England Football derived.
- **`src/components/ActivityDiagram.tsx`**, new. `ActivityDiagram` owns the read
  and the rule; `ActivityDiagramView` is the pure half that renders without a
  query client. A component rather than a hook per screen for a structural
  reason: `LiveWatcher` resolves its drill after three conditional returns, so a
  top level hook there would break the rules of hooks.
- **`DrillDiagramView` stays the canonical renderer.** The seam draws no SVG of
  its own, and an invariant test fails the build if a screen does.
- **The two diagram systems stay apart.** A structured `drills.diagram` is never
  rasterised, wrapped as a `MediaItem` or pushed through `DiagramViewer`.
  `DiagramViewer`, the uploaded-media full-screen viewer, is untouched.
  Coexistence rule: a drill carrying both an uploaded image and a drawn diagram
  shows both, and neither suppresses the other.
- **The per-drill cached read is preserved deliberately.** `useDrillDiagram(id)`
  under cache key `['drill_diagram', id]`, sharing the drill page's entry so a
  drill opened, planned and delivered is fetched once and TanStack dedupes
  concurrent mounts. A batched `.in('id', ids)` read was considered and
  **rejected**, because it would mint a second cache shape over rows already
  cached under the first. `DRILL_COLS` is still never widened to carry the
  column, and an invariant test enforces both.
- **Surfaces:** Planner expanded panel (in `.act-panel`, never the draggable
  `.act-card`, passed as a lazily built `ReactNode` so the read fires only on
  expand), Session Day inline in the setup card beside the existing image button,
  and Live in both the driver and the watcher stage between the media and the
  coaching points.
- **No public share and no print.** Section 13's deny list is untouched and its
  containment test is still green. The PR records a proposed **DRILL-02b** for
  the snapshot contract change, and keeps DRILL-02 **In progress** rather than
  Done.
- **Print, traced rather than assumed:** `window.print()` appears in exactly one
  place in `src/`, `PublicShare.tsx:113`, and the `@media print` block targets
  only `.public-*` classes. **There is no authenticated print path in this
  product**, so print inherits the public share gate exactly.
- Two defects were found and fixed by its own adversarial pass: a height cap that
  shrank the drawing rather than the box (fixed by emitting `--dd-ratio` from the
  renderer so a height cap also bounds width), and `.dd-chip-text` reading
  `var(--ink)`, which vanished under the live view's forced `.theme-dark`.

Its own honest gap, worth carrying: the repository's tests render to static
markup with no DOM, so no layout claim in it has been measured. A real device
check on a phone is recommended before merge, particularly Live in portrait.

## Notable current-state findings the overhaul must design around

1. **Station-based training has no representation, and this is not a duration
   defect.** Section 17 corrects two earlier attempts to make it one. Rotations
   follow the station count, not the group count, so the existing total is
   correct at every attendance level and the duration model needs no change. The
   real absences are station identity, parallel delivery semantics, and any
   record that the ground is rearranged mid-session.

2. **A group is a bib colour, and the derivation has a collision.**
   `tonightGroups` (`src/lib/tonight.ts:1103`) keys on `bib ?? ''`, so **two
   teams sharing a default `teams.bib_colour` merge into one group**, and every
   child with no effective bib merges into a single "No bibs" group. With five
   club teams and nine colours this is avoidable but nothing prevents or
   surfaces it. Coach discovery has since settled that unique active bib colours
   are the rule and that "No bibs" is not a valid group, so both collisions are
   now readiness failures with a defined product answer rather than open
   questions (`02-target-product-model.md` section 6).

2b. **A session-only bib override already exists and already behaves
   correctly.** `register_entries.bib_colour_override` (0044) is per session and
   per player, writes nothing back to `players`, `player_registrations` or
   `teams`, and resolves through `effectiveBib` as override, else team default,
   else none. **The durable team and tonight's bib group are already separate
   facts in the schema**, which is most of what the "session only override"
   requirement asks for.

3. **Drill Maker is finished as a model, and its delivery half is in flight.**
   The diagram schema, the identity boundary, the parser and the editor are all
   sound. PR #189 puts the diagram on the planner, session day and both live
   stages (section 18). What remains after it is authoring: a drill still cannot
   be created without leaving the plan being written.

4. **Authoring is already duplicated across two editors.** The planner and
   `TemplateFormModal` each maintain their own activity list, add bar, custom
   activity literal and row component (section 9). Any authoring work must go
   through one seam or it will diverge three ways.

5. **Venue is a word.** Every layout concept is new. `venues` carries a name and
   nothing else, so there is no coordinate space, no geometry and no imagery to
   build on.

6. **Public sharing is deliberately incapable of carrying an operational plan.**
   Any share of groups and bibs is a new decision, not a wider snapshot. PR #189
   reached the same conclusion independently for the diagram alone and declined
   to widen it.

7. **`sessions.activities` is an unconstrained jsonb array read through a strict
   client allow-list.** Adding a key is cheap in the database and requires
   touching exactly two functions in `src/lib/queries.ts`. Nothing validates the
   shape server side, so a key added there earns none of the guarantees that
   `drills.diagram` and `boards.tokens` have.
