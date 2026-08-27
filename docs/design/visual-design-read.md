# OTJ visual design read

Status: the VISUAL-00 deliverable. Captured 27 August 2026 against `main` at
`434f67f`, by reading the shipped source rather than by trusting the prototype,
earlier screenshots or the Product Excellence findings from the PR #100 era.

This document is the task contract for VISUAL-01. It records what the OTJ
Training Hub visual system is today, decides what it should become, and names
the screens each later wave is accepted against. Every number in Part 1 was
derived from current source and can be re-derived with the commands recorded in
`Method`. Where a decision could not be settled from evidence it is in Part 5
rather than guessed at.

VISUAL-00 changed no React, no CSS, no behaviour, no query and no migration.

---

## Method

The findings were counted from source at `434f67f`, not estimated:

```bash
# type scale
grep -oh "fontSize: *[0-9.]*" src -r --include=*.tsx | grep -oE '[0-9.]+$' | sort -n | uniq -c
grep -oh "font-size: *[0-9.]*px" src -r --include=*.css | grep -oE '[0-9.]+' | sort -n | uniq -c
# inline styling
grep -ro 'style={{' src --include=*.tsx | wc -l
# primitive overrides
grep -nE "\.(chip|btn|card|field|select|icon-btn)[ ,{]" src/routes/*.css src/components/*.css
# focus and motion
grep -rn "focus-visible\|prefers-reduced-motion\|prefers-color-scheme" src --include=*.css
```

Counts of JSX occurrences exclude the test files, because the figures are claims
about the product's styling rather than about its test fixtures. That exclusion
matters most for the ARIA counts, where the tests assert on the same attributes:
`role="alert"` appears 18 times in the product and 32 times if the tests are
counted with it. CSS counts cover all 14 stylesheets.

Contrast ratios were computed from the token hex values with the WCAG relative
luminance formula, in both themes, against the surface each token actually sits
on in the shipped CSS.

Evidence base: `src/styles.css` (837 lines), 13 route and component CSS files
(2,780 lines), 79 non-test `.tsx` files, `design-reference/` (read only), and the 137
test files that constitute the regression net VISUAL-01 must keep green.

The prototype is one third of the evidence and no longer the majority of it.
`design-reference/styles.css` is 410 lines; the shipped `src/styles.css` is 837
and carries 137 class names the prototype never had, and the 13 per-route CSS
files did not exist in the prototype at all. The prototype remains the reference
for brand feel and for the screens it actually drew. It is not a description of
the product.

---

## Part 1. What the visual system is today

### 1.1 The system lives in four places, and only one of them is shared

| Location | Size | Shared? |
|---|---|---|
| `src/styles.css` | 837 lines | yes, the only shared layer |
| 13 route and component CSS files | 2,780 lines | no, locally scoped |
| Inline `style={{…}}` in JSX | 1,142 occurrences | no |
| Hardcoded hex in JSX | 6 non-test files | no |

Seventy-seven per cent of the product's CSS lives outside the shared stylesheet,
in 13 locally scoped files. Those are not all one screen each. Three are
imported by more than one module: `Board.css` by Board, Session Day, Public
Session and BoardPicker; `Login.css` by Login and Set Password; and
`SessionDay.css` by Session Day and Session Register. `DrillDiagram.css` reaches
further than any of them without being imported more than once: it backs
`DrillDiagramView`, which renders on Drill Detail directly and on Planner,
Session Day and Live Session through `ActivityDiagram`, and the Drill Maker
editor reuses its `dd-` classes. So the 77 per cent measures how much styling
sits outside the shared layer, which is the number that matters for
consolidation, and not how much is single-screen. An import count is a weak
proxy for reach, which is why this paragraph gives the render path rather than a
tally.

The largest single stylesheet in the product is still not the shared one:
`src/routes/SessionRegister.css` is 626 lines, three quarters the size of
`styles.css`, and that one genuinely does serve one screen.

Colour discipline is the exception and it is good. Only 6 non-test `.tsx` files
contain a raw colour literal, counting the three-digit form (`#fff`) as well as
the six-digit one, and most are defensible. A hex-shaped search finds two more,
`ExportConfirmModal.tsx` and `SetupSuggestion.tsx`, whose only matches are pull
request references in comments (`#103`, `#109`, `#203`); those are not colours
and are not counted. the SVG token
fills in `DrillDiagramView.tsx` (`#18181b`, `#ffffff`) and the media letterbox
in `MediaPlayerModal.tsx` and `ui.tsx` (`#0a0e1a`) are all deliberately
theme-invariant, because a drawn diagram and a video frame should read the same
in both themes and on paper. The exception is `RenewSeasonModal.tsx:32-34`,
which hardcodes three status dot colours, two of which duplicate `--c-physical`
and `--c-social` and one of which (`#94a3b8`) exists nowhere else in the
product. The two `#fff` uses (`Home.tsx:50` and `AdminClub.tsx:39`) sit on a
brand fill, where a literal white is defensible but a token would be better. Almost everything
else already routes through a CSS variable, so the problem with colour is not
that it is hardcoded. It is what the variables mean, covered in 1.3.

The bib swatches in `src/lib/bibs.ts` are also raw hex and are deliberately so;
see 2.16.

### 1.2 Typography: 25 distinct sizes and no scale

Font size is set 420 times inline and 219 times in CSS. Between them the product
uses 25 distinct values:

```
9.5 10 10.5 11 11.5 12 12.5 13 13.5 14 14.5 15 15.5 16 17 18 19 20 22 24 28 30 34 38 40
```

Seven of those are half pixel values, and the two most used sizes in the whole
product are half pixel: `13.5px` (124 inline uses) and `12.5px` (81). There is
no token, no scale and no rule, so a new screen picks a number that looks right
next to the one beside it, which is how the set grew.

Eight distinct sizes sit between 12px and 15.5px, which is where nearly all the
product's text lives. A coach cannot perceive the difference between 13px and
13.5px, so those eight steps buy no hierarchy and cost every future screen a
decision.

Font family and weight are in better shape. Two families, Archivo for display
and Hanken Grotesk for body, applied consistently through `--display` and
`--sans`, with `h1` to `h4` given the display family globally. Weight runs 500 to
900 and is used deliberately.

The smallest text in the product is `.thumb-label` at 9.5px and the bottom
navigation label at 10.5px. The bottom navigation label is the one a coach reads
most often on a phone.

### 1.3 Colour: the palette is disciplined, the roles are not

The token set is coherent and the brand is well chosen. Navy, royal and gold
carry the club. The four corners palette (technical, physical, social,
psychological) and the media type palette are both genuine product
classifications that deserve colour.

Three problems, all structural rather than cosmetic.

