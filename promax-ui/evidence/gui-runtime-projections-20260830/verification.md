# GUI 运行时状态投影与精简事件验收

> 验收时间：2026-08-30 EDT  
> 运行态：`@promax/promax-ui-brand@0.1.7`、`@promax/promax-ui-layout@0.1.5`、`@promax/promax-ui-console@0.3.33`、`@promax/promax-bundle@0.1.4`、`@promax/promax-report@0.1.1`  
> 环境：`DSH_HOME=/Users/Admin/.dsh-promax`，`http://127.0.0.1:3080`，PID `81664`，HTTP 200  
> 数据：只回放已有脱敏 CP3 会话；GUI 验收未发送任务、未调用模型、未使用真实公司文档

## 1. 本次四项结果

| 原缺口 | 最终结果 | 运行时证据 |
|---|---|---|
| 团队可用性药丸是假数据 | ✅ 改为 native session 的 `removed / openState / lastAgentError / pending / runningCalls / running / queue` 投影；topbar 和工作台元信息共用同一映射 | CP3 空闲态两处均显示「团队待命」；活动会话实见「团队运行中」；源码 `PromaxWorkspaceShell.tsx:641-652,1454-1456,1478` |
| `N / M` 缺本次涉及来源 | ✅ M 由当前会话精确 `deliverables/<task-key>/<filename>` 路径决定：六个必需项恒计入，两项可选仅在当前任务轨迹出现精确路径时计入；空 roster 才回退 8 | CP3 实见 `1 / 6 就绪 · 2 项可选未产出`；单测覆盖可选项出现后 `6→7`；源码 `PromaxWorkspaceShell.tsx:563-606,1336-1342,1427` |
| 精简 timeline-item 缺失 | ✅ 按负责人批准的第二种做法，在工作台任务卡下新增最多 3 条「关键事件」；完整 dsh 对话仍留在任务轨迹 | CP3 实见「任务已进入团队会话」「第 1 轮任务路径已出现」；第二条明确写「不等同于已经生成或判定」；源码 `PromaxWorkspaceShell.tsx:674-763,1404-1424` |
| 成员独立 presence 是团队级假数据 | ✅ 改为按成员负责的当前任务产物与 Judge 回执分别映射 `尚未开始 / 运行中 / 已完成 / 已阻断`，不伪装在线心跳 | CP3：主智能体、solution_design、quality_judge 为已完成，其余为尚未开始；8 个状态点都在右栏 `996–1265px` 内，点坐标统一为 `1238–1245px`；源码 `PromaxWorkspaceShell.tsx:619-630,1360-1375`，布局约束 `workbench-styles.ts:175-188` |

## 2. 浏览器证据

| 证据 | 看到了什么 |
|---|---|
| [CP3 最终工作台](./01-workbench-cp3-final.png) | 真实「团队待命」、17%、2 条关键事件、右栏绿/黄独立状态点、常驻 composer |
| [双栏同时收起仍可恢复](./02-both-collapsed-recoverable.png) | grid 为 `0px 1250px 0px`，topbar 同时出现「展开导航 / 状态栏」；实点恢复为 `250px 730px 270px` |
| [任务轨迹](./03-task-trace-final.png) | 完整 dsh `Chat / Trajectory / Session log / To-dos` 仍在；composer overlap 为 0；用量 footer 仅此屏可见 |
| [交付物](./04-deliverables-final.png) | 8 张业务产物大卡，`1 / 6 就绪`，两项可选未产出；Judge 报告不在卡片中 |
| [1180px](./05-responsive-1180.png) | grid 变 `250px 900px`，右栏 rect 为 0，内容宽 900px |
| [820px](./06-responsive-820.png) | grid 单列 820px，左栏抽屉移出视口，topbar 68px，成员/文件单列，可用性药丸隐藏 |
| [480px](./07-responsive-480.png) | 第一工具按钮隐藏、task-card padding 16px、run-button 414px 满行、composer 三列且 @ 区隐藏 |

浏览器品牌取证：页面标题 `CP3脱敏联调任务配置 — Promax`；Promax favicon 1 个、非 Promax favicon 0 个。工作台可见文本中 `Into the Unknown / Describe what you want to build / Workspace Write / DeepSeek-V4-Flash / Settings / 等待任务 / 轨迹页可查看过程` 均为 0 命中。

## 3. 四条导航不变量（本次重跑）

| 不变量 | 浏览器实点结果 |
|---|---|
| 任意屏同见「新建草稿 / 产品智能体团队」 | 团队会话和草稿会话分别取快照，两入口均各 1 个 |
| 页面切换不移动左栏 | 团队会话、草稿、团队根、项目层的左栏均为 `left=15,width=249`（CSS 轨道 250px） |
| 团队页一击回草稿 | 从 CP3 团队页单击已有脱敏草稿一次进入 `.promax-draft-chrome`，未刷新、未后退 |
| 团队/项目面包屑逐级返回 | 会话页点「产品」返回项目层，标题/heading 均为「产品」且无当前 session；点「产品智能体团队」返回团队根 |

