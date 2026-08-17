# Current-state architecture audit

Status: reference. Captured 17 August 2026 against `main` at `2283350`, by reading
the code and the migration files rather than by trusting any earlier document.

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
  `src/styles.css:739` hides the interactive chrome of the public page. Nothing
  in the authenticated app has a print path.

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

- Rendering a saved drill diagram anywhere (DRILL-02). The data is already in
  `drills.diagram` and already read by `useDrillDiagram`.
- Creating a drill from the planner. `useInsertDrill` already exists; this is
  navigation and a modal.
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

## Notable current-state findings the overhaul must design around

1. **The session model is a linear timeline.** `sessionMinutes`
   (`src/lib/data.ts:539`) is the sum of every activity's duration, and the Live
   view walks activities one at a time. Station-based training is parallel: four
   stations run at once and groups rotate. Today four 10 minute stations read as
   a 40 minute block of sequential work, and the live timer runs them in series.
   This single fact affects `sessionMinutes`, `sessionLifecycle.ts`
   (`FALLBACK_SESSION_MINUTES` and the expected end), `src/lib/ics.ts`,
   `LiveSession.tsx`, `Home.tsx`, `SessionDay.tsx`, `ProgrammeDetail.tsx`,
   `TemplateFormModal.tsx` and `ProgrammeFormModal.tsx`.

2. **A group is a bib colour.** There is no group row anywhere. This is a good
   thing and should be preserved; it means "the reds start at station 2" needs no
   new entity.

3. **Drill Maker is finished as a model and unfinished as a workflow.** The
   diagram schema, the identity boundary, the parser and the editor are all
   sound. The diagram is invisible everywhere a coach actually works.

4. **Venue is a word.** Every layout concept is new.

5. **Public sharing is deliberately incapable of carrying an operational plan.**
   Any share of groups and bibs is a new decision, not a wider snapshot.

6. **`sessions.activities` is an unconstrained jsonb array read through a strict
   client allow-list.** Adding a key is cheap in the database and requires
   touching exactly two functions in `src/lib/queries.ts`. Nothing validates the
   shape server side, so a key added there earns none of the guarantees that
   `drills.diagram` and `boards.tokens` have.
