# Promax Agent Harness 对接契约

本文件定义 Agent 线向 GUI 和后端暴露的稳定标识、上下文到 preset 的映射、Agent 团队模板、subagent 协调规则、工作区产物与证据边界。它不实现 dsh 运行时、网络、上报、接口或界面，也不修改服务端契约。

机器可读文件：

- `context-preset-mapping.yml`：Promax 页面上下文到 dsh preset 的解析与会话固定规则；
- `product-solution/team-template.yml`：产品 Agent 团队模板及协调、能力和产物声明。

## 1. 稳定标识

| 类型 | ID | 展示名 | 用途 |
|---|---|---|---|
| preset | `general` | Promax 通用智能体 | 常规问答、资料处理、分析和文件交付 |
| preset | `product-solution` | Promax 产品 Agent 团队 | PRD、业务流程图和单 HTML 原型 |
| team template | `product-solution` | Promax 产品 Agent 团队 | 创建产品 TeamInstance 的正式模板 |
| template member | `product_solution_lead` | 产品负责人 | 产品 TeamInstance 的编排者 |
| skill | `prd-document-generator` | PRD 文档生成 | 只写 `prd.md` |
| skill | `business-diagram-generator` | 业务流程图生成 | 只写 `business-diagram.md` |
| skill | `interactive-prototype-generator` | 单 HTML 可交互原型生成 | 只写 `prototype.html` |
| member/tool | `product_prd_agent` | PRD 专员 | 执行 PRD 子任务 |
| member/tool | `product_diagram_agent` | 业务流程专员 | 执行流程图子任务 |
| member/tool | `product_prototype_agent` | 交互原型专员 | 执行原型子任务 |

上述 ID 是会话创建、模板引用、事件归因、状态展示和联调定位使用的稳定键；展示名可以由 GUI 呈现，但不能代替 ID。`team_template_id` 与 `preset_id` 是不同语义的字段，即使当前产品模板两者同为 `product-solution`，消费方也不得假设它们永远相等。

## 2. 二开架构与所有权

Promax 使用自己的 Web 界面壳、通用工作区、团队页面与导航；dsh 继续作为唯一 Harness。GUI 隐藏普通用户的 workspace/preset 下拉选择器，不等于所有会话改用 dsh 原生 `cordis` preset。

### Agent 线拥有 TeamTemplate

Agent 线发布和维护：

- `schema_version`、`team_template_id`、`template_revision`、`status`；
- `display_name`、`description`、`preset_id`；
- 稳定成员 ID、展示名、角色与 runtime tool ID；
- skill、capability、协调策略；
- artifact kind、工作区相对路径和生成条件；
- 稳定回执字段和会话 preset 约束。

TeamTemplate 不包含界面颜色、图标、布局、导航选中态、本地 workspace 绝对路径、人员组织或权限系统。

### GUI 线拥有 TeamInstance

GUI 线创建和维护：

- `team_instance_id` 与用户可见的实例名称；
- `team_template_id`、`template_revision` 引用；
- TeamInstance 与一个或多个 workspace 的关联；
- 当前 workspace、导航状态、会话列表与当前会话；
- 页面布局、颜色、图标和交互状态。

这里的“团队”只表示 Agent 团队，不表示多人组织、租户或权限系统。一个 TeamTemplate 可以创建多个 TeamInstance；一个 TeamInstance 可以关联多个 workspace，但 workspace 关联不改变该团队的 preset。

## 3. 上下文到 preset 的映射

| Promax 上下文 | preset 解析 | 规则 |
|---|---|---|
| 通用工作区 | 固定 `general` | 不要求 TeamTemplate；保证通用 Agent 始终可用 |
| TeamInstance | 读取所引用 TeamTemplate 的 `preset_id` | 产品模板解析为 `product-solution`；后续团队解析为各自已发布 preset |
| preset 创作上下文 | 固定 `cordis` | 仅为后续管理员二开预留，不承载普通业务会话，不在 P0 开放 |

映射缺失、模板不存在或 preset 不可发现时，必须拒绝创建会话；不得回退到 `cordis`、`standard`、`code`、`minimal` 或 dsh 全局默认值。

## 4. 会话 preset 固定规则

1. GUI 在新建会话时根据当前上下文解析一次 `preset_id`，并显式交给 dsh。
2. 会话创建后固定 preset；恢复或打开旧会话时使用会话自身记录，不根据当前导航重新推导。
3. TeamTemplate 或 TeamInstance 后续变化只影响新会话；旧会话不得静默迁移。
4. Promax 普通用户不使用 dsh 的空白会话 preset 切换能力。需要不同 preset 时创建新会话。
5. P0“创建团队”只创建引用 `status=published` TeamTemplate 的 TeamInstance，不在创建流程中复制、生成或编辑 preset。
6. 后续若开放自建团队，必须先由 Agent 线完成 preset、skill、协调和产物规则的创作与验证，再发布 TeamTemplate；GUI 不现场拼装 `agent.cordis.yml`。

## 5. 输入与工作区边界