## 4. 表一：九项 dsh 痕迹

| # | 痕迹 | 在哪一屏、浏览器看到了什么 | 结果 |
|---|---|---|---|
| 1 | `Into the Unknown` | 草稿空态由不透明 Promax 层覆盖；工作台截图与可见文本均无该标题 | ✅ 浏览器不可见（不宣称 DOM 已删除） |
| 2 | `Describe what you want to build` | 工作台、任务轨迹、交付物 composer 均为「描述任务，或 @ 指定一名团队成员…」 | ✅ 不可见 |
| 3 | `Workspace Write` | composer 只有附件、成员、文本和发送控制 | ✅ 不可见 |
| 4 | DeepSeek 模型选择器 | 三屏 composer 均无模型席位 | ✅ 不可见 |
| 5 | `Settings` 英文入口 | 左下只显示中文「管理控制台 / 设置」 | ✅ 不可见 |
| 6 | `等待任务 / 轨迹页可查看过程` | 工作台与任务轨迹均无 Promax 状态带/dsh goal 文案；任务轨迹保留 To-dos | ✅ 不可见 |
| 7 | dsh 左上折叠键、三列几何、底纹 | 250/中列/270 的 Promax 外壳，28px 圆角、三层底纹；双栏同时收起后仍有两枚恢复键 | ✅ 已替换 |
| 8 | dsh 官方品牌 | 左上、页面标题、favicon 均为 Promax；非 Promax favicon 为 0 | ✅ 不可见 |
| 9 | 扁平灰调、小圆角 | 全屏为 Promax token、毛玻璃、卡片阴影和锁定圆角 | ✅ 已替换 |

**A 方案保留项（如实可见）**：任务轨迹内的助手消息、工具卡、`Chat / Trajectory`、`Session log`、To-dos、审批/附件面板与 `@`/`/` 弹层仍由 dsh 对话内核渲染。截图 `03-task-trace-final.png` 明确保留这些结构；本轮只统一 token，不宣称删除或重排。

## 5. 表二：§1.2–§1.4 区域、控件、状态

