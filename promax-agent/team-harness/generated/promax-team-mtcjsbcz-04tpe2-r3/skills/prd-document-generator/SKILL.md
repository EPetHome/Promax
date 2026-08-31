---
name: prd-document-generator
description: Create or revise a traceable product solution document or PRD that defines user problems, scope, requirements, business rules, page and interaction references, acceptance criteria, product-level non-functional expectations, risks, assumptions, and open decisions without prescribing technical architecture. Use for product方案、需求文档、PRD、需求拆解或研发前产品定义。
---

# Product Solution / PRD Generator

Write a decision-ready product contract. Describe what outcome and behavior are required; leave architecture, stack, database, API, and deployment design to the R&D agent.

## Inputs

- user problem, evidence, goal, and success measure;
- users, roles, context, and constraints;
- approved scope, exclusions, rules, and priorities;
- clarification decisions and default assumptions;
- interaction, UI, prototype, or audit artifacts if they already exist.

When source material conflicts, preserve the conflict in the decision log. Do not silently choose a convenient interpretation.

## Required Structure

1. Document information: product, requirement ID, version, date, owner, artifact state.
2. Executive summary: problem, proposed product outcome, and the decision requested.
3. Background and evidence.
4. Goals, measurable success, in scope, out of scope, and non-goals.
5. Users, roles, scenarios, and permissions.
6. Functional requirements with stable IDs such as `FR-001`.
7. Business rules, validations, edge cases, recovery behavior, and state requirements.
8. Information architecture, task flows, pages, and interaction-spec references.
9. Product-level data needs: user-visible inputs, outputs, ownership, retention or export expectations when relevant.
10. Acceptance criteria with IDs such as `AC-001`, preferably Given/When/Then.
11. Product-level non-functional expectations that are supported by source evidence or explicitly marked assumptions.
12. Dependencies, risks, assumptions, open questions, deferred scope, and decision log.
13. Traceability matrix linking user goals → requirements → flow/page → acceptance criteria → artifacts.

Adapt the depth to the problem; do not add empty ceremonial sections.

## Writing Rules

- One requirement expresses one observable behavior or business rule.
- Use stable IDs and consistent nouns for roles, entities, and states.
- Distinguish fact, approved decision, assumption, open question, and future idea.
- Do not invent performance or reliability numbers. If the product needs a measurable expectation and none exists, mark it as a decision to be made.
- Acceptance criteria must be verifiable by product, QA, or a reviewing agent.
- Reference an existing prototype by real path and version; do not fabricate preview or download links.

## Output Formats

Default to a Markdown source file. Create DOCX or PDF only when explicitly requested and when an actual conversion/render workflow is available. Verify generated files before listing them as deliverables.

## Quality Gate

- Scope and exclusions are unambiguous.
- P0 requirements have user value, rules, states, and acceptance criteria.
- Assumptions affecting behavior are visible.
- Interaction and prototype artifacts do not contradict the document.
- Product-level data and permission needs are stated without implementation design.
- Every artifact link or path exists.
- No technical architecture is presented as a product decision.
