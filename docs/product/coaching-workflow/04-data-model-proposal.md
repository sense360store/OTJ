# Data model proposal

Status: proposal, corrected 18 August 2026. No migration in this document has
been written, numbered, registered or applied.

Everything here follows the repository's existing migration discipline: gated,
reviewed by a human, applied by hand through the production migration workflow,
never `supabase db push` from a session.

**Read section 8 before assuming a migration number.** A file number is not a
reservation, and the reviewed register pins each migration to the hosted ledger
head it was written against.

---

## 1. Summary of anticipated change

**Three activity keys that need no migration, five columns, and one small
table.** M4 is two columns, not one, which is why the column count is four rather
than three.

| # | Change | Where | Slice | Migration | Risk |
|---|---|---|---|---|---|
| A1 | `slot: 'station' \| 'game'` on an activity | `sessions.activities`, `templates.activities` | COACH-2 | **No** | Low |
| A2 | `skipped: true` on an activity | `sessions.activities` only | COACH-2 | **No** | Low |
| A3 | `game_count: 1 \| 2` on the games activity | `sessions.activities` only | COACH-8 | **No** | Low |
| M1 | `sort_order integer null` + partial unique index | `teams` | COACH-1 | Yes, gated | Low |
| M2 | `venue_layouts` table, **plus `age_groups text[] not null default '{}'` on `clubs`** | new + `clubs` | COACH-5 | Yes, gated | Medium |
| M3 | `game_bib_colour_override text null` | `register_entries` | COACH-8 | Yes, gated | Low |
| M4 | `variant_of uuid null` and `library_listed boolean not null default true` (+ `drills_id_club_unique`) | `drills` | COACH-12 | Yes, gated | Low |
| M5 | diagram element allow-list widening | `drills` | Parked | Yes, gated | Medium |

### What earlier revisions proposed and this one does not

Recorded explicitly, because a deleted proposal that is merely absent tends to
come back.

| Withdrawn | Was | Why it is gone |
|---|---|---|
| `sessions.blocks`, `templates.blocks` | Station and game block metadata as jsonb | Two activity keys carry it. No block entity. |
| `activities[].block_id` | Which block an activity belongs to | Same. |
| `activities[].place` | A fraction-coordinate position per station | Layouts are scoped, admin owned and load automatically. Weekly coaches place nothing. |
| `blocks[].start` | The frozen carousel starting-station map | OTJ tracks no running carousel. |
| `blocks[].games` | Game sides as sets of bib colours | The game bib column carries it, and side derives from the colour. |
| `sessions.template_id` | Uniform provenance and a sibling link | No consumer in the settled model. Section 9. |
| `venues.layout` jsonb column | All four layouts on the venue row | It cannot express the venue plus season plus age group scope. Section 3. |
| Deriving stations from the `Skill` phase | Station identity with no new key | `phaseFor` sets the phase from the drill's corner, so the phase is not structure. Section 2. |
| Deriving games from the `Game` phase | Game identity with no new key | Same. A social drill lands in `Game` and that proves nothing. |
| Two `slot: 'game'` activities for two pitches | How many games run at once | Activities are sequential and their durations are summed, so two would double the games phase in the session total, the derived lifecycle and the calendar, and show two steps in Live. One activity, one `game_count`. Section 2. |
| `created_by` and `updated_by` on `venue_layouts` | Accountability | `venues` deliberately has neither and says so; the audit trail already records who. Section 3. |

### The deliberate non-changes

- **No group table and no `group_id`.** The bib colour is the station group's
  identity, unique per session, enforced in the domain because a group is
  emergent from per-player bib resolution.
- **No per-player ability score, level or classification.** Ability context
  derives through the team's position in the club order (M1).
- **No per-player game number and no per-player side column.** Both derive from
  the game bib colour's position in the planned ordering (section 4).
- **No second game activity for a second pitch.** One games phase is one
  activity; `game_count` says how many pitches run inside it (section 2).
- **No session-level game colour map.** The ordering is a pure function of the
  fixed vocabulary and the game count. Only implementation evidence that the
  deterministic rule cannot work would justify one.
- **No `sessions.season_id`.** The season derives from the session's date
  (section 3).
- **No stored station number.** It is the position among active stations.
- **No provenance flag on a register entry.** The regeneration rule preserves
  every saved assignment rather than only the manual ones.
- **No session workflow state column.** Readiness is derived.
- **No drill version table.** Adaptation is a copy.
- **No new share structure.** Coach to coach sharing already ships.

---

## 2. A1, A2 and A3: three keys on an activity, and no migration

### Why this is not a migration

`sessions.activities` and `templates.activities` are `jsonb` with **no check
constraint** (`00-current-state-audit.md` sections 4 and 27), so the database
imposes no shape and a new key needs no DDL.

What it does need is both mappers, because they rebuild field by field from an
allow-list and **drop any key they do not name**:

```ts
// src/lib/queries.ts:289, :296
export function toActivity(a: ActivityRow): Activity
export function toActivityRow(a: Activity): ActivityRow
```

Adding a key to one and not the other loses it on the next save. There are
exactly five call sites: reads at `:385` (templates) and `:432` (sessions);
writes at `:1579` (templates), `:1826` (copy a template to a week) and `:2026`
(sessions).

### A1: `slot`

