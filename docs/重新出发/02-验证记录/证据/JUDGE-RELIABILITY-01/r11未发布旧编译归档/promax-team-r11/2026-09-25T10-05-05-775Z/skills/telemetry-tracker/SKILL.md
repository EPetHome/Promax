---
name: telemetry-tracker
description: 使用数据埋点与统计技能。承担两个职责：(1) 自动埋点——通过「双轨机制」采集使用数据：message:received 钩子确定性记录每轮对话轮次（source=hook），各智能体仅在真触发能力时补充上报（source=llm），写入 SQLite 数据库；(2) 主动汇报——当用户询问"使用情况""调用统计""哪个用得多"等意图时，读取数据并生成中文文本汇报。
---

# 使用数据埋点与统计

## 核心定位

本技能是整个产品智能体系统的「数据底座」，承担两个互不干扰的职责：

1. **自动埋点（职责 A）**：采用**双轨采集机制**，覆盖两个维度，互不重复计数：
   - **对话轮次（hook 轨）**：配套的 `telemetry-auto-track` 钩子监听 `message:received`，对每轮用户消息确定性记录一条 `chat` 事件（`source=hook`），覆盖率约 **100%**。
   - **能力调用（LLM 轨）**：各智能体**仅在真正执行了能力**（产出 PRD、报告、评审等）时，才调用本技能上报一条 `agent`/`skill` 事件（`source=llm`），覆盖率约 **70-90%**（为下限）。
   - **两者记录不同维度**：hook 记"对话发生了"，LLM 记"能力被调用了"。`stats_usage.py` 按双口径分别统计，不相加为虚高总数。
2. **主动汇报（职责 B）**：当用户主动询问使用情况时，从数据库读取统计数据，组织成结构化中文文本汇报。

---

## 数据存储位置

- **数据库**：`~/.openclaw/workspace/shared/telemetry/usage.db`
- **兜底日志**：`~/.openclaw/workspace/shared/telemetry/failed_events.jsonl`（数据库写入失败时自动写入，不丢失）
- **选择理由**：`shared/` 是 README 定义的跨 Agent 公共协作区，是唯一能被主智能体和全部子智能体共同写入的位置，可绕开各子 Agent 的 workspace 隔离。

---

## 职责 A：自动埋点

### 触发方式（双轨机制）

本系统采用**双轨采集**，hook 与 LLM 各司其职、记录不同维度：

| 采集轨 | 触发方 | 记录内容 | source 值 | event_type | 覆盖率 |
|--------|--------|---------|-----------|-----------|--------|
| **hook 轨**（对话级） | `telemetry-auto-track` 钩子 | 每轮用户消息到达即记一条对话 | `hook` | `chat` | ~100% |
| **LLM 轨**（能力级） | 各智能体轮末上报 | 仅真触发能力时记一条 | `llm` | `agent`/`skill` | 70-90% |

**LLM 轨触发规则**：仅当本轮**实际执行了智能体能力或调用了技能**（有真实产出）时，才在轮末调用本技能上报。**纯对话、澄清提问、拒绝执行、未产出结果的情况不上报**（这些对话轮次已由 hook 兜底记录为 chat）。这样从根上避免同一次对话被重复计数。

### hook 与 LLM 的职责边界

- hook 只感知"用户消息到达"，**不感知**本轮是否调度了 agent 或调用了 skill。所以 hook 永远只记 `chat`。
- LLM 只感知"我执行了能力"，在能力产出后补记 `agent`/`skill`。
- 一次完整对话：hook 记 1 条 chat（对话轮次 +1），LLM 记 0 或 1 条 agent/skill（能力调用 +0 或 +1）。二者维度不同，不会重复计数。

### 上报命令

**LLM 轨上报**（智能体执行能力后调用，source=llm）：

```bash
python3 ~/.openclaw/workspace/skills/telemetry-tracker/scripts/track_usage.py \
  --event-type agent \
  --target-name product_discovery \
  --target-label "产品探索智能体" \
  --source llm \
  --user-query "用户原始输入文本" \
  --session-key "agent:main:wecom:direct:wo_xxx" \
  --user-id wo_xxx \
  --user-name "张三"
```

> hook 轨由 `handler.ts` 自动调用同一脚本并传 `--source hook --event-type chat --target-name -`，无需人工或 LLM 介入。

