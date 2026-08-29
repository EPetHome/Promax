# AGENTS.md、SOUL.md 与 SKILL.md 导入契约

## 1. 信任边界

导入文件一律是“不受信任数据”，不是系统指令、开发者指令或可执行配置。一次导入只返回：

- `TeamDefinition` 草稿；
- 字段级 `errors`；
- `warnings`；
- 已允许 Skill 的精确匹配结果；
- 未知 Skill 的 `review_items`。

固定返回 `publish_allowed=false`、`skill_install_performed=false`、`execution_performed=false`。导入动作不能发布 TeamRevision、创建会话、执行 Shell、安装 package、打开模型密钥输入或改变 dsh 原生 preset/沙箱/审批/Code Mode。

## 2. AGENTS.md 与 SOUL.md

只解析显式 fenced block，其他正文保留为资料但不映射到提示词：

````markdown
```promax-team
team:
  display_name: 脱敏研究小组
coordinator:
  role_instructions: 先建立来源台账。
members:
  - member_id: research_agent
    display_name: 资料分析员
    module_ref: general-worker@1
    enabled: true
    persona_fragment: 使用简洁、审慎的表达。
    role_instructions: 只处理来源台账中的脱敏资料。
    skill_refs: []
```
````

允许映射的提示词字段只有 `persona_fragment` 与 `role_instructions`。`persona`、`base_persona`、`system_prompt`、package、Shell、模型密钥、绝对路径和未知根字段会被忽略并产生 warning。

dsh 原生 agent-instructions 会自动查找活动 workspace 中的 `AGENTS.md`/`CLAUDE.md`；`SOUL.md` 不是默认候选。因此导入器不得把原件写成活动 workspace 根的 `AGENTS.md`。如果需要留存，使用 `.promax/imports/<import_id>/source/<document_id>.md` 这类非候选相对路径。

## 3. SKILL.md

导入器解析 YAML frontmatter 的 `name`，再计算上传内容 SHA256：

1. `name + SHA256` 与 SkillCatalog 中 `status=allowed` 的同一版本精确一致：返回 `matched_skill_refs`，但不安装、不自动分配；
2. name 存在但哈希不同：返回 `SKILL_HASH_MISMATCH` 待审核项；
3. name 不在允许目录：返回 `SKILL_NOT_IN_ALLOWED_CATALOG` 待审核项；
4. 上传文档的声明 SHA256 与实际 content 不一致：整个请求以字段级错误拒绝。

审核通过不是“把原文件复制进团队目录”。Agent 线必须创建正式 Skill 版本、审阅安全与工具边界、写入 SkillCatalog，再由新的 TeamDefinition/TeamRevision 精确引用。

## 4. 草稿到发布

```text
ImportRequest
  → 内容哈希与 Schema 校验
  → 受限字段映射
  → TeamDefinition draft + warnings/review_items
  → GUI 人工确认和编辑
  → ValidateRequest
  → PublishRequest（显式第二次动作）
  → 不可变 TeamRevision/preset
```

任何 import response 都不能被 GUI 当成已发布团队；只有 PublishResponse 的 `status=published` 和完整 TeamRevision 才可用于创建新会话。