```jsonc
{ "phase": "Skill", "drill_id": "…", "duration": 10, "slot": "station" }
{ "phase": "Game",  "drill_id": "…", "duration": 15, "slot": "game" }
{ "phase": "Warm-Up", "title": "Arrival", "duration": 5 }   // no slot: neither
```

- Closed vocabulary: `'station'`, `'game'`. Absent means neither, and absent is a
  real answer rather than a defaulted one.
- **The same key name on both sides.** `slot` is one lowercase word, so there is
  no snake_case to camelCase mapping to get wrong, exactly as `phase` and
  `duration` already are.
- It belongs to the **plan**, so `templates.activities` carries it and
  `useStartFromTemplate`'s deep copy of the mapped activities
  (`src/hooks/useStartFromTemplate.ts:45`) carries it into every dated session
  for free.

**The name was chosen against repository conventions.** `role` is RBAC here
(`profiles.role`, `roles`, `member_roles`). `kind` is already the discriminator
for diagram elements and content shares, and sitting `kind` beside `phase` on one
object invites the exact confusion this key exists to remove. `slot` is unused as
a data key and names what it is.

### A2: `skipped`

```jsonc
{ "phase": "Skill", "drill_id": "…", "duration": 10, "slot": "station", "skipped": true }
```

- **Written only as `true`.** Restoring the drill removes the key. `false` is
  never written, so each state has exactly one representation, which is how
  `drill_id` and `title` already behave.
- **Absence means running**, and that is what decides the sense of the key. Every
  activity in every existing session carries nothing and every one of them runs,
  so a positively-phrased key would read every existing plan as entirely stood
  down.
- **Session-local.** The two template write paths (`:1579`, `:1826`) strip it,
  and the reader ignores it on a template. Both ends agree and neither depends on
  the other, and ignoring it fails towards running the drill.
- **Meaningful on any activity carrying a `slot`**, station or games. A coach who
  decides there are no games tonight stands the games activity down the same way
  they stand a station down, which is what makes "at most one **active** games
  activity" mean anything. The reader ignores it on an activity with no `slot`,
  so a stray value can hide neither a warm-up nor a cool-down.
- **A stood-down activity that carries a `slot` contributes nothing to the
  session's length.** The `slot` qualifier is load bearing: a stray `skipped` on
  an activity with no `slot` changes nothing, which is what makes the key inert
  outside the operational plan. See "The one existing rule this changes" below.

### A3: `game_count`

```jsonc
{ "phase": "Game", "drill_id": "…", "duration": 20, "slot": "game", "game_count": 2 }
```

- **One activity is the whole games phase**, and its `duration` is that phase's
  duration. `game_count` says how many pitches run **inside** it.
- Closed vocabulary: `1` or `2`. **Absent means the operational count has not
  been accepted yet**, which is a real state and not a default.
- **Meaningful only on `slot: 'game'`**, and v1 expects at most one active such
  activity per session.
- **Session local**, exactly like `skipped`, and delivered by the contract below
  rather than by the mappers, so a week plan authored in June carries no
  commitment about September's attendance.
- **The case mapping is real here**, unlike `slot` and `skipped`: `gameCount` in
  `Activity`, `game_count` in `ActivityRow`, which is the ordinary
  `drillId`/`drill_id` convention. Both mappers name it or it is lost.

**Why this is a field and not a second activity.** Activities are sequential and
`sessionMinutes` (`src/lib/data.ts:539`) sums their durations, `plannedMinutes`
(`src/lib/sessionLifecycle.ts:150`) reimplements that sum behind the derived
lifecycle, `src/lib/ics.ts` takes the calendar length from the same seam, and
`LiveSession.tsx` walks the list one at a time. Two pitches running at the same
time modelled as two activities would double the games phase in all four. **One
activity with one duration is what every one of them already assumes, so this
correction leaves all four untouched.**

### The session-local contract, because the mappers cannot deliver it alone

**Corrected after review.** `skipped` and `game_count` are session local; `slot`
is not. The natural reading of "the template write paths strip it" was that
`toActivityRow` does the stripping, and **it cannot**: both template and session
reads call the same `toActivity`, and all three writes call the same
`toActivityRow` (`00-current-state-audit.md` section 27). A shared mapper cannot
tell which side it is on, so adding a key to it preserves that key for templates
too, and omitting it loses the key from sessions.

| Part | Who |
|---|---|
| Carry all three keys faithfully | `toActivity` and `toActivityRow`, shared and context free |
| Strip the session-local keys on the way into a template | **One named helper**, called by the template write paths (`:1579`, `:1826`) |
| Ignore the session-local keys on the way out of a template | The same helper, applied to the template read (`:385`) |

**Both ends deliberately**, so a row that predates the helper, or one written by
a future hand-rolled call, still behaves. **One helper for both keys**, so a
third session-local key later joins a list rather than growing a code path.

### The one existing rule this changes

Every other claim in this document is additive. This one is not, and review is
what caught it. It is one rule, "the session's length is the sum of its
activities' durations", and this repository implements that same sum **four
times**, so
the change lands in both.

**A stood-down activity must not count towards the session's length.** Rotations
follow the active stations, so a five station plan delivered as four runs four
rotations; counting the fifth would overstate the night by one rotation in the
planner, in the expected end and in the calendar export. A stood-down games phase
is the same.

