# PRX-006 独立代码核查 · 第 1 轮

日期：2026-09-02

结论：机验不通过，不进入 `user-check`，不合并。本文只记录代码、git、测试、静态产物和当前安装文件系统中可只读判真的事实；未启动 3080 / 3090 / 3100，未创建业务会话，未读取或写入真实凭据，未调用真实飞书。

## 启动闸门与版本锚点

- `status.py` 退出码为 1（WARN，不是禁止继续的 exit 2）。它确认 PRX-006 为 `reviewing`、两仓同名分支均存在且有实现提交；两条警告分别是 required_context 中旧 definition 路径已不存在，以及 Agent 工作区脏。
- 独立执行 `git status --short` 后，Agent 只有基线既存的 `?? evidence/`，GUI 干净，符合本任务启动例外。
- Agent 增量：`ff563af3189d91800172f126b8f08f69d6f8fcf5..eba68f8ad5dd32cc6877ebdf8c5bb7349898d757`，1 个提交；`diff --stat` 为 1017 files changed、14419 insertions、139180 deletions，退出码 0。
- GUI 增量：`0e60889d9d3e61a944f756c21cc73588d8c33b47..bc81ddbcc895b22da8d6ddf5179e546ce26c8d06`，1 个 PRX-006 提交；`diff --stat` 为 24 files changed、2268 insertions、78 deletions，退出码 0。
- `promax-agent/deepseek-harness` 为干净的 detached `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`；后端工作区干净，本轮未写后端。

## 指定命令结果

| 检查 | 退出码 | 关键结果 |
| --- | ---: | --- |
| Agent `npm test` | 0 | 41 / 41 通过 |
| Agent `node src/cli.mjs catalog` | 0 | 9 modules、28 skills、21 rubrics、3 recipes |
| Agent `validate` | 0 | definition valid，7 个 enabled members（另有 coordinator，总成员 8） |
| Agent 临时目录首次 `compile` / `verify` | 0 / 0 | 固定目录 `promax-team`，verify valid，137 files |
| Agent 临时目录 overwrite `compile` / `verify` | 0 / 0 | 先归档再覆盖，verify valid，137 files |
| GUI `pnpm typecheck` | 0 | 通过 |
| GUI `pnpm test` | 0 | 20 files、104 / 104 通过 |
| GUI `pnpm build` | 0 | 通过 |
| GUI `pnpm package:dist` | 0 | 通过，生成脱敏分发 tgz |
| 两仓 `git diff --check` | 0 / 0 | 无 whitespace error |
| 任务文件列出的 7 条静态数量/残留断言 | 全部 0 | 9 顶层模块；历史 skills-v1/v2、模块 v1/2 与禁用文案均为 0；generated 只有完整 `promax-team` |

## 独立复算

- 使用 harness catalog loader 读取 28 条记录，并以实际源目录重新计算相同规范下的 `content_sha256`、`tree_sha256`：`catalogEntries=28`、`uniqueSkillIds=28`、`contentMatches=28`、`treeMatches=28`、`failures=[]`，退出码 0。
- 将 catalog 每个 `skill_id` 的 `source_path` 与只读原版包同名目录执行递归比对：`originalDirs=28`、`recursiveMatches=28`、`failures=[]`，退出码 0。
- 6 个业务模块 skill 数为 2 / 7 / 5 / 9 / 4 / 6；Judge 为 0；固定 preset 中 28 个 catalog ref 全部唯一且为 `@1`。
- Judge persona 相对独立基线只有 revision 机械收敛；`FABRICATED`、闭集、二元 `pass/fail`、领域 rubric、最多两轮、申诉、人工放行文本均未改变，`judge-reviewer` 仍只允许 `glob/grep/read/write`，无 web。
- `telemetry-tracker` 与原版目录递归一致；交付材料明确写 OpenClaw hook 在 dsh 不原样生效，由 session/event 与本机 SQLite 承担等价职责。

## 机验逐项判定

| # | 判定 | 命令、证据与关键结果 |
| ---: | --- | --- |
| 1 | 不通过 | 全部模块命令退出 0，但 `prx006-complete-team.test.mjs` 未生成业务产物并断言产物内 SRC 回指，未覆盖任务点名的完整失败路径，见失败 F2。 |
| 2 | 通过 | 独立 loader + 哈希重算 + 28 目录 `diff -qr`：28 / 28 全匹配。 |
| 3 | 通过 | definition/module 解析：2 / 7 / 5 / 9 / 4 / 6，总成员 8，Judge 0。 |
| 4 | 通过 | `find` 与 `rg` 断言均退出 0：历史目录和三个被取代模块当前为 0，当前非 generated/evidence 源码无旧角色引用。 |
| 5 | 通过 | generated 顶层仅 `promax-team`；verify valid、137 files、28 skills；definition 不含随机旧 team_id。 |
| 6 | 通过 | 首次归档 `/Users/Admin/Desktop/Promax/.archive/pre-promax-team-20260902-033636` 非空（1646 个路径项）；后续归档 `/Users/Admin/Desktop/Promax/.archive/promax-team-20260902-035735` 非空；安装态恰好 `general`、`promax-team-configurator`、`promax-team`，安装态 verify valid。 |
| 7 | 不通过 | 证据目录只有 1 个 `skills-and-personas.md` 汇总表；三项必填标签均不存在，见失败 F1。 |
| 8 | 通过 | 7 个部门成员均可得到 `web_search` / `web_fetch`，Judge 无 web；分发 patch 包含三个 web 包；密钥只按名称引用，无值字面量。 |
| 9 | 不通过 | manifest 元数据、两种 fetch 状态和篡改失败有测试；业务产物中的 SRC 回指没有测试或运行时校验，见失败 F2。 |
| 10 | 通过 | Judge 专项 diff 与 marker/tool-profile 比对结果符合机械收敛边界。 |
| 11 | 通过 | `PromaxSettings.tsx` 与行为测试覆盖模型、MCP、飞书入口、revision conflict、连接测试路径；不是 dsh 原生设置页透传。 |
| 12 | 未验证 | 哨兵值仅出现在测试 fixture，构建产物、发布包、settings/localStorage 模拟层、日志、证据、`~/.dsh-promax` 与临时目录搜索均为 0；`credentials.describe` 的代码/测试不返回 value。当前 3080 / 3090 / 3100 监听数均为 0，按禁启服务边界无法取得“现存 DeepSeek 配置未被清空/迁移”的当前运行态只读锚点。 |
| 13 | 通过 | 采用预置飞书降级；UI 与交付材料均明确“不能自行添加任意 MCP server”；测试覆盖 stdio 启动、启停、连接测试与经过 namespace 过滤的工具列表结构。 |
| 14 | 通过 | telemetry 整目录递归一致，限制记录如实。 |
| 15 | 不通过 | dsh 与后端未改、未发现真实凭据或公司材料；但 Agent 改动了允许修改清单未列出的 4 个 `examples/` / `recipes/` 路径，含 1 个删除，见失败 F3。 |
| 16 | 通过 | 两仓同名分支各有实现提交；核查写证据前 Agent 仅既存 `evidence/` 未跟踪，GUI 干净；未合并 main。 |

