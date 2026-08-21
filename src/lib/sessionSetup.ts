// =====================================================================
// COACH-3, the suggested setup.
//
// One or two days out, a coach opens the session and the night is already
// drafted: how many children are expected, how many stations and groups
// that recommends, which children are in each group, and what colour each
// group wears.
//
// PURE. No React, no queries, no I/O, and NOTHING HERE PERSISTS. Every
// function below returns a suggestion the coach edits; the write happens
// on Save groups, through the existing Players and groups path, exactly as
// every other edit on that screen does. This module holds no reference to
// a mutation, a client or a table.
//
// THREE THINGS IT DELIBERATELY DOES NOT DO, each of which is the obvious
// wrong turn at this point in the programme:
//
//   It never re-derives the station count. `activityStructure.ts` answers
//   that, and a second answer here would drift from the badge a coach is
//   reading on the same night.
//
//   It never invents a second bib concept. `bibs.ts` holds the one
//   resolution rule (override, then team default, then none) and a target
//   colour is expressed as an ordinary `register_entries.bib_colour_override`
//   on Save. There is no station bib, no group bib and no group entity.
//
//   It never writes toward a child's identity. Moving a child into a
//   different group for one session says nothing about their team, their
//   default next week, or their Spond membership, so nothing in this file
//   produces a value destined for `teams`, `players` or `player_registrations`.
//
// The order of the file follows the one question it answers: how many are
// expected, what that recommends, who is in which group, and whether the
// night is ready.
// =====================================================================
import {
  ACTIVITY_STRUCTURE_WARNINGS,
  MAX_STATIONS,
  MIN_STATIONS,
  type StructuredActivity,
  deriveActivityStructure,
} from './activityStructure'
import { BIB_COLOURS, bibLabel, effectiveBib } from './bibs'
import {
  type TonightDraft,
  type TonightRow,
  draftBib,
  draftIncluded,
  hasResponseContext,
  matchesResponse,
  selectAll,
  setDraftBib,
} from './tonight'

// ---- 1. How many children are expected -------------------------------
//
// EVERY recommendation in this product runs off one number, established
// here and nowhere else in a second form. 02-target-product-model.md
// section 6.4 states the rule; this is its only implementation.
//
// Three different facts, kept apart:
//
//   RSVP STATE            what a parent answered for one child on one
//                         event: accepted, declined, unanswered, waiting.
//   RSVP CONTEXT          whether an external RSVP fact exists AT ALL for
//                         this session. No linked event, an unsettled
//                         read and a failed sync all have none.
//   OPERATIONAL INCLUSION who the coach has put in the groups. Their own
//                         record, and the only one that drives the night.
//
// A PLAYER WITH NO SPOND LINK IS NOT A FOURTH RSVP ANSWER. It means there
// is no external fact about them. They are not "unanswered", because
// nobody asked them. `matchesResponse` already refuses to match a null
// response to any reply state, which is why this file reuses it rather
// than testing the field itself. Nothing below compares `response`.

// Which population answered the question, so the screen can say why it
// said five.
//
// NEITHER BRANCH IS A DEGRADED MODE. `rsvp` and the two local sources are
// the same recommendation over different ways of learning the same number.
// A club that has never configured Spond gets the whole surface.
//
// The local branch is named at the figure it actually used rather than
// left as one word, because "the coach's own included roster" is two
// populations on the two days it matters: before the coach has ticked
// anybody it is the squad the session covers, and after they have started
// it is their selection. Collapsing those into one label would leave a
// coach reading "22 expected" unable to tell whether the app had counted
// their work or the roster behind it.
export type ExpectedSource = 'rsvp' | 'rsvp-partial' | 'included' | 'listed'

export interface ExpectedAttendance {
  count: number
  source: ExpectedSource
  // The children the count is made of, so nothing downstream can place a
  // different population from the one it reported. `count` is this
  // array's length by construction rather than by a test remembering.
  children: TonightRow[]
  // HOW THE COUNT SPLITS, and every figure named for the population it
  // actually counts. `count === goingInSpond + countedLocally`, always.
  //
  // The three are kept apart because two of them are routinely different
  // numbers and collapsing them is this product's signature defect: a
  // figure that is correct wearing a label that is about something else.
  // Four accepted beside three selected out of ten unlinked children is
  // "3", "10" and "7", and only one sentence can be built from all three.
  goingInSpond: number
  // Children with no Spond answer for THIS session: no link, or a guest
  // whose reply is a fact about their own team's event. Deliberately NOT
  // called "not linked", because a guest may well be linked and this
  // module cannot tell.
  withoutSpondAnswer: number
  // How many of those the count actually used.
  countedLocally: number
  // Which local rule produced that number.
  localSource: 'included' | 'listed'
}

