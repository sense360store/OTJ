# Security, privacy and share-boundary analysis

Status: proposal, awaiting approval and a separate security review before any
sharing work starts.

This document answers the sharing question the discovery asks, and it answers it
by inspecting the existing architecture first, as instructed. Where it recommends
against something, the reason is stated rather than asserted.

Authoritative existing documents, which this one defers to and does not restate
in full: `docs/security/content-sharing-boundary.md`,
`docs/security/registered-players-boundary.md`,
`docs/security/spond-data-boundary.md`, `docs/security/board-data-boundary.md`.

---

## 1. What the existing public share contract actually is

From `00-current-state-audit.md` section 13, verified in code:

- A share is a **frozen snapshot** stored in `content_shares.snapshot`, built
  server side by `supabase/functions/_shared/share.ts` and read through the
  service-role-only `read_public_share` RPC.
- `content_shares` has **RLS enabled with no client policy and no client grant**.
  No authenticated user, not even a `shares.manage` holder, can read the table.
- The URL is `/share/:shareId#secret`. Only a SHA-256 hash is stored; the secret
  lives in the fragment so it never reaches a request line or a log.
- Three kinds exist: drill, session, programme. One active share per source.
- Eligibility is **aggregate fail closed**: one restricted, missing or cross-club
  dependency blocks the whole share.
- Rights are three levels with an England Football lock the database enforces
  (`0043`).
- A per-club kill switch defaults to off.

## 2. The public session projection carries no operational data, by construction

This is the finding that decides the whole sharing question, so it is worth
stating precisely.

The server builder's `SessionRow` interface names the columns it reads, and its
own comment names the ones it never reads: `start_time`, `venue`, `team_id`,
`coach_id`, `status`, `spond_event_id` and the live state. Independently, the
browser's `FORBIDDEN` set (`src/lib/publicShare.ts:247`) rejects, anywhere at any
depth in a snapshot:

`date`, `venue`, `venue_id`, `venueId`, `team_id`, `teamId`, `teamIds`,
`session_teams`, `sessionTeams`, `bib_colour`, `bibColour`,
`bib_colour_override`, `bibColourOverride`, `register_entries`,
`registerEntries`, `present`, `included_in_groups`, `includedInGroups`,
`marked_by`, `marked_at`, `player_id`, `playerId`, `spond_member_id`,
`spondMemberId`, `player_spond_links`, `spond_event_responses`, `rsvp`,
`rsvpStatus`, `matched_by`, and `diagram`.

So **every single field a group and bib plan is made of is on a deny list that is
enforced twice, once on the server and once in the browser.** A shared tactics
board already strips `playerId` entirely and resolves no name (`0028`).

**Conclusion: the current public-session sharing contract cannot be widened to
carry a group and bib plan.** Doing so would mean deleting entries from a deny
list that exists because those entries name children. Any operational share is a
new, separately reviewed projection, with its own builder, its own allow-list and
its own security review. Roadmap item TRAIN-02 already says this and it is
correct.

## 3. What may safely be shared publicly

Working from the smallest thing that is useful outward.

| Field | Public? | Reasoning |
|---|---|---|
| Session name, focus, intentions | Yes | Already public today for a shared session. |
| Activity list, phases, durations | Yes | Already public today. |
| Drill text, coaching points, setup notes | Yes, subject to rights | Already public today, gated by `rights` and the FA lock. |
| Drill diagram | **Decision needed** | Not published today. Section 5. |
| Date and start time | **Widening**, needs review | Not public today. TRAIN-02 proposes it. Section 4. |
| Venue name | **Widening**, needs review | Not public today. Names a place children gather. |
| Venue layout, station placement | Probably, with the venue named | Same class as venue name. |
| Number of groups, group colours | Probably | A count and a colour name no one. |
| Group sizes | Probably | A number. |
| **Any child's name** | **No** | Section 6. |
| Shirt number, team of a named child | **No** | Identifies a child by another route. |
| Attendance, presence, inclusion | **No** | Says which child is where and when. |
| Spond figures, member ids, replies | **No** | `docs/security/spond-data-boundary.md`. |

