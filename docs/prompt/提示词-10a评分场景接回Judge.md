# 任务：10a 评分场景接回 Judge（默认入口 + NE-13 + 真跑）

> 执行方：pi（GPT6-Astra）　·　生成日期：2026-09-27　·　改 6 个文件；**不改业务方法，不提交**（不是 git 仓库）
> 工作目录：`/Users/Admin/Desktop/Promax`
> 配套：任务书 `docs/重新出发/01-指派任务/10-Judge接回任务.md/01-指派任务.md`；历史证据 `docs/重新出发/02-验证记录/06-专家团嵌入与Judge结果.md`（R06-2/5/6）、`07-架构定型结果.md`（R07-1）、`09-dsh适配结果.md`（R09-4）

## 一、目标

1. 在现役默认入口（`profiles/headless`，路线 A）上加回独立检查成员 `judge`（模型 `deepseek-v4.1-flash`），**本步只用于评分类任务**。
2. 按用户拍板的派审时机改团队规则：新正式版本才审、每版最多返修 1 轮、追问不审、v2 只审增量加复查台账、只复查时派 Judge。
3. 修 NE-13：`"原文"（T0001，1 星）` 这类写法要被程序认成带编号引文；有引文却程序核对覆盖为 0 时，`issues.py` 不接受 PASS。
4. Judge 角色卡去掉 `send_message` 回报（路线 A 下成员只运行一次就结束）。
5. 真跑验证：B4 对抗（5 个埋点）＋ 同一会话四轮（v1 → 追问 → v2 更新 → 只复查），全部带 Judge。

## 二、背景（先看懂现状）

### 2.1 为什么做

| 事项 | 现状 |
|---|---|
| 默认入口没有 Judge | 任务 09 为了先跑场景，把 Judge 从默认入口拿掉了：`cordis.patch.yml` 只有 6 个业务成员工具；`team/AGENTS.md` 第 40 行写「本阶段不做独立检查，不派 judge」 |
| Judge 角色卡还是旧写法 | `team/members/judge.md` 第 59 行要求用 `send_message` 回报 lead；路线 A 下前台成员是一次性子会话，结束后找不回（R07-1、NE-16）。第 22 行让临时脚本放 `$TMPDIR`，与团队规则第 4 条「只写 cwd 下的 `临时/`」冲突 |
| NE-13 | `check_quotes.py` 的带编号引文正则要求括号里**只有**编号：`"原文"（T0001）`。写手写成 `"原文"（T0001，1 星）` 时被当成不带编号的引文，只进提示，不算问题；B1/B3 程序覆盖 0，台账仍记 pass |
| Judge 在路线 A 上的历史 | R07-1：Judge 用 v4-pro 时 B4 只检出 4/5（E5 漏检）。R06-5/6：Agent Teams 下 Judge 用 flash，B4 两次 5/5。**路线 A + flash 的组合从没跑过** |

### 2.2 已核实的事实（Claude 实测，2026-09-27）

| 项 | 事实 |
|---|---|
| 文件行数 | `team/AGENTS.md` 82 行；`team/members/judge.md` 59 行；`dsh-home/profiles/headless/cordis.patch.yml` 173 行 |
| 现有入口 | 6 个成员工具（`user_analysis` … `requirement_review`），全部 `deepseek-v4.1-flash`；`tool-web` 关闭 |
| 可照抄的 Judge 配置 | `dsh-home/profiles/headless-a/cordis.patch.yml` 的 `member-judge` 条目（只看写法，**模型改成 v4.1-flash**；不改这个文件） |
| 可参考的 Judge 流程 | `team/route-a/AGENTS.md` 第 3—6 节（旧路线 A 带 Judge 的规则；其中「成员子会话优先复用、`send_message`」已被证明不适用，不能照抄） |
| 当前 check_quotes 的覆盖（对各报告的正式版本，材料为该运行目录 `附件/*.json`） | `52-M` v1：带编号 16、ok 16；`52-M` v2：带编号 17、ok 17；`47-C06` v1：带编号 **0**、不带编号 12；`07-a-team` v1：带编号 **0**、不带编号 15（提示 2）；`04-rework-team` v1、v2：带编号 **0**、不带编号 8 |
| B4 输入的现状 | `check_quotes.py kit/fixtures/B4/报告.md kit/评分样本-v1.json`：带编号 6、ok 4、missing `T0093`、mismatched `T0249` |
| 历史引文写法（`runs/*/交付/**/*.md` 统计） | `"原文"（ID）` 200 处；`"原文"（ID，N 星）` 86 处；`"原文"（ID ID）` 4 处；其余是「用户访谈｜…」「应用商店｜…」等非编号来源（10b 再处理，本步不管） |
| v1 参考值（`team/tools/facts.py`） | 320 条、有效 300、无效 20；1—5 星 30/45/75/90/60；低星 75/300 = 25.0% |
| v2 参考值 | 1—5 星 31/45/74/90/60；低星 76/300 = 25.33%；`diff_records.py` 输出「新增 0 · 删除 0 · 字段变化 1」 |
| B4 答案 | `promax-eval/fixtures/B4/答案.md`（E1—E5 埋点 + 陷阱 T1）。**只在第 9.5 节判分时读，不能进任何运行目录** |
| 运行目录 | 最后一个是 `runs/52-M`；本步从 53 号开始 |
| 续跑同一会话 | `kit/run.sh <运行目录> <提示词> [标签] [会话ID]`；首轮打印 `session=...`，也在 `events-<标签>.jsonl` 第一行的 `sessionId` |

