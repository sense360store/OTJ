# Data model proposal

Status: proposal, awaiting approval. No migration in this document has been
written, numbered or applied.

Everything here follows the repository's existing migration discipline: gated,
reviewed by a human, applied by hand after the live ledger is checked, never
`supabase db push` from a session. The next free number is confirmed against the
**hosted ledger**, never assumed from the highest file on disk
(`CLAUDE.md`, Data model). The head at the time of writing is
`20260817104226 spond_team_reconcile`, applied from `0049`.

---

## 1. Summary of anticipated database change

Across the entire programme, six migrations. Five are additive columns; one is a
constraint widening that only happens if motion is approved.

| # | Change | Table | Phase | Risk |
|---|---|---|---|---|
| M1 | `variant_of uuid null` (+ `drills_id_club_unique`) | `drills` | C | Low |
| M2 | `template_id uuid null` (+ `templates_id_club_unique`) | `sessions`, `templates` | E | Low |
| M3 | `blocks jsonb null` + `block_id` on an activity | `sessions`, `templates` | F | Low. **Duration model untouched.** |
| M4 | `layout jsonb null` + shape constraint | `venues` | H | Medium, new shape boundary |
| M5 | diagram element allow-list widening | `drills` | L, optional | Medium, version rollout hazard |
| M6 | `sort_order integer null` + partial unique index | `teams` | G | Low. Null everywhere is today's behaviour. |

**Six named non-changes, each deliberate and each now settled rather than
deferred:**

- **No group table.** The bib colour is the station group's identity, unique per
  session, enforced in the domain rather than in persistence because a group is
  emergent from per-player bib resolution and there is no row a unique index
  could sit on (`02-target-product-model.md` section 6).
- **No per-player ability score, level or training classification.** A player's
  ability context derives through their team's position in the club order. M6
  stores that order once per team, never per child.
- **No new column for session-only bib overrides.**
  `register_entries.bib_colour_override` (0044) already is one: keyed on
  `(session_id, player_id)`, writing nothing back to `players`,
  `player_registrations` or `teams`.
- **No `rotations` or `minutes_per_rotation` field.** Rotations are the station
  count; the rotation length is the members' own duration.
- **No setup phase entity and no layout versioning.** A phase-specific setup view
  is the placements of one block's members, and the transition between them is an
  ordinary activity (`02-target-product-model.md` section 7, layer 3).
- **No session workflow state column.** Readiness is derived (section 5 there).
- **No drill version table.** Adaptation is a copy (section 3 there).

---

## 2. M1: `drills.variant_of`

```sql
alter table public.drills add column variant_of uuid;
alter table public.drills
  add constraint drills_variant_of_fk
  foreign key (variant_of, club_id) references public.drills (id, club_id)
  on delete set null (variant_of);
create index on public.drills (variant_of);
```

**The composite parent constraint does not exist yet and must be added first.**
Checked against the migrations: `teams`, `players`, `sessions`, `venues`,
`seasons` and `spond_events` all carry an `(id, club_id)` unique constraint;
**`drills` and `templates` do not**. So M1 opens with

```sql
alter table public.drills add constraint drills_id_club_unique unique (id, club_id);
```

guarded by the `if not exists` block 0044 used for `sessions_id_club_unique`
(`0044_training_day_core.sql:69`), because a migration that has been partly
applied by hand must be re-runnable. Adding a unique constraint builds an index
over the whole table, which is trivial at this club's scale and worth noting
anyway.

**Why club-scoped composite at all.** The pattern 0044 established, and for the
reason 0044 states: a bare `on delete set null` on a composite foreign key nulls
every referencing column including `club_id`, which then fails its not-null
constraint and makes the parent undeletable. The column list on `set null` is
load bearing.

**`on delete set null`, not cascade.** Deleting the original must never delete
the adaptations, because an adaptation is what a session actually ran. It becomes
an ordinary top-level drill.

**RLS: no new policy.** `variant_of` is an ordinary column on `drills`. The four
live policies already cover every column, so writing a variant link is already
exactly as restricted as renaming the drill. This is the reasoning `0046` used
for `diagram` and it applies unchanged.

**Audit.** `audit_drills()` (0037) records an update only when corner, level or
duration changed. Setting `variant_of` happens at insert, which already emits
`drill.created`. No audit change.

**Rollback.** Drop the constraint and the column. Adaptations survive as ordinary
drills; only the parent link is lost.

## 3. M2: `sessions.template_id`

