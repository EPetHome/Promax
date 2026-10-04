---
context: fork
name: core-metrics-analysis
description: 核心业务指标趋势分析技能。当用户需要：(1) 分析DAU/MAU等规模指标趋势，(2) 分析上传/下载容量等价值指标变化，(3)
  检测量价背离等异常模式，(4) 进行同环比趋势监测和异常检测，(5) 生成指标诊断报告时，使用此技能。输入为核心业务指标数据（日活、月活、上传/下载用户数、上传/下载容量等）；输出为趋势分析报告、量价背离诊断、异常预警、归因推测。支持自动计算衍生关键比率（人均容量等）。
---

执行前读取 `references/collection.md` 和 `references/platform.md`。使用统计由宿主 Hook 自动触发；不得手动运行 start/finish。按 collection.md 的业务结果合同交付真实产物。

**调用 ID：`core-metrics-analysis`；默认角色：`user_analysis`；版本：2.1.5。**

# 核心业务指标趋势分析

## 按本次数据选择分析

提供普通业务统计、分子 / 分母与计算规则时，直接在本 Skill 内按原始口径复算和说明限制；不强求 DAU / MAU / 容量字段，也不套用未指定异常阈值。下方规模 / 价值指标输入与专用脚本仅适用于相应数据结构。

列出每项公式、统计对象、时间窗口、分子、分母和舍入位数；总体率仅在不重叠且可汇总时用分子之和 / 分母之和。分母为零写未定义，分组重复、缺失或窗口不明时说明限制。无法证明因果不能写成已证明“部分因果”，也不据此禁止设定未来效果目标。

### 走哪条路（按本次数据选一条，不要四条都读）

| 本次数据长什么样 | 用哪条命令 | 只读哪份参考 |
|---|---|---|
| 规模 / 价值指标（DAU/MAU/容量，≥7 天序列） | `--metrics … --period N` | `metrics_definition.md` + `anomaly_detection_rules.md` |
| 要诊断量价/量容背离 | `--analysis divergence` | `divergence_analysis_framework.md` |
| **普通业务统计 / 给了分子、分母与计算规则** | **`--analysis ratio`** | `metrics_definition.md`（只借口径写法） |
| 要出周期报告 | `--report-type weekly` | 同上 |

`resources/references/` 下三份参考**按上表只读需要的那份**，不要三份都读；`resources/examples/sample_output.md` 只在需要输出格式样例时才读。

🔴 **给出分子 / 分母与计算规则时，必须先用 `--analysis ratio` 复算，不得手算。**
脚本 stdout 的 `[OK]` / `[INFO]` 汇总行（含汇总校验、恒等式校验、精度校验）**就是复核凭据，直接引用即可**，不要另起一套手算再自证。
`--analysis ratio` 报错时，**按 `resources/examples/sample_ratio_data.json` 的输入契约修正数据 JSON**，不要绕过脚本改手算。

## 核心定位

在缺乏行为路径的情况下，通过"规模指标"（用户数）与"价值指标"（容量/流量）的交叉分析，诊断产品健康度与增长质量。

**一句话原则：规模×价值交叉诊断、量价背离必报、客观数据与推测归因分离呈现。**

## 输入

| 数据类型 | 说明 | 必填 |
|---------|------|------|
| 规模指标 | DAU、MAU、上传用户数、下载用户数 | ✅ |
| 价值指标 | 上传总容量、下载总容量 | ✅ |
| 历史数据 | 用于基线计算和趋势对比（≥7天） | 推荐 |
| 版本发布记录 | 用于指标异动归因 | 可选 |

数据格式参见 `resources/references/metrics_definition.md`。

## 输出

| # | 产物 | 必需字段 |
|---|------|----------|
| 1 | 趋势分析报告 | 同环比趋势、增长率曲线、趋势方向 |
| 2 | 量价背离诊断 | 背离类型、用户变化率、容量变化率、风险评估 |
| 3 | 异常检测报告 | 异常日期、数值、Z分数、异常类型 |
| 4 | 归因推测报告 | 指标异动与舆情/版本的关联分析（标注"推测"） |

## 边界

- ❌ 不做需求优先级裁定
- ❌ 不做PRD产出
- ❌ 不编造归因：归因推测必须标注"推测"并附证据
- ❌ 不直接对外交付

## 核心能力

### 指标体系定义与接入
- 规模指标（用户侧）：DAU/MAU、上传/下载用户数
- 价值指标（资源侧）：上传/下载总容量
- 衍生关键比率：人均容量 = 总容量 / 活跃用户数
- 功能渗透率：上传/下载用户数 / DAU