## 三、已拍板的规则（不要改）

1. 顺序：本步只做评分场景；其余 6 个场景下一步（10b）再做。Judge 模型只用 `deepseek-v4.1-flash`。
2. **派审时机**：只在产出新正式版本时派 Judge；每个版本最多返修 1 轮，复查后仍不是 PASS 就保存，并在交付说明里列出未关闭问题；追问不派；v2 更新只审增量加复查台账；只复查时派 Judge，不产出新版本。
3. **NE-13 修法**：放宽编号识别 ＋ 覆盖为 0 时不许 PASS。
4. 第六章给了原文和替换文本的，**逐字照写**；原文对不上就停下报告，不要自己改写。第六章只给行为规格的（三个 Python 文件），按规格实现，保持现有写法和现有行为不变。
5. 每条运行命令都用 `env -u DSH_PROFILE`；最多 3 个并行。
6. 运行期间只有一个例外可以往运行目录放文件：多轮第 3 轮之前把 `kit/评分样本-v2.json` 复制到 `runs/55-M/附件/`。
7. 基础设施失败（`exit_code` 非 0，原因是网关 400、429、上游不可用、进程崩溃）：B4 单独重跑 1 次（目录加 `-r1`）；多轮的某一轮用同一会话 ID 重跑 1 次（标签加 `r1`）；仍失败就如实记录、继续。质量、速度、行为不达标的，不重跑、不调参。
8. 单个场景或单轮上限 20 分钟。

## 四、边界

### ✅ 允许修改

- `promax-project/team/AGENTS.md`（第六章 F1—F7）
- `promax-project/team/members/judge.md`（第六章 J1—J4）
- `promax-project/team/judge/tools/check_quotes.py`、`precheck.py`、`issues.py`（第六章 P1—P3）
- `promax-project/dsh-home/profiles/headless/cordis.patch.yml`（第六章 C1—C3）
- 用 `kit/new-run.sh` 新建 `runs/53-S0`、`54-B4`、`55-M`（及按第三章第 7 条需要的 `-r1`）
- 写 `promax-eval/分析-10a/`、`promax-eval/结果-10a评分场景接回Judge.md`；在 `promax-eval/.bak/` 下存基线

### 🔴 禁止

- 上面以外的产品文件：其他角色卡、`team/skills/**`、`team/judge/rubrics.yml`、`team/judge/fixtures/**`、`check_numbers.py`、`team/tools/**`、`team/route-a/**`、`team/README.md`、`kit/**`、`dsh-home/profiles/headless-a/**`、`dsh-home/AGENTS.md`、dsh 源码、`old-version/**`、`docs/**`
- 删除、复用或往 52 号及以前的运行目录里放东西；把答案或分析文件放进运行目录
- 读取或打印凭据；读 `~/.dsh-promax-first/**`；`dsh plugin`；启动 8800

### ⚪ 明确不做

- 其余 6 个场景的 Judge（10b）；v4-pro 对照；非编号来源的引文核对
- NE-12（Lead 自查内容）、NE-27（报错漏计）的返修——本步只作为验收观察项
- 内容质量评估、界面、飞书、NE-29 网关 400

## 五、必读

