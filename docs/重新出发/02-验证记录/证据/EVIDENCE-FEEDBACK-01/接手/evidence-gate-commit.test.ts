import { afterEach, expect, it, vi } from "vitest";
import * as evidenceModule from "../src/evidence-links.ts";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import YAML from "yaml";
import { WorkStore, type MemberReceipt, type WorkRound } from "../src/work-store.ts";
import { policyFromRevision } from "../src/acceptance-baseline.ts";
import { stageStructuredSubmission, commitStructuredSubmission, renderCheckReport } from "../src/structured-results.ts";
import { acceptanceEvidence, acceptanceGateErrors, linksPath, readEvidenceLinks, readFrozenSources, verifyEvidenceLinks, type AcceptedEvidenceLink, type EvidenceLinkInput } from "../src/evidence-links.ts";
import { taskCompletion } from "../../promax-ui-console/src/effective-protocol.ts";
import { loadRuntimeSnapshot, resolveRuntimeSnapshot } from "../src/runtime-snapshot.ts";
import { workMetrics } from "../src/chain-metrics.ts";

const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const ARTIFACT_A = "# 比较\n\n产品 A 当前价格 10 元/月（用户材料）。\n\n产品 B 当前价格 12 元/月（用户材料）。\n";
const ARTIFACT_B = "# 用户分析\n\n本批样本 6 条，达标 3 条。\n";
const SOURCE = "第一行：背景\n第二行：产品 A 当前价格 10 元/月。\n第三行：产品 B 当前价格 12 元/月。\n";
const revision = {
  api_version: "promax.ai/v1alpha2", kind: "TeamRevision", metadata: { team_revision_id: "fixture@r7", status: "published" },
  spec: {
    artifacts: [
      { kind: "other", validation_kind: "product-discovery-report", relative_path: ".任务/{task_key}/产物快照/a.md", produced_by: "product_discovery" },
      { kind: "other", validation_kind: "user-analysis-report", relative_path: ".任务/{task_key}/产物快照/b.md", produced_by: "user_analysis" },
      { kind: "judge-report", validation_kind: "judge-report", relative_path: ".任务/{task_key}/判定-r{round}.md", produced_by: "quality_judge" },
    ],
    domain_rubrics: {
      "product-discovery-report": { rules: [{ rule_id: "TRACE", check: "主要比较判断有可比依据", evidence_obligation: { question: "双方依据是否可比", min_basis: "比较时点有效的双边依据" } }] },
      "user-analysis-report": { rules: [{ rule_id: "SECTIONS", check: "按顺序包含固定章节" }] },
    },
  },
};
const contract = { artifacts: [{ relativePath: "a.md", producedBy: "product_discovery" }, { relativePath: "b.md", producedBy: "user_analysis" }] };
const linkForA = (): EvidenceLinkInput => ({
  requirement_ids: ["R2", "D:TRACE"], conclusion: "产品 A 当前价格 10 元/月（用户材料）。", location: "产品 A 当前价格 10 元/月（用户材料）。",
  kind: "fact", evidence: [{ source_id: "SRC-001", range: "第 2 行", use: "当期价格" }],
});

