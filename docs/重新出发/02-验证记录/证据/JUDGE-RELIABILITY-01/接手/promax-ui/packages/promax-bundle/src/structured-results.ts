import { createHash } from "node:crypto";
import { parseHandoff } from "./handoff.ts";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import { acceptanceErrors, type AcceptanceResult, type UnverifiedItem } from "../../promax-ui-console/src/effective-protocol.ts";
import { acceptanceEvidence, acceptanceGateErrors, currentAcceptanceEvidence, evidenceDependencyFromParts, evidenceDependencyParts, evidenceDigest, readFrozenSources, validateEvidenceLinks, verifyEvidenceLinks, type AcceptedEvidenceLink, type EvidenceLinkInput, type FrozenSourceRecord } from "./evidence-links.ts";
import { requirementsDigest, WORK_NODE_GATES, WORK_NODE_RULE } from "../../promax-ui-console/src/work-protocol.ts";
import {
  parseWorkTurnValue,
  type WorkContract,
  type WorkTurn,
} from "../../promax-ui-console/src/work-protocol.ts";
import {
  WorkStore,
  SubmissionRejected,
  type CheckResultRecord,
  type MemberReceipt,
  type WorkRound,
} from "./work-store.ts";

export const WORK_PROPOSAL_TOOL = "promax_work_proposal";
export const MEMBER_RECEIPT_TOOL = "promax_member_receipt";
export const CHECK_RESULT_TOOL = "promax_check_result";
export const REPAIR_PLAN_TOOL = "promax_repair_plan";
export const STRUCTURED_TOOLS: readonly string[] = [WORK_PROPOSAL_TOOL, MEMBER_RECEIPT_TOOL, CHECK_RESULT_TOOL, REPAIR_PLAN_TOOL];

const str = (description: string, maxLength = 1000) => ({ type: "string", maxLength, description });
const strings = (description: string) => ({ type: "array", items: { type: "string", maxLength: 400 }, description });
const unverified = { type: "array", items: { type: "object", additionalProperties: false, required: ["item", "reason"], properties: { item: str("未验证项", 300), reason: str("原因", 500), requirement_ids: strings("关联验收项 ID；无关的一般限制传 []"), impact: { type: "string", enum: ["blocking", "non_blocking"], description: "影响完成/一般限制；必需项不能豁免" } } } };
/** 6.4 成员只提供最小关联；编号、哈希与索引由程序派生，成员不手填。 */
const evidenceLinks = { type: "array", maxItems: 60, description: "必需结论/关键数值/主要比较判断的最小关联；一般叙述可不登记。程序校验必需项 ID、来源编号、正文定位与来源字节后才派生引用索引", items: { type: "object", additionalProperties: false, required: ["requirement_ids", "conclusion", "location", "evidence"], properties: { requirement_ids: strings("当前基准中的验收项 ID，可关联多项"), conclusion: str("结论原文或准确引用（必须能在当前版本中逐字找到）", 500), location: str("当前成果正文中逐字存在且唯一的标题/表格行/结论片段（至少4字符），须指向本条结论所在段落/章节；不得拼接‘报告开头/数据来源段’等导航描述。不同于 evidence.range 的来源定位；未命中、多次命中或范围不对应均拒收", 300), conclusion_id: str("修订已登记结论时原样引用程序回显的 CNL-###；首次登记省略", 40), kind: { type: "string", enum: ["fact", "comparison", "change", "trend", "projection", "recommendation", "unknown"], description: "结论类型；比较/变化/趋势需匹配对应强度依据" }, evidence: { type: "array", minItems: 1, items: { type: "object", additionalProperties: false, required: ["source_id", "range"], properties: { source_id: str("冻结输入清单中的 SRC 编号", 40), range: str("第N行/第N-M行（跨度≤200），或≤400字符逐字片段；受控数值复算可用 json:all 选择该SRC整份JSON数组（≤8MiB、≤100000条），不是磁盘路径", 400), use: str("该依据的用途", 200) } } }, numeric_spec: { type: "object", description: "首稿前用promax_rating_facts取得同源规格。受控冻结JSON评分数组：input=关联SRC编号；field=评分字段；formula=rating_total/rating_valid/rating_invalid/rating_1_count至rating_5_count（unit=records,rounding=half_up:0），或rating_1_2_ratio/rating_4_5_ratio；filter=all_rows_no_dedup；missing_rule=exclude_invalid_rating；window=frozen_input；unit=ratio或percent；rounding=half_up:0—6；percent结果必须带%。分子/分母只作待核声明（计数分母固定为1，比例分母为有效评分数）；若与复算冲突，按result/numerator/denominator逐字段反馈收到值及期望值；其它规格记unsupported", properties: { input: str("关联来源SRC编号；evidence.range=json:all选完整JSON数组，或沿用短定位。每来源只绑定一个计算范围；程序复算全量，回读预览≤2000字符，不注入完整JSON", 400), field: str("JSON记录中的评分字段名", 100), definition: str("字段意义、对象、单位", 400), unit: str("单位", 100), window: str("时间窗", 200), numerator: str("分子", 200), denominator: str("分母", 200), filter: str("过滤与去重规则", 300), missing_rule: str("缺失处理", 300), formula: str("公式", 300), rounding: str("舍入方式", 100), result: str("计算结果", 200) } }, supersedes: strings("拆分/合并/撤回时被替代的 CNL-### 身份，保留历史去向"), note: str("变更说明", 300) } } };