## 4. Date, time and venue: a real widening, not a formality

TRAIN-02's stated payload is "name, date, time, venue, plan". Three of those five
are new to the public surface, and combined they are a different statement from
anything the product publishes today.

A drill snapshot says "here is an exercise". A session snapshot says "here is a
plan". A session snapshot with date, time and venue says **"a group of children
will be at this place at this time"**, on a URL with no login that anyone who
receives it can forward, and which a search engine will index if it is ever
posted anywhere public.

That is not a reason to refuse it. The club already publishes fixture times, and
a parent needs to know where to go. It is a reason to make it an **explicit,
separately confirmed decision** rather than three more fields on an existing
payload, and to attach controls proportionate to it:

- **Opt in per share**, never inherited from the session's `rights` class.
  Publishing a plan and publishing a place and time are two different intentions.
- **A short default expiry.** A session share carrying a date is useless the day
  after and should stop working. The existing `expires_at` supports this; the
  default for this kind should be days, not the current ninety.
- **The confirmation text says what it is**, in the manner of the existing
  `PUBLISH_CONFIRM`: anyone you send this to can open it, can pass it on, and it
  names where and when the children will be.

Recorded as `08-open-questions.md`, Q1. It is a club decision, not an engineering
one.

## 5. Should a drill diagram be publishable?

`diagram` is on the forbidden list today, and `0046` says C1 does not publish one.

The arguments for publishing: it is the club's own drawing, it carries no person
by construction and by check constraint, and a shared session plan without its
pictures is much less useful.

The argument against, and it is the one that decides it: the diagram is only ever
safe to publish if the **whole element allow-list** is safe to publish, and the
publish path must therefore have its own projection of the diagram rather than
passing the stored jsonb through. A `text` element can hold twenty-four
characters of anything a coach typed, and a `player` label can hold three. A
child's initials fit in three characters.

**Recommendation: publish the diagram, through a builder that rebuilds each
element from its own allow-list** exactly as the drill text fields already are,
and add the same rights warning about free text that `RIGHTS_WARNING` already
carries. The existing warning already tells coaches to remove any child's name
from notes and captions; the diagram's labels join that list.

This is a genuinely useful widening and a small one. It is separate from section
4 and can be decided separately.

## 6. Children's names: the decision, and the recommended alternative

**No child's name goes on a public URL. Not first name, not initials, not "R.
Smith".**

The reasoning, in the terms this repository already uses:

- `players.display_name` is the only place the club holds a child's name, its
  select is gated on `players.view`, and parents do not hold it. A public
  projection carrying a name would make available with no login what an
  authenticated parent is refused.
- A URL has no audience. The person who creates it chooses the first recipient
  and nobody chooses the rest. It cannot be un-sent, and a saved or printed copy
  cannot be recalled at all, which the product already says out loud in
  `PRINT_WARNING`.
- Revocation does not undo disclosure. It stops future reads.

### The alternative that meets the actual requirement

The requirement is: *a parent can be told which bib or group their child is in
before they arrive*. It is not: *a page exists on the internet listing the
children*.

**Recommendation: a generated message, composed in the browser by an authorised
coach, and sent by that coach into the channel the club already uses.**

Why this is materially safer rather than merely different:

1. **Nothing is published.** No URL is minted, no snapshot is stored, no service
   answers anonymously. There is no artefact to leak, index, forward beyond a
   known group, or forget to revoke.
2. **The audience is chosen by a human, and it is a group that already exists.**
   The team's WhatsApp group already contains these parents and, in practice,
   already contains their children's names.
3. **The composer needs no new permission and no new read path.** A coach
   pressing it already holds `players.view` and is already looking at the names on
   screen. The text is a formatting of data already in the browser.
4. **It cannot drift from the app**, because it is generated from the same draft
   the groups screen holds, by one pure function, tested like every other pure
   rule in this codebase.

The honest residual, stated rather than hidden: once sent, the club has put
children's first names into a messaging group, and the product cannot control
what happens next. That is the club's existing practice and its own decision. The
product's job is to make it deliberate:

- **First names only by default**, with a surname initial only if two children in
  the session share a first name.
