# 团队运行态与一键停止复验（2026-08-30）

## 修复口径

- 「团队待命」只在父会话和整棵可观测 subagent 会话树均无运行、等待确认、排队或同步状态时显示。
- 只要任一后代 subagent `running`，顶部药丸显示「团队运行中」。
- 团队执行中，发送按钮切换为「停止团队任务」；一次点击先请求中断所有当前运行后代，再调用父会话原生 `stop()`。

## 实现证据

- subagent lineage 聚合：`packages/promax-ui-console/src/client/PromaxWorkspaceShell.tsx:643-685`。
- 团队可用性判定：`packages/promax-ui-console/src/client/PromaxWorkspaceShell.tsx:688-700`。
- composer 运行态、停止态与错误反馈：`packages/promax-ui-console/src/client/PromaxWorkspaceShell.tsx:1310-1410`。
- dsh `subagents.interrupt` 接线，使用现有团队的 `continuable` 模式：`packages/promax-ui-console/src/client/index.tsx:174-186`。
- 组件行为回归：`packages/promax-ui-console/tests/workspace-shell.test.tsx:297-327`、`:415-447`。
- API 接线回归：`packages/promax-ui-console/tests/shell-registration.test.tsx:150-162`。

## 验证

- 针对性：`workspace-shell`、`shell-registration`、`style-policy` 共 29 项通过。
- 全量：16 个测试文件、73 项通过；typecheck、build 通过。
- 隔离浏览器加载安装态 0.3.38：真实点击验证左栏收起后出现「展开导航」且可恢复，右栏收起后出现「展开状态栏」且可恢复；草稿、团队、项目组与三个 tab 均可达。
- 截图：`team-workbench-0.3.38.png`。

## 后续动态验证

- 静态复验之后已另建不接触共享 3080、无需模型的隔离 dsh Web 夹具，并在真实浏览器中点击一次「停止团队任务」。
- 父会话与运行中的 subagent 最终均为 `idle`，两边最后一个 turn 均为 `aborted`；界面恢复「团队待命」和「发送任务」。
- 动态验收、截图与运行时结果见 `../gui-team-stop-dynamic-20260830/verification.md`。
