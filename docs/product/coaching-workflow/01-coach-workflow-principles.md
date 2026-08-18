# Coach workflow and product principles

Status: reference, reconciled 18 August 2026 after the completed coach
discovery. Supersedes the August 17 capture wherever the two disagree.

This document records how training is actually planned and delivered, and the
principles that follow. It is the "why" behind every later document.

Three labels are used throughout this document set and mean exactly one thing
each:

- **Today** is current repository behaviour, verified against `main` at
  `afe790d`. `00-current-state-audit.md` carries the evidence.
- **Target** is approved product behaviour from coach discovery. None of it is
  built.
- **Unresolved** is a question discovery did not answer. Every one is named in
  `08-open-questions.md` and none is hidden inside a target statement.

---

## 1. The outcome the whole programme serves

> A coach should be able to plan training weeks ahead, refine it when Spond
> attendance becomes known, and then every coach should arrive at the venue with
> enough information on their phone to understand the groups, bibs, overall pitch
> setup, individual drill setup and drill objectives without requiring a verbal
> briefing from another coach.

The measurable effect is a reduction in the explaining and coordinating that
happens in the first fifteen minutes on the grass.

## 2. The core product philosophy, and what it rules out

**Target. OTJ is a prepared training plan and a visual guide. It is not a live
administrative system that coaches keep synchronised while they are coaching.**

Once training starts, small operational changes are handled physically on the
pitch and are not recorded:

- A child arrives late. The coach puts them into an existing group. OTJ is not
  updated.
- A coach does not turn up. The other coaches cover between them. OTJ does not
  redesign the session.
- A game changes shape at the last minute. The coach adapts on the grass. Nothing
  is persisted.

This single decision removes more architecture than every other decision in the
programme combined. Anything that exists only so that OTJ stays accurate against
a pitch that is currently moving is out of scope: live rotation progress, a
frozen station assignment that must not move while a carousel runs, machinery for
a bib colour disappearing and reappearing mid-session, and per-tick persistence
of physical changes. `06-phased-plan.md` section 2 lists what was removed and
where each mechanism used to live.

**What the product owes the coach instead** is that the prepared plan is correct,
complete and legible before they leave the house, and that it is still readable
in one hand at a wet venue.

## 3. How training is actually planned

**Long range, by theme.** Coaches think in blocks of several weeks. A programme
is a football development theme. The theme persists; the drills do not. Each week
has its own objective, decided first, and the drills are chosen or created to
serve it.

**One plan, often two deliveries.** The same core session runs twice in a week,
Tuesday and Saturday, with minor tweaks. The second delivery is the same plan,
not a new one.

**Coaches stay with their group.** A coach rotates with their own players between
stations. Coaches are not assigned permanently to a station, and the exceptions
that happen on the night are not modelled.

## 4. A week is four or five stations, and never three

**Target, and it is a closed set in v1.** A session supports exactly **four** or
**five** stations. OTJ never recommends three.

The reasoning is the clock:

| Stations | Minutes per drill | Verdict |
|---|---|---|
| 5 | about 10 | Works well |
| 4 | about 10 to 12 | Works well |
| 3 | about 15 | Too long for one drill |

**The station count follows attendance, not coach availability:**

- **24 or more confirmed attending: recommend 5 stations and 5 groups.**
- **Fewer than 24 confirmed attending: recommend 4 stations and 4 groups.**
- The coach may override either way.

**Fewer groups than stations is a normal night.** A station simply starts empty,
and every active group still rotates through every planned station. Nothing drops
a drill and nothing shortens the carousel.

**A plan holding five drills delivered as four stations is the coach's choice,
never OTJ's.** The recommendation names the count; which drill sits out is
decided by a person. No planned drill is deleted to satisfy an arithmetic
recommendation.

## 5. How drills actually get created

The coach usually already knows the drill. It exists in their head, on paper, in
a PDF, or already in OTJ. **The problem is not discovery. It is getting a known
drill into a useful electronic form.**

**The visual is the drill.** Text is the supporting material. A drill with no
picture does not answer the question a coach asks at the venue.

**Motion is an enhancement, never a requirement.** A simple drill must stay fast
to create.

### Session-first creation, and adaptation that stays put

A coach creates a drill because the session they are planning right now needs it.
Once created it should be reusable, and reuse has two meanings:

- **Use as-is.** The drill runs again unchanged.
- **Adapt for one dated session.** Any property might change.

**Target.** A session adaptation is independent. Changing Saturday's adaptation
must not change Tuesday's session and must not change the original reusable
library drill. Coaches are never shown version numbers, v1 and v2 and the rest.

**Target.** If a coach chooses **Save as reusable drill**, that creates a **new**
library drill. A session adaptation never overwrites the original in v1.

**Target.** Session-only adaptations do not clutter the normal drill library. A
library that fills with "Passing square (Saturday)" is a library nobody browses.

## 6. Planning and operational preparation are different stages

