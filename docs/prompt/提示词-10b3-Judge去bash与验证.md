# 任务：10b-3 拿掉 Judge 的 bash，改由 Lead 跑预检与提交，并验证

> 执行方：pi（GPT6-Sol）　·　生成日期：2026-09-28　·　改 profile 一处、团队规则 6 行、Judge 角色卡、来源标签一处小修，然后真跑 4 场；**不改业务成员与技能，不提交**（不是 git 仓库）
> 工作目录：`/Users/Admin/Desktop/Promax`
> 配套：任务书 `docs/重新出发/01-指派任务/10-Judge接回任务.md/01-指派任务.md`；上一轮复核 `docs/重新出发/02-验证记录/10-Judge接回结果.md` 的 R10-3；上一轮 pi 结果 `promax-eval/结果-10b2-Judge收窄与全场景端到端.md`

## 一、目标

1. **拿掉 Judge 的 bash**（用户 09-28 拍板「拿掉」）：Judge 只保留 read / write / edit，没法再执行任何脚本。
2. 预检和提交改由 Lead 执行（和它现在跑 facts.py、save.py 一样，只是执行程序）；Judge 只读预检结果、材料片段和被审文件，写草稿。
3. 顺带修一处来源标签：写手写 `（竞品-墨舟笔记.md）` 这种带前缀和扩展名的文件名也要认。
4. 真跑 J04、B4、C01，看 Judge 是否降到 90 秒左右、检出是否不变、C01 总耗时降了多少。

## 二、背景（先看懂现状）

### 2.1 为什么做

| 事项 | 现状（R10-3） |
|---|---|
| Judge 自写脚本 | 每个 Judge 会话自写 3—12 段 Python；「不写脚本」在角色卡里写了三轮都没管住 |
| Judge 太慢 | J04 200.8 秒、B4 92.2 秒、C01 两次 147.9/181.7 秒、C02 两次 293.2/297.8 秒；目标 ≤ 90 秒 |
| 场景总耗时 | C01 1349.4 秒（不带 Judge 188.1）；C02 1256.6 秒（原 280.5/372.1） |
| dsh 能力 | 10b-1 查证：成员工具支持 `toolFilter.allow/deny` 按工具名过滤（`deepseek-harness/packages/subagent/tool-subagent/src/index.ts:82—92,125—130,518—524`），不能限制 bash 命令 |
| C02 引文 0/88 | 写手写 `（竞品-墨舟笔记.md）`，程序只认 `竞品-墨舟笔记`、`墨舟笔记`，不认带扩展名的写法 |

### 2.2 已核实的事实（Claude 实测，2026-09-28）

| 项 | 事实 |
|---|---|
| profile | `dsh-home/profiles/headless/cordis.patch.yml` 第 180—181 行：`toolFilter:` / `allow: [read, write, edit, bash]` |
| 文件行数 | `team/AGENTS.md` 90 行；`team/members/judge.md` 60 行 |
| 来源标签代码 | `team/judge/tools/source_checks.py` 第 45—51 行：`stem`、去前缀的 `main`、文件名中的编号 |
| 预检输出 | 检查组模式的预检 JSON 已含 `flags`、`scope`、`ledger_open_issues`、`checklist`、`excerpts`、`excerpt_stats`、被审快照 |
| 草稿格式说明 | 只在 `team/judge/tools/issues.py` 文件头 |
| 基线耗时 | 见 2.1；10b-1：J04 194.9、B4 84.3 |
| 运行目录 | 最后一个是 `runs/73-L01`（69—72 为已建未跑的目录，不动）；本轮从 74 号开始 |

## 三、已拍板的规则（不要改）

1. Judge 不能有 bash；只保留 `read`、`write`、`edit`。
2. Lead 只执行预检和提交程序、传路径，**不读预检内容、不据此判断**（NE-12）。
3. Judge 模型 `deepseek-v4.1-flash`；每版最多返修 1 轮；单次 Judge ≤ 90 秒（记录并判 🟢/🔴）。
4. 第六章给了原文和替换文本的逐字照写，原文对不上就停下报告；只给行为规格的按规格实现。
5. 运行命令都用 `env -u DSH_PROFILE`；外层最多 3 个并行；基础设施失败只重跑 1 次（目录加 `-r1`）；质量、速度、行为不达标不重跑、不调参；J04、B4 每场 20 分钟、C01 30 分钟上限。

## 四、边界

### ✅ 允许修改

