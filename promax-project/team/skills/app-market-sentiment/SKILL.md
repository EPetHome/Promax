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

交付规则以本次冻结基准中 USER_ANALYSIS_REQUIRED_SECTIONS/NUMBER_TRACE/INFERENCE_BOUNDARY 为唯一合同。用户要求简洁评分报告时，仅交付评分分布与数据质量、主要反馈及record_id原文举例、3条待验证建议、必要限制和查看入口。以下完整分析产物按需求适用，不强制全做；不新增模板构成、全量ID清单、额外趋势或长篇真值表。计算/追溯明细使用程序结论关联与工具结果入口，正文不重复手工矩阵。材料版本替换先取程序变化事实，只修改受影响内容及必要关联，保留其余文本；不是新一轮全量报告。

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

### 阶段 1：冻结样本的确定性统计（STD-v0.1）

评分材料在首稿前由 Lead 运行 `python3 /Users/Admin/Desktop/Promax/promax-project/team/tools/facts.py <评分JSON> 交付/facts.json` 得到程序事实（总数、各星级、有效/无效、分子分母、比例、无效记录定位与来源哈希）；正文数字只引用 facts.json 并标事实编号，不靠模型逐条心算。v2 替换时对新旧两份各算一次 facts，按 record_id 对比变化后局部更新。Judge 使用同一份 facts.json 核对。输入非数组或字段不符时先明确格式，不默默改写原始材料；评分数字字符串不自动转换。零有效样本的比例为 null，不是 0%/100%。星级分组不是语义情感分类；主题/语义标签另注明模型判断来源。

### 阶段 1b：语义初筛（不代替上述精确计数）

以下脚本示例仅供独立开发环境参考，Promax受控任务内不执行；简洁评分任务直接依据获准文本做定性归纳，不新增全量语义频次统计。
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

> 在 dsh 中从运行目录（cwd）执行：`resources/` 指 `<team>/skills/app-market-sentiment/resources/`；输出写到 cwd 下的 `临时/`，不写 `/tmp` 或技能目录。

```bash
python3 resources/scripts/analyze_app_reviews.py \
  --input resources/examples/sample_reviews.json \
  --days 30 --output 临时/demo_sentiment.md
cat 临时/demo_sentiment.md   # 对照 examples/sample_output.md 检查
```
