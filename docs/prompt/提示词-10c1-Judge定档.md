# 任务：10c-1 Judge 定档（只测 Judge，固定样本 × 思考档位 × 3 次）

> 执行方：pi（GPT6-Sol）　·　生成日期：2026-09-28（同日修订：上一次在 6.1 以 SETUP_BLOCKED 停工，新增 6.0 实测探档，用户选「A」）　·　只改 profile 里 v4.1-flash 的档位声明和 Judge 的思考档位（跑完恢复原样），新增 4 份固定样本；**不改程序、规则、角色卡，不提交**（不是 git 仓库）
> 工作目录：`/Users/Admin/Desktop/Promax`
> 配套：任务书 `docs/重新出发/01-指派任务/10-Judge接回任务.md/01-指派任务.md`（D6、D7、D14、D15）；上一轮复核 `docs/重新出发/02-验证记录/10-Judge接回结果.md` 的 R10-4；得分表 `docs/重新出发/00-基线/01-当前基线与入口.md` §4.3；判分口径 `docs/重新出发/00-基线/05-工作方式与复核规范.md` §2.6

## 一、目标

找出 Judge 用哪个思考档位，既**判得准**（检出不掉、不冤枉正确内容、证据不足时判 INCOMPLETE），又**最快**；给用户一张档位对照表，用来选档和定 Judge 耗时目标（D15）。本轮**只让 Judge 检查固定样本，不派写手，不跑完整场景**。

## 二、背景（先看懂现状）

### 2.1 为什么做

| 事项 | 现状（R10-4） |
|---|---|
| Judge 耗时 ≈ 输出量 | 拿掉 bash 后 Judge 只读文件、写一次草稿；耗时基本等于输出 token（含思考）÷ 约 95/秒：B4 8703 tok / 88.8 秒，J04 12518 / 126.8，C01 17360 / 179.3、19175 / 210.9 |
| 可调的开关 | dsh 成员配置 `agentOptions` 支持 `reasoningEffort`、`maxTokens`（`promax-project/deepseek-harness/packages/subagent/tool-subagent/src/index.ts:113—122`）；Judge 现在没设，用模型默认档；v4.1-flash 有哪几档、默认哪档未查 |
| 风险 | 少想可能漏掉语义错（如 B4 的 E5「主要集中在」无频次依据）；R07-1 换模型后漏过 E5 |
| 从没测过的 | Judge 会不会冤枉完全正确的成果（旧评测集 C09 合格对照）；证据不足时会不会判 INCOMPLETE（C11） |
| 90 秒 | 用户 09-28 定为初版参考线（D15）：本轮照常记录、不作阻断；最终目标按本轮结果定 |
| 上次停工（09-28 03:55，`promax-eval/结果-10c1-Judge定档.md`） | 模型目录 `dsh-runtime/node_modules/@earendil-works/pi-ai/dist/providers/data/opencode-go.json` 里**没有** v4.1-flash；同系列 `deepseek-v4-flash` 为 `reasoning: true`，`thinkingLevelMap` = `low→low、high→high、max→max`（minimal、medium 不支持）。profile 第 32 行只写 `- id: deepseek-v4.1-flash`，未声明 `reasoningEfforts`，所以 dsh 不传思考参数（`@deepseek-ai/dsh-llm-pi-ai/lib/index.js:563—565`），Judge 实际用网关默认档，是哪档未知。Claude 已核实。用户 09-28 选「A：先实测探档」。上次的结果文件会被本轮覆盖，先把它复制到 `promax-eval/分析-10c1/第一次停工-结果.md` |

### 2.2 已核实的事实（Claude 实测，2026-09-28）

| 项 | 事实 |
|---|---|
| profile | `promax-project/dsh-home/profiles/headless/cordis.patch.yml` 第 184—186 行：`agentOptions:` / `provider: opencode-go` / `model: deepseek-v4.1-flash`（member-judge 条目，第 175 行起） |
| B4 | `kit/prompts/B4-独立检查.txt`；`kit/fixtures/B4/报告.md` + `kit/评分样本-v1.json`；答案 `promax-eval/fixtures/B4/答案.md`（E1—E5 + 陷阱 T0300） |
| J04 | `kit/prompts/J04-独立检查.txt`；`kit/fixtures/judge/J04/*` + `kit/fixtures/scenarios/C04/*`；答案 `promax-eval/fixtures/judge/J04/答案.md` |
| C01 原稿 | `runs/77-C01/交付/检查/客户研究报告/被审-r1/客户研究报告.md`（成员真实首稿，Judge 第 1 轮看到的版本）；材料 `kit/fixtures/scenarios/C01/*`；pi 在 10b-3 判出 2 处真错（`promax-eval/分析-10b3/13-c01-assessment.md`），未经独立核实 |
| C02 原稿 | `runs/68-C02/交付/检查/竞品探索-附件导入进度提示与失败恢复/被审-r1/竞品探索-附件导入进度提示与失败恢复.md`；材料 `kit/fixtures/scenarios/C02/*`；**没人判过有哪些错** |
| J08 底稿 | `runs/55-M/交付/版本/v1-评分与反馈分析.md`（C06 成员报告：数字与 facts 一致、引文程序核对 15/15、10a 的 Judge 判 PASS）+ `kit/评分样本-v1.json` |
| 场景答案 | `promax-eval/fixtures/scenarios/C01/答案.md`、`C02/答案.md`（给成员设的埋点，可作为判原稿的参考） |
| 运行目录 | 最后一个是 `runs/77-C01`；本轮从 78 号开始 |