// The one resolver.
//
// WITH RSVP CONTEXT the expected count is the covered players whose reply
// is accepted. Declined and unanswered do not count, and that is the
// settled decision. Waiting is treated exactly like unanswered: not
// attending, no bib, no group, and still visible under Everyone.
//
// WITHOUT RSVP CONTEXT it is the coach's own local roster. ABSENCE OF
// SPOND DATA NEVER MEANS NOBODY IS ATTENDING. A missing, unconfigured or
// failed integration reaches this function as rows carrying no response,
// which `hasResponseContext` reads as no context, and the local branch
// then answers from the roster in hand. There is no path from a broken
// integration to a zero-player recommendation: the only zero this can
// return on the local branch is a session that genuinely covers no
// registered child, which is a roster fact with its own sentence.
//
// A guest is excluded from the RSVP branch by `matchesResponse` (their
// reply is a fact about their own team's event) and included in the local
// branches, because a child standing in front of the coach is expected
// whatever the mirror knows.
export function expectedAttendance(
  rows: readonly TonightRow[],
  draft: TonightDraft,
): ExpectedAttendance {
  const unique = uniqueByPlayer(rows)
  // THE BRANCH IS PER CHILD, NOT PER SESSION, and that distinction is the
  // whole finding this function was rewritten for.
  //
  // Deciding it once for the whole session reads partial link coverage as
  // complete context: one linked child who declined, beside twenty children
  // nobody asked, produced an authoritative "0 expected". That is exactly
  // the data-gap-as-zero this resolver exists to prevent, one level down
  // from where it was being prevented. It is not hypothetical either: this
  // club has 27 of 40 children linked, so thirteen of them would never have
  // been counted as expected on any night.
  //
  // "A player with no Spond link is not a fourth RSVP answer" is the rule
  // that settles it. For a child with no external fact the RSVP source has
  // nothing to say, so the local rule answers for them, exactly as it
  // answers for a whole session with no context at all.
  //
  // hasResponseContext decides "is there something external to read", per
  // row here rather than per session, so there is still ONE definition of
  // it and no comparison is written in this file.
  const withFact = unique.filter((r) => hasResponseContext([r]))
  const withoutFact = unique.filter((r) => !hasResponseContext([r]))
  const local = localRoster(withoutFact, draft)

  if (withFact.length === 0) {
    return {
      source: local.source,
      children: local.children,
      count: local.children.length,
      goingInSpond: 0,
      withoutSpondAnswer: withoutFact.length,
      countedLocally: local.children.length,
      localSource: local.source,
    }
  }

  const going = withFact.filter((r) => matchesResponse(r, 'going'))
  const children = [...going, ...local.children]
  return {
    // Named apart, because "10 going in Spond" and "10 going plus 13 nobody
    // asked" are different claims and a coach acting on five stations
    // deserves to know which one it was.
    source: withoutFact.length === 0 ? 'rsvp' : 'rsvp-partial',
    children,
    count: children.length,
    goingInSpond: going.length,
    withoutSpondAnswer: withoutFact.length,
    countedLocally: local.children.length,
    localSource: local.source,
  }
}

// The local rule, for a set of children no external fact covers.
//
// The coach's selection once they have started, the whole set before they
// have. A generator that answers "nobody" until the coach has already done
// the work it exists to save them is worse than no generator, and 24 hours
// out the selection is empty by definition.
function localRoster(
  rows: readonly TonightRow[],
  draft: TonightDraft,
): { source: 'included' | 'listed'; children: TonightRow[] } {
  const included = rows.filter((r) => draftIncluded(draft, r.playerId))
  if (included.length > 0) return { source: 'included', children: included }
  // NOT "the squad". This set holds every child the session lists,
  // which includes a quick added guest, and `manual` says in as many words
  // that a guest is outside the covered squad. Calling them a squad member
  // is a claim the row itself contradicts.
  return { source: 'listed', children: [...rows] }
}

// A row appearing twice cannot count twice. `tonightCounts` takes the same
// precaution over the same rows for the same reason.
function uniqueByPlayer(rows: readonly TonightRow[]): TonightRow[] {
  const byPlayer = new Map<string, TonightRow>()
  for (const r of rows) if (!byPlayer.has(r.playerId)) byPlayer.set(r.playerId, r)
  return [...byPlayer.values()]
}

