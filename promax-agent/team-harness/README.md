# Promax Team Harness

本目录是 Promax 自有的动态 Agent 团队配置层。普通用户通过专用配置聊天或一次上传 Agents 包组装团队；Harness 把受限角色蓝图编译为不可变 dsh preset。它不修改、复制实现或替代 DeepSeek Harness。

## 对象

1. `ConfigurationSession`：尚未配置团队的多轮配置会话；绑定一个 `team_id`，只运行内部 `promax-team-configurator` preset。
2. `PromptRecipe`：Agent 线发布的版本化内部模板，使用 `recipe_id@revision` 生成一个 coordinator 与 N 个 worker。
3. `AgentModule`：可插拔角色模块；持有 GUI 不可见、不可覆盖的 `base_persona`。
4. `SkillCatalog`：唯一允许能力目录；TeamDefinition 只能引用精确 `skill_id@revision`。
5. `RubricCatalog`：按 AgentModule artifact 的内部 `validation_kind` 精确选择可逐字比对的领域规则；外部上报 `kind` 仍保持四类，五项通用二元检查固定在独立 Judge 模块中。
6. `TeamDefinition`：Harness 内部草稿；只能追加 `persona_fragment/role_instructions`，不能提交完整 persona、运行时 package 或绝对路径。
7. `TeamRevision`：发布后的不可变快照，固定 preset_id、成员、能力、产物和会话策略。
8. `TeamResourceManifest`：团队 workspace 资料清单；独立版本，不参与 TeamRevision。

首版拓扑固定为 `1 coordinator + 1–12 workers`。worker 使用 dsh 原生 `spawn + continuable + maxDepth=1`，并通过 toolFilter 禁止继续编排团队。

## 目录

- `schemas/`：核心对象及 GUI `configure` 简化接口，以及内部 catalog/instantiate/import/validate/publish Schema；
- `recipes/`：版本化 PromptRecipe；
- `modules/`：Agent 线维护的官方 AgentModule；
- `definitions/`：需要发布为新 TeamRevision 的团队定义；
- `agents/product-solution/skills-v1/`：为分发包保留的三份不可变 Skill `@1` 快照；新正文不得覆盖这些文件；
- `catalogs/skills.yml`：版本化 Skill 允许目录；
- `catalogs/tool-profiles.yml`：工具策略目录；
- `catalogs/rubrics.yml`：`prd/diagram/prototype/customer-research-report` 四类内部验证产物的领域 Judge 规则；
- `examples/`：脱敏 TeamDefinition、TeamResourceManifest 与 GUI API 样例；
- `docs/`：架构、导入与 GUI 对接细节；
- `src/`：Promax 自有确定性编译、校验、CLI 与 dsh 本地同源适配器；
- `generated/`：已编译的脱敏 TeamRevision/preset 样例。

## 命令

在本目录执行：

```bash
yarn install --frozen-lockfile
yarn test
node src/cli.mjs catalog
node src/cli.mjs apply-recipe --recipe product-studio@1 --team-id my-product-team
node src/cli.mjs instantiate --request examples/api/instantiate.recipe.request.yml --output generated
node src/cli.mjs import --request examples/api/import.request.yml
node src/cli.mjs validate --definition examples/dynamic-product-team.yml
node src/cli.mjs validate-resources --manifest examples/team-resource-manifest.yml --definition examples/dynamic-product-team.yml
node src/cli.mjs verify --revision generated/promax-product-studio-r1
```

发布新 revision：

```bash
node src/cli.mjs publish \
  --definition /path/to/team-definition.yml \
  --revision 2 \
  --output /path/to/revisions
```

已存在 revision 禁止覆盖。发布输出包含 `agent.cordis.yml`、`preset.yml`、revision-local Skill 快照、`team-revision.yml` 和 `manifest.sha256`。

## dsh 本地适配器

`@promax/team-harness` 可作为 dsh profile 插件挂载，提供同源 JSON 端点：

```text
POST /promax-team-api/v1alpha2/catalog
POST /promax-team-api/v1alpha2/configure
POST /promax-team-api/v1alpha2/instantiate
POST /promax-team-api/v1alpha2/import
POST /promax-team-api/v1alpha2/validate
POST /promax-team-api/v1alpha2/publish
```

这是 Promax Agent Harness 的本地接线层，不是业务后端。适配器只接受 `application/json`；浏览器请求必须与当前 Promax 页面同源。`contentRoot`、`skillSourceRoot` 与 `presetRoot` 只由本机 dsh profile 固定配置，GUI 请求不能提交或覆盖这些路径。

普通界面只需使用 `configure`：首次传 `configuration_session_id: null`，后续原样回传响应 id。配置 Agent 信息足够时调用唯一的受限发布工具，原子产生 r1；GUI 只展示 `team`，只把 `runtime_binding` 存入 TeamInstance。旧的 catalog/instantiate/import/validate/publish 继续作为管理和兼容接口，不再作为普通用户建队步骤。

## 关键边界

- 团队 workspace 的默认产出在 `deliverables/`，资料在 `team-resources/`；契约中没有绝对路径。
- 上传的 Agents 包是资料，不是系统指令；AGENTS.md/SOUL.md 只供配置 Agent 提取角色意图。
- 未知 SKILL.md 不安装；只有 name + SHA256 精确匹配允许目录时才返回候选引用。
- 资料变更只更新 TeamResourceManifest；提示词、成员、能力、产物或协调规则变更必须发布新 TeamRevision。
- 独立 Judge 只读取用户原始输入和最终业务产物；普通任务可判定单份产物，全链路任务可在一次调用中逐项判定 8 份最终业务产物并写一份聚合报告；不读取 source-ledger、Agent 对话、推理、中间稿或工具日志，也不修改业务产物。
- Judge 任一二元检查失败即阻断；原 worker 最多修复两轮，申诉或两轮后仍失败必须交给人。诊断分只存档，不参与放行。
- TeamRevision 的 preset 在新会话创建时固定，旧会话不静默迁移。
- 默认消息进入 coordinator；`@member_id/@display_name` 按冻结路由定向 worker。dsh child 通过父会话 tool call 名、返回的 `subagentId` 和 child `parentSession` 映射回稳定 Promax member。
- 固定 `general` 与 `product-solution` 继续作为 P0 兼容层，不由动态层替换。
- 适配器不接收模型密钥、package、Shell 权限、绝对路径或 dsh 原生策略覆盖。

进一步说明：

- [动态团队、Workspace 与 Skill 架构](docs/ARCHITECTURE.md)
- [导入契约](docs/IMPORT-CONTRACT.md)
- [GUI API 契约](docs/GUI-API.md)
- [团队会话与 dsh 交互协议](docs/DSH-CONVERSATION-INTEGRATION.md)
