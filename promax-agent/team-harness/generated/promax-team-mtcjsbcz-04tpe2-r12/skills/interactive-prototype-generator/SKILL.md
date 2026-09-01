---
name: interactive-prototype-generator
description: Build a self-contained interactive HTML product prototype from a product solution, task flow, interaction specification, and UI design system. Use for fast exploration prototypes that answer product questions or delivery prototypes that demonstrate complete in-scope journeys, responsive behavior, component states, mock data, and accessible interaction without external runtime dependencies.
---

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
8. Exercise the critical path locally, then run `$prototype-quality-audit` and resolve blocking/high findings before promotion.

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
- static audit plus browser checks actually run;
- screenshot or evidence paths only when those files exist.

## Quality Gate

- The primary user journey completes without a dead end.
- Every visible action has a meaningful response or a clear disabled reason.
- Empty, loading, error, validation, success, and permission states are covered where in scope.
- Layout is usable at defined desktop and narrow widths.
- Focus order, accessible names, dialog behavior, and reduced motion are handled.
- The HTML and the product/interaction documents describe the same behavior.

## Promax 强制执行契约

本节优先于前文。原型只实现不可变输入清单和点名前置产物支持的需求。每个页面、控件、规则和状态在内联注释 `PROMAX_TRACE` 中记录 `REQ-*`、`E-*` 或明确的设计选择；未知项不得伪造为已实现事实。

`prototype.html` 必须是单文件，CSS 与 JavaScript 全内联，无 http、https、协议相对 URL、CDN、外链字体或运行时资源。`<head>` 内保留结构化注释，固定列出：0. 闭集输入；1. 页面与任务映射；2. 控件与处理器映射；3. 状态覆盖；4. 边界真值表；5. 浏览器取证；6. 未验证项；7. 逐项自检。

规则标签、JavaScript 谓词和可见反馈必须同义。数量变化先算 `after` 再判断 `after<=N`；`before=N, delta=1` 必须显示拒绝且状态不增加。没有浏览器插件证据时“浏览器取证”必须写未验证；有证据时写入截图/快照哈希和视口。

逐项自检：`PT-01` 单文件无外链；`PT-02` 控件均有处理器或 disabled 原因；`PT-03` 空/载入/错/成功/权限状态覆盖；`PT-04` 键盘与可访问名称；`PT-05` 三点边界代入；`PT-06` 与 PRD/业务图一致；`PT-07` PROMAX_TRACE 完整；`PT-08` 浏览器证据诚实。
