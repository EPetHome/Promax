import { afterEach, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { WorkStore } from "../src/work-store.ts";
import { buildRuntimeSnapshot } from "../src/runtime-snapshot.ts";
import { stageStructuredSubmission, commitStructuredSubmission, renderCheckReport } from "../src/structured-results.ts";
import { validateJudgeResult } from "../src/judge-evidence.ts";
import type { CheckResultRecord, WorkRound } from "../src/work-store.ts";
import { emptyReviews } from "../../promax-ui-console/src/review-protocol.ts";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const text = "# 分类\n1.5 是 non_integer。\n0/6/-1 是 out_of_range。\n";
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "judge-evidence-")); roots.push(root);
  await mkdir(join(root, ".任务/t/产物快照"), { recursive: true });
  await writeFile(join(root, ".任务/t/产物快照/a.md"), text);
  const round = { task_key: "t", reviewed_hashes: { "a.md": sha(text) }, acceptance_scope: ["R1"], acceptance_baseline: { version: "v", items: [{ id: "R1", files: ["a.md"], required: true }] } } as unknown as WorkRound;
  const issue = { id: "J1", artifact: "a.md", kind: "defect", severity: "medium", location: "分类", evidence: "分类错", impact: "误报", fix: "复核", basis: "quoted", citations: [{ file: "a.md", version: "current", line_start: 2, line_end: 2, quote: "1.5 是 non_integer。" }] } as const;
  const record = { judge_round: 1, verdict: "REVISION_REQUIRED", scope: "test", reviewed_hashes: round.reviewed_hashes, issues: [issue], rechecks: [], unverified: [], decisions: [], report: ".任务/t/判定-r1.md", input_version: 1, call_id: "c", at: "now" } as unknown as CheckResultRecord;
  return { root, round, issue, record };
}
it("引用严格绑定字节/行、唯一命中；缺失只允许验收项及已查范围", async () => {
  const f = await fixture();
  const check = (issues: unknown[]) => validateJudgeResult(f.root, "w", f.round, { ...f.record, issues } as CheckResultRecord, emptyReviews(), true);
  expect(await check([f.issue])).toEqual([]);
  expect((await check([{ ...f.issue, citations: [{ ...f.issue.citations[0], quote: "1.5 是 out_of_range。" }] }])).join()).toMatch(/issues\[0\].citations\[0\]/);
  expect((await check([{ ...f.issue, citations: [{ ...f.issue.citations[0], file: "../a.md" }] }])).join()).toMatch(/citations\[0\]/);
  expect((await check([{ ...f.issue, citations: [] }])).join()).toMatch(/citations/);
  expect((await check([{ ...f.issue, citations: [{ ...f.issue.citations[0], version: "issue_origin" }] }])).join()).toMatch(/citations\[0\]/);
  expect((await check([{ ...f.issue, citations: [{ ...f.issue.citations[0], quote: "1.5 是 non_integer。".repeat(40) }] }])).join()).toMatch(/400字符/);
  expect((await check([{ ...f.issue, kind: "evidence_gap", basis: "missing_required", citations: [], requirement_ids: ["R1"], checked_artifacts: ["a.md"] }])).join()).toBe("");
  expect((await check([{ ...f.issue, kind: "evidence_gap", basis: "missing_required", citations: [], requirement_ids: ["R99"], checked_artifacts: ["a.md"] }])).join()).toMatch(/requirement_ids/);
  expect((await check([{ ...f.issue, citations: [{ ...f.issue.citations[0], file: "foreign.md" }] }])).join()).toMatch(/citations\[0\]/);
  const duplicate = "# 分类\n1.5 是 non_integer。1.5 是 non_integer。\n";
  f.round.reviewed_hashes = { "a.md": sha(duplicate) };
  await writeFile(join(f.root, ".任务/t/产物快照/a.md"), duplicate);
  expect((await check([f.issue])).join()).toMatch(/唯一命中/);
  f.round.reviewed_hashes = { "a.md": sha(text) };
  await writeFile(join(f.root, ".任务/t/产物快照/a.md"), text + "changed");
  expect((await check([f.issue])).join()).toMatch(/版本|哈希/);
});

