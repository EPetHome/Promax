# 任务：专家团 dsh 适配（6 项）+ 切换默认入口 + 7 场景回归

> 执行方：pi　·　生成日期：2026-09-26　·　改角色卡、技能里的旧宿主写法、团队规则和默认 profile，再用原 7 个场景回归；**业务方法一字不动，不提交**
> 工作目录：`/Users/Admin/Desktop/Promax`（不是 git 仓库）。下文相对路径都以它为根

## 一、目标

用户的主线（2026-09-26）：「不用你管能力，现在是在做智能体到 dsh 的适配。」

专家团（6 个业务成员 + 28 个技能）是从旧平台搬过来的，场景摸底（任务 08）证明它在 dsh 上能跑通，但有 6 类**宿主不匹配**。本轮把它们改掉，并把路线 A 切成默认入口，然后用原 7 个场景回归。

| # | 适配项 | 一句话 |
|---|---|---|
| 1 | 成员回报方式 | 角色卡里「send_message 给 lead」「交 Judge」改成「最终回复返回」「检查由 Lead 安排」 |
| 2 | 技能去旧宿主 | 旧平台工具名、`report(...)` 工具、每轮强制遥测、旧平台身份识别、旧目录，改成 dsh 下的写法 |
| 3 | 技能入口对上任务 | 用户分析以 `user-feedback-processor` 为入口、用户口径优先；需求管理写明本地整理没有适用技能 |
| 4 | facts 只在评分统计任务跑 | 访谈、竞品、需求池、PRD 任务不跑 facts.py |
| 5 | 成果和状态分开 | 成果正文不写保存状态；交付说明 ≤ 8 行、不与成果矛盾、工具报错也要说；缺工具写「未运行」，不去翻系统目录 |
| 6 | 默认入口 | `profiles/headless` 换成路线 A（6 个成员工具、无 Judge、无联网）；团队规则换成新规则；旧的 Agent Teams 版归档 |

**回归只看适配指标**（第九章 9.4），内容质量照旧记录，但**不作为通过门槛**。

## 二、背景（先看懂现状）

### 2.1 现在的结构

```text
promax-project/
├─ team/
│   ├─ AGENTS.md              现役规则：Agent Teams + Judge 版（本轮归档替换）
│   ├─ route-a/AGENTS.md      路线 A + Judge 版（保留，以后接回 Judge 用）
│   ├─ route-s/AGENTS.md      路线 A + 无 Judge 场景版（本轮作为新现役规则的底稿，之后归档）
│   ├─ members/*.md           7 张角色卡（judge.md 本轮不动）
│   ├─ skills/                28 个技能
│   └─ tools/、judge/         本轮不动
├─ dsh-home/
│   ├─ AGENTS.md → ../team/AGENTS.md
│   └─ profiles/
│       ├─ headless/          现役：Agent Teams（本轮归档替换）
│       ├─ headless-a/        路线 A + judge 实验（保留）
│       └─ headless-s/        路线 A 场景版：6 成员、无 Judge、tool-web 禁用、agent-instructions 指向 team/route-s（本轮作为新 headless 的底稿，之后归档）
├─ kit/run.sh                 默认 DSH_PROFILE=headless（本轮不改）
└─ runs/                      04—16 号
promax-eval/                  答案、分析、结果、归档；业务 Agent 不可见
```

### 2.2 已核实的事实（Claude 与 Codex 实测，2026-09-26）

