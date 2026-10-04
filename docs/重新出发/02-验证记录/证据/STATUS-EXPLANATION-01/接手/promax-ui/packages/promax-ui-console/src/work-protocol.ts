export interface WorkCondition {
  id: string;
  title: string;
  completion: string;
  kind: "decision" | "artifact" | "manual";
  filenames: string[];
  decision_key?: string;
  /** Unknown is not assumed to be non-blocking. */
  blocking?: boolean;
  evidence?: { at: string; digest: string; hashes: Record<string, string>; basis: string; report?: string; author: string };
}
export interface WorkFeedback {
  id: string;
  node_id?: string;
  condition_id?: string;
  artifact?: string;
  decision_id?: string;
  kind: "defect" | "requirement" | "disagreement";
  text: string;
  at: string;
  hashes: Record<string, string>;
  state: "pending" | "confirmed" | "disputed" | "resolved";
  reviews: Array<{ state: WorkFeedback["state"]; basis: string; at: string; author: string }>;
}
export const WORK_NODE_GATES = ["employee", "checked_artifacts", "accepted_artifacts"] as const;
export type WorkNodeGate = (typeof WORK_NODE_GATES)[number];
/** Shared with the model schema, parser and prompts; these are data rules, not dispatch authorization. */
export const WORK_NODE_RULE = `gate 必填且只能是 ${WORK_NODE_GATES.join(" | ")}；filenames 必须是团队登记成果文件名数组，checked_artifacts/accepted_artifacts 必须关联至少一份成果；不需要自定义阶段时省略 nodes`; 
export interface WorkNode {
  id: string;
  title: string;
  completion: string;
  filenames: string[];
  gate: WorkNodeGate;
  conditions?: WorkCondition[];
  depends_on?: string[];
  /** Program-owned completion evidence, never accepted from a model. */
  evidence?: { at: string; digest: string; hashes: Record<string, string> };
  needs_update?: boolean;
}
export function nodeDefinition({ evidence: _e, needs_update: _u, conditions, ...node }: WorkNode) {
  return { ...node, ...(conditions ? { conditions: conditions.map(({ evidence: _proof, ...condition }) => condition) } : {}) };
}
export interface WorkScopeMove {
  node_id: string;
  condition_id?: string;
  action: "merge" | "defer";
  target_node_id?: string;
  reason: string;
}
export interface WorkScopeHistory {
  id: string;
  at: string;
  author: string;
  decision: "accept" | "reject";
  reason: string;
  from_goal: string;
  to_goal: string;
  before_nodes: WorkNode[];
  after_nodes: WorkNode[];
  moves: WorkScopeMove[];
  unmet: string[];
  pending: PendingItem[];
  decisions: DecisionRecord[];
  feedback: WorkFeedback[];
  side_topics: NonNullable<WorkCard["side_topics"]>;
}
/** A closable reading page. Identity is the document version, so reopening reuses the page. */
export interface DocPage {
  id: string;
  kind: "artifact" | "brief" | "check";
  filename?: string;
  /** Pinned historical version; absent means the current version. */
  sha256?: string;
  highlight?: string;
}
/** An action panel inserted into the conversation. Its binding decides whether it is still actionable. */
export interface ChatItem {
  id: string;
  kind: "question" | "acceptance" | "condition" | "feedback" | "change";
  opened_at: string;
  question_id?: string;
  filename?: string;
  /** The document version the panel was opened for; a newer current version makes the panel stale. */
  sha256?: string;
  base_sha256?: string;
  node_id?: string;
  condition_id?: string;
  decision_id?: string;
  location?: string;
  /** Program record created by the submission (feedback id). */
  result_id?: string;
}
export interface WorkNavigation {
  mode: "overview" | "node" | "question";
  node_id?: string;
  question_id?: string;
  filename?: string;
  highlight?: string;
  focus?: boolean;
  returned_at?: string;
  /** Presentation only; never advances a node or starts a round. */
  workspace_view?: "spine" | "artifact" | "document";
  expanded_node_ids?: string[];
  tree_scroll?: number;
  /** Legacy item tabs; kept readable, no longer opened. */
  opened_question_ids?: string[];
  /** Browsing highlight is independent from the collaboration focus and real progress. */
  located_node_id?: string;
  doc_pages?: DocPage[];
  active_doc?: string;
  chat_items?: ChatItem[];
}
/** Controlled panel content supplied by the agent; the page renders it with fixed components. */
export type PanelField = {
  id: string;
  label: string;
  input: "text" | "number" | "choice";
  options?: string[];
  unit?: string;
  suggested?: string;
  required?: boolean;
};
export type PanelEntry = { id: string; text: string; source?: string; suggested_group?: string };
export type QuestionPanel =
  | { type: "fields"; fields: PanelField[] }
  | { type: "merge"; entries: PanelEntry[] }
  | { type: "order"; entries: PanelEntry[] };
