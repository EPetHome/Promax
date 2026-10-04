---
name: issue-tracker
description: Use when tracking PRD review issue remediation progress, performing version diffs between PRD revisions, verifying fix effectiveness against review checklists, or generating remediation statistics with SLA alerts. Triggered when a requirement_review agent produces a review report needing issue tracking, when a new PRD version arrives for diff comparison, or when SLA checkpoints require timeout warnings.
---

# 跟踪评审问题整改

## 概述

将 `requirement_review` Agent 产出的评审报告中的问题清单转为结构化跟踪工单，对比 PRD 版本差异，逐项复检修复效果，输出整改统计报告。本 Skill 仅输出中间规范格式数据，不直接对接外部系统（TAPD/Jira/飞书）。

## 何时使用

- 收到评审报告，需要将问题清单转为可跟踪的工单
- 新版 PRD 到达，需要对比变更并关联已有工单
- 工单状态为"已修复"，需要基于检查项逐项复检
- 需要生成整改统计（修复率、SLA 达成率、质量趋势）
- SLA 检查节点到达（致命问题 24h），需超时预警

**不适用：** 初次 PRD 评审（那是 `requirement_review` Agent 的职责）、直接对接外部系统、自行修改 PRD 内容。

## 工单字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `issue_id` | string | 全局唯一 ID，格式 `IT-{YYYYMMDD}-{序号}` |
| `source_ids` | string[] | 原始报告中问题编号，支持多编号去重合并 |
| `severity` | enum | `fatal` / `warning` / `suggestion` |
| `dimension` | string | 评审维度：完整性/一致性/可测试性/清晰度/可行性/优先级/边界场景/合规性 |
| `original_location` | string | 原文定位（章节路径或摘录） |
| `issue_title` | string | 问题标题 |
| `issue_description` | string | 完整描述 |
| `impact_analysis` | string | 影响分析 |
| `suggested_fix` | string | 修改建议 |
| `checklist_refs` | string[] | 关联检查项编号 Q1-Q24（映射自 review-checklist.md） |
| `pattern_refs` | string[] | 关联问题模式编号 P-01~P-35（映射自 common-issues.md） |
| `status` | enum | `pending` → `fixed` → `verified` / `rejected` → `closed` |
| `assignee` | string | 责任人（外部输入） |
| `due_date` | string | 按严重等级 SLA 自动计算 |
| `fix_iterations` | integer | 修复尝试次数，每次驳回 +1 |
| `created_at` / `updated_at` / `resolved_at` / `closed_at` | string | 时间戳 |

**去重合并规则：** 同一问题被多角色记录时合并为一条工单，取最严重 `severity`，保留所有 `source_ids`，`checklist_refs` 和 `pattern_refs` 取并集。

## 工作流程

### 第一步：解析报告 → 生成工单

1. 读取评审报告，识别类型（深度评审/快速扫描/多角色）
2. 解析问题清单条目（S-1、PM-1、T-1 等编号），执行去重合并
3. 加载 `requirement-review/references/review-checklist.md`，映射 `checklist_refs`（Q1-Q24）
4. 加载 `requirement-review/references/common-issues.md`，映射 `pattern_refs`（P-01~P-35）
5. 按 SLA 规则计算 `due_date`（参见 `references/tracking-workflow.md`）
6. 初始状态 `pending`，`fix_iterations = 0`
7. 如有历史整改记录，合并历史工单状态

### 第二步：PRD 版本 Diff

按 `references/diff-engine-guide.md` 执行章节级对比，输出：
- 变更章节列表（新增/修改/删除）
- 正向匹配：哪些变更覆盖了工单原文定位
- 反向匹配：哪些工单原文定位未出现在变更中（未处理）
- 静默修改：变更内容不在原有问题清单中（可能引入新风险，反馈给 Agent 评审）

### 第三步：修复效果复检

对 `status = fixed` 的工单逐项复检（判定规则见 `references/tracking-workflow.md`）：
1. 定位新版 PRD 中的原文位置
2. 按 `checklist_refs` 加载对应检查项重新评估
3. 按 `pattern_refs` 加载对应问题模式检查是否仍有同类问题
4. 复检通过 → `verified`；不通过 → `rejected`，`fix_iterations += 1`

### 第四步：统计与输出

按 `references/remediation-report-template.md` 生成报告，包含：
- 问题状态总览表（全部工单状态/责任人/SLA）
- 修复效果复检结论（verified/rejected/未处理）
- 未修复问题风险预警（按 SLA 超时排序）
- 整改统计（修复率、SLA 达成率、平均修复时间、驳回率、反复打开数）
- 版本间质量趋势（改善/持平/恶化）
- 附录：中间规范格式 JSON（供外部系统消费）

## 参考资料加载规则

每次任务**必须加载**：
- `references/tracking-workflow.md` — 状态机、SLA 规则、复检判定规则

按需加载：
- `references/diff-engine-guide.md` — 涉及版本对比时
- `references/remediation-report-template.md` — 输出报告前
- `requirement-review/references/review-checklist.md` — 工单映射和复检时
- `requirement-review/references/common-issues.md` — 工单映射和静默修改扫描时

## 与 requirement_review Agent 的职责边界

| 事项 | Agent | 本 Skill |
|------|-------|---------|
| 初次 PRD 评审 | 负责 | 不参与 |
| 问题工单化与状态跟踪 | 不参与 | 负责 |
| PRD 版本 Diff | 可选定性对比 | 负责机制化章节对比 |
| 修复效果复检 | 可选参考 | 负责逐项执行 |
| 静默修改风险识别 | 收到反馈后专业评审 | 负责识别并上报 |
| 整改统计与趋势 | 可选参考 | 负责计算与输出 |

```
requirement_review Agent → 评审报告 → Issue Tracker → 整改跟踪报告
                                                    ↓
                              趋势数据、静默修改反馈 → Agent → 下一轮评审
```

## 红线

- 不编造修复状态 — 状态变更必须有依据（Diff 结果/复检结论/外部输入）
- 复检结论必须可追溯 — 每个判定引用具体 Q1-Q24 检查项
- 工单 `source_ids` 必须保留完整追溯链
- 不对"修复是否充分"做主观判断 — 基于 checklist_refs 逐项验证
- 输入不足时先完成可执行部分，在报告中标注缺口
- 所有静默修改标记但不自行判定 — 反馈给 Agent 做专业评审