// The sentence that says which population the recommendation counted.
//
// Required by the brief: the screen says which source it used so the coach
// can see why it said five. Wording follows the card's existing habit of
// naming the population rather than printing a bare figure.
export function expectedAttendanceNote(expected: ExpectedAttendance): string {
  const n = expected.count
  const child = n === 1 ? 'player' : 'players'
  if (expected.source === 'rsvp') return `${n} ${child} going in Spond`
  if (expected.source === 'rsvp-partial') {
    // BOTH HALVES NAMED, AND NEITHER NAMED FOR SOMETHING IT IS NOT.
    //
    // This sentence said "and 3 not linked" while ten children were
    // unlinked and three of them were selected: a selection figure wearing
    // a link-coverage label, which is the exact shape of the defect that
    // made "19 vs 11" look like a contradiction when both numbers were
    // right. It also called a quick added guest "not linked", which this
    // module has no way to know and which is usually false.
    //
    // So the population is "no Spond answer" rather than "not linked", and
    // when the coach has started selecting, the counted figure and the
    // population it came out of are both stated rather than one standing
    // in for the other.
    const half =
      expected.localSource === 'included'
        ? `${expected.countedLocally} selected from ${expected.withoutSpondAnswer} with no Spond answer`
        : `${expected.countedLocally} with no Spond answer`
    return `${n} ${child} expected: ${expected.goingInSpond} going in Spond and ${half}`
  }
  if (expected.source === 'included') return `${n} ${child} selected`
  return `${n} ${child} on the list`
}

// ---- 2. What that recommends -----------------------------------------

// The one threshold. 24 or more recommends five stations and five groups,
// fewer recommends four.
export const FIVE_STATION_THRESHOLD = 24

export interface SetupRecommendation {
  // Four or five. NEVER three, and never zero: the bounds come from
  // activityStructure's own MIN_STATIONS and MAX_STATIONS rather than from
  // literals here, so the carousel rule has one definition.
  stations: number
  // One group per station. Stated as its own field because the brief
  // states it as its own recommendation, and because a later slice that
  // separates them should have to change this line to do it.
  groups: number
  expected: ExpectedAttendance
}

// The recommendation, from the expected count and nothing else.
//
// THE SAME RULE RUNS ON BOTH BRANCHES. There is no second threshold for a
// club without Spond, and no branch of this function reads
// `expected.source`: a club that has never configured Spond gets the same
// 4/5 answer over its own roster.
//
// It is total and it is clamped. Three stations is not reachable from any
// count, including zero, which is what the clamp exists to guarantee: an
// empty squad is a roster problem the screen names in words, not a reason
// to recommend a carousel nobody runs.
//
// IT NEVER STANDS A STATION DOWN. Recommending four where a plan declares
// five is advice about the plan, not an edit to it: `skipped` is the
// coach's own decision and nothing here produces one.
export function recommendSetup(expected: ExpectedAttendance): SetupRecommendation {
  const stations = expected.count >= FIVE_STATION_THRESHOLD ? MAX_STATIONS : MIN_STATIONS
  return { stations, groups: stations, expected }
}

// ---- 3. The groups ----------------------------------------------------

// The club's own ordering of its teams, when it has one.
//
// COACH-1 is the slice that stores it (`teams.sort_order`), and it HAS NOT
// SHIPPED: `teams` carries id, name and bib_colour and nothing else today.
// So this arrives as a parameter rather than being read off a team, and
// its absence is a first-class answer rather than a silent fallback.
//
// It is NOT an ability score and there is no per-player field. A child's
// band is derived: child, current registration, team, that team's
// position. Nothing here reads or writes a player-level rating.
export interface TeamOrder {
  // Team id to club position. A team absent from this map has no stated
  // position.
  positionByTeam: ReadonlyMap<string, number>
}

// One suggested group.
export interface SetupGroup {
  // 1-based, in plan order. GROUP 1 STARTS AT STATION 1, which is derived
  // on every read from this number rather than stored: see
  // `groupStartStation`.
  index: number
  // The colour this group should wear. Never null: a group the coach can
  // point at on the grass has a colour, and the vocabulary is long enough
  // that five groups always find five.
  colour: string
  label: string
  children: TonightRow[]
  // The teams the children came from, in first appearance order, so a
  // combined group still says whose squads it holds.
  teamNames: string[]
}

export type SetupNote =
  | 'team-order-unset'
  | 'team-order-incomplete'
  | 'teams-combined'
  | 'team-split'
  | 'fewer-groups-than-recommended'
  | 'nobody-to-place'

