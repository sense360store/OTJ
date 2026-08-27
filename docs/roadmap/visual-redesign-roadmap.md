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
