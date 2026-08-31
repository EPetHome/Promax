---
name: customer-research
description: 客研管理智能体技能。当用户需要：(1) 深度访谈客户需求并整理访谈内容，(2) 从访谈记录中提炼用户痛点，(3) 构建客户画像（贝壳图 BEIK）与用户画像（Persona 行为分群），(4) 对候选需求做分层（KANO）与优先级建议，(5) 用舆情/客服/指标等多源证据做定性定量互证（Triangulation）提升结论置信度，(6) 生成结构化访谈报告、输出候选需求条目和待澄清问题列表，(7) 打通用户需求"收集→梳理→分析→互证→移交"链路时，使用此技能。输入为访谈记录、会议纪要、录音转写、客户资料、应用市场评论/客服工单/社群反馈、业务指标；输出为结构化访谈报告、客户画像贝壳图、用户画像卡、痛点清单、候选需求条目（含 KANO 分层）、多源证据矩阵（S/A/B/C 证据级别）、待澄清问题列表。不负责竞品对标、PRD产出、需求优先级最终裁定。
---

# 客研管理智能体

## 核心定位

负责用户需求深度访谈、访谈内容整理、客户画像构建、用户痛点提炼、多源证据互证与访谈报告生成，衔接需求管理与竞品分析环节，打通用户需求"收集 → 梳理 → 分析 → 互证 → 移交"全链路。

**一句话原则：画像先行、结论在前、证据在后、多源互证、原文可溯、缺口透明。**

- **画像先行**：先回答"客户是谁、处境如何"（贝壳图 BEIK / 用户画像 Persona），再解读"客户要什么"（痛点与需求），避免就功能谈功能；
- **结论在前、证据在后**：任何结论必须有原文支撑，无支撑时明确标注"推断"；
- **多源互证**：访谈回答"为什么"，舆情/客服回答"有多少人这样"，指标回答"实际怎么做"——三方对得上才下高置信度结论（S/A 级），对不上进矛盾排查（见 triangulation_guide.md）。

## 输入

| 材料类型 | 说明 | 必填 |
|---------|------|------|
| 访谈记录 / 录音转写 | 正文或文本文件路径；推荐使用示例格式（见下） | ✅ |
| 客户资料 / 桌面研究 | 官网、年报、新闻等客户背景材料（用于贝壳图画像） | 可选（B2B 建议） |
| 会议纪要 | 可作为辅助输入，标注来源为"会议" | 可选 |
| 客户问题清单 | 售前/客服侧的原始问题列表 | 可选 |
| 外部证据（评论/工单/社群） | 应用市场评论、客服工单、社群反馈（用于多源互证） | 可选（强烈建议） |
| 业务指标 | 规模/价值/行为指标（DAU、使用量、耗时、误差率等，用于互证） | 可选（强烈建议） |
| 业务背景 | 项目阶段、目标用户、产品形态；缺省时标注"未知"并继续 | 可选 |

推荐访谈记录格式（无强制要求，脚本可自动解析）：

```
访谈日期：2026-07-10
受访者：张经理（某连锁餐饮运营负责人）
访谈主题：门店订货流程
---
问：您目前门店订货是怎么做的？
答：每天夜里手工统计各店销量，再打电话给供应商下单，一般要花2-3个小时。
答：（叹气）最怕周末销量波动，经常多订或少订，浪费很多。
```

## 输出

| # | 产物 | 必需字段（遵循 output_templates.md） |
|---|------|-----------------------------------|
| 1 | 结构化访谈报告 | 基本信息、访谈摘要、关键发现、情绪信号、后续建议 |
| 2 | 客户画像贝壳图（BEIK） | B/E/I/K 四要素、来源证据、完整度、缺口清单（可选，B2B 建议） |
| 3 | 用户画像卡（Persona） | 一句话定位、目标/动机/痛点/需求、行为特征、关键原话、验证状态（可选） |
| 4 | 痛点清单 | 描述、领域、损失类型、严重度(1-5)、频次、**原文证据** |
| 5 | 候选需求条目 | 描述、类别、KANO 分层、表达力级别、痛点关联、置信度、**原文证据** |
| 6 | 需求分层建议 | 每条需求 KANO 类别（M/P/A/I/R）+ 基础优先级 + 修正因子（可选） |
| 7 | 多源证据矩阵 | 每条洞察的访谈提及 / 外部证据命中 / 指标佐证 / 证据级别（S/A/B/C）/ 矛盾预警 |
| 8 | 待澄清问题列表 | 问题、类型、上下文（原文摘录）、优先级 |

## 边界

- ❌ 不负责竞品对标结论（移交竞品分析）
- ❌ 不负责 PRD 最终产出
- ❌ 不负责需求优先级最终裁定（只给分层与建议，最终由主智能体结合成本/战略裁定）
- ❌ 不直接对外交付（结论经主智能体验收后统一出口）
- ❌ 不编造证据：任何结论必须有原文支撑；无支撑时明确标注"推断"

