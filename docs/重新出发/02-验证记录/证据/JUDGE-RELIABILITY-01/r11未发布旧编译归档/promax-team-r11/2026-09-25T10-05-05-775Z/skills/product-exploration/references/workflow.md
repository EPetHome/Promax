# Product Exploration Workflow

## Purpose

Define the workflow for the `product-exploration` skill. This skill is the main orchestrator and must always start with intent judgment before calling downstream skills.

## Workflow Overview

```text
User Query
  -> Step 1: Intent Judgment
  -> Step 2: Crawl Plan
  -> Step 3: Competitor Web Crawling
  -> Step 4: Evidence Cleaning and Report Draft
  -> Step 5: Difference Panel
  -> Step 6: Final Report Assembly
```

## Step 1: Intent Judgment

Parse the user query into one of four intent types:

| Intent Type | Scenario | Downstream Focus |
|-------------|----------|------------------|
| `market_landscape` | 产品立项与规划 | Market structure, major players, gaps, opportunities |
| `feature_iteration` | 产品功能设计与迭代 | Feature implementation, feedback, pitfalls, best practices |
| `product_competition` | 多产品竞品对比 | Positioning, features, pricing, differentiation |
| `market_monitoring` | 市场动态与风险预警 | Releases, pricing changes, campaigns, negative signals |

The intent judgment must output:

```json
{
  "intent_type": "market_landscape | feature_iteration | product_competition | market_monitoring",
  "target_market": "string | null",
  "target_product": "string | null",
  "competitors": ["string"],
  "feature_focus": "string | null",
  "monitoring_scope": ["release | pricing | campaign | risk"],
  "analysis_focus": ["business_model | operation_playbook | product_strategy"],
  "missing_inputs": ["string"]
}
```

Use `analysis_focus` when the user asks for richer analysis such as 商业模式、运营方案、变现玩法、增长路径、生态策略 or MVP 建议. Do not create a separate intent for these requests; attach the focus to the most relevant core intent.

## Step 2: Crawl Plan

Based on `intent_type`, build a crawl plan:

- `market_landscape`: discover major vendors, official pages, market reports, media coverage.
- `feature_iteration`: discover product docs, help center pages, feature pages, user feedback, known pitfalls.
- `product_competition`: discover each product's official website, feature page, pricing page, alternatives and comparison pages.
- `market_monitoring`: discover changelogs, release notes, pricing pages, blogs, newsrooms, status pages, and credible risk signals.

## Step 3: Competitor Web Crawling

Call `competitor-web-crawler`:

- Use `web_search` for source discovery.
- Use `web_fetch` for official pages and evidence-rich URLs.
- For market landscape and open-ended competitor research, target **5 core competitors**.
- For each core competitor, collect at least **3 credible sources** whenever available.
- Deduplicate and label every result with source type and credibility.

## Evidence Sufficiency and Stop Conditions

The workflow should use bounded iterative search. It must not search indefinitely.

Continue searching when:

- Fewer than 5 core competitors are identified for market landscape or open-ended competitor research.
- Any core competitor has fewer than 3 credible sources.
- Official website, feature page, pricing page, or equivalent primary evidence is missing for key competitors.
- More than 40% of required report dimensions are `未知`.
- Existing evidence is mostly third-party summaries without official or credible media confirmation.
- Sources conflict and no higher-credibility source has resolved the conflict.

Stop searching when any of the following is true:

- 5 core competitors have been identified, and each has at least 3 credible sources.
- Key dimensions are sufficiently covered for the selected report template.
- A supplemental search round adds no new high-value sources.
- Two supplemental search rounds have already been completed.
- Query, time, or cost budget is reached.

If the ideal coverage cannot be reached, stop after the bounded search and list remaining gaps in `研究范围与信息缺口`.

## Step 4: Evidence Cleaning and Report Draft

Call `report-generator`:

- Clean and normalize crawled evidence.
- Preserve source URLs and verification status.
- Select the report template that matches `intent_type`.
- If `analysis_focus` includes `business_model` or `operation_playbook`, add commercial analysis sections: market playbook, monetization model, vendor strategy comparison, opportunities, risks, MVP or validation roadmap.
- Separate public facts, analytical inferences, and to-be-verified assumptions. Every inference must be traceable to evidence and labeled as an inference when it goes beyond a directly quoted source.
- Reserve a `## 竞品差异面板` section for the panel.

## Step 5: Difference Panel

Call `difference-panel`:

- Generate a dimension-by-product table.
- Use status labels: `领先`, `持平`, `缺失`, `未知`.
- Every non-empty judgment must cite a source.

## Step 6: Final Report Assembly

Return a complete Markdown competitor analysis report with:

- Executive summary
- Research scope and missing inputs
- Competitor difference panel
- Scenario-specific analysis
- Opportunities, risks, and validation questions
- References

## Routing Rules

1. Always complete intent judgment first.
2. If intent is ambiguous, choose the most useful executable path and list ambiguity in `missing_inputs`.
3. If the user provides competitors, crawl each named competitor separately.
4. If the user asks for monitoring, prioritize recent official and credible sources.
5. Never fabricate missing product facts, pricing, releases, or risks.
6. For business model or operation playbook tasks, prefer concise tables plus short judgment paragraphs: avoid raw source dumps, but keep citations close to each non-obvious claim.