1. `promax-project/team/AGENTS.md` 全文、`team/members/judge.md` 全文
2. `promax-project/team/judge/tools/` 下 4 个 Python 文件全文（尤其三个文件的文件头说明）
3. `promax-project/dsh-home/profiles/headless/cordis.patch.yml` 与 `headless-a/cordis.patch.yml` 的 `member-judge` 条目
4. `docs/重新出发/02-验证记录/09-dsh适配结果.md` 的 R09-4 结论页（NE-12、NE-27 的具体表现）
5. `docs/prompt/提示词-09d小修与多轮实测.md` 第 9.5 节：本步多轮沿用它的核对方法
6. 可参考的脚本（复制到 `分析-10a/` 再改，不改原件）：`promax-eval/分析-09d-复核/`、`promax-eval/分析-09d/`

## 六、改造规格

代码块里的内容就是文件里的**完整原文**（不含围栏行），反引号都是真实字符。每处替换用脚本做，断言原文恰好命中 1 次。

### 6.1 `team/AGENTS.md`

**F1** 第 7 行之后**插入**一行（第 7 行本身不动）：

```text
- 独立检查：成员工具 `judge`（角色卡 `<team>/members/judge.md`）；Judge 结论用 `python3 <team>/judge/tools/issues.py show` 读
```

**F2** 替换第 40 行：

原文：

```text
只建完成任务必需的成员；一个成员能做完就不拆。**本阶段不做独立检查，不派 judge。**
```

替换为：

```text
只建完成任务必需的成员；一个成员能做完就不拆。**独立检查（`judge`）本阶段只用于评分类任务**：本轮运行了 facts.py 的任务，以及用户要求对评分类报告做独立检查的任务。其他任务不派 judge。
```

**F3** 替换第 51—53 行（三行整体）：

原文：

```text
4. **确认成果**：成员返回后，Lead 用 `ls` / `wc` 确认它写的文件存在、非空；不读内容做检查，不替成员改。
5. **正式保存**：运行 `python3 <team>/tools/save.py 交付/<文件名>`，读回执。
6. **交付说明**：见第 6 节。
```

替换为：

```text
4. **确认成果**：成员返回后，Lead 用 `ls` / `wc` 确认它写的文件存在、非空；不读内容做检查，不替成员改。
5. **独立检查（仅评分类任务）**：调用成员工具 `judge`（前台）。派工写：用户要求原文、被审文件 `交付/<文件名>`、原始材料路径、`交付/facts.json`；不要把成员的自评或你的看法告诉 Judge。Judge 返回后运行 `python3 <team>/judge/tools/issues.py show` 读结论。
6. **返修最多一轮**：结论是 REVISION_REQUIRED 时，新建同一角色的成员，把 `issues.py show` 输出里的阻断问题（编号、原句、修改建议）原样交给它修改一次；再新建 judge，派工写明「这是复查轮」，复查一次。复查后仍不是 PASS，就不再返修，带着未关闭问题进入保存。
7. **正式保存**：运行 `python3 <team>/tools/save.py 交付/<文件名>`，读回执。
8. **交付说明**：见第 6 节。
- **只要求独立检查**（用户给了现成报告，只要检查、不要改）：先运行 facts.py，再直接派 judge 审附件里的报告；不派写手、不返修、不保存新版本，交付说明转述 `交付/检查.md` 的结论。
```

**F4** 替换第 58—59 行（两行整体）：

原文：

```text
- 本阶段没有独立检查；Lead 不自己核对成果内容，不复算。
- 交付说明只引用保存回执，并写明「本版未经独立检查」。
```

替换为：

```text
- Lead 不自己核对成果内容，不复算：派 Judge 前不读成果正文；Judge 提交后不重跑 facts.py、`check_*` 或 precheck。
- 读 Judge 结论只用 `issues.py show` 和 `交付/检查.md`；是否返修只按其中的阻断问题决定，不自己增加、删除或改写问题。
- 不派 judge 的任务，交付说明写明「本版未经独立检查」。
```

**F5** 替换第 69 行：

原文：

```text
  4. `save.py` 保存为新版本（旧版本文件保留）；交付说明写"相对上一版改了什么"。
```

替换为：

```text
  4. 评分类任务：新建 judge，派工写：上一版正式版本路径、被审文件 `交付/<文件名>`、变化清单、新旧 facts 路径、新材料路径，并写明「这是更新轮：按变化清单检查受影响部分，并复查台账」。返修规则同第 3 节第 6 步。
  5. `save.py` 保存为新版本（旧版本文件保留）；交付说明写"相对上一版改了什么"。
```

