# Report Template

## Purpose

Define the structure and formatting rules for product exploration reports. The final output is always a Markdown competitor analysis report with an embedded competitor difference panel.

## Report Types

Select the appropriate template based on `intent_type`.

### 1. Product Planning and Market Landscape Report

Use when `intent_type = market_landscape`.

```markdown
# {target_market} 产品探索与竞品分析报告

---

## Executive Summary

[2-3 sentences summarizing market structure, key players, opportunity gaps, and major risks.]

---

## 研究范围与信息缺口

| 项目 | 内容 |
|------|------|
| 目标市场 | |
| 覆盖竞品 | |
| 信息来源 | |
| 信息缺口 | |

---

## 竞品差异面板

[由 difference-panel 子技能填充]

---

## 市场概览

- 市场格局与主要玩家 [1]
- 用户/客户需求变化 [2]
- 增长驱动与主要阻碍 [3]

---

## 主要玩家

| # | Product | Vendor | Website | Positioning | Verification |
|---|---------|--------|---------|-------------|--------------|
| 1 | | | | | |

---

## 机会点与空白

| 机会点 | 证据 | 相关竞品 | 不确定性 |
|--------|------|----------|----------|
| | | | |

---

## 风险与约束

| 风险 | 影响 | 证据 | 建议验证 |
|------|------|------|----------|
| | | | |

---

## 产品规划建议

- 可考虑方向 1：... [1]
- 需验证问题 1：...

---

## References

[1] Title - URL
```

### 2. Feature Design and Iteration Report

Use when `intent_type = feature_iteration`.

```markdown
# {feature_focus} 功能探索与竞品分析报告

---

## Executive Summary

[2-3 sentences summarizing competitor implementations, best practices, pitfalls, and design opportunities.]

---

## 研究范围与信息缺口

| 项目 | 内容 |
|------|------|
| 目标功能 | |
| 覆盖竞品 | |
| 覆盖页面 | |
| 信息缺口 | |

---

## 竞品差异面板

[由 difference-panel 子技能填充]

---

## 竞品实现方式

| Product | Entry Point | Core Flow | Rules/Permissions | Feedback/Data | Sources |
|---------|-------------|-----------|-------------------|---------------|---------|
| | | | | | |

---

## 用户反馈与已知坑点

| 问题/反馈 | 涉及产品 | 证据 | 可借鉴/规避 |
|-----------|----------|------|-------------|
| | | | |

---

## 最佳实践提炼

1. **Practice 1**: Description with evidence [1]
2. **Practice 2**: Description with evidence [2]

---

## 功能方案建议

- 可考虑设计：...
- 需要验证：...

---

## References

[1] Title - URL
```

### 3. Competitive Comparison Report

Use when `intent_type = product_competition`.

```markdown
# {target_product} 竞品对比分析报告

---

## Executive Summary

[2-3 sentences about the competitive landscape and differentiation.]

---

## 研究范围与信息缺口

| 项目 | 内容 |
|------|------|
| 目标产品 | |
| 对比竞品 | |
| 信息来源 | |
| 信息缺口 | |

---

## 竞品差异面板

[由 difference-panel 子技能填充]

---

## Products Overview

| Attribute | Product A | Product B | Product C |
|-----------|-----------|-----------|-----------|
| Vendor | | | |
| Website | | | |
| Target User | | | |
| Pricing | | | |

---

## Feature Comparison

| Feature | Product A | Product B | Product C | Evidence |
|---------|-----------|-----------|-----------|----------|
| Feature 1 | Yes/No/Unknown | Yes/No/Unknown | Yes/No/Unknown | [1] |

---

## Differentiation

- **Product A**: Unique strength with evidence [1]
- **Product B**: Unique strength with evidence [2]

---

## Recommendations

- Best for {scenario}: {product} because...
- Needs validation: ...

---

## References

[1] Title - URL
```

### 4. Market Monitoring and Risk Alert Report

Use when `intent_type = market_monitoring`.

```markdown
# {target_product_or_market} 市场动态与风险预警报告

---

## Executive Summary

[2-3 sentences summarizing recent updates, pricing/campaign changes, negative signals, and risk level.]

---

## 监控范围与信息缺口

| 项目 | 内容 |
|------|------|
| 监控对象 | |
| 监控信号 | release / pricing / campaign / risk |
| 时间范围 | |
| 信息缺口 | |

---

## 竞品差异面板

[由 difference-panel 子技能填充]

---

## 动态摘要

| Date | Product | Signal | Summary | Source | Verification |
|------|---------|--------|---------|--------|--------------|
| | | | | | |

---

## 价格与市场活动变化

| Product | Change | Evidence | Potential Impact |
|---------|--------|----------|------------------|
| | | | |

---

## 风险信号

| Risk | Product | Severity | Evidence | Uncertainty |
|------|---------|----------|----------|-------------|
| | | Low/Medium/High | | |

---

## 响应建议

- 需要立即关注：...
- 后续监控建议：...

---

## References

[1] Title - URL
```