**There are no semantic state tokens.** No `--danger`, `--success`, `--warning`
or `--info` exists. So state colour is borrowed from classification palettes:

- destructive is `var(--m-pdf)`, the **PDF media type** colour, referenced 113
  times (111 as `var(--m-pdf)` and twice as `var(--m-pdf, #ef5a5a)`),
  including the permanent bulk delete confirm button
  (`src/components/BulkDeletePlayersModal.tsx:133` sets
  `background: 'var(--m-pdf)'` inline, because no `btn-danger` variant exists);
- success is `var(--c-physical)`, the **four corners physical** colour;
- warning is `var(--c-social)`, the **four corners social** colour.

The consequence is that one hue carries three unrelated meanings at once.
`--c-physical` is simultaneously the physical corner, the Warm-Up phase
(`PHASE_COLOR` in `src/components/ui.tsx:567`) and success. Green on a screen
does not tell a coach which of those it means. It also means that restyling the
PDF badge would restyle every delete button in the product.

**The dark theme flips only neutrals.** `.theme-dark` redefines exactly 12
tokens: `--ink`, `--ink-2`, `--slate`, `--slate-2`, `--line`, `--line-2`,
`--bg`, `--bg-2`, `--card` and the three shadows. Every brand hue, every corner
hue and every media hue is theme invariant. Measured consequences:

- `--royal`, the link and focus ring colour, is **2.21:1** on the dark card. It
  is 7.41:1 in light. Links and focus rings are the thing dark mode most needs
  to keep;
- `--gold-soft` (`#fff4d1`) stays cream in dark mode. It is the background of
  `.ip-note`, `.public-freetext-warning`, `.cp-num`, `.public-activity-phase`
  and `.public-week-focus`. Those panels set no `color`, so their text inherits
  `--ink`, which flips to near white. Note text on a note panel in dark mode
  measures **1.01:1**. It is invisible, not merely low contrast.

**Several pairings fail contrast in light mode too**, computed against the
surface each actually sits on:

| Pairing | Ratio | Where |
|---|---|---|
| `--slate-2` on `--card` | 3.08:1 | `.eyebrow`, `.sb-section`, `.filter-label`, `.bn-item` inactive label, `.setup-cell .k`, `muted-cell` |
| `--slate-2` on `--bg` | 2.82:1 | the same tokens on the page canvas |
| `--m-pdf` text on `--card` | 3.34:1 | `.menu-list button.danger`, `ActionError`, `.bulk-delete-stale` |
| white on `--m-pdf` fill | 3.34:1 | **the bulk delete confirm button** |
| `--c-physical` as success text | 3.30:1 | import outcomes, share status |
| `--c-social` as warning text | 2.45:1 | `.ip-warn` |
| `--gold-600` on `--gold-soft` | 1.88:1 | `.sb-accred`, `.cp-num`, in **both** themes |

`--slate` is fine: 5.34:1 on card, 4.88:1 on bg, 7.13:1 in dark. The distinction
between `--slate` and `--slate-2` is currently "slightly quieter", and the
product uses `--slate-2` for text roughly as often as `--slate`. That is the
single change with the widest reach, because `--slate-2` is a legitimate token
that is simply being asked to do a job it cannot do.

The most serious individual instance is the destructive confirm button. The one
control in the product whose label a user must read before an irreversible
action renders its label at 3.34:1.

### 1.4 Spacing: no scale at all

Padding, gap and margin between them use every integer from 1 to 16, then 18,
20, 22, 24, 26, 28, 30, 32, 38, 40, 44, 48, 60, 70 and 90. Thirty one distinct
non-zero values, counting every value inside a shorthand such as
`padding: 13px 15px` rather than only single-value declarations.

There is no base unit. The most used values inline are 10 (108 uses), 8 (94) and
12 (70), which is close to a 2px rhythm by accident rather than by rule.

Radii are similar. Thirteen distinct literal values are in use (3, 4, 5, 6, 7,
8, 9, 10, 11, 12, 13, 14 and 999) against three declared tokens (`--radius-sm`
11, `--radius` 16, `--radius-lg` 22), which are used 29 times between them. The
tokens exist and are routinely bypassed.

Density itself is appropriate. This is operational software and it is
correctly dense. The problem is the absence of a rhythm, not the amount of space.

### 1.5 Surfaces and elevation

Four levels are in use and they are the right four: page canvas (`--bg`),
content surface (`--card`), raised (`--shadow-sm` on `.card`, `.act-card`,
`.bulk-bar`) and overlay (`--shadow-lg` on `.modal`, `.menu-list`,
`.more-sheet`).

This is the healthiest part of the system. The three shadow tokens are used
roughly as intended, and separation is mostly done with `1px solid var(--line)`
rather than by floating everything.

The one weakness is that `.card` is a container with no variants, so a screen
that needs a padded card, a bordered block or a tinted note writes its own. That
is visible in 1.6.

### 1.6 Controls: primitives exist as CSS classes, not components

There is no `Button`, `Input`, `Card`, `Select`, `Table`, `Badge` or `Toggle`
component. `src/components/ui.tsx` exports 22 things, of which exactly two are
control primitives (`Chip` and `ListInput`); the rest are `Modal`, the state
components, the content components (`DrillCard`, `MediaThumb`, `Pill`,
`CornerTag`, `TopicTags`) and formatters.

Buttons in particular are raw elements carrying class strings. There are 350 of
them outside the test files, across 26 distinct class combinations:

```
98  btn btn-ghost          93  btn btn-primary        52  btn btn-ghost btn-sm
21  btn btn-ghost btn-sm icon-only                    19  btn btn-quiet btn-sm
```

`icon-only` appears on 23 of them and **is defined in no stylesheet in the
repository**, including `design-reference/`. Those 23 buttons receive `.btn`'s
`padding: 0 16px` with no text inside, so they are wider than intended. Nothing
is broken; a class name has simply been dead for some time and nobody could see
it.

Control heights are unsystematic: `.btn` 42px, `.btn-sm` 36px, `.btn-lg` 52px,
`.chip` 34px, `.icon-btn` 38px, `.topbar-search input` 40px, `.field input`
42px, `.select` and `.search-lg input` 48px. Nine selectors, seven distinct
heights, no token.

**The screens have already noticed and patched around it**, and the rules that
touch a shared primitive are of three kinds that must not be confused.

The count below is over the **control** primitives, meaning `.btn` and its size
modifiers, `.chip`, `.field` and its inputs, `.select`, `.icon-btn`, `.card`,
`.tag`, `.pill`, and the two shared search inputs `.search-lg input` and
`.topbar-search input`. The search inputs carry no contextual override today, so
including them does not move the total, but they are controls and leaving them
out would make the scope incomplete. It counts a rule only where a screen or feature context
re-specifies one of those, not where the primitive defines its own modifiers and
internal parts (`.chip.on`, `.nav-item.active`, `.stat .val`, `.act-card
.ac-body` and the like), which are the primitive rather than an override of it.
`.mobile-topbar .crest` resizes the crest from 42px to 34px and is deliberately
outside the count: the crest is a brand asset, not a control, and a smaller
crest on a phone is a deliberate responsive choice rather than a missing rule.

