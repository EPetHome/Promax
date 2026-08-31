# GUI 品牌位与团队工具条复验

> 时间：2026-08-29 13:08 EDT  
> 安装版本：`@promax/promax-ui-console@0.3.8`  
> 环境：`/Users/Admin/.dsh-promax`，隔离端口 3184；未调用模型

## 结论

- 左上品牌位恢复：浏览器可见一个名为 `New session` 的品牌快捷按钮，内容为 Promax 标志和 `Promax`。
- dsh 原生重复 New Session 仍保留在 DOM 中，但浏览器实测 `isVisible=false`；没有再误伤品牌快捷按钮。
- 团队会话顶部面包屑显示 `产品智能体团队 / 产品`，并固定在工具条左端；主智能体、文件、成员控制仍在右侧。
- 三列结构和右侧 r2 进度栏未改变。

## 根因与修复

1. `styles.ts` 原规则只按 `aria-label="New session"` 隐藏 dsh 原生按钮。dsh 的品牌按钮也用同一 label（品牌按钮兼作新会话快捷入口），因此 Promax 品牌一起被隐藏。
2. 改为同时限定 dsh CSS module 的 `_newSession` 类片段，只隐藏重复按钮。
3. 团队工具条原来 `justify-content: flex-end`，整组内容被推到右侧。去掉该规则，并给面包屑 `margin-inline-end: auto`，将层级导航固定到左端。

## 浏览器证据

- 可见品牌快捷按钮数量：1。
- dsh 重复 New Session DOM 数量：1；可见性：false。
- 面包屑文本：`产品智能体团队/产品`。
- 截图：`logo-and-toolbar-0.3.8.jpg`。

## 构建与发布

- `pnpm test`：15 个测试文件、58 项通过。
- `pnpm typecheck`：通过。
- `pnpm build`：brand、console、bundle 通过。
- `pnpm package:dist`：通过；生成 `release/promax-promax-ui-console-0.3.8.tgz`。
- `shasum -a 256 -c SHA256SUMS`：8 项全部通过。
- 安装前后 `dsh --profile web --dump-config`：533 行逐字一致，首个差异为 -1。
- 隔离 3184 已关闭；本轮未重启用户现有 3080 进程。