```sql
alter table public.sessions add column template_id uuid;
alter table public.sessions
  add constraint sessions_template_fk
  foreign key (template_id, club_id) references public.templates (id, club_id)
  on delete set null (template_id);
create index on public.sessions (template_id);
```

Same composite pattern and the same `set null` column list, for the same reason.
**`templates` carries no `(id, club_id)` unique constraint either**, so M2 adds
`templates_id_club_unique` first, under the same `if not exists` guard.

**No backfill.** A session created before this column existed has no provenance
to recover: `programme_id` plus `programme_week` resolves to a week template only
for programme-applied sessions, and inferring the rest from a name match would be
a guess. Null means "we do not know", which is honest and which every consumer
renders as nothing.

**Audit.** `audit_sessions()` (0037) already emits `session.created` and
`session.updated`. Whether `template_id` joins its allow list is a small decision
for the migration; the default answer is no, because the audit feed is for who
changed a session's identity, not for its provenance.

## 4. M3: station blocks

**Simplified after coach discovery.** The previous version added `blocks` with
`minutes_per_rotation` and `rotations`, and changed the duration model. Both are
withdrawn: rotations follow the station count rather than the group count, so the
existing total is already correct and neither field has anything to arbitrate
(`00-current-state-audit.md` section 17).

```sql
alter table public.sessions  add column blocks jsonb;
alter table public.templates add column blocks jsonb;
```

Stored shape:

```json
[{ "id": "b1", "kind": "carousel" },
 { "id": "b2", "kind": "games" }]
```

And each member activity in `activities` gains `"block_id": "b1"`.

**Two fields, and neither is a number.** Rotations are the count of members with
that `block_id`. The rotation length is the members' own shared `duration`, which
they already carry. Storing either would create a value that can disagree with
the list it describes.

`kind` exists because a carousel and a game phase behave differently at delivery
time (groups rotate through members, or groups become sides and stay) while being
the same thing structurally: the activities that occupy the ground at once. One
concept, one field, no second entity.

### The client change that is not optional

`toActivity` and `toActivityRow` (`src/lib/queries.ts:289`, `:296`) rebuild an
activity field by field from an allow-list. **A key they do not name is dropped
on read and lost on the next save.** So `block_id` must be added to both in the
same change, or blocks silently evaporate.

### The duration model is untouched

`sessionMinutes` (`src/lib/data.ts:539`), `plannedMinutes`
(`src/lib/sessionLifecycle.ts:150`), `src/lib/ics.ts`, the derived lifecycle,
`Home.tsx`, `SessionDay.tsx`, `LiveSession.tsx`, `ProgrammeDetail.tsx`,
`TemplateFormModal.tsx` and `ProgrammeFormModal.tsx` **all stay as they are**.

This removes what the previous revision called the highest rollout risk in the
programme. A wrong total could have put a session in the wrong list through the
derived lifecycle; there is now no total change to get wrong.

The one thing worth adding is a **planning warning**, not a rule: stations in one
carousel move together, so unequal member durations describe no real session. The
planner says so; nothing is refused and nothing is auto-corrected.

### Should `blocks` be constrained in the database?

`sessions.activities` carries no check constraint today, so there is precedent
for an unconstrained plan column. The precedent that matters more is `0046` and
`0028`: where a jsonb column has a fixed vocabulary, this repository states it as
schema.

**Recommendation: a light check constraint.** An array of objects with exactly
`id` and `kind`, `kind` drawn from a closed two-value set, a small maximum number
of blocks. It costs one immutable predicate function, it is now a much smaller
predicate than the previous version would have needed, and it stops a future
client writing a shape the reader cannot understand.

`activities.block_id` cannot be constrained without constraining `activities`
itself, which is out of scope and would require validating every existing row.
Leave it; the client allow-list is the boundary there, as it is for `phase`,
`duration` and `title` today.

### Backwards compatibility

Total. `blocks` null and no `block_id` anywhere is every existing session, every
existing template, and the current behaviour exactly.

## 4a. M6: the team ability order

**New, and the only irreducible new fact in the whole programme.**

```sql
alter table public.teams add column sort_order integer;
create unique index teams_sort_order_unique
  on public.teams (club_id, sort_order) where sort_order is not null;
```

### Why nothing existing can carry it

Verified against the schema rather than assumed
(`00-current-state-audit.md` section 19). `public.teams` carries
`id, club_id, name, created_at, bib_colour` and nothing else. A grep for
`sort_order`, `display_order`, `position`, `rank` and `ability` across `src` and
`supabase/migrations` returns nothing relevant. Every team order in the product
is alphabetical: `useTeams` reads `.order('name')` and `sessionTeamsLabel` sorts
by name.