- **No shirt numbers, no teams, no attendance and no Spond anything** in the
  generated text. Group, colour, and where to be.
- **One warning the first time**, in the manner of `RIGHTS_WARNING`: this leaves
  the app and cannot be recalled.
- **A names-free variant offered beside it** ("Reds 6, Blues 6, Greens 5,
  Yellows 5, meet at Flushdyke 6pm"), because some coaches will prefer it and it
  is one line of code.
- It is an **explicit press**, never automatic, never on save, and never
  scheduled.

### What about parents inside the app?

There is a third option worth naming because it is the only one that shows a
parent their own child's group with no disclosure to anyone else: the parent role
already exists, parents already sign in, and `src/routes/ParentHome.tsx` already
exists as their dashboard.

Showing a signed-in parent their own child's group would require binding a
`profiles` row to a `players` row, which the product deliberately does not do
today (`players` has no link to an auth user, stated in `src/lib/data.ts:47`).
That is a significant new identity boundary and a much larger piece of work than
this programme. It is the *right* long-term answer and it is explicitly out of
scope here. Recorded as `08-open-questions.md`, Q2.

## 7. One canonical operational plan

Principle 4 requires the app, the venue view, the bib plan and any share output to
derive from the same underlying plan.

Concretely, for this programme:

- The night's groups come from `register_entries` plus `teams.bib_colour` through
  `src/lib/bibs.ts` and `tonightGroups`. **One implementation.**
- The generated message is a pure function taking the same `TonightRow[]` and
  `TonightDraft` the screen renders. It counts nothing itself, exactly as
  `tonightCounts` is the only count builder today.
- Any public projection is built server side from the session row, as every
  existing snapshot is. It never reads the register.
- `tonight.invariant.test.ts` already fails the build on a second implementation
  of the filters or a second count builder. The share composer joins that rule.

## 8. Boundaries this programme must not move

Restated as a checklist for every future PR in this programme.

1. **Spond stays read only from OTJ**, authentication aside. Nothing here writes
   toward Spond, and no new Spond field is persisted.
2. **No new child data is stored.** No date of birth, no contact, no photograph,
   no guardian, no address.
3. **`players.view` remains the gate** on every read that resolves to a child:
   `players`, `player_registrations`, `register_entries`,
   `player_spond_links`, `spond_event_responses`.
4. **Parents never gain a write** and never gain `players.view`.
5. **A drill diagram can hold no person**, enforced by the `0046` check
   constraint. Any widening for motion keeps that property, and the migration
   says so.
6. **A venue layout can hold no person and no location fix**, enforced the same
   way by its own allow-list.
7. **The public snapshot deny lists stay in step on both sides.** A key added to
   `FORBIDDEN_ANYWHERE` in `_shared/share.ts` is added to `FORBIDDEN` in
   `src/lib/publicShare.ts` in the same change, and any new column from
   `04-data-model-proposal.md` that could name a place or a child is added to
   both when it lands, not when it is first shared.
8. **Public sharing keeps its reduced projection.** Roadmap rule 8. Convenience
   is never a reason to publish authenticated operational data.

## 9. Security review gates in this programme

Following `CLAUDE.md`'s review gates, these are the PRs that stop for human
review and are not auto-merged:

| Work | Gate | Why |
|---|---|---|
| M1 `drills.variant_of` | Migration review | Any `supabase/migrations/` change. |
| M2 `sessions.template_id` | Migration review | Same. |
| M3 blocks | Migration review | Same. |
| M4 `venues.layout` | Migration review, plus shape-boundary review | A new jsonb shape boundary and a new check constraint. |
| M5 diagram widening | Migration review, plus rollout review | Version rollout hazard. |
| Generated message composer | Security review | It renders children's names into text a human will send. |
| Any public projection widening | **Full security review**, separately | Sections 4, 5 and 6. |
| Edge Function deploy for a new projection | Deploy from files, read the source back byte for byte | `CLAUDE.md`, Edge Function deploys. |

Nothing else in the programme touches the security boundary. Drill authoring,
the station block, the planner journeys, the venue composer's client half and the
training-day view are ordinary product work with a PR review.