### 5. Business Model and Operation Playbook Enhancement

Use this enhancement when `analysis_focus` includes `business_model`, `operation_playbook`, or `product_strategy`. It can be appended to `market_landscape`, `product_competition`, or `market_monitoring` reports.

This template is useful when the user asks for:

- 商业模式、变现方式、收费模式、收入来源
- 市场运营方案、增长玩法、渠道策略、权益体系、生态运营
- MVP 建议、产品策略、落地路径、验证问题

```markdown
# {target_market_or_topic} 市场运营方案与商业模式调研分析

---

## Executive Summary

[3-5 bullets. Summarize the market logic, key vendor strategies, monetization paths, and the most important risks. Separate public facts from analytical judgment.]

---

## 研究范围与信息缺口

| 项目 | 内容 |
|------|------|
| 目标市场/主题 | |
| 覆盖厂商 | |
| 分析焦点 | business_model / operation_playbook / product_strategy |
| 公开事实 | |
| 主要信息缺口 | |

---

## 主流玩法总览

| 玩法 | 核心逻辑 | 代表厂商 | 适合客户 | 证据状态 |
|------|----------|----------|----------|----------|
| | | | | fact / inference / to_verify |

---

## 厂商差异面板

| 维度 | Vendor A | Vendor B | Vendor C | 产品/商业启示 |
|------|----------|----------|----------|----------------|
| 战略定位 | | | | |
| 核心资产 | | | | |
| 运营方案 | | | | |
| 商业模式 | | | | |
| 主要优势 | | | | |
| 主要风险 | | | | |

---

## 重点厂商分析

### {Vendor A}: {one-line positioning}

- 已公开事实：... [1]
- 运营打法：... [2]
- 商业模式判断：基于 {evidence}，可推断 ... [1][2]
- 待验证：...

### {Vendor B}: {one-line positioning}

- 已公开事实：...
- 运营打法：...
- 商业模式判断：...
- 待验证：...

---

## 可借鉴的市场运营方案

| 运营层级 | 关键动作 | 落地要点 | 风险控制 |
|----------|----------|----------|----------|
| 供给层 | | | |
| 商品层 | | | |
| 运营层 | | | |
| 治理层 | | | |

---

## 推荐商业模式组合

> 推荐路径：{entry_offer} → {retention_mechanism} → {value_added_service} → {recurring_revenue} → {ecosystem_share}

| 产品线 | 目标客户 | 收费方式 | 优先级 | 需要验证 |
|--------|----------|----------|--------|----------|
| | | | 高/中/低 | |

---

## 机会、风险与验证问题

### 机会

- ... [1]

### 风险

- ... [2]

### 优先验证问题

- 客户愿意为什么付费？
- 单位成本与毛利是否可控？
- 哪些场景能形成高频复购？
- 生态伙伴分润应按什么口径计算？

---

## MVP 建议

| 阶段 | 目标 | 关键交付 | 成功指标 |
|------|------|----------|----------|
| 0-1 验证 | | | |
| 1-10 增长 | | | |
| 10-N 生态 | | | |

---

## References

[1] Title - URL
```

## Writing Rules

1. **Evidence-based**: Every claim should reference a source `[1]`.
2. **No fabrication**: Write "未在搜索结果中找到" for ordinary missing product facts. For business and operation fields, write "未披露" unless a reliable source explicitly confirms absence.
3. **Objective tone**: Avoid promotional language and final business decisions.
4. **Panel required**: Every report must include `## 竞品差异面板`.
5. **Concise**: Prefer tables over paragraphs for comparative data.
6. **Source attribution**: List all source URLs in the References section.
7. **Honest gaps**: Explicitly note what information is missing or unverified.
8. **Fact vs inference**: For commercial strategy, distinguish `公开事实`, `商业模式判断`, and `待验证问题`.
9. **Actionable synthesis**: When the user asks for 运营方案 or 玩法, provide a reusable playbook and MVP path, not only a vendor-by-vendor summary.
10. **Undisclosed is not absent**: For business and operation fields, use `未披露` when public evidence is not found. Use `缺失` only when a reliable source explicitly confirms the item is not provided.
