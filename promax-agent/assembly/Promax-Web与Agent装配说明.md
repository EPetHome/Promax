# Promax Web 与 Agent 装配说明

更新时间：2026-08-26  
状态：已完成隔离装配、preset 挂载与两轮生成；当前服务已停止，最新独立复跑不通过，第二次候选修正待复跑

## 1. 结论

GUI 线的 Web 不需要复制或合并进 Agent 目录，也不应由 Agent 线修改。正确装配关系是：

1. dsh 的 `web` profile 先按顺序加载 `@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app`。
2. GUI 发布包把 `@promax/promax-bundle` 作为第三层 bundle 装入同一个 profile；该层负责 Promax 控制台、品牌、API 代理和 Product 工作区。
3. Agent 线已把 `general` 与 `product-solution` 放入同一 `DSH_HOME` 的 `.agent-presets/`；dsh 的 `agent-presets` 服务能够自动发现它们。
4. 最后只通过 profile patch 选择默认 preset，不改 GUI bundle，不改 dsh 源码，也不碰接口契约。

这符合 Harness 的分层：GUI 是宿主呈现层，preset/skill 是 Agent 上下文、工具、约束、验证和纠正层，两者在 dsh profile 运行时组合，而不是互相拷贝源码。 (ref: [[Harness工程]]) (ref: [[Agent核心公式]])

## 2. 本次使用的冻结基线

| 对象 | 冻结版本/位置 | 用法 |
|---|---|---|
| dsh | commit `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e` | 源码快照已直接收录在 `promax-agent/deepseek-harness/`，不依赖 submodule 或外部仓库跳转 |
| GUI | commit `140611448f24493dfebd7256259c8b7346a9bb37` 的发布包 | 已复制到 `.runtime/gui-release-1406114/`；工作树干净，发布包与提交前取得的副本逐文件相同 |
| 隔离 Harness home | `.runtime/dsh-home/` | 只用于本线装配与冒烟，不污染用户默认 `~/.dsh` |

原始 dsh、GUI、后端仓库均保持只读。

## 3. 证据链

### 3.1 dsh 的装配点

- `packages/boot/app-boot/README.zh.md:38`：profile 的 `package.json` 通过 `dsh.profile.bundles` 定义有序 bundle 层，之后再叠加 profile 的 `cordis.patch.yml`。
- `packages/bundle/web-app/cordis.patch.yml:432-445`：Web profile 插入 `agent-presets`，默认 preset 为 `standard`。
- `packages/preset/agent-presets/README.zh.md:90-100`：`includeUserRoot` 默认开启，自动追加 `$DSH_HOME/.agent-presets`。

### 3.2 GUI 的装配点

GUI commit `1406114` 沿用 `6ee1288` 已交付的 `packages/promax-bundle/cordis.patch.yml`，明确声明它是第三层，并完成：

- 禁用 dsh 官方侧栏和官方品牌；
- 插入 `promax-workspace-bootstrap`；
- 插入 `@promax/promax-ui-console`；
- 插入 `@promax/promax-ui-brand`；
- 在存在员工号及 AT/RT 时启用 `@promax/promax-report`。

该 bundle 不安装、不生成、也不拥有 Agent preset，所以 Agent 线无需进入 GUI 仓修改任何文件。

## 4. 已完成的隔离验证

1. GUI 发布包 4 个 tgz 按 `SHA256SUMS` 校验通过；本次装配期间 GUI 线把状态栏收口提交为 `1406114`，隔离副本与该提交后的 `release/` 中 8 个文件逐文件 `cmp` 相同，因此基线已更正为 `1406114`。
2. GUI 安装脚本在隔离的 `DSH_HOME` 中生成 `web` profile，其 bundle 顺序为：

   ```text
   @deepseek-ai/dsh-base
   @deepseek-ai/dsh-web-app
   @promax/promax-bundle
   ```

3. 初始 `--dump-config` 确认：官方侧栏/品牌被禁用，Promax workspace、console、brand、report 四个运行时条目已组合；在正式 preset 未安装前，`agent-presets` 保持 `default: standard`。
4. 实际启动 `127.0.0.1:3180` 后：首页返回 HTTP 200；HTML 模块清单包含 `@promax/promax-ui-console` 和 `@promax/promax-ui-brand`；`/promax-api/api/v1/me` 到达后端并返回符合未登录状态的 HTTP 401；`workspaces/product/` 已创建。
5. 冒烟结束后已停止测试进程；本线克隆及原始 dsh 的 `packages/` diff 均为 0。
6. 正式 preset 就位后，隔离 profile 已切换 `default: product-solution`；`agentPreset.list` 能看到 `general`、`product-solution`，产品会话 `skill.list` 仅返回三份本线 skill，正式目录与运行时副本 `diff -qr` 为 0。
7. `product-solution` 已完成迁移首轮和 Harness 纠正后的复跑一，三类文件均落到工作区固定目录；但两轮独立审计均不通过。复跑一之后写入的公式化候选修正尚未进行复跑二，因此当前装配成立不等于质量通过。

说明：页面静态 `<title>` 仍为 `DSH Local Build`，但 Promax 品牌插件已加载。该标题是否调整属于 GUI 展示线，不影响 Agent preset 装配，本线不修改。

## 5. Agent preset 当前安装与重装方式

隔离运行时当前已经按下列结构安装；正式真源仍是 `promax-agent/agents/`，`.runtime/` 只是可重建副本：

```text
$DSH_HOME/.agent-presets/
├── general/
│   └── agent.cordis.yml
└── product-solution/
    ├── agent.cordis.yml
    └── skills/
        ├── prd-document-generator/SKILL.md
        ├── business-diagram-generator/SKILL.md
        └── interactive-prototype-generator/SKILL.md
```

需要重建隔离运行时时，先把正式目录完整复制到 `$DSH_HOME/.agent-presets/`，确认 `diff -qr` 为 0，再在 `profiles/web/cordis.patch.yml` 应用本目录的示例 patch，把默认 preset 切为 `product-solution`。不得在目标 preset 不存在或 roster broken 时提前切换。

## 6. 不能由 Agent 线完成的部分

- Promax GUI 页面、主题、标题、交互和控制台实现；
- `@promax/promax-report` 的 hook、鉴权、上报和服务端逻辑；
- 接口契约变更；
- CP3 中控制台展示与服务端接收结果。

Agent 线负责让 preset/skill 生成的三类产物真实落盘，并提供可复现输入、独立验证和基线/迁移后对比；运行时 hook 再从工作区捕获文件。

## 7. 当前停止点

Web、dsh 与两个 preset 的非侵入式装配已经跑通，不存在需要修改 GUI、原始 dsh 或契约的冲突。负责人已确认反编造标签、硬信息保留、矛盾阻断、迁移源 commit 和模型入口五项口径。

当前真正停止点是质量验证：迁移首轮和复跑一均被独立审计否决；复跑一后写入 `after = before + delta`、`before < N` / `before >= N` 和逐点求值规则，但没有启动复跑二。服务已停止，3180/3191 无监听。接手者应保留旧产物，在新 workspace、新会话中用同一脱敏输入做复跑二；通过独立审计前不得宣称 `tested`、`integrated`、`accepted` 或 CP3 完成。
