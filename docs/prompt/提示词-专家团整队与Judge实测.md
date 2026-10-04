# 任务：产品专家团整队实测（v1 → 追问 → v2 更新 → 只复查 → Judge 对抗）

> 执行方：pi　·　生成日期：2026-09-25　·　只跑测试、记录结果，**不改被测对象**，不提交
> 工作目录：`/Users/Admin/Desktop/Promax/promax-project`（不是 git 仓库）

## 一、目标

验证刚嵌入 dsh 的「产品专家团」和新 Judge 机制在真实模型下是否成立：

1. **B1 整队 v1**：Lead 按新团队规则选成员、派工、等待，Judge 用程序工具核对并通过 `issues.py` 提交结论，保存后给出简短、如实的交付说明
2. **B2 追问**：同一会话里追问口径，Lead 直接回答，不派成员、不重算
3. **B3 v2 替代更新**：只改受影响的内容，旧版保留，Judge 按台账复查
4. **B3b 只复查**：不改报告，只让 Judge 检查当前版本
5. **B4 Judge 对抗**：给一份埋了 5 个错、另含 1 个易误判陷阱的报告，看 Judge 能否全部检出且不误报

这是测量任务。结果不好就如实记录，**不许为了让结果变好去改被测对象**。

## 二、背景（先看懂现状）

- 旧 Promax 在 `/Users/Admin/Desktop/Promax/old-version/`，与本任务无关，**不要读、不要运行**。
- 上一轮（`runs/01-v1/`）是新底座首跑，用的是旧的单文件 AGENTS.md。本轮换成完整的专家团：

```text
promax-project/
├─ team/                 被测对象：专家团
│   ├─ AGENTS.md         团队规则（Lead 编排 + 全员约束）→ 经 dsh-home/AGENTS.md 软链全局注入
│   ├─ members/*.md      7 张角色卡（6 个业务成员 + judge），Lead 派工第一句让成员先读
│   ├─ skills/           28 个技能 → 经 dsh-home/skills 软链自动发现
│   ├─ tools/            facts.py、save.py
│   └─ judge/            tools/{check_numbers,check_quotes,issues}.py、rubrics.yml
├─ dsh-home/             独立 DSH_HOME；headless profile；凭据已就位（.credentials.yaml）
├─ dsh-runtime/          dsh 0.1.7-rc.2
├─ kit/                  run.sh、new-run.sh、prompts/、评分样本 v1/v2、fixtures/B4/
└─ runs/                 每次真跑一个目录
```

- 业务模型：`opencode-go/deepseek-v4.1-flash`。路由已补 `x-opencode-session` 请求头，Claude 冒烟通过（4 秒返回"你好"）。**本轮不切换任何其他路由，不使用 `--patch`。**
- `kit/run.sh <运行目录> <提示词> [标签] [会话ID]`：产出 `events-<标签>.jsonl`、`stderr-<标签>.log`、`timing-<标签>.json`，结束时打印 session id。带会话 ID 就是在同一会话里续跑。
- `kit/new-run.sh <运行名> <提示词> <材料...>`：建一个干净的运行目录（附件/、交付/、prompt.txt、git init）。

### 已核实的基线数

| 项 | 值 | 来源 |
|---|---|---|
| v1 参考值 | 总 320；有效 300 / 无效 20；1—5 星 30/45/75/90/60；低星 75/300=25%；高星 150/300=50% | 产品设计验收目标 |
| v2 参考值 | 1—5 星 31/45/74/90/60；低星 76/300=25.33%；高星 50%；只有 T0076.rating 3→1 | 同上 |
| 无效评分 | 全部在 T0301—T0320；T0300 有效；类型：字符串 4、布尔 4、缺失 8、越界整数 3、非整数 1（T0316=1.5） | facts.py 离线运行 |
| 上一轮 v1 | 208 秒、66 次请求；数字/引文/保存全对；交付说明 78 行贴了全文；judge 占 51% 耗时 | `runs/01-v1/结果.md`，Claude 已复核 |
| Judge 工具离线 | 正确报告 0 误报；B4 报告上 check_numbers 检出 E1、check_quotes 检出 E2/E3 | Claude 离线运行 |

## 三、已拍板的规则（不要改）

1. 业务模型固定 `opencode-go/deepseek-v4.1-flash`，不换路由。
2. 共 5 个真跑轮次：B1、B2、B3、B3b、B4，各跑一次。某轮因**基础设施问题**（网络、限流、凭据、进程崩溃）失败时，该轮最多重跑 1 次；因质量、速度或行为不符合预期而"失败"的，**不重跑**。
3. 单轮上限 20 分钟，超时 `bg_kill`，记为超时，保留产物；后续依赖它的轮次标"未执行"。
4. 提示词用 `kit/prompts/` 里的原文，不改一个字。
5. **B4 的答案文件 `kit/fixtures/B4/答案.md` 在 B4 运行结束前不许打开，也不许复制进任何运行目录。**

## 四、边界

### ✅ 允许