**Planning layer**, weeks or months ahead, with attendance unknown:

- the programme theme
- the week's objective
- the drills
- the session structure

**Operational layer**, about 24 to 48 hours before, once Spond replies mean
something:

- how many are confirmed attending
- the recommended station count and group count
- who is in which group, and the bib colour of each group
- how many games, and who is on each side wearing what
- the venue setup that will be loaded for the night

**What the operational layer does not change: the planned drills.** Attendance
changes group sizes, the number of groups and how many stations are occupied. It
never drops a drill, shortens the carousel or rewrites the session.

**Spond must never gate planning.** A programme planned in June for September
cannot wait for RSVPs, and a Spond failure on the night renders as no context,
never as "nobody is coming".

## 7. Attendance, and what counts as attending

**Target.** For operational planning there are three meaningful states:

| State | Counts as attending |
|---|---|
| Yes | Yes |
| No | No |
| Unanswered | No |

**Only Yes counts.** Unanswered is treated as not attending, and an unanswered
child receives no bib, no group and no game assignment. If one of them turns up
anyway, the coach handles it on the pitch.

**Today** the mirror holds four Spond reply states, `accepted`, `declined`,
`unanswered` and `waiting` (`00-current-state-audit.md` section 10). `waiting` is
Spond's waiting list and is not a Yes, so the generator treats it as not
attending. It stays visible on the Everyone view, which is where a coach looks
when they want the whole squad rather than tonight's.

**This changes nothing about what the coach may record.** `present` and
`included_in_groups` remain the coach's own facts. Going and not included,
declined and included, and no reply and included are all valid and all storable.
The generator seeds from Yes; it does not constrain.

**A club with no Spond configuration still gets the whole surface**, with the
coach ticking people in by hand. That rule is unchanged and is not negotiable.

## 8. Groups, bibs and rotation

**The bib colour is the group's name.** It is how a coach and a child identify a
group in one glance across a pitch, and two active groups never share one.

**Target. Station bibs use the active bib colours in a deterministic fixed colour
order, assigned sequentially to Station 1, Station 2 and so on.** The first
active colour is group 1 and starts at station 1, the second is group 2 and
starts at station 2, and so on. Nothing about that is configurable and nothing
about it is stored: it is read off the saved group setup every time the screen
renders.

There is deliberately **no permanent global colour to station mapping**. The
order is over the colours actually in use for this session, not a claim that red
is forever station 1.

**Target. OTJ generates the first suggested setup automatically from the
confirmed attendance.** The coach edits it and saves it. Nothing persists until
they save, which is the existing Players and groups rule.

**Target. When attendance changes before training, the coach's work is
preserved:**

- keep the manual choices already saved, wherever practical
- remove children who are no longer attending
- add newly confirmed children sensibly
- rebalance only where it is necessary
- never wipe the saved setup and regenerate by default

A deliberate Reset or Rebuild action may regenerate from scratch, and that is a
later addition rather than the default behaviour.

**The durable player and team information stays separate from tonight's
operational grouping.** Moving a child for one night changes nothing durable:
their Spond team, their OTJ team and next week's default are untouched.

**Ability comes from the club's ordered teams, and from nowhere else.** There is
no per-player ability score and there must never be one. A child's ability
context is their team, and the club's ordering of its own teams.

## 9. Rotation

**Target. Rotation is always clockwise, and it is not configurable in v1.**

The setup overview shows a subtle clockwise cue, arrows or their equivalent.
**Coaches keep track of the rotation themselves.** OTJ tracks no rotation state
and shows no rotation progress.

**Previous station and Next station mean browsing the drills.** They must never
read as advancing a live session, and nothing in the delivery surface may imply
that OTJ knows where the carousel has got to.

## 10. Venue and pitch setup

**Target. Venue setup is reusable and admin owned.**

- Each venue has **two saved station layouts**: one for four stations and one for
  five. OTJ loads the appropriate one for the session automatically, from the
  session's station count.
- Each venue also has a **simple saved reminder visual for one game and for two
  games**. Different venues use different pitch sizes and positions, and the
  operational information is one game or two, where they are, and which named
  players and bibs are on each side. It is not a geometry editor.
- Each station is a **draggable and resizable rectangular zone** during admin
  setup. The rectangle means "this is the area normally allocated to Station N".
  It is not the exact footprint of that week's drill.
- **Station number comes from drill order in the session plan.** The zones are
  numbered; the plan says which drill is at each number.
- **The physical zone positions stay familiar week to week**, which is most of
  their value.
- **Weekly coaches do not drag or reposition anything in v1.**
- **A clean schematic, never satellite or aerial imagery.**

The club currently trains at Haggs Hill, Flushdyke and Woodkirk. Those are rows
in a table, not a schema. Nothing hard codes three venues or these three names.

## 11. Games

**Target. Game planning is a separate planned allocation from station grouping.**

**Game bib and station bib are two separate concepts for the same session.**
Planning the games must not overwrite or destroy the station bib plan.

