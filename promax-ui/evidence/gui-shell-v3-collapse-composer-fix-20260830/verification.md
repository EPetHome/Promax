# GUI v3 折叠恢复与输入区修复验收

> 验收时间：2026-08-30 EDT  
> 运行态：`@promax/promax-ui-brand@0.1.7`、`@promax/promax-ui-layout@0.1.5`、`@promax/promax-ui-console@0.3.30`、`@promax/promax-report@0.1.1`  
> 环境：`DSH_HOME=/Users/Admin/.dsh-promax`，`http://127.0.0.1:3080`；未调用模型、未使用真实公司文档

## 1. 本次重大问题的结果

- 左右栏：两侧同时收起后，topbar 同时出现「展开导航 / 展开状态栏」；浏览器连续开合两轮，轨道均从 `0px` 恢复到 `250px / 270px`。
- composer：从 fixed overlay 改为布局流中的 `PromaxComposerHost`；工作台、任务轨迹、草稿三屏的内容底边与 host 顶边重叠均为 `0px`。
- 多行输入：textarea `42px → 86px → 42px`，host `117px → 155px → 117px`；内容区跟随缩短/恢复。
- 焦点挪屏：根容器改为 `overflow: clip` 后，四行输入时 `htmlScroll=0`、`bodyScroll=0`、`.app-shell.top=14px`。
- dsh 状态带：移除 Promax 自己误注册的 `promax-agent-status`，并以 `id=goal, priority=-100` 影子 dsh goal 席位；浏览器中「等待任务 / 轨迹页可查看过程」零可见。
- 用量 footer：工作台不可见；任务轨迹可见。

## 2. 浏览器证据

| 证据 | 实测 |
|---|---|
| [工作台最终图](./01-workbench-final.png) | `main-scroll.bottom=608`，`composer-host.top=608`，overlap `0`；用量 footer 不可见 |
| [双栏同时收起](./02-both-panels-collapsed-recoverable.png) | `left-collapsed right-collapsed`；两枚恢复键同时可见；连续两轮恢复到 `250/270px` |
| [任务轨迹最终图](./03-task-trace-telemetry.png) | 无 Promax/dsh goal 状态带；To-dos 作为 A 方案对话内核保留；用量 footer 可见；overlap `0` |
| [1180px](./04-responsive-1180.png) | 右列隐藏，两列布局，内容宽 `900px`，overlap `0` |
| [820px](./05-responsive-820.png) | 左栏抽屉化、右栏隐藏、主区单列，overlap `0` |
| [480px](./06-responsive-480.png) | 第一工具键隐藏、任务卡 padding 16、运行键满宽，overlap `0` |
| [一击回新建草稿](./07-navigation-draft-exit.png) | 团队页点「新建草稿」一次进入草稿；左栏仍同时可见入口与团队 |

四条导航不变量在最终安装态重跑：任意屏左栏同时可见「新建草稿 / 产品智能体团队」；草稿、团队、项目会话之间切换时左栏位置始终 `left=15,width=250`；团队页一次点击回草稿；「产品智能体团队 / 产品」两级面包屑均实点返回对应层。

## 3. 表一：九项 dsh 痕迹

