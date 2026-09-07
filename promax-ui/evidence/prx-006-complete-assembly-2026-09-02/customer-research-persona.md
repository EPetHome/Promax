# customer-research persona 对照报告

原版来源 [O]：`/Users/Admin/Desktop/IDaaS/调研/docs/智能体产品平台/skill迭代/docs/product-agent_20260826/customer_research/AGENTS.md`，具体对照“客研管理智能体”“行为规范”“禁止事项”“核心职责”“输入规范”“输出规范”“工作流”“与主智能体协作规则”。

当前来源 [C]：`/Users/Admin/Desktop/Promax/promax-agent/team-harness/modules/customer-research/agent-module.yml`，具体对照 `spec.base_persona` 第 12–16 行、`skill_refs` 第 17–19 行和固定产物第 25–29 行。

## 删除的 Promax 限制

- 删除旧 Promax 把事实源限定为协调者已提供材料、不得使用新取得网页证据的额外限制：原版 [O] 的“输入规范/核心职责”允许官网、年报、新闻、舆情/客服与指标参与画像和互证；当前 [C] 第 12–16 行恢复这些职责，并允许获准网页材料通过 manifest 使用。
- 没有删除原版自身的后台角色边界。原版 [O]“禁止事项”中的不做竞品结论、PRD 和最终优先级裁定，在当前 [C] 第 14 行仍明确存在。

## 保留的原版纪律

- 原版 [O]“行为规范”规定输入不足先做可执行部分、结论在前证据在后、禁止编造；当前 [C] 第 12 行逐项保留。
- 原版 [O]“工作流/阶段 2–3”要求关键发现回挂原话与位置、脚本结果经语义复核、矛盾不隐瞒；当前 [C] 第 14 行保留来源位置、共识/个案/推断/未知和三方互证纪律。
- 原版 [O]“与主智能体协作规则”要求写共享目录并回传路径、核心结论和缺口；当前 [C] 第 16 行固定同类回执，同时保持后台交付。

## 最终差异

- 当前 [C] 相对原版 [O] 新增 Promax 运行时适配：所有输入与获准网页先冻结为 manifest 中的 `SRC-*`，联网事实同时回指 SRC 与 URL。
- 当前 [C] 把产物所有权机械固定为 `deliverables/{task_key}/customer_research.md`，并明确自检不等于独立 Judge 放行；这两项是平台交付约束，不改变原版 [O] 的客研方法和职责边界。
