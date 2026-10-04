---
context: fork
name: product-exploration
description: 产品探索 workflow 主技能。先进行意图判断，再面向产品经理编排竞品网页自动抓取、结构化报告生成和竞品差异面板输出。当用户提到竞品、产品立项、市场扫描、功能设计、功能迭代、动态监控、风险预警、vs、替代方案时自动触发。
---

执行前读取 `references/collection.md` 和 `references/platform.md`。使用统计由宿主 Hook 自动触发；不得手动运行 start/finish。按 collection.md 的业务结果合同交付真实产物。

**调用 ID：`product-exploration`；默认角色：`product_discovery`；版本：2.1.5。**

# Product Exploration

## Skill 名称
product-exploration

## Skill 目标
接收用户的自然语言查询，作为 workflow 入口先识别产品探索场景，再编排竞品网页抓取、结构化分析报告和竞品差异面板，交付可供产品经理判断与决策的竞品分析报告。

## 适用场景
- 产品立项与规划：扫描目标市场竞争格局，识别市场空白点和潜在机会。
- 产品功能设计与迭代：围绕特定功能点分析竞品实现方式、用户反馈、优劣势和已知坑点。
- 市场动态与风险预警：监控核心竞品版本更新、价格调整、市场活动、负面舆情等变化。
- 商业模式与运营玩法：调研厂商的收费模式、SKU/套餐、渠道入口、权益体系、生态分润、MVP 路径和待验证问题。
- 用户提到"竞品"、"vs"、"替代方案"、"市场分析"、"功能方案"、"动态监控"、"风险预警"等关键词。

## 不适用场景
- 用户需要的是产品使用教程或官方文档摘要，且不涉及竞品或市场探索。
- 用户需求是内部项目评审或代码 review。
- 用户要求直接做商业最终决策，而不是提供事实分析与候选方向。

## 输入要求
- 用户的自然语言查询（中英文均可）
- 可选：目标产品、竞品名单、目标市场、目标功能点、官网 URL、监控时间范围

## 仅分析提供材料

用户给了本地竞品 / 假想参照材料，或明确不联网时，在本 Skill 内分析这些材料，来源写文件位置和原始编号；不调用 crawler / search，不索要虚构网址。按任务所需调用 report-generator / difference-panel，不为凑完整流程重复生成。

矩阵中的未知、明确不支持分别标注。摘要逐项回查矩阵：个别对象的空白不写成共同空白；来源没证明的优势 / 缺陷不得升级成事实。


## 处理流程

### Step 0: Workflow 初始化
读取 `{baseDir}/references/workflow.md`，明确本次任务的执行路径、子技能调用顺序和输出要求。

### Step 1: 意图判断
读取 `{baseDir}/../competitor-web-crawler/references/intent_parser.md`，将查询解析为四种意图之一：

| 意图 | 关键词 | 分析重点 |
|------|--------|---------|
| market_landscape | market、行业、市场、立项、规划、机会、空白点 | 市场格局、玩家分布、机会点 |
| feature_iteration | 功能、方案、实现、迭代、会员积分、AI客服 | 竞品实现方式、用户反馈、坑点、最佳实践 |
| product_competition | vs、对比、竞品、替代、alternatives | 功能/定价/定位差异 |
| market_monitoring | 动态、监控、预警、更新、价格调整、舆情 | 版本、定价、活动、负面风险 |

如用户提到"商业模式"、"运营方案"、"玩法"、"变现"、"收费模式"、"增长"、"渠道"、"权益"、"生态"、"MVP"等，额外设置 `analysis_focus`：
- `business_model`：商业模式、收入来源、计费单位、套餐/SKU、分润机制。
- `operation_playbook`：市场运营、渠道入口、权益体系、增长动作、生态运营。
- `product_strategy`：MVP 路径、产品定位、验证问题和落地建议。

输出结构化 intent 对象，包含 `intent_type`、`target_market`、`target_product`、`competitors`、`feature_focus`、`monitoring_scope`、`analysis_focus` 和 `missing_inputs`。信息不足时先完成可执行部分，并在报告中标注缺口。

### Step 2: 按材料范围取证（仅需联网时抓取）
本地材料足够时跳过本步；只有需要且允许联网时，按 `competitor-web-crawler` 的方法在本技能内完成（这不是一次对该技能的调用；如需独立执行，由成员另行调用）：
- 读取 `{baseDir}/../competitor-web-crawler/references/search_strategy.md` 生成多维度查询。
- 使用 宿主当前可用的网页搜索工具 发现官网、功能页、定价页、更新日志、帮助中心、新闻稿和可信媒体来源。
- 对关键 URL 使用 宿主当前可用的网页读取工具 抓取正文。
- 按来源可信度、URL、产品名和内容相似度过滤去重。

### Step 3: 结构化报告生成
按 `report-generator` 的方法在本技能内完成（这不是一次对该技能的调用；如需独立执行，由成员另行调用）：
- 读取 `{baseDir}/../report-generator/references/data_cleaning.md` 清洗抓取结果。
- 读取 `{baseDir}/../report-generator/references/report_template.md` 选择场景模板。
- 若存在 `analysis_focus`，追加商业模式、运营玩法、MVP 建议和验证问题等增强章节。
- 生成完整 Markdown 竞品分析报告。

### Step 4: 竞品差异面板
按 `difference-panel` 的方法在本技能内完成（这不是一次对该技能的调用；如需独立执行，由成员另行调用）：
- 读取 `{baseDir}/../difference-panel/references/panel_template.md`。
- 生成以维度为行、竞品为列的差异面板。
- 标注 `领先`、`持平`、`缺失`、`未知`，并为每个判断绑定来源引用。

### Step 5: 输出
输出完整 Markdown 报告，必须包含：
- 执行摘要
- 研究范围与信息缺口
- 竞品差异面板
- 产品/市场/功能/动态分析章节
- 机会点与风险点
- 可供产品经理评估的行动建议
- References

汇报执行情况时，只把本次实际发生的 Skill 调用写成「调用」；按其他技能方法在本技能内完成的步骤，写成「本技能内完成」，不得写成调用了对应技能。

## 依赖资源
- `{baseDir}/references/workflow.md` — workflow 执行路径与意图路由规则
- `competitor-web-crawler` 子技能 — 自动抓取竞品网页
- `report-generator` 子技能 — 数据清洗与报告生成
- `difference-panel` 子技能 — 竞品差异面板
- `{baseDir}/../competitor-web-crawler/assets/sources.yaml` — 来源可信度配置

## 注意事项
- 证据优先：只收录有可验证来源的信息。
- 禁止编造：未抓取到的信息标注"未在搜索结果中找到"。
- 不确定信息标注 `[unverified]`。
- References 列出真实 URL 或本地文件与段号；未搜索时写“材料未说明”，不写“搜索未找到”。
- 对产品建议使用"可考虑"、"需验证"等措辞，不替用户做最终业务决策。
- 商业模式/运营玩法相关结论必须区分公开事实、策略推断和待验证问题。

## 示例调用

```text
Input:  "AI客服市场立项分析"
Intent: market_landscape
Output: 市场格局报告，包含主要玩家、机会点、风险点和竞品差异面板

Input:  "分析主流 SaaS 的会员积分体系怎么做"
Intent: feature_iteration
Output: 功能设计分析报告，包含竞品实现方式、用户反馈、优劣势、坑点和差异面板

Input:  "监控 Superhuman 最近价格和版本更新"
Intent: market_monitoring
Output: 市场动态与风险预警报告，包含更新、价格、活动、舆情和风险等级
```


---


## 本次任务输入

$ARGUMENTS