Twenty five rules across nine stylesheets, the shared one included, classified:

**One repaint is not a CSS rule at all**, which is a limit of this count worth
stating rather than hiding. `src/routes/Home.tsx:48` declares `GHOST_ON_NAVY`, an
inline style object giving ghost buttons a translucent white background, a white
label and a translucent border, applied at four call sites inside the Home hero.
It does exactly what `.dv .icon-btn` does and a stylesheet sweep cannot see it.
It is the reason 2.5's `on-dark` variant has two callers rather than one.

- **control size, 14 rules across 8 stylesheets.** These duplicate a
  primitive's own sizing and are the kind a primitive should make unnecessary.
  Between them they invent **six** control heights, none of which is the shared
  value: 28px, 34px, 38px, 40px, 42px and 44px;
- **composition, 10 rules across 5 stylesheets.** `margin-bottom: 0` on a field,
  `flex: 1` on a button, `flex: 0 0 auto` on an icon button, `width: 100%` on a
  select, `min-width` on a filter, and `.shares-summary .pill b { color:
  var(--ink) }`, which emphasises the count inside a pill. These place a shared
  control in one screen's layout or emphasise its own content. They are
  legitimate, they belong to the screen, and no primitive can or should absorb
  them;
- **contextual restyle, 1 rule.** `.dv .icon-btn:disabled`. It changes a
  primitive's appearance for one context rather than its size, and points at a
  missing variant rather than a missing rule. Its sibling `.dv .icon-btn` sets
  44px **and** a dark-surface background, border and text colour in one rule, so
  it is counted under control size above while being the clearest case for the
  `on-dark` variant 2.5 requires.

Three further rules touching a named primitive sit inside the `@media print`
block: two on `.btn` and one setting `print-color-adjust` on `.tag` alongside
`.public-pill` and `.board-disc`. **Every print-medium rule is outside this
count.** Print is a different medium with its own correct answers, a printed
page has no hover, focus or touch target, and forcing colour to survive a
printer is not an override of anything the screen does.

**The shared stylesheet overrides its own primitive**, which is the sharpest
version of this finding. `src/styles.css:200` is
`.act-role-row .chip { height: 28px; padding: 0 11px; font-size: 12px }`, six
pixels shorter than the `.chip` defined 11 lines later in the same file, and the
smallest interactive control in the product. Nothing about that is a screen
working around a missing rule; it is the system disagreeing with itself in one
file.

The newer, mobile first screens use the first kind to reach larger touch
targets:

- `.tn-filters .chip { min-height: 44px }` in `SessionRegister.css:335`;
- `.reg-scope .chip { min-height: 40px }` in `SessionRegister.css:166`;
- `.add-drill-controls .chip { height: 40px }` and `.btn-sm { height: 40px }` in
  `AddDrillModal.css`.

So the shared chip is 34px, and three separate chip groups across two files have
independently decided it should be 40px or 44px, disagreeing with each other as
well as with the shared value. `Home.css` opens with the comment "every action is a
44px-plus target" and enforces it locally. `SessionRegister.css` enforces 44px,
48px and 56px minimums locally and designs explicitly for a 360px viewport.
A further 44 sites across 13 files reach 44px with an inline `minHeight: 44`,
led by `ShareModal.tsx` (12) and `AdminShares.tsx` (11).

This is the most important finding in the audit, and it is a positive one. The
right rules are already known and already written down. They are written down in
the wrong place, once per screen, at three different values.

Inline banners are the same story: 25 distinct note, banner, warning, hint and
callout classes exist across the CSS, with no shared primitive. `--gold-soft` is
used as "this is a note" in 12 places.

### 1.7 Navigation and the two shells

The desktop shell is a 264px sticky sidebar, a sticky translucent top bar with a
`backdrop-filter` blur, and a 1280px max width content column. Below 900px the
sidebar is replaced by a mobile top bar and a fixed bottom navigation. The swap
is clean and the breakpoint is consistent.

The bottom navigation is capability driven, respects
`env(safe-area-inset-bottom)`, and overflows into a More sheet. Item height
computes to roughly 46px, which is adequate. Its label is 10.5px at 3.08:1,
which is not.

Two defects in the top bars:

- the mobile theme toggle (`src/components/TopBar.tsx:60`) is an icon only
  button with no `aria-label` and no `title`. It has no accessible name. The
  desktop equivalent at line 38 has `title="Toggle theme"`;
- the desktop Notifications bell (`TopBar.tsx:36`) has no `onClick`. It is
  inert chrome.

The global search input is `readOnly` and navigates to `/library` on focus. That
is deliberate and commented, but it presents as a text field and is not one.

Page headings are the strongest shared pattern in the product: `.page-head` is
used in exactly 21 routes, once each. Nine routes do not use it; five of those
are legitimately outside the shell (Login, LiveSession, DrillDiagramEditor,
PublicShare, SetPassword) and four are inside it and invent their own heading
(SessionDay, SessionRegister, DrillDetail, ProgrammeDetail).

Heading semantics are wrong in a way that is easy to miss. The page title inside
`.page-head` is an `<h2>`. The only `<h1>` inside the authenticated shell is the
club name in the sidebar, which is identical on every screen. The sidebar is
`display: none` below 900px. So on a phone an authenticated screen has no `<h1>`
at all, and on desktop the `<h1>` never names the page.

### 1.8 Overlays: one excellent primitive and three things that are not it

`Modal` in `src/components/ui.tsx` is genuinely good and should survive the
redesign nearly intact. It has `role="dialog"`, `aria-labelledby` and
`aria-describedby`, a pure and unit tested Tab trap (`src/lib/modalFocus.ts`),
focus move on open, focus restore to the opener on close, Escape handling, a
`focusKey` for dialogs that swap their own body, and a `dismissible` flag that
freezes every dismissal route while a write is in flight. 38 non-test files
render it, 64 times between them.

Three overlays are not it, and each solved the problem differently:

- the **More sheet** in `BottomNav.tsx` has `role="menu"`, closes on overlay
  click, and has no focus trap, no Escape handler and no focus restore. It is
  the primary navigation overflow on a phone;
- `DiagramViewer.tsx` has `role="dialog"` and its own Escape handler, and does
  not use `modalFocus`;
- the Players overflow menu has its own Escape handler at `Players.tsx:138`.

`src/lib/modalFocus.ts` is imported by exactly one file.

