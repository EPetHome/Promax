# Promax

面向产品工作的智能体基座：**dsh 底座 + 常驻团队适配插件 + 产品专家团 + 评审插件**。

设计原则：**模型只做决策和生产；统计、保存、版本、机械检查交给程序。**

## 目录

```text
promax-project/          现役代码与运行环境
├─ deepseek-harness/     dsh 底座冻结源码快照（原样引入，不改源码）
├─ dsh-runtime/          运行时依赖
├─ experts/v2.1.5/       产品专家团：Lead + 6 名成员 + 技能（原样引入，不改内容）
├─ team/                 嵌入 dsh 的定制层
│  ├─ AGENTS.md          团队规则（经 dsh-home/AGENTS.md 全局注入）
│  ├─ members/           角色卡
│  ├─ skills/            业务技能（经 cordis.patch.yml 的 customSkillDirs 挂载）
│  ├─ tools/             程序工具：事实统计、正式保存与回执
│  └─ judge/             Judge 工具、领域规则与参考案例
├─ kit/                  跑批工具（建运行目录、跑单轮、装配 profile）与评分样本
└─ plugins/              promax-wb-host（常驻团队适配）、promax-egress-guard（出网防护）

docs/                    现役文档
├─ 重新出发/00-基线/      当前基线与入口、产品设计与验收目标、主线图、工作方式与复核规范
├─ 重新出发/01-指派任务/  任务书与规格
├─ 重新出发/02-验证记录/  验证与复核记录
├─ 重新出发/03-问题清单/  问题清单
└─ prompt/               执行与复核提示词
```

## 现在到哪一步

主线：`N1 场景跑通 🟡 → N2 三者适配 🟡（进行中）→ N3 可演示 ⚪ → N4 接入 ⚪`

- [当前基线与入口](docs/重新出发/00-基线/01-当前基线与入口.md)：给人看的 5 行 + 会话交接
- [主线图](docs/重新出发/00-基线/06-主线图.md)：节点状态与不追求项
- [产品设计与验收目标](docs/重新出发/00-基线/02-产品设计与验收目标.md)：产品定位、职责分工与完成条件

## 怎么把专家团挂到 dsh 上（不改 dsh 源码）

| 机制 | dsh 原生能力 | 本项目放了什么 |
|---|---|---|
| 成员形态 | `dsh-tool-subagent`：每个成员一个具名工具，可各配模型 | `cordis.patch.yml` 的 insert 列表，`maxDepth: 1`，前台调用 |
| 团队规则 | `agent-instructions` 读取 `$DSH_HOME/AGENTS.md` | 软链到 `team/AGENTS.md` |
| 技能 | `skill-filesystem` 的 `customSkillDirs` | 关闭默认根目录，只挂 `team/skills` |
| 角色 | `persona` 与 `agentOptions` | 角色卡文件，成员先读角色卡 |
| 程序工具 | 成员自带 bash | `team/tools`，用绝对路径调用 |

## 跑一次

```bash
export DSH_HOME="$PWD/promax-project/dsh-home"          # 运行时目录（不入库，需自建）
export OPENCODE_GO_API_KEY=...                          # 或写入 $DSH_HOME/.credentials.yaml

promax-project/kit/new-run.sh <运行名> <提示词文件> <材料文件>...   # 建干净运行目录
promax-project/kit/run.sh <运行目录> <提示词文件> [标签] [会话ID]   # 跑一轮
```

`dsh-home/`、`runs/` 与各 `node_modules/` 是本地运行时内容，不入库；首次使用需按 `kit/` 与 `team/README.md` 自行装配。

## 分支流程

`main` 是受保护主线，禁止直接推送、强制推送和删除；改动从 `main` 建分支，经 Pull Request 合并。详见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 协作约定

[AGENTS.md](AGENTS.md) 是 Agent 协作入口：读取路线、一轮一个主要行为目标、区分已验证与未验证、结束写明证据位置。
