---
name: prototype-quality-audit
description: Audit a self-contained HTML product prototype before review or engineering handoff. Use when validating structure, external dependencies, interactive semantics, keyboard focus, responsive behavior, accessibility signals, error states, or when producing an evidence-based PASS/FAIL report for an HTML prototype.
---

# Prototype Quality Audit

Validate evidence, not intent. In Promax's default generation chain this specification is read inline by the current solution_design member, not invoked as another audit agent. Only static checks run; browser interaction, visual inspection and rendered accessibility remain `not-run`/未验证. Never delay existing drafts awaiting browser evidence.

## Audit Levels

- `BLOCKER`: cannot open, critical path cannot be completed, or the deliverable is not self-contained when that is required.
- `HIGH`: major interaction, accessibility, responsive, or state gap that prevents reliable review.
- `MEDIUM`: quality or consistency issue that should be corrected before R&D handoff.
- `INFO`: observation or improvement that does not block the current artifact state.

## Workflow

1. Confirm the target artifact and state: exploration, draft, review-ready, or handoff-ready.
2. Run the static audit:

   ```bash
   python3 scripts/audit_html.py path/to/prototype.html --format markdown
   ```

3. Do not open a browser in the default chain: no Playwright, agent-browser, Chrome CLI or promax_browser_evidence. Browser interaction and desktop/mobile appearance are `not-run`.
4. Statically inspect the actual controls, handlers, form states and recovery paths without executing the HTML or a parallel implementation of its business logic.
5. Statically inspect accessible names, focus-visible and responsive declarations; keyboard order, rendered focus/overflow and reduced-motion behavior remain unverified.
6. Compare the implementation against the product solution, interaction specification, and design tokens.
7. Record evidence, severity, owner, and retest status for each finding.
8. Report `PASS`, `PASS WITH ACCEPTED RISK`, or `FAIL`. Static checks alone may only support `STATIC PASS`.

[browser-checklist.md](references/browser-checklist.md) is only a checklist for a separately authorized later acceptance task, not a default execution instruction. Missing tools or permission failures end the affected step immediately; preserve files, record the reason, do not install or retry equivalent commands.

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