export const SETUP_NOTES: Record<SetupNote, string> = {
  'team-order-unset':
    'The club has not stated its team order, so teams are kept whole and not combined by ability.',
  'team-order-incomplete':
    'Some teams in this session have no stated club position, so teams are kept whole and not combined by ability.',
  'teams-combined': 'Some groups combine two teams.',
  'team-split': 'Some teams are split across groups.',
  'fewer-groups-than-recommended':
    'There are not enough players to fill every recommended group.',
  'nobody-to-place': 'Nobody is expected yet, so there is nothing to group.',
}

export interface SetupPlan {
  recommendation: SetupRecommendation
  groups: SetupGroup[]
  // False when the club's team order is unset. A fact about the club, not
  // about this session, and the reason the plan keeps teams whole rather
  // than claiming an ability adjacency it cannot know.
  bandingKnown: boolean
  notes: SetupNote[]
}

// A team's children, kept together as one unit until something forces
// otherwise. Keeping normal teams whole is the first priority.
interface TeamBucket {
  teamId: string | null
  teamName: string | null
  children: TonightRow[]
}

// The suggested setup: the count, the recommendation, and the groups.
//
// PRIORITIES, in the order 02-target-product-model.md section 6.4 states
// them and in the order the code applies them:
//
//   1. Preserve normal team continuity as far as practical.
//   2. Combine ADJACENT bands when combining is necessary.
//   3. Keep numbers sensible.
//   4. Prefer slightly uneven groups over unnecessarily splitting a normal
//      team. 6/5/5/4 beats 5/5/5/5 bought by breaking up two squads.
//
// Priority 2 needs the club's order. WITHOUT IT THE PLAN DEGRADES HONESTLY
// rather than guessing: teams stay whole, any combining falls back to the
// order the rows arrived in, and `bandingKnown` is false so the screen can
// say the order is unset. It does not silently treat alphabetical as
// ability, which for this club matches nowhere.
export function planSetup(
  rows: readonly TonightRow[],
  draft: TonightDraft,
  order?: TeamOrder | null,
): SetupPlan {
  const recommendation = recommendSetup(expectedAttendance(rows, draft))
  // BANDING IS KNOWN ONLY WHEN THE ORDER COVERS EVERY TEAM THIS SESSION
  // HOLDS, not merely when an order exists.
  //
  // A partial order is the dangerous shape: `bucketByTeam` places the teams
  // it does not mention by ARRIVAL order behind the ones it does, and
  // `fitToTarget` then combines "adjacent" pairs out of that mixture. With
  // `bandingKnown` true and the note suppressed, the plan claimed an
  // ability adjacency it could not know for the teams that were missing.
  // Reading a partial answer as a complete one is the same mistake as
  // reading absence as zero, one field along.
  //
  // A child with no team is not counted against this: the club's ordering
  // of its teams cannot be expected to place somebody who is on none of
  // them.
  const positions = order?.positionByTeam
  const teamIds = new Set(
    recommendation.expected.children
      .map((c) => c.teamId)
      .filter((id): id is string => id !== null),
  )
  const positioned = positions !== undefined && positions.size > 0
  const complete = positioned && [...teamIds].every((id) => positions.has(id))
  const bandingKnown = complete
  const notes: SetupNote[] = []
  // Two different facts, and the sentence says which: the club has stated
  // nothing at all, or it has stated something that does not reach every
  // team on the pitch tonight.
  if (!positioned) notes.push('team-order-unset')
  else if (!complete) notes.push('team-order-incomplete')

  const buckets = bucketByTeam(recommendation.expected.children, order)
  if (buckets.length === 0) {
    notes.push('nobody-to-place')
    return { recommendation, groups: [], bandingKnown, notes }
  }

  const units = fitToTarget(buckets, recommendation.groups)
  const groups = colourGroups(units)
  // DERIVED FROM THE GROUPS THEMSELVES, never from what the fit did on the
  // way there. Merging two buckets is not the same fact as a group holding
  // two teams: five children with no team are five buckets, so reaching
  // four groups merges twice while no group holds a second team, and the
  // note told the coach their squads had been combined when none had. The
  // same applies to splitting. Reading the output cannot make that mistake.
  const seen = new Map<string, number>()
  for (const g of groups) {
    if (g.teamNames.length > 1) notes.push('teams-combined')
    for (const name of g.teamNames) seen.set(name, (seen.get(name) ?? 0) + 1)
  }
  if ([...seen.values()].some((n) => n > 1)) notes.push('team-split')
  if (groups.length < recommendation.groups) notes.push('fewer-groups-than-recommended')
  return { recommendation, groups, bandingKnown, notes: [...new Set(notes)] }
}