**Four independent implementations sum session activities, not two**, and
`00-current-state-audit.md` section 17 carries the re-derived inventory:
`sessionMinutes` (`src/lib/data.ts:539`), `plannedMinutes`
(`src/lib/sessionLifecycle.ts:150`), an inline reduce in
`src/routes/Planner.tsx:733` that does not import either, and
`buildSessionSnapshot` in `supabase/functions/_shared/share.ts:797-806`, which is
Deno and cannot import from `src/lib/` at all. `src/lib/ics.ts` inherits from the
first two. Each of the four must honour the rule, and the plan must not claim it
lands in two functions.

**`plannedMinutes` additionally needs its zero branch corrected.** It read
`total > 0 ? total : FALLBACK_SESSION_MINUTES`, so a session with every
operational activity stood down would sum to zero and be answered as a synthetic
90 minute session.

**Corrected at implementation, and the mechanism this document proposed was
rejected there.** It said the fallback must key on there being no activities to
sum rather than on the sum being zero. That is one line and it is wrong in the
direction the lifecycle exists to protect: it also swallows a plan whose
durations are zero, absent, null or NaN, and every one of those is reachable
without a coach doing anything unusual, because the planner stores a cleared
minutes box as `parseInt(...) || 0` and a drill saved with a blank duration
reads back as `0` and is copied straight onto the activity by `drillPicker`.
Such a session would end at its own start instant and leave every operational
surface while the coach was standing on the pitch.

**Zero reaches the function two ways and they are opposite facts**, so the
shipped rule keys on which one happened. Something stood down means the coach
emptied a plan they built, and zero is the answer. Nothing stood down means the
plan carries no usable minutes, which is the case the fallback has always
covered, unchanged. The result is floored at zero as well, because `total > 0`
was also the only thing stopping a negative sum putting the expected end before
the start. `src/lib/sessionLifecycle.ts` carries the rule and the reasoning, and
`src/lib/sessionLifecycle.test.ts` enumerates every shape whose answer must not
move.

**It is inert until something is stood down.** No existing row carries `skipped`,
so every stored session's total is unchanged and the derived lifecycle places
every existing session exactly where it does now. That is what keeps a change to
code this widely read low risk, and a test should assert it directly.

### What is not guaranteed, stated plainly

`sessions.activities` has no check constraint, so **these three keys earn none of
the database guarantees `drills.diagram` and `boards.tokens` have**. The client
allow-list is the only boundary, exactly as it already is for `phase`,
`duration`, `title` and `drill_id`.

That is acceptable for the same reason it is acceptable today: none of them can
carry a person, a place or free text. `slot` is one of two words, `skipped` is
`true` or absent, and `game_count` is `1` or `2`. Nothing here needs a privacy
constraint to protect.

### No backfill, and nothing inferred at read time

A plan written before these keys existed carries neither, so it declares no
stations, and the setup map says so with a one-press way to fix it. That press
may be **seeded by a suggestion**, phase-shaped or otherwise, in the same spirit
as `phaseFor` seeding a phase when a drill is added from the library. A
suggestion confirmed by a person and then stored is a different thing from a
heuristic applied at read time, and only the first is allowed.

---

## 3. M2: the `venue_layouts` table

**The scope decides the shape.** Layouts are scoped to **venue, season and age
group**, they are not venue-global, and they are not per team
(`02-target-product-model.md` section 8).

### Why not a jsonb column on `venues`

An earlier revision proposed `venues.layout`, arguing that an ordinary column
inherits the table's club-wide read and `club.manage` write with no new policy.
That argument is sound and the scope outranks it:

- **A season is a row.** `seasons` (`0031_seasons.sql:148`) carries
  `seasons_id_club_unique (id, club_id)`, so the club-scoped composite foreign
  key pattern is available. A season id buried in a jsonb blob is unenforceable.
- **A column grows without bound.** One row per venue holding every season's and
  every age group's layouts only ever accumulates, is edited by
  read-modify-write, and lets two admins editing two age groups on one evening
  overwrite each other.
- **A row is the natural unit** of editing, deletion, and of the unique key that
  makes "one 5 station layout per scope" a database fact rather than a
  convention.

Four rows per venue per age group per season. Three venues and one age group is
twelve rows a season.

### The proposed DDL