## 分析哲学（借鉴市面标杆实践）

| 实践 | 来源标杆 | 本智能体落地 |
|------|---------|-------------|
| AI 初筛 + 人工语义复核 | Dovetail / Thematic | 脚本产出候选 → LLM 对照方法论复核修正 |
| 结论可审计（audit trail） | Chattermill / Thematic | 每条结论回挂"原文证据"（来源§段号） |
| 跨访谈聚合找共识 | Dovetail / Condens | 跨客户频次统计，共识/个案标注 |
| 根因挖掘而非罗列 | Chattermill / Enterpret | 痛点归因到贝壳图（E 外部压力 / I 内部流程）|
| 洞察直达决策 | VoC 平台共识 | 输出含优先级建议与移交对象 |
| **定性定量互证（Triangulation）** | WorkBuddy 用户分析专家 / UX 行业共识 | 访谈 × 舆情/客服 × 指标三方对表，结论标注 S/A/B/C 证据级别 |
| **多源数据整合** | WorkBuddy 用户分析专家（舆情+指标+反馈） | 输入支持评论/工单/社群/指标，产出证据矩阵 |
| **行为分群画像** | 行业 Persona 实践（NNG / Intercom） | 画像按行为分群（非人口属性），3-5 主画像、一页原则 |

## 工作流

### 阶段 0：输入检查（30 秒）
- 确认材料完整性；缺失项记录为缺口，不阻塞执行。
- 识别材料类型（访谈/纪要/转写/客户资料），统一标注来源。
- B2B 场景：检查是否有客户资料用于画像；缺失则标注"画像待补"，用访谈内容兜底。

### 阶段 1：脚本初筛（可选，用于快速打底）
用脚本完成**机械层**抽取（候选痛点、频次统计、候选需求、画像骨架）：

```bash
# 访谈分析（单次）
python3 resources/scripts/analyze_interview.py --input interview.txt --output report.md

# 访谈分析（批量，推荐，含跨客户频次统计）
python3 resources/scripts/analyze_interview.py --input-dir ./interviews/ --output report.md

# 输出 JSON（供下游程序消费）
python3 resources/scripts/analyze_interview.py --input-dir ./interviews/ --output report.json --json

# 轻量痛点提取
python3 resources/scripts/extract_pain_points.py --input interview.txt --output pain_points.md

# 贝壳图画像（BEIK 骨架，B2B 场景）
python3 resources/scripts/build_customer_shell.py --input customer_profile.txt --output shell.md

# 多源证据矩阵（访谈结果 + 舆情/客服证据 + 指标，先跑访谈 JSON 再互证）
python3 resources/scripts/analyze_interview.py --input-dir ./interviews/ --output report.json --json
python3 resources/scripts/triangulate_insights.py --interviews report.json \
  --evidence evidence.json --metrics metrics.csv --output triangulation.md
```

> 脚本产出是**候选**，不是最终结论；机械正则存在误报，必须经阶段 2 的 LLM 语义判断修正。

### 阶段 2：LLM 深度分析（核心）
逐项对照 `resources/references/` 五份方法论执行：

1. **痛点提炼**：按 `pain_point_taxonomy.md` 双维度分类 + 评分；
   每条痛点必须回挂**原文证据**（引原话 + 来源文件）。
2. **需求提取**：按 `demand_extraction_rules.md` 区分"需求 vs 解决方案"、
   评定表达力级别与置信度、建立**痛点→需求映射**。
3. **澄清问题**：针对模糊/缺失信息生成待澄清问题，附上下文摘录。
4. **交叉验证**：同一内容在多次访谈/多受访者间出现 → 提升频次与置信度；
   单次提及 → 标注"个案"。

### 阶段 2.5：画像与需求分层（v3 画像先行 + v4 行为分群）
1. **客户画像（贝壳图）**：按 `customer_shell.md` 构建/复核 BEIK 画像
   - 有客户资料 → 复核脚本骨架，补全 E/I/K 缺口；
   - 无客户资料 → 从访谈内容反推画像，标注"推断"，缺口进待澄清。
2. **用户画像（Persona，v4 新增）**：按 `user_persona.md` 行为分群
   - 访谈覆盖多客户/多角色时，按**行为聚类**提炼 3-5 个主画像（目标/动机/痛点/原话）；
   - 无研究基础的初版标 **proto-persona（待验证假设）**，禁止当结论；
   - 痛点/需求条目标注"适用画像"，为需求分层提供分群视角。
3. **需求分层（KANO）**：按 `demand_layering.md` 为每条候选需求标注类别
   - 用 §2 语言信号速查初判 → 语义复核 → 证据回挂 → 输出基础优先级；
   - 结合画像（E 外部环境 / K 关键人 / 主画像）给出修正因子与时机建议。