### 1.9 State families: well covered, weakly differentiated

Coverage is a real strength. Counted in non-test files: 41 `<Loading>`, 36
`<ErrorNote>`, 33 `<ActionError>`, 30 `<Empty>`, 21 `role="status"`, 18
`role="alert"` and 12 `aria-live`. States are not an afterthought here.

But `Loading` and `ErrorNote` are visually identical. Both are
`className="muted"` with `padding: '48px 0', textAlign: 'center', fontWeight:
600`. A failed load and a slow load differ only in their words. Neither carries
an icon, a border, a colour or a retry.

There are no skeletons and no spinner anywhere in the product. Every loading
state in the product is one line of centred grey text.

There is no success primitive. Success is spelled out per screen with
`role="status"` and `color: var(--c-physical)` inline, in at least five places.

Destructive treatment is otherwise strong. The bulk delete flow requires a typed
phrase, previews dependencies, refuses when the selection is stale and refuses
when the count exceeds a limit. Only its colour role and its label contrast are
wrong.

### 1.10 Focus, motion and touch

Focus rings exist for exactly three selectors in the shared stylesheet, all of
them text inputs, all of them doing `outline: none` and replacing it with a
`box-shadow` ring in `--royal`. That treatment is correct.

Nothing else in the shared system has a focus style. Not `.btn` (350 uses), not
`.chip`, not `.nav-item`, not `.bn-item`, not `.icon-btn`, not `.menu-list
button`, not `.more-sheet-item`. They fall back to the user agent default,
which on `.btn-primary` sits on navy and on `.nav-item.active` sits on navy.
Three specialised places (`Board.css`, `DrillDiagramEditor.css`, `Tick.css`)
each invented their own `:focus-visible`.

`prefers-reduced-motion` appears nowhere. The product has five hover lift rules
(`translateY(-1px)` on the primary and gold buttons and on a Home row, `-3px` on
drill cards, `-2px` on the live round buttons), three keyframe animations
(`fade`, `pop`, `sheet-up`) and 10 property-less `transition` shorthands, which
mean `transition-property: all`. Five of those are `.12s`; the rest are `.14s`,
`.15s` and `.25s`. Three further `transform: translateY` declarations are static
centring rather than motion and are unaffected by any of this.

`prefers-color-scheme` appears nowhere. Dark mode is opt in through the toggle
and persisted to `localStorage` under `otj_dark`, so a coach whose phone is in
dark mode gets a light app until they find the toggle.

### 1.11 What is already right and must survive

Stated explicitly, because a redesign that loses these would be a regression
even if every screen looked better:

- the brand: navy, royal and gold, the crest, the gradient, the accreditation
  pill, the motto;
- the four corners palette as a *classification*, which is FA vocabulary a coach
  already reads;
- the `Modal` primitive and its focus behaviour;
- `.page-head` as a shared page heading, adopted in 21 routes;
- the surface and elevation model, which is already four sensible levels;
- the state coverage, including 12 `aria-live` regions and the `role="alert"` on
  every `ActionError`;
- the Registered Players table plus card duality, and its explicit column drop
  band between 901px and 1080px;
- the status badge convention of a coloured dot plus the word, so status is
  never colour alone;
- the bib ring rather than a bib fill, so white and black bibs both read;
- the print stylesheet for public pages, which is real work and easily lost;
- `env(safe-area-inset-bottom)` on the bottom navigation, the More sheet and the
  live footer.

---

## Part 2. The target visual language

These are decisions. The waves implement them; they do not reopen them.

**Which wave implements which half.** Part 2 settles two different kinds of
thing, and conflating them would put VISUAL-01 in an impossible position, since
some sections here name routes that Part 4 deliberately schedules for VISUAL-02
or VISUAL-03. The rule is:

- **defining a primitive, token or contract is VISUAL-01.** The type scale, the
  colour roles and contrast floors, the spacing and radius scales, the surface
  levels, `Button`, `Input`, `Chip`, `Badge`, `Card`, the `Note` primitive, the
  `Sheet` primitive, the `PageHeader`, the shared focus treatment, the state
  primitives and the reduced-motion block. VISUAL-01 also applies them to the
  shared shell and to its own five acceptance screens in Part 4;
- **adopting them on a route is that route's wave.** So 2.9's table rules bind
  Registered Players when VISUAL-02 reaches it, and 2.16's second cue for the
  live progress segments binds the live view when VISUAL-03 reaches it. Neither
  is VISUAL-01 work, and neither licenses VISUAL-01 to touch those routes.

Where a section below names a route, read it as the standard that route is held
to when its wave arrives, not as a VISUAL-01 deliverable. Part 4 is the
authority on which wave that is.

### 2.0 Principles

1. **A coach beside a pitch is the design target.** Phone first, glanceable,
   confident. Density is good; ambiguity is not.
2. **A rule that can hide information must be narrow; a rule that shows must be
   broad.** This is already how the product's own classification and lifecycle
   rules are written, and the visual system should match it.
3. **The primitive carries the rule.** Where a screen has discovered a rule
   locally, the rule moves into the primitive and the local override is deleted.
4. **Refresh, not restyle.** The brand does not change. The system underneath it
   does.

### 2.1 Typography and type scale

Nine steps replace 25 values. Tokens, not literals.

| Token | Size | Role |
|---|---|---|
| `--text-display` | 38px | stat values, total time. The live timer keeps its `clamp()` |
| `--text-3xl` | 30px | page title, desktop |
| `--text-2xl` | 24px | page title, phone |
| `--text-xl` | 20px | dialog title |
| `--text-lg` | 17px | card and section heading |
| `--text-md` | 15px | list row title, emphasis body |
| `--text-base` | 14px | body default |
| `--text-sm` | 13px | secondary and meta |
| `--text-xs` | 12px | labels, eyebrows, badges |

Rules:

- **no half pixel sizes.** 15.5, 14.5, 13.5, 12.5, 11.5, 10.5 and 9.5 are
  retired. Mapping: 16/15.5/15 to 15, 14.5/14 to 14, 13.5/13 to 13, 12.5/12 to
  12;
- **12px is the floor for any text a user reads.** The bottom navigation label
  moves from 10.5px to 12px. `.thumb-label` at 9.5px moves to 12px or becomes an
  icon;
- font size is never set inline. A new size that is not on the scale is a
  request to change the scale;
- Archivo for display and headings, Hanken Grotesk for body, unchanged. Tabular
  numerals stay wherever the product already asks for them;
- line height: 1.5 for body and prose, 1.25 for headings and single line rows.

### 2.2 Colour roles and contrast rules

**Add semantic state tokens and stop borrowing.** Four roles, each with a text
value, a fill value and a tinted surface value, each defined in both themes:

```
--danger  --danger-fg  --danger-surface
--success --success-fg --success-surface
--warning --warning-fg --warning-surface
--info    --info-fg    --info-surface
```

- `--m-*` and `--c-*` are **classification only**. A media type colour may never
  paint a destructive control; a four corners colour may never mean success or
  warning. `PHASE_COLOR` keeps its own values and stops aliasing `--c-*`;
- add a `btn-danger` variant so no destructive control needs an inline
  `background`.

**The dark palette is not optional, because one surface is always dark.** The
live view forces `theme-dark` on its own container regardless of the user's
setting, so every dark-theme decision here binds the pitch-side surface
unconditionally, for every coach, including those who have never opened the
toggle. Judging the dark palette by how many people switch to it is therefore
the wrong measure.

**Every hue is defined in `.theme-dark`, not only the neutrals.** `--royal`,
`--navy`, `--gold`, `--gold-soft`, the four corner hues and the media hues all
get a dark value. `--gold-soft` in particular must become a dark tinted surface,
because it is the product's note background and currently stays cream.

**Contrast floors, enforced in both themes against the surface the token
actually sits on:**

- body and secondary text: **4.5:1**;
- text at 19px bold or 24px and above: **3:1**;
- control borders, focus rings, and icons that carry meaning without a label:
  **3:1**;
- a filled control's label against its own fill: **4.5:1**. This is what the
  bulk delete confirm button fails today at 3.34:1.

**`--slate-2` is demoted to a non text role.** It becomes the token for control
borders, disabled glyphs and decorative rules. Every place it currently sets
text colour moves to `--slate`, which measures 5.34:1, 4.88:1 and 7.13:1 and
passes. This is a single find and replace with a real accessibility payoff and
almost no visual cost, because the two are close in appearance and far apart in
legibility.

**Brand colour keeps its meaning by being used sparingly.** Navy is the primary
action and the active navigation state. Gold is the accent and the one
highlight; it is only ever a fill behind dark text, never text on white, where
it measures 1.69:1. Royal is links and focus.

### 2.3 Spacing and density

**A 4px base scale**, eight steps, plus one 2px step for tight icon gaps only:

```
2, 4, 8, 12, 16, 20, 24, 32, 48
```

Rules:

- **every value not on the scale is retired**, and each site resolves to the
  nearer step. Against the 31 currently in use that is 22 values: 1, 3, 5, 6, 7,
  9, 10, 11, 13, 14, 15, 18, 22, 26, 28, 30, 38, 40, 44, 60, 70 and 90. The rule
  is what binds, not the list: a value absent from both is still retired;
- gaps between conceptual groups are larger than gaps within one group. This is
  the rule that produces hierarchy, and the product currently produces it by
  accident;
- section rhythm: 24px between sections, 16px within a section, 8px within a row;
- card padding: 16px on a phone, 20px above 900px. One value each, replacing the
  per-screen padding each card variant currently picks for itself;

This is the one decision that produces visible 1px and 2px shifts across many
screens. That is expected and acceptable, and it is why VISUAL-01 is a
foundation PR reviewed visually rather than a silent refactor.

**Radii**, five steps replacing thirteen literal values:

| Token | Value | Role |
|---|---|---|
| `--radius-xs` | 8px | tags, badges, small inline blocks |
| `--radius-sm` | 12px | buttons, inputs, selects, chips that are not pills |
| `--radius-md` | 16px | cards and panels |
| `--radius-lg` | 22px | dialogs, sheets, hero |
| `--radius-pill` | 999px | chips, status pills, avatars |

### 2.4 Surfaces, borders, separators and elevation

Keep the four levels. Name them and stop mixing the mechanisms.

| Level | Background | Separation |
|---|---|---|
| canvas | `--bg` | none |
| content | `--card` | `1px solid --line` |
| raised | `--card` | `1px solid --line` plus `--shadow-sm` |
| overlay | `--card` | `--shadow-lg` |

Rules:

- a border separates, a shadow elevates. Not both for the same reason;
- nothing floats that is not interactive or overlaid. Static content is
  separated with a border, a tonal shift or space;
- `--line-2` is the within group separator (table rows, list rows), `--line` is
  the between group separator (card borders, section rules);
- **one Note primitive replaces the 25 note, banner, warning and hint classes.**
  It takes a tone (`info`, `warning`, `danger`, `neutral`), and renders an icon,
  a tinted `--*-surface` background, a `--*` border and text at
  `--ink`. `--gold-soft` stops being the universal note background and becomes
  what its name says: a gold tint.

### 2.5 Buttons and icon buttons

**Introduce a real `Button` component.** 350 hand-written class strings across
26 combinations is a maintenance surface, and it is why `icon-only` could be
dead for months without anyone seeing it.

Variants: `primary` (navy), `gold` (the one accent action, currently New
Session), `ghost`, `quiet`, `danger` (new) and `on-dark` (new). Sizes: `sm`,
`md`, `lg`.

`on-dark` exists for the two surfaces that put shared controls on a dark ground
which does **not** come from the theme:

- the **Home hero**, whose fixed navy gradient is the product's signature
  surface. `Home.tsx:48` repaints ghost buttons for it inline through
  `GHOST_ON_NAVY`, at four call sites;
- the **diagram viewer chrome**, where `.dv .icon-btn` repaints the primitive's
  background, border and text colour in its own stylesheet.

Home is a VISUAL-01 acceptance screen, so without this variant VISUAL-01 can
satisfy every other rule here and still ship the hero with an inline repaint of
a primitive it has just rebuilt. `on-dark` is part of the contract rather than a
note, and Home is where it is accepted.

**The live view is deliberately not an `on-dark` case.** It renders as
`className="live theme-dark"` and takes its surfaces and text from the dark
theme tokens, so theme-aware controls already work there and a special variant
would be the wrong fix. What the live view needs is the dark palette in 2.2
being right, which is a stronger requirement rather than a weaker one: see the
note in 2.2.

- heights: `sm` 36px, `md` 44px, `lg` 52px. The default becomes 44px, up from
  42px;
- `icon-only` is either implemented or removed. Decision: **implement it**, as a
  square button whose width equals its height, and require an `aria-label` on
  every instance. There are already 23 call sites expecting it to exist;
- an icon only button always has an accessible name, and `aria-label` rather
  than `title`. `title` is a tooltip, not a label, and it does not survive touch;
- disabled keeps `opacity: .5` and adds `cursor: not-allowed`, and disabled
  controls are never the only explanation of why an action is unavailable.

**Every interactive control has a minimum 44 by 44 CSS pixel hit area.** The
visible box may be smaller; the hit area is achieved with padding or a
pseudo-element. This preserves desktop density while making every target
thumb reachable, and it is what lets `.chip` stay visually 34px while being
tappable. It replaces the three different local answers in `SessionRegister.css`,
`Home.css` and `AddDrillModal.css`, which are then deleted.

