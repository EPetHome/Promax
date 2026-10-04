/** M2：WorkBuddy 大写 Skill；只使用公开 Cordis / dsh 服务与挂点。 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { catalog, discover, readBody } from './discovery.mjs';
import { processForkQueue } from './queue.mjs';

export const name = 'promax-wb-skill';
export const inject = ['tools', 'subagents'];
const HOST_TOOLS = new Set(['Skill', 'Agent', 'TeamCreate', 'SendMessage', 'present_files']);
const INLINE_SKILLS = new Set(['prd-document-generator', 'business-diagram-generator', 'interactive-prototype-generator']);
const blocksText = blocks => (blocks ?? []).filter(block => block.type === 'text').map(block => block.text).join('');
const errorText = error => String(error?.message ?? error);
const output = { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] };

export function apply(ctx, config) {
  if (!config?.packageDir || !path.isAbsolute(config.packageDir)) throw new Error('packageDir must be an absolute path');
  if (!config.memberModel?.provider || !config.memberModel?.model) throw new Error('memberModel is required');
  const queue = processForkQueue(config.maxConcurrentForks ?? 16);
  const creation = new AsyncLocalStorage();
  const roles = new Map();
  const lastCatalog = new Map(); // 只在消息实际提交后记为已发布；会话 id 在冷恢复时稳定。
  const pendingCatalog = new Map();

  const roleOf = agent => {
    const known = roles.get(agent?.id);
    if (known !== undefined) return known;
    const header = agent?.session?.header;
    if (!header) return null;
    return header.parentSession === undefined && header.origin !== 'subagent' ? 'lead' : null;
  };
  const log = (agent, event, fields = {}) => {
    const cwd = agent?.session?.header?.cwd;
    if (!cwd) return;
    const directory = path.join(cwd, 'product-agent-output');
    mkdirSync(directory, { recursive: true });
    appendFileSync(path.join(directory, 'wb-host.jsonl'), `${JSON.stringify({
      ...fields, ts: new Date().toISOString(), event,
      session_id: agent?.session?.id ?? agent?.id ?? null, role: roleOf(agent),
    })}\n`, 'utf8');
  };
  const scan = agent => discover(config.packageDir, (event, fields) => log(agent, event, fields));

  // 只读观测 Agent 派发来归属日志角色；不读取或调用 M1 内部实现。
  ctx.on('tools/execute', (exec, next) => {
    if (exec.name !== 'Agent') return next();
    return creation.run({ parentId: exec.agent?.id,
      role: exec.arguments?.name ?? exec.arguments?.subagent_type ?? null }, next);
  });
  ctx.on('agent/created', ({ agent }) => {
    const bound = creation.getStore();
    if (bound && agent.session.header.parentSession === bound.parentId) roles.set(agent.id, bound.role);
  });

  ctx.on('session/event', (session, event) => {
    if (event.type !== 'user/message') return;
    const pending = pendingCatalog.get(session.id);
    if (pending?.messageId !== event.data.id) return;
    lastCatalog.set(session.id, { ...pending, seq: event.seq });
    pendingCatalog.delete(session.id);
  });
  ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
    const decision = await next();
    if (decision.kind !== 'enter' || signal.aborted || roleOf(agent) === 'fork') return decision;
    const current = catalog(scan(agent));
    const previous = lastCatalog.get(agent.id);
    if (previous?.digest === current.digest && agent.session.surface.nodes.includes(previous.seq)
      && agent.session.eventAt(previous.seq)?.data?.id === previous.messageId) return decision;
    const message = { id: randomUUID(), role: 'user', content: [{ type: 'text', text: current.text }],
      source: { kind: 'plugin:promax-wb-host' } };
    pendingCatalog.set(agent.id, { digest: current.digest, messageId: message.id });
    log(agent, 'skill-catalog', { digest: current.digest, message_id: message.id });
    return { ...decision, messages: [...decision.messages, message] };
  });

  ctx.tools.register({
    name: 'Skill', description: '按注册名加载技能；context: fork 时在无人设的独立子会话执行。args 为纯文本。',
    parameters: {
      type: 'object', properties: { skill: { type: 'string' }, args: { type: 'string' } },
      required: ['skill'], additionalProperties: true,
    },
    output,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const extra = Object.fromEntries(Object.entries(args).filter(([key]) => key !== 'skill' && key !== 'args'));
      log(exec.agent, 'skill-call', { tool: 'Skill', call_id: exec.callId, skill: args.skill, args: args.args ?? '', extra });
      const skill = scan(exec.agent).get(args.skill);
      if (!skill) throw new Error(`Unknown skill: ${args.skill}`);
      const mode = !INLINE_SKILLS.has(skill.name) && skill.context === 'fork' ? 'fork' : 'inline';
      const body = readBody(skill);
      // Cordis inject 列表均为硬依赖；公开 get() 在调用时读取可选服务，缺席不阻止 M2 装载。
      const runtime = ctx.get('wbRuntime');
      const issued = runtime ? await runtime.issue({
        cwd: exec.agent.session.header.cwd, skill: skill.name, mode, args: args.args ?? '',
        callerSessionId: exec.agent.session.id,
      }) : undefined;
      const taskArgs = runtime ? issued.args : args.args ?? '';
      const task = `Base directory for this skill: ${skill.directory}\n${body}\n\nARGUMENTS: ${taskArgs}`;
      if (mode === 'inline') return task;

      let ticket;
      let run;
      let finalText = '';
      let error;
      let queueMs = 0;
      try {
        ticket = await queue.acquire(exec.signal);
        queueMs = ticket.queueMs;
        exec.signal.throwIfAborted();
        const allow = ctx.tools.schemas(exec.agent).map(tool => tool.name).filter(tool => !HOST_TOOLS.has(tool));
        run = await creation.run({ parentId: exec.agent.id, role: 'fork' }, () => ctx.subagents.start('spawn', {
          parent: exec.agent, label: `skill:${skill.name}`, signal: exec.signal,
          prompt: [{ type: 'text', text: task }], agentOptions: config.memberModel,
          persona: '', toolFilter: { allow }, maxDepth: ctx.subagents.resolveMaxDepth(),
        }));
        roles.set(run.id, 'fork');
        log(exec.agent, 'skill-fork-start', { skill: skill.name, child_session_id: run.id, queue_ms: queueMs });
        const result = await run.result;
        finalText = blocksText(result.output);
        if (result.stopReason !== 'completed') error = result.diagnostic || finalText || result.stopReason;
      } catch (cause) {
        error = errorText(cause);
        queueMs = ticket?.queueMs ?? cause?.queueMs ?? 0;
      } finally {
        try {
          if (run) await run.dispose();
        } catch (cause) {
          error = error ?? errorText(cause);
        } finally {
          ticket?.release();
        }
      }
      if (runtime) await runtime.finishFork({
        runId: issued.runId, childSessionId: run?.id ?? null, finalText,
        ...(error === undefined ? {} : { error }), queueMs,
      });
      log(exec.agent, 'skill-fork-end', { skill: skill.name, child_session_id: run?.id ?? null,
        queue_ms: queueMs, error: error ?? null });
      return error === undefined
        ? `Skill "${skill.name}" completed (forked execution).\n\n${finalText}`
        : `Skill "${skill.name}" failed (forked execution).\n\n${error}`;
    },
  });
}