- `promax-project/dsh-home/profiles/headless/cordis.patch.yml` 第 181 行（6.1）
- `promax-project/team/AGENTS.md` 第 53、55、58、62、75、77 行（6.2）
- `promax-project/team/members/judge.md`（6.3）
- `promax-project/team/judge/tools/source_checks.py`（6.4）；如预检 JSON 缺 6.3 需要的字段，可改 `group_checks.py`
- 用 `kit/new-run.sh` 新建 `runs/74-S0`、`75-J04`、`76-B4`、`77-C01`（及 `-r1`）
- 写 `promax-eval/分析-10b3/`、`promax-eval/结果-10b3-Judge去bash与验证.md`；在 `promax-eval/.bak/` 下存基线

### 🔴 禁止

- 上面以外的产品文件：业务角色卡、`team/skills/**`、`team/tools/**`、`rubrics.yml`、`issues.py` 的判定规则、`kit/**`、其他 profile、dsh 源码、`old-version/**`、`docs/**`
- 把答案或分析文件放进 `promax-project/`；动 73 号及以前的运行目录（含已建未跑的 69—72）
- 读取或打印凭据；读 `~/.dsh-promax-first/**`；`dsh plugin`；启动 8800

### ⚪ 明确不做

- K2 进一步降噪；C02—C06、L01 重跑；每场景补到 3 次；界面

## 五、必读

1. `team/AGENTS.md`、`team/members/judge.md` 全文；`team/judge/tools/issues.py` 文件头、`group_checks.py`、`source_checks.py`
2. R10-3 结论页；`promax-eval/结果-10b2-Judge收窄与全场景端到端.md`
3. `promax-eval/fixtures/scenarios/C01/答案.md`、`promax-eval/fixtures/judge/J04/答案.md`、`promax-eval/fixtures/B4/答案.md`（判分时读）
4. 10b-2 的离线用例与脚本（`promax-eval/分析-10b2/`），复制后再改

## 六、改造规格

### 6.1 profile 第 181 行

原文：

```text
          allow: [read, write, edit, bash]
```

替换为：

```text
          allow: [read, write, edit]
```

### 6.2 `team/AGENTS.md`（逐字替换，改动前行号）

**B1** 第 53 行，原文：

```text
5. **独立检查**：调用成员工具 `judge`（前台）。派工写：用户要求原文、被审文件、原始材料路径（多成员任务把上游成果的正式版本也列进来）、事实文件路径（有才写）、成果类型；不要把成员的自评或你的看法告诉 Judge。产品方案的 PRD、流程图、原型三份一起交给同一个 judge，PRD 排第一。Judge 返回后运行 `python3 <team>/judge/tools/issues.py show <检查组>` 读结论。
```

替换为：

```text
5. **独立检查**：先运行预检 `python3 <team>/judge/tools/precheck.py <被审文件...> --kind <成果类型> [--facts <facts 路径>] [--previous <上一版正式版本>] --sources <原始材料...>`（多成员任务把上游成果的正式版本也列进 `--sources`；产品方案三件套一起、PRD 排第一），只取它打印的预检 JSON 和草稿路径，不据预检内容做判断。再调用成员工具 `judge`（前台），派工写：用户要求原文、被审文件、预检 JSON 路径、草稿路径；不要把成员的自评或你的看法告诉 Judge。Judge 返回后运行 `python3 <team>/judge/tools/issues.py submit <草稿路径>`：被拒时新建 judge，把拒收错误原文和同一草稿路径交给它改一次再提交，仍被拒就按第 4 节写「本版未完成独立检查」；接受后运行 `python3 <team>/judge/tools/issues.py show <检查组>` 读结论。
```

**B2** 第 55 行，原文：

```text
6. **返修最多一轮**：结论是 REVISION_REQUIRED 时，新建同一角色的成员，把 `issues.py show` 输出里的阻断问题（编号、原句、修改建议）原样交给它修改一次；再新建 judge，派工写明「这是复查轮」，复查一次。复查后仍不是 PASS，就不再返修，带着未关闭问题进入保存。
```

替换为：

```text
6. **返修最多一轮**：结论是 REVISION_REQUIRED 时，新建同一角色的成员，把 `issues.py show` 输出里的阻断问题（编号、原句、修改建议）原样交给它修改一次；再按第 5 步重新预检、新建 judge（派工写明「这是复查轮」）并提交。复查后仍不是 PASS，就不再返修，带着未关闭问题进入保存。
```

**B3** 第 58 行，原文：

```text
- **只要求独立检查**（用户给了现成成果，只要检查、不要改）：评分类先运行 facts.py；再直接派 judge 审附件里的成果，成果类型按上表判断；附件里有多份不同步骤的成果时，每份（三件套算一份）各派一个 judge；不派写手、不返修、不保存新版本，交付说明转述各检查组 `检查.md` 的结论。
```

替换为：

