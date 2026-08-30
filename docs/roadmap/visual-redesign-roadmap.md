# OTJ visual redesign roadmap

Status: approved direction. VISUAL-00 delivered; VISUAL-01 is next and implementation has not started.

Created: 27 August 2026. VISUAL-00 completed 27 August 2026.

This document defines the visual redesign programme for OTJ Training Hub. The master roadmap remains the source of truth for priority and status; this file owns the detailed visual-redesign sequence and acceptance criteria.

## Purpose

Refresh OTJ's visual system and interaction presentation without destabilising the product behaviour that has already been built and tested.

The redesign is not a rewrite. It must preserve the existing React/Supabase architecture, routes, permissions, data semantics, security boundaries and business logic unless a separate product change is explicitly scoped.

## Entry gate

Start the redesign from a stable application baseline.

1. PLAYERS-01 / PR #191 must be merged, because it changes `Players.tsx`, `Activity.tsx`, `BulkDeletePlayersModal.tsx` and `src/styles.css`.
2. PR #196, the small Drill Maker blank-surface default, should be closed before redesign work changes Drill Maker presentation.
3. Normal CI on `main` must be green after those changes.

Both gates closed on 27 August 2026. PR #191 merged, then PR #196 merged, and the push CI on `main` at `434f67f` completed green across all eight jobs (lint, typecheck and build, test, edge functions, security policy suite, and the migration, deploy and content-sharing script suites). The Design Read was captured against that commit.

The redesign does **not** wait for DRILL-02b, the later coaching migrations, public Training Day sharing, or every other roadmap feature. New feature work should inherit the new visual system once the foundation lands rather than extending the old one indefinitely.

## Programme

### VISUAL-00 — Design Read

**Outcome.** A written target visual language grounded in the actual OTJ application before implementation changes any pixels.

**Scope.** Review the live code, `design-reference/`, `src/styles.css`, app shell, mobile navigation, representative route families, existing dark/live modes, forms, tables, dialogs and touch interactions. Record:

- typography and type scale;
- colour roles and contrast rules;
- spacing and density;
- cards, panels, separators and elevation;
- buttons, chips, toggles and form controls;
- tables and mobile-card equivalents;
- page headings and action hierarchy;
- desktop shell, phone shell and bottom navigation;
- modal/sheet treatment;
- loading, empty, error, warning, success and destructive states;
- focus, keyboard, touch target and non-colour cue requirements;
- what remains recognisably OTJ rather than becoming a generic component-library skin.

**Non-goals.** No app code, CSS or persistence changes. Do not redesign from screenshots alone or from the old prototype alone; both are evidence, not current truth.

**Acceptance.** The document identifies representative screens for each surface family and makes enough decisions that VISUAL-01 is implementation rather than another design discovery round.

**Delivered** in #210 as `docs/design/visual-design-read.md`, captured against `main` at
`434f67f`. Part 1 is the current-state audit, counted from source rather than
estimated. Part 2 settles every item in the Scope list above as a decision
VISUAL-01 implements rather than reopens. Part 3 records what stays recognisably
OTJ. Part 4 names the acceptance screens and the seven viewport widths for
VISUAL-01, 02 and 03. Part 5 records seven open product decisions that evidence
could not settle; none of them blocks VISUAL-01.

The findings that most shape VISUAL-01: there is no type scale (25 distinct font
sizes, seven of them half-pixel) and no spacing scale (31 distinct non-zero
values); there are no semantic state tokens, so destructive borrows the PDF media
colour, success borrows the physical corner colour and warning borrows the social
corner colour; `.theme-dark` flips only the 12 neutral and shadow tokens, so
every brand and semantic hue is theme-invariant, which puts `--royal` links at
2.21:1 on the dark card and inherited note text on an unflipped `--gold-soft`
panel at 1.01:1; there are no control primitive components, only 350
hand-written class strings across 26 combinations; and the newer mobile-first
screens have already discovered the right touch-target rules and encoded them
locally, as 14 control-size rules across eight stylesheets inventing six
different heights (28, 34, 38, 40, 42 and 44px), none of them the shared value,
one of them in the shared stylesheet itself.

### VISUAL-01 — Foundation and shell

**Outcome.** OTJ has one coherent visual system and application shell. A large part of the product looks materially refreshed before route-by-route work begins.

**Scope.** Consolidate or replace common visual tokens and primitives for:

- typography;
- spacing;
- surfaces and borders;
- buttons and icon buttons;
- inputs, selects and text areas;
- chips, badges and toggles;
- cards and panels;
- tables/list rows;
- dialogs/sheets;
- page title/action patterns;
- focus and disabled states;
- responsive breakpoints.

Then apply them to the shared shell: sidebar, top bar, content frame and mobile bottom navigation.

