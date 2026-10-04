---
name: telemetry-auto-track
description: "用户消息到达时自动埋点。监听 message:received 事件，提取用户原文与渠道身份，调用 telemetry-tracker 的 track_usage.py 写入 SQLite，实现对每轮对话的确定性采集（覆盖 ~100%）。"
metadata:
  openclaw:
    emoji: "📊"
    events: ["message:received"]
    requires:
      bins: ["python3"]
---

# telemetry-auto-track

本 hook 是 telemetry-tracker 技能的**对话级确定性采集层**，弥补原「LLM 硬触发上报」70-90% 覆盖率的不足。

## 职责边界

本 hook 与智能体上报形成**双轨互补**，二者记录不同维度，**不重复计数**：

| 来源 | 记录维度 | source 值 | 覆盖率 |
|------|---------|-----------|--------|
| 本 hook（`message:received`） | 每轮对话轮次（chat） | `hook` | ~100%（消息到达即触发） |
| 智能体轮末上报 | 能力调用（agent / skill） | `llm` | 70-90%（智能体自觉上报） |

- hook 只记录 `event_type=chat`，**不感知**本轮是否调度了 agent 或调用了 skill。
- 智能体仅在**真正执行了能力**时才上报 agent/skill，纯对话/澄清不再上报。
- 因此同一次对话：hook 记 1 条 chat（对话轮次 +1），智能体记 0 或 1 条 agent/skill（能力调用 +1）。
- `stats_usage.py` 按双口径分别统计，不相加为虚高总数。

## 事件过滤与身份提取

- 只处理 `message:received`，其余事件立即返回。
- 跳过空消息、`/` 开头的斜杠命令（避免与 command 事件重复）。
- 提取：`context.content`（用户原文）、`context.metadata.senderId`、`context.metadata.senderName`、`event.sessionKey`。
- 身份写入时由 `track_usage.py` 的 `normalize_identity` 归一化：能从 sessionKey 解析出真实渠道 ID（ou_/wo_ 等）则用真实 ID，避免 ou_xxx 与 anon-xxx 两套碎片。

## 运行时行为

- 即发即忘（`processInBackground` 风格），try/catch 包裹，**绝不抛错、绝不阻断对话**。
- 写入失败由 `track_usage.py` 自动兜底到 `failed_events.jsonl`，不丢失。
- 静默执行，不向用户展示任何提示。

## 配置

| 环境变量 | 默认值 | 说明 |
|---------|--------|------|
| `TELEMETRY_TRACK_SCRIPT` | `~/.openclaw/workspace/skills/telemetry-tracker/scripts/track_usage.py` | track_usage.py 脚本路径，可按实际部署覆盖 |

## 安装步骤

```bash
# 1. 复制 hook 源文件到托管目录
mkdir -p ~/.openclaw/hooks/telemetry-auto-track
cp skills/telemetry-tracker/hooks/telemetry-auto-track/{HOOK.md,handler.ts} \
   ~/.openclaw/hooks/telemetry-auto-track/

# 2. 启用 hook（Gateway 默认不发现内部 hook，必须显式启用）
openclaw hooks enable telemetry-auto-track

# 3. 检查启用状态
openclaw hooks check

# 4. 重启 Gateway 让 hook 加载
```

详见 `skills/telemetry-tracker/SKILL.md` 的「配套 hook」章节。