// Children grouped by team, in CLUB ORDER when the club has stated one.
//
// Without an order the buckets keep the order the rows arrived in, which
// is the register's own composition order. That is not an ability order
// and is not claimed to be: `bandingKnown` says so, and combining two
// adjacent buckets then means only "these two were next to each other on
// the list", which the note states in words.
//
// A child with no team is their own bucket, because they are still a child
// of the club and belong on the grass. They are never merged into a team's
// identity.
function bucketByTeam(children: readonly TonightRow[], order?: TeamOrder | null): TeamBucket[] {
  const byTeam = new Map<string, TeamBucket>()
  for (const c of children) {
    // A team id is a uuid, so this prefix cannot collide with one. Each
    // unassigned child keys to themselves, which is what makes them their
    // own bucket rather than one shared "no team" squad.
    const key = c.teamId ?? `unassigned:${c.playerId}`
    let bucket = byTeam.get(key)
    if (!bucket) {
      bucket = { teamId: c.teamId, teamName: c.teamName, children: [] }
      byTeam.set(key, bucket)
    }
    bucket.children.push(c)
  }
  const buckets = [...byTeam.values()]
  const positions = order?.positionByTeam
  if (!positions || positions.size === 0) return buckets
  // A stable sort, so teams the club has not positioned keep their arrival
  // order behind the ones it has rather than being reshuffled arbitrarily.
  return buckets
    .map((b, i) => ({ b, i }))
    .sort((x, y) => {
      const px = x.b.teamId === null ? undefined : positions.get(x.b.teamId)
      const py = y.b.teamId === null ? undefined : positions.get(y.b.teamId)
      if (px === undefined && py === undefined) return x.i - y.i
      if (px === undefined) return 1
      if (py === undefined) return -1
      return px - py || x.i - y.i
    })
    .map((x) => x.b)
}

// Turn the team buckets into exactly `target` units where it can.
//
// TOO MANY TEAMS: combine ADJACENT buckets, taking the smallest adjacent
// pair each time. Only adjacent pairs are ever considered, which is what
// makes the club's order matter and what keeps two ends of the order from
// being put on one station.
//
// TOO FEW TEAMS: split the largest bucket, repeatedly. A bucket of one
// child cannot be split, so a club with fewer children than groups ends up
// with fewer groups and says so rather than inventing empty ones.
//
// PRIORITY 4 IS WHY SPLITTING IS THE LAST RESORT. Combining leaves teams
// whole and produces uneven groups; splitting produces even ones by
// breaking up a squad. The brief prefers 6/5/5/4, so combining is tried
// first and splitting happens only when there are not enough buckets to
// reach the target at all.
function fitToTarget(buckets: TeamBucket[], target: number): TeamBucket[][] {
  let units: TeamBucket[][] = buckets.map((b) => [b])

  while (units.length > target) {
    let best = 0
    let bestSize = Number.MAX_SAFE_INTEGER
    for (let i = 0; i < units.length - 1; i++) {
      const size = unitSize(units[i]) + unitSize(units[i + 1])
      if (size < bestSize) {
        bestSize = size
        best = i
      }
    }
    units = [
      ...units.slice(0, best),
      [...units[best], ...units[best + 1]],
      ...units.slice(best + 2),
    ]
  }

  while (units.length < target) {
    let best = -1
    let bestSize = 1
    for (let i = 0; i < units.length; i++) {
      if (unitSize(units[i]) > bestSize) {
        bestSize = unitSize(units[i])
        best = i
      }
    }
    // Nothing left that can be split without emptying a group.
    if (best === -1) break
    const unit = units[best]
    const half = Math.ceil(unitSize(unit) / 2)
    const flat = unit.flatMap((b) => b.children.map((c) => ({ b, c })))
    const head = rebuild(flat.slice(0, half))
    const tail = rebuild(flat.slice(half))
    units = [...units.slice(0, best), head, tail, ...units.slice(best + 1)]
  }

  return units.filter((u) => unitSize(u) > 0)
}

function unitSize(unit: TeamBucket[]): number {
  return unit.reduce((n, b) => n + b.children.length, 0)
}

// Reassemble a slice of children back into buckets, preserving which team
// each came from so a split group still names both squads.
function rebuild(entries: { b: TeamBucket; c: TonightRow }[]): TeamBucket[] {
  const out: TeamBucket[] = []
  for (const { b, c } of entries) {
    let bucket = out.find((o) => o.teamId === b.teamId && o.teamName === b.teamName)
    if (!bucket) {
      bucket = { teamId: b.teamId, teamName: b.teamName, children: [] }
      out.push(bucket)
    }
    bucket.children.push(c)
  }
  return out
}

