---
name: report-generator
description: 独立使用的产品探索报告技能。接收已备好的竞品数据文件，完成结构化清洗并按场景模板生成 Markdown 竞品分析报告。
---

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
- 输入数据不是竞品相关的搜索结果

## 输入要求
- `intent_type`：market_landscape / feature_iteration / product_competition / market_monitoring
- `target_product`：目标产品名称
- `crawl_results`：去重后的抓取结果数组（包含标题、URL、摘要、抓取正文、来源）
- 可选：`target_market`、`competitors`、`feature_focus`、`monitoring_scope`、`analysis_focus`

## 处理流程

### Step 1: 数据清洗
读取 `{baseDir}/references/data_cleaning.md`，对抓取结果进行结构化处理：
- 提取产品信息：名称、厂商、官网、描述、功能列表
- 提取市场洞察：趋势、技术方向、用户偏好、竞争动态、机会点、风险信号
- 若 `analysis_focus` 包含 `business_model` 或 `operation_playbook`，额外提取：套餐/SKU、价格与计费单位、渠道入口、权益/积分、生态伙伴、客户类型、收入来源、成本/资源约束、运营动作、MVP 或验证问题
- 标注验证状态：verified（官网确认）/ partial（部分信息）/ unverified（仅第三方提及）
- 标注判断类型：fact（来源直接支持）/ inference（基于多个事实推断）/ to_verify（缺少硬证据）
- 按产品名合并、按内容去重（>80% 相似度丢弃）

### Step 2: 模板选择
读取 `{baseDir}/references/report_template.md`，根据意图类型选择：
- `market_landscape` → 产品立项与市场格局报告模板
- `feature_iteration` → 功能设计与迭代报告模板
- `product_competition` → 竞争对比报告模板
- `market_monitoring` → 市场动态与风险预警报告模板

### Step 3: 内容填充
- 按模板结构逐章节填充清洗后的数据
- 所有结论标注来源引用 `[1]`、`[2]`
- 未找到公开证据的信息写"未披露"，并列入信息缺口或待验证问题；只有来源明确说明不存在时才写"缺失"
- 不确定信息标注 `[unverified]`
- 商业模式与运营方案类报告必须区分"已公开事实"、"策略推断"和"待验证问题"
- 输出建议要写成"可考虑"、"建议验证"、"优先试点"，不得替用户做最终商业决策
- 为 `difference-panel` 子技能准备结构化维度数据

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
- 对未检索到的商业/运营信息，不得写成"没有"；统一写"未披露"或"公开资料未披露"，并说明需要继续验证
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

## Promax 强制执行契约

本节优先于前文模板。报告只能汇总任务包不可变输入清单内的原始文件、`difference-panel` 已形成的可追溯证据和明确点名的前置最终产物；不得把模型常识或未抓取网页写成事实。统一使用 `SRC-*`、`E-*`，并区分事实、推断、机会假设与未知。

最终 `product_discovery.md` 固定为 0–9 节：0. 任务与闭集输入；1. 来源登记与口径；2. 竞品覆盖矩阵；3. 维度化差异面板；4. 关键差异及证据；5. 机会假设；6. 风险与反证；7. 边界真值表；8. 未验证项；9. 证据追溯矩阵。任何章节不得因无数据而删除。

边界真值表按“变量/规则谓词/边界前一点/边界点/边界后一点/实际代入/结论/E-*”填写；无可求值边界时明确写不适用及原因。

逐项自检：`PD-10` 章节顺序固定；`PD-11` 结论均有证据；`PD-12` 引文未脱离原意；`PD-13` 统计口径和时间窗明确；`PD-14` 机会未写成已证实需求；`PD-15` 反证和缺口未隐藏；`PD-16` 边界求值一致；`PD-17` References 与追溯矩阵一致。
