# 固定 preset、归档与安装态

## 源码与分发态

- 团队定义：`/Users/Admin/Desktop/Promax/promax-agent/team-harness/definitions/promax-product-team.yml`。
- 固定生成目录：`/Users/Admin/Desktop/Promax/promax-agent/team-harness/generated/promax-team`。
- `team_id=promax-product-team`，`revisionId=promax-product-team@r1`，用户侧 `presetId=promax-team`。
- 源码 `generated/` 只有 `promax-team`；28 个 Skill；`verify` valid，137 个受校验文件。
- GUI 的 `PRODUCT_PRESET_ID` 固定为 `promax-team`；分发包不携带或引用随机 rN preset。

## 首次全量归档与安装顺序

安装前只读计数：`/Users/Admin/.dsh-promax/.agent-presets/` 有 12 个顶层 preset、1646 个目录/文件条目，非空。

一次性安装命令退出码 0。脚本实际顺序为：

1. 先校验 profile 内新 `generated/promax-team`，valid、137 个受校验文件。
2. 全量复制旧 preset 根目录到 `/Users/Admin/Desktop/Promax/.archive/pre-promax-team-20260902-033636`。
3. 对源与归档做递归类型/大小/SHA256 inventory；确认归档非空、数量和总摘要一致，记录 1646 个条目。
4. 在独立 stage 装配三个 preset，再次校验 staged `promax-team` valid。
5. 前四项成功后才替换三个允许目录并清理其他历史 preset。
6. 最终再次校验安装态 `promax-team` valid。

安装后机械复点：顶层恰好 `general`、`promax-team`、`promax-team-configurator` 三个目录；`promax-team` 有 28 个 `SKILL.md`；归档顶层保留原 12 个 preset、总条目仍为 1646。

最终代码重新打包后按“后续覆盖”规则执行一次刷新：先把旧固定 preset 完整归档到 `/Users/Admin/Desktop/Promax/.archive/promax-team-20260902-035735`，递归 inventory 为 225 个目录/文件条目；随后 staged 与最终安装态 `verify` 均为 valid、137 个受校验文件。此刷新没有再次启动完整环境。

旧 rN 会话清理后不能按原 preset 直接打开；需要时只能从上述完整归档临时恢复。负责人对该影响的理解与接受仍待人工确认。
