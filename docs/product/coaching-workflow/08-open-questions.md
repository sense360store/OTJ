# Open questions, unresolved implementation details, and what discovery closed

Status: reconciled 18 August 2026. **Three open questions and four unresolved
implementation details.** The previous revision carried ten open questions; coach
discovery answered or removed the requirement behind seven of them.

Nothing here blocks the recommended first slices.

Two kinds of thing are kept apart deliberately:

- **Q** is a product or club decision. A person answers it. Every one has a
  recommendation and a stated default, so none stalls the programme.
- **D** is an unresolved implementation detail. Engineering answers it, and it
  must be settled **before** the slice that needs it starts rather than during
  it. None needs a migration.

---

## Q1. Should a delivered session freeze the drills it ran?

**Blocks:** nothing. It changes COACH-12's scope if the answer is yes.

**The situation.** A session activity references a drill. Editing that drill in
July changes what a session delivered in June displays. Adapting for one session
(COACH-12) solves the *adapt* direction and not this one.

**The trade.** Freezing gives a permanent record of what was actually delivered
and costs a snapshot per session, a decision about when to take it, and a story
for every session that already exists. Not freezing keeps one drill row as the
single truth and accepts that a past session shows the current version.

**Recommendation.** Do not freeze. Nobody at the club audits what a June
session's coaching points said, and COACH-12 makes the change non-silent with a
usage line on the edit form. The mechanism to change our mind exists if it is
ever needed: the public share snapshot already demonstrates freezing.

**If unanswered.** The recommendation is the default and COACH-12 ships as
scoped.

---

## Q2. Is replacing the word "template" acceptable?

**Blocks:** the copy half of COACH-13, and nothing else.

**The situation.** `templates` is the table behind what a coach calls the planned
week. The word came from the FA import model.

**Recommendation.** Rename to **week plan** in everything a user reads, keep the
table name, and keep "session plan" for a standalone one. Consistent with the
existing precedent of removing "roster" from product copy while the code kept its
own names.

**If unanswered.** COACH-13 ships its behaviour with the current word and the
rename becomes a separate copy sweep.

---

## Q3. Should the suggested setup say why it grouped that way?

**Blocks:** nothing. Worth deciding before COACH-3 rather than after.

**The situation.** The generator keeps teams whole, combines adjacent bands and
prefers uneven groups. A coach looking at 6/5/5/4 cannot tell whether OTJ chose
it deliberately or fell into it, and this club has already noticed that kind of
ambiguity once, when two honest numbers wore one word.

**Recommendation.** One sentence under the suggestion, derived from the decision
the function already made: "Two teams combined to keep the numbers workable." It
costs nothing and it makes an override an informed choice rather than a guess.

**If unanswered.** Ship without it and add it when a coach asks why.

---

## D1. Are venue layouts scoped by season or age group as well as by venue?

**Settle before:** COACH-5. **Migration impact:** the shape, not the column.

**The situation.** The settled decision says layouts are saved at the appropriate
venue, season and age group level. The proposed shape
(`04-data-model-proposal.md` section 3) keys them by `(kind, slots)` within one
venue and carries no scope key.

**The argument for venue scope only in v1.** A rectangle on the ground is a
physical fact that does not change when a season turns over. The club trains one
age group, and `sessions.age_group` is free text rather than a modelled entity.
A scope key nobody varies is a key that gets set wrongly once and then confuses
someone.

**The argument against.** If a second age group starts using the same venue with
a different allocation, every layout is suddenly wrong for one of them, and
retrofitting a scope means a shape migration rather than a column.

**Recommendation.** Venue scope only in v1, with the shape kept as a keyed list
precisely so a scope key can be added without a rewrite, and with the decision
written into the migration header so the next reader does not have to infer it.

---

## D2. What is the gesture for delivering a five drill plan as four stations?

**Settle before:** COACH-3 states a recommendation the coach acts on.
**Migration impact:** none, either way.

**The situation.** Attendance can recommend four stations for a plan holding
five. **The coach chooses which drill sits out.** Nothing may delete a planned
drill on their behalf.

**The two candidates.**

