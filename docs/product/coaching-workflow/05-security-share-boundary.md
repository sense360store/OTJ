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
  in the programme needing a full security review. It is gone.
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

## 6. What the new columns oblige

Three of the four proposed migrations are ordinary columns that change no policy
and no grant. Two carry an obligation anyway.

**`register_entries.game_bib_colour_override`** names a child's bib for one
session. It is the same class of field as `bib_colour_override`, which is already
on both public-share forbidden-key lists. **It joins both lists when it lands,
not when it is first shared**, together with its camelCase form. A key added to
`FORBIDDEN_ANYWHERE` in `_shared/share.ts` is added to `FORBIDDEN` in
`src/lib/publicShare.ts` in the same change.

**`venues.layout`** is a drawing of a place. It holds no person by allow-list,
and it must also hold no location fix: no address, no postcode, no latitude or
longitude, no map tile URL and no imagery reference, each made unrepresentable by
the check constraint rather than forbidden by convention. `venue` and `venueId`
are already refused by the browser's list; `layout` joins the deny lists when it
lands, on the same rule.

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
   way by its own allow-list.
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
| M1 `teams.sort_order` | Migration review | Any `supabase/migrations/` change. |
| M2 `venues.layout` | Migration review, plus shape-boundary review | A new jsonb shape boundary and a new check constraint. |
| M3 `register_entries.game_bib_colour_override` | Migration review, plus a deny-list update | It names a child's bib. Prove the migration copies nothing from the existing column, in the manner of 0047. |
| M4 `drills.variant_of` | Migration review | Any `supabase/migrations/` change. |
| M5 diagram widening, if motion is ever approved | Migration review, plus rollout review | Version rollout hazard. |
| Everything else | Ordinary PR review | The setup generator, the setup map, the station screen, the game plan UI, the authoring seam and the adaptation journeys touch no security boundary. |

**No item in this programme needs a full security review**, which is a change
from the previous revision and is a direct consequence of withdrawing the
generated message and the public projection. The two parked items that would need
one, a public operational projection and DRILL-02b, are outside it and block
nothing.

**Edge Function deploys: none.** No phase changes a function. If that ever
changes, deploy from files and read the deployed source back byte for byte, never
paste inline (`CLAUDE.md`, Edge Function deploys).