```sql
create table public.venue_layouts (
  id         uuid primary key default gen_random_uuid(),
  club_id    uuid not null references public.clubs (id) on delete cascade,
  venue_id   uuid not null,
  season_id  uuid not null,
  age_group  text not null,
  kind       text not null,
  slots      integer not null,
  zones      jsonb not null,
  -- No created_by, no updated_by and no updated_at. See "The columns that
  -- are NOT here" below: venues deliberately carries none of them either,
  -- and audit_venue_layouts records who changed what.
  created_at timestamptz not null default now(),

  -- Club scoped composite references. The column list on any future
  -- set null would be load bearing for the reason 0044 states.
  constraint venue_layouts_venue_fk
    foreign key (venue_id, club_id) references public.venues (id, club_id)
    on delete cascade,
  -- restrict, mirroring how player_registrations references seasons: a
  -- season that has layouts is not silently removable, and seasons has no
  -- client delete policy or grant anyway (0031).
  constraint venue_layouts_season_fk
    foreign key (season_id, club_id) references public.seasons (id, club_id)
    on delete restrict,

  constraint venue_layouts_age_group_bounded
    check (btrim(age_group, E' \t\r\n') <> '' and char_length(age_group) <= 20),
  constraint venue_layouts_kind_valid
    check (kind in ('stations', 'games')),
  -- The closed v1 vocabulary: 4 or 5 stations, 1 or 2 games. Three
  -- stations is not offered and is not storable.
  constraint venue_layouts_slots_valid check (
    (kind = 'stations' and slots in (4, 5))
    or (kind = 'games' and slots in (1, 2))
  ),
  -- The predicate takes slots as well as zones, because the zone count is a
  -- property of the PAIR: a four zone layout on a slots = 5 row is exactly the
  -- corruption this constraint exists to refuse, and a predicate over zones
  -- alone cannot see the row's slots to compare against.
  constraint venue_layouts_zones_shape
    check (public.venue_layout_is_valid(zones, slots)),

  constraint venue_layouts_scope_unique
    unique (club_id, venue_id, season_id, age_group, kind, slots)
);
```

**No separate index.** An earlier draft added
`(club_id, venue_id, season_id)`, which is a strict leading prefix of the unique
constraint's own btree: Postgres already serves that lookup from the constraint's
index, so the extra one costs writes and storage and answers nothing new. `0044`
declines exactly this redundancy by name, and the same reasoning applies here.
Should a query ever need a genuinely different leading column, that is the moment
to add one, with the query named beside it.

`age_group` is bounded to 20 characters, matching `seasons.name`'s bound and the
club's own labels.

### M2 also adds the club's age group vocabulary, and that is a correction

**`clubs.age_groups` does not exist.** An earlier revision of this document and
of the audit both asserted it did. Verified against the migrations rather than
the TypeScript: `public.clubs` carries `id, name, crest_url, motto, created_at`
and nothing else (`0001_init.sql:35-41`). The `age_groups text[]` column at
`0001_init.sql:50` is on **`profiles`**.

**`profiles.age_groups` is not the answer and must not be repurposed.** It is one
coach's own age groups, per user and self-writable. A club level scope key taken
from it would mean two coaches could silently define two different vocabularies
for one club, and a member editing their own preferences would move a scope key
that venue layouts are filed under.

**So the venue layout scope needs a canonical club level list, and creating one
is a migration.** Not client work, which is what an earlier draft of `06` called
it:

```sql
alter table public.clubs add column age_groups text[] not null default '{}';
```

- **Admin managed**, under the existing `club.manage` capability that governs the
  rest of club configuration. No new capability key.
- **`default '{}'` means no backfill and no behaviour change on apply.** Every
  existing club gets an empty list, which reads as "not configured yet" and is
  one of the five no-layout states rather than an error.
- **One list, two consumers.** The session age group selector and the venue
  layout admin read the same column. Today there are **two** hardcoded literal
  lists and they disagree with each other: `src/routes/Planner.tsx:763` offers
  `'U6s'…'U12s'` and `AGES` in `src/lib/data.ts:536` is `'U6'…'U12'`, without the
  trailing `s`. That divergence is precisely what a canonical list ends.
- **Existing sessions are not touched.** `sessions.age_group` stays nullable free
  text and **no historical value is rewritten, silently or otherwise**. A session
  carrying a legacy label the club list does not contain still opens, still runs,
  and still displays what it says; it simply resolves no layout, which is the
  named "no age group" state widened to "no matching age group". Migrating those
  labels is a separate, human decision and is not part of this.
- **No `AgeGroup` table.** A text vocabulary is sufficient: nothing references an
  age group by id, nothing carries attributes about one, and the repository has
  no evidence that it needs to. A table would be a second identity to keep in
  step with the free text column that already exists.

**A check constraint still cannot verify membership of the list**, because that
needs a subquery. The vocabulary is enforced by both surfaces offering one list,
which is the same discipline `sessions.age_group` has today, now with a single
source. Section 3's honest gap below.

### `zones`, and the discipline it inherits

An ordered list of named rectangles, versioned, in fraction coordinates:

```json
{
  "version": 1,
  "size": { "metres_wide": 60, "metres_long": 40 },
  "zones": [
    { "n": 1, "name": "Top corner", "x": 0.02, "y": 0.02, "w": 0.45, "h": 0.45 },
    { "n": 2, "x": 0.53, "y": 0.02, "w": 0.45, "h": 0.45 },
    { "n": 3, "x": 0.02, "y": 0.53, "w": 0.45, "h": 0.45 },
    { "n": 4, "x": 0.53, "y": 0.53, "w": 0.45, "h": 0.45 }
  ]
}
```

This is the third fraction-coordinate jsonb value in the product, after
`boards.tokens` (0028) and `drills.diagram` (0046), and it inherits their
discipline rather than inventing a third:

- **Fractions 0 to 1, never metres, for position.** The declared real-world size
  is metadata for labelling and proportion, never the coordinate space.
- **Versioned**, with the diagram's rule: an unrecognised version yields no
  layout rather than a mis-drawn one.
- **A check constraint stating the key allow-list**, via an immutable predicate
  function, so the shape holds against service_role and any hand-written
  PostgREST call, exactly as 0046 does.
