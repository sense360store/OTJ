# Coach workflow and product principles

Status: reference. Captured 17 August 2026 from an active coach and admin at
Ossett Town Juniors, then reconciled against the code in
`00-current-state-audit.md`.

This document records how training is actually planned and delivered, and the
principles that follow from it. It is the "why" behind every later document. It
deliberately describes the club's real practice, not the product's current shape.

---

## 1. The outcome the whole programme serves

> A coach should be able to plan training weeks ahead, refine it when Spond
> attendance becomes known, and then every coach should arrive at the venue with
> enough information on their phone to understand the groups, bibs, overall pitch
> setup, individual drill setup and drill objectives without requiring a verbal
> briefing from another coach.

The measurable effect is a reduction in the explaining and coordinating that
currently happens in the first fifteen minutes on the grass.

## 2. How training is actually planned

**Long range, by theme.** Coaches think in blocks of several weeks. A programme
is a football development theme: attacking, defending, passing, a technical or
tactical objective. The theme persists; the drills do not. Each week has its own
objective, decided first, and the drills are then chosen or created to serve it.

**A week is four to six stations.** Four is the good default. A one hour session
is typically a warm-up, four to six stations that groups rotate between, then one
or two small-sided games.

**One plan, often two deliveries.** The same core session runs twice in a week,
Tuesday and Saturday, with minor tweaks. The second delivery is the same plan,
not a new one.

**Coaches stay with their group.** A coach rotates with their own players
between stations. Coaches are not normally assigned permanently to a station.
Exceptions happen on the night and should not be modelled.

## 3. How drills actually get created

The coach usually already knows the drill. It exists in their head, on paper, in
a PDF, in another coaching resource, or already in OTJ. **The problem is not
discovery. It is getting a known drill into a useful electronic form.**

The natural authoring flow at a laptop is: open a pitch canvas, place goals,
cones, balls and players, draw the exercise, add the objective, use it in the
session being planned.

**The visual is the drill.** Text is the supporting material, not the other way
round. A drill with no picture does not answer the question a coach asks at the
venue.

**Motion is an enhancement, never a requirement.** A simple drill must stay fast
to create. Animation earns its place only for exercises a static picture cannot
explain.

## 4. Session-first creation

A coach creates a drill because the session they are planning right now needs it.
Requiring them to leave the session, open a separate library, create the drill,
save it, find it again, return to the session and add it is seven steps for one
intention.

Once created, the drill should be reusable. Reuse has two meanings and both are
real:

- **Use as-is.** The drill runs again unchanged.
- **Copy and adapt.** Any property might change: diagram, players, rules,
  duration, objectives, coaching points, difficulty, area, equipment.

Adapting for one session must never rewrite the library version or any past
session that used it.

## 5. Planning and operational preparation are different stages

This is the principle the product most needs to express.

**Planning layer**, weeks or months ahead, with attendance unknown and
unknowable:

- the programme theme
- the week's objective
- the drills
- the session structure and a provisional station count

**Operational layer**, one or two days before, once Spond replies mean something:

- how many are coming
- how many coaches
- group sizes and who is in which group
- bib colours
- how many groups the coach chooses to run
- how many small-sided games to set up
- final drill adaptations
- where each station goes at the venue
- the coach-facing plan for the night

**What the operational layer does NOT change: the planned drills.** The station
count is a coaching and programme decision made when the week was planned.
Attendance changes group sizes, the number of groups and how many stations are
occupied at once. It never drops a drill, shortens the carousel or rewrites the
session. An earlier draft of this list said "possibly a revised station count",
and that was wrong.

Spond must never gate planning. A programme planned in June for September cannot
wait for RSVPs, and a Spond failure on the night must render as no context, never
as "nobody is coming".

## 6. Groups and bibs

Attendance shapes grouping. Coaches train as an age group but keep their own team
groups together where they can. The real grouping shifts with who replied, who
turns up, how many coaches are present and how the team numbers fall.

Bibs matter because they are how a coach and a child identify a group in one
glance across a pitch. **The bib colour is the group's name**, and two active
groups never share one.

The operational plan needs to show, for the night: who is attending, their group,
their bib colour, and the shape of the groups.

**The normal team is the default grouping context.** Every child already belongs
to a team, in Spond and mirrored in OTJ, and the club orders its teams from
strongest to weakest. That ordering is the only thing about it OTJ does not
already hold. There is no per-child ability rating and there should never be one.

**Moving a child for one night changes nothing durable.** Their Spond team, their
OTJ team and next week's default are untouched. A bib assignment is a fact about
one session.

**How groups are built**, in priority order: keep normal teams whole as far as
practical; combine only **adjacent** ability bands when combining is needed; keep
numbers sensible; and prefer slightly uneven groups over splitting a squad.
6/5/5/4 beats 5/5/5/5 bought by breaking up two teams. All of it is a suggestion
the coach adjusts.

**Rotations follow stations, not groups.** Every active group completes every
planned station once, so four planned stations means four rotations whether three
groups turn up or four. With three, one station stands empty each rotation.
Nothing drops a drill, shortens the carousel or rewrites the plan because fewer
children replied. More children means bigger groups, not an invented fifth group.