/** Model-facing schemas. They describe the contract; acceptance is decided by the program checks below, not by the schema alone. */
export const STRUCTURED_PARAMETERS: Readonly<Record<string, Record<string, unknown>>> = {
  [WORK_PROPOSAL_TOOL]: {
    type: "object",
    additionalProperties: false,
    required: ["intent", "card_patch", "deliverables", "edit_request", "handled_events"],
    properties: {
      intent: { type: "string", enum: ["answer", "guide", "execute", "edit"] },
      review_requirement_ids: strings("可选：已有基准的局部评审 ID；初次任务省略，默认全检查；局部 PASS 不等于任务完成"),
      card_patch: { type: "object", description: "无变化传 {}；普通追问默认省略 nodes。title/goal/employee_said/suggestions/pending/scope_change_reason/scope_moves/side_topic 等既有字段仍可用，范围变更由程序确认", properties: {
        nodes: { type: "array", minItems: 1, maxItems: 12, description: `可省略；${WORK_NODE_RULE}。gate 是旧记录兼容字段，不是执行授权或人工核销。不是按节点顺序派工；范围变化可结合 scope_change_reason/scope_moves 提案`, items: { type: "object", required: ["id", "title", "completion", "filenames", "gate"], properties: {
          id: { type: "string", minLength: 1, maxLength: 60, pattern: "^[A-Za-z0-9_-]+$", description: "节点标识；同一提案中唯一" },
          title: str("业务阶段名称；不使用成员/工具/建设阶段名", 40),
          completion: str("本阶段可核对的完成描述；不是模型自报完成", 500),
          filenames: { type: "array", items: { type: "string" }, description: "团队登记成果文件名数组；employee 可为 []，其它 gate 必须至少一项，且每项属于当前团队合同" },
          gate: { type: "string", enum: WORK_NODE_GATES, description: "必填字符串枚举；无成果阶段用 employee，checked_artifacts/accepted_artifacts 要有成果；不新增人工核销步骤" },
          depends_on: { type: "array", items: { type: "string" }, description: "可选：已提供的其它节点 id，不能自依赖或成环" },
        } } },
        scope_change_reason: str("改变已有节点/目标的原因；原节点和未完成条件须保留并走范围确认", 1000),
        scope_moves: { type: "array", description: "可选：原节点/条件的去向；merge 给 target_node_id，defer 须明确移出本次范围；由程序确认后生效", items: { type: "object", properties: { node_id: str("原节点 id", 60), condition_id: str("可选：原完成条件 id", 60), action: { type: "string", enum: ["merge", "defer"] }, target_node_id: str("merge 时新主线节点 id", 60), reason: str("每项去向原因", 1000) }, required: ["node_id", "action", "reason"] } },
      } }, 
      deliverables: strings("团队登记的成果文件名；answer/guide 传 []"),
      edit_request: { description: "intent=edit 时为 {filename,base_sha256,anchor:{type,value},instruction}；其他意图传 null" },
      handled_events: {
        type: "array",
        description: "对「待处理输入」逐项给出理解；没有待处理输入时传 []",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["event_id", "intent", "impact", "note"],
          properties: {
            event_id: str("待处理输入的 id", 120),
            intent: { type: "string", enum: ["question", "supplement", "decision", "correction", "new_task", "control"] },
            impact: { type: "string", enum: ["high", "normal"], description: "high 仅用于会改变在做成果或已确认口径的纠正" },
            question_id: str("关联的待决定问题 id", 60),
            answer: str("decision 时的答案，必须来自员工原话或所选选项", 500),
            suggestion: str("关联的建议原文", 400),
            affects: strings("受影响的已有成果文件名；不影响成果传 []"),
            clarify: str("需要反问员工时的问题", 500),
            revokes: { type: "object", additionalProperties: false, properties: { decision_ids: strings("被新口径替代的决定 id"), suggestions: strings("被新口径替代的已采纳建议原文") } },
            note: str("对员工说明实际改动或下一步", 500),
          },
        },
      },
    },
  },
  [MEMBER_RECEIPT_TOOL]: {
    type: "object",
    additionalProperties: false,
    required: ["filename", "status", "summary", "unverified", "gaps", "input_version"],
    properties: {
      filename: str("本次负责的成果文件名", 120),
      status: { type: "string", enum: ["draft_ready", "blocked"] },
      summary: str("最多 5 条核心结论或阻塞说明", 2000),
      handoff: { type: "object", additionalProperties: false, required: ["available", "sources", "scope", "needed_by", "gaps"], properties: { available: strings("已可采用的信息；不等于成员结束"), sources: { type: "array", items: { type: "object", additionalProperties: false, required: ["path", "sha256", "range"], properties: { path: str("本任务冻结输入的相对路径"), sha256: str("原始文件SHA-256", 64), range: str("页/行/记录定位", 400) } } }, scope: str("适用范围，不扩大样本外推"), needed_by: strings("下游要做的具体部分"), gaps: strings("仍缺证据/决定的部分") } },
      unverified,
      gaps: strings("已知缺口"),
      evidence_links: evidenceLinks,
      evidence_update: { type: "object", additionalProperties: false, required: ["mode"], properties: { mode: { type: "string", enum: ["patch", "replace"], description: "省略默认patch：仅变更给出的结论，未变项重核续绑。replace：整组替换，未列项撤回。[]仅表示本次无新增。" }, withdraw: strings("显式撤回的CNL身份，不自动恢复；不可同时更新相同ID") } },
      blocked_reason: { type: "string", enum: ["missing_material", "missing_permission", "missing_tool", "conflict"] },
      input_version: { type: "integer", description: "工作简报中的输入版本" },
    },
  },
  [REPAIR_PLAN_TOOL]: {
    type: "object", additionalProperties: false, required: ["judge_round", "assignments"],
    properties: {
      judge_round: { type: "integer" },
      assignments: { type: "array", minItems: 1, items: { type: "object", additionalProperties: false, required: ["member", "files", "issue_ids", "instruction"], properties: { member: str("登记责任成员", 60), files: strings("本轮授权成果"), issue_ids: strings("当前问题编号"), instruction: str("主 Agent 的具体返修安排", 2000) } } },
    },
  },
  [CHECK_RESULT_TOOL]: {
    type: "object",
    additionalProperties: false,
    required: ["verdict", "issues", "unverified", "decisions", "input_version"],
    properties: {
      verdict: { type: "string", enum: ["PASS", "REVISION_REQUIRED", "INCOMPLETE"] },
      review_request: str("本轮程序绑定的评审请求 ID；旧协议未提供时可省略", 200),
      acceptance: { type: "object", additionalProperties: false, required: ["baseline_version", "items"], properties: {
        baseline_version: str("程序提供的验收基准版本；有基准时必填", 64),
        items: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "state", "evidence"], properties: { id: str("本次 scope 中的验收项 ID", 160), state: { type: "string", enum: ["met", "unmet", "unverifiable"] }, evidence: str("当前版本中的可定位依据；结构完整不代表业务充分", 2000) } } },
      } },
      rechecks: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "state", "evidence"], properties: { id: str("旧问题 ID", 60), state: { type: "string", enum: ["open", "verified", "unverifiable"] }, evidence: str("本版本的逐项核查证据，不接受成员自述", 2000) } } },
      issues: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "severity", "artifact", "location", "evidence", "impact", "fix"],
          properties: { id: str("编号", 60), severity: { type: "string", enum: ["high", "medium", "low"] }, artifact: str("被审文件名", 120), location: str("成果中真实章节标题", 300), evidence: str("原始要求或证据", 2000), impact: str("影响", 1000), owner_member_id: str("仅旧结果兼容，不作为派工依据", 60), kind: { type: "string", enum: ["defect", "suggestion", "evidence_gap", "business_choice"] }, fix: str("修改要求", 1000) },
        },
      },
      unverified,
      decisions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "question", "options", "location", "evidence"],
          properties: { id: str("编号", 60), question: str("需要员工拍板的业务选择", 500), options: strings("2–4 个选项"), location: str("位置", 300), evidence: str("依据", 1000), artifact: str("受影响成果文件名", 120), decision_key: str("稳定业务决定标识", 60), effect: str("选择后修改什么", 500), current_content: str("对应原文摘录", 1000), timing: { type: "string", enum: ["now", "later"] }, reopen_reason: str("重开已答问题的新情况", 500) },
        },
      },
      input_version: { type: "integer", description: "工作简报中的输入版本" },
    },
  },
};
const DESCRIPTIONS: Readonly<Record<string, string>> = {
  [WORK_PROPOSAL_TOOL]: "主 Agent 每次回复调用一次，提交行动提议和对待处理输入的理解。程序校验工作、问题、成果与版本后才生效；返回错误时按错误逐项修正后重试。",
  [MEMBER_RECEIPT_TOOL]: "业务成员在成果文件落盘后调用，提交成果回执。程序核对你的身份、任务、阶段、文件实际存在与哈希、输入版本后才推进；缺材料/权限/工具时 status=blocked。",
  [REPAIR_PLAN_TOOL]: "主 Agent 根据已接收的检查和当前问题清单提交明确返修安排；程序验证职责、问题、授权范围及轮次后进入返修。Judge 不分配成员。",
  [CHECK_RESULT_TOOL]: "独立检查提交本轮检查结果。被审版本、轮次和范围由程序绑定；报告 Markdown 由程序据此渲染，不要手写 YAML 报告。",
};

