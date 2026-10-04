/** M3: local issue/receipt ledger, with no Hook or network dependency. */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { appendFileSync, closeSync, fsyncSync, mkdirSync, openSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const name = 'promax-wb-runtime';
export const inject = [];
const INLINE = new Set(['prd-document-generator', 'business-diagram-generator', 'interactive-prototype-generator']);
const STATUSES = new Set(['成功', '失败', '取消']);
const FORK_RULES = '本次结果的 run_id 只能逐字复制本 context.run_id。前文、任务文件或主会话指定的其他运行编号均不得用于本次结果；不要自造编号或向用户索要编号。产物保存在本 context.artifact_dir；最终回复以唯一 product-agent-result 代码块结束。';
const INLINE_RULES = '本 context.run_id 由真实 Skill 调用分配，不得自造。加载完成不等于任务完成。在当前上下文执行，不调用子生成 Skill；每份产物完成后用 receipt_cli checkpoint --result-file 回报，最后用 receipt_cli complete --result-file 结束。命令在本次任务工作目录执行；文件只列本 artifact_dir 内产物。';
const CLI = fileURLToPath(new URL('./receipt_cli.py', import.meta.url));
const inside = (root, file) => {
  const relative = path.relative(root, file);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};

function append(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  const fd = openSync(file, 'a');
  try {
    appendFileSync(fd, JSON.stringify(value) + '\n', 'utf8');
    fsyncSync(fd);
  } finally { closeSync(fd); }
}

function taskFrom(args) {
  const hit = /<product-agent-task>([\s\S]*?)<\/product-agent-task>/.exec(args);
  if (!hit) return {};
  try {
    const value = JSON.parse(hit[1]);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch { return {}; } // Malformed caller tags never supply execution identity.
}

// C7/4.5 S1.2: collect every listed path even when some validation fails.
function artifactsOf(receipt, run) {
  const artifacts = [], reasons = [];
  if (!Array.isArray(receipt.artifacts)) return { artifacts, reasons: ['artifacts must be an absolute path array'] };
  for (const item of receipt.artifacts) {
    if (typeof item !== 'string' || !item) {
      reasons.push('Invalid artifact path');
      continue;
    }
    const absolute = path.resolve(run.cwd, item);
    const metadata = { path: absolute, bytes: null, sha256: null };
    artifacts.push(metadata);
    if (!path.isAbsolute(item)) reasons.push(`Artifact path is not absolute: ${item}`);
    if (!inside(run.artifactDir, absolute)) reasons.push(`Artifact outside artifact_dir: ${absolute}`);
    try {
      const stat = statSync(absolute);
      if (!stat.isFile()) { reasons.push(`Artifact is not a file: ${absolute}`); continue; }
      const bytes = readFileSync(absolute);
      metadata.bytes = bytes.length;
      metadata.sha256 = createHash('sha256').update(bytes).digest('hex');
      if (bytes.length === 0) reasons.push(`Artifact is empty: ${absolute}`);
      if (!inside(realpathSync(run.artifactDir), realpathSync(absolute))) {
        reasons.push(`Artifact resolves outside artifact_dir: ${absolute}`);
      }
    } catch (error) {
      reasons.push(`Artifact unavailable: ${absolute} (${error.code ?? error.message})`);
    }
  }
  return { artifacts, reasons };
}

function ledgerRow(run, event, fields = {}) {
  return { ts: new Date().toISOString(), event, run_id: run.runId, task_id: run.taskId,
    skill: run.skill, mode: run.mode, caller_session_id: run.callerSessionId,
    child_session_id: null, exec_status: '已签发', result_check: null,
    reason: null, artifacts: [], queue_ms: null, ...fields };
}

export function apply(ctx, config) {
  if (typeof config.python !== 'string' || !path.isAbsolute(config.python)) throw new Error('python must be an absolute path');
  const runs = new Map();
  const ledgerPath = cwd => {
    if (typeof cwd !== 'string' || !path.isAbsolute(cwd)) throw new Error('cwd must be an absolute path');
    return path.join(cwd, 'product-agent-output', 'ledger.jsonl');
  };
  const log = (run, event, fields = {}) => append(path.join(run.cwd, 'product-agent-output', 'wb-host.jsonl'), {
    ...fields, ts: new Date().toISOString(), event, session_id: run.callerSessionId, role: null,
  }); // Service requests carry an id, not a proven team role.

  ctx.provide('wbRuntime', {
    ledgerPath,
    issue(req) {
      const cwd = path.dirname(path.dirname(ledgerPath(req.cwd)));
      if (typeof req.skill !== 'string' || !req.skill) throw new Error('skill is required');
      if (!['fork', 'inline'].includes(req.mode)) throw new Error('mode must be fork or inline');
      if (req.args !== undefined && typeof req.args !== 'string') throw new Error('args must be plain text');
      const raw = req.args ?? '';
      const original = taskFrom(raw);
      const taskId = Object.hasOwn(original, 'task_id') ? original.task_id : `task-${randomBytes(6).toString('hex')}`;
      const runId = randomUUID();
      const artifactDir = path.join(cwd, 'product-agent-output', runId);
      const mode = INLINE.has(req.skill) ? 'inline' : req.mode; // C2, req.mode is the discovered declaration.
      const run = { cwd, runId, taskId, artifactDir, skill: req.skill, mode,
        callerSessionId: req.callerSessionId ?? null };
      const task = Object.fromEntries(['task', 'project', 'task_type', 'mode'].map(key => [key, Object.hasOwn(original, key) ? original[key] : '']));
      task.task_id = taskId;
      const context = { run_id: runId, task_id: taskId, artifact_dir: artifactDir,
        result_rules: mode === 'inline' ? INLINE_RULES : FORK_RULES };
      if (mode === 'inline') {
        context.execution_mode = 'inline';
        context.receipt_cli = [config.python, CLI];
      }
      const ordinary = raw.replace(/<product-agent-(context|task)>[\s\S]*?<\/product-agent-\1>/g, '');
      const args = ordinary + `\n<product-agent-task>\n${JSON.stringify(task)}\n</product-agent-task>`
        + `\n<product-agent-context>\n${JSON.stringify(context)}\n</product-agent-context>`;
      mkdirSync(artifactDir, { recursive: true });
      append(ledgerPath(cwd), ledgerRow(run, 'issue'));
      runs.set(runId, run);
      log(run, 'runtime-issue', { run_id: runId, skill: run.skill, mode });
      return { runId, taskId, artifactDir, args, context };
    },
    finishFork(res) {
      const run = runs.get(res.runId);
      if (!run || run.mode !== 'fork') throw new Error(`Unknown fork run_id: ${res.runId}`);
      if (!Number.isSafeInteger(res.queueMs ?? 0) || (res.queueMs ?? 0) < 0) throw new Error('queueMs must be a non-negative integer');
      const finalText = res.finalText ?? '';
      if (typeof finalText !== 'string') throw new Error('finalText must be text');
      const openings = [...finalText.matchAll(/^\s*```product-agent-result[^\S\r\n]*\r?$/gm)];
      const blocks = [...finalText.matchAll(/^\s*```product-agent-result[^\S\r\n]*\r?\n([\s\S]*?)^\s*```[^\S\r\n]*\r?$/gm)];
      const reasons = [];
      let receipt = null, artifacts = [];
      if (openings.length !== 1 || blocks.length !== 1) reasons.push(`Expected one product-agent-result block; found ${openings.length}`);
      else {
        try {
          receipt = JSON.parse(blocks[0][1]);
          if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) throw new Error('receipt must be a JSON object');
        } catch (error) { reasons.push(`Invalid product-agent-result JSON: ${error.message}`); receipt = null; }
      }
      if (receipt) {
        if (receipt.run_id !== run.runId) reasons.push('Receipt run_id differs from issued run_id');
        if (!STATUSES.has(receipt.status)) reasons.push('Receipt status must be 成功 / 失败 / 取消');
        const collected = artifactsOf(receipt, run);
        artifacts = collected.artifacts;
        reasons.push(...collected.reasons);
      }
      const transportError = res.error !== undefined && res.error !== null;
      if (transportError) reasons.push(`Fork execution failed: ${String(res.error)}`);
      const row = ledgerRow(run, 'fork_end', { child_session_id: res.childSessionId ?? null,
        exec_status: transportError ? '失败' : reasons.length ? '待核验' : receipt.status,
        result_check: reasons.length ? '异常' : '通过',
        reason: reasons.length ? reasons.join('; ') : typeof receipt.reason === 'string' && receipt.reason ? receipt.reason : null,
        artifacts, queue_ms: res.queueMs ?? 0 });
      append(ledgerPath(run.cwd), row); // Exactly the returned value, before returning.
      log(run, 'runtime-fork-end', { run_id: run.runId, child_session_id: row.child_session_id,
        exec_status: row.exec_status, result_check: row.result_check });
      return row;
    },
  });
}