- **A parser and serialiser that rebuild field by field and never spread**, in a
  new `src/lib/venueLayout.ts` sharing `clampFraction` with the others.
- **Bounds**: a name length cap, and a minimum zone size so a zone cannot become
  an ungrabbable sliver.

### What the database boundary must actually be able to enforce

Stated as a checklist, because an earlier draft claimed an enforcement the
proposed signature could not deliver: it passed `zones` alone while the prose
said the zone count equals `slots`, so a four zone value was storable on a
`slots = 5` row and the five station renderer would have received four zones.

| Must refuse | Where |
|---|---|
| An unrecognised `version` | `venue_layout_is_valid` |
| A key outside the allow-list, at any depth | `venue_layout_is_valid`, in the manner of `0046` |
| A coordinate outside 0 to 1, or a zone smaller than the minimum | `venue_layout_is_valid` |
| A zone count that is not `slots` | **`venue_layout_is_valid(zones, slots)`**, which is why it takes the pair |
| `kind = 'stations'` with `slots` not in (4, 5) | `venue_layouts_slots_valid` |
| `kind = 'games'` with `slots` not in (1, 2) | `venue_layouts_slots_valid` |

**Two functions, or one taking the pair?** One taking the pair, because the zone
count is a property of the pair and splitting it would put half a rule in a
second place. The alternative considered was a shape-only validator plus a
separate `check (jsonb_array_length(zones->'zones') = slots)`; it was rejected
because that expression errors when `zones->'zones'` is not an array, which the
shape half has to establish first, so the two checks would have an ordering
dependency the database does not promise. `is_bib_colour` and the `0046`
predicates are the precedent for an immutable helper doing the whole job.

**The migration is not written here**, and its self-verification proves each row
of that table by attempting a refused value.

**It must hold no person, no address, no postcode, no latitude or longitude, no
map tile URL and no imagery reference.** The allow-list makes each
unrepresentable rather than discouraged.

### The columns that are NOT here, and why

The first draft of this table carried `created_by`, `updated_by`, `created_at`
and `updated_at`, while claiming to mirror `venues`. **It did not mirror
`venues`, and `venues` is right.** `0044` gives `venues` exactly
`id, club_id, name, created_at` and states the reason in its own comment:

> No `created_by` column either. Venues are `club.manage` configuration with no
> ownership concept, and `audit_venues` already records who created each one.

A layout is the same class of thing, so the same reasoning applies without
modification:

| Column | Kept? | Why |
|---|---|---|
| `created_by` | **No** | No ownership concept. Every write takes `club.manage`, and the audit trail records who. |
| `updated_by` | **No** | Same, and it is the field most likely to be read as ownership by a future screen that then invents an owner-edits rule this table does not have. |
| `updated_at` | **No** | No consumer. "When was this layout last redrawn" is an audit-feed question, and the feed answers it with **who** as well. |
| `created_at` | **Yes** | Mirrors `venues` exactly. |

**No client-writable accountability field remains, so there is nothing to
forge.** That is the point of removing them rather than defending them: `venues`
avoids the forgery question entirely by not having the fields, and copying that
is cheaper than copying `seasons`' pattern of pinning `created_by = auth.uid()`
in an insert policy.

If an admin screen later genuinely needs "last redrawn", the honest options are
the audit feed, which already carries it, or a column added then with the
consumer visible. **A provenance-looking field is not kept because it looks
useful.**

### RLS, grants and audit

**Mirror `venues` exactly**, because a layout is the same class of club
configuration as the venue it hangs off (`0044_training_day_core.sql:257`):

```sql
alter table public.venue_layouts enable row level security;

create policy "venue_layouts_select_club" on public.venue_layouts
  for select using ( club_id = public.my_club() );
create policy "venue_layouts_manage" on public.venue_layouts
  for all using ( club_id = public.my_club() and public.has_perm('club.manage') )
  with check ( club_id = public.my_club() and public.has_perm('club.manage') );

revoke all on public.venue_layouts from anon, authenticated;
grant select, insert, update, delete on public.venue_layouts to authenticated;
```

Club wide read with no capability, because a coach needs to see where the
stations go and the row carries no child data. `club.manage` write, because it is
admin configuration. Grants are explicit, which is the 0012 lesson.

**Audit, and it now carries more weight.** With `created_by` and `updated_by`
removed, the audit trail is the **only** record of who changed a layout, exactly
as it is for venues. So auditing create, update and delete is not optional
polish; it is what makes the smaller table honest. The migration decides the
source values. **One pleasant consequence of the table:** because
`layout` is no longer a column on `venues`, `audit_venues()` and
`describeActivityEvent`'s "Venue renamed" label (`src/lib/activityView.ts:438`)
**stay true**, and the label correction the previous revision had to schedule
disappears.

### How a session resolves its scope

| Part | Source |
|---|---|
| Venue | `sessions.venue_id` |
| Age group | `sessions.age_group` |
| Station count | active stations in the plan (section 2) |
| Season | **derived**, below |

**Season derivation fails closed.** From `sessions.date` against
`seasons.starts_on` and `seasons.ends_on`:

| Seasons containing the date | Result |
|---|---|
| Exactly one | That season. |
| Zero | **Unresolved.** No layout. The screen says the session's date falls in no season. |
| More than one | **Ambiguous.** No layout. The screen says the date falls in more than one. |

