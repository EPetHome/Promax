---
name: rd-handoff-package
description: Assemble a traceable product-to-engineering handoff package from a product solution, requirements, interaction specification, design tokens, prototype, acceptance criteria, and audit results. Use before handing a product solution to the R&D agent or team, especially when gaps, assumptions, state coverage, or artifact versions must be made explicit.
---

# R&D Handoff Package

Convert approved product intent into a precise handoff that R&D can size, design technically, and implement without guessing about user behavior. Stay at the product-contract layer; the receiving R&D agent owns technical architecture.

## Inputs

- product solution or PRD;
- requirement and acceptance-criteria IDs;
- interaction specification and state matrix;
- design tokens or UI baseline;
- prototype paths and artifact states;
- quality-audit result;
- approved decisions, assumptions, open questions, and deferred scope.

If an input is missing, mark it `missing` or `not applicable`; never fabricate approval or test evidence.

## Workflow

1. Establish the approved scope and identify the canonical version of every artifact.
2. Build the traceability matrix: user goal → requirement → page/flow → state → acceptance criterion → artifact.
3. Separate product facts, approved decisions, temporary assumptions, unresolved questions, and future ideas.
4. Enumerate business entities and product-level data needs without prescribing database schemas.
5. Summarize roles, permissions, business rules, edge cases, error recovery, and non-functional expectations.
6. Attach the prototype audit and list any accepted risks or known omissions.
7. Define what R&D may decide independently and what requires product confirmation.
8. Produce a handoff readiness result: `READY`, `READY WITH CONDITIONS`, or `NOT READY`.

Use [handoff-schema.md](references/handoff-schema.md) as the human-readable structure. For any review-ready or handoff-ready package, also create a machine-readable manifest from [handoff-manifest.template.json](assets/handoff-manifest.template.json), follow [manifest-schema.md](references/manifest-schema.md), and run:

```bash
python3 scripts/validate_handoff.py path/to/manifest.json
```

## Readiness Rules

`READY` requires:

- scope and acceptance criteria are identifiable;
- critical flows and states are specified;
- prototype and specification versions match;
- no unresolved blocker/high audit finding;
- all default assumptions that affect behavior are visible;
- open decisions have an owner and deadline or are explicitly deferred.

Use `READY WITH CONDITIONS` only when the remaining items do not change the critical path and the accepting owner is named. Otherwise report `NOT READY`.

## Output Contract

Deliver one Markdown handoff plus a validated `manifest.json` containing relative paths to the canonical artifacts. Include version, date, source inputs, readiness status, traceability, known gaps, validation evidence, and the receiver's next decisions.

Do not create fake preview, download, DOCX, PDF, or deployment links. Only list artifacts that actually exist.

## Boundaries

- Do not choose frameworks, services, databases, API protocols, or deployment topology.
- Do not turn product-level data needs into a physical data model.
- Do not hide unresolved product decisions inside an “engineering to confirm” label.
- Do not mark a package ready because files exist; validate their consistency and audit evidence.
