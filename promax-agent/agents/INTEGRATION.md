# Promax Agent Harness 对接契约

Promax 使用自己的 Web 界面壳、团队/workspace 导航和团队编辑体验；DeepSeek Harness（dsh）继续提供会话、工具、Skill、subagent 生命周期和 preset 装载。Promax 不另写 Harness，也不修改 dsh 源码。

当前保留两条兼容路径：

- P0 固定层：`general` 与 `product-solution`；
- 动态团队层：`配置会话 -> 受限角色蓝图 -> TeamDefinition（内部） -> TeamRevision -> 不可变 dsh preset`。

## 1. 所有权

### Agent 线拥有

- PromptRecipe、AgentModule、SkillCatalog、TeamDefinition、TeamRevision 与 TeamResourceManifest 契约；
- AgentModule 不可覆盖 `base_persona`、能力来源、工具策略、产物责任和验证规则；
- TeamDefinition/TeamResourceManifest 校验、确定性编译和不可变 preset；
- 随 dsh profile 加载的 Promax 本地 Team API 适配器；
- 内部 `promax-team-configurator` preset、配置 session→team 绑定和唯一受限发布工具；
- dsh subagent 拓扑、最大深度、成员工具权限、结算和重试规则；
- `general`、`product-solution` 兼容 preset 及三份产品 Skill。

### GUI 线拥有

- TeamInstance、草稿编辑状态、图标和展示名；
- 未配置/已配置聊天模式切换、配置消息与一次 Agents 包上传；
- TeamInstance 与 workspace 的关联、当前 workspace 和本地绝对路径解析；
- 导航、会话列表、当前会话和会话创建时的 preset 传递；
- 团队资料上传体验及 workspace 内文件落盘。

Agent 契约不包含界面颜色/布局、本地绝对路径、多人组织、租户或权限系统。GUI 不得提交 dsh package、任意工具名、Shell 权限、模型密钥或原生 preset 策略覆盖。

## 2. 稳定对象

### PromptRecipe

版本化一键配置，引用格式为 `<recipe_id>@<revision>`。GUI 从 catalog 选择 recipe 后生成 coordinator + N worker 的 TeamDefinition 草稿，再允许用户编辑受限字段。当前内置：

- `general-collaboration@1`；
- `product-studio@1`；
- `research-review@1`。

### AgentModule

稳定引用为 `<module_id>@<revision>`。模块的 `base_persona` 只由 Agent 线维护，GUI catalog 不返回该字段。TeamDefinition 只能提交 `persona_fragment` 与 `role_instructions`，编译器把它们以低优先级追加到基础 persona 之后。

当前内置 `team-coordinator@1`、`general-worker@1`、`customer-research@1`、`product-discovery@1`、`requirement-management@1`、`product-solution@1`、`requirement-review@1`、`user-analysis@1`、`independent-judge@1`，并保留 `product-prd@1`、`product-diagram@1`、`product-prototype@1` 作为历史独立模块。

### SkillCatalog

Skill 集中存放在 Agent 线只读允许目录，不放进 TeamDefinition 或团队资料目录。AgentModule/TeamDefinition 只引用 `skill_id@revision`；发布时复核 SKILL.md name 与 SHA256，再复制为 TeamRevision 自己的 `skills/` 快照。

dsh 先暴露 Skill name/description，再由 Agent 按需加载正文，保留渐进式加载。当前同一 preset 内全部 worker 可看到团队已批准 Skill 的并集；成员 `skill_refs` 是职责与审计记录，不是机械可见性 ACL。

### TeamDefinition

GUI 编辑的可变团队草稿，包含：

- `metadata.team_id/display_name/description/source_recipe_ref`；
- 固定 workspace 相对策略；
- 一个 coordinator 与 1–12 个 worker；
- 每个成员的稳定 member_id、display_name、module_ref、可选追加提示词和 skill_ref；
- 固定首版拓扑和回执字段。

