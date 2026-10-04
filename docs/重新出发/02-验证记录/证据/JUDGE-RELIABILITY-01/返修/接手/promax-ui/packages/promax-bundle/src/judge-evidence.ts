import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import type { WorkRound, CheckResultRecord } from "./work-store.ts";
import type { ReviewState, ReviewIssue, IssueRecheck, ReviewCitation } from "../../promax-ui-console/src/review-protocol.ts";

export const JUDGE_CONTRACT = "citations-resolution-v1";
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const own = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const safeFile = (s: unknown): s is string => typeof s === "string" && /^[^./\\\u0000-\u001f][^/\\\u0000-\u001f]*$/u.test(s) && s !== ".." && s.length <= 120;

/** The authorization snapshot is derived from the verified, actually selected TeamRevision bytes.
 * No model-provided version, global default or r-number inference promotes a legacy session. */
export async function frozenJudgeContract(round: WorkRound): Promise<boolean> {
  const frozen = round.runtime_snapshot?.fields.team_revision;
  if (!frozen?.judge_contract) return false;
  if (frozen.judge_contract !== JUDGE_CONTRACT || !frozen.preset_sha256 || !frozen.source) throw new Error("冻结Judge合同不受支持或缺少版本身份");
  const bytes = await readFile(frozen.source);
  if (hash(bytes) !== frozen.preset_sha256) throw new Error("冻结Judge合同的TeamRevision字节已变化");
  const revision = YAML.parse(bytes.toString("utf8"));
  if (revision?.metadata?.team_revision_id !== frozen.team_revision_id || revision?.spec?.judge_contract !== JUDGE_CONTRACT) throw new Error("冻结Judge合同与团队修订不一致");
  return true;
}