**Target size is 5v5 or 6v6.** Avoid 7v7 or larger wherever practical.

**Game count follows attendance:**

- **12 or fewer confirmed: recommend 1 game.**
- **13 or more confirmed: recommend 2 games.**
- The coach may override.

The threshold follows from the target size: one game holds twelve at 6v6, so a
thirteenth child means a second game rather than a 7v7.

### Two games

The club's ordered teams are the starting structure. Today that order is Titans,
then Trojans, then Gladiators, then Spartans, then Argonauts, and **no algorithm
may hard code those names**. They are this season's contents of an ordered set.

- Upper ordered teams naturally form the stronger game.
- Lower ordered teams naturally form the development game.
- The middle band is the flexible bridge, and its players may be split between
  the two games to make sensible numbers.
- **Sensible game size comes before preserving station bib groups.**
- Some players are re-bibbed for the games, and that is expected rather than
  exceptional.
- Where possible, each individual game has two clearly distinguishable bib
  colours.

### One game

Balance the two sides by ability. Do not preserve the stronger and weaker bands
as opposing blocs: distribute players from the stronger teams across both sides,
then use the remaining bands to balance numbers and ability. This is expected to
be relatively rare.

### What the game plan shows

Actual player names, their game side, and their game bib colour. Coaches adapt
physically on the day without updating OTJ.

## 12. On the day

The coach's priority, in order:

1. See the overall station setup.
2. Understand how their starting station is physically set up.
3. Open that drill for detail.

**Target. Most delivery use is an iPhone or an Android phone**, and the setup map
prioritises readability over completeness. A station zone shows useful overview
information, never a drill diagram shrunk until it is unreadable.

**Tapping a station opens a full screen drill detail** carrying the station
number, the drill name, a large drill diagram, the objective and two or three
concise coaching points. **Equipment is not shown there**: equipment is dealt
with during setup, and a coaching screen carrying kit lists is a coaching screen
nobody reads.

Previous station, Next station and Back to setup map are the whole navigation,
and all three are browsing.

## 13. Sharing

**Target. Another authorised coach opens the same protected OTJ session and sees
the same plan.**

On a phone the coach uses the platform Share action to send the session link into
WhatsApp, Messages, email or anywhere else. **No WhatsApp specific integration is
built.**

**The share message carries no player names, no bib assignments and no other
child data.** It shares the protected canonical OTJ session link, and the
receiving coach authenticates in OTJ to see anything operational. None of this
information is exposed through a public or login-free share.

**Today this is already shipped**, which the first discovery pass missed:
`src/lib/share.ts` and the internal share arm of `ShareModal` already put the
canonical protected `/session-day/:id` URL through the platform share sheet with
a clipboard fallback, carrying the session name and nothing else
(`00-current-state-audit.md` section 24). What remains is to keep it reachable
from the delivery surface and to pin the payload with a test.

## 14. The primary success scenario

> A coach arrives, opens OTJ on their phone, and immediately sees today's groups
> and bibs, the venue and station layout, the four or five drills and where each
> station goes. They tap their starting drill and see the full visual, the
> objective and the coaching points. Every coach has the same plan. Little or no
> verbal briefing is needed.

---

## Architecture principles

Each is followed by what it rules out in this codebase specifically.

1. **Coach workflow first.** The current schema must not force an awkward
   journey. Rules out: leaving the plan being written to create a drill, because
   `DrillFormModal` happens to live on other screens.

2. **A prepared plan, not a live administrative record.** Rules out: any
   persistence whose only purpose is to keep OTJ synchronised with a pitch that
   is currently moving.

3. **Preserve useful existing functionality.** Rules out: a second grouping model
   beside `register_entries`, a second diagram model beside `drills.diagram`, a
   second lifecycle beside `sessionLifecycle.ts`, a second count builder beside
   `tonightCounts`, a second share seam beside `src/lib/share.ts`.

4. **No big-bang rebuild.** Every phase leaves OTJ usable and deployable.

5. **One source of truth.** The coach app, the venue setup, the bib plan and any
   share output derive from the same underlying session.

6. **Historical safety.** Adapting a drill must not silently rewrite an old
   session. Copying is preferred to versioning because a copy is unambiguous
   about what a session ran, and because a version number is a concept a
   volunteer coach has no use for.

7. **Planning and operational preparation are different stages.** Spond enriches
   a planned session when the data arrives; it never blocks planning.

8. **Desktop for creation, phone for delivery.** Authoring may optimise for a
   laptop. Delivery is judged on a phone, outdoors, in one hand.

9. **Security boundaries stay explicit.** Public sharing, parent-facing
   information, Spond identities and children's data are reviewed intentionally,
   through the existing gated-migration and security-review process.

10. **Avoid speculative complexity.** Where a fact can be derived from data
    already read, derive it rather than storing it. A derived fact cannot go
    stale and cannot disagree with the record.