async function fixture(first = "a.md", second = "b.md", numeric = false) {
  const activeContract = { artifacts: [{ relativePath: first, producedBy: "product_discovery" }, { relativePath: second, producedBy: "user_analysis" }] };
  const activeRevision = JSON.parse(JSON.stringify(revision).replaceAll("/a.md", `/${first}`).replaceAll("/b.md", `/${second}`));
  if (numeric) activeRevision.spec.domain_rubrics["product-discovery-report"].rules[0].evidence_basis = ["source_link", "numeric_recompute"];
  const root = await realpath(await mkdtemp(join(tmpdir(), "promax-gate-")));
  roots.push(root);
  const store = new WorkStore(root);
  const card = await store.create({ session_id: "main", project_id: "p", title: "门禁", shortname: "gate" });
  const key = card.work_key;
  await store.employeeMessage(key, "根据用户材料比较当前价格并给出依据", []);
  await store.propose(key, { intent: "execute", card_patch: {}, deliverables: [first, second], edit_request: null }, 2, activeContract);
  let round = (await store.round(key))!;
  await store.authorize(key, round.revision, "click", async () => {
    await mkdir(join(root, ".任务/t/产物快照"), { recursive: true });
    await mkdir(join(root, ".任务/t/输入/sources/SRC-001"), { recursive: true });
    await writeFile(join(root, ".任务/t/产物快照", first), ARTIFACT_A);
    await writeFile(join(root, ".任务/t/产物快照", second), ARTIFACT_B);
    await writeFile(join(root, ".任务/t/输入/sources/SRC-001/material.md"), SOURCE);
    await writeFile(join(root, ".任务/t/输入/manifest.yml"), YAML.stringify({
      api_version: "promax.ai/v1alpha2", kind: "EvidenceInputManifest",
      metadata: { task_key: "t", frozen: true, frozen_at: "2026-09-22T00:00:00.000Z" },
      spec: { source_root: ".任务/t/输入/sources", sources: [{ source_id: "SRC-001", relative_path: ".任务/t/输入/sources/SRC-001/material.md", sha256: sha(SOURCE), media_type: "text/markdown", origin_kind: "user-provided", use_qualification: "candidate", content_kind: "body" }] },
    }));
    return "t";
  }, {
    protocol: 2,
    requirement_policy: policyFromRevision(activeRevision, [first, second]),
    runtime_snapshot: ({ task_key, baseline_version, requirement_version }) => ({
      schema_version: 1, snapshot_id: "snapshot:fixture01", captured_at: "2026-09-22T00:00:00.000Z", capture_point: "test/authorize", work_key: key,
      fields: {
        record_schema: { schema_version: 1 },
        team_revision: { team_revision_id: "fixture@r7", revision: 7, definition_sha256: "def", preset_sha256: "preset", source: "test" },
        acceptance_baseline: { version: baseline_version, requirement_version },
        frozen_input: { task_key, manifest_sha256: "m1", frozen_at: "2026-09-22T00:00:00.000Z", source: "test" },
        loaded_components: [{ name: "promax-bundle", version: "0.1.76", evidence: "test" }],
        model_tool_config: { runtime_version: "0.1.76", model_route: null, config_source: "test", config_version: null, unknown_reason: "测试未上报" },
      },
      unknown: [], immutable: true,
    }),
  });
  round = (await store.round(key))!;
  const frozen = await readFrozenSources(root, "t");
  if ("error" in frozen) throw new Error(frozen.error);
  const verified = await verifyEvidenceLinks({ workspace: root, taskKey: "t", filename: first, artifactSha256: sha(ARTIFACT_A), links: [linkForA()], sources: frozen.sources, conclusions: [] });
  expect(verified.errors).toEqual([]);
  const receipt = (filename: string, content: string, links?: AcceptedEvidenceLink[], member = filename === first ? "product_discovery" : "user_analysis"): MemberReceipt => ({
    member, filename, sha256: sha(content), status: "draft_ready", phase: "generating", repair_round: 0,
    summary: "草稿", unverified: [], gaps: [], input_version: round.execution_version ?? 0, call_id: `call-${filename}-${randomUUID()}`, at: new Date().toISOString(),
    ...(links?.length ? { evidence_links: links, evidence_digest: sha(JSON.stringify(links)) } : {}),
  });
  return { root, store, key, round: () => store.round(key), verified: verified.verified, receipt, first, second, contract: activeContract, policy: policyFromRevision(activeRevision, [first, second]) };
}
function submission(f: Awaited<ReturnType<typeof fixture>>, filename: string, evidence_links: EvidenceLinkInput[], callId: string, extra: Record<string, unknown> = {}) {
  const member = filename === f.second ? "user_analysis" : "product_discovery";
  const exec = { callId, agent: { session: { header: { id: `child-${member}`, origin: "subagent", parentSession: "main", cwd: f.root } } } };
  const deps = { contract: async () => contract, member: async () => member, runtimeVersion: "test" };
  return {
    stage: async () => stageStructuredSubmission("promax_member_receipt", { filename, status: "draft_ready", summary: "草稿", gaps: [], unverified: [], input_version: (await f.round())!.execution_version, evidence_links, ...extra }, exec, deps),
    commit: () => commitStructuredSubmission(exec, { isError: false }, deps),
  };
}
it("R11/R12/R16 原始多关联并发提交、独立重新核验重试与持久身份", async () => {
  const f = await fixture();
  const links = (prefix: string, count: number) => Array.from({ length: count }, (_, n) => ({ ...linkForA(), conclusion: `${prefix}结论第${n + 1}条。`, location: `${prefix}结论第${n + 1}条。` }));
  const a = links("甲", 3), b = links("乙", 2);
  const verifier = vi.spyOn(evidenceModule, "verifyEvidenceLinks"); // 仅观察真实核验返回，不替换实现
  await writeFile(join(f.root, ".任务/t/产物快照/a.md"), a.map(l => l.conclusion).join("\n"));
  await writeFile(join(f.root, ".任务/t/产物快照/b.md"), b.map(l => l.conclusion).join("\n"));
  const sa = submission(f, "a.md", a, "multi-a"), sb = submission(f, "b.md", b, "multi-b");
  await Promise.all([sa.stage(), sb.stage()]);
  expect(Object.keys((await f.round())!.receipts ?? {})).toHaveLength(0);
  await Promise.all([sa.commit(), sb.commit()]);
  const before = (await f.round())!;
  const accepted = Object.values(before.receipts!).flatMap(r => r.evidence_links!);
  expect(new Set(accepted.map(l => l.conclusion_id)).size).toBe(5);
  expect(new Set(accepted.map(l => l.link_id)).size).toBe(5);
  expect(accepted.every(l => /^LNK-\d+$/u.test(l.link_id))).toBe(true);
  const statusBefore = await f.store.status(f.key);
  await new Promise(resolve => setTimeout(resolve, 5));
  const retry = submission(f, "a.md", a, "retry-a");
  await retry.stage();
  const reverified = await verifier.mock.results.at(-1)!.value as Awaited<ReturnType<typeof verifyEvidenceLinks>>;
  expect(reverified.verified[0]!.matched_at).not.toBe(before.receipts!["a.md"]!.evidence_links![0]!.matched_at);
  expect(reverified.verified[0]!.source_readback[0]!.verified_at).not.toBe(before.receipts!["a.md"]!.evidence_links![0]!.source_readback[0]!.verified_at);
  expect(await retry.commit()).toMatchObject({ duplicate: true });
  expect(await f.round()).toEqual(before);
  expect(await f.store.status(f.key)).toEqual(statusBefore);
  // 同一工具提交身份变载荷不可伪装重试。
  const conflict = submission(f, "a.md", a, "multi-a", { summary: "改变验收影响" });
  await conflict.stage();
  expect(await conflict.commit()).toMatchObject({ rejected: [expect.stringContaining("有效载荷/版本冲突")] });
  expect((await f.round())!.receipts).toEqual(before.receipts);
  // 同正文的新来源定位与 summary 必须保存；显式原身份修订。
  const revised = a.map((l, n) => ({ ...l, conclusion_id: before.receipts!["a.md"]!.evidence_links![n]!.conclusion_id, evidence: [{ source_id: "SRC-001", range: "第 3 行" }] }));
  const change = submission(f, "a.md", revised, "changed", { summary: "新口径说明" });
  await change.stage(); await change.commit();
  const current = (await f.round())!;
  expect(current.receipts!["a.md"]!.summary).toBe("新口径说明");
  expect(current.receipts!["a.md"]!.evidence_links!.map(l => l.conclusion_id)).toEqual(before.receipts!["a.md"]!.evidence_links!.map(l => l.conclusion_id));
  const index = await f.store.evidenceLinks(f.key);
  await rm(linksPath(f.root, "t"));
  const rebuilt = await f.store.evidenceLinks(f.key);
  expect(rebuilt.artifacts).toEqual(index.artifacts);
  expect(rebuilt.conclusions).toEqual(index.conclusions);
});

