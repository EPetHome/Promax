---
name: business-diagram-generator
description: Generate traceable Mermaid diagrams for product solutions, including user flows, swimlanes, state diagrams, page maps, decision flows, and product-level sequences. Use when roles, transitions, branches, page relationships, or lifecycle states are easier to review visually than in prose.
---

# Business Diagram Generator

Turn confirmed product logic into readable diagrams. Each node and branch must be traceable to source material or explicitly marked as an assumption.

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
7. Validate syntax with an available Mermaid renderer or parser. If none is available, report validation as `not run`.

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

## Promax 强制执行契约

本节优先于前文。业务图只使用不可变输入清单和任务包点名的前置最终产物；所有参与者、节点、条件、边和结果都映射到 `SRC-*`/`E-*`，并标记为输入事实、明确推导、设计选择、矛盾或未知。

`business-diagram.md` 固定包含六个区块且顺序不变：1. 图表类型与业务问题；2. 参与者、节点、条件、边与证据映射；3. Mermaid 图；4. 主流程、异常与补偿说明；5. 矛盾、缺口与设计选择；6. 边界真值表与验证记录。没有内容的区块仍保留并写明原因。

每个条件节点都必须在真值表中列谓词、三点边界、实际代入、true/false 对应边和结果节点；数量变化先算 `after`，`before=N, delta=1` 必须走拒绝分支。

逐项自检：`DG-01` 六区块齐全；`DG-02` Mermaid 语法闭合；`DG-03` 元素全部映射；`DG-04` 分支有名称；`DG-05` 异常与补偿可达；`DG-06` 边界与 PRD 一致；`DG-07` 无技术架构偷渡；`DG-08` 未验证项明确。
