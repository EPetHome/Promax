# GUI composer controls 浏览器验收

> 时间：2026-08-30 EDT  
> 运行面：隔离 dsh Web scaffold，最终复验随机端口 `61704`；共享 `3080` 未由本次启动、重启或访问。  
> 结论：单一 `@`、鼠标悬停与键盘聚焦提示、文件选择器 MIME 过滤和四条导航不变量均已通过，本项完成。

## 1. scaffold 卡点与修复

首次复现时，Vitest 已能通过 alias 和临时 `@deepseek-ai` workspace symlink 解析 dsh 包，但 r6 preset 在临时 `profiles/scaffold/` 中挂载 loader 时找不到 `@promax/team-harness`：

```text
agent-preset-invalid: preset "promax-team-mtcjsbcz-04tpe2-r6" failed to mount
Cannot find package '@promax/team-harness' imported from .../profiles/scaffold/
```

原因是隔离 harness home 只链接了三个 Promax UI 包，漏了 preset loader 的运行时依赖 `@promax/team-harness`。修复如下：

- 在临时 `profiles/node_modules/@promax` 同时链接 `promax-ui-layout`、`promax-ui-console`、`promax-ui-brand`、`team-harness`。
- dsh workspace 包继续由 `linkDshWorkspacePackages()` 链接到临时 `profiles/node_modules/@deepseek-ai`。
- 空 JSONL 只用于提供 provider route，改用 `replayProvidersOnly: true`，避免把“没有模型调用”误判成 fixture 未消费。
- 延长隔离页面存活门，避免人工浏览器取证期间 180 秒提前回收。

最终复验命令结果：`pnpm exec vitest run --config evidence/gui-composer-controls-20260830/vitest.config.ts`，`1 passed`，总时长 `534.28s`。

对应实现：`fixture.e2e.ts:43-92,105-107`，Vitest 配置：`vitest.config.ts:11-16`。

## 2. 四条 composer 实屏结论

| # | 在哪一屏 | 看到了什么 | 证据 | 状态 |
|---|---|---|---|---|
| 1 | r6 `product` 团队会话 / 工作台 | composer 中可见 `@` 按钮只有 1 个，浏览器读数为 `atCount=1`、`aria-label=指定团队成员` | `01-team-session-composer.png` | ✅ |
| 2 | 同屏附件按钮 / 鼠标悬停 | 用户在桌面 Web 窗口真实悬停附件按钮后，实屏完整显示「支持 PNG、JPG、WebP、GIF 图片」；归档图为原始 PNG 裁切，不使用此前错误的移动端截图 | `02-attachment-hover-tooltip.png` | ✅ |
| 3 | 同屏附件按钮 / 键盘聚焦 | 对附件按钮发送键盘按键后，活动元素为「添加图片（支持 PNG、JPG、WebP、GIF 图片）」；`focus-within=true`、tooltip `opacity=1`，实屏可见完整提示 | `04-attachment-keyboard-focus.png` | ✅ |
| 4 | 同屏附件按钮 / 文件选择器 | 实点按钮触发 `filechooser` 事件；`accept=image/png,image/jpeg,image/webp,image/gif`，`multiple=true`，与四种 MIME 一致 | `03-attachment-filechooser-focus.png` | ✅ |

补充：源码把 hover 与 focus 写在同一条显示规则中（`workbench-styles.ts:161`）；本轮已分别保留真实鼠标悬停图与键盘聚焦图，不再以源码或 focus 图替代 hover 证据。

## 3. 四条导航不变量（本次重跑）

| 不变量 | 实点结果 | 证据 | 状态 |
|---|---|---|---|
| 任意屏左栏同时可见「新建草稿 / 产品智能体团队」 | 草稿、团队首页、项目组首页、团队会话四屏均同时可见 | `05-navigation-draft.png`、`06-navigation-team-home.png`、`09-breadcrumb-project-home.png`、`01-team-session-composer.png` | ✅ |
| 切换时左栏几何不漂移 | 四屏浏览器读数均为 `left=15,width=250` | 同上 | ✅ |
| 团队页一次点击回草稿 | 首次提示完成后，从团队首页点击已有「新草稿」一次，顶栏立即变为「草稿」，当前草稿行被选中 | `07-team-home-one-click-draft.png` | ✅ |
| 两级面包屑均可返回 | 会话中实点「产品智能体团队」返回“选择项目组”；重新进会话后实点「product」返回项目组首页 | `08-breadcrumb-team-home.png`、`09-breadcrumb-project-home.png` | ✅ |

## 4. 表二两行状态

| 行 | 最终状态 | 原因 |
|---|---|---|
| 附件支持格式提示 | ✅ 已有 | 桌面 Web 鼠标悬停与键盘聚焦均显示完整提示；filechooser 事件与四种 MIME 过滤通过 |
| 单一成员 `@` 入口 | ✅ 已有 | r6 真实团队会话实屏与浏览器可见元素计数均为 1 |

因此表二两行均已具备浏览器可见性证据，本项完成。
