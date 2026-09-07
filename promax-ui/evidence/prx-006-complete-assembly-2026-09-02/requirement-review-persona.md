# requirement-review persona 对照报告

原版来源 [O]：`/Users/Admin/Desktop/IDaaS/调研/docs/智能体产品平台/skill迭代/docs/product-agent_20260826/requirement-review/AGENTS.md`，具体对照“身份与边界”“核心原则”“评审模式选择”“角色识别”“执行流程”“评分与评级”“报告要求”“保存规则”“协作技能”“常见错误”。

当前来源 [C]：`/Users/Admin/Desktop/Promax/promax-agent/team-harness/modules/requirement-review/agent-module.yml`，具体对照 `spec.base_persona` 第 12–18 行、4 个 `skill_refs` 第 19–23 行和固定产物第 29–33 行。

## 删除的 Promax 限制

- 删除旧 Promax persona 未明确写回原版 Q1–Q12/Q1–Q24、唯一评分标准和按内容激活角色的缩略：原版 [O]“执行流程/角色识别”逐项规定这些机制；当前 [C] 第 14–16 行明确恢复，并保留 `requirement-review`、`logic-detector`、`issue-tracker` 三项专业能力。
- 删除旧 Promax persona 未明确写回历史整改对照的缩略：原版 [O]“保存规则/协作技能”要求历史版本对比、问题工单化和复检；当前 [C] 第 16 行明确保留版本差异与问题状态。

## 保留的原版纪律

- 原版 [O]“身份与边界”规定不替 Owner 拍板、不改最终 PRD、不越权调度、输入不足先标缺口；当前 [C] 第 12 行逐项保留。
- 原版 [O]“核心原则/报告要求”要求高风险优先、判断回指原文、禁止编造、建议可执行；当前 [C] 第 14–16 行保持一致。
- 原版 [O]“评分与评级”禁止新增自定义权重、扣分或阈值；当前 [C] 第 14 行仍限定唯一评分标准，没有新增评分语义。

## 最终差异

- 当前 [C] 相对原版 [O] 将报告统一写入 `deliverables/{task_key}/requirement_review.md`，而不是原版通用的 `review-reports/` 命名；这是团队文件责任适配。
- 当前 [C] 新增 manifest/SRC 输入闭集及“业务评审产物仍交独立 Judge”的平台层边界；没有把原版 [O] 的评审角色误当作最终 Judge，也没有改变评分纪律。
