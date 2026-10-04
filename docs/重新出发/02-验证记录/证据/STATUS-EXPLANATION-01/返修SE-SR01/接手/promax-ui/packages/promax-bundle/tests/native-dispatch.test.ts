// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, writeFile, rm, mkdir, readFile, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { workRouteFixture } from "../../promax-ui-console/tests/work-route-fixture.ts";
import { WorkStore } from "../src/work-store.ts";
import { deliveryTimeline, mergeTimeline, workTimeline } from "../../promax-ui-console/src/client/work-timeline.ts";
import { coordinatorContext } from "../src/index.ts";
import { WORK_SYSTEM_PROMPT } from "../../promax-ui-console/src/work-protocol.ts";
import { emptyStatus, deriveAgentStatus } from "../../promax-ui-console/src/work-control.ts";
import { settleStructuredCommits } from "../src/structured-results.ts";
import { ContentObjectStore } from "@promax/promax-report";
import { isAgentLoopRequest as bundleLoopRequest } from "@deepseek-ai/dsh-llm";
import { controlTaskRunFiles } from "../src/index.ts";

// Real Loader, ToolRuntime, role schemas, native send_message, persistence and continuation manager.
// Only external model responses and the web/settings/company adapters are substituted.
const dsh = new URL("../../../../promax-agent/deepseek-harness/", import.meta.url);
const load = (path: string) => import(/* @vite-ignore */ new URL(path, dsh).href);
const { Context } = await load("vendor/cordis/lib/index.js");
const { default: Loader } = await load("vendor/loader/lib/index.js");
const { default: Include } = await load("vendor/include/lib/index.js");
const { LlmAdapter, BlockAssembler, CallId, createToolResultMessage, createUserMessage, isAgentLoopRequest: nativeLoopRequest } = await load("packages/llm/llm/lib/index.js");
const { summarizeWithLlm } = await load("packages/compaction/compaction-basic/lib/types/summarizer.js");
const { SessionId } = await load("packages/core/session/lib/index.js");
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { vi.restoreAllMocks(); for (const close of cleanups.splice(0).reverse()) await close(); });

async function setup(seed = false) {
  const root = await mkdtemp(join(tmpdir(), "promax-native-"));
  const ctx = new Context(); ctx.baseUrl = pathToFileURL(root).href + "/";
  let f: Awaited<ReturnType<typeof workRouteFixture>> | undefined;
  const gates: Array<() => void> = [];
  const pendingEnds = new Set<Promise<unknown>>();
  cleanups.push(async () => { gates.forEach(release => release()); await Promise.allSettled([...pendingEnds]); await ctx.fiber.dispose(); await f?.close(); await rm(root, { recursive: true, force: true }); });
  await ctx.plugin(Loader); ctx.loader.builtins.include = Include;
  const paths: Record<string, string> = {
    llm: "llm/llm", sessions: "core/session", prompt: "core/system-prompt", tools: "core/tools", agents: "core/agent", loop: "core/agent-loop",
    persistence: "session/session-persistence-jsonl", subagents: "subagent/subagent", spawn: "subagent/subagent-spawn-in-process", control: "subagent/tool-subagent-control",
    member: "subagent/tool-subagent", judge: "subagent/tool-subagent",
  };
  const modules = new Map<string, any>();
  for (const [name, path] of Object.entries(paths)) { const mod = await load(`packages/${path}/lib/index.js`); modules.set(name, mod.default ?? mod); }
  ctx.loader.internal = { version: "v2", async import(name: string) { return modules.get(name); } };
  const config: Record<string, unknown> = { persistence: { root: join(root, "sessions") }, spawn: { providerName: "spawn" },
    member: { provider: "spawn", toolName: "solution_design", backgroundMode: "continuable", persona: "PROMAX_MEMBER_ID:solution_design" },
    judge: { provider: "spawn", toolName: "quality_judge", backgroundMode: "continuable", persona: "PROMAX_MEMBER_ID:quality_judge" } };
  const file = join(root, "cordis.yml");
  await writeFile(file, JSON.stringify(Object.keys(paths).map(name => ({ name, ...(config[name] ? { config: config[name] } : {}) }))));
  await ctx.loader.create({ name: "cordis:include", config: { path: pathToFileURL(file).href } }); await ctx.loader.await();
  expect([...ctx.loader.entries()].filter((e: any) => !e.fiber && !e.disabled)).toEqual([]);
  f = await workRouteFixture({ runtime: { tools: ctx.tools, agents: ctx.agents, on(name: string, callback: (...args: any[]) => any, options?: any) {
    if (name !== "subagent/end") return ctx.on(name, callback, options);
    return ctx.on(name, (...args: any[]) => {
      const pending = Promise.resolve(callback(...args)); pendingEnds.add(pending);
      void pending.finally(() => pendingEnds.delete(pending)).catch(() => {});
      return pending;
    }, options);
  } } });
  const store = new WorkStore(f.scope.projectPath);
  const created = await (await f.request("work/card/update", { action: "create", sessionId: "session-one", title: "原生续接" })).json();
  const key = created.card.work_key;
  let seedHash: string | undefined;
  if (seed) {
    await mkdir(join(f.scope.projectPath, ".任务/delivery-old/产物快照"), { recursive: true });
    const path = ".任务/delivery-old/产物快照/prd.md";
    await writeFile(join(f.scope.projectPath, path), "# PRD\n旧正式版\n");
    seedHash = new ContentObjectStore(f.scope.projectPath).commit("delivery-old", "2".repeat(32), [path], { workKey: key, author: "fixture", kind: "ai_run" })[0]!.current_sha256;
  }
  const parent = ctx.agentLoop.create(SessionId(created.card.session_id), { provider: "stub", model: "stub" }, { cwd: f.scope.projectPath, agentPreset: "promax-team-r10" } as never);
  // Native settlement may notify the parent. Park only the coordinator model, not child execution/lifecycle.
  let parkParent = true;
  ctx.on("agent/pre-step", async ({ agent }: any, next: any) => agent === parent && parkParent ? { kind: "reject" } : next(), { global: true });
  const instructions: string[] = [];
  vi.spyOn(parent, "steer").mockImplementation((message: any) => { instructions.push(message.content.map((c: any) => c.text ?? "").join("")); });
  const turns: string[] = [];
  let gate: Promise<void> | undefined;
  let parentText: (options: any) => string = () => "报告已更新完成";
  let onPrimary: ((options: any) => Promise<void>) | undefined;
  let primaryToolOnce = false;
  class Stub extends LlmAdapter { async *stream(options: any) {
    turns.push(options.sessionId); if (gate) await gate;
    if (options.sessionId === parent.session.header.id && !options.purpose) await onPrimary?.(options);
    const text = options.purpose === "compaction" ? "## Primary Request and Intent\n- 真实摘要内容保留" : options.sessionId === parent.session.header.id ? parentText(options) : "隔离模型响应，非业务验收";
    yield { type: "block-start", index: 0, blockType: "text" };
    yield { type: "text-delta", index: 0, text };
    yield { type: "block-end", index: 0, block: { type: "text", text } };
    if (options.purpose === "compaction") yield { type: "usage", usage: { inputTokens: 17, outputTokens: 13 } };
    if (options.sessionId === parent.session.header.id && !options.purpose && primaryToolOnce) {
      primaryToolOnce = false;
      yield { type: "block-start", index: 1, blockType: "tool-call" };
      yield { type: "tool-call-delta", index: 1, id: CallId("r3-invalid-proposal"), name: "promax_work_proposal", argumentsDelta: "{}" };
      yield { type: "usage", usage: { inputTokens: 11, outputTokens: 7 } };
      yield { type: "finish", reason: { kind: "tool-calls" } };
    } else yield { type: "finish", reason: { kind: "stop" } };
  } }
  ctx.llm.registerAdapter(["stub"], new Stub());
  const event = (await (await f.request("work/card/update", { action: "message", work_key: key, text: "完成prd.md", paths: [] })).json()).event;
  let n = 0;
  const execute = async (name: string, args: any, signal = new AbortController().signal, agent = parent) => {
    const callId = `native-${++n}`;
    agent.session.append("tool/call", { turn: 1, step: 1, name, callId, arguments: JSON.stringify(args) });
    const result = await ctx.tools.execute({ name, arguments: args, callId, signal, agent });
    agent.session.append("tool/result", { turn: 1, step: 1, message: createToolResultMessage({ callId, content: result.content, isError: result.isError }) }, { surfaceOp: "append" });
    await settleStructuredCommits(f!.scope.projectPath);
    return result;
  };
  expect((await execute("promax_work_proposal", { intent: "execute", card_patch: {}, deliverables: ["prd.md"], edit_request: null,
    handled_events: [{ event_id: event.id, intent: "new_task", impact: "normal", note: "开始" }] })).isError).toBe(false);
  const proposed = (await store.round(key))!;
  expect((await f.request("work/card/update", { work_key: key, action: "start", revision: proposed.revision, source: "click" })).status).toBe(200);
  const endings: any[] = [];
  ctx.on("subagent/end", (info: any) => { endings.push(info); }, { global: true });
  const hold = () => { let release!: () => void; gate = new Promise<void>(resolve => { release = resolve; }); gates.push(release); return () => { gate = undefined; release(); }; };
  const stop = async () => { await parent.whenIdle(); await ctx.parallel("agent/turn-stopping", { agent: parent, turn: 1, signal: new AbortController().signal }); };
  const ended = async (id: string, count = 1) => { await vi.waitFor(() => expect(endings.filter(e => e.id === id)).toHaveLength(count)); await store.executions(key); };
  const loadPersisted = async () => {
    await ctx.sessions.flush(parent.session);
    const reader = new Context();
    try {
      await reader.plugin(modules.get("sessions"));
      await reader.plugin(modules.get("persistence"), { root: join(root, "sessions") });
      return await reader.sessionPersistence.load(parent.id);
    } finally { await reader.fiber.dispose(); }
  };
  return { f, ctx, store, key, parent, execute, turns, hold, stop, ended, endings, instructions, seedHash, loadPersisted, unparkParent: () => { parkParent = false; }, setParentText: (text: (options: any) => string) => { parentText = text; }, onPrimary: (run: (options: any) => Promise<void>) => { onPrimary = run; }, setPrimaryToolOnce: () => { primaryToolOnce = true; }, onCleanup: (close: () => Promise<void>) => cleanups.push(close) };
}