**Boundary.** This is presentation work. No route changes, permission changes, Supabase changes, query changes or feature redesigns are allowed merely to make the new shell easier.

**Acceptance.** Existing behaviour tests stay green. Desktop and phone navigation remain functionally identical. The shell, primitive states and core responsive behaviour are visually checked before the next wave.

### VISUAL-02 — Stable everyday surfaces

**Outcome.** The main routes coaches and admins use today consistently use the new system.

**Initial surface group.** Home, Sessions, Registered Players, Activity, Login/account, Feedback and stable admin screens.

Home, Sessions and Login also appear as VISUAL-01 acceptance surfaces in `docs/design/visual-design-read.md`. That is a split of verbs rather than a conflict: VISUAL-01 checks them to prove the primitives and the shell, and VISUAL-02 adopts them in full, including the state matrix each one owns. The Design Read's Part 4 states the split.

Players is deliberately in this wave only after #191, so bulk selection, dependency preview and destructive confirmation are redesigned once against their final application behaviour rather than being restyled on a moving branch.

**Acceptance.** Every surface covers normal, loading, empty, error, read-only/permission-limited and narrow-phone states where those states are reachable. Destructive flows remain unmistakably destructive and preserve their existing confirmation semantics.

#### Registered Players: complete

Registered Players was adopted in three passes: the surface itself, then its page header's action hierarchy, then the six dialog files and the row overflow's item height. Every state the Design Read's Part 4 names for this screen is covered.

One screen a coach reaches from it is deliberately not in that: `/players/spond-links` is its own route with its own stylesheet, it is absent from Part 4's acceptance list, and nothing here touched it. It belongs to whichever slice reaches the Spond admin surfaces.

The third pass closed both items the second one deliberately deferred:

- **The six remaining dialog files.** `PlayerFormModal` (add and edit), `PlayerActionModals` (move team, withdraw, restore, delete permanently and import from Spond, five dialogs in one file), `PlayerHistoryModal`, `ExportConfirmModal`, `ImportPlayersModal` and `RenewSeasonModal` were left on their own local treatment. Six files, eleven dialogs; the count that matters for the slice is the files. They are not in the Design Read's Part 4 acceptance list, they carried 56 inline font sizes between them, and adopting them alongside the surface would have made one reviewable PR into two unreviewable ones. The bulk delete dialog was already adopted, so the pattern to follow was written down. They now use `Button`, the field primitives, `Note`, `Badge` and one shared dialog prose vocabulary; the invariant test's ownership list covers all six, so a size cannot come back.
- **The row overflow menu's item height.** `.menu-list button` was roughly 37px against the product's own `--hit: 44px`. The 44px minimum is the shared `.menu-list` rule now, so the row menus and the page header's overflow take it from one place and cannot drift apart again. It is a real `min-height` rather than a pseudo-element, because the items stack with a 2px gap and an overhanging hit box would reach into a neighbouring destructive action.

Three things the third pass found and fixed, none of them presentation alone:

- The Renew preview said Eligible in `#16a34a` and Withdrawn in `#ef8e1b`, which are `--c-physical` and `--c-social` written out as literals. That is exactly the borrowing 2.2 forbids, and no scan of `var(--c-*)` could see it. They are `Badge` tones now, and a new invariant test hunts the quoted hexes.
- The import preview's Already present pill was `--slate-2` under a white label at 3.80:1, which is the token VISUAL-01 demoted to a non text role. Every pill fill is now measured against its own label in both themes.
- The Import players dialog rendered its Cancel and Import buttons inside the scrolling body rather than in the dialog's footer, so on a phone, where 2.13 makes a form dialog a bottom sheet, they scrolled away under a preview of up to five hundred rows.

Two things about the header hierarchy that are decisions rather than omissions, so a later slice does not undo them by accident. The overflow applies at every width rather than below a breakpoint, because measurement showed the action row fits on one line at no width the product is used at and 901px, where the sidebar returns and the content column drops to 589px, was the worst case on the page; the reasoning and the numbers are in `src/lib/playersView.ts` beside the partition. And the popup is a disclosure rather than an ARIA menu, which is the same deliberate deviation from 2.13 the row menus already carry and for the same stated reason.

#### Activity: complete

The club wide audit feed now uses the shared system. Every state the Design Read's Part 4 names for this screen is covered: the CSS only row to card reflow at 900px, the desktop inline filters against the phone filter dialog, Load more, both empty states, and long actor and entity names. The general VISUAL-02 state requirement is covered too: normal, loading, empty, error, permission limited and narrow phone.