// Give every group a UNIQUE colour, taken in the fixed vocabulary order.
//
// A group whose children already share a team default keeps it where it is
// still free, which is what stops the suggestion rewriting a club's
// established colours for no reason and keeps the number of stored
// overrides as small as it can be. Everything else takes the next free
// colour in `BIB_COLOURS` order.
//
// Uniqueness is the point: two groups sharing a colour are one group on
// the grass, because the register resolves groups BY colour. There are
// nine colours and at most five groups, so a free one always exists.
function colourGroups(units: TeamBucket[][]): SetupGroup[] {
  const taken = new Set<string>()
  const preferred = units.map((unit) => {
    const wanted = unit[0]?.children[0]?.teamBib ?? null
    const shared = unit.every((b) => b.children.every((c) => c.teamBib === wanted))
    return shared ? wanted : null
  })

  // First pass: honour the teams that can keep their own colour.
  const colours: (string | null)[] = units.map(() => null)
  preferred.forEach((want, i) => {
    if (want && !taken.has(want) && BIB_COLOURS.some((b) => b.value === want)) {
      colours[i] = want
      taken.add(want)
    }
  })
  // Second pass: everyone else takes the next free colour in vocabulary
  // order, so the assignment is deterministic and reads the same twice.
  colours.forEach((colour, i) => {
    if (colour !== null) return
    const free = BIB_COLOURS.find((b) => !taken.has(b.value))
    if (!free) return
    colours[i] = free.value
    taken.add(free.value)
  })

  // NUMBERED IN BIB VOCABULARY ORDER, which is what tonightGroups sorts the
  // saved groups by. Numbering in unit order instead put the plan's group 1
  // and the screen's group 1 on different colours the moment a team kept a
  // default that sits late in the vocabulary: a plan reading green, purple,
  // red, blue against a screen reading red, blue, green, purple. Since
  // `groupStartStation` is `index`, that is two different answers to which
  // group starts at station 1, about one night.
  const ordered = units
    .map((unit, i) => ({ unit, colour: colours[i] }))
    .filter((u): u is { unit: TeamBucket[]; colour: string } => u.colour !== null)
    .sort((a, b) => colourRank(a.colour) - colourRank(b.colour))

  return ordered.map(({ unit, colour }, i) => {
    const teamNames: string[] = []
    for (const b of unit) if (b.teamName && !teamNames.includes(b.teamName)) teamNames.push(b.teamName)
    return {
      index: i + 1,
      colour,
      label: `${bibLabel(colour) ?? colour} bibs`,
      children: unit.flatMap((b) => b.children),
      teamNames,
    }
  })
}

// A colour's position in the club vocabulary. The same ordering
// tonightGroups applies to the saved groups, so the plan and the screen
// number one night the same way.
function colourRank(colour: string): number {
  const i = BIB_COLOURS.findIndex((b) => b.value === colour)
  return i === -1 ? BIB_COLOURS.length : i
}

// ---- 4. What the plan says, and what it would store ------------------

// Group 1 starts at station 1, group 2 at station 2, and so on.
//
// DERIVED ON EVERY READ. There is no stored starting station, no rotation
// direction and no configuration for either: the statement is a fact about
// the group's position in the plan, and storing it would be a second
// answer that can drift from the first.
export function groupStartStation(group: SetupGroup): number {
  return group.index
}

// The bib overrides this plan would put in the draft, and nothing else.
//
// THE ONLY VALUES THIS PRODUCES ARE `register_entries.bib_colour_override`
// values for children already on this session. There is no team write, no
// registration write, no player write and no Spond write anywhere in this
// module, which is asserted directly in the tests because a well-meaning
// "also update their team" convenience is the most plausible regression in
// the programme.
//
// A child whose EFFECTIVE bib already resolves to the group's colour gets
// NO override: the canonical resolver already answers correctly for them,
// and writing one would pin a child to a colour their team later moves
// away from. That is the whole reason this returns a sparse map rather
// than a colour per child.
export function planBibTargets(plan: SetupPlan): Record<string, string | null> {
  const out: Record<string, string | null> = {}
  for (const group of plan.groups) {
    for (const child of group.children) {
      // Null means INHERIT: the team default already resolves to this
      // group's colour, so the row stores nothing and a later change of
      // team default still moves the child. `effectiveBib` decides that,
      // never a comparison written here.
      out[child.playerId] = effectiveBib(null, child.teamBib) === group.colour ? null : group.colour
    }
  }
  return out
}

