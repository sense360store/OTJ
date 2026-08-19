# Security, privacy and share boundary

Status: reconciled 18 August 2026. The sharing requirement changed shape in coach
discovery, and it changed towards the safer answer.

Authoritative existing documents, which this one defers to and does not restate
in full: `docs/security/content-sharing-boundary.md`,
`docs/security/registered-players-boundary.md`,
`docs/security/spond-data-boundary.md`, `docs/security/board-data-boundary.md`.

---

## 1. The settled sharing decision

**Target.** Another authorised coach opens the same protected OTJ session and
sees the same plan. On a phone the coach uses the platform Share action to send
the link into WhatsApp, Messages, email or anywhere else. **The share message
carries no player names, no bib assignments and no other child data.** The
receiving coach authenticates in OTJ to see anything operational, and none of it
is exposed through a public or login-free share.

**No WhatsApp specific integration is built.**

## 2. That requirement is already met on `main`

Verified in code, and it is the finding that decides this whole document
(`00-current-state-audit.md` section 24).

`src/lib/share.ts` is the internal club link seam. Its own header states the
contract: an internal club link is a normal protected app URL, the recipient
signs in and must already have club access, the existing Row Level Security stays
the only boundary, and there is **no token, no query-string secret, no temporary
public URL and no anonymous route**. `canonicalUrl('session', id)` builds
`origin + /session-day/:id` and appends nothing.

The share itself feature-detects `navigator.share`, falls back to the clipboard
when the sheet is absent or fails, treats a dismissal as a neutral cancellation,
and returns a deterministic result the caller maps to plain language.
`SHARE_ACCOUNT_NOTE` already tells the coach that the recipient needs an OTJ
account and club access.

The internal arm of `ShareModal` passes
`{ url: canonicalUrl(kind, sourceId), title, text: title }`, and on session day
`title` is `session.name`. **No player name, bib, group, attendance or Spond
field is in the payload, and there is no code path by which one could be**, since
the payload is three strings built from a session name and an id.

**So the remaining work is a check, not a build:**

1. Keep the share reachable from the delivery surface as it is redesigned.
2. Pin the payload with a test asserting it carries no player, bib, group or game
   data. That is cheap and it is the kind of assertion this repository already
   makes about the public snapshot.
3. Never add a per-recipient or per-channel variant. One share, one link.

## 3. The generated message is withdrawn

The previous revision's primary sharing deliverable was a **generated message**,
composed in the browser by an authorised coach, carrying children's first names,
their group and their colour, for the coach to paste into the team's WhatsApp
group. It came with a names-free variant, a first-use warning, a surname-initial
rule and a security review gate.

**It is withdrawn in full.** The settled decision replaces the requirement it
served: the audience is other coaches, not parents, and the mechanism is a
protected link rather than a text containing names.

This is a straightforward improvement to the boundary, and it is worth naming
why rather than just deleting it:

- **Nothing leaves the authenticated product.** The withdrawn design put
  children's first names into a messaging group and then said, honestly, that the
  product could not control what happened next. The settled design puts a URL
  there instead, and the URL discloses nothing on its own.
- **One fewer security-reviewed surface.** The composer was one of only two items
  in the programme needing a full review. It is gone.
- **One fewer place that reads the register.** The composer would have been a
  second reader of tonight's names. There is now exactly one.

**The parent-facing outcome is no longer in this programme's scope.** Telling a
parent which bib their child wears is not part of the settled model, and no
document here should imply it is scheduled. If the club raises it again, the two
candidate answers are recorded in `08-open-questions.md` under withdrawn
questions so the analysis is not redone from scratch.

## 4. Public sharing is untouched, and depends on nothing here

**No phase of this programme reads or writes a share.** Checked per slice: the
team order, the suggested setup, the venue layout, the setup map, the station
detail screen, the game plan, the adaptation work and the authoring seam neither
read nor write `content_shares`, and none of them changes a snapshot builder.

The existing public contract stays exactly as it is
(`00-current-state-audit.md` section 13): a frozen snapshot behind the
service-role-only RPCs, `content_shares` with RLS enabled and no client policy or
grant, the secret in the URL fragment, aggregate fail-closed eligibility, the
England Football lock, and a per-club kill switch defaulting to off.