it("R30 原生角色→续接共享/持久读取严格规范化，无新投递或假等待；R28真实计划批准恢复", async () => {
  const w = await setup(), release = w.hold();
  const first = await w.execute("solution_design", { description: "首稿", prompt: "当前任务" });
  expect(first.isError, JSON.stringify(first)).toBe(false);
  const id = first.value.subagentId;
  const replay = await w.execute("send_message", { subagent_id: id, message: "同动作" });
  expect(replay).toMatchObject({ isError: true, error: { info: { code: "ACTION_REUSED" } } });
  expect(replay.content[0].text).toContain("未再次投递");
  const before = (await w.store.round(w.key))!.member_seq;
  await w.stop(); expect((await w.store.round(w.key))!.member_seq).toEqual(before);
  release(); await w.ended(id);
  const stored = await w.execute("send_message", { subagent_id: id, message: "读取已结束结果" });
  expect(stored.error.info.code).toBe("ACTION_REUSED");
  expect(w.turns).toHaveLength(1);
  expect((await (await w.f.request("work/read", { work_key: w.key })).json()).live).toBe(false);
  // No file/receipt: the real plan writes the authoritative role-key recovery, not a test-authored member_seq.
  await w.stop();
  expect((await w.store.round(w.key))!.member_seq?.solution_design).toBeGreaterThan(0);
  const release2 = w.hold();
  const recovered = await w.execute("send_message", { subagent_id: id, message: "按程序恢复" });
  expect(recovered.isError, JSON.stringify(recovered)).toBe(false);
  const reverse = await w.execute("solution_design", { description: "原动作", prompt: "读取续接" });
  expect(reverse.error.info.code).toBe("ACTION_REUSED");
  const same = await w.execute("send_message", { subagent_id: id, message: "同恢复重复" });
  expect(same.isError).toBe(false); expect(same.value.messageId).toBe(recovered.value.messageId);
  expect(same.content[0].text).toContain("未再次投递");
  expect(w.turns).toHaveLength(2);
  release2(); await w.ended(id, 2);
  expect((await w.store.executions(w.key)).find(e => e.session_id === id)?.state).toBe("done");
});

it.each(["record", "inbox", "schema", "throw"])("R31 受理后%s窗口取消/失败仍在途；真实结束才结清，旧结束不串状态", async (window) => {
  const w = await setup();
  const first = await w.execute("solution_design", { description: "首稿", prompt: "当前任务" });
  expect(first.isError, JSON.stringify(first)).toBe(false);
  const id = first.value.subagentId; await w.ended(id); await w.stop();
  const release = w.hold(), caller = new AbortController();
  const original = WorkStore.prototype.observe;
  let cancelled = false;
  vi.spyOn(WorkStore.prototype, "observe").mockImplementation(async function(this: WorkStore, key, row) {
    if (window === "record" && row.kind === "action_result" && row.tool_name === "send_message" && !cancelled) { cancelled = true; caller.abort(); }
    return original.call(this, key, row);
  });
  w.ctx.on("agent/inbox/inserted", ({ message }: any) => {
    if (window === "inbox" && message.source.kind === "coordinator") { cancelled = true; caller.abort(); }
  }, { global: true });
  const dispose = w.ctx.on("tools/execute", async (exec: any, next: any) => {
    const result = await next();
    if (exec.name !== "send_message") return result;
    if (window === "throw") throw new Error("failure after acceptance");
    return window === "schema" ? { isError: false, value: { wrong: true }, content: [] } : result;
  }, { global: true, prepend: true });
  const result = await w.execute("send_message", { subagent_id: id, message: "恢复" }, caller.signal);
  dispose(); expect(result.isError).toBe(true);
  if (window === "record" || window === "inbox") {
    expect(cancelled).toBe(true); expect(result.error.info.code).toBe("ABORTED");
  }
  const round = (await w.store.round(w.key))!, instructions = w.instructions.length;
  await w.stop();
  expect(w.instructions).toHaveLength(instructions); expect((await w.store.round(w.key))!.member_seq).toEqual(round.member_seq);
  expect((await w.store.executions(w.key)).find(e => e.session_id === id)?.state).toBe("running");
  const view = await (await w.f.request("work/read", { work_key: w.key })).json();
  expect(view.live).toBe(true); expect(view.members.find((m: any) => m.session_id === id).state).toBe("running");
  await w.ctx.parallel("subagent/end", w.endings[0]); // Late old activation event must not clear the new one.
  const early = new AbortController(); early.abort();
  expect((await w.execute("send_message", { subagent_id: id, message: "已取消" }, early.signal)).isError).toBe(true);
  await w.stop(); expect(w.instructions).toHaveLength(instructions);
  release(); await w.ended(id, 3); // Includes the explicitly replayed old notification in the observer list.
  expect((await w.store.executions(w.key)).find(e => e.session_id === id)?.state).toBe("done");
  expect((await (await w.f.request("work/read", { work_key: w.key })).json()).live).toBe(false);
  expect(w.turns).toHaveLength(2);
});

it("R30 final-result：输出规范化失败/中间件异常未投递时释放本次预占", async () => {
  const w = await setup();
  const first = await w.execute("solution_design", { description: "首稿", prompt: "当前任务" });
  const id = first.value.subagentId; await w.ended(id); await w.stop();
  let mode = "schema";
  const dispose = w.ctx.on("tools/execute", async (exec: any, next: any) => {
    if (exec.name !== "send_message") return next();
    if (mode === "throw") throw new Error("isolated middleware failure");
    return { isError: false, value: { kind: "continuable", subagentId: id }, content: [] };
  }, { global: true, prepend: true });
  for (const value of ["schema", "throw"]) {
    mode = value;
    const result = await w.execute("send_message", { subagent_id: id, message: value });
    expect(result.isError).toBe(true);
    const before = w.instructions.length; await w.stop();
    expect(w.instructions.length).toBeGreaterThan(before);
  }
  dispose(); expect(w.turns).toHaveLength(1);
});