```text
- **只要求独立检查**（用户给了现成成果，只要检查、不要改）：评分类先运行 facts.py；再按第 5 步对附件里的成果预检、派 judge、提交，成果类型按上表判断；附件里有多份不同步骤的成果时，每份（三件套算一份）各走一遍；不派写手、不返修、不保存新版本，交付说明转述各检查组 `检查.md` 的结论。
```

**B4** 第 62 行，原文：

```text
- Lead 不自己核对成果内容，不复算：派 Judge 前不读成果正文；Judge 提交后不重跑 facts.py、`check_*` 或 precheck。
```

替换为：

```text
- Lead 不自己核对成果内容，不复算：不读成果正文；预检只按第 3 节第 5 步每轮运行一次，不另跑 `check_*`，不据预检内容自己下判断。
```

**B5** 第 75 行，原文：

```text
  4. 新建 judge，派工写：上一版正式版本路径、被审文件、变化清单、新旧 facts 路径（有才写）、新材料路径、成果类型，并写明「这是更新轮：按变化清单检查受影响部分，并复查台账」。返修规则同第 3 节第 6 步。
```

替换为：

```text
  4. 按第 3 节第 5 步做独立检查：预检加 `--previous <上一版正式版本>`，judge 派工写明「这是更新轮：按变化清单检查受影响部分，并复查台账」，并附变化清单、新旧 facts 路径（有才写）。返修规则同第 3 节第 6 步。
```

**B6** 第 77 行，原文：

```text
- **只复查**（用户要求不改内容、重新检查）：新建 judge，派工写明「只复查当前正式版本」、被审文件、原始材料、facts 路径（有才写）和成果类型；不派写手、不重算、不保存新版本；把该检查组 `检查.md` 的结论如实告诉用户。
```

替换为：

```text
- **只复查**（用户要求不改内容、重新检查）：按第 3 节第 5 步对当前正式版本预检、派 judge（派工写明「只复查当前正式版本」）、提交；不派写手、不重算、不保存新版本；把该检查组 `检查.md` 的结论如实告诉用户。
```

改完仍是 90 行，diff 只落在这 6 行。

### 6.3 `judge.md`（按行为规格改写，保持现有的判断纪律、C1—C5、领域规则说明和语气）

1. 开头写明：你只有 read、write、edit 三个工具，不能执行任何程序；预检和提交由 Lead 完成。
2. **输入**：用户要求原文、被审文件、预检 JSON 路径、草稿路径；更新轮另有变化清单、新旧 facts 路径；复查轮或提交被拒时，另有拒收错误原文。
3. **顺序**：read 预检 JSON（`flags`、引文结果、数字待确认行、`checklist`、`excerpts`、`excerpt_stats`、`scope`、`ledger_open_issues`）→ read 被审文件一次 → 只有某条判断必须补上下文时才 read 原材料，全轮最多 2 次，并在 summary 写明读了什么、为什么 → read 草稿后 edit/write 填 verdict / summary / issues / rechecks / decisions → 最终回复：结论、阻断问题数、草稿路径。
4. **草稿格式**：把 `issues.py` 文件头的草稿格式和拒收规则抄进角色卡（Judge 不能再运行 `issues.py`），包括「quoted 原句必须逐字存在于被审文件」「复查必须覆盖全部未关闭问题」「有阻断问题不能 PASS」「覆盖为 0 不能 PASS」。
5. 删除所有要求 Judge 运行 `precheck.py`、`issues.py`、`python3`、脚本、临时目录的内容。
6. 90 秒目标保留；程序没覆盖又必须计算的内容，写进 summary 的「未验证」，不自己算。

### 6.4 来源标签（行为规格）

`source_checks.py` 的来源标签在现有 `stem`、去前缀 `main`、文件名编号之外，再认：完整文件名（含扩展名，如 `竞品-墨舟笔记.md`）和去前缀后带扩展名的名字（如 `墨舟笔记.md`）。通用规则，不写死任何名字。

## 七、设计约束（陷阱）

1. **提交被拒的循环**：Lead 最多新建 1 次 judge 修草稿；再被拒不再循环，按 B1 写「本版未完成独立检查」。
2. **不改判定**：6.3、6.4 不改程序判定规则；10a、10b-1、10b-2 的离线用例必须全过；10b-1 冻结的 8 个检查组重跑预检，除引文来源标签新增外，flags 与引文结果不变。
3. **Lead 的预检输出**：预检终端摘要会打印 flags 概况；验收看 Lead 是否据此改写问题、自己下判断或读成果正文（NE-12）。
4. 会话目录名以 `--` 开头，解压用 `subprocess.run(['zstd','-dcf','--',path])`；以 `timing-*.json` 的 `exit_code` 和 `turn/end` 判成败。
5. **报错全表**：扫全部 `tool/result`，含 `Traceback`、`Error:`、非 0 退出、`"accepted": false` 的都记，即使后面成功了；issues.py 拒收单列。

