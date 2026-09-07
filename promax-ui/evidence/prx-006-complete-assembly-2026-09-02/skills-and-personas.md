# 28 Skill 与 persona 对照

## 28 个 Skill 递归差异

原版只读根目录：`/Users/Admin/Desktop/IDaaS/调研/docs/智能体产品平台/skill迭代/docs/product-agent_20260826/skills/`。

逐条读取 `team-harness/catalogs/skills.yml` 的 `skill_id` 与 `source_path`，将每个目标目录与原版同名直接子目录执行 `diff -qr`。结果：28 pairs，0 diffs；原版直接子目录 28，Promax 正式 Skill 的 `SKILL.md` 28。

全部匹配项：`alert-early-warning`、`app-market-sentiment`、`business-diagram-generator`、`competitor-research`、`competitor-web-crawler`、`core-metrics-analysis`、`customer-research`、`data-visualization`、`difference-panel`、`feishu-requirement-archive`、`feishu-requirement-board`、`feishu-requirement-entry`、`interaction-design`、`interactive-prototype-generator`、`issue-tracker`、`logic-detector`、`pm-weekly-monitor`、`prd-document-generator`、`product-exploration`、`prototype-quality-audit`、`rd-handoff-package`、`report-generator`、`requirement-clarifier`、`requirement-review`、`search-engine`、`telemetry-tracker`、`ui-design-system`、`user-feedback-processor`。

catalog loader 测试还逐条复算 `content_sha256` 与 `tree_sha256`，并强制唯一 `skill_id`、统一 revision 1。机械证据在 `/Users/Admin/Desktop/Promax/promax-agent/team-harness/test/prx006-complete-team.test.mjs`。

## 7 份 persona 对照索引

本索引不再代替逐角色证据。以下 7 份报告分别引用原版 persona 与当前 `agent-module.yml`，并使用返工卡规定的三个固定小节名：

1. [`customer-research-persona.md`](customer-research-persona.md)
2. [`product-discovery-persona.md`](product-discovery-persona.md)
3. [`requirement-management-persona.md`](requirement-management-persona.md)
4. [`product-solution-persona.md`](product-solution-persona.md)
5. [`requirement-review-persona.md`](requirement-review-persona.md)
6. [`user-analysis-persona.md`](user-analysis-persona.md)
7. [`team-coordinator-persona.md`](team-coordinator-persona.md)

机械计数口径：本目录中精确匹配 `*-persona.md` 的文件应为 7；`skills-and-personas.md` 仅为索引与 28 Skill 总证据，不计入 7 份独立报告。