it("R12 提交间来源变化与取消：旧stage拒收，不占号不留假登记", async () => {
  const f = await fixture();
  const s = submission(f, "a.md", [linkForA()], "source-drift"); await s.stage();
  const path = join(f.root, ".任务/t/输入/sources/SRC-001/material.md");
  await writeFile(path, SOURCE + "新增来源版本\n");
  expect(await s.commit()).toMatchObject({ rejected: [expect.stringContaining("哈希不符")] });
  expect((await f.round())!.receipts).toBeUndefined();
  const manifestPath = join(f.root, ".任务/t/输入/manifest.yml");
  const manifest = YAML.parse(await readFile(manifestPath, "utf8"));
  manifest.spec.sources[0].sha256 = sha(SOURCE + "新增来源版本\n");
  await writeFile(manifestPath, YAML.stringify(manifest));
  const current = submission(f, "a.md", [linkForA()], "new-source-version"); await current.stage();
  expect(await current.commit()).toMatchObject({ duplicate: false, conclusion_ids: ["CNL-001"] });
  const cancelled = submission(f, "a.md", [linkForA()], "cancelled", { summary: "不应被保存" }); await cancelled.stage();
  const round = (await f.round())!;
  await f.store.endStoppedRound("main", "t", round.revision, true);
  expect(await cancelled.commit()).toMatchObject({ rejected: [expect.stringContaining("阶段已变化")] });
  expect((await f.round())!.receipts!["a.md"]!.summary).toBe("草稿");
});

it("R16 z.md先登记、a.md后登记及历史修订/删除索引不重编号", async () => {
  const f = await fixture("z.md", "a.md");
  const z = submission(f, "z.md", [linkForA()], "z-first"); await z.stage(); await z.commit();
  const before = (await f.round())!.receipts!["z.md"]!.evidence_links![0]!;
  const a = submission(f, "a.md", [{ ...linkForA(), requirement_ids: ["R2"], conclusion: "本批样本 6 条，达标 3 条。", location: "本批样本 6 条，达标 3 条。" }], "a-second"); await a.stage(); await a.commit();
  const unchanged = (await f.store.evidenceLinks(f.key)).artifacts.find(a => a.filename === "z.md")!.links[0]!;
  expect(unchanged.link_id).toBe(before.link_id);
  await writeFile(join(f.root, ".任务/t/产物快照/z.md"), ARTIFACT_A + "\n修订备注\n");
  const revision = submission(f, "z.md", [{ ...linkForA(), conclusion_id: before.conclusion_id }], "z-revised"); await revision.stage(); await revision.commit();
  const round = (await f.round())!;
  const old = round.receipt_history!.find(r => r.filename === "z.md")!.evidence_links![0]!;
  expect(old.link_id).toBe(before.link_id);
  expect(round.receipts!["z.md"]!.evidence_links![0]!.link_id).not.toBe(before.link_id);
  await rm(linksPath(f.root, "t"));
  const rebuilt = await f.store.evidenceLinks(f.key);
  const cnl = rebuilt.conclusions.find(c => c.conclusion_id === before.conclusion_id)!;
  expect(cnl.revisions.map(r => r.link_id)).toContain(before.link_id);
  expect(cnl.revisions.map(r => r.artifact_sha256)).toContain(sha(ARTIFACT_A));
  expect(await f.round()).toEqual(round);
  await f.store.endStoppedRound("main", "t", round.revision, true);
  const q = await f.store.employeeMessage(f.key, "只问已有草稿，不改范围", []);
  await f.store.propose(f.key, { intent: "answer", card_patch: {}, deliverables: [], edit_request: null, handled_events: [{ event_id: q.event.id, intent: "question", impact: "normal", note: "普通追问" }] }, 20, f.contract);
  expect((await f.round())!.receipts).toBeUndefined();
  expect((await f.round())!.receipt_archives!.t!.length).toBeGreaterThan(1);
  await rm(linksPath(f.root, "t"));
  const historical = await f.store.evidenceLinks(f.key, "t");
  expect(historical.conclusions).toEqual(rebuilt.conclusions);
  expect(historical.artifacts).toEqual(rebuilt.artifacts);
  await f.store.propose(f.key, { intent: "execute", card_patch: {}, deliverables: [f.first], edit_request: null }, 21, f.contract);
  const next = (await f.round())!;
  await f.store.authorize(f.key, next.revision, "click", async () => {
    await mkdir(join(f.root, ".任务/t2/产物快照"), { recursive: true });
    await writeFile(join(f.root, ".任务/t2/产物快照", f.first), ARTIFACT_A);
    return "t2";
  }, { protocol: 2 });
  await rm(linksPath(f.root, "t"));
  expect((await f.store.evidenceLinks(f.key, "t")).artifacts).toEqual(rebuilt.artifacts);
});

const checkRecord = (round: WorkRound, items: Array<{ id: string; state: "met" | "unmet" | "unverifiable"; evidence?: string }>) => ({
  judge_round: round.judge_round ?? 1, verdict: "PASS" as const, scope: round.check_scope ?? "",
  reviewed_hashes: round.reviewed_hashes!, issues: [], rechecks: [], unverified: [], decisions: [],
  acceptance: { baseline_version: round.acceptance_baseline!.version, items: items.map((item) => ({ ...item, evidence: item.evidence ?? "当前版本依据" })) },
  report: `.任务/t/判定-r${round.judge_round ?? 1}.md`, input_version: round.execution_version ?? 0, call_id: "judge-1", at: new Date().toISOString(),
  ...(round.review_request ? { review_request: round.review_request } : {}),
});