1. **Remove the activity from the dated session.** This already works, and it is
   already non-destructive towards everything that matters: a session is a copy,
   so the week plan and the library drill are untouched. The cost is that
   re-adding it later loses its duration and position.
2. **Mark it as not running tonight.** The activity stays in the plan with a
   marker. It reads better and it is reversible, and it costs one optional key on
   the activity plus `toActivity` and `toActivityRow`. `sessions.activities` is
   unconstrained jsonb, so it is **not a migration**.

**Recommendation.** Decide it with a coach rather than in a document. Both are
cheap and only one of them is destructive-feeling. **Under no circumstances does
OTJ pick the drill.**

---

## D3. How does a game bib colour resolve to a game and a side?

**Settle before:** COACH-8. **Migration impact:** none. This is client logic.

**The situation.** The model stores one game bib per child
(`04-data-model-proposal.md` section 4) and derives the game and the side from
the colour, so that no second fact can disagree with the bib a child is actually
wearing. That works while the colours in play are the deterministic ones the
generator assigned, two per game.

**What is not settled** is what happens when a coach hands a child a colour
outside their game's pair.

**The two candidates.**

1. **Offer only the colours in play for that game.** The derivation holds by
   construction, and a coach who wants a third colour is told why not.
2. **Carry a small session-level map of game and side to colour**, held with the
   plan and read by the derivation. More flexible, and it is a second fact, which
   is the thing the model has been avoiding everywhere else.

**Recommendation.** Candidate 1, because it keeps one fact per child and the
constraint it imposes matches what a coach does with a bag of bibs. Revisit only
if a coach reports being blocked.

---

## D4. Does the derived station list need an explicit marker?

**Settle after:** COACH-2 has been used, not before it.
**Migration impact:** none.

**The situation.** The stations are the `Skill` phase activities in plan order
(`02-target-product-model.md` section 4). A `Skill` activity that is not a
station, for example a whole-group technical exercise, makes the derived count
wrong.

**Why it is deliberately not solved now.** Solving it costs an activity key and a
concept a coach has to learn, and nobody has yet reported a session that mixes
carousel and non-carousel skill work. The derived count is stated on screen, so a
wrong answer is visible rather than silent.

**The fix if it proves real.** One optional key on the activity, added to
`toActivity` and `toActivityRow`. Not a migration.

**Recommendation.** Ship COACH-2 as derived, watch, and only then decide.

---

## Closed by coach discovery

Recorded rather than deleted, so the reasoning is not rediscovered and so a
future session can see that a question was answered rather than forgotten.

### The product philosophy

**OTJ is a prepared training plan and a visual guide, not a live administrative
system.** Once training starts, small operational changes are handled physically.
This closed more questions than any other answer.

### Stations and rotation

| Was open | Answer |
|---|---|
| How many stations | **Exactly four or five. Never three.** 24 or more confirmed recommends five, fewer recommends four, and the coach may override. |
| What drives the count | **Player attendance**, not coach availability. |
| Fewer groups than stations | A station starts empty. Every active group still rotates through every planned station. |
| Which group starts where | Active bib colours in the fixed vocabulary order, assigned sequentially to Station 1, Station 2 and so on. Derived on every read. |
| Rotation direction | **Always clockwise**, not configurable, with a subtle cue on the overview. |
| Does OTJ track rotation progress | **No.** Coaches keep track themselves. Previous and Next browse the drills. |
| Should a re-bib during the carousel warn the coach | **Withdrawn with the mechanism.** There is no carousel state to disturb. |
| What happens when a new bib colour appears mid-carousel | **Withdrawn with the mechanism.** It is a physical event on the grass. |
| How the transition between stations and games is timed | **Handled physically.** The games have their own saved layout, so the change of ground is visible without being scheduled. |

### Groups and bibs