**The public session projection carries no operational data by construction**,
and this programme proposes no change to that. The server builder never reads
`start_time`, `venue`, `team_id`, `coach_id`, `status`, `spond_event_id` or the
live state, and the browser's `FORBIDDEN` set independently rejects `date`,
`venue`, `venueId`, `teamIds`, `session_teams`, `bibColour`,
`bib_colour_override`, `register_entries`, `present`, `includedInGroups`,
`spondMemberId`, `spond_event_responses`, `rsvp` and `diagram`.

**Widening it is not on this programme's path.** Roadmap item TRAIN-02 owns that
question and keeps it; `07-roadmap-reconciliation.md` records what its stated
payload would actually cost. **DRILL-02b**, whether a coach-drawn diagram may be
published, is likewise held where #189 left it. Neither blocks anything here.

## 5. Children's names: the rule, unchanged and now easier to keep

**No child's name goes on a public URL. Not a first name, not initials, not
"R. Smith".**

- `players.display_name` is the only place the club holds a child's name, its
  select is gated on `players.view`, and parents do not hold it. A public
  projection carrying a name would make available with no login what an
  authenticated parent is refused.
- A URL has no audience. The person who creates it chooses the first recipient
  and nobody chooses the rest. It cannot be un-sent, and a saved or printed copy
  cannot be recalled at all, which the product already says out loud in
  `PRINT_WARNING`.
- Revocation does not undo disclosure. It stops future reads.

With the generated message withdrawn, **no output of this programme contains a
child's name outside the authenticated app at all**.

## 6. What the new structure obliges

Three of the four proposed migrations are ordinary columns that change no policy
and no grant. The fourth is a new table. Three carry an obligation.

**The three activity keys carry none.** `slot` is one of two words, `skipped` is
`true` or absent, and `game_count` is `1` or `2`
(`04-data-model-proposal.md` section 2). None can hold a person, a place or free
text, which is why riding an unconstrained jsonb column is acceptable here and
would not be for a diagram or a layout.

**`register_entries.game_bib_colour_override`** names a child's bib for one
session. It is the same class of field as `bib_colour_override`, which is already
on both public-share forbidden-key lists. **It joins both lists when it lands,
not when it is first shared**, together with its camelCase form. A key added to
`FORBIDDEN_ANYWHERE` in `_shared/share.ts` is added to `FORBIDDEN` in
`src/lib/publicShare.ts` in the same change.

**`venue_layouts`** is a drawing of a place, and it is a new table rather than a
column, so it brings its own policies and grants. They **mirror `venues`
exactly**: club wide select with no capability, because a coach needs to see
where the stations go and the row carries no child data; `club.manage` for
everything else; explicit grants, which is the 0012 lesson.

Its `zones` value holds no person by allow-list, and it must also hold **no
location fix**: no address, no postcode, no latitude or longitude, no map tile
URL and no imagery reference, each made unrepresentable by the check constraint
rather than forbidden by convention. `venue` and `venueId` are already refused by
both deny lists; `zones` and any layout-shaped key join **both** when they land,
on the same rule, because a key kept out of one end and not the other is not kept
out at all.

**Its scope keys are not child data.** `season_id` references `seasons`, which
`0031` states holds no child data at all, and `age_group` is a club label. A
layout row names a place, a season and an age group, and never a person.

**`teams.sort_order`** is a club configuration value about teams, not about
children. No obligation beyond the audit label decision.

**`drills.variant_of`** is a link between two drills. A variant is an ordinary
drill to the share builder, and the England Football lock applies to it exactly as
to its parent: an adaptation of an FA derived drill inherits the source
attribution and the redraw prohibition, and nothing about copying may launder
provenance.

## 7. One canonical operational plan

Principle 5 requires the app, the venue view, the bib plan and any share output to
derive from the same underlying plan. Concretely:

- The night's groups come from `register_entries` plus `teams.bib_colour` through
  `src/lib/bibs.ts` and `tonightGroups`. **One implementation.** The game bib
  resolves through the same module, never in a screen.