## 八、开发习惯

- 顺序：9.0 存基线 → 6.1—6.4 → 9.2 离线 → 9.3 冒烟 → 同时启动 J04、B4、C01 → 判分 → 简报。
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

见 2.2。开工时重新核：两份文件行数（90 / 60）、6.1 与 B1—B6 原文各命中 1 次；对不上就停下报告。

### 9.2 离线检查

| # | 标准 |
|---|---|
| T1 | `diff -r`：只有第四章允许的文件有差异 |
| T2 | 6.1、B1—B6 逐字一致；`AGENTS.md` 90 行 |
| T3 | `judge.md` 里 `python3`、`precheck.py`、`issues.py submit`、`临时/`、`bash` 作为 Judge 要执行的动作出现 0 处；草稿格式与拒收规则完整 |
| T4 | 10a、10b-1、10b-2 离线用例全过；8 个冻结组的非来源标签结果不变 |
| T5 | 6.4：`（竞品-墨舟笔记.md）`、`（墨舟笔记.md）` 都能归属；对 `runs/68-C02` 的 `被审-r1` 快照重跑，报告可核对覆盖改前 / 改后 |

### 9.3 冒烟（`runs/74-S0`）

同 10b-2；另从会话配置或一次 Judge 调用的工具清单证明 judge 只有 read、write、edit（S0 没有 Judge 调用时，在 9.4 的 Judge 会话 `request/header` 里证明）。

### 9.4 真跑（`75-J04`、`76-B4`、`77-C01`，可同时启动）

```bash
cd /Users/Admin/Desktop/Promax/promax-project
kit/new-run.sh 75-J04 kit/prompts/J04-独立检查.txt kit/fixtures/judge/J04/* kit/fixtures/scenarios/C04/*
kit/new-run.sh 76-B4 kit/prompts/B4-独立检查.txt kit/fixtures/B4/报告.md kit/评分样本-v1.json
kit/new-run.sh 77-C01 kit/prompts/C01-客研.txt kit/fixtures/scenarios/C01/*
env -u DSH_PROFILE kit/run.sh runs/<目录> runs/<目录>/prompt.txt <标签>
```

| # | 标准（每场一张表，附证据） |
|---|---|
| V-a | Judge 会话工具清单只有 read、write、edit；0 次执行命令 |
| V-b | Lead 每轮运行 1 次预检、Judge 返回后运行 submit；被拒的处理符合 B1 |
| V-c | 检出：J04 4/4、B4 5/5，陷阱不入台账；结论 REVISION_REQUIRED |
| V-d | **Judge 每次耗时**（≤ 90 秒 🟢），与 R10-3 的 200.8 / 92.2 / 147.9、181.7 并列 |
| V-e | Judge 读原材料次数 ≤ 2，且 summary 写明原因 |
| V-f | Lead 没有读成果正文、没有据预检内容改写或增删问题（NE-12） |
| V-g | C01：成员实际犯了答案里哪些错（看 `被审-r1/` 快照）、Judge 第 1 轮抓到几个、误报几个；返修是否触发及结果 |
| V-h | C01 总耗时，与 1349.4（10b-2）和 188.1（不带 Judge）并列；拆出写手、Judge、Lead 各自耗时 |
| V-i | 交付说明 ≤ 8 个非空行，如实写检查结论 |

### 9.5 卫生

| # | 标准 |
|---|---|
| H1 | `diff -r` 基线与现在：只有第四章允许的文件有差异 |
| H2 | `runs/` 只新增 74—77 和按规则的 `-r1` |
| H3 | `promax-project/` 下没有答案或分析文件 |
| H4 | 结果、分析、终端输出里没有密钥 |
| H5 | 8800 无监听；无残留 dsh 进程和后台任务 |

## 十、收尾

不提交、不删除任何产物；确认没有残留后台任务。

## 十一、交付简报

写到 `promax-eval/结果-10b3-Judge去bash与验证.md`，最后一条回复给出相同内容：

1. **一句话结论**：Judge 是否已无法执行命令；J04、B4、C01 的 Judge 耗时与检出；C01 总耗时
2. **改动清单**（附 diff）
3. **离线表**（T1—T5）、冒烟表
4. **真跑表**（V-a—V-i），含 C01 成员犯错与 Judge 台账逐条判定
5. **用量表**（每运行、每个会话）、**报错全表**
6. **各运行 Lead 最终回答原文**和各检查组 `检查.md` 原文
7. **问题清单**与**运行次数与偏离**