## 三、已拍板的规则（不要改）

1. 只测 Judge：每次运行只让 Lead 预检 → 派 Judge → 提交，不派写手、不返修。
2. **只改一个变量**：Judge 的 `reasoningEffort`。模型、程序、规则、角色卡、样本在两批之间完全不变。
3. **答案先冻结**：6 份样本的答案全部写完、记 sha256 后，才能开始任何 Judge 运行；之后不得修改。发现答案有错，另记，不改原件。
4. 每组（样本 × 档位）跑 3 次；看中位数，不看单次。
5. 状态按 05 规范 §2.6：PASS / FAIL / RUN_ERROR / ENV_BLOCKED / SETUP_BLOCKED / NOT_RUN / NEEDS_REVIEW / USER_STOPPED；基础设施故障单列、不计能力，只补跑 1 次（目录加 `-r1`）。
6. 运行命令都用 `env -u DSH_PROFILE`；外层最多 3 个并行；**同一批内档位不变，换档只在两批之间**。
7. 跑完把 profile 恢复成开工时的字节（不留 `reasoningEfforts`、`reasoningEffort`），档位由用户看结果后选。
8. **探档失败就退回「只测默认档」**（用户已预先同意）：网关只接受一档、各档思考量差别不明显、或判断不出默认是哪档时，不做档位对照，改为只用默认档把 6 份样本各跑 3 次（共 18 次），照常测 J08、J09 和耗时。

## 四、边界

### ✅ 允许修改

- `promax-project/dsh-home/profiles/headless/cordis.patch.yml`：只允许两处——第 32 行 `deepseek-v4.1-flash` 模型条目下加 `reasoningEfforts` 声明（6.0）；`member-judge` 的 `agentOptions` 下增删 `reasoningEffort` 一行。结束时恢复原样
- 探档专用的临时 profile `promax-project/dsh-home/profiles/probe-10c1/`（从 headless 复制后只改档位相关字段）；只在 6.0 用 `DSH_PROFILE=probe-10c1` 运行；结束时复制到 `promax-eval/分析-10c1/probe-profile/` 留证后删除
- 新增 `promax-project/kit/fixtures/judge/J08/`、`J09/`、`J10/`、`J11/` 和 `kit/prompts/J08—J11-独立检查.txt`；答案只放 `promax-eval/fixtures/judge/J08—J11/答案.md`
- 用 `kit/new-run.sh` 新建运行目录（78 号起，按 9.4 的命名）
- 写 `promax-eval/分析-10c1/`、`promax-eval/结果-10c1-Judge定档.md`；在 `promax-eval/.bak/` 下存基线

### 🔴 禁止

- `team/**`、`kit/` 下已有文件、其他 profile、dsh 源码、`old-version/**`、`docs/**`
- 答案或分析文件进入 `promax-project/`；动 77 号及以前的运行目录（只读复制原稿）
- 读取或打印凭据；读 `~/.dsh-promax-first/**`；`dsh plugin`；启动 8800

### ⚪ 明确不做

- 完整场景（10c-2）；`maxTokens`；换模型；改程序或规则；写手提速

## 五、必读

1. `team/AGENTS.md` 第 3 节第 5 步（Lead 的预检 → 派 Judge → 提交流程）、`team/members/judge.md`
2. R10-4 结论页；`promax-eval/结果-10b3-Judge去bash与验证.md`；`promax-eval/分析-10b3/13-c01-assessment.md`
3. 2.2 列出的全部样本、材料和答案
4. `deepseek-harness/packages/subagent/tool-subagent/src/index.ts` 与模型目录相关源码（查档位用）

## 六、规格

### 6.0 实测探档（先做）

