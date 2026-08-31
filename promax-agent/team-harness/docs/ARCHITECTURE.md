# Promax 动态团队、Workspace 与 Skill 架构

## 1. 结论

Promax 不把“团队文件夹”“数字员工配置”和“Skill 安装目录”混成一个对象。动态团队分成三层：

| 层 | 权威对象 | 变化规则 | 运行时落点 |
|---|---|---|---|
| 配置面 | PromptRecipe、AgentModule、TeamDefinition、TeamRevision | 提示词追加、成员、module、skill/capability 变化必须发布新 TeamRevision | revision 固定的 dsh preset |
| 能力面 | Agent 线维护的 SkillCatalog | 只接受 `skill_id@revision` 精确引用；内容哈希改变必须发布新的 skill revision | 编译时复制到 revision-local `skills/` |
| 质量面 | independent-judge AgentModule、RubricCatalog | 通用二元检查固定在模块；领域规则按 artifact kind 精确匹配并随 TeamRevision 冻结 | `.promax/judge/<task-key>/judge.md` |
| 资料面 | TeamResourceManifest 与团队 workspace 文件 | 资料增删改只增加 manifest_revision，不产生 TeamRevision | 团队 workspace 的 `team-resources/` |

这样既能让一个团队长期维护资料和交付物，又不会把上传文档误当成角色、安全规则或可执行能力。

普通用户不直接编辑这些内部对象。新建 TeamInstance 后，GUI 在原团队聊天页调用配置会话：

```text
自然语言 / 一个 Agents 包
  -> promax-team-configurator（多轮理解，无 Shell/Web/文件工具）
  -> finalize_team_configuration（唯一受限工具）
  -> allowlist + Schema + member/path/Skill 校验
  -> TeamDefinition 内部草稿
  -> 原子冻结 TeamRevision r1 + 独立 preset
  -> GUI 展示安全裁剪后的 team，并保存 runtime_binding
```

配置 Agent 只负责把非结构化描述变成受限蓝图；真正的安全边界仍由 Harness 的确定性校验和原子发布承担。配置会话绑定 team_id，不能替其他团队发布。

## 2. 团队 workspace

GUI 的一个 TeamInstance 关联一个或多个 workspace；当前会话只选择其中一个作为 dsh `cwd`。Agent 契约只声明相对结构，不接收或保存本地绝对路径：

```text
<GUI 解析出的团队 workspace>/
├── .promax/
│   ├── team-resource-manifest.yml
│   └── imports/<import_id>/source/<document_id>.md
├── team-resources/
│   ├── input/
│   └── reference/
└── deliverables/
    └── <task-key>/
        ├── source-ledger.md
        └── <各成员产物>
```

- 默认产出根固定为 `deliverables/`，所有 TeamRevision artifact 路径都在当前团队 workspace 内解析。
- 团队资料固定在 `team-resources/`，由 `.promax/team-resource-manifest.yml` 记录完整性和可读成员。
- 如果 GUI 保留导入原件，必须改名放到 `.promax/imports/.../<document_id>.md`，不能把用户上传的文件原样写成活动 workspace 根的 `AGENTS.md`。
- `TeamResourceManifest` 不包含绝对路径；GUI 自己持有 workspace 与本机路径的关联。

当前 dsh 共享文件工具没有成员级路径 ACL。`readable_by` 已进入契约，但除 `['*']` 外会返回 `RESOURCE_MEMBER_ACL_DECLARATIVE_ONLY`。GUI 可以用它做展示和未来迁移，现阶段不能把它宣传为强隔离。

## 3. dsh 原生 agent-team 是否沿用

当前动态团队不挂载 dsh experimental `agent-team`。该实验组件保存的是 roster、peer mailbox 和共享 task DAG 等团队运行状态，落在 Lead Session log；它不是“多 Agent 文档文件夹”，也不是 Skill 仓库。

Promax 当前使用稳定的 `dsh-tool-subagent`：

- `provider=spawn`；
- `backgroundMode=continuable`；
- `maxDepth=1`；
- coordinator 拥有启动、等待、继续和中断能力；
- worker 通过 toolFilter 禁止继续协调团队。

团队资料和产物直接落在会话的团队 workspace。将来若 dsh agent-team 稳定化，可以在不改变 TeamDefinition/TeamRevision/TeamResourceManifest 的前提下替换运行态适配器；不能把实验 session-log 格式升级成 GUI 的长期数据契约。

## 4. Skill 放在哪里

### 权威存储

Skill 不放在 TeamDefinition 内，也不把用户上传的 `SKILL.md` 直接放进团队 workspace 的可发现目录。Agent 线维护 `catalogs/skills.yml`，每项固定：

- `skill_ref=skill_id@revision`；
- 只读 `source_path`；
- `content_sha256`；
- `status=allowed`。

