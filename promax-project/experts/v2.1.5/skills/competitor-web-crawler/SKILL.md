---
context: fork
name: competitor-web-crawler
description: 竞品网页自动抓取子技能。根据产品探索意图生成检索策略，使用 宿主网页搜索能力 发现来源并用 网页读取能力 抓取关键网页，返回去重后的结构化网页证据。由
  product-exploration 主技能调用，也可独立使用。
---

执行前读取 `references/collection.md` 和 `references/platform.md`。使用统计由宿主 Hook 自动触发；不得手动运行 start/finish。按 collection.md 的业务结果合同交付真实产物。

**调用 ID：`competitor-web-crawler`；默认角色：`product_discovery`；版本：2.1.5。**

# Competitor Web Crawler

## Skill 名称
competitor-web-crawler

## Skill 目标
根据产品探索场景自动发现并抓取竞品网页，覆盖官网、功能页、定价页、更新日志、帮助中心、新闻稿、可信媒体和市场动态来源，为后续报告生成提供可追溯证据。

## 适用场景
- 主技能 `product-exploration` 需要搜集竞品网页证据。
- 用户需要自动抓取某产品或某市场的竞品网页。
- 用户需要围绕特定功能点收集竞品实现方式、价格、更新、活动或风险信号。

## 不适用场景
- 用户需要的是本地文件搜索。
- 用户明确要求不要联网搜索。
- 不涉及产品、市场、竞品或功能探索的通用搜索需求。

## 输入要求
- `intent_type`：market_landscape / feature_iteration / product_competition / market_monitoring
- `target_product` 或 `target_market`
- 可选：`competitors`、`feature_focus`、`monitoring_scope`、`source_urls`

## 处理流程

### Step 1: 查询生成
读取 `{baseDir}/references/search_strategy.md`，根据意图类型生成查询：

- **market_landscape**：市场格局、主要玩家、趋势、机会点。
- **feature_iteration**：目标功能点、竞品实现方式、帮助文档、用户反馈、坑点。
- **product_competition**：产品基础信息、功能、定价、替代方案、直接对比。
- **market_monitoring**：版本更新、价格调整、市场活动、新闻、负面舆情。

### Step 2: 来源发现
使用 宿主当前可用的网页搜索工具 逐条执行查询，每条收集 5-10 条结果。

优先保留：
- 产品官网、功能页、定价页、帮助中心、开发者文档
- 更新日志、release notes、blog、press/newsroom
- 权威科技媒体、行业报告、可信知识平台
- 中文场景下可将搜狗微信公众号文章搜索 `https://weixin.sogou.com/weixin` 作为补充发现渠道，用于发现公众号文章中的产品动态、案例、用户反馈和舆情信号

覆盖目标：
- 市场格局或开放式竞品研究场景下，目标识别 5 个核心竞品。
- 每个核心竞品尽量保留至少 3 个可信来源。
- 可信来源优先级：官方来源 > 权威媒体/行业报告 > 可信知识平台 > 弱信号来源。

### Step 3: 网页抓取
对以下关键 URL 使用 宿主当前可用的网页读取工具 抓取正文：
- 官网、功能页、定价页、更新日志、公告页
- 与目标功能点强相关的帮助中心或文档页
- 与风险预警相关的新闻、公告和可信媒体报道

如 `网页读取能力` 失败，保留 `web_search` 摘要并标注 `fetch_status: failed`。

### Step 4: 结果过滤
读取 `{baseDir}/assets/sources.yaml` 进行过滤：
- 排除搜索引擎页面、低质量聚合页和无关社交内容；搜狗微信搜索结果页仅作为发现渠道，不作为最终证据来源。
- 常规分析排除评论聚合站；功能反馈或风险预警场景下，仅在有明确证据价值时保留并标注 `[unverified]`。
- 优先保留官方来源和权威媒体来源。

### Step 5: 去重与结构化
- 按 URL 去重，保留正文更完整的结果。
- 按产品名合并，不区分大小写。
- 丢弃内容重复度 >80% 的条目。
- 为每条结果标注 `source_type`、`credibility_level`、`fetch_status` 和 `evidence_tags`。

### Step 6: 证据充分性检查
- 若核心竞品少于 5 个，执行补充检索。
- 若任一核心竞品可信来源少于 3 个，执行补充检索。
- 若补充检索没有新增高价值来源，停止检索并标注缺口。
- 最多执行 2 轮补充检索，避免无限搜索。

## 输出格式
```json
{
  "intent_type": "market_landscape | feature_iteration | product_competition | market_monitoring",
  "query_count": 8,
  "fetched_count": 12,
  "core_competitor_count": 5,
  "results": [
    {
      "title": "...",
      "url": "...",
      "source_domain": "...",
      "source_type": "official | pricing | docs | changelog | media | report | user_feedback",
      "credibility_level": 1,
      "snippet": "...",
      "fetched_content_summary": "...",
      "fetch_status": "success | failed | skipped",
      "evidence_tags": ["features", "pricing", "release", "risk"]
    }
  ],
  "excluded_count": 12,
  "deduped_count": 5,
  "coverage_gaps": [
    {
      "product": "...",
      "missing": "credible_sources | official_page | pricing | feature_page",
      "note": "..."
    }
  ]
}
```

## 依赖资源
- `{baseDir}/references/intent_parser.md` — 意图识别规则
- `{baseDir}/references/search_strategy.md` — 查询与抓取策略
- `{baseDir}/assets/sources.yaml` — 来源可信度与排除规则配置

## 注意事项
- 查询需中英双语并行，最大化覆盖率。
- 市场格局或开放式竞品研究默认目标为 5 个核心竞品。
- 每个核心竞品至少尝试收集 3 个可信来源；达不到时必须标注缺口。
- 对比场景中如有多个竞品名，必须分别抓取每个竞品的官网、功能页和定价页。
- 动态监控场景必须优先抓取更新日志、官方博客、新闻稿、定价页和可信媒体。
- 未抓取到正文的信息只能作为摘要级证据，不能做强结论。


---


## 本次任务输入

$ARGUMENTS