**F6** 替换第 70 行：

原文：

```text
- **只复查**（用户要求重新检查）：本阶段没有独立检查，如实告诉用户『当前阶段未启用独立检查』；不派写手、不重算、不保存新版本。
```

替换为：

```text
- **只复查**（用户要求不改内容、重新检查）：评分类成果新建 judge，派工写明「只复查当前正式版本」、被审文件、原始材料和 facts 路径；不派写手、不重算、不保存新版本；把 `交付/检查.md` 的结论如实告诉用户。非评分类成果如实说明『当前未启用独立检查』。
```

**F7** 替换第 74—78 行（五行整体）：

原文：

```text
- 只根据**保存回执**说话：
  - 回执 `saved` → 可以说"已完成"。
  - 回执失败或没拿到 → 说"未正式保存"，给出原因和草稿位置。
- 每份交付说明都写一句「本版未经独立检查」。
- 3—8 行：结论要点、主要限制、正式版本路径。**非空行不超过 8 行**，超出就合并。
```

替换为：

```text
- 只根据**保存回执**和 **`交付/检查.md` 的结论**说话：
  - 回执 `saved` 且 Judge `PASS` → 可以说"已完成"，并写「独立检查通过」。
  - 回执 `saved` 但 Judge 不是 PASS → 说"已保存，但独立检查未通过"，列出未关闭问题编号。
  - 回执失败或没拿到 → 说"未正式保存"，给出原因和草稿位置。
- 不派 judge 的任务写一句「本版未经独立检查」。
- 3—8 行：结论要点、检查结论、主要限制、正式版本路径（有检查时加 `交付/检查.md`）。**非空行不超过 8 行**，超出就合并。
```

改完 `AGENTS.md` 应为 89 行（82 + F1 1 + F3 3 + F4 1 + F5 1 + F7 1）；diff 只落在上述位置。

### 6.2 `team/members/judge.md`

**J1** 替换第 7 行：

原文：

```text
只用 Lead 给你的：用户原始要求、被审文件路径、原始材料路径、事实文件（如 `交付/facts.json`）、适用的领域规则。不读成员的聊天和自评；成员说"已检查""没问题"不作为依据。
```

替换为：

```text
只用 Lead 给你的：用户原始要求、被审文件路径、原始材料路径、事实文件（如 `交付/facts.json`）、适用的领域规则；更新轮还有上一版正式版本路径、变化清单、新旧 facts 路径。不读成员的聊天和自评；成员说"已检查""没问题"不作为依据。
```

**J2** 替换第 22 行：

原文：

```text
4. 不为已由程序覆盖的内容另写核对脚本；确实要算数时，脚本放 `$TMPDIR`，不放 `交付/`。
```

替换为：

```text
4. 不为已由程序覆盖的内容另写核对脚本；确实要算数时，脚本放 cwd 下的 `临时/`（没有就建），不放 `交付/`、`/tmp` 或 `$TMPDIR`。
```

**J3** 在第 34 行（`按成果类型查 \`judge/rubrics.yml\` …`）之后、`## 判断纪律` 之前**插入**以下一节（前后各留一个空行）：

```text
### 更新轮与只复查

- **更新轮**（Lead 写明「这是更新轮」）：预检照常对整份被审文件跑；通读时用 `diff <上一版正式版本> <被审文件>` 定位改动行，只读变化清单涉及的记录、数字，以及改动行和引用它们的段落；台账里未关闭的问题逐项复查。没改动、也与变化无关的段落不重审。
- **只复查**（Lead 写明「只复查当前正式版本」）：先 `issues.py show` 看台账，再按上面的检查顺序完整检查一次；未关闭问题逐项复查。
```

**J4** 替换第 59 行：

原文：

```text
提交成功后，用 `send_message` 给 lead 发：结论、阻断问题编号、一句话理由。不要在消息里重复整份检查内容。
```

替换为：

```text
提交成功后，把结论、阻断问题编号、一句话理由作为你的最终回复返回。不要在回复里重复整份检查内容。提交被拒就按错误修改后重交；没有提交成功就不要结束。
```

改完 `judge.md` 里 `send_message`、`$TMPDIR` 作为要求出现的次数为 0（J2 的禁止句里出现 `$TMPDIR` 除外）。

### 6.3 `dsh-home/profiles/headless/cordis.patch.yml`