What the slice adopted: `PageHeader` for the heading and its one action, `Button` for the six hand written class strings, the `TextField` and `SelectField` primitives for the eight filters, `Note` for the batch deep link's own notice, `LoadingRows` for the load, and `ErrorNote` with a retry for the failure. The one remaining inline font size on the page (the batch note at 13.5px) is gone, so `routes/Activity.tsx` joins the design system invariant's ownership list and a size cannot come back.

Two things it deliberately did not do. It wrapped nothing new in a `Card`, because containment needs a reason and the feed's rows already become bordered cards at the breakpoint. And it changed no filter semantics: `batchId` is still the one URL persisted dimension, the other seven are still page state, a batch link still composes with whatever else is applied, and Clear filters still clears both halves.

Four things worth recording, none of them presentation alone:

- **The batch link had no touch target.** It is the one interactive control inside a row's meta line and its visible pill is 18px tall. It takes its 44px hit area from a pseudo-element now, exactly as `.btn-sm` does, and the card layout gained a full spacing step under the meta row so that box cannot reach the View history button beneath it. `checks.mjs` measures both, and the existing neighbour overlap check now covers the feed.
- **Its glyph had no size once the inline style went.** The batch reference and the per row batch chip are two different elements and only one of them was a `.activity-chip`, so a rule scoped to that class sized one and left the other laying out at the line's width. Found by measuring in the browser, not by reading the diff.
- **The filter controls now have real labels bound to them.** They were a styled span beside each control, with no `id`, because the same component mounts twice (the inline bar and the dialog) and both are in the document at once below 900px. `useId` makes the two sets disjoint, which is what makes a real `<label for>` safe here; a test renders both copies together and compares the id sets.
- **The information boundary is asserted rather than assumed.** The feed is child name free by design, and a visual pass is exactly the kind of change that could leak a name by resolving one for a label. `src/routes/activity.screens.test.tsx` renders the page in eight states with the identity map populated and asserts the name is absent from every one, and `checks.mjs` opens the gated History dialog in a browser to prove the name reaches that dialog and nothing else. `audit.view` and `players.view` stay two boundaries: the `auditor` capability set in the harness holds the first without the second, and every player reference falls closed to a neutral label with no history offered and no deletion claimed.

One class moved rather than being copied: `.reg-empty-action` became the shared `.empty-action`, because Activity's filtered empty state had reached the same rule and a second name for it is the problem the programme exists to remove.

#### Account: complete

The self service screen now uses the shared system. Its Design Read acceptance is forms, avatar upload, success and error, and every one of those is covered; the general VISUAL-02 requirement is covered too: normal, loading, capability limited, narrow phone, and both themes.

What the slice adopted: `PageHeader` for the heading, `Card` for the five contained sections, `Button` for the seven hand written class strings, `TextField` and `SelectField` for the five fields, and `Note` for every message the screen can produce. The page carried sixteen inline font sizes, five card paddings, two semantic colours written as `var(--danger)` and `var(--success)` on plain text, and one fifteen declaration list row written out twice; `routes/Account.tsx` joins the design system invariant's ownership list, so a size cannot come back.

What it deliberately did not do. It changed no query, no capability test, no auth client call and no message string. It kept the two destination lists as buttons that navigate rather than turning them into links, because the destinations are what the brief froze and a link is a different control. And it added no account removal affordance: that stays admin owned, is stated in the Membership card rather than offered, and its absence is now asserted for every capability set.

Five things worth recording, none of them presentation alone:

- **Three of the four successes dropped focus onto the document body, and getting that right took three attempts.** Remove photo unmounts with the photo it removed; Save goes inert because the name now matches; and the two Security submits go inert because they empty their own fields. A browser blurs a focused control when it is disabled or removed, so a coach who clicked rather than pressed Enter lost their place. Calling `.focus()` in the success callback fixed none of it: TanStack runs a per-call `onSuccess` inside its notify batch BEFORE it notifies its listeners, so React has not re-rendered, the control still carries the in-flight render's `disabled`, and focusing a disabled control is a no-op. And placing it unconditionally on the settled render was worse than the defect, because only the photo actions are disabled during a removal: a coach who moved into another field while the write was in flight had focus taken back off them. The rule that survived is one `useFocusRestore(settled, ref)`: the callback requests, the effect on the settled render places it, and it places it ONLY when `document.activeElement` is the body or nothing, which is what the browser leaves behind when the control it was on is disabled or removed. Both halves are driven in `checks.mjs`, restore and no-steal, and both fail under mutation.
- **Success and failure were carried by colour alone.** `NoteLine` was a `<p class="muted">` with `color` set to `--danger` or `--success` and no icon, no border and no live region, which is the shape 2.4 and 2.14 exist to replace. Both are the shared `Note` now, with the glyph its tone carries and `role="alert"` or `role="status"`. Every message string is unchanged.
- **The team hint became the field's own hint.** It was a muted paragraph under the select; it is `SelectField`'s `hint` now, so it is wired to the control through `aria-describedby` rather than merely sitting near it.
- **The harness could not tell a stale build from a fresh one.** `fresh.mjs` compared the SERVED assets against the last build and said nothing about whether that build was of the current source, so editing a rule in `styles.css` and running a tool measured the previous rule and reported it clean. That happened on this slice and was found by watching a fixed layout still report the old one. It now refuses a build older than the bundle's inputs: `src/`, the harness entry, fixtures and stubs, the Vite config, every TypeScript config and the two package manifests, listed rather than globbed so the three Playwright runners are not their own inputs. A missing listed input is stale rather than absent and a directory's own mtime seeds its walk, because deleting a file moves no surviving sibling's. The BUILD ENVIRONMENT is deliberately not on that list: `src/lib/storageUpload.ts` was the last module in the bundle reading `import.meta.env`, it reaches Supabase and so belonged in the stub list by the config's own rule, and with it stubbed the built assets are byte identical across three different values of `VITE_SUPABASE_URL`. Two rules are derived from source rather than restated, so neither list can go quietly out of date: every `tsconfig*.json` at the repo root must be a listed input, and every file under `src/` that reads `import.meta.env` must be stubbed.

