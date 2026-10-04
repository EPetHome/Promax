---
name: ui-design-system
description: Define or apply a lightweight UI design system for internal enterprise products and self-contained HTML prototypes. Use when a product solution needs visual direction, design tokens, component states, page patterns, responsive behavior, dark mode, accessibility rules, or consistency with the local FPA and Pro Mate prototype corpus.
---

# UI Design System

Build the smallest design system that makes the current product coherent, accessible, and implementable. Treat it as a product constraint and a reusable contract, not as decoration.

## Inputs

Collect or infer:

- product type, users, platform, density, and usage environment;
- existing brand assets or design standards;
- desired visual tone and explicit exclusions;
- required pages, component states, responsive targets, and theme modes;
- prototype level: `exploration` or `delivery`.

If no visual standard exists, use the internal enterprise baseline in [baseline-guidelines.md](references/baseline-guidelines.md). Record every inferred choice as an assumption rather than asking non-blocking style questions.

## Workflow

1. Inspect existing screens and assets before inventing a new visual language.
2. Choose one visual direction and describe its distinguishing features in 3–5 sentences.
3. Define tokens in three layers: primitive → semantic → component.
4. Define component anatomy, variants, interactive states, validation states, and keyboard behavior.
5. Map page patterns to real user tasks, including empty, loading, error, disabled, and success states.
6. Apply responsive, contrast, focus, motion, and density rules.
7. Deliver CSS variables and a concise usage contract that the prototype and R&D handoff can both consume.

Use [baseline-tokens.css](assets/baseline-tokens.css) as the default starting point, then adapt it. Do not ship external fonts, icon libraries, CDN styles, or other runtime dependencies in a self-contained prototype.

## Required Output

Return:

1. visual direction and rationale;
2. token table or CSS variables;
3. component specification with all relevant states;
4. page-pattern rules;
5. responsive and accessibility rules;
6. exceptions, assumptions, and unresolved design decisions.

Read [component-patterns.md](references/component-patterns.md) for minimum component coverage and [page-patterns.md](references/page-patterns.md) for enterprise layouts. When using historical work as evidence, read [internal-prototype-corpus.md](references/internal-prototype-corpus.md) and treat it as a pattern source, not a mandatory brand standard.

## Quality Gates

- Body text and controls remain legible at common desktop and mobile widths.
- Every interactive element has hover, focus-visible, active, and disabled behavior where applicable.
- Status is never communicated by color alone.
- Motion is purposeful and respects `prefers-reduced-motion`.
- Native HTML semantics are preferred over simulated controls.
- A dense interface still has a clear information hierarchy and one dominant action per region.
- Exploration prototypes may use the baseline with a small component set; delivery prototypes require complete states for every in-scope component.

## Boundaries

- Do not invent a company-wide brand system from one prototype.
- Do not overfit to a fashionable style if it reduces clarity for internal users.
- Do not decide technology frameworks, APIs, or implementation architecture.
- Do not claim visual or accessibility acceptance unless the rendered result was inspected and the checks are listed.
