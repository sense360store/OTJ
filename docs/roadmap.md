# Roadmap

The forward plan, in priority order, with acceptance criteria. CLAUDE.md's
build order is a status reflection of what has shipped; this file is where
agreed future work is captured before it is built. Each item ships as its
own PR (or PR series), never folded into unrelated work.

## 1. Training day at a glance (item A)

One authorised coach view that answers "who is coming tonight and what is
each of them wearing" in a single look, composed from data that already
exists: the session's register entries, the Spond reply context, and the
effective bib rule in `src/lib/bibs.ts`.

Acceptance criteria:

- A coach holding `players.view` opens one surface for a session and sees
  every included player with their resolved bib colour (override, else
  team default, else none), grouped the way Players &amp; groups groups them.
- The view is read only: nothing on it writes, so it can be glanced at on
  a phone at the gate without risk of a stray tap editing the night.
- Spond reply context renders beside players exactly as Players &amp; groups
  renders it, through the same `tonightCounts` populations; no new count
  builder and no aggregate figure on any per player surface.
- Works with nothing configured beyond a player list, the Tonight rule.
- Parents never reach it; the role gate is tested at the screen level.

## 2. Spond event location seeds the session venue (item E)

`spond_events.location` is synced today but dropped at the client read
boundary (`SPOND_EVENT_COLS` never selects it), so Plan from Spond creates
sessions with no venue. Investigated on 2026-08-15 against production:
exact case insensitive equality matches zero of the nine distinct stored
locations, because Spond stores "feature, address" display strings; the
defensible deterministic rule is case insensitive whole word containment
of the venue name in the location string, accepted only when exactly one
venue matches. On production data that rule has zero false positives and
zero ambiguity, and would have seeded 7 of 14 events (3 of the 8 linked
sessions currently missing a venue). One production session proves human
choice can disagree with the event location, so the match may only ever
seed a new draft.

Acceptance criteria:

- `location` joins the client `SpondEvent` shape (an event fact, like
  `title`; the children's data boundary is unaffected and the select list
  comment beside it is reworded to keep saying so).
- A pure `matchVenueByLocation(location, venues)`: exactly one whole word
  case insensitive venue name match returns that venue id; zero or two or
  more return null; no regex built from user text.
- Plan from Spond seeds `venueId` on the new session draft only. No match
  leaves the venue unset. The frozen free text `sessions.venue` is never
  written. Linking an event to an existing session changes no venue, and
  no existing row is backfilled by a page render.
- Tests pin the two production positives, the seven negatives, the
  ambiguity refusal and the substring non match ("Wood" never matches
  "Woodkirk"). No migration.

## 3. Public training day share (item B)

A no login page for a session's training day view, for parents and
helpers who are not members. Reuses the existing public share security
boundary (`manage-content-share` / `read-content-share`) and nothing
else; a link is minted by an authorised member, expires, and is revocable
like every existing share.

Acceptance criteria:

- The public page exposes session facts only: name, date, time, venue,
  and the plan. No player name, no register entry, no bib, no Spond
  figure, no member id reaches the public payload; a test asserts the
  serialised response against that list.
- The share is minted and revoked through the existing share tables and
  capabilities; no new auth surface and no new token scheme.
- A separate security review before merge, as for every share boundary
  change. This item does not start until item 1 exists, because it shares
  the composed view item 1 builds.

## 4. Registered players bulk delete (item D)

Season turnover needs removing many registrations at once. Destructive,
so it ships as its own reviewed feature, never beside other work.

Acceptance criteria:

- Selection first: an explicit multi select with a count, never "all by
  default"; a dependency preview names what each deletion touches
  (register entries, Spond links and their cascaded replies, board
  tokens) before anything runs.
- Explicit confirmation naming the number being deleted; one transaction,
  so a partial failure deletes nobody.
- Session history is never silently destroyed: a registration whose
  removal would orphan register entries is surfaced in the preview, and
  the chosen semantics (keep the rows, or refuse) are stated on screen.
- Audit events per run; concurrency tests for two admins deleting
  overlapping selections; RLS review gated as for every destructive
  migration or policy change.

## 5. Venue and session pitch composer (item C)

A composer showing drill setup across a venue's pitches and areas.
Largest item, and it depends on confirming the later Drill Maker and
venue composer direction before any build starts. Captured, not
specified: acceptance criteria are written when that direction is
confirmed, not before. Do not implement ahead of that decision.
