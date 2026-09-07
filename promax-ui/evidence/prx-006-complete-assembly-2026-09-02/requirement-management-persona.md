# requirement-management persona 对照报告

原版来源 [O]：`/Users/Admin/Desktop/IDaaS/调研/docs/智能体产品平台/skill迭代/docs/product-agent_20260826/requirement_management/AGENTS.md`，具体对照“需求管理智能体”“行为规范”“禁止事项”“智能体定位/核心职责”“配套技能”“定时任务”。

当前来源 [C]：`/Users/Admin/Desktop/Promax/promax-agent/team-harness/modules/requirement-management/agent-module.yml`，具体对照 `spec.base_persona` 第 12–18 行、5 个 `skill_refs` 第 19–24 行和固定产物第 30–34 行。

## 删除的 Promax 限制

- 删除旧 Promax“只生成本地 Markdown、不能执行任何外部系统动作”的无条件限制：原版 [O]“核心职责/配套技能”包含飞书录入、看板读取和归档；当前 [C] 第 14–16 行及第 20–23 行恢复这些能力，同时仅在缺凭据时保持只读 + dry-run。
- 删除旧 Promax“周报只被动接受后端派单、不表达注册意图”的限制：原版 [O]“定时任务”包含看板刷新、归档统计和周报，并要求用户先确认时间；当前 [C] 第 16 行允许确认后把调度意图交给平台后端，但没有 `job_id` 仍不声称注册成功。

## 保留的原版纪律

- 原版 [O]“行为规范/禁止事项”规定后台直接执行、缺口透明、禁止编造、不越权调度、不直接对外交付；当前 [C] 第 12–14 行保持一致。
- 原版 [O]“定时任务”要求先让用户确认执行时间，禁止自行决定；当前 [C] 第 16 行保留该前置条件。
- 原版 [O]“核心职责”要求保留需求生命周期数据并识别风险；当前 [C] 第 14 行具体保留原文、来源、重复依据、重要性、紧迫性、投入产出、状态、依赖和风险。

## 最终差异

- 当前 [C] 相对原版 [O] 新增凭据和外部动作安全边界：凭据缺失时仅只读 + dry-run，真实动作只限任务包授权的测试空间；没有 `job_id` 不声称定时任务已注册。
- 当前 [C] 新增 manifest/SRC 回指、固定 `deliverables/{task_key}/requirement_management.md` 和独立 Judge 边界；这些是平台治理，不删除原版 [O] 的需求管理能力。