type Exec = {
  callId: string;
  agent?: { session: { header: { id: string; cwd?: string; origin?: string; parentSession?: string }; events?: readonly unknown[] } };
};
export interface StructuredDeps {
  contract(exec: Exec): Promise<WorkContract>;
  /** Program-bound member identity of a child session (from the dispatch record or the assembled persona). */
  member(exec: Exec): Promise<string | undefined>;
  runtimeVersion: string;
}
type Staged =
  | { kind: "proposal"; workspace: string; key: string; turn: WorkTurn; contract: WorkContract; running: boolean; seq: number; employeeMessages: string[] }
  | { kind: "repair"; workspace: string; key: string; task_key: string; plan: import("../../promax-ui-console/src/review-protocol.ts").RepairPlan }
  | { kind: "receipt"; workspace: string; key: string; task_key: string; receipt: MemberReceipt; verified?: AcceptedEvidenceLink[] }
  | { kind: "check"; workspace: string; key: string; task_key: string; record: CheckResultRecord };
const staged = new Map<string, Staged>();
const stageKey = (exec: Exec) => `${exec.agent?.session.header.id ?? ""}\0${exec.callId}`;
const object = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const sha256 = (v: Buffer | string) => createHash("sha256").update(v).digest("hex");
const clip = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);

function employeeMessages(events: readonly unknown[] | undefined): string[] {
  return (events ?? []).flatMap((e) => {
    if (!object(e) || e.type !== "user/message" || !object(e.data)) return [];
    const data = e.data as { content?: Array<{ type?: string; text?: string }>; source?: { kind?: string } };
    return data.source?.kind === "user" ? [(data.content ?? []).map((b) => (b.type === "text" ? (b.text ?? "") : "")).join("")] : [];
  });
}
const lastSeq = (events: readonly unknown[] | undefined) => Math.max(0, ...(events ?? []).map((e) => (object(e) && typeof e.seq === "number" ? e.seq : 0)));

function unverifiedList(value: unknown, at: string, errors: string[]) {
  if (!Array.isArray(value) || !value.every((u) => object(u) && clip(u.item, 300) && clip(u.reason, 500))) {
    errors.push(`${at} 必须是 [{item, reason}]`);
    return [];
  }
  return value.map((u, index): UnverifiedItem => {
    const v = u as Record<string, unknown>;
    for (const k of Object.keys(v)) if (!["item", "reason", "requirement_ids", "impact"].includes(k)) errors.push(`${at}[${index}] 含未知字段 ${k}；允许item/reason/requirement_ids/impact`);
    if (v.requirement_ids !== undefined && (!Array.isArray(v.requirement_ids) || !v.requirement_ids.every((id) => typeof id === "string"))) errors.push(`${at}.requirement_ids 必须为 ID 数组`);
    if (v.impact !== undefined && !["blocking", "non_blocking"].includes(String(v.impact))) errors.push(`${at}.impact 无效`);
    return { item: clip(v.item, 300)!, reason: clip(v.reason, 500)!, ...(Array.isArray(v.requirement_ids) ? { requirement_ids: v.requirement_ids as string[] } : {}), ...(v.impact === "blocking" || v.impact === "non_blocking" ? { impact: v.impact } : {}) };
  });
}
function runningRound(round: WorkRound | undefined): round is WorkRound & { task_key: string } {
  return !!round?.task_key && round.source !== "proposal" && round.phase !== "ended";
}

