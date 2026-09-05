# Search Strategy

## Purpose

Generate an optimized set of search queries based on the identified intent type to maximize coverage and relevance.

## Strategy Principles

1. **Product first**: Always start with queries about the product itself before searching for competitors or market info
2. **Bilingual coverage**: Include both English and Chinese queries for broader results
3. **Multi-dimensional**: Cover official info, features, pricing, reviews, and alternatives
4. **Temporal relevance**: Include recent year keywords for up-to-date information

## Query Generation Templates

### For market_analysis intent

```
Phase 1 — Market overview:
  "{product} market analysis"
  "{product} industry report {current_year}"

Phase 2 — Key players:
  "{product} major vendors"
  "{product} top products best options"
  "{product} 主要厂商 产品"

Phase 3 — Trends & insights:
  "{product} market trends growth"
  "{product} 市场规模 趋势"
```

### For product_deep_research intent

```
Phase 1 — Product basics:
  "{product} official website"
  "{product} 产品官网 介绍"

Phase 2 — Features & capabilities:
  "{product} features capabilities"
  "{product} 核心功能 特点"

Phase 3 — Technical & business:
  "{product} pricing plans"
  "{product} technology architecture"
  "{product} 定价 商业模式"

Phase 4 — User feedback:
  "{product} review pros cons"
  "{product} 用户评价 优缺点"
```

### For product_competition intent

```
Phase 1 — Understand the product:
  "{product} what is"
  "{product} core features"
  "{product} 官网 介绍"

Phase 2 — Find competitors:
  "{product} alternatives competitors"
  "{product} similar products"
  "{product} 替代方案 竞品"

Phase 3 — Compare:
  "{product} vs comparison"
  "{product} 对比 评测"
```

## Result Collection Guidelines

- Execute queries sequentially to avoid rate limiting
- Collect top 5-10 results per query
- Deduplicate results by URL
- Prioritize results from trusted sources (see `{baseDir}/assets/sources.yaml`)
- Discard results from excluded domains
