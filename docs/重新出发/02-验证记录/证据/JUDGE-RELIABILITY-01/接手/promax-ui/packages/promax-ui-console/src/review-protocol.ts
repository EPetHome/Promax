/** Local work-owned review history. Never inferred from conversational prose. */
export interface ReviewIssue {
  id: string;
  severity: "high" | "medium" | "low";
  artifact: string;
  location: string;
  evidence: string;
  impact: string;
  fix: string;
  owner_member_id?: string; // historical reports only; not dispatch authority
  kind?: "defect" | "suggestion" | "evidence_gap" | "business_choice";
}
export type IssueState = "open" | "changed" | "verified" | "unverifiable" | "accepted_risk";
export interface IssueRecheck {
  id: string;
  state: "open" | "verified" | "unverifiable";
  evidence: string;
}
export interface ReviewLedgerItem extends ReviewIssue {
  group: string;
  state: IssueState;
  first_hashes: Record<string, string>;
  latest_hashes: Record<string, string>;
  input_version?: number;
  history: Array<{ request: string; at: string; state: IssueState; evidence: string; hashes: Record<string, string>; report: string }>;
}
export interface ReviewBinding {
  group: string;
  files: string[];
  session_id?: string;
  /** R07：本次评审请求绑定的运行快照身份；旧记录无此字段。 */
  snapshot_id?: string;
  request?: { id: string; task_key: string; judge_round: number; hashes: Record<string, string>; state: "pending" | "accepted" | "cancelled" };
  reason?: string;
}
export interface ReviewState {
  schema_version: 1;
  bindings: Record<string, ReviewBinding>;
  issues: ReviewLedgerItem[];
  accepted: string[];
  reports?: Array<{ request: string; report: string; hashes: Record<string, string>; at: string; verdict: string; snapshot_id?: string }>;
}
export interface RepairPlan {
  judge_round: number;
  assignments: Array<{ member: string; files: string[]; issue_ids: string[]; instruction: string }>;
}
/** Identity is the work-local document set, not its changing bytes or a display title. */
export function reviewGroup(files: readonly string[]) {
  return JSON.stringify([...new Set(files)].sort());
}
export const emptyReviews = (): ReviewState => ({ schema_version: 1, bindings: {}, issues: [], accepted: [] });
export const unresolvedIssues = (state: ReviewState, group: string) => state.issues.filter((i) => i.group === group && i.state !== "verified");