| 参数 | 必填 | 说明 |
|------|------|------|
| `--event-type` | 是 | `agent`（智能体）/ `skill`（技能）/ `chat`（普通对话） |
| `--target-name` | 是 | 智能体或技能的 ID；普通对话填 `-` |
| `--target-label` | 否 | 中文名，便于汇报展示 |
| `--source` | 否 | 数据来源：`llm`（智能体上报，默认）/ `hook`（消息到达钩子）。用于双口径统计 |
| `--user-query` | 否 | 用户原始输入（自动截断到 500 字） |
| `--session-key` | 否 | 完整会话标识（渠道无关），由调用方通过 session_status 获取；脚本会从中解析渠道用户 ID |
| `--user-id` | 否 | 渠道用户标识（ou_xxx / wo_xxx）；为空时脚本从 --session-key 解析 |
| `--user-name` | 否 | 用户真实姓名（获取链路见下） |
| `--invoke-count` | 否 | 本次触发子调用次数，默认 1 |
| `--output-files` | 否 | 产出文件链接，多个用逗号分隔 |
| `--status` | 否 | `success`（默认）/ `failed` |

### 执行原则（铁律）

1. **仅能力调用上报（LLM 轨）**：智能体**仅在真触发能力**时上报（source=llm）。纯对话不上报，由 hook 兜底。对话轮次不再靠 LLM 每轮自觉记录。
2. **身份归一化（治本）**：写入时由 `track_usage.py` 的 `normalize_identity` 自动归一化——能从 session_key 解析出真实渠道 ID（ou_/wo_ 等）则用真实 ID，避免同一用户在库中产生 `ou_xxx` 与 `anon-xxx` 两套碎片。
3. **尽力获取身份，匿名也要埋点**：身份缺失时仍正常埋点（脚本生成稳定匿名 ID），保证统计不丢。
4. **静默**：不向用户展示任何提示、不等待确认、不报错。
5. **不阻断主流程**：上报失败不影响任务交付（失败自动写兜底日志，不丢失）。
6. **姓名兜底链路**（见下节），由调用方 LLM 负责记忆查询与询问，脚本负责最后一层兜底。

---

## 用户身份与姓名获取链路（session_status 识别 + Relationships.md 记忆）

获取用户身份与真实姓名时，按以下顺序依次处理。**身份识别是尽力获取的加分项，缺失时正常埋点（记为匿名）**；拿到身份后，姓名优先查 Relationships.md 记忆。任何一层成功获取姓名后，都必须**回写到 Relationships.md**，供下次直接命中。

```
第 0 层（身份识别 · 会话启动尽力执行 · 由调用方 LLM 完成）：
  调用方调用 session_status(sessionKey="current") 获取当前会话信息。
  从返回结果解析 sessionKey（如 agent:main:wecom:direct:wo_xxx），
  并提取渠道用户 ID（sessionKey 最后一段，渠道无关）。
  -> 整轮对话保留 sessionKey 与 user_id，埋点上报时传递。
  ⚠️ 拿不到身份也正常埋点（记为匿名），不阻断后续链路。
      ↓ 拿到 user_id（或走匿名）
第 1 层（本地记忆 · Relationships.md）：
  加载 ~/.openclaw/workspace/shared/telemetry/Relationships.md，
  用上述 user_id 查询。
  命中 -> 直接使用该姓名，无需再查。
      ↓ 未命中 / 文件不存在
第 2 层（对话层 · LLM 执行）：
  调用 wecom-cli contact get_userlist，用当前 user_id 反查真实姓名。
  查到 -> 填入 --user-name 参数，并回写 Relationships.md。
  （注意：该接口仅返回可见范围 ≤10 人的成员，可能查不到）

  查不到 / 接口报错 / 不在可见范围
      ↓
第 3 层（对话层 · LLM 主动询问用户）：
  LLM 在对话中主动询问：「请问您的姓名是？」
  用户回复 -> 填入 --user-name，并回写 Relationships.md。
  用户不回复 / 拒绝 -> 进入第 4 层。

      ↓
第 4 层（脚本层 · track_usage.py 兜底）：
  --user-name 为空时，脚本用 --user-id（或从 --session-key 解析）兜底。
  user_id 也为空时，填字符串 "unknown"。
  （此层完全静默，不询问、不报错、不回写记忆）
```

### sessionKey 身份解析（渠道无关）

OpenClaw 的 sessionKey 格式统一为 `agent:<agentId>:<渠道>:<chatType>:<用户标识>`：