TeamDefinition 明确拒绝 `persona/base_persona/system_prompt`、绝对 workspace 路径、dsh package、Shell 和模型密钥字段。

### TeamRevision

发布成功后的不可变机器契约。GUI 创建会话和展示能力时依赖：

- `metadata.team_revision_id/team_id/revision/status/definition_sha256/source_recipe_ref`；
- `spec.preset_id/workspace_policy`；
- `spec.coordinator/members/skills/capabilities/artifacts`；
- `spec.coordination/routing/runtime_mapping/receipt_fields/session_policy/compiled_files`。

配置中有成员不代表成员已经启动或完成；运行态以 dsh 的真实 child/settlement 事件为准。每个 worker 的 `runtime_tool_id` 稳定等于 member_id；父会话 tool result 返回的 `subagentId` 是物理 child id，配合 child header 的 `parentSession` 归属到当前 TeamRevision。一个稳定成员可对应零到多个先后产生的物理 child。

### TeamResourceManifest

位于当前团队 workspace 的 `.promax/team-resource-manifest.yml`。每项包含：

- `resource_id`；
- `relative_path`，必须在 `team-resources/` 下；
- `sha256`；
- `media_type`；
- `readable_by`。

清单有独立 `manifest_revision`。资料变化不产生 TeamRevision；当前成员级文件 ACL 仅为声明性元数据，强路径隔离尚未由共享 dsh 文件工具提供。

### TeamInstance

GUI 拥有的界面对象。建议最小引用：

```yaml
team_instance_id: ti_demo001
display_name: 我的产品团队
team_revision_id: product-studio@r1
workspace_ids: [ws_demo001]
```

GUI 保存 team_revision_id，通过 TeamRevision 获取 preset_id；不得从团队名称、导航位置或成员列表猜 preset。

## 3. 团队 workspace

每个团队 workspace 的稳定相对结构：

```text
.promax/team-resource-manifest.yml
team-resources/...
deliverables/<task-key>/...
```

GUI 把所选团队 workspace 作为新会话 dsh `cwd`。所有产物默认落在 `deliverables/`，所有资料落在 `team-resources/`。Agent 层只返回相对路径，GUI 负责映射到本机路径。

dsh experimental `agent-team` 当前不挂载：它保存 roster、mailbox、task DAG 等 session 运行状态，不是团队文档仓库。Promax 当前使用稳定 `tool-subagent` 的 `spawn + continuable + maxDepth=1`；以后可替换运行态适配器，不改变上述长期契约。

## 4. AGENTS.md、SOUL.md、SKILL.md 导入

旧 `import` 端点保留独立的 draft-only 流程：

1. 校验文档 SHA256；
2. 只读取显式 `promax-team` YAML fenced block；
3. 只映射允许的团队字段与 persona 追加字段；
4. 返回 draft、warnings 和 review_items；
5. 固定 `publish_allowed=false/skill_install_performed=false/execution_performed=false`；
6. GUI 人工确认后再独立 validate/publish。

dsh 会自动查找活动 workspace 的 `AGENTS.md/CLAUDE.md`，因此导入原件不能以 `AGENTS.md` 放在活动 workspace 根。SOUL.md 不是 dsh 默认 instruction 文件。未知 SKILL.md 不安装；只有 name + SHA256 精确匹配 SkillCatalog 才返回候选 skill_ref，仍需用户在草稿中确认。

普通 GUI 的一次 Agents 包上传走 `configure.agents_package`。Harness 先验证包内相对路径、逐文件 SHA256 和规范清单 SHA256；只把 AGENTS/SOUL 作为不受信任角色资料交给受限配置 Agent，SKILL 正文不进入提示词。已知 Skill 只提供精确 `skill_ref`，未知 Skill 进入待审核但不阻止其余安全角色完成 r1 配置。

## 5. GUI 请求响应

普通 GUI 只使用一个简化操作：

