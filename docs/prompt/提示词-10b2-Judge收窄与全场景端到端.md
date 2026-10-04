# 任务：10b-2 Judge 收窄范围 + 七场景带 Judge 端到端真跑

> 执行方：pi（GPT6-Astra）　·　生成日期：2026-09-28　·　小改 Judge 程序、Judge 角色卡和团队规则一行，然后真跑；**不改业务成员与技能，不提交**（不是 git 仓库）
> 工作目录：`/Users/Admin/Desktop/Promax`
> 配套：任务书 `docs/重新出发/01-指派任务/10-Judge接回任务.md/01-指派任务.md`（D1—D11）；上一轮复核 `docs/重新出发/02-验证记录/10-Judge接回结果.md` 的 R10-2；上一轮 pi 结果 `promax-eval/结果-10b1-Judge全场景机制与对抗.md`

## 一、目标

1. **收窄 Judge**：预检直接给 Judge 该类清单和相关材料片段，Judge 不再读整份规则文件和全部材料；给 K2 降噪；每轮留存被审文件的快照。
2. **引文格式**写进团队规则第 1 条，让成员知道程序认什么写法。
3. 回归两份真实难度的样本（J04、B4），看 Judge 是否降到 90 秒左右、仍然全部检出。
4. **七个场景带 Judge 端到端真跑**（写手 → Judge → 最多返修 1 轮 → 保存）。对照各场景答案，判断成员**这次实际犯了**哪些错、Judge 抓到几个、误报几个，并记录每个场景的总耗时。

## 二、背景（先看懂现状）

### 2.1 为什么做

| 事项 | 现状（R10-2） |
|---|---|
| 对抗样本失真 | 10b-1 的 J01/J02/J03/J05/J07 是 15—34 行片段、错误自我暴露，检出 32/32 不代表真实能力。用户定：不重做样本，改用成员真实成果检验 Judge |
| Judge 超时 | ≤90 秒只有 4/9；全长 J04 为 194.9 秒。J04 的 Judge 读了整份 `rubrics.yml`（8 类）和全部材料；J01 通读 4 份访谈 |
| K2 噪声 | 11 份历史成果上 K2 真问题 9 条、误报 129 条（`promax-eval/分析-10b1/06-history-assessment.md`） |
| 引文格式没告诉成员 | 程序只认「引号 + 紧跟括号、括号第一个词是来源」；C02 的 `[S1-1]`、C03 编号写在引文前、L01 痛点用破折号，可核对覆盖都是 0，Judge 永远判不了 PASS；团队规则第 1 条没写格式 |
| 真跑从没走过返修路径 | 10a、10b-1 真跑里 Lead 都没有走「REVISION_REQUIRED → 新建写手返修 → 复查 → 保存」 |
| 被审文件没有快照 | 返修会覆盖 `交付/<文件名>`，事后无法还原 Judge 第 1 轮看到的版本 |

### 2.2 已核实的事实（Claude 实测，2026-09-28）

| 项 | 事实 |
|---|---|
| 文件行数 | `team/AGENTS.md` 90 行；`team/members/judge.md` 60 行；`team/judge/rubrics.yml` 143 行 |
| 团队规则第 1 条 | `team/AGENTS.md` 第 12 行（原文见 6.4） |
| 现有 Judge 程序 | `team/judge/tools/`：`check_numbers.py`、`check_quotes.py`、`group_checks.py`、`group_submit.py`、`issues.py`、`mechanical.py`、`precheck.py`、`source_checks.py` |
| 场景提示词 | `kit/prompts/C01-客研.txt`、`C02-竞品探索.txt`、`C03-需求管理.txt`、`C04-产品方案.txt`、`C05-需求评审.txt`、`L01-联合链路.txt`；**C06 用 `kit/prompts/S1-v1首轮.txt` + `kit/评分样本-v1.json`** |
| 场景材料 | `kit/fixtures/scenarios/<C01…L01>/` |
| 场景答案 | `promax-eval/fixtures/scenarios/<C01…C06、L01>/答案.md`。其中「链路通过的最低标准」里的「没有派 judge」「交付说明写明本版未经独立检查」**已被 D1/D6 取代，本轮不按这两条判** |
| 不带 Judge 的历史耗时（秒，n=1 或 2） | C01 188.1；C02 280.5 / 372.1；C03 162.2；C04 515.8 / 311.8；C05 486.1；C06 72.0；L01 1369.7 |
| 10b-1 Judge 耗时（秒） | J04 194.9；B4 84.3 |
| 运行目录 | 最后一个是 `runs/63-B4`；本轮从 64 号开始 |

