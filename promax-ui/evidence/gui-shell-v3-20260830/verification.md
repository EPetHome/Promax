# Promax GUI v3 整屏换壳验收

> 时间：2026-08-30 06:08 EDT  
> 安装版本：`@promax/promax-ui-brand@0.1.4`、`@promax/promax-ui-layout@0.1.5`、`@promax/promax-ui-console@0.3.21`、`@promax/promax-bundle@0.1.4`  
> 环境：`DSH_HOME=/Users/Admin/.dsh-promax`，`http://127.0.0.1:3080`；未调用模型、未使用真实公司文档

## 结论

- v3 §6 第 1–10 步已落到正式 profile 并按浏览器可见性复验；Promax 接管 root、左栏、composer、details 与 shell overlay，保留 dsh 对话流内核。
- bundle 只 disable 获准的 `ui-layout`、`ui-sidebar`、`ui-brand-official` 三项；未扩大白名单，未改 dsh `packages/`。
- 宽屏实测外壳 `1252×692 @ (14,14)`，三列 `250 / 730 / 270`，三条 header 基线均为 76px；输入栏在草稿和团队页都固定贴底。
- r3 运行时 roster 显示 7 名成员、8 份业务产物；Judge 报告按成员过滤排除，不进入 8 份业务产物。
- 上游尚无“本次涉及”信号，按主方案回退为 `0 / 8 就绪 · 2 项可选未产出`。这不是“本次不涉及”的推断。
- 本轮没有模型运行，因此 Judge 动态闭环与按成员完成态没有运行证据；人工决策流也不属于本轮。

## 浏览器可见证据

| 证据 | 实测 |
|---|---|
| 宽屏工作台 | `workbench-final-1280x720.jpg`；7 张成员卡、8 个产物条、右栏协调者 1 + 成员 7 |
| 草稿空态 | `draft-final-1280x720.jpg`；dsh hero 可见计数 0；composer 与外壳底边间距 15px |
| 交付物页 | `deliverables-final-1280x720.jpg`；8 张大文件卡、2 项可选未产出、无 Judge 报告 |
| toast | `workbench-toast-final-1280x720.jpg`；点击 `prd.md` 后浏览器可见“prd.md 仍在生成中”，280px 宽、底边 682px |
| 1180 | `responsive-final-1180x760.jpg`；列 `250 / 900`，右栏 `display:none`、宽 0，内容宽 900 |
| 820 | `responsive-final-820x760.jpg`；左栏 290px 抽屉 + 全屏遮罩；关闭态 `translateX(-304.5px)`；topbar 68px；成员/文件单列；隐藏 @ |
| 480 | `responsive-final-480x760.jpg`；单列；第一个工具按钮隐藏；task padding 16px；run/footer 同宽 414px |
| 封版 token | 浏览器计算 `--dsw-promax-task-shadow = 0 14px 42px rgba(37,45,73,.065)`；task-card 计算阴影非 `none`；项目计数为 22px 圆丸、9/760 |

## 表一：九项 dsh 痕迹

