# Open questions and decisions requiring human input

Status: awaiting answers. Each question names what is blocked by it, what happens
if it is not answered, and a recommendation, so none of them stalls the
programme.

Nothing here is an engineering question. Every one is a club or product decision.

---

## Q1. May a public share carry the date, time and venue of a session?

**Blocks:** COACH-K's public half, and roadmap item TRAIN-02 as currently
worded.

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

## Q4. How many groups should the suggested split aim for by default?

**Blocks:** a small default in COACH-G. Not the phase.

**The situation.** The discovery says four to six stations with four as a good
default, and that groups rotate between them. So the natural default is "one
group per station". But a club with 22 children and four stations gets groups of
five or six, and with 40 children gets ten, which is a different kind of session.

**Recommendation.** Default to one group per station, and show the resulting
group size prominently so the coach can immediately see whether it is sensible
and change the count. Do not add a target group size setting until someone asks
for one.

**If unanswered.** The recommendation is the default.

---

## Q5. Should a coach be able to choose which group starts at which station?

**Blocks:** nothing. It is the difference between zero state and a small amount
of per-session state in COACH-G.

**The situation.** The plan derives starting stations from group order: the first
group starts at station 1, the second at station 2, and rotation is arithmetic
from there. That is correct for the normal case and costs nothing to store.

**When it would be wrong.** If a coach wants the youngest group to start at the
easiest station, or wants to avoid a particular group starting at the goalkeeping
drill.

**Recommendation.** Ship derived. If coaches ask, add an override then; it is one
small map per session and it can ride the same jsonb as the block metadata.
Building it first is speculative complexity.

**If unanswered.** The recommendation is the default.

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

## Summary: what actually blocks work

| Question | Blocks | Default if unanswered |
|---|---|---|
| Q1 date/time/venue public | COACH-K public half, TRAIN-02 | Message only, no public page |
| Q2 parent identity binding | Nothing | Not built |
| Q3 freeze delivered sessions | Nothing | Not frozen |
| Q4 default group count | Nothing | One group per station |
| Q5 starting station override | Nothing | Derived |
| Q6 venue background imagery | Nothing | No imagery |
| Q7 rename template | COACH-E copy only | Ships with the current word |
| Q8 audible rotation cue | Nothing | LIVE-02 unchanged |

**Only Q1 blocks a phase, and only half of one.** Everything else has a
defensible default, so the programme can start on COACH-A tomorrow without a
single answer.