## 三、已拍板的规则（不要改）

| # | 决定 |
|---|---|
| D2 | Judge 只用 `deepseek-v4.1-flash` |
| D4 | 只在产出新正式版本时派 Judge；每版最多返修 1 轮，复查后仍不是 PASS 就保存并在交付说明列出未关闭问题；追问不审 |
| D6 | 能程序判定的交给程序；Judge 只审语义，只看程序圈出的点和该类清单；业务取舍放 `decisions` |
| D7 | 单次 Judge ≤ 90 秒（记录并判 🟢/🔴，不因超时重跑或调参）；场景整体耗时本轮只记录，不设门槛 |
| D8 | L01 每步都审 |
| D9 | Judge 只核评审意见能否站住，不重做评审 |
| R10-2 用户确认（09-28） | 不重做对抗样本，用成员真实成果检验 Judge；进端到端前先收窄 Judge、给 K2 降噪；团队规则第 1 条加引文格式 |
| — | 第六章给了原文和替换文本的逐字照写，原文对不上就停下报告；只给行为规格的按规格实现 |
| — | 运行命令都用 `env -u DSH_PROFILE`；外层最多 3 个并行；基础设施失败（网关 400/429、上游不可用、进程崩溃）只重跑 1 次（目录加 `-r1`）；质量、速度、行为不达标不重跑、不调参 |
| — | 时间上限：C01—C06 每场 30 分钟，L01 60 分钟；超时停掉并记 🔴 超时，保留已有产物 |

## 四、边界

### ✅ 允许修改

- `promax-project/team/judge/tools/*.py`（可新增）
- `promax-project/team/members/judge.md`
- `promax-project/team/AGENTS.md` 第 12 行（6.4）
- 用 `kit/new-run.sh` 新建 `runs/64-S0`、`65-J04`、`66-B4`、`67-C01`、`68-C02`、`69-C03`、`70-C04`、`71-C05`、`72-C06`、`73-L01`（及按规则的 `-r1`）
- 写 `promax-eval/分析-10b2/`、`promax-eval/结果-10b2-Judge收窄与全场景端到端.md`；在 `promax-eval/.bak/` 下存基线

### 🔴 禁止

- 业务角色卡、`team/skills/**`、`team/tools/**`、`team/judge/rubrics.yml`、`team/route-a/**`、`team/README.md`、`kit/**`（只读）、`dsh-home/profiles/**`、`dsh-home/AGENTS.md`、dsh 源码、`old-version/**`、`docs/**`
- 把答案或分析文件放进 `promax-project/`；删除、复用或往 63 号及以前的运行目录放东西
- 程序里写死样本或场景专用的字符串、编号、文件名
- 读取或打印凭据；读 `~/.dsh-promax-first/**`；`dsh plugin`；启动 8800

### ⚪ 明确不做

- 重做对抗样本；改 rubrics 清单内容；改 profile 或模型；并行/后台优化；每场景补跑到 3 次（下一步）
- NE-12 返修（只观察）；界面；联网

## 五、必读

