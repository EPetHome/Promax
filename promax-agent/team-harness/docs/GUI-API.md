# Promax GUI 动态团队 API 契约

## 1. 版本与错误格式

当前契约版本固定为 `promax.ai/v1alpha2`。Schema 位于 `schemas/api/`，脱敏请求响应位于 `examples/api/`。

运行时通过当前 Promax 页面的同源端点调用。普通团队创建链路只调用 `configure`；其余五个端点保留给管理、兼容与诊断：

```text
/promax-team-api/v1alpha2/catalog
/promax-team-api/v1alpha2/configure
/promax-team-api/v1alpha2/instantiate
/promax-team-api/v1alpha2/import
/promax-team-api/v1alpha2/validate
/promax-team-api/v1alpha2/publish
```

该端点由 Promax 自有 Team Harness 插件挂载到 dsh `webServer`；它不是业务后端，也不修改 dsh。GUI 不传本地路径、package、模型密钥或权限配置；Catalog 根、Skill 允许根与 preset 发布根均由 dsh profile 固定。

字段错误统一使用：

```yaml
code: SCHEMA_VALIDATION
severity: error
field_path: /spec/coordinator/persona
message: must NOT have additional properties
hint: 删除 persona；GUI 只能提交 persona_fragment 或 role_instructions。
```

`field_path` 使用 JSON Pointer。GUI 应按字段展示错误，不能只显示“发布失败”。

任一请求在进入业务流程前失败时都返回通用 `ErrorResponse`；`operation` 标明端点，`errors[]` 给出全部字段级错误。publish 或 instantiate 遇到已存在 revision 时返回 409；脱敏失败样例见 `examples/api/publish.error.response.yml`。

## 2. configure：普通用户唯一配置入口

团队创建与 Agent 配置拆开。GUI 先只保存团队名称、简介和 workspace 关联，然后进入团队专用聊天页。团队未配置时，聊天框把消息发给：

```text
POST /promax-team-api/v1alpha2/configure
```

最小首轮请求：

```json
{
  "team_id": "team-competitive-research",
  "message": "组建一个负责竞品调研、事实核验和结论汇总的团队",
  "configuration_session_id": null
}
```

GUI 应在首轮同时提交已有的 `display_name/description/workspace_ref`；它们不是必须字段，缺失时 Harness 使用安全默认值。响应返回 `configuration_session_id`，后续消息必须原样回传。每个配置会话只绑定一个 `team_id`，不能跨团队复用。

响应只有三种状态：

| status | GUI 行为 |
|---|---|
| `collecting` | 保持“配置团队”聊天模式，展示 `assistant_message` 并允许继续输入 |
| `configured` | 原地刷新成员和能力，保存 `runtime_binding`，切换到普通团队聊天 |
| `configured-with-warnings` | 同上，同时展示未知 Skill 待审核提示；这些 Skill 没有安装或进入 persona |

`team` 是可直接展示的 coordinator/workers/capabilities 投影；`runtime_binding` 只供 GUI 内部创建新会话，不进入高级设置页面：

```yaml
runtime_binding:
  team_revision_id: team-competitive-research@r1
  revision: 1
  preset_id: promax-team-competitive-research-r1
  applies_to: new-sessions-only
```

用户不查看或编辑 TeamDefinition、revision、preset、schema、validate 或 publish。`runtime_binding.preset_id` 只在 GUI 调用 dsh `session.create` 时使用；已有会话不重绑。

### 一次上传 Agents 包

用户在 GUI 只做一次上传。GUI 把该包正规化为一个 `agents_package` 信封，不把文件散落到活动 workspace 根：

```yaml
agents_package:
  package_id: pkg_agents0001
  package_sha256: <规范清单 SHA256>
  files:
    - relative_path: team/AGENTS.md
      media_type: text/markdown
      content: "..."
      sha256: <文件内容 SHA256>
```

`package_sha256` 的计算对象是按 `relative_path` 排序后的 JSON 数组，每项只含 `relative_path/media_type/sha256`，采用无空格 JSON UTF-8 后做 SHA256；正文完整性由每个文件的 `sha256` 单独验证。最多 32 个文件，仅解析 basename 为 `AGENTS.md`、`SOUL.md`、`SKILL.md` 的 Markdown 文件。