| # | 痕迹 | 在哪一屏 | 浏览器里看到了什么 | 结论 |
|---|---|---|---|---|
| 1 | `Into the Unknown` | 草稿空态、团队工作台、无会话任务轨迹 | 文字可见计数 0；草稿空态截图仅见 Promax topbar、交底草稿与贴底 composer。底座 DOM 可保留，未宣称删除。 | ✅ 不可见 |
| 2 | `Describe what you want to build` | 草稿、团队工作台 | 输入框显示“描述任务，或 @ 指定一名团队成员…”，可输入；实点后发送键由 disabled 变为 enabled。 | ✅ 已替换 |
| 3 | `Workspace Write` | 草稿、团队工作台 | composer 仅见附件、@、文本框、发送键。 | ✅ 不可见 |
| 4 | `DeepSeek-V4-Flash High` | 草稿、团队工作台 | 模型选择器可见计数 0。 | ✅ 不可见 |
| 5 | `Settings` 英文入口 | 左栏所有屏 | 左栏底部只见中文“管理控制台 / 设置”。 | ✅ 不可见 |
| 6 | “等待任务 / 轨迹页可查看过程” | 草稿、团队工作台、任务轨迹 | 两段文字可见计数均为 0；无 dsh job dock。 | ✅ 不可见 |
| 7 | dsh 左上折叠、三列几何、点阵 | 宽屏、1180、820、480 | 宽屏是 Promax 14px 外边距、28px 圆角三列；820 为 Promax 抽屉；点阵为 12px、opacity .18、68% 渐隐。 | ✅ 已替换 |
| 8 | dsh 官方品牌位 | 全部屏 | 左上为 P + Promax + AGENT WORKSPACE，页面标题为 Promax；无官方品牌位。 | ✅ 不可见 |
| 9 | 扁平灰调、圆角偏小 | 全部屏 | 浏览器截图显示三层粉/蓝/紫底纹、毛玻璃外壳、指定圆角与阴影；task-card 封版计算阴影与基准一致。 | ✅ 已替换 |

## 表二：§1.2–§1.4 区域、控件与状态