| 项 | 事实 | 出处 |
|---|---|---|
| 角色卡 | 6 张业务角色卡各有 1 行「写完回读确认，再 `send_message` 给 lead：……」和 1 行「自检不等于通过；最终由独立 Judge 检查……」；`requirement-review.md` 第 13 行另有「同样要交独立 Judge 检查」 | `grep -n "send_message\|Judge" team/members/*.md` |
| 回报失败 | C02 成员照角色卡调用 `send_message` 找 lead，失败 | R08-2 §2 |
| 旧平台工具名 | 13 个技能主文件、2 个 references 文件写着「OpenClaw `web_search` / `web_fetch`」之类 | `grep -rliE "openclaw" team/skills/*/SKILL.md` |
| `report(...)` | `prd-document-generator`、`business-diagram-generator`、`interactive-prototype-generator` 三个主文件要求调用 `report({output:string})`；dsh 会话工具清单里没有 `report` | R08-2 §11；`prd-document-generator/SKILL.md:12` |
| 强制遥测 | 19 个技能主文件引用 `telemetry-tracker`；典型写法是整节「## 使用埋点（硬触发 · 每轮必执行 · 静默）……必须调用 `telemetry-tracker` 技能上报」；`telemetry-tracker` 本身依赖 `~/.openclaw/hooks`、`~/.openclaw/workspace/...` | 例：`alert-early-warning/SKILL.md:184—194` |
| 旧平台身份识别 | 12 个技能主文件含 `session_status(sessionKey="current")`、`Relationships.md` 之类的身份与姓名获取链路 | `grep -l "session_status\|Relationships.md" team/skills/*/SKILL.md` |
| 评审目录 | `requirement-review/SKILL.md` 第 102、134、145 行要求保存到 `review-reports/` 并检查其中历史报告 | 源文件 |
| 零技能 | C03、C06、L01 里需求管理、用户分析没加载任何技能；需求管理的 4 个常用技能全是飞书 / 周报（外部系统，未接入），本地整理需求池没有适用技能；`user-feedback-processor` 默认去重，而评分口径是不去重 | R08-2 §2、§11 |
| facts 误用 | 访谈、竞品任务里 Lead 也跑了 facts.py；规则写的是「材料里有评分或需要统计的结构化数据时」 | R08-2 NE-21；`team/route-s/AGENTS.md:42` |
| 成果状态 | C01、C03 正式版本正文里留着「未正式保存」一类阶段说明；C01、L01 交付说明 9 行（上限 8）；C04 方案成员执行过 `ls /Users/Admin/.hermes/node/lib/node_modules` 找工具 | R08-2 §2、§7 |
| 路线 A 机制 | 成员 = `dsh-tool-subagent` 实例；前台调用是一次性子会话，结果以最终回复返回；`maxDepth` 必须是 1 | R07-1 |
| 上一轮基线数 | 7 场景全部正式保存（15 份）；L01 四棒接续成立；技能 28、个人技能 0；场景耗时（并行下）C01 476.7s、C02 663.8s、C03 236.9s、C04 521.6s、C05 384.5s、C06 160.7s、L01 2190.1s | R08-2 §1 |
| Codex 指出的 pi 卫生脚本问题 | 上一轮 H4 只覆盖了 L01 目录；H5 忽略了 ps/lsof 的返回码和 stderr。本轮卫生检查要逐个运行目录覆盖、并检查命令本身是否执行成功 | R08-2 §9 |

## 三、已拍板的规则（不要改）

1. 用户 09-26：只做 dsh 适配，**不改业务方法、不提升成员能力**。
2. 用户 09-26：需求管理用方案 A——角色卡写明「本地需求整理没有适用技能，按角色卡方法做；飞书、周报技能等接入阶段再用」；回归时对它的判定是「**有适用技能才要求加载**」。
3. 用户 09-26：本轮把路线 A 切成默认入口。
4. 不接回 Judge；`judge.md`、`team/judge/**`、`route-a/`、`headless-a/` 不动。
5. 业务模型固定 `opencode-go/deepseek-v4.1-flash`；不联网；不用 `--patch`。
6. 真跑：7 个场景各 1 次，最多 4 个并行，L01 最先启动；基础设施失败（含 429、网关超时、进程崩溃）最多重跑 1 次，且重跑时不与其他场景并行；质量、速度、行为不达标的**不重跑、不调参**。单场景上限 20 分钟，L01 上限 45 分钟。
7. 提示词用 `kit/prompts/` 原文，不改一个字；**7 个场景全部结束后才打开答案**。

## 四、边界

### ✅ 允许修改

- `team/members/` 下 6 张业务角色卡（不含 `judge.md`）：只改第六章 6.1 列出的行
- `team/skills/**/SKILL.md` 和 `team/skills/**/references/*.md`：**只改 6.2 列出的 5 类宿主写法**
- 新写 `team/AGENTS.md`（底稿 `team/route-s/AGENTS.md`，按 6.3 改）
- `team/README.md`：按 6.4 同步说明
- `dsh-home/profiles/headless/`：按 6.4 换成路线 A
- 归档（`mv`，不删）：旧 `team/AGENTS.md`、`team/route-s/`、旧 `profiles/headless/`、`profiles/headless-s/` 移到 `promax-eval/归档/20260926-dsh适配前/`
- 新建运行目录 `runs/17-S0`（冒烟）、`18-C01`—`24-L01`；在 `promax-eval/分析-09/` 写分析；写结果 `promax-eval/结果-09dsh适配与回归.md`

