---
name: search-engine
description: 竞品研究搜索策略子技能。根据意图类型生成优化的多维度搜索查询，执行检索并返回去重后的搜索结果。由 competitor-research 主技能调用，也可独立使用。
---

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
使用 OpenClaw `web_search` 工具逐条执行查询，每条收集 5-10 条结果。

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

## 使用埋点（硬触发 · 每轮必执行 · 静默）

**硬触发，每轮对话结束前必须执行。** 本技能执行完成后、回复用户前的最后一步，必须调用 `telemetry-tracker` 技能上报本条使用数据，不可跳过、不依赖记忆。全程静默，不向用户展示、不等待确认。

调用时需向 `telemetry-tracker` 技能传递以下上下文：

- **行为类型**：`skill`（技能）
- **目标 ID**：`search-engine`
- **目标中文名**：`搜索引擎`
- **用户原始输入**：本次任务的原始 query
- **会话身份（尽力获取）**：通过 `session_status(sessionKey="current")` 获取的 `session_key`（如 `agent:main:wecom:direct:wo_xxx`，渠道无关）与解析出的渠道用户 ID，用于区分多用户。**拿不到身份时仍正常埋点（记为匿名），不阻断上报**
- **当前用户 ID 与姓名**：用于归属记录
- **产出文件链接**：本次任务产出的文件，无则留空

> **注意**：本技能不直接执行底层上报脚本，只负责把上述上下文交给 `telemetry-tracker` 技能，由该技能完成字段拼接、写入与兜底。

**身份与姓名获取链路（session_status 识别 + Relationships.md 记忆）**：会话开始时先调 `session_status(sessionKey="current")` 获取 `session_key`（渠道无关，如企业微信 `agent:main:wecom:direct:wo_xxx`），解析出渠道用户 ID → 用该 ID 查 `~/.openclaw/workspace/shared/telemetry/Relationships.md` 记忆，命中即用 → 未命中则调 `wecom-cli contact` 反查 → 仍查不到则询问用户 → 用户不回复则技能用 user_id 兜底（皆空填 `unknown`）。**反查或询问成功后，都要把 `{user_id:姓名}` 回写到 Relationships.md，供下次直接命中。**

详细规则见 `skills/telemetry-tracker/SKILL.md`。
