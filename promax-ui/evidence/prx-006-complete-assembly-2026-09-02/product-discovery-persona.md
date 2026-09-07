# product-discovery persona 对照报告

原版来源 [O]：`/Users/Admin/Desktop/IDaaS/调研/docs/智能体产品平台/skill迭代/docs/product-agent_20260826/product_discovery/AGENTS.md`，具体对照“产品探索智能体”“行为规范”“核心场景”“启动流程”“工具使用规则”“红线”“输出规范”“协作方式”。

当前来源 [C]：`/Users/Admin/Desktop/Promax/promax-agent/team-harness/modules/product-discovery/agent-module.yml`，具体对照 `spec.base_persona` 第 12–16 行、7 个 `skill_refs` 第 17–24 行和固定产物第 30–34 行。

## 删除的 Promax 限制

- 删除旧 Promax persona 的“不自行联网补采/本步没有网页抓取能力”限制：原版 [O]“工具使用规则”把 `web_search`、`web_fetch` 都列为必需；当前 [C] 第 12–16 行恢复中英文检索、官网/定价/更新日志等页面抓取和失败摘要留存。
- 删除只接收既有材料、不能完成完整竞品探索链路的裁剪：原版 [O]“启动流程/协作方式”要求入口 Skill 编排抓取、清洗、报告和差异面板；当前 [C] 第 14 行及第 18–24 行恢复全部对应 Skill。

## 保留的原版纪律

- 原版 [O]“红线”规定禁止编造、禁止无来源引用、不确定项标 `[unverified]`、抓取结果先去重清洗；当前 [C] 第 14 行逐项保留。
- 原版 [O]“输出规范”要求结构化 Markdown、维度化差异面板、完整 References 和中英文查询；当前 [C] 第 12、14、16 行保留这些输出纪律。
- 原版 [O]“行为规范”中的后台执行、缺口透明、结论在前证据在后，在当前 [C] 第 12 行保持不变。

## 最终差异

- 当前 [C] 相对原版 [O] 新增确定性证据链：成功正文和仅摘要失败材料都写入 manifest，记录 URL、时间、状态、HTTP 状态和 SHA256；业务结论必须回指 `SRC-*`。
- 当前 [C] 把产物固定为 `deliverables/{task_key}/product_discovery.md`，并在进入独立 Judge 前由 runtime gate 校验联网 SRC 回指；原版 [O] 的搜索、抓取和分析能力没有因此收缩。
