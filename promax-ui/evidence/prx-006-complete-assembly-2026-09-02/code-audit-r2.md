# PRX-006 独立代码核查 R2

日期：2026-09-02  
核查分支：Agent / GUI 均为 `codex/prx-006-complete-team-settings`  
增量基线：Agent `ff563af3189d91800172f126b8f08f69d6f8fcf5`；GUI `0e60889d9d3e61a944f756c21cc73588d8c33b47`

## 结论

本轮不得进入 `user-check`，不得合并。源码与新生成的分发包已包含 R1 要求的 Judge 前 SRC 回指门禁，但当前安装态 `/Users/Admin/.dsh-promax/profiles/web/node_modules/@promax/team-harness` 仍是修复前内容。源码包版本没有递增，仓库和新 tgz 与已安装的同名 `0.6.0-dist.1` 包内容不同；当前运行时不会加载本轮新增门禁。

此外，最终合并仍有独立硬阻塞：Agent 的 PRX-001 分支不是 PRX-006 的祖先，GUI 的 PRX-001 分支是 PRX-006 的祖先，后端 PRX-001 仍未进入 `main`。PRX-001 合并依赖待负责人裁决。

## 启动闸门与范围

- `status.py` 退出 1（WARN，不是 exit 2），任务状态为 `reviewing`，两仓同名分支与实现提交均存在。
- 闸门原始警告包括：已删除旧定义仍被 `required_context` 引用；GUI/Agent 工作区脏；上一失败卡的“最小复现”被解析为空。
- 实际 `git status --short`：Agent 只有基线既有 `?? evidence/`；GUI 只有独立核查生成的 `?? evidence/prx-006-complete-assembly-2026-09-02/code-audit-r1.md`，没有未提交任务代码。
- Agent 提交：`eba68f8`、`09909f0`。GUI 提交：`bc81ddb`、`d456d90`。实现会话交付记录与实际返工提交路径一致。
- dsh 子仓仍为 `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`，`deepseek-harness/packages/` 相对任务基线零差异；`promax-end` 当前仍为 `codex/prx-001-three-tier-slots@2bc1f58`，本任务没有后端代码改动。
- R1 的 4 个 `examples/` / `recipes/` 路径已在任务文件“允许修改”中得到负责人精确批准；其余删除均落在任务点名的历史 Skill、模块、生成目录、旧 definition/preset 清理范围。

## 必跑命令

### Agent

| 命令 | 退出码 | 关键结果 |
| --- | ---: | --- |
| `npm test` | 0 | 41 tests、41 pass、0 fail |
| `node src/cli.mjs catalog` | 0 | 9 modules、28 skills、21 rules、3 recipes |
| `node src/cli.mjs validate --definition definitions/promax-product-team.yml` | 0 | 7 workers，定义有效 |
| 两次 `compile`（第二次 `--allow-overwrite`） | 0 / 0 | 固定输出 `promax-team`；覆盖前归档成功 |
| 两次 `verify` | 0 / 0 | 均 `valid`，137 files |

### GUI

| 命令 | 退出码 | 关键结果 |
| --- | ---: | --- |
| `pnpm typecheck` | 0 | 无 TypeScript 错误 |
| `pnpm test` | 0 | 20 files、104 tests、104 pass、0 fail |
| `pnpm build` | 0 | 4 个 workspace package 完成 |
| `pnpm package:dist` | 0 | 6 个 tgz 与 console-web 生成；新 team-harness tgz 含返工源码 |

两仓 `git diff --check`、任务文件列出的 9 个模块/历史目录/唯一生成态/禁止文本检查全部退出 0。

## 独立复算与内容核对