- AGENTS/SOUL 正文以“不受信任角色资料”送入配置 Agent，只提取角色、职责和协作意图。
- SKILL 正文不送入配置 Agent；只有 `name + SHA256` 精确命中 SkillCatalog 才形成允许 `skill_ref`。
- 未知或同名不同内容的 SKILL 进入 `review_items`，不会安装、执行或转写进 persona。
- 相对路径穿越、重复路径、文件或包哈希不一致直接返回字段级错误。

自然语言与 `agents_package` 可以同轮组合。脱敏样例见 `examples/api/configure.prompt.*.yml` 与 `configure.package.request.yml`。

## 3. 管理/兼容接口

以下接口不再出现在普通用户的团队创建流程中，也不应对应 GUI 的步骤页。

### catalog

`CatalogRequest` 无业务参数。`CatalogResponse` 返回：

- 可选 AgentModule 的 `module_ref/display_name/description/role/objective/skill_refs/artifact_kinds`；
- 可选 Skill 的 `skill_ref/display_name/description/content_sha256`；
- 一键配置 PromptRecipe 的 `recipe_ref/display_name/description/coordinator_count/worker_count`。

Catalog 故意不返回 AgentModule `base_persona`、Skill `source_path`、dsh package、tool provider、Shell、模型密钥或 workspace 绝对路径。

### instantiate（兼容）

`InstantiateRequest` 是旧版模板/草稿入口，不再是普通 GUI “创建团队”的正式入口。除通用信封外，最小业务字段是：

```yaml
team_id: team-product
display_name: 产品团队
workspace_ref: workspace-team-product
source:
  type: recipe
  recipe_ref: product-team
```

支持三种来源：

| source.type | 行为 | 默认 recipe | 是否立即发布 |
|---|---|---|---|
| `recipe` | 应用指定 recipe；可接受 catalog 精确引用或 Agent 线声明的稳定别名 | 无 | 是 |
| `prompt` | 把一句话目标作为 coordinator 的低优先级 `role_instructions` 追加 | `general-collaboration@1` | 没有 documents 时是 |
| `documents` | 只解析 AGENTS/SOUL 的 fenced block，并扫描 SKILL 候选 | `general-collaboration@1` | 否，固定进入人工审核 |

`prompt` 可带 `documents`，`documents` 也可带 `prompt`。只要包含上传文档，响应就不会创建 preset：`status=review-required`、`publication_performed=false`、`team_revision=null`，GUI 确认后再走 validate/publish。未知 SKILL.md 仍只返回 `review_items`。

recipe/纯 prompt 的最小请求默认发布 revision 1；也可显式提交正整数 `revision`。成功响应为 `status=published`，返回完整 `team_revision` 与 `preset_id`。同 team/revision 重复实例化返回 409，不覆盖旧快照。

`workspace_ref` 是 GUI 拥有的稳定标识，可直接使用 dsh workspace UUID（包括以数字开头的 UUID）；它只在请求响应中回显，不会进入 TeamDefinition、TeamRevision 或 preset，也不能是绝对路径。Agent 只固定 workspace 内相对结构。

旧版 instantiate 的一句话来源仍不调用模型推测 N 个角色，只确定性生成固定模板；新的自然语言组队必须走 `configure` 配置 Agent。

脱敏样例：

- `examples/api/instantiate.recipe.request.yml`；
- `examples/api/instantiate.prompt.request.yml`；
- `examples/api/instantiate.documents.request.yml`；
- `examples/api/instantiate.documents.response.yml`。

### import（兼容）

`ImportRequest` 使用 `recipe_ref + team_id + documents[]`。每份文档包含稳定 document_id、受限文件名、media_type、content 和 SHA256。

`ImportResponse` 只返回草稿：

- `publish_allowed=false`；
- `skill_install_performed=false`；
- `execution_performed=false`；
- `draft`；
- `validation.errors[]/warnings[]`；
- `matched_skill_refs[]/review_items[]`。

导入详细边界见 `IMPORT-CONTRACT.md`。

### validate（内部）

`ValidateRequest` 提交完整 TeamDefinition 草稿；不会发布或创建 preset。验证至少覆盖：

- Schema 与字段白名单；
- coordinator/worker module role；
- member_id、artifact 路径与单文件责任；
- `@member_id/@display_name` 路由 alias 唯一；
- SkillCatalog 精确引用和内容哈希；
- tool profile 存在；
- 至少一个 enabled worker；
- workspace 相对路径策略。