### 🔴 禁止

- 改动技能或角色卡里**业务方法**的任何文字（分析步骤、判断标准、模板、示例、输出结构）。拿不准是否属于宿主写法的，不改，列进结果的「待定」
- 修改技能的 `scripts/**`（只记录里面的旧路径、旧平台依赖）；删除任何技能；改技能的 `name:`
- 修改 `team/tools/**`、`team/judge/**`、`team/members/judge.md`、`team/route-a/**`、`profiles/headless-a/**`、`kit/**`、评分样本、场景材料、答案
- 修改 `dsh-runtime/**`、`deepseek-harness/**`、`dsh-home/sessions/**`、`dsh-home/.credentials.yaml`
- 修改业务 Agent 的产物；运行期间往运行目录放任何文件；把答案或分析文件放进 `promax-project/`
- 输出、打印、复制凭据；读取或运行 `~/.dsh-promax-first/**`；修改 `old-version/**`、`docs/重新出发/**`、`~/.agents/skills/**`
- 执行 `dsh plugin`；启动 dsh web 服务、占用 8800

### ⚪ 明确不做

- 成员内容质量（NE-22—26）、Judge 接回、模型分配、成果契约 v1、界面、飞书接入

## 五、必读

1. `docs/重新出发/02-验证记录/08-全场景跑通结果.md` 的 §2、§7、§10、§11（问题出处）
2. `team/route-s/AGENTS.md`、6 张业务角色卡
3. 每个要改的技能主文件：先通读，确认改动只落在宿主写法上
4. `dsh-home/profiles/headless-s/`、`headless/` 全部文件
5. `promax-eval/分析-08b-复核/01-review.py`（会话解析可复用）

## 六、改造规格

### 6.1 角色卡（6 张，不含 judge.md）

| 现在的原文 | 改成 |
|---|---|
| 「只写 Lead 指定的 `交付/` 文件；写完回读确认，再 `send_message` 给 lead：文件路径、3—5 条核心结论、缺口与未验证项。」 | 「只写 Lead 指定的 `交付/` 文件；写完回读确认，然后把文件路径、3—5 条核心结论、缺口与未验证项**作为你的最终回复返回**（不要用 `send_message`）。成果正文里不写保存状态，是否已保存以 Lead 的保存回执为准。」 |
| 「自检不等于通过；最终由独立 Judge 检查。收到 Judge 的问题（编号、原句、依据）时，只改相关位置，逐条说明处理结果；认为 Judge 判错时给出证据，不自行忽略。」 | 「自检不等于通过；是否安排独立检查由 Lead 决定。收到检查问题（编号、原句、依据）时，只改相关位置，逐条说明处理结果；认为判错时给出证据，不自行忽略。」 |
| `requirement-review.md` 第 13 行「你的评审报告本身也是业务成果，同样要交独立 Judge 检查；你不是 Judge」 | 「你的评审报告本身也是业务成果，可能被独立检查；你不是 Judge」 |
| `user-analysis.md`（新增一行，放在常用技能后） | 「**入口技能**：处理评分、反馈类任务先加载 `user-feedback-processor`。技能里的默认处理（如去重、按日期过滤）与用户给定口径冲突时，以用户口径为准，并在成果里写明采用了哪个口径。」 |
| `requirement-management.md`（新增一行，放在常用技能后） | 「**本地需求池整理**（需求来自用户给的文件）：当前没有适用技能——上面 4 个技能要连接飞书或周报数据源，接入前不使用；直接按本角色卡的方法做，不要声称已写入飞书或任何外部系统。」 |

### 6.2 技能里的 5 类宿主写法

先把 28 个技能主文件和 `references/*.md` 全部扫一遍，列出清单（文件、行号、原文、属于哪一类），再改。**每一处改动都必须能归到下面 5 类之一**，归不进去的不改。