/** Re-run at stage and inside the authoritative commit lock. Mechanical evidence only: semantic inference remains Judge's job. */
export async function validateJudgeResult(workspace: string, key: string, round: WorkRound, record: CheckResultRecord, ledger: ReviewState, strict: boolean): Promise<string[]> {
  const errors: string[] = [];
  if (!strict) {
    for (const [i, issue] of record.issues.entries()) if (issue.basis !== undefined || issue.citations !== undefined || issue.requirement_ids !== undefined || issue.checked_artifacts !== undefined) errors.push(`issues[${i}] 旧合同不能提交新依据字段`);
    for (const [i, row] of (record.rechecks ?? []).entries()) if (row.resolution !== undefined || row.citations !== undefined) errors.push(`rechecks[${i}] 旧合同不能提交新关闭字段`);
    return errors.slice(0, 24);
  }
  const hashes = round.reviewed_hashes ?? {};
  const task = round.task_key;
  if (!task || !/^[A-Za-z0-9_-]{1,120}$/u.test(task)) return ["检查任务身份无效"];
  const bytes = new Map<string, string>();
  const readBound = async (file: string, digest: string, origin: boolean): Promise<string | undefined> => {
    const path = origin ? join(workspace, ".工作", key, "被审版本", digest) : join(workspace, ".任务", task, "产物快照", file);
    try {
      const segments = origin ? [".工作", key, "被审版本"] : [".任务", task, "产物快照"];
      let parent = workspace;
      for (const segment of segments) { parent = join(parent, segment); const info = await lstat(parent); if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("目录身份无效"); }
      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 8 * 1024 * 1024) throw new Error("不是有界普通文件");
      const content = await readFile(path);
      if (hash(content) !== digest) throw new Error("哈希不符");
      return new TextDecoder("utf-8", { fatal: true }).decode(content);
    } catch { errors.push(`${origin ? "问题原始" : "当前"}被审版本 ${file.slice(0, 120)} 缺失/哈希不符/无法安全读取`); return undefined; }
  };
  for (const [file, digest] of Object.entries(hashes)) {
    if (!safeFile(file) || !/^[a-f0-9]{64}$/u.test(digest)) { errors.push("被审文件名或哈希无效"); continue; }
    const content = await readBound(file, digest, false);
    if (content !== undefined) bytes.set(file, content);
  }
  const citation = async (c: ReviewCitation, at: string, expected: "current" | "issue_origin", originHashes?: Record<string, string>) => {
    if (!own(c) || Object.keys(c).some(k => !["file", "version", "line_start", "line_end", "quote"].includes(k)) ||
      !safeFile(c.file) || !(c.file in hashes) || c.version !== expected ||
      !Number.isSafeInteger(c.line_start) || !Number.isSafeInteger(c.line_end) || c.line_start < 1 || c.line_end < c.line_start || c.line_end - c.line_start > 19 ||
      typeof c.quote !== "string" || !c.quote.trim() || c.quote.length > 400 || c.quote !== c.quote.trim()) { errors.push(`${at} 字段/文件/版本/行范围/逐字片段无效（期望version=${expected}；最多400字符、20行）`); return; }
    const digest = expected === "current" ? hashes[c.file] : originHashes?.[c.file];
    if (!digest || !/^[a-f0-9]{64}$/u.test(digest)) { errors.push(`${at} 不属于绑定的${expected === "current" ? "当前" : "问题原始"}版本`); return; }
    const content = expected === "current" ? bytes.get(c.file) : await readBound(c.file, digest, true);
    if (content === undefined) return;
    // Preserve original newlines (including CRLF); a normalized rejoin is not a verbatim quote.
    const lines = content.match(/[^\n]*(?:\n|$)/gu)?.filter((line, index, all) => line.length > 0 || index < all.length - 1) ?? [];
    if (c.line_end > lines.length) { errors.push(`${at} 行范围超出被审版本`); return; }
    const section = lines.slice(c.line_start - 1, c.line_end).join("");
    if (section.split(c.quote).length !== 2) errors.push(`${at} 在指定行范围内必须逐字且唯一命中；请缩小行范围，不自动取首处`);
  };
  const validArray = (v: unknown, at: string): v is ReviewCitation[] => {
    if (!Array.isArray(v) || v.length > 4) { errors.push(`${at} 须为至多4处引用`); return false; }
    return true;
  };
  for (const [i, issue] of record.issues.entries()) {
    const at = `issues[${i}]`, v = issue as ReviewIssue;
    if (v.basis === "quoted") {
      if (!validArray(v.citations, `${at}.citations`) || !v.citations.length) errors.push(`${at}.citations 至少一处且属于被指责成果`);
      else { for (const [n, c] of v.citations.entries()) { if (!own(c) || c.file !== v.artifact) errors.push(`${at}.citations[${n}] 必须属于被指责成果`); await citation(c, `${at}.citations[${n}]`, "current"); } }
      if (v.requirement_ids !== undefined || v.checked_artifacts !== undefined) errors.push(`${at} 引用型指责不能冒充缺失类`);
    } else if (v.basis === "missing_required") {
      if (!Array.isArray(v.requirement_ids) || !v.requirement_ids.length || new Set(v.requirement_ids).size !== v.requirement_ids.length || !Array.isArray(v.checked_artifacts) || !v.checked_artifacts.length || !v.checked_artifacts.includes(v.artifact) || new Set(v.checked_artifacts).size !== v.checked_artifacts.length || (v.citations !== undefined && (!Array.isArray(v.citations) || v.citations.length))) errors.push(`${at} 缺失类需要无引文、有效requirement_ids及checked_artifacts`);
      const scope = new Set(round.acceptance_scope ?? []);
      const items = round.acceptance_baseline?.items ?? [];
      for (const id of Array.isArray(v.requirement_ids) ? v.requirement_ids : []) {
        const requirement = items.find(x => x.id === id);
        if (typeof id !== "string" || !scope.has(id) || !requirement?.required || !requirement.files.includes(v.artifact)) errors.push(`${at}.requirement_ids 不属于当前scope或被审成果`);
      }
      for (const file of Array.isArray(v.checked_artifacts) ? v.checked_artifacts : []) if (!safeFile(file) || !(file in hashes)) errors.push(`${at}.checked_artifacts 超出当前被审范围`);
      if (!round.acceptance_baseline) errors.push(`${at} 旧回合无冻结验收基准，不能申报必需项缺失`);
    } else errors.push(`${at}.basis 必须是 quoted 或 missing_required，不能通过更换kind豁免`);
    if (v.kind === "evidence_gap" && v.basis !== "missing_required") errors.push(`${at} evidence_gap 必须绑定必需项缺失；不能只换kind绕过依据`);
  }
  for (const [i, row] of (record.rechecks ?? []).entries()) {
    const at = `rechecks[${i}]`, v = row as IssueRecheck;
    const matches = ledger.issues.filter(item => item.group === round.review_group && item.id === v.id);
    if (matches.length !== 1) { errors.push(`${at}.id 不能唯一绑定本组原问题`); continue; }
    const item = matches[0]!;
    if (v.state !== "verified") {
      if (v.resolution !== undefined || (v.citations !== undefined && v.citations.length)) errors.push(`${at}.resolution 非关闭状态不得带关闭原因或引文`);
      continue;
    }
    if (!["fixed", "false_positive"].includes(v.resolution ?? "")) errors.push(`${at}.resolution verified必须明确fixed或false_positive`);
    const original = item.history.filter(h => h.state === "open");
    // A reused ID for a different claim is not a reliable identity. Preserve unverifiable instead.
    if (!original.length || original.some(h => h.evidence !== original[0]!.evidence || (original.length > 1 && (!h.claim_sha256 || h.claim_sha256 !== original[0]?.claim_sha256)))) errors.push(`${at}.id 原始指责身份冲突/缺失，保持unverifiable`);
    const originHashes = original[0]?.hashes;
    const originDigest = originHashes?.[item.artifact];
    if (!originDigest || !(await readBound(item.artifact, originDigest, true))) errors.push(`${at} 原始被审字节不可核对，保持unverifiable`);
    if (!validArray(v.citations, `${at}.citations`) || !v.citations.length || v.citations.some(c => !own(c) || c.file !== item.artifact)) errors.push(`${at}.citations 必须引用原问题所属成果`);
    else for (const [n, c] of v.citations.entries()) await citation(c, `${at}.citations[${n}]`, v.resolution === "false_positive" ? "issue_origin" : "current", originHashes);
    if (v.resolution === "false_positive" && (!originHashes || !item.first_hashes[item.artifact] || originHashes[item.artifact] !== item.first_hashes[item.artifact])) errors.push(`${at} 原问题提出时版本身份不一致，不能撤回`);
  }
  return errors.slice(0, 24);
}