Three alternatives were considered and rejected:

- **Alphabetical.** For this club it gives Argonauts, Gladiators, Spartans,
  Titans, Trojans, which matches the stated ability order nowhere.
- **`created_at`.** It records when a row was inserted during setup. Reading it
  as a statement about football is the kind of confident wrong answer this
  codebase refuses elsewhere.
- **An ordered array of team ids on `clubs`.** It would list teams in a second
  place, drift when a team is added or deleted, and need its own repair story.
  A column on the row it describes cannot drift.

### What it is, and what it is emphatically not

It is **the club's ordering of its own teams**, five integers for this club, set
by a `teams.manage` holder on the existing `AdminTeams` screen.

It is **not an ability score, an ability level or a training classification**,
and there is no per-player field of any kind. A player's ability context is
derived: `player → current registration → team → that team's position`. Every
link in that chain except the last already exists, and the last is a property of
the team, not of the child.

**No literal team name appears in any rule.** Titans, Trojans, Gladiators,
Spartans and Argonauts are this season's contents of an ordered set, and the
order is expected to change between seasons.

### Nullable, and what null means

Null means unordered. A club that never sets it gets today's behaviour: the
grouping suggestion falls back to keeping each team whole and does not claim to
know which teams are adjacent. That is honest and it fails towards doing less
rather than guessing.

The partial unique index prevents two teams claiming one position while allowing
any number of unordered teams.

### RLS, audit and compatibility

**No new policy.** An ordinary column on `teams`, whose write already takes
`teams.manage` via `teams_manage` (`0012_rbac.sql:376`).

**Audit needs a decision, and it is the same shape as the venue one below.**
`audit_teams()` (0044) has an allow list, and `describeActivityEvent` renders
`team.updated` as the deliberately general "Team updated"
(`src/lib/activityView.ts:432`), whose comment already says it stays general
because the list carries both the name and the bib colour. Adding a third field
does not falsify that sentence, so this is a smaller decision than `venues.layout`
poses. Confirm whether `sort_order` joins the audited allow list; the default
answer is yes, since re-banding the club's teams is a club-level change worth a
feed entry.

**Backwards compatibility.** Null everywhere is every existing team.

**Two orders coexist and must not be confused.** Labels stay alphabetical
(`sessionTeamsLabel`, unchanged); grouping uses the club order. A future reviewer
seeing two sorts should not unify them.

## 5. M4: `venues.layout`

```sql
alter table public.venues add column layout jsonb;
```

Stored shape, version 1:

```json
{
  "version": 1,
  "size": { "metres_wide": 60, "metres_long": 40 },
  "areas": [
    { "id": "a1", "name": "Pitch 1", "x": 0.0, "y": 0.0, "w": 0.5, "h": 1.0 },
    { "id": "a2", "name": "Pitch 2", "x": 0.5, "y": 0.0, "w": 0.5, "h": 1.0 }
  ]
}
```

### The rules it inherits, deliberately

This is the third fraction-coordinate jsonb column in the product, after
`boards.tokens` (0028) and `drills.diagram` (0046). It must inherit their
discipline rather than invent a third one:

- **Fractions 0 to 1, never metres, for position.** The declared real-world size
  is metadata for labelling and proportion, not the coordinate space. One stored
  layout then renders at any width.
- **Versioned**, with the same rule the diagram uses: an unrecognised version
  yields no layout rather than a mis-drawn one.
- **A check constraint stating the key allow-list**, so the shape holds against
  service_role and any hand-written call, exactly as 0046 does.
- **A parser and a serialiser that rebuild field by field and never spread**, in
  a new `src/lib/venueLayout.ts` that shares `clampFraction` with the others.
