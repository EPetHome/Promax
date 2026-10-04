import { createHash, randomUUID } from "node:crypto";
import { constants, existsSync } from "node:fs";
import { lstat, mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import YAML from "yaml";
import { ratingStatistics, roundedRatingRatio, RATING_SPEC_VERSION } from "./rating-statistics.ts";
import type { AcceptanceBaseline } from "../../promax-ui-console/src/effective-protocol.ts";

/**
 * 6.4 结论关联：成员只提交“必需项 / 结论定位 / 所用依据 / 数值口径”，程序负责校验与派生。
 * 这里不扫描 SRC 编号来发明支持关系；引用索引只来自被接受的关联。
 * R04：来源必须回读实际字节并核对 manifest 哈希与定位；R10：结论身份与文本/位置分离。
 */
export const EVIDENCE_LINKS_SCHEMA_VERSION = 2;
// 每来源的实际读取上限；完整定位不放宽短行/片段约束，不读取任意路径或执行模型代码。
export const SOURCE_BYTE_LIMIT = 8 * 1024 * 1024;
export const NUMERIC_RECORD_LIMIT = 100_000;
const KIND_VALUES = ["fact", "comparison", "change", "trend", "projection", "recommendation", "unknown"] as const;
const NUMERIC_KEYS = ["input", "definition", "unit", "window", "numerator", "denominator", "filter", "missing_rule", "formula", "rounding", "result", "field"] as const;
export type EvidenceBasisKind = "requirement_record" | "source_link" | "numeric_recompute" | "program_check";
export interface EvidenceLinkInput {
  requirement_ids: string[];
  conclusion: string;
  location: string;
  /** R10：修订时显式引用已登记结论身份；首次登记省略，由程序分配。 */
  conclusion_id?: string;
  kind?: (typeof KIND_VALUES)[number];
  evidence: Array<{ source_id: string; range: string; use?: string }>;
  numeric_spec?: Record<string, string>;
  /** 拆分/合并/撤回时列出被替代的结论身份；留历史去向，不做近似匹配。 */
  supersedes?: string[];
  note?: string;
}
export interface SourceReadback {
  source_id: string;
  relative_path: string;
  sha256: string;
  range: string;
  /** 支持的最小定位契约解析出的行区间；精确片段定位时缺省。 */
  lines?: [number, number];
  snippet: string;
  verified_at: string;
  task_key?: string;
  qualification_sha256?: string;
}
export interface NumericCheck {
  status: "recomputed" | "unsupported";
  formula?: string;
  computed?: number;
  declared?: string;
  matched?: boolean;
  reason?: string;
  checker_version?: string;
  spec_sha256?: string;
  input?: { source_id: string; sha256: string; range: string; selected_sha256: string };
  counts?: { rows: number; numerator: number; denominator: number; missing_rows: number[] };
  unit?: string;
  coverage?: string;
}
export interface ConditionalCheck {
  /** 来源该部分内容是否可作为候选证据；线索/诊断来源不满足 source_link 依据。 */
  usable_as_evidence: boolean;
  reason: string;
}
export interface AcceptedEvidenceLink extends EvidenceLinkInput {
  /** Conservative textual dependencies, not a semantic approval. Old missing fingerprints cannot auto-carry. */
  dependency_sha256?: string;
  continued_from?: { link_id: string; artifact_sha256: string };
  link_id: string;
  conclusion_id: string;
  /** null = 首次登记，stage 不占号；显式修订保留原始请求身份参与幂等。 */
  requested_conclusion_id?: string | null;
  artifact_sha256: string;
  /** 来源在输入清单中的使用资格；线索/诊断来源不冒充候选证据，交由 Judge 判支持关系。 */
  source_qualification: Array<{ source_id: string; use_qualification: string | null; content_kind: string | null }>;
  source_readback: SourceReadback[];
  conditional: ConditionalCheck;
  numeric_check?: NumericCheck;
  matched_at: string;
}
export interface ConclusionRecord {
  conclusion_id: string;
  artifact: string;
  first_conclusion: string;
  first_location: string;
  created_at: string;
  current: { conclusion: string; location: string; artifact_sha256: string; link_id: string; at: string };
  revisions: Array<{ at: string; conclusion: string; location: string; artifact_sha256: string; link_id?: string; supersedes?: string[]; note?: string }>;
  superseded_by?: string | null;
  inactive?: { at: string; state: "invalidated" | "withdrawn"; reason: string };
  lineage: Array<{ at: string; kind: "split" | "merge" | "withdraw"; ids: string[]; note?: string }>;
}
export interface EvidenceLinksArtifact {
  filename: string;
  sha256: string;
  member: string;
  accepted_at: string;
  links: AcceptedEvidenceLink[];
  /** 只从已接受关联派生的引用索引；不是扫描正文得到的。 */
  citation_index: Array<{ source_id: string; used_by: string[]; requirement_ids: string[]; use_qualification: string | null; content_kind: string | null }>;
  history: Array<{ sha256: string; accepted_at: string; link_ids: string[]; superseded_at: string; superseded_by_sha256: string }>;
}
export interface EvidenceLinksFile {
  schema_version: 2;
  task_key: string;
  updated_at: string;
  /** 派生索引对应的权威回执摘要；不一致时由回执重建，而不是把半完成状态当已登记。 */
  receipts_digest: string;
  artifacts: EvidenceLinksArtifact[];
  conclusions: ConclusionRecord[];
}
export interface FrozenSourceRecord {
  source_id: string;
  use_qualification?: string;
  content_kind?: string;
  media_type?: string;
  origin_kind?: string;
  relative_path?: string;
  sha256?: string;
  fetch_status?: string;
  http_status?: number;
  extraction?: { state?: string };
}
/** 权威回执中与派生索引有关的最小结构；避免与 work-store 形成循环依赖。 */
export interface ReceiptWithLinks {
  filename: string;
  sha256: string;
  member: string;
  at: string;
  evidence_links?: AcceptedEvidenceLink[];
  evidence_continuity?: Array<{ conclusion_id: string; state: "continued" | "invalidated" | "withdrawn"; reason: string }>;
}
export interface EvidenceAggregateRow {
  /** 已接受关联提供的依据类别。 */
  available: EvidenceBasisKind[];
  /** 版本与当前被审成果一致、且来源可作候选证据的关联。 */
  links: Array<{ link_id: string; conclusion_id: string; source_ids: string[]; location: string }>;
  /** 已登记但来源资格只支持线索/诊断的关联；用于说明“有登记但不足以支持”。 */
  lead_only_links: string[];
  bindings?: Array<{ filename: string; receipt_digest: string; sources: Array<{ task_key: string; source_id: string; relative_path: string; sha256: string; qualification_sha256: string }> }>;
}
export type EvidenceIndex = Record<string, EvidenceAggregateRow>;
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const clip = (value: unknown, max: number) => (typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined);
const text = (value: unknown, max = 200_000) => (typeof value === "string" ? value.slice(0, max) : "");

/** Frozen input manifest is the only authority for source ids; a missing manifest rejects the links instead of guessing. */
export async function readFrozenSources(workspace: string, taskKey: string, allowEmpty = false): Promise<{ sources: Map<string, FrozenSourceRecord>; manifest: string } | { error: string }> {
  const candidates = [join(workspace, ".任务", taskKey, "输入", "manifest.yml"), join(workspace, ".promax", "input", taskKey, "manifest.yml")];
  const manifest = candidates.find((path) => existsSync(path));
  if (!manifest) return { error: `冻结输入包不存在，不能登记来源关联（已查找 ${candidates.join("、")}）` };
  try {
    const parsed = YAML.parse(await readFile(manifest, "utf8")) as { spec?: { sources?: FrozenSourceRecord[] } };
    const sources = new Map((parsed?.spec?.sources ?? []).map((source) => [source.source_id, source]));
    if (!sources.size && !allowEmpty) return { error: "冻结输入包没有可核对的来源清单" };
    return { sources, manifest };
  } catch (error) {
    return { error: `冻结输入包不可读取：${error instanceof Error ? error.message : String(error)}` };
  }
}
export function linksPath(workspace: string, taskKey: string) {
  return join(workspace, ".任务", taskKey, "结论关联.yml");
}
/** Raw read of the derived index; callers that own receipts rebuild when it is stale. */
export async function readEvidenceLinks(workspace: string, taskKey: string): Promise<EvidenceLinksFile> {
  const path = linksPath(workspace, taskKey);
  if (!existsSync(path)) return emptyEvidenceLinks(taskKey);
  const parsed = YAML.parse(await readFile(path, "utf8")) as EvidenceLinksFile;
  if (parsed?.schema_version !== EVIDENCE_LINKS_SCHEMA_VERSION || !Array.isArray(parsed.artifacts) || !Array.isArray(parsed.conclusions)) throw new Error("结论关联文件版本或结构不支持");
  return parsed;
}
export function emptyEvidenceLinks(taskKey: string): EvidenceLinksFile {
  return { schema_version: EVIDENCE_LINKS_SCHEMA_VERSION, task_key: taskKey, updated_at: new Date(0).toISOString(), receipts_digest: receiptsDigest([]), artifacts: [], conclusions: [] };
}
export function receiptsDigest(receipts: readonly ReceiptWithLinks[]) {
  const canonical = [...receipts]
    .map((receipt) => ({ filename: receipt.filename, sha256: receipt.sha256, member: receipt.member, at: receipt.at, links: receipt.evidence_links ?? [] }))
    .sort((a, b) => `${a.filename}\u0000${a.at}`.localeCompare(`${b.filename}\u0000${b.at}`));
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}
/** R02: 关联载荷也是提交内容的一部分；正文不变但关联修订时不能按重复跳过。 */
export function evidenceDigest(links: readonly EvidenceLinkInput[] | undefined) {
  return sha256(stableJson((links ?? []).map((input) => {
    const link = input as Partial<AcceptedEvidenceLink> & EvidenceLinkInput;
    const { link_id: _id, matched_at: _at, conclusion_id, requested_conclusion_id, source_readback, ...semantic } = link;
    return { ...semantic, conclusion_id: requested_conclusion_id === undefined ? conclusion_id ?? null : requested_conclusion_id,
      ...(source_readback ? { source_readback: source_readback.map(({ verified_at: _observed, ...version }) => version) } : {}) };
  })));
}
function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, entry) => record(entry) ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b))) : entry);
}
/** 同一请求内容与版本，排除 call_id/观测时刻/程序首次分配的编号。 */
export function receiptSemanticDigest(receipt: ReceiptWithLinks & { call_id?: string; evidence_digest?: string; evidence_request_digest?: string; evidence_base_digest?: string; evidence_continuity?: unknown }) {
  const { at: _at, call_id: _call, evidence_digest: _digest, evidence_links, evidence_request_digest, evidence_base_digest: _base, evidence_continuity: _continuity, ...semantic } = receipt;
  return sha256(stableJson({ ...semantic, evidence: evidence_request_digest ?? evidenceDigest(evidence_links) }));
}
/** Extract only model input, never carry computed fields as if they were member assertions. */
export function evidenceLinkInput(link: AcceptedEvidenceLink): EvidenceLinkInput {
  return { requirement_ids: link.requirement_ids, conclusion: link.conclusion, location: link.location, conclusion_id: link.conclusion_id,
    ...(link.kind ? { kind: link.kind } : {}), evidence: link.evidence, ...(link.numeric_spec ? { numeric_spec: link.numeric_spec } : {}),
    ...(link.supersedes ? { supersedes: link.supersedes } : {}), ...(link.note ? { note: link.note } : {}) };
}
/** Bind local section + enclosing headings + shared scope/unit/source/limitation sections. No approximate anchor. */
export function evidenceDependency(text: string, link: EvidenceLinkInput): string | undefined {
  if (text.split(link.location).length !== 2 || !text.includes(link.conclusion) || !anchorBindsConclusion(text, link.location, link.conclusion).ok) return undefined;
  const lines = text.split(/\r?\n/u), at = lines.findIndex(line => line.includes(link.location));
  const headings = lines.flatMap((line, i) => { const m = line.match(/^(#{1,6})\s/u); return m ? [{ i, depth: m[1]!.length, line }] : []; });
  const local = headings.filter(h => h.i <= at).at(-1);
  const end = local ? headings.find(h => h.i > at && h.depth <= local.depth)?.i ?? lines.length : lines.length;
  const parents = local ? headings.filter(h => h.i <= local.i && !headings.some(n => n.i > h.i && n.i <= local.i && n.depth <= h.depth)).map(h => h.line) : [];
  const scope = headings.filter(h => h.depth > 1 && /口径|范围|样本|单位|来源|限制|时间|输入|scope|unit|source|limit/iu.test(h.line)).map(h => lines.slice(h.i, headings.find(n => n.i > h.i && n.depth <= h.depth)?.i ?? lines.length).join("\n"));
  return sha256(stableJson({ preamble: lines.slice(0, headings.find(h => h.depth >= 2)?.i ?? 0), parents, local: lines.slice(local?.i ?? 0, end), scope }));
}
/** 只在权威工作锁内分配。每个已接受关联版本独立 LNK，CNL 仅显式修订复用。 */
export function assignEvidenceIdentities(receipts: readonly ReceiptWithLinks[], links: readonly AcceptedEvidenceLink[], filename: string): AcceptedEvidenceLink[] {
  const all = receipts.flatMap(r => (r.evidence_links ?? []).map(link => ({ ...link, filename: r.filename })));
  const cnls = all.map(l => l.conclusion_id), lnks = all.map(l => l.link_id);
  const claimed = new Set<string>();
  return links.map(input => {
    const link = structuredClone(input);
    if (link.conclusion_id) {
      const owner = all.find(l => l.conclusion_id === link.conclusion_id);
      if (!owner || owner.filename !== filename || claimed.has(link.conclusion_id)) throw new Error(`结论身份 ${link.conclusion_id} 未知、跨成果或重复，冲突未保存`);
    } else link.conclusion_id = nextIdentity("CNL", cnls);
    cnls.push(link.conclusion_id); claimed.add(link.conclusion_id);
    link.link_id = nextIdentity("LNK", lnks); lnks.push(link.link_id);
    return link;
  });
}

/**
 * 定位契约：只支持明确的最小形式，避免把任意自然语言当作“已核验范围”。
 * - `第 3 行` / `第 3-5 行` / `L3` / `L3-L5` / `lines 3-5`
 * - `json:all`：仅 numeric_spec.input 对应冻结来源的完整 JSON 数组，仍受字节/记录上限约束。
 * - 其它形式视为精确片段，必须逐字出现在来源正文中（最多400字符）。
 */
export function parseRange(value: string): { kind: "lines"; start: number; end: number } | { kind: "snippet"; text: string } | { kind: "json_all" } | { error: string } {
  const trimmed = value.trim();
  if (trimmed.length > 400) return { error: "定位不得超过400字符" };
  if (trimmed === "json:all") return { kind: "json_all" };
  const lineMatch = trimmed.match(/^(?:第\s*(\d+)\s*(?:[-–~至]\s*(\d+)\s*)?行|L\s*(\d+)(?:\s*[-–~]\s*(\d+))?|lines?\s+(\d+)(?:\s*[-–~]\s*(\d+))?)$/iu);
  if (lineMatch) {
    const start = Number(lineMatch[1] ?? lineMatch[3] ?? lineMatch[5]);
    const end = Number(lineMatch[2] ?? lineMatch[4] ?? lineMatch[6] ?? start);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start) return { error: `定位区间无效：${trimmed}` };
    if (end - start > 200) return { error: `定位区间过大（>200 行）：${trimmed}` };
    return { kind: "lines", start, end };
  }
  if (trimmed.length < 4) return { error: `定位过短，无法核验：${trimmed}` };
  return { kind: "snippet", text: trimmed };
}
/** 结论锚点必须真的指向这条结论，而不是“结论和锚点各自出现在同一文件”。 */
export function anchorBindsConclusion(artifactText: string, location: string, conclusion: string, windowLines = 80) {
  if (location.includes(conclusion) || conclusion.includes(location)) return { ok: true as const };
  const lines = artifactText.split(/\r?\n/u);
  const anchorLine = lines.findIndex((line) => line.includes(location));
  if (anchorLine < 0) return { ok: false as const, reason: "定位未命中成果当前版本" };
  const heading = lines[anchorLine]!.match(/^(#{1,6})\s/u);
  const sectionEnd = heading
    ? lines.findIndex((line, index) => index > anchorLine && new RegExp(`^#{1,${heading[1]!.length}}\\s`, "u").test(line))
    : -1;
  const stop = sectionEnd > 0 ? sectionEnd : Math.min(lines.length, anchorLine + windowLines);
  const conclusionLine = lines.findIndex((line, index) => index >= anchorLine && index < stop && line.includes(conclusion));
  return conclusionLine >= 0 ? { ok: true as const } : { ok: false as const, reason: `结论未出现在定位项所在的段落/章节内（定位在第 ${anchorLine + 1} 行）` };
}
/** 使用资格：线索/诊断/未知来源可以登记，但不能单独满足 source_link 依据。 */
export function sourceUsableAsEvidence(source: FrozenSourceRecord | undefined, content: string) {
  if (!source) return { usable_as_evidence: false, reason: "来源不在冻结输入清单中" };
  if ((source.http_status ?? 0) >= 400 || ["failed", "cancelled"].includes(source.fetch_status ?? "") || source.content_kind === "error_page")
    return { usable_as_evidence: false, reason: "已知 HTTP/抓取失败或错误页；冲突资格不得升级为业务证据" };
  if (source.content_kind === "search_index" || /web-search-summary\.[^/]+$/u.test(source.relative_path ?? "") || /^仅搜索摘要，未取得正文/u.test(content.trim()))
    return { usable_as_evidence: false, reason: "搜索记录只能作线索，未取得原文" };
  if (!content.trim() || source.extraction?.state === "empty" || source.extraction?.state === "parse_failed") return { usable_as_evidence: false, reason: "没有可读取正文" };
  const qualification = source.use_qualification ?? (source.origin_kind === "user-provided" ? "candidate"
    : source.fetch_status === "success" && (source.http_status ?? 0) >= 200 && (source.http_status ?? 0) < 300 && source.content_kind === "body" ? "candidate" : "unknown");
  if (qualification === "candidate") return { usable_as_evidence: true, reason: "候选证据（仍需语义核对）" };
  if (qualification === "lead_only") return { usable_as_evidence: false, reason: "搜索结果/目录线索只作发现线索" };
  if (qualification === "diagnostic_only") return { usable_as_evidence: false, reason: "访问失败/错误页只作失败诊断" };
  return { usable_as_evidence: false, reason: "来源资格未知，不能单独作为结论依据" };
}
/**
 * 校验一条成果回执的结论关联。错误逐条返回，全部通过才允许提交；不做近似匹配或静默绑定。
 * 本函数只做形状/必需项/正文锚点校验；来源字节与定位由 verifyEvidenceLinks 回读核验。
 */
export function validateEvidenceLinks(
  raw: unknown,
  context: { baseline: AcceptanceBaseline | undefined; sources: Map<string, FrozenSourceRecord> | undefined; artifactText: string; filename: string },
): { links: EvidenceLinkInput[]; errors: string[] } {
  const errors: string[] = [];
  if (raw === undefined) return { links: [], errors };
  if (!Array.isArray(raw)) return { links: [], errors: ["evidence_links 必须是数组"] };
  if (raw.length > 60) errors.push("evidence_links 一次最多 60 条");
  const requirementIds = new Set((context.baseline?.items ?? []).map((item) => item.id));
  const links: EvidenceLinkInput[] = [];
  const seenConclusions = new Set<string>();
  raw.forEach((value, index) => {
    const at = `evidence_links[${index}]`;
    if (!record(value)) return void errors.push(`${at} 不是对象`);
    for (const key of Object.keys(value)) if (!["requirement_ids", "conclusion", "location", "conclusion_id", "kind", "evidence", "numeric_spec", "supersedes", "note"].includes(key)) errors.push(`${at} 含未知字段 ${key}`);
    const ids = Array.isArray(value.requirement_ids) && value.requirement_ids.every((id) => typeof id === "string" && id.trim()) ? (value.requirement_ids as string[]).map((id) => id.trim()) : undefined;
    if (!ids || !ids.length) errors.push(`${at}.requirement_ids 必须是非空 ID 数组`);
    else {
      if (new Set(ids).size !== ids.length) errors.push(`${at}.requirement_ids 重复`);
      for (const id of ids) if (!requirementIds.has(id)) errors.push(`${at} 关联未知验收项 ${id}`);
    }
    if (!context.baseline) errors.push(`${at} 当前没有冻结验收基准，不能登记结论关联`);
    const conclusion = clip(value.conclusion, 500);
    const location = clip(value.location, 300);
    if (!conclusion) errors.push(`${at}.conclusion 必填（结论原文或准确引用）`);
    if (!location || location.length < 4) errors.push(`${at}.location 必填且不少于 4 个字符（成果内的真实定位）`);
    const conclusionId = clip(value.conclusion_id, 40);
    if (conclusionId !== undefined && !/^CNL-\d{3,6}$/u.test(conclusionId)) errors.push(`${at}.conclusion_id 必须是程序分配的 CNL-### 身份`);
    if (value.supersedes !== undefined && (!Array.isArray(value.supersedes) || !value.supersedes.every((id) => typeof id === "string" && /^CNL-\d{3,6}$/u.test(id)))) errors.push(`${at}.supersedes 必须是 CNL-### 数组`);
    if (value.note !== undefined && !clip(value.note, 300)) errors.push(`${at}.note 必须是非空文本`);
    // R04：结论与定位必须在当前版本真实命中，且锚点指向该结论。
    if (conclusion && context.artifactText && !context.artifactText.includes(conclusion)) errors.push(`${at} 结论文本未在 ${context.filename} 当前版本中找到，不能凭记忆登记`);
    if (location && context.artifactText) {
      const count = context.artifactText.split(location).length - 1;
      const field = `${at}.location`;
      const received = JSON.stringify(location.length > 80 ? `${location.slice(0, 80)}…` : location);
      if (count === 0) errors.push(`${field} 在 ${context.filename} 当前版本未命中：收到 ${received}；须填成果正文中逐字存在且唯一的标题、表格行或结论片段，不要拼接导航描述`);
      else if (count > 1) {
        const positions: number[] = [];
        for (let from = 0; positions.length < 3;) {
          const index = context.artifactText.indexOf(location, from);
          if (index < 0) break;
          positions.push(context.artifactText.slice(0, index).split(/\r?\n/u).length);
          from = index + location.length;
        }
        errors.push(`${field} 在 ${context.filename} 当前版本定位不唯一（命中 ${count} 次，前几处行号 ${positions.join("、")}）；收到 ${received}，请选择逐字存在且唯一的片段`);
      } else if (conclusion && context.artifactText.includes(conclusion)) {
        const binding = anchorBindsConclusion(context.artifactText, location, conclusion);
        if (!binding.ok) errors.push(`${field} 在 ${context.filename} 中与 conclusion 范围不对应：${binding.reason}；请选指向该结论的唯一正文锚点`);
      }
    }
    if (conclusion && seenConclusions.has(`${conclusion}\u0000${location}`)) errors.push(`${at} 与本次提交中的其它关联重复`);
    if (conclusion) seenConclusions.add(`${conclusion}\u0000${location}`);
    if (value.kind !== undefined && !KIND_VALUES.includes(value.kind as never)) errors.push(`${at}.kind 只能是 ${KIND_VALUES.join("|")}`);
    const evidence: EvidenceLinkInput["evidence"] = [];
    if (!Array.isArray(value.evidence) || value.evidence.length === 0) errors.push(`${at}.evidence 至少一项；没有依据时不要登记该结论`);
    else value.evidence.forEach((item, itemIndex) => {
      const itemAt = `${at}.evidence[${itemIndex}]`;
      if (!record(item)) return void errors.push(`${itemAt} 不是对象`);
      for (const key of Object.keys(item)) if (!["source_id", "range", "use"].includes(key)) errors.push(`${itemAt} 含未知字段 ${key}`);
      const sourceId = clip(item.source_id, 40);
      const range = typeof item.range === "string" ? item.range.trim() : undefined;
      if (!sourceId) errors.push(`${itemAt}.source_id 必填`);
      else if (context.sources && !context.sources.has(sourceId)) errors.push(`${itemAt} 未知来源 ${sourceId}（只允许冻结输入清单中的编号）`);
      if (!range) errors.push(`${itemAt}.range 必填（片段/字段/行列定位）`);
      else if (parseRange(range).hasOwnProperty("error")) errors.push(`${itemAt}.${(parseRange(range) as { error: string }).error}`);
      if (range === "json:all" && (!record(value.numeric_spec) || value.numeric_spec.input !== sourceId)) errors.push(`${itemAt} json:all 仅用于 numeric_spec.input 绑定来源的完整JSON复算`);
      if (sourceId && range) evidence.push({ source_id: sourceId, range, ...(clip(item.use, 200) ? { use: clip(item.use, 200)! } : {}) });
    });
    let numericSpec: Record<string, string> | undefined;
    if (value.numeric_spec !== undefined) {
      if (!record(value.numeric_spec)) errors.push(`${at}.numeric_spec 必须是对象`);
      else {
        numericSpec = {};
        for (const [key, specValue] of Object.entries(value.numeric_spec)) {
          if (!NUMERIC_KEYS.includes(key as never)) errors.push(`${at}.numeric_spec.${key} 不是允许的口径字段`);
          else if (typeof specValue !== "string" || !specValue.trim()) errors.push(`${at}.numeric_spec.${key} 必须是非空文本`);
          else numericSpec[key] = specValue.trim().slice(0, 400);
        }
        if (!numericSpec.formula && !numericSpec.definition) errors.push(`${at}.numeric_spec 至少给公式或定义`);
        for (const ref of text(numericSpec.input).matchAll(/\bSRC-\d{3,6}\b/gu)) if (!evidence.some((item) => item.source_id === ref[0])) errors.push(`${at}.numeric_spec.input 引用了未关联的来源 ${ref[0]}`);
      }
    }
    if (ids?.length && conclusion && location && evidence.length && !errors.some((error) => error.startsWith(at))) links.push({ requirement_ids: ids, conclusion, location, ...(conclusionId ? { conclusion_id: conclusionId } : {}), ...(value.kind ? { kind: value.kind as NonNullable<EvidenceLinkInput["kind"]> } : {}), evidence, ...(numericSpec ? { numeric_spec: numericSpec } : {}), ...(Array.isArray(value.supersedes) ? { supersedes: value.supersedes as string[] } : {}), ...(clip(value.note, 300) ? { note: clip(value.note, 300)! } : {}) });
  });
  return { links, errors };
}
/** frozen_rating_stats.py 的 rating-counts-1 口径：严格数字1—5、排除缺失、不去重；不执行模型公式。 */
export function recomputeNumericSpec(spec: Record<string, string> | undefined, inputs: Array<{ readback: SourceReadback; content: string; usable: boolean }> = []): NumericCheck | undefined {
  if (!spec) return undefined;
  const unsupported = (reason: string): NumericCheck => ({ status: "unsupported", reason, checker_version: RATING_SPEC_VERSION, spec_sha256: sha256(stableJson(spec)) });
  const input = inputs.find(i => i.readback.source_id === spec.input);
  if (!input || inputs.filter(i => i.readback.source_id === spec.input).length !== 1 || !input.usable) return unsupported("输入必须唯一绑定已回读的候选来源 SRC 与记录范围");
  const countFormula = /^(?:rating_total|rating_valid|rating_invalid|rating_[1-5]_count)$/u.test(spec.formula ?? "");
  if ((!countFormula && !["rating_1_2_ratio", "rating_4_5_ratio"].includes(spec.formula ?? "")) || spec.filter !== "all_rows_no_dedup" || spec.missing_rule !== "exclude_invalid_rating" || spec.window !== "frozen_input") return unsupported("只支持冻结 JSON 评分统计的声明口径；其它公式/过滤/缺失/时间窗未实现");
  if (!(countFormula ? spec.unit === "records" && spec.rounding === "half_up:0" : ["ratio", "percent"].includes(spec.unit ?? "") && /^half_up:[0-6]$/u.test(spec.rounding ?? "")) || !spec.field) return unsupported("需明确比例 ratio/percent、half_up:0—6，或计数 records/half_up:0，以及评分字段");
  let stats: ReturnType<typeof ratingStatistics>;
  try { stats = ratingStatistics(input.content, spec.field); } catch (error) { return unsupported(`所选记录范围不是有效完整 JSON 数组：${String(error)}`); }
  const numerator = countFormula ? spec.formula === "rating_total" ? stats.total : spec.formula === "rating_valid" ? stats.valid : spec.formula === "rating_invalid" ? stats.invalid.length : stats.counts[Number(spec.formula![7]) - 1]! : spec.formula === "rating_1_2_ratio" ? stats.low : stats.high;
  const denominator = countFormula ? 1 : stats.valid;
  const counts = { rows: stats.total, numerator, denominator, missing_rows: stats.invalid.map(row => row.row) };
  const provenance = { checker_version: RATING_SPEC_VERSION, spec_sha256: sha256(stableJson(spec)), input: { source_id: input.readback.source_id, sha256: input.readback.sha256, range: input.readback.range, selected_sha256: sha256(input.content) }, counts, unit: spec.unit!, coverage: "仅所选冻结评分记录；不证明语义情绪、总体外推或任务合格" };
  if (!denominator) return { ...unsupported("有效评分分母为0，无法复算比例"), ...provenance };
  const computed = countFormula ? numerator : roundedRatingRatio(numerator, denominator, spec.unit, Number(spec.rounding!.split(":")[1]))!;
  const syntax = spec.unit === "percent" ? /^(?:0|[1-9]\d*)(?:\.\d+)?%$/u : /^(?:0|[1-9]\d*)(?:\.\d+)?$/u;
  if (!syntax.test(spec.result ?? "")) return { ...unsupported("结果单位不匹配：percent 必须带%，ratio 不得带%"), ...provenance };
  const countMatches = (claimed: string | undefined, actual: number) => claimed === undefined || (/^\d+$/u.test(claimed) && Number(claimed) === actual);
  const matched = Number(spec.result!.replace(/%$/u, "")) === computed && countMatches(spec.numerator, numerator) && countMatches(spec.denominator, denominator);
  return { status: "recomputed", formula: spec.formula!, computed, declared: spec.result!, matched, ...provenance };
}
export async function readSourceBytes(workspace: string, source: FrozenSourceRecord): Promise<{ ok: true; bytes: Buffer; relativePath: string } | { ok: false; reason: string }> {
  const relativePath = text(source.relative_path);
  if (!relativePath) return { ok: false, reason: `来源 ${source.source_id} 在清单中没有相对路径` };
  if (isAbsolute(relativePath) || relativePath.split(/[\\/]/u).includes("..")) return { ok: false, reason: `来源 ${source.source_id} 路径必须是工作区内的合法相对路径` };
  const root = resolve(workspace);
  const target = resolve(root, relativePath);
  if (target !== root && !target.startsWith(`${root}${sep}`)) return { ok: false, reason: `来源 ${source.source_id} 路径越过工作区：${relativePath}` };
  let cursor = root;
  for (const part of relative(root, target).split(sep)) {
    if (!part) continue;
    cursor = join(cursor, part);
    try {
      if ((await lstat(cursor)).isSymbolicLink()) return { ok: false, reason: `来源 ${source.source_id} 路径含符号链接，不能回读` };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ok: false, reason: `来源 ${source.source_id} 文件不存在：${relativePath}` };
      throw error;
    }
  }
  let bytes: Buffer;
  try {
    const handle = await open(cursor, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) return { ok: false, reason: `来源 ${source.source_id} 路径不是普通文件（目录/特殊文件不支持）` };
      if (stat.size > SOURCE_BYTE_LIMIT) return { ok: false, reason: `来源 ${source.source_id} 超出资源限制：最多${SOURCE_BYTE_LIMIT}字节（8 MiB）` };
      // 不用无限制readFile：stat之后文件增长也最多读取limit+1，用于明确拒收而非静默截断。
      const buffer = Buffer.alloc(SOURCE_BYTE_LIMIT + 1);
      let used = 0;
      while (used < buffer.length) {
        const { bytesRead } = await handle.read(buffer, used, buffer.length - used, null);
        if (!bytesRead) break;
        used += bytesRead;
      }
      if (used > SOURCE_BYTE_LIMIT) return { ok: false, reason: `来源 ${source.source_id} 超出资源限制：最多${SOURCE_BYTE_LIMIT}字节（8 MiB）` };
      bytes = buffer.subarray(0, used);
    } finally { await handle.close(); }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ok: false, reason: `来源 ${source.source_id} 文件不存在：${relativePath}` };
    if ((error as NodeJS.ErrnoException).code === "ELOOP") return { ok: false, reason: `来源 ${source.source_id} 路径含符号链接，不能回读` };
    throw error;
  }
  if (source.sha256 && sha256(bytes) !== source.sha256) return { ok: false, reason: `来源 ${source.source_id} 字节与清单哈希不符（清单 ${source.sha256.slice(0, 12)}…，实际 ${sha256(bytes).slice(0, 12)}…）` };
  return { ok: true, bytes, relativePath };
}
const sha256 = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
/**
 * R04：从清单取得合法路径与实际字节，核验定位并回读片段；保存来源身份、版本与读取依据。
 * R10：结论身份由程序分配/核验，跨任务、跨成果、未知与重复身份拒收。
 */
export async function verifyEvidenceLinks(input: {
  workspace: string;
  taskKey: string;
  filename: string;
  artifactSha256: string;
  links: readonly EvidenceLinkInput[];
  sources: Map<string, FrozenSourceRecord>;
  conclusions: readonly ConclusionRecord[];
}): Promise<{ verified: AcceptedEvidenceLink[]; errors: string[] }> {
  const errors: string[] = [];
  const verified: AcceptedEvidenceLink[] = [];
  const known = new Map(input.conclusions.map((entry) => [entry.conclusion_id, entry]));
  const claimed = new Set<string>();
  for (const [index, link] of input.links.entries()) {
    const at = `evidence_links[${index}]`;
    let conclusionId = link.conclusion_id;
    if (conclusionId) {
      const existing = known.get(conclusionId);
      if (!existing) errors.push(`${at} 未知结论身份 ${conclusionId}；新结论不要填写 conclusion_id`);
      else if (existing.artifact !== input.filename) errors.push(`${at} 结论身份 ${conclusionId} 属于 ${existing.artifact}，不能跨成果引用`);
      else if (claimed.has(conclusionId)) errors.push(`${at} 结论身份 ${conclusionId} 在本次提交中重复引用`);
      claimed.add(conclusionId);
    } // 新身份在权威提交锁内分配；不按文字近似复用，也不在 stage 占号。
    for (const superseded of link.supersedes ?? []) {
      const target = known.get(superseded);
      if (!target) errors.push(`${at}.supersedes 未知结论身份 ${superseded}`);
      else if (target.artifact !== input.filename) errors.push(`${at}.supersedes 结论身份 ${superseded} 属于 ${target.artifact}`);
    }
    const readback: SourceReadback[] = [];
    const numericInputs: Array<{ readback: SourceReadback; content: string; usable: boolean }> = [];
    const qualifications: AcceptedEvidenceLink["source_qualification"] = [];
    let usable = false;
    const reasons: string[] = [];
    for (const item of link.evidence) {
      const source = input.sources.get(item.source_id);
      if (!source) { errors.push(`${at} 未知来源 ${item.source_id}`); continue; }
      if (item.range === "json:all" && (link.numeric_spec?.input !== item.source_id || !/^[a-f0-9]{64}$/u.test(source.sha256 ?? ""))) {
        errors.push(`${at} json:all 需要 numeric_spec.input 与清单保存的来源哈希绑定`); continue;
      }
      const bytes = await readSourceBytes(input.workspace, source);
      if (!bytes.ok) { errors.push(`${at} ${bytes.reason}`); continue; }
      const content = bytes.bytes.toString("utf8");
      const parsedRange = parseRange(item.range);
      if ("error" in parsedRange) { errors.push(`${at} ${parsedRange.error}`); continue; }
      let snippet: string;
      let location: number[];
      if (parsedRange.kind === "json_all") {
        location = [];
        snippet = content; // 仅程序复算使用完整输入；持久回读预览仍最多2000字符。
      } else if (parsedRange.kind === "lines") {
        const lines = content.split(/\r?\n/u);
        if (parsedRange.end > lines.length || parsedRange.start > lines.length) {
          errors.push(`${at} 来源 ${item.source_id} 只有 ${lines.length} 行，引用第 ${parsedRange.start}-${parsedRange.end} 行越界`);
          continue;
        }
        location = [parsedRange.start, parsedRange.end];
        snippet = lines.slice(parsedRange.start - 1, parsedRange.end).join("\n");
      } else {
        const count = content.split(parsedRange.text).length - 1;
        if (count === 0) { errors.push(`${at} 来源 ${item.source_id} 未命中该精确片段（定位不成立）`); continue; }
        if (count > 1) { errors.push(`${at} 来源 ${item.source_id} 的精确片段命中 ${count} 次，不能确定引用范围`); continue; }
        location = [];
        snippet = parsedRange.text;
      }
      const check = sourceUsableAsEvidence(source, snippet);
      if (check.usable_as_evidence) usable = true;
      else reasons.push(`${item.source_id}：${check.reason}`);
      qualificationPush(qualifications, source);
      readback.push({
        source_id: item.source_id, task_key: input.taskKey, qualification_sha256: sha256(stableJson(source)), relative_path: bytes.relativePath, sha256: source.sha256 ?? sha256(bytes.bytes), range: item.range,
        ...(location.length ? { lines: [location[0]!, location[1]!] as [number, number] } : {}), snippet: snippet.slice(0, 2000), verified_at: new Date().toISOString(),
      });
      numericInputs.push({ readback: readback.at(-1)!, content: snippet, usable: check.usable_as_evidence });
    }
    const numericCheck = recomputeNumericSpec(link.numeric_spec, numericInputs);
    if (numericCheck?.status === "recomputed" && numericCheck.matched === false) {
      // 只在失败路径给诊断；不增加 numeric_check 字段或改变可持久化的身份/摘要。
      const spec = link.numeric_spec!;
      const observed = (value: string) => JSON.stringify(value.length > 80 ? `${value.slice(0, 80)}…` : value);
      const count = numericCheck.counts!;
      const differences: string[] = [];
      const expected = `${numericCheck.computed}${numericCheck.unit === "percent" ? "%" : ""}`;
      if (Number(numericCheck.declared!.replace(/%$/u, "")) !== numericCheck.computed)
        differences.push(`${at}.numeric_spec.result 收到 ${observed(spec.result!)}，期望 ${expected}（${spec.formula}，${spec.unit}；分子 ${count.numerator} / 分母 ${count.denominator}，${spec.rounding}）`);
      for (const field of ["numerator", "denominator"] as const) {
        const value = spec[field];
        const actual = count[field];
        if (value !== undefined && (!/^\d+$/u.test(value) || Number(value) !== actual))
          differences.push(`${at}.numeric_spec.${field} 收到 ${observed(value)}，期望 ${actual}（${spec.formula} ${spec.unit === "records" ? "计数规格" : "比例规格"}；${field === "denominator" && spec.unit === "records" ? "计数分母固定为 1" : `分子 ${count.numerator} / 分母 ${count.denominator}`}，须为非负整数字符串）`);
      }
      errors.push(...differences);
      continue;
    }
    if (readback.length !== link.evidence.length) continue;
    verified.push({
      ...link,
      conclusion_id: conclusionId ?? "",
      requested_conclusion_id: link.conclusion_id ?? null,
      link_id: "",
      artifact_sha256: input.artifactSha256,
      source_qualification: qualifications,
      source_readback: readback,
      conditional: { usable_as_evidence: usable, reason: usable ? "至少一项来源可作候选证据" : reasons.join("；") || "没有可用候选来源" },
      ...(numericCheck ? { numeric_check: numericCheck } : {}),
      matched_at: new Date().toISOString(),
    });
  }
  return { verified, errors };
}
function qualificationPush(list: AcceptedEvidenceLink["source_qualification"], source: FrozenSourceRecord) {
  list.push({ source_id: source.source_id, use_qualification: source.use_qualification ?? null, content_kind: source.content_kind ?? null });
}
function nextIdentity(prefix: string, existing: readonly string[]) {
  const max = existing.reduce((value, id) => Math.max(value, Number(id.replace(new RegExp(`^${prefix}-`, "u"), "")) || 0), 0);
  return `${prefix}-${String(max + 1).padStart(3, "0")}`;
}
/**
 * 派生索引：只从权威回执构造。稳定身份与编号在回执中已保存，重建不回写历史、不重新编号。
 */
export function buildEvidenceLinksFile(input: { taskKey: string; receipts: readonly ReceiptWithLinks[] }): EvidenceLinksFile {
  const receipts = input.receipts; // 权威历史→当前顺序；不按文件名或stage时间重排提交
  const artifacts = new Map<string, EvidenceLinksArtifact>();
  const conclusions = new Map<string, ConclusionRecord>();
  for (const receipt of receipts) {
    const prior = artifacts.get(receipt.filename);
    for (const change of receipt.evidence_continuity ?? []) {
      const entry = conclusions.get(change.conclusion_id);
      if (entry && change.state !== "continued") entry.inactive = { at: receipt.at, state: change.state, reason: change.reason };
    }
    const links: AcceptedEvidenceLink[] = [];
    for (const link of receipt.evidence_links ?? []) {
      // 历史缺失身份保留未知；投影绝不分配编号或修改权威输入。
      links.push(structuredClone(link));
      const existing = conclusions.get(link.conclusion_id);
      const at = link.matched_at;
      if (!existing) {
        conclusions.set(link.conclusion_id, {
          conclusion_id: link.conclusion_id, artifact: receipt.filename, first_conclusion: link.conclusion, first_location: link.location, created_at: at,
          current: { conclusion: link.conclusion, location: link.location, artifact_sha256: receipt.sha256, link_id: link.link_id, at },
          revisions: [{ at, conclusion: link.conclusion, location: link.location, artifact_sha256: receipt.sha256, link_id: link.link_id, ...(link.supersedes ? { supersedes: link.supersedes } : {}), ...(link.note ? { note: link.note } : {}) }],
          superseded_by: null, lineage: link.supersedes?.length ? [{ at, kind: "merge", ids: link.supersedes, ...(link.note ? { note: link.note } : {}) }] : [],
        });
      } else {
        delete existing.inactive;
        existing.current = { conclusion: link.conclusion, location: link.location, artifact_sha256: receipt.sha256, link_id: link.link_id, at };
        existing.revisions.push({ at, conclusion: link.conclusion, location: link.location, artifact_sha256: receipt.sha256, link_id: link.link_id, ...(link.supersedes ? { supersedes: link.supersedes } : {}), ...(link.note ? { note: link.note } : {}) });
        if (link.supersedes?.length) existing.lineage.push({ at, kind: "merge", ids: link.supersedes, ...(link.note ? { note: link.note } : {}) });
      }
      for (const superseded of link.supersedes ?? []) {
        const target = conclusions.get(superseded);
        if (!target) continue;
        target.superseded_by = link.conclusion_id;
        target.lineage.push({ at, kind: "withdraw", ids: [link.conclusion_id], ...(link.note ? { note: link.note } : {}) });
      }
    }
    const citation = new Map<string, { used_by: string[]; requirement_ids: Set<string>; use_qualification: string | null; content_kind: string | null }>();
    for (const link of links) for (const item of link.evidence) {
      const entry = citation.get(item.source_id) ?? { used_by: [], requirement_ids: new Set<string>(), use_qualification: link.source_qualification.find((s) => s.source_id === item.source_id)?.use_qualification ?? null, content_kind: link.source_qualification.find((s) => s.source_id === item.source_id)?.content_kind ?? null };
      entry.used_by.push(link.link_id);
      for (const id of link.requirement_ids) entry.requirement_ids.add(id);
      citation.set(item.source_id, entry);
    }
    const history = prior && prior.sha256 !== receipt.sha256
      ? [...prior.history, { sha256: prior.sha256, accepted_at: prior.accepted_at, link_ids: prior.links.map((link) => link.link_id), superseded_at: receipt.at, superseded_by_sha256: receipt.sha256 }]
      : prior?.history ?? [];
    artifacts.set(receipt.filename, {
      filename: receipt.filename, sha256: receipt.sha256, member: receipt.member, accepted_at: receipt.at, links,
      citation_index: [...citation].map(([source_id, entry]) => ({ source_id, used_by: entry.used_by, requirement_ids: [...entry.requirement_ids], use_qualification: entry.use_qualification, content_kind: entry.content_kind })),
      history,
    });
  }
  return {
    schema_version: EVIDENCE_LINKS_SCHEMA_VERSION, task_key: input.taskKey, updated_at: new Date().toISOString(),
    receipts_digest: receiptsDigest(receipts), artifacts: [...artifacts.values()], conclusions: [...conclusions.values()],
  };
}
/** R03：写派生索引使用唯一临时名，避免并发或毫秒级重名互相覆盖。 */
export async function writeEvidenceLinksIndex(workspace: string, taskKey: string, file: EvidenceLinksFile) {
  const path = linksPath(workspace, taskKey);
  await mkdir(dirname(path), { recursive: true });
  const staging = `${path}.staging-${process.pid}-${randomUUID()}`;
  const payload = YAML.stringify(file);
  try {
    await writeFile(staging, payload, { flag: "wx", mode: 0o444 });
    await rename(staging, path);
  } finally {
    await rm(staging, { force: true });
  }
  return { path, digest: sha256(payload) };
}
/**
 * 派生索引按回执摘要校验；缺失或过期时从回执重建。半完成状态不会被当作完整登记。
 */
export async function ensureEvidenceLinksIndex(workspace: string, taskKey: string, receipts: readonly ReceiptWithLinks[]) {
  const expected = buildEvidenceLinksFile({ taskKey, receipts });
  let current: EvidenceLinksFile | undefined;
  try { current = await readEvidenceLinks(workspace, taskKey); }
  catch { current = undefined; }
  if (current?.receipts_digest === expected.receipts_digest) return { file: current, rebuilt: false };
  await writeEvidenceLinksIndex(workspace, taskKey, expected);
  return { file: expected, rebuilt: true };
}
/** R03/R10：同一结论身份不能被两个成果或两条不同结论占用；冲突在写回执前拒收。 */
export function conclusionIdentityConflicts(receipts: readonly ReceiptWithLinks[]): string[] {
  const owners = new Map<string, { artifact: string; conclusion: string }>();
  const errors: string[] = [];
  for (const receipt of receipts) for (const link of receipt.evidence_links ?? []) {
    const prior = owners.get(link.conclusion_id);
    if (prior && (prior.artifact !== receipt.filename || prior.conclusion !== link.conclusion))
      errors.push(`结论身份 ${link.conclusion_id} 同时绑定 ${prior.artifact} 与 ${receipt.filename} 的不同结论，冲突未保存`);
    else owners.set(link.conclusion_id, { artifact: receipt.filename, conclusion: link.conclusion });
  }
  return errors;
}
/**
 * 6.4/7.4 依据索引：由已接受回执派生每项可用依据。虚拟的结论身份、旧版本哈希与线索来源不计入。
 */
export function acceptanceEvidence(baseline: AcceptanceBaseline, receipts: Record<string, ReceiptWithLinks> | undefined): EvidenceIndex {
  const rows: EvidenceIndex = {};
  const byRequirement = new Map<string, Array<{ link: AcceptedEvidenceLink; artifact: string }>>();
  for (const receipt of Object.values(receipts ?? {})) {
    for (const link of receipt.evidence_links ?? []) {
      if (link.artifact_sha256 !== receipt.sha256) continue;
      for (const id of link.requirement_ids) byRequirement.set(id, [...(byRequirement.get(id) ?? []), { link, artifact: receipt.filename }]);
    }
  }
  for (const item of baseline.items) {
    const entries = byRequirement.get(item.id) ?? [];
    const scoped = entries.filter((entry) => !item.files.length || item.files.includes(entry.artifact));
    const usable = scoped.filter((entry) => entry.link.conditional?.usable_as_evidence && entry.link.source_readback?.length === entry.link.evidence.length && entry.link.source_readback.every(source => source.task_key && source.qualification_sha256));
    const withNumbers = usable.filter((entry) => entry.link.numeric_check?.status === "recomputed" && entry.link.numeric_check.matched === true && !!entry.link.numeric_check.input?.sha256 && !!entry.link.numeric_check.spec_sha256);
    rows[item.id] = {
      available: [
        ...(usable.length ? (["source_link"] as EvidenceBasisKind[]) : []),
        ...(withNumbers.length ? (["numeric_recompute"] as EvidenceBasisKind[]) : []),
      ],
      links: usable.map((entry) => ({
        link_id: entry.link.link_id, conclusion_id: entry.link.conclusion_id,
        source_ids: entry.link.evidence.map((evidence) => evidence.source_id), location: entry.link.location,
      })),
      lead_only_links: scoped.filter((entry) => !entry.link.conditional?.usable_as_evidence).map((entry) => entry.link.link_id),
      bindings: [...new Set(scoped.map(entry => entry.artifact))].map(filename => ({ filename, receipt_digest: evidenceDigest(receipts?.[filename]?.evidence_links),
        sources: scoped.filter(entry => entry.artifact === filename).flatMap(entry => entry.link.source_readback.filter(source => source.task_key && source.qualification_sha256).map(source => ({ task_key: source.task_key!, source_id: source.source_id, relative_path: source.relative_path, sha256: source.sha256, qualification_sha256: source.qualification_sha256! }))) })), 
    };
  }
  return rows;
}
/** 读取时仅验证已接受快照的绑定，不从空回合发明撤回，也不升级历史证据。 */
export async function currentAcceptanceEvidence(workspace: string, saved: EvidenceIndex, receipts?: Record<string, ReceiptWithLinks>): Promise<EvidenceIndex> {
  const current = structuredClone(saved);
  const checked = new Map<string, Promise<boolean>>();
  for (const row of Object.values(current)) {
    // 旧PASS缺来源版本绑定时只能保留历史，不用当前磁盘回填当时已核验。
    if (row.available.some(kind => kind === "source_link" || kind === "numeric_recompute") && (!row.bindings?.length || row.bindings.some(binding => !binding.sources.length))) {
      row.available = row.available.filter(kind => kind !== "source_link" && kind !== "numeric_recompute"); row.links = [];
    }
    for (const binding of row.bindings ?? []) {
      let valid = !receipts?.[binding.filename] || evidenceDigest(receipts[binding.filename]!.evidence_links) === binding.receipt_digest;
      for (const source of binding.sources) {
        const key = stableJson(source);
        if (!checked.has(key)) checked.set(key, (async () => {
          const frozen = await readFrozenSources(workspace, source.task_key);
          if ("error" in frozen) return false;
          const record = frozen.sources.get(source.source_id);
          if (!record || sha256(stableJson(record)) !== source.qualification_sha256) return false;
          const read = await readSourceBytes(workspace, record);
          return read.ok && sha256(read.bytes) === source.sha256;
        })().catch(() => false));
        if (!await checked.get(key)) valid = false;
      }
      if (!valid) { row.available = []; row.links = []; break; }
    }
  }
  return current;
}
/** R01：必需项要求的依据类别缺失时，judge 的 met 不被接受；错误逐条给到提交者。 */
export function acceptanceGateErrors(
  baseline: AcceptanceBaseline,
  scope: readonly string[],
  acceptance: { items: Array<{ id: string; state: string }> } | undefined,
  evidence: EvidenceIndex,
  programCheck: (item: (typeof baseline.items)[number]) => boolean,
  facts: { requirement_record?: boolean } = {},
): string[] {
  const errors: string[] = [];
  if (!acceptance) return errors;
  for (const row of acceptance.items) {
    if (row.state !== "met") continue;
    const item = baseline.items.find((candidate) => candidate.id === row.id);
    if (!item || !scope.includes(row.id)) continue;
    const required = item.evidence_basis ?? [];
    const missing: string[] = [];
    for (const kind of required) {
      if (kind === "source_link" && !(evidence[item.id]?.available ?? []).includes("source_link")) missing.push("已核验的来源关联");
      if (kind === "numeric_recompute" && !(evidence[item.id]?.available ?? []).includes("numeric_recompute")) missing.push("程序复算凭证");
      if (kind === "requirement_record" && facts.requirement_record === false) missing.push("原始要求/有效决定记录");
      if (kind === "program_check" && !programCheck(item)) missing.push("当前版本文件/版本凭证");
    }
    if (missing.length) errors.push(`验收项 ${item.id} 判为 met，但当前版本缺少必需依据：${missing.join("、")}；请登记可核验依据、降为 unverifiable，或先补齐材料`);
  }
  return errors;
}