it("R01 必需依据门禁：无关联的 met 在提交与接受两处都被拒；有关联时通过；结构项不被误阻断", async () => {
  const f = await fixture();
  // 成员回执：a.md 带已核验关联，b.md 无关联。
  await f.store.acceptReceipt(f.key, f.receipt("a.md", ARTIFACT_A, f.verified), "t");
  await f.store.acceptReceipt(f.key, f.receipt("b.md", ARTIFACT_B), "t");
  const index = await f.store.evidenceLinks(f.key);
  expect(index.artifacts.map((artifact) => artifact.filename).sort()).toEqual(["a.md", "b.md"]);
  expect(index.artifacts.find((artifact) => artifact.filename === "a.md")!.links[0]).toMatchObject({ requirement_ids: ["R2", "D:TRACE"], conclusion_id: "CNL-001" });

  // 进入检查。
  let round = (await f.store.round(f.key))!;
  await f.store.transitionRound(f.key, round, { ...round, phase: "checking", judge_round: 1, reviewed_hashes: { "a.md": sha(ARTIFACT_A), "b.md": sha(ARTIFACT_B) }, requirements_digest: round.execution_digest!, allowed_members: ["quality_judge"] });
  round = (await f.store.round(f.key))!;
  const items = round.acceptance_scope!.map((id) => ({ id, state: "met" as const }));
  // 权威接受：R2/D:TRACE 有依据 → 通过。
  await expect(f.store.acceptCheckResult(f.key, checkRecord(round, items), "t", "report")).resolves.toMatchObject({ duplicate: false });
  const stored = (await f.store.round(f.key))!.check_results!["1"]!;
  expect(stored.acceptance_evidence!["D:TRACE"]!.available).toEqual(expect.arrayContaining(["source_link"]));
  const card = await f.store.read(f.key);
  const completion = taskCompletion(card, round.acceptance_baseline, stored, { "a.md": sha(ARTIFACT_A), "b.md": sha(ARTIFACT_B) });
  expect(completion.state).toBe("complete");
  expect(completion.counts).toMatchObject({ met: completion.counts.denominator });

  // 无关联的工作：同一套 met 被拒收，错误指向具体必需项。
  const g = await fixture();
  await g.store.acceptReceipt(g.key, g.receipt("a.md", ARTIFACT_A), "t");
  await g.store.acceptReceipt(g.key, g.receipt("b.md", ARTIFACT_B), "t");
  let ground = (await g.store.round(g.key))!;
  await g.store.transitionRound(g.key, ground, { ...ground, phase: "checking", judge_round: 1, reviewed_hashes: { "a.md": sha(ARTIFACT_A), "b.md": sha(ARTIFACT_B) }, requirements_digest: ground.execution_digest!, allowed_members: ["quality_judge"] });
  ground = (await g.store.round(g.key))!;
  const gItems = ground.acceptance_scope!.map((id) => ({ id, state: "met" as const }));
  await expect(g.store.acceptCheckResult(g.key, checkRecord(ground, gItems), "t", "report")).rejects.toThrow(/缺少必需依据/);
  // 结构项（无 evidence_basis）不被额外 SRC 要求误阻断：只把有依据的项降级。
  const gIndex = acceptanceEvidence(ground.acceptance_baseline!, ground.receipts);
  expect(gIndex["D:SECTIONS"]!.available).toEqual([]);
  const gCard = await g.store.read(g.key);
  const gCompletion = taskCompletion(gCard, ground.acceptance_baseline, { ...checkRecord(ground, gItems), acceptance_evidence: gIndex, reviewed_hashes: ground.reviewed_hashes! }, { "a.md": sha(ARTIFACT_A), "b.md": sha(ARTIFACT_B) });
  expect(gCompletion.items.find((row) => row.id === "D:TRACE")).toMatchObject({ state: "unverifiable", basis_missing: [expect.stringContaining("来源关联")] });
  expect(gCompletion.items.find((row) => row.id === "D:SECTIONS")).toMatchObject({ state: "met" });
});

it("R02/R03 一致提交：正文不变补关联生效、原样重试不重复、两成员并发都保留、派生索引可从回执重建", async () => {
  const f = await fixture();
  const bare = f.receipt("a.md", ARTIFACT_A);
  await expect(f.store.acceptReceipt(f.key, bare, "t")).resolves.toMatchObject({ duplicate: false });
  // 同正文补关联：不能按重复跳过。
  await expect(f.store.acceptReceipt(f.key, f.receipt("a.md", ARTIFACT_A, f.verified), "t")).resolves.toMatchObject({ duplicate: false, index_state: expect.stringMatching(/rebuilt|current/) });
  // 原样重试：不重复写记录/编号。
  await expect(f.store.acceptReceipt(f.key, f.receipt("a.md", ARTIFACT_A, f.verified), "t")).resolves.toMatchObject({ duplicate: true });
  const index = await f.store.evidenceLinks(f.key);
  expect(index.artifacts).toHaveLength(1);
  expect(index.artifacts[0]!.links).toHaveLength(1);
  expect(index.conclusions).toHaveLength(1);

  // 两个成员并发提交不同成果：双方回执与关联都保留。
  const g = await fixture();
  await Promise.all([
    g.store.acceptReceipt(g.key, g.receipt("a.md", ARTIFACT_A, g.verified), "t"),
    g.store.acceptReceipt(g.key, g.receipt("b.md", ARTIFACT_B), "t"),
  ]);
  const both = await g.store.evidenceLinks(g.key);
  expect(both.artifacts.map((artifact) => artifact.filename).sort()).toEqual(["a.md", "b.md"]);
  const roundReceipts = Object.keys((await g.store.round(g.key))!.receipts ?? {}).sort();
  expect(roundReceipts).toEqual(["a.md", "b.md"]);

  // 派生索引被删/改坏：按回执摘要重建，编号稳定。
  await rm(linksPath(g.root, "t"), { force: true });
  const rebuilt = await g.store.evidenceLinks(g.key);
  expect(rebuilt.artifacts.find((artifact) => artifact.filename === "a.md")!.links[0]!.link_id).toBe(both.artifacts.find((artifact) => artifact.filename === "a.md")!.links[0]!.link_id);
  // 索引写入失败（路径被目录占住）不回滚已接受回执；恢复后重建。
  const h = await fixture();
  await mkdir(linksPath(h.root, "t"), { recursive: true });
  await expect(h.store.acceptReceipt(h.key, h.receipt("a.md", ARTIFACT_A, h.verified), "t")).resolves.toMatchObject({ duplicate: false, index_state: "pending_rebuild" });
  expect((await h.store.round(h.key))!.receipts!["a.md"]!.evidence_links).toHaveLength(1);
  await rm(linksPath(h.root, "t"), { recursive: true, force: true });
  expect((await h.store.evidenceLinks(h.key)).artifacts[0]!.links).toHaveLength(1);
});

