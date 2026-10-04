import { afterEach, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { WorkStore, type WorkRound, type CheckResultRecord } from "../src/work-store.ts";
import { stageStructuredSubmission, commitStructuredSubmission, renderCheckReport } from "../src/structured-results.ts";
const roots: string[] = [];
afterEach(async () => { for (const p of roots.splice(0)) await rm(p, { recursive: true, force: true }); });
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
it("T5/T6 real stores and structured entry: persistent session, versioned snapshots, explicit coordinator repair, item closure and late rejection", async () => {
  const root = await mkdtemp(join(tmpdir(), "promax-review-")); roots.push(root);
  let store = new WorkStore(root);
  const card = await store.create({ session_id: "parent", project_id: "p", title: "test", shortname: "test" });
  const key = card.work_key, filename = "product_discovery.md";
  const contract = { artifacts: [{ relativePath: filename, producedBy: "product_discovery" }] };
  await store.employeeMessage(key, "请生成竞品成果", []);
  await store.propose(key, { intent: "execute", card_patch: {}, deliverables: [filename], edit_request: null }, 1, contract);
  await mkdir(join(root, ".任务", "t", "产物快照"), { recursive: true });
  let round: WorkRound = { ...(await store.round(key))!, task_key: "t", source: "click", protocol: 2, execution_version: 1, phase: "generating" };
  await store.writeRound(key, round);
  const bytes = ["# one", "# two", "# three"];
  const accepted: CheckResultRecord[] = [];
  for (let i = 0; i < 3; i++) {
    await writeFile(join(root, ".任务/t/产物快照", filename), bytes[i]!);
    const next: WorkRound = { ...round, phase: "checking", judge_round: i + 1, reviewed_hashes: { [filename]: hash(bytes[i]!) }, allowed_members: ["quality_judge"] };
    expect(await store.transitionRound(key, round, next)).toBe(true);
    round = (await store.round(key))!;
    if (i === 0) await store.bindJudge(key, "judge-one");
    expect((await store.reviews(key)).bindings[round.review_group!]!.session_id).toBe("judge-one");
    await store.writeRound(key, { ...round, children: { "judge-one": "quality_judge" } });
    round = (await store.round(key))!;
    const issues = ["I1", "I2", "I3"].map((id) => ({ id, severity: "low", artifact: filename, location: "one", evidence: "要求", impact: "实际业务影响", fix: "修复" }));
    const exec = { callId: `c${i}`, agent: { session: { header: { cwd: root, id: "judge-one", origin: "subagent", parentSession: "parent" } } } };
    const deps = { contract: async () => contract, member: async () => undefined, runtimeVersion: "test" };
    if (i > 0) await expect(stageStructuredSubmission("promax_check_result", { verdict: "PASS", issues: [], unverified: [], decisions: [], input_version: 1, review_request: round.review_request }, exec, deps)).rejects.toThrow("逐项");
    const raw = { verdict: i === 0 ? "REVISION_REQUIRED" : "INCOMPLETE", issues: i === 0 ? issues : [], rechecks: i === 1 ? [{ id: "I1", state: "verified", evidence: "核对当前原文" }, { id: "I2", state: "open", evidence: "仍未修" }, { id: "I3", state: "unverifiable", evidence: "无运行证据" }] : [], unverified: [], decisions: [], input_version: 1, review_request: round.review_request };
    await stageStructuredSubmission("promax_check_result", raw, exec, deps);
    await commitStructuredSubmission(exec, { isError: false }, deps);
    round = (await store.round(key))!;
    const result = round.check_results![String(i + 1)]!; accepted.push(result);
    expect(result.issues.every((v) => !v.owner_member_id)).toBe(true);
    expect(await store.acceptCheckResult(key, result, "t", renderCheckReport(result))).toMatchObject({ duplicate: true });
    if (i === 0) {
      const plan = { judge_round: 1, assignments: [{ member: "product_discovery", files: [filename], issue_ids: ["I1", "I2", "I3"], instruction: "逐项修复" }] };
      await expect(store.validateRepairPlan(key, { ...plan, assignments: [{ ...plan.assignments[0], member: "user_analysis" }] })).rejects.toThrow("授权范围");
      await store.acceptRepairPlan(key, "t", plan);
      round = (await store.round(key))!;
      expect(round.phase).toBe("repairing");
    }
    store = new WorkStore(root); // reload persistence, not an in-memory binding
    if (i === 1) {
      expect((await store.reviews(key)).issues.map((v) => v.state)).toEqual(["verified", "open", "unverifiable"]);
      expect((await store.reviews(key)).issues[0]).toMatchObject({ state: "verified", history: [{ state: "open" }, { state: "verified" }] });
      expect((await store.reviews(key)).issues[0]!.resolution).toBeUndefined(); // old contract: unknown, not inferred fixed
    }
  }
  expect((await store.reviews(key)).issues.map((v) => v.state)).toEqual(["changed", "open", "unverifiable"]);
  expect((await store.reviews(key)).issues[0]!.resolution).toBeUndefined();
  await expect(store.acceptCheckResult(key, accepted[0]!, "t", "stale")).rejects.toThrow("轮次");
  expect(await readFile(join(root, ".工作", key, "被审版本", hash(bytes[0]!)), "utf8")).toBe(bytes[0]);
  expect(await readFile(join(root, accepted[0]!.report), "utf8")).toContain("I3");
  expect(await store.inspectFile(key, { kind: "review-version", filename, sha256: hash(bytes[0]!) })).toMatchObject({ content: bytes[0] });
  await expect(store.inspectFile(key, { kind: "review-version", filename: "foreign.md", sha256: hash(bytes[0]!) })).rejects.toThrow("不属于");
  await store.writeRound(key, { ...(await store.round(key))!, phase: "ended" });
  await store.employeeMessage(key, "继续修改同一份文档", []);
  await store.propose(key, { intent: "execute", card_patch: {}, deliverables: [filename], edit_request: null }, 20, contract);
  const proposed = (await store.round(key))!;
  await store.authorize(key, proposed.revision, "click", async () => {
    await mkdir(join(root, ".任务/t2/产物快照"), { recursive: true });
    await writeFile(join(root, ".任务/t2/产物快照", filename), bytes[2]!);
    return "t2";
  }, { protocol: 2 });
  const restartedRound = (await store.round(key))!;
  expect(restartedRound.children).toBeUndefined();
  await store.transitionRound(key, restartedRound, { ...restartedRound, phase: "checking", judge_round: 1, reviewed_hashes: { [filename]: hash(bytes[2]!) } });
  const rebound = (await new WorkStore(root).round(key))!;
  expect(rebound.children).toMatchObject({ "judge-one": "quality_judge" });
  expect(rebound.review_request).toBe("t2:r1");
  await expect(store.acceptCheckResult(key, accepted[0]!, "t2", "late task result")).rejects.toThrow("迟到");
  const other = await store.create({ session_id: "other", project_id: "p", title: "test", shortname: "other" });
  expect((await store.reviews(other.work_key)).bindings).toEqual({});
});
