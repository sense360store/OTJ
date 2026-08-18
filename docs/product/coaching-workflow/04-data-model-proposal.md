# Data model proposal

Status: proposal, reconciled 18 August 2026. No migration in this document has
been written, numbered or applied.

Everything here follows the repository's existing migration discipline: gated,
reviewed by a human, applied by hand after the live ledger is checked, never
`supabase db push` from a session.

**Numbering.** The highest migration on disk is `0049_spond_team_reconcile.sql`.
`0050_bulk_delete_players.sql` is already claimed by open draft PR #191, so the
first migration of this programme is `0051` at the earliest. **Confirm the next
free number against the hosted ledger before writing one**, never against the
highest file on disk (`CLAUDE.md`, Data model).

---

## 1. Summary of anticipated database change

**Four migrations, three of them a single nullable column.** One further
widening exists only if motion is ever approved.

| # | Change | Table | Slice | Risk |
|---|---|---|---|---|
| M1 | `sort_order integer null` + partial unique index | `teams` | COACH-1 | Low. Null everywhere is today's behaviour. |
| M2 | `layout jsonb null` + shape check constraint | `venues` | COACH-3 | Medium. A new jsonb shape boundary. |
| M3 | `game_bib_colour_override text null` + vocabulary check | `register_entries` | COACH-6 | Low. Copies nothing from the existing column. |
| M4 | `variant_of uuid null` (+ `drills_id_club_unique`) | `drills` | COACH-8 | Low. |
| M5 | diagram element allow-list widening | `drills` | Parked | Medium. Version rollout hazard. |

### What the previous revision proposed and this one deletes

Recorded explicitly, because a deleted proposal that is merely absent tends to
come back.

| Withdrawn | Was | Why it is gone |
|---|---|---|
| `sessions.blocks`, `templates.blocks` | Station and game block metadata as jsonb | Station identity is derived from plan order and the existing `Phase` vocabulary. Nothing else the column carried survives. |
| `activities[].block_id` | Which block an activity belongs to | Same. |
| `activities[].place` | A fraction-coordinate position per station, plus derived area membership | Layouts are venue level and admin owned. Weekly coaches place nothing. |
| `blocks[].start` | The frozen carousel starting-station map | OTJ tracks no live carousel, so there is nothing to freeze. |
| `blocks[].games` | Game sides as sets of bib colours | Replaced by one bib column on the register, which is what a coach actually reads. |
| `sessions.template_id` | Uniform provenance and a sibling link | No consumer in the settled model. Deferred, section 7. |

Six proposed structures became one column, and that column is on a table that
already exists for exactly this purpose.

### The deliberate non-changes

- **No group table and no `group_id`.** The bib colour is the station group's
  identity, unique per session, enforced in the domain rather than in
  persistence, because a group is emergent from per-player bib resolution and
  there is no row a unique index could sit on.
- **No per-player ability score, level or training classification.** A player's
  ability context derives through their team's position in the club order. M1
  stores that order once per team.
- **No per-player game side or game number column.** The side derives from the
  game bib colour (`02-target-product-model.md` section 7).
- **No provenance flag on a register entry.** The setup regeneration rule
  preserves every saved assignment rather than only the manual ones, so it never
  needs to know which were which.
- **No `rotations` or `minutes_per_rotation` field.** Rotations are the station
  count and the rotation length is the members' own duration.
- **No session workflow state column.** Readiness is derived.
- **No drill version table.** Adaptation is a copy.
- **No bib history table.** Section 6 states what is lost and why it is
  affordable now that the two bibs no longer overwrite each other.
- **No new share structure.** Coach to coach sharing already ships
  (`00-current-state-audit.md` section 24).

---

## 2. M1: `teams.sort_order`

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

- **Alphabetical.** For this club that gives Argonauts, Gladiators, Spartans,
  Titans, Trojans, which matches the stated ability order nowhere.
- **`created_at`.** It records when a row was inserted during setup. Reading it
  as a statement about football is the kind of confidently wrong answer this
  codebase refuses elsewhere.
- **An ordered array of team ids on `clubs`.** It would list teams in a second
  place, drift when a team is added or deleted, and need its own repair story.

### What it is, and what it is not

**The club's ordering of its own teams.** Five integers for this club, set by a
`teams.manage` holder on the existing `AdminTeams` screen.

It is **not an ability score** and there is no per-player field of any kind. No
literal team name appears in any rule: the current order is Titans, Trojans,
Gladiators, Spartans, Argonauts, and that is this season's contents of an ordered
set, not an algorithm.

### Nullable, and what null means

