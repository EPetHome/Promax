# Data Cleaning Rules

## Purpose

Transform raw search and fetched webpage results into structured data suitable for product exploration reports and difference panels.

## Exclusion Rules

Discard results matching these URL patterns in normal analysis:

```
google.com/search
bing.com/search
youtube.com
twitter.com / x.com
facebook.com
reddit.com
linkedin.com/company
g2.com
capterra.com
trustpilot.com
```

For `market_monitoring`, weak or social sources may be retained only as unverified risk signals when they contain specific evidence. Mark them as `[unverified]`.

## Structured Data Extraction

### Product Information

From each valid crawled result, extract:

| Field | Source | Rule |
|-------|--------|------|
| `name` | Page title | First segment before `-`, `|`, `–` separators |
| `vendor` | Domain or content | Company name from domain or "by {Vendor}" pattern |
| `website` | Result URL | Must be a valid HTTP URL |
| `description` | Content snippet | First 200 characters of relevant content |
| `features` | Content | Named capabilities mentioned in the text |
| `pricing` | Pricing page/content | Plan names, public prices, billing model |
| `updates` | Changelog/blog/news | Release date, change type, impacted feature |
| `risk_signals` | News/status/user feedback | Complaint, outage, negative news, uncertainty |
| `source_type` | URL/content | official, pricing, docs, changelog, media, report, user_feedback |

### Business and Operation Fields

When `analysis_focus` includes `business_model` or `operation_playbook`, extract additional fields:

| Field | Source | Rule |
|-------|--------|------|
| `sku_packages` | Pricing pages, product docs, announcements | Token packs, tiers, quotas, monthly/yearly plans, trial plans |
| `billing_unit` | Pricing or API docs | Token, seat, API call, compute hour, project, usage, outcome |
| `target_customers` | Official pages, cases, media | 2C, 2H, developer, SMB, enterprise, government, ecosystem partner |
| `distribution_channels` | Product pages, apps, ecosystem pages | App, cloud console, API, agent platform, partner marketplace, offline sales |
| `operation_moves` | Announcements, campaigns, docs | Launch campaign, rights package, membership, credits, points, referral, ecosystem incentive |
| `revenue_streams` | Pricing, financial reports, announcements | Subscription, usage-based fee, deployment fee, managed service, revenue share, outcome-based fee |
| `cost_constraints` | Docs, risk notes, technical limits | Rate limit, congestion, quota, GPU cost, model routing, compliance cost |
| `ecosystem_roles` | Partner pages, announcements | Model provider, cloud provider, operator, ISV, channel partner, customer |
| `validation_questions` | Derived from missing evidence | Questions that must be verified before business decision |

### Verification Status

- `verified`: Found official website with clear product information
- `partial`: Found product mention but limited official information
- `unverified`: Only found third-party mentions

### Claim Type

Every extracted statement should also be labeled with `claim_type`:

- `fact`: directly supported by one or more sources.
- `inference`: reasoned synthesis from multiple facts, not directly stated by a source.
- `to_verify`: plausible but not sufficiently evidenced; must appear as a validation question or information gap.

Do not present `inference` or `to_verify` items as facts. Use wording such as "判断", "可推断", "可能", "建议验证".

### Missing vs Undisclosed vs Absent

For business and operation fields, distinguish lack of evidence from confirmed absence:

| Status | When to use | Required wording |
|--------|-------------|------------------|
| `undisclosed` | Public search/fetch results do not contain the information, or only mention it vaguely without details | `未披露` / `公开资料未披露` |
| `absent` | A reliable source explicitly says the product/vendor does not provide the item | `缺失：来源明确说明未提供...` |
| `unverified` | Third-party or weak source mentions the item, but no official/credible confirmation is found | `[unverified] ...` |
| `inference` | The conclusion is derived from multiple facts rather than directly stated | `推断：...，需验证` |

Do not write "没有", "不存在", or "不提供" merely because search results did not find evidence. Use `未披露` and add the item to `validation_questions`.

### Market Insights

Extract qualitative statements about:
- Market trends and growth
- Technology directions
- User preferences
- Competitive dynamics
- Market gaps and product opportunities
- Feature implementation patterns
- Pricing changes and campaign signals
- Risks, complaints, outages, or negative sentiment

Mark each insight with its source URL.

### Difference Panel Dimensions

Prepare normalized dimensions for `difference-panel`:

| Intent | Dimensions |
|--------|------------|
| `market_landscape` | market_positioning, target_users, core_capabilities, pricing_band, ecosystem, opportunity_gap |
| `feature_iteration` | entry_point, core_flow, automation_level, rules_permissions, data_feedback, user_feedback, known_pitfalls |
| `product_competition` | positioning, core_features, pricing_model, target_users, integrations, differentiation |
| `market_monitoring` | release_updates, pricing_changes, market_campaigns, negative_signals, risk_level, response_suggestion |

If `analysis_focus` includes `business_model` or `operation_playbook`, append these dimensions where relevant:

| Focus | Additional Dimensions |
|-------|-----------------------|
| `business_model` | monetization_path, billing_unit, sku_strategy, revenue_streams, ecosystem_economics, cost_risk |
| `operation_playbook` | acquisition_channel, retention_mechanism, rights_or_points_system, partner_operation, go_to_market_motion |
| `product_strategy` | strategic_positioning, mvp_path, validation_priority, defensibility |

## Deduplication

1. **By URL**: Keep only one result per URL, prefer the one with more content
2. **By product name**: Merge entries for the same product (case-insensitive match)
3. **By content**: Discard near-duplicate snippets (>80% similarity)

## Output Format

```json
{
  "products": [
    {
      "name": "string",
      "vendor": "string",
      "website": "string",
      "description": "string",
      "features": ["string"],
      "pricing": "string",
      "updates": ["string"],
      "risk_signals": ["string"],
      "sku_packages": ["string"],
      "billing_unit": "string",
      "target_customers": ["string"],
      "distribution_channels": ["string"],
      "operation_moves": ["string"],
      "revenue_streams": ["string"],
      "cost_constraints": ["string"],
      "ecosystem_roles": ["string"],
      "validation_questions": ["string"],
      "verification_status": "verified | partial | unverified",
      "sources": [{"url": "string", "title": "string"}]
    }
  ],
  "insights": [
    {
      "category": "string",
      "content": "string",
      "source_url": "string",
      "claim_type": "fact | inference | to_verify"
    }
  ],
  "difference_dimensions": [
    {
      "dimension": "string",
      "product": "string",
      "status": "领先 | 持平 | 缺失 | 未知",
      "evidence": "string",
      "source_url": "string",
      "uncertainty": "verified | partial | unverified"
    }
  ],
  "excluded": [
    {
      "name": "string",
      "reason": "string"
    }
  ]
}
```