- **The harness's own timing was part of what it proved, and the first version of it was wrong.** `useCallbackWrite` called `onSuccess` with `isPending` never set, so every control was enabled and a check could pass on a focus repair that did nothing in production. It goes through the pending render now, firing the callback while the control is still disabled, on a timeout rather than a microtask because what has to have happened is React's commit. `writeslow` and `photoslow` are a write that SETTLES rather than hangs, which `inflight` cannot be, and they are what makes the no-steal half reachable at all.

Two capability sets were added to the harness rather than widening existing ones, because `users.manage` adds a sidebar item and a widening moves every shot the set already takes. `planner` is `sessions.create` alone, the variant with the Default team control and no Admin card. `clubadmin` holds `users.manage`, which neither `coach` nor `admin` does: those two are the partial administrative case that is offered Club, Teams and Spond and not Users, and it is the case a capability gated list is most likely to get wrong.

### VISUAL-03 — Feature-area waves

**Outcome.** Feature areas whose product behaviour is still evolving are redesigned with, not immediately before, their functional work.

Use the foundation for later waves rather than freezing all feature development until the redesign is complete:

- Planner and week-plan authoring alongside the COACH-11/12/13 authoring work;
- Training Day and richer session setup alongside COACH-5/6/7/8;
- Drill Maker, now that #196 has merged, when further authoring changes are actually scheduled;
- public/share surfaces after DRILL-02b settles their payload and boundary;
- Live surfaces coordinated with LIVE-01/02 and accessibility requirements.

Each feature PR must use the shared design system rather than introduce a local replacement vocabulary.

### VISUAL-04 — Whole-product visual QA

**Outcome.** The redesigned product is coherent as a system rather than a collection of individually polished screens.

Run a final cross-product pass covering:

- small iPhone portrait first, then wider phones, tablet and desktop;
- light/dark/live modes where applicable;
- long names and long copy;
- loading, empty, offline/error and destructive states;
- keyboard/focus order;
- touch targets;
- contrast and non-colour cues;
- modal focus/escape/close behaviour;
- visual consistency of the same primitive on different routes;
- screenshots or browser captures for representative before/after regression evidence.

Accessibility findings that are visual/interaction-system defects can be fixed in this programme; changes to product permissions or data behaviour stay separately scoped.

## Pull-request strategy

Do not create one application-wide redesign PR.

Preferred sequence:

1. VISUAL-00 — design/readout only.
2. VISUAL-01 — shared foundation and shell.
3. VISUAL-02 — one or more stable-surface PRs.
4. VISUAL-03 — feature-area PRs as those product areas move.
5. VISUAL-04 — final consistency and accessibility QA.

Keep each implementation PR small enough to review visually and behaviourally. Preserve existing test coverage and add targeted regression coverage when presentation structure carries behaviour, accessibility or destructive-action meaning.

## Relationship to QUALITY-01 / QUALITY-02

The redesign absorbs the useful current-state audit work that QUALITY-01 would otherwise repeat for presentation. Do not implement old Product Excellence findings from PR #100-era evidence without rechecking them against current code.

QUALITY-02 remains a useful acceptance lens. Accessibility issues uncovered while changing the shared visual primitives should be fixed with the primitive where possible; broader accessibility work that is independent of the redesign can remain separately tracked.

## Skill/tooling note

A Claude Code visual-redesign skill is optional tooling, not a product dependency. The roadmap must remain executable if the mobile client cannot install or expose custom skills. The Design Read requirements above are the authoritative task contract; a skill may automate or standardise that process when available.
