# 联网闭环、Judge 与 telemetry

## 联网证据闭环

- `promax-bundle/cordis.patch.yml` 实际装配 `@deepseek-ai/dsh-tool-web`、`@deepseek-ai/dsh-web-fetch-http`、`@deepseek-ai/dsh-web-search-deepseek`，搜索后端只引用 `DEEPSEEK_API_KEY` 名称，没有密钥字面量。
- `team-harness/src/external-capabilities.mjs` 在运行时监听 web 工具结果并调用 manifest 追加逻辑；成功正文和只取得摘要的失败结果都写入 URL、抓取时间、`fetch_status`、HTTP 状态与 SHA256。
- `team-harness/src/harness.mjs` 负责冻结、追加、SHA256 校验和业务产物 SRC 回指校验；篡改快照后 `validateEvidenceInput` 返回哈希不匹配，业务产物遗漏联网 SRC 时返回 `EVIDENCE_SOURCE_REFERENCE_MISSING` 并指出 SRC ID。
- `team-harness/src/external-capabilities.mjs` 把 `validateBeforeJudgeExecution` 接到 dsh 的 `tools/pre-execute` 生产门禁；稳定工具 `quality_judge` 只有在 manifest 和业务产物回指校验完成后才调用真实工具体，因此该校验位于 Judge 与后续最终交付之前。
- `test/prx006-complete-team.test.mjs` 使用本机公开 fixture 覆盖成功正文、503 + 摘要、SRC-002/SRC-003 写入和篡改拒绝；测试实际创建 `deliverables/公开竞品案例/product_discovery.md`，完整引用时允许进入 Judge，分别删除 SRC-002、SRC-003 回指时均阻断且核对缺失 ID。
- 六个专业业务 worker 的 tool filter 均可用 `web_search`/`web_fetch`；协调者本身也可用 web；真实业务结论必须回指 `SRC-*`。

真实外网调用、另一名非产品探索成员联网、真实环境的 manifest 与产物 SRC 回指仍待负责人在新会话人验；本证据只证明公开 fixture 的确定性生产门禁，不替代端到端人验。

## Judge 边界

- `modules/independent-judge/agent-module.yml` 只机械改为 revision 1；FABRICATED、闭集、`pass`/`fail` 二元判定、领域规则、最多两轮、申诉与人工强制放行语义未放宽。
- 生成态 `quality_judge` 的 allow 列表固定为 `glob`、`grep`、`read`、`write`，不含 web；Judge 不安装 Skill。
- 测试逐项断言上述规则标记和工具边界。

真实完整跑批中“联网事实没有被误判 FABRICATED”只能由负责人验证，本会话未下结论。

## telemetry-tracker 实际限制

- 原版 Skill 正文、脚本与 `hooks/telemetry-auto-track/` 已整目录安装。
- 原版 OpenClaw `HOOK.md` 格式不会被 dsh 原样注册；实现没有伪称原 hook 生效。
- 等价自动采集由 `team-harness/src/telemetry-runtime.mjs` 监听 dsh `session/event`，写入本机 SQLite；只存 session 标识、turn、事件类型、能力、来源、时间，不存消息正文、工具参数/结果或凭据。
- `promax_usage_report` 从 SQLite 读取聚合计数；真实部署事件名、覆盖率和后端现有 hook 的共同表现仍待负责人检查。
- 详细限制原文：`/Users/Admin/Desktop/Promax/promax-agent/team-harness/docs/TELEMETRY-LIMITATIONS.md`。
