# 设置页、MCP 降级与凭据安全

## Promax 自建设置页

实现入口：`packages/promax-ui-console/src/client/PromaxSettings.tsx`，嵌入 `PromaxWorkspaceShell` 的设置对话框；只复用 dsh 已有 `settings.describe`/`settings.mutate` 与 `credentials.describe`/`credentials.set`。

- 模型页只展示已配置 provider；既有 DeepSeek 不被清除。
- 自定义 `llm-pi-ai` provider 支持 Provider ID、Base URL、协议和去重模型列表。
- Provider ID 必须小写字母开头；Base URL 只接受 HTTP(S)。
- API Key trim 后必须非空、只含可打印 ASCII；拒绝 `NAME=value`、成对引号、空格和换行粘贴。
- 非密钥设置写入携带 `revision`，`settings-conflict` 显示可见冲突反馈；密钥只经 `credentials.set` 单向写入，输入框不预填。
- 测试使用脱敏 sentinel 断言密钥不进入 settings patch 或 localStorage；credential 失败和飞书凭据解析失败只显示/保存固定脱敏错误，不记录错误正文。

## MCP 最终模式

本轮采用任务允许的降级模式：**预置飞书模式，不能自行添加任意 MCP server**。页面明确说明任意 `stdio` 命令配置和任意 `streamable-http` URL/headers 配置本轮不可用，只提供预置飞书 server 的凭据、启停与连接测试。

飞书 server 的实现参数依据飞书官方 `larksuite/lark-openapi-mcp` 文档：

- npm 包名：`@larksuiteoapi/lark-mcp`
- transport：`stdio`（官方默认模式）
- 命令：`npx -y @larksuiteoapi/lark-mcp mcp`
- 凭据字段名称：`APP_ID`、`APP_SECRET`
- 官方依据：https://github.com/larksuite/lark-openapi-mcp/blob/main/docs/usage/configuration/configuration.md

运行时只在子进程操作时解析凭据并通过环境变量传入；settings 和状态只保存启停、probe、脱敏状态、时间和真实注册工具名称。连接测试以 `mcp__feishu__*` 的实际工具 schema 列表为结果，不用预置假列表。

安装 profile 中 `@deepseek-ai/dsh-mcp-client` 可被动态 import，三端启动冒烟无插件加载错误。`pnpm peers check` 仍报告 dsh 插件式 profile 未在顶层清单显式声明若干底座 peer；没有因此复制或升级 dsh，是否影响负责人提供凭据后的真实 MCP 工具注册留待人验。

本会话没有读取、打印、清空、迁移任何既有凭据，也没有要求重填；没有执行真实飞书调用。
