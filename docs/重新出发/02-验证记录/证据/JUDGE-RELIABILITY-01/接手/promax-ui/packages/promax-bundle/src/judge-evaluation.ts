import YAML from "yaml";
import type { IssueRecheck } from "../../promax-ui-console/src/review-protocol.ts";

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const nonempty = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const issueId = (v: unknown): v is string => nonempty(v) && v === v.trim() && v.length <= 60;
const canonical = (value: unknown): string => JSON.stringify(value, (_key, v) => object(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);

/**
 * 11.2 Judge 评价口径。只对有独立可信参考结论的样本计算；未知不填 0，分母为 0 记不适用。
 * 历史 PASS/verified 不自动成为正样本；用途为 rule_debug / excluded 的样本不计入准确率。
 * R09：误放行分母只含参考不合格；无法验证样本被判 PASS 单列为违规，不混入分母也不呈现为零错误。
 */
export type ReferenceVerdict = "qualified" | "unqualified" | "unverifiable" | "pending" | "disputed" | "historical_unknown";
export interface ReferenceBinding {
  reference_version: string;
  scope_id: string;
  scope_kind: "task" | "numeric";
  input_sha256: string;
  artifacts: Record<string, string>;
}
export interface JudgeObservation {
  reference_binding?: ReferenceBinding;
  observation_id?: string;
  verdict: "PASS" | "REVISION_REQUIRED" | "INCOMPLETE";
  found_defects?: string[];
  rechecks?: Array<Pick<IssueRecheck, "id" | "state"> & { required?: boolean; evidence?: string }>;
  /** R09：程序冻结的必回查清单；提供时作为复查分母，不从 Judge 实际回报列表反推。 */
  required_recheck_ids?: string[];
  resolved_issue_ids?: string[];
  reintroduced_issue_ids?: string[];
  version?: { team_revision_id?: string; baseline_version?: string; loaded_component?: string };
  /** 观察来源（工作卡/评审记录），用于追溯；缺观察时保持未知。 */
  source?: string;
}
export interface JudgeEvaluationCase {
  sample_id: string;
  usage: "evaluation" | "rule_debug" | "excluded";
  reference: ReferenceVerdict;
  /** 参考中应发现但未指出的必要缺陷；只统计标记为 necessary 的项。 */
  necessary_defects?: Array<{ id: string; necessary?: boolean }>;
  observed?: JudgeObservation;
  reason?: string;
  reference_binding?: ReferenceBinding;
  reference_source?: unknown;
}
export interface JudgeMetric {
  numerator: number;
  denominator: number;
  rate: number | null;
  status: "observed" | "not_applicable" | "unknown";
}
const metric = (numerator: number, denominator: number, unknown = false): JudgeMetric =>
  unknown ? { numerator, denominator, rate: null, status: "unknown" }
    : denominator ? { numerator, denominator, rate: numerator / denominator, status: "observed" }
      : { numerator, denominator, rate: null, status: "not_applicable" };
export interface JudgeRecheckMetric {
  /** 仅合法程序冻结清单的已知子集；未知清单绝不从Judge回报推断。 */
  required: number;
  covered: number;
  /** 合法回报 open：已覆盖但未解决。 */
  unresolved_blocking: number;
  /** 回报 unverifiable：不算解决。 */
  unverifiable: number;
  /** 必回查项没有出现在本轮回报（漏回）。 */
  missed: number;
  wrong_closed: number;
  reintroduced: number;
  verified: number;
  unresolved_total: number;
  known_observations: number;
  unknown_observations: number;
  empty_observations: number;
  invalid_report_observations: number;
  invalid_reports: number;
  duplicate_reports: number;
  outside_reports: number;
  diagnostics: Array<{ sample_id: string; observation_id?: string; reason: string }>;
  denominator_source: "program_frozen" | "partial_program_frozen" | "unknown";
  status: "observed" | "not_applicable" | "unknown";
}
export interface JudgeEvaluationGroup {
  group: string;
  group_parts: { team_revision_id: string; baseline_version: string; loaded_component: string };
  cases: number;
  misrelease: JudgeMetric;
  misblock: JudgeMetric;
  missed_defects: JudgeMetric;
  /** 参考无法验证却被判 PASS：单列违规，不混入误放行分母。 */
  unverifiable_pass: { count: number; samples: string[] };
  recheck: JudgeRecheckMetric;
}
export interface ObservationIngestion {
  received: number;
  unique: number;
  duplicates: number;
  conflicts: number;
  conflict_records: number;
  invalid_records: number;
  excluded_records: number;
  included: number;
  unknown_records: number;
  duplicate_details: Array<{ identity: string; sources: string[]; record_indices: number[] }>;
  conflict_details: Array<{ identity: string; sources: string[]; record_indices: number[] }>;
}
export interface JudgeEvaluation {
  ingestion?: ObservationIngestion;
  groups: JudgeEvaluationGroup[];
  overall: Omit<JudgeEvaluationGroup, "group" | "group_parts" | "cases"> & { cases: number };
  unknown: Array<{ sample_id: string; reason: string }>;
  policy: string;
  observations: Array<{ sample_id: string; observation_id?: string | undefined; version?: JudgeObservation["version"]; source?: string | undefined; reference_binding?: ReferenceBinding | undefined; reference_source?: unknown }>;
}
/** R09：身份不足（团队/基准/加载组件未知）的样本不能混入一个貌似可比较的整体通过率。 */
export function judgeGroupKey(version: JudgeObservation["version"] | undefined) {
  const parts = {
    team_revision_id: version?.team_revision_id ?? "unknown",
    baseline_version: version?.baseline_version ?? "unknown",
    loaded_component: version?.loaded_component ?? "unknown",
  };
  return { group: `${parts.team_revision_id} / ${parts.baseline_version} / ${parts.loaded_component}`, parts };
}
/** R21：逐观察校验并统计；评价和工作J1读取共用。open/verified/unverifiable均覆盖，仅verified解决。 */
export function evaluateRechecks(observations: Array<{ sample_id: string; observation: Pick<JudgeObservation, "observation_id" | "required_recheck_ids" | "rechecks" | "resolved_issue_ids" | "reintroduced_issue_ids"> }>): JudgeRecheckMetric {
  const result: JudgeRecheckMetric = { required: 0, covered: 0, verified: 0, unresolved_total: 0, unresolved_blocking: 0, unverifiable: 0, missed: 0, wrong_closed: 0, reintroduced: 0, known_observations: 0, unknown_observations: 0, empty_observations: 0, invalid_report_observations: 0, invalid_reports: 0, duplicate_reports: 0, outside_reports: 0, diagnostics: [], denominator_source: "unknown", status: "unknown" };
  for (const { sample_id, observation: o } of observations) {
    const note = (reason: string) => result.diagnostics.push({ sample_id, ...(o.observation_id ? { observation_id: o.observation_id } : {}), reason });
    const ids = o.required_recheck_ids;
    if (!Array.isArray(ids) || !ids.every(issueId) || new Set(ids).size !== ids.length) {
      result.unknown_observations++; note("程序必回查清单缺失/类型或ID无效/重复，分母未知；不使用Judge自报列表"); continue;
    }
    result.known_observations++;
    if (!ids.length) result.empty_observations++;
    result.required += ids.length;
    const required = new Set(ids), buckets = new Map<string, unknown[]>();
    let invalid = false;
    const reportError = (reason: string) => { invalid = true; result.invalid_reports++; note(reason); };
    if (o.rechecks !== undefined && !Array.isArray(o.rechecks)) reportError("rechecks必须是数组");
    for (const row of Array.isArray(o.rechecks) ? o.rechecks : []) {
      if (!object(row) || !issueId(row.id)) { reportError("回报缺合法问题ID"); continue; }
      if (!required.has(row.id)) result.outside_reports++;
      buckets.set(row.id, [...(buckets.get(row.id) ?? []), row]);
    }
    const verified = new Set<string>();
    for (const [id, rows] of buckets) {
      if (rows.length > 1) { result.duplicate_reports += rows.length - 1; reportError(`回报ID ${id} 重复/冲突，不能覆盖或关闭`); continue; }
      const row = rows[0] as Record<string, unknown>;
      if (!["open", "verified", "unverifiable"].includes(String(row.state)) || typeof row.state !== "string" || (row.required !== undefined && typeof row.required !== "boolean") || (row.evidence !== undefined && !nonempty(row.evidence))) { reportError(`回报 ${id} 状态/字段非法`); continue; }
      if (!required.has(id)) { note(`清单外回报 ${id} 不进入分母/覆盖数`); continue; }
      result.covered++;
      if (row.state === "verified") { result.verified++; verified.add(id); }
      if (row.state === "open") result.unresolved_blocking++;
      if (row.state === "unverifiable") result.unverifiable++;
    }
    for (const field of ["resolved_issue_ids", "reintroduced_issue_ids"] as const) {
      const value = o[field];
      if (value === undefined) continue;
      if (!Array.isArray(value) || !value.every(issueId)) { reportError(`${field}必须为合法ID数组`); continue; }
      if (new Set(value).size !== value.length) reportError(`${field}包含重复ID`);
      if (field === "resolved_issue_ids") result.wrong_closed += [...new Set(value)].filter(id => !verified.has(id)).length;
      else result.reintroduced += new Set(value).size;
    }
    if (invalid) result.invalid_report_observations++;
  }
  result.missed = result.required - result.covered;
  result.unresolved_total = result.required - result.verified;
  result.denominator_source = result.known_observations ? result.unknown_observations ? "partial_program_frozen" : "program_frozen" : "unknown";
  result.status = !observations.length || result.unknown_observations ? "unknown" : !result.required ? "not_applicable" : result.invalid_report_observations ? "unknown" : "observed";
  return result;
}
function evaluateGroup(group: string, groupParts: JudgeEvaluationGroup["group_parts"], cases: JudgeEvaluationCase[]): JudgeEvaluationGroup {
  const qualified = cases.filter((item) => item.reference === "qualified");
  const unqualified = cases.filter((item) => item.reference === "unqualified");
  const unverifiable = cases.filter((item) => item.reference === "unverifiable");
  const released = unqualified.filter((item) => item.observed?.verdict === "PASS").length;
  const blocked = qualified.filter((item) => item.observed?.verdict !== "PASS").length;
  // 参考无法验证却被判 PASS：明确违规计数，不当作分母里的普通错误，也不呈现成零错误。
  const unverifiablePass = unverifiable.filter((item) => item.observed?.verdict === "PASS");
  const defects = cases.flatMap((item) => (item.necessary_defects ?? []).filter((defect) => defect.necessary !== false).map((defect) => ({ case: item, defect })));
  const missed = defects.filter(({ case: item, defect }) => !(item.observed?.found_defects ?? []).includes(defect.id)).length;
  const recheck = evaluateRechecks(cases.map(item => ({ sample_id: item.sample_id, observation: item.observed! })));
  return {
    group,
    group_parts: groupParts,
    cases: cases.length,
    misrelease: metric(released, unqualified.length),
    misblock: metric(blocked, qualified.length),
    missed_defects: metric(missed, defects.length),
    unverifiable_pass: { count: unverifiablePass.length, samples: unverifiablePass.map((item) => item.sample_id) },
    recheck,
  };
}
export function evaluateJudge(cases: readonly JudgeEvaluationCase[]): JudgeEvaluation {
  const unknown: Array<{ sample_id: string; reason: string }> = [];
  const judgeable: JudgeEvaluationCase[] = [];
  for (const item of cases) {
    if (item.usage !== "evaluation") { unknown.push({ sample_id: item.sample_id, reason: `用途为 ${item.usage}，只作规则调试/历史线索，不计入 Judge 准确率` }); continue; }
    if (!["qualified", "unqualified", "unverifiable"].includes(item.reference)) { unknown.push({ sample_id: item.sample_id, reason: `参考标签为 ${item.reference}，缺少独立可信参考结论` }); continue; }
    if (!item.observed) { unknown.push({ sample_id: item.sample_id, reason: item.reason ?? "缺少对应判定观察（未运行或未记录）" }); continue; }
    judgeable.push(item);
  }
  const groups = new Map<string, { parts: JudgeEvaluationGroup["group_parts"]; items: JudgeEvaluationCase[] }>();
  for (const item of judgeable) {
    const identity = judgeGroupKey(item.observed?.version);
    const { parts } = identity;
    const group = identity.group + (item.reference_binding ? ` / reference:${item.reference_binding.reference_version} / ${item.reference_binding.scope_kind}:${item.reference_binding.scope_id}` : "");
    const bucket = groups.get(group) ?? { parts, items: [] };
    bucket.items.push(item);
    groups.set(group, bucket);
  }
  const evaluated = [...groups].map(([group, bucket]) => evaluateGroup(group, bucket.parts, bucket.items));
  const overallBase = evaluateGroup("overall", { team_revision_id: "unknown", baseline_version: "unknown", loaded_component: "unknown" }, judgeable);
  // 不同机制/基准/可评范围只有分组计数，不生成貌似可比较的综合率。
  if (evaluated.length > 1 || !judgeable.length) for (const metric of [overallBase.misrelease, overallBase.misblock, overallBase.missed_defects]) { metric.rate = null; metric.status = "unknown"; }
  return {
    groups: evaluated,
    observations: judgeable.map(item => ({ sample_id: item.sample_id, observation_id: item.observed?.observation_id, version: item.observed?.version, source: item.observed?.source, reference_binding: item.reference_binding, reference_source: item.reference_source })),
    overall: { cases: overallBase.cases, misrelease: overallBase.misrelease, misblock: overallBase.misblock, missed_defects: overallBase.missed_defects, unverifiable_pass: overallBase.unverifiable_pass, recheck: overallBase.recheck },
    unknown,
    policy: "只对有独立可信参考结论且已完成判定的样本计算；误放行分母只含参考不合格，无法验证样本被判 PASS 单列违规；复查分母来自程序冻结的必回查清单；分组键为团队修订+基准版本+加载组件，身份不足的样本单列未知；分母为 0 记不适用，参考不足记未知；历史 PASS/verified 不自动生成正样本。",
  };
}
/** 读取 11.1 参考集结构；待人工确认与历史未知样本保留为 unknown，不强行纳入评价。 */
export function loadJudgeReferenceCases(text: string): JudgeEvaluationCase[] {
  const parsed = YAML.parse(text) as { samples?: Array<Record<string, unknown>> };
  return (parsed?.samples ?? []).map((sample) => {
    const label = (sample.reference_label ?? {}) as Record<string, unknown>;
    const usage = String(sample.usage ?? "excluded");
    const confirmation = String(label.confirmation ?? "pending_human_confirmation");
    const kind = String(label.kind ?? "");
    const scope = sample.evaluable_scope as { kind?: string; id?: string } | undefined;
    const frozen = sample.frozen_input as { manifest_sha256?: string } | undefined;
    const versions = Array.isArray(sample.artifact_versions) ? sample.artifact_versions as Array<{ filename: string; sha256: string }> : [];
    const nonempty = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
    const hash = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/u.test(v);
    const valid = nonempty(sample.reference_version) && nonempty(scope?.id) && ["task", "numeric"].includes(scope?.kind ?? "")
      && hash(frozen?.manifest_sha256) && versions.length > 0 && versions.every(v => nonempty(v.filename) && hash(v.sha256)) && new Set(versions.map(v => v.filename)).size === versions.length
      && nonempty(sample.applicable_baseline) && sample.applicable_baseline !== "unknown" && !!sample.source && typeof sample.source === "object" && Object.keys(sample.source).length > 0
      && nonempty(label.confirmed_by) && nonempty(label.method) && nonempty(label.confirmed_at) && Number.isFinite(Date.parse(label.confirmed_at))
      && Array.isArray(label.basis) && label.basis.length > 0 && label.basis.every(nonempty)
      && ["qualified", "unqualified", "unverifiable"].includes(String(label.verdict));
    const confirmed = valid && (confirmation === "independent_confirmed" && kind === "business" || confirmation === "deterministic_recompute" && kind === "deterministic" && scope?.kind === "numeric");
    const reference: ReferenceVerdict = label.disputed === true || kind === "disputed_candidate_misrelease" ? "disputed"
      : confirmation === "historical_unknown" ? "historical_unknown" : confirmed ? label.verdict as ReferenceVerdict : "pending";
    const binding: ReferenceBinding | undefined = confirmed ? { reference_version: String(sample.reference_version), scope_kind: scope!.kind as "task" | "numeric", scope_id: scope!.id!, input_sha256: frozen!.manifest_sha256!, artifacts: Object.fromEntries(versions.map(v => [v.filename, v.sha256])) } : undefined;
    return {
      sample_id: String(sample.sample_id ?? "unknown"),
      usage: (usage === "evaluation" || usage === "rule_debug" ? usage : "excluded") as JudgeEvaluationCase["usage"],
      reference,
      ...(binding ? { reference_binding: binding } : {}),
      reference_source: sample.source,
      ...(Array.isArray(sample.necessary_defects) ? { necessary_defects: sample.necessary_defects as NonNullable<JudgeEvaluationCase["necessary_defects"]> } : {}),
      reason: confirmed ? `已确认${scope!.kind === "numeric" ? "局部数值" : "业务"}标签，仅适用于 ${scope!.id}` : `参考标签状态：${confirmation}；未确认/缺版本、范围或确认依据，不纳入分母`,
    };
  });
}
export interface JudgeObservationRecord {
  sample_id: string;
  observation: JudgeObservation;
  /** YAML读取不静默丢非法行；由统一入口计为未知/非法，不入分母。 */
  invalid_reason?: string;
}
/**
 * R09：从已有参考清单与合法观察记录（本地读模型导出的 YAML）进入计算的最小入口。
 * 参考标签仍按独立依据处理；观察缺失的样本保持 unknown，不输出 0% 业务准确率。
 */
export function judgeObservationsFromYaml(text: string): JudgeObservationRecord[] {
  const parsed: unknown = YAML.parse(text);
  if (!object(parsed) || !Array.isArray(parsed.observations)) throw new Error("观察YAML需要observations数组");
  return parsed.observations.map((raw, index) => {
    const entry = object(raw) ? raw : {};
    // 保留语义字段原始类型，禁止map(String)把非法数字ID变成合法字符串。
    const observation = Object.fromEntries(["verdict", "observation_id", "reference_binding", "version", "source", "found_defects", "rechecks", "required_recheck_ids", "resolved_issue_ids", "reintroduced_issue_ids"].filter(key => Object.hasOwn(entry, key)).map(key => [key, entry[key]])) as unknown as JudgeObservation;
    const invalid = !nonempty(entry.sample_id) || !["PASS", "REVISION_REQUIRED", "INCOMPLETE"].includes(String(entry.verdict));
    return { sample_id: nonempty(entry.sample_id) ? entry.sample_id : `invalid-row-${index + 1}`, observation, ...(invalid ? { invalid_reason: "观察缺合法sample_id或verdict" } : {}) };
  });
}
/** 从程序保存的回合记录导出观察（本地读模型）；没有有效判定结果的回合不产生观察。 */
export function judgeObservationFromRound(input: {
  sample_id: string;
  verdict?: "PASS" | "REVISION_REQUIRED" | "INCOMPLETE";
  found_defects?: string[];
  rechecks?: NonNullable<JudgeObservation["rechecks"]>;
  required_recheck_ids?: string[];
  resolved_issue_ids?: string[];
  reintroduced_issue_ids?: string[];
  team_revision_id?: string;
  baseline_version?: string;
  loaded_component?: string;
  source?: string;
  reference_binding?: ReferenceBinding;
  observation_id?: string;
}): JudgeObservationRecord | undefined {
  if (!input.verdict) return undefined;
  return {
    sample_id: input.sample_id,
    observation: {
      verdict: input.verdict,
      ...(input.reference_binding ? { reference_binding: input.reference_binding } : {}),
      ...(input.observation_id ? { observation_id: input.observation_id } : {}),
      ...(input.found_defects ? { found_defects: input.found_defects } : {}),
      ...(input.rechecks ? { rechecks: input.rechecks } : {}),
      ...(input.required_recheck_ids ? { required_recheck_ids: input.required_recheck_ids } : {}),
      ...(input.resolved_issue_ids ? { resolved_issue_ids: input.resolved_issue_ids } : {}),
      ...(input.reintroduced_issue_ids ? { reintroduced_issue_ids: input.reintroduced_issue_ids } : {}),
      version: { ...(input.team_revision_id ? { team_revision_id: input.team_revision_id } : {}), ...(input.baseline_version ? { baseline_version: input.baseline_version } : {}), ...(input.loaded_component ? { loaded_component: input.loaded_component } : {}) },
      ...(input.source ? { source: input.source } : {}),
    },
  };
}
/** 观察身份不包含冻结字节哈希：同身份改绑定必须冲突，而不是伪装第二个合法观察。 */
function observationIdentity(record: JudgeObservationRecord): string | undefined {
  const o = record.observation;
  const version = o?.version;
  const parts = [record.sample_id, o?.observation_id, version?.team_revision_id, version?.baseline_version, version?.loaded_component, o?.reference_binding?.reference_version];
  return parts.every(v => nonempty(v) && v !== "unknown") ? canonical(parts) : undefined;
}
/** 导出来源/键顺序/集合排序不是新的观察；缺冻结清单和合法空清单仍严格不同。 */
function observationPayload(o: JudgeObservation) {
  const { source: _exportSource, ...payload } = o;
  const sorted = (value: unknown) => Array.isArray(value) ? [...value].sort((a, b) => canonical(a).localeCompare(canonical(b))) : value;
  const optionalList = (value: unknown) => sorted(value === undefined ? [] : value); // null/非法类型不能等同合法空数组
  return canonical({ ...payload, found_defects: optionalList(o.found_defects), rechecks: optionalList(o.rechecks), required_recheck_ids: sorted(o.required_recheck_ids), resolved_issue_ids: optionalList(o.resolved_issue_ids), reintroduced_issue_ids: optionalList(o.reintroduced_issue_ids) });
}
/** R20：所有评价率和本地metrics共用去重/冲突结果；冲突全组隔离，不选第一/最后一个判定。 */
export function evaluateJudgeFromSources(referenceText: string, observations: readonly JudgeObservationRecord[]): JudgeEvaluation {
  const references = loadJudgeReferenceCases(referenceText);
  const ingestion: ObservationIngestion = { received: observations.length, unique: 0, duplicates: 0, conflicts: 0, conflict_records: 0, invalid_records: 0, excluded_records: 0, included: 0, unknown_records: 0, duplicate_details: [], conflict_details: [] };
  const unknown: JudgeEvaluation["unknown"] = [];
  const buckets = new Map<string, Array<{ record: JudgeObservationRecord; index: number }>>();
  observations.forEach((record, index) => {
    const identity = observationIdentity(record);
    if (!identity) { ingestion.invalid_records++; unknown.push({ sample_id: record.sample_id, reason: `观察第${index + 1}条缺身份/参考或机制版本绑定；来源：${record.observation?.source ?? "未知"}` }); return; }
    buckets.set(identity, [...(buckets.get(identity) ?? []), { record, index: index + 1 }]);
  });
  ingestion.unique = buckets.size;
  const cases: JudgeEvaluationCase[] = [];
  for (const [identity, entries] of buckets) {
    const sources = [...new Set(entries.map(e => e.record.observation.source ?? "未知"))].sort();
    const detail = { identity, sources, record_indices: entries.map(e => e.index) };
    const sampleId = entries[0]!.record.sample_id;
    if (new Set(entries.map(e => observationPayload(e.record.observation))).size > 1) {
      ingestion.conflicts++; ingestion.conflict_records += entries.length; ingestion.conflict_details.push(detail);
      unknown.push({ sample_id: sampleId, reason: `观察身份冲突，不进入分母：${identity}；来源：${sources.join("、")}` }); continue;
    }
    const { observation: o } = entries[0]!.record;
    const matches = references.filter(r => r.sample_id === sampleId && r.reference_binding?.reference_version === o.reference_binding?.reference_version);
    const item = matches[0];
    const valid = matches.length === 1 && item?.reference_binding && canonical(item.reference_binding) === canonical(o.reference_binding)
      && entries.every(e => !e.record.invalid_reason && nonempty(e.record.observation.source))
      && ["PASS", "REVISION_REQUIRED", "INCOMPLETE"].includes(o.verdict)
      && (o.found_defects === undefined || Array.isArray(o.found_defects) && o.found_defects.every(issueId));
    if (!valid) {
      // 参考未确认/用途不符与非法观察分别计数；两者都不纳入可信分母。
      const excluded = item && (item.usage !== "evaluation" || !["qualified", "unqualified", "unverifiable"].includes(item.reference));
      if (excluded) ingestion.excluded_records += entries.length; else ingestion.invalid_records += entries.length;
      unknown.push({ sample_id: sampleId, reason: `${excluded ? "参考标签未独立确认或用途不符" : "观察字段非法或缺冻结样本/范围的准确绑定"}；来源：${sources.join("、")}` }); continue;
    }
    ingestion.duplicates += entries.length - 1;
    if (entries.length > 1) ingestion.duplicate_details.push(detail);
    cases.push({ ...item!, observed: o });
  }
  // 无观察的参考样本仍披露，不虚构一次判定。
  for (const item of references) if (!observations.some(r => r.sample_id === item.sample_id && (!item.reference_binding || r.observation.reference_binding?.reference_version === item.reference_binding.reference_version))) cases.push(item);
  const result = evaluateJudge(cases);
  ingestion.included = result.overall.cases;
  // 通过结构核验但因参考用途排除的观察也计入未知来源统计。
  ingestion.excluded_records += cases.filter(c => c.observed && c.usage !== "evaluation").length;
  ingestion.unknown_records = ingestion.invalid_records + ingestion.conflict_records + ingestion.excluded_records;
  return { ...result, unknown: [...result.unknown, ...unknown], ingestion };
}