Null means unordered. A club that never sets it gets today's behaviour: the
grouping suggestion keeps each team whole and does not claim to know which teams
are adjacent. That is honest, and it fails towards doing less rather than
guessing.

**It will look like a bug if the screen stays silent about it**, so the screen
says the order is unset rather than quietly doing less.

The partial unique index prevents two teams claiming one position while allowing
any number of unordered teams.

### RLS, audit and compatibility

**No new policy.** An ordinary column on `teams`, whose write already takes
`teams.manage` via `teams_manage` (`0012_rbac.sql:376`).

**Audit.** `audit_teams()` (0044) has an allow list, and `describeActivityEvent`
renders `team.updated` as the deliberately general "Team updated"
(`src/lib/activityView.ts:432`), whose comment says it stays general because the
list carries both the name and the bib colour. A third field does not falsify
that sentence. Confirm whether `sort_order` joins the audited allow list; the
default answer is yes, since re-banding the club's teams is worth a feed entry.

**Backwards compatibility.** Null everywhere is every existing team.

**Two orders coexist and must not be confused.** Labels stay alphabetical
(`sessionTeamsLabel`, unchanged); grouping uses the club order. A future reviewer
seeing two sorts should not unify them.

---

## 3. M2: `venues.layout`

```sql
alter table public.venues add column layout jsonb;
```

Stored shape, version 1:

```json
{
  "version": 1,
  "size": { "metres_wide": 60, "metres_long": 40 },
  "layouts": [
    { "kind": "stations", "slots": 4,
      "zones": [
        { "n": 1, "name": "Top corner", "x": 0.02, "y": 0.02, "w": 0.45, "h": 0.45 },
        { "n": 2, "x": 0.53, "y": 0.02, "w": 0.45, "h": 0.45 },
        { "n": 3, "x": 0.02, "y": 0.53, "w": 0.45, "h": 0.45 },
        { "n": 4, "x": 0.53, "y": 0.53, "w": 0.45, "h": 0.45 }
      ] },
    { "kind": "stations", "slots": 5, "zones": [] },
    { "kind": "games", "slots": 1, "zones": [] },
    { "kind": "games", "slots": 2, "zones": [] }
  ]
}
```

### One column rather than a table, and why

A `venue_layouts` table was considered. It would give each layout its own row and
its own constraints, and it would carry scope columns naturally.

**A column wins on the argument this repository makes repeatedly.** `layout` is
an ordinary column on `venues`, whose select is club wide and whose write takes
`club.manage`, so drawing a layout is already exactly as restricted as renaming
the venue with **no new policy, no new grant and no new audit function**. That is
the reasoning `0046` used for `diagram` and `0044` used for `bib_colour`. A new
table would add four policies and a grant decision to a gated migration for four
rows per venue that one admin edits occasionally.

The set is closed and small: two station layouts and two game layouts per venue.
Concurrent edits of two layouts at one venue are not a real hazard at this club.

### The rules it inherits, deliberately

This is the third fraction-coordinate jsonb column in the product, after
`boards.tokens` (0028) and `drills.diagram` (0046). It inherits their discipline
rather than inventing a third:

- **Fractions 0 to 1, never metres, for position.** The declared real-world size
  is metadata for labelling and proportion, not the coordinate space. One stored
  layout then renders at any width.
- **Versioned**, with the same rule the diagram uses: an unrecognised version
  yields no layout rather than a mis-drawn one.
- **A check constraint stating the key allow-list**, so the shape holds against
  service_role and any hand-written call, exactly as 0046 does. `kind` is closed
  to `stations` and `games`; `slots` is closed to 4 and 5 for stations and 1 and
  2 for games.
- **A parser and a serialiser that rebuild field by field and never spread**, in
  a new `src/lib/venueLayout.ts` sharing `clampFraction` with the others.
- **Bounds**: at most one layout per `(kind, slots)`, a zone count matching
  `slots`, a name length cap, and a minimum zone size so a zone cannot become an
  ungrabbable sliver.

### What it must never hold

No person, no address, no postcode, no latitude or longitude, no map tile URL and
no imagery reference. The allow-list makes each unrepresentable rather than
forbidden by convention.

Geolocation is excluded explicitly: it is not needed to say "Station 1 goes
here", it introduces a third-party mapping dependency and a new privacy surface,
and the settled decision says a clean schematic rather than aerial imagery.

### RLS and audit

**No new policy**, as argued above.

**Audit, and do not miss this.** `audit_venues()` (0044) currently treats an
update as a rename, and `describeActivityEvent` renders `venue.updated` as
**"Venue renamed"** (`src/lib/activityView.ts:438`), reasoning that the allow
list is the name alone. **That sentence becomes false once a layout can change.**
Either the audit allow list gains `layout` and the label becomes "Venue updated",
or the label and its comment are corrected. This is exactly the kind of quiet
falsehood the repository's commentary style exists to catch.