1. `team/AGENTS.md`、`team/members/judge.md`、`team/judge/rubrics.yml`、`team/judge/tools/` 全部程序
2. R10-2 结论页；`promax-eval/结果-10b1-Judge全场景机制与对抗.md` 第 3、4、6 节；`promax-eval/分析-10b1/06-history-assessment.md`（K2 逐条判定）
3. 7 个场景的提示词、材料和 `答案.md`
4. 10b-1 的离线用例与脚本（`promax-eval/分析-10b1/` 下 `02-core-tests.py`、`03-legacy-offline.py`、`04-offline.py`、`15-general-edge-tests.py` 等），复制后再改

## 六、改造规格

### 6.1 预检给 Judge 清单和材料片段（行为规格）

`precheck.py` 的检查组模式在预检 JSON 和终端摘要里新增：

1. **`checklist`**：`rubrics.yml` 里该成果类型 `by: judge` 的清单项原文（三件套给 prd/diagram/prototype 三节的 judge 项）。Judge 不再需要打开 `rubrics.yml`。
2. **`excerpts`**：Judge 需要看的材料片段，每段标文件和行号：
   - 每条 flag、每条引文核对结果：被审文件该行上下各 3 行；能归属来源的，加来源命中行上下各 2 行；
   - 被审文件里引用了材料编号或来源标签的句子：对应来源的命中行上下各 2 行；
   - 更新轮：`scope` 行对应的片段。
   - 片段合并去重，总量上限 400 行；超出时按 flag → 引文 → 其他排序截断，并在 JSON 里写明截断了多少。
3. **快照**：每次预检把组内每个被审文件复制到 `交付/检查/<组名>/被审-r<轮次>/`（原文件名），JSON 记录快照路径与 sha256。

### 6.2 K2 降噪（行为规格，通用规则）

目标：在 10b-1 的同一批 11 份历史成果上，**误报从 129 条降到 26 条以下（降 80%），9 条真问题不丢**。做不到就如实报告实际数字和丢了哪几条，不硬凑。可用的通用手段举例（自行选择并说明）：只标带单位或统计语境的数字（%、条、人、次、元、MB、天、小时等）；排除可由材料数字直接算出的比例与合计；排除明显的示例、序号、版本号。

### 6.3 `judge.md`（按行为规格改，保持现有结构和语气）

1. 清单从预检 JSON 的 `checklist` 读，**不读 `rubrics.yml`**。
2. 材料从 `excerpts` 看；只有某条判断必须看更多上下文时才读原材料，全轮最多 2 次，并在 summary 写明读了什么、为什么。
3. 被审文件本身可以通读一次。
4. 其余已有规则（不写核对脚本、不重跑 facts.py、90 秒、更新轮只看 scope）保留。

### 6.4 `team/AGENTS.md` 第 12 行（逐字替换）

原文：

```text
1. 数字只来自程序输出（facts.json 或可复算的脚本），不心算；引文逐字复制并附来源编号。引号只用来逐字引用原文，并紧跟来源编号；自己的概括、路径名、分类名不加引号。
```

替换为：

```text
1. 数字只来自程序输出（facts.json 或可复算的脚本），不心算。引文逐字复制，写成 `"原文"（来源）`：括号紧跟在引号后，括号里第一个词是来源——记录编号（如 T0001、REQ-004）、访谈编号（如 IV-01）或材料文件名（如 墨舟笔记），后面可以加说明（如 `（T0001，1 星）`）。引号只用来逐字引用原文；自己的概括、路径名、分类名不加引号。
```

改完仍是 90 行，diff 只有第 12 行。

## 七、设计约束（陷阱）

