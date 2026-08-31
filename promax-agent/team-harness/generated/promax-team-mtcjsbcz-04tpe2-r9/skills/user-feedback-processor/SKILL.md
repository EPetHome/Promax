---
name: user-feedback-processor
description: 用户反馈结构化处理技能。当用户需要：(1) 整合分散在客服记录、应用商店、社群、问卷等渠道的用户反馈，(2) 对海量反馈进行清洗、去重、归类，(3) 提取用户痛点和需求，(4) 生成结构化反馈清单时，使用此技能。输入为多渠道用户反馈数据（客服记录、社群消息、问卷结果、应用商店评论等）；输出为结构化反馈清单、痛点分类、情感分析结果、典型原声摘录。支持自动去重、语义聚类、情感分析。
---

# 用户反馈结构化处理

## 核心定位

整合分散在客服记录、应用商店、社群、问卷等各个孤岛的用户反馈，进行结构化整理及归类，实现全局高效把控。

**一句话原则：多源整合、去重归并、分类有据、原文可溯、缺口透明。**

## 输入

| 数据类型 | 说明 | 必填 |
|---------|------|------|
| 客服记录 | 工单、聊天记录、电话录音转写 | 至少1种 |
| 社群反馈 | 微信群、QQ群、Discord、Slack等 | 至少1种 |
| 问卷数据 | NPS、满意度调查、功能需求调研 | 至少1种 |
| 应用商店评论 | 详见 app-market-sentiment skill | 可选 |
| 其他渠道 | 邮件、论坛、社交媒体等 | 可选 |

数据格式参见 `references/feedback_sources.md`。

## 输出

| # | 产物 | 必需字段 |
|---|------|----------|
| 1 | 结构化反馈清单 | 分类标签、情感分析、典型原声、来源渠道 |
| 2 | 痛点分类报告 | 功能缺陷、体验不佳、价格争议、客服态度、竞品对比 |
| 3 | 需求提取清单 | 明确需求、潜在需求、改进需求 |
| 4 | 反馈趋势分析 | 时间维度上的反馈变化趋势 |

## 边界

- ❌ 不做需求优先级最终裁定
- ❌ 不做PRD产出
- ❌ 不编造反馈：数据不足时标注"样本量不足"
- ❌ 不直接对外交付

## 核心能力

### 多源数据整合
- 统一数据格式：将不同渠道的反馈数据标准化（统一字段定义）
- 去重处理：基于内容相似度（Jaccard系数 > 0.8）+ 用户去重（同用户24h内相同问题）
- 时间对齐：按时间维度整合各渠道数据
- 渠道标识：每条反馈标注来源渠道

### 智能语义处理
- 情感分析：正面、负面、中性、愤怒四级情感识别（关键词初筛 + LLM语义复核）
- 意图识别：投诉、建议、咨询、表扬四类意图分类
- 主题聚类：按 `references/classification_taxonomy.md` 自动归类
- 关键词提取：识别高频问题和热点话题

### 结构化输出
- 反馈卡片：单条反馈的结构化展示（内容、渠道、情感、意图、分类）
- 汇总报告：按分类、渠道、时间维度的统计
- 趋势图表：反馈量、情感分布、主题占比的变化
- 痛点清单：按频次×严重度排序，附典型原声

## 工作流

### 阶段 0：输入检查
- 确认反馈数据格式正确，字段完整
- 识别渠道来源，统一标注
- 标注缺失渠道为"无数据"，不阻塞其他渠道分析

### 阶段 1：脚本初筛
```bash
# 处理单渠道反馈
python3 resources/scripts/process_feedback.py --input customer_service.csv --channel cs --output feedback_report.md

# 批量处理多渠道反馈
python3 resources/scripts/process_feedback.py --input multi_channel.json --output unified_report.md

# 提取痛点和需求
python3 resources/scripts/process_feedback.py --input feedback.csv --extract-pain-points --output pain_points.md
```

### 阶段 2：LLM 深度分析
1. **分类复核**：对照 `references/classification_taxonomy.md` 对脚本初筛结果做语义修正
2. **情感校准**：修正关键词误判（如否定句"不好用"vs"不卡"）
3. **意图识别**：区分投诉/建议/咨询/表扬，标注意图类型
4. **需求提取**：从反馈中提取明确需求、潜在需求、改进需求
5. **交叉验证**：同一问题在多渠道出现 → 提升置信度

### 阶段 3：质量自检
| 检查项 | 标准 |
|--------|------|
| 原声完整性 | 每条痛点附≥1条典型原声 |
| 渠道标注 | 每条反馈标注来源渠道 |
| 去重验证 | 重复反馈已合并，标记重复次数 |
| 样本量标注 | 反馈数<50时标注"样本量不足" |

## 使用方式

```bash
# 处理单渠道反馈
python3 resources/scripts/process_feedback.py --input customer_service.csv --channel cs --output feedback_report.md

# 批量处理多渠道反馈
python3 resources/scripts/process_feedback.py --input multi_channel.json --output unified_report.md

# 生成反馈趋势分析
python3 resources/scripts/process_feedback.py --input feedback_data/ --trend-analysis --period 30 --output trend_report.md

# 提取痛点和需求
python3 resources/scripts/process_feedback.py --input feedback.csv --extract-pain-points --output pain_points.md

# 输出JSON格式（供下游程序消费）
python3 resources/scripts/process_feedback.py --input feedback.csv --output report.json --json
```

## 资源

| 文件 | 用途 |
|------|------|
| `resources/references/feedback_sources.md` | 反馈渠道配置指南 |
| `resources/references/classification_taxonomy.md` | 反馈分类体系 |
| `resources/references/sentiment_analysis_guide.md` | 情感分析指南与校准规则 |
| `resources/scripts/process_feedback.py` | 反馈处理脚本 |
| `resources/examples/sample_feedback.json` | 示例反馈数据 |
| `resources/examples/sample_output.md` | 示例输出报告 |

## 快速验证

```bash
python3 resources/scripts/process_feedback.py \
  --input resources/examples/sample_feedback.json \
  --output /tmp/demo_feedback.md
cat /tmp/demo_feedback.md   # 对照 examples/sample_output.md 检查
```

## Promax 强制执行契约

只处理不可变输入清单中的反馈文件；脚本输出是机械中间结果，不是新增事实源。来源编号 `SRC-*`，原始反馈/证据编号 `E-*`。输出固定为：0. 输入与样本；1. 清洗规则；2. 去重记录；3. 分类口径；4. 结构化反馈；5. 痛点与需求候选；6. 反例与冲突；7. 边界真值表；8. 缺失与未验证；9. 追溯矩阵。

边界覆盖时间窗、最小样本、去重相似度等实际输入规则；没有给定阈值时不得自创。逐项自检：`UA-01` 样本边界明确；`UA-02` 原文可追溯；`UA-03` 去重不删除反例；`UA-04` 评论不外推总体；`UA-05` 候选需求不写成定案；`UA-06` 边界已代入或不适用。