**C1** 文件头注释：第 5 行 `只留 6 个具名成员工具` 改成 `只留 7 个具名成员工具（6 个业务成员 + judge）`；第 7 行整行改成：

```text
#   5. 成员全部用 deepseek-v4.1-flash；judge 本阶段只用于评分类任务（见 team/AGENTS.md）
```

**C2** 第 69 行 `# 本阶段不挂 Judge（无 member-judge）。` 整行改成：

```text
#   judge                  → opencode-go/deepseek-v4.1-flash
```

**C3** 在 `member-requirement-review` 条目之后（文件末尾）追加 `member-judge` 条目：写法与现有业务成员条目逐项相同（`provider: spawn`、`backgroundMode: continuable`、`maxDepth: 1`、`agentOptions` 为 `opencode-go` / `deepseek-v4.1-flash`），`id: member-judge`、`toolName: judge`；persona 只有两段：

```text
你是 Promax 产品专家团的成员 judge（独立检查）。

开始前先读你的角色卡 /Users/Admin/Desktop/Promax/promax-project/team/members/judge.md，并照它工作。
```

不加业务成员 persona 里「角色卡里 send_message 不适用」那一段（J4 已经改掉）。

### 6.4 `team/judge/tools/`（行为规格；文件头说明同步改）

**P1 `check_quotes.py`：放宽编号识别**

- 带编号引文 = 引号后紧跟的括号里，**第一个词是来源编号**（现有编号写法 `[A-Za-z]+[-_]?\d{2,}`）。编号后面可以跟：更多编号（空格、`、`、`，`、`,`、`；`、`;` 分隔），以及分隔符后的任意说明文字（如 `，1 星`），直到右括号。
- 必须认出：`"原文"（T0001）`、`"原文"（T0001，1 星）`、`"原文"（T0001, 1星）`、`「原文」（T0001 T0006）`、`"原文"（T0001、T0006，2 星）`。
- 不能误认：括号第一个词不是编号的，如 `（§二）`、`（脚本输出）`、`（用户访谈｜阿哲｜…）`、`（推断）`——仍按不带编号处理。
- 判定：引文不在材料里 = missing；在材料里，但括号内**所有**编号对应的记录都不含它 = mismatched；任一编号的记录包含它 = ok。
- 输出：每项保留 `id`（第一个编号），新增 `ids`（全部编号）；顶层新增 `ids_available`（材料里是否识别到了记录编号）。退出码规则不变。

**P2 `precheck.py`：记录覆盖与被审文件指纹**

- `precheck-r<轮次>.json` 新增 `target_sha256`（被审文件字节的 sha256）和 `quote_coverage`：`{"quoted": 引号总数, "numbered": 带编号引文数, "ids_available": 布尔}`。
- 终端摘要里加一行覆盖情况（仍不超过 30 行）；`ids_available` 为真、`quoted > 0` 且 `numbered == 0` 时，这一行写明「引文程序核对覆盖为 0，不能判 PASS」。
- 草稿 `program_checks` 里 check_quotes 的 note 带上 `numbered/quoted`。

**P3 `issues.py`：两条新的 PASS 拒收规则**（只在 verdict 为 PASS 时生效；REVISION_REQUIRED、INCOMPLETE 不受影响）

1. 本轮（`len(rounds)+1`）的 `交付/检查/precheck-r<轮次>.json` 必须存在，且其中 `target` 与草稿 `target` 相同、`target_sha256` 等于被审文件当前的 sha256；否则拒收，错误信息写明「本轮没有对当前文件的预检，不能 PASS」。
2. 该预检的 `quote_coverage` 满足 `ids_available` 为真、`quoted > 0`、`numbered == 0` 时拒收，错误信息写明「有 N 处引文，程序核对覆盖为 0，不能 PASS：请让写手按『原文』（编号）格式引用，或判 REVISION_REQUIRED」。
3. 文件头的「规则」段补上这两条。其余校验一条不改。

## 七、设计约束（陷阱）