**The coach has no preference** about which group starts where or which way the
carousel turns, so the product should choose and offer no setting for either.
What the product owes them in return is that **its choice stops moving**: once the
carousel is running, one child changing bib must not silently send a different
group to a different station.

## 7. Sharing before training

Coaches and parents are creatures of habit and communicate on WhatsApp. Telling a
parent which bib or group their child is in before they arrive removes a whole
category of confusion at the gate.

Security is the constraint that decides the shape of this, not an afterthought.
See `05-security-share-boundary.md`. The short version, argued there: a message a
coach sends to a known group is safer than a link anyone can forward, because a
link has no audience and cannot be un-sent.

## 8. Venue and pitch setup

Venue layout is static; drills change weekly. Flushdyke has two pitches side by
side; other venues allocate the club a known fraction of a pitch, for example one
third. The requirement is to model the training area allocated to our age group,
not the whole site and not other age groups.

The layout should be accurate enough to say "Station 1 goes here, Station 2 goes
here", which means a position on the ground rather than only which pitch. A clean
rendered representation is likely to be more useful than a satellite photograph.
Four stations is the default; the number must be flexible.

**The venue base is static. The session's setup is not**: see 8a.

## 8a. A session has at least two physical phases

The earlier venue thinking was too static. A normal hour is:

**Phase A, the station carousel.** Four to six stations set up across the area,
groups rotating between them.

**Then the ground changes.** Cones come in, one or two game pitches go out.

**Phase B, small-sided games.** Players play, in sides drawn from the groups.

So the venue base is reusable and static, but **the session's physical setup is
phase-specific**. One picture cannot describe the night.

**Game count follows attendance**, roughly one game around a dozen children and
two above twenty. Those numbers are a starting point, not a rule, and the
suggestion never rewrites a planned session.

**A game side is not a bib group.** With four station groups and one game, a side
wearing two colours is the expected shape, and forcing a full bib redistribution
to make each side one colour is unnecessary churn at the worst moment.

**Moving one player between game sides means changing that player's bib.** Asked
directly whether they would move a child without changing their bib or re-bib
them, the coach said they would **re-bib**. So there is no need for a "moved but
kept their colour" exception: the child is handed a bib belonging to their new
side, and their colour tells the truth about where they are.

That does **not** collapse into one side equalling one colour. A side of two
colours stays a side of two colours; what the re-bib does is move one child from
one of those colours into one of the other side's. The two facts sit together
without contradiction.

Like every bib assignment, it is a fact about tonight and nothing else: the
child's Spond team, their OTJ team and next week's default are untouched.

**Sides are banded, not averaged.** Stronger players play with and against
appropriately strong players; weaker players stay in an appropriate band. Two
games are not deliberately levelled into identical mixtures, and the strongest
group is not mixed with the weakest to even the numbers.

## 9. On the day

The coach's priority, in order:

1. See the overall station setup.
2. Understand how their starting station is physically set up.
3. Open that drill for detail.

The drill page on a phone needs a large visual and the objectives. It should be
usable by a coach who has never seen the drill before. Administrative metadata
that is not useful while coaching should not be on it.

## 10. The primary success scenario

Today, coaches often arrive not knowing how the players are grouped, what the
drills are, what each drill looks like, or how each station is set up. Someone
walks around explaining it to everyone, and that costs most of the setup time.

The future state:

> A coach arrives, opens OTJ on their phone, and immediately sees today's groups
> and bibs, the overall venue and station layout, the four to six drills and where
> each station goes. They tap their starting drill and see the full visual, the
> objectives and, where present, the animation. Every coach has the same plan.
> Little or no verbal briefing is needed.

---

## Architecture principles

These bind every later document. Each is followed by what it rules out in this
codebase specifically.

1. **Coach workflow first.** The current schema must not force an awkward
   journey. Rules out: leaving the planner to create a drill, because
   `DrillFormModal` happens to live on other screens.

2. **Preserve useful existing functionality.** Rules out: a second grouping
   model beside `register_entries`, a second diagram model beside
   `drills.diagram`, a second lifecycle beside `sessionLifecycle.ts`, a second
   count builder beside `tonightCounts`.

3. **No big-bang rebuild.** Every phase leaves OTJ usable and deployable.

4. **One source of truth.** The coach app, the venue setup, the bib plan and any
   share output all derive from the same underlying session. Rules out: a share
   payload assembled by its own second reading of the register.

5. **Historical safety.** Adapting a drill must not silently rewrite an old
   session. Copying is preferred to versioning because a copy is unambiguous
   about what a session ran.

6. **Planning and operational preparation are different stages.** Spond enriches
   a planned session when the data arrives; it never blocks planning.

7. **Desktop for creation, phone for delivery.** Drill and session authoring may
   optimise for a laptop. Training-day delivery must be excellent on a phone.

8. **Static first, motion optional.** Creating a simple drill stays quick.

9. **Security boundaries stay explicit.** Public sharing, parent-facing
   information, Spond identities and children's data are reviewed intentionally,
   through the existing gated-migration and security-review process.

10. **Avoid speculative complexity.** No workflow engine, no version graph, no
    animation system, unless the product requirement justifies it. Where a fact
    can be derived from data already read, derive it rather than storing it: a
    derived fact cannot go stale and cannot disagree with the record.