- **Bounds**: a small maximum number of areas (eight is generous for one age
  group's allocation), a name length cap, a minimum area size so an area cannot
  become an ungrabbable sliver.

### What it must never hold

No person, no address, no postcode, no latitude or longitude, no map tile URL and
no imagery reference in version 1. The allow-list makes each of those
unrepresentable rather than forbidden by convention. A venue layout is a drawing
of a rectangle with names on it.

Geolocation is worth stating explicitly as excluded: it is not needed to say
"Station 1 goes on Pitch 1", it introduces a third-party mapping dependency and a
new privacy surface, and the discovery does not ask for navigation.

### RLS and audit

**No new policy.** `layout` is an ordinary column on `venues`, whose select is
club wide and whose write takes `club.manage`. Drawing a layout is therefore
already exactly as restricted as renaming the venue, which is the right answer.

`audit_venues()` (0044) currently treats an update as a rename, and
`describeActivityEvent` renders `venue.updated` as "Venue renamed"
(`src/lib/activityView.ts:438`), reasoning that the allow list is the name alone.
**That sentence becomes false once a layout can change.** Either the audit
allow-list gains `layout` and the label becomes "Venue updated", or the label is
changed and the comment corrected. This must not be missed; it is exactly the
kind of quiet falsehood the repository's own commentary style exists to catch.

## 6. Station placement

**Revised after review. An earlier draft stored only an `area_id` per station,
which cannot express where within an area a station goes.** Four stations across
two side-by-side pitches at Flushdyke would render as two coincident markers per
pitch, and a coach would still need telling where station 3 is.

**No migration.** Each station activity gains a `place` object in
`sessions.activities`:

```json
{ "phase": "Skill", "drill_id": "…", "duration": 10,
  "block_id": "b1",
  "place": { "x": 0.22, "y": 0.35 } }
```

with an optional footprint where a station occupies an area rather than a spot:

```json
"place": { "x": 0.22, "y": 0.35, "w": 0.18, "h": 0.22 }
```

`toActivity` and `toActivityRow` gain the key alongside `block_id`. **`place` is
a nested object, and those two functions currently rebuild only flat scalars**,
so it must be rebuilt field by field rather than assigned through, or an unknown
key inside it would survive a round trip that the allow-list is supposed to
prevent.

### The coordinate space, and the rules it inherits

Fractions from 0 to 1 across the **whole allocated training area**, the same
space `venues.layout` uses for its sub-areas. Never metres, never pixels, never
relative to a sub-area. One space means a station's position is meaningful
whether or not any sub-area contains it, and a layout redraw does not renumber
anything.

Clamping and minimum size follow the `zone` element in `src/lib/drillDiagram.ts`
(`clampFraction`, `MIN_ZONE_SIZE`, corner pulled back so the rectangle stays on
the surface). That is an existing, reviewed rule and there is no reason for a
second one.

### Area membership is derived, never stored

A station's sub-area is computed from its position at render time. Storing both
would create two facts that can disagree in two ordinary ways: dragging a station
across a boundary leaves the stored area wrong, and moving a pitch in the venue
layout invalidates every stored area id at once with nothing to detect it.

A position inside no sub-area is honestly **"placed, not in a marked area"**. It
is never silently reassigned to the nearest one, and never treated as unplaced,
because a coach may legitimately set a station on the grass between two pitches.

### What happens when things change underneath a session

- **A sub-area moves or is renamed.** Nothing on the session changes. The
  station's position is unchanged and its derived area is recomputed. This is the
  whole benefit of not copying the geometry.
- **A sub-area is deleted.** The station is still placed; it now derives no area.
- **The venue layout's overall shape changes.** Positions are fractions of the
  allocated area, so they scale with it. A club that re-measures its allocation
  gets stations in the same relative places, which is the honest reading of
  "approximately where".
- **The session's venue changes.** Every position is now a claim about different
  ground. The session says so and offers to clear the placements. It does not
  clear them silently, because a coach who changed the venue by mistake would
  lose the layout.
- **A station leaves its block, or the block is dissolved.** The `place` stays on
  the activity and simply stops being rendered by the composer. Nothing is
  destroyed by a structural edit.

### Why not a separate table

A `session_stations` table was considered. It would give a station a durable id
and its own constraints, but a station has no existence apart from the activity
it is, so the table would need a foreign key to a position inside a jsonb array,
which does not exist. Keeping the placement on the activity means reordering,
removing and copying an activity carry its placement automatically, with no
join to keep in step.

The cost is honest and stated: `sessions.activities` has **no check constraint**,
so `place` earns none of the guarantees `venues.layout` and `drills.diagram`
have. The client allow-list is the only boundary, exactly as it is for `phase`,
`duration` and `title` today. `place` carries no person and no free text, so
there is nothing here for a privacy constraint to protect.

### Phase-specific setup needs no extra structure

The session's physical setup changes mid-session: stations come in, game pitches
go out (`02-target-product-model.md` section 7, layer 3). This looked like it
would need setup phases, layout versions or per-phase placement sets. It needs
none of them.

**A placement belongs to an activity, and an activity belongs to a block.** So
the carousel setup view is the placements of the `'carousel'` block's members and
the game setup view is the placements of the `'games'` block's members. Two
views, one field, zero new structure.

A game pitch is a placement with a footprint (`w`, `h`) rather than a spot, which
is exactly what the optional pair is for and why it survived the last revision.

**The transition is an ordinary activity.** "Reset, 5 min" is a custom activity
the planner already supports, it already occupies real time in the total, and it
already sits between the two blocks in the list. There is nothing to add.

### Game side allocation

A game side is a **set of bib groups**, not a player list and not one colour
(`02-target-product-model.md` section 7a).

It rides the `'games'` block entry rather than a new column:

```json
{ "id": "b2", "kind": "games",
  "games": [{ "a": ["red", "blue"], "b": ["green"] }] }
```

**Why bib colours rather than player ids.** Naming the colour cannot duplicate
player membership, which already lives in `register_entries`, and it survives a
child being re-bibbed because it never named the child. A player list would be a
second copy of tonight's membership that could silently disagree with the
register.

**Why stored at all rather than derived.** The suggestion is derived from the
team order, but the coach adjusts it on the night and an adjustment lost to a
page reload on a wet touchline is worse than a small field. It is stored beside
the block whose delivery it describes.

**Per-player exceptions are not modelled.** Moving one child between sides is a
bib change, which is one tap and already session-only. If coaches later report
wanting to move a player without re-bibbing, that is the stated trigger to
revisit.

**The check constraint** on `blocks` therefore admits `games` as an optional
array of two-key objects whose values are arrays of bib colour strings from the
existing `is_bib_colour` vocabulary. That keeps the closed vocabulary closed on
both sides.

## 7. M5: motion, only if approved

Not scoped here beyond its two hazards, both recorded in
`02-target-product-model.md` section 9 and repeated because they are easy to get
wrong:

1. The element key allow-list is a **check constraint**. New keys are a gated
   migration.
2. The parser **discards an unknown version whole**. The reader that understands
   the new version ships and reaches every client **before** any writer produces
   it. Two releases, in that order.

## 8. What is not touched anywhere in this programme

Stated so a future session does not go looking:

- `players`, `player_registrations`, `seasons`: unchanged.
- `player_spond_links`, `spond_event_responses`, `spond_events`, `spond_groups`:
  unchanged, read only, and Spond stays read-only from OTJ.
- `register_entries`: **unchanged, and this is now a positive finding rather than
  an omission.** The three-facts model of 0044 plus 0047 is correct;
  `bib_colour_override` already is the session-only group assignment the coach
  discovery asked for, keyed on `(session_id, player_id)` and writing back to
  nothing; the suggested split and the game allocation both write through the
  existing draft and `useSaveTonight`. No `group_id` and no ability column.
- `teams.bib_colour`, `is_bib_colour`: unchanged. `teams` gains `sort_order`
  (M6) and nothing else.
- `boards`: unchanged. A tactics board seats a team; a drill diagram is an
  exercise; a venue layout is a place. Three things, three columns, one shared
  coordinate discipline.
- `content_shares` and its RPCs: unchanged unless a new public projection is
  approved, which is `05-security-share-boundary.md`.
- Every Edge Function: unchanged, except `_shared/share.ts` if and only if a new
  projection is approved.

## 9. Ordering constraints between migrations

- M1, M2 and M6 are independent of everything and of each other.
- M3 must precede any station placement work, because placement needs to know
  which activities are stations. Station placement itself is **not** a migration
  (section 6); it rides `sessions.activities`.
- M4 must precede the composer, because a station's position is expressed in the
  venue layout's coordinate space and there is no space without a layout.
- M3 and M4 are independent of each other.
- M3 must precede the game side allocation, which rides the `'games'` block.
- M6 should precede the grouping suggestion, which needs the team order to
  combine adjacent bands. It is not a hard blocker: with `sort_order` null
  everywhere the suggestion keeps each team whole and declines to claim which
  teams are adjacent.
- M5, if it happens, is last and depends on nothing.

**None of these is on the critical path of the public sharing decision, and none
of them depends on it.** M1 through M4 and M6 change no policy, no grant and no
projection.

**Apply order relative to the frontend**, following the rule `0046` had to learn:
each of these columns is new and null everywhere, so **the migration goes first
and the frontend second**. A frontend that reads a column the database lacks gets
PostgREST 42703 and the read fails; a database with an unread new column changes
nothing for anybody.