- configure：首次 `configuration_session_id=null`，后续续接同一配置会话；输入自然语言、一个 Agents 包或二者组合；输出 `collecting/configured/configured-with-warnings`、可展示团队和仅供内部会话创建的 runtime_binding。

以下操作保留给管理、兼容和诊断，不再做成普通用户步骤：

- catalog：获取安全裁剪后的 module/skill/recipe 目录；
- instantiate：从 recipe、prompt 或 documents 生成团队；recipe/纯 prompt 可直接发布冻结 preset，任何 documents 输入固定只返回待审核草稿；
- import：生成草稿，不发布、不安装、不执行；
- validate：返回 JSON Pointer 字段级 errors/warnings；
- publish：原子生成不可变 TeamRevision 与 preset。

运行时通过当前 Promax 页面的同源 HTTP 端点调用，均为 `POST application/json`：

```text
/promax-team-api/v1alpha2/catalog
/promax-team-api/v1alpha2/configure
/promax-team-api/v1alpha2/instantiate
/promax-team-api/v1alpha2/import
/promax-team-api/v1alpha2/validate
/promax-team-api/v1alpha2/publish
```

这些端点由 Promax 自有 `@promax/team-harness` 插件挂载到 dsh `webServer`，不是业务后端，也不修改 dsh。Catalog 根、Skill 来源根和 preset 发布根只由本机 profile 固定；GUI 请求不能传路径或覆盖配置。已存在 revision 返回 HTTP 409 / `REVISION_IMMUTABLE`，跨源浏览器请求返回 HTTP 403。

机器 Schema：`../team-harness/schemas/api/`；脱敏样例：`../team-harness/examples/api/`；完整说明：`../team-harness/docs/GUI-API.md`。

## 6. 消息与实例路由

- 无 `@成员` 的消息默认提交到 coordinator 的 root session；
- `@member_id` 或 `@display_name` 采用消息开头、最长精确匹配，alias 在 validate 阶段机械保证唯一；
- coordinator mention 仍指向 root session；worker mention 已有 continuable child 时可走 dsh `subagent.prompt`，没有 child 时先交 root coordinator 调用该 worker 的稳定工具；
- 运行实例主键为 `team_revision_id + parent_session_id + child_session_id`，`parent.tool_call.name -> runtime_tool_id -> member_id`，`parent.tool_result.subagentId -> child_session_id`，并用 `child.header.parentSession` 复核父子关系；
- 未知 mention 发送前拒绝，多 mention 交 coordinator 拆分；GUI 展示 Promax 成员聚合状态，不展示 dsh 原生 subagent 列表。

### 6.1 dsh 会话交互协议不得被 Team API 替代

团队配置完成后，业务聊天直接复用 dsh 原生 `ConversationSnapshot`、`session.prompt()` 和 `conversation.composer` 接管链；Team API 不代理消息、pending interaction、queue 或 Trajectory。

GUI 至少消费 `nodes/chat`、`partial`、`running`、`runningCalls`、`pending`、`queue`、`composerPhase`、`turnTimings/turnEnds`、`openState/openError`、`promptError/lastAgentError` 和 `removed`。`session.prompt(..., 'queue')` 返回 `accepted=true` 只代表消息被接收，不代表已经出现新的 `turn/start`；消息若停在 queue，GUI 必须立即显示“已排队”，不能在清空输入框后让它消失。

`pending.kind=question` 必须使用 dsh `QuestionComposer`/`PendingWait.respond()` 回答，`pending.kind=approval` 必须使用原生审批接管面；普通文本不能冒充回答或绕过审批。Chat、Trajectory、工具卡和结构化状态优先复用 dsh 原生渲染面，不得另做一套只筛 user/assistant 最终文本的聊天协议。

完整接入规则和脱敏阻塞态样例分别见：

- `../team-harness/docs/DSH-CONVERSATION-INTEGRATION.md`；
- `../team-harness/examples/integration/conversation.pending-question.yml`。

## 7. 版本与会话规则