### 多维趋势分析
- 同环比趋势监测：日/周/月的环比(WoW, MoM)和同比(YoY)
- 异常检测：基于历史数据基线，识别非季节性异常波动（2σ/3σ规则）
- 量价/量容背离分析：
  - 用户涨 + 容量跌 → 警惕"水货用户"（新增用户多为低价值）
  - 用户跌 + 容量涨 → 警惕"大户依赖"（核心大客户使用加深）
  - 功能渗透率连续下降 → 功能边缘化风险

### 归因推测与报告
- 关联分析：将指标异动与舆情自动关联（标注"推测"）
- 周期性报告：日报、周报、月报自动生成
- 客观与推测分离：数据事实用陈述句，归因推测用"推测："前缀

## 工作流

### 阶段 0：输入检查
- 确认指标数据格式正确，字段完整
- 确认历史数据≥7天（异常检测需要）
- 标注缺失指标为"无数据"，不阻塞其他指标分析

### 阶段 1：脚本初筛
按上方路由表**选一条**，不要四条都跑：
```bash
# 分析核心指标趋势
python3 resources/scripts/analyze_core_metrics.py --input metrics.json --metrics dau,mau,upload_users,download_users,upload_capacity,download_capacity --period 30 --output report.md

# 量价背离分析
python3 resources/scripts/analyze_core_metrics.py --input metrics.json --analysis divergence --period 7 --output divergence_report.md

# 异常检测
python3 resources/scripts/analyze_core_metrics.py --input metrics.json --metrics all --detect-anomalies --threshold 2 --output anomalies.json

# 分子 / 分母复算（普通业务统计，给了计算规则；不得手算）
python3 resources/scripts/analyze_core_metrics.py --analysis ratio --input ratios.json --output ratio_report.md
```

### 阶段 2：LLM 深度分析
1. **背离复核**：对照 `resources/references/divergence_analysis_framework.md` 验证脚本背离判断
2. **异常归因**：将异常点与版本发布/舆情事件关联（标注"推测"）
3. **趋势研判**：综合多个指标判断整体健康度
4. **衍生指标计算**：人均容量、功能渗透率等衍生指标的健康度评估

### 阶段 3：质量自检
| 检查项 | 标准 |
|--------|------|
| 数据完整性 | 每个指标标注数据点数和缺失天数 |
| 背离验证 | 量价背离已交叉验证，非单一指标异常 |
| 归因标注 | 归因推测已标注"推测"并附证据 |
| 基线充分 | 异常检测使用≥7天历史数据 |
| 复算凭据 | 分子 / 分母类任务已用 `--analysis ratio` 复算，并引用脚本 `[INFO]` 汇总行（汇总 / 恒等式 / 精度校验）作为复核凭据 |

## 使用方式

```bash
# 分析核心指标趋势
python3 resources/scripts/analyze_core_metrics.py --input metrics.json --metrics dau,mau,upload_users,download_users,upload_capacity,download_capacity --period 30 --output report.md

# 量价背离分析
python3 resources/scripts/analyze_core_metrics.py --input metrics.json --analysis divergence --period 7 --output divergence_report.md

# 异常检测
python3 resources/scripts/analyze_core_metrics.py --input metrics.json --metrics all --detect-anomalies --threshold 2 --output anomalies.json

# 分子 / 分母复算（普通业务统计，给了计算规则）
python3 resources/scripts/analyze_core_metrics.py --analysis ratio --input ratios.json --output ratio_report.md

# 生成周期性报告
python3 resources/scripts/analyze_core_metrics.py --input metrics.json --report-type weekly --output weekly_report.md
```

## 资源

| 文件 | 用途 |
|------|------|
| `resources/references/metrics_definition.md` | 指标定义与计算规则 |
| `resources/references/anomaly_detection_rules.md` | 异常检测规则与算法说明 |
| `resources/references/divergence_analysis_framework.md` | 量价背离分析框架 |
| `resources/scripts/analyze_core_metrics.py` | 指标分析脚本 |
| `resources/examples/sample_metrics.json` | 示例指标数据 |
| `resources/examples/sample_ratio_data.json` | 分子 / 分母复算（`--analysis ratio`）的输入契约样例 |
| `resources/examples/sample_output.md` | 示例输出报告 |

## 快速验证

```bash
python3 resources/scripts/analyze_core_metrics.py \
  --input resources/examples/sample_metrics.json \
  --metrics dau,mau,upload_users,download_users \
  --period 30 --output /tmp/demo_metrics.md
cat /tmp/demo_metrics.md   # 对照 examples/sample_output.md 检查
```

---


## 本次任务输入

$ARGUMENTS