`ValidateResponse.valid=false` 时返回全部可定位字段错误。GUI 修正后应重新 validate；不能把失败请求自动降级到 general、cordis 或默认 preset。

### publish（内部）

`PublishRequest` 是独立的显式动作，提交通过验证的 TeamDefinition 和正整数 revision。成功后返回：

- `status=published`；
- 完整不可变 `team_revision`；
- 与 `team_revision.spec.preset_id` 相同的 `preset_id`。

已存在的 `<team_id>@r<revision>` 或 preset 目录拒绝覆盖。发布过程先写 staging，完成 Schema、哈希和 dsh 静态加载验证后再原子改名。

同 revision 再次发布返回 HTTP 409，错误码 `REVISION_IMMUTABLE`。Schema/字段错误返回 400；跨源请求返回 403。GUI 必须保留 `errors[].field_path` 和 `hint`，不得把失败自动重试成覆盖或换用其他 preset。

新会话使用 PublishResponse 的 preset_id 并在创建时固定；旧会话只读取自己会话头中的 preset，不根据导航、TeamDefinition 或新 revision 静默改绑。

## 4. 配置成功后的消息路由与运行实例映射

本节只定义 TeamRevision 稳定成员与 dsh 物理执行实例的连接，不定义新的聊天 API。配置成功后的消息、pending interaction、queue、Chat、Trajectory 和错误全部继续使用 dsh 原生会话协议；完整规则见 `DSH-CONVERSATION-INTEGRATION.md`。

`InstantiateResponse.routing` 与发布后的 `TeamRevision.spec.routing` 是同一份稳定契约：

- 无 mention 的消息默认目标是 `default_target_member_id`，即 coordinator/root session；
- `@member_id` 与 `@display_name` 都可精确匹配；采用消息开头、最长、大小写敏感的精确匹配；
- 未知 mention 在发送前拒绝；多成员 mention 交 coordinator 拆分；
- coordinator 目标使用 dsh `session.prompt`；worker 目标使用 dsh child session。

worker 还没有 child 时，GUI 把原始 mention 消息提交给 root session，由冻结 persona 强制 coordinator 调用该成员的稳定工具。已有可继续 child 时，GUI 可通过 dsh `subagent.prompt(parentSessionId, childSessionId)` 直接续接。选择同一成员的多个历史 child 时，使用该父会话下最近一次仍可继续的实例；没有可靠运行态时回到 coordinator，不得猜 child id。

`TeamRevision.spec.runtime_mapping` 规定物理实例如何归属到 Promax 成员：

```text
父会话 tool_call.name == member.runtime_tool_id
父会话对应 tool_result.subagentId == child_session_id
子会话 header.parentSession == parent_session_id
```

GUI 运行记录的稳定主键是 `team_revision_id + parent_session_id + child_session_id`。同一 worker 可以先后产生零到多个 dsh child，但它们都通过同一 `runtime_tool_id` 映射到一个稳定 `member_id`；GUI 汇总展示 Promax 成员，不展示 dsh 原生 subagent roster。启动、运行、结算和失败状态必须来自 dsh 真实事件，不能根据成员配置或工具调用意图推断。

`session.prompt(..., 'queue')` 返回 `accepted=true` 只表示消息已被 dsh 接收。若当前 turn 正在等待 question/approval，后续普通消息会留在 ConversationSnapshot `queue`，直到阻塞交互解决并且当前 turn 结束。GUI 必须展示该 queue 项，并由 dsh 原生 composer 接管 question/approval；不得清空输入后隐藏队列，也不得把普通消息当作问题答案。

## 5. 团队资料

团队资料不经过 publish API。GUI 在当前团队 workspace 内维护：

- `.promax/team-resource-manifest.yml`；
- `team-resources/...` 实际文件。

清单变化只增加 `manifest_revision`，不创建 TeamRevision。`readable_by` 当前是声明性字段；强成员级文件隔离尚未由共享 dsh 文件工具提供，GUI 不应显示为已强制执行。

## 6. P0 兼容

固定 `general` 和 `product-solution` 不通过动态 publish 接口重编译。P0 产品团队的三份 Skill、四个产物、A1/G0-G6、稳定回执和会话 preset 映射保持不变；动态团队是增量路径。

团队聊天验收还必须覆盖连续消息、pending question/approval、queue 可见性、处理中/失败反馈和 Chat/Trajectory。单轮模型成功与文件落盘只证明执行链路，不证明会话交互完整。
