---
context: fork
name: report-generator
description: 产品探索报告生成子技能。将提供的本地竞品材料或实际抓取的网页证据进行结构化清洗，按场景模板生成竞品分析报告。由 product-exploration
  主技能调用，也可独立使用。
---

执行前读取 `references/collection.md` 和 `references/platform.md`。使用统计由宿主 Hook 自动触发；不得手动运行 start/finish。按 collection.md 的业务结果合同交付真实产物。

**调用 ID：`report-generator`；默认角色：`product_discovery`；版本：2.1.5。**

# Report Generator

## Skill 名称
report-generator

## Skill 目标
接收竞品网页抓取结果，进行结构化清洗与产品信息提取，按产品探索场景选择模板，生成完整的 Markdown 竞品分析报告。

## 适用场景
- 主技能 product-exploration 完成网页抓取后调用
- 用户已有搜索或抓取结果数据，需要生成结构化报告
- 用户需要将零散的竞品信息整理为专业分析文档

## 不适用场景
- 用户只需要搜索结果列表（不需要分析报告）
- 用户需要的是 PPT 或 Word 格式的报告（本技能仅输出 Markdown）
- 输入材料与本次产品对比无关

## 输入要求
- `intent_type`：market_landscape / feature_iteration / product_competition / market_monitoring
- `target_product`：目标产品名称
- 证据：本地材料路径及原始编号，或 `crawl_results` 抓取结果；不为本地材料编造 URL / 抓取时间
- 可选：`target_market`、`competitors`、`feature_focus`、`monitoring_scope`、`analysis_focus`

## 处理流程

### Step 1: 数据清洗
读取 `{baseDir}/references/data_cleaning.md`，对抓取结果进行结构化处理：
- 提取产品信息：名称、厂商、官网、描述、功能列表
- 提取市场洞察：趋势、技术方向、用户偏好、竞争动态、机会点、风险信号
- 若 `analysis_focus` 包含 `business_model` 或 `operation_playbook`，额外提取：套餐/SKU、价格与计费单位、渠道入口、权益/积分、生态伙伴、客户类型、收入来源、成本/资源约束、运营动作、MVP 或验证问题
- 标注验证状态：verified（官网确认）/ partial（部分信息）/ unverified（仅第三方提及）
- 标注判断类型：fact（来源直接支持）/ inference（基于多个事实推断）/ to_verify（缺少硬证据）
- 按产品名与等价结论归并，保留各来源、不同限制和冲突；不只凭相似度丢弃证据

### Step 2: 模板选择
读取 `{baseDir}/references/report_template.md`，根据意图类型选择：
- `market_landscape` → 产品立项与市场格局报告模板
- `feature_iteration` → 功能设计与迭代报告模板
- `product_competition` → 竞争对比报告模板
- `market_monitoring` → 市场动态与风险预警报告模板

### Step 3: 内容填充
- 按模板结构逐章节填充清洗后的数据
- 所有结论标注来源引用 `[1]`、`[2]`
- 未取得证据写“未知 / 本次材料未说明”；只有来源明确说明不存在或不支持时才写“缺失”
- 不确定信息标注 `[unverified]`
- 商业模式与运营方案类报告必须区分"已公开事实"、"策略推断"和"待验证问题"
- 输出建议要写成"可考虑"、"建议验证"、"优先试点"，不得替用户做最终商业决策
- 为 `difference-panel` 子技能准备结构化维度数据

### 摘要与矩阵一致性

- 逐项核对摘要中的产品名称、能力、渠道和规则与证据矩阵一致。
- “共同能力 / 共同空白”须各对象均满足；仅一个对象的空白单列。
- 未找到证据写“未知 / 本次材料未说明”，不能据此断言厂商未披露或功能不存在。
- 实际已提供的能力与缺口分开，结论与依据就近排列，不重复铺长免责声明。


### Step 4: 质量检查
- 每个章节是否有内容（非空）
- 表格数据是否完整
- References 列表是否与正文引用一致
- 是否存在未标注来源的结论

### Step 5: 输出报告
返回完整的 Markdown 格式报告。

## 输出格式
三种报告模板的核心结构：

**产品立项与市场格局报告**：执行摘要 → 研究范围 → 竞品差异面板占位 → 市场概览 → 主要玩家 → 机会点与风险 → 建议 → 引用

**功能设计与迭代报告**：执行摘要 → 功能范围 → 竞品差异面板占位 → 竞品实现方式 → 用户反馈 → 坑点 → 最佳实践 → 引用

**竞争对比报告**：执行摘要 → 产品概览表格 → 功能对比矩阵 → 定价对比 → 差异化分析 → 推荐建议 → 引用

**市场动态与风险预警报告**：执行摘要 → 监控范围 → 竞品差异面板占位 → 更新动态 → 价格/活动变化 → 风险信号 → 响应建议 → 引用

若 `analysis_focus` 包含 `business_model` 或 `operation_playbook`，在对应模板中追加商业分析增强章节：

**商业模式与运营玩法增强报告**：执行摘要 → 主流玩法总览 → 厂商差异面板 → 重点厂商分析 → 市场运营方案 → 商业模式组合 → 机会/风险/验证问题 → MVP 建议 → 引用

详细模板参见 `{baseDir}/references/report_template.md`，示例输出参见 `{baseDir}/references/example_output.md`。

## 依赖资源
- `{baseDir}/references/data_cleaning.md` — 数据清洗规则与结构化提取标准
- `{baseDir}/references/report_template.md` — 三种报告模板定义
- `{baseDir}/references/example_output.md` — 完整示例报告

## 注意事项
- 不编造抓取结果中未出现的产品功能、定价、更新或风险
- 对未检索到的商业/运营信息，不得写成"没有"；写“本次未取得证据”，并说明需要继续验证
- 表格优先于段落（对比数据使用表格呈现）
- 保持客观中立，避免促销性语言
- 优劣势并重呈现
- 对商业模式、运营玩法、MVP 建议等非来源直接陈述内容，必须显式作为"判断"或"推断"表达，并说明证据基础
- 报告必须为差异面板保留 `## 竞品差异面板` 章节，由 `difference-panel` 子技能填充
- 引用编号必须与 References 列表一一对应

## 示例调用

```
Input:
  intent_type: "feature_iteration"
  feature_focus: "会员积分体系"
  crawl_results: [30+ 条去重后的抓取结果]

Output:
  # 会员积分体系竞品分析报告
  ## Executive Summary
  本报告分析主流产品在会员积分体系中的入口、规则、权益和反馈机制...
  ## 竞品差异面板
  [由 difference-panel 填充]
  ## 竞品实现方式
  ...
  ## References
  [1] ... [2] ...
```


---


## 本次任务输入

$ARGUMENTS
