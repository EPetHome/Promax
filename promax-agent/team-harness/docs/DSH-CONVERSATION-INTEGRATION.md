# Promax 团队会话与 dsh 交互协议

## 1. 结论

Promax Team API 只负责团队配置、TeamRevision 冻结和 preset 解析，不代理业务会话事件，也不另定义一套聊天协议。团队进入业务会话后，GUI 必须直接消费 dsh `ConversationSnapshot`、`session.prompt()` 与原生 `conversation.composer` 接管链。

团队导航、成员展示与 `@member` 是 Promax 界面能力；消息队列、交互式问题、审批、流式输出、工具调用、错误、Chat 和 Trajectory 仍由 dsh 会话协议提供。GUI 不得只抽取 user/assistant 最终文本后另做一个不完整 transcript。

## 2. 所有权边界

| 对象 | 所有者 | GUI 行为 |
|---|---|---|
| TeamInstance、当前团队、workspace 关联 | GUI | 本地持有并驱动导航 |
| TeamRevision、preset_id、稳定 member_id/runtime_tool_id | Agent Harness | 从配置/发布结果保存引用，不自行推导 |
| ConversationSnapshot、pending、queue、runningCalls | dsh | 订阅当前 session 原生快照 |
| question/approval 回答协议 | dsh | 复用 `conversation.composer` 接管项及 PendingWait 响应 |
| Chat、Trajectory、工具卡、流式 partial、错误 | dsh | 复用原生渲染面或同等完整消费公开快照 |
| 成员聚合状态 | GUI | 用 TeamRevision 稳定映射连接 dsh 真实事件，不按团队级 running 猜测 |

这不是新增后端 API。`/promax-team-api/v1alpha2/*` 不返回、缓存或转发 ConversationSnapshot。

## 3. 新会话与发送规则

1. GUI 从 TeamInstance 找到固定 `team_revision_id`，再从 TeamRevision 读取 `preset_id`。
2. 新建空白 dsh session，在首条业务消息前选择一次该 preset。
3. 默认消息提交给 coordinator/root session；`@worker` 先转换为冻结 revision 中的稳定 `member_id` 路由。
4. 调用 `session.prompt(content, 'queue')`。
5. `{ ok: true, value: { accepted: true } }` 只表示 dsh 接收了消息；它可能立即开始、进入 queue，或等待当前 pending interaction 解决。
6. GUI 必须从后续 ConversationSnapshot 判断真实状态，不能把 `accepted` 当作 `turn/start` 或完成回执。
7. 发送失败时保留草稿并展示 `promptError`；发送已接受后，消息必须立即从 queue 或 steering 投影可见，不能从界面消失。

旧会话继续读取会话头中已固定的 preset。团队发布新 revision 只影响后续新会话。

## 4. GUI 必须消费的 ConversationSnapshot 字段

最低完整集合：

| 字段 | 用途 |
|---|---|
| `nodes` / `chat` | 已提交的用户消息、最终回复、工具结果和错误 |
| `partial` | 当前流式 assistant 输出 |
| `running` | 当前 turn 是否仍在运行 |
| `runningCalls` | 正在调用的工具和稳定 tool name |
| `pending` | question/approval 等正在阻塞当前 turn 的人机交互 |
| `queue` | 已接受但尚未被 Agent claim 的消息 |
| `composerPhase` | 当前输入区是否应由普通输入、问题或审批接管 |
| `turnTimings` / `turnEnds` | turn 进度、耗时与完成判定 |
| `openState` / `openError` | 历史恢复状态和打开失败 |
| `promptError` / `lastAgentError` | 发送失败和无 turn 位置的运行失败 |
| `removed` | 会话已断开，禁止继续发送 |

不得用一个只有 `nodes/partial/running/openState` 的裁剪类型冒充完整业务聊天快照。

## 5. pending interaction 是阻塞态

当 `pending.length > 0` 时，当前 turn 仍未结束：

- `kind=question`：必须由 dsh `ui-user-questions` 的 `QuestionComposer`/`PendingQuestion` 或等价的 `PendingWait.respond()` 协议回答；普通文本消息不是问题答案。
- `kind=approval`：必须由 dsh 审批接管面回答；不得绕过审批继续执行。
- 普通消息仍可按 dsh 规则进入 queue，但 GUI 必须显示“已排队，等待你先处理当前问题/审批”。
- pending 解决后，dsh 恢复当前 turn；当前 turn 结束后才轮到 queue 中的下一条普通消息。

GUI 关闭问题卡只能发送协议定义的取消响应，不能只在本地隐藏卡片。刷新页面后应依赖 dsh replay 恢复仍有效的 pending 请求。

## 6. 状态优先级与用户反馈

同一时刻采用以下优先级，避免“正在处理”和“等待用户”互相覆盖：

1. `removed`：会话已断开；
2. `openState=error`、`lastAgentError` 或最近 turn error：执行异常；
3. `pending`：等待用户回答或审批；
4. `runningCalls`：正在使用工具/成员；
5. `running`：正在分析、协调或组织下一步；
6. `queue`：消息已排队；
7. 其他：等待任务或最近一轮已完成。

主界面展示结构化状态、成员动作、工具、耗时和可公开摘要；不得把系统提示、凭据、上传资料原文或内部日志墙直接倾倒给用户。完整过程通过可折叠详情或 Trajectory 查看。

## 7. Promax 成员运行映射

TeamRevision 提供稳定 `member_id` 与 `runtime_tool_id`。GUI 使用真实 dsh 事件建立物理实例映射：

```text
parent session + tool call name(runtime_tool_id)
  -> stable member_id
  -> child session / subagent address（存在时）
```

成员展示态只能来自当前父会话的真实 tool call、child lineage、结算和失败事件：

| 显示态 | 机械依据 |
|---|---|
| 已配置 | revision 有该成员，但当前没有对应事件 |
| 已排队 | coordinator 已创建对应待执行任务，但尚无运行实例 |
| 执行中 | 当前 running call 的 name 精确等于该成员 runtime_tool_id，或已确认 child 正在运行 |
| 等待用户 | 该成员所在活动 turn 有 pending interaction |
| 已完成 | 对应调用/child 已结算成功 |
| 失败 | 对应调用/child 有明确失败事件 |

只有团队级 `running=true` 时，不得把所有 worker 显示为“等待分派”，也不得猜测某个 worker 已启动。

## 8. GUI 验收门禁

必须使用脱敏数据覆盖：

1. Enter 发送、Shift+Enter 换行、IME 组合输入不误发；
2. 第二、第三条连续消息都能在已提交或 queue 状态中立即看见；
3. question pending 可见、可回答、可取消，回答后同一 turn 继续；
4. pending 未解决时的新消息明确显示为已排队；
5. approval pending 不被普通文本绕过；
6. partial、runningCalls、turn error、promptError 和 disconnected 均有可见反馈；
7. Chat/Trajectory 可访问，主界面不倾倒未经结构化的内部日志；
8. member 卡只按稳定映射展示真实状态；
9. 新 revision 不改变旧会话 preset；
10. 所有产物仍真实落在团队 workspace 的 `deliverables/` 相对路径。

脱敏阻塞态样例见 `examples/integration/conversation.pending-question.yml`。