| 规格项 | 状态 | 证据（文件:行） |
|---|---|---|
| body 三径向晕染 | ✅ 已有 | `packages/promax-ui-brand/src/theme.ts:47,171-178` |
| 12px 点阵、0.18、68% 渐隐 | ✅ 已有 | `packages/promax-ui-brand/src/theme.ts:48-49,179-188` |
| 主列 440px 双层圆环 | ✅ 已有 | `packages/promax-ui-brand/src/theme.ts:50-52,190-201` |
| app-shell 14px / 三列 / 28px / 毛玻璃 / 阴影 | ✅ 已有 | `packages/promax-ui-layout/src/client/index.tsx:55-71` |
| 左右栏底色与分隔线 | ✅ 已有 | `packages/promax-ui-layout/src/client/index.tsx:75-80` |
| 中列复合底色 | ✅ 已有 | `packages/promax-ui-brand/src/theme.ts:50`; `packages/promax-ui-layout/src/client/index.tsx:81-87` |
| brand/topbar/right-header 76px 基线 | ✅ 已有 | `packages/promax-ui-console/src/workbench-styles.ts:14,55,170` |
| 左/右栏收起与恢复 | ✅ 已有 | `packages/promax-ui-layout/src/client/index.tsx:73-80,204-220`; `PromaxWorkspaceShell.tsx:1473,1478,1488` |
| topbar kicker、标题、工具按钮组 | ✅ 已有 | `workbench-styles.ts:55-74`; `PromaxWorkspaceShell.tsx:1478` |
| 团队可用性药丸及 idle/active/warning/error | ✅ 已有 | `PromaxWorkspaceShell.tsx:641-652,1454-1456,1478`; `workbench-styles.ts:63-70`；浏览器实见「团队待命」 |
| 三个下划线 tab | ✅ 已有 | `workbench-styles.ts:75-79`; `PromaxWorkspaceShell.tsx:1479`；三屏均实点 |
| main-scroll 唯一滚动容器、960px 内容 | ✅ 已有 | `workbench-styles.ts:80,86`; `PromaxWorkspaceShell.tsx:1480` |
| composer-wrap 常驻底部且不遮挡 | ✅ 已有 | `workbench-styles.ts:152-166`; `PromaxWorkspaceShell.tsx:1486`；工作台/轨迹/交付物 overlap 0 |
| textarea 42–100px 与发送键 | ✅ 已有 | `workbench-styles.ts:162-166`; `PromaxWorkspaceShell.tsx:1252-1323` |
| 新建草稿 primary action | ✅ 已有 | `workbench-styles.ts:24-25`; `PromaxWorkspaceShell.tsx:322-388` |
| 侧栏分组标题、会话、团队、项目、计数、footer | ✅ 已有 | `workbench-styles.ts:26-48`; 浏览器四条导航不变量重跑通过 |
| topbar 面包屑逐级返回 | ✅ 已有 | `workbench-styles.ts:59-61`; `PromaxWorkspaceShell.tsx:1478`；团队/项目两级均实点 |
| workspace 标题与说明 | ✅ 已有 | `workbench-styles.ts:87-90`; `PromaxWorkspaceShell.tsx:1421` |
| task-card、百分比、进度、协调说明、运行键 | ✅ 已有 | `workbench-styles.ts:93-104`; `PromaxWorkspaceShell.tsx:1422` |
| section-bar | ✅ 已有 | `workbench-styles.ts:105-107`; `PromaxWorkspaceShell.tsx:1423,1425,1427` |
| 精简 timeline-item | ✅ 已有 | `PromaxWorkspaceShell.tsx:674-763,1404-1424`; `workbench-styles.ts:135-144`；CP3 实见 2 条 |
| agent-grid 三列、7 卡 | ✅ 已有 | `workbench-styles.ts:108-126`; `PromaxWorkspaceShell.tsx:1425-1426` |
| 成员 running/done/blocked/idle 独立状态 | ✅ 已有 | `PromaxWorkspaceShell.tsx:619-630,1426`; CP3 为 2 已完成、5 尚未开始 |
| deliverable-card / file-grid 三列、8 项 | ✅ 已有 | `workbench-styles.ts:127-134`; `PromaxWorkspaceShell.tsx:1427-1428` |
| 可选未产出 / 已生成待判定 / 已完成可验收 | ✅ 已有 | `PromaxWorkspaceShell.tsx:1329-1357`; CP3 为 1 ready、2 optional-missing |
| `N / M` 动态本次涉及 | ✅ 已有 | `PromaxWorkspaceShell.tsx:563-606,1336-1342`; 当前 `1 / 6`，单测覆盖 `6→7` |
| 交付物 big-file 两列、8 张 | ✅ 已有 | `workbench-styles.ts:145-150`; `PromaxWorkspaceShell.tsx:1432-1434`; 浏览器 8 卡 |
| 右栏 1+7 当前成员 | ✅ 已有 | `PromaxWorkspaceShell.tsx:1360-1377`; `workbench-styles.ts:173-188` |
| 右栏独立 presence 浏览器可见 | ✅ 已有 | 状态源 `PromaxWorkspaceShell.tsx:619-630,1371-1375`; 防挤出 `workbench-styles.ts:175-184`; 8 点均在 panel 内 |
| 右栏 8 产物进度树、生成/判定双状态 | ✅ 已有 | `PromaxWorkspaceShell.tsx:1378-1385`; `workbench-styles.ts:190-198` |
| team-note | ✅ 已有 | `PromaxWorkspaceShell.tsx:1387`; `workbench-styles.ts:199` |
| toast | ✅ 已有 | `PromaxWorkspaceShell.tsx:1464-1468,1482,1489`; `workbench-styles.ts:200-202`；实点显示「customer_research.md 仍在生成中」 |
| 响应式 1180/820/480 + reduce-motion | ✅ 已有 | `workbench-styles.ts:210-246`; 三档截图与计算样式均通过 |

本表没有 `⚠️ 只有假数据` 或 `⏳ 缺运行时来源`：四个原缺口都已改为已有会话/产物/Judge 轨迹的可证投影。成员点表示任务执行状态，不冒充独立网络心跳。

## 6. 工程门禁与安装

- `pnpm test`：16 文件、70/70。
- `pnpm typecheck`：通过。
- `pnpm build`：通过；console client `295.68 kB`，Vite 产物成功。
- `pnpm package:dist`：console `0.3.33`、brand `0.1.7`、layout `0.1.5`、bundle `0.1.4`、report `0.1.1`、team-harness `0.4.1-dist.1`。
- `shasum -a 256 -c SHA256SUMS`：6 个 tgz + 3 个脚本，共 9/9 OK。
- 安装前 `/tmp/promax-gui-before-0.3.33.json`、安装后 `/tmp/promax-gui-after-0.3.33.json`：diff 0 行。
- dump-config 明确只有白名单三项 disabled：`ui-layout`、`ui-sidebar`、`ui-brand-official`；Promax layout/console/brand/report 均在 profile 中。
- `git diff --check`：通过。未改 dsh `packages/`，未扩大 disable 白名单。

## 7. 不扩大结论

- 本轮不宣称人工决策流或 Judge 动态闭环完成；CP3 Judge pass 只是已有运行数据的 GUI 投影。
- 任务轨迹中的 dsh 对话结构仍在，是 A 方案代价，不是遗漏。
- `business-diagram.md` 与 `prototype.html` 的“未产出”不是“未就绪”，UI 已用可选未产出态单独显示。
- 成员状态按当前任务证据独立计算；没有证据时显示“尚未开始”，不猜测在线或可用。