**There is no fallback to `seasons.is_current` in either failing branch.** Two
earlier drafts had one: the first fell back whenever zero or more than one
matched, the second kept a narrower tie-break for the more-than-one case. Both
are removed. A season that does not contain the date is a different season, and
choosing one to fill a gap would load the 2026/27 allocation onto a 2025 session
and show a coach ground that was never theirs.

**`is_current` may still be a default when an admin begins creating
configuration**, because that is a person choosing a scope with the answer in
front of them and able to change it. **It must never override the date when
resolving an existing dated session.**

Season overlap is deliberately unconstrained by `0031`, so more than one match is
a configuration problem with a human answer. Naming it is more useful than
picking one, and it is the same shape as `matchVenueByLocation`
(`src/lib/venues.ts:96`), which refuses to guess when zero or more than one venue
matches.

**Both failing branches are real states, not errors**, and both render exactly
like a scope whose layouts were never drawn: a date before the club's first
season, in a gap between two, beyond the last one's `ends_on`, or inside two that
overlap. A link an admin can follow sits beside the sentence.

**`sessions` gains no `season_id`.** A stored season would be a second fact that
can disagree with the date, and the derivation costs one comparison against rows
the screen has already read.

### The honest gap: the age group vocabulary

**`clubs.age_groups` does not exist**, and the column that does is on `profiles`
(`00-current-state-audit.md` section 26), so the gap is wider than an ignored
list: there is nothing club level to ignore. Two disagreeing hardcoded literals
stand in for it. The fix is the column this section proposes above, plus the
layout admin screen and the session's age group control reading the **same**
list. Making that list the club's own is a small
piece of work COACH-5 should carry rather than inherit, and it is not a
migration.

### Backwards compatibility and rollback

An empty table is every club today, and every surface renders no layout as
nothing.

Rollback drops the table, which **discards every saved layout**. Drop the check
constraint alone if only the shape is being withdrawn. This is the wording `0046`
uses and the same reasoning applies.

---

## 4. M3: `register_entries.game_bib_colour_override`

```sql
alter table public.register_entries add column game_bib_colour_override text
  check (game_bib_colour_override is null
         or public.is_bib_colour(game_bib_colour_override));
```

### Why a second column is the honest answer

**Today** the table holds one row per `(session_id, player_id)` with a single
`bib_colour_override`, written through
`upsert(..., { onConflict: 'session_id,player_id' })`, so a second bib for the
same player in the same session replaces the first
(`00-current-state-audit.md` section 21).

The settled model needs both at once: the station bib plan survives the games
being planned with different bibs, some players are re-bibbed for the games, each
game shows two distinguishable colours, and the game plan names each player's
side and colour beside the station groups. One column cannot hold two independent
values.

**This is the same defect 0047 fixed once already, on this table.** `present`
carried both attendance and inclusion, a coach who split fourteen of the eighteen
who came had four children recorded absent, and the answer was a second column
that copies nothing from the first. The migration shape follows 0047 exactly.

### Resolution, and what derives from it

```
station bib = station override, else the team default, else none
game bib    = game override,    else the effective station bib
```

`src/lib/bibs.ts` owns both rules and no screen resolves a bib itself.

**The fallback is narrower than it looks, and the suggestion must close the
gap.** The game colours are the first `2 x game_count` of the vocabulary, and the
station colours are the first `N` where `N` is the group count. With five groups
and `game_count = 2`, which is the ordinary shape at 24 or more confirmed, the
fifth group's colour is **not** one of the four in play for the games. Falling
back to it would resolve to no game for a whole group.

So the suggested allocation **writes a game override for every included player
whose station colour is not one of the game colours**, and the fallback then
means only what it can honestly mean: *a player whose station colour is already
in play for the games keeps it, and everyone else is handed a bib.* That is also
what happens physically, because a child in the fifth colour has to be given one
of the four the games are using.

**Readiness follows.** "Games prepared" requires every included player to resolve
to a game, so a player left on an out-of-list colour is a named gap on the
screen, not a silent absence from both games.

**Game and side derive from the colour**, by its position in the planned ordering
of the first `2 x game_count` colours of the fixed `BIB_COLOURS` vocabulary:
index 0 is game 1 side A, index 1 is game 1 side B, index 2 is game 2 side A, and
so on. **`game_count` (A3) is the only input besides the fixed vocabulary**, so
with no accepted count there is no ordering and no colours to offer. A colour
outside the list resolves to **no game** and shows as unassigned, never guessed
into the nearest one.

**So no per-player game number column, no per-player side column, no
session-level colour map and no second game activity**, and the UI offers only
the colours in the list, which makes an out-of-list value unreachable through the
product.

### What it copies, and what it must not

**It copies nothing, in either direction, ever.** The migration writes no row.
Like 0047 it must state that in its header and prove it in its self-verification:
fingerprint the existing `bib_colour_override` values before and after and show
they are byte for byte unchanged.

Rows written before this column existed carry a station bib and no game bib,
which resolves to "they play in what they are wearing". That is the correct
reading of history and needs no backfill.

### RLS, grants, audit, write path

**No new policy and no new grant.** The four 0044 policies on `register_entries`
name no column and the grants are table wide, which is what let 0047 add a column
without touching a policy. The self-verification should prove it.