1. **不改变判定结果**：6.1、6.2 只改变给 Judge 的材料和 K2 的命中范围，不改 K1、K3—K10、引文核对和 issues.py 的判定规则。10a、10b-1 的离线用例必须全过；对 10b-1 冻结的 8 个检查组重跑预检，除 K2 和新增字段外，flags 与引文结果必须和 10b-1 相同。
2. **不照样本写**：K2 降噪规则必须通用；验收会 grep 专有词。
3. **判「成员实际犯没犯错」看快照**：以 `被审-r1/` 里 Judge 第 1 轮看到的版本为准，不看返修后的正式版本。
4. **判 Judge 抓没抓到**：以该组台账第 1 轮的问题为准；同一个错误被拆成多条算抓到一次。
5. **误报**：台账里每条问题都要判「成立 / 不成立 / 无法判定」，附成果行号和材料依据；答案里的「其他核对点（不作为缺陷）」和陷阱被列成阻断问题的，算误报。
6. **L01 很长**：每步写手 + Judge + 可能的返修，预计 30 分钟以上；按 60 分钟上限执行，不要中途干预。
7. 会话目录名以 `--` 开头，解压用 `subprocess.run(['zstd','-dcf','--',path])`；以 `timing-*.json` 的 `exit_code` 和 `turn/end` 判成败。
8. **报错全表**：扫全部 `tool/result`，含 `Traceback`、`Error:`、非 0 退出、`"accepted": false` 的都记，即使后面成功了；issues.py 拒收单列。

## 八、开发习惯

- 顺序：9.0 存基线 → 6.1—6.4 → 9.2 离线 → 9.3 冒烟 → 9.4 回归（J04、B4）→ 9.5 七场景（外层 ≤3 并行，L01 尽早开始）→ 判分 → 简报。
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

见 2.2。开工时重新核：三份文件行数（90 / 60 / 143）、6.4 原文命中 1 次、K2 在 11 份历史成果上的命中数（真 9 / 误 129）。对不上就停下报告。

### 9.2 离线检查（冒烟前必须全过）

| # | 标准 |
|---|---|
| T1 | `diff -r`：只有第四章允许的文件有差异；`kit`、`profiles`、`rubrics.yml` 无差异 |
| T2 | 6.4 逐字一致；`AGENTS.md` 90 行，diff 只有第 12 行 |
| T3 | 10a、10b-1 离线用例全过 |
| T4 | 10b-1 冻结的 8 个检查组重跑预检：除 K2 与新增字段外，flags、引文结果与 10b-1 真跑时逐项相同 |
| T5 | K2 在 11 份历史成果上：改前 / 改后的真问题与误报数，逐条列出丢掉的真问题（如有） |
| T6 | `checklist` 与 `rubrics.yml` 的 judge 项逐字一致；`excerpts` 不超过 400 行，并在 J04 上列出实际行数；快照 sha 与被审文件一致 |
| T7 | grep 程序：0 处样本/场景专有词 |

### 9.3 冒烟（`runs/64-S0`）

同 10b-1 的 9.4；另确认会话里读到的团队规则含 6.4 新文本「写成 `"原文"（来源）`」。

### 9.4 回归（`runs/65-J04`、`66-B4`）

```bash
cd /Users/Admin/Desktop/Promax/promax-project
kit/new-run.sh 65-J04 kit/prompts/J04-独立检查.txt kit/fixtures/judge/J04/* kit/fixtures/scenarios/C04/*
kit/new-run.sh 66-B4 kit/prompts/B4-独立检查.txt kit/fixtures/B4/报告.md kit/评分样本-v1.json
```

| # | 标准 |
|---|---|
| G-a | 检出：J04 4/4、B4 5/5；陷阱不入台账；REVISION_REQUIRED |
| G-b | Judge 耗时：写实际秒数，与 10b-1（194.9 / 84.3）对比；≤ 90 秒为 🟢 |
| G-c | Judge 没有读 `rubrics.yml`；读原材料次数 ≤ 2 且 summary 写明原因；没有自写核对脚本、没有重跑 facts.py |

### 9.5 七场景端到端（`runs/67-C01` … `73-L01`）