| 区域 / 控件 / 状态 | 状态 | 代码证据与运行结果 |
|---|---|---|
| §1.2 `.app-shell` 几何、边框、28px 圆角、毛玻璃 | ✅ 已有 | `packages/promax-ui-layout/src/client/index.tsx:56`；浏览器 `1252×692 @ 14,14`、`250/730/270` |
| 左右栏底、分隔线 | ✅ 已有 | `packages/promax-ui-layout/src/client/index.tsx:75` |
| 中列双径向底 + `#fbfbfc` | ✅ 已有 | `packages/promax-ui-brand/src/theme.ts:50`、`packages/promax-ui-layout/src/client/index.tsx:81` |
| body 三层晕染、点阵、440px 圆环 | ✅ 已有 | `packages/promax-ui-brand/src/theme.ts:47`、`:157` |
| brand / topbar / right-header 76px 同基线 | ✅ 已有 | `packages/promax-ui-console/src/workbench-styles.ts:14`、`:55`、`:151`；浏览器三者均 76px |
| 宽屏左栏收起、右栏开合 | ✅ 已有 | `packages/promax-ui-layout/src/client/index.tsx:73`、`:204`；实点 `250/1000/0`、`0/980/270` 后恢复 |
| §1.3 topbar：汉堡、kicker+标题、可用性、工具组 | ✅ 已有 | `packages/promax-ui-console/src/client/PromaxWorkspaceShell.tsx:1200`、`:1205`；样式 `workbench-styles.ts:55` |
| view-tabs 50px / 49px / 2px 蓝下划线 | ✅ 已有 | `packages/promax-ui-console/src/workbench-styles.ts:69`；三个 tab 均已实点 |
| main-scroll 唯一滚动容器、workspace-content 居中 padding | ✅ 已有 | `packages/promax-ui-console/src/workbench-styles.ts:74`、`:81`；切 tab 后 scrollTop=0 |
| composer-wrap 常驻底部、毛玻璃 | ✅ 已有 | `packages/promax-ui-console/src/workbench-styles.ts:77`、`:135`；草稿底边间距 15px |
| `.primary-action` 新建草稿 | ✅ 已有 | `packages/promax-ui-console/src/workbench-styles.ts:24`；结构 `PromaxWorkspaceShell.tsx:388` |
| `.sidebar-section-title` | ✅ 已有 | `packages/promax-ui-console/src/workbench-styles.ts:27` |
| `.sidebar-item` active / icon / count | ✅ 已有 | item/icon `workbench-styles.ts:34`；count 圆丸 `:44`；浏览器 22px、999px、9/760 |
| `.conversation-item` 草稿/项目会话行 | ✅ 已有 | `packages/promax-ui-console/src/workbench-styles.ts:29`；结构 `PromaxWorkspaceShell.tsx:224` |
| `.topbar-title` / kicker | ✅ 已有 | `packages/promax-ui-console/src/workbench-styles.ts:58`、`:62` |
| `.team-availability` / 7px status-dot | ✅ 已有 | `packages/promax-ui-console/src/workbench-styles.ts:63` |
| `.toolbar-button` | ✅ 已有 | `packages/promax-ui-console/src/workbench-styles.ts:66`；打开工作区/团队设置实装 |
| `.view-tab` 选中态 | ✅ 已有 | `packages/promax-ui-console/src/workbench-styles.ts:70`；结构 `PromaxWorkspaceShell.tsx:1206` |
| `.workspace-title` | ✅ 已有 | `packages/promax-ui-console/src/workbench-styles.ts:84` |
| `.task-card` + 右上蓝晕 | ✅ 已有 | `packages/promax-ui-console/src/workbench-styles.ts:88`；封版计算阴影为 `.065` |
| `.task-percent` | ✅ 已有 | `packages/promax-ui-console/src/workbench-styles.ts:93`；当前 0% 来自 0-turn 状态 |
| `.progress-track` / value | ✅ 已有 | `packages/promax-ui-console/src/workbench-styles.ts:94` |
| `.coordinator-avatar` | ✅ 已有 | `packages/promax-ui-console/src/workbench-styles.ts:97` |
| `.run-button` | ✅ 已有 | `packages/promax-ui-console/src/workbench-styles.ts:99`；实点会聚焦贴底输入框 |
| `.section-bar` | ✅ 已有 | `packages/promax-ui-console/src/workbench-styles.ts:100` |
| `.agent-grid` 三列 / 820 单列 | ✅ 已有 | `packages/promax-ui-console/src/workbench-styles.ts:103`、`:206`；浏览器 7 卡 |
| `.agent-card` / hover | ✅ 已有 | `packages/promax-ui-console/src/workbench-styles.ts:104` |
| `.agent-avatar` 三色轮转 | ✅ 已有 | `packages/promax-ui-console/src/workbench-styles.ts:109` |
| 成员卡四段字阶 | ✅ 已有 | `packages/promax-ui-console/src/workbench-styles.ts:112`；结构 `PromaxWorkspaceShell.tsx:1162` |
| 成员卡 running / done 视觉 | ⏳ 缺运行时来源 | 样式已在 `workbench-styles.ts:106`、`:117`；本轮没跑模型，当前只可证明“尚未开始”，不能伪造按成员完成态 |
| `.deliverable-card` / `.file-grid` | ✅ 已有 | `packages/promax-ui-console/src/workbench-styles.ts:120`；浏览器 8 项 |
| `.file-item` / ready / 可选未产出 | ✅ 已有 | `packages/promax-ui-console/src/workbench-styles.ts:122`；状态计算 `PromaxWorkspaceShell.tsx:1084`；文件按钮实点 toast |
| 右栏进度树（timeline 规格等价实现） | ✅ 已有 | 容器/行/两段状态 `workbench-styles.ts:167`；结构 `PromaxWorkspaceShell.tsx:1128` |
| `.big-file` 交付物页 | ✅ 已有 | `packages/promax-ui-console/src/workbench-styles.ts:129`；浏览器 8 卡、无 Judge |
| `.composer` / 工具键 / textarea / 44px send | ✅ 已有 | `packages/promax-ui-console/src/workbench-styles.ts:136`–`:145`；逻辑 `PromaxWorkspaceShell.tsx:1013` |
| `.member-item` 当前成员 | ✅ 已有 | `packages/promax-ui-console/src/workbench-styles.ts:157`；协调者 1 + 成员 7 |
| `.team-note` | ✅ 已有 | `packages/promax-ui-console/src/workbench-styles.ts:176`；结构 `PromaxWorkspaceShell.tsx:1137` |
| `.toast` / 28px 绿勾 | ✅ 已有 | `packages/promax-ui-console/src/workbench-styles.ts:177`；portal 结构 `PromaxWorkspaceShell.tsx:1223`；浏览器截图可见 |
| ≤1180 右栏隐藏 / 内容 900 | ✅ 已有 | `packages/promax-ui-layout/src/client/index.tsx:99`、`workbench-styles.ts:188`；浏览器 `250/900` |
| ≤820 290px 抽屉、遮罩、单列、68px、隐藏 @ | ✅ 已有 | `packages/promax-ui-layout/src/client/index.tsx:104`、`workbench-styles.ts:192`；已实点打开和遮罩关闭 |
| ≤480 第一工具隐藏、task 16、run 满宽 | ✅ 已有 | `packages/promax-ui-console/src/workbench-styles.ts:213`；浏览器 414px=414px |
| reduced-motion `.01ms` | ✅ 已有 | `packages/promax-ui-layout/src/client/index.tsx:134`、`workbench-styles.ts:221`；style-policy 覆盖功能包无硬编码颜色 |
| 成员 7 / 业务产物 8 / Judge 报告排除 | ✅ 已有 | roster 从 preset 读：`team-state.ts:144`；按非 Judge 成员过滤：`PromaxWorkspaceShell.tsx:528` |
| 非必需产物“未产出”与必需产物“未就绪” | ✅ 已有 | `PromaxWorkspaceShell.tsx:1078`–`:1113`；浏览器显示两种不同文案 |
| “本次涉及”动态分母 | ⏳ 缺运行时来源 | 上游信号不存在；集中回退函数 `PromaxWorkspaceShell.tsx:1091` 固定 M=8，未把缺文件解释为不涉及 |
| Judge 动态闭环 | ⏳ 缺运行时来源 | 组件已有生成/判定两段投影 `PromaxWorkspaceShell.tsx:542`；本轮无含 Judge 的真实模型运行证据 |

