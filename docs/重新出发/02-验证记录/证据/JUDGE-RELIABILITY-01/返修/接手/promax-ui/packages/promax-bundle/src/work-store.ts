import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import YAML from "yaml";
import { ContentObjectStore, PromateError } from "@promax/promax-report";
import { parseJudgeReport } from "./judge-report.ts";
import { frozenJudgeContract, validateJudgeResult } from "./judge-evidence.ts";
import { preflightEdit } from "./artifact-edit.ts";
import { deliveryFacts, deliveryReceipt } from "./delivery.ts";
import { parseHandoff } from "./handoff.ts";
import { acceptanceScope, makeAcceptanceBaseline } from "./acceptance-baseline.ts";
import { acceptanceEvidence, acceptanceGateErrors, assignEvidenceIdentities, buildEvidenceLinksFile, currentAcceptanceEvidence, emptyEvidenceLinks, ensureEvidenceLinksIndex, evidenceDependencyFromParts, evidenceDependencyParts, legacyEvidenceDependency, legacyV2EvidenceDependencyParts, evidenceDigest, evidenceLinkInput, validateEvidenceLinks, readFrozenSources, receiptSemanticDigest, verifyEvidenceLinks, type EvidenceDependencyParts } from "./evidence-links.ts";
import { persistRuntimeSnapshot } from "./runtime-snapshot.ts";
import { evaluationRecords } from "./evaluation-records.ts";
import { interruptedRequests, MAX_PENDING_OBSERVATIONS, pendingObservations, recorderOwner, recordingFaults, RECORDING_VERSION, type Observation } from "./recording.ts";
import { acceptanceErrors, confirmedWords, effectiveRequirements, requirementsBrief, type AcceptanceBaseline, type AcceptanceResult, type EffectiveRequirements, type EvidenceIndex, type RequirementPolicy, type UnverifiedItem } from "../../promax-ui-console/src/effective-protocol.ts";
import { emptyReviews, reviewGroup, type ReviewState, type ReviewIssue, type IssueRecheck, type RepairPlan } from "../../promax-ui-console/src/review-protocol.ts";
import {
  ensureSpine,
  invalidateNodes,
  mergeQuestions,
  nodeOutstanding,
  nodeDigest,
  sameDecision,
} from "../../promax-ui-console/src/work-spine.ts";
import {
  decisionText,
  INACTIVE_DECISION,
  nodeDefinition,
  parseWorkTurn,
  requirementsDigest,
  withoutRecommendation,
  verifiedEmployeeStatements,
  workMembers,
  type DecisionRecord,
  type DecisionState,
  type HandledEvent,
  type PendingItem,
  type WorkCard,
  type WorkContract,
  type WorkEvent,
  type WorkTurn,
  type WorkNavigation,
  type WorkFeedback,
  type WorkScopeMove,
} from "../../promax-ui-console/src/work-protocol.ts";
import {
  answerGuard,
  emptyStatus,
  registerFailure,
  resolveChoice,
  resolveFaults,
  sameAnswer,
  type StoredStatus,
  type WorkAlignment,
} from "../../promax-ui-console/src/work-control.ts";
import { planScopeChange, scopeRemovals, scopeSignature, settleScopeChange } from "../../promax-ui-console/src/work-scope.ts";
import { conditionDigest, conditionSatisfied, feedbackFor } from "../../promax-ui-console/src/work-progress.ts";
import { mergeSuggestions, replyToSuggestion } from "../../promax-ui-console/src/work-suggestions.ts";
export type { WorkCard, WorkTurn };
const bump = (card: WorkCard) =>
  new Date(Math.max(Date.now(), Date.parse(card.updated_at) + 1)).toISOString();
export interface WorkRound {
  delivery?: import("../../promax-ui-console/src/delivery-protocol.ts").DeliveryAttempt;
  effective_requirements?: EffectiveRequirements;
  acceptance_baseline?: AcceptanceBaseline;
  acceptance_scope?: string[];
  /** 13.1 不可变运行快照；在任务启动时捕获，跨版本工作各自保留，不被后续升级覆盖。 */
  runtime_snapshot?: import("./runtime-snapshot.ts").RuntimeSnapshot;
  /** R07：本次工作历次快照身份（不可变留存于 .工作/<key>/运行快照/），讨论回合沿用不丢。 */
  snapshot_ids?: string[];
  /** R10：被替换掉的历次已接受回执（含已核验关联），用于保留结论身份与内容历史。 */
  receipt_history?: MemberReceipt[];
  /** 已结束任务的权威回执留在同一工作记录中；不进入模型上下文、不靠派生索引留历史。 */
  receipt_archives?: Record<string, MemberReceipt[]>;
  evidence_task_key?: string;
  check_only?: boolean;
  children?: Record<string, string>;
  review_group?: string;
  review_request?: string;
  repair_plan?: RepairPlan;
  previous_check?: string;
  repair_round?: number;
  judge_round?: number;
  phase?: "generating" | "checking" | "repairing" | "ended";
  allowed_members?: string[];
  check_scope?: string;
  reviewed_hashes?: Record<string, string>;
  /** The latest finished check and what it was bound to; survives later discussion rounds as history. */
  last_check?: {
    report: string;
    judge_round: number;
    reviewed_hashes: Record<string, string>;
    requirements_digest?: string;
    verdict?: "PASS" | "REVISION_REQUIRED" | "INCOMPLETE";
    acceptance_baseline?: AcceptanceBaseline;
    acceptance?: AcceptanceResult;
    /** R01：接受时由权威回执计算的依据索引；完成判定、指标与界面投影共用。 */
    acceptance_evidence?: EvidenceIndex;
    current_acceptance_evidence?: EvidenceIndex;
    unverified?: UnverifiedItem[];
    blocking_issue_ids?: string[];
    delivery_saved?: boolean;
  };
  decision_ids?: string[];
  node_id?: string;
  /** The coordinator was asked once to re-emit a missing work block for this employee message. */
  format_retry?: boolean;
  /** Frozen at authorization; in-flight discussion must not rewrite the task's requirement version. */
  execution_digest?: string;
  /** Accepted suggestions at authorization, not later chat changes. */
  followed_suggestions?: string[];
  /** Requirements the check was run against; a later change makes the check historical. */
  requirements_digest?: string;
  revision: string;
  event_seq: number;
  turn: WorkTurn;
  source: "proposal" | "click" | "countdown";
  task_key?: string;
  attachments: string[];
  demand: string;
  unverified: Array<{ item: string; reason: string }>;
  edit?: WorkTurn["edit_request"];
  /** 2 = structured receipts/check results are the only advancing authority. Absent on historical rounds. */
  protocol?: 2;
  /** Card requirement version frozen at authorization. */
  execution_version?: number;
  /** Accepted, persisted member receipts keyed by deliverable filename. */
  receipts?: Record<string, MemberReceipt>;
  /** Accepted, persisted check results keyed by judge round. */
  check_results?: Record<string, CheckResultRecord>;
  /** The coordinator's committed structured proposal for the current discussion turn. */
  structured?: { call_id: string; seq: number; at: string };
  /** A program-arranged local revision of existing outputs after an employee decision. */
  revise?: { decision_ids: string[]; event_ids: string[]; instruction: string };
  /** Automation paused on an unrecoverable fault; drafts kept, nothing marked passed. */
  halted?: "needs_fix";
  /** Drafts produced under requirements that changed during the run; never committed as current. */
  stale_files?: string[];
  /** Per member: only calls/failures after this session seq belong to the current attempt (set by a recovery). */
  member_seq?: Record<string, number>;
  /** Per member: session seq at which the coordinator was told to dispatch it. */
  notified?: Record<string, number>;
}
export interface MemberReceipt {
  handoff?: import("./handoff.ts").Handoff;
  member: string;
  filename: string;
  sha256: string;
  status: "draft_ready" | "blocked";
  phase: "generating" | "repairing";
  repair_round: number;
  summary: string;
  unverified: Array<{ item: string; reason: string }>;
  gaps: string[];
  blocked_reason?: "missing_material" | "missing_permission" | "missing_tool" | "conflict";
  input_version: number;
  call_id: string;
  at: string;
  /** R03/R04：程序已回读核验的结论关联；这是支撑依据索引的权威载荷。 */
  evidence_links?: import("./evidence-links.ts").AcceptedEvidenceLink[];
  /** R02：关联载荷摘要，参与幂等判断，避免正文不变时跳过关联修订。 */
  evidence_digest?: string;
  evidence_update?: { mode: "patch" | "replace"; withdraw: string[] };
  evidence_request_digest?: string;
  evidence_base_digest?: string;
  evidence_continuity?: Array<{ conclusion_id: string; state: "continued" | "invalidated" | "withdrawn"; reason: string }>;
  baseline_version?: string;
}
export interface CheckResultRecord {
  /** Frozen program evaluation scope; absent on historical records, never backfilled as a new run. */
  evaluation_binding?: { scope: string[]; snapshot_id: string | null; evaluator_version: string };
  /** Program snapshot of mandatory rechecks at submission; absent in older records. */
  required_recheck_ids?: string[];
  acceptance?: AcceptanceResult;
  /** R01：接受时按权威回执计算的依据索引；完成计算、Q1与界面投影共用同一份事实。 */
  acceptance_evidence?: EvidenceIndex;
  current_acceptance_evidence?: EvidenceIndex;
  judge_round: number;
  verdict: "PASS" | "REVISION_REQUIRED" | "INCOMPLETE";
  scope: string;
  reviewed_hashes: Record<string, string>;
  issues: ReviewIssue[];
  rechecks?: IssueRecheck[];
  review_request?: string;
  /** Stage-time authorized Judge; commit must check that the same session remains bound. */
  judge_session_id?: string;
  unverified: UnverifiedItem[];
  decisions: Array<{ id: string; question: string; options: string[]; location: string; evidence: string; artifact?: string; decision_key?: string; effect?: string; current_content?: string; timing?: "now" | "later"; reopen_reason?: string }>;
  report: string;
  input_version: number;
  call_id: string;
  at: string;
}
/** A structured submission that fails program binding; every reason is returned to the submitter. */
export class SubmissionRejected extends Error {
  constructor(readonly reasons: string[]) {
    super(`提交未被接受：${reasons.join("；")}`);
  }
}
const statusWriteFailures = new Map<string, { at: string; message: string }>();
const queues = new Map<string, Promise<unknown>>();
export async function serializeWork<T>(
  key: string,
  action: () => Promise<T>,
): Promise<T> {
  const prior = queues.get(key) ?? Promise.resolve();
  const next = prior.catch(() => undefined).then(action);
  queues.set(key, next);
  try {
    return await next;
  } finally {
    if (queues.get(key) === next) queues.delete(key);
  }
}
export function workKey(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 100 ||
    /[\\/\0]/u.test(value) ||
    value === "." ||
    value === ".." ||
    value.startsWith(".")
  )
    throw new Error("工作身份无效");
  return value;
}
function supportedDependencyParts(value: EvidenceDependencyParts): boolean {
  if (!value || typeof value !== "object") return false;
  const hash = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/u.test(v);
  return (value.version === 2 || value.version === 3) && hash(value.preamble) && hash(value.parents) && hash(value.local)
    && Array.isArray(value.scope) && value.scope.every(row => row && typeof row.heading === "string" && hash(row.sha256));
}
function dependencyChanges(before: EvidenceDependencyParts, after: EvidenceDependencyParts): string[] {
  const changes: string[] = [];
  if (before.preamble !== after.preamble) changes.push("前言/报告总范围变化");
  if (before.parents !== after.parents) changes.push("父标题/章节路径变化");
  if (before.local !== after.local) changes.push("锚点所在局部内容变化");
  if (JSON.stringify(before.scope) !== JSON.stringify(after.scope)) {
    const previous = new Map(before.scope.map((row) => [row.heading, row.sha256]));
    const current = new Map(after.scope.map((row) => [row.heading, row.sha256]));
    const changed = [...new Set([...previous.keys(), ...current.keys()])].filter(title => previous.get(title) !== current.get(title));
    changes.push(`公共限定变化（${changed.slice(0, 2).join("、").slice(0, 120) || "范围/口径/单位/来源/限制"}）`);
  }
  return changes;
}

