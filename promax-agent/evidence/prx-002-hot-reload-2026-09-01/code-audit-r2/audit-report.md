# PRX-002 第 2 轮独立代码核查报告

## 0. 任务卡

| 项目 | 内容 |
|---|---|
| 任务目标 | 显式允许同 revision 覆盖，同时保证 target 原子可用、staging 中断后无半成品，并保持默认不可变行为。 |
| 客观验收指标 | 默认拒绝；正常覆盖/verify/计数一致；staging 硬中断后 target 完整且无临时半成品；全量测试通过；diff 不越界。 |
| 已知作弊路径 | 用可捕获异常代替硬退出；把 helper 清理完成后的父进程退出叫作“交换后崩溃”；只看 4/4、35/35；只验证 target，不检查输出根残留。 |

## 1. Agent 汇报摘要

- 原话：`新增交换失败和交换后硬退出 86 的进程级回归测试。`
- 原话：`原核查注入器重跑：target 存在、无 staging/backup、verify 有效。`
- 原话：`定向测试：4/4；全量测试：35/35。`
- 原话：`但不宣布 PRX-002 通过。`

## 2. 动作 vs 效果拆分

| 动作 | 实际效果 | 跳步/偷换 |
|---|---|---|
| 用 `renamex_np(RENAME_SWAP)` / `renameat2(RENAME_EXCHANGE)` 取代两次 rename | macOS 正常路径的 target 切换为单次内核交换 | Linux 未实测；任务文件仍保留旧 `renameSync` 方法约束 |
| 原注入器重跑 | 证明旧 target→backup 缺失窗口已消失 | 不能证明新 staging 生命周期没有崩溃残留 |
| staging 写入失败测试 | 可捕获异常时 outer catch 清理 staging | 不是 staging 阶段硬退出；`process.exit(86)` 会绕过 catch |
| helper 返回后主进程退出 86 | helper 已完成交换和 `rmtree` 后 target 有效、无临时目录 | 未覆盖 helper 交换后、清理前的窗口 |

## 3. 红旗词扫描

| 结论词 | 证据 | 独立核实 |
|---|---|---|
| 4/4、35/35 | `module-tests.log` | 是，数字属实 |
| 原注入器无 staging/backup | 独立重跑输出 | 是，旧漏洞已闭环 |
| staging 中断无半成品 | `staging-hard-exit.log` | 否，被证伪 |
| 交换后硬退出无临时目录 | 现有测试只在 helper 清理完成后退出；`helper-cleanup-gap.log` 补测清理前窗口 | 部分属实 |

## 4. 证据核查表

| 结论 | 证据 | 可机械复算 | 结果 | 判定 |
|---|---|---|---|---|
| 默认不覆盖 | `module-tests.log` | 是 | exit 1，`REVISION_IMMUTABLE` | 属实 |
| 正常显式覆盖与 verify | `module-tests.log` | 是 | exit 0；111=111；哈希一致；valid | 属实 |
| CLI 只显式开启 | `src/cli.mjs:22-37,100-106` | 是 | 仅字面 flag 传 true | 属实 |
| target 单次内核交换 | `src/harness.mjs:696-752,798-803` 与本机正常运行 | 是 | Darwin 分支成功 | 属实（本机） |
| staging 硬中断无半成品 | `staging-hard-exit.log` | 是 | 留下 1 文件 staging，重试后仍残留 | 不属实 |
| 交换清理窗口无残留 | `helper-cleanup-gap.log` | 是 | target valid，但旧 revision 留在 staging | 不属实 |
| 测试覆盖机验项 | `test/compile-overwrite.test.mjs:112-177` | 是 | 可捕获写异常、helper 完成后的父退出；未测 staging 硬退出 | 部分属实 |
| diff 范围 | `git-audit.log` | 是 | 仅 3 个允许文件 | 属实 |
| dsh 真实识别/热重载 | 未执行人验 | 否 | 无运行证据 | 未验证 |

## 5. 独立复核

- 方式：提交与完整 diff 审阅、测试源码审阅、任务命令复跑、原注入器复跑、staging 硬退出与 helper 清理窗口故障注入。
- 轮次：第 2 轮核查会话，2026-09-01。
- 偏差：自报的正常路径和测试数字属实，旧 target 缺失漏洞已修；但测试仍把可捕获异常当作 staging 中断，漏掉硬退出半成品。

## 6. 反问清单

- [x] 原始命令、退出码、文件计数与哈希已保存。
- [x] 未执行的人验、Linux 分支与任务措辞漂移已列出。
- [x] 用 `process.exit(86)` 实际证伪 staging 清理 claim。
- [x] 4/4、35/35 均复算，未把绿灯当完成。
- [x] 已区分 target 原子可用与临时目录崩溃清理。

## 7. 最终判定

| 判定 | 依据 |
|---|---|
| 未达标 | “staging 阶段中断后没有半成品”机验项失败；硬退出留下 1 文件 staging，后续成功覆盖也不回收。不得进入人验或合并。 |

## 8. 待改进 / 复盘记录

- 看起来完成但实际未完成：`交换后硬退出 86` 用例只在 Python helper 已完成清理后退出父进程，避开了真正的 staging 写入硬退出与 helper 清理窗口。
- 下一轮必须把本轮 `hard-exit-during-staging.mjs` 的行为固化成回归，并检查重试后旧 PID staging 数量为 0。
