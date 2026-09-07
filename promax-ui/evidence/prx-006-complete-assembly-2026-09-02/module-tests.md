# 模块测试与静态范围检查

执行日期：2026-09-02。所有测试数据均为公开或脱敏 fixture。

## Agent 命令

工作目录：`/Users/Admin/Desktop/Promax/promax-agent/team-harness`

| 命令 | 退出码 | 关键结果 |
| --- | ---: | --- |
| `npm test` | 0 | 41 tests，41 pass，0 fail |
| `node src/cli.mjs catalog` | 0 | 9 modules，28 skills，21 rubric rules，3 prompt recipes |
| `node src/cli.mjs validate --definition definitions/promax-product-team.yml` | 0 | `status=valid`，`team_id=promax-product-team`，7 个 worker 成员 |
| `compile --revision 1` 到 `mktemp -d` | 0 | `presetId=promax-team`，`revisionId=promax-product-team@r1` |
| 首次 `verify` | 0 | valid，137 个受校验文件 |
| `compile --revision 1 --allow-overwrite` | 0 | 覆盖前归档 137 个文件后完成原子替换 |
| 覆盖后 `verify` | 0 | valid，137 个受校验文件；28 个 `SKILL.md` |

失败路径覆盖见 `/Users/Admin/Desktop/Promax/promax-agent/team-harness/test/prx006-complete-team.test.mjs`、`test/compile-overwrite.test.mjs` 和 `test/harness.test.mjs`：归档失败拒绝覆盖、暂存/原子交换故障、web fetch 失败摘要、manifest SHA256 篡改、业务产物分别缺 SRC-002/SRC-003 回指、Judge 边界与 telemetry 限制均有断言。

## 第 1 轮返工复测

- `node --test test/prx006-complete-team.test.mjs`：最终退出码 0，5 tests / 5 pass；其中 R1 用例真实创建 `product_discovery.md`，完整引用两个联网 SRC 时进入 Judge，删除任一引用时在 `tools/pre-execute` 生产门禁失败并指出缺失 ID。
- `npm test`：最终退出码 0，41 tests / 41 pass / 0 fail；既有 manifest 元数据、SHA256 篡改、Judge 闭集和 telemetry 测试继续通过。
- 首次直接定向运行和首次全量运行曾因测试文件直接导入带 dsh peer 的运行时模块而分别退出 1；随后将同一个生产 gate 回调置于无 dsh peer 的 `harness.mjs` 并由 `external-capabilities.mjs` 注册，测试直接执行该生产回调且静态断言真实 hook 接线。该失败是测试装载边界，未放宽断言或复制/升级 dsh。
- Persona 机械检查：`find ... -maxdepth 1 -type f -name '*-persona.md' | wc -l` 输出 7；每份报告对三个固定小节的 `rg -c` 均输出 3。

## GUI 命令

工作目录：`/Users/Admin/Desktop/Promax/promax-ui`

| 命令 | 退出码 | 关键结果 |
| --- | ---: | --- |
| `pnpm typecheck` | 0 | TypeScript 无错误 |
| `pnpm test` | 0 | 20 files，104 tests，104 pass，0 fail |
| `pnpm build` | 0 | 4 个 workspace package 构建完成 |
| `pnpm package:dist` | 0 | 6 个 tgz、console-web、3 个 launcher/checksum 文件生成 |

补充检查：`release/install-promax.sh` 的 shell 语法和 4 个内嵌 Node here-doc 均可解析；team-harness 分发包中固定 `generated/promax-team/` 有 138 个 tar 条目，随机 rN preset 引用为 0。设置/MCP 失败路径见 `packages/promax-ui-console/tests/promax-settings.test.tsx` 和 `packages/promax-ui-console/tests/bundle-policy.test.ts`。

## 静态与范围检查

任务文件列出的两仓 `diff --check`、两仓基线 `diff --stat`、模块/历史目录/生成态计数与禁止文本命令最终退出码均为 0。关键计数：

- Agent 最终基线差异统计：1017 files changed，14419 insertions，139180 deletions；大部分删除为任务点名的历史 rN 生成态与旧版本资产。
- GUI 最终基线差异统计：24 files changed，2266 insertions，78 deletions。
- 顶层模块 9；`skills-v1`/`skills-v2` 0；历史模块 `v1`/`2` 0。
- `generated/` 顶层目录 1，名称 `promax-team`；其中 `SKILL.md` 28。
- 旧拆分角色、禁止联网和“不含预警”等任务点名文本命中 0。
