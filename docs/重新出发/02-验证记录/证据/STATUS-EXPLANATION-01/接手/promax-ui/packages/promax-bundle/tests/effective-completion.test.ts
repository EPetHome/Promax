import { afterEach, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import YAML from "yaml";
import { workMetrics } from "../src/chain-metrics.ts";
import { ContentObjectStore } from "@promax/promax-report";
import { createHash } from "node:crypto";
import { WorkStore, type WorkRound } from "../src/work-store.ts";
import { stageStructuredSubmission, commitStructuredSubmission } from "../src/structured-results.ts";
import { policyFromRevision } from "../src/acceptance-baseline.ts";
import { effectiveRequirements, taskCompletion } from "../../promax-ui-console/src/effective-protocol.ts";
import { verifiedEmployeeStatements, requirementsDigest } from "../../promax-ui-console/src/work-protocol.ts";
import { deriveAgentStatus, emptyStatus } from "../../promax-ui-console/src/work-control.ts";
import { enforceDispatchPlanTool, memberToolDenial, memberWorkContext, coordinatorContext, BUNDLE_LOAD_IDENTITY } from "../src/index.ts";
import { uploadedJudgeReport } from "../src/report-adapter.ts";
import { parseJudgeReport } from "../src/judge-report.ts";
import { sealFixturePreset, workRouteFixture } from "../../promax-ui-console/tests/work-route-fixture.ts";
import { trunkProgress } from "../../promax-ui-console/src/client/ProgressTrunk.tsx";
import { TraceUploader, type TraceAccess } from "@promax/promax-report";

const roots: string[] = [];
let route: Awaited<ReturnType<typeof workRouteFixture>> | undefined;
afterEach(async () => { await route?.close(); route = undefined; for (const r of roots.splice(0)) await rm(r, { recursive: true, force: true }); });
const hash = (v: string) => createHash("sha256").update(v).digest("hex");
const filename = "product_discovery.md";
const revision = { api_version: "promax.ai/v1alpha2", kind: "TeamRevision", metadata: { team_revision_id: "fixture@r4", status: "published" }, spec: {
  members: [{ member_id: "product_discovery", display_name: "竞品分析师" }, { member_id: "quality_judge", display_name: "检查" }],
  artifacts: [{ kind: "other", validation_kind: "product-discovery-report", relative_path: `.任务/{task_key}/产物快照/${filename}`, produced_by: "product_discovery" }, { kind: "judge-report", validation_kind: "judge-report", relative_path: ".任务/{task_key}/判定-r{round}.md", produced_by: "quality_judge" }],
  domain_rubrics: { "product-discovery-report": { rules: [{ rule_id: "FACTS", check: "主要判断依据符合用途、时点、产品口径" }] } },
} };
const contract = { artifacts: [{ relativePath: filename, producedBy: "product_discovery" }] };
const judgeResult = (r: WorkRound) => ({ verdict: "PASS", review_request: r.review_request, input_version: r.execution_version, issues: [], decisions: [], unverified: [], acceptance: { baseline_version: r.acceptance_baseline!.version, items: r.acceptance_scope!.map((id) => ({ id, state: "met", evidence: "本地可靠材料 fixture 第 1 行与本版报告第 2 行一致；测试控制的判断，不是模型验证" })) } });
async function fixture(local = false, demand = "根据本地可靠材料比较产品的功能，用于当前选型") {
  const root = await realpath(await mkdtemp(join(tmpdir(), "promax-effective-"))); roots.push(root);
  const store = new WorkStore(root);
  const card = await store.create({ session_id: "main", project_id: "p", title: "比较", shortname: "compare" });
  const key = card.work_key;
  await store.employeeMessage(key, demand, []);
  await store.propose(key, { intent: "execute", card_patch: {}, deliverables: [filename], edit_request: null }, 2, contract);
  let r = (await store.round(key))!;
  if (local) { r.check_only = true; r.check_scope = "只检查当前交付可读性"; r.turn.review_requirement_ids = ["R4"]; await store.writeRound(key, r); }
  await store.authorize(key, r.revision, "click", async () => {
    await mkdir(join(root, ".任务/t/产物快照"), { recursive: true });
    await writeFile(join(root, "reliable-material.md"), "本地已核实材料：产品 A 当前提供导出，产品 B 未核实。\n");
    await writeFile(join(root, ".任务/t/产物快照", filename), "# 比较\n产品 A 当前提供导出（用户材料第1行）；产品 B 未知，不能推断不支持。\n");
    return "t";
  }, { protocol: 2, requirement_policy: policyFromRevision(revision, [filename]) });
  r = (await store.round(key))!;
  const h = hash(await readFile(join(root, ".任务/t/产物快照", filename), "utf8"));
  await store.transitionRound(key, r, { ...r, phase: "checking", judge_round: 1, reviewed_hashes: { [filename]: h }, requirements_digest: r.execution_digest!, children: { judge: "quality_judge" } });
  await store.bindJudge(key, "judge");
  r = (await store.round(key))!;
  let n = 0;
  const deps = { member: async () => "quality_judge", contract: async () => contract, runtimeVersion: "fixture" };
  const submit = async (raw: unknown, commit = false) => {
    const exec = { callId: `c${++n}`, agent: { session: { header: { id: "judge", origin: "subagent", parentSession: "main", cwd: root } } } };
    const result = await stageStructuredSubmission("promax_check_result", raw, exec, deps);
    return commit ? commitStructuredSubmission(exec, { isError: false }, deps) : result;
  };
  return { root, store, key, round: r, h, submit };
}

it("T1 true quote plus false explanation never grants authority; plans cannot mutate capability/source bindings; explicit prohibitions remain original evidence", async () => {
  const demand = "请做国内个人网盘竞品调研";
  const f = await fixture(false, demand);
  const said = [{ quote: demand, text: "用户明确禁止联网，只允许模型记忆" }];
  expect(verifiedEmployeeStatements(said, [demand])).toMatchObject([{ text: demand, quote: demand, source: "message" }]);
  await f.store.noteAssistant(f.key, { intent: "answer", card_patch: { employee_said: said }, deliverables: [], edit_request: null }, contract, [demand]);
  const card = await f.store.read(f.key);
  expect(card.interpretations).toEqual(said);
  expect(effectiveRequirements(card).sources.map((s) => s.text)).toEqual([demand]);
  const before = JSON.stringify(f.round.effective_requirements);
  memberWorkContext(card, f.round, "product_discovery");
  expect(JSON.stringify(f.round.effective_requirements)).toBe(before);
  expect(f.round.effective_requirements!.policy.capabilities).toMatchObject({ browser: "disabled", public_web: "authorized_members_only" });
  expect(memberToolDenial("product_discovery", f.round, "web_search")).toBeUndefined();
  expect(memberToolDenial("quality_judge", f.round, "web_search")).toBeDefined();
  const forbidden = await fixture(false, "明确禁止联网，只要基于已有知识的概览，不作当前市场事实确认");
  memberWorkContext(await forbidden.store.read(forbidden.key), forbidden.round, "product_discovery");
  expect(forbidden.round.effective_requirements!.sources[0]!.text).toContain("明确禁止联网");
  await expect(f.store.validateProposal(f.key, { intent: "answer", card_patch: { employee_said: [{ text: "x", quote: "不存在的原话" }] }, deliverables: [], edit_request: null }, contract)).resolves.toEqual([expect.stringContaining("无法绑定")]);
});

it("T2/T3/T4/T5 real structured store: local evidence can pass, missing/duplicate/unknown/stale/contradictory acceptance cannot; optional limits do not block", async () => {
  const f = await fixture();
  const raw = judgeResult(f.round);
  expect(f.round.acceptance_baseline!.items.map((i) => i.id)).toContain("R2");
  const unmet = structuredClone(raw); unmet.acceptance.items.find((i) => i.id === "R2")!.state = "unverifiable";
  await expect(f.submit(unmet)).rejects.toThrow("PASS 与必需缺口矛盾：R2");
  await expect(f.submit({ ...raw, acceptance: { ...raw.acceptance, items: raw.acceptance.items.slice(1) } })).rejects.toThrow("缺少 scope");
  await expect(f.submit({ ...raw, acceptance: { ...raw.acceptance, items: [...raw.acceptance.items, raw.acceptance.items[0]] } })).rejects.toThrow("重复");
  await expect(f.submit({ ...raw, acceptance: { ...raw.acceptance, items: [...raw.acceptance.items, { id: "FAKE", state: "met", evidence: "fake" }] } })).rejects.toThrow("未知验收项");
  await expect(f.submit({ ...raw, acceptance: { ...raw.acceptance, baseline_version: "old" } })).rejects.toThrow("当前基准");
  await expect(f.submit({ ...raw, unverified: [{ item: "核心比较依据", reason: "只有需求来源", requirement_ids: ["R2"], impact: "non_blocking" }] })).rejects.toThrow("不可豁免");
  await expect(f.submit({ ...raw, surprise: true })).rejects.toThrow("未知字段");
  const legal = { ...raw, unverified: [{ item: "后续非必需浏览器体验", reason: "本任务不要求实测", requirement_ids: [], impact: "non_blocking" }] };
  await f.submit(legal, true);
  const round = (await new WorkStore(f.root).round(f.key))!;
  const result = round.check_results!["1"]!;
  expect(taskCompletion(await f.store.read(f.key), round.acceptance_baseline, result, { [filename]: f.h })).toMatchObject({ state: "complete" });
  const parsed = parseJudgeReport(await readFile(join(f.root, result.report), "utf8")).report!;
  expect(parsed.acceptance).toEqual(result.acceptance);
  const upload = uploadedJudgeReport(parsed);
  expect(upload).not.toHaveProperty("acceptance");
  expect(upload.unverified[0]).not.toHaveProperty("impact");
  expect(upload.unverified[0]!.reason).toContain("non_blocking");
  expect(Object.keys(upload).sort()).toEqual(["reviewer", "round", "verdict", "scope", "reviewed_artifacts", "issues", "rechecks", "unverified", "decisions"].sort());
  expect(taskCompletion(await f.store.read(f.key), round.acceptance_baseline, result, { [filename]: "changed" }).state).toBe("partial");
  await f.store.employeeMessage(f.key, "新的范围补充", []);
  await expect(f.submit(raw)).rejects.toThrow("要求/验收基准已变化");
});

it("T3 local scope PASS stays partial; evidence gap is explicit and old snapshots are immutable", async () => {
  const f = await fixture(true);
  expect(f.round.acceptance_scope).toEqual(["R4"]);
  await f.submit(judgeResult(f.round), true);
  const r = (await f.store.round(f.key))!;
  expect(taskCompletion(await f.store.read(f.key), r.acceptance_baseline, r.check_results!["1"], { [filename]: f.h })).toMatchObject({ state: "partial", gaps: expect.arrayContaining(["R1", "R2", "R3"]) });
  const g = await fixture();
  const result = judgeResult(g.round); result.verdict = "INCOMPLETE"; result.acceptance.items.find((i) => i.id === "R2")!.state = "unverifiable";
  await g.submit({ ...result, unverified: [{ item: "核心事实依据", reason: "仅有用户需求SRC；没有可支持市场判断的事实", requirement_ids: ["R2"], impact: "blocking" }] }, true);
  const gr = (await g.store.round(g.key))!;
  expect(taskCompletion(await g.store.read(g.key), gr.acceptance_baseline, gr.check_results!["1"], { [filename]: g.h }).state).toBe("partial");
  const history = await readFile(join(g.root, gr.check_results!["1"]!.report), "utf8");
  await g.store.writeRound(g.key, { ...gr, phase: "ended", last_check: { report: gr.check_results!["1"]!.report, judge_round: 1, reviewed_hashes: gr.reviewed_hashes!, verdict: "INCOMPLETE", acceptance_baseline: gr.acceptance_baseline!, acceptance: gr.check_results!["1"]!.acceptance! } });
  await g.store.addCheckPending(g.key, [{ id: "keep", question: "如何继续？", options: ["补材料", "保持现状"], source: "check" }]);
  let card = await g.store.read(g.key);
  card = await g.store.update(g.key, { answer: { id: "keep", text: "保持现状" } }, card.updated_at);
  expect((await g.store.round(g.key))!).toMatchObject({ source: "proposal", turn: { intent: "answer", deliverables: [] } });
  expect(await readFile(join(g.root, gr.check_results!["1"]!.report), "utf8")).toBe(history);
  expect(taskCompletion(card, gr.acceptance_baseline, gr.check_results!["1"], { [filename]: g.h }).state).toBe("partial");
});

it.each([["coordinator", true], ["judge-end", true], ["coordinator", false], ["judge-end", false]] as const)("T6 %s local=%s real registered closure and UI share judgement without server or model", async (entry, local) => {
  route = await workRouteFixture();
  const evidenceCase = entry === "judge-end" && !local;
  if (evidenceCase) {
    const injected: Array<{ html?: string }> = [];
    route.hooks.get("webserver/index-inject")!(injected);
    const encoded = injected.map(item => item.html ?? "").join("").match(/name="promax-bundle-runtime" content="([^"]+)"/u)![1]!;
    expect(JSON.parse(decodeURIComponent(encoded))).toEqual(BUNDLE_LOAD_IDENTITY);
    expect(BUNDLE_LOAD_IDENTITY.module_sha256).toMatch(/^[a-f0-9]{64}$/u);
  }
  const installedRevision = structuredClone(revision);
  if (evidenceCase) Object.assign(installedRevision.spec.domain_rubrics["product-discovery-report"].rules[0]!, { evidence_basis: ["source_link"] });
  await writeFile(join(process.env.DSH_HOME!, ".agent-presets/promax-team/team-revision.yml"), JSON.stringify(installedRevision));
  await writeFile(join(process.env.DSH_HOME!, ".agent-presets/promax-team-r10/team-revision.yml"), JSON.stringify({ ...installedRevision, metadata: { ...installedRevision.metadata, team_revision_id: "promax-product-team@r10" }, spec: { ...installedRevision.spec, preset_id: "promax-team-r10" } }));
  await sealFixturePreset(process.env.DSH_HOME!);
  const created = await route.request("work/card/update", { action: "create", sessionId: "session-one", title: "本地材料比较" });
  const { card } = await created.json() as { card: { work_key: string; session_id: string } };
  const store = new WorkStore(route.scope.projectPath), key = card.work_key;
  const msg = await store.employeeMessage(key, "根据可靠附件做比较，不需要浏览器实测", []);
  await store.propose(key, { intent: "execute", card_patch: {}, deliverables: [filename], edit_request: null, handled_events: [{ event_id: msg.event.id, intent: "new_task", impact: "normal", note: "比较附件" }] }, 1, contract);
  let r = (await store.round(key))!;
  const started = await route.request("work/card/update", { work_key: key, action: "start", source: "click", revision: r.revision });
  expect(started.status, await started.text()).toBe(200);
  r = (await store.round(key))!;
  const bytes = "# 比较\n本地 fixture 核实 A 支持，B 未知\n";
  await writeFile(join(route.scope.projectPath, ".任务", r.task_key!, "产物快照", filename), bytes);
  if (evidenceCase) {
    const input = join(route.scope.projectPath, ".任务", r.task_key!, "输入");
    await mkdir(join(input, "sources", "SRC-099"), { recursive: true });
    const material = "合成测试材料：A支持，B未知。";
    await writeFile(join(input, "sources/SRC-099/test.txt"), material);
    const manifest = YAML.parse(await readFile(join(input, "manifest.yml"), "utf8"));
    manifest.spec.sources.push({ source_id: "SRC-099", origin_kind: "user-provided", media_type: "text/plain", relative_path: `.任务/${r.task_key}/输入/sources/SRC-099/test.txt`, sha256: hash(material) });
    await writeFile(join(input, "test-manifest.staging"), YAML.stringify(manifest));
    await rename(join(input, "test-manifest.staging"), join(input, "manifest.yml"));
    const memberExec = { callId: "member-evidence", agent: { session: { header: { id: "researcher", origin: "subagent", parentSession: card.session_id, cwd: route.scope.projectPath }, events: [] } } };
    await store.writeRound(key, { ...r, children: { researcher: "product_discovery" } });
    const receipt = await route.submit("promax_member_receipt", { filename, status: "draft_ready", summary: "测试草稿", gaps: [], unverified: [], input_version: r.execution_version, evidence_links: [{ requirement_ids: ["R2", "D:FACTS"], conclusion: "本地 fixture 核实 A 支持，B 未知", location: "本地 fixture 核实 A 支持，B 未知", evidence: [{ source_id: "SRC-099", range: "第 1 行" }] }] }, memberExec);
    expect(receipt.isError).toBe(false);
    r = (await store.round(key))!;
  }
  await store.transitionRound(key, r, { ...r, phase: "checking", allowed_members: ["quality_judge"], judge_round: 1, requirements_digest: r.execution_digest!, reviewed_hashes: { [filename]: hash(bytes) }, children: { judge: "quality_judge" } });
  if (entry === "coordinator" && local) {
    const args = Object.freeze({ prompt: "用户决定仅允许模型记忆，不得访问任何网页" });
    const before = JSON.stringify((await store.round(key))!.effective_requirements);
    const admitted = await enforceDispatchPlanTool("", { name: "quality_judge", arguments: args, agent: { session: { header: { id: card.session_id, cwd: route.scope.projectPath }, events: [] } } }, async () => ({ kind: "allow" as const }));
    expect(admitted).toMatchObject({ kind: "allow" });
    expect(Object.isFrozen(args)).toBe(true);
    expect(JSON.stringify((await store.round(key))!.effective_requirements)).toBe(before);
    const prompt = await route.hooks.get("system-prompt/assemble")!({}, { scope: { session: { header: { id: "judge", parentSession: card.session_id, cwd: route.scope.projectPath } } } }, async () => ({ sections: [{ name: "deployment:persona", text: "PROMAX_MEMBER_ID:quality_judge" }] }));
    const actualBrief = prompt.sections.find((s: { name: string }) => s.name === "promax-work").text;
    expect(actualBrief).toContain("根据可靠附件做比较，不需要浏览器实测");
    expect(actualBrief).not.toContain("用户决定仅允许模型记忆");
  }
  await route.hooks.get("tools/post-execute")!({ name: "quality_judge", agent: { session: { header: { id: card.session_id, cwd: route.scope.projectPath }, events: [] } } }, { isError: false, value: { kind: "continuable", subagentId: "judge" } }, async () => ({}));
  if (entry === "coordinator") await route.hooks.get("subagent/end")!({ id: "judge" });
  await store.bindJudge(key, "judge"); r = (await store.round(key))!;
  const result = judgeResult(r);
  // Exercise terminal PASS with an uncovered core item via a legal local scope.
  if (local) {
    r.check_only = true; r.acceptance_scope = ["R4"]; r.turn.review_requirement_ids = ["R4"];
    await store.writeRound(key, r);
    result.acceptance.items = result.acceptance.items.filter((i) => i.id === "R4");
  }
  const exec = { callId: "real-check", agent: { session: { header: { id: "judge", parentSession: card.session_id, origin: "subagent", cwd: route.scope.projectPath }, events: [] } } };
  const submitted = await route.submit("promax_check_result", result, exec);
  expect(submitted.isError, String(submitted.value)).toBe(false);
  if (entry === "judge-end") {
    await route.hooks.get("subagent/end")!({ id: "judge" });
  } else {
    const events = [{ type: "tool/call", seq: 3, data: { name: "quality_judge", callId: "j" } }, { type: "assistant/message", seq: 4, data: { message: { content: [{ type: "text", text: "检查结束" }] } } }];
    await route.hooks.get("agent/turn-stopping")!({ agent: { session: { header: { id: card.session_id, cwd: route.scope.projectPath }, events }, steer: () => {} }, turn: 1, signal: new AbortController().signal });
  }
  const ended = (await store.round(key))!, saved = await store.read(key);
  expect(ended.phase).toBe("ended");
  expect(saved.last_progress).toContain(local ? "部分完成" : "已完成");
  expect(ended.last_check?.delivery_saved).toBe(true);
  expect(deriveAgentStatus(saved, ended, emptyStatus()).control === "done").toBe(!local);
  expect(trunkProgress({ card: saved, round: ended }).every((n) => n.state === "done")).toBe(!local);
  expect(taskCompletion(saved, undefined, { verdict: "PASS", reviewed_hashes: { [filename]: hash(bytes) } }, { [filename]: hash(bytes) }).state).toBe("legacy");
  if (evidenceCase) {
    // R15：真实终局闭环→employeeMessage/propose→discussionRound，不拼理想讨论对象。
    const question = await store.employeeMessage(key, "解释一下这份报告的含义，不改要求", []);
    await store.propose(key, { intent: "answer", card_patch: {}, deliverables: [], edit_request: null, handled_events: [{ event_id: question.event.id, intent: "question", impact: "normal", note: "仅回答追问" }] }, 20, contract);
    const assertConsumers = async (complete: boolean) => {
      const current = await store.read(key), discussion = (await store.round(key))!;
      expect(discussion.source).toBe("proposal");
      const metrics = await workMetrics(route!.scope.projectPath, key);
      const hashes = Object.fromEntries(new ContentObjectStore(route!.scope.projectPath).index().artifacts.map(a => [a.filename, a.current_sha256]));
      const ui = taskCompletion(current, discussion.last_check?.acceptance_baseline, discussion.last_check, hashes);
      expect(ui.state === "complete").toBe(complete);
      expect(metrics.Q1.met).toBe(ui.counts.met);
      expect(metrics.completion_candidate.counts).toEqual(ui.counts);
      expect(trunkProgress({ card: current, round: discussion }).every(n => n.state === "done")).toBe(complete);
      expect(coordinatorContext(current, discussion, deriveAgentStatus(current, discussion, emptyStatus()), new ContentObjectStore(route!.scope.projectPath).index().artifacts)).toContain(complete ? '已完成' : '部分完成');
      const exported = await route!.request("work/metrics", { work_key: key });
      expect(exported.status).toBe(200);
      const payload = await exported.json() as Awaited<ReturnType<typeof workMetrics>>;
      expect(payload.Q1.met).toBe(ui.counts.met);
    };
    await assertConsumers(true);
    // 明确撤回来源资格：读取时统一失效，原判定快照不改写。
    const inputManifest = join(route.scope.projectPath, ".任务", ended.task_key!, "输入/manifest.yml");
    const manifest = YAML.parse(await readFile(inputManifest, "utf8"));
    manifest.spec.sources.find((s: { source_id: string }) => s.source_id === "SRC-099").use_qualification = "diagnostic_only";
    await writeFile(`${inputManifest}.test-staging`, YAML.stringify(manifest));
    await rename(`${inputManifest}.test-staging`, inputManifest);
    await assertConsumers(false);
    expect((await store.round(key))!.last_check!.acceptance_evidence!["D:FACTS"]!.available).toContain("source_link");
    // 仅隔离fixture恢复资格以独立覆盖成果版本变化，不碰真实证据。
    delete manifest.spec.sources.find((s: { source_id: string }) => s.source_id === "SRC-099").use_qualification;
    await writeFile(`${inputManifest}.test-staging`, YAML.stringify(manifest));
    await rename(`${inputManifest}.test-staging`, inputManifest);
    await assertConsumers(true);
    const edited = new ContentObjectStore(route.scope.projectPath).saveHumanEdit({ work_key: key, filename, base_sha256: hash(bytes), author: "synthetic-test", content: bytes + "新增测试版本\n" });
    await store.progress(key, "测试修改了成果", { [filename]: edited.current_sha256 });
    await assertConsumers(false);
    const changed = await store.employeeMessage(key, "新增必须比较价格的要求", []);
    await store.propose(key, { intent: "answer", card_patch: {}, deliverables: [], edit_request: null, handled_events: [{ event_id: changed.event.id, intent: "supplement", impact: "normal", note: "明确新要求" }] }, 30, contract);
    await assertConsumers(false);
    expect((await workMetrics(route.scope.projectPath, key)).Q1.met).toBe(0);
  }
  // Historical digests remain readable, but never become new-protocol evidence.
  expect(requirementsDigest({ goal: "旧目标", confirmed: [{ source: "message", text: "旧模型归纳", quote: "实际原话", confirmed_at: "old" }] })).toBe(JSON.stringify(["旧目标", ["旧模型归纳"]]));
});

