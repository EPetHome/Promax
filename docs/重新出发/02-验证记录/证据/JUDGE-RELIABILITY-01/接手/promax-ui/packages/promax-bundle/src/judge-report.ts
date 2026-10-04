import YAML from "yaml";
import type { AcceptanceResult, UnverifiedItem } from "../../promax-ui-console/src/effective-protocol.ts";
export interface JudgeIssue {
  id: string;
  severity: "high" | "medium" | "low";
  artifact: string;
  location: string;
  evidence: string;
  impact: string;
  owner_member_id?: string;
  kind?: "defect" | "suggestion" | "evidence_gap" | "business_choice";
  fix: string;
}
export interface JudgeReport {
  acceptance?: AcceptanceResult;
  reviewer: "quality_judge";
  round: number;
  verdict: "PASS" | "REVISION_REQUIRED" | "INCOMPLETE";
  scope: string;
  reviewed_artifacts: Array<{ filename: string; sha256: string }>;
  issues: JudgeIssue[];
  rechecks?: Array<{ id: string; state: "open" | "verified" | "unverifiable"; evidence: string }>;
  unverified: UnverifiedItem[];
  /** Business choices the Judge cannot decide; a PASS with open decisions is never shown as plain green. */
  decisions: Array<{
    id: string;
    question: string;
    options: string[];
    location: string;
    evidence: string;
    artifact?: string;
    decision_key?: string;
    node_id?: string;
    effect?: string;
    current_content?: string;
    timing?: "now" | "later";
    reopen_reason?: string;
  }>;
}
const record = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
/** PASS is bound to exact bytes, explicit scope and report round, never a prose claim. */
export function parseJudgeReport(
  text: string,
  expected?: { hashes: Record<string, string>; scope: string; round: number },
): { report?: JudgeReport; error?: string } {
  try {
    const header = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(text);
    if (!header) throw new Error("缺少 YAML 报告头");
    const doc = YAML.parseDocument(header[1]!, {
      uniqueKeys: true,
      strict: true,
    });
    if (doc.errors.length) throw new Error("YAML 格式错误");
    const v: unknown = doc.toJS({ maxAliasCount: 0 });
    // Models drift on field names and write full snapshot paths; normalize to leaf filenames, hashes stay strict.
    const leaf = (value: unknown) =>
      typeof value === "string" ? value.split("/").at(-1)! : value;
    // Only quality_judge may write this path during checking, so identity/round/list shape can be normalized safely.
    if (record(v)) {
      if (v.reviewer === undefined && v.judge !== undefined)
        v.reviewer = v.judge;
      if (typeof v.round === "string" && /^r?\d+$/iu.test(v.round.trim()))
        v.round = Number(v.round.trim().replace(/^r/iu, ""));
      if (v.unverified === undefined) v.unverified = [];
      if (v.decisions === undefined || v.decisions === null) v.decisions = [];
      if (
        v.issues === undefined &&
        v.verdict === "REVISION_REQUIRED" &&
        Array.isArray(v.reviewed_artifacts)
      )
        v.issues = v.reviewed_artifacts.map((a, index) => ({
          id: `BODY-${String(index + 1)}`,
          severity: "medium",
          artifact: record(a) ? (a.filename ?? a.path) : "",
          location: "见报告正文问题表",
          evidence: "见报告正文",
          impact: "见报告正文",
          owner_member_id: "",
          fix: "按报告正文问题表逐项局部修改",
        }));
      if (v.issues === undefined) v.issues = [];
    }
    if (record(v) && Array.isArray(v.reviewed_artifacts))
      for (const artifact of v.reviewed_artifacts)
        if (record(artifact))
          artifact.filename = leaf(
            artifact.filename ??
              artifact.path ??
              artifact.relative_path ??
              artifact.file,
          );
    if (record(v) && Array.isArray(v.issues))
      for (const issue of v.issues)
        if (record(issue) && typeof issue.artifact === "string")
          issue.artifact = leaf(issue.artifact);
    if (record(v) && Array.isArray(v.issues))
      for (const issue of v.issues)
        if (record(issue) && typeof issue.fix !== "string")
          for (const alias of [
            "required_fix",
            "fix_required",
            "suggested_fix",
            "修改要求",
          ])
            if (typeof issue[alias] === "string") {
              issue.fix = issue[alias];
              break;
            }
    if (
      !record(v) ||
      v.reviewer !== "quality_judge" ||
      !Number.isSafeInteger(v.round) ||
      Number(v.round) < 1 ||
      typeof v.verdict !== "string" ||
      !["PASS", "REVISION_REQUIRED", "INCOMPLETE"].includes(v.verdict) ||
      typeof v.scope !== "string" ||
      !v.scope.trim()
    )
      throw new Error("检查身份、结论或范围无效");
    if (
      !Array.isArray(v.reviewed_artifacts) ||
      !v.reviewed_artifacts.length ||
      !v.reviewed_artifacts.every(
        (a) =>
          record(a) &&
          typeof a.filename === "string" &&
          typeof a.sha256 === "string" &&
          /^[a-f0-9]{64}$/u.test(a.sha256),
      ) ||
      new Set(v.reviewed_artifacts.map((a) => a.filename)).size !==
        v.reviewed_artifacts.length
    )
      throw new Error("被审版本无效");
    if (
      !Array.isArray(v.issues) ||
      !v.issues.every(
        (i) =>
          record(i) &&
          typeof i.severity === "string" &&
          ["high", "medium", "low"].includes(i.severity) &&
          (i.owner_member_id === undefined || typeof i.owner_member_id === "string") &&
          ["id", "artifact", "location", "evidence", "impact", "fix"].every(
            (k) => typeof i[k] === "string" && i[k].trim(),
          ),
      )
    )
      throw new Error("问题表无效");
    if (
      !Array.isArray(v.unverified) ||
      !v.unverified.every(
        (i) =>
          record(i) &&
          typeof i.item === "string" &&
          !!i.item.trim() &&
          typeof i.reason === "string" &&
          !!i.reason.trim(),
      )
    )
      throw new Error("未验证项无效");
    if (
      !Array.isArray(v.decisions) ||
      !v.decisions.every(
        (d) =>
          record(d) &&
          typeof d.id === "string" &&
          !!d.id.trim() &&
          typeof d.question === "string" &&
          !!d.question.trim() &&
          (d.options === undefined ||
            (Array.isArray(d.options) &&
              d.options.every((o) => typeof o === "string"))),
      )
    )
      throw new Error("待决定事项无效");
    v.decisions = v.decisions.map((d) => ({
      id: d.id,
      question: d.question,
      options: Array.isArray(d.options) ? d.options.slice(0, 5) : [],
      location: typeof d.location === "string" ? d.location : "",
      evidence: typeof d.evidence === "string" ? d.evidence : "",
      ...(typeof d.artifact === "string"
        ? { artifact: leaf(d.artifact) as string }
        : {}),
      ...Object.fromEntries(
        [
          "decision_key",
          "node_id",
          "effect",
          "current_content",
          "reopen_reason",
        ]
          .filter((k) => typeof d[k] === "string")
          .map((k) => [k, d[k]]),
      ),
      ...(d.timing === "now" || d.timing === "later"
        ? { timing: d.timing }
        : {}),
    }));
    if (
      (v.verdict === "PASS" && v.issues.some((i) => i.kind !== "suggestion")) ||
      (v.verdict === "REVISION_REQUIRED" && !v.issues.length && !(Array.isArray(v.rechecks) && v.rechecks.some((r) => record(r) && r.state === "open" && typeof r.evidence === "string")))
    )
      throw new Error("结论与问题表不一致");
    // Binding is the program-computed hashes, round and requirements digest; the Judge's scope text is shown, not string-matched.
    if (
      expected &&
      (v.round !== expected.round ||
        v.reviewed_artifacts.length !== Object.keys(expected.hashes).length ||
        v.reviewed_artifacts.some(
          (a) => expected.hashes[a.filename] !== a.sha256,
        ))
    )
      throw new Error("检查不适用于当前版本、范围或轮次");
    // SAFETY: all required fields and array items have been checked above; additional YAML fields are not used.
    return { report: v as unknown as JudgeReport };
  } catch (e) {
    return {
      error: `无法完整检查：${e instanceof Error ? e.message : String(e)}`,
    };
  }
}
export function repairOwners(
  report: JudgeReport,
  registered: Record<string, string>,
  repairRound: number,
): string[] {
  if (report.verdict !== "REVISION_REQUIRED" || repairRound >= 2) return [];
  // An empty owner means the report named no member; the registered producer of that artifact owns it.
  const owner = (i: JudgeIssue) => i.owner_member_id || registered[i.artifact];
  if (
    report.issues.some((i) => !owner(i) || registered[i.artifact] !== owner(i))
  )
    return [];
  return [...new Set(report.issues.map(owner))] as string[];
}
/** Employee-facing summary of one check; "passed" is only returned when nothing is left open. */
export function checkOutcome(report: JudgeReport): {
  state: "passed" | "passed_with_open" | "revision" | "incomplete";
  label: string;
} {
  if (report.verdict === "REVISION_REQUIRED")
    return {
      state: "revision",
      label: `需返修（${report.issues.length} 个问题）`,
    };
  if (report.verdict === "INCOMPLETE")
    return { state: "incomplete", label: "无法完整检查" };
  const open = [
    report.issues.some((i) => i.kind === "suggestion") ? "有非阻断建议" : "",
    report.decisions.length ? `待你决定 ${report.decisions.length} 项` : "",
    report.unverified.length ? `未验证 ${report.unverified.length} 项` : "",
  ].filter(Boolean);
  return open.length
    ? {
        state: "passed_with_open",
        label: `检查通过（限定范围）· ${open.join(" · ")}`,
      }
    : { state: "passed", label: "检查通过（限定范围）" };
}
const BROWSER_TOOL =
  /^(?:promax_browser_evidence|agent[-_]?browser\w*|browser[-_]\w+|playwright\w*|puppeteer\w*|mcp__[\w-]*(?:browser|playwright|puppeteer|chrome)[\w-]*)$/iu;
const BROWSER_COMMAND =
  /(?:\bplaywright\b|\bpuppeteer\b|agent-browser|\bselenium\b|chromedriver|geckodriver|\b(?:google[- ]chrome|chromium(?:-browser)?|chrome|firefox|msedge)\b[^\n]*(?:--headless|--remote-debugging|https?:|file:)|\bchromium\b|open\s+-a\s+["']?(?:google chrome|safari|firefox))/iu;
/** Only real browser tools or shell commands are blocked; report/write text that mentions a browser is content, not an action. */
export function browserCommandReason(
  name: string,
  args: unknown,
): string | undefined {
  const reason =
    "浏览器能力不可用，已记为未验证；保留已有成果，不重试浏览器命令";
  if (BROWSER_TOOL.test(name)) return reason;
  if (name !== "bash" && name !== "shell") return undefined;
  const command =
    typeof args === "object" && args !== null
      ? String((args as Record<string, unknown>).command ?? "")
      : String(args ?? "");
  return BROWSER_COMMAND.test(command) ? reason : undefined;
}
