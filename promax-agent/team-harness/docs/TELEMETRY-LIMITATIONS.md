# telemetry-tracker 在 dsh 上的边界

- 原版 `telemetry-tracker/hooks/telemetry-auto-track/handler.ts` 是 OpenClaw hook 格式；文件按原版完整保留，但 dsh 不加载它。
- Promax 由 `@promax/team-harness/telemetry-runtime` 监听 dsh 的 `session/event`：`turn/start` 以 `source=hook` 记录轮次，`tool/call` 以 `source=runtime` 记录真实工具调用，并写入本机 SQLite。
- 运行时只记录 session id、turn、事件类型、工具名、来源和时间，不记录消息正文、工具参数、工具结果或凭据。
- 使用情况查询由运行时工具 `promax_usage_report` 读取聚合计数；返回逻辑不写进部门 persona。该工具不是主动推送、定时任务或跨设备遥测。
- 负责人仍需在人验环境确认实际 profile 的数据库路径可写、事件确实落库，不能仅凭模块测试宣称线上 hook 已生效。