- The suggested setup is a pure function producing a draft, using the same rows
  the screen renders and the same `tonightCounts` builder for every number.
- The station list is derived in one place from the plan, never re-derived per
  screen.
- The share output is a URL and a session name. It reads no register at all.
- `tonight.invariant.test.ts` already fails the build on a second implementation
  of the filters or a second count builder. The setup generator and the bib
  resolution join that rule.

## 8. Boundaries this programme must not move

A checklist for every future PR in this programme.

1. **Spond stays read only from OTJ**, authentication aside. Nothing here writes
   toward Spond, and no new Spond field is persisted.
2. **No new child data is stored.** No date of birth, no contact, no photograph,
   no guardian, no address. The one new register column holds a colour from a
   closed vocabulary.
3. **`players.view` remains the gate** on every read that resolves to a child:
   `players`, `player_registrations`, `register_entries`, `player_spond_links`,
   `spond_event_responses`.
4. **Parents never gain a write** and never gain `players.view`.
5. **A drill diagram can hold no person**, enforced by the `0046` check
   constraint. Any widening for motion keeps that property and says so.
6. **A venue layout can hold no person and no location fix**, enforced the same
   way by its own allow-list, and its policies mirror `venues` rather than
   inventing a looser rule.
7. **The public snapshot deny lists stay in step on both sides**, and any new
   column that could name a place or a child joins both when it lands.
8. **Public sharing keeps its reduced projection.** Convenience is never a reason
   to publish authenticated operational data.
9. **The share payload stays a URL and a title.** No operational data is ever
   added to it, however convenient it would be to paste the groups.

## 9. Review gates in this programme

Following `CLAUDE.md`'s review gates, these stop for human review and are not
auto-merged:

| Work | Gate | Why |
|---|---|---|
| A1, A2 and A3: `slot`, `skipped` and `game_count` on an activity | **Ordinary PR review.** No migration. | Three closed-vocabulary keys that can hold no person, place or free text. |
| M1 `teams.sort_order` | Migration review | Any `supabase/migrations/` change. |
| M2 `venue_layouts` | Migration review, plus shape-boundary review, plus a policy and grant review | A new table with new policies and grants, a new jsonb shape boundary, and a new check constraint. The largest review in the programme. |
| M3 `register_entries.game_bib_colour_override` | Migration review, plus a deny-list update | It names a child's bib. Prove the migration copies nothing from the existing column, in the manner of 0047. |
| M4 `drills.variant_of` and `drills.library_listed` | Migration review | Any `supabase/migrations/` change. Both are ordinary columns on `drills`; the listing rule decides what a list shows, never what anyone may read. |
| M5 diagram widening, if motion is ever approved | Migration review, plus rollout review | Version rollout hazard. |
| Everything else | Ordinary PR review | The setup generator, the setup map, the station screen, the game plan UI, the authoring seam and the adaptation journeys touch no security boundary. |

**Each gated migration is registered against the hosted head it will actually run
against**, and none of them assumes or modifies reviewed migration `0050`, which
open draft PR #191 owns (`04-data-model-proposal.md` section 8).

**No item in this programme needs a full RLS or auth review**, which is a change
from the previous revision and is a direct consequence of withdrawing the
generated message and the public projection. **No role is added, no existing
policy is altered, and the authentication boundary does not move.**

**That is not the same as "no policy work", and the gate table above says so.**
M2 creates a table, so it necessarily carries policies and grants of its own, and
the table calls it the largest review in the programme. The two claims are both
true because **M2 introduces no new policy SHAPE**: its policies mirror `venues`
exactly, club wide select with no capability and `club.manage` for everything
else, so the reviewer is checking an instantiation of a pattern already in the
database rather than judging a new access rule. A new table whose policies did
**not** mirror an existing one would be a full RLS review, and there is no such
table here.

The two parked items that would need a full review, a public operational
projection and DRILL-02b, are outside this programme and block nothing.

**Three reviews beyond the ordinary migration gate**, then, and saying "none"
would be untrue now that the survey behind it has been re-derived:

| Item | Review |
|---|---|
| **M2 / COACH-5** | Policy and grant review, against the `venues` pattern it mirrors, plus the jsonb shape boundary |

and two on the content-sharing boundary:

| Item | Why | Scope of the review |
|---|---|---|
| **COACH-2** | Changes `_shared/share.ts`, the module that builds the public snapshot, and requires an Edge deploy under the byte-for-byte readback discipline | The duration change only: that it touches no allow list, publishes no new key, and leaves `buildProgrammeSnapshot` alone |
| **COACH-8** | Adds a child-linked column and puts it on both public-share deny lists | That `game_bib_colour_override` and its camelCase form reach `FORBIDDEN_ANYWHERE` **and** `FORBIDDEN`, in the same change |

Neither is an RLS redesign. Both are the narrow "does a child's data stay out of
the public projection" question this document exists to answer, and both are
cheap precisely because the boundary is already drawn.

## Edge Function deploys: one, at COACH-2

**Corrected 19 August. The previous claim, "Edge Function deploys: none. No phase
changes a function", was false**, and it was false because the survey behind it
looked for session duration in the browser only.

**The module.** `supabase/functions/_shared/share.ts`. `buildSessionSnapshot`
(`:797-806`) accumulates `totalDuration` from the session's activities in its own
`for` loop, in Deno, and cannot import `src/lib/`. It is a fourth independent
implementation of the session duration sum
(`00-current-state-audit.md` section 17), so the stood-down rule reaches it.

**What must change and what must not.** Only the duration accumulation, and only
to skip an activity carrying a `slot` and `skipped: true`. `buildProgrammeSnapshot`
(`:1218-1228`) is a second accumulator in the same file over **week** activities,
and it must not change: a template never carries `skipped`.

**The tests that change with it.** `supabase/functions/_shared/share_test.ts`
(the Deno suite, which asserts `totalDuration`) and `src/lib/publicShare.test.ts`
(the browser validator's suite). Both, because the payload contract has two ends.

**The deploy discipline, from `CLAUDE.md`.** Deploy through Claude Code or the
Supabase CLI **from the files on disk, never by pasting contents inline**: a
deploy carrying a large shared module can be silently truncated or replaced with
a placeholder while still reporting success. Every deploy is verified by reading
the deployed source back **byte for byte** and checking its content, never by
trusting a version number. `share.ts` is exactly the kind of large shared module
that rule was written for.

**Nothing is deployed by this pull request.** This is documentation only.

### What the public snapshot does with a stood-down activity

**Decision: the activity stays in the projected list and contributes zero
duration. `skipped` itself is not published.**

The smallest consistent choice, and it falls out of the existing allow list
rather than needing a new rule. `PublicActivity` is exactly `phase`, `duration`,
`drillRef`, `customTitle`, enforced at both ends: the Deno builder copies only
those, and the browser validator's `ACTIVITY_KEYS`
(`src/lib/publicShare.ts:316`) refuses anything else. So `slot`, `skipped` and
`game_count` are **already** structurally excluded, and publishing `skipped`
would mean widening two allow lists in two runtimes.

There is no consumer for it. A public snapshot is a frozen plan someone was
shown, not an operational surface, and `totalDuration` already tells them how
long the session ran. Excluding the activity from the list entirely was the other
option and is rejected, because it would make the public plan disagree with the
plan the coach shared, for no gain.

**Corrected at implementation: which activity was stood down remains derivable,
and that is accepted rather than claimed otherwise.** An earlier revision of this
section argued that nobody reading a public snapshot needs to know which station
the coach stood down. True, and the chosen projection does not conceal it: the
published activity durations sum to more than `totalDuration`, and the public
page renders both numbers, so a reader who subtracts can usually name the
activity. No projection short of dropping the activity or publishing a duration
the coach did not plan hides that, and both misrepresent the plan that was
shared. The delta is a fact about the coach's own plan and carries no child, no
group, no bib and no attendance, so it is accepted. What the boundary actually
turns on is unchanged: the key itself is not published and neither allow list is
widened.
