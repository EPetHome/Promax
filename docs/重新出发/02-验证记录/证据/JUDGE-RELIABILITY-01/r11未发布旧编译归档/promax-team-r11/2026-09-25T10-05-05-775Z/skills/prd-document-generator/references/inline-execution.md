# Promax 内联方案生成

适用 PRD、业务图、原型及其组合。由当前 solution_design 在同一上下文执行，prd-document-generator 只加载一次；不要为每份文件重新调用生成 Skill 或启动子 Agent。直接调用业务图/原型入口时也在当前上下文继续，不再反向调用 PRD 入口。

## 输入与顺序

- 使用 bundle 已冻结的原始要求、manifest/SRC-*、员工确认规则、requested_artifacts、优先成果、实际本轮输出路径。只处理合同授权文件；缺材料报告具体缺口，不全盘搜索、不默认强制整套。
- 来源与业务规则整理一次，事实/已确认/假设/未知分开；未经员工确认的建议不写「已批准」。按任务目的先做主要成果：只要原型则先最小必要规则和原型，明确全套才继续补齐 PRD/业务图/原型。共享稳定 ID、状态、边界与页面操作，避免章节重复。
- 需要时读取 [业务图规范](../../business-diagram-generator/SKILL.md)、[原型规范](../../interactive-prototype-generator/SKILL.md)、[原型合同](../../interactive-prototype-generator/references/prototype-contract.md) 与已有模板，不再次调生成工具。

## 文件落盘即阶段回报

1. 写入 bundle 注入的本轮受控 `.任务/{task_key}/产物快照/{filename}`（只在任务未结算期间可写）；不直接写 `产物/{work_key}/{filename}`、工作卡、索引或对象库。程序负责版本/CAS/上报；旧版由程序冻结保留。
2. 每份真实非空文件落盘后回读确认，立即用原生 child-scoped `report({output:string})` 向直接父协调者回报（无接收方参数，不能给同级/任意成员派工）：阶段、filename、实际路径、可查看内容、草稿状态、checks、未决项、下一步。例如「PRD 已生成可查看；业务图继续；浏览器交互 not-run，默认链不启动浏览器」。不得等全部完成才报，也不把阶段回报当任务完成。宿主未提供 report 工具则在当前返回中保留阶段事实与工具缺口，不伪造回传成功。
3. 继续其余授权成果；结束时回传全部实际文件、逐项静态检查 pass/fail/not-run、实际证据、未验证项及接续位置，不以一句「完成了」冒充文件、Judge 或上传成功。无需外部回执 CLI、另建 run_id 或统计通道。

## 默认静态检查与兜底

- 对真实 HTML 在当前上下文运行现有 [audit_html.py](../../prototype-quality-audit/scripts/audit_html.py)，参数为实际 HTML 路径和 `--format markdown`；默认 stdout 回报，不往成果闭集外写审计文件。脚本不存在或解释器不可用就报告 not-run。
- 不调用 prototype-quality-audit 另开审计链，不启动 Playwright、agent-browser、Chrome CLI 或 promax_browser_evidence；浏览器交互统一 not-run/未验证。Mermaid 只用已存在的非浏览器解析器，缺少则语法机器校验 not-run。
- 静态检查只支持 STATIC PASS，不证明交互、视觉、响应式或无障碍实际通过；必需浏览器验收未做则整体部分完成，不能删验收项求成功。
- 能力缺失、执行失败、权限拒绝立即结束受影响步骤，不安装、不切换等价工具重试、不无限等待。已有成果先回传，可独立部分继续，依赖缺口待补。不临时复制业务逻辑写测试引擎自证正确。

## 局部修改

遵守成员 persona 的「冻结源版本与局部锚点修改」：以程序指定的 base_sha256 冻结源版本为基础，只改 heading/quote/page 锚点；返回实际变更位置及范围外变化。当前版本已变化时由程序拒绝提交并提示冲突，不能换基线覆盖人工修改。历史平铺成果和已结束任务快照只读，撤销/恢复由程序生成新版本，不删历史。Judge 按本次意见、实际变更、跨成果一致性与旧问题逐项复查，生成者不能自行关闭问题。
