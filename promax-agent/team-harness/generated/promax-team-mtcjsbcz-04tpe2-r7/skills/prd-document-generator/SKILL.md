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

## Promax 强制执行契约

本节优先于前文。只读取不可变输入清单及任务包明确允许的前置最终产物。为来源建立 `SRC-*`，为证据建立 `E-*`，所有需求再建立 `REQ-*`；事实、分析推断、设计选择、假设和未知必须分开。

`prd.md` 固定为 0–11 节：0. 文档控制与闭集输入；1. 背景、问题与证据；2. 目标、成功指标与非目标；3. 用户与场景；4. 范围及优先级；5. 需求清单；6. 业务规则与边界真值表；7. 流程、状态与异常；8. 权限与产品级数据需求；9. 验收标准；10. 输入硬信息保留表与追溯矩阵；11. 假设、矛盾、未决项与未验证项。无依据时保留标题并写“未提供”。

边界真值表必须列变量、谓词、边界前/边界/边界后、代入和预期分支。数量变化先算 `after=before+delta`，再以 `after<=N` 判定；`before=N, delta=1` 必须拒绝。

逐项自检：`PRD-01` 0–11 节齐全；`PRD-02` 输入硬信息逐条保留；`PRD-03` REQ-* 回指 E-* 与 SRC-*；`PRD-04` 事实/选择/假设分离；`PRD-05` 冲突未擅自裁决；`PRD-06` P0/P1 可验收；`PRD-07` 状态异常齐全；`PRD-08` 边界实际代入；`PRD-09` 非目标明确；`PRD-10` 不含技术实现承诺；`PRD-11` 跨产物术语一致。
