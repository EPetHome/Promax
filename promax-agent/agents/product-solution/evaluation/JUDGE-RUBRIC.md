# 产品 Agent 独立 Judge 契约

本文件描述在线放行 Judge，不再承担离线评测报告模板。Judge 是 `independent-judge@1` AgentModule：只判定，不生成业务产物、不替 worker 修复，也不读取团队推理过程。

## 1. 判定输入

Judge 每次只读取：

1. 用户原始输入及用户明确提供的原始附件；
2. 本轮待放行的最终业务产物；
3. TeamRevision 产物声明解析出的 `artifact_kind`；
4. `team-harness/catalogs/rubrics.yml` 按 `artifact_kind` 精确匹配出的领域规则。

Judge 不读取或采信 `source-ledger.md`、Agent 对话、推理过程、中间分析、草稿、委派/结算记录、工具日志、既有验收报告或生成 Agent 的自评。缺少原始输入、最终产物、`artifact_kind`，或 `prd/diagram/prototype` 缺少对应领域规则时，判为 `BLOCKED_CONFIG`，不得猜测或放行。

## 2. 五项通用检查

五项逐项独立判定为 `pass` 或 `fail`，不得合并成一个分数；优先检查第 ⑤ 项。

| # | 检查 | 缺陷类型 | fail 必须附带的证据 |
|---|---|---|---|
| ① | 无来源断言 | `FABRICATED` | 产物原文与位置、输入检索范围及“无此内容” |
| ② | 类别标注正确 | `MISLABELED` | 产物原文与位置、现标类别、应标类别及依据 |
| ③ | 输入硬信息保留 | `DROPPED` | 输入原文与位置、最终产物检索结果 |
| ④ | 输入矛盾已处理 | `INPUT_CONTRADICTION_UNHANDLED` | 输入冲突双方原文与位置、产物未阻断或选边的位置 |
| ⑤ | 产出无自相矛盾 | `OUTPUT_SELF_CONTRADICTION` | 同一产物的位置 A、位置 B、具体代入验证过程 |

检查范围收窄为可逐字核对的业务硬信息：数字、字段名、枚举、明确约束、业务规则、现状描述和明确要求。过渡句、标题、格式文字，以及已经清楚标成建议、推测、设计选择或测试夹具的内容，不按 `FABRICATED` 处理。

报不出规定证据结构的怀疑不构成有效缺陷，该项判 `pass`；不接受“感觉不严谨”“建议优化”等模糊意见。

### A1 固定代入

数量变化一律先算 `after = before + delta`，上限 N 的允许条件是 `after <= N`。`delta=1` 时等价的操作前条件是允许 `before < N`、拒绝 `before >= N`。

对 A1（N=2、delta=1）固定核对：

| before | delta | after | after <= N | 分支 |
|---:|---:|---:|:---:|---|
| 1 | 1 | 2 | true | 允许 |
| 2 | 1 | 3 | false | 拒绝 |
| 3 | 1 | 4 | false | 拒绝 |

表达式、布尔值、图的边标签、代码判断或可见反馈任一不一致，按 `OUTPUT_SELF_CONTRADICTION` 报告；同时命中领域规则时，可并列记录领域缺陷，但不能用分数互相抵消。

## 3. 领域规则选择

领域规则的唯一来源是 `team-harness/catalogs/rubrics.yml`。选择键来自生产者 AgentModule 的 `spec.artifacts[].kind`，不是用户自由填写：

- `prd` → PRD 领域规则；
- `diagram` → 业务流程图领域规则；
- `prototype` → 单 HTML 原型领域规则；
- 其他类型 → 只做五项通用检查。

领域规则只收录能从原始输入和最终产物逐字比对、定位的检查；“洞察不够深”“意见不够有建设性”等主观质量不进入放行门。

## 4. 放行与纠正闭环

三条硬规则：

1. 任一通用项或领域项 `fail` 就不放行，不设“缺陷不超过几处可放行”的阈值；
2. 缺陷必须带位置和原文退回原 worker，最多修复两轮；
3. 两轮后仍失败，或 worker 带反证申诉，必须停下交给人，不能静默放行。

Judge 自己不修改业务产物。worker 申诉必须提供可定位反证；收到有效申诉后 Judge 写 `APPEALED`，不触发重做，直接等待人工裁决。人工强制放行必须另行留痕，不能改写为“Judge 通过”。

## 5. 报告格式

报告只写入 `.promax/judge/<task-key>/judge.md`，不得进入 `deliverables/`：

```markdown
# Judge 判定

- 原始输入：
- artifact_kind：
- 最终产物：
- 判定轮次：0 / 1 / 2
- verdict：pass / fail / BLOCKED_CONFIG / APPEALED / HUMAN_REQUIRED

## 通用检查
## 领域检查
## 有效缺陷与逐字证据
## 申诉反证
## 隐藏诊断分（0–4，仅存档，不展示、不参与放行）
```

一次调用可以同时产生二元结论与诊断分；对用户只展示缺陷类型、数量、位置和闭环状态，不能展示分数，也不能以分数覆盖二元 fail。
