# GUI 改造 v3 · 第 1 步主题验证

> 日期：2026-08-30 EDT  
> 范围：`00_GUI改造计划_20260830.md` §6 第 1 步；未进入第 2 步，未 disable 任何 dsh 插件

## 实现证据

- `packages/promax-ui-brand/src/theme.ts:15-84`：视觉基准 primitive token、复合背景 token，以及现有 dsh/Promax 语义 token。
- `packages/promax-ui-brand/src/theme.ts:87-123`：body 三个径向晕染、12px 点阵与 `.main-column::before` 440px 圆环规则。
- `packages/promax-ui-brand/src/client/index.tsx:56-57`：品牌插件加载时安装全局主题表。
- 功能组件未新增颜色字面量；色值仍只存在于品牌 token 包。

## 静态验证

- `pnpm test -- packages/promax-ui-brand/tests/client.test.tsx packages/promax-ui-console/tests/style-policy.test.ts`
  - 实际由当前 Vitest 配置执行全量测试：15 个测试文件、59 项通过。
- `pnpm typecheck`：通过。
- `pnpm --filter @promax/promax-ui-brand build`：通过，node/client 两个产物均构建成功。
- `git diff --check`：通过。

## 浏览器验证

- 用户 3080 端口未监听；没有覆盖或重启用户进程。
- 将 `/Users/Admin/.dsh-promax` 复制到隔离目录 `/tmp/promax-theme-step1.6ngUYN`，只替换刚构建的品牌包，在 3184 启动 dsh；未调用模型，未使用真实公司文档。
- 浏览器实际打开 `http://127.0.0.1:3184/`；页面可见 Promax 左栏、现役 dsh 对话区和右侧 r2 状态栏。
- 计算样式实测：
  - `body` 底色为 `rgb(243, 244, 247)`；
  - 三个径向晕染分别位于 `7% 12%`、`94% 6%`、`70% 96%`；
  - `body::before` 点阵为 `12px 12px`、`opacity: 0.18`，mask 在 68% 渐隐；
  - 页面已加载 `style#promax-global-theme`。
- 截图：`theme-3184.png`；SHA-256：`9835df47b19b11f5e6e973c1956772731ab4bab95f85b0ec219f45ad215151fa`。

## 尚未满足的可见项

- 当前 root 仍由 `ui-layout` 渲染，DOM 中没有 `.main-column`，所以第三层 440px 圆环规则已经写入但浏览器里尚无挂载对象。
- 截图中的中列仍显示现役方格底纹和 dsh 外壳；这不是第 1 步已消除的内容。要让 Promax 三层底纹和外壳完整可见，必须进入 §6 第 2 步，用 `promax-ui-layout` 接管 root。
- 因此当前结论仅为：token、body 晕染和点阵层已验证；第 1 步的“三层底纹到位”尚未形成完整浏览器可见闭环，不能汇报整步完成。
