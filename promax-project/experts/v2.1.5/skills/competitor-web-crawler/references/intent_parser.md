# Intent Parser

## Purpose

Parse a natural language query into a structured product exploration intent object that drives crawling, analysis, and report generation.

## Intent Types

| Intent | Description | Typical Scenario |
|--------|-------------|------------------|
| `market_landscape` | User wants to understand a market, category, or industry landscape | 产品立项与规划 |
| `feature_iteration` | User wants to analyze how competitors implement a specific feature | 产品功能设计与迭代 |
| `product_competition` | User wants to compare products or find alternatives | 竞品对比 |
| `market_monitoring` | User wants to monitor competitor updates, pricing, campaigns, or risk signals | 市场动态与风险预警 |

## Analysis Focus

In addition to `intent_type`, extract an optional `analysis_focus` array. This keeps the workflow compatible with the four main intents while allowing richer report styles.

| Focus | Trigger Keywords | Report Emphasis |
|-------|------------------|-----------------|
| `business_model` | business model, monetization, revenue, pricing playbook, 商业模式, 收费模式, 变现, 收入模式, 玩法 | Monetization paths, pricing logic, revenue streams, partner economics |
| `operation_playbook` | GTM, operation, growth, go-to-market, campaign, 运营方案, 市场运营, 增长, 渠道, 权益, 套餐, 生态 | Channel strategy, SKU/package design, user acquisition, retention, ecosystem operation |
| `product_strategy` | roadmap, MVP, positioning, strategy, 产品策略, 定位, MVP, 路线图, 建议 | Strategic choices, MVP recommendations, validation questions |

When the user asks for "运营方案和商业模式玩法", usually set:

```json
{
  "intent_type": "market_landscape",
  "analysis_focus": ["business_model", "operation_playbook", "product_strategy"]
}
```

## Parsing Rules

### Market Landscape
Trigger keywords: `market`, `industry`, `landscape`, `overview`, `major players`, `opportunity`, `市场`, `行业`, `立项`, `规划`, `机会`, `空白点`, `主要厂商`

Example:
- Input: "AI customer service market opportunities"
- Output: `{ intent_type: "market_landscape", target_market: "AI customer service" }`

### Feature Iteration
Trigger keywords: `feature`, `implementation`, `best practice`, `workflow`, `功能`, `方案`, `实现方式`, `迭代`, `最佳实践`, `坑点`, `用户反馈`

Example:
- Input: "会员积分体系竞品怎么做"
- Output: `{ intent_type: "feature_iteration", feature_focus: "会员积分体系" }`

### Product Competition
Trigger keywords: `vs`, `compare`, `alternatives`, `competitors`, `similar`, `对比`, `竞品`, `替代`, `类似`

Example:
- Input: "Superhuman vs Front email client"
- Output: `{ intent_type: "product_competition", target_product: "Superhuman", competitors: ["Front"] }`

### Market Monitoring
Trigger keywords: `monitor`, `tracking`, `alert`, `risk`, `changelog`, `release notes`, `pricing update`, `campaign`, `news`, `监控`, `动态`, `预警`, `风险`, `更新`, `价格调整`, `市场活动`, `舆情`

Example:
- Input: "监控 Notion 最近价格调整和版本更新"
- Output: `{ intent_type: "market_monitoring", target_product: "Notion", monitoring_scope: ["pricing", "release"] }`

## Entity Extraction

1. Extract `target_product` when a concrete product name appears.
2. Extract `target_market` when the query describes a category or market.
3. Extract `competitors` by splitting on `vs`, `和`, `与`, `对比`, commas, or listed product names.
4. Extract `feature_focus` from phrases before/after `功能`, `体系`, `方案`, `workflow`, `feature`.
5. Extract `monitoring_scope` from signal words:
   - `release`: changelog, release notes, 版本更新
   - `pricing`: pricing, price, 价格, 定价
   - `campaign`: campaign, launch, 活动, 发布
   - `risk`: complaint, outage, negative, 舆情, 风险, 投诉

## Output Format

```json
{
  "intent_type": "market_landscape | feature_iteration | product_competition | market_monitoring",
  "target_product": "string | null",
  "target_market": "string | null",
  "competitors": ["string"],
  "feature_focus": "string | null",
  "monitoring_scope": ["release | pricing | campaign | risk"],
  "analysis_focus": ["business_model | operation_playbook | product_strategy"],
  "original_query": "string",
  "missing_inputs": ["string"]
}
```