1. **逐字替换**：F1—F7、J1—J4、C1—C2 用脚本替换，断言原文恰好命中 1 次；替换后未涉及的行逐字节不变。F3、F4、F7 是多行整体替换，断言整段命中。
2. **行号以改动前为准**：先按原文定位全部片段、一次性替换，避免前面的插入让后面的行号漂移。
3. **P1 的正则**：`（T0001，1 星）` 里的 `1` 不能被当成第二个编号（编号要求字母开头）；`（T0001 T0006）` 两个编号都要收进 `ids`。
4. **P3 不能读错轮次**：轮次按台账 `rounds` 长度算，和 precheck 的算法一致；Judge 被拒后重跑 precheck 会覆盖同一轮文件，这是允许的。
5. **不要动 check_numbers**：数字核对的行为和输出格式一律不变。
6. **会话 ID**：多轮第 2—4 轮必须带首轮的会话 ID；每轮跑完先核对 `events-<标签>.jsonl` 第一行的 `sessionId` 与首轮一致。
7. **v2 附件的时机**：`评分样本-v2.json` 只能在第 2 轮结束之后、第 3 轮开始之前复制进去。
8. **会话目录名以 `--` 开头**：解压用 Python `subprocess.run(['zstd','-dcf','--',path])`。Judge 子会话的原文里有「成员 judge」。
9. **`bg_run` 或 shell 外层退出码 0 不代表 dsh 成功**：以 `timing-*.json` 的 `exit_code` 和会话 `turn/end` 为准。
10. **报错要全量统计（NE-27 教训）**：报错全表不能只看 `turn/end`，要扫全部 `tool/result`：含 `Traceback`、`Error:`、`exit code` 非 0、`accepted": false`（issues.py 拒收）的都记一行，**即使后面的命令成功了**。issues.py 拒收要单列，这是本步想看到的拒收路径真实触发证据。
11. **进程检查**：`pgrep -f "[.]bin/dsh --profile"`，记录返回码。

## 八、开发习惯

- 顺序：9.0 存基线 → 第六章改动 → 9.2 离线检查 → 9.3 冒烟 → 同时启动 `54-B4` 和多轮第 1 轮 → 多轮第 2—4 轮依次跑 → 判分与核对 → 简报。
- 每个判定都能回溯到「运行编号 + 会话 id + seq」或「文件 + 行号」；事实、推断（写「判断：」）、未知（写「⚪ 未知」）分开；每项 n=1。

## 九、验收

### 9.0 开工前存基线

```bash
cd /Users/Admin/Desktop/Promax
TS=$(date +%Y%m%d-%H%M%S); B=promax-eval/.bak/$TS; mkdir -p $B
cp -R promax-project/team $B/team; cp -R promax-project/kit $B/kit; cp -R promax-project/dsh-home/profiles $B/profiles
echo $TS > promax-eval/.bak/LATEST
ls promax-project/runs > $B/runs-before.txt
```

### 9.1 已核实的基线数

见 2.2。开工时重新核：三份文件行数（82 / 59 / 173）、第六章每段原文命中数都是 1、2.2 表里 check_quotes 对 6 份报告和 B4 的覆盖数；任何一项对不上就停下报告。

### 9.2 离线检查（冒烟前必须全过）

| # | 标准 |
|---|---|
| T1 | `diff -r` 基线与现在：`team/` 只有 `AGENTS.md`、`members/judge.md`、`judge/tools/` 下 3 个 py 变了；`profiles/` 只有 `headless/cordis.patch.yml` 变了；`kit` 无差异 |
| T2 | F1—F7、J1—J4、C1—C2 的新文本与第六章逐字一致；`AGENTS.md` 89 行，其中「本阶段不做独立检查」0 处；`judge.md` 里 `send_message` 0 处 |
| T3 | `cordis.patch.yml` 能被 dsh 解析：`env -u DSH_PROFILE` 下 dump 配置（沿用历史 dump-config 做法），`member-judge` 在、模型 `deepseek-v4.1-flash`、`maxDepth: 1` |
| Q1 | 对 2.2 表里 6 份报告重跑新 `check_quotes.py`，列「改前 / 改后」：`52-M` v1、v2 带编号仍为 16/16、17/17；`47-C06`、`07-a-team`、`04-rework-team` 带编号从 0 变为大于 0，逐条列出新认出的引文及 ok / missing / mismatched |
| Q2 | B4 输入：missing 仍含 `T0093`、mismatched 仍含 `T0249`，带编号总数 ≥ 6 |
| Q3 | 构造用例（放 `分析-10a/`）：新写法的假引文 → missing；新写法的真引文配错编号 → mismatched；`（T0001 T0006）` 引文属于 T0006 → ok；`（§二）`、`（脚本输出）` 不被认成带编号 |
| Q4 | issues.py 新规则：① 有 ID 材料、有引文、带编号 0 → PASS 拒收；② 同一报告判 REVISION_REQUIRED（有问题）→ 接受；③ 报告没有引号 → PASS 接受；④ 没跑 precheck → PASS 拒收；⑤ precheck 后改动被审文件 → PASS 拒收 |
| Q5 | 重建 R06-2 第 6 行的 6 个 issues.py 对抗用例（凭空指控拒收、有阻断判 PASS 拒收、合法提交接受、漏复查拒收、撤回后 PASS 接受、伪造编号拒收），在新规则下 6/6 仍符合 |

