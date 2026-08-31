---
name: app-market-sentiment
description: 应用市场舆情洞察与痛点挖掘技能。当用户需要：(1) 分析应用商店用户评论，(2) 识别版本发布后的舆情风险，(3) 从海量吐槽中提炼用户真实需求，(4) 生成痛点排行榜和版本趋势对比，(5) 检测爆发式负面舆情并预警时，使用此技能。输入为应用市场评论数据（App Store、应用宝、华为应用市场等）；输出为结构化舆情报告、痛点清单、紧急预警。支持多源评论自动采集、智能语义分析与去重、版本关联分析。
---

# 应用市场舆情洞察与痛点挖掘

## 核心定位

将海量、杂乱的用户评论转化为结构化的"产品改进需求清单"，实现版本发布后舆情监控，快速确认是否存在重大Bug或体验倒退。

**一句话原则：痛点归类有据、版本关联可溯、预警分级清晰、原文证据可查。**

## 输入

| 数据类型 | 说明 | 必填 |
|---------|------|------|
| 应用市场评论数据 | App Store、应用宝、华为应用市场、小米应用商店等 | ✅ |
| 版本发布记录 | 版本号、发布日期、更新内容 | 推荐 |
| 历史评论数据 | 用于趋势对比基线 | 可选 |

评论数据格式参见 `references/review_sources.md`。

## 输出

| # | 产物 | 必需字段 |
|---|------|----------|
| 1 | 结构化舆情报告 | 情感分析、问题聚类、版本趋势、预警级别 |
| 2 | 痛点排行榜 | 问题类别、出现频次、占比、典型原声、影响版本 |
| 3 | 紧急预警 | 预警级别(🔴🟡💡)、触发条件、影响范围、应对建议 |
| 4 | 版本对比报告 | 版本间负面率变化、新增问题、消失问题 |

## 边界

- ❌ 不做需求优先级最终裁定
- ❌ 不做PRD产出
- ❌ 不做竞品对标（移交产品探索智能体）
- ❌ 不编造数据：评论不足时标注"样本量不足"

## 核心能力

### 多源评论自动采集
- 增量监控：每日自动抓取新增评论，重点关注近7天和近30天
- 版本关联：自动识别评论对应的软件版本号
- 评分过滤：重点抓取1-3星低分评论，抽样4-5星中的建议部分
- 采集策略：1-2星100%采集，3星80%采集，4-5星20%抽样

### 智能语义分析与去重
- 负面情感识别：精准识别愤怒、失望、困惑等情绪（关键词初筛 + LLM语义复核）
- 问题聚类：语义归并（如"打不开""闪退""崩溃"归并为【稳定性-启动异常】）
- 热度排序：统计同类问题出现频次，按频次×严重度排序
- 版本趋势对比：分析问题是否随新版本发布而激增
- 痛点分类：按 `references/pain_point_taxonomy.md` 双维度分类

### 结构化输出与预警
- 痛点清单：问题类别、典型原声、影响范围、关联版本
- 紧急预警：爆发式负面舆情立即警报（对照 `references/alert_rules.md` 预警规则）
- 改进建议：匹配历史解决方案库或竞品做法

## 工作流

### 阶段 0：输入检查
- 确认评论数据格式正确，字段完整
- 确认版本发布记录（如有），标注缺失版本为"未知"
- 检查时间范围覆盖

### 阶段 1：脚本初筛
```bash
# 分析指定应用市场的评论
python3 resources/scripts/analyze_app_reviews.py --input reviews.json --days 7 --output report.md

# 版本对比分析
python3 resources/scripts/analyze_app_reviews.py --input reviews.json --version v2.5 --compare-version v2.4 --output version_compare.md
```

### 阶段 2：LLM 深度分析
1. **痛点复核**：对照 `references/pain_point_taxonomy.md` 对脚本初筛结果做语义修正
2. **情感校准**：修正关键词误判（如"不卡"被误判为负面）
3. **版本归因**：将痛点与版本发布时间关联，判断是否为新版本引入
4. **预警研判**：对照预警规则评定风险等级

### 阶段 3：质量自检
| 检查项 | 标准 |
|--------|------|
| 原声完整性 | 每条痛点附≥1条典型原声 |
| 版本标注 | 每条痛点标注关联版本 |
| 预警准确 | 预警级别与影响范围匹配 |
| 样本量标注 | 评论数<30时标注"样本量不足" |

## 使用方式

```bash
# 分析指定应用市场的评论
python3 resources/scripts/analyze_app_reviews.py --input reviews.json --days 7 --output report.md

# 批量分析多个应用市场（合并JSON文件）
python3 resources/scripts/analyze_app_reviews.py --input multi_source_reviews.json --days 30 --output report.md

# 版本对比分析
python3 resources/scripts/analyze_app_reviews.py --input reviews.json --version v2.5 --compare-version v2.4 --output version_compare.md

# 输出JSON格式（供下游程序消费）
python3 resources/scripts/analyze_app_reviews.py --input reviews.json --days 7 --output report.json --json
```

## 资源

| 文件 | 用途 |
|------|------|
| `resources/references/review_sources.md` | 应用市场数据源配置 |
| `resources/references/pain_point_taxonomy.md` | 痛点双维度分类体系 |
| `resources/references/sentiment_analysis_framework.md` | 情感分析框架与校准规则 |
| `resources/references/alert_rules.md` | 预警规则配置指南 |
| `resources/scripts/analyze_app_reviews.py` | 评论分析脚本 |
| `resources/examples/sample_reviews.json` | 示例评论数据 |
| `resources/examples/sample_output.md` | 示例输出报告 |

## 快速验证

```bash
python3 resources/scripts/analyze_app_reviews.py \
  --input resources/examples/sample_reviews.json \
  --days 30 --output /tmp/demo_sentiment.md
cat /tmp/demo_sentiment.md   # 对照 examples/sample_output.md 检查
```