| 类 | 识别 | 改法 |
|---|---|---|
| H1 旧平台工具名 | 「OpenClaw `web_search`」「OpenClaw `web_fetch`」之类 | 去掉「OpenClaw」，写成 dsh 的 `web_search` / `web_fetch`，并补一句「仅在用户允许联网时使用」（已有同义表述的不重复加） |
| H2 `report(...)` 回报工具 | `report({output:string})` 及围绕它的「立刻 report、不等整套」一类说明 | 改成「完成后把要回报的内容作为最终回复返回；dsh 中没有 `report` 工具」；原句里与回报无关的业务要求保留 |
| H3 强制遥测 | 「## 使用埋点（硬触发 · 每轮必执行 · 静默）」整节及其他「必须调用 telemetry-tracker 上报」的句子 | 整节删除（其他技能里）；`telemetry-tracker/SKILL.md` 本身不删内容，只在 `description` 开头加「（当前 dsh 环境未启用：依赖旧平台钩子与目录，不要执行）」，正文最前面加一段同义说明 |
| H4 旧平台身份识别 | `session_status(sessionKey=...)`、`Relationships.md`、「身份与姓名获取链路」一类 | 整段删除，替换为一句「不需要识别用户身份，按 Lead 派工内容工作」 |
| H5 旧目录与历史读取 | `review-reports/`、`~/.openclaw/...`、`workspace/...` 等固定目录，以及「检查历史报告」 | 改为「保存到 Lead 指定的 `交付/` 文件；不读取当前运行目录以外的历史报告」。`telemetry-tracker` 里的旧目录按 H3 处理，不逐条改 |

改完后用 `diff` 对照 9.0 基线，**把每个改动块（hunk）标上 H1—H5**，写进结果；出现无法归类的改动块，视为越界，必须回退。

### 6.3 新的现役团队规则 `team/AGENTS.md`

以 `team/route-s/AGENTS.md` 为底稿，改下面这些，其余逐字保留；写好后先把旧的 `team/AGENTS.md` 归档，再放新文件：

| 位置 | 改成 |
|---|---|
| 「所有人都遵守」新增两条 | 「成果正文只写业务内容，不写保存状态（已保存、草稿、保存失败等由 Lead 按回执说明）。」「需要的程序或工具不存在时，在成果里写『未运行』和原因；不要去运行目录和 `<team>/` 以外的目录（包括系统目录、运行时目录）查找。」 |
| 流程第 1 步「准备事实」 | 「**准备事实**：只有用户要求评分分布、比例或其他评分统计时，才运行 `python3 <team>/tools/facts.py <材料JSON> 交付/facts.json` 并交给成员；访谈、竞品、需求池、PRD、评审等任务不运行。」 |
| 选人表下方（新增） | 「需求管理处理本地需求池文件时没有适用技能，按角色卡做；不要为它指定飞书或周报技能。」 |
| 第 6 节「交付说明」 | 保留原有各条，再加：「**非空行不超过 8 行**，超出就合并。」「摘要只复述成果里已写的结论、限制和缺口，不自己概括出成果里没有的结论。」「成员回报里提到的工具报错或未完成项，也要写进交付说明。」 |
| 与 profile 有关的描述 | 不再提 `route-s`；成员工具名照旧 |

写完输出 `diff team/route-s/AGENTS.md team/AGENTS.md` 放进结果；再 `grep -n -i "judge\|issues.py\|precheck\|check_\|检查.md\|spawn_teammate\|wait_agent" team/AGENTS.md`，只允许剩「本阶段不做独立检查，不派 judge」一处。

### 6.4 默认入口切换

1. 把 `profiles/headless/` 整个目录移到归档目录，改名为 `profiles-headless-agentteams/`。
2. 把 `profiles/headless-s/` 复制成新的 `profiles/headless/`，然后：`package.json` 的 `name` 改为 `dsh-profile-headless`；`cordis.patch.yml` **删掉 `agent-instructions` 的 `dshHome` 覆盖段**（让它回到默认的 `$DSH_HOME/AGENTS.md` → `team/AGENTS.md`）；其余（路由、6 个成员工具、skill-filesystem、关闭通用 subagent、关闭 tool-web）保持不变。
3. 把 `profiles/headless-s/` 和 `team/route-s/` 移到归档目录。
4. `kit/run.sh` 不改（默认就是 `headless`）。
5. `team/README.md` 同步：成员形态（dsh 原生 subagent 工具，每个成员一个，可各配模型）、规则来源（`dsh-home/AGENTS.md` → `team/AGENTS.md`）、技能挂载（`customSkillDirs`）、当前阶段不挂 Judge（以后接回的参考配置在 `headless-a` 与 `route-a`）。只改这几处说明。

### 6.5 冒烟与回归

