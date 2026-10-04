# Search and Fetch Strategy

## Purpose

Generate optimized bilingual queries and define which pages should be fetched with OpenClaw `web_fetch`.

## Strategy Principles

1. **Official first**: Prefer official websites, pricing pages, feature pages, changelogs, help centers, blogs, press pages, and developer docs.
2. **Bilingual coverage**: Include both English and Chinese queries when the target market may have Chinese sources.
3. **Scenario-driven**: Query patterns must match the product manager's scenario: planning, feature iteration, comparison, or monitoring.
4. **Fetch key pages**: Search results are discovery only; important official and evidence-rich pages should be fetched.
5. **Temporal relevance**: Include current year keywords and monitoring-specific terms for recent information.
6. **Channel fit**: For Chinese-language product dynamics, market discussion, feature cases, or user feedback, include Sogou WeChat article search (`https://weixin.sogou.com/weixin`) as a supplemental discovery channel.

## Query Generation Templates

### For `market_landscape`

```text
Phase 1 — Market overview:
  "{market} market landscape {current_year}"
  "{market} industry report {current_year}"
  "{market} 市场格局 主要厂商 {current_year}"

Phase 2 — Major players:
  "{market} top products vendors"
  "{market} best tools alternatives"
  "{market} 主要产品 竞品"

Phase 3 — Opportunity and gaps:
  "{market} trends opportunities pain points"
  "{market} unmet needs product opportunities"
  "{market} 趋势 机会 痛点"
  Sogou WeChat: "{market} 市场 趋势 机会 痛点"
```

### For `feature_iteration`

```text
Phase 1 — Feature implementation:
  "{feature} product examples"
  "{feature} implementation best practices"
  "{feature} 竞品 实现方式"

Phase 2 — Competitor docs:
  "{product} {feature} help center"
  "{product} {feature} docs"
  "{product} {feature} 功能 文档"

Phase 3 — Feedback and pitfalls:
  "{feature} user feedback pros cons"
  "{feature} common problems complaints"
  "{feature} 用户反馈 坑点 优缺点"
  Sogou WeChat: "{feature} 方案 案例 用户反馈 坑点"
```

### For `product_competition`

```text
Phase 1 — Product basics:
  "{product} official website"
  "{product} features pricing"
  "{product} 官网 功能 定价"

Phase 2 — Competitors:
  "{product} alternatives competitors {current_year}"
  "{product} similar products comparison"
  "{product} 替代方案 竞品"

Phase 3 — Direct comparison:
  "{product} vs {competitor} comparison"
  "{product} {competitor} pricing features"
  "{product} {competitor} 对比"
  Sogou WeChat: "{product} {competitor} 对比 体验 功能"
```

### For `market_monitoring`

```text
Phase 1 — Official updates:
  "{product} changelog release notes {current_year}"
  "{product} product updates blog {current_year}"
  "{product} 版本更新 发布日志"

Phase 2 — Pricing and campaigns:
  "{product} pricing update {current_year}"
  "{product} new launch campaign"
  "{product} 价格调整 市场活动"

Phase 3 — Risk signals:
  "{product} outage complaints negative news"
  "{product} customer complaints issue"
  "{product} 负面 舆情 投诉 风险"
  Sogou WeChat: "{product} 更新 价格 活动 舆情 风险"
```

## Supplemental Search Channels

Use `https://weixin.sogou.com/weixin` as a supplemental channel when the task benefits from Chinese WeChat public-account articles:

- Chinese market landscape, industry commentary, product launches, feature breakdowns, operational cases, user feedback, or risk signals.
- Query with concise Chinese terms such as `"{product} 功能 体验"`, `"{product} 价格 更新"`, `"{market} 趋势 机会"`, or `"{feature} 案例 坑点"`.
- Treat Sogou result pages as discovery only. Fetch and cite the original article page when possible.
- Mark WeChat article evidence as `media`, `user_feedback`, or `[unverified]` unless the article is from an official product/company account or a clearly credible publication.

## Fetch Guidelines

Use `web_fetch` for:

- Official homepage, feature pages, pricing pages, changelog/release notes.
- Help center or documentation pages that explain the target feature.
- Newsroom, official blog, press release, or announcement pages.
- Credible media/report pages when they contain specific claims about updates, pricing, market activity, or risk.

Skip or deprioritize fetching:

- Search result pages.
- Thin listicles with no primary evidence.
- Duplicated syndicated articles.
- Social posts unless the scenario is risk monitoring and the post is an official account or directly cited by credible media.

## Result Collection Guidelines

- Execute queries sequentially to avoid rate limiting.
- Collect top 5-10 results per query.
- For market landscape or open-ended competitor research, identify 5 core competitors whenever available.
- For each core competitor, collect at least 3 credible sources whenever available.
- Fetch the top official and evidence-rich pages for each competitor.
- Deduplicate results by canonical URL.
- Prioritize sources from `{baseDir}/assets/sources.yaml`.
- Discard results from excluded domains unless the monitoring scenario requires preserving them as unverified risk signals.

## Supplemental Search Limits

Use supplemental search only when evidence coverage is insufficient:

- Core competitors found < 5.
- Any core competitor has fewer than 3 credible sources.
- Official page, feature page, pricing page, changelog, or other required primary evidence is missing.
- More than 40% of target report dimensions remain unknown.

Stop supplemental search when:

- Coverage reaches 5 core competitors with at least 3 credible sources each.
- One supplemental round adds no new high-value source.
- Two supplemental rounds have already been completed.
- The available public web evidence appears exhausted.