// Which of those targets differ from what the draft currently resolves to,
// so a screen can say how many children the suggestion actually moves.
//
// DERIVED FROM THE TARGETS, never computed beside them. This is a display
// question; `planBibTargets` is the gesture, and a second rule producing a
// slightly different set is how a screen comes to promise one thing and
// save another.
export function planBibChanges(plan: SetupPlan, draft: TonightDraft): Record<string, string | null> {
  const out: Record<string, string | null> = {}
  for (const [playerId, target] of Object.entries(planBibTargets(plan))) {
    const child = plan.groups.flatMap((g) => g.children).find((c) => c.playerId === playerId)
    const current = effectiveBib(draftBib(draft, playerId), child?.teamBib ?? null)
    if (current !== effectiveBib(target, child?.teamBib ?? null)) out[playerId] = target
  }
  return out
}

// ---- 5. What the plan says about the coach's own session plan --------

// How the declared stations compare with what attendance recommends.
//
// ZERO IS TWO DIFFERENT FACTS and they are never collapsed: a plan that
// declares no station at all is a plan written before COACH-2 existed, or
// one nobody has marked up yet; a plan whose every declared station is
// stood down is a coach's decision. Reading the second as the first would
// tell a coach to declare stations they have already declared.
// `running` and `declared` are DIFFERENT NUMBERS and both are carried.
//
// The comparison is against the stations that actually run, which is the
// only figure attendance can be weighed against. But the field holding it
// was called `declared`, so a plan declaring five with one stood down
// reported `declared: 4` and `matches` against a recommendation of four:
// a false structural claim about the coach's own plan, made by the field
// name rather than by the arithmetic. The arms are named for running too,
// for the same reason.
export type StationFit =
  | { kind: 'matches'; running: number; declared: number; recommended: number }
  | { kind: 'plan-runs-more'; running: number; declared: number; recommended: number }
  | { kind: 'plan-runs-fewer'; running: number; declared: number; recommended: number }
  | { kind: 'no-stations-declared'; running: 0; declared: 0; recommended: number }
  | { kind: 'all-stations-stood-down'; running: 0; declared: number; recommended: number }

// The COACH-2 seam, CONSUMED AND NEVER RE-DERIVED.
//
// `deriveActivityStructure` is the one answer to how many stations run
// tonight, and it is the answer the coach is already reading as a badge on
// the planner. Counting them again here would produce a second number that
// could disagree with the first, on the same night, about the same plan.
//
// IT IS ADVICE AND ONLY ADVICE. It changes no activity, stands nothing
// down, moves no group and blocks no save. Recommending four where a plan
// declares five is a sentence, not an edit: which station does not run is
// the coach's call and COACH-2B already gives them the control to make it.
export function stationAdvice(
  recommendation: SetupRecommendation,
  activities: readonly StructuredActivity[] | null | undefined,
): StationFit {
  const structure = deriveActivityStructure(activities ?? [])
  const recommended = recommendation.stations
  const declared = structure.declaredStations.length
  if (declared === 0) {
    return { kind: 'no-stations-declared', running: 0, declared: 0, recommended }
  }
  const running = structure.stationCount
  if (running === 0) {
    return { kind: 'all-stations-stood-down', running: 0, declared, recommended }
  }
  if (running === recommended) return { kind: 'matches', running, declared, recommended }
  return {
    kind: running > recommended ? 'plan-runs-more' : 'plan-runs-fewer',
    running,
    declared,
    recommended,
  }
}

// The sentence for that comparison, and nothing when there is none to make.
//
// The two zero arms return the planner's OWN wording verbatim rather than a
// second phrasing of the same fact, so a coach who read it on the plan
// reads the same sentence here.
export function stationFitNote(fit: StationFit): string {
  if (fit.kind === 'matches') return ''
  if (fit.kind === 'no-stations-declared') return ACTIVITY_STRUCTURE_WARNINGS['no-stations-declared']
  if (fit.kind === 'all-stations-stood-down') {
    return ACTIVITY_STRUCTURE_WARNINGS['all-stations-stood-down']
  }
  return `This plan runs ${fit.running} stations and the numbers suggest ${fit.recommended}.`
}

// ---- 6. Accepting the suggestion --------------------------------------