| 渠道 | sessionKey 示例 | 解析出的 user_id |
|---|---|---|
| 企业微信 | `agent:main:wecom:direct:wo1rsbeqaaua2k6c03rsqzhwk7uhejqg` | `wo1rsbeqaaua2k6c03rsqzhwk7uhejqg` |
| 飞书 | `agent:main:feishu:direct:ou_00beb6896485dbac9c92249d87a04534` | `ou_00beb6896485dbac9c92249d87a04534` |

脚本内置 `parse_identity()` 函数自动完成解析：取 sessionKey 以 `:` 分割后的最后一段作为 user_id。

### Relationships.md 记忆文件

这是跨 Agent 共享的用户身份长期记忆，让每个用户只需被询问一次姓名。

- **文件路径**：`~/.openclaw/workspace/shared/telemetry/Relationships.md`
- **格式**：JSON，键为渠道用户 ID，值为姓名。示例：`{"wo1rsbeqaaua2k6c03rsqzhwk7uhejqg":"陛下","ou_00beb...04534":"张三"}`
- **加载时机**：调用方智能体在**会话开始时**（第 1 层）加载，用 user_id 查询。
- **回写时机**：第 2、3 层成功获取姓名后，把 `{user_id: 姓名}` 追加到 JSON 并保存。
- **回写约束**：**禁止覆盖已有其他用户的记录**，只新增或更新当前用户的映射。
- **首次运行**：文件不存在视为空记忆 `{}`，正常进入第 2 层。

**为什么询问由 LLM 而非脚本执行**：身份识别（session_status）和 Relationships.md 读写都由调用方 LLM 在对话层完成；`wecom-cli contact` 受可见范围限制只作补充；「询问用户」是对话动作只能由 LLM 完成；脚本只做最后兜底。

---

## 职责 B：主动汇报

### 触发方式

**语义识别触发**（由主智能体 `main` 判断）。当用户输入语义匹配以下任一意图时，`main` 调用本技能的汇报能力：

- 「使用情况怎么样 / 调用统计 / 埋点数据 / 使用报表」
- 「哪个智能体/Skill 用得多 / 最受欢迎的功能」
- 「最近大家都在用什么 / 活跃度如何」
- 「telemetry / 统计 / 用量 / 上报」

### 查询命令

```bash
# 总览（推荐默认）
python3 ~/.openclaw/workspace/skills/telemetry-tracker/scripts/stats_usage.py --summary

# 近 7 天总览
python3 ~/.openclaw/workspace/skills/telemetry-tracker/scripts/stats_usage.py --summary --days 7

# 按智能体维度
python3 ~/.openclaw/workspace/skills/telemetry-tracker/scripts/stats_usage.py --by-agent

# 按技能维度
python3 ~/.openclaw/workspace/skills/telemetry-tracker/scripts/stats_usage.py --by-skill

# 每日明细（近 14 天）
python3 ~/.openclaw/workspace/skills/telemetry-tracker/scripts/stats_usage.py --daily --days 14

# 自定义日期区间
python3 ~/.openclaw/workspace/skills/telemetry-tracker/scripts/stats_usage.py --summary --since 2026-06-01 --until 2026-06-24
```

### 汇报输出形式

- **默认**：在对话内输出结构化中文文本汇报，不生成文件。
- **例外**：仅当用户明确要求「生成报告文件」「导出数据」时，才调用 `--export` 导出 JSONL 或生成 Markdown。

汇报话术模板见 `{baseDir}/references/reporting_template.md`。

---

## 异常处理

| 场景 | 处理 |
|------|------|
| 数据库写入失败 | 自动追加到 `failed_events.jsonl`，不报错、不阻断 |
| 数据库不存在（无数据） | `stats_usage.py` 打印友好提示，不崩溃 |
| 通讯录查询失败/超限 | 跳过第 1 层，进入询问或兜底 |
| 用户拒绝提供姓名 | 使用 user_id 或 unknown，不强制 |

---

## 重要提醒

1. **上报率说明（双口径）**：
   - **对话轮次**（source=hook）：由 message:received 钩子确定性采集，覆盖率 **~100%**，可视为准确值。
   - **能力调用**（source=llm）：依赖智能体自觉上报，覆盖率 **70-90%**，统计数值应视为「下限」而非精确值。
   - 汇报时需**分口径呈现**，不得简单相加为虚高总数。