### 2.6 Inputs, selects and textareas

One height (44px), one radius (`--radius-sm`), one border (`--line`), one focus
treatment, one disabled treatment, one error treatment. This binds **every**
shared input, the two search fields included: today `.field input` is 42px,
`.topbar-search input` is 40px, and `.select` and `.search-lg input` are 48px,
for no reason a user could name. `.topbar-search input` is the shell's own
search and is named here explicitly, because the shell is VISUAL-01's to change
and a 40px control left behind in it would contradict both the one-height rule
and the 44px hit area on the wave's own surface.

- the label is always a real `<label>` bound to the control, never a styled
  `<div>`;
- an error state sets `--danger` on the border **and** renders a message beneath
  the control **and** sets `aria-invalid` and `aria-describedby`. Never a red
  border alone;
- required and optional are stated in the label text, not by colour or a bare
  asterisk;
- a select keeps the native control. This product is used on phones, and the
  native picker is better than anything worth rebuilding here.

### 2.7 Chips, badges and toggles

- **Chip** is the filter control: a pill, selectable, 44px hit area,
  `aria-pressed` for a toggle chip or a `radiogroup` where the set is exclusive.
  Selected is navy fill plus white text plus `aria-pressed="true"`, so selection
  is never colour alone. It keeps its count where it has one;
- **Badge** is read only status: `--radius-xs`, a tone, a dot plus a word. The
  existing `.status-badge` convention is already right and becomes the
  definition;
- **Tag** stays the four corners and media classification tag, unchanged in
  appearance, and is the only place `--c-*` and `--m-*` colours appear;
- **Toggle** is a real switch or a checkbox, labelled, never an unlabelled icon
  that changes colour.

### 2.8 Cards and panels

`Card` gains variants rather than being re-implemented per screen: `padded`,
`flush` (for a card that contains a list whose rows own their padding),
`interactive` (hover and focus treatment, used where the whole card is a
button) and `tinted`.

A card is used to contain, never to decorate. Content that does not need
containment does not get a border.

### 2.9 Tables and mobile equivalents

There is exactly one `<table>` in the product, in Registered Players. Its
treatment is already the right pattern and becomes the rule:

- a real `<table>` with a real `<caption>`, `<th scope>`, and sortable headers
  as real `<button>`s;
- the table renders above 900px, a card list at and below it, and the two never
  render together;
- where the content column cannot hold every column, named columns drop between
  901px and 1080px and stay reachable through a row action and stay valid sort
  keys;
- the table scrolls inside its own container, never the page body;
- the card equivalent carries the same information and the same actions, not a
  subset.

Any future table in the product follows this, rather than inventing a second
answer.

### 2.10 Page heading and action hierarchy

`.page-head` becomes a `PageHeader` component: eyebrow, title, subtitle, and a
right hand action slot.

- the page title is the page's **`<h1>`**. Today it is an `<h2>` and the only
  `<h1>` is the club name. The sidebar club name becomes a `<p>` or a `<div>`,
  and the mobile top bar's `<b>` stays presentational;
- one primary action per page, at most. Everything else is ghost, quiet, or in
  an overflow menu;
- on a phone the action slot wraps beneath the title rather than shrinking the
  title;
- the four routes inside the shell that invent their own heading (SessionDay,
  SessionRegister, DrillDetail, ProgrammeDetail) adopt it. The five outside the
  shell keep their own treatment by design.

### 2.11 Desktop shell

Largely unchanged, which is correct. It works.

- sidebar stays 264px, sticky, `--card` on `--bg`, with the crest, club name,
  motto and accreditation pill. The accreditation pill's colours change to meet
  contrast (1.88:1 today);
- top bar keeps the sticky translucent treatment. The Notifications bell is
  resolved per Part 5;
- content column stays 1280px max width. Add a wide desktop check above 1600px,
  where a 1280px column in the centre of a very wide screen should not leave the
  sidebar visually orphaned;
- active navigation state stays navy fill with a gold icon. That is
  distinctively OTJ and should not become a generic grey highlight.

### 2.12 Phone shell and bottom navigation

- breakpoint stays 900px;
- bottom navigation keeps `env(safe-area-inset-bottom)`, its capability driven
  items and the More overflow. Label moves to 12px and to `--slate`, from 10.5px
  at 3.08:1;
- the active item gets a non colour cue in addition to the navy tint, and
  `aria-current="page"`;
- the mobile top bar's theme toggle gets an `aria-label`;
- the phone content padding follows the spacing scale (16px), and sticky
  elements are checked against a 360px viewport, which `SessionRegister.css`
  already treats as a real design width and which the rest of the product does
  not.

### 2.13 Modal and sheet treatment

**`Modal` is the definition and everything else adopts it.**

- the More sheet and `DiagramViewer` move onto the shared focus behaviour in
  `src/lib/modalFocus.ts`: focus in on open, Tab trapped, Escape closes, focus
  restored to the opener. The Players overflow menu deliberately does not, for
  the reason in the last bullet of this section: it is a menu, not a dialog.
  What it adopts is the shared Escape handling and focus return, not the Tab
  trap;
- a **Sheet** primitive is introduced for the bottom sheet form, sharing
  `Modal`'s focus contract and differing only in placement, radius and entry
  animation. The More sheet becomes its first caller;
- a dialog above 900px is centred with `--radius-lg`; at and below 900px a
  dialog that is a form becomes a bottom sheet, so its actions stay above the
  keyboard;
- `dismissible={false}` while a write is in flight stays exactly as it is. It is
  correct and it is tested;
- a menu is not a dialog. The overflow menu keeps `role="menu"` and closes on
  Escape and on outside click, and does not trap focus.

### 2.14 State families

Seven states, each visually distinct, each with a primitive.

| State | Treatment |
|---|---|
| loading | a skeleton where the shape is known, otherwise a labelled spinner. Never bare centred grey text |
| empty | icon, a short title, one sentence, and the action that resolves it where one exists |
| error | `--danger-surface`, a `--danger` border, an icon, plain calm wording, and a retry where retrying is meaningful. `role="alert"` |
| warning | `--warning-surface` Note, an icon, no retry |
| success | `--success-surface` or inline `--success` text with a tick icon, `role="status"`. Transient, never blocking |
| destructive | `btn-danger`, an explicit consequence sentence, and the typed confirmation where the action is irreversible |
| read only / permission limited | the control is absent or disabled **with a stated reason**, never silently missing |

`Loading` and `ErrorNote` must stop being byte identical. That is the specific
regression this section exists to fix.

The destructive semantics in the bulk delete flow (typed phrase, dependency
preview, stale selection refusal, count limit) are behaviour and do not change.
Only their presentation does.