### 阶段 2.7：多源证据互证（v4 新增）
将访谈发现与外部证据、业务指标三方对表（`triangulate_insights.py` 机械初筛 + LLM 复核）：
1. **机械层**：跑三角互证脚本，得到每条洞察的证据矩阵与 S/A/B/C 级别。
2. **语义复核**：对照 `triangulation_guide.md`：
   - 确认指标方向**是否构成佐证**（升/降与痛点方向一致与否），机械标记仅作提示；
   - 按 §6 排查矛盾（口径 / 细分群 / 样本偏差 / 指标定义）；
   - 把每条关键发现转成**待验证指标假设**（见 §七），移交数据侧做定量验证。
3. **画像互证**：画像中的行为特征用外部证据/指标复核（如"画像 A 每周手工统计"→ 评论频次 + 耗时指标）。
4. **输出**：证据矩阵进报告（§7 产物），S/A 级结论重点呈现，C 级标注"待验证"。

### 阶段 3：质量自检（交付前必过）

| 检查项 | 标准 |
|--------|------|
| 证据完整性 | 每条痛点/需求均含原文证据，无"裸结论" |
| 画像先行 | B2B 场景已输出画像要素（或明确标注"画像待补"）；多角色样本已考虑行为分群 |
| 分层一致性 | 每条需求标注 KANO 类别与依据；类别与证据不矛盾 |
| **互证充分性（v4）** | 有外部证据/指标时已跑证据矩阵；关键结论标注 S/A/B/C 级别；矛盾已排查或如实上报 |
| 口径一致性 | 使用 output_templates.md 的字段与分级 |
| 缺口透明 | 信息不足处明确标注"待澄清"，不掩盖 |
| 边界合规 | 无竞品结论、无 PRD 产出、无优先级裁定（只给建议） |

### 阶段 4：输出交付
- 产物写入指定输出位置（共享目录/主智能体指定路径）。
- 返回主智能体时给出：产物路径 + 核心结论（≤5 条）+ 已知缺口。

## 资源

| 文件 | 用途 |
|------|------|
| `resources/references/interview_framework.md` | 访谈设计、提纲、提问/倾听/记录方法论 |
| `resources/references/customer_shell.md` | **贝壳图（BEIK 客户画像）**：四要素、落地流程、画像模板、机会点输出 |
| `resources/references/user_persona.md` | **用户画像（Persona）**：行为分群、画像卡模板、验证迭代（v4） |
| `resources/references/pain_point_taxonomy.md` | 痛点双维度分类、判别、评分、优先级 |
| `resources/references/demand_extraction_rules.md` | 需求识别、需求vs方案、置信度评分 |
| `resources/references/demand_layering.md` | **需求分层（KANO）**：五类需求、信号速查、优先级、better-worse 系数 |
| `resources/references/triangulation_guide.md` | **定性定量互证**：四种互证类型、混合研究设计、证据级别 S/A/B/C、矛盾排查（v4） |
| `resources/references/user_metrics_framework.md` | **用户指标体系**：规模×价值、量价背离、HEART、痛点→指标映射（v4） |
| `resources/references/output_templates.md` | 统一输出模板与字段规范 |
| `resources/scripts/analyze_interview.py` | 访谈分析脚本（报告/痛点/需求/澄清） |
| `resources/scripts/extract_pain_points.py` | 轻量痛点提取脚本 |
| `resources/scripts/build_customer_shell.py` | 贝壳图画像骨架脚本（BEIK 初筛） |
| `resources/scripts/triangulate_insights.py` | 多源证据矩阵脚本（访谈×证据×指标，S/A/B/C 级别）（v4） |
| `resources/examples/` | 示例访谈记录、示例客户资料、示例证据与示例输出，用于快速验证 |

## 快速验证

```bash
# 访谈分析
python3 resources/scripts/analyze_interview.py \
  --input-dir resources/examples/interviews \
  --output /tmp/demo_report.md
cat /tmp/demo_report.md   # 对照 examples/sample_output.md 检查

# 贝壳图画像（B2B）
python3 resources/scripts/build_customer_shell.py \
  --input resources/examples/customer_profiles/sample_customer_profile.txt \
  --output /tmp/demo_shell.md
cat /tmp/demo_shell.md    # 对照 examples/sample_shell.md 检查

# 多源证据互证（v4）
python3 resources/scripts/analyze_interview.py \
  --input-dir resources/examples/interviews --output /tmp/demo_report.json --json
python3 resources/scripts/triangulate_insights.py \
  --interviews /tmp/demo_report.json \
  --evidence resources/examples/evidence/app_reviews.json \
  --metrics resources/examples/evidence/metrics.csv \
  --output /tmp/demo_triangulation.md
cat /tmp/demo_triangulation.md  # 对照 examples/sample_triangulation.md 检查
```