### Backwards compatibility and rollback

Null layout is every existing venue and reads as no layout, which every surface
renders as nothing.

Rollback drops the constraint, then the column. **Dropping the column discards
every saved layout**, so drop the constraint alone unless the feature is being
withdrawn. This is the wording `0046` uses and the same reasoning applies.

---

## 4. M3: `register_entries.game_bib_colour_override`

```sql
alter table public.register_entries add column game_bib_colour_override text
  check (game_bib_colour_override is null
         or game_bib_colour_override = 'none'
         or public.is_bib_colour(game_bib_colour_override));
```

### Why a second column is the honest answer

**Today** the table holds one row per `(session_id, player_id)` with a single
`bib_colour_override`, written through `upsert(..., { onConflict:
'session_id,player_id' })`, so a second bib for the same player in the same
session replaces the first (`00-current-state-audit.md` section 21).

The settled model needs both at once: the station bib plan must survive the games
being planned with different bibs, some players are re-bibbed for the games, each
game should ideally show two clearly distinguishable colours, and the game plan
names each player's side and colour beside the station groups.

One column cannot hold two independent values.

**This is the same defect 0047 already fixed once**, and the precedent is
directly on this table: `present` carried both attendance and inclusion, a coach
who split fourteen of the eighteen who came had four children recorded absent,
and the answer was a second column that copies nothing from the first. The
migration shape follows 0047 exactly.

**The previous revision rejected a phase-specific bib column**, on the grounds
that it hard codes two phases into a schema whose point was that the number of
blocks is a planning decision. That objection dies with the blocks. There are
exactly two arrangements per night, and the game bib is a fact a coach reads off
a screen rather than a phase of a general mechanism.

### Resolution

```
station bib = station override, else the team default, else none
game bib    = game override,    else the effective station bib
```

The second line is the physical truth: bibs are handed out only to the children
who change. `src/lib/bibs.ts` owns both rules and no screen resolves a bib
itself, which is the rule that already holds for the first line.

`'none'` keeps its existing meaning of a deliberate no bib, distinct from
inheriting.

### What it copies, and what it must not

**It copies nothing, in either direction, ever.** The migration writes no row.
Like 0047 it must state that in its header and prove it in its self-verification:
fingerprint the existing `bib_colour_override` values before and after and show
they are byte for byte unchanged.

**Rows written before this column existed** carry a station bib and no game bib,
which resolves to "they play in what they are wearing". That is the correct
reading of history and needs no backfill.

### RLS, grants, audit

**No new policy and no new grant.** The four 0044 policies on `register_entries`
name no column and the grants are table wide, which is what let 0047 add a column
without touching a policy. The same self-verification should prove it.

**Unaudited, deliberately.** 0044's self-verification raises an exception if a
per-tick audit trigger is ever attached to this table, and that decision stands:
the row is the record and a bib change is a high frequency operational touch.
`register_entries_touch` continues to stamp `marked_by` and `marked_at`.

### The write path

`REGISTER_COLUMNS` and `useSaveTonight` gain the column, and **a save continues to
send only the columns that changed**, so two coaches editing different facts about
one child cannot overwrite each other. That rule already exists for `present` and
`included_in_groups` and it now covers three independent bib-adjacent facts
rather than two.

### Deny lists

The column names a child's bib and must join both public-share forbidden-key
lists **when it lands, not when it is first shared**
(`05-security-share-boundary.md` section 6). `bib_colour_override` is already on
both.

---

## 5. M4: `drills.variant_of`

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
**`drills` does not**. So M4 opens with

```sql
alter table public.drills add constraint drills_id_club_unique unique (id, club_id);
```

guarded by the `if not exists` block 0044 used for `sessions_id_club_unique`
(`0044_training_day_core.sql:69`), because a migration partly applied by hand
must be re-runnable.

**Why club-scoped composite at all.** The pattern 0044 established, and for the
reason 0044 states: a bare `on delete set null` on a composite foreign key nulls
every referencing column including `club_id`, which then fails its not-null
constraint and makes the parent undeletable. The column list on `set null` is
load bearing.

**`on delete set null`, not cascade.** Deleting the original must never delete
the adaptations, because an adaptation is what a session actually ran. It becomes
an ordinary drill, which is also exactly what "Save as reusable drill" produces,
so the two paths agree.

**The display rule, which is not schema.** A drill with `variant_of` set is not
listed in the library. It is reachable from the session that owns it and from its
parent's detail page. That keeps session-only adaptations out of the library
without an access rule, so it needs no policy work.

