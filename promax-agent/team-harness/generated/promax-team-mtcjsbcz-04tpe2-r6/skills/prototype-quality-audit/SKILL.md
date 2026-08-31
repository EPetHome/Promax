---
name: prototype-quality-audit
description: Audit a self-contained HTML product prototype before review or engineering handoff. Use when validating structure, external dependencies, interactive semantics, keyboard focus, responsive behavior, accessibility signals, error states, or when producing an evidence-based PASS/FAIL report for an HTML prototype.
---

# Prototype Quality Audit

Validate evidence, not intent. A prototype is review-ready only when its important paths can be exercised, its visual output has been inspected, and blocking findings are closed or explicitly accepted.

## Audit Levels

- `BLOCKER`: cannot open, critical path cannot be completed, or the deliverable is not self-contained when that is required.
- `HIGH`: major interaction, accessibility, responsive, or state gap that prevents reliable review.
- `MEDIUM`: quality or consistency issue that should be corrected before R&D handoff.
- `INFO`: observation or improvement that does not block the current artifact state.

## Workflow

1. Confirm the target artifact and state: exploration, draft, review-ready, or handoff-ready.
2. Run the static audit:

   ```bash
   python3 scripts/audit_html.py path/to/prototype.html --format markdown --output audit-report.md
   ```

3. Open the HTML in a real browser at desktop and narrow/mobile widths.
4. Exercise all primary actions, navigation, overlays, form states, theme controls, and recovery paths.
5. Check keyboard order, visible focus, accessible names, dialog focus behavior, content overflow, and reduced-motion handling.
6. Compare the implementation against the product solution, interaction specification, and design tokens.
7. Record evidence, severity, owner, and retest status for each finding.
8. Report `PASS`, `PASS WITH ACCEPTED RISK`, or `FAIL`. Static checks alone may only support `STATIC PASS`.

Use [browser-checklist.md](references/browser-checklist.md) for the rendered inspection.

## Required Report

Include:

- artifact path and version;
- audit scope and environment;
- checks run and evidence paths;
- findings grouped by severity;
- critical-path results;
- unresolved assumptions and accepted risks;
- final status and the exact conditions for promotion to the next artifact state.

## Decision Rules

- Any unresolved `BLOCKER` means `FAIL`.
- Any unresolved `HIGH` normally means `FAIL`; acceptance requires an explicit named decision and rationale.
- A generated file, a successful HTTP response, or a passing static scan is not proof that the user journey works.
- Exploration prototypes may defer secondary states, but must label the omissions and still keep their represented path functional.
- Handoff-ready prototypes require browser evidence at target widths and traceability to acceptance criteria.

## Boundaries

- Do not silently repair the prototype unless the task also authorizes implementation.
- Do not claim WCAG conformance from heuristics alone.
- Do not treat mock-data accuracy as production integration proof.
- Do not downgrade a finding merely to obtain a pass result.

## Promax 强制执行契约

审计输入限定为不可变输入清单、最终 `prototype.html` 和任务包点名的 PRD/业务图；不得读取生成对话或自评作为证据。报告固定为：0. 输入与版本哈希；1. 静态单文件检查；2. 控件—处理器映射；3. 状态覆盖；4. 响应式取证；5. 可访问性取证；6. 规则与边界真值表；7. 跨产物一致性；8. 缺陷清单；9. 未验证项；10. 自检记录。

浏览器取证必须写视口、步骤、观察结果、截图/快照路径与 SHA256；未实际打开页面的项目只能写未验证。逐项自检：`PA-01` 输入哈希明确；`PA-02` 无外链；`PA-03` 控件逐一核对；`PA-04` 三点边界实测或标未验证；`PA-05` 浏览器证据真实存在；`PA-06` 缺陷未静默修复；`PA-07` 不以启发式声称 WCAG 通过。