1. **读 schema**：从 `@deepseek-ai/dsh-llm-pi-ai/lib/index.js` 第 555—580 行附近弄清模型条目 `reasoningEfforts` 的写法（级别 → 发给网关的值），以及怎样让一个 agent 用指定档位（成员用 `agentOptions.reasoningEffort`；Lead 默认档的配置位置自己查）。
2. **建探档 profile**：复制 headless 为 `probe-10c1`，在 v4.1-flash 条目下照 v4-flash 声明 `low→low、high→high、max→max`。
3. **探档题**：写一个固定的小题放 `promax-eval/分析-10c1/probe-prompt.txt`，要求 Lead 直接回答、不派成员，需要一定推理（例如给 15 条带星级的评分记录，按「只接受原始数值 1—5 整数」算低星比例并说明哪几条无效），答案可程序核对。
4. **跑**：「不传档位」「low」「high」「max」各 3 次，共 12 次，`DSH_PROFILE=probe-10c1 kit/run.sh …`（只有这一步允许设 `DSH_PROFILE`，运行目录放 78 号起，命名 `<序号>-probe-<档位>-<第几次>`）。每次记录：退出码、网关是否报错、请求里实际发出的思考参数、思考与输出 token、耗时、答案对不对。
5. **判**：
   - 接受的档位 = 没报错且确实发出了该参数的档位；
   - 默认档 = 思考 token 中位数与「不传档位」最接近、且相差在 30% 以内的那一档；判断不出就记 ⚪；
   - 低一档 = 接受的档位里比默认低的最近一档。
6. **结论**：能确定默认档和低一档 → 比较这两档；否则按第三章第 8 条退回「只测默认档」。
7. 用同样的写法给 headless 的 v4.1-flash 条目加 `reasoningEfforts`，然后跑一次冒烟（沿用 10b-3 的 S0 标准），证明 Lead 与业务成员在不设档位时的请求与改前一致（不发思考参数）。

### 6.1 档位结论

写清：接受的档位、默认档、低一档、依据（6.0 的数据表），以及本轮走「两档对照」还是「只测默认档」。

### 6.2 备样本（答案全部冻结后才能跑）

| 样本号 | 内容 | 预期 | 怎么做 |
|---|---|---|---|
| B4 | 现成 | REVISION_REQUIRED；E1—E5 检出，T0300 不误判 | 直接用 |
| J04 | 现成 | REVISION_REQUIRED；4 处检出，陷阱不误判 | 直接用 |
| J10 | C01 原稿 | 按答案 | 复制原稿与 C01 材料；**写答案**：逐条列出原稿里成员实际犯的错（位置、原句、依据、属于程序还是 Judge 该抓）和不该判错的正确内容。参考 C01 场景答案和 10b-3 的判定，但要自己回原文核实，不照抄 |
| J11 | C02 原稿 | 按答案 | 同 J10，参考 C02 场景答案 |
| J08 | 合格对照 | **PASS，0 条阻断问题** | 以 55-M v1 报告为底稿，逐条核实数字、引文、结论与材料一致；有问题就做最小修正并在答案里记录每处改动，直到你能证明它完全正确 |
| J09 | 证据不足 | **INCOMPLETE**，不能 PASS | 新做：一份可读的成果，但它的关键结论依赖的材料**没有附上**（例如报告引用了 4 份访谈，附件只给 2 份），不是写错。答案写明缺哪份材料、哪些结论因此无法判定 |

每份答案格式照 `promax-eval/fixtures/B4/答案.md`：预期结论、应检出项（位置、原句、程序 / Judge）、不应判错项、通过标准。提示词照 `kit/prompts/B4-独立检查.txt` 的写法，**不写成果类型、不提示答案**。全部写完后记录 sha256 到 `分析-10c1/样本冻结.json`。

### 6.3 判分口径

| 指标 | 定义 |
|---|---|
| 检出 | 答案里的应检出项，在该次台账里以问题指出的比例 |
| 误判 | 不应判错项被列成阻断问题（defect / evidence_gap 且 high / medium）的条数 |
| J08 误报 | 任何阻断问题都算误报；结论不是 PASS 算 FAIL |
| J09 | 结论必须是 INCOMPLETE；判 PASS 算 FAIL，判 REVISION_REQUIRED 记 NEEDS_REVIEW 并写原因 |
| 耗时 | Judge 子会话首末事件时间差；同时记输出 token |
| 单次状态 | 结论与检出、误判都符合答案 → PASS；否则 FAIL；基础设施问题 → RUN_ERROR / ENV_BLOCKED |

## 七、设计约束（陷阱）