- 用 `kit/new-run.sh` 建运行目录；用 `kit/run.sh` 运行
- B3 前把 `kit/评分样本-v2.json` 复制到 `runs/02-team/附件/`（相当于用户"附上 v2"）
- 在 `runs/分析-整队/` 下写分析脚本和输出（**分析文件一律不放进任何运行目录**）
- 写结果文件 `runs/结果-整队与Judge实测.md`
- 只读查看 `dsh-home/sessions/`、`deepseek-harness/` 源码和文档

### 🔴 禁止

- 修改 `team/**`、`kit/**`、`dsh-home/profiles/**`、`dsh-home/AGENTS.md`、`dsh-home/skills`
- 修改业务 Agent 的产物（`runs/*/交付/**` 只读）
- 在运行期间往运行目录里放任何文件（B3 的 v2 附件除外）
- 输出、打印、复制凭据内容；不 `cat`/`grep`/`head` `.credentials.yaml`
- 读取或运行 `old-version/**`、`~/.dsh-promax-first/**`
- 启动 dsh web 服务，占用 8800 端口

### ⚪ 明确不做

- 修复发现的问题（只记录，并给出你判断的原因）
- 界面、飞书、联网类技能

## 五、必读

1. `team/AGENTS.md`、`team/members/judge.md`、`team/members/user-analysis.md`
2. `team/judge/tools/issues.py` 文件头（草稿格式与校验规则）
3. `kit/run.sh`、`kit/new-run.sh`
4. `deepseek-harness/packages/experimental/tool-agent-team/README.zh.md`（团队工具名与行为）

## 六、执行规格

每轮都用 `bg_run` 在后台运行，`bg_status` / `bg_logs` 观察，`bg_result` 取结果。

### 6.1 B1 整队 v1

```bash
cd /Users/Admin/Desktop/Promax/promax-project
kit/new-run.sh 02-team kit/prompts/S1-v1首轮.txt kit/评分样本-v1.json
kit/run.sh runs/02-team runs/02-team/prompt.txt B1
```

记下打印的 session id，后面三轮都用它。

### 6.2 B2 追问（同一会话）

```bash
kit/run.sh runs/02-team kit/prompts/S4-完成后追问.txt B2 <session-id>
```

### 6.3 B3 v2 替代更新（同一会话）

```bash
cp kit/评分样本-v2.json runs/02-team/附件/
kit/run.sh runs/02-team kit/prompts/S6-v2替代更新.txt B3 <session-id>
```

运行前先把 `runs/02-team/交付/版本/` 下 v1 版本文件的 sha256 记到分析目录，用于核对旧版是否保留原样。

### 6.4 B3b 只复查（同一会话）

```bash
kit/run.sh runs/02-team kit/prompts/S8-只复查.txt B3b <session-id>
```

### 6.5 B4 Judge 对抗（新会话）

```bash
kit/new-run.sh 03-judge kit/prompts/B4-独立检查.txt kit/fixtures/B4/报告.md kit/评分样本-v1.json
kit/run.sh runs/03-judge runs/03-judge/prompt.txt B4
```

B4 结束后才打开 `kit/fixtures/B4/答案.md` 对照。

## 七、核对规格（分析脚本放 `runs/分析-整队/`）

先 `head` 看事件格式，再写解析。成员的事件可能在 `dsh-home/sessions/` 的子会话里，找到就一起统计并写明范围。**取不到的写"未知"，不许估算。**

### 7.1 每轮都要取

耗时（timing）、模型请求次数与 token（Lead 与各成员分开）、创建或唤醒了哪些成员（`spawn_teammate` / `send_message`）、是否运行 facts.py / save.py / 三个 Judge 工具、最终回答全文与行数。

### 7.2 分轮核对

| 轮 | 核对项 |
|---|---|
| B1 | ① 成员是否为 `user-analysis` + `judge`（名字取自角色卡文件名），派工第一句是否要求先读角色卡；② facts.json 等于参考值；③ 报告数字、引文、无效分类全对（用 Judge 工具在分析目录独立复算，不写进运行目录）；④ Judge 是否跑了 check_numbers、check_quotes，是否通过 `issues.py submit` 提交（`交付/检查/ledger.json` 存在、`交付/检查.md` 由程序生成）；⑤ 保存回执 saved 且 sha256 与报告和版本文件一致；⑥ 交付说明 ≤ 8 行、没有贴全文、结论与回执和检查结论一致；⑦ 耗时 ≤ 300 秒 |
| B2 | ① 没有 spawn_teammate / send_message，没有运行 facts.py、save.py、issues.py；② 回答口径正确（75/300，分母是有效评分）；③ 没有再出一次交付说明 |
| B3 | ① `交付/facts-v1.json`（或同义旧版文件）保留，新 facts.json 等于 v2 参考值；② 报告点到 T0076 3→1，没有合并成 640 条；③ 用 diff 比对 v1 与 v2 两个版本文件，列出所有改动行，判断是否只改了受影响处；④ v1 版本文件 sha256 与运行前记录一致；⑤ ledger 新增一轮，被审 sha 为 v2；⑥ 交付说明讲了变化（1 星 30→31、3 星 75→74、低星 25%→25.33%）；⑦ 是否复用原成员（send_message）而非重复创建；⑧ 耗时 ≤ 180 秒 |
| B3b | ① 没有新版本文件、没有派写手、没有重算；② ledger 新增一轮，被审 sha 为当前版本；③ 已关闭的问题没被当作新问题重复提出；④ 结论如实告诉用户 |
| B4 | ① 成员是否只有 judge（或加上必要的准备步骤）；② 报告和附件未被修改；③ 对照答案：E1—E5 逐项是否被列为问题（写出对应的 J 编号）；④ T1 是否被误判；⑤ 结论是否为 REVISION_REQUIRED；⑥ issues.py 是否拒收过草稿（从事件里找，拒收原因原样摘录）——**这是 Judge 差异化的关键证据** |