```bash
cd /Users/Admin/Desktop/Promax/promax-project
unset DSH_PROFILE          # 确认走默认入口
S=kit/fixtures/scenarios

# 冒烟：只回「就绪」
kit/new-run.sh 17-S0 ../promax-eval/分析-08a/冒烟提示词.txt
kit/run.sh runs/17-S0 runs/17-S0/prompt.txt S0

# 回归：最多 4 个并行，L01 先起；每条命令前都加 env -u DSH_PROFILE
kit/new-run.sh 24-L01 kit/prompts/L01-联合链路.txt  $S/L01/*
kit/new-run.sh 18-C01 kit/prompts/C01-客研.txt      $S/C01/*
kit/new-run.sh 19-C02 kit/prompts/C02-竞品探索.txt  $S/C02/*
kit/new-run.sh 20-C03 kit/prompts/C03-需求管理.txt  $S/C03/*
kit/new-run.sh 21-C04 kit/prompts/C04-产品方案.txt  $S/C04/*
kit/new-run.sh 22-C05 kit/prompts/C05-需求评审.txt  $S/C05/*
kit/new-run.sh 23-C06 kit/prompts/S1-v1首轮.txt     kit/评分样本-v1.json
# 例：env -u DSH_PROFILE kit/run.sh runs/24-L01 runs/24-L01/prompt.txt L01
```

启动顺序：L01、C01、C02、C03 先起；任一结束再依次补 C04、C05、C06。每个后台任务启动后先确认进程命令行是 `--profile headless`。

## 七、设计约束（陷阱）

1. **业务方法不能动**：这是本轮最大的风险。每个改动块都要能归到 H1—H5 或 6.1、6.3 的表里；拿不准就不改，写进「待定」。
2. **默认入口要真切过去**：冒烟与回归都不设 `DSH_PROFILE`；从会话的工具清单核对：6 个成员工具在，`spawn_teammate`、`judge`、`web_search`、`web_fetch` 都不在。
3. **规则要真读到**：新 profile 删掉了 `agent-instructions` 覆盖后，Lead 读到的必须是新 `team/AGENTS.md`；冒烟会话里能找到新加的「非空行不超过 8 行」等原文就算证实。
4. **归档是移动，不是删除**：归档目录里要能找回旧 `headless`、`headless-s`、旧 `AGENTS.md`、`route-s`。
5. **技能数不变**：仍是 28 个，`telemetry-tracker` 只改说明不删。
6. **答案最后才看**。
7. 并行时环境变量写在每条命令里；卫生检查逐个运行目录覆盖，并检查 `ps`、`lsof` 命令本身是否执行成功。
8. `/Users/Admin/package.json` 带 yarn packageManager：不执行 `dsh plugin`。pi 的工作目录是 `/Users/Admin/Desktop/Promax`，后台任务不要从 `promax-project` 里启动。

## 八、开发习惯

- 顺序：9.0 基线 → 6.2 扫描清单 → 6.1 → 6.2 → 6.3 → 6.4 → 9.2 静态检查全过 → 冒烟 → 回归 → 9.4 → 9.5。
- 静态检查没全过，不开始冒烟；冒烟没过，不开始回归。
- 分析脚本和输出放 `promax-eval/分析-09/`。

## 九、验收

### 9.0 开工前存基线（不是 git 仓库）

```bash
cd /Users/Admin/Desktop/Promax
TS=$(date +%Y%m%d-%H%M%S); B=promax-eval/.bak/$TS; mkdir -p $B
cp -R promax-project/team $B/team
cp -R promax-project/kit $B/kit
cp -R promax-project/dsh-home/profiles $B/profiles
cp -P promax-project/dsh-home/AGENTS.md $B/dsh-home-AGENTS.md
echo $TS > promax-eval/.bak/LATEST
```

### 9.1 已核实的基线数

见 2.2。开工前自己复测并写进结果：6.2 五类写法各自的文件数和行数；角色卡里 `send_message`、`Judge` 的行数。

### 9.2 静态检查（冒烟前必须全过）