it("T7 actual reportWork serializer keeps new protocol local; backend contract is unchanged", async () => {
  const f = await fixture();
  const access: TraceAccess = { identity: { employee_id: "fixture", client_id: "fixture-client", identity_source: "promate" }, projectPermissions: { p: ["read", "write"] } };
  const calls: Array<Record<string, any>> = [];
  const uploader = new TraceUploader(join(f.root, "upload-home"), "https://stub.invalid", { accessToken: async () => "fixture", refresh: async () => ({ kind: "success" as const }), traceAccess: () => access }, { debug() {}, warn() {} }, 1000, async (_url, init) => {
    const body = JSON.parse(String(init?.body)); calls.push(body);
    return Response.json({ work_id: body.work_id, updated_at: body.updated_at });
  });
  const card = await f.store.read(f.key);
  expect(card.acceptance_baseline).toBeDefined();
  uploader.reportWork(f.root, card);
  await uploader.idle();
  expect(calls).toHaveLength(1);
  expect(calls[0]!.card).not.toHaveProperty("acceptance_baseline");
  expect(calls[0]!.card).not.toHaveProperty("acceptance_history");
  expect(calls[0]!.card).not.toHaveProperty("requirement_policy");
  expect(calls[0]!.card).not.toHaveProperty("events");
  expect(calls[0]!.card).not.toHaveProperty("interpretations");
  expect(calls[0]!.card.requirement_version).toBe(card.requirement_version);
});