本表没有 ⚠️“只有假数据”项：当前成员与产物清单来自已安装 r3 preset，工作区/会话来自 dsh 运行时；当前 0-turn 状态是现场数据。两项 ⏳ 明确保留，不伪造上游结果。

## 导航四条不变量（换壳后重跑）

1. 草稿、团队、项目组各屏都同屏可见“新建草稿”和“产品智能体团队”；左栏始终 `x=15 / width=249`。
2. 浏览器在草稿 → 团队 → 项目组切换后左栏位置、宽度不变；单元测试还直接断言导航 DOM 节点引用不变（`workspace-shell.test.tsx`）。
3. 项目组页点草稿会话 1 次返回草稿；不刷新、不用系统后退，满足三次内退出。
4. 团队页 breadcrumb 的“产品智能体团队 / 产品”两级均已实点，分别回团队根和项目组。

## 构建、安装与配置证据

- `pnpm test`：16 个测试文件、63 项通过。
- `pnpm typecheck`：通过。
- `pnpm build`：brand、layout、console、bundle 全部通过。
- `pnpm package:dist`：通过；发行包为 brand 0.1.4、layout 0.1.5、console 0.3.21、bundle 0.1.4。
- `shasum -a 256 -c SHA256SUMS`：9 项全部 OK。
- `git diff --check`：通过。
- 安装前后 `dump-config` 差异只有：三项获准 dsh UI 行新增 `disabled:true`、新增 `promax-ui-layout`，以及 patch provenance 注释。
- dsh 仓 `git status --short` 无输出；未写 dsh 源码。
- profile `pnpm peers check` 仍报告 `@promax/promax-report@0.1.0` 的 5 个 dsh peer 未在 profile manifest 直属声明；这是既有 report 包分发告警，不是本轮 GUI 包编译/浏览器运行失败。本轮未越界修改 report 包。

## A 方案保留项

对话流内部的助手气泡、工具调用卡、审批面板、附件面板、`@` / `/` 菜单弹层仍由 dsh `ui-conversation` 及卫星包渲染；Promax token 只改配色、圆角和边框，不改其结构排版。这是 A 方案边界，不计为遗漏。当前 profile 没有一条已运行的团队模型会话，因此本轮没有伪造这些内部面板的可见截图。
