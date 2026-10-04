# Internal enterprise baseline

Use this baseline when no product-specific visual standard exists.

## Direction

- Calm, precise, and information-forward.
- Light neutral canvas with white elevated work surfaces.
- Indigo-blue primary action, restrained status colors, dark neutral text.
- Compact enough for internal operations, but never so dense that scanning and keyboard use suffer.
- Visible structure comes from spacing, borders, typography, and grouping rather than decorative gradients.

## Token architecture

Use three layers:

1. Primitive tokens describe raw palette, type scale, spacing, radii, shadows, and motion.
2. Semantic tokens describe meaning such as canvas, text, border, action, danger, or success.
3. Component tokens adapt semantics to a button, input, table, navigation item, dialog, or card.

Components should consume semantic or component tokens, not raw palette values. Keep theme changes at the semantic layer.

## Typography

Use a system font stack. Default to 14px body text with 1.5 line height for dense internal tools; never go below 12px for metadata. Use weight and spacing before adding more colors.

## Accessibility and behavior

- Provide a clearly visible 2–3px focus ring with adequate offset.
- Maintain readable text contrast; status chips include text or an icon in addition to color.
- Use native buttons, links, fields, dialog semantics, headings, tables, and lists.
- Support keyboard traversal in the same order as the visual layout.
- Keep essential information available without hover.
- Reduce or remove non-essential animation under `prefers-reduced-motion`.

## Responsive targets

- Wide desktop: persistent navigation and multi-column work area.
- Standard laptop/tablet: compress secondary columns before shrinking primary work content.
- Mobile/narrow: navigation becomes a top region, grids collapse, data tables gain horizontal scrolling or convert to labeled rows.