it("R05 版本前置条件：被审字节变化后旧 met 不进当前分子，未受影响项按依赖保留", async () => {
  const f = await fixture();
  await f.store.acceptReceipt(f.key, f.receipt("a.md", ARTIFACT_A, f.verified), "t");
  await f.store.acceptReceipt(f.key, f.receipt("b.md", ARTIFACT_B), "t");
  let round = (await f.store.round(f.key))!;
  await f.store.transitionRound(f.key, round, { ...round, phase: "checking", judge_round: 1, reviewed_hashes: { "a.md": sha(ARTIFACT_A), "b.md": sha(ARTIFACT_B) }, requirements_digest: round.execution_digest!, allowed_members: ["quality_judge"] });
  round = (await f.store.round(f.key))!;
  const items = round.acceptance_scope!.map((id) => ({ id, state: "met" as const }));
  await f.store.acceptCheckResult(f.key, checkRecord(round, items), "t", "report");
  const stored = (await f.store.round(f.key))!.check_results!["1"]!;
  const card = await f.store.read(f.key);
  // a.md 变化（h2），b.md 不变。
  const drifted = taskCompletion(card, round.acceptance_baseline, stored, { "a.md": "h2", "b.md": sha(ARTIFACT_B) });
  const aRows = drifted.items.filter((row) => row.files.includes("a.md") && row.necessity === "required");
  const bRows = drifted.items.filter((row) => row.files.includes("b.md") && !row.files.includes("a.md") && row.necessity === "required");
  expect(aRows.length).toBeGreaterThan(0);
  for (const row of aRows) expect(row).toMatchObject({ state: "no_result", reason: expect.objectContaining({ code: "version_conflict" }) });
  for (const row of bRows) expect(row.state).toBe("met");
  expect(drifted.counts.met).toBeLessThan(drifted.counts.denominator);
  // 要求版本变化：全部受影响项记版本冲突。
  const staleCard = { ...card, requirement_version: (card.requirement_version ?? 0) + 1 };
  const stale = taskCompletion(staleCard, round.acceptance_baseline, stored, { "a.md": sha(ARTIFACT_A), "b.md": sha(ARTIFACT_B) });
  expect(stale.counts.met).toBe(0);
  expect(stale.items.filter((row) => row.necessity === "required").every((row) => row.state === "no_result" && row.reason?.code === "version_conflict")).toBe(true);
});

it("R07 运行快照：按身份不可变留存、讨论回合不丢、评审绑定与指标可回查", async () => {
  const f = await fixture();
  const persisted = join(f.root, ".工作", f.key, "运行快照");
  expect((await readFile(join(persisted, "snapshot_fixture01.yml"), "utf8"))).toContain("fixture@r7");
  const round = (await f.store.round(f.key))!;
  expect(round.snapshot_ids).toEqual(["snapshot:fixture01"]);
  expect(resolveRuntimeSnapshot(round)).toMatchObject({ status: "present" });
  expect(await loadRuntimeSnapshot(f.root, f.key, "snapshot:fixture01")).toMatchObject({ snapshot_id: "snapshot:fixture01" });
  // 转入普通讨论：身份与内容都保留。
  await f.store.endStoppedRound("main", round.task_key!, round.revision, true);
  const discussion = (await f.store.round(f.key))!;
  expect(discussion.snapshot_ids).toEqual(["snapshot:fixture01"]);
  expect(discussion.runtime_snapshot?.snapshot_id).toBe("snapshot:fixture01");
  // 评审绑定引用同一快照身份。
  await f.store.employeeMessage(f.key, "继续", []);
  await f.store.propose(f.key, { intent: "execute", card_patch: {}, deliverables: ["a.md"], edit_request: null }, 30, contract);
  const proposed = (await f.store.round(f.key))!;
  await f.store.authorize(f.key, proposed.revision, "click", async () => {
    await mkdir(join(f.root, ".任务/t2/产物快照"), { recursive: true });
    await writeFile(join(f.root, ".任务/t2/产物快照/a.md"), ARTIFACT_A);
    return "t2";
  }, { protocol: 2 });
  let next = (await f.store.round(f.key))!;
  await f.store.transitionRound(f.key, next, { ...next, phase: "checking", judge_round: 1, reviewed_hashes: { "a.md": sha(ARTIFACT_A) }, requirements_digest: next.execution_digest!, allowed_members: ["quality_judge"] });
  next = (await f.store.round(f.key))!;
  const binding = (await f.store.reviews(f.key)).bindings[next.review_group!]!;
  expect(binding.snapshot_id).toBe("snapshot:fixture01");
  // 指标读取快照身份；导出内容（回合文件）可解析引用。
  const metrics = await workMetrics(f.root, f.key);
  expect(metrics.snapshot_ids).toEqual(["snapshot:fixture01"]);
  expect(metrics.runtime_snapshot).toMatchObject({ snapshot_id: "snapshot:fixture01" });
  expect(YAML.parse(await readFile(join(f.root, ".工作", f.key, "回合.yml"), "utf8"))).toMatchObject({ snapshot_ids: ["snapshot:fixture01"] });
});