| Was open | Answer |
|---|---|
| Is a group the same thing as a bib colour | **Yes**, and active colours are unique within a session. No Group entity, no `group_id`. |
| How many groups | One per station. Teams kept whole where practical, only adjacent bands combined, uneven preferred over splitting a squad. |
| Where ability comes from | **The club's ordered teams.** Never a per-player score. |
| Session-only assignment | Already satisfied by `register_entries.bib_colour_override`. |
| Who generates the first setup | **OTJ, automatically, from confirmed attendance.** |
| What happens when attendance changes | Preserve saved assignments, remove leavers, add joiners, rebalance minimally. A deliberate Reset is later work. |
| What counts as attending | **Only Yes.** Unanswered is not attending and gets no bib, group or game. |

### Games

| Was open | Answer |
|---|---|
| How many games | **One at 12 or fewer confirmed, two at 13 or more.** A recommendation, never a rewrite. |
| Target size | 5v5 or 6v6. Avoid 7v7 or larger. |
| Are game bibs the same as station bibs | **No.** Two separate facts for one session, and planning the games never destroys the station plan. |
| May a side wear two colours | **Reversed.** Where possible each game has two clearly distinguishable colours, and re-bibbing for the games is expected. |
| How two games are banded | Upper teams form the stronger game, lower teams the development game, the middle band is the flexible bridge and may be split. Sensible game size beats preserving station groups. |
| How one game is balanced | Distribute the stronger players across both sides. Do not keep the bands as opposing blocs. |
| What the game plan shows | Player names, side, and game bib colour. |

### Venue and delivery

| Was open | Answer |
|---|---|
| Should a venue layout allow aerial or traced imagery | **No.** A clean schematic. |
| Who lays out a venue | **An admin, once.** Weekly coaches do not drag or reposition anything in v1. |
| How many layouts per venue | Four: stations for four, stations for five, one game, two games. Loaded automatically. |
| What a station rectangle means | The area normally allocated to Station N, not this week's exact footprint. |
| Where station numbers come from | Drill order in the session plan. |
| What a station shows on the map | Useful overview information, never a shrunken drill diagram. |
| What the station detail shows | Station number, drill name, large diagram, objective, two or three coaching points. **No equipment.** |

### Drills and sharing

| Was open | Answer |
|---|---|
| How a drill is adapted for one session | A copy owned by the session, independent of the library drill and of every other session. |
| Are versions exposed | **Never.** No v1 and v2 anywhere. |
| What Save as reusable does | Creates a **new** library drill. It never overwrites the original. |
| Do session adaptations appear in the library | **No.** |
| How coaches share a session | The platform Share action on the protected canonical link. Already shipped. |
| Is a WhatsApp integration needed | **No.** |
| Does the share carry player data | **No.** Names, bibs and groups never leave the authenticated app. |
| Is public login-free sharing needed for this | **No.** It was never the requirement, and the programme proposes no public projection. |

### Withdrawn because their requirement is gone

- **May a public share carry date, time and venue?** It belongs to TRAIN-02, not
  to this programme, and is recorded there rather than here
  (`07-roadmap-reconciliation.md` section 3).
- **Should a signed-in parent see their own child's group?** Recorded so it is
  not rediscovered as a surprise: it would need a new identity binding between
  `profiles` and `players`, which the product deliberately does not have, plus
  new policies and a per-parent scoped read. It is a programme in its own right
  and it has **no consumer in the settled model**, because parent-facing group
  information is not part of it.
- **Should the live view have an audible rotation cue?** OTJ does not cue
  rotations. LIVE-02 is unaffected and stays as its own row.

---

## Summary: what actually blocks work

| | Blocks | Default if unanswered |
|---|---|---|
| Q1 freeze delivered sessions | Nothing | Not frozen |
| Q2 rename template to week plan | COACH-13 copy only | Ships with the current word |
| Q3 a "why" line on the suggestion | Nothing | Ship without, add on request |
| D1 venue layout scope | COACH-5's shape | Venue scope only, shape kept extensible |
| D2 choosing the four active drills | COACH-3's recommendation wording | Decide with a coach. OTJ never picks. |
| D3 game colour to side | COACH-8 | Offer only the colours in play for that game |
| D4 an explicit station marker | Nothing | Derived, watched, revisited on evidence |

**Nothing blocks the recommended first slices.** COACH-1, COACH-2, COACH-3 and
COACH-5 can start today, and only COACH-5 carries an open detail, which is a
decision about its own migration header.
