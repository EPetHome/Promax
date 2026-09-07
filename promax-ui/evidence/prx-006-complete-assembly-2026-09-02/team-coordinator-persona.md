# team-coordinator persona 对照报告

原版来源 [O]：原版没有独立 coordinator persona。不存在可引用的第七份原版 `AGENTS.md`；对照基线只能使用六份原版 persona 的后台角色/主智能体协作规则，以及原版总表 `/Users/Admin/Desktop/IDaaS/调研/docs/智能体产品平台/skill迭代/docs/product-agent_20260826/AGENTS/智能体技能清单与提示词.md` 的“技能清单总览/各智能体技能详情与提示词”。本报告不虚构 coordinator 原版来源。

当前来源 [C]：`/Users/Admin/Desktop/Promax/promax-agent/team-harness/modules/team-coordinator/agent-module.yml`，具体对照 `spec.objective` 第 10 行、`spec.base_persona` 第 12–26 行和 `telemetry-tracker` 引用第 27–28 行。

批准合同 [T]：`/Users/Admin/Desktop/IDaaS/调研/docs/智能体产品平台/Agent平台/out/需求/PRX-006-完全体智能体装配与设置页.md` 的“任务目标”“完整流程与边界”“完成标准”，它是 coordinator 分阶段、文件责任和 Judge 流程的任务真源。

## 删除的 Promax 限制

- 因原版没有独立 coordinator persona [O]，当前模块 [C] 也没有可诚实表述为“从原版 coordinator 删除或恢复”的能力限制；不得把平台协调合同伪装成部门原版 persona。
- 本轮没有另行声称删除 coordinator 的原版纪律。当前 [C] 只是按批准合同 [T] 固定普通/全链路路由、阶段依赖、等待结算、文件责任与集中 Judge；六份原版 [O] 的“不越权调度/通过主智能体统一交付”是设置该平台角色的边界依据。

## 保留的原版纪律

- 六份原版 [O] 共同要求专业角色是后台子智能体、不自称主智能体、不越权调度、产物写共享目录后由主智能体统一交付；当前 [C] 第 12、18、20、22 行把这些协作规则落实为 coordinator 调度，且明确 coordinator 不代写业务文件。
- 六份原版 [O] 共同保留输入不足标缺口、禁止编造、证据在后且结论可追溯；当前 [C] 第 18、22、24、26 行要求不可变输入、回读真实文件、矛盾阻断和未验证诚实。

## 最终差异

- 当前 [C] 是 Promax 新增的平台级 persona，而不是第七份部门原版 persona：它按批准合同 [T] 实现第一阶段并行、后续顺序依赖、一次集中 `quality_judge`、失败退回原成员、两轮上限、申诉和人工放行。
- 当前 [C] 新增 manifest/SRC 闭集、稳定文件责任、运行时联网证据回传和最终回执；这些治理项包围但不改写六份原版 [O] 的业务角色定位。Judge 仍由独立成员承担，coordinator 不自行判定质量通过。