export interface PendingItem {
  /** Stable business identity. Only merge when location/options are compatible. */
  decision_key?: string;
  node_id?: string;
  artifact?: string;
  location?: string;
  current_content?: string;
  effect?: string;
  timing?: "now" | "later";
  reopen_reason?: string;
  reviewed_sha256?: string;
  sources?: Array<{
    source: "ai" | "check";
    basis: string;
    reference?: string;
  }>;
  id: string;
  question: string;
  options?: string[];
  basis?: string;
  /** "check" items come from an independent check report, never from the coordinator's own opinion. */
  source?: "ai" | "check";
  panel?: QuestionPanel;
  /** 需求澄清 / 材料补充 / 方案取舍 / 成果修改; derived for legacy items. */
  kind?: "clarify" | "material" | "tradeoff" | "revision";
  /** Member id, "coordinator" or "check". */
  raised_by?: string;
  /** Program-owned times; the same question updates the original record. */
  first_at?: string;
  updated_at?: string;
  /** Whether the next step waits for this answer. Unknown is shown as unknown, never assumed. */
  blocking?: boolean;
  urgent?: boolean;
}
/** One employee input as received by the program. Its state is program-owned; the model only proposes meaning. */
export interface WorkEvent {
  id: string;
  seq: number;
  at: string;
  channel: "chat" | "question" | "button" | "stop";
  text: string;
  paths?: string[];
  question_id?: string;
  suggestion?: string;
  /** Explicit option chosen with a button; no model interpretation needed. */
  choice?: string;
  priority: "high" | "normal";
  state: "received" | "clarifying" | "pending_apply" | "applied" | "answered" | "failed";
  intent?: "question" | "supplement" | "decision" | "correction" | "new_task" | "control";
  /** Running task at receipt; settlement of that task must not swallow it. */
  task_key?: string;
  input_version: number;
  note?: string;
  affects?: string[];
  handled_at?: string;
  /** Times the coordinator was asked to understand this input. */
  attempts?: number;
}
/** The coordinator's structured understanding of one received input. */
export interface HandledEvent {
  event_id: string;
  intent: NonNullable<WorkEvent["intent"]>;
  impact: "high" | "normal";
  question_id?: string;
  answer?: string;
  suggestion?: string;
  affects?: string[];
  clarify?: string;
  revokes?: { decision_ids?: string[]; suggestions?: string[] };
  note: string;
}
export interface WorkTurn {
  /** Optional local review selection; never removes requirements from the full baseline. */
  review_requirement_ids?: string[];
  intent: "answer" | "guide" | "execute" | "edit";
  card_patch: {
    title?: string;
    goal?: string;
    pending?: PendingItem[];
    suggestions?: Array<{ text: string; basis: string }>;
    employee_said?: Array<{ text: string; quote: string }>;
    nodes?: WorkNode[];
    scope_change_reason?: string;
    scope_moves?: WorkScopeMove[];
    side_topic?: { text: string; reason: string };
  };
  deliverables: string[];
  edit_request: null | {
    filename: string;
    base_sha256: string;
    anchor: { type: "heading" | "quote" | "page"; value: string };
    instruction: string;
  };
  /** Structured submissions only; legacy text blocks never classify inputs. */
  handled_events?: HandledEvent[];
}
/** What happened after the employee answered a decision; the answer alone is not the end of it. */
export type DecisionState =
  | "processing"
  | "awaiting_start"
  | "running"
  | "updated"
  | "checking"
  | "applied"
  | "partial"
  | "no_change"
  | "failed"
  /** Effective requirement; the coordinator concluded no artifact needs to change. */
  | "recorded"
  /** Kept as history only; a later decision or explicit withdrawal replaced it. */
  | "superseded"
  | "withdrawn";
export interface DecisionRecord extends PendingItem {
  answer: string;
  answered_at: string;
  state: DecisionState;
  note?: string;
  task_key?: string;
  base_sha256?: string;
  applied_sha256?: string;
  source_event?: string;
  superseded_by?: string;
  closed_at?: string;
  /** Saved outputs the coordinator found affected; each must publish a new version before "applied". */
  affects?: string[];
}
export const INACTIVE_DECISION: ReadonlySet<DecisionState> = new Set(["superseded", "withdrawn"]);
export interface ConfirmedItem {
  text: string;
  confirmed_at: string;
  /** message: verified against the employee's own words; form/decision: entered by the employee in the page. */
  source?: "message" | "form" | "decision";
  quote?: string;
}
export interface WorkSuggestion {
  text: string;
  basis: string;
  /** Missing state is a legacy unaccepted suggestion, never consensus. */
  state?: "proposed" | "accepted" | "rejected" | "adjusted" | "superseded";
  history?: Array<{ at: string; reply: string; state: "accepted" | "rejected" | "adjusted" | "superseded" }>;
}
export interface WorkCard {
  schema_version: 1;
  /** Program delivery projections; append-only, not submission success authority. */
  delivery_receipts?: import("./delivery-protocol.ts").DeliveryReceipt[];
  /** Local-only effective-requirements protocol. Absent means historical, not retrospectively verified. */
  requirements_protocol?: 1;
  requirement_policy?: import("./effective-protocol.ts").RequirementPolicy;
  interpretations?: Array<{ text: string; quote: string }>;
  acceptance_baseline?: import("./effective-protocol.ts").AcceptanceBaseline;
  acceptance_history?: import("./effective-protocol.ts").AcceptanceBaseline[];
  work_key: string;
  session_id: string;
  project_id: string;
  title: string;
  goal: string;
  /** The employee's first request; later messages are increments and never overwrite it. Local only. */
  origin?: { text: string; at: string; paths: string[] };
  /** Program-owned: bumps whenever the effective requirements change. */
  requirement_version?: number;
  requirement_digest?: string;
  /** Local-only input ledger (employee text is not uploaded). */
  events?: WorkEvent[];
  materials: Array<{
    /** Compatibility fields always identify original bytes, never a converted copy. */
    path: string; sha256: string; summary: string;
    source_id?: string; readable_path?: string; readable_sha256?: string;
    format?: string; parse_status?: "ready" | "failed"; limitation?: string; error?: string;
    reads?: Array<{ member: string; session_id: string; call_id: string; at: string; offset?: number; limit?: number }>;
  }>;
  confirmed: ConfirmedItem[];
  pending: PendingItem[];
  /** Answered decisions and their follow-up, newest last. */
  decisions?: DecisionRecord[];
  feedback?: WorkFeedback[];
  during_run?: Array<{ id: string; text: string; paths: string[]; at: string; task_key: string; node_id?: string; question_id?: string }>;
  acceptances?: Array<{ filename: string; sha256: string; digest: string; at: string; author: string; condition_ids: string[] }>;
  suggestions?: WorkSuggestion[];
  deliverables: Array<{
    filename: string;
    member_id: string;
    current_sha256: string | null;
    /** Readable task draft, independent of published versions and acceptance. */
    draft?: { task_key: string; path: string; sha256: string; readable_at: string; first_readable_at: string; actionable_at?: string; actionable_client_at?: string };
    status: string;
  }>;
  last_progress: string;
  updated_at: string;
  spine?: { nodes: WorkNode[] };
  scope_proposal?: {
    goal: string;
    nodes?: WorkNode[];
    reason: string;
    deliverables?: WorkCard["deliverables"];
    moves?: WorkScopeMove[];
  };
  /** Program-owned, append-only snapshots; scope exclusion is never completion. */
  scope_history?: WorkScopeHistory[];
  navigation?: WorkNavigation;
  /** Unsubmitted text; never enters confirmed or the execution brief. */
  drafts?: Record<string, string>;
  side_topics?: Array<{
    id: string;
    text: string;
    reason: string;
    node_id?: string;
    deferred: boolean;
    continued?: boolean;
  }>;
}
export interface WorkContract {
  artifacts: Array<{ relativePath: string; producedBy: string }>;
}
const object = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const clip = (v: unknown, max: number): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined;
export function workMembers(
  filenames: readonly string[],
  contract: WorkContract,
): string[] {
  return [
    ...new Set(
      filenames.map((filename) => {
        const matches = contract.artifacts.filter(
          (a) =>
            a.relativePath.split("/").at(-1) === filename &&
            a.producedBy !== "quality_judge",
        );
        if (matches.length !== 1)
          throw new Error(`成果不属于团队合同：${filename}`);
        return matches[0]!.producedBy;
      }),
    ),
  ];
}
/** Program-owned digest of what the employee asked for; a check only stays current while this is unchanged. */
export function requirementsDigest(card: Pick<WorkCard, "goal" | "confirmed"> & Partial<Pick<WorkCard, "spine" | "feedback" | "during_run" | "suggestions" | "materials" | "requirements_protocol" | "origin" | "events" | "decisions" | "requirement_policy" | "deliverables">>) {
  const parts: unknown[] = [card.goal.trim(), card.confirmed.map((c) => (card.requirements_protocol === 1 && c.source === "message" ? c.quote ?? "" : c.text).trim()).sort()];
  if (card.requirements_protocol === 1) parts.push({
    protocol: 1, origin: card.origin,
    inputs: card.events?.filter((e) => ["supplement", "correction"].includes(e.intent ?? "") && ["applied", "pending_apply"].includes(e.state)).map((e) => [e.id, e.text]),
    decisions: card.decisions?.filter((d) => !INACTIVE_DECISION.has(d.state)).map((d) => [d.id, d.question, d.answer, d.source_event]),
    policy: card.requirement_policy,
    files: card.deliverables?.map((d) => d.filename).sort(),
  });
  if (card.materials?.length) parts.push({ materials: card.materials.map((m) => [m.path, m.sha256, m.readable_sha256 ?? ""]) });
  const accepted = card.suggestions?.filter((s) => s.state === "accepted").map((s) => s.text).sort();
  if (accepted?.length) parts.push({ accepted_suggestions: accepted });
  // Keep legacy digests stable until explicit conditions/feedback are introduced.
  if (card.spine?.nodes.some((n) => n.conditions?.length || n.depends_on?.length))
    parts.push(card.spine.nodes.map((n) => ({ id: n.id, completion: n.completion, depends_on: n.depends_on ?? [], conditions: n.conditions?.map(({ evidence: _e, ...condition }) => condition) ?? [] })));
  if (card.during_run?.length) parts.push(card.during_run.map(({ id }) => id));
  if (card.feedback?.length)
    parts.push(card.feedback.map(({ id, kind, text, node_id, artifact, condition_id, decision_id }) => ({ id, kind, text, node_id, artifact, condition_id, decision_id })));
  return JSON.stringify(parts);
}
const squash = (v: string) => v.replace(/\s+/gu, "");
/** Messages the page sends on the employee's behalf after a decision; they are not new wording to quote. */
export const DECISION_MESSAGE_PREFIX = "我的决定：";
export const withoutRecommendation = (v: string) =>
  v.replace(/\s*[（(]推荐[）)]\s*$/u, "").trim();
