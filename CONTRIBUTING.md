# 贡献流程

## 分支与 Pull Request

1. 从最新 `main` 创建分支，建议使用 `feat/`、`fix/`、`chore/` 或 `docs/` 前缀。
2. 只向工作分支提交和推送改动。
3. 在 GitHub 创建目标为 `main` 的 Pull Request。
4. 完成检查并解决讨论后，通过 Pull Request 合并。

`main` 禁止直接推送、强制推送和删除。仓库管理员也应遵循同一规则。

## 本地检查

根据改动范围，在对应模块运行检查：

```bash
cd promax-ui
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
```

```bash
cd promax-end
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test:server
pnpm test:report
```

Agent 配置改动应核对 `promax-agent/agents/INTEGRATION.md` 中的稳定 ID、产物路径和责任边界。