- catalog loader 与独立目录清单复算：28 条、28 个唯一 `skill_id`、全部 `@1`；`content_sha256` 28/28、`tree_sha256` 28/28；与原版同名目录递归一致 28/28，失败列表为空。
- 6 个业务模块 Skill 数为 2 / 7 / 5 / 9 / 4 / 6；团队成员 8；Judge Skill 0。
- 七份 `*-persona.md` 均为独立文件，各自只有一组“删除的 Promax 限制 / 保留的原版纪律 / 最终差异”，已逐份与六份原版 AGENTS.md 及当前模块 persona 对照。`product_discovery` 保留搜索/抓取定位，`user_analysis` 保留预警能力，其余未发现再次加入平台私有限制。
- `telemetry-tracker` 与原版目录 `diff -qr` 退出 0。交付记录明确写 OpenClaw `HOOK.md` 不会在 dsh 原样生效，等价职责由 dsh `session/event` 与 SQLite 承担。
- active Judge 模块相对任务基线只有 `metadata.revision: 2 -> 1`；FABRICATED、输入闭集、二元 verdict、领域 rubric、两轮、申诉与人工放行语义不变。`judge-reviewer` 仍只有 read/write/glob/grep，无 web。
- 凭据哨兵 `sk-ONLY-WRITE-TO-CREDENTIALS` 在 release、两仓 evidence、安装态 Promax 包中的命中文件数均为 0；测试断言它只进入 `credentials.set`，不进入 settings mutate 或 localStorage。
- 对当前 3080 已有监听只执行只读 RPC：`settings.describe` HTTP 200 / ok，`llm-deepseek` 命名空间存在；`credentials.describe({refs:["DEEPSEEK_API_KEY"]})` HTTP 200 / ok，返回 `configured=true`、`source=file`、`writable=true`，且 `hasValueField=false`。没有读取或输出密钥值。
- 安装态 preset 恰好为 `general`、`promax-team-configurator`、`promax-team`；安装态 `promax-team` verify 退出 0，`valid`、137 files。首次归档 `pre-promax-team-20260902-033636` 有 1646 条，后续归档 `promax-team-20260902-035735` 有 226 条。

## 机验逐项判定

| # | 判定 | 证据摘要 |
| ---: | --- | --- |
| 1 | 通过 | Agent 41/41；GUI 104/104；typecheck/build/package 全部退出 0，失败路径测试存在。 |
| 2 | 通过 | 28 条/28 唯一/@1，双哈希重算与 28 个目录递归比对全通过。 |
| 3 | 通过 | Skill 数 2/7/5/9/4/6；8 成员；Judge 0 Skill。 |
| 4 | 通过 | 历史 Skill/模块目录为 0；顶层模块 9；被取代模块引用清理。 |
| 5 | 通过 | 固定 `promax-team`；源码生成态唯一且 verify valid，28 Skill。 |
| 6 | 通过 | 首次/后续归档非空；安装态仅 3 preset；归档路径和计数有脱敏记录。 |
| 7 | 通过 | 七份 persona 报告逐份阅读、逐份三字段对照。 |
| 8 | 通过 | 7 个部门成员均有 web_search/web_fetch，Judge 无 web；bundle 三个 web 包只引用凭据名。 |
| 9 | **不通过** | 源码测试和新 tgz 有 SRC 回指门禁，但当前安装态包没有该门禁；现有绿灯未证明当前运行时具备该行为。见下方最小复现。 |
| 10 | 通过 | active Judge 只有机械 revision 收敛，实质规则和工具边界未放宽。 |
| 11 | 通过 | 自建模型/MCP/飞书页面及行为测试存在，不是原生设置页透传。 |
| 12 | 通过 | 哨兵单向写入且零残留；只读运行态确认 DeepSeek 命名空间和 credential metadata 存在，describe 无 value。 |
| 13 | 通过 | 明确采用预置飞书降级，UI 写明不能任意添加 MCP server；实际工具列表结果结构有测试。 |
| 14 | 通过 | telemetry 原目录完整，dsh/OpenClaw hook 差异如实记录。 |
| 15 | 通过 | dsh packages、后端、共享契约均未改；未发现真实凭据、真实公司材料或无关用户文件混入。 |
| 16 | 通过 | 两仓同名分支均有提交；除既有/核查 evidence 外无未提交任务代码；未合并 main。 |

## 失败 F1：安装态仍是修复前的同版本包

最小复现：

```sh
shasum -a 256 \
  /Users/Admin/Desktop/Promax/promax-agent/team-harness/src/external-capabilities.mjs \
  /Users/Admin/.dsh-promax/profiles/web/node_modules/@promax/team-harness/src/external-capabilities.mjs

shasum -a 256 \
  /Users/Admin/Desktop/Promax/promax-agent/team-harness/src/harness.mjs \
  /Users/Admin/.dsh-promax/profiles/web/node_modules/@promax/team-harness/src/harness.mjs

rg -n 'validateBeforeJudgeExecution|tools/pre-execute' \
  /Users/Admin/.dsh-promax/profiles/web/node_modules/@promax/team-harness/src/{external-capabilities,harness}.mjs
```

