# Open questions and decisions requiring human input

Status: awaiting answers. Each question names what is blocked by it, what happens
if it is not answered, and a recommendation, so none of them stalls the
programme.

Nothing here is an engineering question. Every one is a club or product decision.

---

## Q1. May a public share carry the date, time and venue of a session?

**Blocks:** COACH-K2 and roadmap item TRAIN-02 as currently worded. **Blocks
nothing else in the programme.** Reaffirmed after review: widening login-free
public sharing is deliberately not a prerequisite for the coaching workflow, and
the parent-facing outcome is met without it.

**The situation.** Today the public session snapshot carries no date, no time and
no venue, on the server (the builder never reads those columns) and in the
browser (all three are on the forbidden-key list). TRAIN-02's stated payload
includes all three. That is a widening, not a projection.

**What it means in plain terms.** A snapshot with those three fields says "a
group of children will be at this place at this time", on a login-free URL that
anyone who receives it can forward and that a search engine will index if it is
ever posted somewhere public.

**Recommendation.** Yes, with three conditions: opt in per share rather than
inherited from the session's rights class; a short default expiry measured in
days rather than the current ninety; and confirmation text that says plainly what
is being published.

**If unanswered.** COACH-K ships the generated message only. That already meets
the discovery's stated outcome, so nothing is blocked, only narrowed.

---

## Q2. Should a signed-in parent be able to see their own child's group?

**Blocks:** nothing in this programme. Recorded because it is the only design
that shows a parent their child's group with no disclosure to anyone else, and it
should not be rediscovered later as a surprise.

**The situation.** The parent role exists, parents sign in, and
`src/routes/ParentHome.tsx` is their dashboard. But `players` has **no link to an
auth user** by deliberate design (`src/lib/data.ts:47`), so the product cannot
tell which child belongs to which parent.

**What it would take.** A new identity binding between `profiles` and `players`,
a new way to establish it that a human verifies, new policies, and a new class of
per-parent scoped read. That is a programme in its own right with its own
security review, comparable in size to the Spond linking programme.

**Recommendation.** Not now. Answer the discovery's requirement with the
generated message (COACH-K), and revisit this only if the club wants a durable
parent-facing view rather than a pre-training message.

**If unanswered.** Nothing happens, which is the correct default.

---

## Q3. Should a delivered session freeze the drills it ran?

**Blocks:** nothing. It changes COACH-C's scope if the answer is yes.

**The situation.** A session activity references a drill. Editing that drill in
July changes what a session delivered in June displays. Copy-on-adapt solves the
*adapt* direction (Phase C) but not this one.

**The trade.** Freezing gives a permanent record of what was actually delivered
and costs a snapshot per session, a decision about when to take it, and a story
for every session that already exists. Not freezing keeps one drill row as the
single truth and accepts that a past session shows the current version.

**Recommendation.** Do not freeze. Nobody at the club audits what a June
session's coaching points said, and the change is made non-silent by Phase C's
usage line on the edit form. The mechanism to change our mind exists if we ever
need it: the public share snapshot already demonstrates freezing.

**If unanswered.** The recommendation is the default and Phase C ships as
scoped.

---

## Q6. Should a venue layout be allowed a traced or aerial background image?

**Blocks:** the scope of COACH-H. Not the phase.

**The situation.** The plan draws named rectangles and no imagery. The discovery
mentions that layouts might be derived from measurements, coordinates, Google
Maps or aerial imagery, and says explicitly not to assume the final view should
be a satellite photograph.

