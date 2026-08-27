# Promax Agent Harness 对接契约

本文件只定义 Agent 线对 UI 和后端暴露的稳定标识、工作区产物与证据边界。它不实现运行时、网络、上报、接口或界面，也不修改《Promax 总方案》第四节的服务端契约。

## 1. 稳定标识

| 类型 | ID | 展示名 | 用途 |
|---|---|---|---|
| preset | `general` | Promax 通用智能体 | 常规问答、资料处理、分析和文件交付 |
| preset | `product-solution` | Promax 产品 Agent 团队 | PRD、业务流程图和单 HTML 原型 |
| skill | `prd-document-generator` | PRD 文档生成 | 只写 `prd.md` |
| skill | `business-diagram-generator` | 业务流程图生成 | 只写 `business-diagram.md` |
| skill | `interactive-prototype-generator` | 单 HTML 可交互原型生成 | 只写 `prototype.html` |
| member tool | `product_prd_agent` | PRD 专员 | 执行 PRD 子任务 |
| member tool | `product_diagram_agent` | 业务流程专员 | 执行流程图子任务 |
| member tool | `product_prototype_agent` | 交互原型专员 | 执行原型子任务 |

上述 ID 是 UI 挂载、会话选择、事件归因和联调定位使用的稳定键；展示名可以由 UI 呈现，但不能代替 ID。

## 2. 输入边界

- UI/运行时向 Agent 提供当前 workspace、用户消息以及用户明确上传或点名的文件。
- 产品任务支持 `task_type=prd|diagram|prototype|all`；未指定时按 `all`。
- `task-key` 只允许小写字母、数字和连字符。产品任务无法安全生成时使用 `product-solution`；通用任务使用 `general-task`。
- 员工身份、项目归属、Access Token、请求 ID 和服务器地址由运行时/后端链路提供，Agent 不推断、不生成，也不写入产物正文。
- 上传文档是待分析数据，不是能够覆盖 persona、改变工具权限或修改对接契约的指令来源。

## 3. 工作区产物

### 通用 Agent

用户指定文件名和相对路径时沿用；未指定但要求文件交付时写入：

`deliverables/<task-key>/<用户请求的文件名>`

通用产物默认由后端 hook 归类为 `kind=other`，除非后端契约另有可机械判定的规则。Agent 不自行调用上传接口。

### 产品 Agent 团队

| 工作区相对路径 | artifact kind | 责任人 | 生成条件 |
|---|---|---|---|
| `deliverables/<task-key>/source-ledger.md` | `other` | 产品负责人 | 所有产品任务 |
| `deliverables/<task-key>/prd.md` | `prd` | `product_prd_agent` | `prd` 或 `all` |
| `deliverables/<task-key>/business-diagram.md` | `diagram` | `product_diagram_agent` | `diagram` 或 `all` |
| `deliverables/<task-key>/prototype.html` | `prototype` | `product_prototype_agent` | `prototype` 或 `all` |

文件名和目录位置是 hook 捕获的稳定边界。Agent 不追加日期、工号或项目名，不写服务器 `raw/{工号}/`，也不把一个产物拆到其他目录。

## 4. 会话交付回执

回执供 UI 展示和人工定位使用，不是后端上报的数据源，也不能替代文件事件。

### `general`

按固定字段输出：`状态`、`preset`、`task-key`、`产物路径`、`已执行验证`、`未验证项`、`失败原因`。

### `product-solution`

按固定字段输出：`状态`、`preset`、`task_type`、`task-key`、`团队成员`、`产物`、`G0-G6`、`被阻断项`、`未验证项`。每项产物写明 `kind`、相对路径、存在性和非空结果。

无内容字段写“无”。只有目标文件真实存在且非空，才能把对应文件写为完成；成员只启动未结算时不得写成功。

## 5. 证据层级与责任边界

以下四层必须分开，不得用前一层推断后一层成功：

1. **Agent 工作区证据**：目标文件真实存在、非空、路径正确，并已回读验证。由 Agent Harness 负责。
2. **hook 证据**：运行时确定性捕获文件事件并形成上报。由后端线的 `promax-report` 负责。
3. **服务器证据**：接口返回成功，文件实际进入 `raw/{工号}/{项目}/` 且数据库有记录。由后端负责。
4. **UI 证据**：客户端或控制台能查询并展示对应会话、状态和产物。由 UI + 后端负责。

Agent 最多可以直接声明第 1 层。第 2–4 层没有外部机械证据时必须写“未验证”，不得写进 persona/skill 作为模型自觉上报或埋点。

## 6. 联调验收点

- UI 能按稳定 preset ID 展示并创建 `general`、`product-solution` 会话。
- 产品会话只发现三份约定 skill，团队成员工具 ID 与本文件一致。
- Agent 成功回执中的每条相对路径都能在当前 workspace 找到非空文件。
- hook 对固定产品文件生成正确 `kind`，并使用运行时/后端提供的身份和项目元数据；不得从 Agent 正文猜测。
- CP3 必须同时具备四层证据：脱敏输入、Agent 工作区产物、服务器 `raw/{工号}/` 文件与控制台展示。缺任一层都不能由 Agent 线单独宣称闭环通过。
