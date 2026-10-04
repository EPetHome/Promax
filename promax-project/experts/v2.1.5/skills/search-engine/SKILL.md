---
context: fork
name: search-engine
description: 竞品研究搜索策略子技能。根据意图类型生成优化的多维度搜索查询，执行检索并返回去重后的搜索结果。由 competitor-research
  主技能调用，也可独立使用。
---

执行前读取 `references/collection.md` 和 `references/platform.md`。使用统计由宿主 Hook 自动触发；不得手动运行 start/finish。按 collection.md 的业务结果合同交付真实产物。

**调用 ID：`search-engine`；默认角色：`product_discovery`；版本：2.1.5。**

# Search Engine

## Skill 名称
search-engine

## Skill 目标
根据竞品分析的意图类型，生成高质量的中英双语搜索查询，执行检索，返回去重、过滤后的结构化搜索结果。

## 适用场景
- 主技能 competitor-research 需要检索竞品信息时调用
- 用户只想优化某产品的搜索查询策略
- 需要根据产品名生成多维度检索查询

## 不适用场景
- 用户需要的是本地文件搜索
- 搜索目标是社交媒体内容或实时新闻追踪
- 不涉及竞品分析的通用搜索需求

## 输入要求
- `intent_type`：market_analysis / product_deep_research / product_competition
- `target_product`：目标产品名称
- 可选：`secondary_product`（对比场景中的第二个产品，如 "Superhuman vs Front" 中的 "Front"）

## 处理流程

### Step 1: 查询生成
读取 `{baseDir}/references/search_strategy.md`，根据意图类型生成查询：

- **market_analysis**：市场概览 → 主要厂商 → 趋势洞察（6-8 条查询）
- **product_deep_research**：产品基础 → 功能特性 → 技术商业 → 用户反馈（6-8 条查询）
- **product_competition**：产品了解 → 竞品搜索 → 直接对比（6-8 条查询）

### Step 2: 查询优化
- 产品信息查询优先于竞品查询
- 竞品搜索使用英文关键词（alternatives, competitors, similar tools）
- 避免使用元关键词（"竞品分析"、"competitive analysis"本身）
- 包含当前年份以获取最新信息

### Step 3: 执行检索
使用 宿主当前可用的网页搜索工具 工具逐条执行查询，每条收集 5-10 条结果。

### Step 4: 结果过滤
读取 `{baseDir}/assets/sources.yaml` 进行过滤：
- 排除社交媒体（twitter, facebook, reddit, linkedin）
- 排除评论聚合站（g2, capterra, trustpilot）
- 排除搜索引擎页面（google.com/search）
- 优先保留可信来源（官网 level:3、科技媒体 level:2）

### Step 5: 去重
- 按 URL 去重，保留内容更丰富的结果
- 按产品名合并（不区分大小写）
- 丢弃内容重复度 >80% 的条目

### Step 6: 返回
返回去重后的搜索结果列表，包含：标题、URL、摘要、来源域名。

## 输出格式
```json
{
  "query_count": 8,
  "results": [
    {
      "title": "...",
      "url": "...",
      "snippet": "...",
      "source_domain": "...",
      "credibility_level": 1-3
    }
  ],
  "excluded_count": 12,
  "deduped_count": 5
}
```

## 依赖资源
- `{baseDir}/references/intent_parser.md` — 意图识别规则
- `{baseDir}/references/search_strategy.md` — 搜索查询模板
- `{baseDir}/assets/sources.yaml` — 可信来源与排除规则配置

## 注意事项
- **搜索预算：本次调用合计最多 8 次网页搜索**，由宿主计数，第 9 次起会被拒绝。预算不按竞品数、批次或维度倍增；上游参数写的条数超过 8 时也按 8 执行。先用合并查询覆盖多家竞品，再用剩余次数补关键缺口；搜不到的写入「未找到」，不因预算用完而编造。
- 查询需中英双语并行，最大化覆盖率
- 对比场景（product_competition）中如有第二个产品名，需单独搜索该产品信息
- 查询间需顺序执行，避免触发搜索 API 频率限制
- 产品名提取时需去除后缀修饰词（功能、特性、优势、分析等）

## 示例调用

```
Input:
  intent_type: "product_competition"
  target_product: "Superhuman"
  secondary_product: "Front"

Generated queries:
  1. "Superhuman what is overview"
  2. "Superhuman features pricing review"
  3. "Superhuman alternatives best 2026"
  4. "Superhuman competitors top similar tools"
  5. "best Superhuman alternatives comparison"
  6. "Superhuman vs Front comparison"
  7. "Front features pricing review"
  8. "Superhuman Front which is better"

Output: 去重后的 30+ 条搜索结果，已排除低质量来源
```


---


## 本次任务输入

$ARGUMENTS
