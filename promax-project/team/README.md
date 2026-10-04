# Promax 产品专家团（嵌入 dsh 的定制层）

面向产品经理的智能体团队：一个 Lead 按任务选最少的业务成员干活，成果经正式保存后如实交付。**当前阶段不挂 Judge**；Judge 接回的参考配置在 `headless-a` 与 `route-a`。

## 与通用智能体（wb 等）的差别：Judge（后续接入，当前阶段不挂载）

| | 通用智能体 | Promax 专家团 |
|---|---|---|
| 数字 | 模型写，模型自己看 | 程序算（`tools/facts.py`），Judge 用 `check_numbers.py` 逐项对照 |
| 引文 | 可能改写或张冠李戴 | `check_quotes.py` 逐字核对原文和编号 |
| 检查者 | 同一个模型自评 | 独立成员、全新上下文，看不到写手的自评 |
| 指控 | 可以凭印象说"有问题" | 指控必须引用被审文件里真实存在的原句，否则程序拒收 |
| 问题追踪 | 无 | 程序分配编号、跨轮次台账；复查逐项区分"已修复 / 撤回误判 / 仍未关闭"，漏回不关闭 |
| 结论 | 模型说完成就算完成 | 有阻断问题不能 PASS；交付说明只能按保存回执和检查结论说话 |

## 目录

```text
team/
├─ AGENTS.md            团队规则（Lead 编排 + 全员约束），经 dsh-home/AGENTS.md 全局注入
├─ members/             角色卡：6 个业务成员 + judge；Lead 创建成员时让其先读
├─ skills/              28 个业务技能，经 cordis.patch.yml 的 customSkillDirs 挂载
├─ tools/               facts.py（统计事实）、save.py（正式保存与回执）
└─ judge/
   ├─ tools/            check_numbers.py、check_quotes.py、issues.py（提交校验 + 台账 + 检查报告）
   ├─ rubrics.yml       领域规则：PRD、业务图、原型、客研/探索/用户分析/需求管理/需求评审报告
   └─ fixtures/         旧版 Judge 参考案例（后续做 Judge 回归评测用）
```

## 怎么嵌进 dsh（不改 dsh 源码）

| 机制 | dsh 原生能力 | 我们放了什么 |
|---|---|---|
| 成员形态 | dsh 原生 `dsh-tool-subagent`：每个成员一个具名工具，可各配模型 | `cordis.patch.yml` 的 insert 列表：6 个成员工具，`maxDepth: 1`，前台调用返回最终回复 |
| 团队规则 | `agent-instructions` 读取 `$DSH_HOME/AGENTS.md` | 软链到 `team/AGENTS.md`（路径不变，现役 profile 不再覆盖 `dshHome`） |
| 技能 | `skill-filesystem` 支持 `customSkillDirs` 与 `includeDefaultRoots: false` | `cordis.patch.yml` 关掉默认根目录，只挂 `team/skills`（防止个人技能泄露给业务 Agent） |
| 角色 | `dsh-tool-subagent` 的 `persona` 与 `agentOptions` | 角色卡文件，成员 persona 让成员先读角色卡；模型在 profile 里按成员指定 |
| 程序工具 | 成员都有 bash | `team/tools`，用绝对路径调用（Judge 工具当前阶段不挂载） |

## 已知限制

- 成员可单独指定模型（每个成员一个 `dsh-tool-subagent` 实例）；当前阶段 6 个业务成员都用 `deepseek-v4.1-flash`，Judge 未挂载。
- 成员是一次性子会话：跨轮不保留上下文，靠文件接续；成员共享同一个工作目录，没有文件锁。
- 飞书相关技能未接入凭据，只能 dry-run。
- 联网类技能（竞品抓取）只在用户允许联网时使用。