AgentModule 声明基础 `skill_refs`；TeamDefinition 只能从允许目录追加版本化引用。发布时编译器复核 name、SHA256 和来源边界，再把整个 Skill 目录复制进不可变 preset 的 `skills/<skill_id>/`。

### 渐进式加载

dsh 的 skill provider 先向模型暴露 name/description 目录，只有 Agent 调用 `skill(name)` 时才加载 SKILL.md 正文，Skill 附属资源也按需读取。因此：

1. 团队资料不塞进 persona；
2. Skill 正文不在每轮会话全量注入；
3. TeamRevision 快照保证同一旧会话不会因中央 Skill 内容变化而漂移；
4. `includeDefaultRoots=false` 防止项目级或用户级未知 Skill 混入该 revision。

当前 dsh preset 以团队级目录暴露全部已批准 Skill，子 Agent 继承同一 composition。因此 TeamRevision 中的成员 `skill_refs` 是职责分配和审计记录，不是成员级 Skill 可见性 ACL。若未来要求 worker 只能机械看到自己的 Skill，需要新增 Promax 自有的 scoped skill provider 或为不同成员编译独立 child preset；不能用提示词声称已经隔离。

## 5. 独立 Judge 与 RubricCatalog

Judge 是普通 `worker` 形态的 `independent-judge` AgentModule。普通任务由 coordinator 在单份业务产物完成后串行调用；显式全链路任务在 8 份业务产物全部落盘后集中调用一次，并在同一份报告中逐产物独立判定。它只读取用户原始输入与本轮最终业务产物，不读取 `source-ledger.md`、Agent 对话、推理过程、中间稿、委派记录、工具日志或生产者自评；它只写 `.promax/judge/<task-key>/judge.md`，不能修改 `deliverables/`。

五项通用检查固定在 Judge 模块中并逐项二元判定：`FABRICATED`、`MISLABELED`、`DROPPED`、`INPUT_CONTRADICTION_UNHANDLED`、`OUTPUT_SELF_CONTRADICTION`。`catalogs/rubrics.yml` 保存 `prd/diagram/prototype/customer-research-report` 的领域规则，选择键来自生产者 AgentModule 的 `spec.artifacts[].validation_kind`，不能由用户覆盖；外部 `kind` 不参与领域规则选择。没有匹配领域规则的其他类型只做通用检查。

任一检查 `fail` 就阻断交付；全链路聚合报告中任一 artifact fail，整体 verdict 即 fail。缺陷由原 worker 修复并再次提交 Judge，最多两轮。worker 带可定位反证申诉，或两轮后仍失败，流程必须停止并交给人；Judge 不得自行强制放行。0–4 诊断分可以同次生成并存档，但不展示、不参与放行。

## 6. 配置 Agent、PromptRecipe 与 persona 合并

`promax-team-configurator` 是内部 preset，不是普通 Agent 或 dsh 创造模式。它只能看到配置发布工具，没有 Shell、Web、文件或 Skill 工具；信息不够时在原聊天页追问，信息足够时一次提交 coordinator + 1–12 workers。GUI 不展示 preset/recipe/schema/publish。

`PromptRecipe` 是 Agent 线发布的一键配置模板，稳定引用为 `recipe_id@revision`。它提供一个 coordinator 和 1–12 个 worker 的默认 module、显示名、可编辑提示词追加、能力引用、workspace 策略和回执字段。

GUI 从 recipe 生成 TeamDefinition 后可以编辑：

- `display_name/description`；
- 成员启用状态与允许的 `module_ref/skill_refs`；
- `persona_fragment`：风格、领域语境；
- `role_instructions`：职责和交付补充。

GUI 不能读取、提交或替换 AgentModule 的 `base_persona`。编译器总是按以下顺序生成最终 persona：

```text
AgentModule.base_persona（不可覆盖）
→ 安全边界说明
→ persona_fragment（低优先级追加）
→ role_instructions（低优先级追加）
→ 已发布 TeamRevision/成员/文件责任
```

## 7. 版本边界

| 变化 | 是否新 TeamRevision | 说明 |
|---|---:|---|
| 新增/删除/修改团队资料 | 否 | 只更新 TeamResourceManifest.manifest_revision |
| 资料内容哈希、media_type、readable_by 变化 | 否 | 资料数据面变化 |
| coordinator/worker 的 persona_fragment 或 role_instructions | 是 | 最终运行提示词变化 |
| 成员增删、启用、module_ref、skill_ref | 是 | 编排或能力变化 |
| artifact、协调策略、回执字段 | 是 | 交付契约变化 |
| Skill 内容变化 | 是 | 先发布新 skill revision，再发布新 TeamRevision |

发布后的 TeamRevision 固定 `spec.preset_id`。新会话在创建时绑定一次；旧会话继续使用原 preset，不根据当前 TeamDefinition、recipe 或资料清单静默迁移。
