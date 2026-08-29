# Promax

Promax 单仓库，包含 UI、Agent 配置与后端三个独立模块。

## 目录

- `promax-ui/`：Promax Web 控制台、品牌与运行时 bundle。
- `promax-agent/`：Agent preset、skills、对接契约与装配说明。
- `promax-end/`：服务端、上报插件与接口契约。

各 Node.js 模块使用 pnpm 管理依赖，具体命令以模块内的 `package.json` 为准。

DeepSeek Harness 的冻结源码快照已直接收录在 `promax-agent/deepseek-harness/`，首次克隆后无需初始化 submodule。

## 分支流程

`main` 是受保护主线。所有改动从 `main` 创建独立分支，通过 Pull Request 合并；不要直接向 `main` 推送。详细约定见 [CONTRIBUTING.md](CONTRIBUTING.md)。