| # | 痕迹 | 哪一屏、看到了什么 | 结果 |
|---|---|---|---|
| 1 | `Into the Unknown` | 新建草稿空态只看到 Promax「开始一份草稿」，底座 hero 被不透明空态覆盖 | ✅ 浏览器不可见 |
| 2 | 英文输入提示 | 工作台、轨迹、草稿均为「描述任务，或 @ 指定一名团队成员…」 | ✅ 不可见 |
| 3 | `Workspace Write` | 三屏 composer 只有附件、成员、文本与发送控制 | ✅ 不可见 |
| 4 | DeepSeek 模型选择器 | 三屏 composer 无模型席位 | ✅ 不可见 |
| 5 | `Settings` 英文入口 | 左下为中文「管理控制台 / 设置」 | ✅ 不可见 |
| 6 | `等待任务 / 轨迹页可查看过程` | 任务轨迹实测 `statusBands=0`、`goalBars=0`、目标文本零命中；保留 To-dos | ✅ 不可见 |
| 7 | dsh 折叠键、三列几何、点阵 | 全屏为 Promax 250/中列/270 外壳；双栏收起后有明确恢复键 | ✅ 已替换 |
| 8 | dsh 官方品牌 | 左上、标题与 favicon 均为 Promax | ✅ 不可见 |
| 9 | 扁平灰调、小圆角 | 全屏使用 Promax token、28px 外壳、毛玻璃和三层底纹 | ✅ 已替换 |

**A 方案保留项**：任务轨迹内的助手消息、工具卡、`Chat / Trajectory`、`Session log`、To-dos、审批/附件面板与 `@`/`/` 弹层仍由 dsh 对话内核渲染；本轮只统一 token，不宣称删除或改写其结构。

## 4. 表二：§1.2–§1.4 区域、控件、状态