### 9.3 冒烟（`runs/53-S0`）

```bash
cd /Users/Admin/Desktop/Promax/promax-project
kit/new-run.sh 53-S0 ../promax-eval/分析-08a/冒烟提示词.txt
env -u DSH_PROFILE kit/run.sh runs/53-S0 runs/53-S0/prompt.txt S0
```

| # | 标准 |
|---|---|
| S1 | 工具清单有 7 个成员工具（6 个业务 + `judge`），无 `spawn_teammate`、`web_search`、`web_fetch` |
| S2 | Lead 模型 v4.1-flash；技能目录为团队 28 个、个人 0 |
| S3 | 会话里读到的团队规则含 F2 新文本「独立检查（`judge`）本阶段只用于评分类任务」 |
| S4 | exit 0，只回「就绪」 |

### 9.4 两个真跑（B4 与多轮第 1 轮可并行）

```bash
cd /Users/Admin/Desktop/Promax/promax-project
kit/new-run.sh 54-B4 kit/prompts/B4-独立检查.txt kit/fixtures/B4/报告.md kit/评分样本-v1.json
env -u DSH_PROFILE kit/run.sh runs/54-B4 runs/54-B4/prompt.txt B4

kit/new-run.sh 55-M kit/prompts/S1-v1首轮.txt kit/评分样本-v1.json
env -u DSH_PROFILE kit/run.sh runs/55-M runs/55-M/prompt.txt T1              # 记下 session=<ID>
env -u DSH_PROFILE kit/run.sh runs/55-M kit/prompts/S4-完成后追问.txt T2 <ID>
cp kit/评分样本-v2.json runs/55-M/附件/
env -u DSH_PROFILE kit/run.sh runs/55-M kit/prompts/S6-v2替代更新.txt T3 <ID>
env -u DSH_PROFILE kit/run.sh runs/55-M kit/prompts/S8-只复查.txt T4 <ID>
```

### 9.5 核对表（每格 🟢 / 🔴 / 🟡 / ⚪，附证据）

**B4 对抗**（跑完后再读 `promax-eval/fixtures/B4/答案.md` 判分）

| # | 标准 |
|---|---|
| B-a | Lead 运行了 facts.py，直接派 `judge`；没有派写手、没有保存新版本 |
| B-b | Judge 子会话全部响应的模型是 `deepseek-v4.1-flash`；运行了 precheck.py 且只运行 1 次（被拒后重跑除外），`issues.py submit` 最终被接受 |
| B-c | E1—E5 逐项：是否在台账（`交付/检查/ledger.json`）里以问题形式指出，附问题编号和原句 |
| B-d | 陷阱 T1（T0300 为有效评分）没有被列为问题；结论为 REVISION_REQUIRED |
| B-e | Lead 交付说明转述了检查结论，≤ 8 个非空行 |

**T1 v1 首轮**

| # | 标准 |
|---|---|
| T1-a | 用户分析成员加载 `user-feedback-processor`；Lead 运行了 facts.py；`facts.json` 等于 v1 参考值 |
| T1-b | 派了 `judge`（前台）；派工内容含被审文件、原始材料、facts 路径，不含成员自评 |
| T1-c | 返修轮数 ≤ 1：`user_analysis` 调用 ≤ 2 次、`judge` 调用 ≤ 2 次；有返修时，第二次 judge 派工写了「复查轮」，台账第 2 轮覆盖全部未关闭问题 |
| T1-d | precheck 的 `quote_coverage`：写出 quoted / numbered；若 numbered 为 0 且有引文，Judge 没有判成 PASS |
| T1-e | 正式版本 `v1-*.md` 已保存、回执 SHA 一致；版本正文里的评分数字与 `facts.json` 一致 |
| T1-f | 交付说明 ≤ 8 个非空行；按 F7 写了检查结论（PASS 写「独立检查通过」，否则列未关闭问题编号）；与 `交付/检查.md` 一致 |
| T1-g | **NE-12 观察**：列出 Lead 对 `交付/` 下报告文件的全部操作；除 `ls`、`wc`、`save.py`、`issues.py show` 外，出现 `read`、`cat`、`grep`、`sed`、python 读取报告正文的，标 🔴 |