### 2.15 Focus, keyboard and touch

**One shared `:focus-visible` treatment for every interactive element**, defined
once:

```
outline: 2px solid var(--focus);
outline-offset: 2px;
```

- `--focus` is a token that measures at least 3:1 against both the control it
  rings and the surface behind it, **in both themes**. `--royal` cannot be it
  unchanged, because it is 2.21:1 on the dark card;
- `outline: none` is only ever written with a replacement ring on the same rule.
  The three input rules that do this today are correct and stay;
- the ring appears on `.btn`, `.chip`, `.nav-item`, `.bn-item`, `.icon-btn`,
  `.menu-list button`, `.more-sheet-item`, card level buttons and every link.
  Today none of them has one;
- `Board.css`, `DrillDiagramEditor.css` and `Tick.css` keep bespoke focus
  treatments only where the shared ring genuinely cannot work (a token on a
  pitch, an SVG handle). They adopt the shared `--focus` colour;
- tab order follows visual order. A modal returns focus to its opener;
- 44 by 44 minimum hit area, as decided in 2.5.

### 2.16 Non colour cues

Nothing in the product may be distinguishable by colour alone.

- status is a dot **plus a word**. The existing `.status-badge` is the model;
- a selected chip carries `aria-pressed` and a fill, not a hue shift alone;
- a destructive button carries the word Delete or Remove, not only a red fill;
- the live progress segments (`done`, `cur`, remaining) need a second cue, since
  they are currently green, gold and grey with no text;
- four corners tags already carry their label beside the dot. That stays;
- **bib colours are the deliberate exception and must stay colour**, because
  they name a physical garment a child is wearing. They are already paired with
  `bibLabel` text and drawn as a ring so white and black both read. This is
  correct and VISUAL-01 must not "fix" it. The bib swatch hexes in
  `src/lib/bibs.ts` are also correctly hardcoded rather than tokenised, for the
  same reason.

### 2.17 Motion

- add a `prefers-reduced-motion: reduce` block that removes the hover
  transforms, the `pop` and `sheet-up` animations and reduces transitions to
  opacity. It does not exist today;
- replace the 10 property-less `transition` shorthands with explicit properties;
- motion communicates change: sheet entry, focus and press feedback, newly
  inserted rows. Nothing decorative, no entrance sequences;
- durations: 120ms for state feedback, 180ms for overlay entry.

---

## Part 3. What makes this recognisably OTJ

A redesign that satisfied every rule above and dropped this section would
produce a competent generic dashboard. These are the things that make it the
club's product.

1. **Navy and gold, used as a club uses them.** Deep navy as the ground for
   authority (the active navigation item, the primary button, the hero), gold as
   a single accent that means "this one". Gold is never a decorative gradient
   and never a second body colour.
2. **The crest and the club identity block.** Crest, club name, motto, and the
   FA accreditation pill, present in the sidebar and on the login screen. The
   motto in italic is doing real work and should not be tidied away.
3. **The navy gradient.** `linear-gradient(120deg, var(--navy-900), var(--navy)
   60%, #1b3aa8)` with a soft gold radial in the corner, used on the Home hero
   and the login background. It is the product's one signature surface. It
   should become a token (`--brand-gradient`) so it stops existing twice with a
   raw hex in it, and it should stay rare: two or three places, never a card
   treatment.
4. **The FA four corners as visible vocabulary.** Technical, physical, social
   and psychological, with their own colours, on drills and in the planner. This
   is the language coaches are trained in and it is a genuine differentiator
   from generic software. It gets *more* distinct once it stops sharing hues
   with success and warning.
5. **Pitch and kit references, used sparingly and only where literal.** The
   pitch stripe thumbnail, the tactics board, the bib swatches. These are
   literal depictions of real objects, not decoration, which is why they work.
6. **Operational confidence over polish.** Big tap targets, big timer numerals,
   readable in sunlight, one obvious next action. A coach with cold hands and a
   whistle is the test, not a screenshot.

Explicitly rejected for this product: glassmorphism beyond the one existing top
bar blur, purple or teal gradients, blob and glow decoration, oversized hero
areas on operational screens, grey micro copy used to manufacture hierarchy, and
card containment around content that does not need containing.

---

## Part 4. Acceptance screens for VISUAL-01, 02 and 03

Widths to inspect throughout: **360, 390, 430, 768, 1024, 1280, 1600**. 360 is
included because `SessionRegister.css` already designs for it and the rest of
the product does not. 1024 matters because Registered Players drops columns
between 901 and 1080.

### VISUAL-01, foundation and shell

Accept against these five, because between them they exercise every primitive
and both shells:

| Screen | Why this one |
|---|---|
| **Home** (`/`) | hero, stat cards, week list rows, `.page-head`, and both shells at once. The densest single exercise of the shared vocabulary |
| **Sessions** (`/sessions`) | filter chips (kind, team, ownership, upcoming and past), list rows, the empty state, and a page head with actions |
| **Login** (`/login`) | the product outside the shell: brand gradient, crest, inputs, primary button, error state. Checked in VISUAL-01, adopted in VISUAL-02: see below |
| **The More sheet**, phone only | the one overlay with no primitive today, and the acceptance test for the new Sheet |
| **Any `Modal`**, for example Delete session | dialog, focus trap, Escape, focus restore, and the new `btn-danger` |

VISUAL-01 is accepted when: the token set is in place, the primitives exist
including the `danger` and `on-dark` button variants and the `Note` and `Sheet`
primitives, each of the five surfaces above is visually checked in both themes
**at every width where it exists**, and the 137 test files stay green.

**Login is checked in VISUAL-01 and adopted in VISUAL-02**, and both roadmaps
list it under VISUAL-02's stable surface group, which is correct and is not a
conflict once the two verbs are separated. VISUAL-01 checks it because it is the
only surface that exercises the new primitives with no shell around them, so a
token or primitive that only works inside the content frame fails here first.
VISUAL-02 owns adopting it in full: the account screen beside it, and the state
matrix (invalid credentials, magic link sent, expired link, set password,
permission-limited) that VISUAL-01 does not attempt. The same split applies to
Home and Sessions, which Part 4 lists in both waves for the same reason.

Widths per surface, since two of the five are not present at every one: Home,
Sessions and Login at all seven. The More sheet at 360, 390 and 430 only, since
the bottom navigation it opens from does not render above 900px. A dialog at all
seven, and at 900px in both of its forms, because 2.13 turns a form dialog into
a bottom sheet at and below that width and the changeover is the thing worth
looking at.