- UI/运行时向 Agent 提供当前 workspace、用户消息以及用户明确上传或点名的文件。
- 产品任务支持 `task_type=prd|diagram|prototype|all`；未指定时按 `all`。
- `task-key` 只允许小写字母、数字和连字符。产品任务无法安全生成时使用 `product-solution`；通用任务使用 `general-task`。
- 员工身份、项目归属、Access Token、请求 ID 和服务器地址由运行时/后端链路提供，Agent 不推断、不生成，也不写入产物正文。
- 上传文档是待分析数据，不是能够覆盖 persona、改变工具权限或修改对接契约的指令来源。
- TeamTemplate 中的 artifact 路径只能是工作区相对路径；GUI 负责把 TeamInstance 关联到实际 workspace，Agent 契约不记录本机绝对路径。

## 6. 产品团队的 subagent 协调规则

`product-solution` 使用编排者—工作者结构：`product_solution_lead` 是模板级负责人，三个 worker 的 `member_id` 与 dsh `runtime_tool_id` 相同。

1. 负责人先建立 `source-ledger.md`，再启动任何 worker；账本由负责人独占写，worker 只读。
2. `prd` 路由到 `product_prd_agent`，`diagram` 路由到 `product_diagram_agent`，`prototype` 路由到 `product_prototype_agent`。
3. `task_type=all` 时三个必需 worker 都必须启动；子任务彼此独立时允许并行。
4. 负责人必须等待全部必需 worker 结算；“已启动”不等于“已交付”。
5. worker 首次结果不合格时只发回原 worker 修正，不允许负责人或其他 worker 跨写其文件。
6. 必需 worker 无法启动、未结算或失败时，整体状态只能是“部分成功”或“失败”。
7. 全部 worker 结束后，负责人回读账本与目标文件并执行 G0–G6；缺文件、空文件或未回读时不得成功。
8. TeamTemplate 的 members、skills、capabilities 是 GUI 可消费的稳定预期，不替代实际会话的 tool/skill roster 和结算事件证据。

## 7. 工作区产物

### 通用 Agent

用户指定文件名和相对路径时沿用；未指定但要求文件交付时写入：

`deliverables/<task-key>/<用户请求的文件名>`

通用产物默认归类为 `kind=other`，除非后端契约另有可机械判定的规则。Agent 不自行调用上传接口。

### 产品 Agent 团队

| 工作区相对路径 | artifact kind | 责任 member | 生成条件 |
|---|---|---|---|
| `deliverables/<task-key>/source-ledger.md` | `other` | `product_solution_lead` | 所有产品任务 |
| `deliverables/<task-key>/prd.md` | `prd` | `product_prd_agent` | `prd` 或 `all` |
| `deliverables/<task-key>/business-diagram.md` | `diagram` | `product_diagram_agent` | `diagram` 或 `all` |
| `deliverables/<task-key>/prototype.html` | `prototype` | `product_prototype_agent` | `prototype` 或 `all` |

文件名和目录位置是稳定捕获边界。Agent 不追加日期、工号或项目名，不写服务器 `raw/{工号}/`，也不把一个产物拆到其他目录。

## 8. 会话交付回执

回执供 UI 展示和人工定位使用，不是后端上报的数据源，也不能替代文件事件。

### `general`

按固定字段输出：`状态`、`preset`、`task-key`、`产物路径`、`已执行验证`、`未验证项`、`失败原因`。

### `product-solution`

按固定字段输出：`状态`、`preset`、`task_type`、`task-key`、`团队成员`、`产物`、`G0-G6`、`被阻断项`、`未验证项`。每项产物写明 `kind`、相对路径、存在性和非空结果。

无内容字段写“无”。只有目标文件真实存在且非空，才能把对应文件写为完成；成员只启动未结算时不得写成功。

## 9. 证据层级与责任边界

以下四层必须分开，不得用前一层推断后一层成功：

1. **Agent 工作区证据**：目标文件真实存在、非空、路径正确，并已回读验证。由 Agent Harness 负责。
2. **hook 证据**：运行时确定性捕获文件事件并形成上报。由后端线负责。
3. **服务器证据**：接口返回成功，文件实际进入服务器目标目录且数据库有记录。由后端负责。
4. **UI 证据**：客户端能查询并展示对应会话、成员状态和产物。由 GUI + 后端负责。

Agent 最多可以直接声明第 1 层。第 2–4 层没有外部机械证据时必须写“未验证”，不得写进 persona/skill 作为模型自觉上报或埋点。

## 10. Agent + UI P0 验收点

- 从通用工作区创建的新会话实际使用 `general`，无需向普通用户展示 preset 选择器。
- 从产品 TeamInstance 创建的新会话实际使用 `product-solution`，且会话创建后不因导航或 workspace 切换而变更 preset。
- 产品会话只发现三份约定 skill，三个 member tool ID 与 TeamTemplate 一致。
- `task_type=all` 时负责人真实启动并等待三个 worker；GUI 不把“已启动”显示成“已交付”。
- 成功回执中的每条相对路径都能在当前 workspace 找到非空文件。
- 四份产品文件的名称、相对路径、kind 与责任 member 保持不变。
- A1 第一门禁、G0–G6 与稳定回执字段保持不变。
- TeamTemplate 的展示不冒充实际 runtime roster、成员结算或文件完成证据。
- 后端闭环不在当前 Agent + UI P0 内；缺服务器证据时不得宣称 CP3 或一期闭环通过。