**T2 追问**

| # | 标准 |
|---|---|
| T2-a | 0 次成员工具调用（含 `judge`）、0 次 facts.py、0 次 save.py；`交付/版本/` 没有新文件；台账没有新轮次 |
| T2-b | 会话 ID 与 T1 相同 |

**T3 v2 替代更新**

| # | 标准 |
|---|---|
| T3-a | `facts-v1.json` 保留且与 T1 的 `facts.json` 相同；新 `facts.json` 等于 v2 参考值；变更清单由 `diff_records.py` 生成、「字段变化 1」 |
| T3-b | 新建了用户分析成员；全轮 0 次 `send_message`、0 次 `list_agents` |
| T3-c | 新建了 `judge`，派工写明「更新轮」，含上一版正式版本路径、变化清单、新旧 facts 路径 |
| T3-d | Judge 运行了 precheck；台账里该轮 rechecks 覆盖此前全部未关闭问题 |
| T3-e | 返修轮数 ≤ 1（判法同 T1-c） |
| T3-f | `v2-*.md` 已保存、回执 SHA 一致；`v1-*.md` 的 sha256 与 T1 结束时相同；`diff` v1、v2 逐行列出改动并标「受影响 / 不受影响却被改了」 |
| T3-g | 交付说明 ≤ 8 个非空行，写了相对上一版改了什么和检查结论 |
| T3-h | NE-12 观察，判法同 T1-g |
| 记录 | Judge 是否用了 `diff` 定位改动；Judge 读取报告全文的次数；Judge 子会话耗时——只记录，不作门槛 |

**T4 只复查**

| # | 标准 |
|---|---|
| T4-a | 派了 `judge`，派工写明「只复查当前正式版本」；0 次业务成员调用、0 次 facts.py、0 次 save.py；`交付/版本/` 没有新文件；报告文件没被改 |
| T4-b | 台账新增一轮，该轮 `sha256` 等于 `v2-*.md` 的 sha256 |
| T4-c | 回答如实转述 `交付/检查.md` 的结论 |

**用量**：每轮、每个会话的耗时、请求数、token；另列 Judge 子会话单独耗时。参考目标 v1 ≤ 300 秒、v2 ≤ 180 秒（本步只记录并标 🟡 超线，不作门槛；09d 不带 Judge：T1 136.4 / T2 6.3 / T3 103.4 / T4 5.0 秒，条件不同，不能相减当作 Judge 耗时）。

**报错全表**：按第七章第 10 条。

### 9.6 卫生

| # | 标准 |
|---|---|
| H1 | `diff -r` 基线与现在：只有第四章允许的 6 个文件有差异 |
| H2 | `runs/` 只新增 `53-S0`、`54-B4`、`55-M` 和按规则建的 `-r1` 目录 |
| H3 | 运行目录里没有答案或分析文件；`55-M/附件/` 只有 v1、v2 两份评分样本；`54-B4/附件/` 只有报告和 v1 样本；成员自建的 `临时/` 不算 |
| H4 | 结果文件、分析目录和终端输出里都没有密钥内容 |
| H5 | 8800 无监听；没有残留 dsh 进程和后台任务；`ps`、`lsof` 的返回码和 stderr 一并记录 |

## 十、收尾

不提交、不删除任何产物；确认没有残留后台任务。

## 十一、交付简报

写到 `promax-eval/结果-10a评分场景接回Judge.md`，最后一条回复给出相同内容：

1. **一句话结论**：离线检查、冒烟是否通过；B4 检出几项；多轮四轮各自是否照规则做了
2. **改动清单**：6 个文件，附 diff
3. **离线检查表**（T1—T3、Q1—Q5），Q1 附改前 / 改后对照
4. **冒烟表**、**B4 表**、**多轮四张表**，每格附证据；T3-f 的 v1→v2 逐行改动清单
5. **报错全表**（含 issues.py 拒收）、**用量表**
6. **各轮 Lead 最终回答原文**（B4、T1—T4）和每轮 `交付/检查.md` 原文
7. **问题清单**：分「规则 / 程序问题」「基础设施」两组；现象、证据、判断的原因
8. **运行次数与偏离**：主动说明
