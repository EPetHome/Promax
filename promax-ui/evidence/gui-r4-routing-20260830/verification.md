# GUI × Agent r4 preset 路由复验

## 结论

- 新建或复用的 blank 产品团队会话以 `promax-team-mtcjsbcz-04tpe2-r4` 为当前 preset。
- 已有产品团队 r3 会话继续保留创建时的 `revision=3` / r3 preset binding，不迁移。
- r4 的 7 名成员和 8 份业务产物已经从运行时 preset 读取；Judge 报告仍排除在 8 份业务产物外。
- 本次未运行模型；Agent 线只负责带凭据安全重启，GUI 线完成无模型浏览器复验后才放行其继续 r4 回归。

## 代码证据

- `packages/promax-ui-console/src/client/team-state.ts:5-6`：固定产品团队 active preset/revision 切为 r4。
- `packages/promax-ui-console/src/client/team-state.ts:346-370`：恢复状态时只用当前 r4 roster 更新 active team，但 session bindings 独立解析、保留旧 preset/revision。
- `packages/promax-ui-console/src/client/team-state.ts:658-673`：每个 session 保存独立的创建时 binding。
- `packages/promax-ui-console/src/client/index.tsx:150-159`：运行时 `list/read` r4 并校验返回 preset。
- `packages/promax-ui-console/src/client/index.tsx:217-225`：`connectWorkspace` 返回 blank/new session 后，仅在 blank 且 preset 不同的情况下调用 `agentPresets.select`。
- dsh 现役仓 `packages/client/runtime/src/client/workspaces/service.ts:89-120`：`connectWorkspace` 只复用 workspace 内既有 blank session，否则新建；不会返回历史非空会话供重新选 preset。
- `packages/promax-ui-console/src/client/PromaxWorkspaceShell.tsx:535-541`：Judge 身份按固定 `quality_judge` 精确识别，不再从成员目标文案猜测。

## 回归测试

- `packages/promax-ui-console/tests/team-state.test.ts:179-210`：模拟存量 product active r3 + 历史 r3 session binding，重新加载后 active team 为 r4，历史 binding 仍为 r3。
- `packages/promax-ui-console/tests/shell-registration.test.tsx`：blank session 原 preset 为 r3 时，新建流程选择 r4 并记录 r4。
- `packages/promax-ui-console/tests/workspace-shell.test.tsx:406-455`：使用 r4 真实客研职责文案（含“可判定”），仍得到 8 份业务产物和唯一 Judge。
- `pnpm test`：16 文件、71/71。
- `pnpm typecheck`、`pnpm build`、`git diff --check`：通过。

## 分发与配置不变量

- 安装态：`@promax/promax-ui-console@0.3.37`、`@promax/promax-report@0.1.1`。
- release：6 个 tgz + 3 个脚本，共 9 项 SHA256 全部 OK；install 脚本没有把 report 降回 0.1.0。
- 唯一采用的 dump 入口：在 `/Users/Admin/Desktop/Promax/promax-agent/deepseek-harness` 执行 `DSH_HOME=/Users/Admin/.dsh-promax pnpm dsh --profile web --dump-config`。
- 安装前后均为 17,205 bytes，SHA256 均为 `e8856b9d95783f9b97d3c3c1858fdedb3dd25f8f70b57de6081cdad5dc0526a3`，`cmp` 退出码 0。
- 早先对其他 dsh 工作副本和未显式设置 `DSH_HOME` 的试探全部作废，不计入证据。
- 现役运行态：PID `92751`，console 0.3.37，report 0.1.1，HTTP 200；凭据仅由 Agent 线从 permission-600 auth.json 注入进程，GUI 线未读取或打印。

## 浏览器证据

- 产品首页读取到 r4 独有的客研职责：“可追溯、可判定且不外推样本边界”。
- `业务产物` region 精确 8 个按钮；`customer_research.md` 精确 1 个；页面显示 `0 / 6 就绪 · 2 项可选未产出`。
- 左栏历史 `Revision 3` 标签精确 2 个。
- 打开 CP3 历史会话后，dsh 主区仍显示 `team-mtcjsbcz-04tpe2@r3`，证明 host 会话和 GUI 创建时 binding 都没有迁移。
- 截图：`r4-eight-deliverables-0.3.37.png`、`historical-r3-session-0.3.37.png`。

## 边界

- 本次证明的是 preset 路由、历史 binding 保持和 r4 roster/产物投影；没有运行模型，不宣称 r4 customer_research 动态生成回归完成。
- A 方案保留的 dsh 对话内部结构、人工决策流和 Judge 动态闭环结论不变。
