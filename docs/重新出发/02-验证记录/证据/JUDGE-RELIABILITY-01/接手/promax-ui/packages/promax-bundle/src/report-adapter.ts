import type { JudgeReport } from "./judge-report.ts";
/** Explicit local→existing backend contract. Full acceptance data remains in the immutable local report.
 * No conversation, requirement snapshot or new fields cross the narrow Java whitelist.
 */
export function uploadedJudgeReport(report: JudgeReport) {
  return {
    reviewer: report.reviewer, round: report.round, verdict: report.verdict, scope: report.scope,
    reviewed_artifacts: report.reviewed_artifacts,
    issues: report.issues,
    ...(report.rechecks ? { rechecks: report.rechecks } : {}),
    unverified: report.unverified.map(({ item, reason, requirement_ids, impact }) => ({
      item, reason: `${reason}${impact ? `（本地验收影响：${impact}；关联：${requirement_ids?.join("、") || "一般限制"}）` : ""}`,
    })),
    decisions: report.decisions,
  };
}