/** Validates one submission and stages it. Nothing advances until the authoritative tool result succeeds. */
export async function stageStructuredSubmission(name: string, args: unknown, exec: Exec, deps: StructuredDeps): Promise<{ recorded: true; duplicate?: true; note: string }> {
  const header = exec.agent?.session.header;
  if (!header?.cwd) throw new Error("结构化提交缺少当前工作区");
  const store = new WorkStore(header.cwd);
  if (name === REPAIR_PLAN_TOOL) {
    if (header.origin === "subagent") throw new Error("返修安排只由主 Agent 提交");
    const work = await store.forSession(header.id);
    if (!work) throw new Error("缺少父工作");
    const round = await store.round(work.work_key);
    const plan = await store.validateRepairPlan(work.work_key, args);
    staged.set(stageKey(exec), { kind: "repair", workspace: header.cwd, key: work.work_key, task_key: round!.task_key!, plan });
    return { recorded: true, note: "返修安排通过校验，调用成功后生效" };
  }
  if (name === WORK_PROPOSAL_TOOL) {
    if (header.origin === "subagent") throw new Error("行动提议只由主 Agent 提交");
    const work = await store.forSession(header.id);
    if (!work) throw new Error("当前会话没有工作卡");
    const contract = await deps.contract(exec);
    const parsed = parseWorkTurnValue(args, contract);
    const errors = [...parsed.errors, ...parsed.nodeErrors];
    if (!object(args) || !Array.isArray(args.handled_events)) errors.push("handled_events 必填；没有待处理输入时传 []");
    const round = await store.round(work.work_key);
    const running = runningRound(round);
    if (running && ["execute", "edit"].includes(parsed.turn.intent)) errors.push("执行进行中：新的成果范围待本轮结束后再提出，本次只提交理解与输入处理");
    if (!errors.length) errors.push(...(await store.validateProposal(work.work_key, parsed.turn, contract, employeeMessages(exec.agent?.session.events))));
    if (errors.length) {
      const failure = await store.noteFailure(work.work_key, { step: "coordinator", class: "proposal_invalid", evidence: exec.callId, reason: errors.join("；"), strategy: "按错误逐项修正后重新调用 promax_work_proposal", at: new Date().toISOString(), runtime_version: deps.runtimeVersion });
      throw new Error(failure.decision === "exhausted" ? `已达到自动恢复上限（${failure.fault.limit} 次），平台待修复；员工输入已保留。最后一次错误：${errors.join("；")}` : `${errors.join("；")}（第 ${Math.min(failure.fault.attempts, failure.fault.limit)}/${failure.fault.limit} 次恢复）`);
    }
    staged.set(stageKey(exec), { kind: "proposal", workspace: header.cwd, key: work.work_key, turn: parsed.turn, contract, running, seq: lastSeq(exec.agent?.session.events), employeeMessages: employeeMessages(exec.agent?.session.events) });
    return { recorded: true, note: parsed.turn.card_patch.employee_said?.length ? "来源已核对：仅实际原话记作用户依据，text 另存为主 Agent 解释；调用成功后生效" : "已通过校验，调用成功后生效" };
  }
  if (header.origin !== "subagent" || !header.parentSession) throw new Error(`${name} 只由本次执行中的成员提交`);
  const work = await store.forSession(header.parentSession);
  if (!work) throw new Error("成员缺少真实父工作绑定");
  const round = await store.round(work.work_key);
  if (!runningRound(round)) throw new Error("父工作当前没有执行授权");
  const member = round.children?.[header.id] ?? (await deps.member(exec));
  const errors: string[] = [];
  const raw = object(args) ? args : {};
  const at = new Date().toISOString();
  const version = round.execution_version;
  if (version !== undefined && raw.input_version !== version) errors.push(`input_version 应为本轮冻结的 ${version}，收到 ${String(raw.input_version)}`);
  if (name === MEMBER_RECEIPT_TOOL) {
    const phase = round.phase ?? "generating";
    if (phase !== "generating" && phase !== "repairing") throw new Error("当前不是生成或返修阶段，不能提交成果回执");
    if (!member || member === "quality_judge" || !(round.allowed_members ?? []).concat(round.allowed_members ? [] : work.deliverables.map((d) => d.member_id)).includes(member))
      throw new Error("提交者不是当前阶段获准的责任成员");
    const filename = clip(raw.filename, 120);
    if (round.phase === "repairing" && round.repair_plan && !round.repair_plan.assignments.some((a) => a.member === member && a.files.includes(filename ?? ""))) errors.push("filename 不在主 Agent 本轮返修安排内");
    if (!filename || !work.deliverables.some((d) => d.filename === filename && d.member_id === member) || !round.turn.deliverables.includes(filename))
      errors.push(`filename 必须是你本轮负责的成果：${work.deliverables.filter((d) => d.member_id === member && round.turn.deliverables.includes(d.filename)).map((d) => d.filename).join("、") || "无"}`);
    if (raw.status !== "draft_ready" && raw.status !== "blocked") errors.push("status 只能是 draft_ready|blocked");
    let handoff;
    try { handoff = await parseHandoff(raw.handoff, header.cwd, round.task_key); }
    catch (error) { errors.push(String(error instanceof Error ? error.message : error)); }
    const summary = clip(raw.summary, 2000);
    if (!summary) errors.push("summary 必填");
    const gaps = Array.isArray(raw.gaps) && raw.gaps.every((g) => typeof g === "string") ? (raw.gaps as string[]).map((g) => g.slice(0, 400)).slice(0, 20) : (errors.push("gaps 必须是文字数组"), []);
    const list = unverifiedList(raw.unverified, "unverified", errors);
    if (raw.status === "blocked" && !["missing_material", "missing_permission", "missing_tool", "conflict"].includes(String(raw.blocked_reason))) errors.push("blocked 必须给出 blocked_reason");
    let hash = "";
    let artifactText = "";
    let frozenSources: Map<string, FrozenSourceRecord> | undefined;
    if (filename && !errors.some((e) => e.startsWith("filename"))) {
      try {
        const bytes = await readFile(join(header.cwd, ".任务", round.task_key, "产物快照", filename));
        if (!bytes.byteLength && raw.status !== "blocked") errors.push(`${filename} 尚未落盘，不能提交 draft_ready`);
        hash = sha256(bytes);
        artifactText = bytes.toString("utf8");
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
        if (raw.status !== "blocked") errors.push(`${filename} 尚未落盘，不能提交 draft_ready`);
      }
    }
    const update = raw.evidence_update === undefined ? { mode: "patch" as const, withdraw: [] as string[] } : raw.evidence_update;
    if (!object(update) || !["patch", "replace"].includes(String(update.mode)) || Object.keys(update).some(k => !["mode", "withdraw"].includes(k)) || (update.withdraw !== undefined && (!Array.isArray(update.withdraw) || !update.withdraw.every(id => typeof id === "string" && /^CNL-\d{3,6}$/u.test(id))))) errors.push("evidence_update须为{mode:patch|replace,withdraw?:CNL[]}，不接收其它字段");
    // 6.4 结论关联：先校验必需项 ID、来源编号与定位，再回读来源字节核验（R04）；未知/歧义/越界/版本不符逐条拒收。
    let links: EvidenceLinkInput[] = [];
    let verifiedLinks: AcceptedEvidenceLink[] = [];
    if (raw.evidence_links !== undefined) {
      if (!round.acceptance_baseline) errors.push("当前回合没有冻结验收基准，不能登记结论关联");
      else if (filename && !artifactText) errors.push("成果当前版本不可读取，不能核验结论关联定位");
      const frozen = round.task_key && filename && artifactText && Array.isArray(raw.evidence_links) && raw.evidence_links.length ? await readFrozenSources(header.cwd, round.task_key) : undefined;
      if (frozen && "error" in frozen) errors.push(frozen.error);
      else if (frozen) frozenSources = frozen.sources;
      const result = validateEvidenceLinks(raw.evidence_links, { baseline: round.acceptance_baseline, sources: frozenSources, artifactText, filename: filename ?? "" });
      errors.push(...result.errors);
      links = result.links;
      if (!errors.length && frozenSources && filename && hash) {
        const registry = await store.evidenceLinks(work.work_key).catch(() => undefined);
        const verified = await verifyEvidenceLinks({ workspace: header.cwd, taskKey: round.task_key, filename, artifactSha256: hash, links, sources: frozenSources, conclusions: registry?.conclusions ?? [] });
        errors.push(...verified.errors);
        verifiedLinks = verified.verified.map(link => { const parts = evidenceDependencyParts(artifactText, link); return { ...link, ...(parts ? { dependency_parts: parts, dependency_sha256: evidenceDependencyFromParts(parts) } : {}) }; });
      } else if (!errors.length && links.length && !frozenSources) errors.push("冻结输入包不存在，不能登记来源关联");
    }
    if (errors.length) throw new Error(errors.join("；"));
    const receipt: MemberReceipt = { member: member!, filename: filename!, sha256: hash, status: raw.status as MemberReceipt["status"], phase, repair_round: round.repair_round ?? 0, summary: summary!, ...(handoff ? { handoff } : {}), unverified: list, gaps, ...(raw.status === "blocked" ? { blocked_reason: raw.blocked_reason as NonNullable<MemberReceipt["blocked_reason"]> } : {}), input_version: version ?? 0, ...(round.acceptance_baseline ? { baseline_version: round.acceptance_baseline.version } : {}), call_id: exec.callId, at,
      evidence_update: { mode: (update as { mode: "patch" | "replace" }).mode, withdraw: [...((update as { withdraw?: string[] }).withdraw ?? [])].sort() },
      evidence_request_digest: sha256(JSON.stringify({ links: evidenceDigest(links), mode: (update as { mode: string }).mode, withdraw: [...((update as { withdraw?: string[] }).withdraw ?? [])].sort() })),
      evidence_base_digest: evidenceDigest(round.receipts?.[filename!]?.evidence_links),
      evidence_links: verifiedLinks, evidence_digest: evidenceDigest(verifiedLinks) };
    // 每次原始参数均重新核验；是否重复由权威提交锁判断，不能在 stage 跳过并发/版本检查。
    staged.set(stageKey(exec), { kind: "receipt", workspace: header.cwd, key: work.work_key, task_key: round.task_key, receipt, ...(verifiedLinks.length ? { verified: verifiedLinks } : {}) });
    if (!verifiedLinks.length) return { recorded: true, note: "回执已通过校验，尚未持久登记。接受流程按patch/replace/withdraw重核未变项，结果从本任务结论关联.yml查看；依赖失效只补受影响项，不整篇重写" };
    const echo = verifiedLinks.map((link) => `${link.requirement_ids.join("、")}←${link.evidence.map((item) => item.source_id).join("、")}@${link.location.slice(0, 40)}（${link.conclusion_id ? `待校验修订身份 ${link.conclusion_id}` : "新身份待提交分配"}）`);
    const numeric = verifiedLinks.filter(link => link.evidence.some(e => e.range === "json:all")).map(link => {
      const check = link.numeric_check, source = link.source_readback.find(s => s.source_id === link.numeric_spec?.input);
      return `${source?.source_id}@json:all sha256=${source?.sha256}：${check?.status === "recomputed" ? `记录${check.counts!.rows}，分子${check.counts!.numerator}/分母${check.counts!.denominator}，缺失${check.counts!.missing_rows.length}，结果${check.computed}${check.unit === "percent" ? "%" : ""}` : `未复算：${check?.reason ?? "不支持"}`}；回读预览（非完整输入）${source?.snippet.slice(0, 160) ?? ""}`;
    });
    return { recorded: true, note: `回执与 ${verifiedLinks.length} 条结论关联已通过校验（${echo.join("；")}）；${numeric.length ? `${numeric.join("；")}；` : ""}尚未登记，成功提交后从结论关联读取最终 CNL/LNK 身份` };
  }
  if (name === CHECK_RESULT_TOOL) {
    const allowedFields = Object.keys(STRUCTURED_PARAMETERS[CHECK_RESULT_TOOL]!.properties as Record<string, unknown>);
    for (const field of Object.keys(raw)) if (!allowedFields.includes(field)) errors.push(`检查结果含未知字段 ${field}${field === "request_review_request" ? "；正确字段为 review_request（值见本轮简报）" : ["reviewer", "round", "scope", "reviewed_artifacts"].includes(field) ? "；这是程序生成字段，请从提交参数删除" : `；允许字段：${allowedFields.join("、")}`}`);
    if (member !== "quality_judge") throw new Error("检查结果只由独立检查提交");
    const judgeBinding = round.review_group ? (await store.reviews(work.work_key)).bindings[round.review_group] : undefined;
    if (judgeBinding?.session_id && judgeBinding.session_id !== header.id) throw new Error("检查提交者不是当前评审组绑定的 Judge 子会话");
    if (round.phase !== "checking") throw new Error("当前不是检查阶段");
    const judgeRound = round.judge_round ?? 1;
    if (round.review_request && raw.review_request !== round.review_request) errors.push(`review_request 应为 ${round.review_request}，旧请求不能提交新结果`);
    const hashes = round.reviewed_hashes ?? {};
    for (const [filename, expected] of Object.entries(hashes)) {
      const bytes = await readFile(join(header.cwd, ".任务", round.task_key, "产物快照", filename)).catch(() => Buffer.alloc(0));
      if (sha256(bytes) !== expected) errors.push(`被审文件 ${filename} 在检查期间已变化，本轮结果不能绑定`);
    }
    if (!["PASS", "REVISION_REQUIRED", "INCOMPLETE"].includes(String(raw.verdict))) errors.push("verdict 只能是 PASS|REVISION_REQUIRED|INCOMPLETE");
    const owners = Object.fromEntries(work.deliverables.map((d) => [d.filename, d.member_id]));
    const issues = Array.isArray(raw.issues)
      ? raw.issues.flatMap((value, index) => {
          const at = `issues[${index}]`;
          if (!object(value)) return (errors.push(`${at} 不是对象`), []);
          const fields = ["id", "artifact", "location", "evidence", "impact", "fix"].map((k) => [k, clip(value[k], k === "evidence" ? 2000 : 1000)] as const);
          const missing = fields.filter(([, v]) => !v).map(([k]) => k);
          if (missing.length) return (errors.push(`${at} 缺少 ${missing.join("、")}`), []);
          const issue = Object.fromEntries(fields) as Record<string, string>;
          if (!["high", "medium", "low"].includes(String(value.severity))) return (errors.push(`${at} severity 只能是 high|medium|low`), []);
          if (!(issue.artifact! in hashes)) return (errors.push(`${at} artifact 必须是本轮被审文件：${Object.keys(hashes).join("、")}`), []);
          const owner = clip(value.owner_member_id, 60);
          if (owner && owner !== owners[issue.artifact!]) return (errors.push(`${at} owner_member_id 必须是 ${issue.artifact} 的登记责任成员 ${owners[issue.artifact!]}`), []);
          if (value.kind !== undefined && !["defect", "suggestion", "evidence_gap", "business_choice"].includes(String(value.kind))) errors.push(`${at} kind 无效`);
          return [{ id: issue.id!, severity: value.severity as "high" | "medium" | "low", artifact: issue.artifact!, location: issue.location!, evidence: issue.evidence!, impact: issue.impact!, ...(owner ? { owner_member_id: owner } : {}), ...(value.kind ? { kind: value.kind as NonNullable<import("../../promax-ui-console/src/review-protocol.ts").ReviewIssue["kind"]> } : {}), fix: issue.fix! }];
        })
      : (errors.push("issues 必须是数组"), []);
    const decisions = Array.isArray(raw.decisions)
      ? raw.decisions.flatMap((value, index) => {
          const at = `decisions[${index}]`;
          if (!object(value) || !clip(value.id, 60) || !clip(value.question, 500)) return (errors.push(`${at} 缺少 id 或 question`), []);
          if (!Array.isArray(value.options) || value.options.length < 2 || value.options.length > 5 || !value.options.every((o) => typeof o === "string" && o.trim())) return (errors.push(`${at} options 必须是 2–5 个选项`), []);
          const artifact = clip(value.artifact, 120);
          if (artifact && !(artifact in hashes)) return (errors.push(`${at} artifact 必须是本轮被审文件`), []);
          const decision: CheckResultRecord["decisions"][number] = {
            id: clip(value.id, 60)!,
            question: clip(value.question, 500)!,
            options: (value.options as string[]).map((o) => o.trim().slice(0, 200)),
            location: clip(value.location, 300) ?? "",
            evidence: clip(value.evidence, 1000) ?? "",
            ...(artifact ? { artifact } : {}),
            ...Object.fromEntries((["decision_key", "effect", "current_content", "reopen_reason"] as const).flatMap((k) => (clip(value[k], 1000) ? [[k, clip(value[k], 1000)]] : []))),
            ...(value.timing === "now" || value.timing === "later" ? { timing: value.timing as "now" | "later" } : {}),
          };
          return [decision];
        })
      : (errors.push("decisions 必须是数组"), []);
    const list = unverifiedList(raw.unverified, "unverified", errors);
    if (round.acceptance_baseline) {
      errors.push(...acceptanceErrors(round.acceptance_baseline, round.acceptance_scope ?? [], raw.acceptance, String(raw.verdict), list));
      if (round.execution_digest !== requirementsDigest(work) || work.acceptance_baseline?.version !== round.acceptance_baseline.version) errors.push("当前要求/验收基准已变化，不能提交旧结果");
      // R01：提交入口与权威接受使用同一依据索引；判 met 但缺依据的结果当场退回。
      const evidence = await currentAcceptanceEvidence(header.cwd, acceptanceEvidence(round.acceptance_baseline, round.receipts), round.receipts);
      errors.push(...acceptanceGateErrors(round.acceptance_baseline, round.acceptance_scope ?? [], raw.acceptance as { items: Array<{ id: string; state: string }> } | undefined, evidence, (item) => item.files.every((file) => hashes[file] !== undefined), { requirement_record: round.acceptance_baseline.sources.length > 0 }));
    } else if (raw.acceptance !== undefined) errors.push("历史回合没有新验收基准，不能伪称新协议验收");
    const ledger = await store.reviews(work.work_key);
    for (const issue of issues) if (ledger.issues.some((i) => i.group === round.review_group && i.id === issue.id && i.artifact !== issue.artifact)) errors.push(`问题 ${issue.id} 已绑定其他成果；新问题须独立编号`);
    const rechecks: import("../../promax-ui-console/src/review-protocol.ts").IssueRecheck[] = [];
    if (raw.rechecks !== undefined && !Array.isArray(raw.rechecks)) errors.push("rechecks 必须是数组");
    for (const v of Array.isArray(raw.rechecks) ? raw.rechecks : []) {
      if (!object(v) || !clip(v.id, 60) || !["open", "verified", "unverifiable"].includes(String(v.state)) || !clip(v.evidence, 2000)) { errors.push("rechecks 每项需要 id、state、evidence"); continue; }
      if (!ledger.issues.some((i) => i.group === round.review_group && i.id === v.id)) errors.push(`rechecks 未知问题 ${v.id}`);
      if (issues.some((i) => i.id === v.id)) errors.push(`问题 ${v.id} 不能同时新增和复查`);
      rechecks.push({ id: String(v.id), state: v.state as "open" | "verified" | "unverifiable", evidence: String(v.evidence) });
    }
    if (new Set(issues.map((i) => i.id)).size !== issues.length || new Set(rechecks.map((i) => i.id)).size !== rechecks.length) errors.push("问题 ID 不得重复");
    if (raw.verdict === "PASS" && ledger.issues.some((i) => i.group === round.review_group && i.kind !== "suggestion" && !rechecks.some((r) => r.id === i.id && r.state === "verified") && (i.state !== "verified" || (round.acceptance_baseline && i.input_version !== version) || Object.entries(i.latest_hashes).some(([f, h]) => hashes[f] !== h)))) errors.push("PASS 前必须逐项核实未关闭或版本受影响的旧问题；漏回不关闭");
    if (raw.verdict === "PASS" && issues.some((i) => i.kind !== "suggestion")) errors.push("PASS 不能同时列出未解决缺陷或缺证据；非阻断建议用 kind=suggestion");
    if (raw.verdict === "REVISION_REQUIRED" && !issues.length && !rechecks.some((r) => r.state === "open") && !errors.some((e) => e.startsWith("issues"))) errors.push("REVISION_REQUIRED 必须列出可定位的问题");
    if (errors.length) {
      await store.noteFailure(work.work_key, { step: "check", class: "check_output_invalid", evidence: exec.callId, reason: errors.join("；"), strategy: "按错误逐项修正后重新调用 promax_check_result", at, task_key: round.task_key, runtime_version: deps.runtimeVersion });
      throw new Error(errors.join("；"));
    }
    const record: CheckResultRecord = {
      ...(round.acceptance_baseline ? { acceptance: structuredClone(raw.acceptance as AcceptanceResult) } : {}),
      judge_round: judgeRound,
      verdict: raw.verdict as CheckResultRecord["verdict"],
      scope: round.check_scope ?? "本次授权成果与工作卡已确认规则",
      reviewed_hashes: hashes,
      issues,
      rechecks,
      required_recheck_ids: ledger.issues.filter((i) => i.group === round.review_group && i.kind !== "suggestion" && (i.state !== "verified" || (round.acceptance_baseline && i.input_version !== version) || Object.entries(i.latest_hashes).some(([f, h]) => hashes[f] !== h))).map((i) => i.id),
      ...(round.review_request ? { review_request: round.review_request } : {}),
      unverified: list,
      decisions,
      report: `.任务/${round.task_key}/判定-r${judgeRound}.md`,
      input_version: version ?? 0,
      call_id: exec.callId,
      at,
    };
    const prior = round.check_results?.[String(judgeRound)];
    if (prior && JSON.stringify([prior.verdict, prior.issues, prior.rechecks ?? [], prior.unverified, prior.decisions, prior.acceptance]) === JSON.stringify([record.verdict, record.issues, record.rechecks ?? [], record.unverified, record.decisions, record.acceptance]))
      return { recorded: true, duplicate: true, note: "本轮同一检查结果已保存，未重复执行" };
    if (prior) throw new Error(`第 ${judgeRound} 轮检查结果已保存，不能覆盖`);
    staged.set(stageKey(exec), { kind: "check", workspace: header.cwd, key: work.work_key, task_key: round.task_key, record });
    return { recorded: true, note: "检查结果已通过校验，调用成功后保存并渲染报告" };
  }
  throw new Error(`未知结构化提交 ${name}`);
}

