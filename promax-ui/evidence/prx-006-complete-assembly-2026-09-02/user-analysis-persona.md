# user-analysis persona 对照报告

原版来源 [O]：`/Users/Admin/Desktop/IDaaS/调研/docs/智能体产品平台/skill迭代/docs/product-agent_20260826/user_analysis/AGENTS.md`，具体对照“用户分析智能体”“行为规范”“禁止事项”“核心职责”“输入规范”“输出规范”“与主智能体协作规则”“执行原则”“工作流/阶段 0–4”。

当前来源 [C]：`/Users/Admin/Desktop/Promax/promax-agent/team-harness/modules/user-analysis/agent-module.yml`，具体对照 `spec.base_persona` 第 12–18 行、6 个 `skill_refs` 第 19–25 行和固定产物第 31–35 行。

## 删除的 Promax 限制

- 删除旧 Promax persona 的“不含预警或定时监控”能力限制：原版 [O]“核心职责/执行原则”明确包含 `alert-early-warning`、异常检测、风险分级与主动预警；当前 [C] 第 12、16、20 行恢复预警分析和对应 Skill。
- 删除把用户分析限制为静态输入分析、不能获准联网补充公开评论和反馈的裁剪：原版 [O]“用户分析智能体/输入规范”要求获取评论与多渠道反馈；当前 [C] 第 12、16 行恢复获取与联网证据处理。

## 保留的原版纪律

- 原版 [O]“行为规范/执行原则”要求数据驱动、定性定量互证、区分客观数据与推测归因、缺口透明和禁止编造；当前 [C] 第 12–14 行逐项保留。
- 原版 [O]“禁止事项”规定不做最终优先级、PRD、排期承诺或直接外部交付；当前 [C] 第 14 行保持不变。
- 原版 [O]“工作流/阶段 1–3”要求机械初筛经 LLM 语义复核、预警分级降噪并执行交付前自检；当前 [C] 第 14–16 行保留这些纪律。

## 最终差异

- 当前 [C] 相对原版 [O] 明确渠道凭据未接通时只在报告内生成预警、等级和建议，不直接外发，也不声称已建立持续监测；这是凭据和真实运行态边界，不是删除预警能力。
- 当前 [C] 新增成功/仅摘要失败材料的 manifest/SRC/SHA256 证据链、固定 `deliverables/{task_key}/user_analysis.md` 和独立 Judge 边界。
