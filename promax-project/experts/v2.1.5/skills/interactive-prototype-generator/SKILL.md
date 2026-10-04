---
name: interactive-prototype-generator
description: Build a self-contained interactive HTML product prototype from
  a product solution, task flow, interaction specification, and UI design system.
  Use for fast exploration prototypes that answer product questions or delivery prototypes
  that demonstrate complete in-scope journeys, responsive behavior, component states,
  mock data, and accessible interaction without external runtime dependencies.
---

本 Skill 为内联执行：先读 `references/inline-execution.md`，在当前上下文直接生成，不启动子模型。Hook 只在加载时登记开始，阶段产物与完成须按内联回执返回。

**调用 ID：`interactive-prototype-generator`；默认角色：`solution_design`；版本：2.1.5。**

# Interactive Prototype Generator

Create an executable product argument, not a screenshot collection. The prototype must make the intended workflow observable and must state what is mocked or omitted.

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
8. Save and checkpoint the usable HTML immediately. Run the existing static audit script in the current context and compare the actual artifact against the rules; do not call an audit Skill or browser CLI from the generation chain. Do not write a duplicate simulation engine to prove the same logic. Browser interaction remains not-run until separately tested; return the draft with this limitation, and complete the same inline run.

## Technical Contract

- One complete `.html` file that opens locally without a server.
- `<!doctype html>`, UTF-8 charset, viewport meta, embedded style, and embedded script when interaction requires it.
- Design tokens in CSS custom properties, with explicit focus-visible and responsive rules.
- No external font, stylesheet, script, image, or icon-library dependency.
- No production credentials, network calls, persistence claims, or real destructive operations.
- Errors must be visible in the UI; important dynamic feedback uses a status region where practical.

## Behavior checks

- Business thresholds use precise values / time differences; rounding is for display only. Check values just outside, exactly at, and inside each boundary, including already-started / ended conditions when applicable.
- Repeated operations, cancellation and off/on toggles obey the same rules as the PRD; existing history is kept only as required by the source.
- Mock data follows the declared simulation clock and state. A historical event cannot be in that clock's future; status labels derive from current state and must not contradict each other.
- Compare each page and control with the agreed scope; added behavior is a proposal until accepted. Correct related documents when authorized, or return the discrepancy.


## Required Handoff

Provide:

- actual HTML path and version;
- prototype level and artifact state;
- covered pages, flows, requirements, and review questions;
- mocked behavior, assumptions, omissions, and known limitations;
- static audit results and explicit browser / behavior checks actually run or not-run;
- screenshot or evidence paths only when those files exist.

## Quality Gate

- The primary user journey completes without a dead end.
- Every visible action has a meaningful response or a clear disabled reason.
- Empty, loading, error, validation, success, and permission states are covered where in scope.
- Layout is usable at defined desktop and narrow widths.
- Focus order, accessible names, dialog behavior, and reduced motion are handled.
- The HTML and the product/interaction documents describe the same behavior.


## 本次任务输入

$ARGUMENTS