it("R30/R28 原生Judge并发派发与双向读取只保留原会话；程序批准恢复且同次恢复只受理一次", async () => {
  const w = await setup(), release = w.hold();
  const member = await w.execute("solution_design", { description: "首稿", prompt: "当前任务" });
  expect(member.isError, JSON.stringify(member)).toBe(false);
  const id = member.value.subagentId, round = (await w.store.round(w.key))!;
  await writeFile(join(w.f.scope.projectPath, ".任务", round.task_key!, "产物快照/prd.md"), "# PRD\n隔离首稿\n");
  const receipt = await w.execute("promax_member_receipt", { filename: "prd.md", status: "draft_ready", summary: "首稿", unverified: [], gaps: [], input_version: round.execution_version }, undefined, w.ctx.agents.get(id));
  expect(receipt.isError, JSON.stringify(receipt)).toBe(false);
  release(); await w.ended(id); await w.stop();
  expect((await w.store.round(w.key))!.phase).toBe("checking");
  const releaseJudge = w.hold();
  const [first, second] = await Promise.all([1, 2].map(() => w.execute("quality_judge", { description: "独立检查", prompt: "当前评审" })));
  expect(first.isError, JSON.stringify(first)).toBe(false); expect(second.value).toEqual(first.value);
  const judge = first.value.subagentId;
  expect((await w.execute("send_message", { subagent_id: judge, message: "读取当前检查" })).error.info.code).toBe("ACTION_REUSED");
  releaseJudge(); await w.ended(judge);
  // Old durable role records without tool_name must still be interpretable, not rewritten or replayed as delivery.
  const observe = WorkStore.prototype.observations;
  const legacy = vi.spyOn(WorkStore.prototype, "observations").mockImplementation(async function(this: WorkStore, key) {
    return (await observe.call(this, key)).map(row => { const copy = { ...row }; delete copy.tool_name; return copy; });
  });
  expect((await w.execute("send_message", { subagent_id: judge, message: "读取旧记录" })).error.info.code).toBe("ACTION_REUSED");
  legacy.mockRestore(); await w.stop();
  expect((await w.store.round(w.key))!.member_seq?.quality_judge).toBeGreaterThan(0);
  const releaseRecovered = w.hold();
  const [a, b] = await Promise.all([1, 2].map(() => w.execute("send_message", { subagent_id: judge, message: "本次恢复" })));
  expect(a.isError, JSON.stringify(a)).toBe(false); expect(b.value, JSON.stringify(b)).toEqual(a.value);
  expect((await w.execute("quality_judge", { description: "读取", prompt: "原恢复结果" })).error.info.code).toBe("ACTION_REUSED");
  expect(Object.entries((await w.store.round(w.key))!.children!).filter(([, role]) => role === "quality_judge").map(([id]) => id)).toEqual([judge]);
  releaseRecovered(); await w.ended(judge, 2);
  const rows = await w.store.observations(w.key);
  expect(rows.filter(r => r.kind === "action_started" && r.member === "quality_judge")).toHaveLength(2);
  expect((await w.store.executions(w.key)).find(e => e.session_id === judge)?.events.filter(e => e.id.startsWith("continue:"))).toHaveLength(1);
  expect(w.turns).toHaveLength(3);
});

it("R30/R31 原生受理前拒绝/取消、缓存失败及未知占位不留假running或自动重发", async () => {
  const w = await setup();
  const first = await w.execute("solution_design", { description: "首稿", prompt: "当前任务" });
  const id = first.value.subagentId; await w.ended(id); await w.stop();
  // Cancellation after Promax admission but before native inbox acceptance.
  const caller = new AbortController();
  const abort = w.ctx.on("tools/execute", async (exec: any, next: any) => { if (exec.name === "send_message") caller.abort(); return next(); }, { global: true, prepend: true });
  expect((await w.execute("send_message", { subagent_id: id, message: "未受理取消" }, caller.signal)).isError).toBe(true);
  abort(); const prior = w.instructions.length; await w.stop(); expect(w.instructions.length).toBeGreaterThan(prior);
  // Native cold-resume refuses the target before delivery; the persistent failure must not run it again.
  const inspect = vi.spyOn(w.ctx.sessionPersistence, "inspect").mockRejectedValueOnce(new Error("isolated unavailable child"));
  const denied = await w.execute("send_message", { subagent_id: id, message: "拒绝" });
  expect(denied.isError).toBe(true);
  const cached = await w.execute("send_message", { subagent_id: id, message: "同拒绝" });
  expect(cached.isError).toBe(true); expect(inspect).toHaveBeenCalledTimes(1); inspect.mockRestore();
  expect(w.turns).toHaveLength(1);
  const before = w.instructions.length; await w.stop(); expect(w.instructions.length).toBeGreaterThan(before);
});

it("R30/R31 原生受理后结果未知占位不自动重发，也不残留假running", async () => {
  const w = await setup();
  const first = await w.execute("solution_design", { description: "首稿", prompt: "当前任务" });
  const id = first.value.subagentId; await w.ended(id); await w.stop();
  // Simulate result recording loss only in this isolated workspace. The native accepted child still ends normally.
  const observe = WorkStore.prototype.observe;
  const dropped = vi.spyOn(WorkStore.prototype, "observe").mockImplementation(async function(this: WorkStore, key, row) {
    if (row.kind === "action_result" && row.tool_name === "send_message") return { persisted: false, duplicate: false } as any;
    return observe.call(this, key, row);
  });
  const result = await w.execute("send_message", { subagent_id: id, message: "恢复后记录未落盘" });
  expect(result.isError, JSON.stringify(result)).toBe(false); dropped.mockRestore(); await w.ended(id, 2);
  const unknown = await w.execute("send_message", { subagent_id: id, message: "未知不重发" });
  expect(unknown.error.info.code).toMatch(/ACTION_(UNKNOWN|INFLIGHT)/);
  expect(w.turns).toHaveLength(2);
  const last = w.instructions.length; await w.stop(); expect(w.instructions.length).toBeGreaterThan(last);
});