**Unaudited, deliberately.** 0044's self-verification raises an exception if a
per-tick audit trigger is ever attached to this table, and that decision stands.
`register_entries_touch` continues to stamp `marked_by` and `marked_at`.

`REGISTER_COLUMNS` and `useSaveTonight` gain the column, and **a save continues
to send only the columns that changed**, so two coaches editing different facts
about one child cannot overwrite each other.

**Deny lists.** The column names a child's bib and joins both public-share
forbidden-key lists **when it lands, not when it is first shared**
(`05-security-share-boundary.md` section 6).

---

## 5. M1: `teams.sort_order`

```sql
alter table public.teams add column sort_order integer;
create unique index teams_sort_order_unique
  on public.teams (club_id, sort_order) where sort_order is not null;
```

### Why nothing existing can carry it

Verified against the schema (`00-current-state-audit.md` section 19).
`public.teams` carries `id, club_id, name, created_at, bib_colour` and nothing
else. A grep for `sort_order`, `display_order`, `position`, `rank` and `ability`
across `src` and `supabase/migrations` returns nothing relevant. Every team order
in the product is alphabetical.

Three alternatives were considered and rejected: alphabetical (which for this
club matches the ability order nowhere), `created_at` (which records when a row
was inserted during setup), and an ordered array of team ids on `clubs` (which
lists teams in a second place and drifts).

### What it is, and what it is not

**The club's ordering of its own teams.** Five integers, set by a `teams.manage`
holder on the existing `AdminTeams` screen.

It is **not an ability score** and there is no per-player field of any kind. No
literal team name appears in any rule.

Null means unordered, which is today's behaviour: the grouping suggestion keeps
each team whole and does not claim to know which teams are adjacent. **The screen
says the order is unset** rather than quietly doing less, because the correct
failure will otherwise look like a bug.

**No new policy.** An ordinary column on `teams`, whose write already takes
`teams.manage` via `teams_manage` (`0012_rbac.sql:376`).

**Audit.** `audit_teams()` has an allow list, and `describeActivityEvent` renders
`team.updated` as the deliberately general "Team updated"
(`src/lib/activityView.ts:432`), which a third field does not falsify. Confirm
whether `sort_order` joins the audited allow list; the default answer is yes.

**Two orders coexist and must not be confused.** Labels stay alphabetical
(`sessionTeamsLabel`, unchanged); grouping uses the club order.

---

## 6. M4: `drills.variant_of`

```sql
alter table public.drills add constraint drills_id_club_unique unique (id, club_id);

alter table public.drills add column variant_of uuid;
alter table public.drills
  add constraint drills_variant_of_fk
  foreign key (variant_of, club_id) references public.drills (id, club_id)
  on delete set null (variant_of);
create index on public.drills (variant_of);
```

**The composite parent constraint does not exist yet and must be added first.**
`teams`, `players`, `sessions`, `venues`, `seasons` and `spond_events` all carry
an `(id, club_id)` unique constraint; **`drills` does not**. The addition is
guarded by the `if not exists` block 0044 used for `sessions_id_club_unique`
(`0044_training_day_core.sql:69`), because a migration partly applied by hand
must be re-runnable.

**Why club-scoped composite at all.** The reason 0044 states: a bare
`on delete set null` on a composite foreign key nulls every referencing column
including `club_id`, which then fails its not-null constraint and makes the
parent undeletable. The column list on `set null` is load bearing.

**`on delete set null`, not cascade.** Deleting the original must never delete
the adaptations, because an adaptation is what a session actually ran.

### Provenance and listing are two facts, and one column cannot hold both

An earlier draft derived the library listing from `variant_of`: a drill with a
parent was an adaptation and was hidden. **That is broken by the `set null` it
sits beside.** Deleting the original nulls `variant_of` on every adaptation, and
under a `variant_of is null` listing rule all of them would appear in the library
at once, without any coach pressing Save as reusable. A coach deleting one drill
would find five near-duplicates arrive, which is precisely the clutter the
settled decision forbids.

So M4 is **two columns, not one**:

```sql
alter table public.drills add column variant_of uuid;          -- provenance
alter table public.drills add column library_listed boolean not null default true;
```

| Fact | Column | May go null or change |
|---|---|---|
| Which drill this was adapted from | `variant_of` | Yes. Nulled when the parent is deleted, and that is harmless. |
| Whether this drill belongs in the library | `library_listed` | Only by an explicit human action. |

- An adaptation is created with `library_listed = false`.
- **Save as reusable drill** creates a **new** row with `library_listed = true`
  and `variant_of` pointing at the adaptation's parent. The original is still
  never overwritten.
- Deleting a parent nulls `variant_of` and **does not touch `library_listed`**,
  so an adaptation stays out of the library and simply stops naming where it
  came from.
- `default true` means every existing drill is listed, which is today's
  behaviour exactly, and no backfill is needed.

This is the same shape as the two defects this programme has already had to fix:
`present` carrying attendance and inclusion (0047), and one bib column carrying
the station and game arrangements. **A column that answers two questions answers
one of them wrongly the moment they diverge**, and a parent deletion is exactly
that moment.

**The listing rule is still not an access rule.** `library_listed` decides what a
list shows; every policy on `drills` is unchanged, so an adaptation is as
readable as any other drill to anyone who can reach the session that runs it.