| # | 检查 | 通过标准 |
|---|---|---|
| T1 | 角色卡 | 6 张业务卡里 `send_message` 0 处、`Judge` 0 处（`judge.md` 不算）；用户分析、需求管理的新增行在 |
| T2 | 旧宿主写法 | 技能主文件与 references 里：`OpenClaw` 0 处；`report({` 0 处；除 `telemetry-tracker` 本身外，「使用埋点」「telemetry-tracker 上报」0 处；`session_status`、`Relationships.md` 0 处；`review-reports/` 0 处 |
| T3 | 改动都能归类 | 与基线的每个 diff 块都标了 H1—H5 或 6.1 表中的行；无法归类的 0 个 |
| T4 | 技能数 | 28 个技能目录，`name:` 与目录名全部一致 |
| T5 | 新规则 | `team/AGENTS.md` 的 diff 只涉及 6.3 表；Judge 相关字样只剩一处 |
| T6 | 默认入口 | `dsh --profile headless --dump-config`：6 个成员工具（v4.1-flash、maxDepth 1）、无 agent-team、`tool-web` 禁用、没有 `agent-instructions` 的 dshHome 覆盖；`headless-a` 仍能组合 |
| T7 | 归档 | 归档目录里能找到旧 headless、headless-s、旧 AGENTS.md、route-s；`profiles/` 下只剩 `headless`、`headless-a` |

### 9.3 冒烟（`runs/17-S0`）

| # | 通过标准 |
|---|---|
| S1 | 工具清单：6 个成员工具在；`spawn_teammate`、`judge`、`web_search`、`web_fetch` 不在 |
| S2 | 技能目录 28 个、个人技能 0；模型 v4.1-flash |
| S3 | 会话里能找到新 `team/AGENTS.md` 的新增原文（例如「非空行不超过 8 行」） |
| S4 | 只回「就绪」，0 次工具调用 |

### 9.4 回归：适配指标（本轮的通过门槛）

每个场景一行，每格标 🟢 / 🔴 / ⚪：

| 场景 | M1 回报：成员 0 次 `send_message` | M2 旧宿主：0 次调用不存在的工具（`report` 等）、无 `review-reports/`、无遥测动作 | M3 入口：有适用技能的成员加载了（用户分析加载 `user-feedback-processor`；需求管理不要求、且未加载飞书技能、未声称写入外部系统） | M4 facts：C01—C05 未运行，C06、L01 运行 | M5 状态：正式版本正文无保存状态字样；交付说明非空行 ≤ 8、写了「本版未经独立检查」、成员回报里的报错已披露 | M6 边界：越界 0 次；未联网 | 链路：选人对、成果在、正式保存、L01 四棒接续 |
|---|---|---|---|---|---|---|---|

M5 的「保存状态字样」用这组正则查版本文件：`未正式保存|尚未保存|保存失败|草稿状态|已正式保存`，命中逐条列出原句。

### 9.5 内容观察（记录，不作门槛）

全部结束后打开答案，按场景简记：埋点处理与上一轮（R08-2 §3）比，是变好、持平还是变差；编造类问题是否仍在。**只记录，不下「通过 / 不通过」结论。**

### 9.6 卫生

| # | 标准 |
|---|---|
| H1 | `diff -r` 基线与现在：team 只有 6.1、6.2、6.3、6.4 第 5 条的改动；kit 无差异；profiles 只有 6.4 的变化 |
| H2 | `runs/` 只新增 `17-S0`、`18-C01`—`24-L01` |
| H3 | 运行目录里没有分析文件（逐个目录检查） |
| H4 | 任何文件和终端输出里都没有密钥内容 |
| H5 | 8800 无监听；没有残留的 dsh 进程和后台任务；`ps`、`lsof` 命令本身执行成功（返回码与 stderr 一并记录） |

## 十、收尾

不提交、不删除任何产物；确认没有残留后台任务。

## 十一、交付简报

写到 `promax-eval/结果-09dsh适配与回归.md`，最后一条回复给出相同内容：

1. **一句话结论**：6 项适配是否都改到位；默认入口是否切换成功；回归里适配指标几项全绿
2. **改动清单**：6.2 扫描清单（改前）；每个文件的改动块及其归类（H1—H5 / 6.1 / 6.3）；「待定」清单（拿不准、没改的地方）；归档清单
3. **静态检查、冒烟、回归适配指标**：9.2、9.3、9.4 逐项标色，附证据
4. **内容观察**（9.5），明确写「不作门槛」
5. **用量表**：每场景、每成员的耗时、请求数、token；标明并行负载下测得；尖峰单列
6. **7 段 Lead 最终回答原文**
7. **问题清单**：现象、证据、你判断的原因（标明是判断），分「适配问题」和「内容观察」两组
8. **运行次数与偏离**
