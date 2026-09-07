# 第 7 步交付核验：停止真能停 + Judge 返修闭环

核验时间：2026-09-04（America/New_York）

当前结论：代码、自动化测试、打包、安装和服务重启已完成；真实浏览器验收尚未闭合。真实浏览器创建新任务时，模型服务在规划阶段返回 `Insufficient Balance`（错误码 `QUOTA`），业务成员没有启动，因此不能把“执行中停止 child”和“Judge block 后真实返修复判”写成已通过。

## 关键能力结论

结论：走路线 A。dsh `0.1.1-rc.2` 在不修改 `deepseek-harness/packages/` 的前提下提供运行中 continuable child 当前 turn 的协作式取消能力，入口为 API Proxy 的 `subagents.interrupt`，底层为 `SubagentRuntime.interrupt()` → `Agent.cancel(cause, { keepInbox: true })` → 当前 phase 的 `AbortSignal`。当前 DeepSeek adapter 把该 signal 合并进流式请求并传给 `fetch`，所以当前 child LLM 请求会收到中止信号。

查证依据：

- `/Users/Admin/Desktop/Promax/promax-agent/deepseek-harness/packages/subagent/subagent/README.md:21`：`interrupt(targetSessionId, authority)` 明确说明发出 `Agent.cancel(cause, { keepInbox: true })`，接纳同步、效果异步。
- `/Users/Admin/Desktop/Promax/promax-agent/deepseek-harness/packages/subagent/subagent/src/index.ts:240-256`：`SubagentRuntime.interrupt()` 的实际入口。
- `/Users/Admin/Desktop/Promax/promax-agent/deepseek-harness/packages/host/apiproxy/src/api-proxy.ts:2676-2698`：`subagents.interrupt` API 校验父子归属后调用 runtime，并返回 `{ accepted: true }`。
- `/Users/Admin/Desktop/Promax/promax-agent/deepseek-harness/packages/core/agent-loop/src/agent.ts:134-140`：`Agent.cancel()` abort 当前 phase；同文件 `:332-385` 在 LLM stream 前和消费期间持续检查 signal。
- `/Users/Admin/Desktop/Promax/promax-agent/deepseek-harness/packages/llm/llm-deepseek/src/adapter.ts:460-469,494-498,607-612`：合并 caller signal、把 signal 传进 HTTP `fetch`、识别 caller abort。
- `/Users/Admin/Desktop/Promax/promax-agent/deepseek-harness/packages/subagent/subagent/tests/continuation.spec.ts:2471-2511`：中止后当前 turn 记录为 `aborted`，没有自动发起第二个 model request。

能力边界：这是 AbortSignal 驱动的协作式取消，不是操作系统进程强杀；API 返回 `accepted` 不代表 child 已经静止。Promax 因此在磁盘写 `stop_requested`、`draining`，持续查看父会话与所有后代，只有运行树真实静止后才写 `cancelled`。已删除 team stop 路径中的固定 15 秒 deadline；新实现不再产生 `failed_to_stop`。

## 实现结果

- 停止状态：`running → stop_requested → draining → cancelled`。`cancelled` 只在父会话和所有后代连续 600ms 都不是 running 后落盘。
- 停止动作：对所有运行中后代调用 `subagents.interrupt`，对父会话调用 cancel；等待期间重复中止仍在运行的后代，防止运行树残留。
- 停止界面文案：`已请求停止；正在中止当前步骤，之后不会再启动新成员`、`正在中止当前步骤并等待运行树真实静止`、`已请求停止 · 正在中止当前步骤`、最终磁盘状态为 cancelled 后才显示 `任务已停止`。
- Judge 闭环：新增磁盘控制文件 `.promax/tasks/{taskKey}/judge-repair.yml`，状态为 `repairing | judging | passed | exhausted`，最大返修轮次固定为 2。
- 每轮返修都保存业务产物与 Judge 报告的 mtime、字节数和 SHA-256 指纹；所有登记业务产物变化后才进入复判，Judge 报告变化后才读取新 verdict。
- 第 2 轮仍未通过时写 `exhausted`，界面显示 `多次返修后仍未通过` 并带 Judge 具体理由。
- 返修只重写业务产物；测试对冻结输入 manifest 做逐字节前后比对。

## 交付前自检（实际结果）

1. `pnpm typecheck`：退出码 0。
2. `pnpm build`：退出码 0。
3. 已打包并安装到 `/Users/Admin/.dsh-promax/`，已重启服务；安装版本 `@promax/promax-ui-console@0.3.82`、`@promax/promax-bundle@0.1.24`；`http://127.0.0.1:3080/` 返回 200。`release/SHA256SUMS` 全部校验通过。
4. dsh child 取消能力：提供；依据与路线 A 见“关键能力结论”。没有修改 `deepseek-harness/packages/`。
5. 真跑执行中停止：未通过。真实浏览器新建 `停止能力实测-20260904-长任务`，规划请求直接返回 `Insufficient Balance / QUOTA`，未进入确认派单，child 未启动，因而没有合法的 child step 前后对比和对应 `run-control.yml`。
6. 停止文案实截：未通过。尝试在规划重试后点击“停止团队任务”，点击时刻 `2026-09-04T07:09:40.657Z`；模型配额错误先结算，界面回到 `这次计划没有生成成功` / `Insufficient Balance`，没有形成 team stop 的磁盘状态，不能据此证明停止文案与真实 child 状态一致。组件测试覆盖了全部新文案，但这不替代真实截屏。
7. Judge block → 返修 → 重新产出 → 复判 → 最终界面：未通过真实运行。自动化测试已经覆盖一轮返修后 PASS、产物指纹变化、Judge 报告变化和冻结输入不变；真实任务被同一个 `QUOTA` 阻断在规划阶段。
8. 达上限实际界面文案：未通过真实运行。组件测试已验证 `多次返修后仍未通过` 与具体 Judge 理由，bundle 测试已验证两轮后 `exhausted` 且不再 steer；没有真实浏览器运行证据。

## 自动化与边界核验

- 全量测试：18 个测试文件、105 个测试全部通过。
- 聚焦测试：4 个测试文件、51 个测试全部通过。
- `git diff --check`：通过。
- 受保护文件核对：`PromaxSettings.tsx`、`src/workbench-styles.ts`、`promax-ui-brand/src/index.ts`、`promax-ui-brand/src/theme.ts` 的 SHA-256 与本步动手前记录一致。
- 未修改 `/Users/Admin/.dsh-promax/.agent-presets/`，未修改 `promax-end`，未修改 `deepseek-harness/packages/`。

## 继续验收的唯一外部条件

恢复当前 DeepSeek 凭据的可用额度后，重新执行自检 5、6、7、8。未取得这四项真实浏览器证据前，本步不能标记为完成。