## 失败 F1：persona 比对交付不符合冻结格式

最小复现：

```bash
find /Users/Admin/Desktop/Promax/promax-ui/evidence/prx-006-complete-assembly-2026-09-02 -maxdepth 1 -type f -iname '*persona*' -print
rg -n '删除的 Promax 限制|保留的原版纪律|最终差异' /Users/Admin/Desktop/Promax/promax-ui/evidence/prx-006-complete-assembly-2026-09-02/skills-and-personas.md
```

实际：persona 文件数为 1；第二条命令退出 1 且无匹配。文件只有 7 行汇总表，不能替代任务要求的 7 份逐项报告。六份原版 persona 与七份当前 persona 已逐份人工阅读，主要角色能力本身未发现被再次删减；本失败定位于交付证据层，而非据此断言 persona 实现内容错误。

## 失败 F2：SRC 回指只存在于 manifest，没有被业务产物证明

最小复现：

```bash
rg -n 'product_discovery\.md|artifact|deliverable|产物|回指' /Users/Admin/Desktop/Promax/promax-agent/team-harness/test/prx006-complete-team.test.mjs
rg -n 'product_discovery\.md|artifact.{0,40}SRC|deliverable.{0,40}SRC|产物.{0,40}SRC|回指' /Users/Admin/Desktop/Promax/promax-agent/team-harness/src/external-capabilities.mjs /Users/Admin/Desktop/Promax/promax-agent/team-harness/src/harness.mjs
```

实际：两条命令都退出 1。现有测试第 88–158 行验证了 `SRC-002` / `SRC-003` 被追加进 manifest、元数据与 SHA256 齐全、快照篡改会失败；它没有创建 `product_discovery.md` 或其他业务产物，也没有断言产物引用对应 SRC。runtime hook 只把工具结果追加到 manifest，不检查后续业务产物是否回指。persona 中的提示语不能替代确定性机验。

## 失败 F3：Agent 增量越出允许修改清单

最小复现：

```bash
git -C /Users/Admin/Desktop/Promax/promax-agent diff --name-status ff563af3189d91800172f126b8f08f69d6f8fcf5...codex/prx-006-complete-team-settings -- team-harness/examples team-harness/recipes
```

实际：

```text
D team-harness/examples/api/publish.response.yml
M team-harness/examples/dynamic-product-team.yml
M team-harness/examples/team-resource-manifest.yml
M team-harness/recipes/product-studio/1/prompt-recipe.yml
```

任务“允许修改”的 harness 白名单列出 catalogs、modules、definitions、schemas、src、test、generated、相关 README/INTEGRATION、package 与编译/安装脚本，没有列出 `examples/` 或 `recipes/`。这些改动用于清除旧角色引用并非无目的，但任务也规定若范围不够应先申请显式批准；交付记录中没有该批准。尤其 `publish.response.yml` 的删除不属于点名允许清理的历史 Skill、模块、generated 或 preset。

## PRX-001 合并依赖审计

- Agent：`git merge-base --is-ancestor codex/prx-001-three-tier-slots codex/prx-006-complete-team-settings` 退出 1；PRX-006 从 Agent `main@ff563af` 生长，不含 Agent PRX-001 `186f3ae`。
- GUI：同命令退出 0；PRX-006 以 GUI PRX-001 `0e60889` 为基线，合入 GUI main 时会隐式带入 6 个 PRX-001 提交。
- 后端当前为 `codex/prx-001-three-tier-slots@2bc1f58f70073c797630dbfac1a5b4d75eb3f072`，而后端 main 为 `7d5aa5c13b870b777b244844bc2f0af36d7f6073`。

因此即使返工后机验全绿，当前也不得合并：GUI 会把 PRX-001 带入 main，而 Agent PRX-006 和后端 main 不含对应 PRX-001 版本。该依赖不是本核查会话可自行 cherry-pick、改后端或重写历史解决的事项，须负责人明确裁决。

## 人验边界

任务文件 6 条“完成标准 · 人验项”全部保持未勾选，均为待人工。本轮未用源码搜索、mock、探活或安装目录存在替代负责人的模型、MCP、飞书、真实联网与完整跑批操作。