原始关键结果：

- 仓库 `external-capabilities.mjs`：`8e1616b2...39d9`；安装态：`e35e5337...fa5a0`。
- 仓库 `harness.mjs`：`001f8147...3f0f7`；安装态：`c87257df...d3f162`。
- 安装态 `rg` 零命中、退出 1；仓库与新 tgz 均能命中 `ctx.on('tools/pre-execute', validateBeforeJudgeExecution)`。
- 仓库 package 是 `0.6.0`，新 tgz 和安装态 package 都声明 `0.6.0-dist.1`，但内容不同。新 tgz 时间为 06:01，安装态文件时间为 03:36。profile dependency 已指向同一 tgz 路径，但包未刷新。

期望：当前安装态 `@promax/team-harness` 与本轮分发 tgz 内容一致，真实 dsh 运行时加载 Judge 前 SRC 回指门禁；一个发布版本只对应一份不可变内容。

实际：同名同版本 tgz 被新内容覆盖，而安装态仍保留旧内容；当前运行时没有本轮门禁。

已排除：返工源码漏写、tgz 漏包、dsh 事件名/签名错误。源码已注册真实 `tools/pre-execute`；新 tgz 两个文件哈希与仓库相同；dsh 源码声明该事件签名为 `(exec, next)`，生成态真实 Judge 工具名为 `quality_judge`。

定位到的层：Agent package 版本治理 + GUI 分发安装态刷新。返工修改生产源码后没有递增 `@promax/team-harness` 版本，`package:dist` 复用了 `0.6.0-dist.1` 文件名；当前 profile 没有安装新内容。

未定论：当前 3080 进程何时由谁启动不影响此结论；本核查会话按边界没有起停服务，也没有替实现会话执行安装。实现会话需用新的唯一 package 版本重新打包并走受支持安装流程，不能手抄文件或删除用户归档。

## PRX-001 合并硬阻塞

- `git -C promax-agent merge-base --is-ancestor codex/prx-001-three-tier-slots codex/prx-006-complete-team-settings`：退出 1。
- `git -C promax-ui merge-base --is-ancestor codex/prx-001-three-tier-slots codex/prx-006-complete-team-settings`：退出 0。
- Agent PRX-001 为 `186f3ae`，与 PRX-006 在基线后分叉；GUI PRX-006 从 `0e60889`（PRX-001）继续，最终合入会隐式带入 GUI PRX-001；后端 PRX-001 为 `2bc1f58`，后端 main 为 `7d5aa5c`。
- PRX-001 合并依赖待负责人裁决；实现会话不得合并、cherry-pick、rebase、改后端或共享契约。

## 返工验收条件

1. 为 `@promax/team-harness` 使用新的唯一版本，重新执行 `pnpm package:dist`；不得继续用不同内容覆盖 `0.6.0-dist.1`。
2. 通过生成的受支持安装脚本刷新 `/Users/Admin/.dsh-promax/profiles/web`，保留脚本的先归档、校验、再替换顺序；不得手工复制 node_modules，不得读取/迁移/重填凭据。
3. 安装后对仓库、新 tgz、安装态的 `external-capabilities.mjs` 与 `harness.mjs` 做 SHA256 三方一致性检查；安装态 `rg` 必须命中 `validateBeforeJudgeExecution` 和 `tools/pre-execute`。
4. 重新 verify 安装态 `promax-team`，确认仍只有 3 个 preset；把新增归档路径、文件数、package 版本、三方哈希和命令退出码写入脱敏 evidence。
5. 将任务 `required_context` 中已删除的 `team-harness/definitions/team-mtcjsbcz-04tpe2.yml` 更新为当前 `team-harness/definitions/promax-product-team.yml`，消除 W7；不要删除两仓现有 evidence。
6. 重跑任务全部 Agent/GUI/静态命令并提交两仓实际改动；状态恢复 `reviewing` 后交独立核查 R3。PRX-001 继续只记录阻塞，等待负责人裁决。

所有 6 条人验项仍为待人工，本轮未勾选，也没有执行真实联网、飞书写入或完整跑批。
