// telemetry-auto-track - message:received 钩子
//
// 职责：监听用户消息到达，对每轮对话做确定性埋点（event_type=chat, source=hook）。
// 与智能体轮末上报（source=llm, agent/skill）形成双轨互补，二者记录不同维度，不重复计数。
//
// 设计原则：
//   1. 即发即忘（processInBackground 风格），绝不阻断对话主流程
//   2. try/catch 全包，任何异常都静默吞掉，不向上抛
//   3. 不向用户展示任何提示（埋点应对用户透明）
//   4. 写入失败由 track_usage.py 自动兜底到 failed_events.jsonl，不丢失

import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

const execFileAsync = promisify(execFile);

// track_usage.py 默认路径（OpenClaw workspace skills 目录）。
// 支持环境变量 TELEMETRY_TRACK_SCRIPT 覆盖，便于按实际部署调整。
const DEFAULT_TRACK_SCRIPT = join(
  homedir(),
  ".openclaw/workspace/skills/telemetry-tracker/scripts/track_usage.py"
);

// 调用脚本的超时上限（毫秒）。hook 应快速返回，避免拖慢消息处理。
const EXEC_TIMEOUT_MS = 5000;

/**
 * 处理 message:received 事件，对用户消息做对话级埋点。
 *
 * @param event OpenClaw 事件对象，包含 type/action/context/sessionKey 等
 */
const handler = async (event: any) => {
  // 1. 尽早过滤：只处理 message:received，其余事件立即返回，减少开销
  if (event.type !== "message" || event.action !== "received") {
    return;
  }

  const ctx = event.context || {};
  const metadata = ctx.metadata || {};

  // 2. 提取用户原文与身份信息
  //    context.content 优先用类命令消息的非空正文，回退原始入站正文
  const content: string = ctx.content || "";
  //    渠道身份（飞书 ou_ / 企业微信 wo_ 等）
  const senderId: string = metadata.senderId || "";
  const senderName: string = metadata.senderName || "";
  const sessionKey: string = event.sessionKey || "";
  const channelId: string = ctx.channelId || "";

  // 3. 跳过无需埋点的消息
  //    - 空消息或纯空白
  //    - 斜杠命令（避免与 command 事件重复记录）
  const trimmed = content.trim();
  if (!trimmed || trimmed.startsWith("/")) {
    return;
  }

  // 4. 即发即忘调用 track_usage.py 写入数据库
  //    用 void 包裹的 Promise 主动 detach，handler 立即返回，不阻塞消息处理
  void processInBackground({
    content,
    senderId,
    senderName,
    sessionKey,
    channelId,
  });
};

/**
 * 后台执行埋点写入。所有异常静默吞掉，绝不抛出、绝不阻断对话。
 */
async function processInBackground(input: {
  content: string;
  senderId: string;
  senderName: string;
  sessionKey: string;
  channelId: string;
}): Promise<void> {
  try {
    const script = process.env.TELEMETRY_TRACK_SCRIPT || DEFAULT_TRACK_SCRIPT;

    const args = [
      script,
      "--event-type", "chat",
      "--target-name", "-",
      // 标记来源为 hook，供 stats_usage 双口径统计
      "--source", "hook",
      // 用户原文（截断由脚本负责，hook 层保持单一职责不截断）
      "--user-query", input.content,
      // 渠道身份（尽力获取，缺失则脚本走匿名兜底 + sessionKey 归一化）
      "--user-id", input.senderId,
      "--user-name", input.senderName,
      "--session-key", input.sessionKey,
    ];

    await execFileAsync("python3", args, {
      timeout: EXEC_TIMEOUT_MS,
      // 抑制 stdout/stderr，避免埋点输出污染日志
      stdio: ["ignore", "ignore", "ignore"],
    });
  } catch (_err) {
    // 静默吞掉所有异常：脚本不存在、超时、数据库锁、参数错误等都不阻断对话。
    // 写入失败时 track_usage.py 内部已写兜底日志，无需在此重试。
  }
}

export default handler;
