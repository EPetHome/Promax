# Hero 鲸鱼图标移除复验

- 版本：`@promax/promax-ui-console@0.3.35`
- 运行时：3080 PID `88874`，HTTP 200；`@promax/promax-report@0.1.1`
- 操作一：刷新 3080 后点击左栏「新建草稿」，进入空白草稿屏。
- 操作二：点击「产品」项目组，再点击「任务轨迹」，复验用户截图对应的项目轨迹屏。
- 浏览器结构结果：`fishHitboxCount = 1`（dsh DOM 保留），但 `display = none`、矩形 `0 × 0`，其中鲸鱼 SVG `visible = false`。
- 浏览器布局结果：标题网格由三列收为两列；标题在第 1 列，Preview 在第 2 列，不留鲸鱼占位。项目轨迹屏计算值为 `201.977px 63.5781px`，对应两列的实际解析宽度。
- 代码：`packages/promax-ui-console/src/styles.ts` 的 Promax `.app-shell` 作用域规则。
- 验证：首版规则的全量测试 70/70、typecheck、build 通过；浏览器发现空草稿没有 `.promax-shell-layer` 后，最终 0.3.35 改用 `.app-shell` 作用域，并重新通过 style-policy 6/6、console build、`git diff --check`。最终发行 9/9 SHA256 通过；安装前后 dump-config SHA256 均为 `e8856b9d95783f9b97d3c3c1858fdedb3dd25f8f70b57de6081cdad5dc0526a3`。
- 截图：`hero-mark-removed-0.3.35.png`；用户截图对应路径的复验截图为 `project-trajectory-no-whale-0.3.35.png`。

说明：浏览器复验时 dsh 的 hero DOM 仍存在；本次是 Promax 组装层的可见性与布局接管，不宣称修改或删除 dsh 源码节点。
