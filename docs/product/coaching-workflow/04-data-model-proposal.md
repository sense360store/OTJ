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

Across the entire programme, five migrations. Four are additive columns; one is a
constraint widening that only happens if motion is approved.

| # | Change | Table | Phase | Risk |
|---|---|---|---|---|
| M1 | `variant_of uuid null` (+ `drills_id_club_unique`) | `drills` | C | Low |
| M2 | `template_id uuid null` (+ `templates_id_club_unique`) | `sessions`, `templates` | E | Low |
| M3 | `blocks jsonb null` + `block_id` on an activity | `sessions`, `templates` | F | Low. Duration is unchanged while `rotations` defaults to the station count. |
| M4 | `layout jsonb null` + shape constraint | `venues` | H | Medium, new shape boundary |
| M5 | diagram element allow-list widening | `drills` | L, optional | Medium, version rollout hazard |

Three named non-changes, each deliberate:

- **No group table**, under the recommended option. The bib colour stays the
  operational group identity and the two collisions in that derivation are
  surfaced rather than modelled around (`02-target-product-model.md` section 6,
  `08-open-questions.md` Q9). A lightweight group would be one column on
  `register_entries` plus one jsonb list, and it is deferred with a stated
  trigger rather than refused.
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

Two parts. Only the first is a migration.

```sql
alter table public.sessions add column blocks jsonb;
```

Stored shape:

```json
[{ "id": "b1", "minutes_per_rotation": 10, "rotations": 4 }]
```

And each member activity in `sessions.activities` gains `"block_id": "b1"`.

### The client change that is not optional

`toActivity` and `toActivityRow` (`src/lib/queries.ts:289`, `:296`) rebuild an
activity field by field from an allow-list. **A key they do not name is dropped
on read and lost on the next save.** So `block_id` must be added to both, in the
same change, or blocks silently evaporate. `00-current-state-audit.md` section 4
records this.

### Should blocks be constrained in the database?

`sessions.activities` carries no check constraint today, so there is precedent
for an unconstrained plan column. But the precedent that matters more is `0046`
and `0028`: where a jsonb column has a fixed vocabulary, this repository states
it as schema.

**Recommendation: a light check constraint on `blocks`.** Not for privacy (a
block carries no person and structurally cannot) but for correctness: an array of
objects with exactly `id`, `minutes_per_rotation` and `rotations`, positive
integers, at most a handful of blocks. It costs one immutable predicate function
and it stops a future client writing a shape the reader cannot understand.

`activities.block_id` cannot be constrained without constraining `activities`
itself, which is out of scope and would need every existing row validated. Leave
it; the client allow-list is the boundary there, as it is today.

### The duration change and its blast radius

**Scoped correctly after review.** The current total is *not* wrong for a
carousel run as planned: four 10 minute stations over four rotations is 40
minutes either way. It diverges only when the rotation count differs from the
station count, when stations are unequal under a shared rotation length, or when
groups skip stations (`00-current-state-audit.md` section 17). So this is a
change that makes an existing correct answer stay correct once `rotations`
becomes adjustable, not a defect repair.

`sessionMinutes` (`src/lib/data.ts:539`) becomes block-aware, computing
`minutesPerRotation × rotations` for a block instead of summing its members.
With `rotations` defaulting to the station count, **every existing session and
every newly blocked session returns the same number it does today**, which is
what makes this safe to ship. Everything reading it must still be checked:

- `src/lib/sessionLifecycle.ts` computes its own total for the expected end
  (`:145`, `FALLBACK_SESSION_MINUTES`). It must use the same rule, and it must
  stay the only fallback duration in the product, which
  `sessionLifecycle.invariant.test.ts` already enforces.
- `src/lib/ics.ts`, `Home.tsx`, `SessionDay.tsx`, `LiveSession.tsx`,
  `ProgrammeDetail.tsx`, `TemplateFormModal.tsx`, `ProgrammeFormModal.tsx`.

**Templates need blocks too**, or a week plan cannot carry a station structure
and promoting a session to a plan loses it. `templates.blocks jsonb` alongside,
in the same migration.

**Backwards compatibility is total.** `blocks` null and no `block_id` anywhere is
every existing session, and the maths reduces exactly to the current sum.

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
- `register_entries`: unchanged. The three-facts model of 0044 plus 0047 is
  correct and the suggested split writes through the existing draft and
  `useSaveTonight`.
- `teams.bib_colour`, `is_bib_colour`: unchanged.
- `boards`: unchanged. A tactics board seats a team; a drill diagram is an
  exercise; a venue layout is a place. Three things, three columns, one shared
  coordinate discipline.
- `content_shares` and its RPCs: unchanged unless a new public projection is
  approved, which is `05-security-share-boundary.md`.
- Every Edge Function: unchanged, except `_shared/share.ts` if and only if a new
  projection is approved.

## 9. Ordering constraints between migrations

- M1 and M2 are independent of everything and of each other.
- M3 must precede any station placement work, because placement needs to know
  which activities are stations. Station placement itself is **not** a migration
  (section 6); it rides `sessions.activities`.
- M4 must precede the composer, because a station's position is expressed in the
  venue layout's coordinate space and there is no space without a layout.
- M3 and M4 are independent of each other.
- M5, if it happens, is last and depends on nothing.

**None of these is on the critical path of the public sharing decision, and none
of them depends on it.** M1 through M4 change no policy, no grant and no
projection.

**Apply order relative to the frontend**, following the rule `0046` had to learn:
each of these columns is new and null everywhere, so **the migration goes first
and the frontend second**. A frontend that reads a column the database lacks gets
PostgREST 42703 and the read fails; a database with an unread new column changes
nothing for anybody.
