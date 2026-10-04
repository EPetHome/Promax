import { afterEach, expect, it } from "vitest";
import { readFile, writeFile, rm, symlink, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import YAML from "yaml";
import { WorkStore } from "../src/work-store.ts";
import { workMetrics } from "../src/chain-metrics.ts";
import { workRouteFixture } from "../../promax-ui-console/tests/work-route-fixture.ts";
import { memberWorkContext } from "../src/index.ts";
import { legacyEvidenceDependency, readFrozenSources } from "../src/evidence-links.ts";
import { taskCompletion } from "../../promax-ui-console/src/effective-protocol.ts";
import { settleStructuredCommits, commitStructuredSubmission } from "../src/structured-results.ts";

import { parseJudgeReport } from "../src/judge-report.ts";
const sha = (v: string) => createHash("sha256").update(v).digest("hex");
const samples = resolve("../docs/测试");
const historical = "/Users/Admin/Promax-first/评测隔离-20260915-1242-ed3718";
let f: Awaited<ReturnType<typeof workRouteFixture>>;
afterEach(async () => { await f?.close(); });
async function setup() {
  const rubrics = YAML.parse(await readFile("../promax-agent/team-harness/catalogs/rubrics.yml", "utf8"));
  const revision = { api_version: "promax.ai/v1alpha2", kind: "TeamRevision", metadata: { team_revision_id: "fixture@r8", status: "published" }, spec: {
    members: [{ member_id: "user_analysis", display_name: "分析" }, { member_id: "quality_judge", display_name: "检查" }],
    artifacts: [{ kind: "other", validation_kind: "user-analysis-report", relative_path: ".任务/{task_key}/产物快照/user_analysis.md", produced_by: "user_analysis" }, { kind: "judge-report", validation_kind: "judge-report", relative_path: ".任务/{task_key}/判定-r{round}.md", produced_by: "quality_judge" }],
    domain_rubrics: rubrics.domain_rubrics ?? rubrics.rubrics ?? rubrics,
  } };
  f = await workRouteFixture({ revision });
  const store = new WorkStore(f.scope.projectPath);
  const created = await (await f.request("work/card/update", { action: "create", sessionId: "session-one", title: "简洁评分报告" })).json();
  const key = created.card.work_key as string, session = created.card.session_id as string;
  let n = 0;
  const events: any[] = [];
  const main = { session: { header: { id: session, cwd: f.scope.projectPath }, events }, steer: () => {} };
  const child = (id: string) => ({ session: { header: { id, cwd: f.scope.projectPath, parentSession: session, origin: "subagent" }, events: [] } });
  const say = async (text: string, version?: number) => {
    let paths: string[] = [];
    if (version) {
      const bytes = await readFile(join(samples, `Promax实测-评分样本-v${version}.json`));
      paths = (await (await f.request("attachments", { sessionId: session, files: [{ name: `v${version}.json`, contentBase64: bytes.toString("base64") }] })).json()).paths;
    }
    events.push({ seq: ++n, type: "user/message", data: { content: [{ type: "text", text }], source: { kind: "user" } } });
    return (await (await f.request("work/card/update", { action: "message", work_key: key, text, paths })).json()).event;
  };
  const propose = async (event: any, intent = "execute", correction = false) => {
    const result = await f.submit("promax_work_proposal", { intent, card_patch: {}, deliverables: intent === "answer" ? [] : ["user_analysis.md"], edit_request: null, handled_events: [{ event_id: event.id, intent: correction ? "correction" : intent === "answer" ? "question" : "new_task", impact: correction ? "high" : "normal", affects: correction ? ["user_analysis.md"] : [], note: correction ? "v2替代v1，仅更新受影响统计与结论" : "按原目标处理" }] }, { callId: `proposal-${++n}`, agent: main });
    expect(result.isError, String(result.value)).toBe(false);
  };
  const start = async () => {
    const r = (await store.round(key))!;
    const response = await f.request("work/card/update", { action: "start", work_key: key, revision: r.revision, source: "click" });
    expect(response.status, await response.clone().text()).toBe(200);
    return (await store.round(key))!;
  };
  let businessExecutions = 0;
  const dispatch = async (role: string, id: string) => {
    const exec = { name: role, arguments: role === "send_message" ? { subagent_id: id, message: "继续当前授权" } : { prompt: "当前授权工作" }, callId: `dispatch-${id}-${++n}`, agent: main };
    events.push({ seq: n, type: "tool/call", data: { name: role, callId: exec.callId } });
    const admission = await f.hooks.get("tools/pre-execute")!(exec, async () => ({ kind: "allow" }));
    expect(admission, JSON.stringify(admission)).toMatchObject({ kind: "allow" });
    const result = await f.hooks.get("tools/execute")!(exec, async () => {
      businessExecutions++;
      await new Promise(resolve => setTimeout(resolve, 15));
      return { isError: false, value: { kind: "continuable", subagentId: id }, content: [{ type: "text", text: `成员 ${id} 已派发（模拟执行）` }] };
    });
    expect(result.isError, JSON.stringify(result)).toBe(false);
    await f.hooks.get("tools/post-execute")!(exec, result, async () => ({}));
    return result;
  }; 
  const call = async (name: string, args: unknown, id = "worker") => {
    const exec = { name, arguments: args, callId: `tool-${++n}`, agent: child(id) };
    const admitted = await f.hooks.get("tools/pre-execute")!(exec, async () => ({ kind: "allow" }));
    if (admitted.kind === "deny") throw new Error(admitted.reason);
    return f.tools.get(name)!.execute(args, exec) as Promise<any>;
  };
  const receipt = async (links: unknown[] | undefined, extra: Record<string, unknown> = {}, callId = `receipt-${++n}`) => {
    const round = (await store.round(key))!;
    return f.submit("promax_member_receipt", { filename: "user_analysis.md", status: "draft_ready", summary: "评分报告", unverified: [], gaps: [], input_version: round.execution_version, ...(links ? { evidence_links: links } : {}), ...extra }, { callId, agent: child("worker") });
  };
  const first = await say("请分析附件评分，交付简洁Markdown报告：分布与数据质量、主要反馈举例、3条待验证建议和限制。仅本批合成材料，不联网。", 1);
  await propose(first); const round = await start();
  const shared = await Promise.all([dispatch("user_analysis", "worker"), dispatch("user_analysis", "worker")]);
  expect(shared[0].value).toEqual(shared[1].value); expect(businessExecutions).toBe(1); // Same action, not the same call's delivery text.
  const path = () => join(f.scope.projectPath, ".任务", round.task_key!, "产物快照/user_analysis.md");
  const frozen = await readFrozenSources(f.scope.projectPath, round.task_key!); if ("error" in frozen) throw Error(frozen.error);
  const src = [...frozen.sources.values()].find(s => s.relative_path?.endsWith(".json"))!;
  return { store, key, main, child, say, propose, start, dispatch, call, receipt, round, path, src, events, executions: () => businessExecutions };
}
const links = (facts: any) => facts.numeric_specs.map((numeric_spec: any) => ({ requirement_ids: ["D:USER_ANALYSIS_NUMBER_TRACE"], conclusion: `${numeric_spec.formula}：${numeric_spec.result}`, location: `${numeric_spec.formula}：${numeric_spec.result}`, kind: "fact", evidence: [{ source_id: facts.source_id, range: "json:all" }], numeric_spec }));
const report = (items: any[]) => `# 简洁评分报告\n\n## 评分分布与数据质量\n只描述本批样本；有效分母，严格数值1—5整数，不去重。\n${items.map(l => l.conclusion).join("\n")}\n\n## 主要反馈\n引用T0076的原文：基本能完成材料上传，但预览操作还可以简化。\n\n## 待验证建议\n1. 待验证：简化预览。\n2. 待验证：改进定位。\n3. 待验证：优化状态反馈。\n\n## 限制\n合成样本，不证明趋势、因果或总体；追溯见结论关联入口。\n`;

it("R22 实际注册/工作准入/权限钩子：首稿前v1统计正确，跨任务/路径/脚本与归档写入拒绝", async () => {
  const w = await setup();
  expect((await w.store.round(w.key))!.receipts).toBeUndefined();
  const facts = await w.call("promax_rating_facts", { source_id: w.src.source_id });
  expect(facts).toMatchObject({ total: 320, valid: 300, invalid_count: 20, rating_counts: [30,45,75,90,60], low: { numerator: 75, denominator: 300, percent: 25 }, high: { percent: 50 }, input_sha256: w.src.sha256, kind: "program_facts" });
  expect(facts.invalid).toHaveLength(20);
  for (const args of [{ source_id: "SRC-999" }, { source_id: w.src.source_id, task_key: "other" }, { source_id: w.src.source_id, path: "../../secret" }, { source_id: w.src.source_id, script: "print('ok')" }]) await expect(w.call("promax_rating_facts", args)).rejects.toThrow();
  await expect(w.call("promax_rating_facts", { source_id: w.src.source_id }, "foreign-child")).rejects.toThrow("真实责任成员");
  for (const [name, args] of [["bash", { command: "python3 -c \"print('ok')\"" }], ["write", { path: ".对象库/secret", content: "x" }], ["write", { path: w.src.relative_path, content: "x" }]] as const) {
    const result = await f.hooks.get("tools/pre-execute")!({ name, arguments: args, agent: w.child("worker") }, async () => ({ kind: "allow" }));
    expect(result.kind).toBe("deny");
  }
  const secondDenial = await f.hooks.get("tools/pre-execute")!({ name: "bash", arguments: { command: "node -e 'console.log(1)'" }, callId: "equivalent-interpreter", agent: w.child("worker") }, async () => { throw Error("不应进入执行器"); });
  expect(secondDenial.reason).toContain("已知相同策略限制");
  const legal = await f.hooks.get("tools/pre-execute")!({ name: "bash", arguments: { command: "ls" }, callId: "legal-read", agent: w.child("worker") }, async () => ({ kind: "allow" }));
  expect(legal.kind).toBe("allow");
  // Bounded invalid values in version facts: do not expand a long object/array rating into the tool result.
  const longRows = JSON.parse(await readFile(join(samples, "Promax实测-评分样本-v1.json"), "utf8"));
  longRows.find((row: any) => row.record_id === "T0076").rating = { nested: "long-value".repeat(10000) };
  const rel = `.任务/${w.round.task_key}/输入/sources/SRC-998/data.json`, longJson = JSON.stringify(longRows);
  await mkdir(join(f.scope.projectPath, `.任务/${w.round.task_key}/输入/sources/SRC-998`));
  await writeFile(join(f.scope.projectPath, rel), longJson);
  const manifestPath = join(f.scope.projectPath, `.任务/${w.round.task_key}/输入/manifest.yml`), manifest = YAML.parse(await readFile(manifestPath, "utf8"));
  manifest.spec.sources.push({ ...w.src, source_id: "SRC-998", relative_path: rel, sha256: sha(longJson) });
  await rm(manifestPath); await writeFile(manifestPath, YAML.stringify(manifest));
  const bounded = await w.call("promax_rating_facts", { source_id: "SRC-998", previous_source_id: w.src.source_id });
  expect(bounded.delta.changes[0].rating.after).toMatchObject({ invalid_type: "object" });
  expect(JSON.stringify(bounded).length).toBeLessThan(20000);
  const inputPath = join(f.scope.projectPath, w.src.relative_path!);
  await rm(inputPath); await symlink(join(samples, "Promax实测-评分样本-v1.json"), inputPath);
  await expect(w.call("promax_rating_facts", { source_id: w.src.source_id })).rejects.toThrow("符号链接");
});

it("EVIDENCE-FEEDBACK-01 注册回执：错误数值字段与正文定位反馈；只修参数提交且不改变成果/来源", async () => {
  const w = await setup();
  const tool = f.tools.get("promax_member_receipt")!;
  const schema = tool.parameters as any;
  const facts = await w.call("promax_rating_facts", { source_id: w.src.source_id });
  const spec = facts.numeric_specs.find((s: any) => s.formula === "rating_3_count");
  expect(spec).toMatchObject({ result: "75", numerator: "75", denominator: "1" });
  const line = "rating_3_count：75";
  const preceding = facts.numeric_specs.slice(0, 3).map((numeric_spec: any) => {
    const conclusion = `${numeric_spec.formula}：${numeric_spec.result}`;
    return { requirement_ids: ["D:USER_ANALYSIS_NUMBER_TRACE"], conclusion, location: conclusion, kind: "fact", evidence: [{ source_id: w.src.source_id, range: "json:all" }], numeric_spec };
  });
  const body = `# 评分结果\n\n## 数据表\n评分结果\n${preceding.map((item: any) => item.conclusion).join("\n")}\n${line}\n\n## 局限\n样本范围有限。\n`;
  await writeFile(w.path(), body);
  const sourcePath = join(f.scope.projectPath, w.src.relative_path!);
  const sourceBefore = await readFile(sourcePath);
  const link = { requirement_ids: ["D:USER_ANALYSIS_NUMBER_TRACE"], conclusion: line, location: line, kind: "fact", evidence: [{ source_id: w.src.source_id, range: "json:all" }], numeric_spec: spec };
  const bad = await w.receipt([...preceding, { ...link, numeric_spec: { ...spec, denominator: "300" } }]);
  expect(bad.isError).toBe(true);
  expect(String(bad.value)).toContain("evidence_links[3].numeric_spec.denominator");
  expect(String(bad.value)).toMatch(/收到.*300.*期望.*1/u);
  expect(String(bad.value)).not.toContain("结果 75 与可复算值 75 不一致");
  expect((await w.store.round(w.key))!.receipts).toBeUndefined();
  for (const [location, feedback] of [
    ["报告开头数据来源段 / 数据表", "未命中"],
    ["评分结果", "命中 2 次"],
    ["## 局限", "范围不对应"],
  ]) {
    const rejected = await w.receipt([...preceding, { ...link, location }]);
    expect(rejected.isError).toBe(true);
    expect(String(rejected.value)).toContain("evidence_links[3].location");
    expect(String(rejected.value)).not.toContain("不少于 4 个字符");
    expect(String(rejected.value)).toContain(feedback);
    expect((await w.store.round(w.key))!.receipts).toBeUndefined();
  }
  const accepted = await w.receipt([...preceding, link]);
  expect(accepted.isError, String(accepted.value)).toBe(false);
  const saved = (await w.store.round(w.key))!.receipts!["user_analysis.md"]!;
  expect(saved.sha256).toBe(sha(body));
  expect(saved.evidence_links![3]!.numeric_check).toMatchObject({ status: "recomputed", matched: true, computed: 75, counts: { numerator: 75, denominator: 1 } });
  expect(saved.evidence_links![3]!.link_id).toMatch(/^LNK-/u);
  expect((await w.store.evidenceLinks(w.key)).artifacts[0]!.links).toHaveLength(4);
  expect(await readFile(w.path(), "utf8")).toBe(body);
  expect(await readFile(sourcePath)).toEqual(sourceBefore);
  expect(schema.properties.evidence_links.items.properties.location.description).toContain("逐字");
  expect(schema.properties.evidence_links.items.properties.numeric_spec.description).toContain("计数分母");
});

it("EC01 注册回执：H1前言不受独立后续章节牵连；公共限制仍阻断续绑", async () => {
  const w = await setup();
  const opening = "本报告仅使用该附件，不联网。";
  const intro = `# 评分报告\n\n${opening}\n\n## 独立反馈\n反馈一。\n\n## 材料限制\n仅本批样本。\n`;
  const link = { requirement_ids: ["D:USER_ANALYSIS_NUMBER_TRACE"], conclusion: opening, location: opening, evidence: [{ source_id: w.src.source_id, range: "第 1 行" }] };
  await writeFile(w.path(), intro);
  expect((await w.receipt([link])).isError).toBe(false);
  const old = (await w.store.round(w.key))!.receipts!["user_analysis.md"]!.evidence_links![0]!;
  expect(old.dependency_sha256).toMatch(/^[a-f0-9]{64}$/u);
  const revised = intro.replace("反馈一。", "反馈二。");
  await writeFile(w.path(), revised);
  const response = await w.receipt([], {}, "ec01-independent");
  expect(response.isError, String(response.value)).toBe(false);
  const current = (await w.store.round(w.key))!.receipts!["user_analysis.md"]!;
  expect(current.evidence_continuity).toEqual([expect.objectContaining({ conclusion_id: old.conclusion_id, state: "continued" })]);
  expect(current.evidence_links![0]).toMatchObject({ conclusion_id: old.conclusion_id, artifact_sha256: sha(revised), continued_from: { link_id: old.link_id } });
  expect(current.evidence_links![0]!.link_id).not.toBe(old.link_id);
  await w.receipt([], {}, "ec01-independent");
  expect((await w.store.round(w.key))!.receipts!["user_analysis.md"]).toEqual(current);
  const index = await w.store.evidenceLinks(w.key);
  expect(index.conclusions[0]!.revisions.map(r => r.link_id)).toEqual([old.link_id, current.evidence_links![0]!.link_id]);
  const changedLimit = revised.replace("仅本批样本。", "仅本批样本，不证明总体。");
  await writeFile(w.path(), changedLimit);
  expect((await w.receipt([])).isError).toBe(false);
  const invalid = (await w.store.round(w.key))!.receipts!["user_analysis.md"]!;
  expect(invalid.evidence_links).toHaveLength(0);
  expect(invalid.evidence_continuity).toEqual([expect.objectContaining({ conclusion_id: old.conclusion_id, state: "invalidated", reason: expect.stringContaining("公共限定") })]);
  expect((await w.store.evidenceLinks(w.key)).conclusions[0]!.inactive?.reason).toContain("公共限定");
});

it("EC02 续绑失败分支：局部/锚点/来源版本按真实原因拒绝且在索引可读", async () => {
  const w = await setup();
  const conclusion = "本批结论来自冻结附件。";
  const original = `# 报告\n\n## 本批结论\n${conclusion}\n补充说明不变。\n\n## 独立后续\n其它观察。\n`;
  const link = { requirement_ids: ["D:USER_ANALYSIS_NUMBER_TRACE"], conclusion, location: conclusion, evidence: [{ source_id: w.src.source_id, range: "第 1 行" }] };
  await writeFile(w.path(), original);
  expect((await w.receipt([link])).isError).toBe(false);
  const changes = [
    [original.replace("补充说明不变。", "补充说明已改变。"), "局部内容变化"],
    [original.replace(conclusion, "结论尚待核对。"), "结论文本未在"],
    [original.replace("## 独立后续", `${conclusion}\n\n## 独立后续`), "定位不唯一"],
  ] as const;
  for (const [changed, reason] of changes) {
    await writeFile(w.path(), changed);
    expect((await w.receipt([])).isError).toBe(false);
    const after = (await w.store.round(w.key))!.receipts!["user_analysis.md"]!;
    expect(after.evidence_links).toHaveLength(0);
    expect(after.evidence_continuity![0]!.reason).toContain(reason);
    expect((await w.store.evidenceLinks(w.key)).conclusions.find(c => c.conclusion_id === after.evidence_continuity![0]!.conclusion_id)?.inactive?.reason).toContain(reason);
    await writeFile(w.path(), original);
    expect((await w.receipt([link], { evidence_update: { mode: "replace" } })).isError).toBe(false);
  }
  const sourcePath = join(f.scope.projectPath, w.src.relative_path!);
  const manifestPath = join(f.scope.projectPath, `.任务/${w.round.task_key}/输入/manifest.yml`);
  const content = (await readFile(sourcePath, "utf8")) + "\n";
  await rm(sourcePath); await writeFile(sourcePath, content); // 仅隔离fixture，冻结来源文件只读
  const manifest = YAML.parse(await readFile(manifestPath, "utf8"));
  manifest.spec.sources.find((s: any) => s.source_id === w.src.source_id).sha256 = sha(content);
  await rm(manifestPath); await writeFile(manifestPath, YAML.stringify(manifest));
  expect((await w.receipt([])).isError).toBe(false);
  const reason = (await w.store.round(w.key))!.receipts!["user_analysis.md"]!.evidence_continuity![0]!.reason;
  expect(reason).toContain("来源版本/资格/引用范围变化");
  expect(reason).not.toContain("旧记录缺依赖指纹");
});

it("EC02 冻结基准版本变化仅按真实分支失效，不误称锚点或旧指纹缺失", async () => {
  const w = await setup();
  const conclusion = "仅本批附件。";
  const body = `# 报告\n\n${conclusion}\n\n## 其他\n未变。\n`;
  await writeFile(w.path(), body);
  expect((await w.receipt([{ requirement_ids: ["R1"], conclusion, location: conclusion, evidence: [{ source_id: w.src.source_id, range: "第 1 行" }] }])).isError).toBe(false);
  const before = (await w.store.round(w.key))!;
  const baseline = structuredClone(before.acceptance_baseline!);
  baseline.version += ":new";
  expect(await w.store.transitionRound(w.key, before, { ...before, acceptance_baseline: baseline })).toBe(true);
  expect((await w.receipt([])).isError).toBe(false);
  const invalid = (await w.store.round(w.key))!.receipts!["user_analysis.md"]!;
  expect(invalid.evidence_links).toHaveLength(0);
  expect(invalid.evidence_continuity![0]!.reason).toContain("验收基准版本变化");
  expect(invalid.evidence_continuity![0]!.reason).not.toContain("旧记录缺依赖指纹");
});

it("EC04 v1依赖指纹仅在旧被审字节可核验时按v2分段迁移，不改写旧回执", async () => {
  const w = await setup();
  const opening = "本报告仅使用该附件，不联网。";
  const original = `# 报告\n\n${opening}\n\n## 结论\n独立结论一。\n\n## 材料限制\n只用本批材料。\n`;
  const link = { requirement_ids: ["R1"], conclusion: opening, location: opening, evidence: [{ source_id: w.src.source_id, range: "第 1 行" }] };
  await writeFile(w.path(), original);
  expect((await w.receipt([link])).isError).toBe(false);
  const before = (await w.store.round(w.key))!;
  const saved = structuredClone(before.receipts!["user_analysis.md"]!);
  const legacy = saved.evidence_links![0]!;
  delete legacy.dependency_parts;
  legacy.dependency_sha256 = legacyEvidenceDependency(original, link)!;
  expect(await w.store.transitionRound(w.key, before, { ...before, receipts: { ...before.receipts, [saved.filename]: saved } })).toBe(true);
  const reviewedDir = join(f.scope.projectPath, ".工作", w.key, "被审版本");
  await mkdir(reviewedDir, { recursive: true });
  await writeFile(join(reviewedDir, sha(original)), original);
  const revised = original.replace("独立结论一。", "独立结论二。");
  await writeFile(w.path(), revised);
  expect((await w.receipt([], {}, "ec04-verified-snapshot")).isError).toBe(false);
  const current = (await w.store.round(w.key))!.receipts![saved.filename]!;
  expect(current.evidence_continuity).toEqual([expect.objectContaining({ state: "continued", conclusion_id: legacy.conclusion_id })]);
  expect(current.evidence_links![0]!.dependency_parts?.version).toBe(2);
  expect(current.evidence_links![0]!.continued_from?.link_id).toBe(legacy.link_id);
  expect(await readFile(join(reviewedDir, sha(original)), "utf8")).toBe(original);
  const history = (await w.store.round(w.key))!.receipt_history!;
  expect(history.at(-1)!.evidence_links![0]!.dependency_parts).toBeUndefined();
  expect(history.at(-1)!.evidence_links![0]!.dependency_sha256).toBe(legacy.dependency_sha256);
});

it("EC04 旧被审字节缺失或旧指纹缺失时不猜测续绑，原因在索引可读", async () => {
  const w = await setup();
  const conclusion = "只用本批输入，不联网。";
  const text = `# 报告\n\n${conclusion}\n\n## 后续章节\n数据一。\n`;
  const link = { requirement_ids: ["R1"], conclusion, location: conclusion, evidence: [{ source_id: w.src.source_id, range: "第 1 行" }] };
  await writeFile(w.path(), text);
  expect((await w.receipt([link])).isError).toBe(false);
  const before = (await w.store.round(w.key))!;
  const legacy = structuredClone(before.receipts!["user_analysis.md"]!);
  delete legacy.evidence_links![0]!.dependency_parts;
  legacy.evidence_links![0]!.dependency_sha256 = legacyEvidenceDependency(text, link)!;
  expect(await w.store.transitionRound(w.key, before, { ...before, receipts: { ...before.receipts, [legacy.filename]: legacy } })).toBe(true);
  const revised = text.replace("数据一。", "数据二。");
  await writeFile(w.path(), revised);
  expect((await w.receipt([])).isError).toBe(false);
  const current = (await w.store.round(w.key))!.receipts![legacy.filename]!;
  expect(current.evidence_links).toHaveLength(0);
  expect(current.evidence_continuity![0]).toMatchObject({ state: "invalidated", reason: expect.stringContaining("原被审字节不可核对") });
  expect((await w.store.evidenceLinks(w.key)).conclusions[0]!.inactive?.reason).toContain("原被审字节不可核对");
  // A separate explicit registration may still be made; missing old dependency never gets silently upgraded.
  expect((await w.receipt([link], { evidence_update: { mode: "replace" } })).isError).toBe(false);
  const next = (await w.store.round(w.key))!;
  const missing = structuredClone(next.receipts![legacy.filename]!);
  delete missing.evidence_links![0]!.dependency_sha256;
  delete missing.evidence_links![0]!.dependency_parts;
  expect(await w.store.transitionRound(w.key, next, { ...next, receipts: { ...next.receipts, [missing.filename]: missing } })).toBe(true);
  expect((await w.receipt([])).isError).toBe(false);
  expect((await w.store.round(w.key))!.receipts![legacy.filename]!.evidence_continuity![0]!.reason).toContain("旧记录缺依赖指纹");
});

it("EC04 v1原指纹未变可无旧快照续绑；缺旧来源绑定不得升级", async () => {
  const w = await setup();
  const conclusion = "本批样本据冻结附件统计。";
  const body = `# 报告\n\n${conclusion}\n\n## 后续\n状态未变。\n`;
  const link = { requirement_ids: ["R1"], conclusion, location: conclusion, evidence: [{ source_id: w.src.source_id, range: "第 1 行" }] };
  await writeFile(w.path(), body);
  expect((await w.receipt([link])).isError).toBe(false);
  const before = (await w.store.round(w.key))!;
  const old = structuredClone(before.receipts!["user_analysis.md"]!);
  old.evidence_links![0]!.dependency_sha256 = legacyEvidenceDependency(body, link)!;
  delete old.evidence_links![0]!.dependency_parts;
  expect(await w.store.transitionRound(w.key, before, { ...before, receipts: { ...before.receipts, [old.filename]: old } })).toBe(true);
  expect((await w.receipt([], {}, "ec04-same-body")).isError).toBe(false);
  const kept = (await w.store.round(w.key))!.receipts![old.filename]!;
  expect(kept.evidence_continuity![0]!.state).toBe("continued");
  expect(kept.evidence_links![0]!.dependency_parts?.version).toBe(2);
  const round = (await w.store.round(w.key))!;
  const broken = structuredClone(round.receipts![old.filename]!);
  (broken.evidence_links![0] as any).source_readback = undefined; // 隔离历史损坏反例，不修改产品数据
  expect(await w.store.transitionRound(w.key, round, { ...round, receipts: { ...round.receipts, [broken.filename]: broken } })).toBe(true);
  expect((await w.receipt([], { summary: "缺失旧来源回读的本次提交" }, "ec04-missing-source-binding")).isError).toBe(false);
  expect((await w.store.round(w.key))!.receipts![broken.filename]!.evidence_continuity![0]!.reason).toContain("旧记录缺来源回读版本信息");
});

it("R23 真实首轮报告的局部H3修改：数值续绑、数字/单位/来源失效、撤回/重试/历史", async () => {
  const w = await setup(), facts = await w.call("promax_rating_facts", { source_id: w.src.source_id });
  const originalHash = "6abd82b6f369780c87de8637408ce377a4ef649c0868935cf6f075198aa6aec9";
  const original = await readFile(join(historical, ".工作/请分析附件中-星河笔记-的评分与反馈-交付一份简洁的-M-2/被审版本", originalHash), "utf8");
  const registry = YAML.parse(await readFile(join(historical, ".任务/产品任务/结论关联.yml"), "utf8"));
  const numeric = registry.conclusions.slice(0, 5).map((c: any, i: number) => ({ requirement_ids: ["D:USER_ANALYSIS_NUMBER_TRACE"], conclusion: c.first_conclusion, location: c.first_location, kind: "fact", evidence: [{ source_id: w.src.source_id, range: "json:all" }], numeric_spec: facts.numeric_specs.find((s: any) => s.formula === ["rating_valid", "rating_total", "rating_1_2_ratio", "rating_4_5_ratio", "rating_invalid"][i]) }));
  await writeFile(w.path(), original);
  expect((await w.receipt(numeric)).isError).toBe(false);
  const prior = (await w.store.round(w.key))!.receipts!["user_analysis.md"]!;
  const edited = original.replace("2—3 星中 40 条提到引用位置不清楚", "2—3 星中 40 条提到引用位置不清楚（另有无效记录5条，共45条）");
  expect(edited).not.toBe(original);
  await writeFile(w.path(), edited);
  expect((await w.receipt([], {}, "local-edit")).isError).toBe(false);
  const current = (await w.store.round(w.key))!.receipts!["user_analysis.md"]!;
  expect(current.evidence_links).toHaveLength(5);
  expect(current.evidence_links!.map(l => l.conclusion_id)).toEqual(prior.evidence_links!.map(l => l.conclusion_id));
  expect(current.evidence_links!.every(l => l.artifact_sha256 === sha(edited) && l.numeric_check?.matched && l.continued_from)).toBe(true);
  expect(current.evidence_continuity!.every(c => c.state === "continued")).toBe(true);
  await w.receipt([], {}, "local-edit");
  expect((await w.store.round(w.key))!.receipts!["user_analysis.md"]).toEqual(current);
  const id = current.evidence_links![0]!.conclusion_id;
  await w.receipt([], { evidence_update: { mode: "patch", withdraw: [id] } });
  await w.receipt([]);
  expect((await w.store.round(w.key))!.receipts!["user_analysis.md"]!.evidence_links!.some(l => l.conclusion_id === id)).toBe(false);
  const index = await w.store.evidenceLinks(w.key);
  expect(index.conclusions.find(c => c.conclusion_id === id)?.inactive?.state).toBe("withdrawn");
  expect(index.conclusions.find(c => c.conclusion_id === id)?.revisions.some(r => r.artifact_sha256 === originalHash)).toBe(true);
  // A unit/scope change is a dependency change even while the numeric quote still exists.
  await writeFile(w.path(), edited.replace("## 输入与样本/口径", "## 输入与样本/口径\n本节单位改为用户人数（不再是记录条数）。"));
  await w.receipt([]);
  expect((await w.store.round(w.key))!.receipts!["user_analysis.md"]!.evidence_links).toHaveLength(0);
  expect((await w.store.round(w.key))!.receipts!["user_analysis.md"]!.evidence_continuity!.every(c => c.state === "invalidated")).toBe(true);
  await writeFile(w.path(), edited); await w.receipt(numeric, { evidence_update: { mode: "replace" } });
  await writeFile(w.path(), edited.replace("**25.00%**", "**24.00%**")); await w.receipt([]);
  expect((await w.store.round(w.key))!.receipts!["user_analysis.md"]!.evidence_links!.some(l => l.numeric_spec?.formula === "rating_1_2_ratio")).toBe(false);
  await writeFile(w.path(), edited); await w.receipt(numeric, { evidence_update: { mode: "replace" } });
  await rm(join(f.scope.projectPath, w.src.relative_path!)); // isolated fixture only: simulate external source-version corruption
  await writeFile(join(f.scope.projectPath, w.src.relative_path!), "[]"); await w.receipt([]);
  expect((await w.store.round(w.key))!.receipts!["user_analysis.md"]!.evidence_links).toHaveLength(0);
});

it("R24/R25 注册链路：v1提交/事实供给/合法检查→普通追问→v2替换仅一条变化，原Judge准入保护", async () => {
  const w = await setup(), facts = await w.call("promax_rating_facts", { source_id: w.src.source_id }), initial = links(facts);
  expect((await w.store.round(w.key))!.acceptance_baseline!.items.find(i => i.id === "D:USER_ANALYSIS_REQUIRED_SECTIONS")?.text).toContain("简洁评分报告");
  await writeFile(w.path(), report(initial)); expect((await w.receipt(initial)).isError).toBe(false);
  await f.hooks.get("subagent/end")!({ id: "worker" });
  let round = (await w.store.round(w.key))!;
  await w.store.transitionRound(w.key, round, { ...round, phase: "checking", judge_round: 1, reviewed_hashes: { "user_analysis.md": sha(report(initial)) }, allowed_members: ["quality_judge"], requirements_digest: round.execution_digest! });
  await w.dispatch("quality_judge", "judge");
  const duplicate = await Promise.all([w.dispatch("quality_judge", "judge"), w.dispatch("quality_judge", "judge")]);
  expect(duplicate[0].value).toEqual(duplicate[1].value); expect(w.executions()).toBe(2);
  const judgeFacts = await w.call("promax_rating_facts", { source_id: w.src.source_id }, "judge");
  expect(judgeFacts.fact_id).toBe(facts.fact_id); expect(judgeFacts.access_mode).toBe("read_saved");
  expect(judgeFacts.files[0]).toMatchObject({ matched: true, readable: true });
  expect(judgeFacts.acceptance_evidence["D:USER_ANALYSIS_NUMBER_TRACE"].available).toContain("numeric_recompute");
  round = (await w.store.round(w.key))!;
  const context = memberWorkContext(await w.store.read(w.key), round, "quality_judge");
  expect(context).toContain("程序已完成的哈希/复算");
  expect(context).toContain("再一次集中提交问题清单");
  const check = { verdict: "PASS", review_request: round.review_request, input_version: round.execution_version, issues: [], rechecks: [], decisions: [], unverified: [], acceptance: { baseline_version: round.acceptance_baseline!.version, items: round.acceptance_scope!.map(id => ({ id, state: "met", evidence: "受控事实和本版文本；构造Judge协议结果，非真实语义验收" })) } };
  expect((await f.submit("promax_check_result", { ...check, request_review_request: round.review_request }, { callId: "bad-field", agent: w.child("judge") })).value).toContain("正确字段为 review_request");
  expect((await f.submit("promax_check_result", check, { callId: "check-v1", agent: w.child("judge") })).isError).toBe(false);
  await f.hooks.get("subagent/end")!({ id: "judge" });
  await f.hooks.get("agent/turn-stopping")!({ agent: w.main, turn: 1, signal: new AbortController().signal });
  await settleStructuredCommits(f.scope.projectPath);
  round = (await w.store.round(w.key))!;
  expect(round.phase).toBe("ended");
  const card = await w.store.read(w.key);
  expect(taskCompletion(card, round.acceptance_baseline, round.last_check, { "user_analysis.md": sha(report(initial)) }).state).toBe("complete");
  const history = await readFile(join(f.scope.projectPath, round.last_check!.report), "utf8");
  const beforeQuestion = await w.store.observations(w.key), executionsBefore = w.executions();
  const question = await w.say("低星比例的分母是什么？仅解释，不改报告。"); await w.propose(question, "answer");
  expect(w.executions()).toBe(executionsBefore);
  for (const kind of ["action_started", "rating_calculation", "evaluation_record"]) expect((await w.store.observations(w.key)).filter(r => r.kind === kind)).toEqual(beforeQuestion.filter(r => r.kind === kind));
  const discussion = (await w.store.round(w.key))!;
  expect(discussion.turn.deliverables).toEqual([]); expect(discussion.task_key).toBeUndefined();
  expect(discussion.last_check?.report).toBe(round.last_check!.report);
  const corrected = await w.say("v2完整替代v1，不合并；只修T0076评分及受影响内容，保留其他内容与旧版。", 2); await w.propose(corrected, "execute", true);
  expect((await w.store.round(w.key))!.revise).toBeDefined();
  const next = await w.start(); await w.dispatch("user_analysis", "worker");
  const nextPath = join(f.scope.projectPath, ".任务", next.task_key!, "产物快照/user_analysis.md");
  expect(await readFile(nextPath, "utf8")).toBe(report(initial));
  const frozen = await readFrozenSources(f.scope.projectPath, next.task_key!); if ("error" in frozen) throw Error(frozen.error);
  const jsons = [...frozen.sources.values()].filter(s => s.relative_path?.endsWith(".json"));
  const old = jsons.find(s => s.sha256 === facts.input_sha256)!, newer = jsons.find(s => s.sha256 !== facts.input_sha256)!;
  const updated = await w.call("promax_rating_facts", { source_id: newer.source_id, previous_source_id: old.source_id });
  expect(updated).toMatchObject({ rating_counts: [31,45,74,90,60], low: { numerator: 76, denominator: 300, percent: 25.33 }, high: { percent: 50 }, delta: { changed_records: 1, unchanged_records: 319, changes: [{ record_id: "T0076", fields: ["rating"], rating: { before: 3, after: 1 } }] } });
  const modified = report(links(updated));
  expect(modified.split("## 主要反馈")[1]).toBe(report(initial).split("## 主要反馈")[1]);
  await writeFile(nextPath, modified); expect((await w.receipt(links(updated))).isError).toBe(false);
  await f.hooks.get("subagent/end")!({ id: "worker" });
  // Exact bypass that caused the real second task's new Judge: group absent before admission.
  expect((await w.store.round(w.key))!.review_group).toBeUndefined();
  const admission = await f.hooks.get("tools/pre-execute")!({ name: "quality_judge", arguments: {}, callId: "new-judge-attempt", agent: w.main }, async () => ({ kind: "allow" }));
  expect(admission).toMatchObject({ kind: "deny", reason: expect.stringContaining("judge") });
  const reviewing = (await w.store.round(w.key))!;
  expect((await w.store.reviews(w.key)).bindings[reviewing.review_group!]!.session_id).toBe("judge");
  expect(reviewing.children?.judge).toBe("quality_judge");
  await expect(w.store.bindJudge(w.key, "new-judge")).rejects.toThrow("不得以新会话覆盖");
  await w.dispatch("send_message", "judge");
  const v2check = { ...check, input_version: reviewing.execution_version, review_request: reviewing.review_request, acceptance: { ...check.acceptance, baseline_version: reviewing.acceptance_baseline!.version, items: reviewing.acceptance_scope!.map(id => ({ id, state: "met", evidence: "v2程序事实与局部更新；协议测试" })) } };
  expect((await f.submit("promax_check_result", v2check, { callId: "check-v2", agent: w.child("judge") })).isError).toBe(false);
  await f.hooks.get("agent/turn-stopping")!({ agent: w.main, turn: 2, signal: new AbortController().signal });
  expect((await w.store.round(w.key))!.last_check?.verdict).toBe("PASS");
  expect(await readFile(join(f.scope.projectPath, round.last_check!.report), "utf8")).toBe(history);
  const metrics = await workMetrics(f.scope.projectPath, w.key);
  expect(metrics.evaluation_history).toHaveLength(2);
  expect(metrics.execution_actions.business_dispatches).toBe(2); // v2 member + original Judge continuation
  expect(w.executions()).toBe(4); // v1/v2 each exactly one business generation and one review
  const reopened = new WorkStore(f.scope.projectPath);
  expect((await reopened.observations(w.key)).filter(r => r.kind === "evaluation_record")).toEqual(metrics.evaluation_history);
});

it("R23/R24 patch并发/取消不串版本；QJ-004真实缺口仍拒收met；QJ-001算式矛盾保留反例", async () => {
  const w = await setup(), facts = await w.call("promax_rating_facts", { source_id: w.src.source_id }), items = links(facts);
  await writeFile(w.path(), report(items)); await w.receipt(items);
  const round = (await w.store.round(w.key))!;
  const base = { filename: "user_analysis.md", status: "draft_ready", summary: "局部更新", unverified: [], gaps: [], input_version: round.execution_version, evidence_links: [] };
  const a = { callId: "patch-a", agent: w.child("worker") }, b = { callId: "patch-b", agent: w.child("worker") };
  const tool = f.tools.get("promax_member_receipt")!;
  await tool.execute({ ...base, evidence_update: { mode: "patch", withdraw: [round.receipts!["user_analysis.md"]!.evidence_links![0]!.conclusion_id] } }, a);
  await tool.execute(base, b);
  const deps = { contract: async () => ({ artifacts: [] }), member: async () => "user_analysis", runtimeVersion: "test" };
  expect(await commitStructuredSubmission(a, { isError: false }, deps)).toMatchObject({ duplicate: false });
  expect(await commitStructuredSubmission(b, { isError: false }, deps)).toMatchObject({ rejected: [expect.stringContaining("并发")] });
  // Explicit replacement [] clears; absent/patch [] do not resurrect withdrawn links.
  await w.receipt([], { evidence_update: { mode: "replace" } });
  await w.receipt([]);
  expect((await w.store.round(w.key))!.receipts!["user_analysis.md"]!.evidence_links).toEqual([]);
  let current = (await w.store.round(w.key))!;
  await w.store.transitionRound(w.key, current, { ...current, phase: "checking", judge_round: 1, reviewed_hashes: { "user_analysis.md": sha(report(items)) }, allowed_members: ["quality_judge"], requirements_digest: current.execution_digest! });
  await w.dispatch("quality_judge", "judge"); current = (await w.store.round(w.key))!;
  const result = await f.submit("promax_check_result", { verdict: "PASS", review_request: current.review_request, input_version: current.execution_version, issues: [], rechecks: [], decisions: [], unverified: [], acceptance: { baseline_version: current.acceptance_baseline!.version, items: current.acceptance_scope!.map(id => ({ id, state: "met", evidence: "不应放行：当前凭证已撤回" })) } }, { callId: "qj004", agent: w.child("judge") });
  expect(result.isError).toBe(true); expect(result.value).toContain("程序复算凭证");
  expect((await w.store.round(w.key))!.check_results).toBeUndefined();
  await w.store.transitionRound(w.key, current, { ...current, phase: "generating", allowed_members: ["user_analysis"] });
  const late = { callId: "late", agent: w.child("worker") }; await tool.execute(base, late);
  await w.store.endStoppedRound(w.main.session.header.id, current.task_key!, current.revision, true);
  expect(await commitStructuredSubmission(late, { isError: false }, deps)).toMatchObject({ rejected: [expect.stringContaining("阶段")] });
  await expect(w.call("promax_rating_facts", { source_id: w.src.source_id })).rejects.toThrow("没有执行授权");
  const oldReport = parseJudgeReport(await readFile(join(historical, ".任务/产品任务/判定-r1.md"), "utf8")).report!;
  const qj001 = oldReport.issues.find(i => i.id === "QJ-001")!;
  expect(qj001.evidence).toContain("40"); expect(qj001.evidence).toContain("只有在包含 5 条");
  const rows = JSON.parse(await readFile(join(samples, "Promax实测-评分样本-v1.json"), "utf8"));
  const second = rows.filter((r: any) => r.rating === 2 && r.text === "材料引用位置不够明确，核对原文费时间。").length;
  const third = rows.filter((r: any) => r.rating === 3 && r.text === "能看到材料内容，希望引用位置更清楚。").length;
  expect([second, third, second + third, second + third + 5]).toEqual([15,25,40,45]);
  const secondReport = parseJudgeReport(await readFile(join(historical, ".任务/产品任务-2/判定-r1.md"), "utf8")).report!;
  const qj005 = secondReport.issues.find(i => i.id === "QJ-005")!;
  expect(qj005).toBeDefined(); expect(qj005.evidence).toContain("18");
  expect(18 + 1 + 4).toBe(23); expect(18 + 1 + 4).not.toBe(19); // 真构成错误不能因low或程序事实存在而忽略
  // Only this independently computable contradiction is labelled; not a whole-report business verdict.
});