export class WorkStore {
  constructor(readonly workspace: string) {}
  private async directory(key?: string, create = false) {
    let path = resolve(this.workspace);
    for (const part of [
      ".工作",
      ...(key === undefined ? [] : [workKey(key)]),
    ]) {
      path = join(path, part);
      if (create) {
        try {
          await mkdir(path);
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
        }
      }
      const info = await lstat(path);
      if (!info.isDirectory() || info.isSymbolicLink())
        throw new Error("工作目录不得是符号链接");
    }
    return path;
  }
  private async json<T>(key: string, file: string): Promise<T> {
    const path = join(await this.directory(key), file);
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink())
      throw new Error("工作记录必须为普通文件");
    return YAML.parse(await readFile(path, "utf8")) as T;
  }
  private async put(key: string, file: string, value: unknown) {
    const target = join(await this.directory(key, true), file),
      temporary = `${target}.${randomUUID()}.tmp`;
    try {
      // Shared recorder metadata must not produce hundreds of YAML aliases that exceed the reader's safety limit.
      await writeFile(temporary, YAML.stringify(value, file === "链路观察.yml" ? { aliasDuplicateObjects: false } : {}), {
        flag: "wx",
        mode: 0o600,
      });
      if (file === "链路观察.yml") {
        const handle = await open(temporary, "r+");
        try { await handle.sync(); } finally { await handle.close(); }
      }
      await rename(temporary, target);
      if (file === "链路观察.yml") {
        const directory = await open(join(target, ".."), "r");
        try { await directory.sync(); } finally { await directory.close(); }
      }
    } finally {
      await rm(temporary, { force: true });
    }
  }
  /** Every card write goes through here, so the requirement version can never lag the effective requirements. */
  private async saveCard(card: WorkCard) {
    const digest = createHash("sha256").update(requirementsDigest(card)).digest("hex");
    if (card.requirement_digest !== digest) {
      card.requirement_version = (card.requirement_version ?? 0) + 1;
      card.requirement_digest = digest;
    }
    await this.put(card.work_key, "工作卡.yml", card);
  }
  private async statusRaw(key: string): Promise<StoredStatus> {
    try {
      return { ...emptyStatus(), ...(await this.json<Partial<StoredStatus>>(key, "状态.yml")) };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return emptyStatus();
      throw e;
    }
  }
  private async writeStatusRaw(key: string, status: StoredStatus) {
    const id = `${resolve(this.workspace)}\0${key}`;
    const failed = statusWriteFailures.get(id);
    if (failed) status.write_errors = [...status.write_errors, failed].slice(-50);
    try {
      await this.put(key, "状态.yml", status);
      statusWriteFailures.delete(id);
    } catch (e) {
      // Surfaced to the caller and remembered for the page; a failed status write is never treated as saved.
      statusWriteFailures.set(id, { at: new Date().toISOString(), message: e instanceof Error ? e.message : String(e) });
      throw e;
    }
  }
  async status(key: string) {
    return this.statusRaw(key);
  }
  private observationKey(key: string) { return `${resolve(this.workspace)}\0${workKey(key)}:observations`; }
  recordingHealth(key: string) {
    const id = this.observationKey(key), fault = recordingFaults.get(id);
    return { status: fault ? "incomplete" : "available", ...(fault ?? {}), buffered: pendingObservations.get(id)?.size ?? 0,
      boundary: "本地原子替换并fsync；存储不可用时有界内存缓冲，进程退出可能丢失未落盘尾部，不保证零丢失" };
  }
  private async flushObservations(key: string): Promise<Observation[]> {
    const id = this.observationKey(key), pending = pendingObservations.get(id) ?? new Map<string, Observation>();
    let rows: Observation[];
    try { rows = await this.json(key, "链路观察.yml"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") rows = []; else throw error; }
    let changed = false;
    for (const row of [...pending.values(), ...interruptedRequests(rows)]) {
      if (rows.some(r => r.id === row.id)) continue;
      rows.push({ ...row, event_order: rows.length + 1 }); changed = true;
    }
    const fault = recordingFaults.get(id);
    if (fault) {
      const recoveryId = `recording-recovered:${fault.at}`;
      if (!rows.some(r => r.id === recoveryId)) rows.push({ id: recoveryId, kind: "recording_recovered", at: new Date().toISOString(),
        rule_version: "STD-v0.1", recorder_owner: recorderOwner, event_order: rows.length + 1, failure: fault, incomplete_tail_possible: fault.dropped > 0 });
      changed = true;
    }
    if (changed) await this.put(key, "链路观察.yml", rows);
    pendingObservations.delete(id); recordingFaults.delete(id);
    return rows;
  }
  private recordingFailed(key: string, error: unknown) {
    const id = this.observationKey(key), prior = recordingFaults.get(id);
    recordingFaults.set(id, { at: prior?.at ?? new Date().toISOString(), code: (error as NodeJS.ErrnoException).code ?? "RECORDING_ERROR",
      buffered: pendingObservations.get(id)?.size ?? 0, dropped: prior?.dropped ?? 0 });
    if (!prior) console.warn("Promax记录系统暂不可用；业务结果不改写为模型失败", { work: key, code: recordingFaults.get(id)!.code });
  }
  async observations(key: string): Promise<Observation[]> {
    return serializeWork(this.observationKey(key), async () => {
      try { return await this.flushObservations(key); }
      catch (error) {
        this.recordingFailed(key, error);
        // Readers see known facts + explicit recordingHealth, never trigger agents/retries.
        let saved: Observation[] = [];
        try { saved = await this.json(key, "链路观察.yml"); } catch { /* status remains incomplete */ }
        return [...new Map([...saved, ...pendingObservations.get(this.observationKey(key))?.values() ?? []].map(r => [r.id, r])).values()];
      }
    });
  }
  /** Local-only facts. Failure is explicit but never thrown into a successful model/tool request. */
  async observe(key: string, event: Observation): Promise<{ persisted: boolean }> {
    return serializeWork(this.observationKey(key), async () => {
      const id = this.observationKey(key), pending = pendingObservations.get(id) ?? new Map<string, Observation>();
      if (!pending.has(event.id)) {
        if (pending.size >= MAX_PENDING_OBSERVATIONS) {
          // A full fallback buffer must still retry storage; otherwise future writes could never recover it.
          try { await this.flushObservations(key); pending.clear(); }
          catch (error) {
            this.recordingFailed(key, error);
            recordingFaults.get(id)!.dropped++;
            return { persisted: false };
          }
        }
        pending.set(event.id, { ...event, work_key: key, rule_version: event.rule_version ?? "STD-v0.1", recording_version: RECORDING_VERSION,
          recorder_owner: recorderOwner, evidence_path: `.工作/${key}/链路观察.yml#${event.id}` });
      }
      pendingObservations.set(id, pending);
      try { await this.flushObservations(key); return { persisted: true }; }
      catch (error) { this.recordingFailed(key, error); return { persisted: false }; }
    });
  }
  statusWriteFailure(key: string) {
    return statusWriteFailures.get(`${resolve(this.workspace)}\0${key}`);
  }
  async updateStatus<T>(key: string, mutate: (status: StoredStatus, card: WorkCard, round: WorkRound | undefined) => T | Promise<T>): Promise<T> {
    return serializeWork(this.workspace, async () => {
      const status = await this.statusRaw(key);
      const result = await mutate(status, await this.read(key), await this.round(key));
      await this.writeStatusRaw(key, status);
      return result;
    });
  }
  /** Persists one observed failure against the step's recovery budget; the same evidence never counts twice. */
  async noteFailure(key: string, input: Parameters<typeof registerFailure>[1] & { cause?: "tool_environment" | "agent_defect" | "mixed" | "unknown" }) {
    return serializeWork(this.workspace, async () => {
      const status = await this.statusRaw(key);
      const result = registerFailure(status, input);
      if (!result.duplicate) await this.writeStatusRaw(key, status);
      // 10.2 交付结果与责任归因分账：仅将已知工具/权限阻塞记为环境原因，其余保留未知。
      if (!result.duplicate) {
        const cause = input.cause ?? (["missing_tool", "missing_permission"].includes(input.class) ? "tool_environment" : "unknown");
        const rows = await this.observations(key);
        const snapshotId = (await this.round(key))?.runtime_snapshot?.snapshot_id;
        const record = {
          id: `failure:${input.step}:${input.class}:${input.at}`,
          kind: "failure_attribution",
          at: input.at,
          ...(input.task_key ? { task_key: input.task_key } : {}),
          ...(snapshotId ? { snapshot_id: snapshotId } : {}),
          step: input.step,
          class: input.class,
          cause,
          first_error: !rows.some((row) => row.kind === "failure_attribution" && row.task_key === input.task_key),
          evidence: input.evidence,
          reason: input.reason,
          strategy: input.strategy,
        };
        await this.observe(key, record);
      }
      return result;
    });
  }
  async resolveStep(key: string, step: string, classes?: Parameters<typeof resolveFaults>[3]) {
    return serializeWork(this.workspace, async () => {
      const status = await this.statusRaw(key);
      if (resolveFaults(status, step, new Date().toISOString(), classes)) await this.writeStatusRaw(key, status);
    });
  }
  /**
   * Stores an accepted member receipt only while the same task/phase is current and the file still has that hash.
   * R03：权威回执与派生索引在同一次工作锁内提交；R02：关联载荷变化视为新提交，原样重试才算重复。
   */
  async acceptReceipt(key: string, receipt: MemberReceipt, task_key: string) {
    return serializeWork(this.workspace, async () => {
      const result = await this.acceptReceiptLocked(key, receipt, task_key);
      if (result.duplicate) return result;
      return { ...result, ...(await this.rebuildEvidenceIndexLocked(key, task_key)) };
    });
  }
  /** Old review bytes are optional. Never infer a past fingerprint from today's mutable draft. */
  private async verifiedReviewedText(key: string, hash: string): Promise<string | undefined> {
    if (!/^[a-f0-9]{64}$/u.test(hash)) return undefined;
    try {
      const dir = join(await this.directory(key), "被审版本");
      if (!(await lstat(dir)).isDirectory()) return undefined;
      const file = join(dir, hash), stat = await lstat(file);
      if (!stat.isFile() || stat.size > 8 * 1024 * 1024) return undefined;
      const bytes = await readFile(file);
      return createHash("sha256").update(bytes).digest("hex") === hash ? bytes.toString("utf8") : undefined;
    } catch { return undefined; }
  }
  private async acceptReceiptLocked(key: string, receipt: MemberReceipt, task_key: string) {
    const round = await this.round(key);
    if (!round?.task_key || round.task_key !== task_key || (round.phase ?? "generating") !== receipt.phase || (round.repair_round ?? 0) !== receipt.repair_round)
      throw new SubmissionRejected(["阶段已变化，回执未保存"]);
    const bytes = await readFile(join(this.workspace, ".任务", task_key, "产物快照", receipt.filename));
    if (createHash("sha256").update(bytes).digest("hex") !== receipt.sha256) throw new SubmissionRejected([`${receipt.filename} 在提交后又被修改，回执未保存`]);
    await parseHandoff(receipt.handoff, this.workspace, task_key);
    const prior = round.receipts?.[receipt.filename];
    if (receipt.baseline_version && receipt.baseline_version !== round.acceptance_baseline?.version) throw new SubmissionRejected(["验收基准已变化，回执未保存"]);
    const ledger = receiptLedger(round);
    const nextDigest = receiptSemanticDigest(receipt);
    const sameCall = ledger.find(item => item.call_id === receipt.call_id && item.member === receipt.member);
    if (sameCall && receiptSemanticDigest(sameCall) !== nextDigest) throw new SubmissionRejected(["同一提交身份的有效载荷/版本冲突，回执未保存"]);
    const duplicate = sameCall ?? (prior && receiptSemanticDigest(prior) === nextDigest ? prior : undefined);
    // Duplicate requests must still recheck their explicit sources; never replay side effects or renumber.
    if (receipt.evidence_links?.length) {
      const frozen = await readFrozenSources(this.workspace, task_key);
      if ("error" in frozen) throw new SubmissionRejected([frozen.error]);
      const rechecked = await verifyEvidenceLinks({ workspace: this.workspace, taskKey: task_key, filename: receipt.filename, artifactSha256: receipt.sha256,
        links: receipt.evidence_links.map(({ conclusion_id, ...link }) => ({ ...link, ...(link.requested_conclusion_id !== null && conclusion_id ? { conclusion_id } : {}) })),
        sources: frozen.sources, conclusions: buildEvidenceLinksFile({ taskKey: task_key, receipts: ledger }).conclusions });
      if (rechecked.errors.length) throw new SubmissionRejected(rechecked.errors);
      if (evidenceDigest(receipt.evidence_links) !== evidenceDigest(rechecked.verified)) throw new SubmissionRejected(["来源/口径在提交后变化，须重新核验"]);
    }
    if (duplicate) return { duplicate: true, link_ids: (duplicate.evidence_links ?? []).map(l => l.link_id), conclusion_ids: (duplicate.evidence_links ?? []).map(l => l.conclusion_id) };
    if (receipt.evidence_base_digest !== undefined && receipt.evidence_base_digest !== evidenceDigest(prior?.evidence_links)) throw new SubmissionRejected(["关联基线已被并发提交修改，请重新读取后提交；未覆盖他人更新"]);
    if (receipt.evidence_update) {
      const update = receipt.evidence_update, supplied = receipt.evidence_links ?? [], withdrawn = new Set(update.withdraw);
      const replaced = new Set(supplied.flatMap(l => [l.conclusion_id, ...(l.supersedes ?? [])]).filter(Boolean));
      if (withdrawn.size !== update.withdraw.length || [...withdrawn].some(id => !prior?.evidence_links?.some(l => l.conclusion_id === id) || replaced.has(id))) throw new SubmissionRejected(["撤回身份未知、重复或同时更新；请只修正冲突条目"]);
      const continuity: NonNullable<MemberReceipt["evidence_continuity"]> = [];
      const frozen = prior?.evidence_links?.length ? await readFrozenSources(this.workspace, task_key) : undefined;
      const text = bytes.toString("utf8");
      for (const old of prior?.evidence_links ?? []) {
        if (replaced.has(old.conclusion_id)) continue;
        if (update.mode === "replace" || withdrawn.has(old.conclusion_id)) {
          continuity.push({ conclusion_id: old.conclusion_id, state: "withdrawn", reason: withdrawn.has(old.conclusion_id) ? "显式撤回；不再自动继承" : "整组replace替换；不再自动继承" }); continue;
        }
        if (supplied.some(link => link.location === old.location && link.conclusion === old.conclusion)) {
          continuity.push({ conclusion_id: old.conclusion_id, state: "invalidated", reason: "同一正文判断被重新提交；不能让旧规格掩盖新规格缺口。修订请引用原CNL身份" }); continue;
        }
        const reasons: string[] = [];
        if (old.artifact_sha256 !== prior?.sha256) reasons.push("旧关联成果版本与权威回执不符；不能继承");
        if (!Array.isArray(old.source_readback) || old.source_readback.length !== old.evidence.length) reasons.push("旧记录缺来源回读版本信息；需补登记");
        const input = evidenceLinkInput(old);
        const currentParts = evidenceDependencyParts(text, input);
        if (prior?.baseline_version !== receipt.baseline_version) reasons.push("验收基准版本变化；需按当前基准补登记");
        if (!old.dependency_sha256) reasons.push("旧记录缺依赖指纹，无法证明原正文范围；需补登记");
        else if (old.dependency_parts) {
          if (!supportedDependencyParts(old.dependency_parts) || evidenceDependencyFromParts(old.dependency_parts) !== old.dependency_sha256) reasons.push("旧依赖分量版本不支持或指纹不符；需补登记");
          else if (old.dependency_parts.version === 3 && currentParts) reasons.push(...dependencyChanges(old.dependency_parts, currentParts));
          else if (old.dependency_parts.version === 2 && currentParts) {
            // A v2 narrow hash cannot attest to other occurrences of the same conclusion.
            // Prove the actual old v2 bytes before comparing both versions with v3 rules.
            const sameBytes = old.artifact_sha256 === receipt.sha256;
            const oldText = sameBytes ? text : await this.verifiedReviewedText(key, old.artifact_sha256);
            const oldV2 = oldText && legacyV2EvidenceDependencyParts(oldText, input);
            if (!oldV2 || evidenceDependencyFromParts(oldV2) !== old.dependency_sha256) reasons.push(sameBytes
              ? "旧v2依赖指纹与当前同版正文不符；需补登记"
              : "旧v2窄依赖缺可核对的原被审字节；无法证明被排除的同句分支未变，请补登记");
            else {
              const oldV3 = evidenceDependencyParts(oldText!, input);
              if (!oldV3) reasons.push("旧v2被审版锚点无法核对；请补登记");
              else reasons.push(...dependencyChanges(oldV3, currentParts));
            }
          }
        } else if (currentParts && legacyEvidenceDependency(text, input) !== old.dependency_sha256) {
          // v1 hash was overbroad. Re-partition only when a genuine old reviewed snapshot
          // matches BOTH the old artifact hash and the original v1 dependency hash.
          const oldText = await this.verifiedReviewedText(key, old.artifact_sha256);
          if (!oldText || legacyEvidenceDependency(oldText, input) !== old.dependency_sha256) reasons.push("旧版依赖范围已变化且原被审字节不可核对；不能用新算法猜测旧关联，请补登记");
          else {
            const oldParts = evidenceDependencyParts(oldText, input);
            if (!oldParts) reasons.push("旧被审版锚点无法核对；请补登记");
            else reasons.push(...dependencyChanges(oldParts, currentParts));
          }
        }
        if (frozen && "error" in frozen) reasons.push(`冻结来源不可回读：${frozen.error.slice(0, 180)}`);
        const valid = validateEvidenceLinks([input], { baseline: round.acceptance_baseline, sources: frozen && !("error" in frozen) ? frozen.sources : undefined, artifactText: text, filename: receipt.filename });
        reasons.push(...valid.errors.slice(0, 2).map(e => `正文锚点或验收项：${e.slice(0, 180)}`));
        if (!currentParts && !valid.errors.length) reasons.push("正文锚点不唯一、结论不对应或依赖范围无法确定；请补登记");
        let fresh: typeof old | undefined;
        if (frozen && !("error" in frozen) && !valid.errors.length) {
          const verified = await verifyEvidenceLinks({ workspace: this.workspace, taskKey: task_key, filename: receipt.filename, artifactSha256: receipt.sha256, links: [input], sources: frozen.sources, conclusions: buildEvidenceLinksFile({ taskKey: task_key, receipts: ledger }).conclusions });
          reasons.push(...verified.errors.slice(0, 2).map(e => `来源/数值核验：${e.slice(0, 180)}`));
          fresh = verified.verified[0];
          if (fresh) {
            const versions = (l: typeof old) => JSON.stringify(l.source_readback?.map(s => [s.source_id, s.sha256, s.range, s.qualification_sha256]) ?? null);
            if (versions(fresh) !== versions(old)) reasons.push(`来源版本/资格/引用范围变化：${old.evidence.slice(0, 2).map(e => e.source_id).join("、")}`);
            if (JSON.stringify(fresh.numeric_check) !== JSON.stringify(old.numeric_check)) reasons.push("数值规格或复算结果变化");
          }
        }
        if (!reasons.length && fresh && currentParts) {
          supplied.push({ ...fresh, dependency_sha256: evidenceDependencyFromParts(currentParts), dependency_parts: currentParts, continued_from: { link_id: old.link_id, artifact_sha256: old.artifact_sha256 } });
          continuity.push({ conclusion_id: old.conclusion_id, state: "continued", reason: "当前局部正文、父标题/前言/公共限定、来源与复算重新核对一致；不继承语义判定" }); continue;
        }
        continuity.push({ conclusion_id: old.conclusion_id, state: "invalidated", reason: (reasons.length ? reasons : ["依赖或来源未能完整核验；请补登记"]).slice(0, 4).join("；").slice(0, 800) });
      }
      receipt = { ...receipt, evidence_links: supplied, evidence_continuity: continuity };
    }
    receipt = { ...receipt, ...(receipt.evidence_links ? { evidence_links: assignEvidenceIdentities(ledger, receipt.evidence_links, receipt.filename) } : {}) };
    receipt.evidence_digest = evidenceDigest(receipt.evidence_links);
    await this.writeRound(key, {
      ...round,
      receipts: { ...round.receipts, [receipt.filename]: receipt },
      receipt_history: [...(round.receipt_history ?? []), ...(prior ? [prior] : [])],
    });
    const status = await this.statusRaw(key);
    const at = receipt.at;
    if (receipt.status === "blocked") {
      registerFailure(status, { step: `file:${receipt.filename}`, class: receipt.blocked_reason === "conflict" ? "missing_material" : receipt.blocked_reason ?? "missing_material", evidence: receipt.call_id, reason: receipt.gaps.join("；") || receipt.summary, strategy: "等待员工补充后续接，不自动重试", at, task_key });
      const card = await this.read(key);
      card.pending = mergeQuestions(card, [{ id: `blocked-${receipt.filename}`, question: `${receipt.filename} 需要你补充：${(receipt.gaps.join("；") || receipt.summary).slice(0, 300)}`, kind: "material", raised_by: receipt.member, blocking: true, timing: "now", artifact: receipt.filename, source: "ai", basis: receipt.summary.slice(0, 500) }], at);
      card.updated_at = bump(card);
      await this.saveCard(card);
    } else resolveFaults(status, `file:${receipt.filename}`, at, ["member_run_failed", "member_output_missing", "member_receipt_missing"]);
    status.checkpoint = { at, phase: receipt.phase, task_key, ...(round.judge_round ? { judge_round: round.judge_round } : {}), hashes: Object.fromEntries(Object.values({ ...round.receipts, [receipt.filename]: receipt }).map((r) => [r.filename, r.sha256])), note: `已接收 ${receipt.filename} 回执` };
    await this.writeStatusRaw(key, status);
    return { duplicate: false, link_ids: (receipt.evidence_links ?? []).map((link) => link.link_id), conclusion_ids: (receipt.evidence_links ?? []).map((link) => link.conclusion_id), evidence_continuity: receipt.evidence_continuity ?? [] };
  }
  /** 派生索引重建：回执是权威，索引可随时从回执重现；失败不丢掉已接受回执。 */
  private async rebuildEvidenceIndexLocked(key: string, task_key: string) {
    try {
      const round = await this.round(key);
      const { rebuilt } = await ensureEvidenceLinksIndex(this.workspace, task_key, receiptLedger(round));
      return { index_state: rebuilt ? "rebuilt" as const : "current" as const };
    } catch (error) {
      // 索引写失败不回滚已接受回执；读者会按回执摘要重新构建，不把半完成当完整登记。
      return { index_state: "pending_rebuild" as const, index_error: error instanceof Error ? error.message : String(error) };
    }
  }
  /** 读取派生索引；过期或缺失时从权威回执（含历次修订）重建。与回执提交共用同一工作锁，避免并发重建覆盖。 */
  async evidenceLinks(key: string, taskKey?: string) {
    return serializeWork(this.workspace, async () => {
      const round = await this.round(key);
      const task = taskKey ?? round?.task_key ?? round?.evidence_task_key;
      if (!round || !task) return emptyEvidenceLinks(key);
      const receipts = task === round.task_key ? receiptLedger(round) : round.receipt_archives?.[task];
      if (!receipts) throw new SubmissionRejected(["该任务没有可回查的权威回执，历史身份未知"]);
      const { file } = await ensureEvidenceLinksIndex(this.workspace, task, receipts);
      return file;
    });
  }
  /** Registers stable, readable bytes only after a successful authorized write action; never publishes or approves them. */
  async observeDrafts(key: string, task: string, member: string) {
    return serializeWork(this.workspace, async () => {
      const round = await this.round(key), card = await this.read(key);
      if (round?.task_key !== task || !["generating", "repairing"].includes(round.phase ?? "generating")) return;
      let changed = false;
      const observations: Array<{ id: string; kind: string; at: string; task_key: string; filename: string; sha256: string }> = [];
      for (const file of card.deliverables) {
        if (file.member_id !== member || !round.turn.deliverables.includes(file.filename) ||
            (round.repair_plan && round.phase === "repairing" && !round.repair_plan.assignments.some((a) => a.member === member && a.files.includes(file.filename)))) continue;
        const path = `.任务/${task}/产物快照/${file.filename}`;
        let target = resolve(this.workspace);
        try {
          for (const part of path.split("/")) {
            if (!part || part === "." || part === "..") throw new Error("草稿路径无效");
            target = join(target, part);
            if ((await lstat(target)).isSymbolicLink()) throw new Error("不登记符号链接草稿");
          }
          const before = await lstat(target), bytes = await readFile(target), after = await lstat(target);
          if (!before.isFile() || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ino !== after.ino) continue;
          // A title-only placeholder is not a business draft. This is not a semantic quality judgment.
          if (!bytes.toString("utf8").split("\n").some((line) => line.trim() && !/^\s*#{1,6}\s/u.test(line))) continue;
          const hash = createHash("sha256").update(bytes).digest("hex");
          if (file.draft?.task_key === task && file.draft.sha256 === hash) continue;
          const directory = join(await this.directory(key), "草稿快照");
          await mkdir(directory, { recursive: true });
          if ((await lstat(directory)).isSymbolicLink()) throw new Error("不写入符号链接快照目录");
          const snapshot = join(directory, hash);
          try { await writeFile(snapshot, bytes, { flag: "wx", mode: 0o444 }); }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
          if ((await lstat(snapshot)).isSymbolicLink() || createHash("sha256").update(await readFile(snapshot)).digest("hex") !== hash) throw new Error("草稿快照哈希不符");
          const at = new Date().toISOString();
          file.draft = { task_key: task, path, sha256: hash, readable_at: at, first_readable_at: file.draft?.task_key === task ? file.draft.first_readable_at : at };
          file.status = "草稿 · 未检查";
          observations.push({ id: `draft-ready:${task}:${file.filename}:${hash}`, kind: "draft_ready", at, task_key: task, filename: file.filename, sha256: hash });
          changed = true;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
          throw error;
        }
      }
      if (changed) {
        card.updated_at = bump(card); await this.saveCard(card);
        for (const event of observations) await this.observe(key, event);
      }
    });
  }
  async readDraft(key: string, filename: string, hash: string) {
    const file = (await this.read(key)).deliverables.find((d) => d.filename === filename);
    if (!file?.draft || file.draft.sha256 !== hash || !/^[a-f0-9]{64}$/u.test(hash)) throw new PromateError("VERSION_CONFLICT", "草稿已变化，请重新查看当前入口", 409);
    const directory = join(await this.directory(key), "草稿快照"), target = join(directory, hash);
    if ((await lstat(directory)).isSymbolicLink() || (await lstat(target)).isSymbolicLink()) throw new Error("不读取符号链接快照");
    const bytes = await readFile(target);
    if (createHash("sha256").update(bytes).digest("hex") !== hash) throw new Error("草稿快照哈希不符");
    return { content: bytes.toString("utf8"), sha256: hash, draft: file.draft };
  }
  async draftActionable(key: string, filename: string, hash: string, clientAt: string) {
    return serializeWork(this.workspace, async () => {
      const card = await this.read(key), file = card.deliverables.find((d) => d.filename === filename);
      if (!file?.draft || file.draft.sha256 !== hash) return { recorded: false };
      await this.readDraft(key, filename, hash);
      if (!file.draft.actionable_at) {
        file.draft.actionable_at = new Date().toISOString();
        if (Number.isFinite(Date.parse(clientAt))) file.draft.actionable_client_at = clientAt;
        await this.saveCard(card);
        await this.observe(key, { id: `actionable:${file.draft.task_key}:${filename}:${hash}`, kind: "draft_actionable", at: file.draft.actionable_at, rule_version: "STD-v0.1", task_key: file.draft.task_key, filename, sha256: hash, client_at: file.draft.actionable_client_at, clock: "server_receipt_upper_bound; client clock error unmeasured" });
      }
      return { recorded: true };
    });
  }
  async inspectFile(key: string, input: { kind: unknown; id?: unknown; filename?: unknown; sha256?: unknown }) {
    const card = await this.read(key), reviews = await this.reviews(key);
    let path: string | undefined, hash: string | undefined, filename: string | undefined;
    if (input.kind === "delivery-version") {
      const target = card.delivery_receipts?.find(r => r.id === input.id)?.targets.find(t => t.filename === input.filename && t.sha256 === input.sha256);
      if (target && target.kind !== "draft") return new ContentObjectStore(this.workspace).readVersion(key, target.filename, target.sha256);
      path = target?.path; hash = target?.sha256; filename = target?.filename;
    } else if (input.kind === "material") {
      const m = card.materials.find((m) => m.path === input.id && m.parse_status === "ready");
      path = m?.readable_path; hash = m?.readable_sha256; filename = path?.split("/").at(-1);
    } else if (input.kind === "review-version" && typeof input.sha256 === "string" && /^[a-f0-9]{64}$/u.test(input.sha256) && typeof input.filename === "string" && reviews.reports?.some((r) => r.hashes[input.filename as string] === input.sha256)) {
      path = `.工作/${key}/被审版本/${input.sha256}`; hash = input.sha256; filename = input.filename;
    } else if (input.kind === "report") {
      const report = reviews.reports?.find((r) => r.request === input.id);
      path = report?.report; filename = path?.split("/").at(-1);
    }
    if (!path || !filename) throw new PromateError("FILE_DENIED", "文件不属于本工作已登记的材料或评审版本", 403);
    const target = resolve(this.workspace, path);
    if (!target.startsWith(`${resolve(this.workspace)}/`)) throw new PromateError("FILE_DENIED", "文件越界", 403);
    let checked = resolve(this.workspace);
    for (const part of target.slice(checked.length + 1).split("/")) { checked = join(checked, part); if ((await lstat(checked)).isSymbolicLink()) throw new PromateError("FILE_DENIED", "不读取符号链接", 403); }
    const bytes = await readFile(target);
    if (hash && createHash("sha256").update(bytes).digest("hex") !== hash) throw new PromateError("VERSION_CONFLICT", "版本哈希不一致", 409);
    return { filename, content: bytes.toString("utf8"), sha256: hash ?? createHash("sha256").update(bytes).digest("hex") };
  }
  async executions(key: string): Promise<import("../../promax-ui-console/src/execution-protocol.ts").MemberExecution[]> {
    try { return await this.json(key, "成员过程.yml"); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return []; throw e; }
  }
  async executionEvent(key: string, session: string, event: import("../../promax-ui-console/src/execution-protocol.ts").MemberExecution["events"][number], state?: "running" | "done" | "failed" | "stopped") {
    return serializeWork(this.workspace, async () => {
      const card = await this.read(key), round = await this.round(key), member = round?.children?.[session];
      if (!member || !round?.task_key) return;
      const entries = await this.executions(key);
      let entry = entries.find((e) => e.session_id === session && e.task_key === round.task_key);
      if (!entry) { entry = { session_id: session, parent_session: card.session_id, task_key: round.task_key, member, started_at: event.at, updated_at: event.at, state: "running", events: [] }; entries.push(entry); }
      if (entry.events.some((e) => e.id === event.id)) return;
      entry.events.push(event); entry.updated_at = event.at;
      if (state) { entry.state = state; if (state !== "running") entry.ended_at = event.at; else delete entry.ended_at; }
      await this.put(key, "成员过程.yml", entries);
    });
  }
  async materialRead(key: string, session: string, call: string, path: string, range: { offset?: number; limit?: number }) {
    return serializeWork(this.workspace, async () => {
      const card = await this.read(key), round = await this.round(key);
      const member = card.session_id === session ? "coordinator" : round?.children?.[session];
      if (!member) return;
      let material = card.materials.find((m) => [m.path, m.readable_path].some((p) => p && resolve(this.workspace, p) === resolve(this.workspace, path)));
      if (!material && round?.task_key && resolve(this.workspace, path).startsWith(`${resolve(this.workspace, ".任务", round.task_key, "输入", "sources")}/`)) {
        const bytes = await readFile(resolve(this.workspace, path));
        const hash = createHash("sha256").update(bytes).digest("hex");
        material = card.materials.find((m) => m.sha256 === hash || m.readable_sha256 === hash);
      }
      if (!material || material.reads?.some((r) => r.call_id === call && r.session_id === session)) return;
      material.reads = [...(material.reads ?? []), { member, session_id: session, call_id: call, at: new Date().toISOString(), ...range }];
      await this.saveCard(card);
    });
  }
  async validateRepairPlan(key: string, value: unknown): Promise<RepairPlan> {
    const card = await this.read(key), round = await this.round(key);
    const raw = value as Partial<RepairPlan> | null;
    const errors: string[] = [];
    if (!round?.task_key || round.phase !== "checking" || !round.check_results?.[String(round.judge_round)]) errors.push("只能对当前已接收检查安排返修");
    if (raw?.judge_round !== round?.judge_round) errors.push("judge_round 不是当前检查轮次");
    if ((round?.repair_round ?? 0) >= 2) errors.push("本次授权返修预算已耗尽，保留草稿待用户决定");
    if (round?.check_only) errors.push("本轮仅授权检查，未授权修改成果");
    const state = await this.reviews(key);
    if (!Array.isArray(raw?.assignments) || !raw.assignments.length) errors.push("assignments 至少需要一项明确安排");
    else for (const a of raw.assignments) {
      if (!a || typeof a.member !== "string" || typeof a.instruction !== "string" || !a.instruction.trim() || !Array.isArray(a.files) || !a.files.length || !Array.isArray(a.issue_ids) || !a.issue_ids.length) { errors.push("每项安排需要 member/files/issue_ids/instruction"); continue; }
      for (const file of a.files) if (!round?.turn.deliverables.includes(file) || !card.deliverables.some((d) => d.filename === file && d.member_id === a.member)) errors.push(`${file} 不属于 ${a.member} 的本轮授权范围`);
      for (const id of a.issue_ids) if (!state.issues.some((i) => i.group === round?.review_group && i.id === id && i.state !== "verified" && a.files.includes(i.artifact))) errors.push(`${id} 不是安排内成果的未关闭问题`);
    }
    if (errors.length) throw new SubmissionRejected(errors);
    return raw as RepairPlan;
  }
  async acceptRepairPlan(key: string, task: string, value: RepairPlan) {
    return serializeWork(this.workspace, async () => {
      const plan = await this.validateRepairPlan(key, value), round = (await this.round(key))!;
      if (round.task_key !== task) throw new SubmissionRejected(["返修任务已变化"]);
      await this.writeRound(key, { ...round, repair_plan: plan, phase: "repairing", repair_round: (round.repair_round ?? 0) + 1, allowed_members: [...new Set(plan.assignments.map((a) => a.member))], event_seq: round.event_seq });
      return { recorded: true };
    });
  }
  async reviews(key: string): Promise<ReviewState> {
    try { return await this.json<ReviewState>(key, "评审.yml"); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return emptyReviews(); throw e; }
  }
  /** Called under the work lock. Keeps immutable reviewed bytes, including versions never published. */
  private async prepareReview(key: string, round: WorkRound) {
    if (round.protocol !== 2 || round.phase !== "checking" || !round.task_key || !round.reviewed_hashes) return round;
    if (round.acceptance_baseline) round.acceptance_scope = acceptanceScope(round.acceptance_baseline, Object.keys(round.reviewed_hashes), round.turn.review_requirement_ids);
    const group = reviewGroup(Object.keys(round.reviewed_hashes));
    const request = `${round.task_key}:r${round.judge_round ?? 1}`;
    const state = await this.reviews(key);
    const previous = state.bindings[group];
    if (previous?.request?.id === request) return { ...round, review_group: group, review_request: request, ...(previous.session_id ? { children: { ...round.children, [previous.session_id]: "quality_judge" } } : {}) };
    if (previous?.request?.state === "pending" && previous.request.id !== request)
      throw new SubmissionRejected(["该评审组的上一请求尚未结束，不能并发覆盖"]);
    const directory = join(await this.directory(key), "被审版本");
    await mkdir(directory, { recursive: true });
    if ((await lstat(directory)).isSymbolicLink()) throw new Error("被审版本目录不得是符号链接");
    for (const [filename, hash] of Object.entries(round.reviewed_hashes)) {
      const bytes = await readFile(join(this.workspace, ".任务", round.task_key, "产物快照", filename));
      if (createHash("sha256").update(bytes).digest("hex") !== hash) throw new SubmissionRejected([`${filename} 在评审绑定前变化`]);
      const target = join(directory, hash);
      try { await writeFile(target, bytes, { flag: "wx", mode: 0o444 }); }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; if (createHash("sha256").update(await readFile(target)).digest("hex") !== hash) throw new Error("被审版副本损坏"); }
    }
    state.bindings[group] = { ...previous, group, files: Object.keys(round.reviewed_hashes), ...(round.runtime_snapshot?.snapshot_id ? { snapshot_id: round.runtime_snapshot.snapshot_id } : {}), request: { id: request, task_key: round.task_key, judge_round: round.judge_round ?? 1, hashes: round.reviewed_hashes, state: state.accepted.includes(request) ? "accepted" : "pending" } };
    await this.put(key, "评审.yml", state);
    return { ...round, review_group: group, review_request: request, ...(previous?.session_id ? { children: { ...round.children, [previous.session_id]: "quality_judge" } } : {}) };
  }
  async bindJudge(key: string, session: string) {
    const round = await this.round(key);
    if (!round?.review_group || !round.review_request) return;
    const state = await this.reviews(key), binding = state.bindings[round.review_group];
    if (!binding || binding.request?.id !== round.review_request) throw new SubmissionRejected(["评审请求已变化"]);
    if (binding.session_id && binding.session_id !== session) throw new SubmissionRejected(["同组Judge已绑定；不得以新会话覆盖历史连续性"]);
    binding.session_id = session;
    await this.put(key, "评审.yml", state);
  }
  /** Stores an accepted check result and the program-rendered report; one result per judge round, never overwritten. */
  async acceptCheckResult(key: string, record: CheckResultRecord, task_key: string, rendered: string) {
    return serializeWork(this.workspace, async () => {
      const round = await this.round(key);
      if (!round?.task_key || round.task_key !== task_key || round.phase !== "checking" || (round.judge_round ?? 1) !== record.judge_round)
        throw new SubmissionRejected(["检查轮次已变化，结果未保存"]);
      const prior = round.check_results?.[String(record.judge_round)];
      const canonical = (r: CheckResultRecord) => JSON.stringify([r.verdict, r.issues, r.rechecks ?? [], r.unverified, r.decisions, r.reviewed_hashes, r.acceptance]);
      if (round.review_request && record.review_request !== round.review_request) throw new SubmissionRejected(["评审请求已变化，迟到结果不能覆盖新请求"]);
      if (record.input_version !== (round.execution_version ?? 0)) throw new SubmissionRejected(["输入版本已变化"]);
      const stateBefore = await this.reviews(key);
      const binding = round.review_group ? stateBefore.bindings[round.review_group] : undefined;
      if (record.judge_session_id && binding?.session_id !== record.judge_session_id) throw new SubmissionRejected(["Judge授权会话已变化，旧提交不能接收"]);
      const strictJudge = await frozenJudgeContract(round);
      if (strictJudge && (!record.judge_session_id || binding?.session_id !== record.judge_session_id)) throw new SubmissionRejected(["新合同仅允许当前绑定Judge提交；不能以旧stage代替授权"]);
      const evidenceErrors = await validateJudgeResult(this.workspace, key, round, record, stateBefore, strictJudge);
      if (evidenceErrors.length) throw new SubmissionRejected(evidenceErrors);
      if (round.acceptance_baseline) {
        const card = await this.read(key);
        const errors = acceptanceErrors(round.acceptance_baseline, round.acceptance_scope ?? [], record.acceptance, record.verdict, record.unverified);
        if (round.execution_digest !== requirementsDigest(card) || card.acceptance_baseline?.version !== round.acceptance_baseline.version) errors.push("当前要求/基准已变化，旧结果不能接收");
        // R01：以权威回执为准重算依据，判 met 但缺依据的结果不接受。
        const evidence = await currentAcceptanceEvidence(this.workspace, acceptanceEvidence(round.acceptance_baseline, round.receipts), round.receipts);
        errors.push(...acceptanceGateErrors(round.acceptance_baseline, round.acceptance_scope ?? [], record.acceptance, evidence, (item) => item.files.every((file) => record.reviewed_hashes[file] !== undefined), { requirement_record: round.acceptance_baseline.sources.length > 0 }));
        if (errors.length) throw new SubmissionRejected(errors);
        record.acceptance_evidence = evidence;
      }
      if (JSON.stringify(Object.keys(record.reviewed_hashes).sort()) !== JSON.stringify(Object.keys(round.reviewed_hashes ?? {}).sort())) throw new SubmissionRejected(["被审文件集合不完整"]);
      for (const [file, hash] of Object.entries(record.reviewed_hashes)) {
        if (round.reviewed_hashes?.[file] !== hash || createHash("sha256").update(await readFile(join(this.workspace, ".任务", task_key, "产物快照", file))).digest("hex") !== hash)
          throw new SubmissionRejected([`${file} 已变化，不能接收旧版检查`]);
      }
      if (prior) {
        if (canonical(prior) === canonical(record)) return { duplicate: true, report: prior.report };
        throw new SubmissionRejected([`第 ${record.judge_round} 轮检查结果已保存，不能覆盖`]);
      }
      if (record.verdict === "PASS") {
        const state = await this.reviews(key);
        const open = state.issues.filter((i) => i.group === round.review_group && i.kind !== "suggestion" && !record.rechecks?.some((r) => r.id === i.id && r.state === "verified") && (i.state !== "verified" || i.input_version !== record.input_version || Object.entries(i.latest_hashes).some(([f, h]) => record.reviewed_hashes[f] !== h)));
        if (open.length || record.issues.some((i) => i.kind !== "suggestion")) throw new SubmissionRejected([`PASS 存在未关闭阻断问题：${[...open, ...record.issues.filter((i) => i.kind !== "suggestion")].map((i) => i.id).join("、")}`]);
      }
      const path = join(this.workspace, record.report);
      try {
        await writeFile(path, rendered, { flag: "wx", mode: 0o444 });
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
        // A retry after a partial commit reuses identical bytes; unrelated historical reports remain untouched.
        if (await readFile(path, "utf8") !== rendered) {
          record.report = record.report.replace(/\.md$/u, ".结构化.md");
          await writeFile(join(this.workspace, record.report), rendered, { flag: "wx", mode: 0o444 });
        }
      }
      const state = await this.reviews(key);
      const group = round.review_group ?? reviewGroup(Object.keys(record.reviewed_hashes));
      const request = round.review_request ?? `${task_key}:r${record.judge_round}`;
      if (!state.accepted.includes(request)) {
        for (const issue of record.issues) {
          let item = state.issues.find((i) => i.group === group && i.id === issue.id);
          if (!item) { item = { ...issue, group, state: "open", first_hashes: record.reviewed_hashes, latest_hashes: record.reviewed_hashes, history: [] }; state.issues.push(item); }
          else Object.assign(item, issue, { state: "open", latest_hashes: record.reviewed_hashes });
          delete item.resolution;
          item.input_version = record.input_version;
          item.history.push({ request, at: record.at, state: "open", evidence: issue.evidence, hashes: record.reviewed_hashes, report: record.report, ...(issue.citations ? { citations: issue.citations } : {}), claim_sha256: createHash("sha256").update(JSON.stringify([issue.artifact, issue.location, issue.evidence, issue.impact, issue.fix, issue.basis ?? null])).digest("hex") });
        }
        for (const result of record.rechecks ?? []) {
          const item = state.issues.find((i) => i.group === group && i.id === result.id);
          if (!item || record.issues.some((i) => i.id === result.id)) continue;
          item.state = result.state; item.latest_hashes = record.reviewed_hashes; item.input_version = record.input_version;
          if (result.state === "verified" && result.resolution) item.resolution = result.resolution;
          else delete item.resolution;
          item.history.push({ request, at: record.at, state: result.state, evidence: result.evidence, hashes: record.reviewed_hashes, report: record.report, ...(result.resolution ? { resolution: result.resolution } : {}), ...(result.citations ? { citations: result.citations } : {}) });
        }
        // Missing rechecks never close issues. A changed version reopens prior verified evidence.
        for (const item of state.issues.filter((i) => i.group === group && i.state === "verified")) {
          if (!record.rechecks?.some((r) => r.id === item.id) && Object.entries(item.latest_hashes).some(([f, h]) => record.reviewed_hashes[f] !== h)) { item.state = "changed"; delete item.resolution; }
        }
        state.accepted.push(request);
        state.reports = [...(state.reports ?? []), { request, report: record.report, hashes: record.reviewed_hashes, at: record.at, verdict: record.verdict, ...(round.runtime_snapshot?.snapshot_id ? { snapshot_id: round.runtime_snapshot.snapshot_id } : {}) }];
        if (state.bindings[group]?.request?.id === request) state.bindings[group]!.request!.state = "accepted";
        await this.put(key, "评审.yml", state);
      }
      record.evaluation_binding = { scope: [...round.acceptance_scope ?? []], snapshot_id: round.runtime_snapshot?.snapshot_id ?? null, evaluator_version: "acceptanceStates/evaluation-1" };
      await this.writeRound(key, { ...round, check_results: { ...round.check_results, [String(record.judge_round)]: record } });
      const status = await this.statusRaw(key);
      resolveFaults(status, "check", record.at, ["check_run_failed", "check_output_invalid"]);
      status.checkpoint = { at: record.at, phase: "checking", task_key, judge_round: record.judge_round, hashes: record.reviewed_hashes, note: `已接收第 ${record.judge_round} 轮检查结果：${record.verdict}` };
      await this.writeStatusRaw(key, status);
      return { duplicate: false, report: record.report };
    });
  }
  /** Outputs produced under replaced requirements are redone only for those files, from the saved versions. */
  async proposeRedo(key: string, files: string[], seq: number, note: string) {
    return serializeWork(this.workspace, async () => {
      const previous = await this.round(key);
      if (!previous || previous.phase !== "ended") return;
      const card = await this.read(key);
      const saved = files.filter((f) => card.deliverables.some((d) => d.filename === f));
      if (!saved.length) return;
      await this.writeRound(key, {
        ...discussionRound(previous, note),
        event_seq: seq,
        turn: { intent: "execute", card_patch: {}, deliverables: saved, edit_request: null },
        ...(saved.every((f) => card.deliverables.find((d) => d.filename === f)?.current_sha256) ? { revise: { decision_ids: [], event_ids: [], instruction: note } } : {}),
      });
    });
  }
  async markEventsAttempted(key: string, ids: readonly string[]) {
    if (!ids.length) return;
    return serializeWork(this.workspace, async () => {
      const card = await this.read(key);
      for (const e of card.events ?? []) if (ids.includes(e.id)) e.attempts = (e.attempts ?? 0) + 1;
      await this.saveCard(card);
    });
  }
  /** Inputs that could not be understood after the recovery budget stay recorded and visibly failed. */
  async failEvents(key: string, ids: readonly string[], note: string) {
    if (!ids.length) return;
    return serializeWork(this.workspace, async () => {
      const card = await this.read(key);
      for (const e of card.events ?? [])
        if (ids.includes(e.id) && ["received", "clarifying"].includes(e.state)) {
          e.state = "failed";
          e.note = note;
          e.handled_at = new Date().toISOString();
        }
      card.updated_at = bump(card);
      await this.saveCard(card);
    });
  }
  async recordUsage(key: string, records: StoredStatus["usage"]) {
    if (!records.length) return;
    return serializeWork(this.workspace, async () => {
      const status = await this.statusRaw(key);
      const seen = new Set(status.usage.map((u) => u.event_seq));
      const fresh = records.filter((r) => !seen.has(r.event_seq));
      if (!fresh.length) return;
      status.usage = [...status.usage, ...fresh].slice(-500);
      await this.writeStatusRaw(key, status);
    });
  }
  /** Records one input exactly once; a repeated submission returns the original record and changes nothing. */
  async recordEvent(key: string, input: EventInput) {
    return serializeWork(this.workspace, async () => {
      const card = await this.read(key);
      const { event, duplicate } = addEvent(card, await this.round(key), input, new Date().toISOString());
      if (!duplicate) {
        card.updated_at = bump(card);
        await this.saveCard(card);
      }
      return { card, event, duplicate };
    });
  }
  async list(): Promise<WorkCard[]> {
    let root: string;
    try {
      root = await this.directory();
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw e;
    }
    const cards: WorkCard[] = [];
    for (const entry of await readdir(root, { withFileTypes: true }))
      if (entry.isDirectory()) {
        try {
          cards.push(await this.read(entry.name));
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
        }
      }
    return cards.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }
  async read(key: string): Promise<WorkCard> {
    const c = await this.json<WorkCard>(key, "工作卡.yml");
    if (c.schema_version !== 1 || c.work_key !== key)
      throw new Error("工作卡格式无效");
    ensureSpine(c);
    return c;
  }
  async forSession(id: string) {
    return (await this.list()).find((c) => c.session_id === id);
  }
  async round(key: string): Promise<WorkRound | undefined> {
    try {
      const round = await this.json<WorkRound>(key, "回合.yml");
      for (const review of [round.last_check, ...Object.values(round.check_results ?? {})]) {
        if (review?.acceptance_evidence) review.current_acceptance_evidence = await currentAcceptanceEvidence(this.workspace, review.acceptance_evidence, round.receipts);
      }
      return round;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw e;
    }
  }
  async writeRound(key: string, round: WorkRound) {
    const saved = structuredClone(round);
    for (const review of [saved.last_check, ...Object.values(saved.check_results ?? {})]) if (review) delete review.current_acceptance_evidence;
    await this.put(key, "回合.yml", saved);
    for (const record of evaluationRecords(saved)) await this.observe(key, record);
  }
  async endStoppedRound(
    sessionId: string,
    taskKey: string,
    revision: string,
    cancelled = true,
  ) {
    return serializeWork(this.workspace, async () => {
      const card = await this.forSession(sessionId);
      if (!card) return;
      const round = await this.round(card.work_key);
      // A delayed cancellation must never revoke a newer round's authorization.
      if (
        !round ||
        round.task_key !== taskKey ||
        round.revision !== revision ||
        round.phase === "ended"
      )
        return;
      await this.writeRound(card.work_key, {
        ...round,
        phase: "ended",
        allowed_members: [],
      });
      if (cancelled) card.last_progress = "已停止 · 已有草稿保留 · 未检查";
      card.updated_at = new Date(
        Math.max(Date.now(), Date.parse(card.updated_at) + 1),
      ).toISOString();
      await this.saveCard(card);
      return card;
    });
  }
  async create(input: {
    session_id: string;
    project_id: string;
    title: string;
    shortname: string;
  }): Promise<WorkCard> {
    return serializeWork(this.workspace, async () => {
      const existing = await this.forSession(input.session_id);
      if (existing) return existing;
      const cards = await this.list(),
        base = workKey(input.shortname);
      let key = base,
        i = 1;
      while (cards.some((c) => c.work_key === key)) key = `${base}-${++i}`;
      const card: WorkCard = {
        schema_version: 1,
        requirements_protocol: 1,
        work_key: key,
        session_id: input.session_id,
        project_id: input.project_id,
        title: input.title,
        goal: "",
        materials: [],
        confirmed: [],
        pending: [],
        deliverables: [],
        last_progress: "尚未开始",
        updated_at: new Date().toISOString(),
      };
      await this.saveCard(card);
      return card;
    });
  }
  async update(
    key: string,
    patch: {
      title?: string;
      goal?: string;
      confirmed_text?: string;
      /** An explicit choice (button or exact option text). Free text goes through recordEvent and the coordinator. */
      answer?: { id: string; text: string; event_id?: string };
      remove_confirmed?: string;
      withdraw_decision?: string;
      resend_decision?: string;
    },
    base: string,
  ): Promise<WorkCard> {
    return serializeWork(this.workspace, async () => {
      const card = await this.read(key);
      const active = await this.round(key);
      if (active?.task_key && active.phase !== "ended")
        throw new PromateError(
          "RUN_CONFLICT",
          "请先停止当前执行再修改工作卡",
          409,
        );
      if (card.updated_at !== base)
        throw new PromateError(
          "WORK_CONFLICT",
          "工作卡已变化，请重新确认",
          409,
        );
      const before = requirementsDigest(card);
      if (patch.title?.trim()) card.title = patch.title.trim();
      if (patch.goal?.trim()) card.goal = patch.goal.trim();
      if (patch.confirmed_text?.trim())
        card.confirmed.push({
          text: patch.confirmed_text.trim().slice(0, 1000),
          confirmed_at: new Date().toISOString(),
          source: "form",
        });
      if (patch.answer) {
        const item = card.pending.find((p) => p.id === patch.answer!.id);
        const answer = withoutRecommendation(patch.answer.text);
        if (!item || !answer)
          throw new PromateError(
            "WORK_CONFLICT",
            "这项待决定事项已变化，请刷新后再回答",
            409,
          );
        recordDecision(card, item, answer, new Date().toISOString(), patch.answer.event_id);
      }
      if (patch.withdraw_decision) {
        const record = card.decisions?.find(
          (d) => d.id === patch.withdraw_decision && !INACTIVE_DECISION.has(d.state),
        );
        if (
          !record ||
          !["processing", "failed", "no_change", "recorded"].includes(record.state)
        )
          throw new PromateError(
            "WORK_CONFLICT",
            "这个决定已在修改成果中或已完成，不能撤回",
            409,
          );
        // Withdrawal keeps the answer as history; it just stops being an effective requirement.
        const now = new Date().toISOString();
        card.confirmed = card.confirmed.filter(
          (c) => !(c.source === "decision" && c.text === decisionText(record)),
        );
        const {
          answer: _a,
          answered_at: _t,
          state: _s,
          note: _n,
          task_key: _k,
          base_sha256: _b,
          applied_sha256: _p,
          source_event: _e,
          superseded_by: _y,
          closed_at: _c,
          ...question
        } = record;
        record.id = historyId(card, record.id);
        record.state = "withdrawn";
        record.closed_at = now;
        card.pending = [...card.pending, { ...question, updated_at: now }];
      }
      if (patch.resend_decision) {
        const record = card.decisions?.find(
          (d) => d.id === patch.resend_decision && !INACTIVE_DECISION.has(d.state),
        );
        // "processing" is included: the page may know the follow-up turn failed before the store does.
        if (
          !record ||
          !["processing", "failed", "no_change", "partial"].includes(
            record.state,
          )
        )
          throw new PromateError(
            "WORK_CONFLICT",
            "这个决定不需要重新发送",
            409,
          );
        record.state = "processing";
        record.answered_at = new Date().toISOString();
        delete record.note;
      }
      if (patch.remove_confirmed)
        card.confirmed = card.confirmed.filter(
          (c) => c.confirmed_at + c.text !== patch.remove_confirmed,
        );
      if (before !== requirementsDigest(card)) {
        const affected = patch.answer
          ? card.decisions?.find((d) => d.id === patch.answer!.id)
          : undefined;
        invalidateNodes(card, affected?.node_id, affected?.artifact);
      }
      // A card edit cancels any waiting proposal and never carries a finished run's phase into the next one.
      if (active)
        await this.writeRound(key, discussionRound(active, active.demand));
      card.updated_at = bump(card);
      await this.saveCard(card);
      return card;
    });
  }
  /** Navigation/draft writes never change the round or grant execution authority. */
  async interact(
    key: string,
    input: {
      navigation?: Partial<WorkNavigation>;
      drafts?: Record<string, string>;
      defer_question?: string;
      restore_question?: string;
      defer_topic?: string;
      continue_topic?: string;
      confirm_node?: string;
      scope_decision?: "accept" | "reject";
      scope_moves?: WorkScopeMove[];
      scope_expected?: string;
      confirm_condition?: { node_id: string; condition_id: string; basis: string };
      feedback?: { node_id?: string; condition_id?: string; artifact?: string; decision_id?: string; kind: WorkFeedback["kind"]; text: string };
      review_feedback?: { id: string; state: "confirmed" | "disputed" | "resolved"; basis: string };
    },
    author = "personal",
  ) {
    return serializeWork(this.workspace, async () => {
      const card = await this.read(key);
      if (input.drafts) {
        card.drafts ??= {};
        for (const [name, text] of Object.entries(input.drafts)) {
          if (
            name.length > 180 ||
            ["__proto__", "constructor", "prototype"].includes(name) ||
            typeof text !== "string" ||
            text.length > 200_000
          )
            throw new Error("草稿格式或长度无效");
          if (text) card.drafts[name] = text;
          else delete card.drafts[name];
        }
      }
      if (input.navigation) {
        const nav = {
          mode: "overview" as const,
          ...card.navigation,
          ...input.navigation,
        };
        if (
          nav.workspace_view &&
          !["spine", "artifact", "document"].includes(nav.workspace_view)
        )
          throw new Error("工作视图无效");
        const ref = (v: unknown, max = 180) =>
          v === undefined ||
          (typeof v === "string" && v.length <= max && !/[\0\r\n]/u.test(v));
        const hash = (v: unknown) =>
          v === undefined || (typeof v === "string" && /^[a-f0-9]{64}$/u.test(v));
        if (nav.doc_pages !== undefined) {
          if (!Array.isArray(nav.doc_pages) || nav.doc_pages.length > 12)
            throw new Error("文档活动页无效");
          for (const page of nav.doc_pages)
            if (
              !page ||
              typeof page !== "object" ||
              !ref(page.id) ||
              !page.id ||
              !["artifact", "brief", "check"].includes(page.kind) ||
              !ref(page.filename) ||
              !hash(page.sha256) ||
              !ref(page.highlight, 2000) ||
              (page.kind !== "brief" &&
                !card.deliverables.some((d) => d.filename === page.filename))
            )
              throw new Error("文档活动页无效或文档不属于本工作");
          if (new Set(nav.doc_pages.map((p) => p.id)).size !== nav.doc_pages.length)
            throw new Error("同一文档版本只能有一个活动页");
        }
        if (
          nav.active_doc &&
          !(nav.doc_pages ?? []).some((p) => p.id === nav.active_doc)
        )
          throw new Error("活动页不存在");
        if (nav.chat_items !== undefined) {
          if (!Array.isArray(nav.chat_items) || nav.chat_items.length > 40)
            throw new Error("聊天操作面板无效");
          for (const item of nav.chat_items)
            if (
              !item ||
              typeof item !== "object" ||
              !item.id ||
              !ref(item.id) ||
              !["question", "acceptance", "condition", "feedback", "change"].includes(item.kind) ||
              typeof item.opened_at !== "string" ||
              !Number.isFinite(Date.parse(item.opened_at)) ||
              ![item.question_id, item.filename, item.node_id, item.condition_id, item.decision_id, item.result_id].every((v) => ref(v)) ||
              !ref(item.location, 2000) ||
              !hash(item.sha256) ||
              !hash(item.base_sha256) ||
              (["acceptance", "change"].includes(item.kind) && (!item.filename || !item.sha256))
            )
              throw new Error("聊天操作面板无效");
          if (new Set(nav.chat_items.map((i) => i.id)).size !== nav.chat_items.length)
            throw new Error("聊天操作面板重复");
        }
        if (
          nav.expanded_node_ids &&
          (!Array.isArray(nav.expanded_node_ids) ||
            nav.expanded_node_ids.length > 100 ||
            nav.expanded_node_ids.some(
              (id) => typeof id !== "string" || id.length > 180,
            ))
        )
          throw new Error("主线展开位置无效");
        if (
          nav.tree_scroll !== undefined &&
          (!Number.isFinite(nav.tree_scroll) || nav.tree_scroll < 0)
        )
          throw new Error("主线滚动位置无效");
        if (!["overview", "node", "question"].includes(nav.mode))
          throw new Error("浏览位置无效");
        if (nav.opened_question_ids !== undefined) {
          if (!Array.isArray(nav.opened_question_ids) || nav.opened_question_ids.length > 100 || nav.opened_question_ids.some((id) => typeof id !== "string" || id.length > 180)) throw new Error("事项 Tab 无效");
          nav.opened_question_ids = [...new Set(nav.opened_question_ids)].filter((id) => [...card.pending, ...(card.decisions ?? [])].some((p) => p.id === id));
        }
        if (nav.located_node_id && !card.spine?.nodes.some((n) => n.id === nav.located_node_id)) throw new Error("定位节点不存在");
        if (nav.node_id && !card.spine?.nodes.some((n) => n.id === nav.node_id))
          throw new Error("节点不存在");
        if (nav.mode === "question") {
          const item = [...card.pending, ...(card.decisions ?? [])].find((p) => p.id === nav.question_id);
          if (!item) throw new Error("问题已变化，请返回主线查看");
          if (item.node_id) nav.node_id = item.node_id;
        } else delete nav.question_id;
        if (nav.mode === "overview") {
          delete nav.node_id;
          if (card.navigation?.mode !== "overview") nav.returned_at = new Date().toISOString();
        }
        if (
          nav.filename &&
          !card.deliverables.some((d) => d.filename === nav.filename)
        )
          throw new Error("成果不属于本工作");
        if (
          nav.highlight &&
          (typeof nav.highlight !== "string" || nav.highlight.length > 2000)
        )
          throw new Error("浏览锚点无效");
        card.navigation = nav;
      }
      for (const [id, timing] of [
        [input.defer_question, "later"],
        [input.restore_question, "now"],
      ] as const) {
        if (!id) continue;
        const item = card.pending.find((p) => p.id === id);
        if (!item) throw new Error("问题不存在");
        for (const copy of card.pending.filter(
          (p) => p.id === item.id || sameDecision(p, item),
        ))
          copy.timing = timing;
        // Explicitly moving a problem back into scope invalidates previous completion.
        if (timing === "now")
          invalidateNodes(card, item.node_id, item.artifact);
      }
      if (input.defer_topic || input.continue_topic) {
        const topic = card.side_topics?.find(
          (t) => t.id === (input.defer_topic ?? input.continue_topic),
        );
        if (!topic) throw new Error("后续事项不存在");
        topic.deferred = !!input.defer_topic;
        topic.continued = !!input.continue_topic;
        if (input.continue_topic)
          card.navigation = {
            ...card.navigation,
            mode: "node",
            ...(topic.node_id ? { node_id: topic.node_id } : {}),
          };
        if (input.defer_topic)
          card.navigation = {
            ...card.navigation,
            mode: "overview",
            returned_at: new Date().toISOString(),
          };
      }
      if (input.scope_decision) {
        const round = await this.round(key);
        if (round?.task_key && round.phase !== "ended")
          throw new PromateError(
            "RUN_CONFLICT",
            "请等待当前执行结束后调整总目标",
            409,
          );
        if (!card.scope_proposal) throw new Error("没有待确认的范围变化");
        if (!["accept", "reject"].includes(input.scope_decision)) throw new Error("范围决定无效");
        if (input.scope_decision === "accept") planScopeChange(card, input.scope_moves);
        if ((input.scope_expected !== undefined || input.scope_decision === "accept" && scopeRemovals(card).length) && input.scope_expected !== scopeSignature(card)) throw new Error("范围提案或关联事项已有变化，请重新过目后确认");
        settleScopeChange(card, input.scope_decision, author, randomUUID(), new Date().toISOString(), input.scope_moves);
      }
      if (input.feedback) {
        const f = input.feedback;
        if (!f.text?.trim() || f.text.length > 4000 || !["defect", "requirement", "disagreement"].includes(f.kind)) throw new Error("请说明问题，并区分原错误、新要求或分歧");
        const node = card.spine?.nodes.find((n) => n.id === f.node_id);
        if (f.node_id && !node || f.condition_id && !node?.conditions?.some((c) => c.id === f.condition_id) || f.artifact && !card.deliverables.some((d) => d.filename === f.artifact) || f.decision_id && !card.decisions?.some((d) => d.id === f.decision_id)) throw new Error("反馈位置已变化");
        if (!node && !f.artifact && !f.decision_id) throw new Error("反馈需要关联节点、结论或成果");
        const entry: WorkFeedback = { id: randomUUID(), kind: f.kind, text: f.text.trim(), at: new Date().toISOString(), state: "pending", reviews: [], hashes: Object.fromEntries(card.deliverables.filter((d) => d.current_sha256).map((d) => [d.filename, d.current_sha256!])), ...(f.node_id ? { node_id: f.node_id } : {}), ...(f.condition_id ? { condition_id: f.condition_id } : {}), ...(f.artifact ? { artifact: f.artifact } : {}), ...(f.decision_id ? { decision_id: f.decision_id } : {}) };
        if (!card.feedback?.some((old) => old.state !== "resolved" && old.kind === entry.kind && old.text === entry.text && old.node_id === entry.node_id && old.condition_id === entry.condition_id && old.artifact === entry.artifact && old.decision_id === entry.decision_id))
          card.feedback = [...(card.feedback ?? []), entry];
        invalidateNodes(card, node?.id, f.artifact);
      }
      if (input.review_feedback) {
        const review = input.review_feedback;
        const item = card.feedback?.find((f) => f.id === review.id);
        if (!item || !["confirmed", "disputed", "resolved"].includes(review.state) || !review.basis?.trim() || review.basis.length > 4000) throw new Error("复核需要原要求、依据和处理说明");
        if (review.state === "resolved" && item.artifact && item.kind === "defect") {
          const file = card.deliverables.find((d) => d.filename === item.artifact);
          const round = await this.round(key);
          if (!file?.current_sha256 || file.current_sha256 === item.hashes[item.artifact] || round?.last_check?.requirements_digest !== requirementsDigest(card) || round.last_check.reviewed_hashes[item.artifact] !== file.current_sha256) throw new Error("修正尚未形成已检查的新版本，不能核销此问题");
          const check = parseJudgeReport(await readFile(join(this.workspace, round.last_check.report), "utf8"), { hashes: round.last_check.reviewed_hashes, scope: "", round: round.last_check.judge_round });
          if (check.report?.verdict !== "PASS") throw new Error("修正后的检查尚未通过");
        }
        item.state = review.state;
        item.reviews.push({ state: review.state, basis: review.basis.trim(), at: new Date().toISOString(), author });
      }
      if (input.confirm_condition) {
        const inputCondition = input.confirm_condition;
        const node = card.spine?.nodes.find((n) => n.id === inputCondition.node_id);
        const condition = node?.conditions?.find((c) => c.id === inputCondition.condition_id);
        if (!node || !condition || condition.kind !== "manual" || !inputCondition.basis?.trim() || inputCondition.basis.length > 2000 || feedbackFor(card, node).length) throw new Error("仅可核对无未决反馈的人工条件，并提供依据");
        // An old panel confirming an already satisfied condition keeps the original evidence.
        if (!conditionSatisfied(card, node, condition))
          condition.evidence = { at: new Date().toISOString(), digest: conditionDigest(card, node, condition), hashes: {}, basis: inputCondition.basis.trim(), author };
      }
      if (input.confirm_node) {
        const node = card.spine?.nodes.find((n) => n.id === input.confirm_node);
        if (!node || node.gate !== "employee")
          throw new Error("此节点必须依据成果与有效检查完成，不能手动打勾");
        if (node.conditions?.length) throw new Error("请依据具体完成条件核对，不能整体打勾");
        if (nodeOutstanding(card, node).length || feedbackFor(card, node).length)
          throw new Error("本节点仍有本次待决定事项或待复核问题");
        node.evidence = {
          at: new Date().toISOString(),
          digest: nodeDigest(card, node),
          hashes: {},
        };
        delete node.needs_update;
      }
      await this.reconcileNodes(card, await this.round(key));
      card.updated_at = bump(card);
      await this.saveCard(card);
      return card;
    });
  }
  private async reconcileNodes(card: WorkCard, round?: WorkRound) {
    ensureSpine(card);
    const bound = round?.last_check;
    if (!bound || bound.requirements_digest !== requirementsDigest(card))
      return;
    let text: string;
    try {
      text = await readFile(join(this.workspace, bound.report), "utf8");
    } catch (e) {
      if ((e as { code?: string }).code === "ENOENT") return;
      throw e;
    }
    const report = parseJudgeReport(text, {
      hashes: bound.reviewed_hashes,
      scope: "",
      round: bound.judge_round,
    }).report;
    if (!report || report.verdict !== "PASS") return;
    const entries = new ContentObjectStore(this.workspace)
      .index()
      .artifacts.filter((a) => a.work_key === card.work_key);
    for (const node of card.spine?.nodes ?? []) {
      if (feedbackFor(card, node).length) continue;
      for (const condition of node.conditions ?? []) {
        if (condition.kind !== "artifact" || !condition.filenames.every((f) => bound.reviewed_hashes[f] === card.deliverables.find((d) => d.filename === f)?.current_sha256 && entries.find((a) => a.filename === f)?.current_sha256 === bound.reviewed_hashes[f])) continue;
        const confirmations = condition.filenames.map((f) => card.acceptances?.findLast((a) => a.filename === f && a.sha256 === bound.reviewed_hashes[f] && a.digest === requirementsDigest(card) && a.condition_ids.includes(`${node.id}/${condition.id}`)));
        if (!confirmations.every(Boolean)) continue;
        condition.evidence = { at: confirmations.at(-1)!.at, digest: conditionDigest(card, node, condition), hashes: Object.fromEntries(condition.filenames.map((f) => [f, bound.reviewed_hashes[f]!])), basis: "员工已过目并确认此版本满足本条件；独立检查有效", report: bound.report, author: confirmations.at(-1)!.author };
      }
      if (node.gate === "employee" || nodeOutstanding(card, node).length)
        continue;
      if (
        !node.filenames.every((f) => {
          const current = entries.find((a) => a.filename === f)?.current_sha256;
          return (
            !!current &&
            current === bound.reviewed_hashes[f] &&
            current ===
              card.deliverables.find((d) => d.filename === f)?.current_sha256
          );
        })
      )
        continue;
      if (
        (card.decisions ?? []).some(
          (d) =>
            (d.node_id === node.id ||
              (!!d.artifact && node.filenames.includes(d.artifact))) &&
            d.state !== "applied",
        )
      )
        continue;
      if (
        node.filenames.some(
          (f) =>
            !card.acceptances?.some((a) => a.filename === f && a.sha256 === bound.reviewed_hashes[f] && a.digest === requirementsDigest(card)),
        )
      )
        continue;
      node.evidence = {
        at: new Date().toISOString(),
        digest: nodeDigest(card, node),
        hashes: Object.fromEntries(
          node.filenames.map((f) => [f, bound.reviewed_hashes[f]!]),
        ),
      };
      delete node.needs_update;
    }
  }
  async bindDecision(key: string, id: string, base: string, artifact: string) {
    return serializeWork(this.workspace, async () => {
      const card = await this.read(key),
        round = await this.round(key);
      const decision = card.decisions?.find((d) => d.id === id);
      if (!decision || !round || round.turn.intent !== "edit")
        throw new Error("决定或修改请求已变化");
      decision.state = "awaiting_start";
      decision.artifact = artifact;
      decision.base_sha256 = base;
      delete decision.note;
      await this.writeRound(key, {
        ...round,
        decision_ids: [id],
        ...(decision.node_id ? { node_id: decision.node_id } : {}),
      });
      card.updated_at = bump(card);
      await this.saveCard(card);
    });
  }
  /** An answer is only applied after its bound run publishes a different current version and a valid check. */
  async finishDecisions(
    key: string,
    round: WorkRound,
    success: boolean,
    note: string,
  ) {
    return serializeWork(this.workspace, async () => {
      const card = await this.read(key);
      const entries = new ContentObjectStore(this.workspace)
        .index()
        .artifacts.filter((a) => a.work_key === key);
      const published = (filename: string, base?: string) => {
        const entry = entries.find((a) => a.filename === filename);
        return entry &&
          entry.current_sha256 !== base &&
          entry.versions.some((v) => v.task_key === round.task_key && v.sha256 === entry.current_sha256)
          ? entry.current_sha256
          : undefined;
      };
      for (const d of card.decisions ?? []) {
        if (!round.decision_ids?.includes(d.id) || INACTIVE_DECISION.has(d.state)) continue;
        const files = d.affects?.length ? d.affects : d.artifact ? [d.artifact] : [];
        const applied = files.map((f) => published(f, f === d.artifact ? d.base_sha256 : undefined));
        const changed = files.length > 0 && applied.every(Boolean);
        // An adopted decision whose revision did not land is a visible failure, never "handled".
        d.state = changed ? (success ? "applied" : "partial") : "failed";
        d.note = changed
          ? note
          : "决定已保留，但本次执行没有发布受影响成果的新版本；可重试或补充修改位置";
        if (changed) d.applied_sha256 = applied.at(-1)!;
        d.closed_at = new Date().toISOString();
      }
      for (const e of card.events ?? []) {
        if (e.state !== "pending_apply" || !e.affects?.length || !e.affects.every((f) => round.turn.deliverables.includes(f))) continue;
        const done = e.affects.every((f) => published(f));
        e.state = done && success ? "applied" : "failed";
        e.note = `${e.note ? `${e.note}；` : ""}${done ? (success ? "成果已更新并完成检查" : "成果已更新，检查未通过或未完成") : "本次执行没有发布受影响成果的新版本"}`;
        e.handled_at = new Date().toISOString();
      }
      await this.reconcileNodes(card, round);
      card.updated_at = bump(card);
      await this.saveCard(card);
    });
  }
  async materials(key: string, materials: WorkCard["materials"]) {
    return serializeWork(this.workspace, async () => {
      const card = await this.read(key);
      card.materials = [
        ...card.materials.filter(
          (m) => !materials.some((n) => n.path === m.path),
        ),
        ...materials,
      ];
      card.updated_at = new Date().toISOString();
      await this.saveCard(card);
    });
  }
  async employeeMessage(
    key: string,
    demand: string,
    attachments: string[],
    suggestionTarget?: string,
    input: Omit<EventInput, "text" | "paths" | "suggestion"> = { channel: "chat" },
  ) {
    return serializeWork(this.workspace, async () => {
      const previous = await this.round(key);
      const card = await this.read(key);
      if (demand.length > 20000) throw new Error("补充内容过长，请作为材料提交");
      const at = new Date().toISOString();
      const { event, duplicate } = addEvent(card, previous, { ...input, text: demand, paths: attachments, ...(suggestionTarget ? { suggestion: suggestionTarget } : {}) }, at);
      // A retried send of the same input is acknowledged without a second dispatch or record.
      if (duplicate) return { card, event, duplicate };
      if (!card.origin && !card.goal && (card.events?.length ?? 0) <= 1)
        card.origin = { text: demand, at, paths: attachments };
      const before = requirementsDigest(card);
      // The same time stamps the suggestion history and this input, so the reported state is the one recorded.
      if (replyToSuggestion(card, demand, suggestionTarget, at)) {
        const settled = card.suggestions?.find((s) => s.history?.at(-1)?.at === at);
        event.state = "applied";
        event.intent = "decision";
        event.note = `已记录对建议「${settled?.text ?? suggestionTarget ?? ""}」的回应：${settled?.state === "accepted" ? "采纳（计划口径，不代表已执行）" : settled?.state === "rejected" ? "不采纳" : "按反馈调整"}`;
        event.handled_at = at;
      }
      if (before !== requirementsDigest(card)) invalidateNodes(card);
      if (previous?.task_key && previous.phase !== "ended") {
        card.during_run = [...(card.during_run ?? []), { id: event.id, text: demand, paths: attachments, at, task_key: previous.task_key, ...(card.navigation?.node_id ? { node_id: card.navigation.node_id } : {}), ...(card.navigation?.question_id ? { question_id: card.navigation.question_id } : {}) }];
        invalidateNodes(card);
      }
      card.updated_at = bump(card);
      await this.saveCard(card);
      if (!(previous?.task_key && previous.phase !== "ended"))
        await this.writeRound(key, {
          ...discussionRound(previous, demand),
          attachments,
        });
      return { card, event, duplicate };
    });
  }
  /**
   * Checks a structured proposal against the current records without changing anything. Used when the
   * coordinator submits, so every binding problem is returned to it as a concrete error.
   */
  async validateProposal(key: string, turn: WorkTurn, contract: WorkContract, messages: readonly string[] = []) {
    const card = await this.read(key);
    const round = await this.round(key);
    const errors = [...bindHandledEvents(structuredClone(card), turn.handled_events ?? [], round, new Date().toISOString(), contract, true).errors];
    if (turn.review_requirement_ids) {
      if (round?.source !== "proposal") errors.push("开始检查后不能改变 scope；留待下一次授权");
      if (!card.acceptance_baseline || turn.review_requirement_ids.some((id) => !card.acceptance_baseline!.items.some((i) => i.id === id))) errors.push("局部评审必须引用已存在的验收基准 ID，初次任务默认全任务检查");
    }
    const corpus = [...messages, ...(card.origin ? [card.origin.text] : []), ...(card.events ?? []).map((e) => e.text)];
    for (const s of turn.card_patch.employee_said ?? []) if (!verifiedEmployeeStatements([s], corpus).length) errors.push(`employee_said 无法绑定真实明确原话：${s.quote}`);
    if (turn.intent === "edit" && turn.edit_request) {
      try { preflightEdit(new ContentObjectStore(this.workspace), key, turn.edit_request); }
      catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
    }
    return errors;
  }
  async propose(
    key: string,
    text: string | WorkTurn,
    seq: number,
    contract: WorkContract,
    employeeMessages: readonly string[] = [],
    structured?: { call_id: string },
  ) {
    return serializeWork(this.workspace, async () => {
      const round = await this.round(key);
      if (!round || seq <= round.event_seq || round.source !== "proposal")
        return;
      const turn = typeof text === "string" ? parseWorkTurn(text, contract) : text,
        card = await this.read(key);
      if (turn.intent === "edit") {
        if (!turn.edit_request || turn.deliverables.length !== 1 || turn.deliverables[0] !== turn.edit_request.filename) throw new SubmissionRejected(["edit 仅允许单份成果的指定范围；跨章节/多成果更新用 execute 按影响修订"]);
        preflightEdit(new ContentObjectStore(this.workspace), key, turn.edit_request);
      }
      const at = new Date().toISOString();
      const handled = bindHandledEvents(card, turn.handled_events ?? [], round, at, contract, false);
      if (handled.errors.length) throw new SubmissionRejected(handled.errors);
      const hadSpine = !!card.spine;
      applyDraftPatch(card, turn, employeeMessages);
      const extra = turn.deliverables.filter(
        (f) => !card.deliverables.some((d) => d.filename === f),
      );
      if (hadSpine && extra.length) {
        card.scope_proposal = {
          ...card.scope_proposal,
          goal: card.scope_proposal?.goal ?? card.goal,
          ...(card.scope_proposal?.nodes
            ? { nodes: card.scope_proposal.nodes }
            : {}),
          reason:
            card.scope_proposal?.reason ??
            `新增成果 ${extra.join("、")} 将扩大本次交付范围；现有成果保留，需员工明确决定。`,
          deliverables: extra.map((filename) => ({
            filename,
            member_id: workMembers([filename], contract)[0]!,
            current_sha256: null,
            status: "未开始",
          })),
        };
      }
      // Unaccepted display/quantification suggestions cannot hold already-scoped work hostage.
      // A changed business goal or genuinely new artifact still needs the existing scope authorization.
      // A literal, explicit employee goal change needs no second management-form confirmation.
      // Ambiguous or paraphrased changes stay a proposal; all removal/version protections still run.
      const requestedGoal = /^(?:请)?(?:把|将)?(?:本次)?目标(?:改为|改成|调整为)[：:：\s]*(.+?)[。！!\s]*$/u.exec(round.demand.trim())?.[1];
      if (card.scope_proposal && requestedGoal === card.scope_proposal.goal && !scopeRemovals(card).length && !card.scope_proposal.deliverables?.length) {
        settleScopeChange(card, "accept", "employee-message", randomUUID(), new Date().toISOString());
      }
      // Decisions that affect saved outputs are arranged as a local revision by the program, not left as "no change".
      const savedFiles = new ContentObjectStore(this.workspace).index().artifacts.filter((a) => a.work_key === key);
      const revisionFiles = [...new Set([...handled.affects, ...(turn.intent === "execute" ? turn.deliverables : [])])].filter((f) => savedFiles.some((a) => a.filename === f));
      let effective = turn;
      if (revisionFiles.length && !round.last_check && !["execute", "edit"].includes(turn.intent))
        effective = { ...turn, intent: "execute", deliverables: revisionFiles, edit_request: null };
      const goalChange = !!card.scope_proposal && card.scope_proposal.goal !== card.goal;
      const proposedFiles = goalChange ? [] : effective.deliverables.filter((filename) => !card.scope_proposal?.deliverables?.some((d) => d.filename === filename));
      const proposed = proposedFiles.map((filename) => ({
        filename,
        member_id: workMembers([filename], contract)[0]!,
        current_sha256:
          card.deliverables.find((d) => d.filename === filename)
            ?.current_sha256 ?? savedFiles.find((a) => a.filename === filename)?.current_sha256 ?? null,
        status: "未开始",
      }));
      card.deliverables = [
        ...card.deliverables.filter((d) => !proposedFiles.includes(d.filename)),
        ...proposed,
      ];
      ensureSpine(card);
      card.updated_at = bump(card);
      await this.saveCard(card);
      const decisionIds = [
        ...new Set([
          ...(card.decisions ?? [])
            .filter(
              (d) =>
                d.state === "processing" &&
                ((d.affects?.length ? d.affects.every((f) => effective.deliverables.includes(f)) : !d.artifact || effective.deliverables.includes(d.artifact))),
            )
            .map((d) => d.id),
          ...handled.decisionIds.filter((id) => card.decisions?.some((d) => d.id === id && d.state === "processing")),
        ]),
      ];
      const acting = ["execute", "edit"].includes(effective.intent) && !!proposedFiles.length;
      await this.writeRound(key, {
        ...round,
        revision: createHash("sha256")
          .update(JSON.stringify([effective, card.updated_at, seq]))
          .digest("hex"),
        event_seq: seq,
        turn: acting
          ? { ...effective, deliverables: proposedFiles }
          : { ...effective, intent: effective.intent === "answer" ? "answer" : "guide", deliverables: [], edit_request: null },
        decision_ids: decisionIds,
        ...(card.navigation?.node_id
          ? { node_id: card.navigation.node_id }
          : {}),
        ...(structured ? { structured: { call_id: structured.call_id, seq, at } } : {}),
        ...(acting && revisionFiles.length && !effective.edit_request
          ? { revise: { decision_ids: decisionIds, event_ids: handled.revisionEvents, instruction: handled.revisionNote || round.demand } }
          : {}),
      });
      if (acting)
        for (const d of card.decisions ?? [])
          if (decisionIds.includes(d.id) && d.state === "processing") d.state = "awaiting_start";
      if (acting) await this.saveCard(card);
      return { handled: handled.applied, acting };
    });
  }
  async authorize(
    key: string,
    revision: string,
    source: "click" | "countdown",
    start: (card: WorkCard, round: WorkRound) => Promise<string>,
    options: { protocol?: 2; requirement_policy?: RequirementPolicy; runtime_snapshot?: (context: { task_key: string; baseline_version: string; requirement_version: number }) => import("./runtime-snapshot.ts").RuntimeSnapshot } = {},
  ) {
    return serializeWork(this.workspace, async () => {
      const card = await this.read(key),
        round = await this.round(key);
      if (
        !round ||
        round.revision !== revision ||
        round.source !== "proposal" ||
        !["execute", "edit"].includes(round.turn.intent)
      )
        throw new PromateError(
          "SCOPE_CONFLICT",
          "成果范围已变化或未获授权，请重新确认",
          409,
        );
      if (!["click", "countdown"].includes(source))
        throw new Error("授权来源无效");
      if (round.turn.intent === "edit") {
        if (!round.turn.edit_request || round.turn.deliverables.length !== 1) throw new Error("edit 仅允许单份成果的指定范围");
        preflightEdit(new ContentObjectStore(this.workspace), key, round.turn.edit_request);
      }
      if (options.protocol === 2) {
        card.requirements_protocol = 1;
        if (options.requirement_policy) card.requirement_policy = options.requirement_policy;
        await this.saveCard(card);
        const baseline = makeAcceptanceBaseline(card);
        if (card.acceptance_baseline && card.acceptance_baseline.version !== baseline.version) card.acceptance_history = [...(card.acceptance_history ?? []), card.acceptance_baseline];
        card.acceptance_baseline = baseline;
        round.acceptance_baseline = baseline;
        acceptanceScope(baseline, round.turn.deliverables, round.turn.review_requirement_ids);
        round.effective_requirements = effectiveRequirements(card);
        await this.saveCard(card);
      }
      round.followed_suggestions = card.suggestions?.filter((s) => s.state === "accepted").map((s) => s.text) ?? [];
      const task_key = await start(card, round);
      if (options.runtime_snapshot && round.acceptance_baseline) {
        const snapshot = options.runtime_snapshot({ task_key, baseline_version: round.acceptance_baseline.version, requirement_version: card.requirement_version ?? 0 });
        round.runtime_snapshot = snapshot;
        await persistRuntimeSnapshot(this.workspace, key, snapshot);
        round.snapshot_ids = [...new Set([...(round.snapshot_ids ?? []), snapshot.snapshot_id])];
      }
      const reviews = await this.reviews(key);
      for (const binding of Object.values(reviews.bindings)) if (binding.request?.state === "pending") { binding.request.state = "cancelled"; binding.reason = "上一授权已结束或停止；新授权刷新请求，不迁移旧结论"; }
      if (Object.keys(reviews.bindings).length) await this.put(key, "评审.yml", reviews);
      for (const d of card.decisions ?? []) {
        if (!round.decision_ids?.includes(d.id)) continue;
        d.task_key = task_key;
        d.state = "running";
        if (round.turn.edit_request) {
          d.artifact ??= round.turn.edit_request.filename;
          d.base_sha256 ??= round.turn.edit_request.base_sha256;
        }
      }
      card.updated_at = bump(card);
      await this.saveCard(card);
      const {
        phase: _phase,
        delivery: _delivery,
        judge_round: _judge,
        repair_round: _repair,
        reviewed_hashes: _hashes,
        requirements_digest: _digest,
        allowed_members: _allowed,
        children: _children,
        format_retry: _retry,
        ...proposal
      } = round;
      await this.writeRound(key, {
        ...proposal,
        source,
        task_key,
        execution_digest: requirementsDigest(card),
        execution_version: card.requirement_version ?? 0,
        ...(options.protocol ? { protocol: options.protocol } : {}),
        ...(round.check_only
          ? { allowed_members: [], phase: "generating" as const }
          : {}),
      });
      // Outputs redone under the current requirements close the alignment that paused them.
      const status = await this.statusRaw(key);
      let aligned = false;
      for (const a of status.alignments)
        if (a.state === "active" && a.affects.every((f) => round.turn.deliverables.includes(f))) {
          a.state = "resolved";
          a.resolved_at = new Date().toISOString();
          aligned = true;
        }
      if (aligned) await this.writeStatusRaw(key, status);
      return { card, task_key };
    });
  }
  async accept(key: string, filename: string, sha256: string, conditionIds: string[] = [], author = "personal") {
    return serializeWork(this.workspace, async () => {
      const card = await this.read(key);
      const item = card.deliverables.find((d) => d.filename === filename);
      if (!item || item.current_sha256 !== sha256)
        throw new PromateError(
          "ARTIFACT_CONFLICT",
          "成果已变化，请重新查看",
          409,
        );
      if (!Array.isArray(conditionIds) || conditionIds.some((id) => typeof id !== "string" || !card.spine?.nodes.some((n) => n.conditions?.some((c) => `${n.id}/${c.id}` === id && c.kind === "artifact" && c.filenames.includes(filename))))) throw new Error("确认条件不属于此成果");
      // A repeated click or an old message for the same version and requirement writes nothing new.
      const digest = requirementsDigest(card);
      if (card.acceptances?.some((a) => a.filename === filename && a.sha256 === sha256 && a.digest === digest && conditionIds.every((id) => a.condition_ids.includes(id))))
        return card;
      item.status = "已标记可用";
      card.acceptances = [...(card.acceptances ?? []), { filename, sha256, condition_ids: [...new Set(conditionIds)], digest: requirementsDigest(card), at: new Date().toISOString(), author }];
      await this.reconcileNodes(card, await this.round(key));
      card.updated_at = new Date(
        Math.max(Date.now(), Date.parse(card.updated_at) + 1),
      ).toISOString();
      await this.saveCard(card);
      return card;
    });
  }
  /** Only the file commit runs under this lock; it must not call a WorkStore mutator. */
  async withDeliveryScope<T>(key: string, expected: WorkRound, commit: () => Promise<T>, historicalDrafts = false): Promise<T> {
    return serializeWork(this.workspace, async () => {
      const current = await this.round(key), card = await this.read(key);
      if (!current || current.task_key !== expected.task_key || current.revision !== expected.revision || JSON.stringify(current.reviewed_hashes) !== JSON.stringify(expected.reviewed_hashes)) throw new Error("提交对应的任务或被审版本已变化");
      // A halted run may preserve unaffected drafts, never certify them against changed requirements.
      if (!historicalDrafts && expected.execution_digest && expected.execution_digest !== requirementsDigest(card)) throw new Error("提交前要求已变化，草稿保留，未覆盖正式版本");
      if ((card.events ?? []).some(e => e.task_key === expected.task_key && (["received", "clarifying"].includes(e.state) || (!historicalDrafts && e.state === "pending_apply")))) throw new Error("存在尚未处理的本次用户变更，未提交旧结果");
      return commit();
    });
  }
  /** Reconcile from the original version store; response/display failures do not create new versions. */
  async refreshDelivery(key: string, saving = false) {
    return serializeWork(this.workspace, async () => {
      const card = await this.read(key), round = await this.round(key);
      if (!round?.delivery) return;
      const receipt = deliveryReceipt(this.workspace, card, round, saving)!;
      const facts = deliveryFacts(this.workspace, card, round, saving)!;
      if (round.last_check && round.last_check.delivery_saved !== (facts.state === "saved")) {
        round.last_check.delivery_saved = facts.state === "saved";
        await this.writeRound(key, round);
      }
      const latest = card.delivery_receipts?.at(-1);
      // A historical ID may match after the entry recovers to identical bytes. The current projection
      // still needs updating, and the recovery must be visible once without replaying the old receipt.
      const sameProjection = (latest?.projection_id ?? latest?.id) === receipt.id && latest?.task_key === receipt.task_key && latest.state === receipt.state && latest.text === receipt.text &&
        JSON.stringify(latest.targets) === JSON.stringify(receipt.targets) &&
        JSON.stringify(latest.reviewed_hashes) === JSON.stringify(receipt.reviewed_hashes);
      const visible = sameProjection ? latest : card.delivery_receipts?.some(r => r.id === receipt.id)
        ? { ...receipt, at: new Date(Math.max(Date.now(), Date.parse(latest?.at ?? "") + 1 || 0)).toISOString(), projection_id: receipt.id, id: `delivery:${createHash("sha256").update(JSON.stringify([receipt.id, latest?.id, "recovered"])).digest("hex")}` }
        : receipt;
      if (!sameProjection) card.delivery_receipts = [...(card.delivery_receipts ?? []), visible];
      const status = visible!.state === "complete" ? "正式交付完成" : visible!.state === "saved_partial" ? "已保存 · 部分完成" : visible!.state === "failed" ? "草稿 · 保存失败" : visible!.state === "saving" ? "正在保存版本" : "保存结果待核";
      const projected = card.last_progress === visible!.text && card.deliverables.every(d => !(d.filename in round.delivery!.reviewed_hashes) ||
        (d.current_sha256 === (facts.current[d.filename] ?? null) && d.status === status));
      if (sameProjection && projected) return latest;
      card.last_progress = visible!.text;
      for (const d of card.deliverables) if (d.filename in round.delivery.reviewed_hashes) {
        d.current_sha256 = facts.current[d.filename] ?? null;
        d.status = status;
        if (d.draft && visible!.targets.some(t => t.kind === "formal" && t.filename === d.filename && t.sha256 === d.draft!.sha256)) delete d.draft;
      }
      card.updated_at = bump(card);
      await this.reconcileNodes(card, round);
      await this.saveCard(card);
      return visible;
    });
  }
  async progress(
    key: string,
    last_progress: string,
    hashes: Record<string, string> = {},
    status = "草稿 · 未检查",
  ) {
    return serializeWork(this.workspace, async () => {
      const card = await this.read(key);
      card.last_progress = last_progress;
      card.updated_at = bump(card);
      for (const d of card.deliverables)
        if (hashes[d.filename]) {
          if (d.current_sha256 && d.current_sha256 !== hashes[d.filename])
            invalidateNodes(card, undefined, d.filename);
          d.current_sha256 = hashes[d.filename]!;
          d.status = status;
          const published = new ContentObjectStore(this.workspace).index().artifacts.find((a) => a.work_key === key && a.filename === d.filename);
          if (d.draft && published?.current_sha256 === d.draft.sha256 && published.versions.some((v) => v.sha256 === d.draft!.sha256 && v.task_key === d.draft!.task_key)) delete d.draft;
        }
      await this.reconcileNodes(card, await this.round(key));
      await this.saveCard(card);
    });
  }
  /** Moves answered decisions along their follow-up; only records currently in `from` change. */
  async markDecisions(
    key: string,
    from: readonly DecisionState[],
    to: DecisionState,
    note?: string,
    ids?: readonly string[],
  ) {
    return serializeWork(this.workspace, async () => {
      const card = await this.read(key);
      let changed = false;
      for (const d of card.decisions ?? [])
        if (from.includes(d.state) && (!ids || ids.includes(d.id))) {
          d.state = to;
          if (note) d.note = note;
          else delete d.note;
          changed = true;
        }
      if (!changed) return;
      card.updated_at = bump(card);
      await this.saveCard(card);
    });
  }
  /** Execution-time replies may raise new decisions; they are merged, never used to drop program-recorded ones. */
  async noteAssistant(key: string, text: string | WorkTurn, contract: WorkContract, employeeMessages: readonly string[] = [], structured?: { call_id: string }) {
    return serializeWork(this.workspace, async () => {
      const turn = typeof text === "string" ? parseWorkTurn(text, contract) : text;
      if (!Object.keys(turn.card_patch).length && !turn.handled_events?.length) return;
      const card = await this.read(key);
      const round = await this.round(key);
      const at = new Date().toISOString();
      const handled = bindHandledEvents(card, turn.handled_events ?? [], round, at, contract, false);
      if (handled.errors.length) throw new SubmissionRejected(handled.errors);
      // Update understanding only. The running round and member authority stay frozen.
      applyDraftPatch(card, turn, employeeMessages);
      ensureSpine(card);
      card.updated_at = bump(card);
      await this.saveCard(card);
      if (handled.alignments.length) {
        const status = await this.statusRaw(key);
        status.alignments.push(...handled.alignments);
        // The paused attempt is superseded by a redo under the new requirements; its open recovery is moot.
        for (const file of handled.alignments.flatMap((a) => a.affects)) resolveFaults(status, `file:${file}`, at);
        await this.writeStatusRaw(key, status);
      }
      if (structured && round) await this.writeRound(key, { ...round, structured: { call_id: structured.call_id, seq: round.event_seq, at } });
      return { handled: handled.applied, acting: false };
    });
  }
  /** Business decisions and unresolved check findings stay visible until the employee answers them. */
  async addCheckPending(key: string, items: PendingItem[]) {
    if (!items.length) return;
    return serializeWork(this.workspace, async () => {
      const card = await this.read(key);
      card.pending = mergeQuestions(card, items);
      ensureSpine(card);
      card.updated_at = bump(card);
      await this.saveCard(card);
    });
  }
  /** Compare-and-set so a tool call and a turn stop cannot both advance the same phase. */
  async transitionRound(
    key: string,
    expected: Pick<WorkRound, "phase" | "judge_round" | "repair_round">,
    next: WorkRound,
  ): Promise<boolean> {
    return serializeWork(this.workspace, async () => {
      const current = await this.round(key);
      if (
        !current ||
        current.task_key !== next.task_key ||
        (current.phase ?? "generating") !== (expected.phase ?? "generating") ||
        (current.judge_round ?? 0) !== (expected.judge_round ?? 0) ||
        (current.repair_round ?? 0) !== (expected.repair_round ?? 0)
      )
        return false;
      const { children: _ignored, ...rest } = next;
      await this.writeRound(key, await this.prepareReview(key, {
        ...rest,
        ...(current.children ? { children: current.children } : {}),
      }));
      return true;
    });
  }
  async requirements(key: string) {
    return requirementsDigest(await this.read(key));
  }
}
/** R10/R03：派生索引的权威输入 = 历次被替换回执 + 当前回执；重建不丢结论身份历史。 */
function receiptLedger(round: WorkRound | undefined): MemberReceipt[] {
  return [...(round?.receipt_history ?? []), ...Object.values(round?.receipts ?? {})];
}
function discussionRound(
  previous: WorkRound | undefined,
  demand: string | undefined,
): WorkRound {
  return {
    revision: randomUUID(),
    event_seq: previous?.event_seq ?? -1,
    source: "proposal",
    turn: {
      intent: "answer",
      card_patch: {},
      deliverables: [],
      edit_request: null,
    },
    demand: demand ?? "",
    attachments: [],
    unverified: [],
    ...(previous?.previous_check
      ? { previous_check: previous.previous_check }
      : {}),
    ...(previous?.last_check ? { last_check: previous.last_check } : {}),
    // R11/R16：讨论不再带活动回执，但保存原任务的权威身份/关联历史；重建不依赖旧派生文件。
    ...((previous?.task_key || previous?.receipt_archives) ? { receipt_archives: { ...previous?.receipt_archives, ...(previous?.task_key ? { [previous.task_key]: receiptLedger(previous) } : {}) } } : {}),
    ...((previous?.task_key ?? previous?.evidence_task_key) ? { evidence_task_key: (previous?.task_key ?? previous?.evidence_task_key)! } : {}),
    // R07：转入普通讨论或启动下一任务不得抹除已有快照身份。
    ...(previous?.runtime_snapshot ? { runtime_snapshot: previous.runtime_snapshot } : {}),
    ...(previous?.snapshot_ids?.length ? { snapshot_ids: previous.snapshot_ids } : {}),
    ...(previous?.delivery ? { delivery: previous.delivery } : {}),
  };
}
/** Replaces the draft's AI-owned parts; employee form/decision entries and check findings survive. */
export function applyDraftPatch(
  card: WorkCard,
  turn: WorkTurn,
  employeeMessages: readonly string[],
) {
  const patch = turn.card_patch;
  const before = requirementsDigest(card);
  if (patch.title && !card.spine) card.title = patch.title;
  if (
    card.spine &&
    ((patch.goal && patch.goal !== card.goal) ||
      (patch.scope_change_reason && patch.nodes && JSON.stringify(patch.nodes.map(nodeDefinition)) !== JSON.stringify(card.spine.nodes.map(nodeDefinition))))
  ) {
    card.scope_proposal = {
      goal: patch.goal ?? card.goal,
      ...(patch.nodes ? { nodes: patch.nodes } : {}),
      ...(patch.scope_moves ? { moves: patch.scope_moves } : {}),
      reason:
        patch.scope_change_reason ??
        "总目标或关键节点将发生变化；已有成果保留，受影响节点需更新。请决定是否调整。",
    };
  } else {
    if (patch.goal) card.goal = patch.goal;
    if (patch.nodes && turn.intent !== "answer") {
      // New progress nodes describe work, not employee-maintained completion gates.
      const incoming = patch.nodes.map(({ conditions: _conditions, ...node }) => node);
      if (!card.spine) card.spine = { nodes: incoming };
      else card.spine.nodes = [...card.spine.nodes, ...incoming.filter((n) => !card.spine!.nodes.some((old) => old.id === n.id))];
    }
  }
  if (patch.pending) card.pending = mergeQuestions(card, patch.pending);
  if (
    patch.side_topic &&
    !card.side_topics?.some((t) => t.text === patch.side_topic!.text)
  ) {
    card.side_topics = [
      ...(card.side_topics ?? []),
      {
        id: randomUUID(),
        ...patch.side_topic,
        ...(card.navigation?.node_id
          ? { node_id: card.navigation.node_id }
          : {}),
        deferred: false,
      },
    ];
  }
  if (patch.suggestions) mergeSuggestions(card, patch.suggestions);
  if (patch.employee_said) {
    const verified = verifiedEmployeeStatements(
      patch.employee_said,
      [...employeeMessages, ...(card.origin ? [card.origin.text] : []), ...(card.events ?? []).map((e) => e.text)],
    );
    if (verified.length !== patch.employee_said.length) throw new SubmissionRejected(["employee_said 存在无法绑定的原话，未保存伪授权"]);
    card.interpretations = [...(card.interpretations ?? []), ...patch.employee_said.filter((s) => !card.interpretations?.some((i) => i.text === s.text && i.quote === s.quote))];
    const kept = card.confirmed;
    card.confirmed = [
      ...kept,
      ...verified.filter((v) => !kept.some((k) => k.text === v.text)),
    ];
  }
  if (before !== requirementsDigest(card)) invalidateNodes(card);
  ensureSpine(card);
}
export interface EventInput {
  id?: string;
  channel: WorkEvent["channel"];
  text: string;
  paths?: string[];
  question_id?: string;
  suggestion?: string;
  choice?: string;
  priority?: WorkEvent["priority"];
  intent?: WorkEvent["intent"];
  state?: WorkEvent["state"];
  note?: string;
}
const OPEN_EVENT: ReadonlySet<WorkEvent["state"]> = new Set(["received", "clarifying", "pending_apply"]);
/** Program-owned identity, order and version for one input. Only processed history is trimmed. */
export function addEvent(card: WorkCard, round: WorkRound | undefined, input: EventInput, at: string): { event: WorkEvent; duplicate: boolean } {
  const events = card.events ?? [];
  if (input.text.length > 20000) throw new Error("输入过长，请作为材料提交；未截断为有效要求");
  if (input.id !== undefined) {
    if (!/^[\w:.-]{1,120}$/u.test(input.id)) throw new Error("输入标识无效");
    const prior = events.find((e) => e.id === input.id);
    if (prior) return { event: prior, duplicate: true };
  }
  const running = !!round?.task_key && round.source !== "proposal" && round.phase !== "ended";
  const event: WorkEvent = {
    id: input.id ?? randomUUID(),
    seq: Math.max(0, ...events.map((e) => e.seq)) + 1,
    at,
    channel: input.channel,
    text: input.text,
    ...(input.paths?.length ? { paths: input.paths } : {}),
    ...(input.question_id ? { question_id: input.question_id } : {}),
    ...(input.suggestion ? { suggestion: input.suggestion.slice(0, 400) } : {}),
    ...(input.choice ? { choice: input.choice.slice(0, 500) } : {}),
    priority: input.priority ?? (input.channel === "stop" ? "high" : "normal"),
    state: input.state ?? "received",
    ...(input.intent ? { intent: input.intent } : {}),
    ...(running ? { task_key: round!.task_key! } : {}),
    input_version: card.requirement_version ?? 0,
    ...(input.note ? { note: input.note } : {}),
    ...(input.state && !OPEN_EVENT.has(input.state) ? { handled_at: at } : {}),
  };
  const all = [...events, event];
  const closed = all.filter((e) => !OPEN_EVENT.has(e.state) && !["supplement", "correction", "decision"].includes(e.intent ?? "") && !card.confirmed.some((c) => c.quote === e.text) && !card.decisions?.some((d) => d.source_event === e.id));
  const drop = new Set(closed.slice(0, Math.max(0, all.length - 200)).map((e) => e.id));
  card.events = all.filter((e) => !drop.has(e.id));
  return { event, duplicate: false };
}
function historyId(card: WorkCard, id: string) {
  let n = 1;
  while ((card.decisions ?? []).some((d) => d.id === `${id}-h${n}`)) n++;
  return `${id}-h${n}`;
}
/** Records one effective decision. Earlier answers to the same business decision become history, never co-effective. */
export function recordDecision(card: WorkCard, item: PendingItem, answer: string, at: string, eventId?: string) {
  // Keep every compatible source with the recorded decision, including legacy duplicates.
  const evidence = card.pending
    .filter((p) => p.id === item.id || sameDecision(p, item))
    .flatMap((p) =>
      p.sources?.length
        ? p.sources
        : [{ source: p.source ?? "ai", basis: p.basis ?? p.question }],
    );
  item.sources = evidence.filter(
    (s, i) =>
      evidence.findIndex((p) => JSON.stringify(p) === JSON.stringify(s)) === i,
  );
  // One answer closes every copy of the same question, whoever raised it.
  card.pending = card.pending.filter((p) => p.id !== item.id && !sameDecision(p, item));
  const record: DecisionRecord = {
    ...item,
    answer: answer.slice(0, 500),
    answered_at: at,
    state: "processing",
    ...(eventId ? { source_event: eventId } : {}),
  };
  for (const old of card.decisions ?? []) {
    if (INACTIVE_DECISION.has(old.state)) continue;
    if (old.id !== item.id && !sameDecision(old, item) && !(old.decision_key && old.decision_key === item.decision_key)) continue;
    card.confirmed = card.confirmed.filter((c) => !(c.source === "decision" && c.text === decisionText(old)));
    old.id = old.id === item.id ? historyId(card, old.id) : old.id;
    old.state = "superseded";
    old.superseded_by = record.id;
    old.closed_at = at;
  }
  card.decisions = [...(card.decisions ?? []), record];
  card.confirmed.push({ text: decisionText(record), confirmed_at: at, source: "decision" });
  return record;
}
/**
 * Program binding of the coordinator's classification. Ids, questions, affected files and quoted answers must
 * match real records; a reply that asks back or does not pick a side is never recorded as a decision.
 * With `dryRun` the card is a disposable copy used only to report errors.
 */
export function bindHandledEvents(card: WorkCard, handled: readonly HandledEvent[], round: WorkRound | undefined, at: string, contract: WorkContract, dryRun: boolean) {
  const errors: string[] = [];
  const applied: Array<{ event_id: string; state: WorkEvent["state"]; note: string }> = [];
  const decisionIds: string[] = [];
  const affects = new Set<string>();
  const alignments: WorkAlignment[] = [];
  const revisionEvents: string[] = [];
  const notes: string[] = [];
  const running = !!round?.task_key && round.source !== "proposal" && round.phase !== "ended";
  const known = new Set([...card.deliverables.map((d) => d.filename), ...contract.artifacts.map((a) => a.relativePath.split("/").at(-1)!)]);
  for (const h of handled) {
    const event = card.events?.find((e) => e.id === h.event_id);
    if (!event) {
      errors.push(`输入 ${h.event_id} 不存在`);
      continue;
    }
    if (!["received", "clarifying"].includes(event.state)) continue; // A repeated receipt never re-applies.
    const unknown = (h.affects ?? []).filter((f) => !known.has(f));
    if (unknown.length) errors.push(`输入 ${h.event_id} 的 affects 不是本工作的成果：${unknown.join("、")}`);
    const question = h.question_id ? card.pending.find((p) => p.id === h.question_id) : undefined;
    if (h.question_id && !question && !(h.intent === "decision" && card.decisions?.some((d) => d.id === h.question_id && !INACTIVE_DECISION.has(d.state) && d.source_event === event.id)))
      errors.push(`输入 ${h.event_id} 关联的问题 ${h.question_id} 不存在或已处理`);
    for (const id of h.revokes?.decision_ids ?? [])
      if (!card.decisions?.some((d) => d.id === id && !INACTIVE_DECISION.has(d.state))) errors.push(`要撤销的决定 ${id} 不存在或已不生效`);
    for (const text of h.revokes?.suggestions ?? [])
      if (!card.suggestions?.some((s) => s.text === text && s.state !== "superseded")) errors.push(`要撤销的建议不存在：${text}`);
    if (h.suggestion && !card.suggestions?.some((s) => s.text === h.suggestion && s.state !== "superseded")) errors.push(`关联的建议不存在：${h.suggestion}`);
    if (h.intent === "decision" && question && h.answer) {
      const chosen = event.choice ?? resolveChoice(question, event.text);
      const grounded = chosen ? sameAnswer(chosen, h.answer) || resolveChoice(question, h.answer) === chosen : h.answer === event.text;
      if (!grounded) errors.push(`输入 ${h.event_id} 的 answer 必须来自员工原话或所选选项`);
    }
  }
  if (errors.length || dryRun) return { errors, applied, decisionIds, affects: [...affects], alignments, revisionEvents, revisionNote: "" };
  for (const h of handled) {
    const event = card.events!.find((e) => e.id === h.event_id)!;
    if (!["received", "clarifying"].includes(event.state)) continue;
    const files = (h.affects ?? []).filter((f) => card.deliverables.some((d) => d.filename === f));
    const saved = files.filter((f) => card.deliverables.some((d) => d.filename === f && d.current_sha256));
    event.intent = h.intent;
    event.priority = h.impact === "high" ? "high" : event.priority;
    event.note = h.note;
    event.handled_at = at;
    event.attempts = (event.attempts ?? 0) + 1;
    if (files.length) event.affects = files;
    for (const id of h.revokes?.decision_ids ?? []) {
      const d = card.decisions!.find((x) => x.id === id && !INACTIVE_DECISION.has(x.state))!;
      card.confirmed = card.confirmed.filter((c) => !(c.source === "decision" && c.text === decisionText(d)));
      d.state = "superseded";
      d.superseded_by = event.id;
      d.closed_at = at;
      d.note = `由新输入修订：${event.text.slice(0, 80)}`;
    }
    for (const text of h.revokes?.suggestions ?? []) {
      const s = card.suggestions!.find((x) => x.text === text && x.state !== "superseded")!;
      s.state = "superseded";
      s.history = [...(s.history ?? []), { at, reply: event.text.slice(0, 400), state: "superseded" }];
    }
    let state: WorkEvent["state"];
    const question = h.question_id ? card.pending.find((p) => p.id === h.question_id) : undefined;
    if (h.intent === "decision") {
      const prior = card.decisions?.find((d) => d.source_event === event.id && !INACTIVE_DECISION.has(d.state));
      const guard = event.choice ? "ok" : question ? answerGuard(question, event.text) : "ok";
      if (guard === "question") {
        state = "answered";
        event.intent = "question";
        event.note = `这是追问，已先回答原因，未记为决定。${h.note}`;
      } else if (guard === "ambiguous") {
        state = "clarifying";
        event.note = `回复没有明确选择哪一项，需要澄清，未记为决定。${h.note}`;
      } else {
        const record = prior ?? recordDecision(card, question!, event.choice ?? resolveChoice(question!, event.text) ?? event.text, at, event.id);
        record.affects = saved;
        record.note = h.note;
        if (saved.length) {
          record.state = "processing";
          state = "pending_apply";
          saved.forEach((f) => affects.add(f));
          revisionEvents.push(event.id);
          notes.push(`${record.question} → ${record.answer}`);
        } else {
          record.state = "recorded";
          record.closed_at = at;
          state = "applied";
        }
        decisionIds.push(record.id);
      }
    } else if (h.intent === "question" || h.intent === "new_task") state = "answered";
    else if (h.intent === "control") state = "applied";
    else if (h.intent === "correction" && h.impact === "high" && running && files.some((f) => round!.turn.deliverables.includes(f))) {
      const hit = files.filter((f) => round!.turn.deliverables.includes(f));
      alignments.push({ id: randomUUID(), event_id: event.id, affects: hit, state: "active", at, note: h.note });
      state = "pending_apply";
    } else if (saved.length && (h.intent === "correction" || h.intent === "supplement")) {
      state = "pending_apply";
      if (!running) {
        saved.forEach((f) => affects.add(f));
        revisionEvents.push(event.id);
        notes.push(event.text.slice(0, 200));
      }
    } else state = "applied";
    if (h.suggestion && (h.intent === "decision" || h.intent === "supplement" || h.intent === "correction")) {
      // A reply settles one named suggestion only when the link is unambiguous; otherwise it is clarified first.
      const squash = (v: string) => v.replace(/[\p{P}\p{S}\s]+/gu, "");
      const open = (card.suggestions ?? []).filter((s) => !s.state || s.state === "proposed" || s.state === "adjusted");
      const clear = event.suggestion === h.suggestion || squash(event.text).includes(squash(h.suggestion)) || (open.length === 1 && open[0]!.text === h.suggestion);
      if (!clear) {
        state = "clarifying";
        event.note = `这条回复对应哪一条建议不明确，需要澄清，未记为采纳。${h.note}`;
      } else if (replyToSuggestion(card, event.text, h.suggestion, at)) {
        const settled = card.suggestions!.find((s) => s.text === h.suggestion)!;
        event.note = `已记录对建议「${settled.text}」的回应：${settled.state === "accepted" ? "采纳（计划口径，不代表已执行）" : settled.state === "rejected" ? "不采纳" : "按反馈调整"}。${h.note}`;
      }
    }
    if (h.clarify) {
      card.pending = mergeQuestions(card, [{ id: `clarify-${event.seq}`, question: h.clarify, kind: "clarify", raised_by: "coordinator", blocking: true, timing: "now", source: "ai", ...(h.question_id ? { basis: `澄清：${question?.question ?? h.question_id}` } : {}) }], at);
      if (state === "answered" || state === "applied") state = "clarifying";
    }
    event.state = state;
    applied.push({ event_id: event.id, state, note: event.note ?? h.note });
  }
  return { errors, applied, decisionIds, affects: [...affects], alignments, revisionEvents, revisionNote: notes.length ? `按员工最新输入局部修改：${notes.join("；")}。其他已确认内容逐字保留。` : "" };
}
/** The complete effective input frozen for one run; the latest reply is an increment, not the task. */
export function frozenInput(card: WorkCard, round: WorkRound) {
  const decisions = (card.decisions ?? []).filter((d) => !INACTIVE_DECISION.has(d.state));
  const accepted = card.suggestions?.filter((s) => s.state === "accepted") ?? [];
  const materials = [...new Set([...card.materials.map((m) => m.path), ...round.attachments])];
  const lines = [
    card.title,
    "",
    "## 原始任务",
    card.origin?.text ?? "（此工作创建时未单独记录原始任务，以当前目标为准）",
    "",
    requirementsBrief(round.effective_requirements ?? effectiveRequirements(card), round.acceptance_baseline),
    "## 主 Agent 理解的当前目标（不是用户原话）",
    card.goal || card.title,
    "",
    "## 本轮最新输入（增量，不替代原始任务）",
    round.demand || "（无新文字）",
    "",
    "## 员工明确要求",
    ...(card.confirmed.filter((c) => c.source !== "decision").map((c) => `- ${confirmedWords(c)}`)),
    "",
    "## 员工决定（当前有效）",
    ...decisions.map((d) => `- ${d.question} → ${d.answer}`),
    "",
    "## 已采纳建议（计划口径，不代表已经执行，例如访谈尚未实际进行）",
    ...accepted.map((s) => `- ${s.text}（建议版本 ${createHash("sha256").update(s.text).digest("hex").slice(0, 8)}）`),
    "",
    "## 尚待员工决定（不得写成已确认）",
    ...card.pending.filter((p) => p.timing !== "later").map((p) => `- ${p.question}`),
    "",
    "## 选用材料（原文见输入清单中程序编号的来源，摘要不是独立来源）",
    ...materials.map((path) => `- ${path.split("/").at(-1)}`),
    "",
    "## 续接位置",
    `- 需求版本 ${card.requirement_version ?? 0}`,
    ...card.deliverables.filter((d) => d.current_sha256).map((d) => `- 已有成果版本 ${d.current_sha256!.slice(0, 8)}（${d.status}）`),
  ];
  return { demand: lines.join("\n").replace(/\n{3,}/gu, "\n\n"), attachments: materials };
}