## 八、设计约束（陷阱）

1. **运行目录保持干净**：上一轮的教训是分析文件留在运行目录里，被 Lead 读到了参考答案。本轮所有分析产物只放 `runs/分析-整队/`。
2. **同一会话的成员名字不能重复**：B3、B3b 里 Lead 如果重复 spawn 同名成员会报错。这本身就是要观察的行为，如实记录，不要干预。
3. **`/Users/Admin/package.json` 带 yarn packageManager**：不要执行 `dsh plugin`。
4. **exit=0 不等于通过**：以第七章的逐项核对为准。
5. **B4 的答案**：结束前不看，看完不外传进运行目录。
6. 凭据只用 `test -s` 检查是否存在。

## 九、验收

### 9.0 开工前存基线

```bash
cd /Users/Admin/Desktop/Promax/promax-project
TS=$(date +%Y%m%d-%H%M%S); mkdir -p .bak/$TS
cp -R team .bak/$TS/team
cp -R kit .bak/$TS/kit
cp -R dsh-home/profiles/headless .bak/$TS/headless-profile
echo $TS > .bak/LATEST
```

### 9.1 验收表

| # | 检查 | 通过标准 |
|---|---|---|
| B1-a | 选人 | user-analysis + judge，派工要求先读角色卡 |
| B1-b | 可靠 | 数字、引文、分类、保存全对 |
| B1-c | Judge 机制 | 跑了两个核对工具，结论经 issues.py 提交，检查.md 由程序生成 |
| B1-d | 交付说明 | ≤ 8 行、不贴全文、与回执和检查结论一致 |
| B1-e | 效率 | ≤ 300 秒 |
| B2 | 追问 | 不派成员、不重算、口径正确、无重复交付说明 |
| B3-a | v2 正确 | 数字等于 v2 参考值，点到 T0076，未合并 |
| B3-b | 局部修改 | 只改受影响处；v1 版本文件原样保留 |
| B3-c | 复查 | ledger 新一轮针对 v2 |
| B3-d | 说明变化 | 讲清 30→31、75→74、25%→25.33% |
| B3-e | 效率 | ≤ 180 秒 |
| B3b | 只复查 | 无新版本、无写手、ledger 新一轮、不重复旧问题 |
| B4-a | 检出 | E1—E5 全部检出 |
| B4-b | 不误报 | T1 未被列为问题 |
| B4-c | 结论 | REVISION_REQUIRED |

每项标 🟢 / 🔴 / ⚪（未知或未执行），不通过的附原句或原始数据。

### 9.2 卫生

| # | 标准 |
|---|---|
| H1 | `diff -r .bak/$(cat .bak/LATEST)/team team` 无输出 |
| H2 | `diff -r .bak/$(cat .bak/LATEST)/kit kit` 无输出 |
| H3 | `diff -r .bak/$(cat .bak/LATEST)/headless-profile dsh-home/profiles/headless` 中 `cordis.patch.yml`、`package.json` 无差异 |
| H4 | 运行目录里没有分析文件（B3 的 v2 附件除外） |
| H5 | 任何文件和终端输出里都没有密钥内容 |
| H6 | 8800 无监听，没有残留的 dsh 进程 |

## 十、收尾

不提交、不删除任何运行产物；确认没有残留的后台任务。

## 十一、交付简报

写到 `runs/结果-整队与Judge实测.md`，最后一条回复给出相同内容：

1. **一句话结论**：专家团与新 Judge 在五轮里各是什么状态
2. **验收表**：9.1 与 9.2 逐项标色，附证据路径
3. **关键数据表**：每轮耗时、请求数、token、成员、返修轮数；和上一轮（208 秒、66 次请求）并列
4. **四段最终回答原文**：B1、B2、B3、B3b 的 Lead 最终回答全文
5. **B4 对照表**：E1—E5、T1 逐项：是否检出、对应 J 编号、Judge 原文依据；issues.py 拒收记录
6. **问题清单**：现象、证据位置、你判断的原因（标明是判断），按严重度排序
7. **运行次数与偏离**：每轮实际跑了几次；有重跑的写明基础设施原因；主动说明其他偏离