// Put the plan into the draft, as A DRAFT EDIT AND NOTHING ELSE.
//
// IT PERSISTS NOTHING. It returns a new draft; that draft reaches storage
// only through Save groups, which is the existing rule and is not changed
// here. Nothing in this module holds a mutation.
//
// IT GOES THROUGH THE EXISTING GESTURE HELPERS, which is not a style
// preference. `selectAll` and `setDraftBib` stamp `draft.touched`, and
// `touched` is how `draftDelta` recognises a change at all: a draft
// assembled by writing `included` and `bibs` directly would look identical
// and send NOTHING on save, or worse, let a frozen seed overwrite another
// coach's edit on a field this coach never touched. A generated gesture
// stamps exactly what a tap stamps.
//
// IT IS STRICTLY ADDITIVE. `selectAll` only ever sets inclusion true, so
// this can add a child to the groups and can never remove one. A child who
// is no longer coming is COACH-4's business, and nothing in this slice
// unticks anybody.
//
// IT SETS NO ATTENDANCE. Being in a group and having turned up are the two
// facts 0047 separated, and a suggestion made a day early knows nothing
// about the second.
export function applySetup(draft: TonightDraft, plan: SetupPlan): TonightDraft {
  const children = plan.groups.flatMap((g) => g.children)
  let next = selectAll(draft, [...children])
  // EVERY PLACED CHILD, not only the ones whose value differs from this
  // draft, and that is a correctness rule rather than a tidiness one.
  //
  // The draft is frozen when the screen opens while the stored rows keep
  // refetching, and `draftDelta` deliberately carries the STORED value
  // forward for any field this coach did not touch. So a child the plan
  // leaves alone because the frozen draft already agrees is a child whose
  // bib another coach may have changed since: the save then writes their
  // value, the plan's colour never lands, and nothing says so. Stamping the
  // gesture for every child makes accepting the plan mean what it says.
  //
  // It costs nothing to store. A target of null is the inherit gesture, and
  // draftDelta only marks the field changed when there is actually an
  // override to clear, so a whole team following its default still writes
  // no row.
  for (const [playerId, colour] of Object.entries(planBibTargets(plan))) {
    next = setDraftBib(next, playerId, colour)
  }
  return next
}

// ---- 7. Readiness -----------------------------------------------------

export type SetupIssue = 'child-without-bib' | 'groups-share-colour'

// Each issue names the fix, because "not ready" without one is a coach
// standing in a car park being told they have a problem.
export const SETUP_ISSUE_FIXES: Record<SetupIssue, string> = {
  'child-without-bib':
    'Some selected players have no bib colour. Give them one, or set a default colour on their team.',
  'groups-share-colour':
    'Two groups are wearing the same colour, so they run as one. Give one of them a different bib.',
}

export interface SetupReadiness {
  ready: boolean
  issues: SetupIssue[]
}

// Is the night ready to run?
//
// Derived from what is actually arranged, never from the suggestion: a
// coach who accepted the plan and then edited it is looking at their own
// work, and readiness has to describe that.
//
// TWO CONDITIONS, both stated by the brief:
//
//   A selected child with no effective bib. They have nothing to wear and
//   no group to stand in.
//
//   Two groups sharing a colour. The register resolves groups BY effective
//   colour, so two groups in one colour are one group on the grass. The
//   symptom is that the selected children resolve to fewer distinct
//   colours than there are groups to fill, which is what this measures.
//
// An empty selection is not "not ready", it is not started, and it has its
// own sentence elsewhere. Reporting an issue over nobody would put a
// warning on every session the moment it was opened.
export function setupReadiness(
  rows: readonly TonightRow[],
  draft: TonightDraft,
  intendedGroups: number,
): SetupReadiness {
  const selected = uniqueByPlayer(rows).filter((r) => draftIncluded(draft, r.playerId))
  if (selected.length === 0) return { ready: true, issues: [] }

  const issues: SetupIssue[] = []
  const colours = new Set<string>()
  let bibbed = 0
  let withoutBib = false
  for (const r of selected) {
    const bib = effectiveBib(draftBib(draft, r.playerId), r.teamBib)
    if (bib === null) withoutBib = true
    else {
      bibbed++
      colours.add(bib)
    }
  }
  if (withoutBib) issues.push('child-without-bib')
  // MEASURED OVER THE CHILDREN WHO ACTUALLY HAVE A BIB, which is the whole
  // difference between naming the right fix and the wrong one.
  //
  // Counting every selected child made a shortage of BIBS look like a
  // shortage of COLOURS: four children in red, blue, green and yellow plus
  // one with no bib, against five groups, raised both issues and told the
  // coach to change a bib that was not duplicated. Two groups share a
  // colour only if the bibbed children are numerous enough to fill the
  // groups and still resolve to fewer colours than there are groups.
  //
  // This also subsumes the too-few-players guard it replaces: a coach who
  // has selected three children for five groups can never have three or
  // more bibbed ones and so can never reach this.
  if (bibbed >= intendedGroups && colours.size < intendedGroups) {
    issues.push('groups-share-colour')
  }
  return { ready: issues.length === 0, issues }
}