it("R10/R02 提交入口：显式身份修订保持 CNL 不变，跨成果身份冲突拒收，回显只报告已接受事实", async () => {
  const f = await fixture();
  const stage = async (raw: unknown, callId: string, member: string) => {
    const exec = { callId, agent: { session: { header: { id: "child", origin: "subagent", parentSession: "main", cwd: f.root } } } };
    return stageStructuredSubmission("promax_member_receipt", raw, exec, { contract: async () => contract, member: async () => member, runtimeVersion: "test" });
  };
  const base = { filename: "a.md", status: "draft_ready", summary: "草稿", unverified: [], gaps: [], input_version: (await f.round())!.execution_version ?? 0 };
  const first = await stage({ ...base, evidence_links: [linkForA()] }, "s1", "product_discovery");
  expect(first.note).toContain("身份");
  await commitStructuredSubmission({ callId: "s1", agent: { session: { header: { id: "child" } } } } as never, { isError: false }, { contract: async () => contract, member: async () => "product_discovery", runtimeVersion: "test" });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const accepted = await f.store.evidenceLinks(f.key);
  const conclusionId = accepted.conclusions[0]!.conclusion_id;
  expect(conclusionId).toBe("CNL-001");
  // 显式引用身份并改措辞/移动位置：身份保持，历史保留（成果版本变化也不换身份）。
  await writeFile(join(f.root, ".任务/t/产物快照/a.md"), ARTIFACT_A.replace("产品 A 当前价格 10 元/月（用户材料）。", "产品 A 现价 10 元/月（用户材料）。"));
  const revised = { ...base, evidence_links: [{ ...linkForA(), conclusion_id: conclusionId, conclusion: "产品 A 现价 10 元/月（用户材料）。", location: "产品 A 现价 10 元/月（用户材料）。", supersedes: [] }] };
  await expect(stage(revised, "s2", "product_discovery")).resolves.toMatchObject({ recorded: true });
  await commitStructuredSubmission({ callId: "s2", agent: { session: { header: { id: "child" } } } } as never, { isError: false }, { contract: async () => contract, member: async () => "product_discovery", runtimeVersion: "test" });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const after = await f.store.evidenceLinks(f.key);
  expect(after.conclusions).toHaveLength(1);
  expect(after.conclusions[0]!.conclusion_id).toBe(conclusionId);
  expect(after.conclusions[0]!.revisions.length).toBeGreaterThanOrEqual(2);
  // 跨成果引用同一身份：拒收。
  await expect(stage({ ...base, filename: "b.md", evidence_links: [{ requirement_ids: ["R2"], conclusion: "本批样本 6 条，达标 3 条。", location: "本批样本 6 条，达标 3 条。", conclusion_id: conclusionId, evidence: [{ source_id: "SRC-001", range: "第 2 行" }] }] }, "s3", "user_analysis")).rejects.toThrow(/不能跨成果引用/);
});

it.each([
  [{ http_status: 403, fetch_status: "success" }, false],
  [{ fetch_status: "failed" }, false],
  [{ content_kind: "search_index" }, false],
  [{}, false],
  [{ origin_kind: "user-provided" }, true],
] as const)("R14 历史来源经stage/commit与门禁：%j", async (metadata, usable) => {
  const f = await fixture();
  const path = join(f.root, ".任务/t/输入/manifest.yml");
  const manifest = YAML.parse(await readFile(path, "utf8"));
  const { use_qualification, content_kind, origin_kind, ...base } = manifest.spec.sources[0];
  manifest.spec.sources[0] = { ...base, origin_kind: "web-snapshot", ...metadata };
  await writeFile(path, YAML.stringify(manifest));
  const s = submission(f, "a.md", [linkForA()], "legacy");
  await s.stage(); expect(await s.commit()).toMatchObject({ duplicate: false });
  let r = (await f.round())!;
  await f.store.transitionRound(f.key, r, { ...r, phase: "checking", judge_round: 1, reviewed_hashes: { "a.md": sha(ARTIFACT_A), "b.md": sha(ARTIFACT_B) }, requirements_digest: r.execution_digest! });
  r = (await f.round())!;
  const check = f.store.acceptCheckResult(f.key, checkRecord(r, r.acceptance_scope!.map(id => ({ id, state: "met" }))), "t", "report");
  if (usable) await expect(check).resolves.toMatchObject({ duplicate: false });
  else await expect(check).rejects.toThrow(/缺少必需依据/u);
  expect(YAML.parse(await readFile(path, "utf8"))).toEqual(manifest); // 不清洗原记录
});

