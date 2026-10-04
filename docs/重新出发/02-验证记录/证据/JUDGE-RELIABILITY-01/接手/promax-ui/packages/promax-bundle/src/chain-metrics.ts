import { readFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import { ContentObjectStore, taskPaths } from "@promax/promax-report";
import { WorkStore } from "./work-store.ts";
import { evaluationRecords } from "./evaluation-records.ts";
import { acceptanceStates, taskCompletion, type AcceptanceFacts, type NoResultCause } from "../../promax-ui-console/src/effective-protocol.ts";
import { requirementsDigest } from "../../promax-ui-console/src/work-protocol.ts";
import { evaluateJudgeFromSources, evaluateRechecks, judgeObservationsFromYaml } from "./judge-evaluation.ts";
import { loadRuntimeSnapshot, resolveRuntimeSnapshot } from "./runtime-snapshot.ts";

type Observation = Record<string, unknown> & { id: string; kind: string; at: string };
const knownNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
/** Trace in_tokens already includes cache; this aggregator never adds those buckets again. */
export function aggregateUsage(rows: readonly Record<string, unknown>[]) {
  const unique = [...new Map(rows.map((r) => [r.request_id ?? r.id, r])).values()];
  const observed = unique.filter((r) => r.usage_observed === true && knownNumber(r.in_tokens) && knownNumber(r.out_tokens));
  const sum = (field: string) => { const values = observed.map((r) => r[field]).filter(knownNumber); return values.length ? values.reduce((a, b) => a + b, 0) : null; };
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const row of unique) { const key = `${row.member ?? "unknown"}/${row.phase ?? "unknown"}/${row.purpose ?? "unknown"}`; groups.set(key, [...(groups.get(key) ?? []), row]); }
  return { requests: unique.length, observed_requests: observed.length, missing_usage: unique.length - observed.length, input_tokens: sum("in_tokens"), output_tokens: sum("out_tokens"), cache_read_tokens: sum("cache_read_tokens"), cache_write_tokens: sum("cache_write_tokens"), cache_is_input_subset: true,
    groups: [...groups].map(([group, values]) => ({ group, requests: values.length, missing_usage: values.filter((r) => r.usage_observed !== true).length, input_tokens: values.some((r) => knownNumber(r.in_tokens)) ? values.reduce((n, r) => n + (knownNumber(r.in_tokens) ? r.in_tokens : 0), 0) : null })) };
}
export function measuredDelay(start?: Observation, end?: Observation) {
  if (!start || !end) return { value_ms: null, status: "unknown", reason: "缺必要事件" };
  const delta = Date.parse(end.at) - Date.parse(start.at);
  return Number.isFinite(delta) && delta >= 0 ? { value_ms: delta, status: "observed", clock: "server wall clock; skew not calibrated" } : { value_ms: null, status: "unknown", reason: "时钟无效或负时长" };
}
/** Derived local read model; no new fields enter the Java uploader or raw session/trace logs. */
export async function workMetrics(workspace: string, key: string, evaluation?: { references_yaml: string; observations_yaml: string }) {
  const store = new WorkStore(workspace), card = await store.read(key), round = await store.round(key), reviews = await store.reviews(key);
  // Rebuild only deterministic missing evaluation records from accepted, version-bound findings; no model/session replay.
  if (round) for (const record of evaluationRecords(round)) await store.observe(key, record);
  const observed = await store.observations(key);
  const rows = observed.filter((r) => (r.task_key ?? null) === (round?.task_key ?? null));
  const closedRequests = new Set(rows.filter(r => ["request_usage", "request_interrupted"].includes(r.kind)).map(r => r.request_id));
  const usageRows = [...rows.filter(r => ["request_usage", "request_interrupted"].includes(r.kind)),
    ...rows.filter(r => r.kind === "request_started" && !closedRequests.has(r.request_id)).map(r => ({ ...r, usage_observed: false, status: "in_progress_or_unknown" }))];
  const hashes = Object.fromEntries(new ContentObjectStore(workspace).index().artifacts.filter((e) => e.work_key === key).map((e) => [e.filename, e.current_sha256]));
  const baseline = round?.acceptance_baseline ?? card.acceptance_baseline;
  const latest = round?.check_results?.[String(round.judge_round)] ?? round?.last_check;
  const versionBound = !!baseline && latest?.acceptance?.baseline_version === baseline.version && baseline.requirement_version === card.requirement_version && Object.entries(latest?.reviewed_hashes ?? {}).every(([file, hash]) => hashes[file] === hash);
  const running = !!round?.task_key && round.phase !== "ended";
  let terminal = "unknown";
  if (round?.task_key) {
    try { terminal = YAML.parse(await readFile(join(workspace, taskPaths(workspace, round.task_key).control), "utf8"))?.spec?.state ?? "unknown"; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  // 失败观察可能由旧调用点未带 task_key 写入；本文件按工作卡隔离，未标注的记录视为当前任务。
  const taskRows = observed.filter((r) => r.task_key === undefined || r.task_key === null || r.task_key === (round?.task_key ?? null));
  const protocolFault = taskRows.find((r) => r.kind === "failure_attribution" && ["proposal_invalid", "member_receipt_missing", "member_output_missing", "check_output_invalid", "commit_failed"].includes(String(r.class)));
  const reviewState: NoResultCause = protocolFault ? "submission_invalid" : !running && ["failed", "cancelled"].includes(terminal) && !latest ? "interrupted" : latest ? "version_conflict" : "no_review";
  const reviewNote = protocolFault ? `尚无有效判定：提交未被接受（${String(protocolFault.class)}）；保留在分母，不等同内容不合格` : !running && ["failed", "cancelled"].includes(terminal) && !latest ? "执行失败或取消，未形成有效判定" : latest ? "已保存的评审不绑定当前基准/被审字节，不能确认当前内容已受检" : "尚无有效评审结果";
  const reviewEvidence = protocolFault ? [`failure_attribution:${String(protocolFault.class)}`] : latest ? [`review_request:${String((latest as { review_request?: string }).review_request ?? "unknown")}`] : [];
  // R01/R05：同一份依据索引与版本前置条件同时供完成判定、Q1 与界面投影使用。
  const itemEvidence = latest?.current_acceptance_evidence ?? latest?.acceptance_evidence;
  const facts: AcceptanceFacts = {
    running,
    current_hashes: hashes,
    requirements_current: !!baseline && baseline.requirement_version === card.requirement_version && baseline.requirements_digest === requirementsDigest(card) && card.acceptance_baseline?.version === baseline.version,
    ...(itemEvidence ? { item_evidence: itemEvidence } : {}),
    requirement_record: !!baseline?.sources.length,
    ...(versionBound ? {} : { review_state: reviewState, review_note: reviewNote, ...(reviewEvidence.length ? { review_evidence: reviewEvidence } : {}) }),
  };
  const summary = baseline ? acceptanceStates(baseline, latest, { ...(round?.acceptance_scope ? { scope: round.acceptance_scope } : {}), facts }) : undefined;
  const quality = summary
    ? { denominator: summary.denominator, met: summary.met, unmet: summary.unmet, unverifiable: summary.unverifiable, no_result: summary.no_result, rate: summary.q1, source: "Judge semantic findings; program version binding", status: summary.status, ...(summary.reason ? { reason: summary.reason } : {}), progress_only: summary.progress_only, no_result_causes: summary.no_result_causes }
    : { denominator: null, met: null, unmet: null, unverifiable: null, no_result: null, rate: null, source: "Judge semantic findings; program version binding", status: "unknown", reason: "无权威基准" };
  const attributed = taskRows.filter((r) => r.kind === "failure_attribution");
  const firstError = attributed.find((r) => r.first_error === true);
  const attribution = {
    observed: attributed.length,
    first_error: firstError ? { task_key: firstError.task_key ?? null, step: firstError.step ?? null, class: firstError.class ?? null, cause: firstError.cause ?? "unknown", reason: firstError.reason ?? null, at: firstError.at } : null,
    by_cause: ["tool_environment", "agent_defect", "mixed", "unknown"].map((cause) => ({ cause, count: attributed.filter((r) => r.cause === cause).length, items: attributed.filter((r) => r.cause === cause).map((r) => r.id) })),
    note: "交付结果、Agent 质量、环境故障分开记录；首错与后续处置保留，未知不强行扣分或免分，也不从整体任务分母删除失败/取消。",
  };
  const snapshot = resolveRuntimeSnapshot(round);
  // R07：回合只留引用时按身份从不可变留存读取；读不到保持引用/未知，不用当前磁盘回填。
  const snapshotPayload = snapshot.status === "present" ? snapshot.snapshot : snapshot.snapshot_id ? await loadRuntimeSnapshot(workspace, key, snapshot.snapshot_id) : undefined;
  const integrity = rows.filter((r) => r.kind === "context_integrity");
  const firstDrafts = card.deliverables.map((file) => {
    const ready = rows.find((r) => r.kind === "draft_ready" && r.filename === file.filename);
    const visible = ready ? rows.find((r) => r.kind === "draft_actionable" && r.filename === file.filename && r.sha256 === ready.sha256) : undefined;
    return { filename: file.filename, sha256: ready?.sha256 ?? null, ...measuredDelay(ready, visible), measurement: "frontend event received by server; upper bound includes return trip, not calibrated UI latency", pure_view_model_calls: null };
  });
  const rechecks = Object.values(round?.check_results ?? {}).map((r) => {
    const metric = evaluateRechecks([{ sample_id: r.review_request ?? String(r.judge_round), observation: r }]);
    return { ...metric, review_request: r.review_request, required_ids: r.required_recheck_ids ?? null, denominator: metric.known_observations ? metric.required : null, covered: metric.known_observations ? metric.covered : null, rate: metric.status === "observed" && metric.required ? metric.covered / metric.required : null };
  });
  // 与界面投影共用同一判定：取消/等待决定只改变业务表达，不把 no_result 变成满足。
  const cancelled = !running && /已停止|取消|中断/u.test(card.last_progress);
  const completion = taskCompletion(card, baseline, latest, hashes, { running, cancelled, awaiting_decision: card.pending.some((p) => p.timing !== "later"), ...(itemEvidence ? { item_evidence: itemEvidence } : {}) });
  return {
    rule_version: "STD-v0.1", work_key: key, task_key: round?.task_key ?? null, baseline_version: baseline?.version ?? null, observed_at: new Date().toISOString(), observation_cutoff: new Date().toISOString(), execution_state: terminal, terminal,
    runtime_snapshot: snapshotPayload ?? { status: snapshot.status === "reference_only" ? "reference_only" : "legacy_unknown", ...(snapshot.snapshot_id ? { snapshot_id: snapshot.snapshot_id } : {}), ...(snapshot.reason ? { reason: snapshot.reason } : {}) },
    snapshot_ids: round?.snapshot_ids ?? [],
    recording: { ...store.recordingHealth(key), recovery_events: observed.filter(r => r.kind === "recording_recovered"), interrupted: rows.filter(r => r.kind === "request_interrupted") },
    evaluation_history: observed.filter(r => r.kind === "evaluation_record"),
    execution_actions: {
      rating_tool_calls: new Set(rows.filter(r => r.kind === "rating_fact_access").map(r => r.call_id)).size,
      rating_computations: rows.filter(r => r.kind === "rating_calculation" && r.mode === "computed").length,
      rating_result_reads: rows.filter(r => r.kind === "rating_fact_access" && r.mode !== "computed").length,
      business_dispatches: rows.filter(r => r.kind === "action_access" && r.mode === "executed").length,
      model_executions: rows.filter(r => r.kind === "request_dispatched").length,
      decisions: rows.filter(r => r.kind === "action_access"),
      note: "工具读取、实际计算、成员派发与模型请求分开；读取/恢复记录不调用Agent，未知远端结果不重发",
    },
    completion_candidate: completion,
    business_success: terminal === "completed" && completion.state === "complete",
    Q1: quality,
    // 既有本地指标/导出入口接受显式参考清单与版本化观察；不写真值、不启动Judge、不进入业务完成计算。
    judge_evaluation: evaluation ? evaluateJudgeFromSources(evaluation.references_yaml, judgeObservationsFromYaml(evaluation.observations_yaml)) : { status: "not_evaluated", reason: "未提供独立确认的参考清单与绑定观察" },
    failure_attribution: attribution,
    Q2: { samples: integrity.length, missing: integrity.length ? integrity.reduce((n, r) => n + (Array.isArray(r.missing) ? r.missing.length : 0), 0) : null, status: integrity.length ? "structural_only" : "unknown", semantic_fidelity: "not_verified", required_entry_accessibility: "not_fully_verified" },
    D1: firstDrafts,
    L1: { decisions: rows.filter((r) => r.kind === "dispatch_decided"), admissions: rows.filter((r) => r.kind === "dispatch_admitted"), waits: rows.filter((r) => r.kind === "dispatch_wait"), local_dispatch: rows.filter((r) => r.kind === "dispatch_resources_ready").map((r) => ({ call_id: r.call_id, ...measuredDelay(r, rows.find((e) => e.kind === "dispatch_sent" && e.call_id === r.call_id)) })), model_dispatch: rows.filter((r) => r.kind === "dispatch_resources_ready").map((r) => ({ call_id: r.call_id, ...measuredDelay(r, rows.find((e) => e.kind === "request_dispatched" && e.call_id === r.call_id)) })), send_latency_ms: null, reason: "逐调用看model_dispatch：AsyncLocalStorage绑定原调度callId至首次适配器发出；缺关联/负时长为未知。此前决定/准入等待另存，远端到达未测，不能以fixture宣称真实1秒体验" },
    R1: { failures: rows.filter((r) => ["tool_failure", "tool_unavailable", "request_retry"].includes(r.kind)), local_cancellation_does_not_prove_remote_billing_stopped: true },
    J1: { repair_rounds: round?.repair_round ?? 0, rechecks, unresolved_issues: reviews.issues.filter((i) => i.group === round?.review_group && i.state !== "verified").map((i) => i.id) },
    C1: rows.filter((r) => r.kind === "request_context"),
    C2: { ...aggregateUsage(usageRows), legacy_missing_reason: "历史trace缺明确task/request关联时不按相近时间回填；本地新记录保留trace_id与原会话定位" },
    evidence: { observations: `.工作/${key}/链路观察.yml`, work: `.工作/${key}/工作卡.yml`, reviews: `.工作/${key}/评审.yml` },
  };
}