1. **答案先于运行**：冻结文件的时间必须早于第一个 Judge 样本运行目录的创建时间（6.0 探档目录不含样本、不派 Judge，不算）；复核会比对。
2. **不照 Judge 写答案**：J10、J11 的答案不能参考本轮任何 Judge 输出。
3. **原稿只读**：从 77、68 号运行目录复制，不改原目录。
4. **换档只在两批之间**：先跑完默认档全部 18 次，再改 profile，跑低一档 18 次；每批开工前记录 profile 的 sha256，并从一次 Judge 会话的请求记录里证明实际生效的档位。
5. 会话目录名以 `--` 开头，解压用 `subprocess.run(['zstd','-dcf','--',path])`；以 `timing-*.json` 的 `exit_code` 和 `turn/end` 判成败。
6. **报错全表**：扫全部 `tool/result`，含 `Traceback`、`Error:`、非 0 退出、`"accepted": false` 的都记；issues.py 拒收单列。

## 八、开发习惯

- 顺序：9.0 存基线 → 6.0 实测探档 → 6.1 档位结论 → 6.2 备样本并冻结 → 9.3 默认档 18 次 →（两档对照时）Judge 改为低一档再跑 18 次 → 恢复 profile、删除探档 profile → 统计 → 简报。
- 每个判定都能回溯到「运行编号 + 会话 id + seq」或「文件 + 行号」；事实、推断（写「判断：」）、未知（写「⚪ 未知」）分开。

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

见 2.2。开工时重新核：profile 第 184—186 行原文、6 份样本底稿都存在；对不上就停下报告。

### 9.2 样本检查（跑之前）

| # | 标准 |
|---|---|
| S1 | 6.0 探档数据表（12 次）与 6.1 的档位结论；headless 声明档位后的冒烟 |
| S2 | J08—J11 的样本、提示词、答案齐全；答案格式完整 |
| S3 | J08 逐条核实记录（数字、引文、结论），修正处列清 |
| S4 | `样本冻结.json` 含全部样本、提示词、答案的 sha256，时间早于第一个 Judge 样本运行目录（6.0 探档目录不算） |

### 9.3 运行

每次运行一个目录，命名 `<序号>-<样本号>-<档位>-<第几次>`，序号接在 6.0 探档目录之后（下例的 `NN` 换成实际序号）：

```bash
cd /Users/Admin/Desktop/Promax/promax-project
kit/new-run.sh NN-B4-默认-1 kit/prompts/B4-独立检查.txt kit/fixtures/B4/报告.md kit/评分样本-v1.json
env -u DSH_PROFILE kit/run.sh runs/NN-B4-默认-1 runs/NN-B4-默认-1/prompt.txt run
```

J04 附 `kit/fixtures/judge/J04/*` + `kit/fixtures/scenarios/C04/*`；J08—J11 附各自样本和材料（J09 只附答案设定里「已附」的那部分材料）。

### 9.4 结果表

**逐次表**：每次运行一行：样本、档位、第几次、状态、结论、检出 x/n、误判、Judge 秒、输出 token、Lead 是否读正文（NE-12 观察）。

**档位对照表**（交用户选档，最重要）：

| 样本 | 档位 | PASS 次数 / 3 | 检出（3 次合计） | 误判 | Judge 秒中位数 | 输出 token 中位数 |
|---|---|---|---|---|---|---|

另起一行汇总每个档位：全部样本的 PASS 次数、J08 误报、J09 是否都判 INCOMPLETE、全部 Judge 秒的中位数和最大值。

**判断**（写「判断：」）：哪一档在「检出不降、J08 不误报、J09 判 INCOMPLETE」的前提下最快；按成果类型给出 Judge 耗时建议值（中位数加余量），并说明依据。**只建议，不改 profile**。

### 9.5 卫生

| # | 标准 |
|---|---|
| H1 | profile 已恢复为开工时的字节（sha256 相同）；探档 profile 已删除并留证；`team/` 无差异；`kit/` 只新增 J08—J11 |
| H2 | `runs/` 只新增本轮目录 |
| H3 | `promax-project/` 下没有答案或分析文件 |
| H4 | 结果、分析、终端输出里没有密钥 |
| H5 | 8800 无监听；无残留 dsh 进程和后台任务 |

## 十、收尾

不提交、不删除任何产物；确认 profile 已恢复、没有残留后台任务。

## 十一、交付简报

写到 `promax-eval/结果-10c1-Judge定档.md`，最后一条回复给出相同内容：

1. **一句话结论**：可用档位；推荐哪一档及理由；J08、J09 的结果
2. **档位对照表**（9.4）
3. **样本表**：6 份样本、答案摘要、冻结 sha
4. **逐次表**、用量、报错全表
5. **判断**：推荐档位与按类型的耗时建议值
6. **问题清单**与**运行次数与偏离**