**The case against, for the first version.** A photograph brings a third-party
rights question (Google Maps imagery is licensed and its terms would need
checking against the club's non-commercial use), a storage cost, and a
legibility problem at phone width that a drawn rectangle does not have. It also
sits awkwardly with the venue layout's allow-list, which currently makes an
imagery reference unrepresentable rather than merely discouraged.

**Recommendation.** No imagery in version 1. If the layouts turn out to be hard
to draw accurately without a reference, revisit with a **traced** representation
produced once by an admin from whatever reference they like, which is a drawing
and carries no third-party rights question at all.

**If unanswered.** The recommendation is the default.

---

## Q7. Is the word "template" being replaced acceptable?

**Blocks:** the copy half of COACH-E.

**The situation.** `templates` is the table behind what the discovery calls "the
planned session/week". The word came from the FA import model. A coach plans a
week, not a template.

**Recommendation.** Rename to **week plan** in everything a user reads, keep the
table name, and keep "session plan" for a standalone one. Consistent with roadmap
rule 6's existing precedent of removing "roster" from product copy while the code
kept its own names.

**If unanswered.** COACH-E ships its behaviour with the current word and the
rename becomes a separate copy sweep, exactly as SPOND-04 was.

---

## Q8. Does the club want the rotation cue to be audible in the live view?

**Blocks:** nothing. It informs LIVE-02's priority.

**The situation.** COACH-F introduces rotations. A rotation that nobody notices
does not happen, and a phone in a pocket at a windy venue is not a reliable
visual cue. LIVE-02 ("unmissable time-up cue") is already on the roadmap as
Later.

**Recommendation.** Re-read LIVE-02's priority when COACH-F is scheduled, not
now. Sound has its own considerations (a phone on silent, a coach who is deaf,
whether it should be one coach's phone or everyone's) that deserve their own
thought rather than being decided as a footnote here.

**If unanswered.** Nothing is blocked.

---

## SETTLED. Q4, Q5 and Q9, answered by the August coach discovery

Recorded here rather than deleted, so the reasoning is not rediscovered.

### Q9. Is an operational group the same thing as a bib colour? **Settled: yes.**

- **The station group's coach-facing identity is its bib colour.**
- **Active station groups have unique bib colours within a session.** The coach
  reports no use case for two intended groups sharing one, and the silent merge
  that happens today is a defect.
- **"No bibs" is not a valid group.** An included player with no effective bib
  means Groups and bibs is **not ready**.
- **Not ready is a soft state, never a blocker.** The session opens, edits and
  runs regardless, and a late arrival added to a group recalculates it.
- **Uniqueness is a domain and UI rule, not a database constraint**, because a
  group is emergent from per-player bib resolution and there is no row a unique
  index could sit on without inventing the entity this decision declines.
- **No new Group entity**, unless implementation evidence later proves the
  existing model cannot carry the behaviour.
- **The normal team from Spond supplies the default grouping context**, and
  **tonight's bib assignment is session-only** and already is, through
  `register_entries.bib_colour_override`.
- **No per-player ability score, level or permanent training classification.**
  The context derives through the team's position in the club order.

The one thing that must be stored is the club's ordering of its own teams, one
integer per team, because nothing in the schema can express or derive it
(`00-current-state-audit.md` section 19). That is M6.

### Q4. How many groups should the split aim for? **Settled.**

One group per station remains the starting point, but the rules that shape it are
now explicit: keep normal teams whole where practical, combine only **adjacent**
ability bands, and prefer slightly uneven groups (6/5/5/4) over splitting squads
to reach even ones (5/5/5/5). Higher attendance makes existing groups bigger; it
does not invent a group to fill a station that was never planned.

### Q5. Should a coach choose which group starts at which station? **Settled: no.**

The coach reports no preference about starting stations or rotation direction. So
OTJ picks deterministically and **offers no configuration UI for either**. This
was previously deferred with a recommendation; it is now an answer.

---

## SETTLED. The game phase

Answered by the same discovery, and new since the last revision.

- A session has at least two physical phases: the station carousel, then
  small-sided games, with the ground rearranged between them.
- **A game side is not a bib group.** One side may contain two bib colours, and
  nothing forces a redistribution to make each side one colour.
- A side is modelled as **a set of bib groups**, never a player list and never
  one colour.
- **Game count is an attendance-driven recommendation**, roughly one game around
  a dozen children and two above twenty, with those numbers adjustable and in one
  named place. It never rewrites the planned session.
- **Sides are banded, not averaged**: stronger groups together, weaker groups
  together, using the club team order.
- The setup views are derived from blocks, so the two-phase model needs no new
  entity.

---

## Q10. How is the transition between the phases timed?

**New, and genuinely open.**

**The situation.** The plan models the transition as an ordinary activity
("Reset, 5 min"), which needs no new structure and occupies real time in the
total. But nobody has said whether coaches actually want it in the plan, or
whether they treat it as slack inside the carousel's last rotation.

**Why it matters slightly.** If it is a real activity, the session total is
honest and the live view has something to show. If coaches never add one, the
live view moves from the last station straight to the first game with no cue that
the ground has to change, which is exactly the unexplained moment this programme
exists to remove.

**Recommendation.** Ship it as an optional ordinary activity, and have the games
setup view announce itself ("Next: two games, pitches here") whether or not a
Reset activity exists. That way the cue does not depend on the coach having
planned for it.

**If unanswered.** The recommendation is the default and nothing is blocked.

## Q11. Does the grouping suggestion need a "why" line?

**New, and worth deciding before Phase G rather than after.**

**The situation.** The suggestion combines adjacent bands and prefers uneven
groups. A coach looking at 6/5/5/4 cannot tell whether OTJ chose it deliberately
or fell into it, and the previous experience with two honest numbers wearing one
word (`CLAUDE.md`, Tonight) says this club notices that kind of ambiguity.

**Recommendation.** One sentence under the suggestion: "Titans and Trojans
combined to keep the numbers workable." It costs nothing, it is derived from the
decision the function already made, and it makes an override an informed choice.

**If unanswered.** Ship without it and add it when a coach asks why.

---

---

## Summary: what actually blocks work

**Open questions**

| Question | Blocks | Default if unanswered |
|---|---|---|
| Q1 date/time/venue public | COACH-K2 and TRAIN-02 only | Message only, no public page |
| Q2 parent identity binding | Nothing | Not built |
| Q3 freeze delivered sessions | Nothing | Not frozen |
| Q6 venue background imagery | Nothing | No imagery |
| Q7 rename template | COACH-E copy only | Ships with the current word |
| Q8 audible rotation cue | Nothing | LIVE-02 unchanged |
| Q10 transition timing | Nothing | Optional activity, games view announces itself |
| Q11 a "why" line on the suggestion | Nothing | Ship without, add on request |

**Settled by the August coach discovery, and not to be reopened without evidence**

| Was | Decision |
|---|---|
| Q4 group count | One per station, teams kept whole, adjacent bands combined, uneven preferred |
| Q5 starting station and rotation direction | Derived, deterministic, no configuration UI |
| Q9 group identity | Bib colour, unique per session, no Group entity, no ability field |
| Game phase | Sides are sets of bib groups, banded not averaged, count is a recommendation |
| Session-only override | Already satisfied by `register_entries.bib_colour_override` |
| Team ability order | One integer per team (M6), the only irreducible new fact |

**Nothing blocks the critical path.** Q1 governs only the parked public
projection. Q10 and Q11 are refinements with defaults. The programme can proceed
today: review and merge PR #189, then start COACH-B1.