const questionKey = (v: string) =>
  withoutRecommendation(v)
    .replace(/[\p{P}\p{S}\s]+/gu, "")
    .toLowerCase();
/** Same business question asked twice (e.g. by the coordinator and by the check report). */
export function sameQuestion(a: string, b: string) {
  const x = questionKey(a),
    y = questionKey(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  if (short.length >= 6 && long.includes(short)) return true;
  const grams = (v: string) =>
    new Set(
      [...Array(Math.max(v.length - 1, 0)).keys()].map((i) =>
        v.slice(i, i + 2),
      ),
    );
  const gx = grams(x),
    gy = grams(y);
  const shared = [...gx].filter((g) => gy.has(g)).length;
  return (2 * shared) / Math.max(gx.size + gy.size, 1) >= 0.75;
}
/** Questions the employee already answered in the page. */
export function answeredQuestions(card: Pick<WorkCard, "confirmed">) {
  return card.confirmed
    .filter((c) => c.source === "decision")
    .map((c) => c.text.split(" → ")[0] ?? c.text);
}
export const decisionText = (d: Pick<DecisionRecord, "question" | "answer">) =>
  `${d.question} → ${d.answer}`;
/** Keeps only statements whose quote really occurs in the employee's own messages. */
export function verifiedEmployeeStatements(
  said: WorkTurn["card_patch"]["employee_said"],
  employeeMessages: readonly string[],
): ConfirmedItem[] {
  const corpus = employeeMessages.filter((m) => !m.trim().startsWith(DECISION_MESSAGE_PREFIX));
  const now = new Date().toISOString();
  return (said ?? [])
    .filter((s) => {
      const quote = squash(s.quote);
      const vague = /^(?:(?:这个|这条|该)建议)?(?:可以|好|好的|同意|认可|接受|采纳|不用|不要|不做|不同意)[。！!，,\s]*$/u.test(s.quote.trim());
      return !vague && quote.length >= 2 && corpus.some((m) => m.includes(s.quote));
    })
    .map((s) => ({
      text: corpus.find((m) => m.includes(s.quote))!,
      quote: corpus.find((m) => m.includes(s.quote))!,
      source: "message" as const,
      confirmed_at: now,
    }));
}
/** A malformed panel is dropped; the question stays answerable in plain text. */
export function parseQuestionPanel(value: unknown): QuestionPanel | undefined {
  if (!object(value)) return undefined;
  const ids = (items: Array<{ id: string }>) =>
    new Set(items.map((i) => i.id)).size === items.length;
  if (value.type === "fields") {
    if (!Array.isArray(value.fields) || !value.fields.length || value.fields.length > 12) return undefined;
    const fields: PanelField[] = [];
    for (const raw of value.fields) {
      if (!object(raw)) return undefined;
      const id = clip(raw.id, 60), label = clip(raw.label, 40);
      if (!id || !/^[\w-]+$/u.test(id) || !label || !["text", "number", "choice"].includes(String(raw.input))) return undefined;
      const options = Array.isArray(raw.options) ? raw.options.map((o) => clip(o, 80)).filter((o): o is string => !!o).slice(0, 8) : [];
      if (raw.input === "choice" && options.length < 2) return undefined;
      const unit = clip(raw.unit, 12), suggested = clip(raw.suggested, 200);
      fields.push({ id, label, input: raw.input as PanelField["input"], ...(options.length ? { options } : {}), ...(unit ? { unit } : {}), ...(suggested ? { suggested } : {}), ...(raw.required === true ? { required: true } : {}) });
    }
    return ids(fields) ? { type: "fields", fields } : undefined;
  }
  if (value.type === "merge" || value.type === "order") {
    if (!Array.isArray(value.entries) || value.entries.length < 2 || value.entries.length > 20) return undefined;
    const entries: PanelEntry[] = [];
    for (const raw of value.entries) {
      if (!object(raw)) return undefined;
      const id = clip(raw.id, 40), text = clip(raw.text, 400);
      if (!id || !/^[\w-]+$/u.test(id) || !text) return undefined;
      const source = clip(raw.source, 120), group = clip(raw.suggested_group, 40);
      entries.push({ id, text, ...(source ? { source } : {}), ...(group && value.type === "merge" ? { suggested_group: group } : {}) });
    }
    return ids(entries) ? { type: value.type, entries } : undefined;
  }
  return undefined;
}
function pendingList(value: unknown): PendingItem[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items: PendingItem[] = [];
  for (const p of value.slice(0, 8)) {
    if (!object(p)) return undefined;
    const id = clip(p.id, 60),
      question = clip(p.question, 500);
    if (!id || !question) return undefined;
    const options = Array.isArray(p.options)
      ? p.options
          .map((o) => clip(o, 120))
          .filter((o): o is string => !!o)
          .slice(0, 5)
      : [];
    const basis = clip(p.basis, 1000);
    const linked: Partial<PendingItem> = {};
    for (const field of [
      "decision_key",
      "node_id",
      "artifact",
      "location",
      "current_content",
      "effect",
      "reopen_reason",
      "reviewed_sha256",
    ] as const) {
      const value = clip(p[field], 1000);
      if (value) linked[field] = value;
    }
    if (p.timing === "now" || p.timing === "later") linked.timing = p.timing;
    const panel = parseQuestionPanel(p.panel);
    items.push({
      ...linked,
      id,
      question,
      ...(options.length ? { options } : {}),
      ...(basis ? { basis } : {}),
      ...(panel ? { panel } : {}),
      source: "ai",
    });
  }
  return items;
}
const nodeActual = (value: unknown, present = true) => !present || value === undefined
  ? "缺失" : `${value === null ? "null" : Array.isArray(value) ? "array" : typeof value} ${JSON.stringify(value)?.slice(0, 160) ?? String(value)}`;
function parseWorkNode(raw: unknown, contract: WorkContract, index: number): WorkNode | string | string[] {
  const at = `card_patch.nodes[${index}]`;
  if (!object(raw)) return [`${at} 实际 ${nodeActual(raw)}；期望节点对象`];
  const errors: string[] = [];
  const id = clip(raw.id, 60), title = clip(raw.title, 40), completion = clip(raw.completion, 500);
  if (!id || !/^[\w-]+$/u.test(id)) errors.push(`${at}.id 实际 ${nodeActual(raw.id, "id" in raw)}；期望 1–60 字符的字母/数字/下划线/连字符`);
  if (!title) errors.push(`${at}.title 实际 ${nodeActual(raw.title, "title" in raw)}；期望非空文字（最多 40 字）`);
  if (!completion) errors.push(`${at}.completion 实际 ${nodeActual(raw.completion, "completion" in raw)}；期望非空文字（最多 500 字）`);
  if (title && /(?:Agent|Judge|M[1-4]|quality_judge|solution_design|工具调用)/iu.test(title))
    errors.push(`${at}.title 使用了内部成员、工具或建设阶段名称`);
  const files = Array.isArray(raw.filenames) ? raw.filenames : undefined;
  const filenamesValid = files?.every((f) => typeof f === "string") === true;
  if (!filenamesValid) errors.push(`${at}.filenames 实际 ${nodeActual(raw.filenames, "filenames" in raw)}；期望团队登记成果文件名数组（无关联可传 []）`);
  else for (const [fileIndex, filename] of files!.entries()) {
    try { workMembers([filename], contract); }
    catch (e) { errors.push(`${at}.filenames[${fileIndex}] 实际 ${nodeActual(filename)}；${e instanceof Error ? e.message : String(e)}；期望团队登记成果文件名`); }
  }
  const gateValid = WORK_NODE_GATES.some((gate) => gate === raw.gate);
  if (!gateValid) errors.push(`${at}.gate 实际 ${nodeActual(raw.gate, "gate" in raw)}；期望 ${WORK_NODE_GATES.join(" | ")}（例：{\"gate\":\"employee\",\"filenames\":[]}）；先修正 gate，才能判断它与 filenames 的关联约束`);
  if (gateValid && filenamesValid && raw.gate !== "employee" && files!.length === 0)
    errors.push(`${at}.filenames 实际 []；gate=${raw.gate} 必须关联至少一份团队登记成果；无成果阶段使用 gate=employee，或省略 nodes`);
  if (errors.length) return errors;
  let conditions: WorkCondition[] | undefined;
  if (raw.conditions !== undefined) {
    if (!Array.isArray(raw.conditions) || !raw.conditions.length || raw.conditions.length > 30) return `${at}（${id}）conditions 无效`;
    conditions = [];
    for (const c of raw.conditions) {
      if (!object(c)) return `${at}（${id}）条件不是对象`;
      const cid = clip(c.id, 60), label = clip(c.title, 80), criterion = clip(c.completion, 500);
      if (!cid || !/^[\w-]+$/u.test(cid) || !label || !criterion || !["decision", "artifact", "manual"].includes(String(c.kind))) return `${at}（${id}）条件缺少 id/title/completion/kind`;
      const filenames = c.filenames ?? [];
      if (!Array.isArray(filenames) || !filenames.every((f) => typeof f === "string" && raw.filenames instanceof Array && raw.filenames.includes(f))) return `${at}（${id}）条件成果不属于节点`;
      if (c.kind === "artifact" && !filenames.length) return `${at}（${id}）成果条件缺少成果`;
      const decision_key = clip(c.decision_key, 60);
      if (c.kind === "decision" && !decision_key) return `${at}（${id}）决定条件缺少 decision_key`;
      if (c.blocking !== undefined && typeof c.blocking !== "boolean") return `${at}（${id}）条件 blocking 无效`;
      conditions.push({ id: cid, title: label, completion: criterion, kind: c.kind as WorkCondition["kind"], filenames: [...new Set(filenames as string[])], ...(decision_key ? { decision_key } : {}), ...(typeof c.blocking === "boolean" ? { blocking: c.blocking } : {}) });
    }
    if (new Set(conditions.map((c) => c.id)).size !== conditions.length) return `${at}（${id}）条件 id 重复`;
  }
  const dependencies = raw.depends_on;
  if (dependencies !== undefined && (!Array.isArray(dependencies) || !dependencies.every((d) => typeof d === "string" && d !== id))) return `${at}（${id}）depends_on 无效`;
  return {
    id: id!,
    title: title!,
    completion: completion!,
    filenames: [...new Set(raw.filenames as string[])],
    gate: raw.gate as WorkNode["gate"],
    ...(conditions ? { conditions } : {}),
    ...(dependencies ? { depends_on: [...new Set(dependencies as string[])] } : {}),
  };
}
/** Strict: scope plans must not silently lose a node. */
export function parseWorkNodes(
  value: unknown,
  contract: WorkContract,
): WorkNode[] | undefined {
  const result = parseWorkNodesDetailed(value, contract);
  return result.errors.length || !result.nodes.length ? undefined : result.nodes;
}
/** Keeps every legal node and names each rejected one; a single bad node never collapses the trunk. */
export function parseWorkNodesDetailed(
  value: unknown,
  contract: WorkContract,
): { nodes: WorkNode[]; errors: string[] } {
  if (value === undefined) return { nodes: [], errors: [] };
  if (!Array.isArray(value) || !value.length || value.length > 12)
    return { nodes: [], errors: [`card_patch.nodes 实际 ${nodeActual(value)}；提供时必须是 1–12 个节点的数组；不需要时请省略 nodes`] };
  const errors: string[] = [];
  let nodes: WorkNode[] = [];
  value.forEach((raw, index) => {
    const node = parseWorkNode(raw, contract, index);
    if (Array.isArray(node)) errors.push(...node);
    else if (typeof node === "string") errors.push(node);
    else if (nodes.some((n) => n.id === node.id)) errors.push(`主干节点 id 重复：${node.id}`);
    else nodes.push(node);
  });
  for (let changed = true; changed; ) {
    changed = false;
    const ids = new Set(nodes.map((n) => n.id));
    const visit = (id: string, path: Set<string>): boolean => !path.has(id) && (nodes.find((n) => n.id === id)?.depends_on ?? []).every((d) => visit(d, new Set([...path, id])));
    const kept = nodes.filter((n) => {
      const missing = n.depends_on?.filter((d) => !ids.has(d)) ?? [];
      if (missing.length) errors.push(`主干节点 ${n.id} 依赖不存在的节点：${missing.join("、")}`);
      else if (!visit(n.id, new Set())) errors.push(`主干节点 ${n.id} 的依赖成环`);
      else return true;
      return false;
    });
    changed = kept.length !== nodes.length;
    nodes = kept;
  }
  return { nodes, errors };
}
export function parseScopeMoves(value: unknown): WorkScopeMove[] {
  if (!Array.isArray(value) || value.length > 372) throw new Error("范围去向列表无效");
  return value.map((v) => {
    if (!object(v) || !["merge", "defer"].includes(String(v.action)) || typeof v.reason !== "string" || !v.reason.trim() || v.reason.length > 1000) throw new Error("每项范围变化都需要去向和原因");
    for (const key of ["node_id", "condition_id", "target_node_id"])
      if ((key === "node_id" || v[key] !== undefined) && (typeof v[key] !== "string" || !/^[A-Za-z0-9_-]{1,60}$/u.test(v[key] as string))) throw new Error("范围去向标识无效");
    if (v.action === "merge" ? !v.target_node_id : v.target_node_id !== undefined) throw new Error("合并需要目标，移出范围不能同时指定目标");
    return { node_id: v.node_id as string, action: v.action as WorkScopeMove["action"], reason: v.reason.trim(), ...(v.condition_id ? { condition_id: v.condition_id as string } : {}), ...(v.target_node_id ? { target_node_id: v.target_node_id as string } : {}) };
  });
}
const INTENTS = ["question", "supplement", "decision", "correction", "new_task", "control"] as const;
const textList = (value: unknown, max: number, pattern?: RegExp) =>
  Array.isArray(value) && value.length <= max && value.every((v) => typeof v === "string" && v.length <= 400 && (!pattern || pattern.test(v)));
/** The coordinator's classification of received inputs; ids/versions are bound by the program, not trusted here. */
export function parseHandledEvents(value: unknown): { items: HandledEvent[]; errors: string[] } {
  if (value === undefined) return { items: [], errors: [] };
  if (!Array.isArray(value) || value.length > 50) return { items: [], errors: ["handled_events 必须是最多 50 项的数组"] };
  const items: HandledEvent[] = [];
  const errors: string[] = [];
  value.forEach((raw, index) => {
    const at = `handled_events[${index}]`;
    if (!object(raw)) return errors.push(`${at} 不是对象`);
    const event_id = clip(raw.event_id, 120), note = clip(raw.note, 500);
    if (!event_id) return errors.push(`${at} 缺少 event_id`);
    if (!INTENTS.includes(raw.intent as (typeof INTENTS)[number])) return errors.push(`${at} intent 只能是 ${INTENTS.join("|")}`);
    if (raw.impact !== "high" && raw.impact !== "normal") return errors.push(`${at} impact 只能是 high|normal`);
    if (!note) return errors.push(`${at} 缺少 note（实际改动或下一步）`);
    if (items.some((i) => i.event_id === event_id)) return errors.push(`${at} 重复处理同一输入 ${event_id}`);
    if (raw.affects !== undefined && !textList(raw.affects, 12, /^[\w.-]+$/u)) return errors.push(`${at} affects 必须是成果文件名数组`);
    if (raw.revokes !== undefined && (!object(raw.revokes) || (raw.revokes.decision_ids !== undefined && !textList(raw.revokes.decision_ids, 20)) || (raw.revokes.suggestions !== undefined && !textList(raw.revokes.suggestions, 20)))) return errors.push(`${at} revokes 无效`);
    for (const key of ["question_id", "answer", "suggestion", "clarify"] as const)
      if (raw[key] !== undefined && typeof raw[key] !== "string") return errors.push(`${at} ${key} 必须是文字`);
    const question_id = clip(raw.question_id, 60), answer = clip(raw.answer, 500), suggestion = clip(raw.suggestion, 400), clarify = clip(raw.clarify, 500);
    if (raw.intent === "decision" && (!question_id || !answer)) return errors.push(`${at} 决定必须给出 question_id 与 answer`);
    const revokes = object(raw.revokes) ? { ...(Array.isArray(raw.revokes.decision_ids) ? { decision_ids: raw.revokes.decision_ids as string[] } : {}), ...(Array.isArray(raw.revokes.suggestions) ? { suggestions: raw.revokes.suggestions as string[] } : {}) } : undefined;
    items.push({
      event_id,
      intent: raw.intent as HandledEvent["intent"],
      impact: raw.impact,
      note,
      ...(question_id ? { question_id } : {}),
      ...(answer ? { answer } : {}),
      ...(suggestion ? { suggestion } : {}),
      ...(clarify ? { clarify } : {}),
      ...(Array.isArray(raw.affects) ? { affects: [...new Set(raw.affects as string[])] } : {}),
      ...(revokes && Object.keys(revokes).length ? { revokes } : {}),
    });
    return undefined;
  });
  return { items, errors };
}
/**
 * Shape and contract check of one proposal value. Every rejection is named for the submitter; the
 * caller decides whether errors reject the submission (structured) or fail closed (legacy text).
 */
export function parseWorkTurnValue(
  value: unknown,
  contract: WorkContract,
): { turn: WorkTurn; errors: string[]; nodeErrors: string[] } {
  const answer: WorkTurn = {
    intent: "answer",
    card_patch: {},
    deliverables: [],
    edit_request: null,
  };
  const fail = (...errors: string[]) => ({ turn: answer, errors, nodeErrors: [] });
  if (!object(value)) return fail("提交内容必须是对象");
  const raw = value;
  if (raw.card_patch !== undefined && !object(raw.card_patch)) return fail("card_patch 必须是对象");
  // Models sometimes nest deliverables in card_patch or omit edit_request; normalize shape only, never authorization.
  const patchRaw = object(raw.card_patch) ? raw.card_patch : {};
  const editFile =
    raw.intent === "edit" &&
    object(raw.edit_request) &&
    typeof raw.edit_request.filename === "string"
      ? [raw.edit_request.filename]
      : [];
  const listRaw =
    Array.isArray(raw.deliverables) && raw.deliverables.length
      ? raw.deliverables
      : Array.isArray(patchRaw.deliverables) && patchRaw.deliverables.length
        ? patchRaw.deliverables
        : editFile;
  const deliverables = listRaw.map((d) =>
    object(d) && typeof d.filename === "string" ? d.filename : d,
  );
  const editRequest = raw.edit_request ?? null;
  if (!["answer", "guide", "execute", "edit"].includes(String(raw.intent)))
    return fail("intent 只能是 answer|guide|execute|edit");
  if (
    !deliverables.every((f) => typeof f === "string" && /^[\w.-]+$/u.test(f)) ||
    new Set(deliverables).size !== deliverables.length
  )
    return fail("deliverables 必须是不重复的团队登记文件名");
  try {
    workMembers(deliverables as string[], contract);
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
  if (["execute", "edit"].includes(String(raw.intent)) && deliverables.length === 0)
    return fail("execute/edit 必须列出本次成果");
  const errors: string[] = [];
  if (raw.review_requirement_ids !== undefined && (!Array.isArray(raw.review_requirement_ids) || !raw.review_requirement_ids.length || raw.review_requirement_ids.length > 80 || !raw.review_requirement_ids.every((id) => typeof id === "string") || new Set(raw.review_requirement_ids).size !== raw.review_requirement_ids.length)) errors.push("review_requirement_ids 必须是不重复的验收项 ID 数组");
  const patch: WorkTurn["card_patch"] = {};
  const title = clip(patchRaw.title, 80),
    goal = clip(patchRaw.goal, 2000);
  if (title) patch.title = title;
  if (goal) patch.goal = goal;
  const parsedNodes = parseWorkNodesDetailed(patchRaw.nodes, contract);
  if (parsedNodes.nodes.length) patch.nodes = parsedNodes.nodes;
  const reason = clip(patchRaw.scope_change_reason, 1000);
  if (reason) patch.scope_change_reason = reason;
  if (patchRaw.scope_moves !== undefined) {
    try {
      patch.scope_moves = parseScopeMoves(patchRaw.scope_moves);
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  if (object(patchRaw.side_topic)) {
    const text = clip(patchRaw.side_topic.text, 500),
      reason = clip(patchRaw.side_topic.reason, 500);
    if (text && reason) patch.side_topic = { text, reason };
  }
  if (patchRaw.pending !== undefined) {
    const pending = pendingList(patchRaw.pending);
    if (!pending) errors.push("pending 每项必须有 id 与 question");
    else patch.pending = pending;
  }
  if (Array.isArray(patchRaw.suggestions))
    patch.suggestions = patchRaw.suggestions
      .filter(object)
      .map((s) => ({
        text: clip(s.text, 400) ?? "",
        basis: clip(s.basis, 300) ?? "推断",
      }))
      .filter((s) => s.text)
      .slice(0, 8);
  if (patchRaw.employee_said !== undefined) {
    if (!Array.isArray(patchRaw.employee_said) || patchRaw.employee_said.length > 12 || !patchRaw.employee_said.every((s) => object(s) && typeof s.text === "string" && !!s.text.trim() && s.text.length <= 400 && typeof s.quote === "string" && !!s.quote.trim() && s.quote.length <= 400)) errors.push("employee_said 必须为最多 12 项 {text,quote}，每项非空且不超过 400 字；没有来源请不填");
    else patch.employee_said = patchRaw.employee_said.map((s) => ({ text: (s as { text: string }).text, quote: (s as { quote: string }).quote }));
  }
  let edit: WorkTurn["edit_request"] = null;
  if (raw.intent === "edit") {
    if (deliverables.length !== 1) errors.push("edit 仅允许单份成果的指定范围；跨章节/多成果更新用 execute 按影响修订");
    const e = editRequest;
    if (
      !object(e) ||
      typeof e.filename !== "string" ||
      !deliverables.includes(e.filename) ||
      typeof e.base_sha256 !== "string" ||
      !/^[a-f0-9]{64}$/u.test(e.base_sha256) ||
      !object(e.anchor) ||
      !["heading", "quote", "page"].includes(String(e.anchor.type)) ||
      typeof e.anchor.value !== "string" ||
      !e.anchor.value.trim() ||
      typeof e.instruction !== "string" ||
      !e.instruction.trim()
    )
      errors.push("edit_request 必须包含本次成果 filename、64 位 base_sha256、anchor{type,value} 与 instruction");
    else
      edit = {
        filename: e.filename,
        base_sha256: e.base_sha256,
        anchor: {
          type: e.anchor.type as "heading" | "quote" | "page",
          value: e.anchor.value,
        },
        instruction: e.instruction,
      };
  } else if (editRequest !== null) errors.push("只有 edit 可以提交 edit_request");
  const handled = parseHandledEvents(raw.handled_events);
  errors.push(...handled.errors);
  if (errors.length) return { turn: answer, errors, nodeErrors: parsedNodes.errors };
  return {
    turn: {
      intent: raw.intent as WorkTurn["intent"],
      ...(Array.isArray(raw.review_requirement_ids) ? { review_requirement_ids: raw.review_requirement_ids as string[] } : {}),
      card_patch: patch,
      deliverables: deliverables as string[],
      edit_request: edit,
      ...(handled.items.length ? { handled_events: handled.items } : {}),
    },
    errors: [],
    nodeErrors: parsedNodes.errors,
  };
}
export const hasWorkBlock = (text: string) =>
  /<promax-work>[\s\S]*?<\/promax-work>/u.test(text);
/**
 * Legacy text block, kept readable for historical sessions. Fail closed; confirmed is never accepted
 * from a model, and a text block never classifies employee inputs.
 */
export function parseWorkTurn(text: string, contract: WorkContract): WorkTurn {
  const answer: WorkTurn = {
    intent: "answer",
    card_patch: {},
    deliverables: [],
    edit_request: null,
  };
  const blocks = [...text.matchAll(/<promax-work>([\s\S]*?)<\/promax-work>/gu)];
  if (blocks.length !== 1 || (text.match(/<promax-work>/gu)?.length ?? 0) !== 1)
    return answer;
  try {
    const raw: unknown = JSON.parse(blocks[0]![1]!);
    if (object(raw)) delete raw.handled_events;
    const { turn, errors, nodeErrors } = parseWorkTurnValue(raw, contract);
    return errors.length || nodeErrors.length ? answer : turn;
  } catch {
    return answer;
  }
}
export function readableConversation(
  nodes: readonly unknown[],
): Array<{ role: "user" | "assistant"; text: string }> {
  return nodes.flatMap((n) => {
    if (!object(n) || !["user", "assistant"].includes(String(n.kind)))
      return [];
    const blocks = Array.isArray(n.blocks)
      ? n.blocks
      : Array.isArray(n.content)
        ? n.content
        : [];
    let text = blocks
      .flatMap((b) =>
        object(b) &&
        (b.kind === "text" || b.type === "text") &&
        typeof b.text === "string"
          ? [b.text]
          : [],
      )
      .join("");
    if (/PROMAX_DISPATCH_|运行时完整性闸门|^Background subagent /u.test(text))
      return [];
    text = text
      .replace(/<promax-work>[\s\S]*?(?:<\/promax-work>|$)/gu, "")
      .trim();
    return text ? [{ role: n.kind as "user" | "assistant", text }] : [];
  });
}
export const WORK_SYSTEM_PROMPT = `你是 Promax 主 Agent，面向公司内部产品员工。员工不需要懂内部成员、任务包或检查机制。

## 对员工说话
- 用员工能直接读懂的短段、分组或表格；普通问题直接答完，不附流程说明。
- 不向员工展示内部标识：成员 ID（如 solution_design、quality_judge）、task_key、文件路径、哈希、团队版本、判定轮次、scope.start、冻结、合同、闸门等运行术语。提到成员时用角色名：客户研究员、竞品分析师、需求管理员、方案设计师、需求评审员、数据分析师、检查。
- 程序暂缓某个调用不是失败，不要对员工说"被拒绝""需要再次授权"。

## 每次回复调用一次 promax_work_proposal（结构化提交）
正文照常写给员工；控制依据只来自 promax_work_proposal 的参数，不再在正文末尾写 <promax-work> 结构块（旧会话里的结构块只是历史）。工具返回错误时按错误逐项修正后重新调用；程序校验工作、问题、成果、版本后才生效，你自报的状态、次数、版本或"已完成"不作为依据。工作区只显示主干、问题列表和员工打开的一份文档。
参数：{"intent":"answer|guide|execute|edit","card_patch":{},"deliverables":[],"edit_request":null,"handled_events":[]}
- answer：普通问答。不建成果、不调成员。card_patch 通常为空。
- guide：模糊想法或只给材料。先给材料里的具体观察或可选方向，再问最多 1–2 个会改变结果的问题；同时用 card_patch 形成可纠正的草稿，不启动执行。
- execute：员工已明确要什么成果。正文用一两句说明将产出什么、按什么范围做，并说明"几秒后自动开始，可随时停止或先等等"。不要写"等你确认""请授权"。执行进行中不能提出新的 execute/edit。
- edit：严格修改单份已有成果的一个指定范围，范围外逐字保留。edit_request 填 filename、当前版本哈希（只用程序注入值）、anchor（heading 可用纯标题文字或完整 Markdown 标题，必须唯一存在）与 instruction。材料替换等跨章节更新用 execute 列出受影响成果，不伪造单标题锚点；程序预置当前版本并保留冻结基线，只修受影响内容及必要交叉引用，不无条件覆盖。

## 待处理输入与 handled_events
上下文「待处理输入」中的每一项都必须在 handled_events 里给出 {event_id, intent, impact, note}，按列出的优先级处理，前面的普通输入不能跳过。
- intent：question 追问/咨询（先回答，不记决定）；supplement 补充要求或材料；decision 对某个问题的回答（给 question_id 和 answer）；correction 否定或纠正已有口径/成果；new_task 与当前目标无关的新任务；control 停止、等等、开始等控制意图。
- 正例：问题「同一个人最终按什么识别？」回复「工号」→ decision，answer=工号。回复「给我用」→ decision。
- 反例：回复「是空白还是什么原因」→ question，先解释原因，不记决定。二选一问题只回「是的」→ 不能擅自选边，用 clarify 反问是哪一项。「采纳」只关联当前回应的那一条建议及其版本，不等于所有建议获批，也不代表建议里的访谈已经完成；关联不清先 clarify。
- impact=high 只用于会改变在做成果或已确认口径的纠正；此时写 affects（受影响成果文件名），程序会暂停相关步骤、其余工作继续。普通补充 impact=normal。
- 决定或补充影响已有成果时写 affects；有多份成果就逐份列出，程序会安排局部修改。不影响任何成果时 affects 传 []，程序记为有效要求。
- 新口径替代旧决定或已采纳建议时用 revokes 指明，旧口径保留为历史但不再同时生效。
- note 用一句话说明实际改动或下一步，界面会展示；不要只写"记下了"。

card_patch 字段（未采纳建议可调整，已采纳建议及反馈由程序持续保留；已记录要求、问题和员工决定不能用空列表清除）：
- title：不超过 20 字的工作名；goal：一句话目标。
- employee_said：[{text, quote}]。quote 必须逐字摘自真实员工消息；程序只保存实际消息为依据。text 仅是你的解释，永不获得用户来源身份；不能凭真实引文把新增禁令变成用户决定。无真实来源时工具明确拒绝。
- suggestions：[{text, basis}] 少量可核对的量化建议，每条一件事，basis 写依据。在聊天中提出，不变成独立清单、表单或执行关卡。程序记录用户回应的具体建议：state=accepted 才持续按采纳事项跟进；rejected 不再强求；adjusted 按 history 中的反馈改建议；未表态仍是 proposed。不能用含糊的“可以”确认全部建议；employee_said 不用于伪造建议采纳。拒绝额外建议不撤销用户原本明确要求。未采纳建议不阻断已具备输入、已明确委托的工作。
- nodes：普通追问默认不创建或重写；无自定义阶段时省略，沿用程序初始节点。确需自定义时提供 1–12 个主要业务阶段 [{id,title,completion,filenames,gate,depends_on?}]；id 为 1–60 字符的字母/数字/下划线/连字符，title/completion 为非空业务文字，filenames 为数组。${WORK_NODE_RULE}；合法例子：{id:"intake",title:"核对材料",completion:"明确材料范围",filenames:[],gate:"employee"}、{id:"report",title:"形成报告",completion:"报告保存并核对",filenames:["团队登记成果名.md"],gate:"checked_artifacts"}。depends_on 可用其它节点 id 的数组表示真实依赖。不硬套固定名称、顺序或一阶段一成员。gate 虽为兼容字段仍须满足数据格式，但不是新增执行授权或用户手工核销步骤；旧三个值意义不变。主干只读、无展开/导航/编辑/手工核销，不显示默认百分比。派工仍按需求、必要输入和真实依赖；失败、中断、等待必要信息如实报告。
- 合并/移除原节点或完成条件时，scope_moves 逐项给出 {node_id,condition_id?,action:"merge"|"defer",target_node_id?,reason}。整个节点移除只给节点级条目；保留节点中移除条件给条件级条目。merge 指向新主线中的节点，程序会完整迁入原条件和关联缺口（同名条件不擅自删减）；defer 是员工明确移出本次范围，不是完成。每项说明原因，员工过目确认前不生效；历史、未满足条件及其去向永久保留。不得用删除或假完成换全绿。
- 不新增 conditions 手工核销条件；旧条件、证据和版本仍保留。量化事项用 suggestions 提出并跟进，不随机打质量分，不删除未完成事项制造完成率。新要求影响在跑任务时保留原任务范围，说明旧结果需要更新或复核。
- 用户指出问题时先核对原要求、原文与证据；明确错误才纠正，分歧保留，不把新要求当原错误。文件落盘、独立检查和用户采纳分开表述，不要求员工维护进度；浏览不能改变执行或完成状态。
- pending：[{id, decision_key, node_id, artifact, location, current_content, effect, timing, question, options, basis}] 需要员工拍板的业务选择或缺口。每轮只在正文引导 1–3 个最必要的问题，完整清单保留在问题列表中；说明是否阻塞后续步骤及影响范围。decision_key 是稳定业务决定标识；artifact 是具体成果文件名，location 是真实章节标题/唯一原文；current_content 摘录当前内容，effect 说明决定后改哪处。timing=now 是本次必需；后续设计 timing=later，不扩大本次必交。options 可给少量参考答案，员工在聊天中直接回应，无需管理表单。检查报告已提出的待决定项程序会自动放进卡片，不要换个说法再提一遍；员工已回答的问题不要再列。
- 不再输出 panel；旧工作中的表单数据只作历史兼容。问题、归并与排序建议用短聊天表达，不能要求用户先填表再开始工作。
- 员工以"我的决定：…"点选的答案程序已记为决定；你仍需在 handled_events 中给出它影响哪些成果（affects），不要再改写成 employee_said。
- deliverables 只用团队登记的文件名；简版需求默认只列员工要的那一份。

## 执行由程序推进
- during_run 是员工执行中提交的新信息及所在事项。当前任务仍按启动时的范围执行；及时回应讨论，核对哪些变化影响结果，不能把旧范围成果当已满足新要求。新的范围、成果或决定待当前回合结束后按既有授权机制推进，不取消或重跑在跑任务。
- 程序在员工点击开始或倒计时结束后启动执行，并按"生成 → 独立检查 → 需要时返修（最多两轮）→ 结束"推进。每一步程序会通知你该调用谁；成员用成果回执、检查用结构化结果提交，程序核对后才推进。你不需要也不能替成员写成果，不要运行命令或计算哈希。
- 模型或工具失败时程序按同一故障最多自动恢复 3 次；缺权限、工具或必要材料会等员工，不盲目重试；耗尽后保留成果、暂停受影响步骤并上报平台缺陷。据实转述 Agent Status，不要自称已修复、已上报或已完成。
- 生成后及时告知成果可查看；检查结论与全任务完成度分开，以程序的验收基准与状态为准。局部 PASS、问题台账关闭、文件存在均不等于任务完成；保留结论的未知、推断与时效边界。
- 执行结束后，把仍需员工判断的事项放进 pending（带 options），正文只点出最关键的一两项。
- 员工回答了待决定事项或补充了要求时，程序已把它记为已确认；单一范围用 edit；跨章节或多成果用 execute 按影响修订，保留未受影响的内容，不重写全文。
- 改变目标、已确认规则或成果范围时，先说明影响再提出。
- 恢复工作只依据注入的工作卡、当前成果与最近检查；默认不做浏览器验收，相关项标未验证。
- 协作焦点以员工最新聊天为准，旧导航只是历史浏览记录，不是当前派工指令。员工说“回到主题，看看还差什么”时围绕总目标、有效要求、已采纳建议和真实剩余事项回答，不把这句话吞成导航操作。
- drafts 是员工未提交输入：不引用、不执行、不作为决定。side_topics 中 deferred=true 的事项不是本次范围。
- 范围外话题根据与目标的关系用 side_topic:{text,reason} 轻提示，允许继续展开；不用轮数或耗时中断。暂存支线不算接受新范围。
- 已答问题不重新提出；确有新材料/冲突，写 reopen_reason 和 reviewed_sha256（确有新版本），说明为什么需要重新讨论。`;
