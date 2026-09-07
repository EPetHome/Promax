# PRX-002 独立代码核查报告

## 0. 任务卡

| 项目 | 内容 |
|---|---|
| 任务目标 | 在默认保持 revision 不可变的前提下，允许 CLI 显式覆盖同一 preset，并保证替换过程原子、失败后旧目录完整。 |
| 客观验收指标 | 默认拒绝；显式覆盖 + verify + 文件数一致；中断/失败不暴露缺失或半成品 target；全量测试通过；diff 不越界。 |
| 已知作弊路径 | 只验证正常覆盖；把同进程异常回滚当成进程中断安全；只看 `node --test` 绿灯；把“有 staging/rename”直接等同于“原子替换”。 |

## 1. Agent 汇报摘要

- 原话/提交：`feat(agent): allow atomic team revision overwrite`。
- 原话：`提升失败时立即回滚旧目录，成功后删除备份。`
- 原话：`退出码 0；34/34 通过，0 失败。`
- 原话：`实现会话未执行 GUI / 真实会话端到端验收`。
- 红旗扫描命中与本结论相关的词：`成功`、`符合预期`、`3/3 通过`、`34/34 通过`；这些均按原始命令和故障注入复核。

## 2. 动作 vs 效果拆分

| 动作 | 实际效果 | 跳步/偷换 |
|---|---|---|
| 增加 `allowOverwrite = false` 与 CLI 布尔开关 | 默认拒绝与显式覆盖正常路径成立 | 无 |
| staging 完整生成后，旧 target 改名为 backup，再提升 staging | 捕获到 promotion 异常且 rollback 成功时可恢复 | 把“两次 rename + 同进程回滚”当成 target 路径原子替换；进程中断时回滚不会运行 |
| 新增 3 个测试并跑全量 34 个测试 | 覆盖默认拒绝、显式覆盖、CLI 传递、staging 写异常、promotion 异常、verify 与文件数 | 未覆盖两次 rename 之间的硬中断、rollback 自身失败、backup 清理失败 |

## 3. 红旗词扫描

| 红旗结论 | 对应证据 | 独立核实 |
|---|---|---|
| 默认拒绝符合预期 | `module-tests.log`，`M1_EXIT=1` 与 `REVISION_IMMUTABLE` | 是 |
| 显式覆盖成功 | `module-tests.log`，覆盖退出 0、前后 111 项且 manifest SHA256 相同 | 是（正常路径） |
| 34/34 通过 | `module-tests.log`，`tests 34`、`pass 34`、`fail 0` | 是 |
| atomic overwrite | `crash-window.log`，中断后 target 不存在 | 否；结论被证伪 |

## 4. 证据核查表

| 结论 | 证据 | 可机械复算 | 结果 | 判定 |
|---|---|---|---|---|
| 默认未传开关仍拒绝 | `module-tests.log`、`src/harness.mjs:698-711` | 是 | 退出 1，错误码正确 | 属实 |
| CLI 只在显式 flag 时开启 | `src/cli.mjs:22-37,100-106`；同一测试先拒绝后成功 | 是 | 仅字面 flag 产生布尔 true | 属实 |
| 正常覆盖 verify 与文件数一致 | `module-tests.log` | 是 | valid，111=111，哈希相同 | 属实 |
| target 替换原子 | `src/harness.mjs:745-757`、`crash-window.log` | 是 | 两次 rename 间硬退出后 target 缺失 | 不属实 |
| 异常恢复完整 | `exception-paths.log` | 是 | rollback 再失败时 target 缺失；backup 清理失败时命令失败且双目录残留 | 部分属实 |
| 测试覆盖全部要求 | `test/compile-overwrite.test.mjs:68-137` | 是 | 未覆盖硬中断与上述异常窗口 | 不属实 |
| diff 未越界 | `git-audit.log` | 是 | 仅 3 个允许文件 | 属实 |
| dsh 真实识别/热重载 | 未执行人验 | 否 | 无运行证据 | 未验证 |

## 5. 独立复核

- 方式：完整 diff、调用链阅读、测试源码审阅、任务命令独立执行、进程级故障注入、异常路径故障注入。
- 复核轮次：第 1 轮核查会话，2026-09-01。
- 偏差：实现会话的正常路径与测试数字属实，但“原子覆盖”不成立；全绿测试未覆盖关键崩溃窗口。

## 6. 反问清单

- [x] 关键结论均有原始文件、退出码或日志。
- [x] 明确列出未执行的人验与未覆盖的崩溃窗口。
- [x] 用硬中断实际证伪 atomic claim。
- [x] 无主观分数/百分比；3/3 与 34/34 均按原始测试计数复算。
- [x] 已区分“正常覆盖动作完成”和“原子替换目标达成”。

## 7. 最终判定

| 判定 | 依据 |
|---|---|
| 未达标 | 原子写入机验项失败；target 在两次 rename 之间存在缺失窗口，硬中断可留下 target 缺失、backup + staging 残留。按任务规则不得进入人验或合并。 |

## 8. 待改进 / 复盘记录

- 看起来完成但实际未完成的说法：`allow atomic team revision overwrite`；现有实现提供的是正常路径覆盖和部分异常回滚，不是可抵抗进程中断的 target 原子切换。
- 下一轮验收必须把“旧目录改名后立即退出进程”固定为回归用例，并同时验证 target 可读性与 staging/backup 清理，而不是只注入可被 `catch` 捕获的异常。
