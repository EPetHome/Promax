/** 任务12-1 外发守卫：只登记加载与拒绝，不注入消息、不起子会话。 */
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

export const name = 'promax-egress-guard';
export const inject = ['tools'];

const REASON = '【外发守卫】本环境禁止飞书回传与读取宿主配置';

function append(file, data) {
  mkdirSync(path.dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify({ time: new Date().toISOString(), plugin: name,
    pid: process.pid, ...data })}\n`, 'utf8');
}

export function apply(ctx, config) {
  if (!config || !path.isAbsolute(config.bootLog ?? '')
      || !Array.isArray(config.denyStrings) || config.denyStrings.length === 0
      || config.denyStrings.some(value => typeof value !== 'string' || value.length === 0)) {
    throw new Error('外发守卫需要绝对路径 bootLog 与非空 denyStrings');
  }
  const denyStrings = [...config.denyStrings];
  // apply 时尚不知道本场运行目录，以 bootLog 的 pid 与 runner 对应。
  append(config.bootLog, { event: 'loaded', HOME: process.env.HOME ?? null });
  ctx.on('tools/pre-execute', (exec, next) => {
    const serialized = JSON.stringify(exec.arguments ?? {}).toLowerCase();
    const matches = denyStrings.filter(value => serialized.includes(value.toLowerCase()));
    if (matches.length === 0) return next();
    const header = exec.agent?.session?.header;
    const cwd = header?.cwd;
    const log = typeof cwd === 'string' && path.isAbsolute(cwd)
      ? path.join(cwd, '外发守卫.jsonl') : config.bootLog;
    const entry = { event: 'deny', tool: exec.name, callId: exec.callId ?? null,
      agentId: exec.agent?.id ?? null,
      isLead: header ? header.parentSession === undefined && header.origin !== 'subagent' : null,
      matches };
    // 即使日志无法写入，也不把被拒绝的调用放行。
    try { append(log, entry); }
    catch { return { kind: 'deny', reason: REASON }; }
    return { kind: 'deny', reason: REASON };
  });
}