| 变化 | 处理 |
|---|---|
| 团队资料内容、哈希、media_type、readable_by | 只更新 TeamResourceManifest.manifest_revision |
| 提示词追加、成员、module、skill、artifact、协调与回执 | 发布新 TeamRevision |
| Skill 内容 | 先发新 skill revision，再发新 TeamRevision |

GUI 新建会话时解析一次 `TeamRevision.spec.preset_id` 并显式传给 dsh；恢复旧会话使用会话头记录。revision/preset 缺失时拒绝创建，不回退到 cordis、general、standard、code 或默认值。旧会话不得静默迁移。

### 7.1 r5 全链路装配模式

`team-mtcjsbcz-04tpe2@r5` 是负责人选择的新不可变 revision，用于优先装配固定六业务角色的完整生产链。它不迁移 r3/r4 会话，也不代表原步骤二预案中的外部能力阶段已经完成。

用户明确要求“全链路”“完整流程”“六个业务角色”或“8 份业务产物”时，coordinator 使用同一个 `task_key` 按四阶段编排：

1. 并行启动 `customer_research`、`product_discovery`、`user_analysis`；
2. 三者结算后启动 `requirement_management`；
3. 前两阶段结算后启动 `solution_design`，并要求同轮生成 `prd.md`、`business-diagram.md`、`prototype.html`；
4. 三份方案产物落盘后启动 `requirement_review`。

八份业务产物全部存在且非空后，coordinator 集中调用 `quality_judge` 一次。Judge 只接收原始输入与八份最终产物，在 `.promax/judge/<task-key>/judge.md` 内分别给出八条 artifact verdict 和一个整体 verdict；任一 artifact fail 即整体 fail。原 worker 修复、最多两轮、带反证申诉交人、达上限交人和强制放行留痕等硬约束不变。

TeamRevision 对外仍声明固定 7 名成员和 8 份业务产物，Judge 报告不计入业务产物。`business-diagram.md` 与 `prototype.html` 的 `required: false` 保留给普通任务和 GUI 展示契约；显式全链路任务由 coordinator 提示词要求三份方案产物全部生成。该编排当前由冻结的 YAML/preset 驱动，不是底座状态机级的机械工作流；完成真实端到端运行前只能称为“已装配”，不能称为“全链路已通过”。

## 8. 上下文到 preset

| Promax 上下文 | preset 解析 | 失败策略 |
|---|---|---|
| 通用工作区 | 固定 `general` | 缺失即拒绝 |
| 动态 TeamInstance | 已发布 TeamRevision 的 `spec.preset_id` | revision/preset 缺失即拒绝 |
| P0 产品 TeamInstance | 兼容映射 `product-solution@1 -> product-solution` | 仅限显式 legacy 模板 |
| 高级 preset 创作页 | 固定 `cordis` | 不对普通用户开放 |

普通会话不能全部固定到 `cordis`；否则会绕过正式团队的成员工具、Skill、文件责任、质量门禁和稳定回执。

## 9. P0 兼容边界

以下验收保持不变：

- 通用工作区新会话使用 `general`；
- 现有产品 TeamInstance 新会话使用 `product-solution`；
- 产品团队仍是负责人 + PRD/流程图/原型三名专员；
- 三份 Skill、四个稳定产物路径、A1、G0–G6 和稳定回执不变；
- `task_type=all` 必须真实启动并等待三个 worker；
- 成功回执中的相对路径必须在当前 workspace 找到非空文件；
- 后端闭环不属于当前 Agent + UI P0，没有服务器证据不得宣称通过。

新增会话交互门禁：连续消息必须可见且真实进入后续 turn；`ask_user_question`/审批不得因 Promax 团队壳隐藏而阻塞；处理中、排队、失败和 Trajectory 必须可访问。单次任务产物落盘不再足以证明团队聊天 P0 完整通过。

动态 TeamRevision 是增量能力，不替换或迁移固定 P0 会话。