**RLS: no new policy.** An ordinary column on `drills`; the four live policies
already cover every column, so writing a variant link is exactly as restricted as
renaming the drill. This is the reasoning `0046` used for `diagram`.

**Audit.** `audit_drills()` (0037) records an update only when corner, level or
duration changed. Setting `variant_of` happens at insert, which already emits
`drill.created`. No audit change.

**Rollback.** Drop the constraint and the column. Adaptations survive as ordinary
drills and become visible in the library, which should be stated in the PR.

---

## 6. What is not stored, and what that costs

### A child's earlier bib within one session

The two bib columns mean the **station bib survives the games being planned**,
which is the requirement. What is still not recoverable is a change **within**
one of them: re-bib a child from red to blue for the carousel and the red is
gone, because the column is a scalar, `register_entries_touch` overwrites
`marked_by` and `marked_at`, and 0044 refuses a per-tick audit trigger outright.

**That is accepted, and it costs less than it did.** The case that made it
uncomfortable was the carousel colour being destroyed by a game re-bib, and the
second column removes it entirely. What remains is a coach correcting their own
station grouping before training, where the previous value is not a fact anyone
asks for.

**What would reverse the decision**, recorded so it is not rediscovered: a
post-session record of what each child actually did, per-child development
tracking across sessions, or a safeguarding-shaped dispute about who was where.
None is on the roadmap. If one arrives, the smallest answer is an append-only
record of bib changes for a session, one narrow table that does not touch the
operational read path. It is a shape, not scheduled work.

### Live rotation progress

Not stored, because it is not tracked. There is nothing to lose.

### Which drill sat out at a four station delivery

If a coach removes the fifth activity from the dated session, the session records
four activities and the week plan still records five, so the plan is intact and
the session is honest. If instead a marker is used, the fifth activity stays with
a marker on it. **Unresolved** which of the two is the right gesture
(`08-open-questions.md`, D2); neither needs a migration.

---

## 7. Deferred: `sessions.template_id`

Recorded so the reasoning is not rediscovered.

It would give a session uniform provenance (today only a programme-applied
session records where it came from) and make two deliveries of one plan visible
as siblings. **It is not proposed**, because the promote and multi-date journeys
are copies that work without it, nothing in the settled model asks for a sibling
display, and an unread column invites a wrong reading later.

**The trigger that would revive it**: a request to see "also delivered Saturday"
on a session, or a request to apply one edit to both deliveries. Either makes the
link a consumer-backed fact rather than a tidy idea.

---

## 8. What is not touched anywhere in this programme

Stated so a future session does not go looking:

- `players`, `player_registrations`, `seasons`: unchanged.
- `player_spond_links`, `spond_event_responses`, `spond_events`, `spond_groups`:
  unchanged, read only, and Spond stays read-only from OTJ.
- `sessions` and `templates`: **unchanged.** No `blocks`, no `template_id`, and
  no new key inside `activities` unless the derived station list proves
  insufficient, which would be a client allow-list change and not a migration.
- `register_entries`: one added column and nothing else. The three-facts model of
  0044 plus 0047 is correct and is extended, not reinterpreted.
- `teams.bib_colour`, `is_bib_colour`: unchanged. `teams` gains `sort_order` and
  nothing else, and the game bib draws on the same closed vocabulary.
- `boards`: unchanged. A tactics board seats a team; a drill diagram is an
  exercise; a venue layout is a place. Three things, three columns, one shared
  coordinate discipline.
- `content_shares` and its RPCs: unchanged. This programme proposes no public
  projection.
- `src/lib/share.ts` and `ShareModal`: unchanged in behaviour. Coach to coach
  sharing already works.
- Every Edge Function: unchanged.

---

## 9. Ordering constraints between migrations

- M1, M2, M3 and M4 are independent of each other and of everything else.
- M1 should precede the grouping suggestion, which needs the team order to
  combine adjacent bands. It is not a hard blocker: with `sort_order` null the
  suggestion keeps each team whole and says the order is unset.
- M2 must precede the setup map, because there is no layout to load without it.
- M3 must precede the game plan.
- M4 must precede adaptation.
- M5, if it ever happens, is last and depends on nothing.

**Apply order relative to the frontend**, following the rule `0046` had to learn:
each of these columns is new and null everywhere, so **the migration goes first
and the frontend second**. A frontend reading a column the database lacks gets
PostgREST 42703 and the read fails; a database with an unread new column changes
nothing for anybody.

**None of these changes a policy, a grant or a public projection**, with the two
audit-label decisions in M1 and M2 as the only adjacent work.