it("R13 冻结输入驱动评分复算：单位/计数/缺失/分母/规格按真实提交门禁处理", async () => {
  const f = await fixture();
  const path = join(f.root, ".任务/t/输入/manifest.yml");
  const manifest = YAML.parse(await readFile(path, "utf8"));
  const freeze = async (rows: unknown[]) => {
    const content = JSON.stringify(rows);
    await writeFile(join(f.root, manifest.spec.sources[0].relative_path), content);
    manifest.spec.sources[0].sha256 = sha(content);
    await writeFile(path, YAML.stringify(manifest));
  };
  await freeze([{ rating: 1 }, { rating: 5 }, { rating: 4 }, {}, { rating: "1" }]);
  const spec = { input: "SRC-001", field: "rating", numerator: "1", denominator: "3", result: "33.33%", formula: "rating_1_2_ratio", unit: "percent", rounding: "half_up:2", filter: "all_rows_no_dedup", missing_rule: "exclude_invalid_rating", window: "frozen_input" };
  const submit = (over: Record<string, string>, id: string) => submission(f, "a.md", [{ ...linkForA(), evidence: [{ source_id: "SRC-001", range: "第 1 行" }], numeric_spec: { ...spec, ...over } }], id);
  const bad = submit({ numerator: "2", result: "66.67%" }, "fake-counts");
  await expect(bad.stage()).rejects.toThrow(/与可复算值/);
  const good = submit({}, "real-counts"); await good.stage(); expect(await good.commit()).toMatchObject({ duplicate: false });
  let r = (await f.round())!;
  expect(r.receipts!["a.md"]!.evidence_links![0]!.numeric_check).toMatchObject({ status: "recomputed", computed: 33.33, matched: true, counts: { numerator: 1, denominator: 3, missing_rows: [4, 5] }, input: { sha256: manifest.spec.sources[0].sha256 } });
  const reference = JSON.parse(execFileSync("/usr/bin/python3", [join(process.cwd(), "../promax-agent/agents/user-analysis/skills/app-market-sentiment/resources/scripts/frozen_rating_stats.py"), "--input", join(f.root, manifest.spec.sources[0].relative_path)], { encoding: "utf8" }));
  expect(r.receipts!["a.md"]!.evidence_links![0]!.numeric_check!.counts).toMatchObject({ denominator: reference.denominator, numerator: reference.counts["1"] + reference.counts["2"], missing_rows: reference.missing_rows });
  const numericBaseline = structuredClone(r.acceptance_baseline!);
  numericBaseline.items.find(item => item.id === "D:TRACE")!.evidence_basis = ["source_link", "numeric_recompute"];
  expect(acceptanceEvidence(numericBaseline, r.receipts)["D:TRACE"]!.available).toContain("numeric_recompute");
  await freeze([{ rating: 1 }, { rating: 5 }]);
  for (const [n, over, recomputed] of [
    ["ratio", { unit: "ratio", result: "0.5", denominator: "2" }, true],
    ["percent", { result: "50%", denominator: "2" }, true],
    ["unit-mismatch", { result: "0.5", denominator: "2" }, false],
    ["unsupported", { formula: "eval(code)", denominator: "2" }, false],
    ["filter-change", { filter: "dedup", denominator: "2" }, false],
  ] as const) {
    const s = submit(over, n); await s.stage(); expect(await s.commit()).toMatchObject({ duplicate: false });
    r = (await f.round())!;
    const available = acceptanceEvidence(numericBaseline, r.receipts)["D:TRACE"]!.available;
    expect(available.includes("numeric_recompute"), n).toBe(recomputed);
    expect(acceptanceGateErrors(numericBaseline, ["D:TRACE"], { items: [{ id: "D:TRACE", state: "met" }] }, acceptanceEvidence(numericBaseline, r.receipts), () => true).length).toBe(recomputed ? 0 : 1);
  }
  await freeze([{}, { rating: true }]);
  const zero = submit({}, "zero"); await zero.stage(); await zero.commit();
  expect((await f.round())!.receipts!["a.md"]!.evidence_links![0]!.numeric_check).toMatchObject({ status: "unsupported", counts: { denominator: 0 } });
});

it("R19 完整JSON短定位经原始stage/commit→复算凭证→权威验收门禁；格式不影响计数", async () => {
  const rows = Array.from({ length: 320 }, (_, i) => ({ rating: i % 2 ? 5 : 1, test_only: i }));
  const checks = [];
  for (const content of [JSON.stringify(rows, null, 2), JSON.stringify(rows)]) {
    const f = await fixture("a.md", "b.md", true);
    const path = join(f.root, ".任务/t/输入/manifest.yml");
    const manifest = YAML.parse(await readFile(path, "utf8"));
    manifest.spec.sources[0].sha256 = sha(content);
    await writeFile(join(f.root, manifest.spec.sources[0].relative_path), content);
    await writeFile(path, YAML.stringify(manifest));
    const link = { ...linkForA(), evidence: [{ source_id: "SRC-001", range: "json:all" }], numeric_spec: { input: "SRC-001", field: "rating", formula: "rating_1_2_ratio", unit: "ratio", result: "0.5", rounding: "half_up:2", filter: "all_rows_no_dedup", missing_rule: "exclude_invalid_rating", window: "frozen_input" } };
    if (content.includes("\n")) {
      expect(content.split("\n").length).toBeGreaterThanOrEqual(300);
      expect(content.length).toBeGreaterThan(400);
      await expect(submission(f, "a.md", [{ ...link, evidence: [{ source_id: "SRC-001", range: `第1-${content.split("\n").length}行` }] }], "long-lines").stage()).rejects.toThrow(/定位区间过大/u);
    }
    const s = submission(f, "a.md", [link], "whole-json");
    const staged = await s.stage();
    expect(staged.note).toContain("记录320，分子160/分母320");
    expect(staged.note).toContain("非完整输入");
    expect(staged.note.length).toBeLessThan(2000);
    expect(await s.commit()).toMatchObject({ duplicate: false });
    let r = (await f.round())!;
    const saved = r.receipts!["a.md"]!.evidence_links![0]!;
    expect(saved.numeric_check).toMatchObject({ status: "recomputed", matched: true, computed: 0.5, counts: { rows: 320, numerator: 160, denominator: 320 }, input: { source_id: "SRC-001", sha256: sha(content), range: "json:all", selected_sha256: sha(content) } });
    expect(saved.source_readback[0]!.snippet.length).toBeLessThanOrEqual(2000);
    checks.push(saved.numeric_check!.counts);
    await f.store.transitionRound(f.key, r, { ...r, phase: "checking", judge_round: 1, reviewed_hashes: { "a.md": sha(ARTIFACT_A), "b.md": sha(ARTIFACT_B) }, requirements_digest: r.execution_digest! });
    r = (await f.round())!;
    await expect(f.store.acceptCheckResult(f.key, checkRecord(r, r.acceptance_scope!.map(id => ({ id, state: "met" }))), "t", "report")).resolves.toMatchObject({ duplicate: false });
    expect((await f.round())!.check_results!["1"]!.acceptance_evidence!["D:TRACE"]!.available).toContain("numeric_recompute");
  }
  expect(checks[0]).toEqual(checks[1]);
});