/**
 * Commits a staged value after the authoritative tool result. A failed result discards it. A commit that no longer
 * binds (the phase moved in between) is recorded as a failure of that step, never silently dropped.
 */
export function commitStructuredSubmission(exec: Exec, result: { isError: boolean }, deps: StructuredDeps) {
  const key = stageKey(exec);
  const entry = staged.get(key);
  if (!entry) return Promise.resolve(undefined);
  staged.delete(key);
  if (result.isError) return Promise.resolve(undefined);
  const pending = commitEntry(entry, exec, deps);
  const set = commits.get(entry.workspace) ?? new Set<Promise<unknown>>();
  commits.set(entry.workspace, set);
  set.add(pending);
  void pending.finally(() => set.delete(pending)).catch(() => undefined);
  return pending;
}
/** The tool-result notification cannot be awaited by the agent loop; state readers wait for in-flight commits instead. */
export async function settleStructuredCommits(workspace: string) {
  await Promise.allSettled([...(commits.get(workspace) ?? [])]);
}
const commits = new Map<string, Set<Promise<unknown>>>();
async function commitEntry(entry: Staged, exec: Exec, deps: StructuredDeps) {
  const store = new WorkStore(entry.workspace);
  try {
    if (entry.kind === "proposal") {
      const outcome = entry.running
        ? await store.noteAssistant(entry.key, entry.turn, entry.contract, entry.employeeMessages, { call_id: exec.callId })
        : await store.propose(entry.key, entry.turn, entry.seq, entry.contract, entry.employeeMessages, { call_id: exec.callId });
      await store.resolveStep(entry.key, "coordinator", ["proposal_invalid"]);
      return outcome ?? { handled: [], acting: false };
    }
    if (entry.kind === "repair") return await store.acceptRepairPlan(entry.key, entry.task_key, entry.plan);
    if (entry.kind === "receipt") {
      const accepted = await store.acceptReceipt(entry.key, entry.receipt, entry.task_key);
      if (entry.receipt.handoff && !accepted.duplicate) await store.observe(entry.key, { id: `ready:${exec.callId}`, kind: "information_ready", at: new Date().toISOString(), task_key: entry.task_key, member: entry.receipt.member, artifact: entry.receipt.filename, sha256: entry.receipt.sha256, handoff: entry.receipt.handoff });
      return accepted;
    }
    return await store.acceptCheckResult(entry.key, entry.record, entry.task_key, renderCheckReport(entry.record));
  } catch (error) {
    const reasons = error instanceof SubmissionRejected ? error.reasons : [error instanceof Error ? error.message : String(error)];
    await store.noteFailure(entry.key, {
      step: entry.kind === "proposal" ? "coordinator" : entry.kind === "check" || entry.kind === "repair" ? "check" : `file:${entry.receipt.filename}`,
      class: entry.kind === "proposal" ? "proposal_invalid" : entry.kind === "check" ? "check_output_invalid" : "member_receipt_missing",
      evidence: `commit:${exec.callId}`,
      reason: `提交通过校验但保存时失效：${reasons.join("；")}`,
      strategy: "按最新状态重新提交",
      at: new Date().toISOString(),
      runtime_version: deps.runtimeVersion,
    });
    return { rejected: reasons };
  }
}

