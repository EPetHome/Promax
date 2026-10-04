---
name: business-diagram-generator
description: Generate traceable Mermaid diagrams for product solutions, including user flows, swimlanes, state diagrams, page maps, decision flows, and product-level sequences. Use when roles, transitions, branches, page relationships, or lifecycle states are easier to review visually than in prose.
---

# Business Diagram Generator

Turn confirmed product logic into readable diagrams. Each node and branch must be traceable to source material or explicitly marked as an assumption.

## Inline execution

Follow [inline-execution.md](../prd-document-generator/references/inline-execution.md) in the current member context. Reuse the same frozen sources, confirmed rules and stable IDs as the PRD/prototype. Do not spawn a subagent or call another generator Skill. Write only the authorized `business-diagram.md` to the bundle-injected in-flight snapshot path; immediately use native `report({output:string})` (direct parent only) with its actual path, draft state, unverified items and next step. Do not write the published current version or wait for Judge.

## Choose the Diagram

| Need | Diagram |
| --- | --- |
| Cross-role responsibility and handoff | Swimlane-style `flowchart LR` |
| User task with decisions or recovery | `flowchart TD` |
| Entity or workflow lifecycle | `stateDiagram-v2` |
| Page hierarchy and navigation | `flowchart TD` page map |
| Time-ordered product interaction | `sequenceDiagram` |

Avoid system-service or API call sequences unless the user has asked for a technical diagram; those belong to the R&D agent.

## Workflow

1. Extract actors, goals, entry conditions, steps, decisions, states, exits, and recovery paths.
2. Separate confirmed logic from assumptions and unresolved branches.
3. Pick the smallest diagram that answers the review question.
4. Use stable IDs from the product solution when available.
5. Generate Mermaid source with concise verb-object labels and consistent granularity.
6. Add a short legend for assumptions, errors, or deferred scope.
7. Validate syntax only with an already available non-browser Mermaid parser. Never start a browser or install a renderer in the default chain. If unavailable, report syntax validation as `not-run`; rendered appearance and browser interaction remain unverified.

## Rules

- Do not invent happy-path or exception steps. Necessary inferred transitions must be labeled `假设` and added to the assumption log.
- Every decision node has named outcomes; every state transition has a trigger.
- Show meaningful recovery, cancellation, permission, or terminal states when they are in scope.
- Split diagrams that become difficult to scan rather than shrinking labels.
- Provide Mermaid source as the canonical artifact. Only provide an image or preview when one was actually rendered.

## Output

Return:

1. diagram purpose and selected type;
2. Mermaid source;
3. assumptions or unresolved branches;
4. source requirement IDs;
5. syntax validation result.

## Quality Gate

- The diagram answers one explicit product question.
- Roles, steps, branches, and states match the source.
- No disconnected node or unnamed branch remains.
- Labels are readable and use consistent terms.
- Technical architecture is not smuggled into a product-level diagram.

## Conditional Telemetry

If the host exposes the approved telemetry skill and session context, record actual use after artifact creation. Missing telemetry capability never blocks output and must not be represented as successful logging.
