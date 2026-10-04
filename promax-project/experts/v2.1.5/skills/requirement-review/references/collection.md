# 使用统计与结果回执（2.1.5）

首次使用仍由使用者提供本人姓名、部门与可选工号；连接随包配置，不索要或展示密钥。采集身份、项目 / 任务标签、能力 ID、版本、起止时间、状态和产物文件名，不上传原始对话或文件正文。

## 两种真实执行方式

| 能力 | 执行 | 结束方式 |
|---|---|---|
| prd-document-generator、business-diagram-generator、interactive-prototype-generator | 内联，同一模型上下文继续工作 | 读取本 Skill 的 inline-execution.md；checkpoint 记录产物，complete 明确结束 |
| 其余 24 个业务 Skill | context: fork 独立执行 | 宿主 PostToolUse 核对 fork 完成回执和结尾 product-agent-result |
| product-agent、telemetry-tracker | 入口 / 查询 | 不登记业务执行 |

仍为 29 个 Skill、27 个可计数业务能力。产品方案整套生成默认一次内联调用，不为 PRD、图、原型分别伪造调用；阶段产物与检查存在同一运行记录中。读取专业规范不另计一次 Skill 执行。

## 共同身份与目录

- 每次实际 Skill 调用的 PreToolUse 分配 run_id / task_id / artifact_dir。必须使用本次 product-agent-context，不自造、预填或向用户索要 run_id。
- 若本次调用参数中没有 product-agent-context（宿主 Hook 未生效），不要搜索环境变量、文件或目录寻找 run_id / artifact_dir，也不要向用户索要；直接在当前任务工作目录完成业务并交付，结尾说明“本次统计未登记：未收到 product-agent-context”，不输出 product-agent-result 代码块，不为补登记反复尝试命令。
- args 传完整用户要求、材料绝对路径、交付范围、约束及 product-agent-task 标签；项目 / 任务 / 正式或测试原样传递。
- args 整体是纯文本：不要为了「结构化」把它包成 JSON 对象或数组，尤其不要把 product-agent-task 标签放进 JSON 字符串值——引号被迫转义后标签解析会失败，这次调用只能记为未登记。几行 `字段：值` 的纯文本即可，标签块紧随其后。允许的形状（标签块内 JSON 由 Hook 注入，这里只示意位置与纯文本形态）：

```
目标：应用市场舆情分析

输入：/Users/me/材料/舆情原始数据.xlsx；范围：近 30 天

约束：结论先行，不改动材料
<product-agent-task>
{"task":"应用市场舆情分析","project":"某应用市场","task_type":"客研","mode":"测试","task_id":"本次 Hook 注入值"}
</product-agent-task>
<product-agent-context>
{"run_id":"本次 Hook 注入值","artifact_dir":"本次 Hook 注入值","result_rules":"本次 Hook 注入值"}
</product-agent-context>
```

- 默认正式；明确的模拟测试且同意测试统计时用 mode=测试。任务文件只含 task、project、task_type、mode，可选 task_id；不写 run_id 或 artifact_dir。
- 成果只保存到本次 artifact_dir，不另存副本，不自行新建或拼接目录；用户在对话里明确给出交付目录的才另存一份。回执仅列本次 artifact_dir 内真实非空文件。父任务不能把子目录文件冒充自己的产物。
- 执行结果、业务验收、业务系统写入、统计回传分别说明。文件存在、已加载规范或生成成功不能替代业务验收。

## fork 业务结果

仅 fork 技能使用下面的结尾代码块；不得手动启动另一条 start/finish 记录。子调用同时传递任务标签与父 context，新 run_id 仍由新 Hook 分配。

```product-agent-result
{"run_id":"本次 Hook 注入值","status":"成功","artifacts":["本次 artifact_dir 内真实非空产物绝对路径"],"reason":""}
```

status 仅成功 / 失败 / 取消；失败或取消填写输入不足、生成失败、工具失败、校验失败、用户取消、上游失败或其他。成功至少有一份真实产物。完整交付审计报告可以表示执行成功，但报告结论仍可 FAIL / INCOMPLETE，不代表被审对象通过。

回执缺失、编号错误或输出目录不符时记待核验 / 异常，不把空的产物数量当没生成文件。宿主工具或业务失败仍记失败。不要为修统计重跑已有业务。

## 内联业务结果

内联 Skill 的 PostToolUse 只表示规范加载，运行状态保持运行中。执行者用本次 context.receipt_cli 的 checkpoint / complete 更新同一条记录；不等待网络。编号、目录、证据文件及 hash 由本地脚本核验，检查本身的正确性仍需实际执行证据。

每份成果记录阶段并即时回报主理人或用户；草稿可查看、任务执行状态和检查状态分别显示。脚本记录的 pass / fail / not-run 仅覆盖列出的检查，不能当成全局验收。

## 回传与兼容

本地记录由既有后台 worker 幂等补传，同一 run_id 只创建一行后续更新。安装器回传与业务调用仍分开，不因阶段回执新增安装事件或人员。

使用安装器实际输出的 runtime/hook.py status 查询：execution_mode、phase、checks、执行状态、delivery 与 record_id。只有 delivery=verified 才能声明该版本结果已回传；旧回执不会因升级而改写。网络失败保留本地事件，后续正常生命周期或显式 sync 补传。

prd-document-generator 保留稳定 ID，显示名为产品方案生成；旧汇总行可能保留 PRD 文档生成的标签，不影响按稳定 ID 聚合。对比耗时与次数应按版本和采集方式分组：一次整套方案执行不同于旧版三个独立生成调用。

强制取消、断电或执行者未调用 complete 时可能没有结束回执，保留未结束状态，不自动猜成功。应核对后用原 run_id 关闭，不重新生成整套成果来修统计。
