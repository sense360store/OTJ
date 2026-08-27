# Design quality reference

Use this when diagnosing an interface or choosing the visual direction.

## Avoid generic redesign patterns

A redesign should look like the product was intentionally designed, not like a generic AI dashboard template.

Avoid by default:

- arbitrary purple/blue gradients;
- glassmorphism on every surface;
- excessive pill controls;
- oversized border radii without hierarchy;
- cards around content that does not need containment;
- random blobs, glows, grain, or decorative gradients;
- huge empty hero areas in operational software;
- tiny grey body copy used to manufacture hierarchy;
- excessive shadows or floating surfaces;
- motion added simply because animation is possible.

Use the product's brand, audience, information density, workflows and reference material to determine the aesthetic.

## Hierarchy

Every screen should make these questions easy to answer:

1. Where am I?
2. What is the primary task here?
3. What needs attention now?
4. What is secondary/supporting information?
5. Which actions are destructive, risky, or irreversible?

Use typography, spacing, contrast and grouping before adding decoration.

## Typography

Build a small intentional hierarchy rather than many near-identical sizes.

- Keep body text comfortably readable on phone and desktop.
- Keep line length controlled for prose.
- Make headings meaningfully different from body text through scale, weight, tracking or family.
- Use muted text sparingly; low contrast is not a substitute for hierarchy.
- Avoid excessive uppercase for long labels.
- Keep numeric/statistical displays legible and aligned where useful.
- Check long names, dates and translated/expanded copy.

## Spacing and density

Choose a spacing rhythm and repeat it.

Operational products often benefit from moderate density rather than marketing-site whitespace. Increase breathing room where it improves grouping and comprehension, not everywhere equally.

Prefer:

- consistent section gaps;
- consistent control heights;
- predictable card/panel padding;
- alignment to shared edges;
- dense tables/lists that remain touch-friendly on mobile;
- larger gaps between conceptual groups than within a group.

## Surfaces

Use surface hierarchy intentionally.

A useful system usually needs only a few levels:

- app/background canvas;
- primary content surface;
- raised/interactive surface;
- overlay/modal surface.

Do not make every object float independently. Borders, subtle tonal shifts and whitespace can separate content without shadows.

## Radius, borders and shadows

Define a language rather than one value everywhere.

- Smaller radii suit compact controls and dense operational interfaces.
- Larger radii can distinguish major containers or mobile sheets.
- Borders should have a reason: separation, focus, status or containment.
- Shadows should communicate elevation, not simply decorate cards.

## Colour

Use brand colour selectively so it retains meaning.

- Primary action colour should not be used for every icon or heading.
- Semantic colours must remain recognisable for success, warning and danger.
- Destructive actions should be unmistakable even without relying on colour alone.
- Test contrast in both light and dark modes when present.
- Prefer several neutral surface/text roles to arbitrary opacity variations.

## Components

Related components should share interaction physics and state treatment.

Check at least:

- buttons and icon buttons;
- inputs/selects/textareas;
- chips/badges/toggles;
- cards/list rows;
- tables;
- navigation;
- modals/sheets;
- menus/dropdowns;
- empty/loading/error states.

For each, consider default, hover, focus, active, disabled and destructive variants.

## Mobile

Do not treat phone layout as compressed desktop.

- Keep primary actions reachable.
- Maintain at least comfortable touch targets.
- Convert wide tables to an appropriate mobile representation where the existing product already supports one.
- Avoid horizontal scrolling except for genuinely horizontal content.
- Keep bottom navigation clear of browser/home-indicator safe areas.
- Check sticky controls do not consume excessive viewport height.
- Check modals/sheets with the software keyboard visible when forms are involved.

## Motion

Motion should communicate change, hierarchy or causality.

Good uses include:

- menu/sheet entry and exit;
- focus/press feedback;
- subtle state transitions;
- revealing newly inserted content;
- continuity between related states.

Avoid long entrance sequences in task-oriented software. Respect `prefers-reduced-motion` and avoid `transition: all` where explicit properties suffice.

## OTJ-specific interpretation

For OTJ, prioritise clarity, speed and confidence for a coach using the product on a phone beside a pitch. The interface can feel premium and distinctive without becoming ornamental. Information hierarchy, glanceability, touch targets, state clarity and reliable navigation outrank decorative novelty.