2. **隐私**：`user_query` 字段会保存用户原始输入（截断 500 字），如含敏感信息需注意。数据库为本地文件，不会上传外部服务。hook 同样不存储内容全文，截断逻辑沿用脚本上限。
3. **并发**：SQLite 已开启 WAL 模式 + busy_timeout=5s，正常多 Agent 并发够用。
4. **不入库**：`usage.db`、`failed_events.jsonl`、`Relationships.md`、合并备份 `*.backup-*` 是运行时产物，不应提交到 Git（已被 `.gitignore` 忽略）。

## 配套 hook：telemetry-auto-track

本技能配套一个内部 hook，承担「对话级确定性采集」职责，弥补纯 LLM 上报的覆盖率不足。

- **源文件位置**（随仓库分发）：`{baseDir}/hooks/telemetry-auto-track/`，含 `HOOK.md`（元数据）与 `handler.ts`（处理逻辑）。
- **运行位置**：复制到 `~/.openclaw/hooks/telemetry-auto-track/`（托管目录，本机生效）。
- **监听事件**：`message:received`。
- **职责**：用户消息到达时，提取原文与渠道身份，调用 `track_usage.py` 写入一条 `source=hook` 的 chat 事件，确定性记录对话轮次。
- **与 LLM 上报的关系**：hook 只记对话维度（chat），LLM 只记能力维度（agent/skill），二者不重复。详见上方「职责 A：触发方式（双轨机制）」。

**安装步骤**：

```bash
# 1. 复制 hook 源文件到托管目录
mkdir -p ~/.openclaw/hooks/telemetry-auto-track
cp {baseDir}/hooks/telemetry-auto-track/{HOOK.md,handler.ts} \
   ~/.openclaw/hooks/telemetry-auto-track/

# 2. 启用 hook（Gateway 默认不发现内部 hook，必须显式启用）
openclaw hooks enable telemetry-auto-track

# 3. 检查启用状态
openclaw hooks check

# 4. 重启 Gateway 让 hook 加载
```

> 环境变量 `TELEMETRY_TRACK_SCRIPT` 可覆盖 `track_usage.py` 的默认路径，按实际部署调整。

---

## 身份合并工具：merge_users.py

历史库中可能存在同一真实用户的多条碎片记录（`ou_xxx` + `anon-<sessionKey哈希>` + `anon-<uuid>` + `unknown`），导致按 user_id 统计时同一人被拆成多行。`merge_users.py` 用于**一次性治理历史碎片**（写入层归一化已从源头减少新碎片）。

### 判定规则（与 track_usage.py 的 normalize_identity 一致）

1. 真实渠道用户标识（前缀 `ou_/wo_/wm_/on_/u_`）= 权威身份
2. `anon-` 系列若其 session_key 能解析出真实渠道标识 → 归并到该真实 ID
3. 解析不出真实身份的 `anon-` → 保留不强行合并（避免误并不同匿名用户）
4. `unknown` → 不与任何合并

### 使用方式

```bash
# 1. 预览将要合并的映射（不修改数据库，强烈建议先跑）
python3 {baseDir}/scripts/merge_users.py --dry-run

# 2. 确认无误后执行实际合并（执行前自动备份数据库）
python3 {baseDir}/scripts/merge_users.py --apply

# 3. 指定数据库路径（默认 ~/.openclaw/workspace/shared/telemetry/usage.db）
python3 {baseDir}/scripts/merge_users.py --apply --db-path /path/to/usage.db
```

### 安全保证

- 默认 `--dry-run`，仅打印映射，不改库
- 必须 `--apply` 才执行，执行前自动备份到 `<db>.backup-YYYYMMDDHHMMSS`
- 全程单事务，任何异常自动回滚
- 幂等：重复执行对已合并库不产生新变化
- 若需回滚，用备份文件覆盖 `usage.db` 即可

> 此脚本由运维/管理员**单独手动执行**，不纳入自动流程。建议在重大版本升级或定期清理时运行一次。

---

## 依赖资源

- `{baseDir}/scripts/track_usage.py` — 上报脚本（含自动建表、身份归一化 normalize_identity）
- `{baseDir}/scripts/stats_usage.py` — 统计脚本（双口径 summary/by-agent/by-skill/daily/export）
- `{baseDir}/scripts/merge_users.py` — 历史用户身份碎片合并脚本（dry-run/apply/备份）
- `{baseDir}/references/reporting_template.md` — 汇报话术模板
- `{baseDir}/hooks/telemetry-auto-track/` — 配套 message:received 钩子（HOOK.md + handler.ts）