// Exercises the registered tool implementation, not a mock judge or a forged stored report.
async function registered(initial = text) {
  const root = await mkdtemp(join(tmpdir(), "judge-registered-")); roots.push(root);
  const store = new WorkStore(root);
  const card = await store.create({ session_id: "parent", project_id: "p", title: "judge", shortname: "judge" });
  const key = card.work_key, filename = "a.md";
  await store.employeeMessage(key, "检查这个分类", []);
  await store.propose(key, { intent: "execute", card_patch: {}, deliverables: [filename], edit_request: null }, 1, { artifacts: [{ relativePath: filename, producedBy: "product_discovery" }] });
  await mkdir(join(root, ".任务/t/产物快照"), { recursive: true });
  await writeFile(join(root, ".任务/t/产物快照/a.md"), initial);
  const preset = await readFile(resolve(import.meta.dirname, "../../../../promax-agent/team-harness/generated/r11/promax-team-r11/team-revision.yml"));
  const source = join(root, "team-revision.yml"); await writeFile(source, preset);
  let round = { ...(await store.round(key))!, task_key: "t", source: "click" as const, protocol: 2 as const, execution_version: 1, phase: "generating" as const,
    runtime_snapshot: buildRuntimeSnapshot({ work_key: key, task_key: "t", capture_point: "test", baseline_version: "test", requirement_version: 1, runtime_version: "test", preset: { team_revision_id: "promax-product-team@r11", bytes: preset, source } }) };
  await store.writeRound(key, round);
  await store.transitionRound(key, round, { ...round, phase: "checking", judge_round: 1, reviewed_hashes: { [filename]: sha(initial) }, allowed_members: ["quality_judge"] });
  round = (await store.round(key))! as typeof round;
  await store.bindJudge(key, "judge");
  const exec = (callId: string) => ({ callId, agent: { session: { header: { id: "judge", cwd: root, origin: "subagent", parentSession: "parent" } } } });
  const deps = { contract: async () => ({ artifacts: [] }), member: async () => "quality_judge", runtimeVersion: "test" };
  const raw = (issue: unknown) => ({ verdict: issue ? "REVISION_REQUIRED" : "INCOMPLETE", review_request: round.review_request, input_version: 1, issues: issue ? [issue] : [], rechecks: [], unverified: [], decisions: [] });
  return { root, store, key, source, round: () => store.round(key), exec, deps, raw };
}
it("JR03 同名ID的原始指责身份冲突不撤回", async () => {
  const f = await fixture(), state = emptyReviews(), digest = sha(text);
  f.round.review_group = "g";
  await mkdir(join(f.root, ".工作/w/被审版本"), { recursive: true });
  await writeFile(join(f.root, ".工作/w/被审版本", digest), text);
  state.issues.push({ ...f.issue, citations: [...f.issue.citations], group: "g", state: "open", first_hashes: { "a.md": digest }, latest_hashes: { "a.md": digest }, history: [
    { request: "t:r1", at: "one", state: "open", evidence: "分类指责A", hashes: { "a.md": digest }, report: "r1" },
    { request: "t:r2", at: "two", state: "open", evidence: "另一指责B", hashes: { "a.md": digest }, report: "r2" },
  ] });
  const recheck = { id: "J1", state: "verified", resolution: "false_positive", evidence: "试图撤回", citations: [{ ...f.issue.citations[0], version: "issue_origin" }] };
  expect((await validateJudgeResult(f.root, "w", f.round, { ...f.record, issues: [], rechecks: [recheck] } as CheckResultRecord, state, true)).join()).toMatch(/身份冲突/);
});

