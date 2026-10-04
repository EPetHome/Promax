---
name: interactive-prototype-generator
description: Build a self-contained interactive HTML product prototype from a product solution, task flow, interaction specification, and UI design system. Use for fast exploration prototypes that answer product questions or delivery prototypes that demonstrate complete in-scope journeys, responsive behavior, component states, mock data, and accessible interaction without external runtime dependencies.
---

# Interactive Prototype Generator

Create an executable product argument, not a screenshot collection. The prototype must make the intended workflow observable and must state what is mocked or omitted.

## Inline execution

Follow [inline-execution.md](../prd-document-generator/references/inline-execution.md) in the same member context; reuse frozen sources and the PRD/diagram's confirmed rules without per-file subagents or repeated generator Skill calls. Write only the authorized `prototype.html` to the `交付/` path the Lead assigned, not to `交付/版本/`. After all authorized files are written, include its real path, draft state, unverified items and next step in your one final reply — dsh has no `report` tool, and there is no Judge to wait for.

## Select the Prototype Level

### Exploration prototype

Use early when layout, information architecture, workflow, terminology, or interaction risk is still uncertain. Build only the minimum path needed to answer named questions. Label it `exploration`, list omitted states, and expect it to be discarded or rebuilt.

### Delivery prototype

Use after scope, flow, and major decisions are stable enough for review or R&D handoff. Cover all in-scope pages, component states, validation, recovery, responsive behavior, and acceptance-critical interactions.

Read [prototype-contract.md](references/prototype-contract.md) before generating either level.

## Inputs

- prototype level and review questions;
- product solution and stable requirement IDs;
- page map, task flows, state matrix, and interaction rules;
- UI tokens and component rules;
- expected viewports, themes, content density, and accessibility needs;
- real or explicitly mocked sample data.

If the solution is incomplete, implement only defaultable decisions and record them. Stop for a blocking ambiguity that could make the represented critical path wrong.

## Build Workflow

1. Declare artifact state, goal, covered requirements, and omissions.
2. Design the page and state architecture before styling.
3. Reuse [single-html-shell.html](assets/single-html-shell.html) as a structural starting point when appropriate.
4. Inline CSS and JavaScript; use system fonts, CSS/SVG graphics, and no external runtime dependencies.
5. Use native semantic elements and implement keyboard-visible focus.
6. Implement all represented controls. Do not render dead buttons, fake links, or pretend API success without identifying mock behavior.
7. Add responsive rules and reduced-motion behavior.
8. Inspect the actual HTML statically in this context using the existing [audit_html.py](../prototype-quality-audit/scripts/audit_html.py) with the real file path and `--format markdown`. Do not call the audit Skill or start Playwright, agent-browser, Chrome CLI or promax_browser_evidence. Default browser interaction is `not-run`; static success is only STATIC PASS. Preserve the draft and report missing/failed tools immediately, without installation or equivalent retries.

## Technical Contract

- One complete `.html` file that opens locally without a server.
- `<!doctype html>`, UTF-8 charset, viewport meta, embedded style, and embedded script when interaction requires it.
- Design tokens in CSS custom properties, with explicit focus-visible and responsive rules.
- No external font, stylesheet, script, image, or icon-library dependency.
- No production credentials, network calls, persistence claims, or real destructive operations.
- Errors must be visible in the UI; important dynamic feedback uses a status region where practical.

## Required Handoff

Provide:

- actual HTML path and version;
- prototype level and artifact state;
- covered pages, flows, requirements, and review questions;
- mocked behavior, assumptions, omissions, and known limitations;
- actual static audit result plus browser interaction `not-run` (default chain), with reasons;
- screenshot or evidence paths only when those files exist.

## Quality Gate

- The primary user journey completes without a dead end.
- Every visible action has a meaningful response or a clear disabled reason.
- Empty, loading, error, validation, success, and permission states are covered where in scope.
- Layout is usable at defined desktop and narrow widths.
- Focus order, accessible names, dialog behavior, and reduced motion are handled.
- The HTML and the product/interaction documents describe the same behavior.

## Conditional Telemetry

If the host exposes the approved telemetry skill and valid session context, record actual use after output. Missing telemetry capability must not block the prototype or produce a fabricated telemetry claim.