**No new policy.** Ordinary columns on `drills`; the four live policies already
cover every column. **Audit**: `audit_drills()` (0037) records an update only
when corner, level or duration changed, and setting either column happens at
insert, which already emits `drill.created`.

**Rollback, and the two columns are not equally safe to drop.** Dropping
`variant_of` loses only provenance: adaptations stay unlisted and every session
still points at the row it ran. **Dropping `library_listed` publishes every
adaptation into the library at once**, which is the exact defect the column
exists to prevent, so it is dropped only if the whole adaptation feature is being
withdrawn and someone has decided what should happen to the copies already made.
This is the same "drop the constraint, not the column" shape `0046` uses and M2
repeats.

---

## 7. M5: motion, only if approved

Not scoped beyond its two hazards, both repeated because they are easy to get
wrong:

1. The element key allow-list is a **check constraint**. New keys are a gated
   migration.
2. The parser **discards an unknown version whole**. The reader that understands
   the new version ships and reaches every client **before** any writer produces
   it. Two releases, in that order.

---

## 8. Migration sequencing, and why a file number reserves nothing

**Open draft PR #191 owns reviewed migration `0050_bulk_delete_players.sql`. This
programme does not modify it, does not depend on it, and must not assume it.**

The production migration workflow applies one file per run, chosen from the
closed register in
`.github/scripts/production-migration/reviewed_migrations.py`. Every entry pins
the hosted state it was reviewed against:

```python
expected_previous_version="20260812102912",
expected_previous_name="spond_session_link_unique",
```

That is "the ledger row that must still be the unique newest one before this
runs". If the head has moved, the run stops before touching anything.

**Three consequences, and they are the whole of this section:**

1. **A file number is not a reservation.** Calling a file `0051` claims nothing.
   What claims a position is a register entry pinned to a head.
2. **A register entry cannot be written before its head is known.** If `0050` is
   applied first, the next migration's `expected_previous_version` is `0050`'s
   stamp, which does not exist until `0050` has run.
3. **Two unapplied migrations cannot both be authored against today's head**
   without one becoming wrong the moment the other applies. The second is
   rewritten, reviewed again, and only then applied.

**So no coaching migration is authored as "the one after 0050" while 0050 is
unresolved.** Each is numbered and registered at the moment it is ready for its
own application review, against the live ledger as it stands then, confirmed
there and not against the highest file on disk (`CLAUDE.md`, Data model).

**The non-migration slices are not sequenced by any of this.** A1 and A2, the
suggested setup, the setup reconciliation, the share check and the whole
authoring track touch no migration and proceed on their own dependencies.

### Ordering between the migrations themselves

- M1, M2, M3 and M4 are independent of each other.
- M1 should precede the grouping suggestion, which wants the team order to
  combine adjacent bands. It is not a hard blocker: with `sort_order` null the
  suggestion keeps each team whole and says the order is unset.
- M2 must precede the setup map.
- M3 must precede the game plan. A3 rides `sessions.activities` and needs no
  migration, so it can land with or before it.
- M4 must precede adaptation.
- M5, if it ever happens, is last.

**Apply order relative to the frontend**, following the rule `0046` had to learn:
each column is new and null everywhere and the table is new and empty, so **the
migration goes first and the frontend second**. A frontend reading a column the
database lacks gets PostgREST 42703 and the read fails.

---

## 9. Deferred: `sessions.template_id`

It would give a session uniform provenance and make two deliveries of one plan
visible as siblings. **It is not proposed**, because both journeys are copies
that work without it and nothing in the settled model asks for a sibling display.

**The trigger that would revive it**: a request to see "also delivered Saturday"
on a session, or to apply one edit to both deliveries.

---

## 10. What is not touched anywhere in this programme

- `players`, `player_registrations`: unchanged.
- `seasons`: **read only**. Referenced by `venue_layouts`, never written by this
  programme, and its no-delete rule is respected by `on delete restrict`.
- `clubs`: unchanged. `age_groups` is read, and should start being read by the
  screens that offer an age group.
- `player_spond_links`, `spond_event_responses`, `spond_events`, `spond_groups`:
  unchanged, read only, and Spond stays read-only from OTJ.
- `sessions` and `templates`: **no column change.** Three new keys inside the
  existing `activities` jsonb, **two of which** (`skipped` and `game_count`) never reach
  `templates`, and nothing else. **No `sessions.season_id`.**
- `venues`: **unchanged**, which is what keeps `audit_venues()` and its "Venue
  renamed" label true.
- `register_entries`: one added column and nothing else.
- `teams.bib_colour`, `is_bib_colour`: unchanged. `teams` gains `sort_order` and
  nothing else, and the game bib draws on the same closed vocabulary.
- `boards`: unchanged.
- `content_shares` and its RPCs: unchanged. This programme proposes no public
  projection.
- `src/lib/share.ts` and `ShareModal`: unchanged in behaviour. Protected coach to
  coach sharing already ships and is untouched by all of this.
- **Edge Functions: one shared module changes when COACH-2 is implemented**, and
  the previous "every Edge Function: unchanged" claim was false. See
  `05-security-share-boundary.md` for the module, the tests and the deploy
  discipline. No Edge Function is deployed by this documentation pull request.