/** A deliberately wrong coordinator, with real native notice → assembly → generation and real stores. */
async function acceptedDelivery(seed = false) {
  const w = await setup(seed), release = w.hold();
  const member = await w.execute("solution_design", { description: "首稿", prompt: "当前任务" });
  expect(member.isError, JSON.stringify(member)).toBe(false);
  const round = (await w.store.round(w.key))!;
  await writeFile(join(w.f.scope.projectPath, ".任务", round.task_key!, "产物快照/prd.md"), "# PRD\n交付真实性隔离反例\n");
  expect((await w.execute("promax_member_receipt", { filename: "prd.md", status: "draft_ready", summary: "首稿", unverified: [], gaps: [], input_version: round.execution_version }, undefined, w.ctx.agents.get(member.value.subagentId))).isError).toBe(false);
  release(); await w.ended(member.value.subagentId); await w.stop();
  expect((await w.store.round(w.key))!.phase).toBe("checking");
  const releaseJudge = w.hold();
  const dispatched = await w.execute("quality_judge", { description: "检查", prompt: "本次检查" });
  expect(dispatched.isError, JSON.stringify(dispatched)).toBe(false);
  const judge = dispatched.value.subagentId, checking = (await w.store.round(w.key))!;
  const result = await w.execute("promax_check_result", { verdict: "PASS", review_request: checking.review_request, input_version: checking.execution_version, issues: [], decisions: [], unverified: [], acceptance: { baseline_version: checking.acceptance_baseline!.version, items: checking.acceptance_scope!.map(id => ({ id, state: "met", evidence: "隔离测试可控判定，不是真实模型业务验收" })) } }, undefined, w.ctx.agents.get(judge));
  expect(result.isError, JSON.stringify(result)).toBe(false);
  return { ...w, judge, releaseJudge, taskKey: round.task_key!, reviewedHash: checking.reviewed_hashes!["prd.md"] };
}
const parentVisibleText = (w: Awaited<ReturnType<typeof setup>>) => w.parent.session.events.filter((e: any) => e.type === "assistant/message").flatMap((e: any) => e.data.message.content).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
/** 阶段四B：回执确定后的说明回合必须是公开的受控说明。错误替身只在结算前输出错误完成话术；说明回合按回执状态给出正当说明。 */
const primaryModelText = (options: any) => [typeof options.system === "string" ? options.system : "", ...(options.messages ?? []).map((m: any) => typeof m.content === "string" ? m.content : (Array.isArray(m.content) ? m.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n") : ""))].join("\n");
const explainSettledDelivery = (w: Awaited<ReturnType<typeof setup>>) => w.setParentText((options: any) => /程序交付回执（不是员工输入）：.*"state":"(complete|saved_partial|failed|unknown)"/su.test(primaryModelText(options))
  ? "交付说明：以程序回执为准，说明本次成果、变化、限制和入口。"
  : "报告已更新完成");

it("T03 原生结束通知先于提交：错误主Agent替身不能提前发布正式成功", async () => {
  const w = await acceptedDelivery();
  const progress = WorkStore.prototype.progress;
  let release!: () => void, reached!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const saving = new Promise<void>(resolve => { reached = resolve; });
  w.onCleanup(async () => { release(); });
  vi.spyOn(WorkStore.prototype, "progress").mockImplementation(async function(this: WorkStore, ...args) {
    if (this.workspace === w.f.scope.projectPath && args[1].includes("正在保存版本")) { reached(); await gate; }
    return progress.apply(this, args);
  });
  // 阶段四B：结算后的说明回合是公开受控说明，错误替身只在结算前输出错误完成话术（原断言不变）。
  explainSettledDelivery(w);
  w.unparkParent(); w.releaseJudge();
  await saving;
  try {
    await new Promise(resolve => setTimeout(resolve, 80));
    expect(new ContentObjectStore(w.f.scope.projectPath).index().artifacts).toEqual([]);
    expect(parentVisibleText(w)).not.toContain("报告已更新完成");
  } finally { release(); }
  await w.ended(w.judge); await w.parent.whenIdle();
  await vi.waitFor(async () => expect((await w.store.round(w.key))!.last_check?.delivery_saved).toBe(true));
  expect(new ContentObjectStore(w.f.scope.projectPath).index().artifacts[0]!.current_sha256).toBe(w.reviewedHash);
  expect(parentVisibleText(w)).not.toContain("报告已更新完成");
  const receipts = (await w.store.read(w.key)).delivery_receipts!;
  expect(receipts.filter(r => r.state === "complete")).toHaveLength(1);
  expect(w.parent.session.events.some((e: any) => e.type === "user/message" && e.data.source?.plugin === "promax-delivery" && e.data.content[0].text.includes('"state":"complete"'))).toBe(true);
  const loaded = await w.loadPersisted();
  expect(loaded.events.filter((e: any) => e.type === "user/message" && e.data.source?.plugin === "promax-delivery" && e.data.id === receipts.at(-1)!.id)).toHaveLength(1);
  await w.store.employeeMessage(w.key, "只解释变化，不修改", []);
  expect((await w.store.round(w.key))?.task_key).toBeUndefined();
  await w.f.request("work/read", { work_key: w.key });
  expect((await w.store.read(w.key)).delivery_receipts!.filter(r => r.state === "complete")).toHaveLength(1);
});

it.each(["新记录", "旧记录"] as const)("SR02 %s只检查→普通追问→新读取器仍认保存身份，不重复提交", async (format) => {
  const w = await acceptedDelivery();
  w.releaseJudge(); await w.ended(w.judge); await w.parent.whenIdle();
  await vi.waitFor(async () => expect((await w.store.round(w.key))?.last_check?.delivery_saved).toBe(true));
  const before = new ContentObjectStore(w.f.scope.projectPath).index().artifacts[0]!.versions.length;
  expect((await w.f.request("check/request", { work_key: w.key, filenames: ["prd.md"], scope: "只检查已存正式版" })).status).toBe(200);
  const proposal = (await w.store.round(w.key))!;
  expect((await w.f.request("work/card/update", { work_key: w.key, action: "start", revision: proposal.revision, source: "click" })).status).toBe(200);
  await w.stop();
  const checking = (await w.store.round(w.key))!;
  expect(checking.phase).toBe("checking");
  const release = w.hold();
  const judge = await w.execute("send_message", { subagent_id: w.judge, message: "按新请求复查既有正式版" });
  expect(judge.isError, JSON.stringify(judge)).toBe(false);
  const result = await w.execute("promax_check_result", { verdict: "PASS", review_request: checking.review_request, input_version: checking.execution_version, issues: [], decisions: [], unverified: [], acceptance: { baseline_version: checking.acceptance_baseline!.version, items: checking.acceptance_scope!.map(id => ({ id, state: "met", evidence: "隔离检查" })) } }, undefined, w.ctx.agents.get(w.judge));
  expect(result.isError, JSON.stringify(result)).toBe(false);
  release(); await w.ended(w.judge, 2); await w.parent.whenIdle();
  expect((await w.store.round(w.key))!.last_check?.delivery_saved).toBe(true);
  if (format === "旧记录") {
    const historical = (await w.store.round(w.key))!;
    delete historical.delivery!.check_only;
    await w.store.writeRound(w.key, historical);
  }
  await w.store.employeeMessage(w.key, "解释一下检查结果，不改要求", []);
  const reopened = new WorkStore(w.f.scope.projectPath);
  const view = await (await w.f.request("work/read", { work_key: w.key })).json();
  expect((await reopened.round(w.key))?.check_only).not.toBe(true);
  const restored = (await reopened.round(w.key))!;
  expect(restored.last_check?.delivery_saved).toBe(true);
  expect(view.card.delivery_receipts.at(-1).state).toMatch(/complete|saved_partial/);
  expect(view.card.delivery_receipts.at(-1).correction).toBe(false);
  expect(coordinatorContext(await reopened.read(w.key), restored, deriveAgentStatus(await reopened.read(w.key), restored, emptyStatus()), new ContentObjectStore(w.f.scope.projectPath).index().artifacts)).toContain('state: complete');
  expect(new ContentObjectStore(w.f.scope.projectPath).index().artifacts[0]!.versions).toHaveLength(before);
});

it("SR02 普通T1/T2同字节提交：不得从旧展示回执推断T2已保存或回跳T1", async () => {
  const w = await acceptedDelivery();
  w.releaseJudge(); await w.ended(w.judge); await w.parent.whenIdle();
  const root = w.f.scope.projectPath, objects = new ContentObjectStore(root);
  const second = "second-normal-task", trace = "4".repeat(32);
  const path = `.任务/${second}/产物快照/prd.md`;
  await mkdir(join(root, `.任务/${second}/产物快照`), { recursive: true });
  await writeFile(join(root, path), await readFile(join(root, `.任务/${w.taskKey}/产物快照/prd.md`)));
  await writeFile(join(root, `.任务/${second}/工作关联.yml`), `work_key: ${w.key}\ncheck_only: false\n`);
  const round = (await w.store.round(w.key))!;
  round.task_key = second;
  round.delivery = { task_key: second, trace_id: trace, reviewed_hashes: { "prd.md": w.reviewedHash! }, at: new Date().toISOString() };
  await w.store.writeRound(w.key, round);
  await w.store.refreshDelivery(w.key);
  expect((await w.store.read(w.key)).delivery_receipts!.at(-1)!.state).not.toBe("complete");
  expect((await new WorkStore(root).round(w.key))!.last_check?.delivery_saved).toBe(false);
  objects.commit(second, trace, [path], { workKey: w.key, author: "fixture", kind: "ai_run" });
  await w.store.refreshDelivery(w.key);
  for (let i = 0; i < 3; i++) await new WorkStore(root).refreshDelivery(w.key);
  const card = await new WorkStore(root).read(w.key);
  expect(card.delivery_receipts!.filter(r => r.task_key === second && r.state === "complete")).toHaveLength(1);
  expect(card.delivery_receipts!.at(-1)!.targets.find(t => t.kind === "formal")?.task_key).toBe(second);
  expect(objects.index().artifacts[0]!.versions).toHaveLength(2);
});

it("T08 提交等待期间真实停止保留草稿、不发布新版本、不吞取消", async () => {
  const w = await acceptedDelivery(true), progress = WorkStore.prototype.progress;
  let release!: () => void, reached!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const saving = new Promise<void>(resolve => { reached = resolve; });
  w.onCleanup(async () => { release(); });
  vi.spyOn(WorkStore.prototype, "progress").mockImplementation(async function(this: WorkStore, ...args) {
    if (this.workspace === w.f.scope.projectPath && args[1].includes("正在保存版本")) { reached(); await gate; }
    return progress.apply(this, args);
  });
  w.unparkParent(); w.releaseJudge(); await saving;
  const control = JSON.parse(await readFile(join(w.f.scope.projectPath, ".任务", w.taskKey, "run-control.yml"), "utf8"));
  await controlTaskRunFiles(w.f.scope.projectPath, { sessionId: w.parent.id, taskKey: w.taskKey, runEpoch: control.spec.run_epoch, updatedAt: new Date().toISOString(), state: "stop_requested" });
  w.parent.cancel({ kind: "user" }); release();
  await w.ended(w.judge); await w.parent.whenIdle();
  await vi.waitFor(async () => expect((await w.store.read(w.key)).delivery_receipts?.at(-1)?.state).toBe("failed"));
  expect(new ContentObjectStore(w.f.scope.projectPath).index().artifacts[0]!.current_sha256).toBe(w.seedHash);
  expect(parentVisibleText(w)).not.toContain("报告已更新完成");
  expect(await readFile(join(w.f.scope.projectPath, ".任务", w.taskKey, "产物快照/prd.md"), "utf8")).toContain("隔离反例");
});

it("T05 真正结算失败：错误主Agent替身不能留下相反完成话术", async () => {
  const w = await acceptedDelivery();
  const commit = ContentObjectStore.prototype.commit;
  vi.spyOn(ContentObjectStore.prototype, "commit").mockImplementation(function(this: ContentObjectStore, ...args) {
    if (args[0] === w.taskKey) throw new Error("隔离注入：正式提交失败");
    return commit.apply(this, args);
  });
  // 阶段四B：结算后的说明回合是公开受控说明，错误替身只在结算前输出错误完成话术（原断言不变）。
  explainSettledDelivery(w);
  w.unparkParent(); w.releaseJudge(); await w.ended(w.judge); await w.parent.whenIdle();
  await vi.waitFor(async () => expect((await w.store.read(w.key)).last_progress).toContain("保存失败"));
  expect((await w.store.round(w.key))!.last_check?.delivery_saved).toBe(false);
  expect(new ContentObjectStore(w.f.scope.projectPath).index().artifacts).toEqual([]);
  expect(parentVisibleText(w)).not.toContain("报告已更新完成");
  expect((await w.store.read(w.key)).delivery_receipts?.at(-1)?.state).toBe("failed");
});

it("T04/T07 保存后响应丢失先认实际版本，重复结束不重复提交，后来版本不被旧回执覆盖", async () => {
  const w = await acceptedDelivery(true), original = ContentObjectStore.prototype.commit;
  let commits = 0;
  vi.spyOn(ContentObjectStore.prototype, "commit").mockImplementation(function(this: ContentObjectStore, ...args) {
    const result = original.apply(this, args);
    if (args[0] === w.taskKey) { commits++; throw new Error("隔离注入：保存已落盘但响应丢失"); }
    return result;
  });
  // 阶段四B：结算后的说明回合是公开受控说明，错误替身只在结算前输出错误完成话术（原断言不变）。
  explainSettledDelivery(w);
  w.unparkParent(); w.releaseJudge(); await w.ended(w.judge); await w.parent.whenIdle();
  await vi.waitFor(async () => expect((await w.store.read(w.key)).delivery_receipts?.at(-1)?.state).toBe("complete"));
  const objects = new ContentObjectStore(w.f.scope.projectPath);
  const entry = objects.index().artifacts[0]!;
  expect(entry.versions).toHaveLength(2);
  expect(entry.current_sha256).toBe(w.reviewedHash);
  expect(objects.readVersion(w.key, "prd.md", w.seedHash!).content).toContain("旧正式版");
  const control = JSON.parse(await readFile(join(w.f.scope.projectPath, ".任务", w.taskKey, "run-control.yml"), "utf8"));
  expect(control.spec.state).toBe("completed");
  const notice = w.endings.find(e => e.id === w.judge);
  await Promise.all([1, 2, 3].map(() => w.ctx.parallel("subagent/end", notice)));
  expect(commits).toBe(1);
  expect((await w.store.read(w.key)).delivery_receipts!.filter(r => r.state === "complete")).toHaveLength(1);
  const later = objects.saveHumanEdit({ work_key: w.key, filename: "prd.md", base_sha256: entry.current_sha256, author: "fixture", content: "# PRD\n后续人工版本\n" });
  await w.ctx.parallel("subagent/end", notice);
  await w.store.refreshDelivery(w.key);
  expect(objects.index().artifacts[0]!.current_sha256).toBe(later.current_sha256);
  expect(objects.index().artifacts[0]!.versions).toHaveLength(3);
  expect(commits).toBe(1);
  expect((await w.store.read(w.key)).delivery_receipts?.at(-1)?.state).toBe("saved_partial");
  const previousReceipt = (await w.store.read(w.key)).delivery_receipts!.at(-1)!.id;
  const another = objects.saveHumanEdit({ work_key: w.key, filename: "prd.md", base_sha256: later.current_sha256, author: "fixture", content: "# PRD\n再次人工修改\n" });
  await w.store.refreshDelivery(w.key);
  expect((await w.store.read(w.key)).deliverables.find(d => d.filename === "prd.md")?.current_sha256).toBe(another.current_sha256);
  expect((await w.store.read(w.key)).delivery_receipts!.at(-1)!.id).not.toBe(previousReceipt);
  expect(parentVisibleText(w)).not.toContain("报告已更新完成");
});

it.each(["用户纠正", "被审快照变化"] as const)("SR01 原生Judge结束通知不得消费未结算的%s", async (cause) => {
  const w = await acceptedDelivery(true);
  if (cause === "用户纠正") {
    const response = await w.f.request("work/card/update", { action: "message", work_key: w.key, text: "新增必须比较价格的要求", paths: [] });
    expect(response.status).toBe(200);
  } else {
    await writeFile(join(w.f.scope.projectPath, ".任务", w.taskKey, "产物快照/prd.md"), "# PRD\n已变化的被审草稿\n");
  }
  w.unparkParent(); w.releaseJudge(); await w.ended(w.judge); await w.parent.whenIdle();
  const after = (await w.store.round(w.key))!;
  expect(after.delivery).toBeUndefined();
  if (cause === "用户纠正") {
    expect((await w.store.read(w.key)).events?.some(e => e.text.includes("价格") && e.task_key === w.taskKey && e.state !== "applied")).toBe(true);
    expect(w.instructions.some(s => s.includes("promax_work_proposal"))).toBe(true);
  } else {
    expect(after.phase).toBe("generating");
    expect(w.instructions.some(s => s.includes("被审草稿在检查结果接收后变化"))).toBe(true);
  }
  expect(new ContentObjectStore(w.f.scope.projectPath).index().artifacts[0]!.current_sha256).toBe(w.seedHash);
  expect(new ContentObjectStore(w.f.scope.projectPath).readVersion(w.key, "prd.md", w.seedHash!).sha256).toBe(w.seedHash);
  expect(w.turns.filter(id => id === w.parent.id).length).toBeGreaterThan(0);
  // The native loop emits chunks before turn-stopping. Neither the session nor the
  // front-end conversation projection may publish an unverified completion claim.
  expect(parentVisibleText(w)).not.toContain("报告已更新完成");
  const view = await (await w.f.request("work/read", { work_key: w.key })).json();
  expect(JSON.stringify(view)).not.toContain("报告已更新完成");
  const front = mergeTimeline(workTimeline(w.parent.session.events.filter((e: any) => e.type === "assistant/message").map((e: any) => ({ kind: "assistant", seq: e.seq, blocks: e.data.message.content }))), deliveryTimeline(view.card.delivery_receipts));
  expect(JSON.stringify(front)).not.toContain("报告已更新完成");
  expect((await w.loadPersisted()).events.some((e: any) => e.type === "assistant/chunk" && JSON.stringify(e.data).includes("报告已更新完成"))).toBe(false);
  expect(view.card.last_progress).toMatch(/部分完成|生成中|旧检查不适用于当前版本/);
  expect(view.card.delivery_receipts?.filter((r: any) => r.task_key === w.taskKey && r.state === "complete") ?? []).toHaveLength(0);
});

it("SR01-A 未结算自动通知与真实解释问题混批：自动完成不可见、真实回答仍公开", async () => {
  const w = await acceptedDelivery(true);
  await writeFile(join(w.f.scope.projectPath, ".任务", w.taskKey, "产物快照/prd.md"), "# PRD\n复查前草稿变化\n");
  const employeeText = "解释混批的草稿差异，不修改成果";
  const recorded = await w.f.request("work/card/update", { action: "message", work_key: w.key, text: employeeText, paths: [] });
  expect(recorded.status).toBe(200);
  const user = createUserMessage({ content: [{ type: "text", text: employeeText }], source: { kind: "user" } });
  w.setParentText((options: any) => options.messages.some((m: any) => m.id === user.id) ? "正常回答：草稿尚未复查，旧正式版未替换。" : "报告已更新完成");
  w.parent.inject(user); // next-step plus Judge's next-turn notice: native Inbox.claim joins them.
  w.unparkParent(); w.releaseJudge(); await w.ended(w.judge); await w.parent.whenIdle();
  const events = w.parent.session.events;
  expect(events.filter((e: any) => e.type === "user/message" && e.data.id === user.id)).toHaveLength(1);
  expect(w.turns.filter(id => id === w.parent.id).length).toBeGreaterThanOrEqual(2);
  expect(parentVisibleText(w)).toContain("正常回答：草稿尚未复查");
  expect(JSON.stringify(events.filter((e: any) => e.type === "assistant/chunk"))).not.toContain("报告已更新完成");
  const view = await (await w.f.request("work/read", { work_key: w.key })).json();
  const front = mergeTimeline(workTimeline(events.filter((e: any) => e.type === "assistant/message" || e.type === "user/message").map((e: any) => ({ kind: e.type === "assistant/message" ? "assistant" : "user", seq: e.seq, source: e.data.source, blocks: e.data.message?.content ?? e.data.content }))), deliveryTimeline(view.card.delivery_receipts));
  expect(JSON.stringify(front)).toContain("正常回答：草稿尚未复查");
  expect(JSON.stringify(front)).not.toContain("报告已更新完成");
  expect((await w.store.round(w.key))?.delivery).toBeUndefined();
  expect((await w.store.read(w.key)).events?.some(e => e.text === employeeText)).toBe(true);
  w.parent.followup(createUserMessage({ content: [{ type: "text", text: "解释混批的草稿差异，不修改成果" }], source: { kind: "user" } }));
  await w.parent.whenIdle();
  expect(parentVisibleText(w).match(/正常回答：草稿尚未复查/gu)?.length).toBeGreaterThanOrEqual(2);
});

it("SR01-B 守卫激活时原生主循环错误完成受控，真实compaction摘要同会话保留", async () => {
  const w = await acceptedDelivery(true);
  await writeFile(join(w.f.scope.projectPath, ".任务", w.taskKey, "产物快照/prd.md"), "# PRD\n复查前草稿变化\n");
  let marked: boolean | undefined;
  let bundleMarked: boolean | undefined;
  let summary: any;
  w.setPrimaryToolOnce();
  w.onPrimary(async options => {
    if (summary) return;
    marked = nativeLoopRequest(options);
    bundleMarked = bundleLoopRequest(options);
    summary = await summarizeWithLlm(w.ctx, { summarizationProvider: "", summarizationModel: "", maxTokens: 128 }, { messages: options.messages }, w.parent, options.signal);
  });
  w.unparkParent(); w.releaseJudge(); await w.ended(w.judge); await w.parent.whenIdle();
  expect(marked).toBe(true); // A real native loop request, not an invented marker.
  expect(bundleMarked).toBe(false); // The bundle's dependency resolves a separate marker WeakSet here.
  expect(summary?.summary.some((b: any) => b.type === "text" && b.text.includes("真实摘要内容保留"))).toBe(true);
  expect(summary?.usage).toEqual({ inputTokens: 17, outputTokens: 13 });
  expect(summary?.llmStreamCall).toBe(true);
  const primary = w.parent.session.events.filter((e: any) => e.type === "assistant/message");
  expect(primary.some((e: any) => e.data.message.content.some((b: any) => b.type === "tool-call" && b.name === "promax_work_proposal"))).toBe(true);
  expect(primary.find((e: any) => e.data.usage)?.data.usage).toMatchObject({ inputTokens: 11, outputTokens: 7 });
  expect(w.parent.session.events.some((e: any) => e.type === "tool/result")).toBe(true);
  expect(parentVisibleText(w)).not.toContain("报告已更新完成");
  expect(JSON.stringify(w.parent.session.events.filter((e: any) => e.type === "assistant/chunk"))).not.toContain("报告已更新完成");
});

it("SR01-C 无守卫且不传signal的普通LLM流保留文本", async () => {
  const w = await setup();
  w.setParentText(() => "普通无signal调用应保留的文本");
  const assembler = new BlockAssembler();
  for await (const chunk of w.ctx.llm.stream({ provider: "stub", model: "stub", sessionId: w.parent.id, messages: [] })) assembler.push(chunk);
  expect(assembler.blocks()).toEqual([{ type: "text", text: "普通无signal调用应保留的文本" }]);
  expect(assembler.finish).toEqual({ kind: "stop" });
});

it("SR01-B 自动请求取消时仍按原生信号结束，后续独立用户轮次不继承守卫", async () => {
  const w = await acceptedDelivery(true);
  await writeFile(join(w.f.scope.projectPath, ".任务", w.taskKey, "产物快照/prd.md"), "# PRD\n复查前草稿变化\n");
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const blocked = new Promise<void>(resolve => { release = resolve; });
  w.onCleanup(async () => { release(); });
  w.onPrimary(async () => { entered(); await blocked; });
  w.unparkParent(); w.releaseJudge(); await started;
  w.parent.cancel({ kind: "user" }); release();
  await w.ended(w.judge); await w.parent.whenIdle();
  expect(w.parent.session.events.some((e: any) => e.type === "turn/end" && e.data.reason?.kind === "aborted")).toBe(true);
  expect(parentVisibleText(w)).not.toContain("报告已更新完成");
  const user = createUserMessage({ content: [{ type: "text", text: "独立追问：解释目前的变化" }], source: { kind: "user" } });
  w.setParentText((options: any) => options.messages.some((m: any) => m.id === user.id) ? "正常回答：尚待复查。" : "报告已更新完成");
  w.parent.followup(user); await w.parent.whenIdle();
  expect(parentVisibleText(w)).toContain("正常回答：尚待复查。");
  expect(new ContentObjectStore(w.f.scope.projectPath).index().artifacts[0]!.current_sha256).toBe(w.seedHash);
});

it("T07 版本已保存但当前入口刷新失败，报告已保存而非提交失败，不重复版本", async () => {
  const w = await acceptedDelivery(true), original = ContentObjectStore.prototype.commit;
  let commits = 0;
  vi.spyOn(ContentObjectStore.prototype, "commit").mockImplementation(function(this: ContentObjectStore, ...args) {
    const result = original.apply(this, args);
    if (args[0] === w.taskKey) { commits++; throw new Error("隔离注入：响应丢失"); }
    return result;
  });
  // Fail only reads of the published current entry; the immutable object/version remains real and readable.
  w.releaseJudge(); await w.ended(w.judge); await w.parent.whenIdle();
  await vi.waitFor(async () => expect((await w.store.read(w.key)).delivery_receipts?.at(-1)?.state).toBe("complete"));
  const path = join(w.f.scope.projectPath, "产物", w.key, "prd.md");
  await rename(path, `${path}.fixture-preserved`);
  await w.store.refreshDelivery(w.key);
  const receipt = (await w.store.read(w.key)).delivery_receipts!.at(-1)!;
  expect(receipt.state).toBe("saved_partial");
  expect(receipt.text).toContain("正式版本已保存，当前入口待修复");
  expect((await w.store.round(w.key))!.last_check!.delivery_saved).toBe(true);
  const target = receipt.targets.find(t => t.kind === "formal")!;
  expect((await w.store.inspectFile(w.key, { kind: "delivery-version", id: receipt.id, filename: target.filename, sha256: target.sha256 })).sha256).toBe(w.reviewedHash);
  await w.ctx.parallel("subagent/end", w.endings.find(e => e.id === w.judge));
  expect(commits).toBe(1);
  expect(new ContentObjectStore(w.f.scope.projectPath).index().artifacts[0]!.versions).toHaveLength(2);
  await rename(`${path}.fixture-preserved`, path);
  await w.store.refreshDelivery(w.key);
  const recovered = await w.store.read(w.key);
  expect(recovered.delivery_receipts!.at(-1)).toMatchObject({ state: "complete", correction: false, projection_id: recovered.delivery_receipts!.find(r => r.state === "complete")!.id });
  expect(recovered.deliverables.find(d => d.filename === "prd.md")).toMatchObject({ current_sha256: w.reviewedHash, status: "正式交付完成" });
  expect(recovered.last_progress).toContain("正式交付已完成");
  expect(deliveryTimeline(recovered.delivery_receipts).at(-1)).toMatchObject({ kind: "delivery", receipt: { state: "complete", id: recovered.delivery_receipts!.at(-1)!.id } });
  const visible = mergeTimeline([], deliveryTimeline(recovered.delivery_receipts));
  expect(visible.at(-1)).toMatchObject({ kind: "delivery", receipt: { state: "complete", id: recovered.delivery_receipts!.at(-1)!.id } });
  expect(Date.parse(recovered.delivery_receipts!.at(-1)!.at)).toBeGreaterThan(Date.parse(receipt.at));
  expect(coordinatorContext(recovered, (await w.store.round(w.key))!, deriveAgentStatus(recovered, (await w.store.round(w.key))!, emptyStatus()), new ContentObjectStore(w.f.scope.projectPath).index().artifacts)).toContain('state: complete');
  const count = recovered.delivery_receipts!.length;
  await w.store.refreshDelivery(w.key);
  await new WorkStore(w.f.scope.projectPath).refreshDelivery(w.key);
  expect((await w.store.read(w.key)).delivery_receipts).toHaveLength(count);
  expect(new ContentObjectStore(w.f.scope.projectPath).index().artifacts[0]!.versions).toHaveLength(2);
});

it("T05/T07 未知提交锁保留，草稿和旧版入口可读，不自动重造版本", async () => {
  const w = await acceptedDelivery(true);
  const lock = join(w.f.scope.projectPath, "产物/.commit-lock");
  await mkdir(lock);
  // 阶段四B：结算后的说明回合是公开受控说明，错误替身只在结算前输出错误完成话术（原断言不变）。
  explainSettledDelivery(w);
  w.unparkParent(); w.releaseJudge(); await w.ended(w.judge); await w.parent.whenIdle();
  await vi.waitFor(async () => expect((await w.store.read(w.key)).delivery_receipts?.at(-1)?.state).toBe("unknown"));
  const first = (await w.store.read(w.key)).delivery_receipts!.at(-1)!;
  expect(first.targets.map(t => t.kind)).toEqual(["previous", "draft"]);
  for (const target of first.targets) {
    const result = await w.f.request("work/inspect", { work_key: w.key, kind: "delivery-version", id: first.id, filename: target.filename, sha256: target.sha256 });
    expect(result.status).toBe(200); expect((await result.json()).sha256).toBe(target.sha256);
  }
  const objects = new ContentObjectStore(w.f.scope.projectPath);
  const before = objects.index();
  await w.ctx.parallel("subagent/end", w.endings.find(e => e.id === w.judge));
  await w.f.request("work/read", { work_key: w.key });
  expect(objects.index()).toEqual(before);
  await expect(mkdir(lock)).rejects.toMatchObject({ code: "EEXIST" });
  expect((await w.store.read(w.key)).delivery_receipts!.filter(r => r.state === "unknown")).toHaveLength(1);
  expect(parentVisibleText(w)).not.toContain("报告已更新完成");
});

it("T06 晚到失败否定同任务同版本，只追加一次更正，历史和诊断保留", async () => {
  const w = await acceptedDelivery(true);
  const index = join(w.f.scope.projectPath, "产物/.index.yml"), baseline = await readFile(index);
  // 阶段四B：结算后的说明回合是公开受控说明，错误替身只在结算前输出错误完成话术（原断言不变）。
  explainSettledDelivery(w);
  w.unparkParent(); w.releaseJudge(); await w.ended(w.judge); await w.parent.whenIdle();
  await vi.waitFor(async () => expect((await w.store.read(w.key)).delivery_receipts?.at(-1)?.state).toBe("complete"));
  const original = (await w.store.read(w.key)).delivery_receipts!.at(-1)!;
  // Isolated fault injection only: later storage verification disproves the new durable version.
  await writeFile(`${index}.fixture`, baseline); await rename(`${index}.fixture`, index);
  const round = (await w.store.round(w.key))!;
  round.delivery!.failure = "failed"; round.delivery!.error = "隔离后置核验：正式提交未成立";
  await w.store.writeRound(w.key, round);
  await Promise.all([1, 2, 3].map(() => w.f.request("work/read", { work_key: w.key })));
  const card = await w.store.read(w.key);
  expect(card.delivery_receipts!.find(r => r.id === original.id)).toEqual(original);
  const corrections = card.delivery_receipts!.filter(r => r.correction);
  expect(corrections).toHaveLength(1);
  expect(corrections[0]).toMatchObject({ task_key: w.taskKey, reviewed_hashes: { "prd.md": w.reviewedHash }, state: "failed" });
  expect(corrections[0]!.text).toContain("此前完成说明不准确");
  expect(corrections[0]!.text).toContain("正式提交未成立");
  expect(w.parent.session.events.filter((e: any) => e.type === "user/message" && e.data.source?.plugin === "promax-delivery" && e.data.content[0].text.includes('"correction":true'))).toHaveLength(1);
  expect((await w.store.round(w.key))!.last_check!.delivery_saved).toBe(false);
  expect(parentVisibleText(w)).not.toContain("报告已更新完成");
});

it.each(["同批", "等待期间入队"] as const)("T08 原生%s结束通知与新用户输入只消费自动通知，不丢真实输入", async (timing) => {
  const w = await acceptedDelivery();
  w.releaseJudge(); await w.ended(w.judge); await w.parent.whenIdle();
  await vi.waitFor(async () => expect((await w.store.read(w.key)).delivery_receipts?.at(-1)?.state).toBe("complete"));
  w.unparkParent();
  const notice = createUserMessage({ content: [{ type: "text", text: "重复结束通知" }], source: { kind: "subagent-settled", form: "notice", summary: "结束", senderSessionId: w.judge } });
  const user = createUserMessage({ content: [{ type: "text", text: "解释本次变化，不修改成果" }], source: { kind: "user" } });
  if (timing === "同批") { w.parent.inject(user); w.parent.followup(notice); }
  else { w.parent.followup(notice); w.parent.followup(user); }
  await w.parent.whenIdle();
  const messages = w.parent.session.events.filter((e: any) => e.type === "user/message").map((e: any) => e.data);
  expect(messages.some((m: any) => m.id === user.id), JSON.stringify({ messages, turns: w.turns, tail: w.parent.session.events.slice(-8) })).toBe(true);
  expect(messages.some((m: any) => m.id === notice.id)).toBe(false);
  expect(w.turns.filter(id => id === w.parent.session.header.id)).toHaveLength(1);
});

const deliveryNotice = (judge: string) => createUserMessage({ content: [{ type: "text", text: "结束通知" }], source: { kind: "subagent-settled", form: "notice", summary: "结束", senderSessionId: judge } });

it("SE01 提示词与讨论拒绝文案不再预告开始，提案被拒程序状态仍是讨论", async () => {
  expect(WORK_SYSTEM_PROMPT).not.toContain("几秒后自动开始");
  expect(WORK_SYSTEM_PROMPT).not.toContain("倒计时并自动开始");
  expect(WORK_SYSTEM_PROMPT).toContain("交付说明");
  const w = await acceptedDelivery();
  w.releaseJudge(); await w.ended(w.judge); await w.parent.whenIdle();
  await vi.waitFor(async () => expect((await w.store.read(w.key)).delivery_receipts?.at(-1)?.state).toBe("complete"));
  await w.store.employeeMessage(w.key, "结束后追问：不修改成果", []);
  const round = (await w.store.round(w.key))!;
  expect(round.source).toBe("proposal");
  const denied = await w.execute("solution_design", { description: "讨论阶段越权派工", prompt: "不应派发" });
  expect(denied.isError).toBe(true);
  const text = denied.content.map((b: any) => b.text ?? "").join("\n");
  expect(text).toContain("intent=execute");
  expect(text).toContain("不要对员工说被拒绝");
  expect(text).not.toContain("自动开始");
  expect(text).not.toContain("倒计时");
  const status = deriveAgentStatus(await w.store.read(w.key), round, emptyStatus());
  expect(status.control).not.toBe("running");
  expect(status.steps.every((s: any) => s.control !== "running" && s.business !== "generate")).toBe(true);
});

it("SE02 complete回执后恰有一次交付说明回合，公开文本可见且在回执之后", async () => {
  const w = await acceptedDelivery();
  explainSettledDelivery(w);
  w.unparkParent(); w.releaseJudge(); await w.ended(w.judge); await w.parent.whenIdle();
  await vi.waitFor(async () => expect((await w.store.read(w.key)).delivery_receipts?.at(-1)?.state).toBe("complete"));
  const events = w.parent.session.events;
  await vi.waitFor(() => expect(events.some((e: any) => e.type === "user/message" && e.data.source?.plugin === "promax-delivery" && e.data.content.some((b: any) => b.type === "text" && b.text.includes('"state":"complete"')))).toBe(true));
  const receipt = events.find((e: any) => e.type === "user/message" && e.data.source?.plugin === "promax-delivery" && e.data.content.some((b: any) => b.type === "text" && b.text.includes('"state":"complete"')));
  const explanation = events.findLast((e: any) => e.type === "assistant/message" && e.data.message.content.some((b: any) => b.type === "text" && b.text.includes("交付说明：以程序回执为准")));
  expect(receipt, "程序回执必须先发布").toBeTruthy();
  expect(explanation, "complete 回执后应恰有一次公开说明回合").toBeTruthy();
  expect(explanation!.seq).toBeGreaterThan(receipt!.seq);
  expect(w.turns.filter(id => id === w.parent.id)).toHaveLength(1);
  const card = await w.store.read(w.key);
  expect(card.explained_receipts).toContain(card.delivery_receipts!.at(-1)!.id);
  w.parent.followup(deliveryNotice(w.judge)); await w.parent.whenIdle();
  expect(w.turns.filter(id => id === w.parent.id)).toHaveLength(1);
  expect(parentVisibleText(w).match(/交付说明：以程序回执为准/gu) ?? []).toHaveLength(1);
});

it.each(["saved_partial", "failed", "unknown"] as const)("SE03 %s：说明输入带实际状态与缺口，回执不被改写", async (state) => {
  const w = await acceptedDelivery(true);
  let seen = "";
  w.onPrimary(async (options: any) => { seen = primaryModelText(options); });
  w.setParentText((options: any) => primaryModelText(options).includes(`"state":"${state}"`) && primaryModelText(options).includes("程序交付回执")
    ? `交付说明（${state}）：草稿与旧版可看，缺口和限制以回执为准。`
    : "报告已更新完成");
  if (state === "saved_partial") {
    w.releaseJudge(); await w.ended(w.judge); await w.parent.whenIdle();
    await vi.waitFor(async () => expect((await w.store.read(w.key)).delivery_receipts?.at(-1)?.state).toBe("complete"));
    const path = join(w.f.scope.projectPath, "产物", w.key, "prd.md");
    await rename(path, `${path}.fixture-preserved`);
    await w.store.refreshDelivery(w.key);
    await vi.waitFor(async () => expect((await w.store.read(w.key)).delivery_receipts?.at(-1)?.state).toBe("saved_partial"));
    w.unparkParent();
    w.parent.followup(deliveryNotice(w.judge)); await w.parent.whenIdle();
  } else {
    if (state === "failed") {
      const commit = ContentObjectStore.prototype.commit;
      vi.spyOn(ContentObjectStore.prototype, "commit").mockImplementation(function (this: ContentObjectStore, ...args: any[]) {
        if (args[0] === w.taskKey) throw new Error("隔离注入：正式提交失败");
        return commit.apply(this, args as never);
      });
    }
    if (state === "unknown") await mkdir(join(w.f.scope.projectPath, "产物/.commit-lock"));
    w.unparkParent(); w.releaseJudge(); await w.ended(w.judge); await w.parent.whenIdle();
    await vi.waitFor(async () => expect((await w.store.read(w.key)).delivery_receipts?.at(-1)?.state).toBe(state));
  }
  const before = (await w.store.read(w.key)).delivery_receipts!.at(-1)!;
  expect(before.state).toBe(state);
  expect(before.gaps?.length ?? 0).toBeGreaterThan(0);
  expect(seen).toContain(`state: ${state}`);
  expect(seen).toContain("delivery_explanation");
  expect(seen).toContain(before.gaps![0]!);
  expect(parentVisibleText(w)).toContain(`交付说明（${state}）`);
  const after = (await w.store.read(w.key)).delivery_receipts!.at(-1)!;
  expect(after.text).toBe(before.text);
  expect(after.state).toBe(state);
  expect(JSON.stringify(after.targets)).toBe(JSON.stringify(before.targets));
  expect(after.reviewed_hashes).toEqual(before.reviewed_hashes);
  expect((await w.store.read(w.key)).explained_receipts).toContain(before.projection_id ?? before.id);
});

it("SE04 说明回合只读：派工/提案/回执/检查/写改与统计计算被拒，只读可用", async () => {
  const w = await acceptedDelivery();
  w.ctx.tools.register({ name: "read", description: "隔离只读工具", parameters: { type: "object", additionalProperties: false, properties: { path: { type: "string" } } }, output: { schema: { type: "object", additionalProperties: true }, render: (_args: unknown, value: unknown) => [{ type: "text", text: JSON.stringify(value) }] }, async execute(raw: unknown) { return { read_only: String((raw as { path?: string })?.path ?? "") }; } } as never);
  const results = new Map<string, any>();
  let readResult: any;
  w.onPrimary(async () => {
    results.set("solution_design", await w.execute("solution_design", { description: "说明回合派工", prompt: "不应派发" }));
    results.set("promax_work_proposal", await w.execute("promax_work_proposal", { intent: "execute", card_patch: {}, deliverables: [], edit_request: null, handled_events: [] }));
    results.set("promax_member_receipt", await w.execute("promax_member_receipt", { filename: "prd.md", status: "draft_ready", summary: "不应提交", unverified: [], gaps: [], input_version: 1 }));
    results.set("promax_check_result", await w.execute("promax_check_result", { verdict: "PASS", review_request: "x", input_version: 1, issues: [], decisions: [], unverified: [], acceptance: { baseline_version: "x", items: [] } }));
    results.set("write", await w.execute("write", { path: "说明回合越权.txt", content: "不应写入" }));
    results.set("promax_rating_facts", await w.execute("promax_rating_facts", { source_id: "SRC-001" }));
    readResult = await w.execute("read", { path: "只读测试.md" });
  });
  explainSettledDelivery(w);
  w.unparkParent(); w.releaseJudge(); await w.ended(w.judge); await w.parent.whenIdle();
  await vi.waitFor(() => expect(results.size).toBe(6));
  for (const name of ["solution_design", "promax_work_proposal", "promax_member_receipt", "promax_check_result", "write", "promax_rating_facts"]) {
    expect(results.get(name)!.isError, `${name}: ${JSON.stringify(results.get(name))}`).toBe(true);
    expect(JSON.stringify(results.get(name)!.content), name).toContain("说明回合");
  }
  expect(readResult!.isError, JSON.stringify(readResult)).toBe(false);
  expect(JSON.stringify(readResult!.value ?? readResult!.content)).toContain("只读测试.md");
});

it("SE06 重复通知/重复结束/冷读不重复说明；correction 触发一次更正说明且历史保留", async () => {
  const w = await acceptedDelivery(true);
  w.setParentText((options: any) => {
    const text = primaryModelText(options);
    return text.includes('"correction":true') ? "更正说明：此前完成结论不成立，按当前回执重新核对。"
      : text.includes('"state":"complete"') ? "首版说明：已保存并通过检查。"
        : "报告已更新完成";
  });
  const index = join(w.f.scope.projectPath, "产物/.index.yml"), baseline = await readFile(index);
  w.unparkParent(); w.releaseJudge(); await w.ended(w.judge); await w.parent.whenIdle();
  await vi.waitFor(async () => expect((await w.store.read(w.key)).delivery_receipts?.at(-1)?.state).toBe("complete"));
  const parentTurns = () => w.turns.filter(id => id === w.parent.id).length;
  expect(parentTurns()).toBe(1);
  const notice = w.endings.find(e => e.id === w.judge);
  await Promise.all([1, 2, 3].map(() => w.ctx.parallel("subagent/end", notice)));
  w.parent.followup(deliveryNotice(w.judge)); await w.parent.whenIdle();
  expect(parentTurns()).toBe(1);
  const cold = new WorkStore(w.f.scope.projectPath);
  const firstReceipt = (await cold.read(w.key)).delivery_receipts!.at(-1)!;
  expect((await cold.read(w.key)).explained_receipts).toContain(firstReceipt.id);
  await writeFile(`${index}.fixture`, baseline); await rename(`${index}.fixture`, index);
  const round = (await cold.round(w.key))!;
  round.delivery!.failure = "failed"; round.delivery!.error = "隔离后置核验：正式提交未成立";
  await cold.writeRound(w.key, round);
  await Promise.all([1, 2, 3].map(() => w.f.request("work/read", { work_key: w.key })));
  await w.parent.whenIdle();
  const card = await cold.read(w.key);
  const corrections = card.delivery_receipts!.filter(r => r.correction);
  expect(corrections).toHaveLength(1);
  expect(card.explained_receipts).toContain(corrections[0]!.id);
  expect(card.delivery_receipts!.find(r => r.id === firstReceipt.id)).toBeTruthy();
  expect(parentVisibleText(w)).toContain("首版说明");
  expect(parentVisibleText(w)).toContain("更正说明");
  expect(parentTurns()).toBe(2);
  await w.f.request("work/read", { work_key: w.key });
  w.parent.followup(deliveryNotice(w.judge)); await w.parent.whenIdle();
  expect(parentTurns()).toBe(2);
  expect(parentVisibleText(w).match(/更正说明/gu) ?? []).toHaveLength(1);
});

it("SE07 说明回合失败只保留回执不重试；混批员工问题公开回答且说明不吞输入", async () => {
  const failed = await acceptedDelivery();
  let attempts = 0;
  failed.onPrimary(async () => { attempts++; throw new Error("隔离注入：说明回合模型失败"); });
  failed.unparkParent(); failed.releaseJudge(); await failed.ended(failed.judge); await failed.parent.whenIdle();
  await vi.waitFor(async () => expect((await failed.store.read(failed.key)).delivery_receipts?.at(-1)?.state).toBe("complete"));
  const failedReceipt = (await failed.store.read(failed.key)).delivery_receipts!.at(-1)!;
  expect(parentVisibleText(failed)).toBe("");
  expect((await failed.store.read(failed.key)).explained_receipts).toContain(failedReceipt.id);
  failed.parent.followup(deliveryNotice(failed.judge)); await failed.parent.whenIdle();
  expect(attempts).toBe(1);
  expect((await failed.store.read(failed.key)).delivery_receipts!.at(-1)!.state).toBe("complete");
  const w = await acceptedDelivery();
  const question = "解释当前交付状态，不要修改成果";
  const user = createUserMessage({ content: [{ type: "text", text: question }], source: { kind: "user" } });
  w.setParentText((options: any) => options.messages.some((m: any) => m.id === user.id) ? "正常回答：首版已交付，未修改任何成果。" : "报告已更新完成");
  w.parent.inject(user);
  w.unparkParent(); w.releaseJudge(); await w.ended(w.judge); await w.parent.whenIdle();
  const events = w.parent.session.events;
  expect(events.filter((e: any) => e.type === "user/message" && e.data.id === user.id)).toHaveLength(1);
  expect(w.turns.filter(id => id === w.parent.id)).toHaveLength(1);
  expect(parentVisibleText(w)).toContain("正常回答");
  expect(JSON.stringify(events.filter((e: any) => e.type === "assistant/chunk"))).not.toContain("报告已更新完成");
  const card = await w.store.read(w.key);
  expect(card.explained_receipts).toContain(card.delivery_receipts!.at(-1)!.id);
  expect(card.delivery_receipts!.at(-1)!.state).toBe("complete");
});
