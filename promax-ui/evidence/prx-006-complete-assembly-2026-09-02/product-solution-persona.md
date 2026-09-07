# product-solution persona 对照报告

原版来源 [O]：`/Users/Admin/Desktop/IDaaS/调研/docs/智能体产品平台/skill迭代/docs/product-agent_20260826/solution_design/AGENTS.md`，具体对照“角色定位”“职责边界”“输入合同”“澄清与默认决策”“主 SOP”“产物状态”“输出合同”。

当前来源 [C]：`/Users/Admin/Desktop/Promax/promax-agent/team-harness/modules/product-solution/agent-module.yml`，具体对照 `spec.base_persona` 第 12–18 行、9 个 `skill_refs` 第 19–28 行和三类产物第 34–46 行。

## 删除的 Promax 限制

- 删除旧 Promax 只允许使用“已提供、可追溯业务输入”、不能使用获准联网事实的额外限制：原版 [O]“输入合同/主 SOP”允许完整上下文包驱动澄清、方案、流程、交互、原型、审计与交接；当前 [C] 第 12–18 行保留同一统一 worker 的完整能力，并让获准联网事实通过 manifest 使用。
- 删除旧 Promax 遇到业务口径冲突就一律停止的过宽限制：原版 [O]“澄清与默认决策”只让会改变核心范围、关键规则、高风险动作或验收标准的缺口阻塞；当前 [C] 第 16 行恢复阻塞/可默认区分和 `A-xxx` 假设。

## 保留的原版纪律

- 原版 [O]“职责边界”规定不替业务 Owner 拍板、不维护最终优先级、不输出数据库/API/技术栈/部署架构、不伪造格式与链接；当前 [C] 第 14 行完整保留。
- 原版 [O]“主 SOP”要求按需生成而非默认生成全部产物，并在浏览器、响应式、可访问性等真实验证后再提升状态；当前 [C] 第 16、18 行保留按需模式和验证诚实。
- 原版 [O]“输出合同”规定未运行的验证必须写 `not-run`；当前 [C] 第 16 行原样保留该语义。

## 最终差异

- 当前 [C] 相对原版 [O] 新增 Promax 全链路特例：用户明确要求完整流程时，固定写 `prd.md`、`business-diagram.md`、`prototype.html`；普通任务仍按需生成。
- 当前 [C] 新增 manifest/SRC 回指、`deliverables/{task_key}/` 文件所有权和独立 Judge 放行边界；原版 [O] 的产品方法、技术边界与验证纪律不变。
