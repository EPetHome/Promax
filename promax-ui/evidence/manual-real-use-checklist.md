# Promax 真实使用手验清单

规则：本文件的运行记录只允许追加，不删除、不改写旧记录。自动化测试是自检，不能替代下面的真实模型与磁盘产物检查。

## 固定检查项

- [ ] 用 `scripts/start-real-use.sh` 启动；如需把 release 重装进隔离运行时，使用 `scripts/start-real-use.sh --refresh`。
- [ ] 浏览器进入产品团队时无崩溃，成员数、业务产物数与当前 TeamRevision 一致。
- [ ] 提交一句话小任务，明确只要一份产物；任务包也只能列出这一份 requested artifact。
- [ ] 主智能体读取冻结输入并调用真实模型成员；不能用 mock、路由 `ok` 或测试绿灯代替。
- [ ] 产物在 `deliverables/{task_key}/` 落盘、非空，且保留输入中的用户、场景、痛点、范围、约束和优先级。
- [ ] full/team tier 必须有 Judge 结果；single tier 允许由协调者回读自检，不伪装成 Judge PASS。
- [ ] GUI 与磁盘一致：执行成员、产物路径、生成状态、验收方式、完成比例必须说同一件事。
- [ ] 若点击停止，child 不再产生新 step；未实际验证时必须记为 `not-run`。
- [ ] 记录运行版本、任务键、产物摘要、失败点和未验证项。

## 运行记录（append-only）

### RUN-001 · 2026-09-02 · FAIL / 主动停止

- 运行版本：UI 0.3.65；team-harness 0.6.3-dist.1。
- 输入：社区图书馆到馆提醒，要求“只产出一份简短 PRD”。
- 发现：规划器把正文中的“需求优先级”误当成第二份 `requirement_management.md`；长任务键还以省略号结尾，让模型把准确路径误判成截断路径。
- 处置：点击“停止团队任务”；随后修复单产物显式意图优先级，并把长任务键改为稳定哈希后缀。
- 结论：失败运行保留，不作为完成证据。

### RUN-002 · 2026-09-02 · PASS（single tier）

- 运行版本：UI 0.3.67；team-harness 0.6.3-dist.1；TeamRevision `promax-product-team@r1`。
- 用户输入：`社区图书馆到馆提醒 PRD`；已给出目标用户、使用场景、痛点、站内提醒范围、不发短信约束、P0 优先级，并明确只产出一份简短 PRD、不联网。
- 输入/调度：task package 为 `tier=single`，requested artifacts 仅 `deliverables/社区图书馆到馆提醒 PRD/prd.md`，starting point 仅 `solution_design`，无缺口。
- 真实执行：主智能体校验 SRC-001 哈希后调用 `solution_design`；成员真实生成产物，协调者随后回读文件并做存在、非空和输入保真检查。
- 磁盘产物：`/Users/Admin/Promax/产品/deliverables/社区图书馆到馆提醒 PRD/prd.md`，123 行、9,369 字节，SHA-256 `51923e4c2adc2be66ebf94a85c954221cbb062380c276c2b18a9b1572d08eafb`。
- GUI 结果：团队已完成、100%、`1 / 1 就绪`、方案智能体已完成、`prd.md 已完成 · 单层自检`；没有伪造 Judge PASS。
- 模型回执：状态“已完成并交付”，产物路径与磁盘一致；Judge 明确为未执行，因为 single tier 不含 Judge slot。
- 内容抽查：PRD 保留目标用户、到馆日前一天、遗忘导致预约失效、只做站内提醒、不发短信、P0；联网、自动化校验、独立评审和真实用户验证均诚实标记为未执行。
- 未验证：本轮没有执行停止后 child 不再产生 step 的回归；保留为下一次真实运行检查项。

### 2026-09-02 运行时补丁记录（非一次新的真实使用）

- UI 0.3.68 在 RUN-002 的 single-tier 完成投影上增加取消态保护：已取消任务即使遗留非空文件，也不能被标成“单层自检完成”。该项已用结构化投影回归测试覆盖；没有冒充一次新的真实模型验证。

### RUN-003 · 2026-09-04 · MIXED（主链 PASS / 停止 FAIL）

- 运行版本：`@promax/promax-ui-console@0.3.81`、`@promax/promax-bundle@0.1.23`、`@promax/team-harness@0.6.4-dist.1`；用户页面团队名 `promax-team`。
- 脱敏需求：为社区体育馆设计“预约开始前 30 分钟站内提醒”；目标用户为已预约场地的市民，场景为到场前查看提醒，痛点为容易忘记，范围仅站内提醒、不发短信，P0；只要一份简短 PRD，由独立 Judge 检查，不联网。
- 派工确认：主智能体逐个判断七名 roster，最小必要计划只选 `solution_design` 与固定 `quality_judge`；计划业务产物仅 `prd.md`，用户点击“就这样跑”后才执行。
- 冻结输入：`.promax/input/场馆预约提醒收口验收-停止成功演练/manifest.yml` 只含 SRC-001；任务包为 `.promax/tasks/场馆预约提醒收口验收-停止成功演练/task-package.yml`。
- 真实执行：`solution_design` 生成并回读 PRD，`quality_judge` 只从精确任务包进入；两名成员均真实结算。
- 磁盘产物：`/Users/Admin/Promax/产品/deliverables/场馆预约提醒收口验收-停止成功演练/prd.md`，147 行、9,117 字节。
- Judge：`/Users/Admin/Promax/产品/.promax/judge/场馆预约提醒收口验收-停止成功演练/judge.md`，104 行；整体 verdict=pass，三条 PRD 领域规则和五项通用检查全部 pass。
- GUI：结果页显示“任务完成”“跑完了。1 个文件。”“prd.md”“✓ 判定通过”；实际点开过进度树，能看到成员、文件生成和 Judge 状态。
- 打开目录：点击“打开文件夹”后，Finder 前窗实测为 `/Users/Admin/Promax/产品/deliverables/场馆预约提醒收口验收-停止成功演练/`；与页面 task key 和业务文件一致。
- 停止复验（FAIL）：在另一轮执行阶段点击“停止团队任务”，子 Agent 未在 15 秒内静止，页面报“停止任务失败”；规划阶段点击停止也没有中断规划。因此本轮不能把停止能力记为通过。
- Judge 反例（保留）：`场馆预约提醒收口验收-最终完成` 的 PRD 把一条加工收敛规则误标为“输入隐含”，Judge 判 block；页面同步显示“✕ 判定不通过”。主智能体发送返修消息后没有继续得到成员结算与复判，自动返修闭环未通过。
- 未验证：`prototype-v1.html` 浏览器交互审计未执行；服务端产物回传与 `raw/{employee-id}/` 未执行；真实飞书未调用。