const cell = (v: string) => v.replace(/\|/gu, "\\|").replace(/\r?\n/gu, " ");
/** Reading copy rendered from accepted data; the YAML header is serialized by the program, never hand-written. */
export function renderCheckReport(record: CheckResultRecord): string {
  const header = YAML.stringify({
    reviewer: "quality_judge",
    round: record.judge_round,
    verdict: record.verdict,
    scope: record.scope,
    reviewed_artifacts: Object.entries(record.reviewed_hashes).map(([filename, sha256]) => ({ filename, sha256 })),
    issues: record.issues,
    rechecks: record.rechecks ?? [],
    unverified: record.unverified,
    decisions: record.decisions,
    ...(record.acceptance ? { acceptance: record.acceptance } : {}),
  });
  const verdict = record.verdict === "PASS" ? "检查通过（限定范围）" : record.verdict === "REVISION_REQUIRED" ? "需要返修" : "无法完整检查";
  const lines = [
    `# 检查结果 · 第 ${record.judge_round} 轮`,
    "",
    `结论：${verdict}${record.decisions.length ? ` · 待你决定 ${record.decisions.length} 项` : ""}${record.unverified.length ? ` · 未验证 ${record.unverified.length} 项` : ""}`,
    "",
    `范围：${record.scope}`,
    "",
    "## 问题",
    ...(record.issues.length
      ? ["| 编号 | 严重度 | 成果 | 位置 | 依据 | 影响 | 修改要求 |", "| --- | --- | --- | --- | --- | --- | --- |", ...record.issues.map((i) => `| ${cell(i.id)} | ${i.severity} | ${cell(i.artifact)} | ${cell(i.location)} | ${cell(i.evidence)} | ${cell(i.impact)} | ${cell(i.fix)} |`)]
      : ["无"]),
    "",
    "## 旧问题复查",
    ...(record.rechecks?.length ? record.rechecks.map((r) => `- [${r.state === "verified" ? "x" : " "}] ${r.id} · ${r.state}：${r.evidence}`) : ["未提交逐项复查；旧问题不会自动关闭"]),
    "",
    "## 逐项验收",
    ...(record.acceptance ? [`基准：${record.acceptance.baseline_version}`, ...record.acceptance.items.map((i) => `- ${i.id} · ${i.state}：${i.evidence}`)] : ["历史协议，无新基准逐项验收"]),
    "",
    "## 未验证项",
    ...(record.unverified.length ? record.unverified.map((u) => `- ${u.item}：${u.reason}${u.impact ? `（${u.impact}；${u.requirement_ids?.join("、") || "一般限制"}）` : ""}`) : ["无"]),
    "",
    "## 待员工决定",
    ...(record.decisions.length ? record.decisions.map((d) => `- ${d.question}（${d.options.join(" / ")}）${d.location ? ` · 位置：${d.location}` : ""}`) : ["无"]),
    "",
  ];
  return `---\n${header}---\n${lines.join("\n")}`;
}

export function structuredToolDefinitions(deps: StructuredDeps) {
  return STRUCTURED_TOOLS.map((name) => ({
    name,
    description: DESCRIPTIONS[name]!,
    parameters: STRUCTURED_PARAMETERS[name]!,
    output: {
      schema: { type: "object", properties: { recorded: { type: "boolean" }, duplicate: { type: "boolean" }, note: { type: "string" } }, required: ["recorded"] },
      render: (_args: unknown, value: unknown) => [{ type: "text" as const, text: object(value) && typeof value.note === "string" ? value.note : "已提交" }],
    },
    execute: (args: unknown, exec: { callId: string; agent?: unknown }) => stageStructuredSubmission(name, args, exec as Exec, deps),
  }));
}