```bash
cd /Users/Admin/Desktop/Promax/promax-project
S=kit/fixtures/scenarios
kit/new-run.sh 67-C01 kit/prompts/C01-客研.txt $S/C01/*
kit/new-run.sh 68-C02 kit/prompts/C02-竞品探索.txt $S/C02/*
kit/new-run.sh 69-C03 kit/prompts/C03-需求管理.txt $S/C03/*
kit/new-run.sh 70-C04 kit/prompts/C04-产品方案.txt $S/C04/*
kit/new-run.sh 71-C05 kit/prompts/C05-需求评审.txt $S/C05/*
kit/new-run.sh 72-C06 kit/prompts/S1-v1首轮.txt kit/评分样本-v1.json
kit/new-run.sh 73-L01 kit/prompts/L01-联合链路.txt $S/L01/*
env -u DSH_PROFILE kit/run.sh runs/<目录> runs/<目录>/prompt.txt <标签>
```

每个场景一张表（L01 每一步一张），每格 🟢 / 🔴 / 🟡 / ⚪，附证据：

| # | 标准 |
|---|---|
| E-a | 流程：写手 → Judge（成果类型与团队规则对照表一致）→ 按结论返修至多 1 轮 → 保存；L01 每步都派了 Judge，下一步派工写了上一步正式版本路径 |
| E-b | **成员实际犯的错**：按该场景答案的每个埋点，对照 `被审-r1/` 快照判「犯了 / 没犯 / 无法判定」，附行号 |
| E-c | **Judge 抓到**：犯了的错里，Judge 第 1 轮台账抓到几个（x / n），逐条附问题编号；漏掉的写明原因判断 |
| E-d | **误报**：台账每条问题判「成立 / 不成立 / 无法判定」；陷阱和「其他核对点」被列成阻断问题的计入误报 |
| E-e | **返修路径**：是否触发；触发的写清复查轮每个问题的 fixed / withdrawn / open，最终保存的版本和交付说明里有没有列未关闭问题 |
| E-f | **引文格式**：成员是否按 6.4 写法引用；可核对覆盖 x / 引号数；覆盖为 0 导致 PASS 被拒的写明 |
| E-g | Judge 每次耗时（≤ 90 秒 🟢）；场景总耗时，与 2.2 的历史不带 Judge 耗时并列（只记录） |
| E-h | Judge 没有读 `rubrics.yml`、读原材料 ≤ 2 次、没有自写核对脚本；Lead 没有读成果正文或复算（NE-12 观察） |
| E-i | 交付说明 ≤ 8 个非空行；按检查组如实写结论；有未关闭问题时列出编号 |

汇总表：七场景的「成员犯错数 / Judge 抓到数 / 误报数 / 返修是否触发 / Judge 最长耗时 / 场景总耗时」。

### 9.6 卫生

| # | 标准 |
|---|---|
| H1 | `diff -r` 基线与现在：只有第四章允许的文件有差异 |
| H2 | `runs/` 只新增 64—73 和按规则的 `-r1` |
| H3 | `promax-project/` 下没有答案或分析文件 |
| H4 | 结果、分析、终端输出里没有密钥 |
| H5 | 8800 无监听；无残留 dsh 进程和后台任务 |

## 十、收尾

不提交、不删除任何产物；确认没有残留后台任务。

## 十一、交付简报

写到 `promax-eval/结果-10b2-Judge收窄与全场景端到端.md`，最后一条回复给出相同内容：

1. **一句话结论**：离线是否全过；J04、B4 回归的检出与耗时；七场景汇总表
2. **改动清单**（附 diff）；6.1 的片段规则与截断实测；6.2 的 K2 规则与改前 / 改后
3. **离线表**（T1—T7）、冒烟表、回归表（G-a—G-c）
4. **七场景逐表**（E-a—E-i），含成员犯错清单、Judge 台账逐条判定
5. **用量表**（每运行、每个 Judge 子会话）、**报错全表**
6. **各运行 Lead 最终回答原文**和各检查组 `检查.md` 原文
7. **问题清单**：「规则 / 程序问题」「基础设施」两组
8. **运行次数与偏离**：主动说明