it("R19 资源上限、非法路径/哈希与不适用完整定位仍拒收，不生成成功凭证", async () => {
  for (const mode of ["bytes", "records", "escape", "absolute", "hash", "no-spec", "snippet-limit"] as const) {
    const f = await fixture("a.md", "b.md", true);
    const path = join(f.root, ".任务/t/输入/manifest.yml");
    const manifest = YAML.parse(await readFile(path, "utf8"));
    const content = mode === "bytes" ? " ".repeat(8 * 1024 * 1024 + 1) : JSON.stringify(Array.from({ length: mode === "records" ? 100_001 : 2 }, () => ({ rating: 1 })));
    await writeFile(join(f.root, manifest.spec.sources[0].relative_path), content);
    manifest.spec.sources[0].sha256 = mode === "hash" ? "0".repeat(64) : sha(content);
    if (mode === "escape") manifest.spec.sources[0].relative_path = "../outside.json";
    if (mode === "absolute") manifest.spec.sources[0].relative_path = join(f.root, manifest.spec.sources[0].relative_path);
    await writeFile(path, YAML.stringify(manifest));
    const link: EvidenceLinkInput = { ...linkForA(), evidence: [{ source_id: "SRC-001", range: mode === "snippet-limit" ? "a".repeat(401) : "json:all" }], ...(mode === "no-spec" ? {} : { numeric_spec: { input: "SRC-001", field: "rating", formula: "rating_1_2_ratio", unit: "ratio", result: "1", rounding: "half_up:2", filter: "all_rows_no_dedup", missing_rule: "exclude_invalid_rating", window: "frozen_input" } }) };
    const s = submission(f, "a.md", [link], `limit-${mode}`);
    if (mode === "records") {
      await s.stage(); await s.commit();
      let r = (await f.round())!;
      expect(r.receipts!["a.md"]!.evidence_links![0]!.numeric_check).toMatchObject({ status: "unsupported", reason: expect.stringContaining("100000") });
      await f.store.transitionRound(f.key, r, { ...r, phase: "checking", judge_round: 1, reviewed_hashes: { "a.md": sha(ARTIFACT_A), "b.md": sha(ARTIFACT_B) }, requirements_digest: r.execution_digest! });
      r = (await f.round())!;
      await expect(f.store.acceptCheckResult(f.key, checkRecord(r, r.acceptance_scope!.map(id => ({ id, state: "met" }))), "t", "report")).rejects.toThrow(/程序复算凭证/u);
    } else {
      await expect(s.stage(), mode).rejects.toThrow(/资源限制|路径|哈希不符|numeric_spec|400/u);
      expect((await f.round())!.receipts).toBeUndefined();
    }
  }
});

it("R01 提交入口：检查结果判 met 但缺依据时，stage 当场退回并给具体条目", async () => {
  const f = await fixture();
  await f.store.acceptReceipt(f.key, f.receipt("a.md", ARTIFACT_A), "t");
  await f.store.acceptReceipt(f.key, f.receipt("b.md", ARTIFACT_B), "t");
  let round = (await f.store.round(f.key))!;
  await f.store.transitionRound(f.key, round, { ...round, phase: "checking", judge_round: 1, reviewed_hashes: { "a.md": sha(ARTIFACT_A), "b.md": sha(ARTIFACT_B) }, requirements_digest: round.execution_digest!, allowed_members: ["quality_judge"] });
  round = (await f.store.round(f.key))!;
  const items = round.acceptance_scope!.map((id) => ({ id, state: "met", evidence: "依据" }));
  const exec = { callId: "judge-1", agent: { session: { header: { id: "judge", origin: "subagent", parentSession: "main", cwd: f.root } } } };
  await expect(stageStructuredSubmission("promax_check_result", {
    verdict: "PASS", issues: [], unverified: [], decisions: [], input_version: round.execution_version, review_request: round.review_request,
    acceptance: { baseline_version: round.acceptance_baseline!.version, items },
  }, exec, { contract: async () => contract, member: async () => "quality_judge", runtimeVersion: "test" })).rejects.toThrow(/缺少必需依据/);
  // 降为 unverifiable 后可以提交（诚实缺口不被门禁挡住）。
  const honest = items.map((item) => ({ ...item, state: item.id === "D:TRACE" || item.id === "R2" ? "unverifiable" as const : item.state }));
  await expect(stageStructuredSubmission("promax_check_result", {
    verdict: "INCOMPLETE", issues: [], unverified: [{ item: "比较依据", reason: "缺来源关联", requirement_ids: ["R2"], impact: "blocking" }], decisions: [], input_version: round.execution_version, review_request: round.review_request,
    acceptance: { baseline_version: round.acceptance_baseline!.version, items: honest },
  }, exec, { contract: async () => contract, member: async () => "quality_judge", runtimeVersion: "test" })).resolves.toMatchObject({ recorded: true });
  expect((await readEvidenceLinks(f.root, "t")).artifacts).toHaveLength(2);
  expect(renderCheckReport({ ...checkRecord(round, items.map((item) => ({ ...item, state: item.state as "met" | "unmet" | "unverifiable" }))), acceptance_evidence: {} })).toContain("逐项验收");
});
