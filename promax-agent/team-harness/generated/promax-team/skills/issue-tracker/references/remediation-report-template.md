<!-- 跟踪评审问题整改 Skill 参考文件 - 整改跟踪报告模板 -->

# 整改跟踪报告模板

> 本文件定义整改跟踪报告的完整结构，供 Issue Tracker Skill 在输出最终报告时使用。模板中的占位符 `{...}` 在实际执行时应替换为真实数据。

---

## 报告类型说明

| 报告类型 | 触发条件 | 输出范围 |
|---------|---------|---------|
| 完整跟踪报告 | 新版 PRD 已发布，Diff 和复检均已执行 | 全部章节 |
| 进度快照 | 未到 Diff 阶段，仅查询当前整改状态 | 基本信息 + 问题状态总览表 + SLA 预警 |
| 关闭报告 | 全部问题已步入终态（verified 或 closed） | 完整报告 + 最终统计 |

---

## 完整跟踪报告模板

```markdown
# {项目名称} 需求评审问题整改跟踪报告

---

## 基本信息

| 字段 | 值 |
|------|-----|
| 项目名称 | {product_name} |
| 原评审编号 | {review_report_id} |
| 原评审日期 | {review_date} |
| 原评审结论 | {review_conclusion} |
| 原综合评分 | {original_score}/100（{original_grade} 级） |
| 跟踪日期 | {tracking_date} |
| 旧版 PRD 版本 | {old_prd_version} |
| 新版 PRD 版本 | {new_prd_version} |
| 跟踪模式 | 完整跟踪 / 进度快照 / 关闭报告 |
| 生成者 | Issue Tracker Skill |

---

## 一、整改概览

| 指标 | 值 |
|------|-----|
| 总问题数 | {total} |
| ✅ 已验证（已修复） | {verified} |
| ❌ 驳回（修复不充分） | {rejected} |
| 🔄 处理中 | {in_progress} |
| ⏳ 待处理 | {pending} |
| 📋 已关闭（不修复） | {closed} |
| 🔴 致命问题修复率 | {fatal_fix_rate}%（{fatal_verified}/{fatal_total}） |
| 🟡 警告问题修复率 | {warning_fix_rate}%（{warning_verified}/{warning_total}） |
| 💡 建议问题修复率 | {suggestion_fix_rate}%（{suggestion_verified}/{suggestion_total}） |
| 📊 总修复率 | {total_fix_rate}%（{verified}/{total}） |
| ⏰ SLA 达成率 | {sla_rate}%（{sla_met}/{verified}） |
| 🔁 反复打开问题数 | {reopened_count} |
| ⏱ 平均修复时间 | {avg_fix_time} 小时 |

---

## 二、问题状态总览表

### 2.1 致命问题（🔴）

| 工单 ID | 问题标题 | 状态 | 责任人 | SLA 截止 | SLA 状态 | 修复次数 |
|--------|---------|------|--------|---------|---------|---------|
| IT-XXX | {title} | {status} | {assignee} | {due_date} | on_track/at_risk/overdue | {fix_iterations} |

### 2.2 警告问题（🟡）

| 工单 ID | 问题标题 | 状态 | 责任人 | SLA 截止 | SLA 状态 | 修复次数 |
|--------|---------|------|--------|---------|---------|---------|
| IT-XXX | {title} | {status} | {assignee} | {due_date} | on_track/at_risk/overdue | {fix_iterations} |

### 2.3 建议问题（💡）

| 工单 ID | 问题标题 | 状态 | 责任人 | SLA 截止 | SLA 状态 | 修复次数 |
|--------|---------|------|--------|---------|---------|---------|
| IT-XXX | {title} | {status} | {assignee} | {due_date} | on_track/at_risk/overdue | {fix_iterations} |

---

## 三、修复效果复检结论

### 3.1 已验证（✅ verified）—— {n} 个

**IT-{xxx}: {问题标题}**

- **原始问题**：[严重等级] {问题描述摘要}
- **原始定位**：{章节}
- **修复内容**：{新版 PRD 中的变更描述}
- **复检检查项**：{Q1, Q3, ...}
- **复检结果**：✅ 通过
- **复检说明**：{逐项检查结果，如：Q1 ✅ 已补充背景说明；Q3 ✅ 功能列表已补全；P-01 ✅ 模糊词已淘汰}

---

### 3.2 驳回（❌ rejected）—— {n} 个

**IT-{xxx}: {问题标题}**

- **原始问题**：[严重等级] {问题描述摘要}
- **原始定位**：{章节}
- **修复内容**：{新版 PRD 中的变更描述}
- **驳回原因**：{驳回的具体原因，如：Q7 检查未通过，验收标准仍缺失}
- **复检发现**：
  - {检查项}：❌ {具体发现}
  - {检查项}：✅ {通过项也列出}
- **驳回建议**：{建议下一步修复方向}
- **修复次数**：{fix_iterations} / 3
- **{fix_iterations >= 3 时}** ⚠️ 已达到 3 次修复尝试，建议召开专项评审

---

### 3.3 未处理（⏳ pending）—— {n} 个

| 工单 ID | 问题标题 | 严重等级 | 未处理原因 | 风险 |
|--------|---------|---------|-----------|------|
| IT-XXX | {title} | {severity} | Diff 未检测到变更 | {risk} |
| IT-XXX | {title} | {severity} | 定位失效（章节已删除） | {risk} |

---

### 3.4 已关闭（📋 closed）—— {n} 个

| 工单 ID | 问题标题 | 严重等级 | 关闭原因 | 关闭时间 |
|--------|---------|---------|---------|---------|
| IT-XXX | {title} | {severity} | 建议类问题，延后至 V3 | {closed_at} |

---

## 四、未修复问题风险预警

### 4.1 SLA 超时预警

| 优先级 | 工单 ID | 问题标题 | 严重等级 | 超时时长 | 建议行动 |
|-------|--------|---------|---------|---------|---------|
| 🔴 紧急 | IT-XXX | {title} | 致命 | 超时 {n}h | 立即升级至项目经理 |
| 🟡 关注 | IT-XXX | {title} | 警告 | 超时 {n}d | 提醒责任人 |
| 💡 留意 | IT-XXX | {title} | 建议 | 超时 {n}d | 下一次迭代跟踪 |

### 4.2 反复打开预警

| 工单 ID | 问题标题 | 修复次数 | 最近一次驳回原因 |
|--------|---------|---------|----------------|
| IT-XXX | {title} | {n} | {reason} |

> 建议：对反复打开的问题召开专项评审，重新评估问题根因和修复方案。

### 4.3 高风险未处理项

| 工单 ID | 问题标题 | 严重等级 | 风险说明 |
|--------|---------|---------|---------|
| IT-XXX | {title} | 致命 | 阻塞核心功能开发，必须本轮修复 |
| IT-XXX | {title} | 警告 | 可能导致前后端联调时返工 |

---

## 五、整改趋势统计

### 5.1 本轮整改数据

| 指标 | 数值 |
|------|------|
| 总修复率 | {total_fix_rate}% |
| SLA 达成率 | {sla_rate}% |
| 平均修复时间 | {avg_fix_time} 小时 |
| 驳回率 | {rejection_rate}%（{rejected_count}/{fixed_count}） |
| 反复打开率 | {reopen_rate}%（{reopened_count}/{total}） |

### 5.2 各维度修复进度

| 维度 | 总问题数 | 已修复 | 修复率 | 剩余扣分 |
|------|---------|--------|--------|---------|
| 完整性 | {n} | {n} | {x}% | {y} 分 |
| 一致性 | {n} | {n} | {x}% | {y} 分 |
| 可测试性 | {n} | {n} | {x}% | {y} 分 |
| 清晰度 | {n} | {n} | {x}% | {y} 分 |
| 可行性 | {n} | {n} | {x}% | {y} 分 |
| 优先级 | {n} | {n} | {x}% | {y} 分 |
| 边界场景 | {n} | {n} | {x}% | {y} 分 |
| 合规性 | {n} | {n} | {x}% | {y} 分 |

> 扣分规则参见 `requirement-review/references/scoring-standards.md`：致命 -25 / 警告 -10 / 建议 -3

### 5.3 版本间质量趋势

{仅在存在历史整改记录时输出本节}

| 指标 | 上一轮（{prev_review_date}） | 本轮（{review_date}） | 变化 |
|------|---------------------------|---------------------|------|
| 原评审总问题数 | {prev_total} | {curr_total} | {delta} |
| 原评审致命问题数 | {prev_fatal} | {curr_fatal} | {delta} |
| 总扣分 | {prev_deduction} | {curr_deduction} | {delta} |
| 修复率 | {prev_fix_rate}% | {curr_fix_rate}% | {delta}% |
| 平均修复时间 | {prev_avg_time}h | {curr_avg_time}h | {delta}h |

**质量趋势判定**：{改善 / 持平 / 恶化}

**趋势分析**：
{对趋势的分析说明，如：本轮致命问题数减少但警告问题增加，总扣分从 85 降至 45，整体质量改善。但可测试性维度修复率偏低（40%），建议重点推进。}

---

## 六、PRD 版本变更摘要

{本章内容由 Diff 引擎生成，直接引用。完整模板见 `references/diff-engine-guide.md` 第四章。}

### 6.1 章节变更概览

- 新增章节：{n} 个
- 删除章节：{n} 个
- 修改章节：{n} 个

### 6.2 静默修改风险提示

{如有静默修改，列出并标注风险等级。完整信息已反馈给 requirement_review Agent 做补充评审。}

---

## 七、建议行动

### 7.1 立即行动（本轮必须完成）

1. {action_1}（如：修复 IT-XXX 致命问题，SLA 已超时 {n}h）
2. {action_2}

### 7.2 短期行动（下一轮修复）

1. {action_1}（如：推进警告问题修复，当前修复率仅 {x}%）
2. {action_2}

### 7.3 建议关注

1. {suggestion_1}（如：可测试性维度修复率持续偏低，建议组织专项讨论）
2. {suggestion_2}

---

## 八、附录：外部系统同步数据

### 8.1 中间规范格式（JSON）

以下 JSON 数组包含全部工单的结构化数据，可作为对接 TAPD / Jira / 飞书多维表格的中间格式：

```json
[
  {
    "issue_id": "IT-20260427-0001",
    "source_ids": ["S-1", "PM-3"],
    "severity": "fatal",
    "severity_label": "致命",
    "dimension": "完整性",
    "original_location": "2.1 核心功能",
    "title": "缺少核心功能验收标准",
    "description": "P0 功能「用户注册」未定义验收标准...",
    "impact": "开发无法确认功能是否实现符合预期",
    "suggested_fix": "为「用户注册」功能补充验收标准：注册成功率 > 99%，注册耗时 < 3s",
    "checklist_refs": ["Q3", "Q7"],
    "pattern_refs": ["P-06"],
    "status": "verified",
    "assignee": "pm-zhang",
    "due_date": "2026-04-28T10:00:00Z",
    "fix_iterations": 1,
    "created_at": "2026-04-27T10:00:00Z",
    "updated_at": "2026-04-28T10:30:00Z",
    "resolved_at": "2026-04-28T10:30:00Z",
    "closed_at": null,
    "review_verdict": "verified",
    "review_detail": "Q3/Q7 检查通过，P-06 模式已消除",
    "sla_status": "on_track",
    "timeline": [
      {
        "timestamp": "2026-04-27T10:00:00Z",
        "event": "created",
        "from": null,
        "to": "pending",
        "operator": "issue-tracker",
        "note": "从评审报告 S-1 解析生成"
      }
    ]
  }
]
```

### 8.2 TAPD 字段映射

| 中间规范字段 | TAPD 字段 | 映射说明 |
|-------------|----------|---------|
| `issue_id` | `id` / `custom_field_issue_id` | TAPD 有系统自动生成的 ID，中间规范 ID 建议存入自定义字段 |
| `source_ids` | 自定义字段 | 以逗号分隔存储 |
| `severity` | `severity` | 映射：fatal→fatal, warning→normal, suggestion→suggestion |
| `dimension` | 自定义字段 | TAPD 无标准维度字段 |
| `title` | `name` / `title` | 缺陷标题 |
| `description` | `description` | 详细描述 |
| `status` | `status` | 需映射：pending→new, in_progress→in_progress, fixed→resolved, verified→closed, rejected→reopened, closed→closed |
| `assignee` | `owner` / `current_owner` | 处理人 |
| `due_date` | `due` | 截止日期 |
| `fix_iterations` | 自定义字段 | 修复尝试次数 |
| `created_at` | `created` | 创建时间 |
| `resolved_at` | `resolved` | 解决时间 |
| `review_detail` | `resolution` / 自定义字段 | 解决方案或复检结果 |

### 8.3 Jira 字段映射

| 中间规范字段 | Jira 字段 | 映射说明 |
|-------------|----------|---------|
| `issue_id` | `key` / 自定义字段 | Jira 自动生成 issue key，中间规范 ID 建议存入自定义字段 |
| `severity` | `priority` | 映射：fatal→Highest, warning→High, suggestion→Medium |
| `dimension` | `labels` 或自定义字段 | 以标签形式存储 |
| `title` | `summary` | 问题摘要 |
| `description` | `description` | 详细描述 |
| `status` | `status` | 需映射至 Jira 工作流的对应状态 |
| `assignee` | `assignee` | 经办人 |
| `due_date` | `duedate` | 截止日期 |
| `fix_iterations` | 自定义字段 | 修复尝试次数 |
| `created_at` | `created` | 创建时间 |
| `resolved_at` | `resolutiondate` | 解决时间 |
| `checklist_refs` | 自定义字段或链接 | 关联的检查项编号 |
| `pattern_refs` | 自定义字段或链接 | 关联的问题模式编号 |

### 8.4 飞书多维表格字段映射

| 中间规范字段 | 飞书多维表格字段 | 字段类型 |
|-------------|----------------|---------|
| `issue_id` | 工单 ID | 文本 |
| `source_ids` | 原始编号 | 文本（逗号分隔） |
| `severity_label` | 严重等级 | 单选（致命/警告/建议） |
| `dimension` | 所属维度 | 单选（8 个维度） |
| `title` | 问题标题 | 文本 |
| `description` | 问题描述 | 多行文本 |
| `status` | 状态 | 单选（6 个状态） |
| `assignee` | 责任人 | 人员 |
| `due_date` | 截止日期 | 日期 |
| `fix_iterations` | 修复次数 | 数字 |
| `sla_status` | SLA 状态 | 单选（正常/风险/超时） |
| `review_verdict` | 复检结论 | 单选（通过/驳回/待复检） |
| `created_at` | 创建时间 | 日期 |
| `resolved_at` | 解决时间 | 日期 |

> 注：以上字段映射为建议方案。实际对接时需根据各系统的自定义字段能力和工作流配置调整。
```

---

## 进度快照报告模板（简化版）

当不需要完整报告时（如仅查询当前状态），使用此简化模板：

```markdown
# {项目名称} 整改进度快照

**快照日期**：{date}
**原评审日期**：{review_date}

## 进度概览

| 状态 | 数量 | 占比 |
|------|------|------|
| ✅ 已验证 | {n} | {x}% |
| 🔄 处理中 | {n} | {x}% |
| ⏳ 待处理 | {n} | {x}% |
| 📋 已关闭 | {n} | {x}% |
| **合计** | **{total}** | **100%** |

## SLA 预警

| 工单 ID | 问题标题 | 严重等级 | 超时时长 |
|--------|---------|---------|---------|
| IT-XXX | {title} | {severity} | {overtime} |

## 待处理清单

| 工单 ID | 问题标题 | 严重等级 | 责任人 | 截止日期 |
|--------|---------|---------|--------|---------|
| IT-XXX | {title} | {severity} | {assignee} | {due_date} |
```
