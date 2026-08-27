# Verification reference

Use this after each meaningful redesign slice and before declaring the work complete.

## Functional regression pass

Confirm the changed area still performs the same product work:

- routes and deep links still resolve;
- auth/permission states still show the intended controls;
- forms still validate, submit and report errors;
- queries and mutations still execute through the same paths;
- menus, drawers, modals and sheets open/close correctly;
- destructive confirmation semantics are unchanged;
- keyboard shortcuts and key handlers still work;
- drag/drop, canvas, timers, live-state or gesture interactions still work where relevant;
- loading, empty and error branches remain reachable and readable;
- no console/runtime errors were introduced.

Run the repository's actual build, typecheck, lint and relevant tests. Never claim they pass without running them.

## Responsive matrix

For OTJ, start with the phone rather than treating it as a final shrink test.

Inspect at minimum:

1. narrow iPhone portrait (~375-390 CSS px);
2. larger phone portrait (~430 CSS px);
3. tablet/intermediate width;
4. normal laptop/desktop;
5. wide desktop where layout expansion could become excessive.

Check:

- no unintended horizontal overflow;
- sticky headers/bars do not hide content;
- bottom navigation respects safe areas;
- controls remain tappable and do not crowd;
- page headings/actions wrap intentionally;
- cards/tables switch layout at sensible points;
- dialogs fit the viewport and remain dismissible;
- software-keyboard scenarios do not bury form actions where practical to test.

## State matrix

For every redesigned primitive/surface that exposes them, inspect:

- default;
- hover (desktop);
- focus-visible;
- active/pressed;
- selected/current;
- disabled;
- loading;
- success;
- warning;
- error;
- destructive;
- empty/no-data;
- permission-limited/read-only.

A visual system is incomplete if only the happy state was redesigned.

## Content stress

Test representative extremes:

- long player/session/drill names;
- short and empty labels where allowed;
- large counts;
- long error/confirmation copy;
- multi-line buttons or headings where unavoidable;
- lists with one item and many items;
- missing optional metadata;
- dates/times that occupy more width.

Do not truncate information that the current product intentionally exposes unless the redesign explicitly provides an accessible way to reveal it.

## Accessibility pass

Confirm:

- visible keyboard focus;
- logical tab/focus order;
- existing `aria-*`, labels and roles remain intact;
- touch targets are comfortable;
- status is not communicated by colour alone;
- destructive actions have text/structure as well as colour;
- text/background contrast remains appropriate;
- reduced-motion preference is respected;
- modal focus trapping/return/escape behavior is not broken;
- live announcements remain intact where the product has them.

## Visual-diff loop

When browser or screenshot tooling is available:

1. capture the current/before surface at representative widths;
2. implement one coherent visual layer or component family;
3. capture the same views after;
4. compare hierarchy, alignment, spacing, overflow and state visibility;
5. fix unintended regressions before moving to the next layer.

Do not optimise solely for a single screenshot. A good redesign must survive real data and interaction.

## Completion record

At the end, report precisely:

- commands/checks actually run;
- viewports actually inspected;
- main flows actually exercised;
- anything not verified and why.

If visual browser tooling is unavailable, say so and rely on build/tests/static inspection without pretending a visual review occurred.
