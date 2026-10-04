# 阶段三｜Judge可靠判定结果

📍 **JR-SR01(P1)／JR-SR02(P2)返修通过独立静态复评，两项可关闭；阶段三按本任务工程/静态范围可收口，见[关闭结论](#judge-reliability-repair-static-review)。**0.1.103加载及原失败记录保留；真实Judge效果/业务体验未验，非全仓全绿声明。

## 📎 任务准备｜2026-09-25

- 任务：[阶段三整体开发任务](../01-指派任务/03-Judge可靠判定任务.md/01-指派任务.md)；设计：[完整方案](../00-基线/03-阶段三Judge可靠判定方案.md)。一份任务覆盖引用依据、关闭原因、新旧合同、工程与交付；JR01—JR08是验收项，不是新增工作流或子批。
- 已静态核对当前schema/stage/commit、问题历史及指标消费者、Judge基础规则与发布入口。准备依据与身份见[静态核对](证据/JUDGE-RELIABILITY-01/任务书静态核对.json)。Pi0.84.3、权限扩展32.0.2、gpt-6-sol条目及启动资源按当前安装核对，实际运行加载待Pi启动确认。
- 已按work-wiki当前索引查询并采用LLM-as-a-Judge、Agent评估、工具设计原则及“门禁全绿不等于语义正确”经验；具体采纳及适用限制写入任务§10。Wiki只读，未回填或写候选台账。
- 本轮只写任务/准备记录/入口与检查点；未修改产品、未运行测试/构建/服务/真实Judge，未代启动Pi或第二开发会话。阶段二EC-SR01工程/0.1.101加载为已有记录，尚待独立静态复评，未被本轮关闭。

## 🛠️ Pi工程与安全加载｜2026-09-25

**合同/兼容判据（实施口径，事后写入本结果；未在改码前单独成文）：**共享 `promax_check_result` schema 保留字段可选以兼容旧会话；从实际加载并在任务授权时冻结的 TeamRevision 字节解析 `spec.judge_contract=citations-resolution-v1`，记录于运行快照并在 stage、权威 commit 复核字节和身份。新合同每个 issue 必填 `basis=quoted|missing_required`：quoted 的 `citations:[{file,version:current,line_start,line_end,quote}]` 为本轮登记文件的逐字定位；缺失类给真实 scope 中必需 `requirement_ids`、已查 `checked_artifacts`，不伪造引文。每条至多4处/每处400字符/单次20行，行范围内0或多命中拒收；文件和原句从程序版本读，不收模型传路径或哈希。新合同 `rechecks.state=verified` 必填 `resolution=fixed|false_positive` 和当前/原始被审版引用；非关闭不能伪造原因；缺旧版和多次同名不同指责不撤回。旧 r10 及更早合同没有该能力，不从当前包号升级，不倒填旧关闭原因。程序核对字节、要求及授权，语义推断仍由Judge负责。

- ✅ **JR01—JR04：**`judge-evidence.ts` 为 stage/commit 共享验证；两次检查绑定文件/版本与引用，原始被审版取本工作 `被审版本/<程序登记hash>`。权威记录保留新 issue 引文、recheck 原因/引文和历史；重开清除当前原因，历史保留。报告 YAML 与表格、现有 WorkApp 将 fixed／撤回／历史未知分开；`judge-evaluation` J1/chain metrics 保留冻结必回查分母并分类关闭，不把Judge自报撤回计作成员修复或独立真值。无引用不能换kind绕过。修前[日志](证据/JUDGE-RELIABILITY-01/修前反例.log)只证明新测试导入当时不存在的模块而失败，**不是有意义的语义修前反例**；未将其冒称验证误判减少。
- ✅ **JR05：**新未占用 r11 编译并验证清单139项；r10 旧资源留在新包，旧 r10 会话按原 preset 继续解析，新会话 UI 默认 r11；`productRevisionForSession`、旧 r8/r9 绑定与冷读测试通过。基础模块、rubric、新简报、schema条件规则和已装资源均按各自版本区分。[资源核对](证据/JUDGE-RELIABILITY-01/预设资源核对.log)。
- 🟡 **JR06：**[调试集](../02-验证记录/证据/JUDGE-RELIABILITY-01/冻结调试样本身份.json)共7个隔离合成对照/候选，涵盖正确/故意错误的分类、无主题频次却称集中/明确限缩、撤回/修复及开发者改写候选；参考待独立确认。后续单一[效果验证入口](证据/JUDGE-RELIABILITY-01/01-后续效果验证入口.md)，本次零真实Judge/业务模型调用。未证明真实误报或漏报变化。
- ✅ **JR07定向工程：**`TMPDIR=/private/tmp vitest run --testTimeout 15000` 覆盖 bundle/console 13文件 **137/137**（[集成日志](证据/JUDGE-RELIABILITY-01/受影响最终集成复验.log)）；之后仅补一个原始身份冲突测试，`tsc --noEmit -p tsconfig.json`与其定向 4/4 均通过（[补测](证据/JUDGE-RELIABILITY-01/身份冲突补测.log)）。涵盖阶段二 evidence-links/rating-usability 门禁及旧Judge生命周期。r11 `cli verify` 139文件及team-harness `judge-reliability`/`frozen-statistics` 2/2通过（[日志](证据/JUDGE-RELIABILITY-01/团队最终定向.log)）。bundle `tsdown`、console `tsdown`+`vite build`成功（[bundle](证据/JUDGE-RELIABILITY-01/bundle最终构建.log)／[console](证据/JUDGE-RELIABILITY-01/console最终构建.log)）；包内旧测试**未全绿**，见下文失败，不能称全仓通过。
- 📦 **JR08实际生效：**归档 bundle **0.1.102**、console **0.3.158**、team-harness **0.6.19**；归档中除 pnpm 规范化 `package.json` 键顺序外所有文件与本次源码/构建字节相同，离线安装输出 `downloaded 3` 是本地 file: 包（[归档身份](../../../old-version/.runtime/releases/judge-reliability-20260925/archive-identity.json)／[安装核对](证据/JUDGE-RELIABILITY-01/安装字节核对.log)）。阶段二EC-SR01独立静态复评已通过，接手备份 `work-store.ts`、`structured-results.ts` 哈希与其复评最终身份完全相同；未改其续绑 `evidence-links.ts` 或原任务7记录。活动初查/停止前重查均无600秒内会话写入、无子进程、仅3个localhost连接；对旧PID74179只发SIGTERM并自行退出，未用根stop/restart或强停（[初查](证据/JUDGE-RELIABILITY-01/安全活动初查.log)／[TERM](证据/JUDGE-RELIABILITY-01/有界停止.log)）。备份旧profile/锁、三旧包/安装目录及r10资源在 [recovery](../../../old-version/.runtime/releases/judge-reliability-20260925/recovery)；只替换profile三项file:声明，锁diff只涉及三包。`./start.sh start`安全启动PID **83640**，localhost HTML内存中的 bundle0.1.102／team0.6.19模块SHA与构建/安装一致，console静态模块SHA与安装一致，r11预设139文件与安装包相同，r10旧资源139文件保持（[启动](证据/JUDGE-RELIABILITY-01/安全启动.log)／[加载身份](证据/JUDGE-RELIABILITY-01/实际加载身份.json)）。主入口：`http://127.0.0.1:8800/`；新会话可检查新合同，旧会话仍看旧绑定；**未用浏览器或真实会话验证这两个产品交互**。

### ⚠️ 失败与未确认

- 首次合并跑13文件默认5秒超时：r11 fixture 拷贝与并行IO令 `promax-session-binding` 一项超时，清理时因拷贝未结束出现 ENOTEMPTY；改为15秒超时复跑同批 **137/137通过**（[原失败](证据/JUDGE-RELIABILITY-01/受影响最终集成.log)、[复验](证据/JUDGE-RELIABILITY-01/受影响最终集成复验.log)），未删除断言。console样本一度仍写r10导致75/76，改为r11后76/76，原失败保留（[原日志](证据/JUDGE-RELIABILITY-01/界面入口定向.log)）。
- 原team-harness旧测试 `first-usable/review-revision` **5失败**（固守早期r2/r8包入口/文件数），`prx006/modern-layout` 中**3失败**（旧Judge工具名单/“最多两轮”断言及一项旧web拒收预期）；本轮未改旧发布字节或为绿灯降低断言。前两类与接手r10现状冲突；web失败尚未独立定位，不能宣称team全测通过（[旧测](证据/JUDGE-RELIABILITY-01/团队旧测中检.log)／[受影响团队测](证据/JUDGE-RELIABILITY-01/团队受影响集成.log)）。
- 先前打包逐字比较时 `package.json` 被pnpm仅重排键，改按JSON语义比对后其余文件逐字通过；首次静态HTML提取把动态插件列表误认为 script 标签，调整解析后才取得[实际加载身份](证据/JUDGE-RELIABILITY-01/实际加载身份.json)，不冒充首次成功。
- **未验：**真实Judge判断J1-01/J1-02或独立改写集、误判率/漏判率、真实成员修改与关闭语义、浏览器/用户体验、效率、旧会话真实续接；这些不能由引用存在、单元测试、归档或服务加载推断。Codex独立静态复评尚未进行。补测只改测试字节，无再次构建/加载需求；[最终源码身份](证据/JUDGE-RELIABILITY-01/最终源码身份.sha256)。

📍 **下一步：**交Codex按任务JR01—JR08独立静态复评并核对上述未定位旧web测试是否阻断本批；真实Judge效果须用户另行明确模型/配置、两个集合、运行次数/费用上限与停止条件后才运行。若需恢复，先重新核进程活动、已安装和用户后续改动；只能在安全停机后按 recovery 中三旧包及旧profile/锁做有界恢复，不能直接覆盖后续工作或强停。


<a id="judge-reliability-static-review"></a>

## 🔎 Codex独立静态复评｜2026-09-25

**暂不通过：1项P1（JR-SR01）和1项P2（JR-SR02），阶段三尚不能工程收口。**本轮仅读任务、接手差异、源码调用链、测试代码、既有日志和文件字节，没有执行测试/fixture/复现、类型/构建、接口、模型、浏览器、进程探测或服务操作，没有修改产品。以下触发结果均为静态代码推导，未运行复现。

📎 [核对与发现索引](证据/JUDGE-RELIABILITY-01/独立静态复评.json)：32项最终身份匹配、21项声明的接手身份匹配；三包归档与当前安装逐文件相同，r10/r11各139项源码/安装/挂载资源匹配，模块身份与既有加载记录相同。此结论不代表当前进程或业务效果已重验。

### 🔴 JR-SR01｜P1：新Judge合同拒绝平台合法中文任务名

位置：[judge-evidence.ts:36](../../../old-version/promax-ui/packages/promax-bundle/src/judge-evidence.ts:36)。新校验只允许ASCII字母、数字、下划线和连字符；而[index.ts:1978](../../../old-version/promax-ui/packages/promax-bundle/src/index.ts:1978)的现役任务名契约明确允许中文，normalizedTaskKey保留汉字、空标题回退为“产品任务”，ensureSessionOutputDirectory把该名称作为task_key保存。

触发：r11新合同任务的合法task_key含中文，例如“评分分析”或“产品任务”。stage和权威commit都会调用新验证器，直接返回“检查任务身份无效”；即使引用/权限/版本都正确，PASS、REVISION_REQUIRED、INCOMPLETE也不能提交。这会阻断常用中文任务的Judge收口，不能靠让模型改名或重试解决。

最小修正：复用或对齐现有安全task_key契约，保留穿越、非法字符和目录身份保护，不另建互相矛盾的正则。验收需经过实际任务命名/创建→严格r11合同→已注册工具→权威提交；当前judge-reliability测试手工设task_key='t'，没有覆盖真实中文命名链。其它通用fixture的r11又是未声明新能力的合成revision，其通过不能抵消这个缺口。

### 🔴 JR-SR02｜P2：一次正常open复查会阻断后续关闭

位置：[judge-evidence.ts:104](../../../old-version/promax-ui/packages/promax-bundle/src/judge-evidence.ts:104)，关联[work-store.ts:884](../../../old-version/promax-ui/packages/promax-bundle/src/work-store.ts:884)。验证器把所有state=open的历史行当成原始指责，并要求多行的evidence与claim_sha256一致。实际存储中，issue声明会写claim_sha256，正常rechecks.state=open历史则不写该字段。

合法触发链：r1提出I1 → r2复查“仍未修复”，记录open → r3已修复或发现原判错误，提交verified。r2这条正常复查会被混入“原始指责”集合；即使它的evidence原样不变，也因缺claim_sha256被判身份冲突。fixed和false_positive都受影响，问题被迫保持unverifiable，无法正常关闭。现有用例覆盖了直接open→verified和真正同名不同指责，未覆盖open复查后再关闭。

最小修正：区分问题声明/身份事件与复查观察，不能仅靠open状态判断原始指责。保留对真正复用ID表达不同指责的拒绝；不要简单忽略所有缺hash历史或复制同一hash掩盖冲突。补注册链“提出→open复查→fixed/false_positive”的必要正向和真实身份冲突反例，旧历史未知仍保守。

### 📎 已有证据、失败归属与限制

- 已有13文件137/137、补测4/4、类型/构建、新revision及加载记录保留；它们没有覆盖上述两个组合。本轮不复跑，也不将工程候选写成真实Judge语义通过。
- 修前日志只是导入尚不存在模块失败，不能证明原行为反例；实施记录已披露此限制。返修时应针对上面具体触发链留有意义的修前/修后证据。
- 旧team八项失败不改写为通过。其中web失败的测试在prx006第177行要求缺一个抓取来源引用就拒绝进入；旧0.6.18-dist.1安装包已采用“抓取不等于采用”的策略并返回uncited/non_fact信息，当前harness相对此旧包仅新增judge_contract编译透传。因此该web失败静态归为旧断言与既有行为冲突，不是本批新增回归；其余早期r2/r8入口、旧工具名单/措辞断言也不能当作当前包全绿。未运行旧版对照测试。
- 接手harness副本与当前相同，且不等于准备时SHA；本轮改用恢复目录的旧0.6.18归档核对其真实差异。rubric/参考集缺准备对应的接手副本，rubric从旧归档对照，参考集保持rule_debug/excluded及待独立确认。保留这些取证限制，不补写“改码前已全量备份”。
- 真实Judge误报/漏报、关闭语义、浏览器体验、旧会话实际续接与效率均未验证；七个合成候选不等于独立业务真值。阶段二已关闭范围不重开。

📍 下一步仅针对JR-SR01/JR-SR02返修并补必要注册链反例，完成后再静态复评；不新增阶段三子批或产品评审环节。本轮不代改源码或启动真实Judge。

<a id="judge-reliability-repair-preparation"></a>

## 📍 JR-SR01／JR-SR02返修提示词准备｜2026-09-25

用户要求修复；按Pi开发/Codex静态复评分工，已追加[同一任务§12](../01-指派任务/03-Judge可靠判定任务.md/01-指派任务.md#judge-reliability-repair)。两项一起完成，不新增独立阶段或产品工作流：中文任务名对齐现有安全契约；区分原始声明与open复查观察，兼容0.1.102既有历史而不掩盖真实身份冲突。明确实际任务生成/严格r11注册链、open后分别fixed/false_positive的修前/修后反例及必要回归、安全交付。

[静态核对](证据/JUDGE-RELIABILITY-01/返修/返修提示词静态核对.json)记录5项当前源码/测试身份、任务SHA、Pi0.84.3/权限32.0.2及CLI/资源源码；任务链接无缺失。工具按本地返修选read/edit/write/bash、权限扩展、context-relay；保留llm-wiki-query按需只读，本轮未查询/回填Wiki。未修改产品、运行测试/模型/接口/服务或启动Pi；结果仍待实施后独立复评。

<a id="judge-reliability-repair-result"></a>

## 🛠️ JR-SR01／JR-SR02 Pi返修结果｜2026-09-25

**两项修复已落盘、安全加载，待Codex静态复评；真实Judge效果未授权／未运行。**实际会话模型 `openai-codex/gpt-6-sol`、思考 `xhigh`；接手5项源码/测试SHA与[复评准备](证据/JUDGE-RELIABILITY-01/返修/返修提示词静态核对.json)完全一致，9份受改/关联文件在修改前逐字备份并核SHA（[接手](证据/JUDGE-RELIABILITY-01/返修/接手身份.sha256)）。仅修改 bundle `src/{index,judge-evidence,work-store}.ts`、新增 `src/task-key.ts`、共享类型 `console/src/review-protocol.ts`、新增 `tests/judge-repair.test.ts`及 bundle package 0.1.102→**0.1.103**；console/team/r11 只有类型读取或既有资源核查，**未重发/原地修改**。不改旧报告/数据/会话、阶段二续绑或原任务7。

- ✅ **JR-SR01：**抽出现役新任务名与已绑定历史名的安全契约到纯 `task-key.ts`，`index.ts`任务生成/会话目录和 `judge-evidence.ts`共用；Judge逐字核对绑定 `task_key`，不替会话重新命名。由 `taskKeyFromSubmission`→`ensureSessionOutputDirectory`→`WorkStore.authorize`实际形成中文、回退“产品任务”、英文/中文数字连字符的task_key，载入真实编译r11 TeamRevision字节且确实有 `citations-resolution-v1`，经注册 `promax_check_result`→stage→权威commit→回读报告/ledger；危险新任务名、历史穿越/绝对路径和非法字符仍拒绝，已存安全旧名不强套新命名语法。
- ✅ **JR-SR02：**问题声明历史新写 `origin=issue` 与原有claim摘要，复查新写 `origin=recheck`；正常 `open` 只是观察，不产生第二声明。对已装0.1.102无标记的open复查及更旧无摘要声明，严格限定历史 `request/report` 路径，回读该行程序渲染报告，核轮次/被审SHA、ID、成果、evidence及复查状态后才判来源；缺/错报告、真实同ID不同声明仍保守拒绝关闭，不盲填摘要或改写旧历史。fixed引用当前版，false_positive引用原被审版；正常同文/改写open复查后两种关闭均在同一ID持久，报告原因及指标读取仍按原逻辑。幂等重复提交不重记历史。引用及权限版本门禁沿用共享stage/commit核对。
- 🧪 **有意义修前→修后：**[修前注册链](证据/JUDGE-RELIABILITY-01/返修/修前注册反例.log)13项中7失败：3个合法中文名“检查任务身份无效”，4组提出问题→open观察→verified报身份冲突；另6项（ASCII/危险名称/真身份冲突）通过。修后同链扩充空标题回退、旧声明回读、缺报告保守负例、历史安全名及路径负例为[17/17通过](证据/JUDGE-RELIABILITY-01/返修/两项修后注册定向.log)；这不是模型语义判断测试。`tsc --noEmit -p tsconfig.json`退出0；[受影响10文件集成](证据/JUDGE-RELIABILITY-01/返修/受影响集成.log)9文件通过，`session-output`其余旧2项失败（xlsx预览`truncated`期望、两轮失败后话术），非本轮变更路径但**未运行旧版对照，不能宣称全包绿或已独立归因**；其任务命名3项按[现有定向回归](证据/JUDGE-RELIABILITY-01/返修/任务名原有回归.log)通过。旧team八项失败保留，不借此改无关web策略。bundle定向[tsdown构建](证据/JUDGE-RELIABILITY-01/返修/bundle构建.log)成功。
- 📦 **安全交付：**只归档/离线安装 bundle0.1.103（[归档6文件及构建SHA](../../../old-version/.runtime/releases/jr-sr01-sr02-20260925/archive-identity.json)／[安装核对](证据/JUDGE-RELIABILITY-01/返修/安装字节核对.log)），保留 console0.3.158、team0.6.19、旧r10和新r11资源原字节。只读活动[初查](证据/JUDGE-RELIABILITY-01/返修/安全活动初查.log)及停前复核：PID83640为原8800进程，无子进程/近600秒会话写入，3条localhost连接；仅发TERM自行退出（[记录](证据/JUDGE-RELIABILITY-01/返修/有界停止.log)），未用根stop/restart或SIGKILL。原profile/锁/0.1.102归档/安装目录备份在 [.runtime恢复材料](../../../old-version/.runtime/releases/jr-sr01-sr02-20260925/recovery)；声明与锁仅bundle一项变化，安装6文件逐字等于归档。`./start.sh start`启动PID **88713**（[启动](证据/JUDGE-RELIABILITY-01/返修/安全启动.log)）；localhost HTML内存中bundle **0.1.103** 的模块SHA `2c69557d…`与构建/归档/安装一致，console静态脚本与team加载模块SHA均仍等于上次记录，r10/r11预设清单SHA未变（[加载身份](证据/JUDGE-RELIABILITY-01/返修/实际加载身份.json)）。既定入口：`http://127.0.0.1:8800/`；未开浏览器或真实会话。若恢复，须先核活动及后续用户改动，不能直接覆盖新工作或强停。

🟡 **未确认：**本轮修复仍待Codex独立静态复评；真实Judge误报/漏报、旧会话真实续接、浏览器与业务体验均未验。技术测试与静态模块加载不等于业务通过。定向源码/测试/构建[最终身份](证据/JUDGE-RELIABILITY-01/返修/最终源码身份.sha256)。下一步交Codex只复评这两项及其必要保护；不自动调用模型或开展阶段四。

<a id="judge-reliability-repair-static-review"></a>

## 🟢 JR-SR01／JR-SR02返修独立静态复评｜2026-09-25

**通过本次静态复评，未发现本批新增需返修问题；JR-SR01(P1)、JR-SR02(P2)可关闭。阶段三可按本任务工程/静态范围收口，真实Judge语义及业务效果仍未验。**本轮只读接手差异、调用链、测试代码、原失败/修后日志与文件身份，没有运行测试、fixture、复现、类型/构建、接口、模型、浏览器、进程探测或服务，没有修改产品。

📎 [静态核对索引](证据/JUDGE-RELIABILITY-01/返修/独立静态复评.json)：最终14项与接手9项身份匹配；当前profile仅bundle依赖变化，0.1.103归档6文件与安装一致，入口SHA与既有加载记录一致；r10/r11各139项源码/安装/挂载资源均匹配。当前进程状态未重验。

| 原问题 | 关闭依据 |
|---|---|
| JR-SR01 中文任务名 | 新task-key.ts逐项保留原入口的安全规则，仅抽为纯共享模块；新命名与历史已绑定命名仍分开。Judge用同一sessionScopeNameOf并要求不改变绑定名称（[judge-evidence.ts:73](../../../old-version/promax-ui/packages/promax-bundle/src/judge-evidence.ts:73)）。测试经过taskKeyFromSubmission、目录创建、WorkStore.authorize、真实r11合同能力、工具定义execute及权威commit；中文、空标题回退、英文和中英数字组合通过，危险路径/非法名拒绝。 |
| JR-SR02 open后关闭 | 新写入的origin明确issue/recheck，正常open观察不再当作原声明；旧无标记行回读其request/report限定路径的程序报告，核轮次、被审哈希、ID、evidence及状态后识别（[judge-evidence.ts:142](../../../old-version/promax-ui/packages/promax-bundle/src/judge-evidence.ts:142)）。缺报告/来源未知及真正同ID不同声明仍保守拒绝；原始版和当前版引用规则保持。 |

已核对新增17项测试的正反断言：open说明原样/更新后均能分别fixed或false_positive；0.1.102旧open和更早缺摘要声明按各自报告辨认，不回写旧历史；真身份冲突/缺报告不被忽略，持久原因、报告、计数及重复提交均有覆盖。修前7/13行为失败、修后17/17及任务名原有3/3为Pi既有运行记录，本轮未重跑。

🟡 **失败与验证边界：**受影响10文件集成记录为94通过、2失败，不能称全绿。xlsx预览truncated断言和停止后的话术断言对应本次未改动的代码/测试；本轮静态未见它们由任务名函数等价抽取或历史来源分类引入，因此不作为此次两项返修阻断，但保留失败，未运行旧版对照，也不宣布这两项产品问题已解决。旧team八失败继续保留。真实Judge误报/漏报、旧会话业务续接、浏览器、效率仍待另行授权验证。

📍 当前开发返修到此收口，旧执行/部署命令不自动重跑；可依据[后续效果验证入口](证据/JUDGE-RELIABILITY-01/01-后续效果验证入口.md)准备独立业务验收。未获模型/样本/次数预算授权前不调用真实Judge，本轮不启动阶段四。
