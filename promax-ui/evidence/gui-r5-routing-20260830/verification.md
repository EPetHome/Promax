# GUI r5 preset 路由复验（2026-08-30）

## 范围

- 新建/blank 产品团队会话改用 `promax-team-mtcjsbcz-04tpe2-r5`。
- 历史 r3/r4 会话继续使用创建时保存的 revision/preset binding，不迁移。
- GUI 线不运行模型、不做 r5 浏览器验收、不重启共享 3080；安装后安全重启由 Agent 线另行完成。

## 实现证据

- r5 active preset/revision：`packages/promax-ui-console/src/client/team-state.ts:5-6`。
- 恢复本地状态时，仅复用与当前 r5 preset 精确匹配的 runtime roster；旧 active roster 不覆盖 r5，但 `sessionBindings` 原样解析保留：`packages/promax-ui-console/src/client/team-state.ts:346-371`。
- blank 会话在 preset 不同于 r5 时才调用 `agentPresets.select`；非 blank 历史会话不重绑：`packages/promax-ui-console/src/client/index.tsx:237-246`。
- r5 roster 仍从安装态 preset 的已发布快照读取，不在 GUI 复制成员名单：`packages/promax-ui-console/src/client/index.tsx:158-167`、`packages/promax-ui-console/src/client/team-state.ts:449-459`。

## 契约复验

对安装态 `/Users/Admin/.dsh-promax/.agent-presets/promax-team-mtcjsbcz-04tpe2-r5/agent.cordis.yml` 调用 GUI 的 `runtimeTeamRosterOf`：

```json
{"presetId":"promax-team-mtcjsbcz-04tpe2-r5","revision":5,"members":7,"business":8,"judge":1}
```

Judge 路径仍为 `.promax/judge/{task_key}/judge.md`，未计入 8 份 `deliverables/` 业务产物。

## 自动化与构建

- 针对性：3 个测试文件、30 项通过。
- 全量：16 个测试文件、73 项通过。
- `pnpm typecheck`：通过。
- `pnpm build`：通过；console client 产物含 r5，不含作为 active preset 的 r4。
- `git diff --check`：通过。
- `pnpm package:dist`：生成 `promax-promax-ui-console-0.3.39.tgz`；`promax-promax-report-0.1.1.tgz` 未降级。
- `shasum -a 256 -c SHA256SUMS`：9/9 通过。

## 安装与配置不变量

- 安装命令：`DSH_HOME=/Users/Admin/.dsh-promax PROMAX_DSH_REPO=/Users/Admin/Desktop/Promax/promax-agent/deepseek-harness ./release/install-promax.sh web`。
- 安装态：console `0.3.39`、report `0.1.1`、layout `0.1.5`、brand `0.1.7`。
- profile 依赖指向 release 中 console `0.3.39` 与 report `0.1.1` tgz。
- 安装前后准确命令均为：`DSH_HOME=/Users/Admin/.dsh-promax pnpm dsh --profile web --dump-config`。
- 两次完整捕获均为 17,269 bytes，逐字节相同；配置 stdout SHA256 均为 `e8856b9d95783f9b97d3c3c1858fdedb3dd25f8f70b57de6081cdad5dc0526a3`。

## 运行时状态

- Agent 线在安装完成后执行了安全重启；当前共享 3080 为 PID `3082`，启动时间 2026-08-30 12:25:49 EDT，HTTP 200。
- profile 依赖指向 console `0.3.39`、report `0.1.1`；本次不再重启、不跑模型、不追加 r5 浏览器验收。
- PID、启动时间和 HTTP 由 GUI 线只读复核；凭据注入方式与未跑模型由 Agent 线回传，GUI 线未读取、打印或转存凭据值。