| 规格项 | 状态 | 证据（文件:行） |
|---|---|---|
| body 三径向晕染 | ✅ 已有 | `packages/promax-ui-brand/src/theme.ts:47` |
| 12px 点阵、0.18、68% 渐隐 | ✅ 已有 | `packages/promax-ui-brand/src/theme.ts:48-49,179-188` |
| 主列 440px 双层圆环 | ✅ 已有 | `packages/promax-ui-brand/src/theme.ts:50-52,190-201` |
| app-shell 14px / 三列 / 28px / 毛玻璃 / 阴影 | ✅ 已有 | `packages/promax-ui-layout/src/client/index.tsx:56-72` |
| 左右栏背景、分隔线 | ✅ 已有 | `packages/promax-ui-layout/src/client/index.tsx:75-80` |
| 中列复合底色 | ✅ 已有 | `packages/promax-ui-brand/src/theme.ts:50`; `packages/promax-ui-layout/src/client/index.tsx:81-87` |
| brand/topbar/right-header 76px 基线 | ✅ 已有 | `packages/promax-ui-console/src/workbench-styles.ts:14,55,152` |
| 左/右栏收起及恢复 | ✅ 已有 | `packages/promax-ui-layout/src/client/index.tsx:73-80,204-220`; `PromaxWorkspaceShell.tsx:1003,1299-1314` |
| topbar kicker、标题、工具按钮组 | ✅ 已有 | `packages/promax-ui-console/src/workbench-styles.ts:55-68`; `PromaxWorkspaceShell.tsx:1304` |
| 团队可用性药丸 | ⚠️ 只有假数据 | 样式在 `workbench-styles.ts:63-64`；header 文案在 `PromaxWorkspaceShell.tsx:1304` 固定为「团队可用」，尚无独立健康源 |
| 三个下划线 tab | ✅ 已有 | `workbench-styles.ts:69-73`; `PromaxWorkspaceShell.tsx:1305` |
| main-scroll 唯一滚动容器、960px 内容 | ✅ 已有 | `workbench-styles.ts:74-80`; `PromaxWorkspaceShell.tsx:1306` |
| composer-wrap 常驻底部且不遮挡 | ✅ 已有 | `workbench-styles.ts:134-150`; `PromaxWorkspaceShell.tsx:1062-1084,1151-1166` |
| textarea 42–100px 自增长 | ✅ 已有 | `PromaxWorkspaceShell.tsx:1114-1119`; `workbench-styles.ts:144` |
| 用量 footer 只在任务轨迹 | ✅ 已有 | `PromaxWorkspaceShell.tsx:1164`; `workspace-shell.test.tsx:318-336` |
| 新建草稿 primary action | ✅ 已有 | `workbench-styles.ts:24-25`; `PromaxWorkspaceShell.tsx:1005` |
| 侧栏分组标题、会话、团队、项目、计数、footer | ✅ 已有 | `workbench-styles.ts:27-48`; `PromaxWorkspaceShell.tsx:999-1010` |
| topbar 面包屑可点击返回 | ✅ 已有 | `workbench-styles.ts:59-61`; `PromaxWorkspaceShell.tsx:1304` |
| workspace 标题与说明 | ✅ 已有 | `workbench-styles.ts:80-86`; `PromaxWorkspaceShell.tsx:1250` |
| task-card、百分比、进度条、协调者、运行键 | ✅ 已有 | `workbench-styles.ts:87-98`; `PromaxWorkspaceShell.tsx:1251` |
| agent-grid 三列、7 卡 3+3+1 | ✅ 已有 | `workbench-styles.ts:102-118`; `PromaxWorkspaceShell.tsx:1250-1253` |
| 成员运行/完成/阻断状态 | ✅ 已有 | `PromaxWorkspaceShell.tsx:1253`；当前真实 r3 回放为 2 已完成、5 尚未开始 |
| file-grid 三列、8 项 3+3+2 | ✅ 已有 | `workbench-styles.ts:119-126`; `PromaxWorkspaceShell.tsx:1255` |
| 可选未产出 / 已生成待判定 / 已完成可验收 | ✅ 已有 | `PromaxWorkspaceShell.tsx:1169-1204`; `workbench-styles.ts:122-123` |
| `N/M` 的本次涉及信号 | ⏳ 缺运行时来源 | 集中回退函数在 `PromaxWorkspaceShell.tsx:1182-1189`；当前按 M=8，等待上游 involvement signal |
| timeline-item 精简事件流 | ❌ 缺失 | §2.3 明定 A 方案本轮不自绘事件流，任务轨迹保留 dsh 对话流 |
| 交付物 big-file 两列 | ✅ 已有 | `workbench-styles.ts:127-132`; `PromaxWorkspaceShell.tsx:1260-1261` |
| 右栏 1+7 当前成员列表 | ✅ 已有 | `PromaxWorkspaceShell.tsx:1207-1217`; `workbench-styles.ts:157-166` |
| 右栏成员独立 presence | ⚠️ 只有假数据 | `PromaxWorkspaceShell.tsx:1215` 只按团队全局 evidence 投影，不是成员级心跳 |
| 右栏 8 产物进度树、生成/判定双状态 | ✅ 已有 | `PromaxWorkspaceShell.tsx:1219-1226`; `workbench-styles.ts:168-176` |
| team-note | ✅ 已有 | `PromaxWorkspaceShell.tsx:1228`; `workbench-styles.ts:177` |
| toast | ✅ 已有 | `PromaxWorkspaceShell.tsx:1273-1315`; `workbench-styles.ts:178-180`；浏览器实点显示「customer_research.md 仍在生成中」 |

## 5. 工程门禁

- `pnpm test`：16 文件、67/67。
- `pnpm typecheck`：通过。
- `pnpm build`：通过。
- `pnpm package:dist`：brand `0.1.7`、layout `0.1.5`、console `0.3.30`、report `0.1.1`。
- `shasum -a 256 -c SHA256SUMS`：9/9 OK。
- 安装前后 `dsh --profile web --dump-config`：17,269 bytes 逐字一致。
- disable 白名单仍只有 `ui-layout`、`ui-sidebar`、`ui-brand-official`。

## 6. 不扩大结论

- 本轮未完成、也不宣称完成 5.9 人工决策流或 Judge 动态闭环。
- 右栏只投影已有数据；没有运行时数据不伪造完成态。
- 主计划 §3 第 6 项的技术归因需要负责人修订：可见三句来自 Promax 自己的 `promax-agent-status`；dsh `ui-goal` 实际注册在 `conversation.input.dock`，不是 `conversation.composer.dock`。本轮未改计划文档。