**Only the control-size overrides are in scope, and they are not all
VISUAL-01's to delete.** The ten composition rules identified in 1.6
(`margin-bottom: 0` on a field, `flex: 1` on a button, `flex: 0 0 auto` on an
icon button, a full-width select, a `min-width` on a filter, and the emphasised
count inside a pill) are composition, not duplication: all ten belong to their
screen and no primitive can or should absorb them. Deleting any of them would
either leak a screen's layout into every other caller or fail a later wave for
correctly keeping them. The single contextual restyle,
`.dv .icon-btn:disabled`, is likewise not a deletion: it resolves when
`on-dark` gives it a disabled state to inherit.

The 14 control-size rules are the ones a primitive makes unnecessary, and each
goes with its route's wave, for the same reason Part 2 opens with the wave
split. Only `Home.css`'s single rule sits on a VISUAL-01 acceptance surface and
goes with this wave. `SpondLinks.css` (1) goes with VISUAL-02.
`SessionRegister.css` (5), `DrillDiagramEditor.css` (2), `AddDrillModal.css`
(2), `Board.css` (1), `DiagramViewer.css` (1) and `styles.css`'s
`.act-role-row .chip` (1) go with VISUAL-03; that last one styles the activity
card row, which Planner and the week plan editor both render.

**What is retired is the declaration, not always the rule.** Two of the 14 carry
a size declaration and a composition or restyle declaration in the same block,
and deleting the block would regress the screen:
`Home.css`'s `.week-foot .btn` sets `min-height: 44px` **and** `width: 100%`,
and `.dv .icon-btn` sets 44px **and** the dark-surface background, border and
text colour. In both cases the size declaration goes and the rest stays, until
`on-dark` makes the viewer's colours unnecessary too. A wave that deletes a
whole rule and loses a full-width footer action has misread this criterion.

What VISUAL-01 owns is making **every control-sizing declaration in all 14
rules** unnecessary by putting the rule in the primitive. That is more than 14
declarations: `.dv .icon-btn` sets both `width` and `height`, and
`.act-role-row .chip` sets `height`, `padding` and `font-size`, all three of
which are the chip's own sizing and all three of which go. For `.dv .icon-btn`
it also means shipping the `on-dark` variant 2.5 requires, not only the 44px hit
area. A later wave that meets a control-sizing declaration it cannot retire has
found a gap in the primitive, and that is a VISUAL-01 defect to fix rather than
a reason to keep the override.

### VISUAL-02, stable everyday surfaces

| Screen | States that must be covered |
|---|---|
| **Registered Players** | table at 1280, column drop at 1024, card list at 390 and 360; bulk selection bar; bulk delete modal including typed confirmation, dependency preview, stale selection and over limit; withdrawn rows; the archived season banner; empty; loading; error; a parent's absence of access |
| **Activity** | the CSS only row to card reflow at 900px; inline filters against the phone filter dialog; load more; empty; long actor and entity names |
| **Home** and **Sessions** | re-checked as regression after VISUAL-01 |
| **Account** | forms, avatar upload, success and error |
| **Feedback** | the one surface a parent may write to; create, list, status change as admin, read only as parent |
| **Admin Users** and **Admin Teams** | representative admin: invite flow, role change, destructive removal, bib colour selection |

Registered Players is the primary acceptance screen for this wave. It is the
only table, it holds the only irreversible destructive flow, it has a full
mobile card equivalent, and it is where the colour role and contrast decisions
in 2.2 are most visibly tested.

### VISUAL-03, feature area waves

| Screen | Paired with |
|---|---|
| **Planner** and the week plan editor | COACH-11/12/13. `.act-card`, `.act-edit`, `.add-slot`, the sticky `.planner-side`, drag handles |
| **Players and groups** (`/session-day/:id/register`) | COACH-5/6/7/8. The densest touch surface in the product: response chips, the group view, bib controls, quick add, Save groups. Accept at 360 first |
| **Session day** | COACH-5/6/7/8 |
| **Drill Maker** (`/drill/:id/diagram`) | when further authoring work is scheduled. Full screen, outside the shell, canvas and touch gestures, bespoke focus treatment |
| **Live session** (`/live/:id`) | LIVE-01/02. Forced dark, the timer, the progress segments and their non colour cue, sunlight legibility |
| **Public share** and its print output | after DRILL-02b. Anonymous, no shell, and the print stylesheet |

---

## Part 5. Open product decisions

These could not be settled from current evidence. They are product calls, not
design calls, and VISUAL-01 does not need them answered. VISUAL-02 does.

1. **The Notifications bell.** `TopBar.tsx:36` renders a bell with no `onClick`.
   Is it a placeholder for planned work, or chrome to remove? A redesign should
   not ship a styled control that does nothing.
2. **The global search field.** It is `readOnly` and navigates to `/library` on
   focus. Should it become a real search, or be replaced by a plainly labelled
   Library button? Presenting a text field that cannot be typed into is the kind
   of thing a visual refresh makes more prominent rather than less.
3. **Whether dark mode should follow the operating system.** Adding
   `prefers-color-scheme` would change what existing users see on their next
   load, which is a product decision rather than a styling one. The alternative
   is to keep the explicit toggle and make it easier to find.
4. **Whether the New Session action stays gold.** Gold is the product's accent
   and it is currently spent on one button. It works, and it is distinctive.
   Confirming it is deliberate matters before the button is rebuilt.
5. **Whether the four corners hues change at all** once they stop doubling as
   success and warning. Coaches may recognise the current values. The
   recommendation is to keep them exactly and give the new semantic tokens
   different hues, but that is worth a coach's opinion.
6. **The bib palette and the four corners palette share hex values today**
   (`#16a34a`, `#1f43d6`, `#f4c020`, `#ef8e1b`, `#7c4dff`). A bib swatch and a
   corner tag can appear on the same screen. Whether to deliberately separate
   them is a product judgement about what a coach reads at a glance.
7. **How many destinations the bottom navigation should hold** before More. This
   is information architecture rather than presentation, so it is out of the
   VISUAL programme's scope, but the redesign will make the current split more
   visible.

---

## Part 6. Boundaries

VISUAL-00 produced this document and nothing else. No React, CSS, behaviour,
route, permission, Supabase, query, migration or Edge Function change.

Constraints binding VISUAL-01 onwards, restated from the roadmap so they are not
rediscovered:

- presentation only. Routes, permissions, RLS, data semantics and security
  boundaries do not move to make a design easier;
- no single application wide redesign pull request. Foundation, stable surface
  groups and feature waves stay independently reviewable;
- existing behaviour tests stay green. Where presentation carries behaviour,
  accessibility or destructive meaning, targeted regression coverage is added
  rather than removed;
- old Product Excellence findings are not implemented without being re-derived
  from current code. Everything asserted in Part 1 of this document was
  re-derived on 27 August 2026 at `434f67f`;
- `design-reference/` stays read only and is evidence, not truth.