it("JR01/JR02/JR03 真工具stage→commit不信旧校验；关闭历史不倒填", async () => {
  const f = await registered();
  const issue = { id: "I1", kind: "defect", severity: "medium", artifact: "a.md", location: "分类", evidence: "判读须对照原文", impact: "误导", fix: "纠正", basis: "quoted", citations: [{ file: "a.md", version: "current", line_start: 2, line_end: 2, quote: "1.5 是 non_integer。" }] };
  await expect(stageStructuredSubmission("promax_check_result", f.raw({ ...issue, citations: [{ ...issue.citations[0], quote: "并不存在" }] }), f.exec("bad"), f.deps)).rejects.toThrow(/citations\[0\]/);
  expect((await f.round())?.check_results).toBeUndefined();
  await stageStructuredSubmission("promax_check_result", f.raw(issue), f.exec("drift"), f.deps);
  await writeFile(join(f.root, ".任务/t/产物快照/a.md"), text + "变更");
  expect(await commitStructuredSubmission(f.exec("drift"), { isError: false }, f.deps)).toMatchObject({ rejected: [expect.stringMatching(/哈希|变化/)] });
  expect((await f.round())?.check_results).toBeUndefined();
  await writeFile(join(f.root, ".任务/t/产物快照/a.md"), text);
  const sourceBytes = await readFile(f.source);
  const contractCall = f.exec("contract-drift"); await stageStructuredSubmission("promax_check_result", f.raw(issue), contractCall, f.deps);
  await writeFile(f.source, sourceBytes.toString() + "\n# drift");
  expect(await commitStructuredSubmission(contractCall, { isError: false }, f.deps)).toMatchObject({ rejected: [expect.stringMatching(/合同.*字节/)] });
  expect((await f.round())?.check_results).toBeUndefined();
  await writeFile(f.source, sourceBytes);
  const exec = f.exec("valid"); await stageStructuredSubmission("promax_check_result", f.raw(issue), exec, f.deps);
  expect(await commitStructuredSubmission(exec, { isError: false }, f.deps)).toMatchObject({ duplicate: false });
  const first = (await f.round())!.check_results!["1"]!;
  expect(first.issues[0]!.citations).toEqual(issue.citations);
  expect(await readFile(join(f.root, first.report), "utf8")).toContain("1.5 是 non_integer。");
  expect(await f.store.acceptCheckResult(f.key, first, "t", renderCheckReport(first))).toMatchObject({ duplicate: true });
  const current = (await f.round())!;
  await f.store.transitionRound(f.key, current, { ...current, phase: "checking", judge_round: 2, reviewed_hashes: { "a.md": sha(text) } });
  const second = (await f.round())!;
  expect(second.review_request).not.toBe(current.review_request);
  const reopened = { verdict: "PASS", review_request: second.review_request, input_version: 1, issues: [], rechecks: [{ id: "I1", state: "verified", evidence: "原版已正确", resolution: "false_positive", citations: [{ ...issue.citations[0], version: "issue_origin" }] }], unverified: [], decisions: [] };
  await expect(stageStructuredSubmission("promax_check_result", { ...reopened, rechecks: [{ ...reopened.rechecks[0], citations: [{ ...issue.citations[0], version: "current" }] }] }, f.exec("wrong-origin"), f.deps)).rejects.toThrow(/issue_origin|citations/);
  const originalPath = join(f.root, ".工作", f.key, "被审版本", sha(text));
  await rm(originalPath);
  await expect(stageStructuredSubmission("promax_check_result", reopened, f.exec("missing-origin"), f.deps)).rejects.toThrow(/原始被审字节|问题原始被审版本/);
  await writeFile(originalPath, text);
  const close = f.exec("close"); await stageStructuredSubmission("promax_check_result", reopened, close, f.deps);
  expect(await commitStructuredSubmission(close, { isError: false }, f.deps)).toMatchObject({ duplicate: false });
  const ledger = await f.store.reviews(f.key);
  expect(ledger.issues[0]).toMatchObject({ state: "verified", resolution: "false_positive", history: [{ state: "open" }, { state: "verified", resolution: "false_positive" }] });
  expect((await readFile(join(f.root, (await f.round())!.check_results!["2"]!.report), "utf8"))).toContain("原判撤回");
  const changed = text + "# 后续修改\n";
  await writeFile(join(f.root, ".任务/t/产物快照/a.md"), changed);
  const prior = (await f.round())!;
  await f.store.transitionRound(f.key, prior, { ...prior, phase: "checking", judge_round: 3, reviewed_hashes: { "a.md": sha(changed) } });
  const later = (await f.round())!, third = f.exec("reopen");
  await stageStructuredSubmission("promax_check_result", { verdict: "INCOMPLETE", review_request: later.review_request, input_version: 1, issues: [], rechecks: [], unverified: [], decisions: [] }, third, f.deps);
  await commitStructuredSubmission(third, { isError: false }, f.deps);
  expect((await f.store.reviews(f.key)).issues[0]).toMatchObject({ state: "changed", history: [{ state: "open" }, { state: "verified", resolution: "false_positive" }] });
  expect((await f.store.reviews(f.key)).issues[0]!.resolution).toBeUndefined();
});

it("JR03 原来有错当前才修为fixed；不能将当前文本当作旧版反证", async () => {
  const wrong = "# 分类\n1.5 是 out_of_range。\n";
  const f = await registered(wrong);
  const issue = { id: "I1", severity: "medium", kind: "defect", artifact: "a.md", location: "分类", evidence: "1.5非整数", impact: "错误分类", fix: "改正", basis: "quoted", citations: [{ file: "a.md", version: "current", line_start: 2, line_end: 2, quote: "1.5 是 out_of_range。" }] };
  const first = f.exec("wrong"); await stageStructuredSubmission("promax_check_result", f.raw(issue), first, f.deps); await commitStructuredSubmission(first, { isError: false }, f.deps);
  await writeFile(join(f.root, ".任务/t/产物快照/a.md"), text);
  const previous = (await f.round())!;
  await f.store.transitionRound(f.key, previous, { ...previous, phase: "checking", judge_round: 2, reviewed_hashes: { "a.md": sha(text) } });
  const round = (await f.round())!;
  const current = { file: "a.md", version: "current", line_start: 2, line_end: 2, quote: "1.5 是 non_integer。" };
  const falseClaim = { verdict: "PASS", review_request: round.review_request, input_version: 1, issues: [], rechecks: [{ id: "I1", state: "verified", evidence: "旧版正确", resolution: "false_positive", citations: [current] }], unverified: [], decisions: [] };
  await expect(stageStructuredSubmission("promax_check_result", falseClaim, f.exec("not-origin"), f.deps)).rejects.toThrow(/issue_origin/);
  const fixed = f.exec("fixed"); await stageStructuredSubmission("promax_check_result", { ...falseClaim, rechecks: [{ id: "I1", state: "verified", evidence: "已修复", resolution: "fixed", citations: [current] }] }, fixed, f.deps);
  expect(await commitStructuredSubmission(fixed, { isError: false }, f.deps)).toMatchObject({ duplicate: false });
  expect((await f.store.reviews(f.key)).issues[0]).toMatchObject({ state: "verified", resolution: "fixed", history: [{ state: "open" }, { state: "verified", resolution: "fixed" }] });
});
